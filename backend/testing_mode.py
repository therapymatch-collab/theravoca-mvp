"""Master testing-mode toggle.

One flag that disables the abuse-defense barriers an admin needs to
bypass when running end-to-end tests (Playwright, AI agents, manual
QA) against a live backend. The flag has an absolute expiry timestamp
so it auto-deactivates after a few hours -- an admin can't leave
testing mode on by accident.

What testing mode bypasses
--------------------------
- Cloudflare Turnstile widget + token verification
- Per-IP rate limit on `/api/requests` (patient intake)
- Per-email rate limit on `/api/requests`
- Per-IP rate limit on `/api/therapists/signup`
- Intake timing heuristic (< 2s submission)
- Magic-code send rate limit (5/hour)
- Magic-code verify wrong-attempt lockout

What it does NOT bypass
-----------------------
- Honeypot field (real bots fill it, tests never should)
- HMAC token validation (tests must use real tokens)
- Admin login lockout (5-failure threshold is fine for tests)
- Crisis-escalation triggers (real safety surface, not test friction)
- Stripe webhook signature verification (test the sig path too)

Storage
-------
Single doc in `app_config` keyed `master_testing_mode`:
    {
        "key": "master_testing_mode",
        "enabled": True,
        "enabled_until": "2026-05-12T18:00:00+00:00",  # ISO, UTC
        "enabled_reason": "playwright e2e",
        "enabled_by": "admin",
        "enabled_at": "...",
    }
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from deps import db, logger

# Hard ceiling on how long testing mode can stay on. The frontend
# defaults to a shorter window; this is a server-side safety so a
# misclicked "infinite" toggle still expires.
MASTER_TESTING_MAX_HOURS = 8


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


async def is_active() -> bool:
    """True when master testing mode is on AND not expired. Fails soft
    on any DB error (treat as off so production isn't accidentally
    weakened by a transient outage)."""
    try:
        doc = await db.app_config.find_one(
            {"key": "master_testing_mode"},
            {"_id": 0, "enabled": 1, "enabled_until": 1},
        )
    except Exception as e:
        logger.warning("testing_mode is_active read failed: %s", e)
        return False
    if not doc or not doc.get("enabled"):
        return False
    until_dt = _parse_iso(doc.get("enabled_until"))
    if not until_dt:
        return False
    return until_dt > datetime.now(timezone.utc)


async def status() -> dict:
    """Read the full status doc -- used by the admin Settings panel."""
    try:
        doc = await db.app_config.find_one(
            {"key": "master_testing_mode"}, {"_id": 0},
        ) or {}
    except Exception as e:
        logger.warning("testing_mode status read failed: %s", e)
        doc = {}
    until_dt = _parse_iso(doc.get("enabled_until"))
    now = datetime.now(timezone.utc)
    expired = bool(until_dt and until_dt <= now)
    return {
        "enabled": bool(doc.get("enabled")) and not expired,
        "enabled_until": doc.get("enabled_until"),
        "enabled_at": doc.get("enabled_at"),
        "enabled_by": doc.get("enabled_by"),
        "enabled_reason": doc.get("enabled_reason") or "",
        "max_hours": MASTER_TESTING_MAX_HOURS,
        "remaining_seconds": (
            int((until_dt - now).total_seconds())
            if until_dt and until_dt > now else 0
        ),
    }
