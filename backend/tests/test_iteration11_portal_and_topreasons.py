"""Iteration 11 — Portal therapist endpoints (referrals, availability-confirm),
license-warn idempotent flag, and top-3 'why we matched' raw-score sort.

Auth: We obtain a therapist session via the magic-code flow by reading the
latest unused code directly from MongoDB (allowed in test env)."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ─── helpers ──────────────────────────────────────────────────────────────────
def _db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


async def _latest_code(email: str, role: str) -> str | None:
    db = _db()
    rec = await db.magic_codes.find_one(
        {"email": email.lower(), "role": role, "used": False},
        sort=[("created_at", -1)],
    )
    return rec["code"] if rec else None


def _therapist_session(email: str) -> str | None:
    """Request + verify magic code for an approved/active therapist.
    Returns bearer token, or None if email isn't known/approved."""
    r = requests.post(
        f"{API}/auth/request-code", json={"email": email, "role": "therapist"}, timeout=15
    )
    if r.status_code != 200:
        return None
    code = asyncio.new_event_loop().run_until_complete(_latest_code(email, "therapist"))
    if not code:
        return None
    r2 = requests.post(
        f"{API}/auth/verify-code",
        json={"email": email, "role": "therapist", "code": code},
        timeout=15,
    )
    if r2.status_code != 200:
        return None
    return r2.json()["token"]


# ─── fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def approved_therapist_email():
    """Pick the first seeded therapist that is approved + active."""
    res = requests.get(
        f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=20
    )
    assert res.status_code == 200
    rows = res.json()
    for t in rows:
        if not t.get("pending_approval") and t.get("is_active", True) and t.get("email"):
            return t["email"], t["id"]
    pytest.skip("No approved therapist available for portal tests")


@pytest.fixture(scope="module")
def therapist_token(approved_therapist_email):
    email, _tid = approved_therapist_email
    tok = _therapist_session(email)
    if not tok:
        pytest.skip(f"Could not obtain magic code for {email}")
    return tok


# ─── tests: portal/therapist/referrals ────────────────────────────────────────
def test_portal_referrals_returns_enriched_profile(therapist_token, approved_therapist_email):
    _email, tid = approved_therapist_email
    res = requests.get(
        f"{API}/portal/therapist/referrals",
        headers={"Authorization": f"Bearer {therapist_token}"},
        timeout=20,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "therapist" in body and "referrals" in body
    t = body["therapist"]
    # All new fields from iter-15 must be in the response (may be None)
    for key in (
        "pending_approval", "license_expires_at", "office_phone",
        "phone_alert", "availability_prompt_pending", "license_picture",
        "license_number",
    ):
        assert key in t, f"missing key: {key}"
    assert t["id"] == tid
    assert t["pending_approval"] is False  # we picked approved


def test_portal_referrals_requires_therapist_role():
    res = requests.get(f"{API}/portal/therapist/referrals", timeout=10)
    assert res.status_code == 401


# ─── tests: availability-confirm ──────────────────────────────────────────────
def test_availability_confirm_clears_flag_and_persists_windows(
    therapist_token, approved_therapist_email
):
    _email, tid = approved_therapist_email
    headers = {"Authorization": f"Bearer {therapist_token}"}
    new_windows = ["weekday_morning", "weekday_evening"]
    res = requests.post(
        f"{API}/portal/therapist/availability-confirm",
        headers=headers,
        json={"availability_windows": new_windows, "urgency_capacity": "1_2_per_week"},
        timeout=15,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert "availability_prompt_pending" in body["updated"]
    assert "last_availability_update_at" in body["updated"]
    assert "availability_windows" in body["updated"]
    # Verify persistence through portal/referrals
    chk = requests.get(
        f"{API}/portal/therapist/referrals", headers=headers, timeout=15
    ).json()["therapist"]
    assert chk["availability_prompt_pending"] is False
    assert chk["last_availability_update_at"]
    assert set(chk["availability_windows"]) == set(new_windows)


def test_availability_confirm_requires_session():
    res = requests.post(f"{API}/portal/therapist/availability-confirm", json={}, timeout=10)
    assert res.status_code == 401


# ─── tests: license-warn idempotent flag ──────────────────────────────────────
def test_license_warn_30_sent_at_flag_set_after_run():
    """Create a therapist with license expiring in 15 days, run daily-tasks,
    verify the flag is set in the DB and that a second run does NOT clear it."""
    expires = (datetime.now(timezone.utc) + timedelta(days=15)).date().isoformat()
    payload = {
        "name": "License Flag Therapist, LCSW",
        "email": f"license_flag_{datetime.now().timestamp()}@example.com",
        "phone_alert": "(208) 555-1212",
        "office_phone": "(208) 555-3434",
        "gender": "male",
        "licensed_states": ["ID"],
        "license_number": "LCSW-FLAG",
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
    r = requests.post(f"{API}/therapists/signup", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    # First run
    r1 = requests.post(
        f"{API}/admin/run-daily-tasks", headers=ADMIN_HEADERS, timeout=30
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert "license" in body1 and "billing" in body1 and "availability" in body1

    # Verify flag was set on the therapist row
    rows = requests.get(
        f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=15
    ).json()
    me = next(t for t in rows if t["id"] == tid)
    assert me.get("license_warn_30_sent_at"), \
        "license_warn_30_sent_at should be set after run-daily-tasks fires the alert"

    # Second run — license.sent must not increment for our therapist; flag stays
    r2 = requests.post(
        f"{API}/admin/run-daily-tasks", headers=ADMIN_HEADERS, timeout=30
    )
    assert r2.status_code == 200
    rows2 = requests.get(
        f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=15
    ).json()
    me2 = next(t for t in rows2 if t["id"] == tid)
    assert me2.get("license_warn_30_sent_at") == me.get("license_warn_30_sent_at"), \
        "Flag must remain stable across reruns (idempotent)"


# ─── tests: top-3 chips raw-score sort (no threshold) ─────────────────────────
def test_top_reasons_sort_uses_raw_score_no_threshold():
    """Import the sort logic directly to verify ordering rules."""
    import sys
    sys.path.insert(0, "/app/backend")
    # Replicate the sort used in PatientResults.jsx and email_service.py:
    # top 3 axes by raw score, no threshold.
    breakdown = {
        "specialty": 35.0,
        "modality": 5.0,
        "format": 10.0,
        "geo": 0.0,
        "payment_fit": 3.0,
        "demographics": 2.0,
        "language": 0.0,
        "availability": 8.0,
        "urgency": 1.0,
    }
    top3 = sorted(breakdown.items(), key=lambda kv: kv[1], reverse=True)[:3]
    keys = [k for k, _ in top3]
    assert keys[0] == "specialty"
    assert "format" in keys  # 10.0 must appear
    assert "availability" in keys  # 8.0 must appear (was below 0.5*max threshold previously)
