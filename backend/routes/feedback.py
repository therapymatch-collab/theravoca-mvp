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

from fastapi import APIRouter, Header, HTTPException, Path, Query
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
    answers with the match quality they experienced.

    `match_score_at_response` reflects the FINAL score (initial
    match_score + apply_fit bonus, capped at 100) so it matches what the
    survey UI displayed to the patient. `initial_match_score_at_response`
    is preserved separately for trend analysis.
    """
    app = await db.applications.find_one(
        {"request_id": request_id},
        {"_id": 0, "match_score": 1, "match_breakdown": 1, "apply_fit": 1},
        sort=[("match_score", -1)],
    )
    if not app:
        return {}
    out: dict[str, Any] = {}
    initial = app.get("match_score")
    fit = app.get("apply_fit") or 0
    if initial is not None:
        out["initial_match_score_at_response"] = initial
        out["apply_fit_bonus_at_response"] = fit
        out["match_score_at_response"] = min(100, round(initial + fit))
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


async def _verify_feedback_token(
    entity_id: str,
    token: Optional[str],
    entity_type: str = "patient",
    authorization: Optional[str] = None,
) -> None:
    """Verify a feedback token OR a valid session Bearer JWT.
    Raises 401/403 on failure.

    SECURITY (2026-05-16 audit, CRITICAL feedback IDOR): when accepting
    a session-authenticated request, this function MUST verify that
    the session's email owns the entity referenced in the URL.
    Previously any valid JWT was accepted, so a signed-in therapist
    could POST /feedback/patient/{any_request_id}/3w to manipulate
    NPS, trigger fake crisis alerts, or tank competitor stats.
    Resolution:
      - entity_type=patient: the session.email must match
        requests.email for the given request_id
      - entity_type=therapist: the session.email must match
        therapists.email for the given therapist_id (or be admin)
    Admin sessions still pass without ownership check (they're our
    own ops).
    """
    # Allow session-authenticated users (logged into portal) ONLY when
    # they actually own the entity in question.
    if not token and authorization:
        session = _decode_session_from_authorization(authorization)
        if session:
            sess_email = (session.get("email") or "").strip().lower()
            sess_role = session.get("role")
            # Admin sessions bypass ownership (own-system ops).
            if sess_role == "admin":
                return
            if not sess_email:
                raise HTTPException(401, "Session has no email; cannot verify ownership.")
            if entity_type == "patient":
                req = await db.requests.find_one(
                    {"id": entity_id},
                    {"_id": 0, "email": 1},
                )
                if not req:
                    raise HTTPException(404, "Request not found.")
                if (req.get("email") or "").strip().lower() != sess_email:
                    raise HTTPException(403, "Session does not own this request.")
                return
            if entity_type == "therapist":
                t = await db.therapists.find_one(
                    {"id": entity_id},
                    {"_id": 0, "email": 1},
                )
                if not t:
                    raise HTTPException(404, "Therapist not found.")
                if (t.get("email") or "").strip().lower() != sess_email:
                    raise HTTPException(403, "Session does not own this therapist.")
                return
            # Unknown entity_type -> fail closed.
            raise HTTPException(401, "Unknown entity type for session auth.")
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


class TherapistSurveyV3(BaseModel):
    """Phase 3 therapist survey -- match fit + NPS + ongoing-client conversion.
    One survey per (therapist_id, survey_number); cron increments survey_number
    each fire."""
    model_config = ConfigDict(extra="ignore")
    match_fit: int = Field(ge=1, le=4)            # 1=poor, 2=fair, 3=good, 4=excellent
    nps: int = Field(ge=0, le=10)
    new_patients: int = Field(ge=0)               # ongoing clients since last survey
    improvement_text: Optional[str] = Field(None, max_length=2000)


class WidgetFeedback(BaseModel):
    message: str = Field(min_length=5, max_length=2000)
    name: Optional[str] = ""
    email: Optional[EmailStr] = None
    source_url: Optional[str] = ""
    role: Optional[str] = ""
    # 2026-05-16 security: floating widget is a public unauth
    # endpoint. Frontend should attach a Cloudflare Turnstile token;
    # backend verifies + fails-soft if Turnstile isn't configured.
    turnstile_token: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════
# PATIENT FEEDBACK — 48h / 3w / 9w / 15w
# ═══════════════════════════════════════════════════════════════════════

@router.post("/feedback/patient/{request_id}/48h")
async def submit_patient_48h(
    request_id: str, payload: PatientFeedback48h,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """48h soft touch -- process feedback only, no reliability updates."""
    await _verify_feedback_token(request_id, token, "patient", authorization)
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
    crisis = await _handle_crisis_flag(
        request_id, payload.model_dump(), "48h", doc["id"], req.get("email"),
    )
    return {"ok": True, "crisis_flagged": crisis}


@router.post("/feedback/patient/{request_id}/3w")
async def submit_patient_3w(
    request_id: str, payload: PatientFeedback3w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """3-week selection + first impressions."""
    await _verify_feedback_token(request_id, token, "patient", authorization)
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

    crisis = await _handle_crisis_flag(
        request_id, payload.model_dump(), "3w", doc["id"], req.get("email"),
    )
    return {"ok": True, "crisis_flagged": crisis}


@router.post("/feedback/patient/{request_id}/9w")
async def submit_patient_9w(
    request_id: str, payload: PatientFeedback9w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """9-week retention + Match Strength questions."""
    await _verify_feedback_token(request_id, token, "patient", authorization)
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

    crisis = await _handle_crisis_flag(
        request_id, payload.model_dump(), "9w", doc["id"], req.get("email"),
    )
    return {"ok": True, "crisis_flagged": crisis}


@router.post("/feedback/patient/{request_id}/15w")
async def submit_patient_15w(
    request_id: str, payload: PatientFeedback15w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """15-week outcome survey."""
    await _verify_feedback_token(request_id, token, "patient", authorization)
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

    crisis = await _handle_crisis_flag(
        request_id, payload.model_dump(), "15w", doc["id"], req.get("email"),
    )
    return {"ok": True, "crisis_flagged": crisis}


# =======================================================================
# CRISIS DETECTION
# =======================================================================
# When a patient's free-text mentions self-harm/suicide keywords OR they
# rate NPS=0, OR they say they're no longer seeing the therapist with
# negative sentiment, flag the doc and email admin. The patient's
# frontend is also notified (response carries crisis_flagged: true) so
# the survey thank-you page can surface the 988 hotline.

# Keep these patterns conservative -- false positives are fine; false
# negatives are not. Lower-cased before matching.
_CRISIS_KEYWORDS = (
    "suicide", "suicidal", "kill myself", "end my life", "end it all",
    "want to die", "wish i was dead", "wish i were dead",
    "self harm", "self-harm", "hurt myself", "harm myself",
    "no reason to live", "nothing to live for",
    "better off dead", "can't go on", "cant go on",
    "give up on life", "ending things", "take my life",
)


def _matched_crisis_keywords(text: Optional[str]) -> list[str]:
    if not text:
        return []
    lo = text.lower()
    return [kw for kw in _CRISIS_KEYWORDS if kw in lo]


def _check_crisis_indicators(payload_dict: dict, milestone: str) -> dict:
    """Return crisis-flag metadata for a submitted survey payload.

    Output shape:
      {triggered: bool, reasons: [str], matched_keywords: [str]}

    Triggers:
      - Any free-text field contains a crisis keyword
      - NPS == 0
      - 9w / 15w with still_seeing == 'no' AND negative free-text
    """
    reasons: list[str] = []
    matched: list[str] = []

    # 1. Keyword scan across every plausible free-text field.
    text_fields = (
        "improvement_text", "notes", "surprises", "what_changed",
        "final_reflection", "working_well", "not_working",
        "feedback_text", "issues",
    )
    combined = " ".join(
        str(payload_dict.get(f) or "") for f in text_fields
    ).strip()
    keyword_hits = _matched_crisis_keywords(combined)
    if keyword_hits:
        reasons.append("crisis_keyword_in_free_text")
        matched = keyword_hits

    # 2. NPS == 0 (most extreme detractor).
    nps = payload_dict.get("nps")
    if isinstance(nps, (int, float)) and int(nps) == 0:
        reasons.append("nps_zero")

    # 3. Dropped therapy with negative-leaning context (9w/15w).
    if milestone in ("9w", "15w") and payload_dict.get("still_seeing") == "no":
        # Any free-text at this milestone counts as worth surfacing.
        if combined and len(combined) > 20:
            reasons.append("dropped_with_comment")

    return {
        "triggered": bool(reasons),
        "reasons": reasons,
        "matched_keywords": matched,
    }


async def _handle_crisis_flag(
    request_id: str,
    payload_dict: dict,
    milestone: str,
    feedback_id: str,
    patient_email: Optional[str],
) -> bool:
    """If crisis indicators are present, persist the flag on the
    feedback doc and email admin. Returns True when flagged.
    Failures (email send, db update) are logged but don't break the
    survey submission -- the patient's response still gets saved."""
    check = _check_crisis_indicators(payload_dict, milestone)
    if not check["triggered"]:
        return False
    try:
        await db.feedback.update_one(
            {"id": feedback_id},
            {"$set": {
                "crisis_flagged": True,
                "crisis_reasons": check["reasons"],
                "crisis_matched_keywords": check["matched_keywords"],
                "crisis_flagged_at": _now_iso(),
            }},
        )
    except Exception as e:
        logger.exception("Crisis flag DB update failed: %s", e)
    try:
        reason_str = ", ".join(check["reasons"])
        kw_str = ", ".join(check["matched_keywords"]) or "(none)"
        await _flag_admin(
            subject=f"CRISIS FLAG -- patient {patient_email or request_id}",
            body_html=(
                f"<p><strong>A patient survey response triggered crisis "
                f"escalation rules.</strong></p>"
                f"<p>Patient email: {patient_email or '(unknown)'}<br/>"
                f"Request ID: {request_id}<br/>"
                f"Milestone: {milestone}<br/>"
                f"Reasons: {reason_str}<br/>"
                f"Matched keywords: {kw_str}</p>"
                f"<p>The patient was shown the 988 Suicide &amp; Crisis "
                f"Lifeline + Crisis Text Line resources on the thank-you "
                f"page. Reach out within 24 hours.</p>"
            ),
        )
    except Exception as e:
        logger.exception("Crisis flag admin email failed: %s", e)
    logger.info(
        f"CRISIS_FLAG request={request_id} milestone={milestone} "
        f"reasons={check['reasons']}"
    )
    return True


# =======================================================================
# THERAPIST SURVEY (Phase 3) -- match fit + NPS + ongoing-client conversion
# =======================================================================
# (Weekly pulse feature deleted 2026-05-11 -- was never wired into a cron
# trigger and the front-end form was orphaned. See git history for the
# previous TherapistWeeklyPulse model + /pulse endpoint if it needs to be
# resurrected later.)

@router.get("/feedback/therapist/{therapist_id}/survey/{survey_number}")
async def get_therapist_survey(
    therapist_id: str,
    survey_number: int = Path(..., ge=1),
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Return the existing therapist survey submission for {therapist_id,
    survey_number} if it exists, else null.

    Used by the frontend to render replay-mode (read-only) when the therapist
    revisits a survey link they already submitted. Returns 200 with body
    `null` when no doc exists -- frontend distinguishes 'not submitted yet'
    (200 + null) from 'auth failed' (401)."""
    await _verify_feedback_token(therapist_id, token, "therapist", authorization)
    doc = await db.therapist_surveys.find_one(
        {"therapist_id": therapist_id, "survey_number": survey_number},
        {"_id": 0},
    )
    return doc


@router.post("/feedback/therapist/{therapist_id}/survey/{survey_number}")
async def submit_therapist_survey(
    therapist_id: str,
    payload: TherapistSurveyV3,
    survey_number: int = Path(..., ge=1),
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Submit a Phase 3 therapist survey response.

    Idempotent: one submission per (therapist_id, survey_number). Returns 409
    on duplicate (e.g. double-click Submit, or revisit-after-submit -- though
    the frontend renders read-only replay UI to prevent the latter).

    Side effect: updates `last_therapist_survey_submitted_at` on the therapist
    doc so the admin dashboard can see who has and hasn't responded. The
    paired `last_therapist_survey_sent_at` is set by the daily cron when it
    fires the survey email (C3, separate commit)."""
    await _verify_feedback_token(therapist_id, token, "therapist", authorization)
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "email": 1, "name": 1},
    )
    if not t:
        raise HTTPException(404, "Therapist not found")

    existing = await db.therapist_surveys.find_one(
        {"therapist_id": therapist_id, "survey_number": survey_number},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "Already submitted")

    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "therapist_id": therapist_id,
        "survey_number": survey_number,
        "survey_version": 3,
        "role": "therapist",
        **payload.model_dump(),
        "submitted_at": now,
    }
    await db.therapist_surveys.insert_one(doc)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"last_therapist_survey_submitted_at": now}},
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
    await _verify_feedback_token(request_id, token, "patient", authorization)
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
    await _verify_feedback_token(therapist_id, token, "therapist", authorization)
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
    await _verify_feedback_token(therapist_id, token, "therapist", authorization)
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
    await _verify_feedback_token(request_id, token, "patient", authorization)
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
        # Pull both the initial match_score (computed at intake, displayed
        # to patient + therapist on the original notification) AND the
        # apply_fit bonus (0-5 LLM-graded based on the therapist's actual
        # apply text). The combined `final_score` is what we surface in
        # surveys -- it reflects how the match performed AFTER the
        # therapist actually responded, which is more honest than the
        # pre-response score.
        apps: dict[str, dict] = {}
        async for a in db.applications.find(
            {"request_id": request_id, "therapist_id": {"$in": therapist_ids}},
            {"_id": 0, "therapist_id": 1, "match_score": 1, "apply_fit": 1},
        ):
            apps[a["therapist_id"]] = {
                "match_score": a.get("match_score"),
                "apply_fit": a.get("apply_fit") or 0,
            }
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
            app_data = apps.get(tid) or {}
            initial = app_data.get("match_score")
            fit = app_data.get("apply_fit") or 0
            # Final score caps at 100 -- a therapist with the max apply_fit
            # bonus on top of an already-high score shouldn't display 102.
            final = (
                min(100, round((initial or 0) + fit))
                if initial is not None else None
            )
            out.append({
                "therapist_id": tid,
                "therapist_name": t.get("name", "Therapist"),
                "match_score": final,        # what the survey UI displays
                "initial_match_score": initial,  # pre-apply for transparency
                "apply_fit_bonus": fit,
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
    await _verify_feedback_token(request_id, token, "patient", authorization)
    doc = await db.feedback.find_one(
        {"request_id": request_id, "milestone": milestone},
        {"_id": 0},
    )
    return doc


# ═══════════════════════════════════════════════════════════════════════
# FLOATING WIDGET — unchanged from v1
# ═══════════════════════════════════════════════════════════════════════

@router.post("/feedback/widget")
async def submit_widget_feedback(payload: WidgetFeedback, request: Request):
    """Floating feedback widget submission. Public endpoint.

    SECURITY (2026-05-16 audit, HIGH #4):
      1. Turnstile gate — previously absent. Public unauth endpoint
         was wide-open to bulk abuse / Resend deliverability harm.
      2. HTML/href injection in the admin relay email — `message`
         and `source_url` were interpolated into HTML/href context
         without escaping. Anyone could send the admin (FEEDBACK_INBOX)
         emails containing arbitrary HTML or malicious href payloads
         (drive-by phishing on admin click). All user-controlled
         strings now go through html.escape; the source_url is
         additionally constrained to http(s):// before being placed
         in an href.
    """
    # Turnstile gate (fail-soft when Turnstile not configured).
    try:
        from turnstile_service import verify_token as _verify_turnstile
        client_ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or None
        ok, ts_err = await _verify_turnstile(
            getattr(payload, "turnstile_token", None), ip=client_ip,
        )
        if not ok:
            raise HTTPException(400, ts_err or "Security check failed.")
    except HTTPException:
        raise
    except Exception as e:
        # Turnstile import / runtime failure -> log + allow (don't
        # break feedback when the bot-defense layer flaps). Aligns
        # with the rest of the codebase's fail-soft Turnstile policy.
        logger.warning("Turnstile not enforced on feedback widget: %s", e)

    # 2026-05-17 (Josh) -- open-text moderation. Run heuristic
    # checks against the message body BEFORE persisting so abusive
    # content never lands in the admin inbox. Pydantic already
    # enforces 5..2000 chars; this layer adds gibberish / profanity
    # / all-caps / link-spam checks.
    from text_moderation import validate_or_raise as _validate_text
    _validate_text(
        payload.message,
        field_name="Feedback message",
        min_length=5,
        max_length=2000,
        required=True,
        route="/api/feedback/widget",
        actor_email=payload.email,
    )

    import html as _html
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
        who_safe = _html.escape(doc["name"] or "Anonymous")
        email_safe = _html.escape(doc["email"] or "")
        role_safe = _html.escape(str(doc["role"] or "anonymous"))
        msg_safe = _html.escape(doc["message"] or "")
        # source_url: only allow http(s); reject everything else
        # (javascript:, data:, etc.) before placing in an href.
        raw_url = doc["source_url"] or ""
        url_safe = ""
        if raw_url.startswith("http://") or raw_url.startswith("https://"):
            url_safe = _html.escape(raw_url, quote=True)
        contact_line = (
            f"<p>{who_safe}"
            + (f" · {email_safe}" if email_safe else "")
            + "</p>"
        )
        role_line = (
            f"<p style='color:{BRAND['muted']};font-size:13px;'>"
            f"Role: {role_safe}</p>"
        )
        src_line = (
            f"<p style='color:{BRAND['muted']};font-size:12px;'>From: "
            f"<a href=\"{url_safe}\">{url_safe}</a></p>"
            if url_safe
            else ""
        )
        body_html = (
            f"{contact_line}{role_line}"
            f"<div style='background:{BRAND['bg']};padding:16px 20px;border-radius:10px;"
            f"border:1px solid {BRAND['border']};margin:14px 0;font-size:15px;line-height:1.6;'>"
            f"{msg_safe.replace(chr(10), '<br>')}</div>{src_line}"
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
