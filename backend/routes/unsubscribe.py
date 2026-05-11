"""Patient + therapist one-click unsubscribe flow.

CAN-SPAM requires every recurring/promotional email to carry a
one-click unsubscribe affordance that doesn't require a login. This
module owns the HMAC token helpers and the public endpoints that flip
the `unsubscribed` flag on a request (patient) or therapist doc.

Token strategy:
  - Unsubscribe tokens do NOT expire. A subscriber must be able to opt
    out months after the email was sent.
  - Signature = HMAC-SHA256(entity_id + ":" + role)[:32]
  - Re-using the JWT_SECRET keeps key management simple.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from deps import JWT_SECRET, db, logger
from helpers import _now_iso

router = APIRouter()


def generate_unsubscribe_token(entity_id: str, role: str = "patient") -> str:
    """HMAC-SHA256 signature over (entity_id, role). No expiry."""
    msg = f"{entity_id}:{role}:unsubscribe"
    return _hmac.new(
        JWT_SECRET.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()[:32]


def _verify_unsubscribe_token(entity_id: str, role: str, token: str) -> None:
    expected = generate_unsubscribe_token(entity_id, role)
    if not _hmac.compare_digest(token or "", expected):
        raise HTTPException(401, "Invalid unsubscribe link.")


def build_unsubscribe_url(app_url: str, entity_id: str, role: str = "patient") -> str:
    """Build the public unsubscribe URL embedded in email footers."""
    tok = generate_unsubscribe_token(entity_id, role)
    if role == "therapist":
        return f"{app_url}/unsubscribe/therapist/{entity_id}?token={tok}"
    return f"{app_url}/unsubscribe/patient/{entity_id}?token={tok}"


@router.post("/unsubscribe/patient/{request_id}")
async def unsubscribe_patient(
    request_id: str,
    token: str = Query(...),
) -> dict:
    """One-click patient unsubscribe. Sets `unsubscribed: True` on the
    request doc. Idempotent: calling twice is a no-op the second time."""
    _verify_unsubscribe_token(request_id, "patient", token)
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "email": 1, "unsubscribed": 1},
    )
    if not req:
        # Don't leak whether the request exists -- always return success
        # so spammers/phishers can't enumerate via this endpoint.
        return {"ok": True}
    if req.get("unsubscribed"):
        return {"ok": True, "already_unsubscribed": True, "email": req.get("email")}
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "unsubscribed": True,
            "unsubscribed_at": _now_iso(),
        }},
    )
    logger.info(f"Patient unsubscribed: request={request_id}")
    return {"ok": True, "email": req.get("email")}


@router.post("/unsubscribe/patient/{request_id}/resubscribe")
async def resubscribe_patient(
    request_id: str,
    token: str = Query(...),
) -> dict:
    """Restore subscription. Same token works for both directions so a
    misclick is one click away from being undone."""
    _verify_unsubscribe_token(request_id, "patient", token)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"unsubscribed": False, "resubscribed_at": _now_iso()}},
    )
    return {"ok": True}


@router.post("/unsubscribe/therapist/{therapist_id}")
async def unsubscribe_therapist(
    therapist_id: str,
    token: str = Query(...),
) -> dict:
    """One-click therapist unsubscribe. Sets `unsubscribed: True` on the
    therapist doc. Affects Phase 3 surveys, recruiting nudges, etc.
    Transactional emails (referral notifications, license-expiry alerts)
    are NOT skipped -- those are business-critical communications, not
    promotional."""
    _verify_unsubscribe_token(therapist_id, "therapist", token)
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "email": 1, "unsubscribed": 1},
    )
    if not t:
        return {"ok": True}
    if t.get("unsubscribed"):
        return {"ok": True, "already_unsubscribed": True, "email": t.get("email")}
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "unsubscribed": True,
            "unsubscribed_at": _now_iso(),
        }},
    )
    logger.info(f"Therapist unsubscribed: id={therapist_id}")
    return {"ok": True, "email": t.get("email")}


@router.post("/unsubscribe/therapist/{therapist_id}/resubscribe")
async def resubscribe_therapist(
    therapist_id: str,
    token: str = Query(...),
) -> dict:
    _verify_unsubscribe_token(therapist_id, "therapist", token)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"unsubscribed": False, "resubscribed_at": _now_iso()}},
    )
    return {"ok": True}
