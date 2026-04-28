"""Iter-50 backend tests — follow-up/feedback APIs, age-groups cap,
approval+rejection emails, returning-patient prefill, stale-profile nag flag."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── Feedback widget ──────────────────────────────────────────────────────

def test_feedback_widget_persists_and_returns_id():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/feedback/widget",
        json={"message": "Unit test widget feedback", "name": "Unit"},
        timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json().get("id")


def test_feedback_widget_rejects_empty_message():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/feedback/widget", json={"message": "hi"}, timeout=10,
    )
    assert r.status_code == 422  # min_length=5 pydantic


# ── Patient follow-up form ───────────────────────────────────────────────

def test_patient_feedback_submission():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")

    from deps import db

    rid = f"test-feedback-req-{uuid.uuid4().hex[:6]}"
    async def seed():
        await db.requests.insert_one({
            "id": rid, "email": "feedback@example.com",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    _run(seed())

    r = requests.post(
        f"{BASE_URL}/api/feedback/patient/{rid}",
        json={
            "milestone": "48h",
            "reached_out": "booked",
            "match_quality": 5,
            "notes": "Great experience.",
        },
        timeout=10,
    )
    assert r.status_code == 200, r.text


def test_patient_feedback_404_for_unknown_request():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/feedback/patient/does-not-exist-" + uuid.uuid4().hex,
        json={"milestone": "48h", "reached_out": "none", "match_quality": 3},
        timeout=10,
    )
    assert r.status_code == 404


# ── Admin feedback list ──────────────────────────────────────────────────

def test_admin_feedback_list_requires_auth():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(f"{BASE_URL}/api/admin/feedback", timeout=10)
    assert r.status_code in (401, 403)


def test_admin_feedback_list_returns_records():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    # Submit one first so the list has at least 1 record
    requests.post(
        f"{BASE_URL}/api/feedback/widget",
        json={"message": "Seed for admin list test"},
        timeout=10,
    )
    r = requests.get(
        f"{BASE_URL}/api/admin/feedback",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200
    body = r.json()
    assert "feedback" in body
    assert body["total"] >= 1


# ── Returning-patient prefill ────────────────────────────────────────────

def test_returning_patient_prefill():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    from deps import db

    email = f"returning_{uuid.uuid4().hex[:6]}@example.com"

    # No prior request → returning=false
    r = requests.get(
        f"{BASE_URL}/api/requests/prefill?email={email}", timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["returning"] is False

    # Seed a prior request
    async def seed():
        await db.requests.insert_one({
            "id": f"seed-{uuid.uuid4().hex[:6]}",
            "email": email,
            "referral_source": "ChatGPT / AI assistant",
            "zip_code": "83702",
            "preferred_language": "English",
            "age_group": "adults_30_64",
            "gender_preference": "no_preference",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    _run(seed())

    r2 = requests.get(
        f"{BASE_URL}/api/requests/prefill?email={email}", timeout=10,
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["returning"] is True
    assert body["prefill"]["referral_source"] == "ChatGPT / AI assistant"
    assert body["prefill"]["zip_code"] == "83702"
    assert body["prior_request_count"] >= 1


# ── Age-groups cap (model + admin PUT) ───────────────────────────────────

def test_age_groups_model_caps_at_3():
    from models import TherapistSignup
    with pytest.raises(Exception):
        TherapistSignup(
            name="x", email="x@x.com", phone="2085551234",
            license_number="X", license_state="ID", license_expires_at="2030-01-01",
            bio="b" * 50,
            primary_specialties=["anxiety"], secondary_specialties=[],
            modalities=["cbt"], office_locations=[],
            insurance_accepted=[], cash_rate=150,
            years_experience=5, availability_windows=[],
            client_types=["adults"],
            age_groups=["a", "b", "c", "d"],  # 4 items, exceeds max_length
        )


def test_age_groups_admin_put_clamps_to_3():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    from deps import db
    tid = f"age-cap-{uuid.uuid4().hex[:6]}"

    async def seed():
        await db.therapists.insert_one({
            "id": tid, "email": f"{tid}@example.com",
            "name": "AgeCap", "is_active": True, "pending_approval": False,
            "age_groups": ["a"],
        })
    _run(seed())

    r = requests.put(
        f"{BASE_URL}/api/admin/therapists/{tid}",
        json={"age_groups": ["x", "y", "z", "w", "q"]},
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    t = r.json()["therapist"]
    assert len(t["age_groups"]) == 3


# ── Approval / rejection emails ──────────────────────────────────────────

def test_approve_therapist_sends_email_and_activates():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    from deps import db
    tid = f"approve-{uuid.uuid4().hex[:6]}"

    async def seed():
        await db.therapists.insert_one({
            "id": tid, "email": f"{tid}@example.com",
            "name": "Approve Me", "is_active": False, "pending_approval": True,
        })
    _run(seed())

    r = requests.post(
        f"{BASE_URL}/api/admin/therapists/{tid}/approve",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200

    async def check():
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        assert t["is_active"] is True
        assert t["pending_approval"] is False
    _run(check())


def test_reject_therapist_deactivates_and_stamps():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    from deps import db
    tid = f"reject-{uuid.uuid4().hex[:6]}"

    async def seed():
        await db.therapists.insert_one({
            "id": tid, "email": f"{tid}@example.com",
            "name": "Reject Me", "is_active": True, "pending_approval": True,
        })
    _run(seed())

    r = requests.post(
        f"{BASE_URL}/api/admin/therapists/{tid}/reject",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200

    async def check():
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        assert t["is_active"] is False
        assert t["pending_approval"] is False
        assert t.get("rejected_at")
    _run(check())


# ── Clear re-approval flag ───────────────────────────────────────────────

def test_clear_reapproval_unsets_flag():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    from deps import db
    tid = f"reappr-{uuid.uuid4().hex[:6]}"

    async def seed():
        await db.therapists.insert_one({
            "id": tid, "email": f"{tid}@example.com",
            "name": "X", "is_active": True,
            "pending_reapproval": True,
            "pending_reapproval_fields": ["primary_specialties"],
        })
    _run(seed())

    r = requests.post(
        f"{BASE_URL}/api/admin/therapists/{tid}/clear-reapproval",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200

    async def check():
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        assert t.get("pending_reapproval") is False
        assert "pending_reapproval_fields" not in t
        assert t.get("reapproved_at")
    _run(check())
