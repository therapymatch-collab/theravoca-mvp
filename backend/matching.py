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

from typing import Any

# ─── Constants ────────────────────────────────────────────────────────────────
MAX_ISSUES = 35.0
MAX_AVAILABILITY = 20.0
MAX_MODALITY = 15.0
MAX_URGENCY = 10.0
MAX_PRIOR = 10.0
MAX_EXPERIENCE = 5.0
MAX_GENDER = 3.0
MAX_STYLE = 2.0

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
    accepted = [i.lower() for i in t.get("insurance_accepted") or []]
    if not accepted:
        return False
    if plan and plan not in ("other", "other / not listed"):
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
        return offering in ("in_person", "both")
    return True


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
    pref = r.get("experience_preference") or "no_pref"
    if pref == "no_pref":
        return 0.0
    rng = EXPERIENCE_RANGES.get(pref)
    if not rng:
        return 0.0
    years = t.get("years_experience") or 0
    if rng[0] <= years <= rng[1]:
        return MAX_EXPERIENCE
    # Adjacent range
    keys = list(EXPERIENCE_RANGES.keys())
    if pref in keys:
        i = keys.index(pref)
        adjacent = []
        if i - 1 >= 0:
            adjacent.append(EXPERIENCE_RANGES[keys[i - 1]])
        if i + 1 < len(keys):
            adjacent.append(EXPERIENCE_RANGES[keys[i + 1]])
        for lo, hi in adjacent:
            if lo <= years <= hi:
                return 3.0
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
    }
    total = round(sum(breakdown.values()), 1)
    return {"total": total, "breakdown": breakdown, "filtered": False}


def rank_therapists(
    therapists: list[dict],
    request: dict,
    threshold: float = 71.0,
    top_n: int = 30,
    min_results: int = 3,
) -> list[dict]:
    """Score and filter per spec:
       - send to top N where score >= threshold
       - if fewer than min_results above threshold, lower stepwise (60, 50)
       - return up to top_n therapists
    """
    scored = []
    for t in therapists:
        result = score_therapist(t, request)
        if result["filtered"]:
            continue
        scored.append({**t, "match_score": result["total"], "match_breakdown": result["breakdown"]})

    scored.sort(key=lambda x: x["match_score"], reverse=True)
    above = [s for s in scored if s["match_score"] >= threshold]
    if len(above) >= min_results:
        return above[:top_n]

    # Auto-lower threshold per spec: try 60, then 50
    for cur in (60.0, 50.0):
        if cur >= threshold:
            continue
        above = [s for s in scored if s["match_score"] >= cur]
        if len(above) >= min_results:
            return above[:top_n]

    return scored[:top_n]
