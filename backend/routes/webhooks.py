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
