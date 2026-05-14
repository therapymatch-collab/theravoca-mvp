"""Inbound webhook handlers from third-party services.

Resend (transactional email delivery):
  POST /api/webhooks/resend  -- receives lifecycle events for every
                                outbound email we send. Updates
                                `outreach_invites` with delivered/
                                opened/bounced/complained timestamps
                                and records hard-bounced addresses in
                                a registry so the outreach cooldown
                                filter can skip them forever.

Signature scheme: Svix (https://docs.svix.com/receiving/verifying-payloads).
Headers:
  - svix-id          message id
  - svix-timestamp   unix seconds
  - svix-signature   "v1,<base64-sig>" (possibly multiple)
Secret: RESEND_WEBHOOK_SECRET env, prefixed `whsec_`.

The signed payload is `{svix-id}.{svix-timestamp}.{raw-body}` and the
expected signature is HMAC-SHA256 with the decoded secret. We reject
timestamps older than 5 minutes to mitigate replay.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

from deps import db, logger
from helpers import _now_iso

router = APIRouter()

SVIX_TOLERANCE_SECONDS = 5 * 60


def _decode_resend_secret(secret: str) -> Optional[bytes]:
    """Resend webhook secrets are prefixed `whsec_` followed by base64.
    Return the decoded bytes or None if the format is wrong."""
    if not secret:
        return None
    s = secret.strip()
    if s.startswith("whsec_"):
        s = s[len("whsec_"):]
    try:
        return base64.b64decode(s)
    except Exception:
        return None


def _verify_svix(
    secret: str,
    body: bytes,
    svix_id: str,
    svix_timestamp: str,
    svix_signature: str,
) -> bool:
    """Verify a Svix-style signature header against the raw body. Returns
    True only if at least one of the v1 sigs matches AND the timestamp
    is within tolerance.
    """
    decoded_secret = _decode_resend_secret(secret)
    if not decoded_secret or not svix_id or not svix_timestamp or not svix_signature:
        return False
    try:
        ts = int(svix_timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - ts) > SVIX_TOLERANCE_SECONDS:
        logger.warning("Resend webhook: timestamp outside tolerance window")
        return False
    signed_payload = f"{svix_id}.{svix_timestamp}.".encode() + body
    expected_sig = base64.b64encode(
        hmac.new(decoded_secret, signed_payload, hashlib.sha256).digest()
    ).decode()
    # Header may contain multiple comma-separated sigs ("v1,sigA v1,sigB"
    # or "v1,sigA,v1,sigB"). Match if ANY equals our expected sig.
    for part in svix_signature.replace(",", " ").split():
        if part.startswith("v1,"):
            candidate = part[len("v1,"):]
            if hmac.compare_digest(candidate, expected_sig):
                return True
    return False


@router.post("/webhooks/resend")
async def resend_webhook(request: Request) -> dict[str, Any]:
    """Resend webhook receiver. Records delivery + engagement events on
    the matching outreach_invites row (when we can find one) and
    accumulates hard-bounced addresses in `bounced_emails` so the
    outreach cooldown filter can skip them.

    Match priority for an event -> invite:
      1. Exact match on `resend_email_id` (most reliable; only available
         when we stored it on send).
      2. Fallback: most recent outreach_invite with matching
         candidate.email and a created_at within the last 30 days.

    Match miss is logged but doesn't 4xx -- transactional emails (patient
    verification, results, surveys) also flow through Resend; we just
    don't have invite rows for those yet. Future ticket can extend this
    to a generic `email_events` collection covering all outbound mail
    so the Outbound admin tab can render every send.
    """
    secret = (os.environ.get("RESEND_WEBHOOK_SECRET") or "").strip()
    if not secret:
        # Fail closed in non-dev environments. We don't want to silently
        # accept unverified events.
        logger.warning("Resend webhook called but RESEND_WEBHOOK_SECRET not set")
        raise HTTPException(503, "webhook not configured")

    body = await request.body()
    svix_id = request.headers.get("svix-id", "")
    svix_ts = request.headers.get("svix-timestamp", "")
    svix_sig = request.headers.get("svix-signature", "")

    if not _verify_svix(secret, body, svix_id, svix_ts, svix_sig):
        logger.warning("Resend webhook: signature verification failed")
        raise HTTPException(401, "invalid signature")

    import json as _json
    try:
        event = _json.loads(body)
    except Exception:
        raise HTTPException(400, "invalid json")

    etype = (event.get("type") or "").lower()
    data = event.get("data") or {}
    email_id = data.get("email_id") or data.get("id")
    # `to` can be string or list depending on send shape.
    to_field = data.get("to")
    recipients: list[str] = []
    if isinstance(to_field, str):
        recipients = [to_field.lower()]
    elif isinstance(to_field, list):
        recipients = [str(x).lower() for x in to_field if x]
    created_at = data.get("created_at") or _now_iso()

    if not etype:
        return {"ok": True, "skipped": "no_type"}

    # Map event type -> field we stamp on the invite row.
    field_for_event = {
        "email.delivered": "delivered_at",
        "email.opened": "opened_at",
        "email.clicked": "clicked_at",
        "email.bounced": "bounced_at",
        "email.complained": "complained_at",
        "email.delivery_delayed": "delayed_at",
    }
    field = field_for_event.get(etype)
    if not field:
        return {"ok": True, "skipped": f"unhandled_event:{etype}"}

    is_hard_bounce = etype == "email.bounced" and (
        (data.get("bounce_type") or "").lower() == "hard"
    )

    # ── Locate the invite row ──
    invite: Optional[dict] = None
    if email_id:
        invite = await db.outreach_invites.find_one(
            {"resend_email_id": email_id}, {"_id": 0, "id": 1},
        )
    if not invite and recipients:
        invite = await db.outreach_invites.find_one(
            {
                "candidate.email": {"$in": recipients},
                # Fallback match: scope to recent sends to avoid mapping
                # this event to an unrelated invite from months ago.
                "created_at": {
                    "$gte": (
                        datetime.now(timezone.utc).replace(microsecond=0)
                        .replace(day=max(1, datetime.now(timezone.utc).day - 30))
                        .isoformat()
                    ),
                },
            },
            {"_id": 0, "id": 1},
            sort=[("created_at", -1)],
        )

    update_set: dict[str, Any] = {field: _now_iso(), "updated_at": _now_iso()}
    if etype == "email.bounced":
        update_set["bounce_type"] = (data.get("bounce_type") or "").lower() or None
        update_set["bounce_reason"] = data.get("reason") or data.get("message") or None
    if invite:
        await db.outreach_invites.update_one(
            {"id": invite["id"]}, {"$set": update_set},
        )

    # Always log the event into a generic email_events stream so the
    # Outbound admin tab can render delivery state for ALL outbound
    # email -- not just outreach invites. Verification emails, match
    # results, surveys, and the claim campaign all flow through the
    # same Resend pipeline; without this every non-outreach event
    # would be silently dropped from the admin feed.
    try:
        await db.email_events.insert_one({
            "event_type": etype,
            "received_at": _now_iso(),
            "resend_email_id": email_id,
            "to": recipients[0] if recipients else None,
            "subject": data.get("subject"),
            "from": data.get("from"),
            "invite_id": invite["id"] if invite else None,
            "is_hard_bounce": is_hard_bounce,
            "bounce_type": (data.get("bounce_type") or "").lower() or None,
            "bounce_reason": data.get("reason") or data.get("message") or None,
            "raw_created_at": created_at,
        })
    except Exception as e:
        # Don't fail the webhook on event-log write failures -- the
        # invite update above is the critical path.
        logger.warning("email_events insert failed for %s: %s", etype, e)

    # ── Permanent bounce registry so cooldown filter can skip forever ──
    if is_hard_bounce:
        for r in recipients:
            await db.bounced_emails.update_one(
                {"email": r},
                {
                    "$set": {
                        "email": r,
                        "last_bounce_at": _now_iso(),
                        "last_bounce_reason": (data.get("reason") or data.get("message") or ""),
                    },
                    "$inc": {"bounce_count": 1},
                    "$setOnInsert": {"first_bounce_at": _now_iso()},
                },
                upsert=True,
            )

    # Always log + 200 so Resend doesn't retry storms.
    logger.info(
        "Resend webhook: %s recipient=%s invite_matched=%s hard_bounce=%s",
        etype, recipients[0] if recipients else "?",
        bool(invite), is_hard_bounce,
    )
    return {
        "ok": True,
        "event": etype,
        "invite_matched": bool(invite),
        "hard_bounce": is_hard_bounce,
    }


# ─── Telnyx (SMS) ──────────────────────────────────────────────────────
#
# Single webhook URL for all Telnyx event types:
#   POST /api/webhooks/telnyx
#
# Telnyx signs the payload with Ed25519. Headers:
#   - Telnyx-Signature-Ed25519   base64 64-byte signature
#   - Telnyx-Timestamp           unix-seconds timestamp
# Signed payload = `timestamp|raw_body`. Public key lives in the
# TELNYX_PUBLIC_KEY env (paste from Telnyx Mission Control dashboard).
# When the env is unset we log + accept anyway -- early-test convenience
# so the URL works as soon as it's saved in Telnyx, before secrets are
# wired up. Tighten that to required once we're live.
#
# Event types we care about today:
#   - message.finalized -> updates sms_sends row by message id with the
#                          delivery status (delivered / failed /
#                          undelivered) and error code
#   - message.received  -> inbound SMS. Auto-records STOP replies into
#                          outreach_opt_outs (matching the existing
#                          Twilio inbound path's behaviour) and logs
#                          everything else for triage.
#   - message.sent      -> creation ack; we already have the sms_sends
#                          row from outbound, so just log.

TELNYX_TOLERANCE_SECONDS = 5 * 60


def _verify_telnyx_ed25519(
    public_key_b64: str, body: bytes, signature_b64: str, timestamp: str,
) -> bool:
    """Verify a Telnyx Ed25519 signature against `timestamp|body`."""
    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        return False
    if abs(int(time.time()) - ts) > TELNYX_TOLERANCE_SECONDS:
        logger.warning("Telnyx webhook: timestamp outside tolerance window")
        return False
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        pub_bytes = base64.b64decode(public_key_b64)
        sig_bytes = base64.b64decode(signature_b64)
        payload = f"{timestamp}|".encode() + body
        Ed25519PublicKey.from_public_bytes(pub_bytes).verify(sig_bytes, payload)
        return True
    except Exception as e:
        logger.warning("Telnyx webhook: signature verification failed: %s", e)
        return False


@router.post("/webhooks/telnyx")
async def telnyx_webhook(request: Request) -> dict[str, Any]:
    """Telnyx webhook receiver. Single endpoint for all event types --
    outbound status updates, inbound replies, and creation acks. Handles
    signature verification when TELNYX_PUBLIC_KEY is configured;
    otherwise accepts + logs a warning so the URL is reachable for
    initial setup without env-var blocking. Tighten verification after
    go-live."""
    body = await request.body()
    signature = request.headers.get("Telnyx-Signature-Ed25519", "")
    timestamp = request.headers.get("Telnyx-Timestamp", "")
    public_key = os.environ.get("TELNYX_PUBLIC_KEY", "").strip()
    if public_key:
        if not _verify_telnyx_ed25519(public_key, body, signature, timestamp):
            raise HTTPException(401, "Invalid Telnyx signature")
    else:
        logger.warning(
            "Telnyx webhook: TELNYX_PUBLIC_KEY not set -- accepting without "
            "signature verification (tighten this for production)."
        )

    try:
        import json as _json
        payload = _json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Malformed JSON body")

    data = payload.get("data") or {}
    etype = (data.get("event_type") or "").lower()
    msg = data.get("payload") or {}
    msg_id = msg.get("id") or ""

    # ── Outbound status update ──
    # Telnyx tracks each destination separately; we look at the FIRST
    # `to` entry's status which is the carrier delivery status. The
    # `errors` array carries human-readable error context when status is
    # `delivery_failed` / `sending_failed`.
    if etype in ("message.finalized", "message.sent"):
        to_list = msg.get("to") or []
        to_status = (to_list[0].get("status") if to_list else "") or ""
        errors = msg.get("errors") or []
        error_code = errors[0].get("code") if errors else None
        error_message = errors[0].get("title") if errors else None
        update: dict[str, Any] = {
            "telnyx_status": to_status,
            "telnyx_event_at": _now_iso(),
        }
        if error_code:
            update["telnyx_error_code"] = error_code
            update["telnyx_error_message"] = error_message
        # Match against sms_sends by Telnyx message ID. When we cut
        # over the outbound path from Twilio to Telnyx we'll start
        # populating sms_sends.telnyx_id at send time; until then the
        # lookup misses and we just log.
        if msg_id:
            res = await db.sms_sends.update_one(
                {"telnyx_id": msg_id},
                {"$set": update},
            )
            matched = res.matched_count
        else:
            matched = 0
        logger.info(
            "Telnyx webhook: %s msg_id=%s status=%s err=%s matched_sms_sends=%d",
            etype, msg_id, to_status, error_code, matched,
        )
        return {
            "ok": True, "event": etype, "msg_id": msg_id,
            "status": to_status, "matched": matched,
        }

    # ── Inbound SMS ──
    # Auto-handle STOP replies the same way Twilio's inbound flow does:
    # add the sender phone to outreach_opt_outs so the outreach agent
    # never texts them again. Telnyx's payload has the inbound text in
    # `payload.text` and the sender in `payload.from.phone_number`.
    if etype == "message.received":
        text = (msg.get("text") or "").strip()
        sender = ((msg.get("from") or {}).get("phone_number") or "").strip()
        is_stop = (
            text.lower() in ("stop", "stopall", "unsubscribe", "cancel", "end", "quit")
            or (len(text) < 60 and " stop " in f" {text.lower()} ")
        )
        if is_stop and sender:
            try:
                from outreach_optout import record_opt_out
                await record_opt_out(
                    email="", phone=sender,
                    reason="STOP reply (Telnyx)",
                    source="sms_stop_reply_telnyx",
                )
                logger.info(
                    "Telnyx webhook: STOP reply from %s -- added to opt-out registry",
                    sender,
                )
            except Exception as e:
                logger.warning("Telnyx opt-out record failed: %s", e)
        else:
            logger.info(
                "Telnyx webhook: inbound from %s text=%s",
                sender, text[:80],
            )
        return {"ok": True, "event": etype, "from": sender, "is_stop": is_stop}

    # Anything else (delivery_updated, message.attachment_*, etc.)
    # is logged + 200'd so Telnyx doesn't retry-storm us.
    logger.info("Telnyx webhook: unhandled event_type=%s msg_id=%s", etype, msg_id)
    return {"ok": True, "event": etype, "handled": False}
