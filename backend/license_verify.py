"""Therapist license-status helpers.

Idaho DOPL does NOT expose a public JSON API (confirmed via docs — they only
offer a web-based licensee search and downloadable HTML rosters). So
"verification" is pragmatic:

  1. We compute a freshness status ("active" / "expiring_soon" / "expired"
     / "unknown") from the `license_expires_at` field we already collect
     on the therapist profile.
  2. We provide a one-click deep-link to the DOPL public license search
     that pre-fills the license number, so the admin can audit a provider
     in two clicks instead of hand-typing the license.

When Idaho DOPL eventually publishes an API (they've teased one for the
2025–2026 biennial renewal cycle), upgrade `check_dopl_status()` to return
live board-disciplined / suspension flags.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


EXPIRING_SOON_DAYS = 45
# Idaho DOPL public license-search portal. The hash anchor (#2) auto-opens
# the "License Lookup" tab on the SPA so the admin lands one click from
# the search input.
DOPL_SEARCH_URL = "https://edopl.idaho.gov/onlineservices/_/#2"


def _parse_iso_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Accept YYYY-MM-DD or full ISO
        if len(s) == 10:
            return datetime.fromisoformat(s + "T00:00:00+00:00")
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_license_status(
    license_expires_at: Optional[str] = None,
    license_number: Optional[str] = None,
) -> dict:
    """Returns a verdict dict safe to expose to admin UI.

    Statuses:
      - `active`         : expiry is in the future, >45 days out
      - `expiring_soon`  : expires within 45 days (warn admin to nag)
      - `expired`        : expiry date is in the past (RED — hide from matching)
      - `no_expiry`      : therapist submitted a license number but no date
      - `no_license`     : no license number at all (RED)
    """
    exp = _parse_iso_date(license_expires_at)
    now = datetime.now(timezone.utc)

    if not license_number:
        return {
            "status": "no_license",
            "label": "No license on file",
            "severity": "error",
            "expires_at": license_expires_at,
            "days_until_expiry": None,
        }

    if not exp:
        return {
            "status": "no_expiry",
            "label": "No expiry on file",
            "severity": "warn",
            "expires_at": None,
            "days_until_expiry": None,
        }

    delta_days = (exp - now).days
    if delta_days < 0:
        return {
            "status": "expired",
            "label": f"Expired {exp.strftime('%b %Y')}",
            "severity": "error",
            "expires_at": license_expires_at,
            "days_until_expiry": delta_days,
        }
    if delta_days <= EXPIRING_SOON_DAYS:
        return {
            "status": "expiring_soon",
            "label": f"Expires in {delta_days}d",
            "severity": "warn",
            "expires_at": license_expires_at,
            "days_until_expiry": delta_days,
        }
    return {
        "status": "active",
        "label": f"Active · renews {exp.strftime('%b %Y')}",
        "severity": "ok",
        "expires_at": license_expires_at,
        "days_until_expiry": delta_days,
    }


def dopl_verification_url(license_number: Optional[str]) -> Optional[str]:
    """Deep-link to Idaho DOPL's online-services license-lookup landing
    page (`edopl.idaho.gov/onlineservices/_/#2`). The portal is a
    JavaScript SPA so the license number can't be pre-filled in the
    URL, but the hash anchor lands the admin directly on the License
    Lookup tab — one paste away from a verified result."""
    if not license_number:
        return None
    ln = license_number.strip()
    if not ln:
        return None
    return DOPL_SEARCH_URL


# ── Live DOPL check — upgrade path ─────────────────────────────────────
# Idaho DOPL teased a biennial-renewal-cycle API overhaul for 2025–2026.
# When that ships, implement this function to hit their JSON endpoint with
# the license number and return a dict like:
#   {
#     "live_ok": True,
#     "disciplined": False,
#     "suspended": False,
#     "raw_expiry": "2027-12-31",
#     "last_checked_at": iso,
#   }
# The return shape must be a superset of `compute_license_status`'s fields
# so the admin UI doesn't need changes to consume the richer data — just
# merge the extra flags into the existing badge.
#
# Right now this is a STUB that returns None (signaling "not available")
# so the rest of the code path stays on the offline expiry calculation.
async def check_dopl_status(license_number: str | None) -> dict | None:
    """Return live DOPL verification status, or None if the API isn't
    reachable / available yet.

    When implementing: honour a short cache (e.g. 24h TTL in a
    `dopl_cache` Mongo collection) so we don't hit DOPL on every admin
    page render. Fail soft — if DOPL is down, fall back to the offline
    status computed from `license_expires_at`.
    """
    if not license_number:
        return None
    # TODO(idaho-dopl-api): once DOPL publishes the JSON endpoint,
    # make an httpx GET against it with a 5s timeout, cache the result
    # in `dopl_cache`, and return the dict shape documented above.
    return None
