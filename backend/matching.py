"""Therapist matching engine for TheraVoca.

Simple, transparent scoring (0-100) based on:
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


# Common keyword aliases mapped to canonical specialty tags
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


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _extract_issues(presenting_issues: str) -> set[str]:
    text = _normalize(presenting_issues)
    found = set()
    for canonical, aliases in ISSUE_KEYWORDS.items():
        for alias in aliases:
            if alias in text:
                found.add(canonical)
                break
    return found


def _age_in_band(age: int, band: str) -> bool:
    """band examples: 'children-5-12', 'teen-13-17', 'adult-18-64', 'older-65+'"""
    band = band.lower()
    if "+" in band:
        try:
            low = int(re.findall(r"\d+", band)[-1])
            return age >= low
        except Exception:
            return False
    nums = re.findall(r"\d+", band)
    if len(nums) >= 2:
        return int(nums[0]) <= age <= int(nums[1])
    return False


def score_therapist(therapist: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    """Return scoring breakdown and total. Returns total=-1 if state mismatch (filter)."""
    breakdown: dict[str, float] = {}

    # HARD FILTER: state license
    licensed_states = [s.upper() for s in therapist.get("licensed_states", [])]
    req_state = (request.get("location_state") or "").upper()
    if req_state and req_state not in licensed_states:
        return {"total": -1, "breakdown": {"state": "no match"}, "filtered": True}

    # Issue match (40 pts)
    requested_issues = _extract_issues(request.get("presenting_issues", ""))
    therapist_specialties = {s.get("name", "").lower() for s in therapist.get("specialties", [])}
    therapist_specialty_weights = {
        s.get("name", "").lower(): s.get("weight", 0) for s in therapist.get("specialties", [])
    }
    if requested_issues:
        matched = requested_issues & therapist_specialties
        if matched:
            # Weight by therapist's own specialty weights
            score = sum(therapist_specialty_weights.get(m, 20) for m in matched)
            score = min(score, 100)
            breakdown["issue"] = round(40 * (score / 100), 1)
        else:
            breakdown["issue"] = 0.0
    else:
        breakdown["issue"] = 20.0  # neutral if no issues parsed

    # Age match (15 pts)
    client_age = request.get("client_age")
    ages_served = therapist.get("ages_served", [])
    if client_age and ages_served:
        breakdown["age"] = 15.0 if any(_age_in_band(int(client_age), b) for b in ages_served) else 0.0
    else:
        breakdown["age"] = 7.5

    # Payment match (20 pts)
    payment_type = (request.get("payment_type") or "").lower()
    if payment_type == "insurance":
        req_ins = (request.get("insurance_name") or "").lower().strip()
        accepted = [i.lower() for i in therapist.get("insurance_accepted", [])]
        if req_ins and req_ins in accepted:
            breakdown["payment"] = 20.0
        elif accepted:
            breakdown["payment"] = 8.0
        else:
            breakdown["payment"] = 0.0
    elif payment_type == "cash":
        budget = request.get("budget")
        cash_rate = therapist.get("cash_rate")
        if budget and cash_rate:
            try:
                if int(cash_rate) <= int(budget):
                    breakdown["payment"] = 20.0
                elif int(cash_rate) <= int(budget) * 1.2:
                    breakdown["payment"] = 10.0
                else:
                    breakdown["payment"] = 4.0
            except Exception:
                breakdown["payment"] = 10.0
        else:
            breakdown["payment"] = 10.0
    else:
        breakdown["payment"] = 10.0

    # Location / format (15 pts)
    fmt = (request.get("session_format") or "virtual").lower()
    if "person" in fmt or "hybrid" in fmt:
        # check city overlap
        req_city = (request.get("location_city") or "").lower().strip()
        offices = [o.lower() for o in therapist.get("office_locations", [])]
        if req_city and any(req_city in o or o in req_city for o in offices):
            breakdown["location"] = 15.0
        elif therapist.get("telehealth"):
            breakdown["location"] = 6.0
        else:
            breakdown["location"] = 0.0
    else:
        breakdown["location"] = 15.0 if therapist.get("telehealth") else 0.0

    # Modality / preference (10 pts)
    pref_modality = (request.get("preferred_modality") or "").lower().strip()
    therapist_modalities = [m.lower() for m in therapist.get("modalities", [])]
    if pref_modality:
        if any(pref_modality in m or m in pref_modality for m in therapist_modalities):
            breakdown["modality"] = 10.0
        else:
            breakdown["modality"] = 2.0
    else:
        breakdown["modality"] = 5.0

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

    # Auto-lower threshold by 10 pt steps until we have min_results
    cur = threshold
    while cur > 20 and len(above) < min_results:
        cur -= 10
        above = [s for s in scored if s["match_score"] >= cur]
    return above if above else scored[:min_results]
