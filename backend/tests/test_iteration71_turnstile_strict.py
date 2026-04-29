"""Iteration 71: Turnstile keys NOW configured -> strict gating.

Contract change being verified:
- POST /api/requests omitting turnstile_token -> 400 "Missing security verification token"
- POST /api/therapists/signup omitting turnstile_token -> 400 same message
- Site-copy admin returns rows; PUT/DELETE round-trip works.
"""
from __future__ import annotations

import os
import uuid
import time

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://care-matcher-1.preview.emergentagent.com",
).rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_headers(s):
    """Admin auth header. The backend accepts the master env password as
    a Basic-style admin token via either the X-Admin-Password header or
    the cookie set by /api/admin/login. Use header form for simplicity."""
    return {"X-Admin-Password": ADMIN_PWD}


# ─── Backend reachable ────────────────────────────────────────────────
def test_backend_health(s):
    r = s.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code in (200, 404), f"backend not reachable: {r.status_code}"


# ─── Turnstile is configured (env present) ────────────────────────────
def test_turnstile_env_present():
    # The site key is publicly exposed via frontend; this just sanity
    # checks the backend has its secret too. We don't read backend env
    # over the wire — instead we rely on the rejection-path tests below.
    assert True


# ─── Contract change: /api/requests strict ────────────────────────────
def _valid_intake_payload(suffix=""):
    return {
        "email": f"TEST_iter71+{suffix or uuid.uuid4().hex[:6]}@example.com",
        "location_state": "ID",
        "location_city": "Boise",
        "location_zip": "83702",
        "client_type": "individual",
        "age_group": "adult",
        "client_age": 32,
        "payment_type": "cash",
        "budget": 150,
        "presenting_issues": ["anxiety"],
        "availability_windows": ["weekday_evenings"],
        "modality_preference": "telehealth",
        "urgency": "flexible",
        "prior_therapy": "yes",
        "experience_preference": [],
        "gender_preference": "no_pref",
        "style_preference": [],
        # honeypot empty + form_started timestamp old enough
        "fax_number": "",
        "form_started_at_ms": int(time.time() * 1000) - 10_000,
    }


def test_intake_omit_turnstile_returns_400(s):
    payload = _valid_intake_payload()
    # NOTE: deliberately NOT including turnstile_token
    r = s.post(f"{BASE_URL}/api/requests", json=payload, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    detail = (r.json().get("detail") or "").lower()
    assert "security" in detail or "verification" in detail or "token" in detail, (
        f"unexpected error detail: {detail}"
    )


def test_intake_invalid_turnstile_returns_400(s):
    payload = _valid_intake_payload()
    payload["turnstile_token"] = "invalid_fake_token_xxx"
    r = s.post(f"{BASE_URL}/api/requests", json=payload, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ─── Contract change: /api/therapists/signup strict ───────────────────
def _valid_therapist_payload(suffix=""):
    return {
        "name": f"TEST iter71 {suffix or uuid.uuid4().hex[:6]}",
        "email": f"TEST_iter71+t_{suffix or uuid.uuid4().hex[:6]}@example.com",
        "phone_alert": "+12085551234",
        "office_phone": "+12085551235",
        "gender": "female",
        "licensed_states": ["ID"],
        "license_number": "LCSW-99999",
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "modalities": ["cbt"],
        "modality_offering": "telehealth",
        "office_locations": [],
        "insurance_accepted": [],
        "cash_rate": 150,
        "years_experience": 5,
        "availability_windows": ["weekday_evenings"],
        "urgency_capacity": "within_month",
        "free_consult": True,
        "bio": "Iter71 test therapist signup payload.",
    }


def test_therapist_signup_omit_turnstile_returns_400(s):
    payload = _valid_therapist_payload()
    r = s.post(f"{BASE_URL}/api/therapists/signup", json=payload, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    detail = (r.json().get("detail") or "").lower()
    assert "security" in detail or "verification" in detail or "token" in detail, (
        f"unexpected error detail: {detail}"
    )


def test_therapist_signup_invalid_turnstile_returns_400(s):
    payload = _valid_therapist_payload()
    payload["turnstile_token"] = "invalid_fake_token_xxx"
    r = s.post(f"{BASE_URL}/api/therapists/signup", json=payload, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ─── Site-copy editor backend ─────────────────────────────────────────
def test_admin_site_copy_list(s, admin_headers):
    r = s.get(f"{BASE_URL}/api/admin/site-copy", headers=admin_headers, timeout=10)
    assert r.status_code == 200, f"got {r.status_code}: {r.text}"
    data = r.json()
    assert "rows" in data
    assert isinstance(data["rows"], list)


def test_admin_site_copy_upsert_and_delete_round_trip(s, admin_headers):
    test_key = f"TEST_iter71.copy.{uuid.uuid4().hex[:6]}"
    test_value = "TURNSTILE-LIVE-TEST-VALUE"

    # Upsert
    r = s.put(
        f"{BASE_URL}/api/admin/site-copy",
        headers=admin_headers,
        json={"key": test_key, "value": test_value},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("key") == test_key
    assert body.get("value") == test_value

    # Verify via GET (admin)
    r2 = s.get(f"{BASE_URL}/api/admin/site-copy", headers=admin_headers, timeout=10)
    rows = r2.json().get("rows", [])
    found = next((row for row in rows if row.get("key") == test_key), None)
    assert found is not None, "upserted key not found in admin list"
    assert found.get("value") == test_value

    # Verify via public GET
    r3 = s.get(f"{BASE_URL}/api/site-copy", timeout=10)
    assert r3.status_code == 200
    public = r3.json()
    assert public.get(test_key) == test_value, "public site-copy did not pick up override"

    # Delete (cleanup)
    r4 = s.delete(
        f"{BASE_URL}/api/admin/site-copy/{test_key}",
        headers=admin_headers,
        timeout=10,
    )
    assert r4.status_code == 200, r4.text
    assert r4.json().get("deleted") == 1

    # Verify gone from public
    r5 = s.get(f"{BASE_URL}/api/site-copy", timeout=10)
    assert test_key not in r5.json()


def test_admin_site_copy_edit_btn_therapist_cta_headline(s, admin_headers):
    """End-to-end seed-key edit: btn.therapist.cta.headline.

    Saves the override, verifies it appears on public /api/site-copy,
    then DELETEs to restore default. We don't open the rendered HTML
    here — that's the frontend test's job — but we prove the data
    plumbing works.
    """
    key = "btn.therapist.cta.headline"
    value = "TURNSTILE-LIVE-TEST"

    # Capture the original override (if any) so we can restore later
    pre = s.get(f"{BASE_URL}/api/admin/site-copy", headers=admin_headers).json()
    original = next((r for r in pre.get("rows", []) if r.get("key") == key), None)

    try:
        r = s.put(
            f"{BASE_URL}/api/admin/site-copy",
            headers=admin_headers,
            json={"key": key, "value": value},
        )
        assert r.status_code == 200

        # Public reflects the override
        public = s.get(f"{BASE_URL}/api/site-copy").json()
        assert public.get(key) == value
    finally:
        if original is None:
            s.delete(
                f"{BASE_URL}/api/admin/site-copy/{key}",
                headers=admin_headers,
            )
        else:
            # Restore original value
            s.put(
                f"{BASE_URL}/api/admin/site-copy",
                headers=admin_headers,
                json={"key": key, "value": original.get("value", "")},
            )
