"""Therapist matching engine for TheraVoca.

Scoring is split into small, testable helpers. Total max = 100.
- State match (REQUIRED, hard filter)
- Issue/specialty match (40 pts)
- Age match (15 pts)
- Insurance/payment match (20 pts)
- Location proximity (15 pts; only if in-person)
- Modality match (10 pts; from preferences)
"""
from __future__ import annotations

import re
from typing import Any


# ─── Constants ────────────────────────────────────────────────────────────────

ISSUE_KEYWORDS: dict[str, list[str]] = {
    "anxiety": ["anxiety", "anxious", "panic", "worry", "phobia"],
    "depression": ["depression", "depressed", "sad", "mood", "low mood"],
    "trauma": ["trauma", "ptsd", "abuse", "assault"],
    "couples": ["couple", "couples", "marriage", "marital", "relationship"],
    "family": ["family", "parent", "parenting", "child", "teen", "adolescent"],
    "grief": ["grief", "loss", "bereavement", "mourning"],
    "addiction": ["addict", "substance", "alcohol", "drug", "recovery"],
    "lgbtq": ["lgbtq", "lgbt", "queer", "gay", "lesbian", "trans", "nonbinary"],
    "eating": ["eating", "anorexia", "bulimia", "body image"],
    "ocd": ["ocd", "obsessive", "compulsive"],
    "adhd": ["adhd", "attention", "focus"],
    "stress": ["stress", "burnout", "overwhelm"],
    "self-esteem": ["self-esteem", "confidence", "self worth"],
    "career": ["career", "work", "job", "professional"],
    "identity": ["identity", "self-discovery"],
}

MAX_ISSUE = 40.0
MAX_AGE = 15.0
MAX_PAYMENT = 20.0
MAX_LOCATION = 15.0
MAX_MODALITY = 10.0


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _extract_issues(presenting_issues: str) -> set[str]:
    text = re.sub(r"\s+", " ", presenting_issues.lower()).strip()
    found: set[str] = set()
    for canonical, aliases in ISSUE_KEYWORDS.items():
        if any(alias in text for alias in aliases):
            found.add(canonical)
    return found


def _age_in_band(age: int, band: str) -> bool:
    """band examples: 'children-5-12', 'teen-13-17', 'adult-18-64', 'older-65+'"""
    band = band.lower()
    nums = re.findall(r"\d+", band)
    if "+" in band and nums:
        return age >= int(nums[-1])
    if len(nums) >= 2:
        return int(nums[0]) <= age <= int(nums[1])
    return False


def _state_passes(therapist: dict[str, Any], request: dict[str, Any]) -> bool:
    licensed = [s.upper() for s in therapist.get("licensed_states", [])]
    req_state = (request.get("location_state") or "").upper()
    return not req_state or req_state in licensed


def _score_issue(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    requested = _extract_issues(request.get("presenting_issues", ""))
    if not requested:
        return MAX_ISSUE / 2  # neutral if no issues parsed
    weights = {s.get("name", "").lower(): s.get("weight", 0) for s in therapist.get("specialties", [])}
    matched = requested & set(weights.keys())
    if not matched:
        return 0.0
    raw = min(sum(weights.get(m, 20) for m in matched), 100)
    return round(MAX_ISSUE * (raw / 100), 1)


def _score_age(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    client_age = request.get("client_age")
    bands = therapist.get("ages_served", [])
    if not client_age or not bands:
        return MAX_AGE / 2
    return MAX_AGE if any(_age_in_band(int(client_age), b) for b in bands) else 0.0


def _score_payment(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    payment_type = (request.get("payment_type") or "").lower()
    if payment_type == "insurance":
        return _score_insurance(therapist, request)
    if payment_type == "cash":
        return _score_cash(therapist, request)
    return MAX_PAYMENT / 2


def _score_insurance(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    req_ins = (request.get("insurance_name") or "").lower().strip()
    accepted = [i.lower() for i in therapist.get("insurance_accepted", [])]
    if req_ins and req_ins in accepted:
        return MAX_PAYMENT
    if accepted:
        return 8.0
    return 0.0


def _score_cash(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    budget = request.get("budget")
    cash_rate = therapist.get("cash_rate")
    if not budget or not cash_rate:
        return MAX_PAYMENT / 2
    try:
        rate = int(cash_rate)
        cap = int(budget)
    except (TypeError, ValueError):
        return MAX_PAYMENT / 2
    if rate <= cap:
        return MAX_PAYMENT
    if rate <= cap * 1.2:
        return 10.0
    return 4.0


def _score_location(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    """Distance-banded location score.

    If we have geocoded patient + office data, use real miles:
      ≤10mi=15, ≤25mi=12, ≤50mi=7, ≤75mi=3, >75mi=0 (telehealth fallback if available).
    If we don't have geo data, fall back to case-insensitive city substring match.
    """
    fmt = (request.get("session_format") or "virtual").lower()
    needs_in_person = "person" in fmt or "hybrid" in fmt

    if not needs_in_person:
        return MAX_LOCATION if therapist.get("telehealth") else 0.0

    # Try geo-based scoring first
    patient_geo = request.get("patient_geo")  # {"lat":.., "lng":..}
    office_geos = therapist.get("office_geos") or []
    if patient_geo and office_geos:
        from geocoding import haversine_miles
        miles_list = [
            haversine_miles(patient_geo["lat"], patient_geo["lng"], o["lat"], o["lng"])
            for o in office_geos if "lat" in o and "lng" in o
        ]
        if miles_list:
            best = min(miles_list)
            if best <= 10:
                return MAX_LOCATION
            if best <= 25:
                return 12.0
            if best <= 50:
                return 7.0
            if best <= 75:
                return 3.0
            return 6.0 if therapist.get("telehealth") else 0.0

    # Fallback: case-insensitive city substring match (legacy behavior)
    req_city = (request.get("location_city") or "").lower().strip()
    offices = [o.lower() for o in therapist.get("office_locations", [])]
    if req_city and any(req_city in o or o in req_city for o in offices):
        return MAX_LOCATION
    return 6.0 if therapist.get("telehealth") else 0.0


def _score_modality(therapist: dict[str, Any], request: dict[str, Any]) -> float:
    pref = (request.get("preferred_modality") or "").lower().strip()
    if not pref:
        return MAX_MODALITY / 2
    modalities = [m.lower() for m in therapist.get("modalities", [])]
    if any(pref in m or m in pref for m in modalities):
        return MAX_MODALITY
    return 2.0


# ─── Public API ───────────────────────────────────────────────────────────────

def score_therapist(therapist: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    """Return scoring breakdown and total. total=-1 indicates filtered out."""
    if not _state_passes(therapist, request):
        return {"total": -1, "breakdown": {"state": "no match"}, "filtered": True}

    breakdown = {
        "issue": _score_issue(therapist, request),
        "age": _score_age(therapist, request),
        "payment": _score_payment(therapist, request),
        "location": _score_location(therapist, request),
        "modality": _score_modality(therapist, request),
    }
    total = round(sum(breakdown.values()), 1)
    return {"total": total, "breakdown": breakdown, "filtered": False}


def rank_therapists(
    therapists: list[dict[str, Any]],
    request: dict[str, Any],
    threshold: float = 60.0,
    min_results: int = 5,
) -> list[dict[str, Any]]:
    """Score and filter. Auto-lower threshold if too few matches."""
    scored = []
    for t in therapists:
        result = score_therapist(t, request)
        if result["filtered"]:
            continue
        scored.append({**t, "match_score": result["total"], "match_breakdown": result["breakdown"]})

    scored.sort(key=lambda x: x["match_score"], reverse=True)

    above = [s for s in scored if s["match_score"] >= threshold]
    if len(above) >= min_results:
        return above

    cur = threshold
    while cur > 20 and len(above) < min_results:
        cur -= 10
        above = [s for s in scored if s["match_score"] >= cur]
    return above if above else scored[:min_results]
