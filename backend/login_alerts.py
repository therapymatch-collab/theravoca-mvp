"""New-IP login alert -- detect + email when a session is created from
an IP we haven't seen for that account before.

How it works:
  - Every successful sign-in (magic-code or password, patient + therapist
    + admin) calls `check_and_record_login()` after the auth check passes.
  - We HMAC the IP (same pattern as audit log -- preserves privacy while
    keeping query equality).
  - If we have NEVER seen (email, ip_hash) for this account -> spawn an
    email alert in the background.
  - We always record the event afterward so the next time from that IP
    is silent.

First-ever login skips the alert (we have nothing to compare against and
the user just signed up; alerting would be noise).

Records live in `db.login_events` with a 90-day TTL index. After 90 days
the same IP looks "new" again, which is intentional -- a stale fingerprint
shouldn't be trusted forever.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac as _hmac
import logging
from datetime import datetime, timezone
from typing import Optional

from deps import JWT_SECRET, db

logger = logging.getLogger("theravoca.login_alerts")

_TTL_SECONDS = 90 * 24 * 3600  # 90 days


def _hash_ip(ip: str) -> str:
    """HMAC-SHA256 the IP with JWT_SECRET. Same IP -> same hash, but
    not reversible without the server secret."""
    raw = (ip or "").strip()
    if not raw:
        return ""
    return _hmac.new(
        JWT_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256,
    ).hexdigest()[:32]


async def ensure_indexes() -> None:
    """Create the TTL + query indexes for login_events. Idempotent."""
    try:
        await db.login_events.create_index("ts", expireAfterSeconds=_TTL_SECONDS)
        await db.login_events.create_index([("email", 1), ("ip_hash", 1)])
        await db.login_events.create_index([("email", 1), ("ts", -1)])
    except Exception as e:
        logger.warning("login_events index setup failed: %s", e)


async def check_and_record_login(
    email: str,
    role: str,
    ip: str,
    user_agent: str = "",
) -> dict:
    """Record a login event and return whether the alert email should fire.

    Returns dict:
      {
        "is_new_ip": bool,           # IP not seen for this account before
        "is_first_login": bool,      # account has no prior login_events
        "alert_fired": bool,         # we spawned the email send
      }

    Spawns the alert email in the background -- never blocks the caller.
    """
    from email_service import send_new_login_alert  # local import to avoid cycles

    email_norm = (email or "").strip().lower()
    if not email_norm:
        return {"is_new_ip": False, "is_first_login": False, "alert_fired": False}

    ip_hash = _hash_ip(ip)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Has this account ever signed in before?
    prior_count = await db.login_events.count_documents({"email": email_norm}, limit=1)
    is_first_login = prior_count == 0

    # Has this specific (account, IP) been seen?
    is_new_ip = False
    if not is_first_login and ip_hash:
        seen = await db.login_events.find_one(
            {"email": email_norm, "ip_hash": ip_hash}, {"_id": 1}
        )
        is_new_ip = seen is None

    # Always record this login (after we've checked).
    try:
        await db.login_events.insert_one({
            "email": email_norm,
            "role": role,
            "ip_hash": ip_hash,
            "user_agent": (user_agent or "")[:500],
            "ts": now_iso,
        })
    except Exception as e:
        # SECURITY (2026-05-16 audit, MEDIUM #9): don't log full email
        # to Render stdout. Use the audit-style hash so ops can still
        # correlate without exposing PII in log retention.
        try:
            from audit import _hash_patient_email as _h
            email_id = _h(email_norm)
        except Exception:
            email_id = "<hash-unavailable>"
        logger.warning("login_events insert failed for hash:%s: %s", email_id, e)

    alert_fired = False
    if is_new_ip and not is_first_login:
        try:
            asyncio.create_task(
                send_new_login_alert(
                    to=email_norm,
                    role=role,
                    user_agent=user_agent,
                    when_iso=now_iso,
                )
            )
            alert_fired = True
        except RuntimeError:
            logger.debug("No event loop for new-IP alert -- skipping")

    return {
        "is_new_ip": is_new_ip,
        "is_first_login": is_first_login,
        "alert_fired": alert_fired,
    }


async def get_login_history(
    email: str, limit: int = 50,
) -> list[dict]:
    """Return the most recent login events for an account, newest first.
    Used by the patient/therapist 'My login history' page (Fix 3).
    Strips ip_hash from the response -- not useful to show users."""
    cur = db.login_events.find(
        {"email": (email or "").strip().lower()},
        {"_id": 0, "role": 1, "user_agent": 1, "ts": 1},
    ).sort("ts", -1).limit(limit)
    return await cur.to_list(limit)
