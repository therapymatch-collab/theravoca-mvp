"""Feedback system v5 -- timeline-aligned patient/therapist follow-ups.

Surveys at 4 patient touchpoints (48h, 3w, 9w, 15w), a conditional 5w
follow-up, and a weekly therapist pulse.  All feed into the matching
engine's therapist reliability score, Match Strength, and expectation accuracy.

Timeline:
  48h   Soft touch check-in (process feedback, relationship building)
  3w    Selection + first impressions (who picked, confidence, expectation)
  5w    Follow-up only if patient chose "still_deciding" at 3w
  9w    Retention + Match Strength questions (still seeing, bond, goals)
  15w   Outcome (progress, referral, what changed)
  Weekly Therapist pulse (general satisfaction, never about specific patients)

Authenticated endpoints (HMAC token via ?token= OR Bearer session JWT):
  POST /api/feedback/patient/{request_id}/48h
  POST /api/feedback/patient/{request_id}/3w
  POST /api/feedback/patient/{request_id}/9w
  POST /api/feedback/patient/{request_id}/15w
  POST /api/feedback/therapist/{therapist_id}/pulse
Unauthenticated (general contact form, protected by Turnstile CAPTCHA):
  POST /api/feedback/widget
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from deps import db, JWT_SECRET, PHASE_2_LAUNCH_DATE, _decode_session_from_authorization
from email_service import _send

logger = logging.getLogger("theravoca.feedback")

router = APIRouter()

FEEDBACK_INBOX = os.environ.get("FEEDBACK_INBOX_EMAIL", "theravoca@gmail.com")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════
# SNAPSHOT / DENORMALIZATION HELPERS (v2 surveys)
# ═══════════════════════════════════════════════════════════════════════

# Shared projection for request lookups in all 4 patient handlers.
_REQUEST_SNAPSHOT_PROJECTION = {
    "_id": 0, "id": 1, "email": 1, "notified_therapist_ids": 1,
    "results_sent_at": 1, "presenting_issues": 1, "deep_match_opt_in": 1,
}


def _snapshot_fields(req: dict) -> dict:
    """Return extra fields to denormalize into a feedback doc when the
    request was served after the Phase 2 launch date."""
    rsa = req.get("results_sent_at") or ""
    if rsa < PHASE_2_LAUNCH_DATE:
        return {}
    out: dict = {"survey_version": 2}
    if req.get("presenting_issues"):
        out["presenting_issues_snapshot"] = req["presenting_issues"]
    if req.get("deep_match_opt_in") is not None:
        out["deep_match_opt_in"] = req["deep_match_opt_in"]
    return out


async def _snapshot_match_scores(request_id: str) -> dict:
    """Grab the top application's match_score and match_breakdown at
    the time the patient submits feedback, so we can correlate survey
    answers with the match quality they experienced."""
    app = await db.applications.find_one(
        {"request_id": request_id},
        {"_id": 0, "match_score": 1, "match_breakdown": 1},
        sort=[("match_score", -1)],
    )
    if not app:
        return {}
    out = {}
    if app.get("match_score") is not None:
        out["match_score_at_response"] = app["match_score"]
    if app.get("match_breakdown"):
        out["match_breakdown_at_response"] = app["match_breakdown"]
    return out


# ═══════════════════════════════════════════════════════════════════════
# FEEDBACK TOKEN AUTH (HMAC-signed, expiring)
# ═══════════════════════════════════════════════════════════════════════

FEEDBACK_TOKEN_TTL_HOURS = int(os.environ.get("FEEDBACK_TOKEN_TTL_HOURS", "168"))  # 7 days


def generate_feedback_token(entity_id: str, entity_type: str = "patient") -> str:
    """Create an HMAC-SHA256 token for a feedback email link.
    Token format: {signature}.{expires_unix}
    where signature = HMAC(entity_id:entity_type:expires_unix)[:32]
    Using unix timestamp avoids colon-in-ISO issues with URL params.
    """
    expires_unix = int(
        (datetime.now(timezone.utc) + timedelta(hours=FEEDBACK_TOKEN_TTL_HOURS)).timestamp()
    )
    msg = f"{entity_id}:{entity_type}:{expires_unix}"
    sig = _hmac.new(
        JWT_SECRET.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()[:32]
    return f"{sig}.{expires_unix}"


def _verify_feedback_token(
    entity_id: str,
    token: Optional[str],
    entity_type: str = "patient",
    authorization: Optional[str] = None,
) -> None:
    """Verify a feedback token OR a valid session Bearer JWT.
    Raises 401 on failure."""
    # Allow session-authenticated users (logged into portal)
    if not token and authorization:
        session = _decode_session_from_authorization(authorization)
        if session:
            return  # Valid session — allow through
    if not token:
        raise HTTPException(401, "Missing feedback token — use the link from your email.")
    parts = token.split(".", 1)
    if len(parts) != 2:
        raise HTTPException(401, "Invalid feedback token format.")
    sig, expires_str = parts
    # Check expiry
    try:
        expires_unix = int(expires_str)
        if datetime.fromtimestamp(expires_unix, tz=timezone.utc) < datetime.now(timezone.utc):
            raise HTTPException(401, "This feedback link has expired. Please sign in to your portal instead.")
    except (ValueError, OSError):
        raise HTTPException(401, "Invalid token expiration.")
    # Check signature
    msg = f"{entity_id}:{entity_type}:{expires_unix}"
    expected = _hmac.new(
        JWT_SECRET.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()[:32]
    if not _hmac.compare_digest(sig, expected):
        raise HTTPException(401, "Invalid feedback token.")


# ═══════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════

class PatientFeedback48h(BaseModel):
    """48-hour check-in. v1 and v2 fields coexist; extra="ignore" drops
    any unknown keys. v1 fields are kept Optional so v2-only payloads
    still parse, and vice versa."""
    model_config = ConfigDict(extra="ignore")
    survey_version: Optional[int] = None  # 1 or 2, sent by frontend
    # -- v1 fields (kept for backward compat) --
    process: Optional[str] = None  # "great" | "fine" | "had_issues"
    issues: Optional[str] = None
    reached_out: Optional[str] = None  # v1: "yes" | "not_yet"
    # -- v2 fields --
    match_feel: Optional[int] = None  # 1-4
    # v2 reached_out reuses the same field name with richer enum:
    # "scheduled_or_session" | "message_no_reply" | "not_yet_reviewing" | "none_seemed_right"
    improvement_text: Optional[str] = Field(None, max_length=1000)


class PatientFeedback3w(BaseModel):
    """3-week check-in. v1 and v2 fields coexist.

    Field aliases accept the OLD v1 names (contacted_therapist,
    fit_confidence, met_expectations) so in-flight email links that
    submit the old payload still parse correctly after deploy.
    populate_by_name=True lets the NEW names work too.
    """
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    survey_version: Optional[int] = None
    # -- v1 fields (kept for backward compat, all Optional now) --
    chosen_status: Optional[str] = Field(None, alias="contacted_therapist")
    chosen_therapist_id: Optional[str] = None
    had_session: Optional[str] = None  # "yes" | "scheduled" | "no"
    confidence: Optional[int] = Field(None, ge=0, le=100, alias="fit_confidence")
    expectation_match: Optional[str] = Field(None, alias="met_expectations")
    surprises: Optional[str] = None
    notes: Optional[str] = None
    # -- v2 fields --
    selected_therapists: Optional[list[str]] = None  # therapist_ids or sentinel strings
    going_so_far: Optional[int] = None  # 1-4
    nps: Optional[int] = Field(None, ge=0, le=10)


class PatientFeedback9w(BaseModel):
    """9-week retention + Match Strength questions. v1 and v2 coexist."""
    model_config = ConfigDict(extra="ignore")
    survey_version: Optional[int] = None
    # -- v1 fields (kept for backward compat, all Optional now) --
    still_seeing: Optional[str] = None  # v1: "yes"|"no"|"switched"; v2: richer enum
    session_count: Optional[str] = None  # v1 only
    working_well: Optional[str] = None  # v1 only
    not_working: Optional[str] = None  # v1 only
    feel_understood: Optional[int] = Field(None, ge=1, le=5)  # v1: 1-5, v2: 1-4 (fits)
    same_page: Optional[int] = Field(None, ge=1, le=5)  # v1 only
    recommend_therapist: Optional[int] = Field(None, ge=1, le=10)  # v1 only
    recommend_theravoca: Optional[int] = Field(None, ge=1, le=10)  # v1 only
    # -- v2 fields --
    expectations_match: Optional[int] = Field(None, ge=1, le=4)  # Tasks signal
    goals_aligned: Optional[int] = Field(None, ge=1, le=4)  # Goals signal
    nps: Optional[int] = Field(None, ge=0, le=10)


class PatientFeedback15w(BaseModel):
    """15-week outcome survey. v1 and v2 coexist."""
    model_config = ConfigDict(extra="ignore")
    survey_version: Optional[int] = None
    # -- v1 fields (kept for backward compat, all Optional now) --
    still_seeing: Optional[str] = None  # v1: "yes"|"no"|"switched"; v2: richer enum
    progress: Optional[int] = Field(None, ge=1, le=10)  # v1 only
    refer_therapist: Optional[str] = None  # v1 only
    refer_theravoca: Optional[str] = None  # v1 only
    what_changed: Optional[str] = None  # v1 only
    notes: Optional[str] = None  # v1 only
    # -- v2 fields --
    feel_understood: Optional[int] = Field(None, ge=1, le=5)  # Bond signal
    expectations_match: Optional[int] = Field(None, ge=1, le=4)  # Tasks signal
    goals_aligned: Optional[int] = Field(None, ge=1, le=4)  # Goals signal
    nps: Optional[int] = Field(None, ge=0, le=10)
    final_reflection: Optional[str] = Field(None, max_length=2000)


class TherapistWeeklyPulse(BaseModel):
    """Weekly therapist pulse — general satisfaction, never about specific patients."""
    referral_quality: int = Field(ge=1, le=5)
    match_accuracy: int = Field(ge=1, le=5)
    satisfaction: int = Field(ge=1, le=5)
    feedback_text: Optional[str] = None
    adjust_preferences: bool = False


class WidgetFeedback(BaseModel):
    message: str = Field(min_length=5, max_length=2000)
    name: Optional[str] = ""
    email: Optional[EmailStr] = None
    source_url: Optional[str] = ""
    role: Optional[str] = ""


# ═══════════════════════════════════════════════════════════════════════
# PATIENT FEEDBACK — 48h / 3w / 9w / 15w
# ═══════════════════════════════════════════════════════════════════════

@router.post("/feedback/patient/{request_id}/48h")
async def submit_patient_48h(
    request_id: str, payload: PatientFeedback48h,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """48h soft touch -- process feedback only, no reliability updates."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, _REQUEST_SNAPSHOT_PROJECTION)
    if not req:
        raise HTTPException(404, "Request not found")

    # Idempotency: one submission per (request_id, milestone). 409 on
    # double-click Submit or revisit-after-submit. Replay UI on the
    # frontend uses the GET endpoint to render read-only.
    existing = await db.feedback.find_one(
        {"request_id": request_id, "milestone": "48h"},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "Already submitted")

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_48h",
        "milestone": "48h",
        "role": "patient",
        "request_id": request_id,
        "patient_email": req.get("email"),
        **payload.model_dump(),
        **_snapshot_fields(req),
        **(await _snapshot_match_scores(request_id)),
        "submitted_at": _now_iso(),
    }
    await db.feedback.insert_one(doc)
    return {"ok": True}


@router.post("/feedback/patient/{request_id}/3w")
async def submit_patient_3w(
    request_id: str, payload: PatientFeedback3w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """3-week selection + first impressions."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, _REQUEST_SNAPSHOT_PROJECTION)
    if not req:
        raise HTTPException(404, "Request not found")

    # Idempotency -- see 48h handler comment.
    existing = await db.feedback.find_one(
        {"request_id": request_id, "milestone": "3w"},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "Already submitted")

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_3w",
        "milestone": "3w",
        "role": "patient",
        "request_id": request_id,
        "patient_email": req.get("email"),
        **payload.model_dump(),
        **_snapshot_fields(req),
        **(await _snapshot_match_scores(request_id)),
        "submitted_at": _now_iso(),
    }
    await db.feedback.insert_one(doc)

    # ── Selection rate updates ──
    if payload.chosen_status == "picked" and payload.chosen_therapist_id:
        # Chosen therapist: selected=True
        await _update_therapist_selection_rate(payload.chosen_therapist_id, True)
        # All other shown therapists: selected=False
        shown_ids = req.get("notified_therapist_ids") or []
        for tid in shown_ids:
            if tid != payload.chosen_therapist_id:
                await _update_therapist_selection_rate(tid, False)

    # ── Schedule 5w follow-up if still deciding ──
    if payload.chosen_status == "still_deciding":
        await db.requests.update_one(
            {"id": request_id},
            {"$set": {
                "followup_5w": True,
                "followup_5w_due": (
                    datetime.now(timezone.utc) + timedelta(weeks=2)
                ).isoformat(),
            }},
        )

    # ── Expectation accuracy ──
    if payload.chosen_therapist_id:
        await _update_therapist_expectation_accuracy(
            payload.chosen_therapist_id, payload.expectation_match
        )

    # ── Low confidence intervention ──
    if payload.confidence is not None and payload.confidence < 75:
        await _flag_for_intervention(
            request_id, payload.chosen_therapist_id, payload.confidence
        )

    return {"ok": True}


@router.post("/feedback/patient/{request_id}/9w")
async def submit_patient_9w(
    request_id: str, payload: PatientFeedback9w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """9-week retention + Match Strength questions."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, _REQUEST_SNAPSHOT_PROJECTION)
    if not req:
        raise HTTPException(404, "Request not found")

    # Idempotency -- see 48h handler comment.
    existing = await db.feedback.find_one(
        {"request_id": request_id, "milestone": "9w"},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "Already submitted")

    # Look up the chosen therapist from the 3w survey
    therapist_id = await _get_therapist_for_request(request_id)

    # Build Match Strength data from accumulated feedback
    match_strength_score = -1.0
    if therapist_id:
        ms_data = await _build_match_strength_data(request_id, payload)
        from matching import calculate_match_strength
        match_strength_score = calculate_match_strength(ms_data)

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_9w",
        "milestone": "9w",
        "role": "patient",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "therapist_id": therapist_id,
        **payload.model_dump(),
        **_snapshot_fields(req),
        **(await _snapshot_match_scores(request_id)),
        "match_strength_score": match_strength_score,
        "submitted_at": _now_iso(),
    }
    await db.feedback.insert_one(doc)

    # ── Retention update ──
    if therapist_id:
        await _update_therapist_retention(therapist_id, "retention_9w", payload.still_seeing)

    return {"ok": True}


@router.post("/feedback/patient/{request_id}/15w")
async def submit_patient_15w(
    request_id: str, payload: PatientFeedback15w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """15-week outcome survey."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, _REQUEST_SNAPSHOT_PROJECTION)
    if not req:
        raise HTTPException(404, "Request not found")

    # Idempotency -- see 48h handler comment.
    existing = await db.feedback.find_one(
        {"request_id": request_id, "milestone": "15w"},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "Already submitted")

    therapist_id = await _get_therapist_for_request(request_id)

    # Build full Match Strength data from all milestones
    match_strength_score = -1.0
    if therapist_id:
        ms_data = await _build_match_strength_data(request_id, None, payload)
        from matching import calculate_match_strength
        match_strength_score = calculate_match_strength(ms_data)

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_15w",
        "milestone": "15w",
        "role": "patient",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "therapist_id": therapist_id,
        **payload.model_dump(),
        **_snapshot_fields(req),
        **(await _snapshot_match_scores(request_id)),
        "match_strength_score": match_strength_score,
        "submitted_at": _now_iso(),
    }
    await db.feedback.insert_one(doc)

    # ── Retention update ──
    if therapist_id:
        await _update_therapist_retention(therapist_id, "retention_15w", payload.still_seeing)

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════
# THERAPIST FEEDBACK — weekly pulse
# ═══════════════════════════════════════════════════════════════════════

@router.post("/feedback/therapist/{therapist_id}/pulse")
async def submit_therapist_pulse(
    therapist_id: str, payload: TherapistWeeklyPulse,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """Weekly therapist pulse — general satisfaction, never about specific patients."""
    _verify_feedback_token(therapist_id, token, "therapist", authorization)
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "email": 1, "name": 1}
    )
    if not t:
        raise HTTPException(404, "Therapist not found")

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "therapist_pulse",
        "therapist_id": therapist_id,
        "therapist_email": t.get("email"),
        "therapist_name": t.get("name"),
        **payload.model_dump(),
        "submitted_at": _now_iso(),
    }
    await db.therapist_pulse.insert_one(doc)

    # ── Churn risk flag ──
    if payload.satisfaction < 3:
        await _flag_admin(
            f"Therapist churn risk: {t.get('name', therapist_id)}",
            f"<p>Satisfaction score: <strong>{payload.satisfaction}/5</strong></p>"
            f"<p>Referral quality: {payload.referral_quality}/5</p>"
            f"<p>Match accuracy: {payload.match_accuracy}/5</p>"
            f"<p>Feedback: {payload.feedback_text or 'N/A'}</p>",
        )

    # ── Preference adjustment flag ──
    if payload.adjust_preferences:
        await _flag_admin(
            f"Therapist wants preference update: {t.get('name', therapist_id)}",
            f"<p>{t.get('name', therapist_id)} has requested to adjust their matching preferences.</p>"
            f"<p>Feedback: {payload.feedback_text or 'N/A'}</p>",
        )

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════
# LEGACY + BACKWARD COMPAT
# ═══════════════════════════════════════════════════════════════════════

# Legacy endpoint — keep backward compat with old email links
@router.post("/feedback/patient/{request_id}")
async def submit_patient_feedback_legacy(
    request_id: str, payload: dict,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """Backward-compatible: old email links hit this. Store as-is."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    milestone = (payload or {}).get("milestone", "48h")
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 1})
    if not req:
        raise HTTPException(404, "Request not found")
    await db.feedback.insert_one({
        "id": str(uuid.uuid4()),
        "kind": f"patient_legacy_{milestone}",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "data": payload,
        "submitted_at": _now_iso(),
    })
    return {"ok": True}


# Legacy therapist regular endpoint
@router.post("/feedback/therapist/{therapist_id}")
async def submit_therapist_feedback_legacy(
    therapist_id: str, payload: dict,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """Backward-compatible: old therapist feedback links."""
    _verify_feedback_token(therapist_id, token, "therapist", authorization)
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "email": 1, "name": 1}
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    await db.feedback.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "therapist_legacy",
        "therapist_id": therapist_id,
        "therapist_email": t.get("email"),
        "data": payload,
        "submitted_at": _now_iso(),
    })
    return {"ok": True}


# Legacy therapist exception endpoint
@router.post("/feedback/therapist/{therapist_id}/exception")
async def submit_therapist_exception_legacy(
    therapist_id: str, payload: dict,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """Backward-compatible: old exception-based feedback."""
    _verify_feedback_token(therapist_id, token, "therapist", authorization)
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "email": 1, "name": 1}
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    await db.feedback.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "therapist_exception_legacy",
        "therapist_id": therapist_id,
        "therapist_email": t.get("email"),
        "data": payload,
        "submitted_at": _now_iso(),
    })
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════
# THERAPIST LIST FOR 3w SURVEY DROPDOWN
# ═══════════════════════════════════════════════════════════════════════

@router.get("/feedback/patient/{request_id}/matches")
async def get_patient_matches(
    request_id: str,
    token: Optional[str] = Query(None),
    milestone: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Return therapists for the survey dropdown.

    Behavior depends on milestone:
      - 48h: APPLIED therapists only (drives the optional Q2b dropdown
        on the 48h survey for patients who chose 'yes_contacted' or
        'yes_multiple'). Empty if no applications -- frontend hides Q2b.
      - 3w: APPLIED therapists.
      - 9w/15w: prefer the therapists the patient picked at 3w. Pull
        `selected_therapists` from the patient's 3w feedback doc,
        filter out sentinel values (anything starting with '_', e.g.
        '_outside' / '_not_started'). If real IDs remain, return only
        those. Otherwise fall back to APPLIED therapists. If both are
        empty, return an empty matches array (frontend hides Q1b).
      - Unspecified milestone: notified pool (legacy fallback).
    """
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one(
        {"id": request_id},
        {"_id": 0, "notified_therapist_ids": 1},
    )
    if not req:
        raise HTTPException(404, "Request not found")

    async def _applied_ids() -> list[str]:
        ids: list[str] = []
        async for a in db.applications.find(
            {"request_id": request_id},
            {"_id": 0, "therapist_id": 1},
        ):
            ids.append(a["therapist_id"])
        return ids

    async def _hydrate(therapist_ids: list[str]) -> list[dict]:
        """Enrich a list of therapist IDs with match score, profile, and
        a deterministic avatar color. Empty input -> empty output."""
        if not therapist_ids:
            return []
        apps: dict[str, float | None] = {}
        async for a in db.applications.find(
            {"request_id": request_id, "therapist_id": {"$in": therapist_ids}},
            {"_id": 0, "therapist_id": 1, "match_score": 1},
        ):
            apps[a["therapist_id"]] = a.get("match_score")
        out: list[dict] = []
        _colors = [
            "#4F46E5", "#7C3AED", "#2563EB", "#0891B2",
            "#059669", "#D97706", "#DC2626", "#DB2777",
        ]
        async for t in db.therapists.find(
            {"id": {"$in": therapist_ids}},
            {"_id": 0, "id": 1, "name": 1,
             "credential_type": 1, "years_experience": 1,
             "modality_offering": 1},
        ):
            tid = t["id"]
            _hash = sum(ord(c) for c in tid) % len(_colors)
            out.append({
                "therapist_id": tid,
                "therapist_name": t.get("name", "Therapist"),
                "match_score": apps.get(tid),
                "credential_type": t.get("credential_type"),
                "years_experience": t.get("years_experience"),
                "modality_offering": t.get("modality_offering"),
                "avatar_color": _colors[_hash],
            })
        return out

    if milestone in ("48h", "3w"):
        return {"matches": await _hydrate(await _applied_ids())}

    if milestone in ("9w", "15w"):
        # `matches` = primary list: 3w-picked therapists (sentinels
        # filtered), falling back to applied if 3w was sentinel-only or
        # missing.
        # `all_applied` = the full applied list, used by the frontend
        # when the patient picks "yes_different" at Q1 (they switched,
        # so they need to see the full pool, not just the 3w picks).
        # Both arrays may be empty when no applications exist; the
        # frontend hides Q1b in that case.
        fb_3w = await db.feedback.find_one(
            {"request_id": request_id, "milestone": "3w"},
            {"_id": 0, "selected_therapists": 1},
        )
        selected = (fb_3w or {}).get("selected_therapists") or []
        primary_ids = [tid for tid in selected if not tid.startswith("_")]
        all_applied_ids = await _applied_ids()
        if not primary_ids:
            primary_ids = list(all_applied_ids)
        return {
            "matches": await _hydrate(primary_ids),
            "all_applied": await _hydrate(all_applied_ids),
        }

    # Unspecified milestone -- preserve old behavior (notified pool).
    therapist_ids = req.get("notified_therapist_ids") or []
    return {"matches": await _hydrate(therapist_ids)}


# ═══════════════════════════════════════════════════════════════════════
# REPLAY -- read previously submitted feedback for a milestone
# ═══════════════════════════════════════════════════════════════════════

@router.get("/feedback/patient/{request_id}/{milestone}")
async def get_patient_submission(
    request_id: str,
    milestone: Literal["48h", "3w", "9w", "15w"],
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Return the existing patient feedback submission for {request_id,
    milestone} if it exists, else null.

    Used by the frontend to render replay-mode (read-only) surveys when
    the patient revisits a survey link they already submitted. Returns
    200 with body `null` when no doc exists -- the frontend uses null to
    distinguish 'not submitted yet' (200 + null) from 'auth failed' (401).

    Path-param order matters: this route is registered AFTER
    `/feedback/patient/{request_id}/matches` so /matches reaches that
    handler first. Literal validation on `milestone` also rejects any
    non-milestone path segment (matches, etc.) with a 422 even if order
    were swapped.
    """
    _verify_feedback_token(request_id, token, "patient", authorization)
    doc = await db.feedback.find_one(
        {"request_id": request_id, "milestone": milestone},
        {"_id": 0},
    )
    return doc


# ═══════════════════════════════════════════════════════════════════════
# FLOATING WIDGET — unchanged from v1
# ═══════════════════════════════════════════════════════════════════════

@router.post("/feedback/widget")
async def submit_widget_feedback(payload: WidgetFeedback):
    doc = {
        "id": str(uuid.uuid4()),
        "kind": "widget",
        "name": (payload.name or "").strip() or None,
        "email": payload.email or None,
        "role": payload.role or "anonymous",
        "message": payload.message.strip(),
        "source_url": (payload.source_url or "")[:500],
        "created_at": _now_iso(),
    }
    await db.feedback.insert_one(doc)

    try:
        from email_service import _wrap, BRAND
        who = doc["name"] or "Anonymous"
        contact_line = f"<p>{who}" + (f" · {doc['email']}" if doc["email"] else "") + "</p>"
        role_line = f"<p style='color:{BRAND['muted']};font-size:13px;'>Role: {doc['role']}</p>"
        src_line = (
            f"<p style='color:{BRAND['muted']};font-size:12px;'>From: "
            f"<a href='{doc['source_url']}'>{doc['source_url']}</a></p>"
            if doc["source_url"]
            else ""
        )
        body_html = (
            f"{contact_line}{role_line}"
            f"<div style='background:{BRAND['bg']};padding:16px 20px;border-radius:10px;"
            f"border:1px solid {BRAND['border']};margin:14px 0;font-size:15px;line-height:1.6;'>"
            f"{doc['message'].replace(chr(10), '<br>')}</div>{src_line}"
        )
        await _send(
            FEEDBACK_INBOX,
            f"[TheraVoca feedback] {doc['message'][:60]}",
            _wrap("New feedback", body_html),
        )
    except Exception as e:
        logger.warning("Feedback email relay failed: %s", e)
    return {"ok": True, "id": doc["id"]}


# ═══════════════════════════════════════════════════════════════════════
# RELIABILITY UPDATE HELPERS — running average pattern
# ═══════════════════════════════════════════════════════════════════════

async def _running_avg_update(
    therapist_id: str, field: str, new_value: float, window: int = 20
) -> None:
    """Update a reliability sub-field as a running average.
    Uses recency-weighted averaging over the last `window` data points."""
    t = await db.therapists.find_one({"id": therapist_id}, {"reliability": 1})
    if not t:
        return
    rel = t.get("reliability", {})
    history_key = f"{field}_history"
    history = rel.get(history_key, [])
    history.append(new_value)
    if len(history) > window:
        history = history[-window:]
    # Recency-weighted: more recent values count more
    weights = [1 + i * 0.1 for i in range(len(history))]
    avg = sum(h * w for h, w in zip(history, weights)) / sum(weights)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            f"reliability.{field}": round(avg, 4),
            f"reliability.{history_key}": history,
            "reliability.last_feedback_at": _now_iso(),
        }},
    )


async def _update_therapist_expectation_accuracy(
    therapist_id: str, match_value: str
) -> None:
    """Update therapist's expectation_accuracy via running average.
    Maps: yes=1.0, somewhat=0.5, no=0.0."""
    score_map = {"yes": 1.0, "somewhat": 0.5, "no": 0.0}
    score = score_map.get(match_value)
    if score is None:
        return
    await _running_avg_update(therapist_id, "expectation_accuracy", score)


async def _update_therapist_retention(
    therapist_id: str, field_name: str, still_seeing: str
) -> None:
    """Update retention_9w or retention_15w via running average.
    'yes' = 1.0, anything else = 0.0."""
    value = 1.0 if still_seeing == "yes" else 0.0
    await _running_avg_update(therapist_id, field_name, value)


async def _update_therapist_selection_rate(
    therapist_id: str, was_selected: bool
) -> None:
    """Update selection_rate via running average."""
    await _running_avg_update(
        therapist_id, "selection_rate", 1.0 if was_selected else 0.0
    )


async def _flag_for_intervention(
    request_id: str, therapist_id: str | None, confidence: int
) -> None:
    """Create intervention record + email admin when confidence < 75."""
    await db.interventions.insert_one({
        "id": str(uuid.uuid4()),
        "request_id": request_id,
        "therapist_id": therapist_id,
        "trigger": "low_confidence_3w",
        "confidence": confidence,
        "status": "pending",  # pending -> contacted -> resolved
        "created_at": _now_iso(),
    })
    await _flag_admin(
        "[TheraVoca] Low confidence alert — intervention needed",
        f"<p>Patient confidence score: <strong>{confidence}/100</strong></p>"
        f"<p>Therapist ID: {therapist_id or 'N/A'}</p>"
        f"<p>Request ID: {request_id}</p>"
        f"<p style='color:#666;font-size:13px;'>This patient may need a replacement match or follow-up.</p>",
    )


async def _flag_admin(subject: str, body_html: str) -> None:
    """Send an alert email to the admin inbox."""
    try:
        from email_service import _wrap
        await _send(
            FEEDBACK_INBOX,
            subject,
            _wrap(subject, body_html),
        )
    except Exception as e:
        logger.warning("Admin flag email failed: %s", e)


# ═══════════════════════════════════════════════════════════════════════
# PASSIVE DATA TRACKING — update response_rate on therapist actions
# ═══════════════════════════════════════════════════════════════════════

async def update_therapist_response_rate(therapist_id: str, responded: bool) -> None:
    """Called when a therapist applies/declines (responded=True) or when
    a referral expires without action (responded=False). Updates the
    running response_rate in therapist.reliability."""
    await _running_avg_update(
        therapist_id, "response_rate", 1.0 if responded else 0.0
    )


# ═══════════════════════════════════════════════════════════════════════
# LOOKUP + MATCH STRENGTH HELPERS
# ═══════════════════════════════════════════════════════════════════════

async def _get_therapist_for_request(request_id: str) -> str | None:
    """Look up which therapist was chosen for a request from the 3w survey."""
    fb_3w = await db.feedback.find_one(
        {"request_id": request_id, "kind": "patient_3w"},
        {"chosen_therapist_id": 1, "chosen_status": 1},
    )
    if fb_3w and fb_3w.get("chosen_status") == "picked":
        return fb_3w.get("chosen_therapist_id")
    return None


async def _build_match_strength_data(
    request_id: str,
    payload_9w: PatientFeedback9w | None = None,
    payload_15w: PatientFeedback15w | None = None,
) -> dict:
    """Assemble the Match Strength input dict from accumulated feedback.
    The dict keys match what matching.calculate_match_strength() expects."""
    ms_data: dict = {}

    # Pull 3w data from DB
    fb_3w = await db.feedback.find_one(
        {"request_id": request_id, "kind": "patient_3w"},
        {"confidence": 1, "expectation_match": 1},
    )
    if fb_3w:
        ms_data["confidence_3w"] = fb_3w.get("confidence", 50)
        ms_data["expectation_match_3w"] = fb_3w.get("expectation_match", "somewhat")

    # 9w data -- from payload if provided, else from DB
    if payload_9w:
        ms_data["feel_understood_9w"] = payload_9w.feel_understood
        ms_data["same_page_9w"] = payload_9w.same_page
        ms_data["still_seeing_9w"] = payload_9w.still_seeing
    else:
        fb_9w = await db.feedback.find_one(
            {"request_id": request_id, "kind": "patient_9w"},
            {"feel_understood": 1, "same_page": 1, "still_seeing": 1},
        )
        if fb_9w:
            ms_data["feel_understood_9w"] = fb_9w.get("feel_understood")
            ms_data["same_page_9w"] = fb_9w.get("same_page")
            ms_data["still_seeing_9w"] = fb_9w.get("still_seeing")

    # 15w data -- from payload if provided
    if payload_15w:
        ms_data["progress_15w"] = payload_15w.progress
        ms_data["still_seeing_15w"] = payload_15w.still_seeing

    return ms_data
