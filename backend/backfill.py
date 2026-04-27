"""One-shot backfill helper to complete every therapist profile with realistic
fake data so the entire app feels production-like during demos.

Each pass through `backfill_therapist` will fill missing fields ONLY — never
overwrite ones the admin or therapist explicitly set. Safe to re-run.
"""
from __future__ import annotations

import random
from typing import Any

from seed_data import (
    FIRST_NAMES, LAST_NAMES, IDAHO_CITIES, ALL_ISSUES, ALL_MODALITIES,
    INSURERS, AGE_GROUPS, AVAILABILITY, STYLE_TAGS, _name_to_gender,
)

CREDENTIAL_TYPES = [
    ("psychologist", ["PhD", "PsyD"]),
    ("lcsw", ["LCSW", "LICSW"]),
    ("lpc", ["LPC", "LPCC", "LCPC", "LCMHC"]),
    ("lmft", ["LMFT"]),
    ("psychiatrist", ["MD"]),
    ("lmhc", ["LMHC"]),
]

# Tiny placeholder JPEG (1x1 pixel) — replaced lazily by frontend if needed.
# Real avatars live in the existing `profile_picture` field; this is just so
# every record has SOMETHING (which the frontend then renders as initials over
# top via a fallback). We use null so the FE initials fallback kicks in cleanly.
DEFAULT_PROFILE_PICTURE = None


def _suggest_credential() -> tuple[str, str]:
    """Return (credential_type, license_suffix) tuple."""
    cred_type, license_pool = random.choice(CREDENTIAL_TYPES)
    return cred_type, random.choice(license_pool)


def _ensure_full_name_with_license(name: str | None, suffix: str) -> str:
    name = (name or "").strip()
    if not name:
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        return f"{first} {last}, {suffix}"
    if "," in name:
        return name  # already has a license suffix
    return f"{name}, {suffix}"


def _normalize_email(email: str | None, idx: int) -> str:
    """Force every therapist email to therapymatch+tNNN@gmail.com format so the
    user's verified inbox receives every transactional email during dev."""
    if email and "therapymatch+" in email:
        return email
    return f"therapymatch+t{idx:03d}@gmail.com"


def backfill_therapist(t: dict[str, Any], idx: int) -> dict[str, Any]:
    """Return a flat dict of fields to $set on the therapist doc. Empty values
    are filled with realistic fakes; non-empty values are preserved."""
    set_fields: dict[str, Any] = {}

    # Credential type + license suffix
    cred_type = t.get("credential_type") or ""
    if not cred_type:
        cred_type, license_suffix = _suggest_credential()
        set_fields["credential_type"] = cred_type
    else:
        # Pick a sensible license suffix matching the cred_type
        license_pool = next(
            (p for c, p in CREDENTIAL_TYPES if c == cred_type), ["LCSW"]
        )
        license_suffix = random.choice(license_pool)

    # Name with license
    name = t.get("name", "")
    new_name = _ensure_full_name_with_license(name, license_suffix)
    if new_name != name:
        set_fields["name"] = new_name
    name = new_name
    first_name = name.split(",")[0].split(" ")[0] if name else random.choice(FIRST_NAMES)

    # Email — force therapymatch+tNNN@gmail.com pattern
    new_email = _normalize_email(t.get("email"), idx)
    if new_email != t.get("email"):
        set_fields["email"] = new_email

    # Phone
    if not (t.get("phone") or "").strip():
        set_fields["phone"] = f"(208) {random.randint(200, 999)}-{random.randint(1000, 9999)}"

    # Gender
    if not t.get("gender"):
        set_fields["gender"] = _name_to_gender(first_name)

    # Specialties — required for matching, ensure non-empty
    if not t.get("primary_specialties"):
        avail = random.sample(ALL_ISSUES, k=random.randint(5, 9))
        set_fields["primary_specialties"] = avail[:random.randint(1, 2)]
        set_fields["secondary_specialties"] = avail[2:2 + random.randint(1, 3)]
        set_fields["general_treats"] = avail[5:5 + random.randint(1, 4)]

    if not t.get("modalities"):
        set_fields["modalities"] = random.sample(ALL_MODALITIES, random.randint(2, 4))

    # Modality offering + telehealth/in_person consistency
    if not t.get("modality_offering"):
        roll = random.random()
        offering = "both" if roll < 0.55 else ("telehealth" if roll < 0.85 else "in_person")
        set_fields["modality_offering"] = offering
    else:
        offering = t["modality_offering"]
    if "telehealth" not in t:
        set_fields["telehealth"] = offering in ("telehealth", "both")
    if "offers_in_person" not in t:
        set_fields["offers_in_person"] = offering in ("in_person", "both")

    # Office locations (only if in-person)
    if (set_fields.get("offers_in_person") or t.get("offers_in_person")) and not t.get("office_locations"):
        set_fields["office_locations"] = random.sample(IDAHO_CITIES, random.randint(1, 2))

    # Age groups
    if not t.get("age_groups"):
        set_fields["age_groups"] = random.sample(AGE_GROUPS, random.randint(2, 4))

    # Client types
    if not t.get("client_types"):
        types = ["individual"]
        if random.random() < 0.4:
            types.append("couples")
        if random.random() < 0.3:
            types.append("family")
        set_fields["client_types"] = types

    # Insurance
    if t.get("insurance_accepted") is None or len(t.get("insurance_accepted") or []) == 0:
        if random.random() < 0.75:
            set_fields["insurance_accepted"] = random.sample(INSURERS, random.randint(2, 5))
        else:
            set_fields["insurance_accepted"] = []

    # Cash rate / sliding scale
    if not t.get("cash_rate"):
        set_fields["cash_rate"] = random.choice([100, 120, 130, 140, 150, 160, 175, 185, 200, 225])
    if "sliding_scale" not in t:
        set_fields["sliding_scale"] = random.random() < 0.45

    # Years experience
    if not t.get("years_experience"):
        set_fields["years_experience"] = random.randint(2, 28)

    # Availability windows
    if not t.get("availability_windows"):
        set_fields["availability_windows"] = random.sample(AVAILABILITY, random.randint(2, 4))

    # Urgency capacity
    if not t.get("urgency_capacity"):
        set_fields["urgency_capacity"] = random.choices(
            ["asap", "within_2_3_weeks", "within_month", "full"],
            weights=[0.25, 0.4, 0.25, 0.1], k=1,
        )[0]

    # Style tags
    if not t.get("style_tags"):
        set_fields["style_tags"] = random.sample(STYLE_TAGS, random.randint(2, 4))

    # Free consult
    if "free_consult" not in t:
        set_fields["free_consult"] = random.random() < 0.65

    # Bio
    if not (t.get("bio") or "").strip():
        years = set_fields.get("years_experience") or t.get("years_experience") or 5
        modalities = set_fields.get("modalities") or t.get("modalities") or ["CBT"]
        set_fields["bio"] = (
            f"{first_name} is a {license_suffix} with {years} years of clinical experience. "
            f"Trained in {', '.join(modalities[:3])}, {first_name} brings warmth and "
            f"evidence-based care to every session, helping clients feel heard and equipped "
            f"with practical tools."
        )

    # Notification prefs default true
    if "notify_email" not in t:
        set_fields["notify_email"] = True
    if "notify_sms" not in t:
        set_fields["notify_sms"] = True

    # Profile picture left null — frontend renders initials fallback
    if "profile_picture" not in t:
        set_fields["profile_picture"] = DEFAULT_PROFILE_PICTURE

    return set_fields
