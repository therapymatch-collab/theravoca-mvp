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
    for r in reqs:
        score = (r.get("notified_scores") or {}).get(therapist["id"])
        application = await db.applications.find_one(
            {"request_id": r["id"], "therapist_id": therapist["id"]},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1},
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
            "created_at": r["created_at"],
            "status": r.get("status"),
            "referral_status": ref_status,
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
            "presenting_issues_preview": (r.get("presenting_issues") or "")[:140],
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
