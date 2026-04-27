"""Input validation helpers for patient intake.

- `is_disposable_email`: blocks well-known disposable / temp-mail domains.
- `email_is_plausible`: light syntactic + domain-shape checks beyond Pydantic's `EmailStr`.
- `validate_zip_for_state`: reject ZIPs that don't belong to the patient's stated state
  (US ZIP first-3-digit prefix map). Used as a fast pre-check before geocoding.
- `validate_zip_city_consistent`: post-geocode check that ZIP and city are within
  ~30 miles of each other (catches "Boise" + "10001" mismatches).
"""
from __future__ import annotations

import re
from typing import Optional

from geocoding import haversine_miles


# Top common disposable / throwaway / temp-email domains. Not exhaustive but
# blocks the most-abused ones. Lower-cased.
DISPOSABLE_DOMAINS: set[str] = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
    "guerrillamailblock.com", "sharklasers.com", "10minutemail.com", "10minutemail.net",
    "tempmail.com", "tempmail.net", "tempmail.io", "temp-mail.org", "temp-mail.io",
    "yopmail.com", "yopmail.net", "yopmail.fr", "trashmail.com", "trashmail.net",
    "throwawaymail.com", "fakeinbox.com", "getnada.com", "nada.email",
    "mintemail.com", "maildrop.cc", "dispostable.com", "spamgourmet.com",
    "mohmal.com", "mytemp.email", "mytrashmail.com", "anonbox.net",
    "getairmail.com", "emailondeck.com", "tempr.email", "discard.email",
    "burnermail.io", "moakt.com", "mailnesia.com", "sogetthis.com",
    "tempemail.net", "trbvm.com", "wegwerfemail.de", "spambox.us",
    "spamex.com", "spamavert.com", "fakemail.net", "fakeemailgenerator.com",
    "tempemail.co", "tempinbox.com", "20minutemail.com", "33mail.com",
    "anonymbox.com", "armyspy.com", "boun.cr", "bouncr.com", "cuvox.de",
    "deadaddress.com", "dispomail.eu", "dropmail.me", "einrot.com",
    "fleckens.hu", "gustr.com", "harakirimail.com", "imgof.com",
    "jourrapide.com", "jetable.org", "lroid.com", "mailcatch.com",
    "mailexpire.com", "mailforspam.com", "mailinator2.com", "mailinator.net",
    "mailmoat.com", "mailtemporanea.com", "mailtothis.com", "mailzilla.org",
    "mvrht.com", "namaide.com", "nepwk.com", "nervmich.net", "nice-4u.com",
    "nomail.xl.cx", "noref.in", "nowmymail.com", "nurfuerspam.de",
    "objectmail.com", "rcpt.at", "rhyta.com", "shieldedmail.com",
    "shitmail.me", "sneakmail.de", "spam.la", "spam.me", "spamcero.com",
    "spamhole.com", "spamify.com", "spaml.de", "spammotel.com",
    "stuffmail.de", "superrito.com", "tempemailaddress.com",
    "tempinbox.co.uk", "tempmail2.com", "tempmailo.com", "tempymail.com",
    "trash-mail.com", "trashemail.de", "tyldd.com", "uggsrock.com",
    "wegwerf-email.net", "yepmail.net", "zoemail.net",
}


def email_domain(email: str) -> str:
    return (email or "").rsplit("@", 1)[-1].lower().strip()


def is_disposable_email(email: str) -> bool:
    return email_domain(email) in DISPOSABLE_DOMAINS


# Syntactic guards beyond Pydantic's EmailStr (catches obvious junk like
# "asdf@asdf" that may technically pass Pydantic's loose RFC parsing).
_LOCAL_PART_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}$")
_DOMAIN_RE = re.compile(r"^[A-Za-z0-9.\-]{1,255}\.[A-Za-z]{2,}$")


def email_is_plausible(email: str) -> bool:
    """Reject obvious garbage. Doesn't replace EmailStr — runs alongside it."""
    if not email or "@" not in email:
        return False
    local, _, domain = email.partition("@")
    if not _LOCAL_PART_RE.match(local) or not _DOMAIN_RE.match(domain):
        return False
    if domain.startswith("-") or domain.endswith("-"):
        return False
    if ".." in email:
        return False
    return True


# US ZIP first-3-digit prefix → set of valid USPS state codes. Source: USPS.
# Truncated to states we care about (Idaho + neighbors + a sane subset for
# rejecting wildly-wrong combos like ZIP=10001 + state=ID).
_ZIP3_TO_STATES: dict[str, set[str]] = {}


def _build_zip3_map() -> dict[str, set[str]]:
    """Build (lazy) a ZIP-prefix -> {state, ...} map. Only populated once."""
    if _ZIP3_TO_STATES:
        return _ZIP3_TO_STATES
    # First-3-digit prefix → states. Based on USPS ZIP code prefix table.
    raw = {
        "ID": list(range(832, 839 + 1)),
        "WA": list(range(980, 994 + 1)),
        "OR": list(range(970, 979 + 1)),
        "MT": list(range(590, 599 + 1)),
        "UT": list(range(840, 847 + 1)),
        "WY": list(range(820, 831 + 1)),
        "NV": list(range(889, 898 + 1)),
        "CA": list(range(900, 961 + 1)),
        "AZ": list(range(850, 865 + 1)),
        "NY": list(range(100, 149 + 1)),
        "TX": list(range(750, 799 + 1)),
        "FL": list(range(320, 349 + 1)),
        "MA": list(range(10, 27 + 1)),
        "IL": list(range(600, 629 + 1)),
        "CO": list(range(800, 816 + 1)),
        "GA": list(range(300, 319 + 1)) + list(range(398, 399 + 1)),
        "PA": list(range(150, 196 + 1)),
        "NJ": list(range(70, 89 + 1)),
        "OH": list(range(430, 458 + 1)),
        "MI": list(range(480, 499 + 1)),
        "VA": list(range(220, 246 + 1)),
        "NC": list(range(270, 289 + 1)),
        "MN": list(range(550, 567 + 1)),
        "WI": list(range(530, 549 + 1)),
        "MO": list(range(630, 658 + 1)),
        "MD": list(range(206, 219 + 1)),
        "AL": list(range(350, 369 + 1)),
        "TN": list(range(370, 385 + 1)),
        "IN": list(range(460, 479 + 1)),
        "SC": list(range(290, 299 + 1)),
        "OK": list(range(730, 749 + 1)),
        "AR": list(range(716, 729 + 1)),
        "LA": list(range(700, 715 + 1)),
        "MS": list(range(386, 397 + 1)),
        "KY": list(range(400, 427 + 1)),
        "IA": list(range(500, 528 + 1)),
        "KS": list(range(660, 679 + 1)),
        "NM": list(range(870, 884 + 1)),
        "NE": list(range(680, 693 + 1)),
        "ND": list(range(580, 588 + 1)),
        "SD": list(range(570, 577 + 1)),
        "AK": list(range(995, 999 + 1)),
        "HI": [967, 968],
        "ME": list(range(39, 49 + 1)),
        "NH": list(range(30, 38 + 1)),
        "VT": list(range(50, 59 + 1)),
        "RI": list(range(28, 29 + 1)),
        "CT": list(range(60, 69 + 1)),
        "WV": list(range(247, 268 + 1)),
        "DE": list(range(197, 199 + 1)),
        "DC": list(range(200, 205 + 1)),
    }
    for state, prefs in raw.items():
        for p in prefs:
            key = f"{p:03d}"
            _ZIP3_TO_STATES.setdefault(key, set()).add(state)
    return _ZIP3_TO_STATES


def validate_zip_for_state(zip_code: str, state: str) -> bool:
    """Return False only if ZIP unambiguously belongs to a different state.
    Unknown prefixes pass (don't block edge cases / new ZIPs)."""
    z = (zip_code or "").strip()
    s = (state or "").strip().upper()
    if not z or not s or len(z) < 5 or not z[:5].isdigit():
        return True  # let other validators / EmailStr handle blanks
    prefix = z[:3]
    valid = _build_zip3_map().get(prefix)
    if not valid:
        return True
    return s in valid


async def validate_zip_city_consistent(
    db, zip_code: str, city: str, state: str, max_miles: float = 35.0,
) -> Optional[str]:
    """Return None if ZIP and city geocode within `max_miles` of each other,
    else a short error string. Skipped silently if either can't be geocoded."""
    from geocoding import geocode_city, geocode_zip
    if not zip_code or not city:
        return None
    zip_coord = await geocode_zip(db, zip_code)
    city_coord = await geocode_city(db, city, state or "ID")
    if not zip_coord or not city_coord:
        return None
    dist = haversine_miles(
        zip_coord[0], zip_coord[1], city_coord[0], city_coord[1],
    )
    if dist > max_miles:
        return (
            f"ZIP {zip_code} doesn't appear to be in or near {city}. "
            f"Please double-check both."
        )
    return None
