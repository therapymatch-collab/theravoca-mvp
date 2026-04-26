"""TheraVoca backend iteration 2 tests — therapist signup + admin approve/reject + sweep + matching filter."""
import os
import sys
import time
import asyncio
import uuid
import pytest
import requests

# Read public URL from frontend/.env (REACT_APP_BACKEND_URL)
def _read_backend_url() -> str:
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.strip().startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE = _read_backend_url()
ADMIN = {"X-Admin-Password": "admin123!"}

# Insert backend dir into path so we can import server helpers for sweep test
sys.path.insert(0, "/app/backend")


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _unique_email(prefix="TEST_signup"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"


# ─── Therapist signup ────────────────────────────────────────────────────────

def test_signup_valid_creates_pending(s):
    email = _unique_email("TEST_t_valid")
    payload = {
        "name": "TEST Dr Pending",
        "email": email,
        "phone": "208-555-0101",
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [{"name": "Anxiety", "weight": 30}, {"name": "Depression", "weight": 20}],
        "modalities": ["CBT"],
        "ages_served": ["Adult"],
        "insurance_accepted": ["Aetna"],
        "cash_rate": 175,
        "years_experience": 5,
        "free_consult": True,
        "bio": "I help adults with anxiety using CBT.",
    }
    r = s.post(f"{BASE}/api/therapists/signup", json=payload)
    assert r.status_code in (200, 201), r.text
    j = r.json()
    assert "id" in j and j["status"] == "pending_approval"
    # Verify persistence via admin
    pending = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "true"}).json()
    found = next((t for t in pending if t["id"] == j["id"]), None)
    assert found is not None, "newly signed-up therapist not in pending list"
    assert found["pending_approval"] is True
    assert found["is_active"] is True
    assert found.get("source") == "signup"
    assert found["email"] == email
    pytest.created_signup_id = j["id"]
    pytest.created_signup_email = email


def test_signup_duplicate_email_409(s):
    email = pytest.created_signup_email
    payload = {
        "name": "TEST Dup Person",
        "email": email,
        "specialties": [{"name": "Anxiety", "weight": 20}],
        "modalities": ["CBT"],
        "ages_served": ["Adult"],
    }
    r = s.post(f"{BASE}/api/therapists/signup", json=payload)
    assert r.status_code == 409


def test_signup_missing_fields_422(s):
    # missing name and email
    r = s.post(f"{BASE}/api/therapists/signup", json={})
    assert r.status_code == 422


def test_signup_invalid_email_422(s):
    r = s.post(f"{BASE}/api/therapists/signup", json={"name": "TEST short", "email": "notanemail"})
    assert r.status_code == 422


# ─── Admin therapists list filter ────────────────────────────────────────────

def test_admin_list_pending_only(s):
    pending = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "true"}).json()
    assert isinstance(pending, list)
    for t in pending:
        assert t.get("pending_approval") is True


def test_admin_list_approved_only(s):
    approved = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "false"}).json()
    assert isinstance(approved, list)
    assert len(approved) >= 100  # seed therapists
    for t in approved:
        assert t.get("pending_approval") is not True


# ─── Admin stats includes pending_therapists ─────────────────────────────────

def test_admin_stats_includes_pending_therapists(s):
    r = s.get(f"{BASE}/api/admin/stats", headers=ADMIN)
    assert r.status_code == 200
    j = r.json()
    assert "pending_therapists" in j
    assert isinstance(j["pending_therapists"], int)
    assert j["pending_therapists"] >= 1  # we just created one


# ─── Approve / reject ────────────────────────────────────────────────────────

def test_admin_approve_therapist(s):
    tid = pytest.created_signup_id
    r = s.post(f"{BASE}/api/admin/therapists/{tid}/approve", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    # Verify it moved out of pending
    pending = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "true"}).json()
    assert all(t["id"] != tid for t in pending)
    approved = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "false"}).json()
    rec = next((t for t in approved if t["id"] == tid), None)
    assert rec is not None
    assert rec["pending_approval"] is False
    assert rec["is_active"] is True
    assert "approved_at" in rec


def test_admin_reject_therapist(s):
    # Create another signup specifically for reject
    email = _unique_email("TEST_t_reject")
    payload = {
        "name": "TEST Reject Me",
        "email": email,
        "specialties": [{"name": "Anxiety", "weight": 20}],
        "modalities": ["CBT"],
        "ages_served": ["Adult"],
    }
    j = s.post(f"{BASE}/api/therapists/signup", json=payload).json()
    tid = j["id"]
    r = s.post(f"{BASE}/api/admin/therapists/{tid}/reject", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    # verify is_active=False, pending_approval=False
    approved = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN, params={"pending": "false"}).json()
    rec = next((t for t in approved if t["id"] == tid), None)
    assert rec is not None
    assert rec["is_active"] is False
    assert rec["pending_approval"] is False


def test_admin_approve_unknown_404(s):
    r = s.post(f"{BASE}/api/admin/therapists/does-not-exist/approve", headers=ADMIN)
    assert r.status_code == 404


def test_admin_approve_unauth(s):
    r = s.post(f"{BASE}/api/admin/therapists/anything/approve")
    assert r.status_code == 401


# ─── CRITICAL: Pending therapists are excluded from matching ────────────────

def _get_token_from_db(request_id: str) -> str:
    """Read verification_token directly from MongoDB (it's not exposed via API)."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def go():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        d = c[os.environ.get("DB_NAME", "test_database")]
        doc = await d.requests.find_one({"id": request_id})
        return doc["verification_token"] if doc else None

    return asyncio.new_event_loop().run_until_complete(go())


def test_pending_therapist_excluded_from_matching(s):
    # 1) Create a pending therapist with broad specialties to maximise match likelihood
    email = _unique_email("TEST_pending_match")
    signup = {
        "name": "TEST Pending Matcher",
        "email": email,
        "licensed_states": ["ID"],
        "office_locations": ["Boise"],
        "telehealth": True,
        "specialties": [
            {"name": "Anxiety", "weight": 30},
            {"name": "Depression", "weight": 30},
            {"name": "Trauma/PTSD", "weight": 20},
        ],
        "modalities": ["CBT", "DBT", "EMDR"],
        "ages_served": ["Child", "Teen", "Adult", "Older Adult"],
        "insurance_accepted": ["Aetna", "BCBS", "Cigna", "Self-pay"],
        "cash_rate": 100,
        "years_experience": 10,
        "free_consult": True,
    }
    sj = s.post(f"{BASE}/api/therapists/signup", json=signup).json()
    pending_tid = sj["id"]

    # 2) Create + verify a request that this therapist would naturally match
    payload = {
        "email": "TEST_match_patient@example.com",
        "client_age": 30,
        "location_state": "ID",
        "location_city": "Boise",
        "session_format": "virtual",
        "payment_type": "cash",
        "budget": 200,
        "presenting_issues": "Anxiety, depression, trauma — looking for CBT support",
        "preferred_modality": "CBT",
    }
    r = s.post(f"{BASE}/api/requests", json=payload)
    assert r.status_code == 200
    rid = r.json()["id"]
    # set lower threshold so more therapists are considered (irrelevant for filter, but ensures rich match)
    s.put(f"{BASE}/api/admin/requests/{rid}/threshold", headers=ADMIN, json={"threshold": 30})

    # Get token and verify
    token = _get_token_from_db(rid)
    assert token, "could not retrieve verification token"
    assert s.get(f"{BASE}/api/requests/verify/{token}").status_code == 200

    # Wait briefly for background matching task
    time.sleep(4)

    detail = s.get(f"{BASE}/api/admin/requests/{rid}", headers=ADMIN).json()
    notified_ids = [n["id"] for n in detail.get("notified", [])]
    assert pending_tid not in notified_ids, (
        f"CRITICAL: pending therapist {pending_tid} was notified — pending_approval filter broken"
    )
    # Sanity: at least some seed therapists were notified
    assert len(notified_ids) >= 1

    # 3) Approve the pending therapist and resend notifications — they should now be eligible
    s.post(f"{BASE}/api/admin/therapists/{pending_tid}/approve", headers=ADMIN)
    rs = s.post(f"{BASE}/api/admin/requests/{rid}/resend-notifications", headers=ADMIN)
    assert rs.status_code == 200
    detail2 = s.get(f"{BASE}/api/admin/requests/{rid}", headers=ADMIN).json()
    notified_ids2 = [n["id"] for n in detail2.get("notified", [])]
    # After approval, this therapist should be considered (broad specialties guarantee match at threshold=30)
    assert pending_tid in notified_ids2, (
        "After approval, therapist should appear in notified list on resend"
    )


# ─── Sweep loop function safety ──────────────────────────────────────────────

def test_sweep_function_no_crash():
    """Directly invoke _sweep_overdue_results to ensure the query/code path doesn't error."""
    from server import _sweep_overdue_results

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_sweep_overdue_results())
    finally:
        loop.close()


def test_sweep_loop_started_in_logs():
    import subprocess
    out = subprocess.run(
        ["bash", "-lc", "grep -c 'Started results sweep loop' /var/log/supervisor/backend.err.log /var/log/supervisor/backend.out.log 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'"],
        capture_output=True, text=True,
    )
    count = int((out.stdout or "0").strip() or "0")
    assert count >= 1, "Expected 'Started results sweep loop' in backend logs"


# ─── Regression: existing flows still 200 ────────────────────────────────────

def test_regression_admin_endpoints(s):
    assert s.get(f"{BASE}/api/admin/stats", headers=ADMIN).status_code == 200
    assert s.get(f"{BASE}/api/admin/requests", headers=ADMIN).status_code == 200
    assert s.get(f"{BASE}/api/admin/therapists", headers=ADMIN).status_code == 200


def test_regression_root(s):
    r = s.get(f"{BASE}/api/")
    assert r.status_code == 200 and r.json()["status"] == "ok"
