"""Hard-filter capacity computation.

Patient intake has HARD toggles (language_strict, gender_required,
in_person_only, etc.) that, when flipped, drop therapists who don't
pass that axis from the match pool. If the CURRENT active directory
has fewer than `MIN_REQUIRED` therapists passing a given HARD option,
selecting that option would shrink the shortlist below 30 and the
patient would see a mostly-empty result page.

This module computes, for each HARD variant, how many active
therapists currently pass — and tells the intake UI which options to
grey out + the admin Coverage-Gaps panel which protections are active
and why.

Pure-read: never mutates the directory.
"""
from __future__ import annotations

from collections import Counter


MIN_REQUIRED = 30  # target notified count per request


# Filter predicates — one per HARD variant. Each takes a therapist doc
# and returns True if the therapist would pass the given hard option.
# Kept as plain functions (not Mongo queries) because the active pool
# is only ~150 docs; iterating in Python is faster and simpler than
# 30+ separate aggregation pipelines.

def _passes_language(t: dict, lang: str) -> bool:
    if not lang or lang == "English":
        return True  # English is effectively unrestricted — every
                     # therapist speaks English in our directory.
    langs = [str(x).lower() for x in (t.get("languages_spoken") or [])]
    return lang.lower() in langs


def _passes_gender(t: dict, gender: str) -> bool:
    if not gender or gender == "no_pref":
        return True
    return (t.get("gender") or "").lower() == gender.lower()


def _passes_in_person(t: dict) -> bool:
    # Has an in-person office.
    return bool(t.get("office_addresses") or t.get("office_locations"))


def _passes_telehealth(t: dict) -> bool:
    offering = (t.get("modality_offering") or "").lower()
    return offering in ("telehealth", "both")


def _passes_insurance(t: dict, carrier: str) -> bool:
    if not carrier:
        return True
    carriers = [str(x).lower() for x in (t.get("insurance_accepted") or [])]
    return carrier.lower() in carriers


def _passes_urgency(t: dict, urgency: str) -> bool:
    if not urgency or urgency == "flexible":
        return True
    # urgency_capacity is a single string ("asap" / "within_2_3_weeks" /
    # "within_month"), NOT a list. (matching.py line 329 also reads it
    # as a string.) Earlier versions of this file iterated the string
    # as a list which silently broke all urgency-strict checks against
    # any therapist with a populated value.
    cap = (t.get("urgency_capacity") or "").lower()
    if not cap:
        return False
    # Matching ladder — asap can only be filled by asap-capable;
    # within_2_3_weeks accepts asap or within_2_3_weeks, etc.
    ladder = {
        "asap": {"asap"},
        "within_2_3_weeks": {"asap", "within_2_3_weeks"},
        "within_month": {"asap", "within_2_3_weeks", "within_month"},
    }
    accepted = ladder.get(urgency, set())
    return cap in accepted


async def compute_capacity(db) -> dict:
    """Build the full capacity snapshot used by intake + admin views."""
    pool = await db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {
                "$nin": ["past_due", "canceled", "unpaid", "incomplete"],
            },
        },
        {"_id": 0},
    ).to_list(length=None)
    pool_size = len(pool)

    # Languages (case-insensitive counter).
    lang_ci: Counter[str] = Counter()
    for t in pool:
        for raw in (t.get("languages_spoken") or []):
            s = str(raw).strip()
            if s:
                lang_ci[s.lower()] += 1
    # Gender.
    gen_c: Counter[str] = Counter()
    for t in pool:
        g = (t.get("gender") or "").strip().lower()
        if g:
            gen_c[g] += 1
    # Insurance (case-insensitive).
    ins_c: Counter[str] = Counter()
    for t in pool:
        for raw in (t.get("insurance_accepted") or []):
            s = str(raw).strip()
            if s:
                ins_c[s.lower()] += 1
    # Client type (individual / couples / family / group). Each
    # therapist exposes the formats they offer in `client_types`;
    # patients pick exactly one on the intake form.
    ct_c: Counter[str] = Counter()
    for t in pool:
        for raw in (t.get("client_types") or []):
            s = str(raw).strip().lower()
            if s:
                ct_c[s] += 1
    # Age group (child / teen / young_adult / adult / older_adult).
    ag_c: Counter[str] = Counter()
    for t in pool:
        for raw in (t.get("age_groups") or []):
            s = str(raw).strip().lower()
            if s:
                ag_c[s] += 1
    # Urgency ladders — compute each capacity bucket count.
    urgency_counts = {
        u: sum(1 for t in pool if _passes_urgency(t, u))
        for u in ["asap", "within_2_3_weeks", "within_month"]
    }

    in_person = sum(1 for t in pool if _passes_in_person(t))
    telehealth = sum(1 for t in pool if _passes_telehealth(t))

    # Pretty-case lookup for languages so the UI can match its own
    # canonical spelling (e.g. "Mandarin" not "mandarin").
    lang_canonical: dict[str, str] = {}
    for t in pool:
        for raw in (t.get("languages_spoken") or []):
            s = str(raw).strip()
            if s and s.lower() not in lang_canonical:
                lang_canonical[s.lower()] = s

    # Disabled lists — values the patient UI should grey out.
    disabled = {
        # When a non-English language has < MIN_REQUIRED speakers,
        # `language_strict=True` would collapse the pool.
        "language_strict": sorted([
            lang_canonical.get(k, k)
            for k, v in lang_ci.items()
            if k != "english" and v < MIN_REQUIRED
        ]),
        # Gender-required → for any gender with < MIN_REQUIRED
        # therapists, `gender_required=True` would collapse the pool.
        "gender_required": sorted([
            g for g, v in gen_c.items() if v < MIN_REQUIRED
        ]),
        # In-person / telehealth only.
        "in_person_only": in_person < MIN_REQUIRED,
        "telehealth_only": telehealth < MIN_REQUIRED,
        # Insurance carriers with thin coverage.
        "insurance_strict": sorted([
            k for k, v in ins_c.items() if v < MIN_REQUIRED
        ]),
        # Urgency buckets that are HARD and thin.
        "urgency_strict": [
            u for u, v in urgency_counts.items() if v < MIN_REQUIRED
        ],
        # Client type (HARD-by-default — patient picks exactly one
        # and the matcher filters on it). Surfacing thin buckets so
        # the intake form can warn the patient before they pick one
        # we can't fulfil.
        "client_type": sorted([
            ct for ct, v in ct_c.items() if v < MIN_REQUIRED
        ]),
        # Age group (also HARD-by-default).
        "age_group": sorted([
            ag for ag, v in ag_c.items() if v < MIN_REQUIRED
        ]),
    }

    # Human-readable explanations — what the tooltip says.
    protections: list[dict] = []
    for lang in disabled["language_strict"]:
        count = lang_ci.get(lang.lower(), 0)
        protections.append({
            "axis": "language_strict",
            "value": lang,
            "count": count,
            "label": (
                f"Only {count} active therapist{'s' if count != 1 else ''} "
                f"in our directory speak{'' if count == 1 else ''} "
                f"{lang}. Keeping language as a preference (not HARD) "
                f"lets us still show you every Idaho therapist who fits "
                f"your other criteria — you pick who to reach out to."
            ),
        })
    for gender in disabled["gender_required"]:
        count = gen_c.get(gender, 0)
        protections.append({
            "axis": "gender_required",
            "value": gender,
            "count": count,
            "label": (
                f"Only {count} {gender} therapist{'s' if count != 1 else ''} "
                f"in our directory. Requiring {gender} would leave you "
                f"with too few matches."
            ),
        })
    if disabled["in_person_only"]:
        protections.append({
            "axis": "in_person_only",
            "value": "in_person_only",
            "count": in_person,
            "label": (
                f"Only {in_person} therapist{'s' if in_person != 1 else ''} "
                f"currently offer{'' if in_person == 1 else 's'} in-person "
                f"sessions in Idaho. Choose 'Prefer in-person' instead — "
                f"we'll rank in-person therapists first but keep "
                f"telehealth options available."
            ),
        })
    if disabled["telehealth_only"]:
        protections.append({
            "axis": "telehealth_only",
            "value": "telehealth_only",
            "count": telehealth,
            "label": (
                f"Only {telehealth} therapist{'s' if telehealth != 1 else ''} "
                f"currently offer{'' if telehealth == 1 else 's'} telehealth-only "
                f"in Idaho."
            ),
        })
    for carrier in disabled["insurance_strict"]:
        count = ins_c.get(carrier.lower(), 0)
        protections.append({
            "axis": "insurance_strict",
            "value": carrier,
            "count": count,
            "label": (
                f"Only {count} therapist{'s' if count != 1 else ''} in "
                f"network for {carrier.title()}. Keeping insurance as a "
                f"preference lets us show you their cash-pay alternatives too."
            ),
        })
    for u in disabled["urgency_strict"]:
        count = urgency_counts.get(u, 0)
        protections.append({
            "axis": "urgency_strict",
            "value": u,
            "count": count,
            "label": (
                f"Only {count} therapist{'s' if count != 1 else ''} "
                f"currently accept {u.replace('_', ' ')} starts."
            ),
        })
    for ct in disabled["client_type"]:
        count = ct_c.get(ct, 0)
        protections.append({
            "axis": "client_type",
            "value": ct,
            "count": count,
            "label": (
                f"Only {count} therapist{'s' if count != 1 else ''} in our "
                f"directory offer {ct} therapy. Picking this would leave "
                f"you with too few matches — we're actively recruiting "
                f"more {ct} therapists in Idaho."
            ),
        })
    for ag in disabled["age_group"]:
        count = ag_c.get(ag, 0)
        pretty = ag.replace("_", " ")
        protections.append({
            "axis": "age_group",
            "value": ag,
            "count": count,
            "label": (
                f"Only {count} therapist{'s' if count != 1 else ''} "
                f"in our directory see {pretty} clients. We're "
                f"actively recruiting {pretty} specialists in Idaho."
            ),
        })

    return {
        "pool_size": pool_size,
        "min_required": MIN_REQUIRED,
        "counts": {
            "language": {
                (lang_canonical.get(k, k)): v for k, v in lang_ci.items()
            },
            "gender": dict(gen_c),
            "insurance": dict(ins_c),
            "urgency": urgency_counts,
            "in_person": in_person,
            "telehealth": telehealth,
            "client_type": dict(ct_c),
            "age_group": dict(ag_c),
        },
        "disabled": disabled,
        "protections": protections,
    }
