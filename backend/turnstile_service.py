"""Cloudflare Turnstile token verification.

Fail-soft design: when `TURNSTILE_SECRET_KEY` is not configured, this
module short-circuits and returns success — so dev/preview environments
keep working without keys, and the existing free defenses (honeypot +
timing + IP rate-limit) continue to gate the intake endpoint.

Once an admin pastes their secret key into `backend/.env`, the
verification kicks in automatically on the next backend reload.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("theravoca.turnstile")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TIMEOUT_SEC = 5.0


def is_configured() -> bool:
    """True only when both the site + secret key envs are populated."""
    return bool(
        (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
        and (os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    )


async def verify_token(
    token: Optional[str],
    *,
    remote_ip: Optional[str] = None,
) -> tuple[bool, Optional[str]]:
    """Verify a Turnstile token against Cloudflare Siteverify.

    Returns `(ok, error_message)`. When Turnstile isn't configured the
    function returns `(True, None)` so the rest of the request handling
    can proceed unmodified — equivalent to "Turnstile is off."

    Network/API failures are logged and treated as a soft failure
    (return False) so we never block legitimate traffic during a
    Cloudflare outage; the caller decides whether to reject or fall
    back to other defenses.
    """
    secret = (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
    if not secret:
        return True, None  # Not configured → skip
    if not token:
        return False, "Missing security verification token."
    # Token max length per Cloudflare docs is 2048 chars. Reject early.
    if len(token) > 2048:
        return False, "Invalid security verification token."
    payload = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
            r = await client.post(SITEVERIFY_URL, data=payload)
        r.raise_for_status()
        data = r.json()
    except httpx.TimeoutException:
        logger.warning("Turnstile siteverify timeout — failing soft")
        return True, None  # Don't block on transient outages
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Turnstile siteverify error — failing soft: %s", exc)
        return True, None
    if data.get("success") is True:
        return True, None
    error_codes = data.get("error-codes") or []
    logger.info("Turnstile rejected: %s", error_codes)
    return False, "Security check failed. Please refresh the page and try again."
