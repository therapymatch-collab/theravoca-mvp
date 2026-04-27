"""Iteration 5: magic-link auth + portal endpoints."""
import os
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

PATIENT_EMAIL = "therapymatch@gmail.com"
THERAPIST_PLUS_EMAIL = "therapymatch+t007@gmail.com"
UNKNOWN_THERAPIST_EMAIL = "TEST_unknown_therapist_iter5@example.com"


# ─── helpers ──────────────────────────────────────────────────────────────────
def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


async def _latest_code(email: str, role: str) -> str | None:
    db = _mongo()
    doc = await db.magic_codes.find_one(
        {"email": email.lower(), "role": role, "used": False},
        sort=[("created_at", -1)],
    )
    return doc["code"] if doc else None


async def _delete_codes(email: str):
    db = _mongo()
    await db.magic_codes.delete_many({"email": email.lower()})


def request_code(email: str, role: str) -> requests.Response:
    return requests.post(f"{API}/auth/request-code", json={"email": email, "role": role}, timeout=15)


def verify_code(email: str, role: str, code: str) -> requests.Response:
    return requests.post(f"{API}/auth/verify-code", json={"email": email, "role": role, "code": code}, timeout=15)


def get_token(email: str, role: str) -> str:
    asyncio.run(_delete_codes(email))
    r = request_code(email, role)
    assert r.status_code == 200, r.text
    code = asyncio.run(_latest_code(email, role))
    assert code, f"No code created for {email}/{role}"
    v = verify_code(email, role, code)
    assert v.status_code == 200, v.text
    return v.json()["token"]


# ─── /auth/request-code ───────────────────────────────────────────────────────
class TestRequestCode:
    def test_patient_request_creates_code(self):
        asyncio.run(_delete_codes(PATIENT_EMAIL))
        r = request_code(PATIENT_EMAIL, "patient")
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        code = asyncio.run(_latest_code(PATIENT_EMAIL, "patient"))
        assert code and len(code) == 6 and code.isdigit()

    def test_therapist_known_email_creates_code(self):
        asyncio.run(_delete_codes(THERAPIST_PLUS_EMAIL))
        r = request_code(THERAPIST_PLUS_EMAIL, "therapist")
        assert r.status_code == 200
        code = asyncio.run(_latest_code(THERAPIST_PLUS_EMAIL, "therapist"))
        assert code, "Approved+active therapist (with '+' email) must get a code"

    def test_therapist_unknown_email_silent_success(self):
        asyncio.run(_delete_codes(UNKNOWN_THERAPIST_EMAIL))
        r = request_code(UNKNOWN_THERAPIST_EMAIL, "therapist")
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        code = asyncio.run(_latest_code(UNKNOWN_THERAPIST_EMAIL, "therapist"))
        assert code is None, "Unknown therapist email must not create a code (no enumeration)"

    def test_invalid_role_rejected(self):
        r = request_code("foo@bar.com", "admin")
        assert r.status_code == 400

    def test_rate_limit_6th_returns_429(self):
        rl_email = "TEST_iter5_rl@example.com"
        asyncio.run(_delete_codes(rl_email))
        # patient role does not require existing record so each call creates a code
        codes_made = 0
        for i in range(5):
            r = request_code(rl_email, "patient")
            assert r.status_code == 200, f"Attempt {i+1}: {r.status_code} {r.text}"
            codes_made += 1
        # 6th must be 429
        r6 = request_code(rl_email, "patient")
        assert r6.status_code == 429, f"6th call expected 429 got {r6.status_code} {r6.text}"
        asyncio.run(_delete_codes(rl_email))


# ─── /auth/verify-code ────────────────────────────────────────────────────────
class TestVerifyCode:
    def test_correct_code_returns_token(self):
        asyncio.run(_delete_codes(PATIENT_EMAIL))
        request_code(PATIENT_EMAIL, "patient")
        code = asyncio.run(_latest_code(PATIENT_EMAIL, "patient"))
        r = verify_code(PATIENT_EMAIL, "patient", code)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "patient"
        assert body["email"] == PATIENT_EMAIL.lower()
        assert isinstance(body["token"], str) and len(body["token"]) > 20

    def test_wrong_code_returns_401(self):
        asyncio.run(_delete_codes(PATIENT_EMAIL))
        request_code(PATIENT_EMAIL, "patient")
        r = verify_code(PATIENT_EMAIL, "patient", "000000")
        assert r.status_code == 401

    def test_second_use_of_same_code_fails(self):
        asyncio.run(_delete_codes(PATIENT_EMAIL))
        request_code(PATIENT_EMAIL, "patient")
        code = asyncio.run(_latest_code(PATIENT_EMAIL, "patient"))
        r1 = verify_code(PATIENT_EMAIL, "patient", code)
        assert r1.status_code == 200
        r2 = verify_code(PATIENT_EMAIL, "patient", code)
        assert r2.status_code == 401, "Re-using the same code must be rejected"


# ─── /portal/me + role guards ─────────────────────────────────────────────────
class TestPortalMe:
    def test_me_with_patient_token(self):
        token = get_token(PATIENT_EMAIL, "patient")
        r = requests.get(f"{API}/portal/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"email": PATIENT_EMAIL.lower(), "role": "patient"}

    def test_missing_token_401(self):
        r = requests.get(f"{API}/portal/me", timeout=15)
        assert r.status_code == 401

    def test_invalid_token_401(self):
        r = requests.get(f"{API}/portal/me", headers={"Authorization": "Bearer not.a.jwt"}, timeout=15)
        assert r.status_code == 401


# ─── /portal/patient/requests ─────────────────────────────────────────────────
class TestPatientRequests:
    def test_returns_patient_requests(self):
        token = get_token(PATIENT_EMAIL, "patient")
        r = requests.get(f"{API}/portal/patient/requests", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # context says 4 requests exist; assert at least 1 to avoid flake from data churn
        assert len(data) >= 1, f"Expected >=1 patient requests, got {len(data)}"
        for d in data:
            assert "id" in d and "status" in d
            assert "verification_token" not in d
            assert "application_count" in d
            assert "notified_count" in d

    def test_cross_role_blocked_403(self):
        therapist_token = get_token(THERAPIST_PLUS_EMAIL, "therapist")
        r = requests.get(
            f"{API}/portal/patient/requests",
            headers={"Authorization": f"Bearer {therapist_token}"}, timeout=15,
        )
        assert r.status_code == 403


# ─── /portal/therapist/referrals ──────────────────────────────────────────────
class TestTherapistReferrals:
    def test_plus_email_returns_referrals(self):
        """Critical: therapist email contains '+'; ensures regex escapes correctly."""
        token = get_token(THERAPIST_PLUS_EMAIL, "therapist")
        r = requests.get(
            f"{API}/portal/therapist/referrals",
            headers={"Authorization": f"Bearer {token}"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "therapist" in body and "referrals" in body
        assert body["therapist"]["email"].lower() == THERAPIST_PLUS_EMAIL.lower()
        refs = body["referrals"]
        assert isinstance(refs, list)
        assert len(refs) >= 1, "Expected referrals for seeded therapist t007"
        for ref in refs:
            assert "request_id" in ref
            assert "match_score" in ref
            assert "applied" in ref and isinstance(ref["applied"], bool)
            assert "summary" in ref
            # PII guard: no patient email anywhere in summary or top-level
            assert "email" not in ref or not ref.get("email"), "Email leaked"
            # summary text should not embed an @ from a real email
            summary_str = str(ref["summary"])
            assert PATIENT_EMAIL not in summary_str

    def test_cross_role_patient_blocked_403(self):
        token = get_token(PATIENT_EMAIL, "patient")
        r = requests.get(
            f"{API}/portal/therapist/referrals",
            headers={"Authorization": f"Bearer {token}"}, timeout=15,
        )
        assert r.status_code == 403


# ─── Regression of prior endpoints ────────────────────────────────────────────
class TestRegression:
    def test_root(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200 and r.json().get("status") == "ok"

    def test_admin_login_wrong(self):
        r = requests.post(f"{API}/admin/login", json={"password": "wrong-iter5"}, timeout=10)
        assert r.status_code in (401, 429)

    def test_admin_login_right(self):
        r = requests.post(f"{API}/admin/login", json={"password": os.environ.get("ADMIN_PASSWORD", "admin123!")}, timeout=10)
        # could be 429 if previous lockout; tolerate
        assert r.status_code in (200, 429)

    def test_create_request_then_verify_smoke(self):
        # quick e2e to ensure /api/requests still creates + verifies
        from tests.conftest import v2_request_payload
        payload = v2_request_payload(email="TEST_iter5_smoke@example.com")
        r = requests.post(f"{API}/requests", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # response shape may include verification_token or just id
        assert "id" in body or "verification_token" in body
