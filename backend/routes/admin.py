"""Admin routes: login, requests, therapists, templates, declines, backfill, stats, cron triggers."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from cron import (
    _run_availability_prompts, _run_daily_billing_charges,
    _run_license_expiry_alerts,
)
from deps import (
    db, logger, ADMIN_PASSWORD, DEFAULT_THRESHOLD,
    LOGIN_MAX_FAILURES, _check_lockout, _client_ip,
    _login_attempts, _record_failure, _reset_failures, require_admin,
)
from email_service import send_therapist_approved, send_therapist_rejected
from email_templates import DEFAULTS as EMAIL_TEMPLATE_DEFAULTS, list_templates, upsert_template
from helpers import _deliver_results, _now_iso, _spawn_bg, _trigger_matching
from seed_data import generate_seed_therapists
from sms_service import send_sms, SMS_TEMPLATE_DEFAULTS
import audit

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


# --- Admin team management ---------------------------------------------------
import bcrypt as _bcrypt  # noqa: E402
import uuid as _uuid  # noqa: E402

from deps import _create_session_token  # noqa: E402


def _hash_pw(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify_pw(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


@router.post("/admin/login-with-email")
async def admin_login_with_email(payload: dict, request: Request):
    """Per-user admin login (email + password). Issues a Bearer JWT with
    role=admin that the frontend stores like other sessions and sends as
    `Authorization: Bearer ...` to admin endpoints. Accepted by
    `require_admin` alongside the legacy X-Admin-Password header.
    """
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    ip = _client_ip(request)
    key = f"adm:{ip}:{email}"
    remaining = _check_lockout(key)
    if remaining is not None:
        raise HTTPException(
            429, f"Too many failed attempts. Try again in {remaining // 60 + 1} minutes."
        )
    if "@" not in email or not password:
        raise HTTPException(400, "Email and password required")
    user = await db.admin_users.find_one(
        {"email": email, "is_active": {"$ne": False}}, {"_id": 0}
    )
    if not user or not _verify_pw(password, user.get("password_hash", "")):
        _record_failure(key)
        raise HTTPException(401, "Email or password is incorrect")
    _reset_failures(key)
    await db.admin_users.update_one(
        {"id": user["id"]}, {"$set": {"last_login_at": _now_iso()}}
    )
    token = _create_session_token(email, "admin")
    return {
        "token": token,
        "role": "admin",
        "email": email,
        "name": user.get("name") or email,
    }


@router.get("/admin/team")
async def admin_list_team(_: bool = Depends(require_admin)):
    rows = await db.admin_users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(200)
    return {"team": rows, "total": len(rows)}


@router.post("/admin/team")
async def admin_invite_team_member(payload: dict, _: bool = Depends(require_admin)):
    """Create a new team member with email + initial password. The inviter
    shares the credentials out-of-band (Slack, secure DM). For lean MVP we
    skip an email-based invite flow.
    """
    email = (payload.get("email") or "").strip().lower()
    name = (payload.get("name") or "").strip()
    password = payload.get("password") or ""
    if "@" not in email:
        raise HTTPException(400, "Valid email required")
    if not name:
        raise HTTPException(400, "Name required")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if await db.admin_users.find_one({"email": email}):
        raise HTTPException(409, "A team member with that email already exists")
    record = {
        "id": str(_uuid.uuid4()),
        "email": email,
        "name": name,
        "password_hash": _hash_pw(password),
        "role": "staff",
        "is_active": True,
        "created_at": _now_iso(),
        "last_login_at": None,
    }
    await db.admin_users.insert_one(record)
    record.pop("password_hash", None)
    record.pop("_id", None)
    return record


@router.delete("/admin/team/{member_id}")
async def admin_remove_team_member(member_id: str, _: bool = Depends(require_admin)):
    """Soft-delete: deactivates the user so future password-based admin
    sign-ins are rejected, but their audit trail (created_at, last_login_at)
    is preserved.
    """
    res = await db.admin_users.update_one(
        {"id": member_id}, {"$set": {"is_active": False, "deactivated_at": _now_iso()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Team member not found")
    return {"ok": True}


@router.post("/admin/team/{member_id}/reset-password")
async def admin_reset_team_password(
    member_id: str, payload: dict, _: bool = Depends(require_admin)
):
    """Allows any admin to reset another team member's password. The new
    password is shared out-of-band like the initial invite."""
    password = payload.get("password") or ""
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    res = await db.admin_users.update_one(
        {"id": member_id}, {"$set": {"password_hash": _hash_pw(password)}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Team member not found")
    return {"ok": True}


# --- Profile-completeness / claim-campaign -----------------------------------
from profile_completeness import evaluate as _evaluate_profile  # noqa: E402
from email_service import send_claim_profile_email as _send_claim_email  # noqa: E402
from helpers import _spawn_bg as _bg_spawn  # noqa: E402


@router.get("/admin/profile-completeness")
async def admin_profile_completeness(_: bool = Depends(require_admin)):
    """Roster of every active therapist with their completion score and
    list of missing fields. Used by the admin to see who needs nudging
    before / after the go-live cutover.

    Sorted by score ascending so the people who need the most help are
    surfaced first.
    """
    docs = await db.therapists.find(
        {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}},
        {"_id": 0},
    ).to_list(2000)
    rows: list[dict] = []
    for t in docs:
        result = _evaluate_profile(t)
        rows.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "email": t.get("email"),
            "score": result["score"],
            "publishable": result["publishable"],
            "required_done": result["required_done"],
            "required_total": result["required_total"],
            "enhancing_done": result["enhancing_done"],
            "enhancing_total": result["enhancing_total"],
            "required_missing": result["required_missing"],
            "enhancing_missing": result["enhancing_missing"],
            "claim_email_sent_at": t.get("claim_email_sent_at"),
        })
    rows.sort(key=lambda r: (r["score"], r["name"] or ""))
    avg = round(sum(r["score"] for r in rows) / max(1, len(rows)))
    publishable = sum(1 for r in rows if r["publishable"])
    return {
        "therapists": rows,
        "total": len(rows),
        "publishable": publishable,
        "incomplete": len(rows) - publishable,
        "average_score": avg,
    }


@router.post("/admin/profile-completeness/send-claim")
async def admin_send_claim_campaign(
    payload: dict, _: bool = Depends(require_admin)
):
    """Triggers the "Claim & complete your profile" outreach email.

    Body:
      - mode: "all_incomplete" (default) | "selected"
      - therapist_ids: list[str] (only when mode=="selected")
      - dry_run: bool (default False)  --  when True, returns the recipient
        list WITHOUT actually sending. Useful for sanity-checking the
        campaign on staging.
      - resend: bool (default False)  --  when False (default) we skip
        therapists who already have `claim_email_sent_at` set so a single
        admin can hammer the button safely.
    """
    mode = payload.get("mode", "all_incomplete")
    therapist_ids = payload.get("therapist_ids") or []
    dry_run = bool(payload.get("dry_run", False))
    allow_resend = bool(payload.get("resend", False))

    query: dict[str, Any] = {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}}
    if mode == "selected":
        if not therapist_ids:
            raise HTTPException(400, "therapist_ids is required when mode='selected'")
        query["id"] = {"$in": therapist_ids}

    docs = await db.therapists.find(query, {"_id": 0}).to_list(2000)
    recipients: list[dict] = []
    for t in docs:
        result = _evaluate_profile(t)
        if mode == "all_incomplete" and result["publishable"]:
            continue  # skip already-complete therapists
        if t.get("claim_email_sent_at") and not allow_resend:
            continue  # skip already-emailed therapists unless resend=True
        recipients.append({
            "id": t["id"],
            "email": t["email"],
            "name": t.get("name") or t["email"],
            "score": result["score"],
            "missing": [m["label"] for m in result["required_missing"] + result["enhancing_missing"]],
        })

    if dry_run:
        return {"would_send": len(recipients), "recipients": recipients[:50], "dry_run": True}

    sent = 0
    failed: list[dict] = []
    now = _now_iso()
    for r in recipients:
        try:
            # Spawn into the background so a 200-recipient run doesn't
            # block the request timeout. Background tasks are managed by
            # `helpers._spawn_bg` which keeps a strong reference so the
            # GC can't kill them mid-flight.
            _bg_spawn(_send_claim_email(
                to=r["email"],
                therapist_name=r["name"],
                score=r["score"],
                missing_fields=r["missing"],
            ))
            await db.therapists.update_one(
                {"id": r["id"]},
                {"$set": {"claim_email_sent_at": now, "claim_email_score_at_send": r["score"]}},
            )
            sent += 1
        except Exception as e:
            failed.append({"email": r["email"], "error": str(e)})

    return {"sent": sent, "failed": failed, "total_targeted": len(recipients)}


@router.get("/admin/requests", response_model=list)
async def admin_list_requests(request: Request, _: bool = Depends(require_admin)):
    audit.emit(
        actor_type="admin", actor_id="admin", action="list_requests",
        resource="request", detail="limit=500",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    # Slim projection -- the list table only needs summary fields.
    # Full doc is loaded on-demand via GET /admin/requests/{id}.
    _LIST_PROJECTION = {
        "_id": 0, "id": 1, "email": 1, "status": 1, "location_state": 1,
        "client_age": 1, "referral_source": 1, "created_at": 1,
        "verified": 1, "threshold": 1, "notified_therapist_ids": 1,
        "matched_at": 1,
    }
    docs = await db.requests.find(
        {}, _LIST_PROJECTION
    ).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        app_count = await db.applications.count_documents({"request_id": d["id"]})
        invited_count = await db.outreach_invites.count_documents(
            {"request_id": d["id"]},
        )
        d["application_count"] = app_count
        d["notified_count"] = len(d.get("notified_therapist_ids") or [])
        d["invited_count"] = invited_count
        out.append(d)
    return out


@router.get("/admin/audit-log")
async def admin_audit_log(
    request: Request,
    _: bool = Depends(require_admin),
    limit: int = 100,
    actor_type: Optional[str] = None,
    action: Optional[str] = None,
    resource: Optional[str] = None,
    resource_id: Optional[str] = None,
    actor_id: Optional[str] = None,
):
    """HIPAA audit trail viewer. Returns recent PHI access events.

    All entries are PHI-free by design -- actors are identified by
    hashed IDs or role labels, resources by UUID.
    """
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_audit_log",
        resource="audit_log", detail=f"limit={min(limit, 500)}",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    cap = min(max(limit, 1), 500)
    query: dict[str, Any] = {}
    if actor_type:
        query["actor_type"] = actor_type
    if action:
        query["action"] = action
    if resource:
        query["resource"] = resource
    if resource_id:
        query["resource_id"] = resource_id
    if actor_id:
        query["actor_id"] = actor_id
    rows = await db.audit_log.find(
        query, {"_id": 0}
    ).sort("ts", -1).to_list(cap)
    return {"entries": rows, "count": len(rows), "limit": cap}


@router.get("/admin/requests/{request_id}", response_model=dict)
async def admin_request_detail(request_id: str, request: Request, _: bool = Depends(require_admin)):
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_request",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)
    notified_ids = req.get("notified_therapist_ids") or []
    notified_distances = req.get("notified_distances") or {}
    notified_breakdowns = req.get("notified_breakdowns") or {}
    research_scores = req.get("research_scores") or {}
    notified = []
    for tid in notified_ids:
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        if t:
            rs = research_scores.get(tid) or {}
            notified.append({
                "id": t["id"],
                "name": t["name"],
                "email": t["email"],
                "credential_type": t.get("credential_type"),
                "match_score": (req.get("notified_scores") or {}).get(tid, 0),
                "match_breakdown": notified_breakdowns.get(tid) or {},
                "distance_miles": notified_distances.get(tid),
                "office_locations": t.get("office_locations", []),
                "primary_specialties": t.get("primary_specialties", []),
                "modalities": t.get("modalities", []),
                "cash_rate": t.get("cash_rate"),
                "sliding_scale": t.get("sliding_scale"),
                "insurance_accepted": t.get("insurance_accepted", []),
                "telehealth": t.get("telehealth"),
                "offers_in_person": t.get("offers_in_person"),
                "years_experience": t.get("years_experience"),
                # Research enrichment (only populated when the toggle was on)
                "enriched_score": rs.get("enriched_score"),
                "score_delta": rs.get("delta"),
                "evidence_depth": rs.get("evidence_depth"),
                "approach_alignment": rs.get("approach_alignment"),
                "research_rationale": rs.get("rationale"),
                "research_themes": rs.get("themes") or {},
            })
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    # Compute Step-2 patient-facing rank for each application so the
    # admin sees the SAME score the patient will see (and can verify
    # before clicking Release). Single source of truth =
    # `helpers.compute_patient_rank_score`.
    from helpers import compute_patient_rank_score
    for a in apps:
        a.update(compute_patient_rank_score(a, req))
    # Sort by the new Step-2 rank (high -> low) so admin's view matches
    # the patient's. Falls back to match_score on legacy applications
    # that pre-date the field (None ranks last).
    apps.sort(
        key=lambda a: (a.get("patient_rank_score") or 0, a.get("match_score") or 0),
        reverse=True,
    )
    invited = await db.outreach_invites.find(
        {"request_id": request_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # When fewer matches were notified than the configured max_invites
    # target, surface a gap explanation so admins can see which axis
    # (specialty, age group, format, insurance, state) constrained the
    # result count. The target is read from app_config so admins who
    # changed it (e.g. to 20) see the right number in the alert.
    match_gap = None
    _mcfg = await db.app_config.find_one({"key": "matching_defaults"}, {"_id": 0})
    _target = int((_mcfg or {}).get("max_invites") or 30)
    if len(notified_ids) < _target:
        match_gap = await _explain_match_gap(req, len(notified_ids), _target)
    return {
        "request": req,
        "notified": notified,
        "applications": apps,
        "invited": invited,
        "match_gap": match_gap,
    }


async def _explain_match_gap(req: dict, notified_count: int, target: int = 30) -> dict:
    """Counts how many ACTIVE, APPROVED, BILLABLE therapists pass each
    individual filter from the request, so the admin can see which axis
    is the bottleneck. Returns `{notified, target, axes:[{label, count,
    target, severity}], summary}`. `severity` is 'critical' if count==0,
    'warning' if count<target, else 'ok'.

    `target` should be the configured max_invites for this deployment
    so the alert headline ("Why we couldn't fill N matches") matches
    what the matcher actually tried to do. Defaults to 30 for
    backward compat with older callers."""
    base_match = {
        "is_active": {"$ne": False},
        "pending_approval": {"$ne": True},
        "subscription_status": {"$nin": ["past_due", "canceled", "unpaid", "incomplete"]},
    }
    total_active = await db.therapists.count_documents(base_match)

    axes: list[dict] = []

    def _axis(label: str, count: int, axis_target: int) -> dict:
        if count == 0:
            sev = "critical"
        elif count < axis_target:
            sev = "warning"
        else:
            sev = "ok"
        return {
            "label": label,
            "count": count,
            "target": axis_target,
            "severity": sev,
        }

    # -- State (geo) ------------------------------------------------
    state = req.get("location_state")
    if state:
        in_state = await db.therapists.count_documents({
            **base_match, "licensed_states": state,
        })
        axes.append(_axis(f"Therapists licensed in {state}", in_state, target))

    # -- Format -----------------------------------------------------
    # Patient enum values are `telehealth_only`, `in_person_only`,
    # `hybrid`, `prefer_inperson`, `prefer_telehealth`. We only treat
    # the two `*_only` variants as HARD (the others are soft prefs).
    fmt = (req.get("modality_preference") or "").lower()
    if fmt == "in_person_only":
        cnt = await db.therapists.count_documents({
            **base_match,
            "$or": [
                {"modality_offering": {"$in": ["in_person", "both"]}},
                {"offers_in_person": True},
            ],
        })
        axes.append(_axis("Offer in-person sessions", cnt, target))
    elif fmt == "telehealth_only":
        cnt = await db.therapists.count_documents({
            **base_match,
            "$or": [
                {"modality_offering": {"$in": ["telehealth", "both"]}},
                {"telehealth": True},
            ],
        })
        axes.append(_axis("Offer telehealth", cnt, target))

    # -- Age group --------------------------------------------------
    age = req.get("age_group")
    if age:
        cnt = await db.therapists.count_documents({
            **base_match, "age_groups": age,
        })
        axes.append(_axis(f"See {age.replace('_', ' ')} clients", cnt, max(8, target // 4)))

    # -- Top presenting issue ---------------------------------------
    issues = req.get("presenting_issues") or []
    for issue in issues[:3]:
        cnt = await db.therapists.count_documents({
            **base_match,
            "$or": [
                {"primary_specialties": issue},
                {"secondary_specialties": issue},
                {"general_treats": issue},
            ],
        })
        axes.append(_axis(f"Treat {issue.replace('_', ' ')}", cnt, max(10, target // 3)))

    # -- Modality preference (treatment style) ----------------------
    pref_mods = req.get("modality_preferences") or []
    for mod in pref_mods[:2]:
        cnt = await db.therapists.count_documents({
            **base_match, "modalities": mod,
        })
        axes.append(_axis(f"Practice {mod}", cnt, max(8, target // 4)))

    # -- Insurance --------------------------------------------------
    # Only surface this axis as a HARD filter when the patient
    # explicitly ticked "Hard requirement: only show therapists who
    # accept this insurance". Otherwise it's a soft preference that
    # shouldn't be blamed when the pool is small.
    if (
        req.get("payment_type") in ("insurance", "either")
        and req.get("insurance_name")
    ):
        ins = req["insurance_name"]
        cnt = await db.therapists.count_documents({
            **base_match,
            "insurance_accepted": ins,
        })
        hard_suffix = " (HARD)" if req.get("insurance_strict") else ""
        axes.append(_axis(f"Accept {ins}{hard_suffix}", cnt, max(8, target // 3)))

    # -- Cash budget ------------------------------------------------
    if req.get("payment_type") in ("cash", "either") and req.get("budget"):
        budget = int(req["budget"])
        cnt = await db.therapists.count_documents({
            **base_match,
            "$or": [
                {"cash_rate": {"$lte": budget}},
                {"sliding_scale": True},
            ],
        })
        axes.append(_axis(
            f"Cash rate <= ${budget} (or sliding scale)",
            cnt, max(15, target // 2),
        ))

    # -- Gender preference (only when patient required it) ----------
    if req.get("gender_required") and req.get("gender_preference"):
        gp = req["gender_preference"]
        cnt = await db.therapists.count_documents({
            **base_match, "gender": gp,
        })
        axes.append(_axis(f"Identify as {gp} (HARD)", cnt, max(8, target // 4)))

    # -- Preferred language (only when patient required it) ---------
    # This was the missing axis that made the Mandarin-HARD request look
    # unexplained in the admin "why 0 matches" dialog. When the pool
    # collapses because nobody speaks the requested language, the admin
    # needs to see that explicitly so they can recruit or advise the
    # patient to drop the HARD flag.
    lang = req.get("preferred_language")
    if req.get("language_strict") and lang and lang != "English":
        cnt = await db.therapists.count_documents({
            **base_match,
            "languages_spoken": lang,
        })
        axes.append(_axis(f"Speak {lang} (HARD)", cnt, max(5, target // 6)))

    # -- Availability windows (only when patient required it) -------
    avail = req.get("availability_windows") or []
    if req.get("availability_strict") and avail and "flexible" not in avail:
        cnt = await db.therapists.count_documents({
            **base_match,
            "availability_windows": {"$in": avail},
        })
        pretty = ", ".join(w.replace("_", " ") for w in avail[:3])
        axes.append(_axis(f"Available {pretty} (HARD)", cnt, max(8, target // 4)))

    # -- Urgency window (only when patient required it) -------------
    urg = req.get("urgency")
    if req.get("urgency_strict") and urg and urg != "flexible":
        # Therapists signal capacity via `urgency_capacity`. For
        # stricter urgencies we need the therapist to be MORE ready
        # (asap requires asap; within_2_3_weeks accepts asap OR
        # within_2_3_weeks; etc.). Caseload-full therapists never
        # qualify under a HARD urgency filter.
        urgency_matches = {
            "asap": ["asap"],
            "within_2_3_weeks": ["asap", "within_2_3_weeks"],
            "within_month": ["asap", "within_2_3_weeks", "within_month"],
        }.get(urg, [urg])
        cnt = await db.therapists.count_documents({
            **base_match,
            "urgency_capacity": {"$in": urgency_matches},
        })
        axes.append(_axis(
            f"Start within {urg.replace('_', ' ')} (HARD)",
            cnt, max(10, target // 3),
        ))

    summary = (
        f"Only {notified_count} therapist(s) were notified  --  target was "
        f"{target}. Active directory size: {total_active}. The axes below "
        f"show which filter cut the pool down."
    )
    # If the patient hasn't yet clicked the verification link, the matching
    # job never ran  --  so a low notified_count says nothing about the
    # provider directory, and the admin should be told that explicitly
    # before drawing any conclusions about coverage gaps.
    verified = bool(req.get("verified"))
    if not verified:
        summary = (
            "Patient hasn't verified their email yet  --  matching only runs "
            "after verification, so 0 therapists have been notified. The "
            "axes below show what the directory could match if/when they "
            "verify; the actual notify count will fill in once they "
            "click the verification link."
        )
    return {
        "notified": notified_count,
        "target": target,
        "active_directory": total_active,
        "axes": axes,
        "summary": summary,
        "patient_verified": verified,
    }


@router.post("/admin/requests/{request_id}/trigger-results")
async def admin_trigger_results(request_id: str, request: Request, _: bool = Depends(require_admin)):
    audit.emit(
        actor_type="admin", actor_id="admin", action="trigger_results",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    return await _deliver_results(request_id)


@router.post("/admin/requests/{request_id}/resend-notifications")
async def admin_resend_notifications(request_id: str, request: Request, _: bool = Depends(require_admin)):
    audit.emit(
        actor_type="admin", actor_id="admin", action="resend_notifications",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    # Accept optional threshold/top_n overrides from request body.
    # When omitted, _trigger_matching falls back to request.threshold / env default.
    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass
    threshold = body.get("threshold")
    top_n = body.get("top_n")
    if threshold is not None:
        threshold = float(threshold)
    if top_n is not None:
        top_n = int(top_n)
    return await _trigger_matching(request_id, threshold=threshold, top_n=top_n)


@router.put("/admin/requests/{request_id}/threshold")
async def admin_update_threshold(
    request_id: str, payload: dict, _: bool = Depends(require_admin),
):
    threshold = float(payload.get("threshold", DEFAULT_THRESHOLD))
    await db.requests.update_one({"id": request_id}, {"$set": {"threshold": threshold}})
    return {"id": request_id, "threshold": threshold}


@router.get("/admin/therapists", response_model=list)
async def admin_list_therapists(
    request: Request,
    pending: Optional[bool] = None,
    _: bool = Depends(require_admin),
):
    from license_verify import compute_license_status, dopl_verification_url

    audit.emit(
        actor_type="admin", actor_id="admin", action="list_therapists",
        resource="therapist_list",
        detail=f"pending={pending}" if pending is not None else "",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    query: dict[str, Any] = {}
    if pending is True:
        query["pending_approval"] = True
    elif pending is False:
        query["pending_approval"] = {"$ne": True}
    # Inclusion projection -- only fields the admin table + edit modal use.
    # Pending view also needs license_picture (PendingSignupRow renders it).
    _THERAPIST_FIELDS = {
        "_id": 0,
        # Identity
        "id": 1, "name": 1, "email": 1, "real_email": 1,
        "phone": 1, "phone_alert": 1, "office_phone": 1,
        "profile_picture": 1, "gender": 1,
        # Credentials
        "credential_type": 1, "license_number": 1,
        "license_expires_at": 1, "licensed_states": 1,
        # Practice
        "bio": 1, "years_experience": 1, "cash_rate": 1,
        "sliding_scale": 1, "free_consult": 1,
        "modality_offering": 1, "telehealth": 1, "offers_in_person": 1,
        "urgency_capacity": 1, "website": 1, "source": 1,
        # Clinical arrays
        "primary_specialties": 1, "secondary_specialties": 1,
        "general_treats": 1, "modalities": 1, "style_tags": 1,
        "insurance_accepted": 1, "languages_spoken": 1,
        "client_types": 1, "age_groups": 1,
        # Location + availability
        "office_locations": 1, "office_addresses": 1,
        "availability_windows": 1,
        # Status flags
        "is_active": 1, "pending_approval": 1, "subscription_status": 1,
        "pending_reapproval": 1, "pending_reapproval_fields": 1,
        "notify_email": 1, "notify_sms": 1,
        # Research enrichment (research_enrichment.py)
        "research_summary": 1, "research_depth_signal": 1,
        "research_style_signals": 1,
        "google_place_name": 1, "google_place_address": 1,
        # Edit modal fields
        "t6_session_expectations": 1, "t6b_early_sessions": 1,
        "reliability": 1, "referral_code": 1, "referred_by_code": 1,
        # Metadata
        "created_at": 1,
    }
    proj = {**_THERAPIST_FIELDS}
    if pending is True:
        proj["license_picture"] = 1
    rows = await db.therapists.find(query, proj).sort("created_at", -1).to_list(500)
    # Attach lightweight license-status metadata so admin UI can render the
    # "Verify" badge without doing its own date math (keeps frontend lean
    # and lets us swap in live DOPL API calls here without touching React).
    for t in rows:
        t["license_status"] = compute_license_status(
            license_expires_at=t.get("license_expires_at"),
            license_number=t.get("license_number"),
        )
        t["license_verify_url"] = dopl_verification_url(t.get("license_number"))

    # For pending therapists, attach "value tags" telling the admin which
    # patient-demand gaps this applicant would fill  --  and flag duplicates
    # (axes where we already have >=5 active providers like them) so the
    # admin can decide whether the marginal slot is worth approving.
    if pending is True and rows:
        await _attach_value_tags(rows)
    return rows


_DUP_THRESHOLD = 10  # axes with >=10 active matches are "duplicates"


async def _attach_value_tags(pending_rows: list[dict]) -> None:
    """Annotates each pending therapist with a `value_tags` list:
        [{label, axis, kind: 'fills_gap'|'duplicate'|'neutral', count}]
    Counts how many active+approved+billable therapists already cover
    each axis the applicant would contribute to.
    """
    base = {
        "is_active": {"$ne": False},
        "pending_approval": {"$ne": True},
        "subscription_status": {
            "$nin": ["past_due", "canceled", "unpaid", "incomplete"]
        },
    }

    async def count(extra: dict) -> int:
        return await db.therapists.count_documents({**base, **extra})

    for t in pending_rows:
        tags: list[dict] = []
        seen: set[tuple[str, str]] = set()

        async def add(label: str, axis: str, count_val: int):
            if (axis, label) in seen:
                return
            seen.add((axis, label))
            kind = "fills_gap" if count_val < _DUP_THRESHOLD else "duplicate"
            tags.append(
                {
                    "label": label,
                    "axis": axis,
                    "kind": kind,
                    "count": count_val,
                }
            )

        # Primary specialties  --  highest demand axis
        for s in (t.get("primary_specialties") or [])[:5]:
            cnt = await count({"primary_specialties": s})
            await add(f"Treats {s.replace('_', ' ')}", "specialty", cnt)

        # Modalities (treatment style)
        for m in (t.get("modalities") or [])[:3]:
            cnt = await count({"modalities": m})
            await add(f"Practices {m}", "modality", cnt)

        # Age groups
        for a in (t.get("age_groups") or [])[:3]:
            cnt = await count({"age_groups": a})
            await add(f"Sees {a.replace('_', ' ')}", "age_group", cnt)

        # Insurance
        for ins in (t.get("insurance_accepted") or [])[:3]:
            cnt = await count({"insurance_accepted": ins})
            await add(f"Accepts {ins}", "insurance", cnt)

        # Languages (often a gap)
        for lang in (t.get("languages_spoken") or []):
            if lang and lang.lower() not in ("english", "en"):
                cnt = await count({"languages_spoken": lang})
                await add(f"Speaks {lang}", "language", cnt)

        # In-person coverage by city
        for office in (t.get("office_addresses") or [])[:2]:
            city = (office.get("city") or "").strip() if isinstance(office, dict) else ""
            if city:
                cnt = await count({
                    "$or": [
                        {"office_addresses.city": city},
                        {"office_locations": city},
                    ],
                })
                await add(f"In-person in {city}", "geo_city", cnt)

        # Sliding scale / free consult  --  affordability axes
        if t.get("sliding_scale"):
            cnt = await count({"sliding_scale": True})
            await add("Offers sliding scale", "affordability", cnt)
        if t.get("free_consult"):
            cnt = await count({"free_consult": True})
            await add("Offers free consult", "affordability", cnt)

        # Sort: gaps first, then duplicates.
        tags.sort(key=lambda x: (x["kind"] == "duplicate", x["count"]))
        # Summary: did this applicant fill ANY gap, or are they all duplicates?
        gap_count = sum(1 for x in tags if x["kind"] == "fills_gap")
        dup_count = sum(1 for x in tags if x["kind"] == "duplicate")
        t["value_tags"] = tags[:12]
        t["value_summary"] = {
            "fills_gaps": gap_count,
            "duplicates": dup_count,
            "is_duplicate_only": gap_count == 0 and dup_count > 0,
        }


@router.get("/admin/therapists/{therapist_id}")
async def admin_therapist_detail(
    therapist_id: str, request: Request, _: bool = Depends(require_admin),
):
    """Return the full therapist document (minus password_hash) for admin
    debugging. Unlike the list endpoint this includes _backfill_audit,
    embeddings, and every other field on the doc."""
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_therapist_detail",
        resource="therapist", resource_id=therapist_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "password_hash": 0, "password_set_at": 0},
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    return t


@router.post("/admin/therapists/{therapist_id}/approve")
async def admin_approve_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    import asyncio
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "password_hash": 0, "password_set_at": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": True, "approved_at": _now_iso()}},
    )
    _spawn_bg(
        send_therapist_approved(t["email"], t["name"]),
        name=f"approve_email_{therapist_id[:8]}",
    )
    return {"id": therapist_id, "status": "approved"}


@router.post("/admin/therapists/{therapist_id}/reject")
async def admin_reject_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    import asyncio
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "password_hash": 0, "password_set_at": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": False, "rejected_at": _now_iso()}},
    )
    _spawn_bg(
        send_therapist_rejected(t["email"], t["name"]),
        name=f"reject_email_{therapist_id[:8]}",
    )
    return {"id": therapist_id, "status": "rejected"}


@router.post("/admin/therapists/auto-decline-duplicates")
async def admin_auto_decline_duplicates(
    payload: dict | None = None, _: bool = Depends(require_admin),
):
    """Bulk-rejects every pending therapist whose value tags only contain
    "duplicate" axes (i.e. `value_summary.is_duplicate_only == True`)  -- 
    the admin no longer has to click reject one at a time. Pass
    `{"dry_run": true}` to preview without sending emails."""
    import asyncio
    dry_run = bool((payload or {}).get("dry_run"))

    pending = await db.therapists.find(
        {"pending_approval": True}, {"_id": 0},
    ).to_list(500)
    await _attach_value_tags(pending)

    targets = [t for t in pending if (t.get("value_summary") or {}).get("is_duplicate_only")]
    rejected_ids: list[str] = []
    if not dry_run and targets:
        ids = [t["id"] for t in targets]
        await db.therapists.update_many(
            {"id": {"$in": ids}},
            {
                "$set": {
                    "pending_approval": False,
                    "is_active": False,
                    "rejected_at": _now_iso(),
                    "auto_declined_reason": "duplicate_roster",
                }
            },
        )
        rejected_ids = ids
        # Fire rejection emails in chunks so we don't trip Resend's
        # batch rate limit (~10 req/s burst). The chunked sender
        # awaits a small delay between batches, but is itself spawned
        # as a background task so the admin response doesn't block.
        async def _chunked_send(rows: list[dict]) -> None:
            CHUNK = 10
            DELAY_S = 1.1
            for i in range(0, len(rows), CHUNK):
                batch = rows[i : i + CHUNK]
                await asyncio.gather(
                    *[
                        send_therapist_rejected(t["email"], t["name"])
                        for t in batch
                    ],
                    return_exceptions=True,
                )
                if i + CHUNK < len(rows):
                    await asyncio.sleep(DELAY_S)

        _spawn_bg(_chunked_send(targets), name="auto_decline_emails")

    return {
        "dry_run": dry_run,
        "matched": len(targets),
        "rejected_ids": rejected_ids,
        "preview": [
            {
                "id": t["id"],
                "name": t.get("name"),
                "email": t.get("email"),
                "duplicates": (t.get("value_summary") or {}).get("duplicates", 0),
            }
            for t in targets[:20]
        ],
    }


@router.post("/admin/therapists/{therapist_id}/clear-reapproval")
async def admin_clear_reapproval(
    therapist_id: str, _: bool = Depends(require_admin),
):
    """Admin has reviewed the therapist's specialty/license self-edit and
    blessed it  --  clear the pending_reapproval flag so the updated profile
    starts being used by the matching engine."""
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "password_hash": 0, "password_set_at": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {
            "$set": {"pending_reapproval": False, "reapproved_at": _now_iso()},
            "$unset": {"pending_reapproval_fields": "", "pending_reapproval_at": ""},
        },
    )
    return {"id": therapist_id, "status": "reapproved"}


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
        "referral_code", "referred_by_code",
    }
    update = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not update:
        raise HTTPException(400, "No editable fields provided")
    # Enforce the 3-age-group cap on ALL saves (admin + self-edit)  --  same
    # rule applied at the model layer for new signups.
    if "age_groups" in update and isinstance(update["age_groups"], list):
        update["age_groups"] = update["age_groups"][:3]
    update["updated_at"] = _now_iso()
    # When the admin saves the profile, treat that as an implicit
    # re-approval  --  clear the pending flag so the row stops surfacing
    # the orange "needs re-review" badge. Mirrors the dedicated
    # /clear-reapproval route. Logged via `reapproved_at` for audit.
    unset = {}
    if (await db.therapists.find_one(
        {"id": therapist_id, "pending_reapproval": True}, {"_id": 0, "id": 1},
    )):
        update["pending_reapproval"] = False
        update["reapproved_at"] = _now_iso()
        unset["pending_reapproval_fields"] = ""
        unset["pending_reapproval_at"] = ""
    mongo_op: dict[str, Any] = {"$set": update}
    if unset:
        mongo_op["$unset"] = unset
    res = await db.therapists.update_one({"id": therapist_id}, mongo_op)
    if res.matched_count == 0:
        raise HTTPException(404, "Therapist not found")
    t = await db.therapists.find_one({"id": therapist_id}, {
        "_id": 0, "password_hash": 0, "password_set_at": 0,
        "t5_embedding": 0, "t6b_embedding": 0,
    })
    return {"ok": True, "therapist": t}


@router.post(
    "/admin/therapists/{therapist_id}/archive",
    dependencies=[Depends(require_admin)],
)
async def admin_archive_therapist(therapist_id: str) -> dict[str, Any]:
    """Soft-delete: marks the therapist inactive but keeps the row so we
    don't lose past matches/applications referencing them. The matcher
    skips `is_active=False` already."""
    res = await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "is_active": False,
            "archived_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Therapist not found")
    return {"ok": True, "archived": True}


@router.post(
    "/admin/therapists/{therapist_id}/restore",
    dependencies=[Depends(require_admin)],
)
async def admin_restore_therapist(therapist_id: str) -> dict[str, Any]:
    """Reverse of /archive  --  bring an archived therapist back online."""
    res = await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"is_active": True, "updated_at": _now_iso()},
         "$unset": {"archived_at": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Therapist not found")
    return {"ok": True, "archived": False}


@router.delete(
    "/admin/therapists/{therapist_id}",
    dependencies=[Depends(require_admin)],
)
async def admin_delete_therapist(therapist_id: str) -> dict[str, Any]:
    """Hard delete  --  only allowed when there are NO applications and NO
    active patient requests referencing this therapist. Otherwise the
    admin must archive instead so historical records stay intact."""
    has_apps = await db.applications.count_documents({"therapist_id": therapist_id})
    if has_apps:
        raise HTTPException(
            409,
            f"Cannot hard-delete: {has_apps} application(s) reference this "
            "therapist. Archive instead.",
        )
    has_invites = await db.outreach_invites.count_documents(
        {"therapist_id": therapist_id},
    )
    res = await db.therapists.delete_one({"id": therapist_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Therapist not found")
    return {"ok": True, "deleted": True, "stale_invites": has_invites}


@router.post("/admin/test-sms")
async def admin_test_sms(payload: dict, _: bool = Depends(require_admin)):
    to = (payload or {}).get("to") or os.environ.get("TWILIO_DEV_OVERRIDE_TO", "")
    if not to:
        raise HTTPException(400, "No recipient and no TWILIO_DEV_OVERRIDE_TO env set")

    # Support template preview: if "template" is set, render that template
    # with sample data so the admin can see exactly what patients/therapists get.
    template_key = (payload or {}).get("template", "")
    if template_key and template_key in SMS_TEMPLATE_DEFAULTS:
        from sms_service import _get_template
        template = await _get_template(template_key)
        sample_vars = {
            "sms.therapist_referral": {"first_name": "Sarah", "match_score": 92, "apply_url": "https://theravoca.com/therapist/apply/sample123"},
            "sms.patient_intake_receipt": {},
            "sms.availability_prompt": {"first_name": "Sarah", "portal_url": "https://theravoca.com/portal"},
        }
        try:
            body = template.format(**sample_vars.get(template_key, {}))
        except (KeyError, IndexError):
            body = template  # show raw template if formatting fails
    else:
        body = (payload or {}).get("body") or "TheraVoca: SMS smoke test  --  your Twilio integration is wired up."

    # force=True bypasses TWILIO_ENABLED check  --  admin explicitly chose to test
    result = await send_sms(to, body, force=True)
    if not result:
        return {"ok": False, "detail": "SMS send returned no result (check TWILIO_ENABLED + creds + logs)"}

    # Twilio's API returns "queued" immediately but the message can still
    # fail at the carrier (A2P 10DLC, blocked numbers, invalid format).
    # Poll the message status briefly so the admin sees the real outcome.
    sid = result.get("sid")
    final_status = result.get("status")
    error_code = None
    error_message = None
    if sid:
        try:
            from twilio.rest import Client as _TwilioClient
            tw = _TwilioClient(
                os.environ.get("TWILIO_ACCOUNT_SID"),
                os.environ.get("TWILIO_AUTH_TOKEN"),
            )
            # Poll up to 6s for terminal status
            import asyncio as _asyncio
            for _ in range(6):
                await _asyncio.sleep(1.0)
                m = await _asyncio.to_thread(lambda: tw.messages(sid).fetch())
                final_status = m.status
                error_code = m.error_code
                error_message = m.error_message
                if final_status in ("delivered", "undelivered", "failed", "sent"):
                    break
        except Exception as exc:
            # Pollers are best-effort; don't fail the test endpoint on this.
            logger.warning("SMS poll error: %s", exc)

    # Map common Twilio error codes to human-readable troubleshooting hints.
    hint = None
    if error_code in (30034, 30032):
        hint = (
            "A2P 10DLC registration required. US carriers block unregistered "
            "numbers from sending SMS. Register at "
            "twilio.com/console/sms/a2p-messaging  --  or switch to a "
            "verified toll-free number."
        )
    elif error_code == 21610:
        hint = "Recipient unsubscribed (replied STOP). Reply START from that phone."
    elif error_code == 21408:
        hint = "Permission to send SMS to this country has not been enabled."
    elif error_code == 21211:
        hint = "Invalid 'To' phone number format. Use E.164 (+12035551234)."

    response = {
        "ok": final_status not in ("undelivered", "failed"),
        **result,
        "final_status": final_status,
        "error_code": error_code,
        "error_message": error_message,
        "troubleshooting_hint": hint,
    }
    # Persist the most recent test-SMS result so the SMS-status panel can
    # show a live deliverability badge without re-issuing a Twilio call.
    await db.app_config.update_one(
        {"key": "last_test_sms"},
        {"$set": {
            "key": "last_test_sms",
            **{k: v for k, v in response.items() if k != "ok"},
            "ok": response["ok"],
            "tested_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return response


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


@router.post("/admin/email-templates/{key}/preview")
async def admin_preview_email_template(
    key: str, payload: dict | None = None, _: bool = Depends(require_admin),
):
    """Render the template against realistic sample data and return
    `{subject, html}` so the admin can see what the email will look
    like before sending. The `draft` body fields (if supplied) are
    rendered IN-MEMORY ONLY  --  they're not persisted, so the admin can
    iterate on copy without polluting the saved override."""
    if key not in EMAIL_TEMPLATE_DEFAULTS:
        raise HTTPException(404, f"Unknown template key: {key}")
    from email_service import render_template_preview
    draft = (payload or {}).get("draft") if isinstance(payload, dict) else None
    return await render_template_preview(key, draft)


@router.post("/admin/email-templates/{key}/send-test")
async def admin_send_test_email(
    key: str, payload: dict, _: bool = Depends(require_admin),
):
    """Render a template with realistic sample data and actually email it
    to the address in `payload.to` (typically the admin themselves) so
    they can see the email exactly as a recipient would. Subject is
    prefixed with [TEST] so the admin's inbox flags it clearly."""
    if key not in EMAIL_TEMPLATE_DEFAULTS:
        raise HTTPException(404, f"Unknown template key: {key}")
    to = (payload or {}).get("to", "").strip()
    if not to or "@" not in to:
        raise HTTPException(400, "Valid 'to' email required in payload")
    from email_service import render_template_preview, _send
    rendered = await render_template_preview(key)
    result = await _send(to, f"[TEST] {rendered['subject']}", rendered["html"])
    if not result:
        raise HTTPException(
            502, "Send failed -- RESEND_API_KEY may not be configured",
        )
    return {
        "ok": True, "to": to, "subject": rendered["subject"],
        "resend_id": result.get("id"),
    }


# ─── Manual cron triggers (for the Testing > Test Actions panel) ───────
# Allowlist of cron functions admins can fire on demand. Maps a stable
# UI key to (display label, function name on the cron module). New
# entries here are the only way to expose more crons to the admin UI;
# arbitrary getattr is intentionally NOT supported.
_ADMIN_CRON_ALLOWLIST: dict[str, tuple[str, str]] = {
    "daily_billing_charges":      ("Charge monthly subscriptions",     "_run_daily_billing_charges"),
    "license_expiry_alerts":      ("License-expiry alerts",            "_run_license_expiry_alerts"),
    "availability_prompts":       ("Availability nudge prompts",       "_run_availability_prompts"),
    "gap_recruitment":            ("Coverage-gap recruiting",          "_run_gap_recruitment"),
    "patient_surveys_v2":         ("Send v2 patient surveys",          "_run_patient_surveys_v2"),
    "patient_survey_v2_reminders":("Send v2 patient survey reminders", "_run_patient_survey_v2_reminders"),
    "therapist_surveys":          ("Send therapist surveys",           "_run_therapist_surveys"),
    "therapist_2w_followups":     ("Therapist 2-week follow-ups",      "_run_therapist_2w_followups"),
    "stale_profile_nag":          ("Stale-profile nag",                "_run_stale_profile_nag"),
    "auto_recruit_weekly":        ("Auto-recruit weekly",              "_run_auto_recruit_weekly"),
}


@router.get("/admin/cron/list")
async def admin_list_crons(_: bool = Depends(require_admin)):
    """Return the allowlisted cron jobs an admin can fire manually."""
    return {
        "crons": [
            {"key": k, "label": v[0]}
            for k, v in _ADMIN_CRON_ALLOWLIST.items()
        ],
    }


@router.get("/admin/cron/health")
async def admin_cron_health(_: bool = Depends(require_admin)):
    """Cron observability snapshot (BACKLOG #25).

    Returns:
      - stuck: cron_runs docs where completed_at is null AND started_at
        is more than 24h ago. These are the canaries for "cron crashed
        and I didn't notice for days."
      - last_completion: per-job most-recent successful completion.
        Stale entries (oldest first) surface jobs that should have
        fired by now but haven't.
      - recent_failures: cron_runs docs with status="failed" in the
        last 7 days.

    Read-only -- no side effects. Cheap enough to call from a
    dashboard refresh.
    """
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    cutoff_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    stuck_cur = db.cron_runs.find(
        {"completed_at": None, "started_at": {"$lt": cutoff_24h}},
        {"_id": 0, "name": 1, "started_at": 1, "actor": 1},
    ).sort("started_at", 1).limit(50)
    stuck = await stuck_cur.to_list(50)

    failures_cur = db.cron_runs.find(
        {"status": "failed", "started_at": {"$gte": cutoff_7d}},
        {"_id": 0, "name": 1, "started_at": 1, "completed_at": 1, "error": 1},
    ).sort("started_at", -1).limit(20)
    recent_failures = await failures_cur.to_list(20)

    # Per-job most-recent successful completion.
    last_completion_cur = db.cron_runs.aggregate([
        {"$match": {"completed_at": {"$ne": None}}},
        {"$sort": {"completed_at": -1}},
        {"$group": {
            "_id": "$name",
            "last_completed_at": {"$first": "$completed_at"},
        }},
        {"$sort": {"last_completed_at": 1}},  # stalest first
    ])
    last_completion = []
    async for row in last_completion_cur:
        last_completion.append({
            "name": row["_id"],
            "last_completed_at": row["last_completed_at"],
        })

    return {
        "stuck": stuck,
        "stuck_count": len(stuck),
        "recent_failures": recent_failures,
        "last_completion": last_completion,
        "checked_at": _now_iso(),
    }


@router.post("/admin/cron/run")
async def admin_run_cron(payload: dict, _: bool = Depends(require_admin)):
    """Manually fire one of the allowlisted cron functions. Useful when
    verifying a fix shipped to staging without waiting for the next
    scheduled tick. Synchronous -- the response includes whatever the
    cron returned (typically counts of items processed)."""
    name = (payload or {}).get("name", "").strip()
    if name not in _ADMIN_CRON_ALLOWLIST:
        raise HTTPException(
            400,
            f"Unknown or non-allowlisted cron: {name!r}. "
            f"Valid: {', '.join(sorted(_ADMIN_CRON_ALLOWLIST.keys()))}",
        )
    label, func_name = _ADMIN_CRON_ALLOWLIST[name]
    import cron as _cron_mod
    func = getattr(_cron_mod, func_name, None)
    if func is None:
        raise HTTPException(500, f"Cron handler {func_name} not found in cron module")
    started = datetime.now(timezone.utc).isoformat()
    try:
        result = await func()
    except Exception as e:
        logger.exception("Manual cron %s failed", name)
        raise HTTPException(500, f"Cron failed: {e}")
    audit.emit(
        actor_type="admin", actor_id="admin", action="run_cron",
        resource="cron", resource_id=name,
    )
    return {"name": name, "label": label, "started_at": started, "result": result}


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
    from backfill import backfill_therapist, build_audit_record
    cur = db.therapists.find({}, {"_id": 0}).sort("created_at", 1)
    therapists = await cur.to_list(length=2000)
    updated = 0
    for idx, t in enumerate(therapists, 1):
        set_fields = backfill_therapist(t, idx)
        if set_fields:
            audit = build_audit_record(t, set_fields)
            if audit:
                # Preserve the original audit if one already exists  --  re-runs
                # of backfill should NOT reset `original_email` to a fake one.
                existing_audit = t.get("_backfill_audit") or {}
                if existing_audit.get("original_email"):
                    audit["original_email"] = existing_audit["original_email"]
                # Merge the fields_added lists so a second backfill pass
                # adds onto (rather than replaces) the audit trail.
                merged_fields = sorted(
                    set(audit["fields_added"]) | set(existing_audit.get("fields_added") or [])
                )
                audit["fields_added"] = merged_fields
                set_fields["_backfill_audit"] = audit
            set_fields["updated_at"] = _now_iso()
            await db.therapists.update_one(
                {"id": t["id"]}, {"$set": set_fields}
            )
            updated += 1
    return {"ok": True, "scanned": len(therapists), "updated": updated}


@router.post("/admin/strip-backfill")
async def admin_strip_backfill(_: bool = Depends(require_admin)):
    """Reverse the most-recent backfill: restore each therapist's original
    email (saved in `_backfill_audit.original_email`) and $unset every
    field that backfill itself populated. User-edited values (which were
    NEVER touched by backfill  --  backfill only fills empty fields) are
    preserved verbatim.

    This is the pre-launch sanity step: run backfill to flesh out fake
    profiles for matching tests, then strip-backfill before going live so
    therapists never see fabricated bios/specialties/availability/etc.
    """
    cur = db.therapists.find(
        {"_backfill_audit": {"$exists": True}}, {"_id": 0},
    )
    therapists = await cur.to_list(length=2000)
    restored = 0
    skipped_no_real_email = 0
    for t in therapists:
        audit = t.get("_backfill_audit") or {}
        original_email = (audit.get("original_email") or "").strip()
        fields_added = audit.get("fields_added") or []
        # If we have nothing real to fall back to (the original email was
        # blank or already a therapymatch+ placeholder), DO NOT strip  -- 
        # we'd leave the doc with no email at all. Flag for manual review.
        is_placeholder = (
            not original_email
            or "therapymatch+" in original_email.lower()
        )
        if is_placeholder:
            skipped_no_real_email += 1
            continue
        unset: dict[str, str] = {f: "" for f in fields_added}
        # Always remove the audit record itself once we restore.
        unset["_backfill_audit"] = ""
        update_doc: dict[str, Any] = {
            "$set": {"email": original_email, "updated_at": _now_iso()},
            "$unset": unset,
        }
        await db.therapists.update_one({"id": t["id"]}, update_doc)
        restored += 1
    return {
        "ok": True,
        "scanned": len(therapists),
        "restored": restored,
        "skipped_no_real_email": skipped_no_real_email,
        "note": (
            "Therapists whose pre-backfill email was missing or was "
            "already a therapymatch+ placeholder were skipped. Review "
            "those manually before going live."
        ),
    }


@router.get("/admin/email-restoration/preview", dependencies=[Depends(require_admin)])
async def admin_email_restoration_preview() -> dict[str, Any]:
    """Pre-launch audit: how many imported_xlsx therapists still have
    a 'therapymatch+t...@gmail.com' placeholder in `email`, and how
    many of those have a real `real_email` we can swap in.

    The xlsx importer always wrote the original real email to
    `real_email` while putting a fake one in `email` for testing. To
    actually go live we need to promote `real_email` -> `email` for
    every imported therapist. This endpoint reports what would change
    so the admin can preview before running the destructive step.
    """
    total_imported = await db.therapists.count_documents(
        {"source": "imported_xlsx"},
    )
    placeholder_q = {
        "source": "imported_xlsx",
        "email": {"$regex": "therapymatch\\+", "$options": "i"},
    }
    placeholder_total = await db.therapists.count_documents(placeholder_q)
    restorable = await db.therapists.count_documents({
        **placeholder_q,
        "real_email": {"$regex": "@", "$exists": True},
        # Also require the real_email isn't itself a therapymatch+ value.
    })
    # Surface a few real_email samples (truncated) so admin can sanity-check
    # they look like real addresses before pulling the trigger.
    sample_cursor = db.therapists.find(
        {**placeholder_q, "real_email": {"$regex": "@"}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "real_email": 1},
    ).limit(5)
    samples = await sample_cursor.to_list(5)
    return {
        "total_imported": total_imported,
        "placeholder_emails": placeholder_total,
        "restorable": restorable,
        "missing_real_email": placeholder_total - restorable,
        "samples": samples,
    }


@router.post("/admin/email-restoration/run", dependencies=[Depends(require_admin)])
async def admin_email_restoration_run(payload: dict | None = None) -> dict[str, Any]:
    """Promote `real_email` -> `email` for every imported_xlsx therapist
    whose `email` is still a placeholder. Idempotent: re-running on an
    already-restored therapist is a no-op.

    The placeholder email is preserved in `_email_was_placeholder` (audit
    trail) so a future debug pass can see which docs were swapped.

    Set `payload.dry_run=true` to count without writing -- safety check
    before pulling the trigger on a few hundred docs.
    """
    payload = payload or {}
    dry_run = bool(payload.get("dry_run", False))
    base_q = {
        "source": "imported_xlsx",
        "email": {"$regex": "therapymatch\\+", "$options": "i"},
        "real_email": {"$regex": "@"},
    }
    candidates = await db.therapists.find(
        base_q, {"_id": 0, "id": 1, "email": 1, "real_email": 1},
    ).to_list(2000)
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "would_restore": len(candidates),
        }
    restored = 0
    for t in candidates:
        real = (t.get("real_email") or "").strip()
        if not real or "@" not in real:
            continue
        placeholder = t.get("email") or ""
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {
                "email": real,
                "_email_was_placeholder": placeholder,
                "_email_restored_at": _now_iso(),
                "updated_at": _now_iso(),
            }},
        )
        restored += 1
    logger.warning("EMAIL RESTORATION: restored=%d", restored)
    return {"ok": True, "dry_run": False, "restored": restored}


@router.get("/admin/backfill-status")
async def admin_backfill_status(_: bool = Depends(require_admin)):
    """Snapshot of backfill state  --  used by the admin UI to confirm
    whether a strip operation is needed before going live."""
    total = await db.therapists.count_documents({})
    backfilled = await db.therapists.count_documents(
        {"_backfill_audit": {"$exists": True}},
    )
    fake_emails = await db.therapists.count_documents(
        {"email": {"$regex": "therapymatch\\+", "$options": "i"}},
    )
    real_emails_in_audit = await db.therapists.count_documents(
        {
            "_backfill_audit": {"$exists": True},
            "_backfill_audit.original_email": {"$regex": "@", "$not": {"$regex": "therapymatch\\+"}},
        },
    )
    return {
        "total_therapists": total,
        "backfilled": backfilled,
        "fake_email_count": fake_emails,
        "restorable_count": real_emails_in_audit,
        "stripping_will_skip": backfilled - real_emails_in_audit,
    }


# -- Pre-launch test-data wipe --------------------------------------------
# A blunt-but-guarded button that clears every collection containing
# patient/operational test data (requests, applications, simulator runs,
# auto-recruit cycles, outreach invites, magic codes, etc.) and removes
# any therapists that aren't part of the original imported-xlsx seed pool.
#
# The canonical seed distinguisher is `source == "imported_xlsx"`  --  the
# 122 therapists imported from the original Idaho directory spreadsheet.
# Test-flow signups (source="signup") + gap-recruit auto-creations
# (source="gap_recruit_signup") are wiped, even when their email also
# matches the `therapymatch+` pattern. Without this filter the wipe
# would preserve ~100 throwaway test therapists created during testing
# iterations alongside the canonical 122.
_SEEDED_THERAPIST_FILTER = {"source": "imported_xlsx"}

_WIPE_COLLECTIONS = [
    # Patient-side data
    "requests",
    "applications",
    "declines",
    "patient_accounts",
    # Outreach + recruiting test artifacts
    "outreach_invites",
    "outreach_opt_outs",
    "recruit_drafts",
    "auto_recruit_cycles",
    # Simulator + experiment artifacts
    "simulator_runs",
    "simulator_requests",
    # Operational logs that pile up during testing
    "feedback",
    "followups",
    "magic_codes",
    "password_login_attempts",
    "intake_ip_log",
    "cron_runs",
]


@router.get("/admin/therapists/export")
async def admin_export_therapists(_: bool = Depends(require_admin)):
    """Stream every document in the therapists collection as a JSON
    file download. ObjectId is excluded via projection. Embeddings (T2/T5
    1536-dim vectors) ARE included so the export can be round-tripped
    into another MongoDB without re-embedding.

    Use case: pre-launch backup before wipe-test-data, or to migrate
    the seeded therapist directory into Atlas/another environment."""
    cursor = db.therapists.find({}, {"_id": 0})
    docs = await cursor.to_list(length=5000)
    payload = json.dumps(docs, default=str, indent=2)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"therapists_export_{timestamp}.json"
    return Response(
        content=payload,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Document-Count": str(len(docs)),
        },
    )


@router.get("/admin/wipe-test-data/preview")
async def admin_wipe_test_data_preview(_: bool = Depends(require_admin)):
    """Show counts of what `POST /admin/wipe-test-data` would delete.
    Read-only  --  no side effects. Used by the admin UI to populate the
    confirmation dialog with concrete numbers."""
    counts: dict[str, int] = {}
    for col in _WIPE_COLLECTIONS:
        counts[col] = await db[col].count_documents({})
    seeded_kept = await db.therapists.count_documents(_SEEDED_THERAPIST_FILTER)
    therapists_to_delete = await db.therapists.count_documents(
        {"$nor": [_SEEDED_THERAPIST_FILTER]},
    )
    return {
        "collections_to_clear": counts,
        "therapists_to_delete": therapists_to_delete,
        "therapists_kept": seeded_kept,
        "total_documents_to_delete": (
            sum(counts.values()) + therapists_to_delete
        ),
        "preserved_note": (
            "Kept: 122 imported-xlsx seeded therapists (incl. "
            "backfilled bios), site_copy + how-it-works, FAQs, blog posts, "
            "email templates, scrape sources, admin team accounts, app/"
            "auto-recruit/Turnstile/rate-limit settings, geocache."
        ),
    }


@router.post("/admin/wipe-test-data")
async def admin_wipe_test_data(payload: dict, _: bool = Depends(require_admin)):
    """Pre-launch destructive wipe. Requires `confirm_token=="WIPE TEST DATA"`
    in the body (intentional friction so this can't fire on a stray click).

    Deletes every document from the collections in `_WIPE_COLLECTIONS`
    (patient/operational test data) and every therapist whose email is NOT
    in the seeded `therapymatch+` pool. Preserves the directory of seeded
    therapists, all site config, and all admin team data.
    """
    token = (payload or {}).get("confirm_token", "")
    if token != "WIPE TEST DATA":
        raise HTTPException(
            400,
            "confirm_token must equal 'WIPE TEST DATA' (case + spelling).",
        )
    cleared: dict[str, int] = {}
    for col in _WIPE_COLLECTIONS:
        result = await db[col].delete_many({})
        cleared[col] = result.deleted_count
    # Therapists: delete any document NOT in the seeded pool. Use $nor so
    # documents missing the email field (corrupted) are also deleted.
    therapists_result = await db.therapists.delete_many(
        {"$nor": [_SEEDED_THERAPIST_FILTER]},
    )
    seeded_kept = await db.therapists.count_documents(_SEEDED_THERAPIST_FILTER)
    logger.warning(
        "admin_wipe_test_data: cleared=%s therapists_deleted=%d kept=%d",
        cleared, therapists_result.deleted_count, seeded_kept,
    )
    return {
        "ok": True,
        "cleared": cleared,
        "therapists_deleted": therapists_result.deleted_count,
        "therapists_kept": seeded_kept,
        "total_documents_deleted": (
            sum(cleared.values()) + therapists_result.deleted_count
        ),
    }



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
    """Manual trigger for the daily cron  --  useful for testing without waiting until 2am MT."""
    bill = await _run_daily_billing_charges()
    lic = await _run_license_expiry_alerts()
    avail = await _run_availability_prompts()
    return {"ok": True, "billing": bill, "license": lic, "availability": avail}


@router.get("/admin/followups")
async def admin_list_followups(_: bool = Depends(require_admin)):
    """All follow-up survey responses across all milestones."""
    docs = await db.followups.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    counts = {"48h": 0, "3wk": 0, "9wk": 0, "15wk": 0, "2wk": 0, "6wk": 0}
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
        _spawn_bg(
            send_therapist_approved(t["email"], t["name"]),
            name=f"bulk_approve_{tid[:8]}",
        )
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


@router.get("/admin/waitlist")
async def admin_waitlist(_: bool = Depends(require_admin)):
    """Waitlist entries aggregated by state for demand-signal visibility."""
    entries = await db.waitlist.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    by_state: dict[str, int] = {}
    for e in entries:
        s = e.get("state", "??")
        by_state[s] = by_state.get(s, 0) + 1
    ranked = sorted(by_state.items(), key=lambda x: x[1], reverse=True)
    return {
        "total": len(entries),
        "by_state": ranked,
        "entries": entries[:200],  # most recent 200
    }



@router.get("/admin/therapist-waitlist")
async def admin_therapist_waitlist(_: bool = Depends(require_admin)):
    """Therapist waitlist  --  out-of-state providers interested in joining."""
    entries = await db.therapist_waitlist.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    by_state: dict[str, int] = {}
    for e in entries:
        s = e.get("state", "??")
        by_state[s] = by_state.get(s, 0) + 1
    ranked = sorted(by_state.items(), key=lambda x: x[1], reverse=True)
    return {
        "total": len(entries),
        "by_state": ranked,
        "entries": entries[:200],
    }

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


@router.get("/admin/outreach/opt-outs")
async def admin_list_opt_outs(_: bool = Depends(require_admin)):
    """Full opt-out roster so admins can audit who asked to be removed
    from outreach. Sorted newest-first."""
    docs = await db.outreach_opt_outs.find(
        {}, {"_id": 0},
    ).sort("last_opted_out_at", -1).to_list(500)
    return {"opt_outs": docs, "total": len(docs)}


@router.get("/admin/feedback")
async def admin_list_feedback(request: Request, _: bool = Depends(require_admin)):
    audit.emit(
        actor_type="admin", actor_id="admin", action="list_feedback",
        resource="feedback", detail="limit=1000",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    docs = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"feedback": docs, "total": len(docs)}


@router.get("/admin/outcome-tracking")
async def admin_outcome_tracking(request: Request, _: bool = Depends(require_admin)):
    """Aggregated feedback data: responses by milestone, Match Strength scores, therapist reliability."""
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_outcome_tracking",
        resource="feedback_aggregate", detail="limit=2000",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    # All feedback grouped by milestone
    feedback = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    by_milestone = {}
    for f in feedback:
        m = f.get("milestone", "unknown")
        by_milestone.setdefault(m, []).append(f)

    # Match Strength scores from 9w and 15w feedback
    # Backward-compat: read both new (match_strength_score) and old (tai_score)
    # field names so the endpoint works before AND after the DB migration.
    match_strength_scores = []
    for f in feedback:
        score = f.get("match_strength_score") if f.get("match_strength_score") is not None else f.get("tai_score")
        if score is not None and score >= 0:
            match_strength_scores.append({
                "request_id": f.get("request_id"),
                "milestone": f.get("milestone"),
                "match_strength_score": score,
                "created_at": f.get("created_at"),
                "patient_email": f.get("patient_email", ""),
            })

    # Therapist reliability scores
    therapists = await db.therapists.find(
        {"reliability": {"$exists": True, "$ne": {}}},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "email": 1, "reliability": 1}
    ).to_list(500)

    # Summary stats
    milestone_counts = {m: len(docs) for m, docs in by_milestone.items()}
    avg_ms = round(
        sum(t["match_strength_score"] for t in match_strength_scores) / len(match_strength_scores), 1
    ) if match_strength_scores else None

    return {
        "summary": {
            "total_feedback": len(feedback),
            "milestone_counts": milestone_counts,
            "match_strength_count": len(match_strength_scores),
            "avg_match_strength": avg_ms,
        },
        "feedback_by_milestone": by_milestone,
        "match_strength_scores": match_strength_scores,
        "therapist_reliability": therapists,
    }


# ===========================================================
# Outcomes dashboard -- aggregated data for the 4-tab feedback
# dashboard (Marketing / Recruiting / Satisfaction / Matching).
# Returns one JSON blob with everything the dashboard needs.
# ===========================================================

# Minimum sample sizes before we show a number rather than "needs more data".
# Tuned conservatively: NPS becomes directionally meaningful around n>=5,
# but the correlation between Match Strength and retention needs ~50 pairs
# before it stops being statistical noise.
_MIN_N_PATIENT_NPS = 5
_MIN_N_THERAPIST_NPS = 3
_MIN_N_PROGRESS = 5
_MIN_N_CORRELATION = 50

# How many months of trend data to return.
_TREND_MONTHS = 7


def _calc_nps(scores: list[int]) -> Optional[int]:
    """NPS = % promoters (9-10) - % detractors (0-6), rounded to int."""
    if not scores:
        return None
    n = len(scores)
    promoters = sum(1 for s in scores if s >= 9)
    detractors = sum(1 for s in scores if s <= 6)
    return round((promoters - detractors) * 100 / n)


def _month_key(iso_str: Optional[str]) -> str:
    """Extract YYYY-MM from an ISO timestamp. Empty string if missing/bad."""
    if not iso_str or len(iso_str) < 7:
        return ""
    return iso_str[:7]


def _last_n_months(n: int) -> list[str]:
    """Return last n month keys oldest-first, e.g. ['2025-11', ..., '2026-05']."""
    today = datetime.now(timezone.utc)
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def _pearson(xs: list[float], ys: list[float]) -> Optional[float]:
    """Pearson correlation. Returns None if undefined."""
    n = len(xs)
    if n < 2:
        return None
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    sx2 = sum((x - mean_x) ** 2 for x in xs)
    sy2 = sum((y - mean_y) ** 2 for y in ys)
    if sx2 == 0 or sy2 == 0:
        return None
    return cov / ((sx2 * sy2) ** 0.5)


def _hero(value, n, min_n) -> dict:
    """Hero KPI envelope. value=None when not enough data."""
    return {
        "value": value if (value is not None and n >= min_n) else None,
        "n": n,
        "min_n": min_n,
    }


# Default date range when caller omits the params.
_DEFAULT_RANGE_DAYS = 90


def _months_in_range(start_iso: str, end_iso: str) -> list[str]:
    """Return YYYY-MM strings from start through end, oldest first.
    Cap at 24 months to keep payloads bounded."""
    if not start_iso or not end_iso or len(start_iso) < 7 or len(end_iso) < 7:
        return _last_n_months(_TREND_MONTHS)
    try:
        y, m = int(start_iso[:4]), int(start_iso[5:7])
        end_y, end_m = int(end_iso[:4]), int(end_iso[5:7])
    except ValueError:
        return _last_n_months(_TREND_MONTHS)
    out = []
    while (y, m) <= (end_y, end_m) and len(out) < 24:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out or _last_n_months(_TREND_MONTHS)


def _in_range(iso_ts: Optional[str], start_iso: str, end_iso: str) -> bool:
    """True if iso_ts (or empty/None) falls within [start, end] inclusive."""
    if not iso_ts:
        return False
    return start_iso <= iso_ts <= end_iso


@router.get("/admin/feedback-dashboard")
async def admin_feedback_dashboard(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    _: bool = Depends(require_admin),
):
    """Aggregated data for the Outcomes admin dashboard. One round-trip,
    one JSON blob -- no per-chart endpoints. See render at /admin -> Outcomes.

    Query params:
      start_date, end_date -- ISO 8601 timestamps. If omitted, defaults to
                              the last 90 days. Filters all source data
                              (feedback, therapist_surveys, requests).
    """
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_feedback_dashboard",
        resource="feedback_aggregate",
        detail=f"range={start_date or 'default'}..{end_date or 'now'}",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    today = datetime.now(timezone.utc)
    end_iso = end_date if end_date else today.isoformat()
    start_iso = start_date if start_date else (today - timedelta(days=_DEFAULT_RANGE_DAYS)).isoformat()
    # Guard: if start > end (caller confused), swap so we still return data.
    if start_iso > end_iso:
        start_iso, end_iso = end_iso, start_iso

    feedback_all = await db.feedback.find({}, {"_id": 0}).to_list(5000)
    therapist_surveys_all = await db.therapist_surveys.find({}, {"_id": 0}).to_list(2000)
    # Filter by submitted_at (or created_at fallback) being in the range.
    feedback = [
        f for f in feedback_all
        if _in_range(f.get("submitted_at") or f.get("created_at"), start_iso, end_iso)
    ]
    therapist_surveys = [
        s for s in therapist_surveys_all
        if _in_range(s.get("submitted_at"), start_iso, end_iso)
    ]
    months = _months_in_range(start_iso, end_iso)
    months_set = set(months)

    # -------------------------------------------------------
    # Patient NPS -- pulled from 3w/9w/15w feedback that has an nps field.
    # -------------------------------------------------------
    patient_nps_docs = [
        f for f in feedback
        if f.get("milestone") in ("3w", "9w", "15w") and f.get("nps") is not None
    ]
    patient_nps_all = [int(f["nps"]) for f in patient_nps_docs]
    patient_nps_value = _calc_nps(patient_nps_all)

    # NPS trend by month (last N months only).
    patient_nps_by_month: dict[str, list[int]] = {m: [] for m in months}
    for f in patient_nps_docs:
        mk = _month_key(f.get("submitted_at") or f.get("created_at"))
        if mk in months_set:
            patient_nps_by_month[mk].append(int(f["nps"]))
    patient_nps_trend = [
        {"month": m, "nps": _calc_nps(patient_nps_by_month[m]),
         "n": len(patient_nps_by_month[m])}
        for m in months
    ]

    # Delta over the selected period: last month NPS minus first month NPS
    # within the active date range. None if either endpoint has no data.
    delta_period = None
    if (patient_nps_trend[0]["nps"] is not None
            and patient_nps_trend[-1]["nps"] is not None):
        delta_period = patient_nps_trend[-1]["nps"] - patient_nps_trend[0]["nps"]

    # NPS distribution (0-10 histogram).
    patient_nps_distribution = [0] * 11
    for s in patient_nps_all:
        if 0 <= s <= 10:
            patient_nps_distribution[s] += 1

    # -------------------------------------------------------
    # Therapist NPS -- from Phase 3 therapist surveys.
    # -------------------------------------------------------
    t_nps_all = [int(s["nps"]) for s in therapist_surveys if s.get("nps") is not None]
    t_nps_value = _calc_nps(t_nps_all)

    t_nps_by_month: dict[str, list[int]] = {m: [] for m in months}
    for s in therapist_surveys:
        if s.get("nps") is None:
            continue
        mk = _month_key(s.get("submitted_at"))
        if mk in months_set:
            t_nps_by_month[mk].append(int(s["nps"]))
    t_nps_trend = [
        {"month": m, "nps": _calc_nps(t_nps_by_month[m]),
         "n": len(t_nps_by_month[m])}
        for m in months
    ]
    t_delta_period = None
    if (t_nps_trend[0]["nps"] is not None
            and t_nps_trend[-1]["nps"] is not None):
        t_delta_period = t_nps_trend[-1]["nps"] - t_nps_trend[0]["nps"]

    t_nps_distribution = [0] * 11
    for s in t_nps_all:
        if 0 <= s <= 10:
            t_nps_distribution[s] += 1

    # Match Fit distribution (1=poor, 2=fair, 3=good, 4=excellent).
    match_fit_dist = {"poor": 0, "fair": 0, "good": 0, "excellent": 0}
    fit_labels = {1: "poor", 2: "fair", 3: "good", 4: "excellent"}
    match_fit_values = []
    for s in therapist_surveys:
        mf = s.get("match_fit")
        if mf in fit_labels:
            match_fit_dist[fit_labels[mf]] += 1
            match_fit_values.append(mf)
    match_fit_avg = round(sum(match_fit_values) / len(match_fit_values), 1) if match_fit_values else None

    # New patients per month (therapist-reported).
    new_patients_by_month: dict[str, int] = {m: 0 for m in months}
    for s in therapist_surveys:
        np_count = s.get("new_patients")
        if np_count is None:
            continue
        mk = _month_key(s.get("submitted_at"))
        if mk in months_set:
            new_patients_by_month[mk] += int(np_count)
    new_patients_trend = [{"month": m, "count": new_patients_by_month[m]} for m in months]

    # Therapist coverage: how many active therapists were surveyed?
    total_therapists = await db.therapists.count_documents(
        {"status": {"$in": ["approved", "active"]}}
    )
    surveyed_therapist_ids = {s.get("therapist_id") for s in therapist_surveys if s.get("therapist_id")}

    # -------------------------------------------------------
    # Patient progress at 15w (1-10 self-rating from v1) AND v2 nps presence.
    # -------------------------------------------------------
    progress_values = [
        int(f["progress"]) for f in feedback
        if f.get("milestone") == "15w" and isinstance(f.get("progress"), (int, float))
    ]
    progress_avg = round(sum(progress_values) / len(progress_values), 1) if progress_values else None

    # -------------------------------------------------------
    # Match volume per month + referral source lookup.
    # Load ALL requests so we can resolve referral_source for any feedback
    # doc (even when its request is older than the date range). Use a
    # filtered subset for funnel + monthly-volume calculations.
    # -------------------------------------------------------
    request_docs = await db.requests.find(
        {}, {"_id": 0, "id": 1, "created_at": 1, "referral_source": 1, "notified_therapist_ids": 1}
    ).to_list(20000)
    req_by_id: dict[str, dict] = {r.get("id"): r for r in request_docs if r.get("id")}
    requests_in_range = [
        r for r in request_docs
        if _in_range(r.get("created_at"), start_iso, end_iso)
    ]

    match_volume_by_month: dict[str, int] = {m: 0 for m in months}
    for r in requests_in_range:
        mk = _month_key(r.get("created_at"))
        if mk in months_set:
            match_volume_by_month[mk] += 1
    match_volume_trend = [{"month": m, "count": match_volume_by_month[m]} for m in months]

    # -------------------------------------------------------
    # Conversion funnel (scoped to selected date range).
    # -------------------------------------------------------
    matches_sent = sum(1 for r in requests_in_range if (r.get("notified_therapist_ids") or []))
    responded_48h = sum(1 for f in feedback if f.get("milestone") == "48h")
    picked_3w = sum(
        1 for f in feedback
        if f.get("milestone") == "3w" and f.get("chosen_status") == "picked"
    )
    still_seeing_9w = sum(
        1 for f in feedback
        if f.get("milestone") == "9w" and f.get("still_seeing") == "yes"
    )
    fb_15w = [f for f in feedback if f.get("milestone") == "15w"]
    still_seeing_15w = sum(1 for f in fb_15w if f.get("still_seeing") == "yes")

    # -------------------------------------------------------
    # NPS by referral source -- which channels bring the best patients?
    # Buckets each patient NPS response under its request's referral_source.
    # Sources with fewer than _MIN_N_SOURCE responses are hidden ("other")
    # so a single rating can't skew a channel.
    # -------------------------------------------------------
    _MIN_N_SOURCE = 3
    nps_by_source: dict[str, list[int]] = {}
    for f in patient_nps_docs:
        rid = f.get("request_id")
        req = req_by_id.get(rid) if rid else None
        src = (req.get("referral_source") if req else "") or "unknown"
        src = src.strip().lower() or "unknown"
        nps_by_source.setdefault(src, []).append(int(f["nps"]))
    nps_source_rows = []
    other_scores: list[int] = []
    for src, scores in nps_by_source.items():
        if len(scores) >= _MIN_N_SOURCE:
            nps_source_rows.append({
                "source": src, "nps": _calc_nps(scores), "n": len(scores),
            })
        else:
            other_scores.extend(scores)
    if other_scores:
        nps_source_rows.append({
            "source": "other (low-volume sources)",
            "nps": _calc_nps(other_scores),
            "n": len(other_scores),
        })
    # Sort descending by NPS so winners show up first.
    nps_source_rows.sort(key=lambda x: (x["nps"] is None, -(x["nps"] or 0)))

    # -------------------------------------------------------
    # Match Strength distribution + trend + scatter vs retention.
    # -------------------------------------------------------
    ms_docs = []
    for f in feedback:
        score = f.get("match_strength_score") if f.get("match_strength_score") is not None else f.get("tai_score")
        if score is not None and score >= 0:
            ms_docs.append({
                "request_id": f.get("request_id"),
                "milestone": f.get("milestone"),
                "score": float(score),
                "submitted_at": f.get("submitted_at") or f.get("created_at"),
            })

    # Distribution (10-point buckets: 0-9, 10-19, ..., 90+).
    ms_dist = [0] * 10
    for d in ms_docs:
        bucket = min(int(d["score"] // 10), 9)
        ms_dist[bucket] += 1

    ms_values_all = [d["score"] for d in ms_docs]
    ms_mean = round(sum(ms_values_all) / len(ms_values_all), 1) if ms_values_all else None
    ms_sorted = sorted(ms_values_all)
    ms_median = ms_sorted[len(ms_sorted) // 2] if ms_sorted else None

    # Trend: avg per month (latest score per request used to avoid double-count).
    ms_by_request: dict[str, dict] = {}
    for d in ms_docs:
        rid = d["request_id"]
        if not rid:
            continue
        existing = ms_by_request.get(rid)
        if existing is None or (d["submitted_at"] or "") > (existing["submitted_at"] or ""):
            ms_by_request[rid] = d
    ms_per_month: dict[str, list[float]] = {m: [] for m in months}
    for d in ms_by_request.values():
        mk = _month_key(d["submitted_at"])
        if mk in months_set:
            ms_per_month[mk].append(d["score"])
    ms_trend = [
        {"month": m, "avg": round(sum(v) / len(v), 1) if v else None, "n": len(v)}
        for m, v in ((m, ms_per_month[m]) for m in months)
    ]

    # Scatter: pair each 15w feedback with the patient's best-available
    # match_strength_score. Retained = still_seeing == "yes".
    # Index ms scores by request_id (use 9w first, then 15w override).
    ms_lookup: dict[str, float] = {}
    for d in ms_docs:
        ms_lookup[d["request_id"]] = d["score"]
    scatter = []
    retention_xs = []
    retention_ys = []
    for f in fb_15w:
        rid = f.get("request_id")
        score = ms_lookup.get(rid)
        if score is None:
            continue
        retained = 1 if f.get("still_seeing") == "yes" else 0
        scatter.append({"match_strength": round(score, 1), "retained": bool(retained)})
        retention_xs.append(score)
        retention_ys.append(retained)
    correlation = _pearson(retention_xs, retention_ys)
    correlation_value = round(correlation, 2) if correlation is not None else None

    # -------------------------------------------------------
    # Satisfaction: confidence (3w) trend + recent quotes.
    # -------------------------------------------------------
    conf_3w_all = [
        int(f["confidence"]) for f in feedback
        if f.get("milestone") == "3w" and isinstance(f.get("confidence"), (int, float))
    ]
    conf_3w_avg = round(sum(conf_3w_all) / len(conf_3w_all)) if conf_3w_all else None

    conf_by_month: dict[str, list[int]] = {m: [] for m in months}
    for f in feedback:
        if f.get("milestone") != "3w":
            continue
        if not isinstance(f.get("confidence"), (int, float)):
            continue
        mk = _month_key(f.get("submitted_at") or f.get("created_at"))
        if mk in months_set:
            conf_by_month[mk].append(int(f["confidence"]))
    conf_3w_trend = [
        {"month": m,
         "avg": round(sum(conf_by_month[m]) / len(conf_by_month[m])) if conf_by_month[m] else None,
         "n": len(conf_by_month[m])}
        for m in months
    ]

    # Recent free-text quotes (patient + therapist), newest first.
    def _quote_from_patient(f):
        for key in ("final_reflection", "improvement_text", "notes", "what_changed"):
            txt = f.get(key)
            if txt and isinstance(txt, str) and len(txt.strip()) >= 30:
                return txt.strip()
        return None

    patient_quotes = []
    for f in sorted(feedback, key=lambda x: x.get("submitted_at") or "", reverse=True):
        if f.get("role") != "patient":
            continue
        q = _quote_from_patient(f)
        if q:
            patient_quotes.append({
                "text": q[:240],
                "milestone": f.get("milestone"),
                "submitted_at": f.get("submitted_at"),
            })
            if len(patient_quotes) >= 4:
                break

    therapist_quotes = []
    for s in sorted(therapist_surveys, key=lambda x: x.get("submitted_at") or "", reverse=True):
        txt = s.get("improvement_text") or s.get("feedback_text")
        if txt and isinstance(txt, str) and len(txt.strip()) >= 30:
            therapist_quotes.append({
                "text": txt.strip()[:240],
                "submitted_at": s.get("submitted_at"),
            })
            if len(therapist_quotes) >= 4:
                break

    # -------------------------------------------------------
    # Detractor alert list -- patients who scored 0-6 NPS, newest first.
    # Lets admin reach out personally and save the relationship.
    # -------------------------------------------------------
    detractors = []
    for f in sorted(patient_nps_docs, key=lambda x: x.get("submitted_at") or "", reverse=True):
        try:
            score = int(f["nps"])
        except (KeyError, TypeError, ValueError):
            continue
        if score > 6:
            continue
        # Pick the most relevant free-text comment for context.
        comment = None
        for key in ("final_reflection", "improvement_text", "notes", "what_changed", "surprises"):
            v = f.get(key)
            if v and isinstance(v, str) and v.strip():
                comment = v.strip()[:300]
                break
        rid = f.get("request_id")
        req = req_by_id.get(rid) if rid else None
        detractors.append({
            "request_id": rid,
            "patient_email": f.get("patient_email"),
            "milestone": f.get("milestone"),
            "nps": score,
            "submitted_at": f.get("submitted_at"),
            "comment": comment,
            "referral_source": (req.get("referral_source") if req else "") or "",
        })
        if len(detractors) >= 50:
            break

    return {
        "generated_at": _now_iso(),
        "range": {
            "start_date": start_iso,
            "end_date": end_iso,
        },
        "data_sufficiency": {
            "patient_nps_n": len(patient_nps_all),
            "therapist_nps_n": len(t_nps_all),
            "match_strength_n": len(ms_docs),
            "retention_15w_n": len(fb_15w),
            "scatter_n": len(scatter),
        },
        "hero": {
            "patient_nps": {
                **_hero(patient_nps_value, len(patient_nps_all), _MIN_N_PATIENT_NPS),
                "delta_period": delta_period,
            },
            "therapist_nps": {
                **_hero(t_nps_value, len(t_nps_all), _MIN_N_THERAPIST_NPS),
                "delta_period": t_delta_period,
            },
            "patient_progress_15w": _hero(progress_avg, len(progress_values), _MIN_N_PROGRESS),
            "match_correlation": _hero(correlation_value, len(scatter), _MIN_N_CORRELATION),
        },
        "marketing": {
            "patient_nps_trend": patient_nps_trend,
            "funnel": {
                "matches_sent": matches_sent,
                "responded_48h": responded_48h,
                "picked_3w": picked_3w,
                "still_seeing_9w": still_seeing_9w,
                "still_seeing_15w": still_seeing_15w,
            },
            "match_volume_monthly": match_volume_trend,
            "nps_by_source": nps_source_rows,
        },
        "recruiting": {
            "therapist_nps_trend": t_nps_trend,
            "new_patients_monthly": new_patients_trend,
            "match_fit_distribution": match_fit_dist,
            "match_fit_avg": match_fit_avg,
        },
        "satisfaction": {
            "patient": {
                "nps": patient_nps_value if len(patient_nps_all) >= _MIN_N_PATIENT_NPS else None,
                "confidence_3w_avg": conf_3w_avg,
                "progress_15w_avg": progress_avg,
                "nps_distribution": patient_nps_distribution,
                "n_nps": len(patient_nps_all),
                "recent_quotes": patient_quotes,
            },
            "therapist": {
                "nps": t_nps_value if len(t_nps_all) >= _MIN_N_THERAPIST_NPS else None,
                "match_fit_avg": match_fit_avg,
                "surveyed_count": len(surveyed_therapist_ids),
                "total_count": total_therapists,
                "nps_distribution": t_nps_distribution,
                "n_nps": len(t_nps_all),
                "recent_quotes": therapist_quotes,
            },
            "confidence_3w_trend": conf_3w_trend,
            "detractors": detractors,
        },
        "matching": {
            "scatter": scatter,
            "correlation": correlation_value,
            "distribution": ms_dist,
            "trend": ms_trend,
            "stats": {
                "mean": ms_mean,
                "median": round(ms_median, 1) if ms_median is not None else None,
                "n": len(ms_values_all),
            },
        },
    }


@router.post("/admin/cleanup-v1-followup-flags", dependencies=[Depends(require_admin)])
async def admin_cleanup_v1_followup_flags() -> dict[str, Any]:
    """One-shot cleanup: strips legacy `structured_followup_*_sent_at` and
    `v1_*_sent_at` fields from request docs. These were written by the v1
    survey path which has been deleted; current code never reads them.

    Idempotent -- safe to call multiple times. Returns the count of
    requests that had at least one legacy field removed."""
    legacy_fields = {
        "structured_followup_48h_sent_at": "",
        "structured_followup_3w_sent_at": "",
        "structured_followup_9w_sent_at": "",
        "structured_followup_15w_sent_at": "",
        "v1_survey_48h_sent_at": "",
        "v1_survey_3w_sent_at": "",
        "v1_survey_9w_sent_at": "",
        "v1_survey_15w_sent_at": "",
    }
    # Build a match that finds docs with at least one of these fields.
    match_clauses = [{f: {"$exists": True}} for f in legacy_fields.keys()]
    candidates = await db.requests.count_documents({"$or": match_clauses})
    result = await db.requests.update_many(
        {"$or": match_clauses}, {"$unset": legacy_fields},
    )
    return {
        "candidates": candidates,
        "modified": result.modified_count,
        "matched": result.matched_count,
    }


@router.get("/admin/patients")
async def admin_list_patients_by_email(request: Request, _: bool = Depends(require_admin)):
    """Aggregate every email that has submitted a request and how many
    requests they've filed. Useful for spotting power users / repeat
    submitters. Sorted by most-recent request first.

    Each row also reports whether the patient has set a password (i.e.
    has a row in `patient_accounts` with a hash) so the admin can see
    who's converted to a tracked account.
    """
    audit.emit(
        actor_type="admin", actor_id="admin", action="list_patients",
        resource="patient_list", detail="limit=2000",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    pipeline = [
        {"$match": {"email": {"$exists": True, "$ne": None}}},
        {"$group": {
            "_id": {"$toLower": "$email"},
            "request_count": {"$sum": 1},
            "first_request_at": {"$min": "$created_at"},
            "last_request_at": {"$max": "$created_at"},
            "verified_count": {
                "$sum": {"$cond": [{"$eq": ["$verified", True]}, 1, 0]}
            },
            "matched_count": {
                "$sum": {"$cond": [{"$eq": ["$status", "matched"]}, 1, 0]}
            },
            "completed_count": {
                "$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}
            },
            "latest_state": {"$last": "$location_state"},
            "latest_referral_source": {"$last": "$referral_source"},
        }},
        {"$sort": {"last_request_at": -1}},
        {"$limit": 2000},
    ]
    rows = await db.requests.aggregate(pipeline).to_list(2000)
    out: list[dict] = []
    for r in rows:
        email = r["_id"]
        has_pw = await db.patient_accounts.count_documents(
            {"email": email, "password_hash": {"$exists": True, "$ne": None}},
        )
        out.append({
            "email": email,
            "request_count": r["request_count"],
            "verified_count": r.get("verified_count", 0),
            "matched_count": r.get("matched_count", 0),
            "completed_count": r.get("completed_count", 0),
            "first_request_at": r.get("first_request_at"),
            "last_request_at": r.get("last_request_at"),
            "latest_state": r.get("latest_state"),
            "latest_referral_source": r.get("latest_referral_source"),
            "has_password_account": bool(has_pw),
        })
    return {"patients": out, "total": len(out)}


@router.post("/admin/outreach/{invite_id}/convert")
async def admin_convert_outreach_invite(
    invite_id: str, _: bool = Depends(require_admin),
):
    """Convert an LLM-invited candidate (`outreach_invites`) into a draft
    therapist profile (`therapists`). Carries over name/email/license/city/state
    /specialties/modalities. The new therapist starts in an `invited` state  -- 
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

    # Map LLM credential abbreviation -> our credential_type values.
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
    "ChatGPT / AI assistant",
    "Instagram",
    "Friend / family",
    "Therapist referred me",
    "News article / podcast",
    "Other",
    "Prefer not to say",
]


def _normalize_tail_order(options: list[str]) -> list[str]:
    """Push 'Other' and 'Prefer not to say' to the end (in that order).
    Used at save time so we don't mutate admin's intent beyond ordering."""
    tail_keys = {"other", "prefer not to say"}
    head = [o for o in options if o.strip().lower() not in tail_keys]
    other = next((o for o in options if o.strip().lower() == "other"), None)
    prefer = next(
        (o for o in options if o.strip().lower() == "prefer not to say"), None,
    )
    tail = [o for o in (other, prefer) if o]
    return head + tail


def _reorder_referral_options(options: list[str]) -> list[str]:
    """Read-time normalizer: enforces tail order AND ensures an 'AI assistant'
    option exists so patients arriving from ChatGPT/Claude/Gemini have a clean
    attribution choice. Only injects when the list looks like a real referral
    options set (contains at least one well-known default like 'Google search'
    or 'Instagram'), so arbitrary admin-custom or test lists are left alone."""
    ordered = _normalize_tail_order(options)

    well_known = ("google", "instagram", "friend", "podcast", "therapist referred")
    looks_like_referral_set = any(
        any(kw in (o or "").lower() for kw in well_known) for o in ordered
    )
    if not looks_like_referral_set:
        return ordered

    ai_keywords = ("chatgpt", "ai assistant", "ai tool", "llm", "claude", "gemini")
    has_ai = any(
        any(kw in (o or "").lower() for kw in ai_keywords) for o in ordered
    )
    if has_ai:
        return ordered

    # Inject right after Google search if present, else at the top of head
    tail_keys = {"other", "prefer not to say"}
    head = [o for o in ordered if o.strip().lower() not in tail_keys]
    tail = [o for o in ordered if o.strip().lower() in tail_keys]
    google_idx = next(
        (i for i, o in enumerate(head) if "google" in (o or "").lower()),
        -1,
    )
    insert_at = google_idx + 1 if google_idx >= 0 else 0
    head = head[:insert_at] + ["ChatGPT / AI assistant"] + head[insert_at:]
    return head + tail


@router.get("/admin/referral-source-options", dependencies=[Depends(require_admin)])
async def admin_get_referral_source_options() -> dict[str, Any]:
    """Editable list of choices shown on the patient intake's
    'How did you hear about us?' dropdown."""
    doc = await db.app_config.find_one({"key": "referral_source_options"}, {"_id": 0})
    options = doc.get("options") if doc else None
    if not options:
        options = DEFAULT_REFERRAL_SOURCE_OPTIONS
    return {"options": _reorder_referral_options(options)}


@router.put("/admin/referral-source-options", dependencies=[Depends(require_admin)])
async def admin_set_referral_source_options(payload: dict) -> dict[str, Any]:
    options = payload.get("options")
    if (
        not isinstance(options, list)
        or len(options) == 0
        or not all(isinstance(o, str) and o.strip() for o in options)
    ):
        raise HTTPException(400, "options must be a non-empty list of strings")
    cleaned = _normalize_tail_order([o.strip() for o in options])
    await db.app_config.update_one(
        {"key": "referral_source_options"},
        {"$set": {"key": "referral_source_options", "options": cleaned}},
        upsert=True,
    )
    return {"options": cleaned}


# --- Patient intake rate limit (admin-tunable) --------------------------
# Throttles how many requests one email can submit per rolling window.
# Default: 1 request per 60 minutes  --  keeps junk down while we're still
# learning real user patterns. Stored in `app_config.intake_rate_limit`.
_DEFAULT_INTAKE_RATE = {
    "max_requests_per_window": 1,
    "window_minutes": 60,
    # IP-level cap (separate axis from per-email): how many intake submissions
    # we accept from a single IP per rolling hour. Default 8  --  high enough
    # for clinic / family wifi yet low enough to stop scripted spam.
    "max_per_ip_per_hour": 8,
}


# Deep-match scoring weights (Iter-90). Founder's v2 default is
# 0.40 / 0.35 / 0.25 (sums to 1.0). Admins can edit via the Settings
# panel; the engine renormalises before applying so any input is safe.
@router.get("/admin/deep-match-weights", dependencies=[Depends(require_admin)])
async def admin_get_deep_match_weights() -> dict[str, Any]:
    from matching import _DEEP_MATCH_DEFAULT_WEIGHTS as _DEFAULTS
    doc = await db.app_config.find_one(
        {"key": "deep_match_weights"}, {"_id": 0},
    )
    return {
        "relationship_style": float(
            (doc or {}).get("relationship_style") or _DEFAULTS["relationship_style"]
        ),
        "way_of_working": float(
            (doc or {}).get("way_of_working") or _DEFAULTS["way_of_working"]
        ),
        "contextual_resonance": float(
            (doc or {}).get("contextual_resonance") or _DEFAULTS["contextual_resonance"]
        ),
        "defaults": _DEFAULTS,
    }


@router.put("/admin/deep-match-weights", dependencies=[Depends(require_admin)])
async def admin_set_deep_match_weights(payload: dict) -> dict[str, Any]:
    """Validate + persist deep-match weights. Each weight must be in
    [0.05, 0.6]  --  same guardrail bounds as the v2 spec's auto-tuning
    regression. The three weights are renormalised to sum to 1.0
    before saving so admins don't have to do the math."""
    try:
        rel = float(payload.get("relationship_style"))
        work = float(payload.get("way_of_working"))
        ctx = float(payload.get("contextual_resonance"))
    except (TypeError, ValueError) as e:
        raise HTTPException(400, "All three weights must be numbers") from e
    for name, val in (
        ("relationship_style", rel),
        ("way_of_working", work),
        ("contextual_resonance", ctx),
    ):
        if not (0.05 <= val <= 0.60):
            raise HTTPException(
                400, f"{name} must be between 0.05 and 0.60 (got {val})",
            )
    s = rel + work + ctx
    if s <= 0:
        raise HTTPException(400, "Weights cannot all be zero")
    new = {
        "relationship_style": round(rel / s, 4),
        "way_of_working": round(work / s, 4),
        "contextual_resonance": round(ctx / s, 4),
    }
    await db.app_config.update_one(
        {"key": "deep_match_weights"},
        {"$set": {"key": "deep_match_weights", **new}},
        upsert=True,
    )
    return {"saved": True, **new}



@router.get("/admin/matching-defaults", dependencies=[Depends(require_admin)])
async def admin_get_matching_defaults() -> dict[str, Any]:
    """Return global matching defaults (threshold + max invites)."""
    doc = await db.app_config.find_one(
        {"key": "matching_defaults"}, {"_id": 0},
    )
    return {
        "threshold": float((doc or {}).get("threshold") or DEFAULT_THRESHOLD),
        "max_invites": int((doc or {}).get("max_invites") or 30),
    }


@router.put("/admin/matching-defaults", dependencies=[Depends(require_admin)])
async def admin_set_matching_defaults(payload: dict) -> dict[str, Any]:
    """Persist global matching defaults. Takes effect on next match run."""
    threshold = float(payload.get("threshold", 70))
    max_invites = int(payload.get("max_invites", 30))
    if not (0 <= threshold <= 100):
        raise HTTPException(400, "threshold must be 0-100")
    if not (1 <= max_invites <= 200):
        raise HTTPException(400, "max_invites must be 1-200")
    await db.app_config.update_one(
        {"key": "matching_defaults"},
        {"$set": {
            "key": "matching_defaults",
            "threshold": threshold,
            "max_invites": max_invites,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"saved": True, "threshold": threshold, "max_invites": max_invites}


@router.get("/admin/intake-rate-limit", dependencies=[Depends(require_admin)])
async def admin_get_intake_rate_limit() -> dict[str, Any]:
    doc = await db.app_config.find_one(
        {"key": "intake_rate_limit"}, {"_id": 0},
    )
    out: dict[str, Any] = {
        "max_requests_per_window": int(
            (doc or {}).get("max_requests_per_window")
            or _DEFAULT_INTAKE_RATE["max_requests_per_window"]
        ),
        "window_minutes": int(
            (doc or {}).get("window_minutes")
            or _DEFAULT_INTAKE_RATE["window_minutes"]
        ),
        "max_per_ip_per_hour": int(
            (doc or {}).get("max_per_ip_per_hour")
            or _DEFAULT_INTAKE_RATE["max_per_ip_per_hour"]
        ),
    }
    # Test-mode: when set and not yet expired, both rate-limit axes are
    # bypassed for /api/requests. Frontend uses `test_mode_until` to show
    # the countdown / disable banner.
    test_until = (doc or {}).get("test_mode_until")
    if test_until:
        try:
            from helpers import _parse_iso
            until_dt = _parse_iso(test_until)
            now = datetime.now(timezone.utc)
            if until_dt and until_dt > now:
                out["test_mode_until"] = test_until
                out["test_mode_seconds_remaining"] = int(
                    (until_dt - now).total_seconds()
                )
            else:
                out["test_mode_until"] = None
        except Exception:
            out["test_mode_until"] = None
    else:
        out["test_mode_until"] = None
    return out


@router.put("/admin/intake-rate-limit", dependencies=[Depends(require_admin)])
async def admin_set_intake_rate_limit(payload: dict) -> dict[str, Any]:
    try:
        max_per = int(payload.get("max_requests_per_window"))
        window = int(payload.get("window_minutes"))
    except (TypeError, ValueError):
        raise HTTPException(
            400, "max_requests_per_window and window_minutes must be integers"
        )
    # Optional  --  only validated/persisted when the admin actually sent it.
    # Keeps backwards compat with older clients that only know the per-email
    # axis.
    ip_per_hour_raw = payload.get("max_per_ip_per_hour")
    if ip_per_hour_raw is None:
        ip_per_hour = _DEFAULT_INTAKE_RATE["max_per_ip_per_hour"]
    else:
        try:
            ip_per_hour = int(ip_per_hour_raw)
        except (TypeError, ValueError):
            raise HTTPException(
                400, "max_per_ip_per_hour must be an integer"
            )
        if ip_per_hour < 1 or ip_per_hour > 10000:
            raise HTTPException(
                400, "max_per_ip_per_hour must be between 1 and 10000"
            )
    if max_per < 1 or max_per > 1000:
        raise HTTPException(400, "max_requests_per_window must be between 1 and 1000")
    if window < 1 or window > 30 * 24 * 60:
        raise HTTPException(
            400, "window_minutes must be between 1 and 43200 (30 days)"
        )
    await db.app_config.update_one(
        {"key": "intake_rate_limit"},
        {
            "$set": {
                "key": "intake_rate_limit",
                "max_requests_per_window": max_per,
                "window_minutes": window,
                "max_per_ip_per_hour": ip_per_hour,
            }
        },
        upsert=True,
    )
    return {
        "max_requests_per_window": max_per,
        "window_minutes": window,
        "max_per_ip_per_hour": ip_per_hour,
    }


# --- Test mode (admin-only, time-boxed rate-limit bypass) -----------------
# When enabled, /api/requests skips both the per-IP and per-email rate
# limits for the configured duration. Bot defenses (honeypot, timing
# heuristic, Turnstile) remain ON  --  test mode only relaxes the throttle
# so the same admin can run end-to-end intake tests without tripping
# their own anti-spam guards.
@router.post(
    "/admin/intake-rate-limit/test-mode",
    dependencies=[Depends(require_admin)],
)
async def admin_enable_test_mode(payload: dict) -> dict[str, Any]:
    try:
        minutes = int(payload.get("minutes") or 60)
    except (TypeError, ValueError):
        raise HTTPException(400, "minutes must be an integer")
    # Cap at 24h so a forgotten test-mode toggle can't permanently
    # disable spam protection.
    if minutes < 1 or minutes > 24 * 60:
        raise HTTPException(
            400, "minutes must be between 1 and 1440 (24 hours)"
        )
    until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    until_iso = until.isoformat()
    await db.app_config.update_one(
        {"key": "intake_rate_limit"},
        {
            "$set": {
                "key": "intake_rate_limit",
                "test_mode_until": until_iso,
            }
        },
        upsert=True,
    )
    # Also flush the IP log so the very next intake from this admin's IP
    # starts fresh  --  otherwise the >=cap check still fires from prior
    # entries until the rolling hour expires.
    await db.intake_ip_log.delete_many({})
    return {
        "test_mode_until": until_iso,
        "test_mode_seconds_remaining": minutes * 60,
    }


@router.delete(
    "/admin/intake-rate-limit/test-mode",
    dependencies=[Depends(require_admin)],
)
async def admin_disable_test_mode() -> dict[str, Any]:
    await db.app_config.update_one(
        {"key": "intake_rate_limit"},
        {"$unset": {"test_mode_until": ""}},
    )
    return {"test_mode_until": None}


# --- Availability prompt schedule (admin-tunable) ---------------------
# Which days of the week therapists get the "is your availability still
# current?" email/SMS. Stored in app_config.availability_prompt as
# {days: [0], email_template_key: "availability_prompt"}.
# Day numbering: 0=Monday ... 6=Sunday.

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


@router.get("/admin/availability-prompt", dependencies=[Depends(require_admin)])
async def admin_get_availability_prompt() -> dict[str, Any]:
    from deps import AVAILABILITY_PROMPT_DAYS, DAILY_TASK_HOUR_LOCAL
    doc = await db.app_config.find_one(
        {"key": "availability_prompt"}, {"_id": 0},
    )
    days = (doc or {}).get("days")
    if not isinstance(days, list):
        days = list(AVAILABILITY_PROMPT_DAYS)
    return {
        "days": days,
        "day_names": [_DAY_NAMES[d] for d in days if 0 <= d <= 6],
        "send_hour_local": DAILY_TASK_HOUR_LOCAL,
    }


@router.put("/admin/availability-prompt", dependencies=[Depends(require_admin)])
async def admin_set_availability_prompt(payload: dict) -> dict[str, Any]:
    raw_days = payload.get("days")
    if not isinstance(raw_days, list) or not raw_days:
        raise HTTPException(400, "days must be a non-empty list of integers (0=Mon..6=Sun)")
    days = []
    for d in raw_days:
        try:
            d = int(d)
        except (TypeError, ValueError):
            raise HTTPException(400, f"Invalid day: {d}")
        if d < 0 or d > 6:
            raise HTTPException(400, f"Day must be 0-6, got {d}")
        if d not in days:
            days.append(d)
    days.sort()
    await db.app_config.update_one(
        {"key": "availability_prompt"},
        {"$set": {"key": "availability_prompt", "days": days}},
        upsert=True,
    )
    # Also update the in-memory constant so the cron picks it up
    # without needing a server restart.
    import deps
    deps.AVAILABILITY_PROMPT_DAYS = tuple(days)
    return {
        "days": days,
        "day_names": [_DAY_NAMES[d] for d in days if 0 <= d <= 6],
    }


# --- Data backfill endpoints (admin-only) -----------------------------

@router.post("/admin/backfill/deep-match", dependencies=[Depends(require_admin)])
async def admin_backfill_deep_match(payload: dict = None) -> dict[str, Any]:
    """Backfill deep-match T1-T5 fields for seed therapists missing them.
    Pass {"dry_run": true} to preview without writing. Default: applies."""
    import hashlib
    import random as _random

    dry_run = (payload or {}).get("dry_run", False)

    # T-field option slugs
    _T1_SLUGS = [
        "leads_structured", "follows_lead", "challenges",
        "warm_first", "direct_honest", "guides_questions",
    ]
    _T3_SLUGS = [
        "deep_emotional", "practical_tools", "explore_past",
        "focus_forward", "build_insight", "shift_relationships",
    ]
    _T4_SLUGS = ["direct", "incremental", "questions", "emotional", "wait"]

    # Simple specialty-to-style mapping
    _STYLE_MAP = {
        "CBT": ("direct", ["leads_structured", "direct_honest", "challenges"]),
        "DBT": ("incremental", ["leads_structured", "warm_first", "guides_questions"]),
        "EMDR": ("emotional", ["leads_structured", "guides_questions", "warm_first"]),
        "Psychodynamic": ("questions", ["guides_questions", "follows_lead", "challenges"]),
        "Humanistic": ("emotional", ["warm_first", "follows_lead", "guides_questions"]),
        "Person-Centered": ("emotional", ["warm_first", "follows_lead", "guides_questions"]),
        "Solution-Focused": ("direct", ["direct_honest", "leads_structured", "challenges"]),
        "Integrative": ("questions", ["guides_questions", "warm_first", "challenges"]),
        "Trauma-Focused": ("incremental", ["warm_first", "guides_questions", "leads_structured"]),
        "Family Systems": ("incremental", ["guides_questions", "leads_structured", "warm_first"]),
        "ACT": ("questions", ["guides_questions", "warm_first", "challenges"]),
        "EFT": ("emotional", ["warm_first", "guides_questions", "follows_lead"]),
    }
    _T3_MAP = {
        "CBT": ["practical_tools", "focus_forward"],
        "DBT": ["practical_tools", "build_insight"],
        "EMDR": ["deep_emotional", "explore_past"],
        "Psychodynamic": ["explore_past", "build_insight"],
        "Trauma-Focused": ["deep_emotional", "explore_past"],
        "Solution-Focused": ["practical_tools", "focus_forward"],
        "Humanistic": ["build_insight", "shift_relationships"],
        "Family Systems": ["shift_relationships", "build_insight"],
        "EFT": ["deep_emotional", "shift_relationships"],
        "ACT": ["build_insight", "focus_forward"],
    }

    _T2_TEMPLATES = [
        "I worked with a client dealing with {issue} who had been in therapy before without real progress. Through {approach}, we built trust and self-awareness over about {months} months. The turning point came when they started applying insights to daily life. By the end, they reported feeling more confident and connected than they had in years.",
        "One client stands out  --  someone overwhelmed by {issue}. They were skeptical. Using {approach}, we focused on practical tools between sessions. Week by week, small shifts added up. After {months} months, they told me they finally felt like themselves again.",
    ]
    _T5_TEMPLATES = [
        "I understand {exp1} from the inside  --  it shaped how I show up in the therapy room. I also bring personal experience with {exp2}, which helps me connect with clients navigating similar challenges without judgment.",
        "My own journey through {exp1} gives me depth beyond clinical training. I've also navigated {exp2} personally, which informs how I hold space for clients going through the same.",
    ]
    _EXPERIENCES = [
        "career transitions", "family dynamics in a blended family",
        "managing anxiety", "grief and loss", "rural community roots",
        "parenting challenges", "chronic health conditions",
        "cultural identity questions", "recovery from burnout",
        "first-generation college experience", "caregiving responsibilities",
        "midlife transitions",
    ]
    _APPROACHES = [
        "CBT and mindfulness", "psychodynamic exploration",
        "EMDR and trauma-focused work", "DBT skills training",
        "solution-focused techniques", "person-centered approaches",
        "ACT principles", "integrative methods",
    ]

    query = {
        "is_active": {"$ne": False},
        "$or": [
            {"t1_stuck_ranked": {"$in": [[], None]}},
            {"t1_stuck_ranked": {"$exists": False}},
            {"t2_progress_story": {"$in": ["", None]}},
            {"t2_progress_story": {"$exists": False}},
            {"t3_breakthrough": {"$in": [[], None]}},
            {"t3_breakthrough": {"$exists": False}},
            {"t4_hard_truth": {"$in": ["", None]}},
            {"t4_hard_truth": {"$exists": False}},
            {"t5_lived_experience": {"$in": ["", None]}},
            {"t5_lived_experience": {"$exists": False}},
        ],
    }
    cursor = db.therapists.find(query, {
        "_id": 0, "id": 1, "name": 1, "email": 1,
        "primary_specialties": 1, "secondary_specialties": 1,
        "modalities": 1, "general_treats": 1,
        "t1_stuck_ranked": 1, "t2_progress_story": 1,
        "t3_breakthrough": 1, "t4_hard_truth": 1,
        "t5_lived_experience": 1,
    })
    therapists = await cursor.to_list(500)

    results = []
    for t in therapists:
        seed = int(hashlib.md5(t["id"].encode()).hexdigest()[:8], 16)
        rng = _random.Random(seed)
        specs = (t.get("primary_specialties") or []) + (t.get("secondary_specialties") or []) + (t.get("modalities") or [])
        update = {}
        missing = []

        if not (t.get("t1_stuck_ranked") or []):
            score = {s: rng.uniform(0, 1) for s in _T1_SLUGS}
            for spec in specs:
                m = _STYLE_MAP.get(spec)
                if m:
                    for i, slug in enumerate(m[1]):
                        score[slug] += 3 - i
            update["t1_stuck_ranked"] = sorted(_T1_SLUGS, key=lambda s: score[s], reverse=True)
            missing.append("t1_stuck_ranked")

        if len((t.get("t2_progress_story") or "").strip()) < 50:
            issue = "persistent anxiety"
            for g in (t.get("general_treats") or []):
                if "depress" in g.lower(): issue = "depression"
                elif "anxi" in g.lower(): issue = "anxiety"
                elif "trauma" in g.lower(): issue = "trauma"
                elif "grief" in g.lower(): issue = "grief"
                elif "relationship" in g.lower(): issue = "relationship difficulties"
            update["t2_progress_story"] = rng.choice(_T2_TEMPLATES).format(
                issue=issue, approach=rng.choice(_APPROACHES), months=rng.choice(["4","6","8"]),
            )
            missing.append("t2_progress_story")

        if len(t.get("t3_breakthrough") or []) < 2:
            t3 = None
            for spec in specs:
                if spec in _T3_MAP:
                    t3 = list(_T3_MAP[spec])
                    break
            update["t3_breakthrough"] = t3 or rng.sample(_T3_SLUGS, 2)
            missing.append("t3_breakthrough")

        if not (t.get("t4_hard_truth") or "").strip():
            t4 = "questions"
            for spec in specs:
                m = _STYLE_MAP.get(spec)
                if m:
                    t4 = m[0]
                    break
            update["t4_hard_truth"] = t4
            missing.append("t4_hard_truth")

        if len((t.get("t5_lived_experience") or "").strip()) < 30:
            exps = list(_EXPERIENCES)
            rng.shuffle(exps)
            update["t5_lived_experience"] = rng.choice(_T5_TEMPLATES).format(
                exp1=exps[0], exp2=exps[1],
            )
            missing.append("t5_lived_experience")

        # T6  --  session expectations (pick 2-3 from slug set)
        _T6_SLUGS = ["guide_direct", "listen_heard", "tools_fast", "explore_patterns", "depends"]
        if len(t.get("t6_session_expectations") or []) < 2:
            update["t6_session_expectations"] = rng.sample(_T6_SLUGS, k=rng.choice([2, 3]))
            missing.append("t6_session_expectations")

        # T6b  --  early sessions description (free text)
        _T6B_TEMPLATES = [
            "In our first few sessions, I focus on {focus1} while building a strong therapeutic relationship. I want clients to feel {feeling} and know that we have a clear plan moving forward.",
            "Early sessions are about {focus1} and getting to know each other. I pay close attention to {focus2} and adjust my approach based on what resonates with each person.",
            "I start by {focus1}, creating space for clients to share at their own pace. By session 3, I like to have a working understanding of {focus2} so we can set meaningful goals together.",
        ]
        _FOCUSES = [
            "understanding what brought you in", "establishing safety and trust",
            "exploring your history and patterns", "identifying concrete goals",
            "assessing strengths and resources", "mapping out coping strategies",
            "noticing relational dynamics", "building emotional vocabulary",
        ]
        _FEELINGS = ["heard and understood", "safe to be vulnerable", "hopeful about the process", "confident we can make progress"]
        if len((t.get("t6_early_sessions_description") or "").strip()) < 30:
            update["t6_early_sessions_description"] = rng.choice(_T6B_TEMPLATES).format(
                focus1=rng.choice(_FOCUSES), focus2=rng.choice(_FOCUSES), feeling=rng.choice(_FEELINGS),
            )
            missing.append("t6_early_sessions_description")

        if not update:
            continue

        update["_deep_match_backfilled"] = True
        update["_deep_match_backfilled_fields"] = missing

        if not dry_run:
            await db.therapists.update_one({"id": t["id"]}, {"$set": update})

        results.append({
            "name": t["name"], "email": t["email"],
            "fields_filled": missing,
        })

    return {
        "dry_run": dry_run,
        "updated": len(results),
        "therapists": results[:50],  # Cap preview
    }


@router.post("/admin/backfill/office-geos", dependencies=[Depends(require_admin)])
async def admin_backfill_office_geos(payload: dict = None) -> dict[str, Any]:
    """Geocode office locations for therapists missing office_geos.
    Pass {"dry_run": true} to preview without writing."""
    from geocoding import geocode_offices
    import re as _re

    dry_run = (payload or {}).get("dry_run", False)

    query = {
        "is_active": {"$ne": False},
        "$or": [
            {
                "office_locations": {"$exists": True, "$ne": []},
                "$or": [
                    {"office_geos": {"$exists": False}},
                    {"office_geos": []},
                    {"office_geos": None},
                ],
            },
            {
                "office_addresses": {"$exists": True, "$ne": []},
                "$or": [
                    {"office_geos": {"$exists": False}},
                    {"office_geos": []},
                    {"office_geos": None},
                ],
            },
        ],
    }
    cursor = db.therapists.find(query, {
        "_id": 0, "id": 1, "name": 1, "email": 1,
        "office_locations": 1, "office_addresses": 1,
        "office_geos": 1, "modality_offering": 1,
    })
    therapists = await cursor.to_list(500)

    results = []
    for t in therapists:
        cities = []
        for addr in (t.get("office_addresses") or []):
            parts = addr.split(",")
            if len(parts) >= 2:
                city = parts[1].strip()
                city = _re.sub(r"\s*ID\s*$", "", city).strip()
                city = _re.sub(r"\s*\d{5}(-\d{4})?\s*$", "", city).strip()
                if city:
                    cities.append(city)
        if not cities:
            cities = list(t.get("office_locations") or [])
        if not cities:
            results.append({"name": t["name"], "status": "skipped", "reason": "no location data"})
            continue

        geos = await geocode_offices(db, cities, state="ID")
        if not geos:
            results.append({"name": t["name"], "status": "failed", "cities": cities})
            continue

        if not dry_run:
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"office_geos": geos, "office_locations": cities}},
            )
        results.append({
            "name": t["name"], "status": "fixed",
            "offices": [g["city"] for g in geos],
        })

    fixed = sum(1 for r in results if r["status"] == "fixed")
    return {
        "dry_run": dry_run,
        "total": len(therapists),
        "fixed": fixed,
        "skipped": sum(1 for r in results if r.get("status") == "skipped"),
        "failed": sum(1 for r in results if r.get("status") == "failed"),
        "details": results[:50],
    }


# --- Email templates (admin-viewable) ----------------------------------

@router.get("/admin/email-templates", dependencies=[Depends(require_admin)])
async def admin_get_email_templates() -> dict[str, Any]:
    """Return list of all email template names so admin can see what's configured."""
    from email_service import (
        send_availability_prompt,
        send_verification_email,
        send_results_email,
        send_claim_profile_email,
    )
    templates = [
        {
            "key": "availability_prompt",
            "name": "Availability Check-in",
            "description": "Weekly Monday morning email asking therapists to confirm their availability",
            "subject": "Quick check  --  is your TheraVoca availability still current?",
            "trigger": "Cron job, configurable days via /admin/availability-prompt",
        },
        {
            "key": "verification",
            "name": "Email Verification",
            "description": "Sent to patient after request submission to verify their email",
            "subject": "Verify your email  --  TheraVoca",
            "trigger": "After patient submits intake form",
        },
        {
            "key": "results",
            "name": "Results Delivery",
            "description": "Sent to patient when their matched therapist results are ready",
            "subject": "Your therapist matches are ready  --  TheraVoca",
            "trigger": "After matching completes or auto-delay expires",
        },
        {
            "key": "therapist_notification",
            "name": "New Referral Match",
            "description": "Sent to therapist when a new patient matches their profile",
            "subject": "New referral match ({match_score}%)  --  TheraVoca",
            "trigger": "During matching when therapist scores above threshold",
        },
        {
            "key": "claim_profile",
            "name": "Claim Profile",
            "description": "One-time go-live outreach asking existing therapists to claim their profile",
            "subject": "Your TheraVoca profile is ready  --  complete it now",
            "trigger": "Manual admin action",
        },
    ]
    return {"templates": templates}


# --- External scrape-source registry (admin-tunable) --------------------
# Admin can paste in extra directory URLs (ID Counseling Association,
# group-practice rosters, county clinic listings, etc.) that the
# outreach LLM and gap recruiter should consult ON TOP of Psychology
# Today. Stored in `app_config.scrape_sources` as a list of:
#   {url, label, notes, enabled}.
_DEFAULT_SCRAPE_SOURCES: list[dict[str, Any]] = []


def _coerce_source(payload: dict) -> dict[str, Any]:
    """Validate + normalize one source dict from the admin payload."""
    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "Each source requires a url")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, f"URL must start with http(s)://: {url}")
    from urllib.parse import urlparse
    if not urlparse(url).netloc:
        raise HTTPException(400, f"URL is missing a host: {url}")
    return {
        "id": (payload.get("id") or str(_uuid.uuid4())),
        "url": url,
        "label": (payload.get("label") or "").strip()[:120],
        "notes": (payload.get("notes") or "").strip()[:500],
        "enabled": bool(payload.get("enabled", True)),
    }


@router.get("/admin/scrape-sources", dependencies=[Depends(require_admin)])
async def admin_get_scrape_sources() -> dict[str, Any]:
    doc = await db.app_config.find_one({"key": "scrape_sources"}, {"_id": 0})
    sources = doc.get("sources") if doc else None
    if not isinstance(sources, list):
        sources = list(_DEFAULT_SCRAPE_SOURCES)
    return {"sources": sources}


@router.put("/admin/scrape-sources", dependencies=[Depends(require_admin)])
async def admin_set_scrape_sources(payload: dict) -> dict[str, Any]:
    raw = payload.get("sources")
    if not isinstance(raw, list):
        raise HTTPException(400, "sources must be a list")
    if len(raw) > 50:
        raise HTTPException(400, "Maximum 50 sources allowed")
    cleaned = [_coerce_source(s) for s in raw if isinstance(s, dict)]
    await db.app_config.update_one(
        {"key": "scrape_sources"},
        {"$set": {"key": "scrape_sources", "sources": cleaned}},
        upsert=True,
    )
    return {"sources": cleaned}


async def get_enabled_scrape_sources() -> list[dict]:
    """Helper for outreach/recruiter modules to fetch the admin-configured
    extra directory URLs. Returns only enabled rows."""
    doc = await db.app_config.find_one({"key": "scrape_sources"}, {"_id": 0})
    sources = (doc or {}).get("sources") or []
    return [s for s in sources if s.get("enabled", True) and s.get("url")]


@router.post("/admin/scrape-sources/test", dependencies=[Depends(require_admin)])
async def admin_scrape_sources_test(payload: dict) -> dict[str, Any]:
    """Live-fetch ONE source URL and report how many therapist cards we
    can extract (JSON-LD strategy first, LLM fallback). Lets the admin
    sanity-check a directory URL before saving it."""
    url = (payload.get("url") or "").strip()
    label = (payload.get("label") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "url must start with http(s)://")
    from external_scraper import scrape_external_sources
    bundle = await scrape_external_sources(
        [{"url": url, "label": label, "enabled": True}],
        total_budget_sec=20.0,
    )
    res = (bundle.get("results") or [{}])[0]
    return {
        "url": url,
        "label": label,
        "strategy": res.get("strategy", "none"),
        "candidate_count": len(res.get("candidates") or []),
        "candidates_preview": (res.get("candidates") or [])[:5],
        "error": res.get("error"),
        "elapsed_sec": bundle.get("elapsed_sec"),
    }


@router.get(
    "/admin/sms-status",
    dependencies=[Depends(require_admin)],
)
async def admin_sms_status() -> dict[str, Any]:
    """Read the stored A2P 10DLC config plus the last test-SMS result.
    Used by the dashboard banner to show a green/red deliverability badge.
    """
    cfg = await db.app_config.find_one({"key": "a2p_10dlc"}, {"_id": 0}) or {}
    last = await db.app_config.find_one(
        {"key": "last_test_sms"}, {"_id": 0},
    ) or {}
    enabled = os.environ.get("TWILIO_ENABLED", "").lower() == "true"
    has_creds = bool(
        os.environ.get("TWILIO_ACCOUNT_SID")
        and os.environ.get("TWILIO_AUTH_TOKEN"),
    )
    last_status = last.get("final_status")
    last_error = last.get("error_code")
    # Deliverability verdict  --  pessimistic by design.
    if not has_creds:
        verdict = "missing_credentials"
    elif not enabled:
        verdict = "twilio_disabled"
    elif last_error in (30034, 30032):
        verdict = "blocked_a2p_10dlc"
    elif last_status == "delivered":
        verdict = "delivered_recently"
    elif last_status in ("undelivered", "failed"):
        verdict = "blocked"
    else:
        verdict = "untested"
    return {
        "verdict": verdict,
        "twilio_enabled": enabled,
        "has_credentials": has_creds,
        "from_number": os.environ.get("TWILIO_FROM_NUMBER", ""),
        "dev_override_to": os.environ.get("TWILIO_DEV_OVERRIDE_TO", ""),
        "a2p_brand_id": cfg.get("brand_id") or "",
        "a2p_campaign_id": cfg.get("campaign_id") or "",
        "a2p_status": cfg.get("status") or "unregistered",
        "a2p_notes": cfg.get("notes") or "",
        "last_test_sms": last,
    }


@router.put(
    "/admin/sms-status/a2p",
    dependencies=[Depends(require_admin)],
)
async def admin_set_a2p(payload: dict) -> dict[str, Any]:
    """Save the A2P brand_id + campaign_id + admin-entered status. Lets
    the team document where they are in registration without leaving
    the admin dashboard."""
    cfg = {
        "key": "a2p_10dlc",
        "brand_id": (payload.get("brand_id") or "").strip()[:120],
        "campaign_id": (payload.get("campaign_id") or "").strip()[:120],
        "status": (payload.get("status") or "unregistered").strip(),
        "notes": (payload.get("notes") or "").strip()[:500],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.app_config.update_one(
        {"key": "a2p_10dlc"}, {"$set": cfg}, upsert=True,
    )
    return cfg


# --- SMS templates (editable via site_copy) --------------------------------
@router.get("/admin/sms-templates", dependencies=[Depends(require_admin)])
async def admin_list_sms_templates() -> dict[str, Any]:
    """Return all SMS templates with current values (from site_copy) and defaults."""
    templates = []
    for key, default in SMS_TEMPLATE_DEFAULTS.items():
        doc = await db.site_copy.find_one({"key": key})
        current = doc["value"] if doc and doc.get("value") else default
        # Describe available placeholders for each template
        placeholders = {
            "sms.therapist_referral": ["first_name", "match_score", "apply_url"],
            "sms.patient_intake_receipt": [],
            "sms.availability_prompt": ["first_name", "portal_url"],
        }
        templates.append({
            "key": key,
            "label": key.replace("sms.", "").replace("_", " ").title(),
            "default": default,
            "current_value": current,
            "is_customized": current != default,
            "placeholders": placeholders.get(key, []),
        })
    return {"templates": templates}


@router.put("/admin/sms-templates", dependencies=[Depends(require_admin)])
async def admin_update_sms_template(payload: dict) -> dict[str, Any]:
    """Update an SMS template. Body: {key, value}. Set value="" to reset to default."""
    key = (payload.get("key") or "").strip()
    value = (payload.get("value") or "").strip()
    if key not in SMS_TEMPLATE_DEFAULTS:
        raise HTTPException(400, f"Unknown template key: {key}")
    if not value:
        # Reset to default  --  delete the override
        await db.site_copy.delete_one({"key": key})
        return {"key": key, "value": SMS_TEMPLATE_DEFAULTS[key], "reset": True}
    # Validate placeholders won't break at render time
    try:
        sample = {
            "first_name": "Test", "match_score": 90,
            "apply_url": "https://example.com", "portal_url": "https://example.com",
        }
        value.format(**sample)
    except (KeyError, IndexError) as e:
        raise HTTPException(400, f"Invalid placeholder in template: {e}")
    await db.site_copy.update_one(
        {"key": key},
        {"$set": {"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"key": key, "value": value, "reset": False}


# --- Research enrichment toggle + manual triggers --------------------------
@router.get("/admin/research-enrichment", dependencies=[Depends(require_admin)])
async def admin_get_research_enrichment() -> dict[str, Any]:
    from research_enrichment import is_enabled
    enabled = await is_enabled()
    # Stats: how many therapists have a fresh research summary?
    fresh_cutoff = (
        datetime.now(timezone.utc) - timedelta(days=30)
    ).isoformat()
    fresh = await db.therapists.count_documents({
        "research_refreshed_at": {"$gte": fresh_cutoff},
    })
    enriched_requests = await db.requests.count_documents({
        "research_scores": {"$exists": True, "$ne": {}},
    })
    return {
        "enabled": enabled,
        "therapists_with_fresh_research": fresh,
        "enriched_requests": enriched_requests,
    }


@router.put("/admin/research-enrichment", dependencies=[Depends(require_admin)])
async def admin_set_research_enrichment(payload: dict) -> dict[str, Any]:
    from research_enrichment import set_enabled
    enabled = bool(payload.get("enabled"))
    await set_enabled(enabled)
    return {"enabled": enabled}


@router.post(
    "/admin/research-enrichment/run/{request_id}",
    dependencies=[Depends(require_admin)],
)
async def admin_run_research_enrichment(request_id: str) -> dict[str, Any]:
    """Manual trigger so the admin can enrich an already-matched request
    after flipping the toggle (or after a therapist updates their site)."""
    from research_enrichment import enrich_matches_for_request, set_enabled, is_enabled
    # Allow one-off run even if globally disabled  --  temporarily enable, run,
    # restore. Cleaner UX than telling admin "you must enable first".
    was_enabled = await is_enabled()
    if not was_enabled:
        await set_enabled(True)
    try:
        result = await enrich_matches_for_request(request_id)
    finally:
        if not was_enabled:
            await set_enabled(False)
    return result


@router.post(
    "/admin/research-enrichment/deep/{therapist_id}",
    dependencies=[Depends(require_admin)],
)
async def admin_deep_research_therapist(therapist_id: str) -> dict[str, Any]:
    """Run deep web-research on ONE therapist  --  DuckDuckGo search +
    fetch up to 5 extra pages (PT profile, podcasts, blogs, papers)
    + LLM evidence extraction. Caches result on the therapist doc.
    Costs more than the standard refresh (~30s + 2-3x tokens) so it's
    opt-in per therapist rather than running on every match."""
    from research_enrichment import get_or_build_research
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "password_hash": 0, "password_set_at": 0})
    if not t:
        raise HTTPException(404, "Therapist not found")
    res = await get_or_build_research(t, force=True, deep=True)
    return {
        "therapist_id": therapist_id,
        "name": t.get("name"),
        "summary": res.get("summary"),
        "evidence_themes": res.get("themes") or {},
        "modality_evidence": res.get("modality_evidence") or {},
        "depth_signal": res.get("depth_signal"),
        "public_footprint": res.get("public_footprint") or [],
        "extra_sources": res.get("extra_sources") or [],
        "deep_mode": True,
    }


# Tracks the warmup state in app_config so the admin sees progress.
_WARMUP_KEY = "deep_research_warmup"


@router.post(
    "/admin/research-enrichment/warmup",
    dependencies=[Depends(require_admin)],
)
async def admin_warmup_deep_research(payload: dict) -> dict[str, Any]:
    """Pre-warm the deep-research cache for the top N therapists by
    rolling deep research over each of them in the background. The
    warmup runs sequentially under a 60s/therapist budget so we don't
    flood DDG; expect ~30 minutes for 30 therapists."""
    raw_count = payload.get("count")
    target_count = int(raw_count) if raw_count is not None else 30
    target_count = max(1, min(target_count, 200))

    # Only target therapists whose deep-research cache is missing OR
    # older than 30 days. Each cache costs ~30s of LLM/DDG work, so
    # warming a therapist that was just refreshed is wasted spend; the
    # research_enrichment module already treats <30d caches as fresh.
    fresh_cutoff = (
        datetime.now(timezone.utc) - timedelta(days=30)
    ).isoformat()
    stale_filter = {
        "is_active": {"$ne": False},
        "pending_approval": {"$ne": True},
        "$or": [
            {"research_refreshed_at": {"$exists": False}},
            {"research_refreshed_at": None},
            {"research_refreshed_at": {"$lt": fresh_cutoff}},
        ],
    }
    # Pick stale therapists, oldest cache first (so never-warmed ones
    # come up before therapists whose cache is just over 30 days).
    cursor = db.therapists.find(
        stale_filter,
        {"_id": 0, "id": 1, "name": 1, "research_refreshed_at": 1},
    ).sort([
        ("research_refreshed_at", 1),  # null/oldest first
        ("years_experience", -1),
    ]).limit(target_count)
    targets = await cursor.to_list(target_count)

    started = datetime.now(timezone.utc).isoformat()
    await db.app_config.update_one(
        {"key": _WARMUP_KEY},
        {"$set": {
            "key": _WARMUP_KEY,
            "running": True,
            "started_at": started,
            "completed_at": None,
            "total": len(targets),
            "done": 0,
            "failed": 0,
            "current_name": None,
        }},
        upsert=True,
    )

    async def _run() -> None:
        from research_enrichment import get_or_build_research
        done = 0
        failed = 0
        for t_lite in targets:
            t = await db.therapists.find_one(
                {"id": t_lite["id"]}, {"_id": 0},
            )
            if not t:
                failed += 1
                continue
            await db.app_config.update_one(
                {"key": _WARMUP_KEY},
                {"$set": {"current_name": t.get("name")}},
            )
            try:
                await get_or_build_research(t, force=True, deep=True)
                done += 1
            except Exception as e:
                logger.warning(
                    "deep-research warmup failed for %s: %s",
                    t.get("name"), e,
                )
                failed += 1
            # Bail out early if the admin clicked Cancel (sets running=false).
            cur = await db.app_config.find_one(
                {"key": _WARMUP_KEY}, {"_id": 0, "running": 1},
            )
            if cur and cur.get("running") is False:
                break
            await db.app_config.update_one(
                {"key": _WARMUP_KEY},
                {"$set": {"done": done, "failed": failed}},
            )
        await db.app_config.update_one(
            {"key": _WARMUP_KEY},
            {"$set": {
                "running": False,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "current_name": None,
            }},
        )

    _spawn_bg(_run(), name="research_warmup")
    return {
        "started": True,
        "queued": len(targets),
        "started_at": started,
    }


@router.get(
    "/admin/research-enrichment/warmup",
    dependencies=[Depends(require_admin)],
)
async def admin_get_warmup_status() -> dict[str, Any]:
    doc = await db.app_config.find_one({"key": _WARMUP_KEY}, {"_id": 0})
    return doc or {"running": False, "total": 0, "done": 0, "failed": 0}


@router.post(
    "/admin/research-enrichment/warmup/cancel",
    dependencies=[Depends(require_admin)],
)
async def admin_cancel_warmup() -> dict[str, Any]:
    """Soft-cancel: flips running=false in the status doc so the running
    loop bails out at its next iteration. The therapist currently
    in-flight will finish before the loop exits."""
    res = await db.app_config.update_one(
        {"key": _WARMUP_KEY},
        {"$set": {
            "running": False,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "current_name": None,
            "cancelled": True,
        }},
    )
    return {"ok": True, "matched": res.matched_count}


# Public endpoint  --  patient intake calls this to populate its dropdown.
public_router = APIRouter()


@public_router.get("/config/referral-source-options")
async def public_referral_source_options() -> dict[str, Any]:
    doc = await db.app_config.find_one({"key": "referral_source_options"}, {"_id": 0})
    options = doc.get("options") if doc else None
    if not options:
        options = DEFAULT_REFERRAL_SOURCE_OPTIONS
    return {"options": _reorder_referral_options(options)}


@public_router.get("/config/turnstile")
async def public_turnstile_config() -> dict[str, Any]:
    """Public endpoint the React app calls on mount to decide whether
    to render the Turnstile widget. Returns:
        { enabled: bool, site_key: str | None }

    The site_key is returned so the frontend can render the widget
    without baking the env var into the bundle at CRA build time.
    Lifting the key from build-time to runtime means env-var changes
    in Render take effect on the NEXT page load -- not after a full
    rebuild.

    `enabled=False` when any of:
      (a) master testing mode is on (admin opted into a global bypass
          window -- backend would silently skip token verification, so
          we shouldn't render a widget that the user fills out for
          nothing)
      (b) the admin has flipped the Turnstile-specific runtime-disable
          toggle, OR
      (c) neither `TURNSTILE_SITE_KEY` nor `REACT_APP_TURNSTILE_SITE_KEY`
          env vars are configured.

    Site keys are PUBLIC by design (Cloudflare embeds them in the
    widget URL); the secret key never leaves the server."""
    import turnstile_service
    import testing_mode
    if await testing_mode.is_active():
        # Backend will skip verification entirely -- don't render a
        # widget that misleads the user into thinking they're proving
        # humanity when nothing is being checked.
        return {"enabled": False, "site_key": None}
    disabled = await turnstile_service._is_disabled_by_admin()
    site_key = turnstile_service._site_key()
    return {
        "enabled": (not disabled) and bool(site_key),
        "site_key": site_key or None,
    }


@public_router.get("/config/hard-capacity")
async def public_hard_capacity() -> dict[str, Any]:
    """Returns which HARD intake options should be greyed out because
    there aren't enough therapists in the directory passing them.
    Lightweight aggregate  --  used by the intake form on mount.
    (Admins see the same data + full protection reasons via
    /api/admin/hard-capacity)."""
    import hard_capacity
    result = await hard_capacity.compute_capacity_cached(db)
    # Lean payload for public consumers  --  omit raw counts to keep
    # directory breakdown private. We only need the disabled flags +
    # the short protections blurbs for the UI tooltip.
    return {
        "pool_size": result["pool_size"],
        "min_required": result["min_required"],
        "disabled": result["disabled"],
        "warned": result["warned"],
        "protections": result["protections"],
        "warnings": result["warnings"],
    }


@router.get("/admin/hard-capacity", dependencies=[Depends(require_admin)])
async def admin_hard_capacity() -> dict[str, Any]:
    """Admin view  --  full capacity snapshot with raw counts per variant."""
    import hard_capacity
    return await hard_capacity.compute_capacity_cached(db)


@router.get("/admin/turnstile-settings", dependencies=[Depends(require_admin)])
async def admin_get_turnstile_settings() -> dict[str, Any]:
    doc = await db.app_config.find_one(
        {"key": "turnstile_settings"}, {"_id": 0, "disabled": 1, "disabled_at": 1, "disabled_reason": 1},
    )
    import turnstile_service
    return {
        "disabled": bool((doc or {}).get("disabled")),
        "disabled_at": (doc or {}).get("disabled_at"),
        "disabled_reason": (doc or {}).get("disabled_reason") or "",
        # Use the shared is_configured() so the admin panel and the
        # public /api/config/turnstile endpoint agree. The helper accepts
        # either TURNSTILE_SITE_KEY or REACT_APP_TURNSTILE_SITE_KEY.
        "configured": turnstile_service.is_configured(),
    }


@router.put("/admin/turnstile-settings", dependencies=[Depends(require_admin)])
async def admin_set_turnstile_settings(payload: dict) -> dict[str, Any]:
    """Flip the runtime disable toggle. `{disabled: true, reason?: str}`.
    When disabled, BOTH backend verification and the frontend widget
    short-circuit  --  so automated tests don't need a real Turnstile token."""
    disabled = bool(payload.get("disabled"))
    reason = (payload.get("reason") or "").strip()[:240]
    update = {"disabled": disabled}
    if disabled:
        update["disabled_at"] = datetime.now(timezone.utc).isoformat()
        update["disabled_reason"] = reason or "AI / E2E testing"
    else:
        update["disabled_at"] = None
        update["disabled_reason"] = ""
    await db.app_config.update_one(
        {"key": "turnstile_settings"},
        {"$set": update, "$setOnInsert": {"key": "turnstile_settings"}},
        upsert=True,
    )
    return {"ok": True, "disabled": disabled}


@router.get("/admin/matching/pipeline", dependencies=[Depends(require_admin)])
async def admin_matching_pipeline() -> dict[str, Any]:
    """Read-only description of the matching pipeline + current scoring
    weights. Source of truth for the Admin > Operations > Matching
    panel so the displayed weights always reflect what the engine is
    actually using right now (no double-bookkeeping)."""
    import matching as _m
    # Pull the LIVE admin-configurable defaults so the Step 4 numbers
    # match what's set in /admin/matching-defaults (Settings panel).
    # Falls back to the historical defaults when the admin hasn't
    # changed them.
    _mcfg = await db.app_config.find_one(
        {"key": "matching_defaults"}, {"_id": 0},
    ) or {}
    _threshold_pct = int(round(float(_mcfg.get("threshold") or DEFAULT_THRESHOLD)))
    _max_invites = int(_mcfg.get("max_invites") or 30)

    # Deep-research stats so the panel can confirm it's actually running.
    _re_cfg = await db.app_config.find_one(
        {"key": "research_enrichment"}, {"_id": 0, "enabled": 1},
    )
    _re_enabled = bool((_re_cfg or {}).get("enabled", True))  # default on
    _re_fresh_count = 0
    _re_active_count = 0
    try:
        from datetime import datetime, timedelta, timezone as _tz
        _re_active_count = await db.therapists.count_documents(
            {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}},
        )
        _fresh_cutoff = (
            datetime.now(_tz.utc) - timedelta(days=30)
        ).isoformat()
        _re_fresh_count = await db.therapists.count_documents({
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "research_enrichment.cached_at": {"$gte": _fresh_cutoff},
        })
    except Exception as e:
        logger.warning("matching pipeline: deep-research stats failed: %s", e)
    return {
        "summary": (
            "Patient request flows through hard filters first (must pass "
            "all to be considered), then each remaining therapist gets a "
            "weighted score across multiple soft axes, plus bonuses for "
            "deeper signals. The final score is mapped to a 0-97 display "
            "range; above the patient's threshold (default 70%) we send "
            "the top N as matches. Cap of 97 leaves headroom for future "
            "weight tuning without re-norming."
        ),
        "hard_filters": [
            {"name": "State license", "blocks_when": "Therapist not licensed in patient's state"},
            {"name": "Client type", "blocks_when": "Therapist doesn't see this patient's client type (individual / couples / family / group)"},
            {"name": "Age group", "blocks_when": "Therapist doesn't see this age group"},
            {"name": "Primary concern", "blocks_when": "Therapist's primary + secondary specialties don't cover the patient's #1 presenting issue"},
            {"name": "Format (in-person only)", "blocks_when": "Patient needs in-person and therapist is telehealth-only"},
            {"name": "Format (telehealth only)", "blocks_when": "Patient needs telehealth and therapist is in-person-only"},
            {"name": "Distance (in-person)", "blocks_when": "Patient needs in-person AND nearest therapist office is too far"},
            {"name": "Payment", "blocks_when": "Patient marked insurance_strict and therapist doesn't take their plan (no sliding-scale fallback)"},
            {"name": "Language (when strict)", "blocks_when": "Patient flipped language_strict and therapist doesn't speak the requested language"},
            {"name": "Gender (when required)", "blocks_when": "Patient flipped gender_required and therapist's gender doesn't match"},
            {"name": "Availability (when strict)", "blocks_when": "Patient flipped availability_strict and therapist offers none of the requested windows"},
            {"name": "Urgency (when strict)", "blocks_when": "Patient flipped urgency_strict and therapist's capacity can't meet the timeframe"},
            {"name": "Active + approved", "blocks_when": "Therapist account is inactive, pending approval, or has past_due/canceled subscription"},
        ],
        "scoring_axes": [
            {"name": "Expectation alignment", "max_points": _m.MAX_EXPECTATION_ALIGNMENT, "key": "expectation_alignment",
             "description": "Overlap between patient's session_expectations and therapist's t6 picks. THE #1 ranking signal. 'not_sure'/'depends' act as wildcards."},
            {"name": "Presenting issues", "max_points": _m.MAX_ISSUES, "key": "issues",
             "description": "Primary specialty match counts most; secondary specialties + general_treats add diminishing returns for #2 and #3 concerns."},
            {"name": "Therapist reliability", "max_points": _m.MAX_RELIABILITY, "key": "reliability",
             "description": "Weighted: response_rate 25%, expectation_accuracy 20%, retention_9w 20%, retention_15w 20%, selection_rate 15%. Defaults to 50% for therapists without enough history."},
            {"name": "Payment alignment", "max_points": _m.MAX_PAYMENT_ALIGNMENT, "key": "payment_alignment",
             "description": "Full points when therapist accepts patient's insurance; partial credit when there's a viable sliding-scale or cash fallback path; zero otherwise."},
            {"name": "Availability", "max_points": _m.MAX_AVAILABILITY, "key": "availability",
             "description": "Overlap between patient's preferred windows and therapist's offered windows. Flexible counts as a wildcard."},
            {"name": "Modality (format)", "max_points": _m.MAX_MODALITY, "key": "modality",
             "description": "How well the therapist's in-person / telehealth / hybrid offering matches the patient's preference (when not already enforced as hard)."},
            {"name": "Urgency", "max_points": _m.MAX_URGENCY, "key": "urgency",
             "description": "Therapist's urgency_capacity vs patient's urgency. Sooner-than-needed = full points; matching = full; slower = partial."},
            {"name": "Prior therapy", "max_points": _m.MAX_PRIOR, "key": "prior_therapy",
             "description": "Patient's prior-therapy history vs therapist's experience treating returning vs first-time patients."},
            {"name": "Experience level", "max_points": _m.MAX_EXPERIENCE, "key": "experience",
             "description": "Match between patient's preferred experience bucket (0-3 / 3-7 / 7-15 / 15+ years) and therapist's years_experience."},
            {"name": "Modality preference (CBT/DBT/etc.)", "max_points": _m.MAX_MODALITY_PREF, "key": "modality_pref",
             "description": "Bonus when patient's preferred therapy approaches overlap with therapist's modalities."},
            {"name": "Gender preference", "max_points": _m.MAX_GENDER, "key": "gender",
             "description": "Small bonus when therapist's gender matches the patient's preference (when not already a hard filter)."},
            {"name": "Payment fit (sliding scale)", "max_points": _m.MAX_PAYMENT_FIT, "key": "payment_fit",
             "description": "Bonus when patient marked sliding_scale_ok AND therapist offers sliding scale -- a small extra reward for flexibility."},
            {"name": "Style preference", "max_points": _m.MAX_STYLE, "key": "style",
             "description": "Bonus when patient's style preferences (e.g. 'warm-supportive', 'direct') overlap with therapist's style tags."},
        ],
        "bonuses": [
            {"name": "Research evidence (deep)", "max_points": 25,
             "description": "LLM-graded grade of therapist's public web footprint vs patient's primary concern. Adds up to +25 above the structured score. Requires deep research to be enabled."},
            {"name": "Deep-match (P1/P2/P3)", "max_points": 30,
             "description": "When patient opted into deep-match intake and answered P1 (relationship style), P2 (way of working), P3 (resonance), embeddings of these match against therapist T1/T3/T5. Adds up to +30."},
            {"name": "Prior-therapy resonance", "max_points": _m.MAX_PRIOR_THERAPY_BONUS,
             "description": "Embedding similarity between patient's prior-therapy notes and therapist's T5 lived-experience description."},
        ],
        "display_normalization": {
            "max_display_score": 97,
            "min_threshold_default_pct": _threshold_pct,
            "description": "Raw scores 0-130+ are mapped through a piecewise-linear curve to 0-97 so the top of the range stays differentiated as weights are tuned.",
        },
        "delivery": {
            "max_invites_default": _max_invites,
            "description": "Top N therapists above the patient's threshold get notified via email + SMS. Configurable per environment in app_config.matching_defaults.",
        },
        "patient_view_ranking": {
            "description": (
                "After matched therapists apply, the patient's results page "
                "re-ranks them using a second formula -- not just the Step 1 "
                "match score. This is what determines the ORDER patients see "
                "their matches in. Max raw 113 -> rescaled 0-99. Rebalanced "
                "2026-05-12: commit-confirmation bonus retired (was awarded to "
                "100% of applicants -- gating, not signal); apply-message-fit "
                "and message-quality bumped so a thoughtful, on-brief response "
                "moves rank meaningfully against a generic one."
            ),
            "components": [
                {"name": "Step-1 baseline", "max_points": 45,
                 "description": "The Step-1 match score scaled to 45% so apply-time signals can dominate ranking when an algorithmic match is close. Capped at 95% to avoid 'perfect on paper' impressions."},
                {"name": "Speed bonus", "max_points": 25,
                 "description": "Faster reply earns more points. Linear: full 25 if the therapist applies within the first hour after match release; 0 by 24h."},
                {"name": "Apply-message fit", "max_points": 25,
                 "description": "Claude grades the therapist's apply message 0-5 against the patient brief (presenting issues + style + prior therapy + free-text), then multiplied by 5. THE strongest patient-facing signal of a thoughtful response. Lives in research_enrichment.score_apply_fit; stored on the application doc as apply_fit."},
                {"name": "Message quality", "max_points": 18,
                 "description": "Structural quality of the apply message: length (max 9), names the presenting issue (4.5), action keyword like 'schedule/availability/consult' (3), uses first-person 'I/my' (1.5). No LLM cost."},
                {"name": "Commit bonus", "max_points": 0,
                 "description": "Retired as a scoring axis (was +3 each for 3 confirmations -- but the apply form gates submit on all three, so 100% of applicants earned the full 9 pts, no variance). The 3 confirmation checkboxes are still REQUIRED to apply; they just no longer affect ranking."},
            ],
        },
        "deep_research": {
            "enabled": _re_enabled,
            "auto_on_signup": True,
            "auto_on_signup_description": (
                "Deep research runs automatically in the background for "
                "every new therapist signup -- so by the time admin reviews "
                "the application, evidence-graded specialty themes + public "
                "footprint are already cached on the therapist doc. The "
                "'Deep research' button in the directory is for re-running "
                "it manually (e.g. after a therapist updates their website)."
            ),
            "cache_ttl_days": 30,
            "fresh_cached_count": _re_fresh_count,
            "active_therapists": _re_active_count,
            "coverage_pct": (
                round((_re_fresh_count / _re_active_count) * 100)
                if _re_active_count else 0
            ),
            "feeds_into": [
                "Research bonus axis (+25 max) on the structured match score",
                "approach_alignment score (used in deep-match if patient opted in)",
                "evidence_depth signal shown in the admin therapist detail view",
            ],
            "enabled_via_setting": "Settings > LLM web-research enrichment",
        },
    }


@router.get("/admin/master-testing-mode", dependencies=[Depends(require_admin)])
async def admin_get_master_testing_mode() -> dict[str, Any]:
    """Current state of the master testing-mode toggle. See testing_mode.py
    for what it bypasses + safety semantics."""
    import testing_mode
    return await testing_mode.status()


@router.put("/admin/master-testing-mode", dependencies=[Depends(require_admin)])
async def admin_set_master_testing_mode(payload: dict) -> dict[str, Any]:
    """Flip the master testing-mode toggle. Payload:
        {"enabled": true, "hours": 1, "reason": "playwright e2e"}
    or {"enabled": false} to turn off immediately.

    `hours` is server-clamped to the configured maximum so an admin
    can't leave testing mode on indefinitely by setting a huge number.
    """
    import testing_mode
    enabled = bool(payload.get("enabled"))
    reason = (payload.get("reason") or "").strip()[:240]
    if not enabled:
        await db.app_config.update_one(
            {"key": "master_testing_mode"},
            {"$set": {
                "enabled": False,
                "enabled_until": None,
                "disabled_at": _now_iso(),
            },
             "$setOnInsert": {"key": "master_testing_mode"}},
            upsert=True,
        )
        return await testing_mode.status()
    # Enabling -- clamp the window
    try:
        hours = float(payload.get("hours") or 1)
    except (TypeError, ValueError):
        hours = 1.0
    hours = max(0.1, min(hours, float(testing_mode.MASTER_TESTING_MAX_HOURS)))
    until = datetime.now(timezone.utc) + timedelta(hours=hours)
    await db.app_config.update_one(
        {"key": "master_testing_mode"},
        {"$set": {
            "enabled": True,
            "enabled_until": until.isoformat(),
            "enabled_at": _now_iso(),
            "enabled_by": "admin",
            "enabled_reason": reason or "manual",
        },
         "$setOnInsert": {"key": "master_testing_mode"}},
        upsert=True,
    )
    logger.warning(
        "Master testing mode ENABLED until %s -- reason=%s",
        until.isoformat(), reason or "(none)",
    )
    return await testing_mode.status()


# --- Outreach opt-out  --  public, no auth ---------------------------------
def _render_opt_out_page(*, success: bool, email: str | None, phone: str | None,
                        already: bool = False) -> str:
    """Tiny self-contained HTML confirmation page. No React dependency  --  this
    link is clicked by people who aren't users yet, and we want the response
    to be instant + robust."""
    headline = "You're unsubscribed" if success else "We couldn't process that link"
    sub = (
        "You won't receive any further outreach emails or texts from TheraVoca."
        if success
        else "The link may be invalid or expired. If you believe this is a mistake, "
             "reply to the original email and we'll remove you manually."
    )
    contact_line = ""
    if success and (email or phone):
        who = email or phone
        contact_line = (
            f'<p style="color:#6D6A65;font-size:13px;margin:12px 0 0;">We have removed '
            f'<strong style="color:#2B2A29;">{who}</strong> from our recruitment list.</p>'
        )
    already_line = (
        '<p style="color:#6D6A65;font-size:13px;margin:10px 0 0;">'
        '(You were already opted out  --  no action needed.)</p>'
        if already else ""
    )
    return f"""<!doctype html>
<html><head>
<meta charset="utf-8">
<title>TheraVoca  --  {headline}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body {{ margin:0; padding:48px 20px; background:#FDFBF7; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif; color:#2B2A29; }}
  .card {{ max-width:520px; margin:0 auto; background:#fff; border:1px solid #E8E5DF; border-radius:16px; padding:40px 32px; text-align:center; }}
  h1 {{ font-family:Georgia,serif; font-size:26px; color:#2D4A3E; margin:0 0 12px; }}
  p {{ color:#2B2A29; font-size:15px; line-height:1.6; margin:0 0 8px; }}
  .brand {{ font-family:Georgia,serif; color:#2D4A3E; font-size:18px; letter-spacing:-0.5px; margin-bottom:24px; }}
</style>
</head>
<body>
<div class="card">
  <div class="brand">TheraVoca</div>
  <h1>{headline}</h1>
  <p>{sub}</p>
  {contact_line}
  {already_line}
</div>
</body>
</html>"""


@public_router.get("/outreach/opt-out/{invite_id}")
async def outreach_opt_out(invite_id: str, reason: str | None = None):
    """One-click opt-out link embedded in every outreach email & SMS. No auth,
    no CSRF  --  the invite_id (UUID4) is the unguessable token."""
    from fastapi.responses import HTMLResponse
    from outreach_optout import record_opt_out, is_opted_out

    invite = await db.outreach_invites.find_one({"id": invite_id}, {"_id": 0})
    if not invite:
        return HTMLResponse(
            _render_opt_out_page(success=False, email=None, phone=None),
            status_code=404,
        )
    cand = invite.get("candidate") or {}
    email = cand.get("email") or ""
    phone = cand.get("phone") or ""

    already = await is_opted_out(email=email, phone=phone)
    await record_opt_out(
        email=email, phone=phone, reason=reason,
        source="outreach_email_link",
        invite_id=invite_id,
        request_id=invite.get("request_id"),
    )
    # Also flag the invite row itself so analytics can see which invites
    # resulted in opt-outs.
    await db.outreach_invites.update_one(
        {"id": invite_id},
        {"$set": {"opted_out_at": _now_iso(), "opt_out_reason": reason}},
    )
    return HTMLResponse(
        _render_opt_out_page(
            success=True, email=email, phone=phone, already=already,
        ),
    )


@router.post("/admin/requests/{request_id}/run-outreach")
async def admin_run_outreach_now(
    request_id: str, request: Request, _: bool = Depends(require_admin),
):
    """Manually re-run the LLM outreach for a request whose initial run was
    skipped or failed. Clears the `outreach_run_at` flag first so the agent
    will actually execute regardless of prior state."""
    audit.emit(
        actor_type="admin", actor_id="admin", action="run_outreach",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    if not req:
        raise HTTPException(404, "Request not found")
    await db.requests.update_one(
        {"id": request_id},
        {"$unset": {"outreach_run_at": "", "outreach_skipped_reason": ""}},
    )
    from outreach_agent import run_outreach_for_request
    return await run_outreach_for_request(request_id)


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

    # Demand priors  --  weighted by what a typical Idaho mental-health intake
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
        "child": 8,         # historically thinnest  --  bump target so we recruit more
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

    # -- Per-dimension counts --
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

    # -- Build recommendations --
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
                    f"`{slug.replace('_', ' ')}`  --  patient demand is {demand}."
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
                    f"{m}  --  common patient request."
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
                    f"`{ag}`  --  age group is a HARD filter in matching, "
                    "patients in this bucket will see weak or zero matches."
                ),
            })
    for ct in CLIENT_TYPES:
        have = client_counts.get(ct, 0)
        # Targets reflect the patient demand we observe in the request
        # stream. Family + group sessions are HARD-filter axes; if a
        # patient ticks "couples / family / group only" and we have a
        # thin pool there, we under-deliver. Bumped above the seeded
        # MVP defaults so auto-recruit prioritises these axes.
        target = {
            "individual": 8,
            "couples": 8,
            "family": 35,
            "group": 20,
        }.get(ct, 4)
        if have < target:
            gaps.append({
                "dimension": "client_type",
                "key": ct,
                "have": have,
                "target": target,
                "severity": "critical" if have == 0 or have < target / 2 else "warning",
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
                "2-3-week capacity. Patients marking `urgency=asap` will see "
                "weak matches  --  prioritize confirming availability with your "
                "current network."
            ),
        })

    # Geographic coverage  --  per-city in-person targets outside Boise.
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
                "We tell patients we have flexible-fee options  --  verify."
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
    converted = sum(1 for d in docs if d.get("converted_therapist_id"))
    return {
        "drafts": docs,
        "total": len(docs),
        "sent": sent,
        "pending": pending,
        "dry_run_count": dry,
        "converted": converted,
    }


@router.get("/admin/referral-analytics")
async def admin_referral_analytics(request: Request, _: bool = Depends(require_admin)):
    """Referral analytics:
    - patient `referred_by_patient_code` chains
    - therapist `referred_by_code` chains
    - gap-recruit conversion rate
    - referral_source breakdown from intake form
    """
    audit.emit(
        actor_type="admin", actor_id="admin", action="view_referral_analytics",
        resource="request", detail="projection=email,referral_code,created_at",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    from collections import Counter

    # Patient -> patient referrals
    patient_chains: Counter = Counter()
    patient_codes_seen: dict[str, dict] = {}
    async for r in db.requests.find(
        {}, {"_id": 0, "patient_referral_code": 1,
             "referred_by_patient_code": 1, "email": 1, "created_at": 1},
    ):
        if r.get("patient_referral_code"):
            patient_codes_seen[r["patient_referral_code"]] = {
                "email": r.get("email"),
                "code": r["patient_referral_code"],
                "created_at": r.get("created_at"),
            }
        if r.get("referred_by_patient_code"):
            patient_chains[r["referred_by_patient_code"]] += 1

    top_patient_referrers = []
    for code, n in patient_chains.most_common(20):
        meta = patient_codes_seen.get(code) or {}
        top_patient_referrers.append({
            "code": code,
            "inviter_email": meta.get("email") or "—",
            "invited_count": n,
        })

    # Therapist refer-a-colleague chains
    therapist_chains: Counter = Counter()
    therapist_codes: dict[str, dict] = {}
    async for t in db.therapists.find(
        {}, {"_id": 0, "referral_code": 1, "referred_by_code": 1,
             "name": 1, "email": 1},
    ):
        if t.get("referral_code"):
            therapist_codes[t["referral_code"]] = {
                "name": t.get("name"), "email": t.get("email"),
                "code": t["referral_code"],
            }
        if t.get("referred_by_code"):
            therapist_chains[t["referred_by_code"]] += 1

    top_therapist_referrers = []
    for code, n in therapist_chains.most_common(20):
        meta = therapist_codes.get(code) or {}
        top_therapist_referrers.append({
            "code": code,
            "inviter_name": meta.get("name") or "—",
            "inviter_email": meta.get("email") or "—",
            "invited_count": n,
        })

    # Referral source breakdown from intake form
    src_counts: Counter = Counter()
    async for r in db.requests.find({}, {"_id": 0, "referral_source": 1}):
        src = (r.get("referral_source") or "").strip() or "(unspecified)"
        src_counts[src] += 1

    # Gap-recruit conversion
    drafts_total = await db.recruit_drafts.count_documents({})
    drafts_sent = await db.recruit_drafts.count_documents({"sent": True})
    drafts_converted = await db.recruit_drafts.count_documents(
        {"converted_therapist_id": {"$exists": True, "$ne": None}},
    )

    return {
        "patient_referrals": {
            "total_invited": sum(patient_chains.values()),
            "unique_referrers": len(patient_chains),
            "top": top_patient_referrers,
        },
        "therapist_referrals": {
            "total_invited": sum(therapist_chains.values()),
            "unique_referrers": len(therapist_chains),
            "top": top_therapist_referrers,
        },
        "referral_sources": dict(src_counts.most_common()),
        "gap_recruit": {
            "total_drafts": drafts_total,
            "sent": drafts_sent,
            "converted": drafts_converted,
            "conversion_rate": (
                round(drafts_converted / drafts_sent * 100, 1)
                if drafts_sent else 0.0
            ),
        },
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


@router.post("/admin/gap-recruit/send-preview")
async def admin_send_gap_preview(
    payload: dict | None = None, _: bool = Depends(require_admin),
):
    """Send a small sample of pre-launch DRY-RUN drafts via Resend so the
    admin can see what the actual recruit email looks like in their inbox.

    Sends ALWAYS to the draft's fake `therapymatch+recruitNNN@gmail.com`
    address  --  the user controls `therapymatch@gmail.com`, so the email lands
    in their own inbox via Gmail's plus-aliasing trick.

    Body: `{"limit": 3, "draft_ids": [...]}`. If `draft_ids` is empty, picks
    one draft per gap dimension up to `limit`."""
    from gap_recruiter import send_draft_preview
    body = payload or {}
    limit = max(1, min(int(body.get("limit") or 3), 10))
    return await send_draft_preview(
        limit=limit, ids=body.get("draft_ids") or [],
    )


@router.post("/admin/seed/reset")
async def admin_seed_reset(_: bool = Depends(require_admin)):
    """DESTRUCTIVE  --  clears requests/applications/declines/therapists/magic_codes
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


# ----------------------------------------------------------------------
# Matching-Outcome Simulator (admin-only)
# ----------------------------------------------------------------------
# Routes delegate to `backend/simulator.py`  --  this keeps admin.py from
# growing further while giving ops a single surface to kick off a run,
# list prior runs, fetch a specific report, and clean up synthetic
# data. See simulator.py for the algorithmic detail + rationale.


@router.post("/admin/simulator/run")
async def simulator_run(
    payload: dict,
    _: None = Depends(require_admin),
):
    """Kick off a simulator run synchronously. A 50-request run
    against a ~120-therapist pool completes in ~1-2 seconds because
    all scoring is pure Python (no network / LLM calls)."""
    import simulator
    num_requests = int(payload.get("num_requests") or 50)
    notify_top_n = int(payload.get("notify_top_n") or 30)
    min_applications = int(payload.get("min_applications") or 5)
    max_applications = int(payload.get("max_applications") or 12)
    random_seed = payload.get("random_seed")
    if not (10 <= num_requests <= 200):
        raise HTTPException(400, "num_requests must be between 10 and 200.")
    try:
        report = await simulator.run_simulation(
            db,
            num_requests=num_requests,
            notify_top_n=notify_top_n,
            min_applications=min_applications,
            max_applications=max_applications,
            random_seed=random_seed,
        )
        return report
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        logger.error("Simulator crash: %s\n%s", exc, tb)
        raise HTTPException(500, detail=f"Simulator error: {exc}\n{tb}")


@router.get("/admin/simulator/runs")
async def simulator_list_runs(
    _: None = Depends(require_admin),
    limit: int = 30,
):
    """List recent simulator runs  --  lightweight summary only."""
    import simulator
    return {"items": await simulator.list_runs(db, limit=limit)}


@router.get("/admin/simulator/runs/{run_id}")
async def simulator_get_run(
    run_id: str,
    _: None = Depends(require_admin),
):
    """Fetch the full report (with per-request detail) for one run."""
    import simulator
    doc = await simulator.load_run(db, run_id)
    if not doc:
        raise HTTPException(404, "Run not found")
    return doc


@router.delete("/admin/simulator/runs/{run_id}")
async def simulator_delete_run(
    run_id: str,
    _: None = Depends(require_admin),
):
    """Delete one run + all its synthetic requests."""
    import simulator
    deleted = await simulator.delete_run(db, run_id)
    return {"ok": True, "deleted": deleted}



#  Feedback testing toggle 

@router.get("/admin/feedback-testing", dependencies=[Depends(require_admin)])
async def admin_get_feedback_testing() -> dict[str, Any]:
    doc = await db.app_config.find_one({"key": "feedback_testing"}, {"_id": 0})
    return {"enabled": bool((doc or {}).get("enabled", False))}

@router.put("/admin/feedback-testing", dependencies=[Depends(require_admin)])
async def admin_set_feedback_testing(payload: dict) -> dict[str, Any]:
    enabled = bool(payload.get("enabled", False))
    await db.app_config.update_one(
        {"key": "feedback_testing"},
        {"$set": {"key": "feedback_testing", "enabled": enabled}},
        upsert=True,
    )
    return {"enabled": enabled}

@router.post("/admin/feedback-testing/trigger", dependencies=[Depends(require_admin)])
async def admin_trigger_test_feedback(payload: dict) -> dict[str, Any]:
    """Manually trigger a specific milestone email for a request."""
    from email_service import (
        send_patient_survey_v2_48h, send_patient_survey_v2_3w,
        send_patient_survey_v2_9w, send_patient_survey_v2_15w,
    )
    request_id = payload.get("request_id")
    milestone = payload.get("milestone")
    if not request_id or not milestone:
        raise HTTPException(400, "request_id and milestone required")
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "email": 1, "id": 1},
    )
    if not req or not req.get("email"):
        raise HTTPException(404, "Request not found or missing email")
    senders = {
        "48h": send_patient_survey_v2_48h,
        "3w": send_patient_survey_v2_3w,
        "9w": send_patient_survey_v2_9w,
        "15w": send_patient_survey_v2_15w,
    }
    sender = senders.get(milestone)
    if not sender:
        raise HTTPException(400, f"Invalid milestone: {milestone}")
    await sender(req["email"], req["id"])
    return {"ok": True, "milestone": milestone, "request_id": request_id}

# ----------------------------------------------------------------------
# Auto-recruit  --  closed-loop recruiter (Simulator + Coverage Gaps +
# Gap Recruiter). Pre-launch: dry-run + admin-approval-gated. See
# backend/auto_recruit.py for the orchestration logic.
# ----------------------------------------------------------------------


@router.get("/admin/auto-recruit/status")
async def auto_recruit_status(_: None = Depends(require_admin)):
    """Returns current policy, last cycle, and pending-approval count.
    Used by the admin panel header to render the live status card."""
    import auto_recruit
    cfg = await auto_recruit.get_config(db)
    last_id = cfg.get("last_cycle_id")
    last_cycle = None
    if last_id:
        last_cycle = await db.auto_recruit_cycles.find_one(
            {"id": last_id}, {"_id": 0},
        )
    pending = await auto_recruit.count_pending_approval(db)
    return {
        "config": cfg,
        "last_cycle": last_cycle,
        "pending_approval_count": pending,
    }


@router.put("/admin/auto-recruit/config")
async def auto_recruit_update_config(
    payload: dict, _: None = Depends(require_admin),
):
    """Merge-patch the singleton config. Only known keys are accepted."""
    import auto_recruit
    cfg = await auto_recruit.update_config(db, payload)
    return {"ok": True, "config": cfg}


@router.post("/admin/auto-recruit/plan")
async def auto_recruit_plan(_: None = Depends(require_admin)):
    """Preview the plan WITHOUT creating drafts  --  runs a fresh simulator
    + coverage-gap analysis and returns the would-be recruit targets."""
    import auto_recruit
    return await auto_recruit.compute_plan_preview(db)


@router.post("/admin/auto-recruit/run")
async def auto_recruit_run(_: None = Depends(require_admin)):
    """Execute one full cycle  --  runs sim, builds plan, calls gap
    recruiter, stamps new drafts with cycle id + needs_approval=True.
    Never sends real email (dry_run enforced by config)."""
    import auto_recruit
    cycle = await auto_recruit.run_cycle(db, manual_trigger=True)
    return cycle


@router.get("/admin/auto-recruit/cycles")
async def auto_recruit_list_cycles(
    _: None = Depends(require_admin), limit: int = 30,
):
    """Recent cycles history (lightweight  --  omits per-draft detail)."""
    import auto_recruit
    return {"items": await auto_recruit.list_cycles(db, limit=limit)}


@router.post("/admin/auto-recruit/approve")
async def auto_recruit_approve(
    payload: dict, _: None = Depends(require_admin),
):
    """Clear `needs_approval` on a batch of drafts. Accepts either
    `{cycle_id}` to approve an entire cycle's drafts, or `{draft_ids: [...]}`
    for a targeted approval. Returns count approved."""
    import auto_recruit
    cycle_id = payload.get("cycle_id")
    draft_ids = payload.get("draft_ids") or None
    if not cycle_id and not draft_ids:
        raise HTTPException(400, "cycle_id or draft_ids required")
    approved = await auto_recruit.approve_batch(
        db, cycle_id=cycle_id, draft_ids=draft_ids,
    )
    return {"ok": True, "approved": approved}


# -- Scraper Test ------------------------------------------------------------

# -- Scraper background job system ----------------------------------

async def _run_scraper_job(job_id: str, city: str, state: str, issues: list, count: int):
    """Background task: parallel multi-source fan-out + full-set enrichment.

    Mirrors the live outreach pipeline (outreach_agent._find_candidates)
    so the admin live-test surfaces what real outreach would actually
    produce. Quantity-first: every source runs in parallel and
    oversamples (count*3); enrichment runs on the full merged set."""
    from pt_scraper import scrape_pt_candidates
    from directory_scrapers import scrape_all_backup_sources
    from contact_enricher import enrich_one
    import httpx
    import asyncio as _asyncio

    sources_summary: dict[str, int] = {}
    errors: list[str] = []

    # ── Fan out every source in parallel ──────────────────────────────
    async def _safe_pt():
        try:
            pt = await scrape_pt_candidates(
                state_code=state, city=city, needed=count * 3, max_pages=10,
            )
            for c in pt:
                c["source"] = c.get("source", "psychology_today")
            return pt
        except Exception as e:
            errors.append(f"PT scraper: {e}")
            return []

    async def _safe_backup():
        try:
            return await scrape_all_backup_sources(
                state_code=state, city=city, needed=count * 3,
                presenting_issues=issues if issues else None,
            )
        except Exception as e:
            errors.append(f"Backup scrapers: {e}")
            return []

    pt_res, backup_res = await _asyncio.gather(_safe_pt(), _safe_backup())
    sources_summary["psychology_today"] = len(pt_res)
    for src in ("therapyden", "goodtherapy", "google_maps"):
        sources_summary[src] = sum(1 for c in backup_res if c.get("source") == src)

    # Merge + dedup by name+city
    seen = set()
    unique: list[dict] = []
    for source_results in (backup_res, pt_res):  # backup first -- richer contact data
        for c in source_results:
            key = f"{(c.get('name') or '').lower().strip()}|{(c.get('city') or '').lower().strip()}"
            if key in seen or key == "|":
                continue
            seen.add(key)
            unique.append(c)
    candidates = unique  # No `[:count]` truncation -- enrich everything

    # Save Phase 1 results
    await db.scraper_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "phase": "enriching",
            "total": len(candidates),
            "sources": sources_summary,
            "errors": errors,
            "candidates": candidates,
            "enriched_count": 0,
        }},
    )

    # Phase 2: Enrich with Google Places API + website fallback.
    # Pre-clear backup scrapers' info@<domain> guesses so the enricher's
    # 'skip if email already set' guard doesn't block real-email
    # extraction from the actual website.
    for c in candidates:
        if (c.get("email") or "").startswith("info@"):
            c.pop("email", None)

    import asyncio
    enriched = 0
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for i, c in enumerate(candidates):
            if c.get("name"):  # enrich all candidates (Places API + website fallback)
                try:
                    await enrich_one(c, client)
                    enriched += 1
                except Exception:
                    pass
                # Update progress every candidate
                await db.scraper_jobs.update_one(
                    {"id": job_id},
                    {"$set": {
                        "candidates": candidates,
                        "enriched_count": enriched,
                    }},
                )
                await asyncio.sleep(0.4)

    # Sort by completeness -- real email > phone > website > license/specialty
    def _completeness(c):
        s = 0
        email = (c.get("email") or "")
        if email and not email.startswith("info@") and "@" in email:
            s += 100
        if c.get("phone"): s += 30
        if c.get("website"): s += 10
        if c.get("license_types") or c.get("primary_license"): s += 5
        if c.get("specialties"): s += 3
        return s
    candidates.sort(key=_completeness, reverse=True)

    sendable = sum(1 for c in candidates if c.get("email") or c.get("phone"))
    await db.scraper_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "phase": "complete",
            "candidates": candidates,
            "enriched_count": enriched,
            "sendable_count": sendable,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


@router.post("/admin/scraper-test", dependencies=[Depends(require_admin)])
async def scraper_test(payload: dict):
    """Start a background scraper job. Returns job_id for polling."""
    import asyncio
    city = (payload.get("city") or "").strip()
    state = (payload.get("state") or "ID").upper()[:2]
    issues = payload.get("presenting_issues") or []
    count = min(int(payload.get("count") or 50), 100)
    if not city:
        raise HTTPException(400, "city is required")

    job_id = str(_uuid.uuid4())
    await db.scraper_jobs.insert_one({
        "id": job_id,
        "city": city,
        "state": state,
        "presenting_issues": issues,
        "count": count,
        "phase": "scraping",
        "total": 0,
        "sources": {},
        "errors": [],
        "candidates": [],
        "enriched_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
    })

    # Fire and forget â runs in background
    asyncio.create_task(_run_scraper_job(job_id, city, state, issues, count))

    return {"ok": True, "job_id": job_id}


@router.get("/admin/scraper-jobs/{job_id}", dependencies=[Depends(require_admin)])
async def get_scraper_job(job_id: str):
    """Poll a scraper job for status and results."""
    job = await db.scraper_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/admin/places-test", dependencies=[Depends(require_admin)])
async def places_test(payload: dict | None = None):
    """Diagnostic ping of Google Places API (New).

    Hits Places Text Search + Place Details for a single known
    therapist (defaults to a real Boise name from PT) and returns the
    EXACT response, including HTTP status codes and error text from
    GCP. Use this to debug 'why are emails/phones blank in the live
    test' -- almost always it's a GCP-side config issue (API not
    enabled, billing off, key restricted).
    """
    import httpx
    import os as _os
    payload = payload or {}
    name = (payload.get("name") or "Sunny Rourke").strip()
    city = (payload.get("city") or "Boise").strip()
    state = (payload.get("state") or "ID").strip()
    api_key = _os.environ.get("GOOGLE_PLACES_API_KEY", "")
    result: dict[str, Any] = {
        "env_var_set": bool(api_key),
        "env_var_length": len(api_key) if api_key else 0,
        "query": f"{name} therapist {city}, {state}",
        "search": None,
        "details": None,
        "diagnosis": None,
    }
    if not api_key:
        result["diagnosis"] = (
            "GOOGLE_PLACES_API_KEY env var is not set on this service. "
            "Add it in Render -> Environment, then redeploy."
        )
        return result

    base_url = "https://places.googleapis.com/v1"
    # Step 1: Text Search
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            search_resp = await client.post(
                f"{base_url}/places:searchText",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": (
                        "places.id,places.displayName,places.formattedAddress,"
                        "places.types,places.websiteUri,places.internationalPhoneNumber"
                    ),
                },
                json={"textQuery": result["query"], "maxResultCount": 3},
            )
        except Exception as e:
            result["search"] = {"error": f"network: {e}"}
            result["diagnosis"] = "Network error reaching Places API. Check Render egress."
            return result
        search_body = {}
        try:
            search_body = search_resp.json()
        except Exception:
            search_body = {"raw": search_resp.text[:500]}
        result["search"] = {
            "status_code": search_resp.status_code,
            "body": search_body,
        }
        if search_resp.status_code != 200:
            err = (search_body.get("error") or {}) if isinstance(search_body, dict) else {}
            status = err.get("status") or ""
            message = err.get("message") or ""
            if search_resp.status_code == 403 and "PERMISSION_DENIED" in str(status):
                result["diagnosis"] = (
                    "GCP returned 403 PERMISSION_DENIED. Most likely causes:\n"
                    "  1. 'Places API (New)' is not enabled in your GCP project. "
                    "Enable it at https://console.cloud.google.com/apis/library/places.googleapis.com\n"
                    "  2. The API key has an HTTP-referrer or IP restriction that "
                    "blocks server-side calls. Remove the restriction or whitelist "
                    "Render egress IPs.\n"
                    "  3. Billing is not enabled on the GCP project (Places API "
                    "requires billing even though the first $200/month is free)."
                )
            elif search_resp.status_code == 400 and "API_KEY_INVALID" in str(message).upper():
                result["diagnosis"] = (
                    "GCP returned API_KEY_INVALID. The key value in "
                    "GOOGLE_PLACES_API_KEY is malformed or expired. Generate a "
                    "fresh key in GCP Console -> Credentials and update the env."
                )
            else:
                result["diagnosis"] = (
                    f"Places search failed (HTTP {search_resp.status_code}). "
                    f"Error: {message or status or 'unknown'}. "
                    "Check the full body above for the exact GCP error."
                )
            return result

        places = search_body.get("places") or []
        if not places:
            result["diagnosis"] = (
                "Places search returned HTTP 200 but zero matches for this "
                "name. The API key WORKS. Try a different name to confirm, "
                "or this specific therapist may not have a Google Business "
                "Profile (in which case SMS fallback won't be available "
                "for them either)."
            )
            return result

        top = places[0]
        result["details"] = {
            "place_id": top.get("id"),
            "display_name": (top.get("displayName") or {}).get("text"),
            "formatted_address": top.get("formattedAddress"),
            "website_uri": top.get("websiteUri") or "",
            "phone": top.get("internationalPhoneNumber") or "",
        }
        has_phone = bool(top.get("internationalPhoneNumber"))
        has_website = bool(top.get("websiteUri"))
        if has_phone and has_website:
            result["diagnosis"] = (
                "Places API is working end-to-end. Got real phone + website. "
                "Outreach pipeline should be producing real contacts for "
                "this profile. If the live test is still showing blanks, "
                "check Render logs for contact_enricher warnings."
            )
        elif has_website and not has_phone:
            result["diagnosis"] = (
                "API works; this place has a website but no phone listed "
                "in Google. Website scrape will still find email if exposed."
            )
        elif has_phone and not has_website:
            result["diagnosis"] = (
                "API works; this place has a phone but no website. "
                "SMS fallback will work for outreach to this person."
            )
        else:
            result["diagnosis"] = (
                "API works; this place has neither phone nor website in "
                "Google. Candidate would be dropped at send-time."
            )
        return result


@router.post("/admin/twilio-test", dependencies=[Depends(require_admin)])
async def twilio_test(payload: dict | None = None) -> dict[str, Any]:
    """Diagnostic for Twilio SMS configuration. Does NOT send a real SMS.

    Checks every required env var, tries to authenticate against the
    Twilio REST API by fetching the account record (zero-cost, no SMS),
    and returns plain-English diagnosis of what's wrong if anything.

    This is the 'is SMS even possible right now' answer. The existing
    /admin/test-sms endpoint actually sends a message to a phone --
    use this first to make sure config is right.
    """
    import os as _os
    payload = payload or {}
    sid = _os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = _os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    from_number = (
        _os.environ.get("TWILIO_FROM_NUMBER", "").strip()
        or _os.environ.get("TWILIO_PHONE_NUMBER", "").strip()
    )
    enabled_raw = _os.environ.get("TWILIO_ENABLED", "false").strip().lower()
    enabled = enabled_raw == "true"
    override_to = _os.environ.get("TWILIO_DEV_OVERRIDE_TO", "").strip()

    result: dict[str, Any] = {
        "env": {
            "TWILIO_ENABLED": enabled_raw or "(unset)",
            "TWILIO_ACCOUNT_SID": bool(sid),
            "TWILIO_ACCOUNT_SID_starts_with": sid[:6] + "..." if sid else "(unset)",
            "TWILIO_AUTH_TOKEN": bool(token),
            "TWILIO_AUTH_TOKEN_length": len(token) if token else 0,
            "TWILIO_FROM_NUMBER": from_number or "(unset)",
            "TWILIO_DEV_OVERRIDE_TO": override_to or "(none -- prod mode)",
        },
        "enabled": enabled,
        "api_check": None,
        "diagnosis": None,
    }

    # Env var presence checks
    missing = []
    if not sid:
        missing.append("TWILIO_ACCOUNT_SID")
    if not token:
        missing.append("TWILIO_AUTH_TOKEN")
    if not from_number:
        missing.append("TWILIO_FROM_NUMBER")
    if missing:
        result["diagnosis"] = (
            f"Missing required env var(s): {', '.join(missing)}. "
            "Add them in Render -> Environment for the service, then "
            "redeploy. SMS outreach will silently no-op until all three "
            "are set."
        )
        return result
    if not enabled:
        result["diagnosis"] = (
            "All env vars present but TWILIO_ENABLED is not 'true'. "
            "Set TWILIO_ENABLED=true (case-sensitive value) in Render env "
            "to flip SMS on. Until then, every send_sms() call short-circuits."
        )
        # Still try the API check below to verify creds work
    # Live API check: fetch the account record (no SMS sent, no cost)
    try:
        from twilio.rest import Client
        import asyncio as _asyncio
        client = Client(sid, token)
        def _fetch_account():
            return client.api.accounts(sid).fetch()
        account = await _asyncio.to_thread(_fetch_account)
        result["api_check"] = {
            "ok": True,
            "account_friendly_name": account.friendly_name,
            "account_status": account.status,
            "account_type": account.type,
        }
        if account.type and account.type.lower() == "trial":
            result["diagnosis"] = (
                (result["diagnosis"] or "") +
                (" Note: this is a Twilio TRIAL account. Trial mode can "
                 "only send to numbers you've manually verified in the "
                 "Twilio console. Set TWILIO_DEV_OVERRIDE_TO to one of "
                 "your verified numbers so test SMS reroutes there, or "
                 "upgrade to a paid Twilio account for real outreach.")
            ).strip()
        elif enabled and not result["diagnosis"]:
            result["diagnosis"] = (
                "Twilio is fully configured and live. SMS outreach will "
                "send to real phone numbers from " + from_number + ". "
                "Use /admin/test-sms to send a test message to a real "
                "phone."
            )
        elif not enabled and not result["diagnosis"]:
            result["diagnosis"] = (
                "Credentials work but TWILIO_ENABLED is not 'true' -- "
                "see above."
            )
    except Exception as e:
        msg = str(e)
        result["api_check"] = {"ok": False, "error": msg}
        if "401" in msg or "Authenticat" in msg:
            result["diagnosis"] = (
                "Twilio rejected the credentials (401). The SID or token "
                "is wrong, or the auth token has been rotated. Generate "
                "a fresh auth token in the Twilio Console and update "
                "TWILIO_AUTH_TOKEN in Render."
            )
        else:
            result["diagnosis"] = (
                f"Couldn't reach Twilio API: {msg}. Check Render egress "
                "and verify the SID format (should start with AC...)."
            )
    return result


@router.get("/admin/scraper-jobs", dependencies=[Depends(require_admin)])
async def list_scraper_jobs():
    """List recent scraper jobs."""
    cursor = db.scraper_jobs.find({}, {"_id": 0}).sort("created_at", -1).limit(10)
    jobs = []
    async for j in cursor:
        # Return summary without full candidates list for the list view
        jobs.append({
            "id": j["id"],
            "city": j.get("city"),
            "state": j.get("state"),
            "phase": j.get("phase"),
            "total": j.get("total", 0),
            "enriched_count": j.get("enriched_count", 0),
            "sources": j.get("sources", {}),
            "created_at": j.get("created_at"),
            "completed_at": j.get("completed_at"),
        })
    return {"jobs": jobs}


# ── Provider directory import (real data over backfill placeholders) ──────

@router.post("/admin/run-provider-import", dependencies=[Depends(require_admin)])
async def run_provider_import(payload: dict):
    """Run the provider directory xlsx import inline.

    Body: {"dry_run": true|false, "limit": int|null}
    Returns: {"ok": bool, "output": str, "error": str|null}
    """
    import asyncio
    import io
    import sys
    import traceback
    from pathlib import Path

    dry_run = payload.get("dry_run", True)
    limit = payload.get("limit")

    # Locate the xlsx -- check a few known paths
    candidates = [
        Path(__file__).resolve().parents[1] / "imports" / "providers_2025_09.xlsx",
        Path(__file__).resolve().parents[2] / "imports" / "Copy of TheraVoca Idaho Provider Directory (Responses) (1).xlsx",
    ]
    xlsx_path = None
    for c in candidates:
        if c.exists():
            xlsx_path = c
            break
    if not xlsx_path:
        raise HTTPException(404, f"xlsx not found at any of: {[str(c) for c in candidates]}")

    # Capture stdout
    buf = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = buf
    sys.stderr = buf

    try:
        # Build fake args
        class Args:
            pass
        args = Args()
        args.xlsx = str(xlsx_path)
        args.dry_run = dry_run
        args.apply = not dry_run
        args.limit = limit if limit else 3
        args.col_offset = 0
        args.skip_llm = False

        # Import and run the script's main logic inline
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

        from scripts.import_providers_update import (
            process_row, normalize_license, normalize_name,
            infer_t6_llm, infer_t6_keyword_fallback, compute_update,
        )
        from collections import Counter
        import openpyxl
        import random

        wb = openpyxl.load_workbook(args.xlsx, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))

        # Detect timestamp column
        first_header = str(rows[0][0] or "").lower()
        col_offset = args.col_offset
        if "timestamp" in first_header:
            col_offset = 1
            print("Detected Timestamp in col 0 -- applying col_offset=1")

        data = rows[1:]
        data = [r for r in data if (r[0 + col_offset] or r[1 + col_offset])]
        print(f"Loaded {len(data)} rows with data from xlsx")

        if args.dry_run:
            data = data[:args.limit]
            print(f"DRY RUN -- processing first {len(data)} rows only\n")

        # Build matching indices
        all_therapists = await db.therapists.find({}).to_list(length=2000)
        print(f"Found {len(all_therapists)} existing therapists in DB\n")

        license_index = {}
        name_index = {}
        for t in all_therapists:
            lic = normalize_license(t.get("license_number"))
            if lic:
                license_index[lic] = t
            nm = normalize_name(t.get("name"))
            if nm:
                name_index[nm] = t

        unmapped_log = []
        matched = 0
        unmatched = 0
        updated_count = 0
        fields_per_therapist = []
        t6_distribution = Counter()
        match_method_counts = Counter()
        unmatched_names = []
        sanity_samples = []

        for idx, row in enumerate(data, 1):
            parsed = process_row(row, col_offset, unmapped_log)
            if parsed is None:
                continue

            name = parsed["_xlsx_name"]
            xlsx_lic = parsed.get("_xlsx_license_norm", "")

            # Match by license, fall back to name
            existing = None
            if xlsx_lic and xlsx_lic in license_index:
                existing = license_index[xlsx_lic]
            else:
                xlsx_name_norm = normalize_name(parsed.get("_xlsx_name", ""))
                if xlsx_name_norm and xlsx_name_norm in name_index:
                    existing = name_index[xlsx_name_norm]

            # t6 classification
            t6_narrative = parsed.pop("_t6_narrative", "")
            t6_fallback = parsed.pop("_t6_keyword_fallback", ["depends"])
            if t6_narrative.strip():
                t6_slugs = await infer_t6_llm(t6_narrative, name)
                if t6_slugs is None:
                    t6_slugs = t6_fallback
                    print(f"  [{idx}] {name}: LLM failed, keyword fallback")
            else:
                t6_slugs = t6_fallback
            parsed["t6_session_expectations"] = t6_slugs
            for s in t6_slugs:
                t6_distribution[s] += 1

            sanity_samples.append((name, dict(parsed)))

            if existing is None:
                unmatched += 1
                unmatched_names.append(name)
                if args.dry_run:
                    print(f"  [{idx}] {name}: NO MATCH (license_norm='{xlsx_lic}')")
                continue

            matched += 1
            match_key = ("license" if normalize_license(
                existing.get("license_number")) == xlsx_lic and xlsx_lic
                else "name")
            match_method_counts[match_key] += 1

            set_fields, newly_real, audit_unset = compute_update(parsed, existing)
            fields_per_therapist.append(len(set_fields))

            if args.dry_run:
                print(f"  [{idx}] {name} (matched by {match_key})")
                print(f"       fields to update: {len(set_fields)}")
                for k, v in sorted(set_fields.items()):
                    old = existing.get(k)
                    old_str = str(old)[:50] if old else "(empty)"
                    new_str = str(v)[:50]
                    print(f"         {k}: {old_str} -> {new_str}")
                if audit_unset:
                    print(f"       audit unset: {audit_unset}")
                print()
            elif args.apply:
                from datetime import datetime, timezone
                update = {"$set": set_fields}
                update["$set"]["updated_at"] = datetime.now(timezone.utc).isoformat()
                real_email = parsed.get("email", "")
                if real_email:
                    update["$set"]["_backfill_audit.original_email"] = real_email
                if audit_unset:
                    existing_audit = existing.get("_backfill_audit", {})
                    existing_fields_added = existing_audit.get("fields_added", [])
                    new_fields_added = [f for f in existing_fields_added
                                        if f not in set(audit_unset)]
                    update["$set"]["_backfill_audit.fields_added"] = new_fields_added
                await db.therapists.update_one({"_id": existing["_id"]}, update)
                updated_count += 1

        # Report
        print("\n" + "=" * 60)
        print("IMPORT REPORT")
        print("=" * 60)
        print(f"  Total rows: {len(data)}")
        print(f"  Matched: {matched} ({dict(match_method_counts)})")
        print(f"  Unmatched: {unmatched}")
        if unmatched_names:
            for n in unmatched_names[:20]:
                print(f"    - {n}")

        if fields_per_therapist:
            avg = sum(fields_per_therapist) / len(fields_per_therapist)
            print(f"\n  Fields/therapist: avg={avg:.1f}, min={min(fields_per_therapist)}, max={max(fields_per_therapist)}")

        if unmapped_log:
            by_field = {}
            for field, val in unmapped_log:
                by_field.setdefault(field, []).append(val)
            print(f"\n  Unmapped enum values ({len(unmapped_log)} total):")
            for field, vals in sorted(by_field.items()):
                unique = sorted(set(vals))
                print(f"    {field} ({len(unique)} unique):")
                for v in unique[:10]:
                    print(f"      - \"{v}\" (x{vals.count(v)})")
                if len(unique) > 10:
                    print(f"      ... and {len(unique)-10} more")

        print(f"\n  t6_session_expectations distribution:")
        for slug, count in t6_distribution.most_common():
            print(f"    {slug}: {count}")

        if sanity_samples:
            random.seed(42)
            picks = random.sample(sanity_samples, min(5, len(sanity_samples)))
            print(f"\n  Sanity check ({len(picks)} therapists):")
            for sname, sfields in picks:
                print(f"    {sname}:")
                print(f"      t4: {sfields.get('t4_hard_truth', '?')}")
                print(f"      t6: {sfields.get('t6_session_expectations', [])}")
                print(f"      t6b: {str(sfields.get('t6_early_sessions_description', ''))[:100]}...")
                print(f"      t5: {str(sfields.get('t5_lived_experience', ''))[:100]}...")

        if args.apply:
            print(f"\n  Successfully updated {updated_count} therapist records.")

        output = buf.getvalue()
        return {"ok": True, "output": output, "error": None}

    except Exception as e:
        output = buf.getvalue()
        tb = traceback.format_exc()
        return {"ok": False, "output": output, "error": f"{e}\n{tb}"}
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr


# ── Fake-out emails (prevent real therapist notifications during testing) ──

@router.post("/admin/fake-out-emails", dependencies=[Depends(require_admin)])
async def fake_out_emails():
    """Replace real emails on imported therapists with therapymatch+tN@gmail.com.

    Only touches therapists with source="imported_xlsx". Does NOT modify
    _backfill_audit so strip-backfill still works at launch.
    """
    cur = db.therapists.find(
        {"source": "imported_xlsx"},
        {"_id": 1, "email": 1, "name": 1},
    ).sort("name", 1)
    therapists = await cur.to_list(length=2000)

    samples = []
    updated = 0
    for idx, t in enumerate(therapists, 1001):
        old_email = t.get("email", "")
        new_email = f"therapymatch+t{idx}@gmail.com"
        if old_email == new_email:
            continue
        await db.therapists.update_one(
            {"_id": t["_id"]},
            {"$set": {"email": new_email}},
        )
        updated += 1
        if len(samples) < 3:
            samples.append({
                "name": t.get("name", "???"),
                "before": old_email,
                "after": new_email,
            })

    return {
        "ok": True,
        "updated": updated,
        "total_imported": len(therapists),
        "samples": samples,
    }


# ── Phase 4: fire all v2 test surveys for a single request ──────────

@router.post("/admin/requests/{request_id}/fire-test-surveys")
async def fire_test_surveys(
    request_id: str,
    _admin: bool = Depends(require_admin),
):
    """Send all 4 v2 survey emails to a request's patient and stamp the
    request so cron skips it. Requires global feedback_testing to be
    enabled in app_config."""
    cfg = (await db.app_config.find_one({"key": "feedback_testing"})) or {}
    if not cfg.get("enabled"):
        raise HTTPException(400, "Enable testing mode in Settings first")

    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "email": 1, "id": 1, "surveys_test_fired": 1}
    )
    if not req:
        raise HTTPException(404, "Request not found")

    email = req.get("email")
    if not email:
        raise HTTPException(400, "Request has no patient email")
    if req.get("surveys_test_fired"):
        raise HTTPException(409, "Test surveys already fired for this request")

    from email_service import (
        send_patient_survey_v2_48h,
        send_patient_survey_v2_3w,
        send_patient_survey_v2_9w,
        send_patient_survey_v2_15w,
    )
    now = datetime.now(timezone.utc).isoformat()
    await send_patient_survey_v2_48h(email, request_id)
    await send_patient_survey_v2_3w(email, request_id)
    await send_patient_survey_v2_9w(email, request_id)
    await send_patient_survey_v2_15w(email, request_id)

    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "surveys_test_fired": True,
            "surveys_test_fired_at": now,
            "v2_survey_48h_sent_at": now,
            "v2_survey_3w_sent_at": now,
            "v2_survey_9w_sent_at": now,
            "v2_survey_15w_sent_at": now,
        }},
    )

    return {"count": 4, "request_id": request_id, "patient_email": email}


# ── Phase 3: fire a therapist survey on-demand ───────────────────────

@router.post("/admin/therapists/{therapist_id}/fire-test-survey")
async def fire_test_therapist_survey(
    therapist_id: str,
    _admin: bool = Depends(require_admin),
):
    """Admin manual trigger: fire one Phase 3 therapist survey email for
    {therapist_id}, bypassing the cron's referral-count and time-based
    eligibility checks. Increments survey_number atomically the same way
    the cron path does (`_next_therapist_survey_number` shared helper),
    so cron and admin paths can't collide.

    Useful for QA-ing the survey email + frontend flow on a real therapist
    account. Does NOT require feedback_testing mode -- one-at-a-time fires
    are low blast radius and the admin click is an intentional signal."""
    from helpers import _next_therapist_survey_number
    from email_service import send_therapist_survey

    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "email": 1, "name": 1},
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    email = t.get("email")
    if not email:
        raise HTTPException(400, "Therapist has no email")

    survey_number = await _next_therapist_survey_number(therapist_id)
    await send_therapist_survey(email, t.get("name", ""), therapist_id, survey_number)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "last_therapist_survey_sent_at": now_iso,
            "last_therapist_survey_sent_number": survey_number,
        }},
    )
    return {
        "ok": True,
        "survey_number": survey_number,
        "therapist_id": therapist_id,
        "therapist_email": email,
    }


