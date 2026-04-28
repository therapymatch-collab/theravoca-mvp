"""Iteration 53 — admin team management + JWT-based admin auth.

Covers:
  • POST /api/admin/team (invite)
  • GET  /api/admin/team
  • DELETE /api/admin/team/{id}
  • POST /api/admin/team/{id}/reset-password
  • POST /api/admin/login-with-email
  • require_admin now accepts Bearer admin JWT
  • require_admin still accepts X-Admin-Password header
"""
import os
import sys
import time
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")
sys.path.insert(0, "/app/backend")


def _master() -> dict:
    return {"X-Admin-Password": ADMIN_PW}


class TestAdminTeamLifecycle:
    EMAIL = f"team_{int(time.time())}@theravoca.test"
    PW = "teampass123"
    NEW_PW = "newpass456"
    member_id = None

    def test_01_invite(self):
        r = requests.post(
            f"{API}/admin/team",
            headers=_master(),
            json={"email": self.EMAIL, "name": "Team Tester", "password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == self.EMAIL
        assert body["name"] == "Team Tester"
        assert "password_hash" not in body
        type(self).member_id = body["id"]

    def test_02_invite_duplicate_409(self):
        r = requests.post(
            f"{API}/admin/team",
            headers=_master(),
            json={"email": self.EMAIL, "name": "Duplicate", "password": "differentpw"},
            timeout=10,
        )
        assert r.status_code == 409

    def test_03_invite_short_password_400(self):
        r = requests.post(
            f"{API}/admin/team",
            headers=_master(),
            json={"email": "another@theravoca.test", "name": "X", "password": "abc"},
            timeout=10,
        )
        assert r.status_code == 400

    def test_04_list_team_includes_invitee(self):
        r = requests.get(f"{API}/admin/team", headers=_master(), timeout=10)
        assert r.status_code == 200
        emails = [m["email"] for m in r.json()["team"]]
        assert self.EMAIL in emails

    def test_05_login_with_email_issues_jwt(self):
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": self.PW},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "admin"
        assert body["email"] == self.EMAIL
        assert body["name"] == "Team Tester"
        assert isinstance(body["token"], str) and len(body["token"]) > 30

    def test_06_jwt_grants_admin_access(self):
        # Invitee logs in, then uses Bearer JWT to hit an admin endpoint.
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": self.PW},
            timeout=10,
        )
        token = r.json()["token"]
        r = requests.get(
            f"{API}/admin/team",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text

    def test_07_wrong_password_401(self):
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": "wrong"},
            timeout=10,
        )
        assert r.status_code == 401

    def test_08_reset_password(self):
        assert self.member_id, "test_01 must run first"
        r = requests.post(
            f"{API}/admin/team/{self.member_id}/reset-password",
            headers=_master(),
            json={"password": self.NEW_PW},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Old password no longer works
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": self.PW},
            timeout=10,
        )
        assert r.status_code == 401
        # New password works
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": self.NEW_PW},
            timeout=10,
        )
        assert r.status_code == 200

    def test_09_remove_deactivates(self):
        assert self.member_id
        r = requests.delete(
            f"{API}/admin/team/{self.member_id}",
            headers=_master(),
            timeout=10,
        )
        assert r.status_code == 200
        # Deactivated user can no longer log in
        r = requests.post(
            f"{API}/admin/login-with-email",
            json={"email": self.EMAIL, "password": self.NEW_PW},
            timeout=10,
        )
        assert r.status_code == 401

    def test_10_remove_unknown_404(self):
        r = requests.delete(
            f"{API}/admin/team/does-not-exist",
            headers=_master(),
            timeout=10,
        )
        assert r.status_code == 404


class TestRequireAdminAcceptsBoth:
    """`require_admin` must accept either auth mode without regression."""

    def test_master_password_still_works(self):
        r = requests.get(f"{API}/admin/team", headers=_master(), timeout=10)
        assert r.status_code == 200

    def test_no_credentials_401(self):
        r = requests.get(f"{API}/admin/team", timeout=10)
        assert r.status_code == 401

    def test_invalid_bearer_401(self):
        r = requests.get(
            f"{API}/admin/team",
            headers={"Authorization": "Bearer not-a-real-token"},
            timeout=10,
        )
        assert r.status_code == 401
