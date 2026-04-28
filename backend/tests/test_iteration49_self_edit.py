"""Iter-49 backend tests — therapist self-edit, license badge, opt-outs tab data."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── license_verify unit tests ────────────────────────────────────────────

def test_license_status_active_when_far_future():
    from license_verify import compute_license_status
    future = (datetime.now(timezone.utc) + timedelta(days=180)).date().isoformat()
    out = compute_license_status(license_expires_at=future, license_number="LCSW-12345")
    assert out["status"] == "active"
    assert out["severity"] == "ok"


def test_license_status_expiring_soon_within_45d():
    from license_verify import compute_license_status
    soon = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
    out = compute_license_status(license_expires_at=soon, license_number="LCSW-12345")
    assert out["status"] == "expiring_soon"
    assert out["severity"] == "warn"
    # 20-day remaining may round to 19d depending on the exact datetime,
    # so just assert the label format is correct
    assert "d" in out["label"] and "Expires in" in out["label"]


def test_license_status_expired_when_past():
    from license_verify import compute_license_status
    past = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    out = compute_license_status(license_expires_at=past, license_number="LCSW-12345")
    assert out["status"] == "expired"
    assert out["severity"] == "error"


def test_license_status_no_license_is_error():
    from license_verify import compute_license_status
    out = compute_license_status(license_expires_at=None, license_number=None)
    assert out["status"] == "no_license"
    assert out["severity"] == "error"


def test_license_status_no_expiry_is_warn():
    from license_verify import compute_license_status
    out = compute_license_status(license_expires_at=None, license_number="LCSW-12345")
    assert out["status"] == "no_expiry"
    assert out["severity"] == "warn"


def test_dopl_verification_url():
    from license_verify import dopl_verification_url
    assert dopl_verification_url("LCSW-12345").endswith("?q=LCSW-12345")
    assert dopl_verification_url(None) is None
    assert dopl_verification_url("") is None


# ── admin /therapists now carries license_status ─────────────────────────

def test_admin_therapists_list_includes_license_status():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(
        f"{BASE_URL}/api/admin/therapists",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200
    rows = r.json()
    if rows:
        row = rows[0]
        assert "license_status" in row
        assert "status" in row["license_status"]
        assert "severity" in row["license_status"]
        assert "license_verify_url" in row


# ── Portal therapist self-edit ───────────────────────────────────────────

def _create_session_for_therapist(email: str) -> str:
    """Bypass magic-link flow by directly creating a session token — used
    only in tests, mirrors what routes/portal.py verify-code does."""
    from deps import _create_session_token
    return _create_session_token(email=email, role="therapist")


def test_portal_therapist_profile_get_and_put():
    """Seeds a minimal therapist, grabs a session token, updates the bio +
    cash rate + sliding scale via PUT, verifies the change is persisted."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")

    from deps import db

    tid = f"test-therapist-{uuid.uuid4().hex[:6]}"
    email = f"selfedit_{uuid.uuid4().hex[:6]}@example.com"

    async def seed():
        await db.therapists.insert_one({
            "id": tid,
            "email": email,
            "name": "Test Selfedit",
            "is_active": True,
            "pending_approval": False,
            "bio": "old bio",
            "cash_rate": 120,
            "sliding_scale": False,
            "primary_specialties": ["anxiety"],
        })

    _run(seed())
    token = _create_session_for_therapist(email)
    headers = {"Authorization": f"Bearer {token}"}

    # GET
    r = requests.get(
        f"{BASE_URL}/api/portal/therapist/profile", headers=headers, timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["email"].lower() == email.lower()
    assert r.json()["bio"] == "old bio"

    # PUT non-reapproval field → no flag
    r2 = requests.put(
        f"{BASE_URL}/api/portal/therapist/profile",
        json={"bio": "new bio", "cash_rate": 175, "sliding_scale": True},
        headers=headers,
        timeout=10,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["ok"] is True
    assert body["requires_reapproval"] is False
    assert body["profile"]["bio"] == "new bio"
    assert body["profile"]["cash_rate"] == 175
    assert body["profile"]["sliding_scale"] is True

    # PUT re-approval field (specialty change) → flag
    r3 = requests.put(
        f"{BASE_URL}/api/portal/therapist/profile",
        json={"primary_specialties": ["anxiety", "trauma_ptsd"]},
        headers=headers,
        timeout=10,
    )
    assert r3.status_code == 200, r3.text
    assert r3.json()["requires_reapproval"] is True
    assert "primary_specialties" in r3.json()["reapproval_fields"]

    # Verify cash_rate clamping
    r4 = requests.put(
        f"{BASE_URL}/api/portal/therapist/profile",
        json={"cash_rate": 99999},
        headers=headers,
        timeout=10,
    )
    assert r4.status_code == 200
    assert r4.json()["profile"]["cash_rate"] == 1000


def test_portal_therapist_profile_rejects_unknown_fields():
    """The `is_active`, `pending_approval`, `stripe_customer_id` fields are
    not in the self-editable allowlist — attempts must be silently dropped."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")

    from deps import db

    tid = f"test-therapist-{uuid.uuid4().hex[:6]}"
    email = f"allowlist_{uuid.uuid4().hex[:6]}@example.com"

    async def seed():
        await db.therapists.insert_one({
            "id": tid, "email": email, "name": "AL",
            "is_active": True, "pending_approval": False,
            "stripe_customer_id": "cus_original",
        })

    _run(seed())
    token = _create_session_for_therapist(email)

    # Try to sneak in a privilege change — should 400 because bio wasn't sent
    r = requests.put(
        f"{BASE_URL}/api/portal/therapist/profile",
        json={"is_active": False, "stripe_customer_id": "cus_hacker"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    # All fields were filtered out → 400 "No editable fields provided"
    assert r.status_code == 400

    # Verify original values intact
    async def check():
        doc = await db.therapists.find_one({"id": tid}, {"_id": 0})
        assert doc["is_active"] is True
        assert doc["stripe_customer_id"] == "cus_original"
    _run(check())


def test_portal_therapist_profile_unauthenticated_rejects():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(f"{BASE_URL}/api/portal/therapist/profile", timeout=10)
    assert r.status_code in (401, 403)
