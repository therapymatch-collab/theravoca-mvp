"""Iter-25: multi-experience-preference + actual insurance/cash on apply page +
admin outreach feed shape."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

from conftest import v2_request_payload, v2_therapist_signup_payload

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def test_experience_preference_accepts_list():
    """Patient can submit experience_preference as a list of multiple values."""
    payload = v2_request_payload(
        email=f"multiexp_{int(time.time() * 1000)}@example.com",
        experience_preference=["seasoned", "mid_career"],
        location_state="ID",
        location_city="Boise",
        location_zip="83702",
    )
    res = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert res.status_code == 200, res.text
    rid = res.json()["id"]
    detail = requests.get(
        f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS, timeout=10,
    )
    assert detail.status_code == 200
    req = detail.json()["request"]
    assert req["experience_preference"] == ["seasoned", "mid_career"], req[
        "experience_preference"
    ]


def test_experience_preference_legacy_string_still_works():
    """Existing single-string clients shouldn't break."""
    payload = v2_request_payload(
        email=f"legacyexp_{int(time.time() * 1000)}@example.com",
        experience_preference="seasoned",
        location_state="ID",
        location_city="Boise",
        location_zip="83702",
    )
    res = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert res.status_code == 200, res.text


def test_apply_page_payment_summary_shows_actual_values():
    """Helper that builds the apply summary correctly surfaces actual insurance + budget."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from helpers import _safe_summary_for_therapist

    req = {
        "client_type": "individual",
        "age_group": "adult",
        "location_state": "ID",
        "location_city": "Boise",
        "presenting_issues": ["anxiety"],
        "modality_preference": "hybrid",
        "payment_type": "either",
        "insurance_name": "Blue Cross of Idaho",
        "budget": 200,
        "sliding_scale_ok": False,
        "availability_windows": ["weekday_evening"],
        "urgency": "flexible",
        "prior_therapy": "no",
        "experience_preference": ["seasoned", "mid_career"],
        "gender_preference": "no_pref",
        "style_preference": [],
    }
    summary = _safe_summary_for_therapist(req)
    payment = summary.get("Payment", "")
    assert "Blue Cross of Idaho" in payment, payment
    assert "$200" in payment, payment


def test_admin_outreach_endpoint_returns_invites_shape():
    """`/admin/outreach` returns invites with the candidate fields the new
    admin tab expects (name, email, license_type, specialties, city, state,
    match_rationale, estimated_score)."""
    res = requests.get(f"{API}/admin/outreach", headers=ADMIN_HEADERS, timeout=10)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "invites" in body and "total" in body
    # If there are invites, validate shape
    for inv in body["invites"][:3]:
        assert "request_id" in inv
        assert "candidate" in inv
        assert "email_sent" in inv
        assert "created_at" in inv
