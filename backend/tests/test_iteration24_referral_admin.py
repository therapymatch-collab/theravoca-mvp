"""Iter-24 backend tests — referral source options CRUD, email template copy."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")

DEFAULT_OPTIONS = [
    "Google search",
    "Instagram",
    "Friend / family",
    "Therapist referred me",
    "News article / podcast",
    "Other",
    "Prefer not to say",
]


@pytest.fixture
def admin_headers():
    return {"X-Admin-Password": ADMIN_PW, "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def reset_options_after(admin_headers):
    """Ensure default options are restored after every test."""
    yield
    try:
        requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": DEFAULT_OPTIONS},
            headers=admin_headers,
            timeout=10,
        )
    except Exception:
        pass


# ---- Public endpoint: default 7 options ----
class TestPublicReferralOptions:
    def test_public_returns_default_7(self, admin_headers):
        # First reset to defaults (in case prior run left custom)
        requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": DEFAULT_OPTIONS},
            headers=admin_headers,
            timeout=10,
        )
        r = requests.get(
            f"{BASE_URL}/api/config/referral-source-options", timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert "options" in body
        assert body["options"] == DEFAULT_OPTIONS


# ---- Admin endpoint auth ----
class TestAdminAuth:
    def test_get_requires_admin_password(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/referral-source-options", timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_get_with_admin_password_ok(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/referral-source-options",
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200
        assert isinstance(r.json().get("options"), list)

    def test_put_requires_admin_password(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": ["X"]},
            timeout=10,
        )
        assert r.status_code in (401, 403)


# ---- Admin PUT validation + persistence ----
class TestAdminPut:
    def test_put_persists_and_reflects_on_public(self, admin_headers):
        custom = ["TEST_A", "TEST_B", "TEST_C"]
        r = requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": custom},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["options"] == custom

        # Public endpoint reflects change
        r2 = requests.get(
            f"{BASE_URL}/api/config/referral-source-options", timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["options"] == custom

        # Admin GET reflects change too
        r3 = requests.get(
            f"{BASE_URL}/api/admin/referral-source-options",
            headers=admin_headers,
            timeout=10,
        )
        assert r3.status_code == 200
        assert r3.json()["options"] == custom

    def test_put_rejects_empty_list(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": []},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 400

    def test_put_rejects_non_string_entries(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": ["ok", 123, None]},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 400

    def test_put_rejects_blank_string_entries(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/referral-source-options",
            json={"options": ["ok", "   "]},
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 400


# ---- Email template updated copy ----
class TestEmailTemplateCopy:
    def test_therapist_signup_received_has_new_copy(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/email-templates",
            headers=admin_headers,
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        # Response could be list or dict keyed by template name.
        tpl = None
        if isinstance(body, dict):
            if "therapist_signup_received" in body:
                tpl = body["therapist_signup_received"]
            elif "templates" in body:
                for t in body["templates"]:
                    if t.get("key") == "therapist_signup_received":
                        tpl = t
                        break
        elif isinstance(body, list):
            for t in body:
                if t.get("key") == "therapist_signup_received":
                    tpl = t
                    break
        assert tpl is not None, f"therapist_signup_received not found in {body!r}"
        intro = tpl.get("intro", "") if isinstance(tpl, dict) else ""
        assert "can't sign in to edit your profile yet" in intro


# ---- Patient request payload still accepts referral_source string ----
class TestPatientRequestPayload:
    def test_post_requests_accepts_referral_source_string(self):
        from conftest import v2_request_payload
        payload = v2_request_payload(
            email="iter24_refsrc@example.com",
            referral_source="Google search",
        )
        r = requests.post(
            f"{BASE_URL}/api/requests", json=payload, timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert "id" in data or "request_id" in data

    def test_post_requests_accepts_other_colon_prefix(self):
        from conftest import v2_request_payload
        payload = v2_request_payload(
            email="iter24_refsrc_other@example.com",
            referral_source="Other: a friend told me",
        )
        r = requests.post(
            f"{BASE_URL}/api/requests", json=payload, timeout=15,
        )
        assert r.status_code in (200, 201), r.text
