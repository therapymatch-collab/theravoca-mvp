"""Patient-facing routes: requests CRUD, verify, results, and admin release."""
from __future__ import annotations

import asyncio
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from deps import db, DEFAULT_THRESHOLD, _decode_session_from_authorization, require_admin
from email_service import send_verification_email
from geocoding import geocode_city, geocode_zip
from helpers import _now_iso, _parse_iso, _trigger_matching
from models import FollowupResponse, RequestCreate
from sms_service import send_patient_intake_receipt_sms
from validation import (
    email_is_plausible, is_disposable_email,
    validate_zip_city_consistent, validate_zip_for_state,
)

router = APIRouter()


@router.get("/")
async def root():
    return {"app": "TheraVoca", "status": "ok"}


@router.get("/requests/prefill")
async def prefill_from_prior_request(email: str):
    """Returning-patient helper: if this email already filed a request,
    return the fields that never change between visits (referral source,
    attribution, location, language) so we can pre-populate the intake.
    We DO NOT pre-fill the sensitive clinical fields (presenting issues,
    payment situation, urgency) — those legitimately change every time
    they come back.
    """
    import re
    email_norm = (email or "").strip().lower()
    if not email_norm or "@" not in email_norm:
        raise HTTPException(400, "Invalid email")
    prior = await db.requests.find_one(
        {"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"}},
        {
            "_id": 0, "verification_token": 0,
            "email": 0, "phone": 0,
        },
        sort=[("created_at", -1)],
    )
    if not prior:
        return {"returning": False, "has_password_account": False}
    has_account = await db.patient_accounts.find_one(
        {"email": email_norm, "password_hash": {"$exists": True, "$ne": None}},
        {"_id": 0, "email": 1},
    )
    return {
        "returning": True,
        "prefill": {
            "referral_source": prior.get("referral_source"),
            "zip_code": prior.get("zip_code"),
            "preferred_language": prior.get("preferred_language"),
            "age_group": prior.get("age_group"),
            "gender_preference": prior.get("gender_preference"),
        },
        "prior_request_count": await db.requests.count_documents(
            {"email": {"$regex": f"^{re.escape(email_norm)}$", "$options": "i"}},
        ),
        "has_password_account": bool(has_account),
    }


@router.post("/requests", response_model=dict)
async def create_request(payload: RequestCreate, request: Request):
    # ─── Bot defenses (run before anything expensive) ──────────────────
    # 1. Honeypot: a hidden form field bots auto-fill. Real users never
    #    see it, so any non-empty value is a clear signal. We respond
    #    with a generic 400 so scrapers don't learn what tripped them.
    if (payload.fax_number or "").strip():
        raise HTTPException(400, "Submission rejected.")
    # 2. Timing heuristic: humans take >2s to fill the form, bots fire
    #    instantly. We compare the client timestamp against now; if the
    #    delta is <2s OR the client clock is wildly off (>1h skew),
    #    drop the request.
    if payload.form_started_at_ms is not None:
        try:
            started_ms = int(payload.form_started_at_ms)
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            delta_s = (now_ms - started_ms) / 1000.0
            if delta_s < 2.0 or delta_s > 24 * 3600.0:
                raise HTTPException(400, "Submission rejected.")
        except (TypeError, ValueError):
            pass
    # 3. Per-IP rate limit: cap intake submissions per IP per hour.
    #    `X-Forwarded-For` is set by our k8s ingress; fall back to the
    #    raw socket address. Track in `intake_ip_log` collection (no
    #    PII — just the IP and a timestamp).
    fwd = request.headers.get("x-forwarded-for") or ""
    client_ip = (fwd.split(",")[0].strip() if fwd else None) or (
        getattr(request.client, "host", None) or ""
    )
    # Test-mode short-circuit: when an admin has toggled test mode on,
    # bypass BOTH rate-limit axes for the configured window so the same
    # admin can run end-to-end intake tests without tripping their own
    # anti-spam guards. Honeypot / timing / Turnstile remain enforced.
    rate_cfg_doc = await db.app_config.find_one(
        {"key": "intake_rate_limit"}, {"_id": 0},
    )
    test_mode_active = False
    test_until = (rate_cfg_doc or {}).get("test_mode_until")
    if test_until:
        try:
            until_dt = _parse_iso(test_until)
            if until_dt and until_dt > datetime.now(timezone.utc):
                test_mode_active = True
        except Exception:
            pass
    if client_ip and not test_mode_active:
        ip_cutoff_iso = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        ).isoformat()
        ip_recent = await db.intake_ip_log.count_documents(
            {"ip": client_ip, "ts": {"$gte": ip_cutoff_iso}},
        )
        # Admin-tunable IP cap. Stored alongside the per-email rate limit
        # in `app_config.intake_rate_limit.max_per_ip_per_hour`. Default
        # 8 — enough for clinic / family wifi but tight against scripts.
        ip_cap = int(
            (rate_cfg_doc or {}).get("max_per_ip_per_hour") or 8
        )
        if ip_cap > 0 and ip_recent >= ip_cap:
            raise HTTPException(
                429,
                "Too many submissions from this network in the last hour. "
                "Please try again later.",
            )

    # 4. Cloudflare Turnstile (CAPTCHA replacement). Fail-soft: when the
    #    secret key isn't configured this returns ok=True so dev/preview
    #    keep working without keys. When configured, an invalid or
    #    missing token rejects the submission with a clear 400.
    from turnstile_service import verify_token as verify_turnstile
    ok, ts_err = await verify_turnstile(
        payload.turnstile_token, remote_ip=client_ip,
    )
    if not ok:
        raise HTTPException(400, ts_err or "Security check failed.")

    # ─── Spam / sanity gates (run before any DB writes) ────────────────
    if not email_is_plausible(payload.email):
        raise HTTPException(400, "That email address doesn't look right. Please double-check it.")
    if is_disposable_email(payload.email):
        raise HTTPException(
            400, "Please use a personal email — disposable / temp-mail addresses aren't accepted.",
        )
    if payload.location_zip and not validate_zip_for_state(
        payload.location_zip, payload.location_state,
    ):
        raise HTTPException(
            400,
            f"ZIP {payload.location_zip} doesn't belong to {payload.location_state}. "
            "Please correct the ZIP or state.",
        )
    if payload.location_zip and payload.location_city:
        msg = await validate_zip_city_consistent(
            db, payload.location_zip, payload.location_city, payload.location_state,
        )
        if msg:
            raise HTTPException(400, msg)

    # ─── Per-email rate limit ─────────────────────────────────────────
    # We cap how many times the same email can submit within a rolling
    # window so a single user can't fire dozens of referrals before we
    # finish matching the first one. Both the limit and the window are
    # admin-configurable (app_config / intake_rate_limit).
    # Reuse rate_cfg_doc fetched above (test-mode check) to avoid a
    # second round-trip.
    rate_doc = rate_cfg_doc
    max_per_window = int(
        (rate_doc or {}).get("max_requests_per_window") or 1
    )
    window_minutes = int((rate_doc or {}).get("window_minutes") or 60)
    if not test_mode_active and max_per_window > 0 and window_minutes > 0:
        import re as _re
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
        ).isoformat()
        recent = await db.requests.count_documents(
            {
                "email": {
                    "$regex": f"^{_re.escape(payload.email.strip())}$",
                    "$options": "i",
                },
                "created_at": {"$gte": cutoff},
            },
        )
        if recent >= max_per_window:
            # Compute the minutes until they can submit again so the error
            # message tells them exactly when, not just "wait".
            most_recent = await db.requests.find_one(
                {
                    "email": {
                        "$regex": f"^{_re.escape(payload.email.strip())}$",
                        "$options": "i",
                    },
                },
                sort=[("created_at", -1)],
                projection={"_id": 0, "created_at": 1},
            )
            wait_minutes = window_minutes
            if most_recent and most_recent.get("created_at"):
                last_dt = _parse_iso(most_recent["created_at"])
                if last_dt:
                    elapsed = (
                        datetime.now(timezone.utc) - last_dt
                    ).total_seconds() / 60.0
                    wait_minutes = max(1, int(window_minutes - elapsed) + 1)
            window_label = (
                "hour"
                if window_minutes == 60
                else f"{window_minutes} minutes"
            )
            plural = "request" if max_per_window == 1 else "requests"
            raise HTTPException(
                429,
                f"You've already submitted a referral in the last {window_label}. "
                "We're working on matching you now — check your email for "
                "next steps. You can submit a new referral in about "
                f"{wait_minutes} minute{'s' if wait_minutes != 1 else ''}. "
                f"(Limit: {max_per_window} {plural} per {window_label}.)",
            )

    rid = str(uuid.uuid4())
    token = secrets.token_urlsafe(24)
    # 8-char base32-ish referral code patients can share with friends.
    patient_referral_code = uuid.uuid4().hex[:8].upper()
    patient_geo = None
    if payload.location_zip:
        coords = await geocode_zip(db, payload.location_zip)
        if coords:
            patient_geo = {"lat": coords[0], "lng": coords[1], "source": "zip"}
    if not patient_geo and payload.location_city:
        coords = await geocode_city(db, payload.location_city, payload.location_state)
        if coords:
            patient_geo = {"lat": coords[0], "lng": coords[1], "source": "city"}

    doc = {
        "id": rid,
        **payload.model_dump(),
        "patient_referral_code": patient_referral_code,
        "patient_geo": patient_geo,
        "verification_token": token,
        "view_token": secrets.token_urlsafe(24),
        "verified": False,
        "status": "pending_verification",
        "threshold": DEFAULT_THRESHOLD,
        "notified_therapist_ids": [],
        "notified_scores": {},
        "notified_distances": {},
        "results_sent_at": None,
        "created_at": _now_iso(),
    }
    # Bot-defense fields are interrogated above — never persist them.
    doc.pop("fax_number", None)
    doc.pop("form_started_at_ms", None)
    doc.pop("turnstile_token", None)
    await db.requests.insert_one(doc.copy())
    # Log the IP for the rate-limit window. We only keep these for ~24h
    # via a TTL index on `ts_at` (BSON Date) — see server.py startup.
    if client_ip:
        try:
            now_dt = datetime.now(timezone.utc)
            await db.intake_ip_log.insert_one(
                {
                    "ip": client_ip,
                    "ts": now_dt.isoformat(),  # human-readable
                    "ts_at": now_dt,  # BSON Date — used by TTL index
                    "request_id": rid,
                },
            )
        except Exception:
            pass
    await send_verification_email(payload.email, rid, token)
    # Optional SMS receipt — only if patient gave a phone AND opted in
    if payload.sms_opt_in and (payload.phone or "").strip():
        try:
            await send_patient_intake_receipt_sms(payload.phone)
        except Exception:
            # Never let SMS failures block the intake flow
            pass
    return {"id": rid, "status": "pending_verification"}


@router.get("/requests/verify/{token}")
async def verify_request(token: str):
    req = await db.requests.find_one({"verification_token": token}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Invalid or expired token")
    if not req.get("verified"):
        await db.requests.update_one(
            {"id": req["id"]},
            {"$set": {"verified": True, "status": "open", "verified_at": _now_iso()}},
        )
        # Hold a strong ref to the task so Python's GC can't kill it mid-run.
        from helpers import _spawn_bg
        _spawn_bg(
            _trigger_matching(req["id"]),
            name=f"match_for_{req['id'][:8]}",
        )
    # Issue a patient session token here too — the email link itself proves
    # the user owns this address, so we can drop them straight into account
    # setup without a second magic-code round-trip.
    from deps import _create_session_token  # local import to avoid cycle
    session_token = (
        _create_session_token(req["email"], "patient") if req.get("email") else None
    )
    return {
        "id": req["id"],
        "verified": True,
        "email": req.get("email"),
        "session_token": session_token,
    }


@router.get("/requests/{request_id}/public", response_model=dict)
async def public_request_view(request_id: str):
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)
    return req


@router.get("/followup/{request_id}/{milestone}")
async def followup_view(request_id: str, milestone: str):
    """Surface enough context for the follow-up form: list of therapist
    applications the patient saw, plus any previously submitted response."""
    if milestone not in ("48h", "2wk", "6wk"):
        raise HTTPException(400, "Invalid milestone")
    req = await db.requests.find_one(
        {"id": request_id},
        {"_id": 0, "id": 1, "results_sent_at": 1, "status": 1},
    )
    if not req:
        raise HTTPException(404)
    apps = await db.applications.find(
        {"request_id": request_id},
        {"_id": 0, "therapist_id": 1, "therapist_name": 1, "match_score": 1},
    ).sort("match_score", -1).to_list(50)
    existing = await db.followups.find_one(
        {"request_id": request_id, "milestone": milestone}, {"_id": 0}
    )
    return {
        "request_id": request_id,
        "milestone": milestone,
        "applications": apps,
        "existing": existing,
    }


@router.post("/followup/{request_id}/{milestone}")
async def followup_submit(
    request_id: str, milestone: str, payload: FollowupResponse,
):
    """Patient submits the follow-up survey. Idempotent — last write wins."""
    if milestone not in ("48h", "2wk", "6wk"):
        raise HTTPException(400, "Invalid milestone")
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1, "email": 1})
    if not req:
        raise HTTPException(404)
    doc = {
        "request_id": request_id,
        "patient_email_anon": (req.get("email", "")[:3] + "***") if req.get("email") else "",
        "milestone": milestone,
        **payload.model_dump(),
        "created_at": _now_iso(),
    }
    await db.followups.update_one(
        {"request_id": request_id, "milestone": milestone},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, "milestone": milestone}


@router.post("/admin/requests/{request_id}/release-results")
async def admin_release_results(request_id: str, _: bool = Depends(require_admin)):
    """Manually release the 24h hold on patient results."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    if not req:
        raise HTTPException(404)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"results_released_at": _now_iso()}},
    )
    return {"ok": True, "released_at": _now_iso()}


@router.get("/requests/{request_id}/results", response_model=dict)
async def public_request_results(
    request_id: str,
    t: Optional[str] = None,  # view_token from email
    authorization: Optional[str] = Header(None),
):
    """Patient view of ranked therapist applications.

    Auth model:
      - Email link carries `?t=<view_token>` → grant access (the link itself
        was sent only to the verified patient inbox, so possessing the token
        proves email control).
      - No token → require a magic-link session whose email matches the
        request's patient email. This protects against a leaked/shoulder-
        surfed UUID URL — even if someone guesses the URL, they can't open
        it without proving inbox control via the 6-digit magic code.
      - Admin's `X-Admin-Password` header always grants access (debug).
    24h hold: results are hidden until matched_at + 24h OR admin manually releases.
    """
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)

    # ── auth gate ──
    granted = False
    expected_token = req.get("view_token")
    if t and expected_token and t == expected_token:
        granted = True
    if not granted:
        # Session-based auth: the patient must be signed in with the email
        # that owns this request (verified via 6-digit magic code).
        sess = _decode_session_from_authorization(authorization)
        if (
            sess
            and (sess.get("role") == "patient")
            and (sess.get("email", "").lower() == (req.get("email") or "").lower())
        ):
            granted = True
    if not granted:
        # 401 → frontend redirects to /sign-in?role=patient&next=/results/...
        raise HTTPException(
            status_code=401,
            detail="signin_required",
            headers={"X-Auth-Hint": "magic_code"},
        )
    apps_raw = await db.applications.find(
        {"request_id": request_id}, {"_id": 0}
    ).to_list(50)

    released_at = req.get("results_released_at")
    matched_at_str = req.get("matched_at") or req.get("created_at")
    matched_dt = _parse_iso(matched_at_str) if matched_at_str else None
    now = datetime.now(timezone.utc)
    hold_active = False
    hold_ends_at_iso: Optional[str] = None
    if not released_at and matched_dt:
        elapsed_h = (now - matched_dt).total_seconds() / 3600.0
        if elapsed_h < 24.0:
            hold_active = True
            hold_ends_at_iso = (matched_dt + timedelta(hours=24)).isoformat()

    apps = apps_raw if not hold_active else []

    matched_at = req.get("matched_at") or req.get("created_at")
    matched_dt2 = _parse_iso(matched_at) if matched_at else None
    patient_issues = [
        i.lower() for i in (req.get("presenting_issues") or []) if i
    ]
    for a in apps:
        ms = float(a.get("match_score") or 0)
        speed_bonus = 0.0
        if matched_dt2:
            applied_dt = _parse_iso(a.get("created_at") or "")
            if applied_dt:
                hours = max(0.0, (applied_dt - matched_dt2).total_seconds() / 3600.0)
                speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))
        # Response-quality signal: rewards therapists who actually engaged
        # with the patient's anonymous summary, not generic boilerplate.
        # Components:
        #   1. Length (0-6): up to 6 points for a substantive 300-char reply
        #   2. Issue match (0-3): mentions any of the patient's presenting
        #      concerns by name → +3
        #   3. Action signal (0-2): offers a concrete next step (slot,
        #      free consult, available time) → +2
        #   4. Personal voice (0-1): uses first-person pronoun → +1
        # Capped at 12 total. Replaces the older length-only `/300 * 10`
        # heuristic so a 300-char generic reply no longer outranks a
        # 200-char specific reply.
        msg = (a.get("message") or "").lower()
        msg_len = len(msg)
        len_score = min(6.0, msg_len / 300.0 * 6.0)
        issue_score = 0.0
        if patient_issues:
            for issue in patient_issues:
                # Match on the slug OR the human-readable form ("trauma_ptsd"
                # in the slug list also matches "trauma" / "ptsd").
                tokens = [issue] + issue.replace("_", " ").split()
                if any(tok in msg for tok in tokens if len(tok) >= 4):
                    issue_score = 3.0
                    break
        action_keywords = (
            "consult", "available", "open slot", "schedule", "next week",
            "this week", "free 15", "intake call", "appointment", "tomorrow",
            "in-person", "telehealth", "offer", "i can see you",
        )
        action_score = 2.0 if any(k in msg for k in action_keywords) else 0.0
        personal_score = 1.0 if re.search(
            r"\b(i\s|i'd|i'll|i've|i'm|my\s)", msg,
        ) else 0.0
        quality_bonus = min(
            12.0, len_score + issue_score + action_score + personal_score,
        )
        a["patient_rank_score"] = round(min(100.0, ms * 0.6 + speed_bonus + quality_bonus), 1)
        a["response_quality"] = {
            "length": round(len_score, 1),
            "issue_match": issue_score,
            "action_signal": action_score,
            "personal_voice": personal_score,
            "total": round(quality_bonus, 1),
        }

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    breakdowns = req.get("notified_breakdowns") or {}
    distances = req.get("notified_distances") or {}
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            enriched.append({
                **a,
                "therapist": t,
                "match_breakdown": breakdowns.get(a["therapist_id"]) or {},
                "distance_miles": distances.get(a["therapist_id"]),
            })
    return {
        "request": req,
        "applications": enriched,
        "hold_active": hold_active,
        "hold_ends_at": hold_ends_at_iso,
        "applications_pending_count": len(apps_raw) if hold_active else 0,
    }
