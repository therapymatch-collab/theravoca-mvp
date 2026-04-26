"""Twilio SMS service for TheraVoca therapist notifications.

Pattern mirrors email_service.py:
  - Single `send_therapist_referral_sms(to, body)` async helper
  - Reads creds + kill-switch + dev override from env on every call (hot reload)
  - Normalizes US phone numbers to E.164 format before sending
  - Wraps Twilio SDK in `asyncio.to_thread` so the FastAPI event loop never blocks
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from twilio.rest import Client

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.environ.get("TWILIO_ENABLED", "false").strip().lower() == "true"


def _client() -> Client | None:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not token:
        return None
    return Client(sid, token)


def _from_number() -> str:
    return os.environ.get("TWILIO_FROM_NUMBER", "").strip()


def _override_to() -> str:
    return os.environ.get("TWILIO_DEV_OVERRIDE_TO", "").strip()


def normalize_us_phone(raw: str) -> str | None:
    """Return E.164 (+1XXXXXXXXXX) for a US phone, or None if unparseable."""
    if not raw:
        return None
    # Already E.164
    if raw.startswith("+") and len(raw) >= 10:
        digits = re.sub(r"\D", "", raw[1:])
        if digits and 10 <= len(digits) <= 15:
            return f"+{digits}"
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


async def send_sms(to: str, body: str) -> dict[str, Any] | None:
    """Send an SMS. Returns Twilio message dict on success, None on skip/failure.

    Honors:
      * TWILIO_ENABLED=false → no-op (dev kill switch)
      * TWILIO_DEV_OVERRIDE_TO → reroutes every SMS to a single verified number
        (essential for Twilio trial accounts)
    """
    if not _enabled():
        logger.info("SMS disabled (TWILIO_ENABLED!=true), would have sent to %s", to)
        return None

    client = _client()
    from_ = _from_number()
    if client is None or not from_:
        logger.warning("Twilio not fully configured, skipping SMS to %s", to)
        return None

    intended_to = normalize_us_phone(to)
    if not intended_to:
        logger.warning("Invalid phone %r, skipping SMS", to)
        return None

    override = normalize_us_phone(_override_to())
    actual_to = override or intended_to
    actual_body = body
    if override and override != intended_to:
        actual_body = f"[was: {intended_to}]\n{body}"

    def _send_sync() -> Any:
        return client.messages.create(to=actual_to, from_=from_, body=actual_body)

    try:
        msg = await asyncio.to_thread(_send_sync)
        logger.info(
            "Sent SMS sid=%s to %s (intended %s) status=%s",
            msg.sid, actual_to, intended_to, msg.status,
        )
        return {"sid": msg.sid, "to": actual_to, "intended_to": intended_to,
                "status": msg.status}
    except Exception as e:
        logger.exception("Failed to send SMS to %s: %s", actual_to, e)
        return None


async def send_therapist_referral_sms(
    to: str,
    therapist_first_name: str,
    match_score: float,
    apply_url: str,
) -> dict[str, Any] | None:
    """Short transactional SMS for new high-match referrals."""
    body = (
        f"TheraVoca: New referral matched to you ({int(round(match_score))}%). "
        f"Tap to review & apply within 24h: {apply_url}"
    )
    return await send_sms(to, body)
