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


@router.post("/admin/outreach/{invite_id}/convert")
async def admin_convert_outreach_invite(
    invite_id: str, _: bool = Depends(require_admin),
):
    """Convert an LLM-invited candidate (`outreach_invites`) into a draft
    therapist profile (`therapists`). Carries over name/email/license/city/state
    /specialties/modalities. The new therapist starts in an `invited` state —
    invisible to matching, awaiting therapist completion + admin approval.
    The original `outreach_invites` row is kept and flagged as `converted` for
    audit trail, with `converted_therapist_id` pointing to the new profile."""
    import uuid as _uuid

    invite = await db.outreach_invites.find_one({"id": invite_id}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Outreach invite not found")
    if invite.get("status") == "converted":
        raise HTTPException(
            409,
            f"Already converted to therapist {invite.get('converted_therapist_id', '')}",
        )

    candidate = invite.get("candidate") or {}
    email = (candidate.get("email") or "").strip().lower()
    name = (candidate.get("name") or "").strip()
    if not email or not name:
        raise HTTPException(400, "Invite missing name or email")

    existing = await db.therapists.find_one(
        {"email": email}, {"_id": 0, "id": 1, "name": 1},
    )
    if existing:
        raise HTTPException(
            409,
            f"A therapist with email {email} already exists (id={existing['id']}).",
        )

    # Map LLM credential abbreviation → our credential_type values.
    license_type = (candidate.get("license_type") or "").upper().strip()
    credential_type = license_type if license_type else "Other"

    state = (candidate.get("state") or "ID").upper()
    city = (candidate.get("city") or "").strip()
    office_locations = [city] if city else []
    specialties = candidate.get("specialties") or []
    modalities = candidate.get("modalities") or []

    tid = str(_uuid.uuid4())
    referral_code = _uuid.uuid4().hex[:8].upper()
    therapist_doc = {
        "id": tid,
        "name": name,
        "email": email,
        "phone": "",
        "phone_alert": "",
        "office_phone": "",
        "gender": "",
        "credential_type": credential_type,
        "licensed_states": [state],
        "license_number": "",
        "license_expires_at": None,
        "license_picture": "",
        "client_types": [],
        "age_groups": [],
        "primary_specialties": specialties,
        "secondary_specialties": [],
        "general_treats": [],
        "modalities": modalities,
        "modality_offering": "telehealth",
        "telehealth": True,
        "offers_in_person": False,
        "office_locations": office_locations,
        "office_addresses": [],
        "office_geos": [],
        "website": "",
        "insurance_accepted": [],
        "cash_rate": None,
        "sliding_scale": False,
        "free_consult": False,
        "years_experience": None,
        "availability_windows": [],
        "urgency_capacity": False,
        "style_tags": [],
        "bio": "",
        "profile_picture": "",
        "notify_email": True,
        "notify_sms": False,
        "referral_code": referral_code,
        "source": "invited",
        "signup_status": "invited",
        "is_active": False,
        "pending_approval": True,
        "subscription_status": "incomplete",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": None,
        "current_period_end": None,
        "outreach_invite_id": invite_id,
        "outreach_request_id": invite.get("request_id"),
        "created_at": _now_iso(),
    }
    await db.therapists.insert_one(therapist_doc.copy())
    await db.outreach_invites.update_one(
        {"id": invite_id},
        {"$set": {
            "status": "converted",
            "converted_therapist_id": tid,
            "converted_at": _now_iso(),
        }},
    )
    return {
        "ok": True,
        "therapist_id": tid,
        "invite_id": invite_id,
        "status": "invited",
    }


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


DEFAULT_REFERRAL_SOURCE_OPTIONS = [
    "Google search",
    "Instagram",
    "Friend / family",
    "Therapist referred me",
    "News article / podcast",
    "Other",
    "Prefer not to say",
]


@router.get("/admin/referral-source-options", dependencies=[Depends(require_admin)])
async def admin_get_referral_source_options() -> dict[str, Any]:
    """Editable list of choices shown on the patient intake's
    'How did you hear about us?' dropdown."""
    doc = await db.app_config.find_one({"key": "referral_source_options"}, {"_id": 0})
    options = doc.get("options") if doc else None
    if not options:
        options = DEFAULT_REFERRAL_SOURCE_OPTIONS
    return {"options": options}


@router.put("/admin/referral-source-options", dependencies=[Depends(require_admin)])
async def admin_set_referral_source_options(payload: dict) -> dict[str, Any]:
    options = payload.get("options")
    if (
        not isinstance(options, list)
        or len(options) == 0
        or not all(isinstance(o, str) and o.strip() for o in options)
    ):
        raise HTTPException(400, "options must be a non-empty list of strings")
    cleaned = [o.strip() for o in options]
    await db.app_config.update_one(
        {"key": "referral_source_options"},
        {"$set": {"key": "referral_source_options", "options": cleaned}},
        upsert=True,
    )
    return {"options": cleaned}


# Public endpoint — patient intake calls this to populate its dropdown.
public_router = APIRouter()


@public_router.get("/config/referral-source-options")
async def public_referral_source_options() -> dict[str, Any]:
    doc = await db.app_config.find_one({"key": "referral_source_options"}, {"_id": 0})
    options = doc.get("options") if doc else None
    if not options:
        options = DEFAULT_REFERRAL_SOURCE_OPTIONS
    return {"options": options}


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


@router.post("/admin/therapists/{therapist_id}/research-reviews")
async def admin_research_therapist_reviews(
    therapist_id: str, _: bool = Depends(require_admin),
):
    """Run the LLM review-research agent against one therapist. Persists
    `review_avg` / `review_count` / `review_sources` if the agent finds high-
    confidence data; otherwise records `review_research_attempted_at` so we
    don't re-run for 30 days."""
    from review_research_agent import research_reviews_for_therapist
    return await research_reviews_for_therapist(therapist_id)


@router.post("/admin/therapists/research-reviews-all")
async def admin_research_all_reviews(
    payload: dict | None = None, _: bool = Depends(require_admin),
):
    """Bulk-run review research across all active therapists not researched in
    the last 30 days. Optional `limit` (default 100) caps the batch."""
    from review_research_agent import research_reviews_for_all
    limit = int((payload or {}).get("limit") or 100)
    return await research_reviews_for_all(limit=limit)


@router.get("/admin/coverage-gap-analysis")
async def admin_coverage_gap_analysis(_: bool = Depends(require_admin)):
    """Coverage gap analysis across the active therapist directory.

    Returns counts per dimension (specialty, modality, age group, insurance,
    language, urgency capacity, in-person vs telehealth, fee tier) plus a
    prioritized recommendations list of where we should recruit therapists
    before launch.
    """
    return await _compute_coverage_gap_analysis()


async def _compute_coverage_gap_analysis() -> dict:
    """Auth-free helper used by both the admin endpoint and the daily cron."""
    from collections import Counter

    # Demand priors — weighted by what a typical Idaho mental-health intake
    # population looks like (rough, but better than uniform).
    SPECIALTY_DEMAND = {
        "anxiety": "very_high", "depression": "very_high",
        "trauma_ptsd": "very_high", "relationship_issues": "high",
        "life_transitions": "high", "adhd": "high",
        "parenting_family": "medium", "substance_use": "medium",
        "ocd": "medium", "eating_concerns": "medium",
        "autism_neurodivergence": "medium", "school_academic_stress": "low",
    }
    DEMAND_TARGETS = {
        "very_high": 12, "high": 8, "medium": 5, "low": 3,
    }
    MODALITIES_CORE = [
        "CBT", "DBT", "EMDR", "ACT", "Mindfulness-Based",
        "Trauma-Informed", "IFS", "Psychodynamic",
    ]
    AGE_GROUPS = ["child", "teen", "young_adult", "adult", "older_adult"]
    AGE_GROUP_TARGETS = {
        "child": 8,         # historically thinnest — bump target so we recruit more
        "teen": 8,
        "young_adult": 5,
        "adult": 5,
        "older_adult": 5,
    }
    # Major Idaho cities outside Boise we want in-person coverage in.
    OUTSIDE_BOISE_CITIES = [
        "Meridian", "Nampa", "Idaho Falls", "Pocatello",
        "Coeur d'Alene", "Twin Falls",
    ]
    PER_CITY_INPERSON_TARGET = 3
    CLIENT_TYPES = ["individual", "couples", "family", "group"]
    INSURERS_CORE = [
        "Blue Cross of Idaho", "Regence BlueShield of Idaho",
        "Mountain Health Co-op", "PacificSource Health Plans",
        "SelectHealth", "Aetna", "Cigna", "UnitedHealthcare",
        "Idaho Medicaid", "Medicare", "Tricare West", "Optum",
    ]

    therapists = await db.therapists.find(
        {"is_active": True}, {"_id": 0},
    ).to_list(length=2000)
    total = len(therapists)

    # ── Per-dimension counts ──
    spec_counts: Counter = Counter()
    modality_counts: Counter = Counter()
    age_counts: Counter = Counter()
    client_counts: Counter = Counter()
    insurance_counts: Counter = Counter()
    language_counts: Counter = Counter()
    cred_counts: Counter = Counter()
    gender_counts: Counter = Counter()
    urgency_counts: Counter = Counter()
    has_id_office = 0
    in_person_by_city: Counter = Counter()
    telehealth_only = 0
    in_person_only = 0
    sliding_scale = 0
    free_consult = 0
    rate_buckets = {"<100": 0, "100-149": 0, "150-199": 0, "200-249": 0, "250+": 0}

    for t in therapists:
        for s in t.get("primary_specialties") or []:
            spec_counts[s] += 1
        for m in t.get("modalities") or []:
            modality_counts[m] += 1
        for a in t.get("age_groups") or []:
            age_counts[a] += 1
        for c in t.get("client_types") or []:
            client_counts[c] += 1
        for i in t.get("insurance_accepted") or []:
            insurance_counts[i] += 1
        for lang in t.get("languages_spoken") or []:
            language_counts[lang] += 1
        cred_counts[t.get("credential_type") or "Other"] += 1
        gender_counts[t.get("gender") or "unspecified"] += 1
        urgency_counts[t.get("urgency_capacity") or "unspecified"] += 1
        if t.get("office_addresses"):
            has_id_office += 1
            # Tally in-person coverage by Idaho city.
            for city in (t.get("office_locations") or [])[:3]:
                if city:
                    in_person_by_city[city.strip()] += 1
        if t.get("telehealth") and not t.get("offers_in_person"):
            telehealth_only += 1
        if t.get("offers_in_person") and not t.get("telehealth"):
            in_person_only += 1
        if t.get("sliding_scale"):
            sliding_scale += 1
        if t.get("free_consult"):
            free_consult += 1
        rate = t.get("cash_rate")
        if isinstance(rate, (int, float)):
            if rate < 100:
                rate_buckets["<100"] += 1
            elif rate < 150:
                rate_buckets["100-149"] += 1
            elif rate < 200:
                rate_buckets["150-199"] += 1
            elif rate < 250:
                rate_buckets["200-249"] += 1
            else:
                rate_buckets["250+"] += 1

    # ── Build recommendations ──
    gaps: list[dict] = []

    for slug, demand in SPECIALTY_DEMAND.items():
        target = DEMAND_TARGETS[demand]
        have = spec_counts.get(slug, 0)
        if have < target:
            gaps.append({
                "dimension": "specialty",
                "key": slug,
                "have": have,
                "target": target,
                "demand": demand,
                "severity": "critical" if have < target / 2 else "warning",
                "recommendation": (
                    f"Recruit {target - have} more therapist(s) specializing in "
                    f"`{slug.replace('_', ' ')}` — patient demand is {demand}."
                ),
            })
    for m in MODALITIES_CORE:
        have = modality_counts.get(m, 0)
        target = 6
        if have < target:
            gaps.append({
                "dimension": "modality",
                "key": m,
                "have": have,
                "target": target,
                "severity": "critical" if have < 3 else "warning",
                "recommendation": (
                    f"Recruit {target - have} more therapist(s) trained in "
                    f"{m} — common patient request."
                ),
            })
    for ag in AGE_GROUPS:
        have = age_counts.get(ag, 0)
        target = AGE_GROUP_TARGETS.get(ag, 5)
        if have < target:
            gaps.append({
                "dimension": "age_group",
                "key": ag,
                "have": have,
                "target": target,
                "severity": "critical" if have < target / 2 or have == 0 else "warning",
                "recommendation": (
                    f"Recruit {target - have} more therapist(s) serving "
                    f"`{ag}` — age group is a HARD filter in matching, "
                    "patients in this bucket will see weak or zero matches."
                ),
            })
    for ct in CLIENT_TYPES:
        have = client_counts.get(ct, 0)
        target = 4 if ct in ("individual", "couples") else 2
        if have < target:
            gaps.append({
                "dimension": "client_type",
                "key": ct,
                "have": have,
                "target": target,
                "severity": "critical" if have == 0 else "warning",
                "recommendation": (
                    f"Recruit {target - have} more therapist(s) offering "
                    f"`{ct}` therapy."
                ),
            })
    for ins in INSURERS_CORE:
        have = insurance_counts.get(ins, 0)
        target = 3
        if have < target:
            gaps.append({
                "dimension": "insurance",
                "key": ins,
                "have": have,
                "target": target,
                "severity": "warning",
                "recommendation": (
                    f"Only {have} therapist(s) accept {ins}. Patients on "
                    "this plan won't have many in-network options."
                ),
            })

    # Urgency capacity
    can_take_quick = (
        urgency_counts.get("asap", 0)
        + urgency_counts.get("within_2_3_weeks", 0)
    )
    if can_take_quick < 10:
        gaps.append({
            "dimension": "urgency",
            "key": "fast_intake",
            "have": can_take_quick,
            "target": 10,
            "severity": "warning",
            "recommendation": (
                f"Only {can_take_quick} therapist(s) flagged with ASAP / "
                "2–3-week capacity. Patients marking `urgency=asap` will see "
                "weak matches — prioritize confirming availability with your "
                "current network."
            ),
        })

    # Geographic coverage — per-city in-person targets outside Boise.
    # Case-insensitive city match so "Coeur D'Alene" / "coeur d'alene" all match.
    in_person_lower = {k.lower(): v for k, v in in_person_by_city.items()}
    for city in OUTSIDE_BOISE_CITIES:
        have = in_person_lower.get(city.lower(), 0)
        if have < PER_CITY_INPERSON_TARGET:
            gaps.append({
                "dimension": "geography",
                "key": city,
                "have": have,
                "target": PER_CITY_INPERSON_TARGET,
                "severity": "critical" if have == 0 else "warning",
                "recommendation": (
                    f"Only {have} therapist(s) with an in-person office in "
                    f"{city}. Recruit {PER_CITY_INPERSON_TARGET - have} more "
                    "in-person provider(s) here so patients outside Boise have "
                    "real local options."
                ),
            })

    # Fee diversity
    affordable = rate_buckets["<100"] + rate_buckets["100-149"]
    if affordable < 10:
        gaps.append({
            "dimension": "fee",
            "key": "affordable_cash",
            "have": affordable,
            "target": 10,
            "severity": "warning",
            "recommendation": (
                f"Only {affordable} therapist(s) charge <$150/hr cash. "
                "Patients with tight budgets will run out of options. "
                "Recruit more sliding-scale or interns/associates."
            ),
        })
    if sliding_scale < 20:
        gaps.append({
            "dimension": "fee",
            "key": "sliding_scale",
            "have": sliding_scale,
            "target": 20,
            "severity": "warning",
            "recommendation": (
                f"Only {sliding_scale} therapist(s) offer a sliding scale. "
                "We tell patients we have flexible-fee options — verify."
            ),
        })

    # Sort: critical > warning, then largest absolute gap.
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    gaps.sort(key=lambda g: (
        severity_order.get(g["severity"], 9),
        -(g["target"] - g["have"]),
    ))

    return {
        "total_active_therapists": total,
        "summary": {
            "specialties": dict(spec_counts.most_common()),
            "modalities": dict(modality_counts.most_common()),
            "age_groups": dict(age_counts.most_common()),
            "client_types": dict(client_counts.most_common()),
            "credentials": dict(cred_counts.most_common()),
            "genders": dict(gender_counts.most_common()),
            "urgency_capacity": dict(urgency_counts.most_common()),
            "insurance": dict(insurance_counts.most_common()),
            "languages": dict(language_counts.most_common()),
            "rate_distribution": rate_buckets,
            "with_idaho_office": has_id_office,
            "in_person_by_city": dict(in_person_by_city.most_common()),
            "telehealth_only": telehealth_only,
            "in_person_only": in_person_only,
            "sliding_scale_count": sliding_scale,
            "free_consult_count": free_consult,
        },
        "gaps": gaps,
        "gap_summary": {
            "critical": sum(1 for g in gaps if g["severity"] == "critical"),
            "warning": sum(1 for g in gaps if g["severity"] == "warning"),
            "total": len(gaps),
        },
    }


@router.post("/admin/gap-recruit/run")
async def admin_run_gap_recruit(
    payload: dict | None = None, _: bool = Depends(require_admin),
):
    """Manually trigger the gap recruiter. Pre-launch, runs in dry-run mode
    (fake `therapymatch+recruitNNN@gmail.com` emails). Post-launch, set
    `dry_run=false` in the payload to use real emails."""
    from gap_recruiter import run_gap_recruitment
    dry = bool((payload or {}).get("dry_run", True))
    cap = int((payload or {}).get("max_drafts", 30))
    return await run_gap_recruitment(dry_run=dry, max_drafts=cap)


@router.get("/admin/gap-recruit/drafts")
async def admin_list_gap_drafts(_: bool = Depends(require_admin)):
    """All recruit-draft rows, newest first."""
    docs = await db.recruit_drafts.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(length=500)
    sent = sum(1 for d in docs if d.get("sent"))
    pending = sum(1 for d in docs if not d.get("sent"))
    dry = sum(1 for d in docs if d.get("dry_run"))
    return {
        "drafts": docs,
        "total": len(docs),
        "sent": sent,
        "pending": pending,
        "dry_run_count": dry,
    }


@router.delete("/admin/gap-recruit/drafts/{draft_id}")
async def admin_delete_gap_draft(draft_id: str, _: bool = Depends(require_admin)):
    res = await db.recruit_drafts.delete_one({"id": draft_id})
    if res.deleted_count == 0:
        raise HTTPException(404)
    return {"ok": True}


@router.post("/admin/gap-recruit/send-all")
async def admin_send_gap_drafts(_: bool = Depends(require_admin)):
    """Fire off all pending non-dry-run drafts via Resend. Pre-launch this
    endpoint will return 0 sent because every draft is `dry_run=true`."""
    from gap_recruiter import send_pending_drafts
    return await send_pending_drafts()


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
