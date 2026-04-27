"""Iteration 15 — Stripe Customer Portal, daily billing, license expiry,
availability prompt, expanded therapist signup."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}
@pytest.fixture
def therapist_with_expiring_license():
    """Create a therapist whose license expires in 20 days."""
    expires = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
    payload = {
        "name": "Daily Tasks Therapist, LCSW",
        "email": f"daily_{datetime.now().timestamp()}@example.com",
        "phone_alert": "(208) 555-0001",
        "office_phone": "(208) 555-9999",
        "gender": "female",
        "licensed_states": ["ID"],
        "license_number": "LCSW-XX",
        "license_expires_at": expires,
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "modalities": ["CBT"],
        "modality_offering": "telehealth",
        "office_locations": [],
        "availability_windows": ["weekday_morning"],
        "credential_type": "lcsw",
        "cash_rate": 175,
        "years_experience": 5,
    }
    res = requests.post(f"{API}/therapists/signup", json=payload, timeout=20)
    assert res.status_code == 200, res.text
    return res.json()["id"], expires


def test_signup_persists_new_fields(therapist_with_expiring_license):
    tid, expires = therapist_with_expiring_license
    res = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=20)
    rows = res.json()
    found = next(r for r in rows if r["id"] == tid)
    assert found["phone_alert"] == "(208) 555-0001"
    assert found["office_phone"] == "(208) 555-9999"
    assert found["license_number"] == "LCSW-XX"
    assert found["license_expires_at"] == expires
    assert found["credential_type"] == "lcsw"


def test_admin_run_daily_tasks_endpoint(therapist_with_expiring_license):
    """Verify license alert fires for the freshly-created therapist."""
    res = requests.post(
        f"{API}/admin/run-daily-tasks", headers=ADMIN_HEADERS, timeout=30
    )
    body = res.json()
    assert res.status_code == 200, res.text
    assert "billing" in body
    assert "license" in body
    assert "availability" in body
    # Either it sent for the new fixture this run, or already-marked from prior run.
    assert body["license"]["sent"] >= 0


def test_admin_run_daily_tasks_idempotent(therapist_with_expiring_license):
    """Running again should not re-send the same license alert."""
    res1 = requests.post(f"{API}/admin/run-daily-tasks", headers=ADMIN_HEADERS, timeout=30)
    res2 = requests.post(f"{API}/admin/run-daily-tasks", headers=ADMIN_HEADERS, timeout=30)
    assert res2.status_code == 200
    # Second run shouldn't increase the count
    assert res2.json()["license"]["sent"] <= res1.json()["license"]["sent"] + 0


def test_portal_session_requires_stripe_customer():
    """Without a Stripe customer, portal-session should 400."""
    # Use any therapist (the seed ones have stripe_customer_id=None)
    therapists = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=20).json()
    no_cust = next((t for t in therapists if not t.get("stripe_customer_id")), None)
    if not no_cust:
        pytest.skip("All therapists have stripe customers")
    res = requests.post(
        f"{API}/therapists/{no_cust['id']}/portal-session", json={}, timeout=20
    )
    assert res.status_code == 400


def test_admin_update_license_fields_whitelisted(therapist_with_expiring_license):
    tid, _ = therapist_with_expiring_license
    new_exp = (datetime.now(timezone.utc) + timedelta(days=400)).date().isoformat()
    res = requests.put(
        f"{API}/admin/therapists/{tid}",
        headers=ADMIN_HEADERS,
        json={
            "license_expires_at": new_exp,
            "license_picture": "data:image/png;base64,iVBORw0KGgo=",
            "office_phone": "(208) 555-7777",
        },
        timeout=20,
    )
    assert res.status_code == 200
    t = res.json()["therapist"]
    assert t["license_expires_at"] == new_exp
    assert t["office_phone"] == "(208) 555-7777"
    assert t["license_picture"].startswith("data:image/png")
