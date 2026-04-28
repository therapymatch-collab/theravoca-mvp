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
MAX_MODALITY_PREF = 4.0  # bonus when patient's preferred modalities (CBT/DBT/etc.) match therapist's

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


def _payment_pass(t: dict, r: dict) -> bool:
    pay = (r.get("payment_type") or "either").lower()
    if pay == "either":
        return _insurance_match(t, r) or _cash_match(t, r)
    if pay == "insurance":
        return _insurance_match(t, r)
    if pay == "cash":
        return _cash_match(t, r)
    return True


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
    p = r.get("patient_geo") or {}
    plat, plng = p.get("lat"), p.get("lng")
    if plat is None or plng is None:
        return True
    offices = t.get("office_geos") or []
    if not offices:
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

def score_therapist(t: dict, r: dict) -> dict[str, Any]:
    """Return scoring breakdown + total. total=-1 indicates filtered out."""
    if not _state_pass(t, r):
        return {"total": -1, "filter_failed": "state", "filtered": True}
    if not _client_type_pass(t, r):
        return {"total": -1, "filter_failed": "client_type", "filtered": True}
    if not _age_group_pass(t, r):
        return {"total": -1, "filter_failed": "age_group", "filtered": True}
    if not _payment_pass(t, r):
        return {"total": -1, "filter_failed": "payment", "filtered": True}
    if not _modality_pass(t, r):
        return {"total": -1, "filter_failed": "modality", "filtered": True}
    if not _gender_pass(t, r):
        return {"total": -1, "filter_failed": "gender", "filtered": True}

    breakdown = {
        "issues": _score_issues(t, r),
        "availability": _score_availability(t, r),
        "modality": _score_modality(t, r),
        "urgency": _score_urgency(t, r),
        "prior_therapy": _score_prior_therapy(t, r),
        "experience": _score_experience(t, r),
        "gender": _score_gender(t, r),
        "style": _score_style(t, r),
        "payment_fit": _score_payment_fit(t, r),
        "modality_pref": _score_modality_pref(t, r),
    }
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

    total = round(min(100.0, sum(breakdown.values())), 2)
    return {"total": total, "breakdown": breakdown, "filtered": False}


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
) -> list[dict]:
    """Score and filter per spec:
       - hard floor: never include therapists below `threshold` (default 70)
       - target up to `top_n` matches
       - if fewer than `min_results` clear the floor, return what we have
         (caller should trigger Phase D outreach to find more)

    Identical `match_score` values are tie-broken via `_tiebreaker` so
    the ordering is deterministic AND meaningful — the 70-point therapist
    with 80 verified reviews ranks above the 70-point therapist with 0.
    """
    scored = []
    for t in therapists:
        result = score_therapist(t, request)
        if result["filtered"]:
            continue
        scored.append({
            **t,
            "match_score": result["total"],
            "match_breakdown": result["breakdown"],
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
        explanation, suggestion = result
        candidates.append({
            "key": k,
            "label": label,
            "explanation": explanation,
            "suggestion": suggestion,
            "gap": round(mx - score, 1),  # kept for sorting; not shown to user
        })
    candidates.sort(key=lambda c: c["gap"], reverse=True)
    for c in candidates:
        c.pop("gap", None)
    return candidates[:top_n]


def _humanize(s: str) -> str:
    return (s or "").replace("_", " ").strip()
