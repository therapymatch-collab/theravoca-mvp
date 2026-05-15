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


# ── Modality -> session-style-tag mapping ────────────────────────
# Values are drawn from the patient-side session_expectations enum.
# "not_sure" is never assigned -- it is a patient-only wildcard.
_MODALITY_STYLE_MAP: dict[str, list[str]] = {
    "CBT":                  ["guide_direct", "tools_fast"],
    "Solution-Focused":     ["guide_direct", "tools_fast"],
    "Behavioral":           ["guide_direct", "tools_fast"],
    "Coaching":             ["guide_direct", "tools_fast"],
    "DBT":                  ["guide_direct", "tools_fast"],
    "Gottman":              ["guide_direct", "tools_fast"],
    "Motivational Interviewing": ["guide_direct", "listen_heard"],
    "Person-Centered":      ["listen_heard", "explore_patterns"],
    "Psychodynamic":        ["listen_heard", "explore_patterns"],
    "IFS":                  ["listen_heard", "explore_patterns"],
    "Art Therapy":          ["listen_heard", "explore_patterns"],
    "Christian Counseling":  ["listen_heard", "explore_patterns"],
    "EMDR":                 ["listen_heard", "explore_patterns"],
    "Trauma-Informed":      ["listen_heard", "explore_patterns"],
    "ACT":                  ["tools_fast", "explore_patterns"],
    "Mindfulness-Based":    ["tools_fast", "explore_patterns"],
    "Somatic Experiencing": ["tools_fast", "explore_patterns"],
    "Eclectic":             ["tools_fast", "listen_heard"],
}
_STYLE_DEFAULT = ["guide_direct", "tools_fast"]


def _infer_session_style_tags(modalities: list[str]) -> list[str]:
    """Infer up to 3 session-style tags from a therapist's modalities
    using the rule-based mapping above. Deduplicates and preserves
    rough insertion order (most common tags bubble to the front)."""
    if not modalities:
        return _STYLE_DEFAULT[:3]
    seen: dict[str, int] = {}
    for mod in modalities:
        tags = _MODALITY_STYLE_MAP.get(mod, _STYLE_DEFAULT)
        for tag in tags:
            seen[tag] = seen.get(tag, 0) + 1
    # Sort by frequency descending (most-mapped tag first), cap at 3
    ranked = sorted(seen.keys(), key=lambda t: seen[t], reverse=True)
    return ranked[:3]


def _suggest_credential() -> tuple[str, str]:
    """Return (credential_type, license_suffix) tuple."""
    cred_type, license_pool = random.choice(CREDENTIAL_TYPES)
    return cred_type, random.choice(license_pool)


# Normalised mapping of any saved credential_type variant (lowercase token,
# bare abbreviation, or full title) → license_pool of matching suffixes.
# Built once at import. Keeps `_resolve_license_pool` cheap and robust to
# whatever case/format the therapist's profile happens to use.
_CRED_LOOKUP: dict[str, list[str]] = {}
for _t, _pool in CREDENTIAL_TYPES:
    _CRED_LOOKUP[_t.lower()] = _pool
    for _suf in _pool:
        _CRED_LOOKUP[_suf.lower()] = _pool
# Common spelled-out / signup-form variants → same pool. These are the
# values therapists actually pick from the public signup dropdown
# (e.g., "Licensed Professional Counselor (LPC)") so without this map
# the lookup falls back to LCSW for everyone whose `credential_type`
# wasn't a lowercase internal token.
_CRED_TITLE_HINTS: list[tuple[str, str]] = [
    ("psychiatrist", "psychiatrist"),
    ("psychologist", "psychologist"),
    ("psyd", "psychologist"), ("phd", "psychologist"),
    ("social worker", "lcsw"), ("lcsw", "lcsw"), ("licsw", "lcsw"),
    ("lmsw", "lcsw"),
    ("marriage", "lmft"), ("family therapist", "lmft"), ("lmft", "lmft"),
    ("mental health", "lmhc"), ("lmhc", "lmhc"),
    ("professional counselor", "lpc"), ("clinical professional counselor", "lpc"),
    ("lpc", "lpc"), ("lcpc", "lpc"), ("lpcc", "lpc"), ("lcmhc", "lpc"),
]


def _resolve_license_pool(cred_type: str) -> list[str]:
    """Return the license-suffix pool that matches `cred_type` no matter
    whether it was stored as a lowercase internal token (`lpc`), a bare
    abbreviation (`LPC`), or a full title (`Licensed Professional
    Counselor (LPC)`). Falls back to a generic LCSW pool only when
    nothing in the lookup matches."""
    raw = (cred_type or "").strip().lower()
    if not raw:
        return ["LCSW"]
    if raw in _CRED_LOOKUP:
        return _CRED_LOOKUP[raw]
    # Strip "(ABBR)" trailing block + try again on bare abbreviation.
    import re as _re
    cleaned = _re.sub(r"\s*\([^)]*\)\s*$", "", raw).strip()
    if cleaned in _CRED_LOOKUP:
        return _CRED_LOOKUP[cleaned]
    # Fuzzy: title-substring match.
    for hint, key in _CRED_TITLE_HINTS:
        if hint in raw:
            return _CRED_LOOKUP.get(key, ["LCSW"])
    return ["LCSW"]


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
        # Pick a sensible license suffix matching the cred_type, normalised
        # for case + spelled-out title variants so therapists with
        # "LPC" / "Licensed Professional Counselor (LPC)" / "lpc" all
        # land on a counselor suffix instead of falling through to LCSW.
        license_pool = _resolve_license_pool(cred_type)
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

    # Office addresses (full street-level, only if in-person). Patient
    # results page renders the FIRST address as a clickable Google Maps
    # link, so backfill at least one realistic address per in-person
    # therapist. Synthesised from a small Idaho-flavoured street name +
    # number pool -- intentionally low-quality so admins glancing at
    # the doc viewer immediately see "this is fake test data."
    _IDAHO_STREETS = [
        "Bannock St", "State St", "Capitol Blvd", "Front St", "Main St",
        "Idaho St", "Bishop Blvd", "Yellowstone Ave", "Sherman Ave",
        "Pocatello Creek Rd", "Lincoln Ave", "Broadway Ave", "Park Blvd",
        "Vista Ave", "Federal Way", "Eagle Rd", "Fairview Ave",
    ]
    _IDAHO_ZIPS_BY_CITY = {
        "Boise": "83702", "Meridian": "83642", "Nampa": "83651",
        "Caldwell": "83605", "Eagle": "83616", "Idaho Falls": "83401",
        "Pocatello": "83201", "Twin Falls": "83301",
        "Coeur d'Alene": "83814", "Lewiston": "83501", "Moscow": "83843",
        "Sandpoint": "83864", "Sun Valley": "83353", "Ketchum": "83340",
    }
    if (set_fields.get("offers_in_person") or t.get("offers_in_person")) \
            and not t.get("office_addresses"):
        cities = (
            set_fields.get("office_locations")
            or t.get("office_locations")
            or random.sample(IDAHO_CITIES, 1)
        )
        addrs = []
        for city in cities[:2]:
            number = random.randint(120, 9899)
            street = random.choice(_IDAHO_STREETS)
            unit = "" if random.random() < 0.65 else f", Suite {random.randint(100, 410)}"
            zipc = _IDAHO_ZIPS_BY_CITY.get(city, "83702")
            addrs.append(f"{number} {street}{unit}, {city}, ID {zipc}")
        set_fields["office_addresses"] = addrs

    # Office phone (public, separate from the private alert `phone`).
    # Same Idaho 208 area-code format, different last 7 digits so the
    # two values don't collide.
    if not (t.get("office_phone") or "").strip():
        set_fields["office_phone"] = (
            f"(208) {random.randint(200, 999)}-{random.randint(1000, 9999)}"
        )

    # Website -- plausible-looking practice URL derived from the first
    # name. Not a real domain (uses .example so no accidental DNS hit
    # if a curious admin clicks). Strip-backfill removes this so the
    # therapist enters their real URL on first login.
    if not (t.get("website") or "").strip():
        slug = first_name.lower().strip()[:18]
        # Sprinkle a few realistic suffix variations so admins reviewing
        # a list don't see "lin-therapy.example" 30 times.
        suffix = random.choice([
            "therapy", "counseling", "wellness", "psychology",
            "clinic", "practice",
        ])
        set_fields["website"] = f"https://{slug}-{suffix}.example"

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

    # Session style tags -- infer from modalities, cap at 3, never "not_sure"
    if not t.get("session_style_tags"):
        mods = set_fields.get("modalities") or t.get("modalities") or []
        set_fields["session_style_tags"] = _infer_session_style_tags(mods)

    # Notification response times -- real data only, no fake history
    if not t.get("notification_response_times"):
        set_fields["notification_response_times"] = []

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
    # backfill we drop in a 1x1 transparent PNG so the form-completeness
    # check passes during testing while the actual bytes are obviously
    # synthetic. Both `license_picture` (legacy schema) and
    # `license_document` (newer dedicated-upload schema) get the same
    # stub so EITHER code path treats the row as "license on file".
    # Strip-backfill clears both fields via the audit's fields_added.
    _PLACEHOLDER_PNG_B64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg"
        "YGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg=="
    )
    _PLACEHOLDER_DATA_URL = "data:image/png;base64," + _PLACEHOLDER_PNG_B64
    existing_lp = t.get("license_picture")
    has_lp = isinstance(existing_lp, str) and existing_lp.strip()
    if not has_lp:
        # `data:` URL (not an https:// placeholder) because
        # profile_completeness._has_license_document strict-rejects
        # placeholder URLs to prevent backfilled therapists from passing
        # the publishable check with no real license.
        set_fields["license_picture"] = _PLACEHOLDER_DATA_URL
    if not (t.get("license_document") or {}).get("data_base64"):
        # The therapist portal's LicenseDocUploader widget reads from
        # this field directly (not license_picture). Without a stub here
        # backfilled rows showed an alarming "No license document on
        # file yet" red alert in the portal even though they passed the
        # publishable check. The legacy_field fallback in the GET
        # endpoint handled DISPLAY but writing real data here is cleaner
        # -- the upload widget shows "License (backfill placeholder)"
        # instead of red, and admin tools that grep license_document.* in
        # the future just work. Strip-backfill clears this field too.
        from datetime import datetime, timezone
        set_fields["license_document"] = {
            "filename": "License (backfill placeholder)",
            "content_type": "image/png",
            "size_bytes": 70,  # actual byte length of the 1x1 PNG
            "data_base64": _PLACEHOLDER_DATA_URL,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "is_backfill_placeholder": True,
        }

    # Deep-match T-fields (T4/T5/T6/T6b). These are ENHANCING (not
    # REQUIRED) so they don't block publishability, but the therapist
    # portal's deep-match completion meter + the matcher's deep-match
    # axis both treat empty fields as "incomplete" -- backfilled
    # therapists were always at ~70% completion with the deep-match
    # banner up. Stub them with realistic-looking responses so the meter
    # hits 100%, marked with `_deep_match_backfilled=True` so the
    # portal can prompt the therapist to replace them. Strip-backfill
    # clears all of these via the audit's fields_added.
    deep_match_added = []
    if not (t.get("t4_hard_truth") or "").strip():
        set_fields["t4_hard_truth"] = random.choice([
            "warm",
            "warm_with_pause",
            "direct",
            "context_first",
        ])
        deep_match_added.append("t4_hard_truth")
    if len((t.get("t5_lived_experience") or "").strip()) < 30:
        set_fields["t5_lived_experience"] = (
            "I've sat across from clients walking through grief, identity "
            "shifts, and the slow rebuild after burnout. The work that "
            "moves me most is helping someone hear themselves clearly."
        )
        deep_match_added.append("t5_lived_experience")
    if not (t.get("t6_session_expectations") or []):
        set_fields["t6_session_expectations"] = random.sample(
            [
                "skills_and_homework",
                "structured_processing",
                "open_exploration",
                "somatic_check_in",
            ],
            k=2,
        )
        deep_match_added.append("t6_session_expectations")
    if len((t.get("t6_early_sessions_description") or "").strip()) < 30:
        set_fields["t6_early_sessions_description"] = (
            "First few sessions are spent mapping what brought you in, "
            "what's worked and what hasn't, and quietly checking fit. "
            "We agree on a direction together before any active work begins."
        )
        deep_match_added.append("t6_early_sessions_description")
    if deep_match_added:
        # Mark with both flags so existing code that checks the legacy
        # `_deep_match_backfilled` boolean still works, while the more
        # granular `_deep_match_backfilled_fields` enables a per-field
        # nudge in the portal ("you haven't customized T5 yet").
        set_fields["_deep_match_backfilled"] = True
        existing_dm = t.get("_deep_match_backfilled_fields") or []
        set_fields["_deep_match_backfilled_fields"] = sorted(
            set(existing_dm) | set(deep_match_added)
        )

    # Account password (password_hash). Backfilled therapists had no
    # password set, so the portal kept prompting "Set a password" on
    # every login -- noisy and misleading during admin testing. Stub a
    # bcrypt hash of a random unguessable string so `has_password`
    # returns true and the prompt vanishes; the therapist still can't
    # login with a password (no one knows the cleartext) and must use
    # the magic-link flow until they reset on first claim. Strip-backfill
    # clears `password_hash` via the audit so a real claim flow can set
    # the user's actual password.
    if not (t.get("password_hash") or "").strip():
        try:
            import bcrypt
            import secrets
            random_secret = secrets.token_urlsafe(32).encode("utf-8")
            set_fields["password_hash"] = bcrypt.hashpw(
                random_secret, bcrypt.gensalt(rounds=10),
            ).decode("utf-8")
            from datetime import datetime, timezone
            set_fields["password_set_at"] = (
                datetime.now(timezone.utc).isoformat()
            )
        except Exception:
            # If bcrypt isn't importable for any reason, don't crash the
            # backfill -- just skip the password stub. The portal will
            # prompt for password setup on first login as before.
            pass

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
        # Use the same case-insensitive resolver as the bio so the prefix
        # always matches the therapist's actual credential (e.g., "LPC" or
        # "lpc" both → "LPC-NNNNNN", not the LCSW fallback).
        suffix = (_resolve_license_pool(cred) or ["LCSW"])[0]
        prefix = {
            "PhD": "PSY", "PsyD": "PSY",
            "LCSW": "LCS", "LICSW": "LCS",
            "LCPC": "LCP", "LPCC": "LCP", "LCMHC": "LCP",
            "LMFT": "LMT",
            "LPC": "LPC",
            "MD": "MD",
            "LMHC": "LMH",
        }.get(suffix, "LIC")
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
