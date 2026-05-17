"""SMS service for TheraVoca therapist notifications.

Pattern mirrors email_service.py:
  - Single `send_sms(to, body)` async helper
  - Reads creds + kill-switch + dev override from env on every call (hot reload)
  - Normalizes US phone numbers to E.164 format before sending
  - Provider is auto-selected:
      TELNYX_ENABLED=true  -> Telnyx HTTP API (preferred, post-cutover)
      TWILIO_ENABLED=true  -> Twilio SDK     (legacy fallback)
      both false           -> kill-switch, skip
  - Twilio call goes through `asyncio.to_thread` (sync SDK); Telnyx is
    native httpx async so it doesn't need a thread.
  - `TWILIO_DEV_OVERRIDE_TO` (or the alias `SMS_DEV_OVERRIDE_TO`) and
    `SMS_LIVE_MODE` apply to BOTH providers -- the safety guards are
    provider-agnostic.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from twilio.rest import Client

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)


def _twilio_enabled() -> bool:
    return os.environ.get("TWILIO_ENABLED", "false").strip().lower() == "true"


def _telnyx_enabled() -> bool:
    return os.environ.get("TELNYX_ENABLED", "false").strip().lower() == "true"


def _provider() -> str | None:
    """Returns the active SMS provider name, or None if both are off.

    Telnyx wins if both flags are on -- once we flip the cutover env var
    we want Telnyx to take traffic immediately, not silently keep using
    Twilio because the old flag was still set."""
    if _telnyx_enabled():
        return "telnyx"
    if _twilio_enabled():
        return "twilio"
    return None


def _enabled() -> bool:
    """Backwards-compat alias -- 'any provider enabled?'."""
    return _provider() is not None


def _client() -> Client | None:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not token:
        return None
    return Client(sid, token)


def _from_number() -> str:
    # Used by both providers. Telnyx-specific env wins when set so we
    # can keep different sender numbers per provider during cutover.
    return (os.environ.get("TELNYX_FROM_NUMBER", "")
            or os.environ.get("TWILIO_FROM_NUMBER", "")
            or os.environ.get("TWILIO_PHONE_NUMBER", "")).strip()


def _override_to() -> str:
    # Either name works -- TWILIO_DEV_OVERRIDE_TO is the historical name
    # and we keep it for backwards-compat; SMS_DEV_OVERRIDE_TO is the
    # provider-agnostic name we prefer going forward.
    return (os.environ.get("SMS_DEV_OVERRIDE_TO", "")
            or os.environ.get("TWILIO_DEV_OVERRIDE_TO", "")).strip()


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


async def _log_sms_send(
    *,
    intended_to: str,
    actual_to: str,
    body: str,
    sid: str | None,
    status: str | None,
    sent_ok: bool,
    blocked: bool = False,
    block_reason: str | None = None,
    provider: str | None = None,
) -> None:
    """Insert one row into `sms_sends` for every SMS attempt -- mirrors the
    `email_sends` audit table. Lets ops answer "what got SMS'd to real
    therapists" without relying on the Twilio/Telnyx console. Failures
    here are swallowed so a logging hiccup never blocks the actual send.

    Field shape: `twilio_sid` holds whatever opaque message id the
    provider returned (Twilio SM... or Telnyx UUID). When the provider
    is telnyx we ALSO populate `telnyx_id` so the Telnyx webhook
    matcher in routes/webhooks.py can update this row on
    `message.finalized`. `provider` records which path was taken so
    the admin dashboard can group by sender.
    """
    try:
        from deps import db as _db
        from datetime import datetime, timezone
        doc: dict[str, Any] = {
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "intended_to": intended_to,
            "actual_to": actual_to,
            "body_preview": (body or "")[:160],
            "twilio_sid": sid,        # legacy field, kept for the admin UI
            "twilio_status": status,  # legacy field, kept for the admin UI
            "sent_ok": bool(sent_ok),
            "blocked": bool(blocked),
            "block_reason": block_reason,
            "provider": provider or _provider() or "none",
        }
        if provider == "telnyx" and sid:
            doc["telnyx_id"] = sid  # the webhook will $set telnyx_status here
        await _db.sms_sends.insert_one(doc)
    except Exception as e:
        logger.warning("sms_sends log failed: %s", e)


async def _send_via_twilio(
    *, intended_to: str, actual_to: str, actual_body: str, from_: str,
) -> dict[str, Any] | None:
    """Twilio send path. Returns {sid,to,intended_to,status} on success,
    None on failure. Caller handles audit logging."""
    client = _client()
    if client is None:
        return None

    def _send_sync() -> Any:
        return client.messages.create(to=actual_to, from_=from_, body=actual_body)

    msg = await asyncio.to_thread(_send_sync)
    logger.info("Sent SMS via Twilio sid=%s status=%s", msg.sid, msg.status)
    return {"sid": msg.sid, "to": actual_to, "intended_to": intended_to,
            "status": msg.status, "provider": "twilio"}


async def _send_via_telnyx(
    *, intended_to: str, actual_to: str, actual_body: str, from_: str,
) -> dict[str, Any] | None:
    """Telnyx send path (HTTP API, no SDK).

    POST https://api.telnyx.com/v2/messages with Bearer auth. The
    `messaging_profile_id` is required for 10DLC/short-code routing in
    the US -- the bare from-number alone isn't enough for high-volume
    outbound. Returns the same dict shape as the Twilio path so callers
    don't care which provider sent the message.
    """
    api_key = os.environ.get("TELNYX_API_KEY", "").strip()
    profile_id = os.environ.get("TELNYX_MESSAGING_PROFILE_ID", "").strip()
    if not api_key:
        return None
    payload: dict[str, Any] = {
        "from": from_,
        "to": actual_to,
        "text": actual_body,
    }
    if profile_id:
        payload["messaging_profile_id"] = profile_id

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            "https://api.telnyx.com/v2/messages",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    # Telnyx returns 200 with {"data": {...}} on accept. 4xx/5xx ->
    # raise a RuntimeError that includes Telnyx's first error code +
    # title from the response body so the audit row's block_reason
    # tells the admin EXACTLY why Telnyx refused (e.g. "10010 -
    # messaging profile not found") instead of just "400 Bad
    # Request". Without this, the outer except in send_sms only
    # captures the bare HTTP status because httpx's HTTPStatusError
    # doesn't include the response body in str().
    if resp.status_code >= 400:
        try:
            err_body = resp.json() or {}
            errors = err_body.get("errors") or []
            first = errors[0] if errors else {}
            err_code = first.get("code") or "unknown"
            err_title = first.get("title") or first.get("detail") or "no detail"
            raise RuntimeError(f"telnyx {resp.status_code} {err_code} - {err_title}")
        except (ValueError, KeyError):
            raise RuntimeError(f"telnyx {resp.status_code} (no parseable error body)")
    data = (resp.json() or {}).get("data") or {}
    msg_id = data.get("id") or ""
    # `to[*].status` is "queued" on initial accept. Real delivery status
    # arrives later via the message.finalized webhook.
    to_entries = data.get("to") or []
    to_status = (to_entries[0].get("status") if to_entries else "") or "queued"
    logger.info("Sent SMS via Telnyx id=%s status=%s", msg_id, to_status)
    return {"sid": msg_id, "to": actual_to, "intended_to": intended_to,
            "status": to_status, "provider": "telnyx"}


async def send_sms(to: str, body: str, *, force: bool = False) -> dict[str, Any] | None:
    """Send an SMS. Returns {sid,to,intended_to,status,provider} on
    success, None on skip/failure.

    Provider auto-selection (highest precedence wins):
      1. TELNYX_ENABLED=true -> Telnyx HTTP API
      2. TWILIO_ENABLED=true -> Twilio SDK
      3. neither set         -> kill switch, skip entirely.

    Safety order (every send goes through ALL of these):
      1. provider kill switch       -> skip if both providers off.
      2. Pre-launch safety guard    -> if no DEV_OVERRIDE_TO is set
         AND SMS_LIVE_MODE!=true, refuse to send to any real number.
         Mirrors EMAIL_OVERRIDE_TO + EMAIL_LIVE_MODE -- "fail closed"
         so a misconfigured staging env can never page real therapists.
      3. DEV_OVERRIDE_TO            -> reroutes the message to the
         verified test number, prefixed with [was: <intended>].
      4. Provider creds + from-number -> required, else skip.

    If force=True, bypasses #1 and #2 (for the admin test-SMS endpoint
    where the admin explicitly chose to fire a live send).
    """
    active_provider = _provider()
    if not force and active_provider is None:
        logger.info("SMS disabled (no provider enabled), skipping send")
        await _log_sms_send(
            intended_to=to, actual_to=to, body=body,
            sid=None, status=None, sent_ok=False,
            blocked=True, block_reason="provider_disabled",
            provider="none",
        )
        return None
    # When force=True for a test send, still need to know which provider
    # to talk to. Default to telnyx if its API key is set, else twilio.
    if active_provider is None:
        active_provider = "telnyx" if os.environ.get("TELNYX_API_KEY", "").strip() else "twilio"

    from_ = _from_number()
    if not from_:
        logger.warning("%s from-number not configured, skipping SMS send", active_provider)
        await _log_sms_send(
            intended_to=to, actual_to=to, body=body,
            sid=None, status=None, sent_ok=False,
            blocked=True, block_reason="not_configured",
            provider=active_provider,
        )
        return None

    intended_to = normalize_us_phone(to)
    if not intended_to:
        logger.warning("Invalid phone format, skipping SMS")
        await _log_sms_send(
            intended_to=to, actual_to=to, body=body,
            sid=None, status=None, sent_ok=False,
            blocked=True, block_reason="invalid_phone_format",
            provider=active_provider,
        )
        return None

    override = normalize_us_phone(_override_to())
    # Pre-launch safety guard. Same three-state pattern as email:
    #   1. SMS_DEV_OVERRIDE_TO set -> redirect (safe testing).
    #   2. SMS_LIVE_MODE=true      -> allow real recipient (go-live).
    #   3. neither                 -> BLOCK any real send.
    # Without this guard, flipping a provider on for staging without
    # an override would silently SMS every real therapist phone in the
    # imported_xlsx directory. Fail closed.
    live_mode = os.environ.get("SMS_LIVE_MODE", "").strip().lower() == "true"
    if not force and not override and not live_mode:
        logger.warning(
            "PRELAUNCH BLOCK: refusing to SMS %s (real number). "
            "Set SMS_DEV_OVERRIDE_TO (or legacy TWILIO_DEV_OVERRIDE_TO) "
            "to redirect to a test phone, or SMS_LIVE_MODE=true to go live.",
            intended_to,
        )
        await _log_sms_send(
            intended_to=intended_to, actual_to=intended_to, body=body,
            sid=None, status=None, sent_ok=False,
            blocked=True, block_reason="prelaunch_safety_guard",
            provider=active_provider,
        )
        return None

    actual_to = override or intended_to
    actual_body = body
    if override and override != intended_to:
        actual_body = f"[was: {intended_to}]\n{body}"

    # Dry-run mode: short-circuit BEFORE the provider call so we exercise
    # the whole code path (cron triggers, normalization, audit log) but
    # never spend a credit or page anyone. Use this when you want to
    # verify "would the right therapists have been SMS'd?" without
    # hammering your own cell. Marks the audit row with a recognisable
    # status so it's easy to filter out of real-traffic dashboards.
    dry_run = os.environ.get("SMS_DRY_RUN", "").strip().lower() == "true"
    if dry_run:
        logger.info(
            "SMS_DRY_RUN: would have sent via %s to %s (intended=%s) body=%s",
            active_provider, actual_to, intended_to, actual_body[:80],
        )
        await _log_sms_send(
            intended_to=intended_to, actual_to=actual_to, body=actual_body,
            sid="dry-run", status="dry_run", sent_ok=True,
            provider=active_provider,
        )
        return {"sid": "dry-run", "to": actual_to,
                "intended_to": intended_to, "status": "dry_run",
                "provider": active_provider}

    try:
        if active_provider == "telnyx":
            result = await _send_via_telnyx(
                intended_to=intended_to, actual_to=actual_to,
                actual_body=actual_body, from_=from_,
            )
        else:
            result = await _send_via_twilio(
                intended_to=intended_to, actual_to=actual_to,
                actual_body=actual_body, from_=from_,
            )
        if result is None:
            # Provider creds incomplete -- the per-provider helper
            # returns None when its API key / SDK client is missing.
            await _log_sms_send(
                intended_to=intended_to, actual_to=actual_to, body=actual_body,
                sid=None, status=None, sent_ok=False,
                blocked=True, block_reason=f"{active_provider}_not_configured",
                provider=active_provider,
            )
            return None
        await _log_sms_send(
            intended_to=intended_to, actual_to=actual_to, body=actual_body,
            sid=result.get("sid"), status=result.get("status"), sent_ok=True,
            provider=active_provider,
        )
        return result
    except Exception as e:
        logger.exception("Failed to send SMS via %s: %s", active_provider, e)
        # httpx errors include the response body in str(e); truncate
        # to keep the audit row readable. 2026-05-17: bumped from
        # 120 -> 300 because Telnyx's RuntimeError message format
        # ("telnyx 400 10010 - messaging_profile_id not found and
        # several more chars of context") gets clipped mid-reason
        # at 120, hiding the part that says WHY the send failed.
        await _log_sms_send(
            intended_to=intended_to, actual_to=actual_to, body=actual_body,
            sid=None, status=None, sent_ok=False,
            blocked=True, block_reason=f"{active_provider}_exception:{str(e)[:300]}",
            provider=active_provider,
        )
        return None


# ---------------------------------------------------------------------------
# Editable SMS templates — stored in db.site_copy, with hardcoded fallbacks
# ---------------------------------------------------------------------------
# Template keys and their defaults. Placeholders use {curly_braces}.
SMS_TEMPLATE_DEFAULTS: dict[str, str] = {
    "sms.therapist_referral": (
        "TheraVoca: New referral matched to you ({match_score}%). "
        "Tap to review & apply within 24h: {apply_url}"
    ),
    "sms.patient_intake_receipt": (
        "TheraVoca: Got your referral — we're routing it to therapists in your "
        "state right now. You'll see your matches by email within 24 hours. "
        "Reply STOP to opt out."
    ),
    "sms.availability_prompt": (
        "TheraVoca: Hi {first_name} — quick check, is your same-week availability "
        "still current? Confirm or update in 10 sec: {portal_url}?confirmAvailability=1"
    ),
}


async def _get_template(key: str) -> str:
    """Load an SMS template from site_copy, falling back to the hardcoded default."""
    try:
        from deps import db  # late import to avoid circular deps
        doc = await db.site_copy.find_one({"key": key})
        if doc and doc.get("value"):
            logger.debug("SMS template '%s' loaded from MongoDB", key)
            return doc["value"]
    except ImportError:
        logger.error("Failed to import db from deps — SMS templates will use hardcoded defaults")
    except Exception as e:
        logger.warning("Failed to load SMS template '%s' from MongoDB: %s", key, e)
    return SMS_TEMPLATE_DEFAULTS.get(key, "")


async def send_therapist_referral_sms(
    to: str,
    therapist_first_name: str,
    match_score: float,
    apply_url: str,
) -> dict[str, Any] | None:
    """Short transactional SMS for new high-match referrals."""
    template = await _get_template("sms.therapist_referral")
    first = (therapist_first_name or "there").split(" ")[0]
    body = template.format(
        first_name=first,
        match_score=int(round(match_score)),
        apply_url=apply_url,
    )
    return await send_sms(to, body)


async def send_patient_intake_receipt_sms(to: str) -> dict[str, Any] | None:
    """Confirmation text to a patient right after they submit a referral.
    Tells them we'll email matches inside 24h and how to reach support."""
    template = await _get_template("sms.patient_intake_receipt")
    body = template.format()  # no placeholders in default
    return await send_sms(to, body)


async def send_availability_prompt_sms(
    to: str, therapist_first_name: str, portal_url: str
) -> dict[str, Any] | None:
    """Weekly SMS reminder (Mondays) asking the therapist to refresh
    availability. Email + SMS fire together from the same cron path."""
    first = (therapist_first_name or "there").split(" ")[0]
    template = await _get_template("sms.availability_prompt")
    body = template.format(first_name=first, portal_url=portal_url)
    return await send_sms(to, body)
