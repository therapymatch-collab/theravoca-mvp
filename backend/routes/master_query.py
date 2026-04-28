"""Admin master-query — natural-language Q&A over the business metrics
that matter day-to-day.

The endpoint computes a wide JSON snapshot of the platform on every call
(counts, status breakdowns, recency curves, revenue, top emails, etc.)
and hands it to Claude Sonnet 4.5 via the Emergent LLM key. Claude is
told to answer *only* from the snapshot, cite numbers exactly, and stay
short.

Snapshots are cached in-process for 60 seconds so a busy admin
hammering the input doesn't repeatedly recompute the same aggregates.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from deps import db, require_admin, logger

router = APIRouter()

_SNAPSHOT_TTL_SECS = 60
_snapshot_cache: dict[str, Any] = {"at": 0.0, "data": None}


async def _build_snapshot() -> dict:
    """Compute the metrics snapshot. Kept in this single function so we
    have one place to add new dimensions when the business asks new
    questions."""
    now = datetime.now(timezone.utc)
    iso7 = (now - timedelta(days=7)).isoformat()
    iso30 = (now - timedelta(days=30)).isoformat()

    # Requests
    total_requests = await db.requests.count_documents({})
    requests_7d = await db.requests.count_documents({"created_at": {"$gte": iso7}})
    requests_30d = await db.requests.count_documents({"created_at": {"$gte": iso30}})
    by_status = {}
    async for row in db.requests.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        by_status[row["_id"] or "unknown"] = row["n"]
    verified = await db.requests.count_documents({"verified": True})
    matched = await db.requests.count_documents({"status": "matched"})
    completed = await db.requests.count_documents({"status": "completed"})

    # Therapists
    total_therapists = await db.therapists.count_documents(
        {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}},
    )
    pending_approval = await db.therapists.count_documents({"pending_approval": True})
    pending_reapproval = await db.therapists.count_documents({"pending_reapproval": True})
    with_subscription = await db.therapists.count_documents({"subscription_status": "active"})

    # Applications
    total_applications = await db.applications.count_documents({})
    apps_7d = await db.applications.count_documents({"created_at": {"$gte": iso7}})

    # Conversion: % of verified requests that received >=1 application
    matched_with_apps = await db.requests.count_documents(
        {"verified": True, "status": "matched"}
    )

    # Top referral sources (last 90 days for relevance)
    iso90 = (now - timedelta(days=90)).isoformat()
    referral_breakdown: list[dict] = []
    async for row in db.requests.aggregate([
        {"$match": {"created_at": {"$gte": iso90}, "referral_source": {"$ne": None}}},
        {"$group": {"_id": "$referral_source", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 20},
    ]):
        referral_breakdown.append({"source": row["_id"], "count": row["n"]})

    # Top emails by request count (could be repeat patients)
    top_emails: list[dict] = []
    async for row in db.requests.aggregate([
        {"$group": {"_id": {"$toLower": "$email"}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gte": 2}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]):
        top_emails.append({"email": row["_id"], "request_count": row["n"]})

    # Geo coverage — patient requests
    geo: list[dict] = []
    async for row in db.requests.aggregate([
        {"$group": {"_id": "$location_state", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]):
        geo.append({"state": row["_id"], "count": row["n"]})

    # Therapist directory geo aggregates — used to answer questions like
    # "how many therapists do we have in Boise?" or "in 83702?".
    # We treat a therapist as covering each of `licensed_states` and
    # each `office_geos[].city`. Only count active+approved.
    t_match = {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}}
    therapists_by_state: list[dict] = []
    async for row in db.therapists.aggregate([
        {"$match": t_match},
        {"$unwind": {"path": "$licensed_states", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": {"$toUpper": "$licensed_states"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 25},
    ]):
        if row["_id"]:
            therapists_by_state.append({"state": row["_id"], "count": row["n"]})

    therapists_by_city: list[dict] = []
    async for row in db.therapists.aggregate([
        {"$match": t_match},
        {"$unwind": {"path": "$office_geos", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$office_geos.city", "n": {"$sum": 1}}},
        {"$match": {"_id": {"$nin": [None, ""]}}},
        {"$sort": {"n": -1}},
        {"$limit": 50},
    ]):
        therapists_by_city.append({"city": row["_id"], "count": row["n"]})

    # Zip aggregation — parse 5-digit zips from office_addresses since the
    # structured `office_geos` doesn't carry zip. Done in Python (small set).
    import re as _re
    zip_counts: dict[str, int] = {}
    async for t in db.therapists.find(
        t_match, {"_id": 0, "office_addresses": 1},
    ):
        addrs = t.get("office_addresses") or []
        if not isinstance(addrs, list):
            continue
        for a in addrs:
            for z in _re.findall(r"\b(\d{5})\b", a or ""):
                zip_counts[z] = zip_counts.get(z, 0) + 1
    therapists_by_zip = [
        {"zip": z, "count": n}
        for z, n in sorted(zip_counts.items(), key=lambda kv: -kv[1])[:50]
    ]

    # Concerns
    concerns: list[dict] = []
    async for row in db.requests.aggregate([
        {"$unwind": "$presenting_issues"},
        {"$group": {"_id": "$presenting_issues", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 15},
    ]):
        concerns.append({"issue": row["_id"], "count": row["n"]})

    # Revenue (very rough — sum of cash_rate * 1 per active therapist as a
    # ceiling proxy; the real bookkeeping lives in Stripe).
    cash_rates: list[float] = []
    async for t in db.therapists.find(
        {"cash_rate": {"$gt": 0}, "is_active": {"$ne": False}},
        {"_id": 0, "cash_rate": 1},
    ):
        if isinstance(t.get("cash_rate"), (int, float)):
            cash_rates.append(float(t["cash_rate"]))
    avg_cash = round(sum(cash_rates) / max(1, len(cash_rates)))

    # Profile completeness — short summary
    from profile_completeness import evaluate
    docs = await db.therapists.find(
        {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}}, {"_id": 0}
    ).to_list(2000)
    scores = [evaluate(t)["score"] for t in docs]
    publishable = sum(1 for t in docs if evaluate(t)["publishable"])
    avg_completeness = round(sum(scores) / max(1, len(scores)))

    # Feedback
    feedback_total = await db.feedback.count_documents({})
    feedback_recent: list[dict] = []
    async for f in db.feedback.find(
        {}, {"_id": 0, "name": 1, "email": 1, "message": 1, "created_at": 1}
    ).sort("created_at", -1).limit(5):
        feedback_recent.append(f)

    return {
        "now": now.isoformat(),
        "requests": {
            "total": total_requests,
            "verified": verified,
            "matched": matched,
            "completed": completed,
            "last_7_days": requests_7d,
            "last_30_days": requests_30d,
            "by_status": by_status,
        },
        "therapists": {
            "active_approved": total_therapists,
            "pending_approval": pending_approval,
            "pending_reapproval": pending_reapproval,
            "with_active_subscription": with_subscription,
            "average_cash_rate_usd": avg_cash,
            "profile_publishable": publishable,
            "average_completeness_score_pct": avg_completeness,
        },
        "applications": {
            "total": total_applications,
            "last_7_days": apps_7d,
            "verified_requests_with_match": matched_with_apps,
        },
        "top_referral_sources_90d": referral_breakdown,
        "repeat_submitter_emails": top_emails,
        "geo_distribution": geo,
        "therapists_by_state": therapists_by_state,
        "therapists_by_city": therapists_by_city,
        "therapists_by_zip": therapists_by_zip,
        "top_presenting_concerns": concerns,
        "feedback": {
            "total": feedback_total,
            "recent": feedback_recent,
        },
    }


async def _cached_snapshot() -> dict:
    if _snapshot_cache["data"] and time.time() - _snapshot_cache["at"] < _SNAPSHOT_TTL_SECS:
        return _snapshot_cache["data"]
    data = await _build_snapshot()
    _snapshot_cache.update({"at": time.time(), "data": data})
    return data


@router.get("/admin/master-query/snapshot")
async def admin_metrics_snapshot(_: bool = Depends(require_admin)):
    """Returns the raw snapshot — useful when the admin wants to inspect
    the exact data Claude is reasoning over (also handy for debugging)."""
    return await _cached_snapshot()


@router.post("/admin/master-query")
async def admin_master_query(payload: dict, _: bool = Depends(require_admin)):
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "Question is required")
    if len(question) > 600:
        raise HTTPException(400, "Question is too long (max 600 chars)")

    snapshot = await _cached_snapshot()

    # Lazy import so the rest of admin still boots if the Emergent
    # integrations package isn't installed for some reason.
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError as e:
        logger.exception("emergentintegrations missing")
        raise HTTPException(500, f"LLM integration unavailable: {e}")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "EMERGENT_LLM_KEY is not configured on the server")

    system = (
        "You are an analyst for TheraVoca, a patient-to-therapist matching platform. "
        "You will receive a JSON SNAPSHOT of the current business metrics, followed "
        "by an admin's question.\n\n"
        "Rules:\n"
        "1. Answer ONLY using the numbers in the snapshot. If the snapshot doesn't "
        "contain enough information, say so plainly and suggest which metric to add.\n"
        "2. Cite the exact number(s) you used (e.g. 'last 7 days: 42').\n"
        "3. Keep answers under 120 words. Use short bullets if you cite multiple stats.\n"
        "4. Never invent data, projections, or outside benchmarks.\n"
        "5. Do not output JSON or code unless explicitly asked. Reply in plain prose.\n"
        "6. For 'how many therapists in <city/zip/state>' questions, use the "
        "`therapists_by_city`, `therapists_by_zip`, and `therapists_by_state` "
        "arrays. Match case-insensitively. If the location isn't in the array, "
        "say zero (the array lists every location with at least one therapist)."
    )
    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"admin-mq-{uuid.uuid4()}",
            system_message=system,
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )

    import json as _json
    user_text = (
        f"SNAPSHOT (JSON):\n{_json.dumps(snapshot, default=str)}\n\n"
        f"QUESTION: {question}"
    )
    try:
        answer = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        logger.exception("Master-query LLM call failed")
        raise HTTPException(502, f"LLM call failed: {e}")
    return {
        "question": question,
        "answer": (answer or "").strip(),
        "snapshot_at": snapshot.get("now"),
    }
