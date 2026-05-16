"""Patient + therapist one-click unsubscribe flow.

CAN-SPAM requires every recurring/promotional email to carry a
one-click unsubscribe affordance that doesn't require a login. This
module owns the HMAC token helpers and the public endpoints that flip
the `unsubscribed` flag on a request (patient) or therapist doc.

Token strategy:
  - Token = "<expires_unix>.<sig>" where sig = HMAC-SHA256
    (entity_id + ":" + role + ":" + expires_unix)[:32].
  - Default 365-day lifetime. Long enough that someone can unsubscribe
    months after the email was sent; short enough that a leaked URL
    (logs, browser history, archived inbox) doesn't grant a perpetual
    opt-out vector against the whole user base. (2026-05-16 security
    audit MEDIUM #10.)
  - Re-using the JWT_SECRET keeps key management simple.
  - Success responses NO LONGER include the recipient email so an
    attacker who guesses or steals a URL can't enumerate addresses
    from the response body.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from deps import JWT_SECRET, db, logger
from helpers import _now_iso

router = APIRouter()


_DEFAULT_TTL_DAYS = 365


def _sign_unsub(entity_id: str, role: str, expires_unix: int) -> str:
    msg = f"{entity_id}:{role}:{expires_unix}:unsubscribe"
    return _hmac.new(
        JWT_SECRET.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()[:32]


def generate_unsubscribe_token(
    entity_id: str, role: str = "patient", ttl_days: int = _DEFAULT_TTL_DAYS,
) -> str:
    """Build an expiring HMAC token. Format: `<expires_unix>.<sig>`."""
    expires = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    expires_unix = int(expires.timestamp())
    sig = _sign_unsub(entity_id, role, expires_unix)
    return f"{expires_unix}.{sig}"


def _verify_unsubscribe_token(entity_id: str, role: str, token: str) -> None:
    """Reject expired or tampered tokens. Constant-time HMAC compare."""
    if not token:
        raise HTTPException(401, "Invalid unsubscribe link.")
    parts = token.split(".", 1)
    if len(parts) != 2:
        raise HTTPException(401, "Invalid unsubscribe link.")
    expires_str, sig = parts
    try:
        expires_unix = int(expires_str)
    except (ValueError, TypeError):
        raise HTTPException(401, "Invalid unsubscribe link.")
    if datetime.fromtimestamp(expires_unix, tz=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(401, "This unsubscribe link has expired. Please email support@theravoca.com.")
    expected = _sign_unsub(entity_id, role, expires_unix)
    if not _hmac.compare_digest(sig, expected):
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
        {"id": request_id}, {"_id": 0, "unsubscribed": 1},
    )
    if not req:
        # Don't leak whether the request exists -- always return success
        # so spammers/phishers can't enumerate via this endpoint.
        return {"ok": True}
    if req.get("unsubscribed"):
        return {"ok": True, "already_unsubscribed": True}
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "unsubscribed": True,
            "unsubscribed_at": _now_iso(),
        }},
    )
    logger.info(f"Patient unsubscribed: request={request_id}")
    return {"ok": True}


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
        {"id": therapist_id}, {"_id": 0, "unsubscribed": 1},
    )
    if not t:
        return {"ok": True}
    if t.get("unsubscribed"):
        return {"ok": True, "already_unsubscribed": True}
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "unsubscribed": True,
            "unsubscribed_at": _now_iso(),
        }},
    )
    logger.info(f"Therapist unsubscribed: id={therapist_id}")
    return {"ok": True}


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
