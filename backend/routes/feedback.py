"""Feedback system v5 — timeline-aligned patient/therapist follow-ups.

Surveys at 4 patient touchpoints (48h, 3w, 9w, 15w), a conditional 5w
follow-up, and a weekly therapist pulse.  All feed into the matching
engine's therapist reliability score, TAI, and expectation accuracy.

Timeline:
  48h   Soft touch check-in (process feedback, relationship building)
  3w    Selection + first impressions (who picked, confidence, expectation)
  5w    Follow-up only if patient chose "still_deciding" at 3w
  9w    Retention + TAI questions (still seeing, bond, goals)
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
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from deps import db, JWT_SECRET, _decode_session_from_authorization
from email_service import _send

logger = logging.getLogger("theravoca.feedback")

router = APIRouter()

FEEDBACK_INBOX = os.environ.get("FEEDBACK_INBOX_EMAIL", "theravoca@gmail.com")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    """48-hour soft touch check-in — process feedback, not a real survey."""
    process_rating: str  # "great" | "fine" | "had_issues"
    issues_text: Optional[str] = None
    started_reaching_out: str  # "yes" | "not_yet"


class PatientFeedback3w(BaseModel):
    """3-week selection + first impressions."""
    chosen_therapist_id: Optional[str] = None  # therapist id string or None
    chosen_status: str  # "picked" | "still_deciding" | "none"
    had_session: str  # "yes" | "scheduled" | "no"
    confidence: int = Field(ge=0, le=100)
    expectation_match: str  # "yes" | "somewhat" | "no"
    surprise_text: Optional[str] = None
    notes: Optional[str] = None


class PatientFeedback9w(BaseModel):
    """9-week retention + TAI questions."""
    still_seeing: str  # "yes" | "no" | "switched"
    session_count: str  # "1-3" | "4-6" | "7+" | "none"
    whats_working: str
    whats_not: Optional[str] = None
    feel_understood: int = Field(ge=1, le=5)  # TAI Bond
    same_page: int = Field(ge=1, le=5)  # TAI Goals
    recommend_therapist: int = Field(ge=1, le=10)
    recommend_theravoca: int = Field(ge=1, le=10)


class PatientFeedback15w(BaseModel):
    """15-week outcome survey."""
    still_seeing: str  # "yes" | "no" | "switched"
    progress: int = Field(ge=1, le=10)
    refer_therapist: str  # "yes" | "maybe" | "no"
    refer_theravoca: str  # "yes" | "maybe" | "no"
    what_changed: str
    notes: Optional[str] = None


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
    """48h soft touch — process feedback only, no reliability updates."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 1})
    if not req:
        raise HTTPException(404, "Request not found")

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_48h",
        "milestone": "48h",
        "request_id": request_id,
        "patient_email": req.get("email"),
        **payload.model_dump(),
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
    req = await db.requests.find_one(
        {"id": request_id},
        {"_id": 0, "email": 1, "notified_therapist_ids": 1},
    )
    if not req:
        raise HTTPException(404, "Request not found")

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_3w",
        "milestone": "3w",
        "request_id": request_id,
        "patient_email": req.get("email"),
        **payload.model_dump(),
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
    if payload.confidence < 75:
        await _flag_for_intervention(
            request_id, payload.chosen_therapist_id, payload.confidence
        )

    return {"ok": True}


@router.post("/feedback/patient/{request_id}/9w")
async def submit_patient_9w(
    request_id: str, payload: PatientFeedback9w,
    token: Optional[str] = Query(None), authorization: Optional[str] = Header(None),
):
    """9-week retention + TAI questions."""
    _verify_feedback_token(request_id, token, "patient", authorization)
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 1})
    if not req:
        raise HTTPException(404, "Request not found")

    # Look up the chosen therapist from the 3w survey
    therapist_id = await _get_therapist_for_request(request_id)

    # Build TAI data from accumulated feedback
    tai_score = -1.0
    if therapist_id:
        tai_data = await _build_tai_data(request_id, payload)
        from matching import calculate_tai
        tai_score = calculate_tai(tai_data)

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_9w",
        "milestone": "9w",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "therapist_id": therapist_id,
        **payload.model_dump(),
        "tai_score": tai_score,
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
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 1})
    if not req:
        raise HTTPException(404, "Request not found")

    therapist_id = await _get_therapist_for_request(request_id)

    # Build full TAI data from all milestones
    tai_score = -1.0
    if therapist_id:
        tai_data = await _build_tai_data(request_id, None, payload)
        from matching import calculate_tai
        tai_score = calculate_tai(tai_data)

    doc = {
        "id": str(uuid.uuid4()),
        "kind": "patient_15w",
        "milestone": "15w",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "therapist_id": therapist_id,
        **payload.model_dump(),
        "tai_score": tai_score,
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
# LOOKUP + TAI HELPERS
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


async def _build_tai_data(
    request_id: str,
    payload_9w: PatientFeedback9w | None = None,
    payload_15w: PatientFeedback15w | None = None,
) -> dict:
    """Assemble the TAI input dict from accumulated feedback for a request.
    The dict keys match what matching.calculate_tai() expects."""
    tai_data: dict = {}

    # Pull 3w data from DB
    fb_3w = await db.feedback.find_one(
        {"request_id": request_id, "kind": "patient_3w"},
        {"confidence": 1, "expectation_match": 1},
    )
    if fb_3w:
        tai_data["confidence_3w"] = fb_3w.get("confidence", 50)
        tai_data["expectation_match_3w"] = fb_3w.get("expectation_match", "somewhat")

    # 9w data — from payload if provided, else from DB
    if payload_9w:
        tai_data["feel_understood_9w"] = payload_9w.feel_understood
        tai_data["same_page_9w"] = payload_9w.same_page
        tai_data["still_seeing_9w"] = payload_9w.still_seeing
    else:
        fb_9w = await db.feedback.find_one(
            {"request_id": request_id, "kind": "patient_9w"},
            {"feel_understood": 1, "same_page": 1, "still_seeing": 1},
        )
        if fb_9w:
            tai_data["feel_understood_9w"] = fb_9w.get("feel_understood")
            tai_data["same_page_9w"] = fb_9w.get("same_page")
            tai_data["still_seeing_9w"] = fb_9w.get("still_seeing")

    # 15w data — from payload if provided
    if payload_15w:
        tai_data["progress_15w"] = payload_15w.progress
        tai_data["still_seeing_15w"] = payload_15w.still_seeing

    return tai_data
