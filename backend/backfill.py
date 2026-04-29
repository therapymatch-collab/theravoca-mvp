"""One-shot backfill helper to complete every therapist profile with realistic
fake data so the entire app feels production-like during demos.

Each pass through `backfill_therapist` will fill missing fields ONLY — never
overwrite ones the admin or therapist explicitly set. Safe to re-run.

The pre-launch reversal lives at `POST /api/admin/strip-backfill` and reads
each therapist's `_backfill_audit` record (written here) to undo every field
this module added. See `build_audit_record()` below.
"""
from __future__ import annotations

import random
from typing import Any

from seed_data import (
    IDAHO_CITIES, ALL_ISSUES, ALL_MODALITIES,
    INSURERS, AGE_GROUPS, AVAILABILITY, STYLE_TAGS,
)

# Self-contained name lists — historically these lived in seed_data but
# were removed during a seed-data refactor. We don't need a huge corpus
# here; any first name we generate is purely for fallback bios on
# already-seeded records.
FIRST_NAMES = [
    "Sarah", "Jessica", "Emily", "Megan", "Hannah", "Rachel", "Anna",
    "Ashley", "Lauren", "Amanda", "Michelle", "Stephanie", "Nicole",
    "Heather", "Rebecca", "Erica", "Christina", "Katherine", "Caroline",
    "Olivia", "Sophia", "Isabella", "Charlotte", "Amelia", "Mia",
    "Michael", "David", "James", "John", "Robert", "Daniel", "Matthew",
    "Andrew", "Jacob", "Christopher", "Joshua", "Ryan", "Tyler", "Brandon",
    "Justin", "William", "Thomas", "Brian", "Kevin", "Anthony", "Paul",
    "Alex", "Benjamin", "Samuel", "Ethan", "Noah", "Liam", "Mason",
]
LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
    "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts", "Phillips",
]

# Loose first-name → likely gender heuristic. Falls back to non_binary so
# downstream code (which surfaces gender as a soft preference) doesn't
# default-bias every backfilled profile to one gender. Patient-facing
# code only ever uses this when the therapist hasn't set their own.
_FEMALE_HINTS = {
    "sarah", "jessica", "emily", "megan", "hannah", "rachel", "anna",
    "ashley", "lauren", "amanda", "michelle", "stephanie", "nicole",
    "heather", "rebecca", "erica", "christina", "katherine", "caroline",
    "olivia", "sophia", "isabella", "charlotte", "amelia", "mia",
}
_MALE_HINTS = {
    "michael", "david", "james", "john", "robert", "daniel", "matthew",
    "andrew", "jacob", "christopher", "joshua", "ryan", "tyler", "brandon",
    "justin", "william", "thomas", "brian", "kevin", "anthony", "paul",
    "alex", "benjamin", "samuel", "ethan", "noah", "liam", "mason",
}


def _name_to_gender(first_name: str) -> str:
    fn = (first_name or "").strip().lower()
    if fn in _FEMALE_HINTS:
        return "female"
    if fn in _MALE_HINTS:
        return "male"
    return "non_binary"

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

    # Specialties — required for matching, ensure non-empty.
    # primary_specialties is the priority axis; secondary_specialties is
    # the "also treats" tier the matcher uses for soft scoring; general_treats
    # is the everything-else bucket. Backfilling each independently means
    # a therapist who has primary set (via signup) still gets sensible
    # secondary/general entries instead of leaving those empty and
    # under-scoring them.
    primary = t.get("primary_specialties") or set_fields.get("primary_specialties")
    if not primary:
        avail = random.sample(ALL_ISSUES, k=random.randint(5, 9))
        set_fields["primary_specialties"] = avail[:random.randint(1, 2)]
        primary = set_fields["primary_specialties"]
    if not (t.get("secondary_specialties") or set_fields.get("secondary_specialties")):
        # Pick from issues that AREN'T already in primary.
        remaining = [i for i in ALL_ISSUES if i not in primary]
        if remaining:
            set_fields["secondary_specialties"] = random.sample(
                remaining, k=min(len(remaining), random.randint(2, 4)),
            )
    if not (t.get("general_treats") or set_fields.get("general_treats")):
        already = set(primary) | set(
            t.get("secondary_specialties")
            or set_fields.get("secondary_specialties") or [],
        )
        remaining = [i for i in ALL_ISSUES if i not in already]
        if remaining:
            set_fields["general_treats"] = random.sample(
                remaining, k=min(len(remaining), random.randint(3, 5)),
            )

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

    # Languages spoken — convention is the list captures languages BEYOND
    # English (English is implicit). ~35% of therapists offer one or two
    # additional languages; bias Spanish since that matches Idaho demand.
    if t.get("languages_spoken") is None or t.get("languages_spoken") == []:
        roll = random.random()
        if roll < 0.20:
            set_fields["languages_spoken"] = ["Spanish"]
        elif roll < 0.30:
            set_fields["languages_spoken"] = random.sample(
                ["Spanish", "Korean", "Vietnamese", "Mandarin", "Arabic", "ASL"],
                k=random.randint(1, 2),
            )
        elif roll < 0.35:
            set_fields["languages_spoken"] = ["ASL"]
        else:
            # English-only — explicit empty list so we don't keep
            # re-rolling on every backfill pass.
            set_fields["languages_spoken"] = []

    # License document upload (base64 image / PDF in production). For
    # backfill we drop in a placehold.co URL that obviously labels itself
    # as a placeholder — admins glancing at the doc viewer immediately
    # see "this is fake". Strip-backfill removes the field entirely so the
    # therapist must upload the real one before going live.
    if not (t.get("license_picture") or "").strip():
        cred = (
            set_fields.get("credential_type") or t.get("credential_type") or "License"
        ).replace(" ", "+")
        set_fields["license_picture"] = (
            f"https://placehold.co/600x800/EEE5DF/2D4A3E/png?text=Sample+{cred}+License+Doc"
        )

    # Notification prefs default true
    if "notify_email" not in t:
        set_fields["notify_email"] = True
    if "notify_sms" not in t:
        set_fields["notify_sms"] = True

    # Subscription defaults — existing therapists are put into trialing state
    # with a 30-day clock so they need to add a card too. Date is stored as ISO.
    if not t.get("subscription_status") or t.get("subscription_status") == "incomplete":
        from datetime import datetime, timedelta, timezone
        trial_end = datetime.now(timezone.utc) + timedelta(days=30)
        set_fields["subscription_status"] = "trialing"
        set_fields["trial_ends_at"] = trial_end.isoformat()
        set_fields.setdefault("stripe_customer_id", None)
        set_fields.setdefault("stripe_subscription_id", None)

    # License number — synthesise a state-prefixed pseudo-license so the
    # admin's "license verified" UX has something to render. Format mirrors
    # what Idaho DOPL actually issues (LCS-XXXXXX style). Pre-launch strip
    # nukes this — therapists must re-enter their real number on first
    # login if it wasn't set during signup.
    if not (t.get("license_number") or "").strip():
        cred = set_fields.get("credential_type") or t.get("credential_type") or "LCSW"
        prefix = {
            "Psychologist": "PSY",
            "LCSW": "LCS",
            "LCPC": "LCP",
            "LMFT": "LMT",
            "LPC": "LPC",
        }.get(cred, "LIC")
        set_fields["license_number"] = (
            f"{prefix}-{random.randint(100000, 999999)}"
        )

    # License expiration — random date 12 to 36 months from now (Idaho
    # license cycles are 2 years; this gives realistic spread). Stored
    # as ISO-8601 date so the frontend can render "Expires Jul 2027".
    if not t.get("license_expires_at"):
        from datetime import datetime, timedelta, timezone
        days_out = random.randint(365, 1095)
        exp = (datetime.now(timezone.utc) + timedelta(days=days_out)).date()
        set_fields["license_expires_at"] = exp.isoformat()

    # Profile picture — deterministic, gender-aware avatar via
    # randomuser.me's portrait CDN. Hashing the therapist's id keeps
    # the same therapist on the same photo across backfill re-runs (so
    # admins don't see faces shuffle every time). When stripped, the
    # frontend falls back to the initials avatar.
    if not (t.get("profile_picture") or "").strip():
        gender = (
            set_fields.get("gender") or t.get("gender") or "non_binary"
        ).lower()
        # randomuser.me only has men/women buckets; non_binary alternates
        # by parity of the hash so we don't bias.
        seed = abs(hash(t.get("id") or t.get("email") or "")) % 100
        if gender == "male":
            bucket = "men"
        elif gender == "female":
            bucket = "women"
        else:
            bucket = "men" if seed % 2 else "women"
        set_fields["profile_picture"] = (
            f"https://randomuser.me/api/portraits/{bucket}/{seed}.jpg"
        )

    return set_fields


def build_audit_record(
    original: dict[str, Any], set_fields: dict[str, Any],
) -> dict[str, Any] | None:
    """Build the `_backfill_audit` record for a single therapist update.

    The audit captures (a) the pre-backfill email so the strip operation
    can put it back, and (b) the list of fields the backfill ACTUALLY
    populated this run (the diff against the pre-existing therapist doc).
    Without this we couldn't tell which fields were faked vs. user-edited
    later. Returns None when nothing was changed (e.g. re-run on a doc
    that's already complete).
    """
    if not set_fields:
        return None
    # Only the fields we wrote that weren't already on the therapist
    # count as "added by backfill". `updated_at` and `_backfill_audit`
    # itself aren't user data — exclude them.
    EXCLUDE = {"updated_at", "_backfill_audit"}
    fields_added = sorted(
        k for k in set_fields.keys()
        if k not in EXCLUDE and (k not in original or original.get(k) in (None, "", [], {}))
    )
    if not fields_added and "email" not in set_fields:
        return None
    from datetime import datetime, timezone
    return {
        "original_email": original.get("email") or "",
        "fields_added": fields_added,
        "backfilled_at": datetime.now(timezone.utc).isoformat(),
    }
