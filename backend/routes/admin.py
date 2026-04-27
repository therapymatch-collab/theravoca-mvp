"""Admin routes: login, requests, therapists, templates, declines, backfill, stats, cron triggers."""
from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from cron import (
    _run_availability_prompts, _run_daily_billing_charges,
    _run_followup_surveys, _run_license_expiry_alerts,
)
from deps import (
    db, logger, ADMIN_PASSWORD, DEFAULT_THRESHOLD,
    LOGIN_MAX_FAILURES, _check_lockout, _client_ip,
    _login_attempts, _record_failure, _reset_failures, require_admin,
)
from email_service import send_therapist_approved
from email_templates import DEFAULTS as EMAIL_TEMPLATE_DEFAULTS, list_templates, upsert_template
from helpers import _deliver_results, _now_iso, _trigger_matching
from seed_data import generate_seed_therapists
from sms_service import send_sms

router = APIRouter()


@router.post("/admin/login")
async def admin_login(payload: dict, request: Request):
    ip = _client_ip(request)
    remaining = _check_lockout(ip)
    if remaining is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {remaining // 60 + 1} minutes.",
        )
    if payload.get("password") != ADMIN_PASSWORD:
        _record_failure(ip)
        rec = _login_attempts.get(ip, {})
        attempts_left = max(0, LOGIN_MAX_FAILURES - rec.get("failures", 0))
        raise HTTPException(
            status_code=401,
            detail=f"Invalid password. {attempts_left} attempt(s) left before lockout.",
        )
    _reset_failures(ip)
    return {"ok": True}


@router.get("/admin/requests", response_model=list)
async def admin_list_requests(_: bool = Depends(require_admin)):
    docs = await db.requests.find(
        {}, {"_id": 0, "verification_token": 0}
    ).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        app_count = await db.applications.count_documents({"request_id": d["id"]})
        d["application_count"] = app_count
        d["notified_count"] = len(d.get("notified_therapist_ids") or [])
        out.append(d)
    return out


@router.get("/admin/requests/{request_id}", response_model=dict)
async def admin_request_detail(request_id: str, _: bool = Depends(require_admin)):
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)
    notified_ids = req.get("notified_therapist_ids") or []
    notified_distances = req.get("notified_distances") or {}
    notified = []
    for tid in notified_ids:
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        if t:
            notified.append({
                "id": t["id"],
                "name": t["name"],
                "email": t["email"],
                "match_score": (req.get("notified_scores") or {}).get(tid, 0),
                "distance_miles": notified_distances.get(tid),
                "office_locations": t.get("office_locations", []),
            })
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    apps.sort(key=lambda a: a["match_score"], reverse=True)
    return {"request": req, "notified": notified, "applications": apps}


@router.post("/admin/requests/{request_id}/trigger-results")
async def admin_trigger_results(request_id: str, _: bool = Depends(require_admin)):
    return await _deliver_results(request_id)


@router.post("/admin/requests/{request_id}/resend-notifications")
async def admin_resend_notifications(request_id: str, _: bool = Depends(require_admin)):
    return await _trigger_matching(request_id)


@router.put("/admin/requests/{request_id}/threshold")
async def admin_update_threshold(
    request_id: str, payload: dict, _: bool = Depends(require_admin),
):
    threshold = float(payload.get("threshold", DEFAULT_THRESHOLD))
    await db.requests.update_one({"id": request_id}, {"$set": {"threshold": threshold}})
    return {"id": request_id, "threshold": threshold}


@router.get("/admin/therapists", response_model=list)
async def admin_list_therapists(
    pending: Optional[bool] = None, _: bool = Depends(require_admin),
):
    query: dict[str, Any] = {}
    if pending is True:
        query["pending_approval"] = True
    elif pending is False:
        query["pending_approval"] = {"$ne": True}
    return await db.therapists.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/admin/therapists/{therapist_id}/approve")
async def admin_approve_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    import asyncio
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": True, "approved_at": _now_iso()}},
    )
    asyncio.create_task(send_therapist_approved(t["email"], t["name"]))
    return {"id": therapist_id, "status": "approved"}


@router.post("/admin/therapists/{therapist_id}/reject")
async def admin_reject_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": False, "rejected_at": _now_iso()}},
    )
    return {"id": therapist_id, "status": "rejected"}


@router.put("/admin/therapists/{therapist_id}")
async def admin_update_therapist(
    therapist_id: str, payload: dict, _: bool = Depends(require_admin),
):
    """Whitelisted update of a therapist profile."""
    allowed = {
        "name", "email", "phone", "phone_alert", "office_phone",
        "gender", "licensed_states",
        "license_number", "license_expires_at", "license_picture",
        "client_types", "age_groups",
        "primary_specialties", "secondary_specialties", "general_treats",
        "modalities", "modality_offering", "office_locations", "office_addresses",
        "website",
        "insurance_accepted", "cash_rate", "sliding_scale", "free_consult",
        "years_experience", "availability_windows", "urgency_capacity",
        "style_tags", "bio", "is_active", "pending_approval",
        "profile_picture", "credential_type", "notify_email", "notify_sms",
        "next_7_day_capacity", "responsiveness_score", "top_responder",
        "stripe_customer_id", "subscription_status", "trial_ends_at",
        "current_period_end",
        "review_avg", "review_count", "review_sources",
        "referral_code", "referred_by_code",
    }
    update = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not update:
        raise HTTPException(400, "No editable fields provided")
    update["updated_at"] = _now_iso()
    res = await db.therapists.update_one({"id": therapist_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Therapist not found")
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    return {"ok": True, "therapist": t}


@router.post("/admin/test-sms")
async def admin_test_sms(payload: dict, _: bool = Depends(require_admin)):
    to = (payload or {}).get("to") or os.environ.get("TWILIO_DEV_OVERRIDE_TO", "")
    body = (payload or {}).get("body") or "TheraVoca: SMS smoke test — your Twilio integration is wired up."
    if not to:
        raise HTTPException(400, "No recipient and no TWILIO_DEV_OVERRIDE_TO env set")
    result = await send_sms(to, body)
    if not result:
        return {"ok": False, "detail": "SMS send returned no result (check TWILIO_ENABLED + creds + logs)"}
    return {"ok": True, **result}


@router.get("/admin/email-templates")
async def admin_list_email_templates(_: bool = Depends(require_admin)):
    return await list_templates(db)


@router.put("/admin/email-templates/{key}")
async def admin_update_email_template(
    key: str, payload: dict, _: bool = Depends(require_admin),
):
    if key not in EMAIL_TEMPLATE_DEFAULTS:
        raise HTTPException(404, f"Unknown template key: {key}")
    return await upsert_template(db, key, payload or {})


@router.get("/admin/declines")
async def admin_list_declines(_: bool = Depends(require_admin)):
    declines = await db.declines.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    counts: dict[str, int] = {}
    for d in declines:
        for code in d.get("reason_codes") or []:
            counts[code] = counts.get(code, 0) + 1
    return {"declines": declines, "reason_counts": counts}


@router.post("/admin/backfill-therapists")
async def admin_backfill_therapists(_: bool = Depends(require_admin)):
    from backfill import backfill_therapist
    cur = db.therapists.find({}, {"_id": 0}).sort("created_at", 1)
    therapists = await cur.to_list(length=10_000)
    updated = 0
    for idx, t in enumerate(therapists, 1):
        set_fields = backfill_therapist(t, idx)
        if set_fields:
            set_fields["updated_at"] = _now_iso()
            await db.therapists.update_one(
                {"id": t["id"]}, {"$set": set_fields}
            )
            updated += 1
    return {"ok": True, "scanned": len(therapists), "updated": updated}


@router.post("/admin/seed")
async def admin_seed(_: bool = Depends(require_admin)):
    existing = await db.therapists.count_documents({})
    if existing > 0:
        return {"ok": True, "skipped": True, "existing": existing}
    therapists = generate_seed_therapists(100)
    await db.therapists.insert_many([t.copy() for t in therapists])
    return {"ok": True, "inserted": len(therapists)}


@router.get("/admin/stats")
async def admin_stats(_: bool = Depends(require_admin)):
    total_requests = await db.requests.count_documents({})
    pending = await db.requests.count_documents({"status": "pending_verification"})
    open_ = await db.requests.count_documents({"status": {"$in": ["open", "matched"]}})
    completed = await db.requests.count_documents({"status": "completed"})
    therapists = await db.therapists.count_documents({})
    pending_therapists = await db.therapists.count_documents({"pending_approval": True})
    apps = await db.applications.count_documents({})
    return {
        "total_requests": total_requests,
        "pending": pending,
        "open": open_,
        "completed": completed,
        "therapists": therapists,
        "pending_therapists": pending_therapists,
        "applications": apps,
        "default_threshold": DEFAULT_THRESHOLD,
    }


@router.post("/admin/run-daily-tasks")
async def admin_run_daily_tasks(_: bool = Depends(require_admin)):
    """Manual trigger for the daily cron — useful for testing without waiting until 2am MT."""
    bill = await _run_daily_billing_charges()
    lic = await _run_license_expiry_alerts()
    avail = await _run_availability_prompts()
    follow = await _run_followup_surveys()
    return {"ok": True, "billing": bill, "license": lic, "availability": avail, "followups": follow}


@router.get("/admin/followups")
async def admin_list_followups(_: bool = Depends(require_admin)):
    """All follow-up survey responses across all milestones."""
    docs = await db.followups.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    counts = {"48h": 0, "2wk": 0, "6wk": 0}
    helpful_scores: list[int] = []
    contacted = 0
    for d in docs:
        m = d.get("milestone")
        if m in counts:
            counts[m] += 1
        if d.get("helpful_score") is not None:
            helpful_scores.append(int(d["helpful_score"]))
        if d.get("contacted_therapist"):
            contacted += 1
    avg = round(sum(helpful_scores) / len(helpful_scores), 2) if helpful_scores else None
    return {
        "responses": docs,
        "counts": counts,
        "avg_helpful_score": avg,
        "contacted_count": contacted,
        "total": len(docs),
    }


@router.post("/admin/therapists/bulk-approve")
async def admin_bulk_approve_therapists(payload: dict, _: bool = Depends(require_admin)):
    """Approve a list of pending therapists in one shot."""
    import asyncio
    ids = [str(x) for x in (payload or {}).get("therapist_ids") or []][:200]
    approved: list[str] = []
    for tid in ids:
        t = await db.therapists.find_one({"id": tid}, {"_id": 0, "id": 1, "email": 1, "name": 1})
        if not t:
            continue
        await db.therapists.update_one(
            {"id": tid},
            {"$set": {"pending_approval": False, "is_active": True, "approved_at": _now_iso()}},
        )
        asyncio.create_task(send_therapist_approved(t["email"], t["name"]))
        approved.append(tid)
    return {"ok": True, "approved": approved, "count": len(approved)}


@router.get("/admin/therapists/export.csv")
async def admin_export_therapists_csv(_: bool = Depends(require_admin)):
    """CSV dump of all therapists for spreadsheet review."""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    therapists = await db.therapists.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    cols = [
        "id", "name", "email", "phone_alert", "office_phone", "website",
        "credential_type", "license_number", "license_expires_at",
        "subscription_status", "pending_approval", "is_active",
        "primary_specialties", "secondary_specialties", "general_treats",
        "modalities", "modality_offering", "office_locations", "office_addresses",
        "insurance_accepted", "cash_rate", "sliding_scale", "free_consult",
        "years_experience", "availability_windows", "urgency_capacity",
        "created_at",
    ]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for t in therapists:
        row = []
        for c in cols:
            v = t.get(c)
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v)
            row.append(v if v is not None else "")
        w.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=theravoca_therapists.csv"},
    )


@router.post("/admin/outreach/run/{request_id}")
async def admin_run_outreach(request_id: str, _: bool = Depends(require_admin)):
    """Trigger LLM outreach agent for a single request. Idempotent."""
    from outreach_agent import run_outreach_for_request
    return await run_outreach_for_request(request_id)


@router.post("/admin/outreach/run-all")
async def admin_run_outreach_all(_: bool = Depends(require_admin)):
    """Run LLM outreach agent on all recent requests with outreach gap."""
    from outreach_agent import run_outreach_for_all_pending
    return await run_outreach_for_all_pending()


@router.get("/admin/outreach")
async def admin_list_outreach(_: bool = Depends(require_admin)):
    docs = await db.outreach_invites.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"invites": docs, "total": len(docs)}


@router.get("/admin/referral-sources")
async def admin_referral_sources(
    start: Optional[str] = None,
    end: Optional[str] = None,
    _: bool = Depends(require_admin),
):
    """Aggregate patient requests by `referral_source` between optional ISO
    dates. Empty source is bucketed as `(unspecified)`.

    Returns: {sources: [{source, count}, ...], total, range: {start, end}}
    """
    from helpers import _parse_iso
    query: dict[str, Any] = {}
    if start or end:
        rng: dict[str, str] = {}
        if start:
            s_dt = _parse_iso(start)
            if s_dt:
                rng["$gte"] = s_dt.isoformat()
        if end:
            e_dt = _parse_iso(end)
            if e_dt:
                rng["$lte"] = e_dt.isoformat()
        if rng:
            query["created_at"] = rng
    docs = await db.requests.find(
        query, {"_id": 0, "referral_source": 1, "created_at": 1, "id": 1, "email": 1},
    ).sort("created_at", -1).to_list(2000)
    counts: dict[str, int] = {}
    for d in docs:
        src = (d.get("referral_source") or "").strip() or "(unspecified)"
        counts[src] = counts.get(src, 0) + 1
    sources = sorted(
        ({"source": k, "count": v} for k, v in counts.items()),
        key=lambda x: x["count"],
        reverse=True,
    )
    return {
        "sources": sources,
        "total": len(docs),
        "range": {"start": start, "end": end},
        "samples": docs[:50],
    }


@router.post("/admin/therapists/{therapist_id}/reviews")
async def admin_update_therapist_reviews(
    therapist_id: str, payload: dict, _: bool = Depends(require_admin),
):
    """Manually attach review data to a therapist (manual-entry stub for the
    web-scraping pipeline). `payload`: {avg, count, sources: [{platform, url, rating}]}."""
    avg = float(payload.get("avg") or 0)
    cnt = int(payload.get("count") or 0)
    sources = payload.get("sources") or []
    if not 0 <= avg <= 5 or cnt < 0:
        raise HTTPException(400, "Invalid review data")
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "review_avg": avg, "review_count": cnt, "review_sources": sources,
            "review_updated_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    return {"ok": True, "review_avg": avg, "review_count": cnt}


@router.post("/admin/seed/reset")
async def admin_seed_reset(_: bool = Depends(require_admin)):
    """DESTRUCTIVE — clears requests/applications/declines/therapists/magic_codes
    and re-seeds 100 fresh therapists (v3 schema). Also kicks off office geocoding."""
    cleared = {
        "requests": (await db.requests.delete_many({})).deleted_count,
        "applications": (await db.applications.delete_many({})).deleted_count,
        "declines": (await db.declines.delete_many({})).deleted_count,
        "therapists": (await db.therapists.delete_many({})).deleted_count,
        "magic_codes": (await db.magic_codes.delete_many({})).deleted_count,
        "cron_runs": (await db.cron_runs.delete_many({})).deleted_count,
    }
    therapists = generate_seed_therapists(100)
    await db.therapists.insert_many([t.copy() for t in therapists])
    # Trigger geocoding inline so post-reset matching works without waiting for the
    # async startup task. Uses cached city geos so it's fast (<2s for 100 therapists).
    from helpers import _backfill_therapist_geo
    await _backfill_therapist_geo()
    return {"ok": True, "cleared": cleared, "seeded": len(therapists)}


# Suppress unused-import warnings on logger (kept for future logging)
void = logger
