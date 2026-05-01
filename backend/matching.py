"""TheraVoca matching engine v2 — per the MVP spec.

Total max = 100 across 8 weighted axes:
  Presenting issues 35, Availability 20, Modality 15, Urgency 10,
  Prior therapy 10, Experience 5, Gender 3, Style 2.

Hard filters (return total=-1):
  state license, client type, age group, payment fit,
  modality (when patient says telehealth-only or in-person-only),
  gender (when patient marks gender preference as required).
"""
from __future__ import annotations

from typing import Any, Optional

# ─── Constants ────────────────────────────────────────────────────────────────
MAX_ISSUES = 35.0
MAX_AVAILABILITY = 20.0
MAX_MODALITY = 15.0
MAX_URGENCY = 10.0
MAX_PRIOR = 10.0
MAX_EXPERIENCE = 5.0
MAX_GENDER = 3.0
MAX_STYLE = 2.0
MAX_PAYMENT_FIT = 3.0  # bonus when patient accepts sliding scale AND therapist offers it
MAX_PAYMENT_ALIGNMENT = 10.0  # penalty axis: 0 when patient asked for a specific insurance/cash path the therapist can't meet
MAX_MODALITY_PREF = 4.0  # bonus when patient's preferred modalities (CBT/DBT/etc.) match therapist's
# Patient `Anything else?` free-text resonance bonus. Embedded once at
# request creation, then cosine-compared against therapist T5/T2
# embeddings. Capped at 6 points so it materially differentiates the
# top of the rank without overwhelming the structured-fit signal.
MAX_OTHER_ISSUE_BONUS = 6.0
# Patient `prior_therapy_notes` free-text resonance bonus. Smaller than
# `other_issue` because the two signals overlap conceptually and we
# don't want to double-count when both are filled in.
MAX_PRIOR_THERAPY_BONUS = 4.0

# Maps experience preference label -> (lo, hi) years
EXPERIENCE_RANGES = {
    "0-3": (0, 3),
    "3-7": (3, 7),
    "7-15": (7, 15),
    "15+": (15, 100),
}

URGENCY_ORDER = ["asap", "within_2_3_weeks", "within_month", "flexible"]
THERAPIST_URGENCY_ORDER = ["asap", "within_2_3_weeks", "within_month", "full"]


# ─── Hard filter helpers ──────────────────────────────────────────────────────

def _state_pass(t: dict, r: dict) -> bool:
    licensed = [s.upper() for s in t.get("licensed_states") or []]
    return (r.get("location_state") or "").upper() in licensed


def _client_type_pass(t: dict, r: dict) -> bool:
    needed = (r.get("client_type") or "").lower()
    if not needed:
        return True
    types = [c.lower() for c in t.get("client_types") or []]
    return needed in types


def _age_group_pass(t: dict, r: dict) -> bool:
    needed = (r.get("age_group") or "").lower()
    if not needed:
        return True
    served = [a.lower() for a in t.get("age_groups") or []]
    return needed in served


def _primary_concern_pass(t: dict, r: dict) -> bool:
    """Hard filter: therapist must list the patient's primary concern in
    primary, secondary, OR general specialties — anywhere they treat it
    counts. The patient's primary concern is the first (top-priority)
    item in `presenting_issues`. If the patient picked nothing or only
    "other", we don't filter (the matcher will fall back to soft scoring).
    """
    issues = [
        i.lower() for i in (r.get("presenting_issues") or [])
        if i and i.lower() != "other"
    ]
    if not issues:
        return True
    primary = issues[0]
    treats = (
        {s.lower() for s in t.get("primary_specialties") or []}
        | {s.lower() for s in t.get("secondary_specialties") or []}
        | {s.lower() for s in t.get("general_treats") or []}
    )
    return primary in treats


def _payment_pass(t: dict, r: dict) -> bool:
    """Payment compatibility. Hard by default, but the patient can soften
    it by leaving `insurance_strict` False — in which case insurance-only
    plans that don't match still pass (they pay out-of-pocket later).
    """
    pay = (r.get("payment_type") or "either").lower()
    # When the patient hasn't explicitly demanded a specific carrier,
    # treat insurance as a soft preference (let the score down-rank
    # mismatches but don't filter them out entirely).
    strict = bool(r.get("insurance_strict"))
    if pay == "either":
        # "Either" is permissive by definition — only filter if the
        # therapist truly accepts neither.
        return _insurance_match(t, r) or _cash_match(t, r)
    if pay == "insurance":
        if not strict:
            # Soft: accept if therapist takes patient's plan OR if the
            # patient also gave a budget that the therapist's cash rate
            # fits (lets out-of-network bookings happen).
            return _insurance_match(t, r) or _cash_match(t, r)
        return _insurance_match(t, r)
    if pay == "cash":
        return _cash_match(t, r)
    return True


def _availability_pass(t: dict, r: dict) -> bool:
    """Availability hard-filter when the patient has ticked
    `availability_strict`. Otherwise availability is purely soft (axis
    score). Strict mode requires at least one window overlap unless the
    patient picked 'flexible'.
    """
    if not r.get("availability_strict"):
        return True
    patient = {w for w in (r.get("availability_windows") or []) if w}
    if not patient or "flexible" in patient:
        return True
    therapist = {w for w in (t.get("availability_windows") or []) if w}
    if not therapist:
        # Therapist hasn't published a schedule — fail closed in strict mode.
        return False
    return bool(patient & therapist)


def _urgency_pass(t: dict, r: dict) -> bool:
    """Urgency hard-filter when the patient has ticked `urgency_strict`.
    'asap' patients require a therapist with `urgency_capacity` of 'asap'
    or 'within_2_3_weeks'. 'within_2_3_weeks' patients require either
    of those two. Otherwise the filter is a no-op."""
    if not r.get("urgency_strict"):
        return True
    pu = (r.get("urgency") or "").lower()
    tu = (t.get("urgency_capacity") or "").lower()
    if pu == "asap":
        return tu in ("asap", "within_2_3_weeks")
    if pu == "within_2_3_weeks":
        return tu in ("asap", "within_2_3_weeks", "within_month")
    if pu == "within_month":
        return tu in ("asap", "within_2_3_weeks", "within_month")
    # 'flexible' or empty — never filters.
    return True


def _language_pass(t: dict, r: dict) -> bool:
    """Language hard-filter when patient has ticked `language_strict`.
    Skipped entirely when patient's preferred_language is empty/English
    (English is the implicit default — no filter needed). Skipped when
    `language_strict=False` (soft scoring axis handles preference).
    """
    pl = (r.get("preferred_language") or "").strip().lower()
    if not pl or pl == "english":
        return True
    if not r.get("language_strict"):
        return True
    spoken = {
        (s or "").strip().lower()
        for s in (t.get("languages_spoken") or [])
    }
    return pl in spoken


def _insurance_match(t: dict, r: dict) -> bool:
    plan = (r.get("insurance_name") or "").lower().strip()
    # "Other / not listed" = patient doesn't know exact carrier — skip the filter entirely
    if plan in ("other", "other / not listed"):
        return True
    accepted = [i.lower() for i in t.get("insurance_accepted") or []]
    if not accepted:
        return False
    if plan:
        return plan in accepted
    return True


def _cash_match(t: dict, r: dict) -> bool:
    budget = r.get("budget")
    rate = t.get("cash_rate")
    if not budget or not rate:
        return True
    try:
        budget_n = int(budget)
        rate_n = int(rate)
    except (TypeError, ValueError):
        return True
    if r.get("sliding_scale_ok") and t.get("sliding_scale"):
        # Sliding-scale therapist + patient open to it: accept up to 2x budget
        return rate_n <= budget_n * 2
    return rate_n <= budget_n * 1.2  # 20% tolerance


def _modality_pass(t: dict, r: dict) -> bool:
    pref = (r.get("modality_preference") or "").lower()
    offering = (t.get("modality_offering") or "both").lower()
    if pref == "telehealth_only":
        return offering in ("telehealth", "both")
    if pref == "in_person_only":
        if offering not in ("in_person", "both"):
            return False
        # 30-mile distance filter for in-person seekers
        return _distance_within(t, r, miles=30.0)
    if pref == "prefer_inperson":
        # Soft preference — only filter out true in-person at >30mi distance.
        if offering == "in_person":
            return _distance_within(t, r, miles=30.0)
        return True
    return True


def _distance_within(t: dict, r: dict, miles: float) -> bool:
    """Return True if any of the therapist's offices is within `miles` of the
    patient. If we don't have geo data on either side, default to True (don't
    block the match — let the patient + therapist sort it out)."""
    import logging
    _log = logging.getLogger(__name__)
    p = r.get("patient_geo") or {}
    plat, plng = p.get("lat"), p.get("lng")
    if plat is None or plng is None:
        _log.warning(
            "GEO_MISSING: Patient request %s has no geocoded location "
            "(city=%s, zip=%s) — distance filter bypassed",
            r.get("id", "?"), r.get("location_city", ""), r.get("location_zip", ""),
        )
        return True
    offices = t.get("office_geos") or []
    if not offices:
        _log.warning(
            "GEO_MISSING: Therapist %s (%s) has no office_geos — "
            "distance filter bypassed",
            t.get("id", "?"), t.get("name", "?"),
        )
        return True
    for o in offices:
        olat, olng = o.get("lat"), o.get("lng")
        if olat is None or olng is None:
            continue
        # Inline haversine to avoid circular imports
        from math import asin, cos, radians, sin, sqrt
        dlat = radians(olat - plat)
        dlng = radians(olng - plng)
        a = sin(dlat / 2) ** 2 + cos(radians(plat)) * cos(radians(olat)) * sin(dlng / 2) ** 2
        d_miles = 2 * 3958.8 * asin(sqrt(a))
        if d_miles <= miles:
            return True
    return False


def _gender_pass(t: dict, r: dict) -> bool:
    if not r.get("gender_required"):
        return True
    pref = (r.get("gender_preference") or "").lower()
    if not pref or pref == "no_pref":
        return True
    return (t.get("gender") or "").lower() == pref


# ─── Weighted scoring helpers ─────────────────────────────────────────────────

def _score_issue_one(t: dict, issue: str) -> float:
    issue = issue.lower()
    if issue in [s.lower() for s in t.get("primary_specialties") or []]:
        return 35.0
    if issue in [s.lower() for s in t.get("secondary_specialties") or []]:
        return 25.0
    if issue in [s.lower() for s in t.get("general_treats") or []]:
        return 15.0
    return 0.0


def _score_issues(t: dict, r: dict) -> float:
    issues = [i for i in (r.get("presenting_issues") or []) if i and i != "other"]
    if not issues:
        return MAX_ISSUES / 2  # neutral if none parsed
    # Top issue gets 60% weight, the rest split the other 40%
    primary_score = _score_issue_one(t, issues[0])
    if len(issues) == 1:
        return round(primary_score, 1)
    rest_scores = [_score_issue_one(t, i) for i in issues[1:]]
    rest_avg = sum(rest_scores) / len(rest_scores)
    blended = primary_score * 0.6 + rest_avg * 0.4
    return round(min(blended, MAX_ISSUES), 1)


def _score_availability(t: dict, r: dict) -> float:
    patient = set([w for w in (r.get("availability_windows") or []) if w])
    if not patient:
        return MAX_AVAILABILITY / 2
    if "flexible" in patient:
        return MAX_AVAILABILITY
    therapist = set([w for w in (t.get("availability_windows") or []) if w])
    if not therapist:
        return 5.0  # unknown
    overlap = patient & therapist
    if len(overlap) >= 2 or (overlap and len(patient) <= 2):
        return MAX_AVAILABILITY
    if overlap:
        return 10.0
    return 0.0


def _score_modality(t: dict, r: dict) -> float:
    pref = (r.get("modality_preference") or "").lower()
    offering = (t.get("modality_offering") or "both").lower()
    if not pref:
        return MAX_MODALITY / 2
    # Exact match
    if pref == "telehealth_only" and offering == "telehealth":
        return MAX_MODALITY
    if pref == "in_person_only" and offering == "in_person":
        return MAX_MODALITY
    if pref == "hybrid" and offering == "both":
        return MAX_MODALITY
    # Acceptable alternatives
    if pref == "prefer_inperson" and offering == "in_person":
        return MAX_MODALITY
    if pref == "prefer_inperson" and offering == "both":
        return 10.0
    if pref == "prefer_inperson" and offering == "telehealth":
        return 5.0
    if pref == "prefer_telehealth" and offering == "telehealth":
        return MAX_MODALITY
    if pref == "prefer_telehealth" and offering == "both":
        return 10.0
    if pref == "prefer_telehealth" and offering == "in_person":
        return 5.0
    if pref == "telehealth_only" and offering == "both":
        return 10.0
    if pref == "in_person_only" and offering == "both":
        return 10.0
    if pref == "hybrid":
        return 10.0
    return 0.0


def _score_urgency(t: dict, r: dict) -> float:
    patient = (r.get("urgency") or "flexible").lower()
    therapist = (t.get("urgency_capacity") or "within_month").lower()
    if patient == "flexible":
        return MAX_URGENCY
    if therapist == "full":
        return 0.0
    p_idx = URGENCY_ORDER.index(patient) if patient in URGENCY_ORDER else 3
    t_idx = THERAPIST_URGENCY_ORDER.index(therapist) if therapist in THERAPIST_URGENCY_ORDER else 2
    if t_idx <= p_idx:
        return MAX_URGENCY
    if t_idx == p_idx + 1:
        return 6.0
    return 3.0


def _score_prior_therapy(t: dict, r: dict) -> float:
    prior = (r.get("prior_therapy") or "not_sure").lower()
    years = t.get("years_experience") or 0
    style_tags = [s.lower() for s in t.get("style_tags") or []]
    if prior == "no":
        # Beginner-friendly therapists score higher
        if "warm_supportive" in style_tags or "structured" in style_tags:
            return MAX_PRIOR
        return 6.0
    if prior == "yes_helped":
        return 6.0
    if prior == "yes_not_helped":
        # Patient wants something different — favor experienced therapists with deeper specialty
        if years >= 7 and len(t.get("primary_specialties") or []) >= 1:
            return MAX_PRIOR
        return 6.0
    return 3.0  # not_sure


def _score_experience(t: dict, r: dict) -> float:
    """Patient may pass `experience_preference` as a list (preferred) or legacy
    string. Score returns the BEST match across any of their selections."""
    raw = r.get("experience_preference") or "no_pref"
    prefs = raw if isinstance(raw, list) else [raw]
    prefs = [p for p in prefs if p and p != "no_pref"]
    if not prefs:
        return 0.0
    years = t.get("years_experience") or 0
    best = 0.0
    keys = list(EXPERIENCE_RANGES.keys())
    for pref in prefs:
        rng = EXPERIENCE_RANGES.get(pref)
        if not rng:
            continue
        if rng[0] <= years <= rng[1]:
            return MAX_EXPERIENCE  # exact match short-circuits
        if pref in keys:
            i = keys.index(pref)
            for adj_i in (i - 1, i + 1):
                if 0 <= adj_i < len(keys):
                    lo, hi = EXPERIENCE_RANGES[keys[adj_i]]
                    if lo <= years <= hi:
                        best = max(best, 3.0)
    return best
    return 0.0


def _score_gender(t: dict, r: dict) -> float:
    pref = (r.get("gender_preference") or "no_pref").lower()
    if pref == "no_pref":
        return 0.0
    return MAX_GENDER if (t.get("gender") or "").lower() == pref else 0.0


def _score_style(t: dict, r: dict) -> float:
    prefs = [s.lower() for s in (r.get("style_preference") or []) if s and s != "no_pref"]
    if not prefs:
        return 0.0
    therapist = [s.lower() for s in (t.get("style_tags") or [])]
    overlap = set(prefs) & set(therapist)
    if len(overlap) >= 2 or (overlap and len(prefs) == 1):
        return MAX_STYLE
    if overlap:
        return 1.0
    return 0.0


def _score_payment_fit(t: dict, r: dict) -> float:
    """Bonus axis: patient accepts sliding scale AND therapist offers it."""
    if r.get("sliding_scale_ok") and t.get("sliding_scale"):
        return MAX_PAYMENT_FIT
    return 0.0


def _score_payment_alignment(t: dict, r: dict) -> float:
    """Soft-penalty axis: scores whether the patient's stated payment
    path is actually viable with this therapist.

    Returns MAX_PAYMENT_ALIGNMENT (full credit) when at least one viable
    payment route exists; 0 when the patient asked for a specific
    insurance / cash-budget path and the therapist can't meet any of
    them. Without this axis a soft-insurance mismatch shows ~96% match
    even when the therapist doesn't take the patient's plan and the
    patient gave no cash budget — misleading the patient.

    Logic:
      * `payment_type = either` → full credit (no specific demand).
      * `payment_type = insurance` with a specific plan:
          - therapist accepts it → full
          - patient OK'd sliding-scale + therapist offers it → full
          - patient gave a cash budget that fits → full
          - none of the above → 0
      * `payment_type = cash`:
          - no budget given → full (not enough info to penalize)
          - budget fits therapist's rate (≤ 1.2× or ≤ 2× w/ sliding) → full
          - rate exceeds budget → 0
    """
    pay = (r.get("payment_type") or "either").lower()
    if pay == "either":
        return MAX_PAYMENT_ALIGNMENT

    # Insurance path.
    if pay == "insurance":
        plan = (r.get("insurance_name") or "").strip()
        # No specific plan supplied — can't penalize; full credit.
        if not plan or plan.lower() in ("other", "other / not listed"):
            return MAX_PAYMENT_ALIGNMENT
        if _insurance_match(t, r):
            return MAX_PAYMENT_ALIGNMENT
        # Out-of-network fallback paths.
        if r.get("sliding_scale_ok") and t.get("sliding_scale"):
            return MAX_PAYMENT_ALIGNMENT
        if r.get("budget") and _cash_match(t, r):
            return MAX_PAYMENT_ALIGNMENT
        return 0.0

    # Cash path.
    if pay == "cash":
        if not r.get("budget"):
            return MAX_PAYMENT_ALIGNMENT
        return MAX_PAYMENT_ALIGNMENT if _cash_match(t, r) else 0.0

    return MAX_PAYMENT_ALIGNMENT


def _score_modality_pref(t: dict, r: dict) -> float:
    """Bonus axis: patient lists preferred therapy modalities (CBT/DBT/EMDR/etc.)
    that overlap with the therapist's modalities. Up to MAX_MODALITY_PREF.
    """
    prefs = [m.lower().strip() for m in (r.get("modality_preferences") or []) if m]
    if not prefs:
        return 0.0
    therapist = [m.lower().strip() for m in (t.get("modalities") or [])]
    overlap = set(prefs) & set(therapist)
    if not overlap:
        return 0.0
    if len(overlap) >= 2 or len(prefs) == 1:
        return MAX_MODALITY_PREF
    return MAX_MODALITY_PREF * 0.6


# ─── Public API ───────────────────────────────────────────────────────────────

# Maps the patient-facing "priority factor" keys to the scoring axes they
# emphasise. When the patient picks one of these on intake, the listed
# axes get multiplied by `PRIORITY_BOOST` and re-normalised so the total
# stays in [0, 100]. Picking nothing leaves the default weights intact.
PRIORITY_AXES = {
    # The "always hard" axes (specialty/concern via _primary_concern_pass)
    # and the patient-toggleable hards (payment/availability/urgency/
    # gender via *_strict flags) live OUTSIDE this boost map — they're
    # already enforced or flagged at filter-time. Boost factors only
    # apply to the remaining SOFT axes the patient wants weighted higher.
    "modality":   ["modality", "modality_pref"],
    "experience": ["experience"],
    "identity":   ["gender", "style"],
}
# Multiplier applied to score axes the patient flagged as a priority.
# Tuned down from 1.8 → 1.15 in iter-77 because the larger boost
# blew past the 100-pt ceiling for *every* qualifying therapist when
# the patient picked 3+ priorities — the proportional scale-back then
# crushed everyone to 100, removing all differentiation. 1.15 is
# enough to nudge ranking while keeping totals well within 0-100.
PRIORITY_BOOST = 1.15


def _priority_weights(priority_factors: list[str]) -> dict[str, float]:
    """Return a per-axis weight map. Axes the patient selected get
    `PRIORITY_BOOST`; everything else stays at 1.0. Empty selection
    returns an all-1.0 map (default behaviour).
    """
    weights = {ax: 1.0 for ax in [
        "issues", "availability", "modality", "urgency",
        "prior_therapy", "experience", "gender", "style",
        "payment_fit", "payment_alignment", "modality_pref",
    ]}
    for f in priority_factors or []:
        for axis in PRIORITY_AXES.get(f, []):
            weights[axis] = PRIORITY_BOOST
    return weights


def _patient_expressed_axis(r: dict, axis: str) -> bool:
    """Per-axis check used by strict-mode: did the patient actually tell
    us something concrete about THIS scoring axis? If not, we skip the
    strict-mode filter for it (otherwise picking a priority factor
    composed of multiple axes — e.g. 'identity' = gender + style —
    would drop every therapist when the patient set only one of them).
    """
    if axis == "issues":
        return bool([i for i in (r.get("presenting_issues") or []) if i and i != "other"])
    if axis == "modality":
        return bool((r.get("modality_preference") or "").strip())
    if axis == "modality_pref":
        return bool([m for m in (r.get("modality_preferences") or []) if m])
    if axis == "availability":
        return bool([w for w in (r.get("availability_windows") or []) if w])
    if axis == "urgency":
        return (r.get("urgency") or "").strip() not in ("", "flexible")
    if axis == "payment_fit":
        return bool(r.get("sliding_scale_ok"))
    if axis == "gender":
        return (r.get("gender_preference") or "").lower() not in ("", "no_pref")
    if axis == "style":
        return bool([s for s in (r.get("style_preference") or []) if s and s != "no_pref"])
    return False


# ─── Deep-match scoring (Iter-89 v2) ───────────────────────────────────
# Three axes activated only when the patient opted into the deep flow
# (request.deep_match_opt_in is True) AND the therapist has answered
# the corresponding T-fields. Each axis returns a 0–1 sub-score; the
# bonus added to the total is `weight * sub_score * DEEP_MATCH_SCALE`.
#
# Default weights match the founder's v2 spec:
#   relationship_style 0.40 / way_of_working 0.35 / contextual_resonance 0.25
# Admins can override these in `app_config.deep_match_weights`. The
# scale factor pegs the maximum total deep bonus to 30 score points
# (≈ a 30% lift over baseline) — large enough that deep answers can
# meaningfully reorder results, small enough that they can't swamp
# hard-requirement axes like specialty and licensure.
_DEEP_MATCH_DEFAULT_WEIGHTS = {
    "relationship_style": 0.40,
    "way_of_working": 0.35,
    "contextual_resonance": 0.25,
}
_DEEP_MATCH_SCALE = 30.0  # max bonus per axis ≈ weight * 30

# Canonical option order for P1/T1 vectors. Indices here drive the
# 6-slot binary/rank vectors used by `_score_relationship_style`.
_P1_T1_KEYS = (
    "leads_structured",   # 0
    "follows_lead",       # 1
    "challenges",         # 2
    "warm_first",         # 3
    "direct_honest",      # 4
    "guides_questions",   # 5
)

# T4 → adjustments to the therapist's T1 rank vector. Each T4 slug
# emphasises certain positions on the directiveness/warmth axis. These
# values come straight from the v2 spec.
_T4_BOOST_MAP: dict[str, dict[int, float]] = {
    "direct":      {2: 0.15, 4: 0.15},
    "incremental": {3: 0.10},
    "questions":   {5: 0.15},
    "emotional":   {3: 0.10},
    "wait":        {3: 0.10, 1: 0.05},
}


def _p1_to_vector(picks: list[str]) -> list[float]:
    """Binary 6-vector for the patient's P1 selections."""
    return [1.0 if k in picks else 0.0 for k in _P1_T1_KEYS]


def _t1_rank_to_vector(rank_order: list[str]) -> list[float]:
    """Therapist's T1 ranking → normalised 6-vector. The slug at index 0
    of `rank_order` is rank-1 (most instinctive) → 1.0; index 5 is
    rank-6 → 0.0. Slugs missing from the input default to 0.0 so a
    therapist who hasn't answered T1 yet scores neutrally rather than
    being penalised."""
    pos: dict[str, int] = {slug: i for i, slug in enumerate(rank_order or [])}
    out = [0.0] * 6
    for i, key in enumerate(_P1_T1_KEYS):
        if key in pos:
            out[i] = (5 - pos[key]) / 5.0
    return out


def _apply_t4_boost(t_vec: list[float], t4: str | None) -> list[float]:
    """Add T4-driven boosts to the therapist rank vector and clamp at
    1.0. Pure function — caller passes a copy if it doesn't want
    mutation."""
    if not t4 or t4 not in _T4_BOOST_MAP:
        return t_vec
    out = list(t_vec)
    for idx, boost in _T4_BOOST_MAP[t4].items():
        out[idx] = min(1.0, out[idx] + boost)
    return out


def _cosine6(a: list[float], b: list[float]) -> float:
    """Cosine similarity for fixed 6-vectors. Returns 0 when either is
    all-zero so an unanswered side never penalises."""
    import math
    num = sum(x * y for x, y in zip(a, b))
    da = math.sqrt(sum(x * x for x in a))
    db = math.sqrt(sum(x * x for x in b))
    if da == 0 or db == 0:
        return 0.0
    return num / (da * db)


def _score_relationship_style(
    p1_picks: list[str], t1_ranks: list[str], t4: str | None
) -> float:
    """Dimension 1 — Relationship Style (weight 0.40 in v2 spec).

    score = cosine_sim(P1_vec, blend(T1_rank_vec, T4))

    P1_vec is a 6-element binary vector indicating the 2 picks. T1
    ranking is normalised so rank-1 → 1.0, rank-6 → 0.0. T4 boosts
    specific positions per `_T4_BOOST_MAP` (e.g., a "direct" T4 lifts
    `challenges` and `direct_honest` slots by 0.15 each)."""
    if not p1_picks or not t1_ranks:
        return 0.0
    p_vec = _p1_to_vector(p1_picks)
    t_vec = _t1_rank_to_vector(t1_ranks)
    t_vec = _apply_t4_boost(t_vec, t4)
    return round(_cosine6(p_vec, t_vec), 4)


def _score_way_of_working(p2_picks: list[str], t3_picks: list[str]) -> float:
    """Dimension 2 — Way of Working (weight 0.35 in v2 spec). Both pick
    exactly 2 from the same set of 6 slugs; score = (overlapping picks) / 2.
    So: 0 shared → 0.0, 1 shared → 0.5, 2 shared → 1.0.
    """
    if not p2_picks or not t3_picks:
        return 0.0
    overlap = len(set(p2_picks) & set(t3_picks))
    return overlap / 2.0


def _score_contextual_resonance(
    p3_embedding: list[float] | None,
    t5_embedding: list[float] | None,
    t2_embedding: list[float] | None,
) -> float:
    """Dimension 3 — Contextual Resonance (weight 0.25 in v2 spec).
    score = 0.7 * sim(P3, T5) + 0.3 * sim(P3, T2). Cosine sim is
    clamped to [0,1] so weakly opposite vectors don't subtract from
    the bonus.
    """
    from embeddings import cosine_similarity
    sim_t5 = max(0.0, cosine_similarity(p3_embedding, t5_embedding))
    sim_t2 = max(0.0, cosine_similarity(p3_embedding, t2_embedding))
    return round(0.7 * sim_t5 + 0.3 * sim_t2, 4)


def _deep_match_bonus(
    r: dict, t: dict, *, weights: dict[str, float] | None = None
) -> dict[str, Any]:
    """Compute the three v2 sub-scores + the total bonus. Returns the
    breakdown so the admin debug view can show patients WHY a therapist
    scored higher (e.g., "your style picks aligned with their top-2 instincts").
    """
    weights = weights or _DEEP_MATCH_DEFAULT_WEIGHTS
    rel = _score_relationship_style(
        r.get("p1_communication") or [],
        t.get("t1_stuck_ranked") or [],
        t.get("t4_hard_truth"),
    )
    work = _score_way_of_working(
        r.get("p2_change") or [],
        t.get("t3_breakthrough") or [],
    )
    ctx = _score_contextual_resonance(
        r.get("p3_embedding"),
        t.get("t5_embedding"),
        t.get("t2_embedding"),
    )
    bonus = (
        weights["relationship_style"] * rel
        + weights["way_of_working"] * work
        + weights["contextual_resonance"] * ctx
    ) * _DEEP_MATCH_SCALE
    return {
        "relationship_style": round(rel, 4),
        "way_of_working": round(work, 4),
        "contextual_resonance": round(ctx, 4),
        "weights": weights,
        "bonus": round(bonus, 2),
    }



def score_therapist(
    t: dict,
    r: dict,
    *,
    research_cache: Optional[dict] = None,
) -> dict[str, Any]:
    """Return scoring breakdown + total. total=-1 indicates filtered out.

    `research_cache` (when provided) is the therapist's pre-warmed deep-
    research cache (`therapist.research_cache`). When present and warm
    (has `themes` extracted), we fold the evidence-depth + approach-
    alignment bonus directly into the final score so the score the
    therapist sees in their notification matches the score the patient
    sees on the results page. No LLM calls happen here — it's pure set
    arithmetic over the cached themes + the patient's brief.
    """
    # ── Hard filters (always-on) ──────────────────────────────────────
    if not _state_pass(t, r):
        return {"total": -1, "filter_failed": "state", "filtered": True}
    if not _client_type_pass(t, r):
        return {"total": -1, "filter_failed": "client_type", "filtered": True}
    if not _age_group_pass(t, r):
        return {"total": -1, "filter_failed": "age_group", "filtered": True}
    if not _primary_concern_pass(t, r):
        return {
            "total": -1,
            "filter_failed": "primary_concern",
            "filtered": True,
        }
    # ── Patient-toggleable hard filters (soft by default) ─────────────
    if not _payment_pass(t, r):
        return {"total": -1, "filter_failed": "payment", "filtered": True}
    if not _modality_pass(t, r):
        return {"total": -1, "filter_failed": "modality", "filtered": True}
    if not _gender_pass(t, r):
        return {"total": -1, "filter_failed": "gender", "filtered": True}
    if not _availability_pass(t, r):
        return {"total": -1, "filter_failed": "availability", "filtered": True}
    if not _urgency_pass(t, r):
        return {"total": -1, "filter_failed": "urgency", "filtered": True}
    if not _language_pass(t, r):
        return {"total": -1, "filter_failed": "language", "filtered": True}

    raw = {
        "issues": _score_issues(t, r),
        "availability": _score_availability(t, r),
        "modality": _score_modality(t, r),
        "urgency": _score_urgency(t, r),
        "prior_therapy": _score_prior_therapy(t, r),
        "experience": _score_experience(t, r),
        "gender": _score_gender(t, r),
        "style": _score_style(t, r),
        "payment_fit": _score_payment_fit(t, r),
        "payment_alignment": _score_payment_alignment(t, r),
        "modality_pref": _score_modality_pref(t, r),
    }

    # Strict mode: patient said "don't show me anyone who scores zero on
    # my top priorities." Hard-filter any therapist that whiffed an axis
    # the patient flagged as important — but ONLY if the patient actually
    # expressed a preference on that axis. e.g. picking "identity" with
    # gender_preference='no_pref' would otherwise drop every therapist
    # because _score_gender returns 0 when the patient doesn't care.
    priority_factors = list(r.get("priority_factors") or [])
    if r.get("strict_priorities") and priority_factors:
        for f in priority_factors:
            for axis in PRIORITY_AXES.get(f, []):
                if not _patient_expressed_axis(r, axis):
                    continue
                if (raw.get(axis) or 0) <= 0:
                    return {
                        "total": -1,
                        "filter_failed": f"strict_priority_{f}",
                        "filtered": True,
                    }

    # Apply patient-customizable weight multipliers. To preserve
    # discrimination on the 0-100 scale (instead of crushing every
    # decent match to 100 via a hard cap), we scale the breakdown
    # PROPORTIONALLY when the boosted sum exceeds 100. This keeps the
    # SAME relative ordering as if there were no cap, while still
    # bounding all displayed scores in [0, 100].
    #
    # Worked example: patient picks 3 axes (specialty/schedule/payment)
    # and a therapist scores 140 raw across the boosted axes. We
    # multiply every axis by 100/140 ≈ 0.714, so the therapist now
    # scores 100. A weaker therapist whose raw total is 110 gets
    # 110*0.714 ≈ 78.6 — they're still meaningfully behind the top.
    weights = _priority_weights(priority_factors)
    breakdown = {ax: round(v * weights[ax], 2) for ax, v in raw.items()}
    # Reputation boost — verified online reviews ≥ 4.5★ adds +5 (out of 100).
    review_avg = float(t.get("review_avg") or 0)
    review_count = int(t.get("review_count") or 0)
    if review_avg >= 4.5 and review_count >= 3:
        breakdown["reviews"] = 5
    elif review_avg >= 4.0 and review_count >= 3:
        breakdown["reviews"] = 2
    else:
        breakdown["reviews"] = 0
    # Differentiator bonus — adds up to +1.5 in fractional points so two
    # otherwise-identical therapists don't display the same integer score.
    # Uses verified-review quality, years experience, and review-count
    # depth. Capped well below the next bucket boundary so it can't
    # promote a 69 above a 70 threshold cutoff.
    diff_bonus = 0.0
    if review_avg >= 4.0 and review_count >= 3:
        # 0-1.0: heavily weights both rating and depth-of-reviews
        import math as _math
        diff_bonus += min(
            1.0,
            (review_avg - 4.0) * 0.6 + _math.log10(review_count + 1) * 0.15,
        )
    years = float(t.get("years_experience") or 0)
    if years > 0:
        # 0-0.5: 0 yrs → 0, 5 yrs → 0.25, 20 yrs → 0.5
        diff_bonus += min(0.5, years / 40.0)
    breakdown["differentiator"] = round(diff_bonus, 2)

    # Language soft axis — small bonus when the patient's preferred
    # language is in the therapist's `languages_spoken`. Skipped when
    # patient's preferred_language is empty or English (the implicit
    # default) so we don't bias every match toward "Spanish-speaking
    # but not your language" therapists. The corresponding hard filter
    # at `_language_pass` already covers strict-mode requests.
    pl = (r.get("preferred_language") or "").strip().lower()
    if pl and pl != "english":
        spoken = {
            (s or "").strip().lower()
            for s in (t.get("languages_spoken") or [])
        }
        breakdown["language"] = 4 if pl in spoken else 0

    raw_total = sum(breakdown.values())
    # Proportional scale-down (only when boosted) so we don't squash
    # everyone to 100. Threshold filtering still uses the displayed
    # `total`, but because we scale BEFORE truncation, a therapist
    # who originally scored 70 (no boost) doesn't get penalised — the
    # scaling only kicks in when raw_total > 100.
    if raw_total > 100.0 and raw_total > 0:
        scale = 100.0 / raw_total
        for ax in list(breakdown.keys()):
            breakdown[ax] = round(breakdown[ax] * scale, 2)
        total = 100.0
    else:
        total = round(raw_total, 2)

    # ── Research-cache bonus (folded directly into the live score) ────
    # When the therapist has a warm pre-warm cache, we project it through
    # the patient's brief now (cheap set arithmetic, no LLM call) so the
    # final score reflects evidence-graded specialty match + style/modality
    # alignment. This used to live in a separate background task — moving
    # it inline means notifications go out with the SAME score the patient
    # eventually sees, and re-ranking (a deep-cache match jumping from #6
    # to #2) actually works.
    research_axes: dict[str, Any] = {}
    if research_cache:
        try:
            from research_enrichment import _score_axes
            research_axes = _score_axes(research_cache, r)
            bonus = (
                float(research_axes.get("evidence_depth") or 0)
                + float(research_axes.get("approach_alignment") or 0)
            )
            if bonus:
                breakdown["research_bonus"] = round(bonus, 2)
                total = round(min(120.0, total + bonus), 2)
        except Exception:
            # Defensive: a malformed cache should never break scoring.
            research_axes = {}
    # ── Deep-match bonus (Iter-89) ────────────────────────────────────
    # Three additional axes activated when the patient opted in. Each
    # sub-score is in [0,1]; we multiply by configurable weights and
    # _DEEP_MATCH_SCALE before adding to the total. Always recorded in
    # the return payload so the admin debug view can display the
    # breakdown even when the patient skipped deep mode (sub-scores
    # will be 0.0, bonus 0.0).
    deep = None
    if r.get("deep_match_opt_in"):
        weights = (r.get("_deep_weights")  # set by caller to override
                   or _DEEP_MATCH_DEFAULT_WEIGHTS)
        deep = _deep_match_bonus(r, t, weights=weights)
        if deep["bonus"]:
            breakdown["deep_match"] = deep["bonus"]
            total = round(min(150.0, total + deep["bonus"]), 2)
    # ── Patient `other_issue` free-text resonance bonus ─────────────
    # When the patient filled in *Anything else?* on intake, we
    # embedded their text at request creation. Cosine similarity vs the
    # therapist's T5 lived-experience and T2 progress-story embeddings
    # awards up to MAX_OTHER_ISSUE_BONUS points. This closes the gap
    # the text-impact experiment surfaced — the engine was previously
    # blind to this textarea, so two patients with identical slug
    # picks but different free-text ranked therapists identically.
    other_issue_axes: dict[str, float] = {}
    oi_vec = r.get("other_issue_embedding")
    if oi_vec:
        try:
            from embeddings import cosine_similarity
            sim_t5 = max(0.0, cosine_similarity(oi_vec, t.get("t5_embedding")))
            sim_t2 = max(0.0, cosine_similarity(oi_vec, t.get("t2_embedding")))
            blended = round(0.7 * sim_t5 + 0.3 * sim_t2, 4)
            bonus_oi = round(blended * MAX_OTHER_ISSUE_BONUS, 2)
            if bonus_oi:
                breakdown["other_issue_bonus"] = bonus_oi
                total = round(total + bonus_oi, 2)
            other_issue_axes = {
                "sim_t5": round(sim_t5, 4),
                "sim_t2": round(sim_t2, 4),
                "blended": blended,
                "bonus": bonus_oi,
            }
        except Exception:
            other_issue_axes = {}
    # ── Patient `prior_therapy_notes` free-text resonance bonus ─────
    # Patients describe what worked / didn't work in past therapy
    # ("liked her style, took time to know us both"). Embed at request
    # creation, cosine-compare against therapist T5/T2, soft-bonus when
    # they resonate. Capped at MAX_PRIOR_THERAPY_BONUS=4 points so we
    # don't double-count the very similar `other_issue_bonus`.
    prior_therapy_axes: dict[str, float] = {}
    pt_vec = r.get("prior_therapy_embedding")
    if pt_vec:
        try:
            from embeddings import cosine_similarity
            sim_t5 = max(0.0, cosine_similarity(pt_vec, t.get("t5_embedding")))
            sim_t2 = max(0.0, cosine_similarity(pt_vec, t.get("t2_embedding")))
            blended = round(0.7 * sim_t5 + 0.3 * sim_t2, 4)
            bonus_pt = round(blended * MAX_PRIOR_THERAPY_BONUS, 2)
            if bonus_pt:
                breakdown["prior_therapy_bonus"] = bonus_pt
                total = round(total + bonus_pt, 2)
            prior_therapy_axes = {
                "sim_t5": round(sim_t5, 4),
                "sim_t2": round(sim_t2, 4),
                "blended": blended,
                "bonus": bonus_pt,
            }
        except Exception:
            prior_therapy_axes = {}
    # Cap displayed match-score at 95: no match is ever truly perfect,
    # and a 100% chip on the patient UI sets an expectation we can't
    # meet (every therapist falls short of "perfect" on something —
    # personality fit, life experience, the small things we can't
    # measure). 95 still communicates "exceptional fit" while leaving
    # head-room for honesty. Filtering / -1 sentinels are NOT capped.
    if isinstance(total, (int, float)) and total > 0:
        total = min(95.0, total)
        # Round to a whole number so every UI surface (patient results,
        # therapist portal, admin dashboard, simulator) renders the
        # same integer without each callsite needing its own
        # Math.round / toFixed(0). Filter sentinels (-1) skip this.
        total = int(round(total))
    return {
        "total": total,
        "breakdown": breakdown,
        "filtered": False,
        "research_axes": research_axes,  # rationale + chips for the patient view
        "deep_match": deep,
        "other_issue_axes": other_issue_axes,  # cosine breakdown for free-text bonus
        "prior_therapy_axes": prior_therapy_axes,  # cosine breakdown for prior-therapy free-text bonus
    }


def _tiebreaker(t: dict) -> tuple[float, float, float, float]:
    """Tiebreaker tuple applied AFTER the integer match_score. Returns
    values that resolve identical match_scores by:
      1. Verified review quality (avg × log10(count+1)) — real social proof
      2. Years of experience — seasoned therapists slightly preferred
      3. Recency of profile activity — active therapists outrank stale ones
      4. Hash of the therapist id — final stable shuffle so we don't
         consistently favour alphabetical order when EVERYTHING else
         is equal.
    All values are returned negated so a desc-sort works the same as
    the primary `match_score` desc-sort (higher is better).
    """
    review_avg = float(t.get("review_avg") or 0.0)
    review_count = int(t.get("review_count") or 0)
    import math as _math
    review_signal = review_avg * _math.log10(review_count + 1)
    years = float(t.get("years_experience") or 0.0)
    # Recency: prefer therapists whose `updated_at` is recent — stale
    # profiles indicate the therapist may have moved on.
    from helpers import _parse_iso as _piso
    updated = _piso(t.get("updated_at") or t.get("created_at") or "")
    recency = updated.timestamp() if updated else 0.0
    # Stable per-therapist random-ish offset so two genuinely-identical
    # therapists don't always sort the same way (avoids one therapist
    # always getting the top slot at the expense of another). SHA-256
    # used purely as a stable hash function — not for any security purpose.
    tid = (t.get("id") or t.get("email") or "").encode("utf-8")
    import hashlib as _h
    salt = int(_h.sha256(tid).hexdigest()[:8], 16) / 0xFFFFFFFF
    return (review_signal, years, recency, salt)


def rank_therapists(
    therapists: list[dict],
    request: dict,
    threshold: float = 70.0,
    top_n: int = 30,
    min_results: int = 3,
    *,
    research_caches: Optional[dict[str, dict]] = None,
    decline_history: Optional[dict[str, dict]] = None,
) -> list[dict]:
    """Score and filter per spec:
       - hard floor: never include therapists below `threshold` (default 70)
       - target up to `top_n` matches
       - if fewer than `min_results` clear the floor, return what we have
         (caller should trigger Phase D outreach to find more)

    Identical `match_score` values are tie-broken via `_tiebreaker` so
    the ordering is deterministic AND meaningful — the 70-point therapist
    with 80 verified reviews ranks above the 70-point therapist with 0.

    `research_caches` (optional): {therapist_id: research_cache_dict}.
    Pre-fetched once by the caller so we make ONE Mongo round-trip
    instead of N. Therapists missing from the map score without the
    research-axis bonus.

    `decline_history` (optional): {therapist_id: {decline_count, last_decline_at,
    has_recent_similar_decline}}. When provided, therapists with a recent
    decline against a similar request get a small ranking penalty so we
    don't keep notifying providers who routinely turn down this concern.
    """
    research_caches = research_caches or {}
    decline_history = decline_history or {}
    scored = []
    for t in therapists:
        cache = research_caches.get(t.get("id"))
        result = score_therapist(t, request, research_cache=cache)
        if result["filtered"]:
            continue
        # Decline-history penalty (soft re-rank, not a strict filter).
        # We don't filter outright — capacity may have changed since the
        # decline — but the -10pt penalty re-ranks them lower. NOTE: a
        # therapist sitting just above the threshold (e.g. score 75)
        # will drop to 65 and fall below the 70-point cutoff applied
        # below — that's intended. They've actively declined a similar
        # request in the last 30 days; we'd rather route to someone who
        # hasn't recently said no, even if their raw score was a hair lower.
        dh = decline_history.get(t.get("id")) or {}
        if dh.get("has_recent_similar_decline"):
            result["total"] = max(0.0, result["total"] - 10.0)
            result.setdefault("breakdown", {})["decline_penalty"] = -10.0
        scored.append({
            **t,
            "match_score": result["total"],
            "match_breakdown": result["breakdown"],
            "research_axes": result.get("research_axes") or {},
            "other_issue_axes": result.get("other_issue_axes") or {},
            "prior_therapy_axes": result.get("prior_therapy_axes") or {},
        })

    scored.sort(
        key=lambda x: (x["match_score"], *_tiebreaker(x)),
        reverse=True,
    )
    above = [s for s in scored if s["match_score"] >= threshold]
    return above[:top_n]


def gap_axes(
    therapist: dict,
    request: dict,
    breakdown: dict,
    top_n: int = 3,
) -> list[dict]:
    """Return up-to-3 plain-English explanations of *why* this match isn't 100%.

    Each entry: {key, label, explanation, suggestion} — designed for the therapist
    notification email + Apply page so they know exactly what to address in their
    response if they want to apply.
    """
    AXIS = {
        "issues":       (MAX_ISSUES,       "Specializes in patient's concerns"),
        "availability": (MAX_AVAILABILITY, "Schedule overlap"),
        "modality":     (MAX_MODALITY,     "Format (telehealth / in-person)"),
        "urgency":      (MAX_URGENCY,      "How quickly you can start"),
        "prior_therapy":(MAX_PRIOR,        "Fit for patient's therapy history"),
        "experience":   (MAX_EXPERIENCE,   "Years of experience"),
        "gender":       (MAX_GENDER,       "Gender preference"),
        "style":        (MAX_STYLE,        "Style preference"),
        "payment_fit":  (MAX_PAYMENT_FIT,  "Sliding-scale fit"),
        "payment_alignment": (MAX_PAYMENT_ALIGNMENT, "Accepts your payment method"),
        "modality_pref":(MAX_MODALITY_PREF,"Preferred therapy approach"),
    }

    # ─── Per-axis explanation generators ───────────────────────────────────
    def _issues() -> Optional[tuple[str, str]]:
        patient_issues = [i.lower() for i in (request.get("presenting_issues") or []) if i]
        if not patient_issues:
            return None
        primary = {s.lower() for s in therapist.get("primary_specialties") or []}
        secondary = {s.lower() for s in therapist.get("secondary_specialties") or []}
        general = {s.lower() for s in therapist.get("general_treats") or []}
        not_primary = [i for i in patient_issues if i not in primary]
        if not not_primary:
            return None
        # Highest-priority gap: issues not even in secondary/general
        unmatched = [i for i in not_primary if i not in secondary and i not in general]
        nice = ", ".join(_humanize(i) for i in (unmatched or not_primary))
        if unmatched:
            return (
                f"Patient's main concerns include {nice}, which you don't list as a specialty.",
                f"If you have related training or experience with {nice}, mention it in your reply.",
            )
        in_secondary = [i for i in not_primary if i in secondary]
        if in_secondary:
            nice2 = ", ".join(_humanize(i) for i in in_secondary)
            return (
                f"You list {nice2} as secondary — patient flagged {nice2} as a top concern.",
                f"Highlight any specific training or recent cases you've handled with {nice2}.",
            )
        return None

    def _availability() -> Optional[tuple[str, str]]:
        p_windows = set(request.get("availability_windows") or [])
        t_windows = set(therapist.get("availability_windows") or [])
        if not p_windows:
            return None
        missing = p_windows - t_windows
        if not missing:
            return None
        nice = ", ".join(_humanize(w) for w in sorted(missing))
        return (
            f"Patient prefers {nice}, which isn't on your standard schedule.",
            f"If you can flex into {nice} for this patient, say so explicitly.",
        )

    def _modality() -> Optional[tuple[str, str]]:
        pref = (request.get("modality_preference") or "").lower()
        offering = (therapist.get("modality_offering") or "").lower()
        if pref == "telehealth_only" and offering == "in_person":
            return (
                "Patient wants telehealth only; your profile says in-person only.",
                "If you also offer telehealth, update your profile or note it in your reply.",
            )
        if pref == "in_person_only" and offering == "telehealth":
            return (
                "Patient wants in-person only; your profile says telehealth only.",
                "If you have an office option, mention it. Otherwise this isn't a fit.",
            )
        if pref == "prefer_inperson" and offering == "telehealth":
            return (
                "Patient prefers in-person; you're telehealth-only.",
                "Acknowledge this in your reply — some patients flex if the fit feels right.",
            )
        return None

    def _urgency() -> Optional[tuple[str, str]]:
        pu = (request.get("urgency") or "flexible").lower()
        cap = (therapist.get("urgency_capacity") or "within_month").lower()
        order = {"asap": 0, "within_2_3_weeks": 1, "within_month": 2, "full": 3, "flexible": 2}
        if order.get(pu, 2) < order.get(cap, 2):
            patient_label = _humanize(pu)
            cap_label = _humanize(cap)
            return (
                f"Patient needs {patient_label} support; your stated capacity is {cap_label}.",
                "If you have a slot opening up sooner, mention the soonest you could meet.",
            )
        return None

    def _prior_therapy() -> Optional[tuple[str, str]]:
        pt = (request.get("prior_therapy") or "").lower()
        if pt == "yes_not_helped":
            notes = request.get("prior_therapy_notes")
            base = "Patient has tried therapy before and it didn't fully click."
            sugg = (
                "Acknowledge this — share how your approach is different from "
                "what they've tried."
            )
            if notes:
                base += f' They said: "{notes[:120]}"'
            return (base, sugg)
        return None

    def _experience() -> Optional[tuple[str, str]]:
        raw = request.get("experience_preference")
        prefs = raw if isinstance(raw, list) else [raw or ""]
        prefs = [str(p).lower() for p in prefs if p]
        years = therapist.get("years_experience") or 0
        seasoned = {"seasoned", "15+", "10+"}
        if any(p in seasoned for p in prefs) and years < 10:
            return (
                f"Patient prefers a seasoned therapist; you have {years} years.",
                "If you've handled cases with similar complexity, lead with those.",
            )
        return None

    def _gender() -> Optional[tuple[str, str]]:
        pref = (request.get("gender_preference") or "").lower()
        if pref in ("", "no_pref"):
            return None
        actual = (therapist.get("gender") or "").lower()
        if pref != actual:
            required = request.get("gender_required")
            base = f"Patient prefers a {pref} therapist; you're {actual or 'unspecified'}."
            sugg = (
                "This is a hard preference — they may pass, but go ahead and apply if "
                "you feel you're a strong fit on other dimensions."
            ) if required else (
                "It's a soft preference — apply if other dimensions are a clear win."
            )
            return (base, sugg)
        return None

    def _style() -> Optional[tuple[str, str]]:
        prefs = set(request.get("style_preference") or [])
        prefs.discard("no_pref")
        if not prefs:
            return None
        tags = set(therapist.get("style_tags") or [])
        missing = prefs - tags
        if not missing:
            return None
        nice = ", ".join(_humanize(s) for s in sorted(missing))
        return (
            f"Patient's preferred style is {nice}, which isn't on your style tags.",
            f"Speak to how your approach feels {nice} in practice.",
        )

    def _payment_fit() -> Optional[tuple[str, str]]:
        if request.get("payment_type") in ("cash", "either") and request.get("sliding_scale_ok"):
            if not therapist.get("sliding_scale"):
                return (
                    "Patient is open to sliding scale; you don't list it.",
                    "If you can offer a reduced rate for this patient, name a number.",
                )
        return None

    def _modality_pref() -> Optional[tuple[str, str]]:
        prefs = [m for m in (request.get("modality_preferences") or []) if m]
        if not prefs:
            return None
        offered = {m.lower() for m in (therapist.get("modalities") or [])}
        missing = [m for m in prefs if m.lower() not in offered]
        if not missing:
            return None
        nice = ", ".join(missing)
        return (
            f"Patient asked for {nice}; you don't list it as a modality.",
            f"If you have training in {nice} or use a related approach, mention it.",
        )

    def _payment_alignment() -> Optional[tuple[str, str]]:
        pay = (request.get("payment_type") or "either").lower()
        if pay != "insurance":
            return None
        plan = (request.get("insurance_name") or "").strip()
        if not plan or plan.lower() in ("other", "other / not listed"):
            return None
        accepted = [str(s).lower() for s in (therapist.get("insurance_accepted") or [])]
        if plan.lower() in accepted:
            return None
        if request.get("sliding_scale_ok") and therapist.get("sliding_scale"):
            return None
        return (
            f"Patient asked for {plan}; you don't list it as in-network.",
            f"If you bill {plan} via a payer-list provider, or accept superbills, mention it.",
        )

    GENERATORS = {
        "issues": _issues,
        "availability": _availability,
        "modality": _modality,
        "urgency": _urgency,
        "prior_therapy": _prior_therapy,
        "experience": _experience,
        "gender": _gender,
        "style": _style,
        "payment_fit": _payment_fit,
        "payment_alignment": _payment_alignment,
        "modality_pref": _modality_pref,
    }

    # Walk axes ordered by gap size (max - score) desc, return top_n with details
    candidates: list[dict] = []
    for k, (mx, label) in AXIS.items():
        score = breakdown.get(k, 0) or 0
        if mx <= 0 or score >= mx:
            continue
        gen = GENERATORS.get(k)
        result = gen() if gen else None
        if not result:
            continue
       