"""Admin routes: login, requests, therapists, templates, declines, backfill, stats, cron triggers."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
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
from email_service import send_therapist_approved, send_therapist_rejected
from email_templates import DEFAULTS as EMAIL_TEMPLATE_DEFAULTS, list_templates, upsert_template
from helpers import _deliver_results, _now_iso, _spawn_bg, _trigger_matching
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


# ─── Admin team management ───────────────────────────────────────────────────
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


# ─── Profile-completeness / claim-campaign ───────────────────────────────────
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
      - dry_run: bool (default False) — when True, returns the recipient
        list WITHOUT actually sending. Useful for sanity-checking the
        campaign on staging.
      - resend: bool (default False) — when False (default) we skip
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
async def admin_list_requests(_: bool = Depends(require_admin)):
    docs = await db.requests.find(
        {}, {"_id": 0, "verification_token": 0}
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


@router.get("/admin/requests/{request_id}", response_model=dict)
async def admin_request_detail(request_id: str, _: bool = Depends(require_admin)):
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
                "review_avg": t.get("review_avg"),
                "review_count": t.get("review_count"),
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
    # Sort by the new Step-2 rank (high → low) so admin's view matches
    # the patient's. Falls back to match_score on legacy applications
    # that pre-date the field (None ranks last).
    apps.sort(
        key=lambda a: (a.get("patient_rank_score") or 0, a.get("match_score") or 0),
        reverse=True,
    )
    invited = await db.outreach_invites.find(
        {"request_id": request_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # When fewer than 30 directory matches were notified, surface a gap
    # explanation so admins can see which axis (specialty, age group,
    # format, insurance, state) constrained the result count.
    match_gap = None
    if len(notified_ids) < 30:
        match_gap = await _explain_match_gap(req, len(notified_ids))
    return {
        "request": req,
        "notified": notified,
        "applications": apps,
        "invited": invited,
        "match_gap": match_gap,
    }


async def _explain_match_gap(req: dict, notified_count: int) -> dict:
    """Counts how many ACTIVE, APPROVED, BILLABLE therapists pass each
    individual filter from the request, so the admin can see which axis
    is the bottleneck. Returns `{notified, target, axes:[{label, count,
    target, severity}], summary}`. `severity` is 'critical' if count==0,
    'warning' if count<target, else 'ok'."""
    target = 30
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

    # ── State (geo) ────────────────────────────────────────────────
    state = req.get("location_state")
    if state:
        in_state = await db.therapists.count_documents({
            **base_match, "licensed_states": state,
        })
        axes.append(_axis(f"Therapists licensed in {state}", in_state, target))

    # ── Format ─────────────────────────────────────────────────────
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

    # ── Age group ──────────────────────────────────────────────────
    age = req.get("age_group")
    if age:
        cnt = await db.therapists.count_documents({
            **base_match, "age_groups": age,
        })
        axes.append(_axis(f"See {age.replace('_', ' ')} clients", cnt, max(8, target // 4)))

    # ── Top presenting issue ───────────────────────────────────────
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

    # ── Modality preference (treatment style) ──────────────────────
    pref_mods = req.get("modality_preferences") or []
    for mod in pref_mods[:2]:
        cnt = await db.therapists.count_documents({
            **base_match, "modalities": mod,
        })
        axes.append(_axis(f"Practice {mod}", cnt, max(8, target // 4)))

    # ── Insurance ──────────────────────────────────────────────────
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

    # ── Cash budget ────────────────────────────────────────────────
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
            f"Cash rate ≤ ${budget} (or sliding scale)",
            cnt, max(15, target // 2),
        ))

    # ── Gender preference (only when patient required it) ──────────
    if req.get("gender_required") and req.get("gender_preference"):
        gp = req["gender_preference"]
        cnt = await db.therapists.count_documents({
            **base_match, "gender": gp,
        })
        axes.append(_axis(f"Identify as {gp} (HARD)", cnt, max(8, target // 4)))

    # ── Preferred language (only when patient required it) ─────────
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

    # ── Availability windows (only when patient required it) ───────
    avail = req.get("availability_windows") or []
    if req.get("availability_strict") and avail and "flexible" not in avail:
        cnt = await db.therapists.count_documents({
            **base_match,
            "availability_windows": {"$in": avail},
        })
        pretty = ", ".join(w.replace("_", " ") for w in avail[:3])
        axes.append(_axis(f"Available {pretty} (HARD)", cnt, max(8, target // 4)))

    # ── Urgency window (only when patient required it) ─────────────
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
        f"Only {notified_count} therapist(s) were notified — target was "
        f"{target}. Active directory size: {total_active}. The axes below "
        f"show which filter cut the pool down."
    )
    # If the patient hasn't yet clicked the verification link, the matching
    # job never ran — so a low notified_count says nothing about the
    # provider directory, and the admin should be told that explicitly
    # before drawing any conclusions about coverage gaps.
    verified = bool(req.get("verified"))
    if not verified:
        summary = (
            "Patient hasn't verified their email yet — matching only runs "
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
    from license_verify import compute_license_status, dopl_verification_url

    query: dict[str, Any] = {}
    if pending is True:
        query["pending_approval"] = True
    elif pending is False:
        query["pending_approval"] = {"$ne": True}
    rows = await db.therapists.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
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
    # patient-demand gaps this applicant would fill — and flag duplicates
    # (axes where we already have ≥5 active providers like them) so the
    # admin can decide whether the marginal slot is worth approving.
    if pending is True and rows:
        await _attach_value_tags(rows)
    return rows


_DUP_THRESHOLD = 5  # axes with ≥5 active matches are "duplicates"


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

        # Primary specialties — highest demand axis
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

        # Sliding scale / free consult — affordability axes
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
    _spawn_bg(
        send_therapist_approved(t["email"], t["name"]),
        name=f"approve_email_{therapist_id[:8]}",
    )
    return {"id": therapist_id, "status": "approved"}


@router.post("/admin/therapists/{therapist_id}/reject")
async def admin_reject_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    import asyncio
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
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
    "duplicate" axes (i.e. `value_summary.is_duplicate_only == True`) —
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
    blessed it — clear the pending_reapproval flag so the updated profile
    starts being used by the matching engine."""
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
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
        "review_avg", "review_count", "review_sources",
        "referral_code", "referred_by_code",
    }
    update = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not update:
        raise HTTPException(400, "No editable fields provided")
    # Enforce the 3-age-group cap on ALL saves (admin + self-edit) — same
    # rule applied at the model layer for new signups.
    if "age_groups" in update and isinstance(update["age_groups"], list):
        update["age_groups"] = update["age_groups"][:3]
    update["updated_at"] = _now_iso()
    # When the admin saves the profile, treat that as an implicit
    # re-approval — clear the pending flag so the row stops surfacing
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
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
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
    """Reverse of /archive — bring an archived therapist back online."""
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
    """Hard delete — only allowed when there are NO applications and NO
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
    body = (payload or {}).get("body") or "TheraVoca: SMS smoke test — your Twilio integration is wired up."
    if not to:
        raise HTTPException(400, "No recipient and no TWILIO_DEV_OVERRIDE_TO env set")
    result = await send_sms(to, body)
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
        except Exception:
            # Pollers are best-effort; don't fail the test endpoint on this.
            pass

    # Map common Twilio error codes to human-readable troubleshooting hints.
    hint = None
    if error_code in (30034, 30032):
        hint = (
            "A2P 10DLC registration required. US carriers block unregistered "
            "numbers from sending SMS. Register at "
            "twilio.com/console/sms/a2p-messaging — or switch to a "
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
    rendered IN-MEMORY ONLY — they're not persisted, so the admin can
    iterate on copy without polluting the saved override."""
    if key not in EMAIL_TEMPLATE_DEFAULTS:
        raise HTTPException(404, f"Unknown template key: {key}")
    from email_service import render_template_preview
    draft = (payload or {}).get("draft") if isinstance(payload, dict) else None
    return await render_template_preview(key, draft)


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
                # Preserve the original audit if one already exists — re-runs
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
    NEVER touched by backfill — backfill only fills empty fields) are
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
        # blank or already a therapymatch+ placeholder), DO NOT strip —
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


@router.get("/admin/backfill-status")
async def admin_backfill_status(_: bool = Depends(require_admin)):
    """Snapshot of backfill state — used by the admin UI to confirm
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


# ── Pre-launch test-data wipe ────────────────────────────────────────────
# A blunt-but-guarded button that clears every collection containing
# patient/operational test data (requests, applications, simulator runs,
# auto-recruit cycles, outreach invites, magic codes, etc.) and removes
# any therapists that aren't part of the seeded `therapymatch+` pool.
# Designed for "everything we used to test the matching engine, gone —
# but the seeded therapist directory + all admin/site config preserved."
_SEEDED_THERAPIST_FILTER = {
    "email": {"$regex": "therapymatch\\+", "$options": "i"},
}

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


@router.get("/admin/wipe-test-data/preview")
async def admin_wipe_test_data_preview(_: bool = Depends(require_admin)):
    """Show counts of what `POST /admin/wipe-test-data` would delete.
    Read-only — no side effects. Used by the admin UI to populate the
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
            "Kept: seeded therapists with therapymatch+ emails (incl. "
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
async def admin_list_feedback(_: bool = Depends(require_admin)):
    docs = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"feedback": docs, "total": len(docs)}


@router.get("/admin/patients")
async def admin_list_patients_by_email(_: bool = Depends(require_admin)):
    """Aggregate every email that has submitted a request and how many
    requests they've filed. Useful for spotting power users / repeat
    submitters. Sorted by most-recent request first.

    Each row also reports whether the patient has set a password (i.e.
    has a row in `patient_accounts` with a hash) so the admin can see
    who's converted to a tracked account.
    """
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


# ─── Patient intake rate limit (admin-tunable) ──────────────────────────
# Throttles how many requests one email can submit per rolling window.
# Default: 1 request per 60 minutes — keeps junk down while we're still
# learning real user patterns. Stored in `app_config.intake_rate_limit`.
_DEFAULT_INTAKE_RATE = {
    "max_requests_per_window": 1,
    "window_minutes": 60,
    # IP-level cap (separate axis from per-email): how many intake submissions
    # we accept from a single IP per rolling hour. Default 8 — high enough
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
    [0.05, 0.6] — same guardrail bounds as the v2 spec's auto-tuning
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
    # Optional — only validated/persisted when the admin actually sent it.
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


# ─── Test mode (admin-only, time-boxed rate-limit bypass) ─────────────────
# When enabled, /api/requests skips both the per-IP and per-email rate
# limits for the configured duration. Bot defenses (honeypot, timing
# heuristic, Turnstile) remain ON — test mode only relaxes the throttle
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
    # starts fresh — otherwise the >=cap check still fires from prior
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


# ─── External scrape-source registry (admin-tunable) ────────────────────
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
    # Deliverability verdict — pessimistic by design.
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


# ─── Research enrichment toggle + manual triggers ──────────────────────────
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
    # Allow one-off run even if globally disabled — temporarily enable, run,
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
    """Run deep web-research on ONE therapist — DuckDuckGo search +
    fetch up to 5 extra pages (PT profile, podcasts, blogs, papers)
    + LLM evidence extraction. Caches result on the therapist doc.
    Costs more than the standard refresh (~30s + 2-3x tokens) so it's
    opt-in per therapist rather than running on every match."""
    from research_enrichment import get_or_build_research
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
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
        ("review_count", -1),
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


# Public endpoint — patient intake calls this to populate its dropdown.
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
    to render the Turnstile widget. Returns `{enabled: bool}` —
    `enabled=False` when either (a) the admin has flipped the
    runtime-disable toggle (used during AI-driven E2E testing) or
    (b) the `TURNSTILE_SITE_KEY` env isn't configured.
    The widget only renders when `enabled=True`."""
    import turnstile_service
    disabled = await turnstile_service._is_disabled_by_admin()
    configured = bool(
        (os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    )
    return {"enabled": (not disabled) and configured}


@public_router.get("/config/hard-capacity")
async def public_hard_capacity() -> dict[str, Any]:
    """Returns which HARD intake options should be greyed out because
    there aren't enough therapists in the directory passing them.
    Lightweight aggregate — used by the intake form on mount.
    (Admins see the same data + full protection reasons via
    /api/admin/hard-capacity)."""
    import hard_capacity
    result = await hard_capacity.compute_capacity(db)
    # Lean payload for public consumers — omit raw counts to keep
    # directory breakdown private. We only need the disabled flags +
    # the short protections blurbs for the UI tooltip.
    return {
        "pool_size": result["pool_size"],
        "min_required": result["min_required"],
        "disabled": result["disabled"],
        "protections": result["protections"],
    }


@router.get("/admin/hard-capacity", dependencies=[Depends(require_admin)])
async def admin_hard_capacity() -> dict[str, Any]:
    """Admin view — full capacity snapshot with raw counts per variant."""
    import hard_capacity
    return await hard_capacity.compute_capacity(db)


@router.get("/admin/turnstile-settings", dependencies=[Depends(require_admin)])
async def admin_get_turnstile_settings() -> dict[str, Any]:
    doc = await db.app_config.find_one(
        {"key": "turnstile_settings"}, {"_id": 0, "disabled": 1, "disabled_at": 1, "disabled_reason": 1},
    )
    return {
        "disabled": bool((doc or {}).get("disabled")),
        "disabled_at": (doc or {}).get("disabled_at"),
        "disabled_reason": (doc or {}).get("disabled_reason") or "",
        "configured": bool(
            (os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
            and (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
        ),
    }


@router.put("/admin/turnstile-settings", dependencies=[Depends(require_admin)])
async def admin_set_turnstile_settings(payload: dict) -> dict[str, Any]:
    """Flip the runtime disable toggle. `{disabled: true, reason?: str}`.
    When disabled, BOTH backend verification and the frontend widget
    short-circuit — so automated tests don't need a real Turnstile token."""
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


# ─── Outreach opt-out — public, no auth ─────────────────────────────────
def _render_opt_out_page(*, success: bool, email: str | None, phone: str | None,
                        already: bool = False) -> str:
    """Tiny self-contained HTML confirmation page. No React dependency — this
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
        '(You were already opted out — no action needed.)</p>'
        if already else ""
    )
    return f"""<!doctype html>
<html><head>
<meta charset="utf-8">
<title>TheraVoca — {headline}</title>
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
    no CSRF — the invite_id (UUID4) is the unguessable token."""
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


@router.post("/admin/requests/{request_id}/run-outreach")
async def admin_run_outreach_now(
    request_id: str, _: bool = Depends(require_admin),
):
    """Manually re-run the LLM outreach for a request whose initial run was
    skipped or failed. Clears the `outreach_run_at` flag first so the agent
    will actually execute regardless of prior state."""
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
async def admin_referral_analytics(_: bool = Depends(require_admin)):
    """Referral analytics:
    - patient `referred_by_patient_code` chains
    - therapist `referred_by_code` chains
    - gap-recruit conversion rate
    - referral_source breakdown from intake form
    """
    from collections import Counter

    # Patient → patient referrals
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
    address — the user controls `therapymatch@gmail.com`, so the email lands
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


# ──────────────────────────────────────────────────────────────────────
# Matching-Outcome Simulator (admin-only)
# ──────────────────────────────────────────────────────────────────────
# Routes delegate to `backend/simulator.py` — this keeps admin.py from
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
    report = await simulator.run_simulation(
        db,
        num_requests=num_requests,
        notify_top_n=notify_top_n,
        min_applications=min_applications,
        max_applications=max_applications,
        random_seed=random_seed,
    )
    return report


@router.get("/admin/simulator/runs")
async def simulator_list_runs(
    _: None = Depends(require_admin),
    limit: int = 30,
):
    """List recent simulator runs — lightweight summary only."""
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


# ──────────────────────────────────────────────────────────────────────
# Auto-recruit — closed-loop recruiter (Simulator + Coverage Gaps +
# Gap Recruiter). Pre-launch: dry-run + admin-approval-gated. See
# backend/auto_recruit.py for the orchestration logic.
# ──────────────────────────────────────────────────────────────────────


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
    """Preview the plan WITHOUT creating drafts — runs a fresh simulator
    + coverage-gap analysis and returns the would-be recruit targets."""
    import auto_recruit
    return await auto_recruit.compute_plan_preview(db)


@router.post("/admin/auto-recruit/run")
async def auto_recruit_run(_: None = Depends(require_admin)):
    """Execute one full cycle — runs sim, builds plan, calls gap
    recruiter, stamps new drafts with cycle id + needs_approval=True.
    Never sends real email (dry_run enforced by config)."""
    import auto_recruit
    cycle = await auto_recruit.run_cycle(db, manual_trigger=True)
    return cycle


@router.get("/admin/auto-recruit/cycles")
async def auto_recruit_list_cycles(
    _: None = Depends(require_admin), limit: int = 30,
):
    """Recent cycles history (lightweight — omits per-draft detail)."""
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


# ─── Experiment download (text-impact study) ───────────────────────────────
# Lightweight read-only endpoint that streams the latest run's xlsx so the
# admin can download it from the "How matching works" panel without us
# having to host a separate static-file route.
@router.get("/admin/experiments/text-impact/latest")
async def admin_experiment_text_impact_latest(
    _: None = Depends(require_admin),
):
    """Returns metadata + a download URL for the most recent
    `experiment_text_impact` xlsx. The xlsx itself is served by the
    sibling `/download` endpoint below as binary."""
    from pathlib import Path
    results_dir = Path("/app/backend/scripts/results")
    files = sorted(results_dir.glob("exp_*.xlsx"), reverse=True)
    if not files:
        return {"available": False}
    f = files[0]
    return {
        "available": True,
        "filename": f.name,
        "size_bytes": f.stat().st_size,
        "modified_at": datetime.fromtimestamp(
            f.stat().st_mtime, tz=timezone.utc,
        ).isoformat(),
        "download_url": "/api/admin/experiments/text-impact/download",
    }


@router.get("/admin/experiments/text-impact/download")
async def admin_experiment_text_impact_download(
    _: None = Depends(require_admin),
):
    """Streams the latest text-impact xlsx as an attachment."""
    from pathlib import Path

    from fastapi.responses import FileResponse
    results_dir = Path("/app/backend/scripts/results")
    files = sorted(results_dir.glob("exp_*.xlsx"), reverse=True)
    if not files:
        raise HTTPException(404, "No experiment results available yet.")
    return FileResponse(
        path=str(files[0]),
        filename=files[0].name,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
    )


# Suppress unused-import warnings on logger (kept for future logging)
void = logger
