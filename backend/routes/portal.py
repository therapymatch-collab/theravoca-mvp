"""Magic-link auth + patient/therapist portal routes."""
from __future__ import annotations

import asyncio
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from deps import (
    db, logger, MAGIC_CODE_MAX_PER_HOUR, MAGIC_CODE_TTL_MINUTES,
    _create_session_token, require_session,
)
from email_service import send_magic_code
from helpers import _now_iso, _safe_summary_for_therapist
from models import MagicCodeRequest, MagicCodeVerify

router = APIRouter()


@router.post("/auth/request-code")
async def auth_request_code(payload: MagicCodeRequest):
    if payload.role not in ("patient", "therapist"):
        raise HTTPException(400, "Invalid role")
    email = payload.email.lower()

    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.magic_codes.count_documents({
        "email": email, "role": payload.role, "created_at": {"$gte": one_hour_ago}
    })
    if recent >= MAGIC_CODE_MAX_PER_HOUR:
        raise HTTPException(429, "Too many code requests. Try again in an hour.")

    if payload.role == "therapist":
        therapist = await db.therapists.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
             "is_active": {"$ne": False},
             "pending_approval": {"$ne": True}},
            {"_id": 0, "id": 1},
        )
        if not therapist:
            logger.info("Magic-code requested for unknown/pending therapist email=%s", email)
            return {"ok": True}

    code = f"{secrets.randbelow(900000) + 100000:06d}"
    await db.magic_codes.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "role": payload.role,
        "code": code,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=MAGIC_CODE_TTL_MINUTES)).isoformat(),
        "used": False,
        "created_at": _now_iso(),
    })
    asyncio.create_task(send_magic_code(email, code, payload.role))
    return {"ok": True}


@router.post("/auth/verify-code")
async def auth_verify_code(payload: MagicCodeVerify):
    email = payload.email.lower()
    now_iso = _now_iso()
    rec = await db.magic_codes.find_one({
        "email": email,
        "role": payload.role,
        "code": payload.code,
        "used": False,
        "expires_at": {"$gte": now_iso},
    }, {"_id": 0})
    if not rec:
        raise HTTPException(401, "Invalid or expired code")
    await db.magic_codes.update_one(
        {"id": rec["id"]}, {"$set": {"used": True, "used_at": now_iso}}
    )
    token = _create_session_token(email, payload.role)
    return {"token": token, "role": payload.role, "email": email}


@router.get("/portal/me")
async def portal_me(
    session: dict[str, Any] = Depends(require_session(("patient", "therapist"))),
):
    return {"email": session["email"], "role": session["role"]}


@router.get("/portal/therapist/profile")
async def portal_therapist_profile(
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    """Return the therapist's own profile for the self-edit page.

    Strips fields the therapist shouldn't see/own (e.g., internal scoring
    caches) but keeps everything they're allowed to edit."""
    t = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0},
    )
    if not t:
        raise HTTPException(404, "Therapist profile not found")
    return t


# Fields a therapist can change directly without admin re-approval.
_SELF_EDITABLE_FIELDS = {
    "bio",
    "office_phone", "phone", "phone_alert",
    "website",
    "office_addresses", "office_locations",
    "client_types", "age_groups",
    "modalities", "modality_offering",
    "offers_in_person", "telehealth",
    "insurance_accepted",
    "cash_rate", "sliding_scale", "free_consult",
    "languages_spoken",
    "availability", "availability_notes",
    "profile_picture",
    "notify_by_email", "notify_by_sms",
}

# Fields that force a re-approval flag when edited (e.g., license or
# specialties changes need a human-in-the-loop check).
_REAPPROVAL_FIELDS = {
    "primary_specialties",
    "secondary_specialties",
    "general_treats",
    "license_number",
    "license_expires_at",
    "licensed_states",
    "years_experience",
    "credential_type",
    "gender",
    "name",
}


@router.put("/portal/therapist/profile")
async def portal_therapist_update_profile(
    payload: dict[str, Any],
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    """Therapist self-edit. Silently drops unknown/forbidden fields so
    clients can send the whole profile back without cherry-picking. Setting
    any field in `_REAPPROVAL_FIELDS` flips `pending_reapproval=True` so
    an admin sees it in the pending queue before the change goes live to
    patients."""
    allowed = _SELF_EDITABLE_FIELDS | _REAPPROVAL_FIELDS
    clean = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not clean:
        raise HTTPException(400, "No editable fields provided")

    # Clamp rate to sanity bounds (mirrors models.TherapistSignup)
    if "cash_rate" in clean:
        try:
            clean["cash_rate"] = max(0, min(1000, int(clean["cash_rate"])))
        except (TypeError, ValueError):
            clean.pop("cash_rate")
    # Enforce 3-age-group cap on self-edit too
    if "age_groups" in clean and isinstance(clean["age_groups"], list):
        clean["age_groups"] = clean["age_groups"][:3]

    current = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0},
    )
    if not current:
        raise HTTPException(404, "Therapist profile not found")

    reapproval_changed = [
        k for k in _REAPPROVAL_FIELDS
        if k in clean and current.get(k) != clean.get(k)
    ]
    update_doc = {**clean, "updated_at": _now_iso()}
    # Reset the stale-profile nag flag whenever they touch the profile —
    # they're active again and shouldn't get the nag email next week.
    unset_doc = {"stale_profile_nag_sent_at": ""}
    if reapproval_changed:
        update_doc["pending_reapproval"] = True
        update_doc["pending_reapproval_fields"] = reapproval_changed
        update_doc["pending_reapproval_at"] = _now_iso()

    await db.therapists.update_one(
        {"id": current["id"]},
        {"$set": update_doc, "$unset": unset_doc},
    )
    updated = await db.therapists.find_one({"id": current["id"]}, {"_id": 0})
    return {
        "ok": True,
        "profile": updated,
        "requires_reapproval": bool(reapproval_changed),
        "reapproval_fields": reapproval_changed,
    }


@router.get("/portal/patient/requests")
async def portal_patient_requests(
    session: dict[str, Any] = Depends(require_session(("patient",))),
):
    docs = await db.requests.find(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "verification_token": 0},
    ).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        app_count = await db.applications.count_documents({"request_id": d["id"]})
        d["application_count"] = app_count
        d["notified_count"] = len(d.get("notified_therapist_ids") or [])
        out.append(d)
    return out


@router.get("/portal/therapist/analytics")
async def portal_therapist_analytics(
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    """Lightweight analytics for the therapist portal: how many referrals
    we've sent them, how many they applied to / declined, conversion rate,
    avg match score, top specialty fits, and review summary."""
    from collections import Counter

    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")
    tid = therapist["id"]

    reqs = await db.requests.find(
        {"notified_therapist_ids": tid},
        {"_id": 0, "id": 1, "notified_scores": 1, "presenting_issues": 1,
         "created_at": 1, "results_sent_at": 1},
    ).to_list(500)
    invited = len(reqs)
    score_sum = 0.0
    score_count = 0
    issues_seen: Counter = Counter()
    for r in reqs:
        s = (r.get("notified_scores") or {}).get(tid)
        if s is not None:
            score_sum += float(s)
            score_count += 1
        for i in (r.get("presenting_issues") or []):
            issues_seen[i] += 1
    avg_score = round(score_sum / score_count, 1) if score_count else 0.0

    applied = await db.applications.count_documents({"therapist_id": tid})
    declined = await db.declines.count_documents({"therapist_id": tid})
    apply_rate = round(applied / invited * 100, 1) if invited else 0.0
    decline_rate = round(declined / invited * 100, 1) if invited else 0.0

    # Refer-a-colleague chain
    referrals_made = await db.therapists.count_documents(
        {"referred_by_code": therapist.get("referral_code") or "—"},
    )

    return {
        "invited_count": invited,
        "applied_count": applied,
        "declined_count": declined,
        "apply_rate": apply_rate,
        "decline_rate": decline_rate,
        "avg_match_score": avg_score,
        "top_referral_topics": dict(issues_seen.most_common(8)),
        "referrals_made": referrals_made,
        "referral_code": therapist.get("referral_code"),
        "review_avg": therapist.get("review_avg") or 0,
        "review_count": therapist.get("review_count") or 0,
        "review_source": therapist.get("review_research_source"),
    }


@router.get("/portal/therapist/referrals")
async def portal_therapist_referrals(
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")

    reqs = await db.requests.find(
        {"notified_therapist_ids": therapist["id"]},
        {"_id": 0, "email": 0, "verification_token": 0},
    ).sort("created_at", -1).to_list(100)

    out = []
    from matching import gap_axes
    for r in reqs:
        score = (r.get("notified_scores") or {}).get(therapist["id"])
        breakdown = (r.get("notified_breakdowns") or {}).get(therapist["id"]) or {}
        gaps = gap_axes(therapist, r, breakdown, top_n=3) if breakdown else []
        application = await db.applications.find_one(
            {"request_id": r["id"], "therapist_id": therapist["id"]},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1,
             "confirms_availability": 1, "confirms_urgency": 1,
             "confirms_payment": 1, "all_confirmed": 1},
        )
        decline = await db.declines.find_one(
            {"request_id": r["id"], "therapist_id": therapist["id"]},
            {"_id": 0},
        )
        if application:
            ref_status = "interested"
        elif decline:
            ref_status = "declined"
        else:
            ref_status = "pending"
        out.append({
            "request_id": r["id"],
            "match_score": score,
            "match_breakdown": breakdown,
            "gaps": gaps,
            "created_at": r["created_at"],
            "status": r.get("status"),
            "referral_status": ref_status,
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
            "presenting_issues_preview": (r.get("presenting_issues") or "")[:140] if isinstance(r.get("presenting_issues"), str) else (", ".join(r.get("presenting_issues") or []))[:140],
            "applied": bool(application),
            "application": application,
            "declined": bool(decline),
        })
    return {
        "therapist": {
            "id": therapist["id"],
            "name": therapist["name"],
            "email": therapist["email"],
            "phone": therapist.get("phone"),
            "phone_alert": therapist.get("phone_alert"),
            "office_phone": therapist.get("office_phone"),
            "credential_type": therapist.get("credential_type"),
            "license_number": therapist.get("license_number"),
            "license_expires_at": therapist.get("license_expires_at"),
            "license_picture": therapist.get("license_picture"),
            "primary_specialties": therapist.get("primary_specialties", []),
            "secondary_specialties": therapist.get("secondary_specialties", []),
            "general_treats": therapist.get("general_treats", []),
            "modalities": therapist.get("modalities", []),
            "modality_offering": therapist.get("modality_offering"),
            "office_locations": therapist.get("office_locations", []),
            "office_addresses": therapist.get("office_addresses", []),
            "website": therapist.get("website"),
            "insurance_accepted": therapist.get("insurance_accepted", []),
            "cash_rate": therapist.get("cash_rate"),
            "sliding_scale": therapist.get("sliding_scale"),
            "free_consult": therapist.get("free_consult"),
            "years_experience": therapist.get("years_experience"),
            "availability_windows": therapist.get("availability_windows", []),
            "urgency_capacity": therapist.get("urgency_capacity"),
            "style_tags": therapist.get("style_tags", []),
            "bio": therapist.get("bio"),
            "profile_picture": therapist.get("profile_picture"),
            "pending_approval": bool(therapist.get("pending_approval")),
            "is_active": therapist.get("is_active", True),
            "availability_prompt_pending": bool(therapist.get("availability_prompt_pending")),
            "last_availability_update_at": therapist.get("last_availability_update_at"),
            "referral_code": therapist.get("referral_code"),
            "pending_reapproval": bool(therapist.get("pending_reapproval")),
            "pending_reapproval_fields": therapist.get("pending_reapproval_fields", []),
            "updated_at": therapist.get("updated_at"),
        },
        "referrals": out,
    }


@router.post("/portal/therapist/availability-confirm")
async def portal_therapist_availability_confirm(
    payload: Optional[dict] = None,
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")
    update: dict[str, Any] = {
        "availability_prompt_pending": False,
        "last_availability_update_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    if payload and isinstance(payload.get("availability_windows"), list):
        update["availability_windows"] = [
            str(x) for x in payload["availability_windows"] if x
        ][:10]
    if payload and payload.get("urgency_capacity"):
        update["urgency_capacity"] = str(payload["urgency_capacity"])[:50]
    await db.therapists.update_one({"id": therapist["id"]}, {"$set": update})
    return {"ok": True, "updated": list(update.keys())}
