"""Iter-57 — match-gap panel + value-tags + DOPL link.

Lightweight pytest covering the new admin response shapes. Heavier
e2e is delegated to the iteration testing agent.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

API = os.environ.get(
    "API_BASE_URL",
    "https://match-engine-test-1.preview.emergentagent.com/api",
)
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
HDR = {"X-Admin-Password": ADMIN_PWD}


def _make_request(presenting_issue: str = "anxiety") -> str:
    payload = {
        "email": f"iter57+{uuid.uuid4().hex[:8]}@test.example.com",
        "phone": "",
        "client_type": "individual",
        "age_group": "adult",
        "location_state": "ID",
        "location_city": "Boise",
        "location_zip": "83702",
        "presenting_issues": [presenting_issue],
        "modality_preference": "telehealth",
        "payment_type": "cash",
        "budget": 200,
        "urgency": "within_2_3_weeks",
        "previous_therapy": False,
        "gender_preference": "any",
        "preferred_language": "English",
        "sms_opt_in": False,
        "agreed": True,
    }
    # Always lift the rate limit before posting so test runs don't collide
    requests.put(
        f"{API}/admin/intake-rate-limit",
        json={"max_requests_per_window": 50, "window_minutes": 1},
        headers=HDR,
        timeout=10,
    )
    r = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_dopl_link_uses_new_edopl_url():
    rows = requests.get(
        f"{API}/admin/therapists?pending=false", headers=HDR, timeout=15
    ).json()
    assert isinstance(rows, list)
    if not rows:
        pytest.skip("no therapists in directory")
    # At least one row should have a license_number → license_verify_url
    with_url = [t for t in rows if t.get("license_verify_url")]
    if not with_url:
        pytest.skip("no therapists with licenses")
    for t in with_url[:5]:
        assert "edopl.idaho.gov/onlineservices" in t["license_verify_url"]


def test_request_detail_includes_match_gap_when_under_30():
    """A request that notified <30 therapists should now expose a
    match_gap dict on /admin/requests/{id}."""
    rid = _make_request()
    # Don't verify the request — keeps notified_count at 0, guaranteeing
    # the match_gap branch fires.
    detail = requests.get(
        f"{API}/admin/requests/{rid}", headers=HDR, timeout=15
    ).json()
    assert "match_gap" in detail
    gap = detail["match_gap"]
    assert gap is not None
    assert gap["notified"] == 0
    assert gap["target"] == 30
    assert gap["active_directory"] >= 0
    assert isinstance(gap["axes"], list)
    # We expect at least the state, age, primary issue, and budget axes
    labels = " ".join(a["label"] for a in gap["axes"])
    assert "ID" in labels  # state
    assert "anxiety" in labels  # presenting issue


def test_pending_therapists_attach_value_tags():
    rows = requests.get(
        f"{API}/admin/therapists?pending=true", headers=HDR, timeout=15
    ).json()
    assert isinstance(rows, list)
    if not rows:
        pytest.skip("no pending therapists in directory")
    tagged = [t for t in rows if "value_tags" in t and "value_summary" in t]
    assert tagged, "expected pending rows to have value_tags + value_summary"
    for t in tagged[:3]:
        assert isinstance(t["value_tags"], list)
        for tag in t["value_tags"]:
            assert tag["kind"] in ("fills_gap", "duplicate", "neutral")
            assert "label" in tag
            assert "axis" in tag
            assert isinstance(tag["count"], int)
        s = t["value_summary"]
        assert "fills_gaps" in s and "duplicates" in s
        assert isinstance(s["is_duplicate_only"], bool)


def test_non_pending_therapists_have_no_value_tags():
    """value_tags is only computed for the pending-review queue (where
    the admin needs to decide approve/reject). All-providers rows skip
    the work."""
    rows = requests.get(
        f"{API}/admin/therapists?pending=false", headers=HDR, timeout=15
    ).json()
    if not rows:
        pytest.skip("no active therapists in directory")
    # We don't strictly forbid the field on active rows (depends on prior
    # data) but we do require that not every active row has it (otherwise
    # the cost is being paid every page render).
    with_tags = [t for t in rows if t.get("value_tags")]
    assert len(with_tags) == 0
