"""Iteration-3 tests: admin login rate limit + lifespan + regression smoke.

NOTE: Lockout state is per-IP in memory. We pass our own X-Forwarded-For per test
so each scenario uses an isolated bucket and doesn't interfere with other agents/UI.
"""
import os
import time
import uuid
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
LOGIN = f"{BASE}/api/admin/login"
ADMIN_PWD = "admin123!"


def _post(session, ip, password):
    """Login attempt with a synthetic client IP via X-Forwarded-For (left-most wins)."""
    return session.post(
        LOGIN,
        json={"password": password},
        headers={"X-Forwarded-For": ip, "Content-Type": "application/json"},
    )


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ── Happy path ────────────────────────────────────────────────────────────────

def test_login_correct_returns_ok(s):
    ip = f"10.0.0.{uuid.uuid4().int % 250 + 1}"
    r = _post(s, ip, ADMIN_PWD)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}


# ── Wrong-password message decrements N from 4 -> 0 ───────────────────────────

def test_wrong_password_decrement_message(s):
    ip = f"10.0.1.{uuid.uuid4().int % 250 + 1}"
    expected_left = [4, 3, 2, 1, 0]
    for i, left in enumerate(expected_left, start=1):
        r = _post(s, ip, "nope")
        # 5th wrong attempt may return 401 with "0 attempt(s) left" then bucket flips to locked.
        assert r.status_code == 401, f"attempt {i}: expected 401, got {r.status_code} body={r.text}"
        detail = r.json().get("detail", "")
        assert "Invalid password" in detail, f"attempt {i}: detail={detail!r}"
        assert f"{left} attempt(s) left" in detail, f"attempt {i}: detail={detail!r}"


# ── 6th attempt returns 429 even with correct password (lockout precedence) ──

def test_lockout_429_after_5_failures_even_with_correct_password(s):
    ip = f"10.0.2.{uuid.uuid4().int % 250 + 1}"
    for i in range(5):
        r = _post(s, ip, "wrong")
        assert r.status_code == 401, f"fail #{i+1}: {r.status_code} {r.text}"
    # 6th — correct password should still be 429 (lockout precedence)
    r = _post(s, ip, ADMIN_PWD)
    assert r.status_code == 429, f"expected 429 lockout, got {r.status_code} {r.text}"
    detail = r.json().get("detail", "")
    assert "Too many failed attempts" in detail, f"detail={detail!r}"


# ── Successful login resets counter (4 wrong → success → 1 wrong → not locked)

def test_success_resets_failure_counter(s):
    ip = f"10.0.3.{uuid.uuid4().int % 250 + 1}"
    # 4 wrong (counter at 4, not yet locked since threshold is 5)
    for i in range(4):
        r = _post(s, ip, "wrong")
        assert r.status_code == 401, f"fail #{i+1}: {r.status_code}"
    # success — should reset counter
    r = _post(s, ip, ADMIN_PWD)
    assert r.status_code == 200, f"correct pwd should succeed, got {r.status_code} {r.text}"
    # one more wrong — should be 401 with "4 attempt(s) left" (not 0, not 429)
    r = _post(s, ip, "wrong")
    assert r.status_code == 401, f"expected 401 after reset, got {r.status_code} {r.text}"
    detail = r.json().get("detail", "")
    assert "4 attempt(s) left" in detail, (
        f"counter should have reset to 0 then incremented to 1 (=> 4 left). detail={detail!r}"
    )


# ── Regression: other endpoints still respond ────────────────────────────────

def test_regression_root(s):
    r = s.get(f"{BASE}/api/")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_regression_admin_stats(s):
    r = s.get(f"{BASE}/api/admin/stats", headers={"X-Admin-Password": ADMIN_PWD})
    assert r.status_code == 200
    body = r.json()
    for k in ("total_requests", "therapists", "pending_therapists", "applications"):
        assert k in body


def test_regression_admin_requests(s):
    r = s.get(f"{BASE}/api/admin/requests", headers={"X-Admin-Password": ADMIN_PWD})
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_regression_admin_therapists(s):
    r = s.get(f"{BASE}/api/admin/therapists", headers={"X-Admin-Password": ADMIN_PWD})
    assert r.status_code == 200 and len(r.json()) >= 100


def test_regression_therapist_signup_then_approve(s):
    email = f"TEST_iter3_{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "name": "TEST Iter3 Therapist",
        "email": email,
        "phone": "208-555-0100",
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [{"name": "Anxiety", "weight": 30}],
        "modalities": ["CBT"],
        "ages_served": ["adult-18-64"],
        "insurance_accepted": ["Cash"],
        "cash_rate": 150,
        "years_experience": 5,
        "free_consult": True,
        "bio": "Test bio for iter-3 regression.",
    }
    r = s.post(f"{BASE}/api/therapists/signup", json=payload)
    assert r.status_code in (200, 201), r.text
    tid = r.json()["id"]
    # Approve
    r2 = s.post(
        f"{BASE}/api/admin/therapists/{tid}/approve",
        headers={"X-Admin-Password": ADMIN_PWD},
    )
    assert r2.status_code == 200 and r2.json()["status"] == "approved"
    # Cleanup
    requests.post(
        f"{BASE}/api/admin/therapists/{tid}/reject",
        headers={"X-Admin-Password": ADMIN_PWD},
    )


def test_regression_request_create_and_verify(s):
    from tests.conftest import v2_request_payload
    payload = v2_request_payload(email=f"TEST_iter3_{uuid.uuid4().hex[:6]}@example.com")
    r = s.post(f"{BASE}/api/requests", json=payload)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    # Look up token via mongo
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _tok():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        d = c[os.environ.get("DB_NAME", "test_database")]
        doc = await d.requests.find_one({"id": rid})
        return doc.get("verification_token")

    token = asyncio.run(_tok())
    assert token, "verification_token missing"
    r2 = s.get(f"{BASE}/api/requests/verify/{token}")
    assert r2.status_code == 200 and r2.json()["verified"] is True


# ── Lifespan check (post-restart): backend log mentions sweep loop ───────────

def test_lifespan_started_sweep_loop_log():
    """Reads supervisor log to confirm lifespan-style startup banner."""
    log_paths = [
        "/var/log/supervisor/backend.err.log",
        "/var/log/supervisor/backend.out.log",
    ]
    found_sweep = False
    found_deprecation = False
    for p in log_paths:
        if not os.path.exists(p):
            continue
        with open(p, "r", errors="ignore") as f:
            content = f.read()
            if "Started results sweep loop" in content:
                found_sweep = True
            if "DeprecationWarning" in content and "on_event" in content:
                found_deprecation = True
    assert found_sweep, "expected 'Started results sweep loop' in backend log"
    assert not found_deprecation, "found DeprecationWarning related to on_event"
