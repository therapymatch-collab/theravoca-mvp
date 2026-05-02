"""Magic-link auth + patient/therapist portal routes."""
from __future__ import annotations

import asyncio
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request

from deps import (
    db, logger, MAGIC_CODE_MAX_PER_HOUR, MAGIC_CODE_TTL_MINUTES,
    LOGIN_MAX_FAILURES, LOGIN_LOCKOUT_MINUTES,
    _create_session_token, require_session, _client_ip,
)
from email_service import send_magic_code
from helpers import _now_iso, _safe_summary_for_therapist, _spawn_bg
from models import MagicCodeRequest, MagicCodeVerify
from profile_completeness import evaluate as _evaluate_profile_inline

router = APIRouter()


# ─── Password helpers ─────────────────────────────────────────────────────────
def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# Persistent (DB-backed) lockout for password login attempts. Keyed by
# `{ip}:{email}` so an attacker can't lock out a real user from another
# IP. Uses the existing `LOGIN_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES`
# env constants for parity with the admin login flow.
async def _password_lockout_remaining(key: str) -> Optional[int]:
    rec = await db.password_login_attempts.find_one({"_id": key}, {"_id": 0})
    if not rec or not rec.get("locked_until"):
        return None
    locked_until = rec["locked_until"]
    if isinstance(locked_until, str):
        try:
            locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
        except ValueError:
            return None
    now = datetime.now(timezone.utc)
    if locked_until > now:
        return int((locked_until - now).total_seconds())
    await db.password_login_attempts.delete_one({"_id": key})
    return None


async def _password_record_failure(key: str) -> None:
    rec = await db.password_login_attempts.find_one({"_id": key}, {"_id": 0})
    failures = (rec or {}).get("failures", 0) + 1
    update: dict[str, Any] = {"failures": failures, "updated_at": _now_iso()}
    if failures >= LOGIN_MAX_FAILURES:
        update["locked_until"] = (
            datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        ).isoformat()
        logger.warning("Password login locked for key=%s after %d failures", key, failures)
    await db.password_login_attempts.update_one(
        {"_id": key}, {"$set": update}, upsert=True
    )


async def _password_reset_failures(key: str) -> None:
    await db.password_login_attempts.delete_one({"_id": key})


async def _find_user_doc(email: str, role: str) -> Optional[dict[str, Any]]:
    """Locate the auth-bearing record for an email + role.

    Therapists: stored on the `therapists` collection (one doc per therapist).
    Patients:   stored on the `patient_accounts` collection (created lazily
                when the patient sets a password — patients have no global
                profile record otherwise).
    """
    email_norm = email.lower()
    if role == "therapist":
        return await db.therapists.find_one(
            {"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"},
             "is_active": {"$ne": False}},
            {"_id": 0},
        )
    if role == "patient":
        return await db.patient_accounts.find_one({"email": email_norm}, {"_id": 0})
    return None


async def _set_password_on_doc(email: str, role: str, password_hash: str) -> bool:
    """Store the password hash on the appropriate collection. Returns True if
    a record was actually updated/created."""
    email_norm = email.lower()
    now = _now_iso()
    if role == "therapist":
        res = await db.therapists.update_one(
            {"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"}},
            {"$set": {"password_hash": password_hash, "password_set_at": now,
                      "updated_at": now}},
        )
        return res.matched_count > 0
    if role == "patient":
        # Lazy-create a `patient_accounts` row; patients don't have a global
        # profile doc otherwise. We seed `created_at` only on insert.
        await db.patient_accounts.update_one(
            {"email": email_norm},
            {"$set": {"password_hash": password_hash, "password_set_at": now,
                      "updated_at": now},
             "$setOnInsert": {"email": email_norm, "created_at": now}},
            upsert=True,
        )
        return True
    return False



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
    _spawn_bg(
        send_magic_code(email, code, payload.role),
        name=f"magic_code_{email[:8]}",
    )
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
    # Tell the client whether this account already has a password — used by
    # the portal to nudge first-time users to set one for password login.
    user = await _find_user_doc(email, payload.role)
    has_password = bool(user and user.get("password_hash"))
    return {
        "token": token,
        "role": payload.role,
        "email": email,
        "has_password": has_password,
    }


# ─── Password auth ────────────────────────────────────────────────────────────
@router.get("/auth/password-status")
async def auth_password_status(email: str, role: str):
    """Public — tells the SignIn page whether to show a password input or
    fall back to magic-code only. Always returns 200 to avoid leaking
    account existence; `has_password=False` for unknown emails."""
    if role not in ("patient", "therapist"):
        raise HTTPException(400, "Invalid role")
    user = await _find_user_doc(email, role)
    return {"has_password": bool(user and user.get("password_hash"))}


@router.post("/auth/login-password")
async def auth_login_password(payload: dict[str, Any], request: Request):
    """Email + password login. Returns the same shape as `/auth/verify-code`
    so the frontend can treat both paths interchangeably."""
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role = payload.get("role")
    if role not in ("patient", "therapist"):
        raise HTTPException(400, "Invalid role")
    if "@" not in email or not password:
        raise HTTPException(400, "Email and password required")

    ip = _client_ip(request)
    key = f"{ip}:{role}:{email}"
    locked = await _password_lockout_remaining(key)
    if locked is not None:
        raise HTTPException(429, f"Too many failed attempts. Try again in {locked // 60 + 1} min.")

    user = await _find_user_doc(email, role)
    if not user or not user.get("password_hash"):
        await _password_record_failure(key)
        raise HTTPException(401, "Email or password is incorrect")
    if role == "therapist" and user.get("pending_approval"):
        raise HTTPException(403, "Your therapist profile is still under review.")
    if not _verify_password(password, user["password_hash"]):
        await _password_record_failure(key)
        raise HTTPException(401, "Email or password is incorrect")

    await _password_reset_failures(key)
    token = _create_session_token(email, role)
    return {"token": token, "role": role, "email": email, "has_password": True}


@router.post("/auth/set-password")
async def auth_set_password(
    payload: dict[str, Any],
    session: dict[str, Any] = Depends(require_session(("patient", "therapist"))),
):
    """Set or change the current user's password. Requires an active
    magic-link session (or an existing password session) so we know the
    email is already verified."""
    password = payload.get("password") or ""
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if len(password) > 128:
        raise HTTPException(400, "Password is too long (max 128 chars)")

    ok = await _set_password_on_doc(session["email"], session["role"], _hash_password(password))
    if not ok:
        raise HTTPException(404, "Account not found")
    # Invalidate any prior failure counters so the user can immediately log
    # in with the new password.
    await db.password_login_attempts.delete_many(
        {"_id": {"$regex": f":{re.escape(session['role'])}:{re.escape(session['email'])}$"}}
    )
    return {"ok": True}


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
    # Deep-match style answers (v5). Therapists fill or update these
    # without admin re-approval — they're style answers, not licensure
    # claims. T5/T6b changes also trigger an embedding refresh.
    "t1_stuck_ranked", "t3_breakthrough",
    "t4_hard_truth", "t5_lived_experience",
    "t6_session_expectations", "t6_early_sessions_description",
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
    # Re-embed T5 in the background if it changed. We schedule
    # rather than await so the portal-save UX stays snappy.
    t5_changed = "t5_lived_experience" in clean and current.get("t5_lived_experience") != clean.get("t5_lived_experience")
    if t5_changed:
        from routes.therapists import _embed_therapist_signals
        new_t5 = clean.get("t5_lived_experience") if "t5_lived_experience" in clean else current.get("t5_lived_experience", "")
        _spawn_bg(
            _embed_therapist_signals(current["id"], new_t5 or "", ""),
            name=f"embed_portal_{current['id'][:8]}",
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
    # Surface password-account flag so the portal can prompt the patient to
    # set a password if they're still on magic-code-only.
    user = await _find_user_doc(session["email"], "patient")
    return {
        "requests": out,
        "has_password": bool(user and user.get("password_hash")),
        "email": session["email"],
    }


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
    # Round to whole numbers — the portal UI shows these as `${n}%`
    # chips and decimal precision (85.3%, 76.5%) reads as false-precision
    # to therapists. Whole numbers convey the same information with less
    # cognitive load.
    avg_score = int(round(score_sum / score_count)) if score_count else 0
    applied = await db.applications.count_documents({"therapist_id": tid})
    declined = await db.declines.count_documents({"therapist_id": tid})
    apply_rate = int(round(applied / invited * 100)) if invited else 0
    decline_rate = int(round(declined / invited * 100)) if invited else 0

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
            "has_password": bool(therapist.get("password_hash")),
            "completeness": _evaluate_profile_inline(therapist),
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
