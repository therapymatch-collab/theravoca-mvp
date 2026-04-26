"""Iteration-4 regression: refactored matching.py helpers must produce identical
totals & breakdown structure as before. score_therapist max=100 unchanged.

Covers explicit cases from the review request:
- State mismatch -> total=-1, filtered=true
- Perfect cash fit (Boise in-person, age 28, $150 budget, anxiety+depression,
  CBT, telehealth+Boise office) -> total ~ 100
- Insurance match (Aetna in accepted) -> payment 20/20
- No-issue-match -> issue 0, but other axes still pass
- rank_therapists still filters by state and auto-lowers threshold
"""
import os
import sys
import uuid

import pytest
import requests

# Make /app/backend importable so we can call matching helpers directly.
sys.path.insert(0, "/app/backend")
from matching import (  # noqa: E402
    rank_therapists,
    score_therapist,
)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN = {"X-Admin-Password": "admin123!"}


# ── Fixtures: synthetic therapists & request ─────────────────────────────────

def _perfect_cash_therapist():
    return {
        "id": "T_perfect",
        "name": "Perfect Fit",
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [
            # Weights sum to 100 so issue axis hits MAX_ISSUE (40) per formula:
            #   raw = min(sum(weights), 100); score = MAX_ISSUE * raw/100
            {"name": "anxiety", "weight": 60},
            {"name": "depression", "weight": 40},
        ],
        "modalities": ["CBT"],
        "ages_served": ["adult-18-64"],
        "insurance_accepted": [],
        "cash_rate": 120,  # under $150 budget
    }


def _aetna_insurance_therapist():
    return {
        "id": "T_aetna",
        "name": "Aetna Accepts",
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [{"name": "anxiety", "weight": 30}],
        "modalities": ["CBT"],
        "ages_served": ["adult-18-64"],
        "insurance_accepted": ["Aetna", "BCBS"],
        "cash_rate": 200,
    }


def _no_match_therapist():
    return {
        "id": "T_nomatch",
        "name": "Different Specialty",
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [{"name": "career", "weight": 30}],  # patient wants anxiety
        "modalities": ["CBT"],
        "ages_served": ["adult-18-64"],
        "insurance_accepted": [],
        "cash_rate": 120,
    }


def _wrong_state_therapist():
    return {
        "id": "T_wrong_state",
        "name": "California Only",
        "licensed_states": ["CA"],
        "office_locations": ["LA"],
        "telehealth": True,
        "specialties": [{"name": "anxiety", "weight": 40}],
        "modalities": ["CBT"],
        "ages_served": ["adult-18-64"],
        "insurance_accepted": [],
        "cash_rate": 100,
    }


def _cash_request():
    return {
        "client_age": 28,
        "location_state": "ID",
        "location_city": "Boise",
        "session_format": "in-person",
        "payment_type": "cash",
        "budget": 150,
        "presenting_issues": "I have anxiety and depression",
        "preferred_modality": "CBT",
    }


def _insurance_request():
    return {
        "client_age": 28,
        "location_state": "ID",
        "location_city": "Boise",
        "session_format": "virtual",
        "payment_type": "insurance",
        "insurance_name": "Aetna",
        "presenting_issues": "anxiety and panic attacks",
        "preferred_modality": "CBT",
    }


# ── Hard filter: state mismatch ──────────────────────────────────────────────

def test_state_mismatch_is_hard_filter():
    out = score_therapist(_wrong_state_therapist(), _cash_request())
    assert out["total"] == -1
    assert out["filtered"] is True
    assert "breakdown" in out


# ── Perfect-fit cash patient should total ~100 ───────────────────────────────

def test_perfect_cash_fit_totals_100():
    out = score_therapist(_perfect_cash_therapist(), _cash_request())
    assert out["filtered"] is False
    bd = out["breakdown"]
    # all axes should be at their maximums
    assert bd["issue"] == 40.0, bd
    assert bd["age"] == 15.0, bd
    assert bd["payment"] == 20.0, bd
    assert bd["location"] == 15.0, bd
    assert bd["modality"] == 10.0, bd
    assert out["total"] == 100.0, out


# ── Insurance match scores 20/20 ─────────────────────────────────────────────

def test_insurance_match_full_20():
    out = score_therapist(_aetna_insurance_therapist(), _insurance_request())
    assert out["filtered"] is False
    assert out["breakdown"]["payment"] == 20.0, out


# ── No-issue-match: issue=0, others still pass ───────────────────────────────

def test_no_issue_match_zero_but_other_axes_pass():
    out = score_therapist(_no_match_therapist(), _cash_request())
    assert out["filtered"] is False
    bd = out["breakdown"]
    assert bd["issue"] == 0.0, bd
    # Other axes still produce points
    assert bd["age"] == 15.0
    assert bd["payment"] == 20.0
    assert bd["location"] == 15.0
    assert bd["modality"] == 10.0
    # total = 0 + 15 + 20 + 15 + 10 = 60
    assert out["total"] == 60.0


# ── Breakdown structure is stable ────────────────────────────────────────────

def test_breakdown_keys_unchanged():
    out = score_therapist(_perfect_cash_therapist(), _cash_request())
    assert set(out["breakdown"].keys()) == {"issue", "age", "payment", "location", "modality"}
    assert set(out.keys()) == {"total", "breakdown", "filtered"}


# ── rank_therapists still filters by state ───────────────────────────────────

def test_rank_filters_out_wrong_state():
    therapists = [_wrong_state_therapist(), _perfect_cash_therapist(), _no_match_therapist()]
    ranked = rank_therapists(therapists, _cash_request(), threshold=50.0, min_results=1)
    ids = [r["id"] for r in ranked]
    assert "T_wrong_state" not in ids
    assert "T_perfect" in ids


# ── rank_therapists auto-lowers threshold when too few matches ───────────────

def test_rank_auto_lowers_threshold():
    therapists = [_no_match_therapist()]  # totals 60
    # Threshold above 60, but min_results=1: should auto-lower below 60.
    ranked = rank_therapists(therapists, _cash_request(), threshold=90.0, min_results=1)
    assert len(ranked) >= 1
    assert ranked[0]["id"] == "T_nomatch"


def test_rank_returns_top_n_when_zero_above_any_threshold():
    # Single therapist with very low score; rank_therapists should still return it.
    weak = _no_match_therapist()
    weak["specialties"] = []
    weak["ages_served"] = []
    ranked = rank_therapists([weak], _cash_request(), threshold=99.0, min_results=1)
    assert len(ranked) >= 1


# ── End-to-end: POST /api/requests + verify -> matching populated ───────────

def test_e2e_request_verify_triggers_matching():
    payload = {
        "email": f"TEST_iter4_{uuid.uuid4().hex[:6]}@example.com",
        "client_age": 28,
        "location_state": "ID",
        "location_city": "Boise",
        "session_format": "virtual",
        "payment_type": "cash",
        "budget": 150,
        "presenting_issues": "iter4 regression: anxiety and depression",
        "preferred_modality": "CBT",
    }
    s = requests.Session()
    r = s.post(f"{BASE}/api/requests", json=payload)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]

    # Pull token directly from Mongo
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _tok():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        d = c[os.environ.get("DB_NAME", "test_database")]
        return (await d.requests.find_one({"id": rid}))["verification_token"]

    token = asyncio.run(_tok())
    v = s.get(f"{BASE}/api/requests/verify/{token}")
    assert v.status_code == 200 and v.json()["verified"] is True

    import time
    time.sleep(4)
    detail = s.get(f"{BASE}/api/admin/requests/{rid}", headers=ADMIN).json()
    notified = detail["notified"]
    assert len(notified) >= 5
    # match_score must be present and numeric > 0
    for n in notified:
        assert "match_score" in n
        assert n["match_score"] > 0


# ── Regression sweep on previous endpoints (still 200) ──────────────────────

def test_regression_endpoints_smoke():
    s = requests.Session()
    assert s.get(f"{BASE}/api/").status_code == 200
    assert s.get(f"{BASE}/api/admin/stats", headers=ADMIN).status_code == 200
    assert s.get(f"{BASE}/api/admin/requests", headers=ADMIN).status_code == 200
    assert s.get(f"{BASE}/api/admin/therapists", headers=ADMIN).status_code == 200
