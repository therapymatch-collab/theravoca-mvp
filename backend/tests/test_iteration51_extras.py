"""Iteration 51 extras — covers gaps not in test_iteration51_password_auth.py:

  • Brute-force lockout after 5 wrong attempts (HTTP 429)
  • /portal/patient/requests new dict shape {requests, has_password, email}
  • /portal/therapist/referrals therapist payload includes has_password
"""
import os
import sys
import time
import uuid
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
sys.path.insert(0, "/app/backend")


def _mint(email: str, role: str) -> str:
    from deps import _create_session_token  # type: ignore
    return _create_session_token(email, role)


# ─── Brute-force lockout ────────────────────────────────────────────────────
class TestBruteForceLockout:
    EMAIL = f"bruteforce_{uuid.uuid4().hex[:8]}@example.com"
    PW = "rightpassword123"

    def test_lockout_after_5_failures(self):
        # Set a password first
        token = _mint(self.EMAIL, "patient")
        r = requests.post(
            f"{API}/auth/set-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200, r.text

        # 5 wrong attempts
        for i in range(5):
            r = requests.post(
                f"{API}/auth/login-password",
                json={"email": self.EMAIL, "password": "wrong", "role": "patient"},
                timeout=10,
            )
            assert r.status_code == 401, f"attempt {i} expected 401, got {r.status_code}"

        # 6th attempt should be locked out (429 expected per spec)
        r = requests.post(
            f"{API}/auth/login-password",
            json={"email": self.EMAIL, "password": self.PW, "role": "patient"},
            timeout=10,
        )
        assert r.status_code in (401, 423, 429), (
            f"expected lockout status (429/423), got {r.status_code}, body={r.text}"
        )
        # Even the *correct* password should be blocked while locked
        if r.status_code == 200:
            raise AssertionError("Lockout NOT enforced — correct pw allowed during lockout window.")


# ─── /portal/patient/requests new shape ─────────────────────────────────────
class TestPortalPatientRequestsShape:
    def test_returns_dict_with_keys(self):
        from tests.conftest import v2_request_payload
        email = f"portalpatient_{int(time.time())}@example.com"
        # Create a request so this email has data
        r = requests.post(f"{API}/requests", json=v2_request_payload(email=email), timeout=15)
        assert r.status_code == 200

        token = _mint(email, "patient")
        r = requests.get(
            f"{API}/portal/patient/requests",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict), f"expected dict, got {type(body).__name__}"
        assert "requests" in body and isinstance(body["requests"], list)
        assert "has_password" in body and isinstance(body["has_password"], bool)
        assert "email" in body and body["email"] == email


# ─── /portal/therapist/referrals therapist.has_password ─────────────────────
class TestTherapistReferralsHasPassword:
    EMAIL = "portaltest@example.com"

    def test_payload_has_has_password(self):
        token = _mint(self.EMAIL, "therapist")
        r = requests.get(
            f"{API}/portal/therapist/referrals",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "therapist" in body, body
        assert "has_password" in body["therapist"], body["therapist"]
        assert isinstance(body["therapist"]["has_password"], bool)
