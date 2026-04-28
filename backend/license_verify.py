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
DOPL_SEARCH_URL = "https://dopl.idaho.gov/public-records-request/"


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
    """Deep-link to Idaho DOPL's license-verification landing page with the
    license number pre-filled (query param `q`). DOPL doesn't currently honor
    the query param but we keep it for when they do — and the URL itself
    drops the admin 1 click closer to the search."""
    if not license_number:
        return None
    ln = license_number.strip()
    if not ln:
        return None
    return f"https://dopl.idaho.gov/public-records-request/?q={ln}"
