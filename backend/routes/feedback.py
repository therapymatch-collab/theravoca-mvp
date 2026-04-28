"""Feedback capture — patient/therapist follow-ups + floating widget.

Public endpoints (no auth) for 3 feedback flows:
  1. Patient 48h follow-up   (POST /api/feedback/patient/{request_id})
  2. Patient 2-week follow-up (same endpoint; `milestone=2w`)
  3. Therapist 2-week follow-up (POST /api/feedback/therapist/{therapist_id})
  4. Floating-widget feedback  (POST /api/feedback/widget)

Every submission lands in the `feedback` collection, which the admin tab
in AdminDashboard.jsx lists. Widget submissions also email the team so
they show up in our shared inbox without anyone having to check the app.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, EmailStr

from deps import db
from email_service import _send

logger = logging.getLogger("theravoca.feedback")

router = APIRouter()

FEEDBACK_INBOX = os.environ.get("FEEDBACK_INBOX_EMAIL", "theravoca@gmail.com")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Patient follow-up ────────────────────────────────────────────────
class PatientFeedback(BaseModel):
    milestone: str = Field(pattern=r"^(48h|2w)$")
    # q1: Did you reach out to any matched therapist? (yes/no/browsing)
    reached_out: str
    # q2: How well did the matches fit what you were looking for?
    match_quality: int = Field(ge=1, le=5)
    # q3: Free-form — what would have made it better?
    notes: Optional[str] = ""


@router.post("/feedback/patient/{request_id}")
async def submit_patient_feedback(request_id: str, payload: PatientFeedback):
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 1})
    if not req:
        raise HTTPException(404, "Request not found")
    await db.feedback.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "patient",
        "request_id": request_id,
        "patient_email": req.get("email"),
        "milestone": payload.milestone,
        "reached_out": payload.reached_out,
        "match_quality": payload.match_quality,
        "notes": (payload.notes or "")[:2000],
        "created_at": _now_iso(),
    })
    return {"ok": True}


class TherapistFeedback(BaseModel):
    milestone: str = Field(pattern=r"^(2w|first_referral)$")
    referrals_quality: int = Field(ge=1, le=5)
    # q2: Have you booked any intake / consult from a TheraVoca referral?
    booked_any: str
    # q3: Free-form — what would you change?
    notes: Optional[str] = ""


@router.post("/feedback/therapist/{therapist_id}")
async def submit_therapist_feedback(therapist_id: str, payload: TherapistFeedback):
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "email": 1, "name": 1})
    if not t:
        raise HTTPException(404, "Therapist not found")
    await db.feedback.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "therapist",
        "therapist_id": therapist_id,
        "therapist_email": t.get("email"),
        "therapist_name": t.get("name"),
        "milestone": payload.milestone,
        "referrals_quality": payload.referrals_quality,
        "booked_any": payload.booked_any,
        "notes": (payload.notes or "")[:2000],
        "created_at": _now_iso(),
    })
    return {"ok": True}


# ── Floating feedback widget — unauthenticated, rate-limited ──────────
class WidgetFeedback(BaseModel):
    message: str = Field(min_length=5, max_length=2000)
    name: Optional[str] = ""
    email: Optional[EmailStr] = None
    source_url: Optional[str] = ""
    role: Optional[str] = ""  # 'patient' / 'therapist' / 'anonymous'


@router.post("/feedback/widget")
async def submit_widget_feedback(payload: WidgetFeedback):
    """Floating feedback widget — persisted AND emailed to the team inbox.
    Quiet-fails the email side so a bad SMTP config doesn't block the UI."""
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
