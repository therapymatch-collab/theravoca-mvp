"""Iteration 51 — password auth + admin patients-by-email endpoint.

Covers:
  • POST /api/auth/login-password
  • POST /api/auth/set-password
  • GET  /api/auth/password-status
  • GET  /api/admin/patients
  • Verify endpoint now returns email
  • prefill response carries `has_password_account` flag
"""
import os
import time
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")


def _mint_session_token(email: str, role: str) -> str:
    """Helper: create a patient/therapist session token via the
    `_create_session_token` helper directly. Skips the magic-code
    round-trip so each test stays hermetic.
    """
    import sys
    sys.path.insert(0, "/app/backend")
    from deps import _create_session_token  # type: ignore  # noqa: E402
    return _create_session_token(email, role)


# ─── /auth/password-status ───────────────────────────────────────────────────
class TestPasswordStatus:
    def test_unknown_email_is_falsy(self):
        r = requests.get(
            f"{API}/auth/password-status",
            params={"email": "nobody@example.com", "role": "patient"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"has_password": False}

    def test_invalid_role_400(self):
        r = requests.get(
            f"{API}/auth/password-status",
            params={"email": "x@example.com", "role": "admin"},
            timeout=10,
        )
        assert r.status_code == 400


# ─── /auth/set-password + /auth/login-password (therapist) ───────────────────
class TestPasswordRoundTripTherapist:
    """Run end-to-end: set password (using a magic-code session) → confirm
    login-password works → wrong password is rejected with 401."""

    EMAIL = "portaltest@example.com"  # seeded in `/app/memory/test_credentials.md`
    PW = f"pwroundtrip_{int(time.time())}"

    def test_set_password_then_login(self):
        token = _mint_session_token(self.EMAIL, "therapist")
        # Step 1 — set the password using the magic-link session
        r = requests.post(
            f"{API}/auth/set-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        # Step 2 — password-status should now report True
        r = requests.get(
            f"{API}/auth/password-status",
            params={"email": self.EMAIL, "role": "therapist"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["has_password"] is True

        # Step 3 — login with that password
        r = requests.post(
            f"{API}/auth/login-password",
            json={"email": self.EMAIL, "password": self.PW, "role": "therapist"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "therapist"
        assert body["email"] == self.EMAIL
        assert body["has_password"] is True
        assert isinstance(body["token"], str) and len(body["token"]) > 30

        # Step 4 — wrong password is rejected
        r = requests.post(
            f"{API}/auth/login-password",
            json={"email": self.EMAIL, "password": "wrong", "role": "therapist"},
            timeout=10,
        )
        assert r.status_code == 401

    def test_short_password_400(self):
        token = _mint_session_token(self.EMAIL, "therapist")
        r = requests.post(
            f"{API}/auth/set-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": "short"},
            timeout=10,
        )
        assert r.status_code == 400


# ─── /auth/set-password + /auth/login-password (patient) ─────────────────────
class TestPasswordRoundTripPatient:
    """Patients have no global record — `_set_password_on_doc` should
    lazy-create a `patient_accounts` row on first set."""

    EMAIL = f"pwpatient_{int(time.time())}@example.com"
    PW = "pwpatientpass"

    def test_lazy_create_account(self):
        token = _mint_session_token(self.EMAIL, "patient")
        r = requests.post(
            f"{API}/auth/set-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200
        # Login afterwards
        r = requests.post(
            f"{API}/auth/login-password",
            json={"email": self.EMAIL, "password": self.PW, "role": "patient"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["role"] == "patient"


# ─── /admin/patients (by email) ──────────────────────────────────────────────
class TestAdminPatientsByEmail:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/admin/patients", timeout=10)
        assert r.status_code == 401

    def test_returns_aggregate(self):
        r = requests.get(
            f"{API}/admin/patients",
            headers={"X-Admin-Password": ADMIN_PW},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "patients" in data and isinstance(data["patients"], list)
        assert "total" in data
        # Every row must have the contracted shape
        for row in data["patients"][:5]:
            assert "email" in row
            assert "request_count" in row
            assert "verified_count" in row
            assert "matched_count" in row
            assert "last_request_at" in row
            assert "has_password_account" in row
            assert isinstance(row["request_count"], int)


# ─── /requests/verify response includes email ────────────────────────────────
class TestVerifyEmailEcho:
    def test_verify_returns_email(self):
        # Submit a real request, grab its verification_token from DB, hit
        # /requests/verify/{token} and confirm `email` is echoed.
        from tests.conftest import v2_request_payload
        email = f"iter51_verify_{int(time.time())}@example.com"
        payload = v2_request_payload(email=email)
        r = requests.post(f"{API}/requests", json=payload, timeout=15)
        assert r.status_code == 200
        rid = r.json()["id"]
        # Pull the verification_token directly from Mongo (we don't expose it).
        import asyncio
        from deps import db  # type: ignore  # noqa: E402

        async def _get_token():
            doc = await db.requests.find_one(
                {"id": rid}, {"_id": 0, "verification_token": 1}
            )
            return doc["verification_token"]

        token = asyncio.get_event_loop().run_until_complete(_get_token())
        r = requests.get(f"{API}/requests/verify/{token}", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["verified"] is True
        assert body["email"] == email


# ─── /requests/prefill carries has_password_account ──────────────────────────
class TestPrefillHasAccountFlag:
    EMAIL = f"iter51_prefill_{int(time.time())}@example.com"
    PW = "prefillpass"

    def test_flag_flips_after_set_password(self):
        # File a request so the email exists in `requests`
        from tests.conftest import v2_request_payload
        payload = v2_request_payload(email=self.EMAIL)
        r = requests.post(f"{API}/requests", json=payload, timeout=15)
        assert r.status_code == 200

        # Initially: no password
        r = requests.get(
            f"{API}/requests/prefill", params={"email": self.EMAIL}, timeout=10
        )
        body = r.json()
        assert body.get("returning") is True
        assert body.get("has_password_account") is False

        # Set a password
        token = _mint_session_token(self.EMAIL, "patient")
        r = requests.post(
            f"{API}/auth/set-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200

        # Now the flag flips
        r = requests.get(
            f"{API}/requests/prefill", params={"email": self.EMAIL}, timeout=10
        )
        body = r.json()
        assert body.get("has_password_account") is True
