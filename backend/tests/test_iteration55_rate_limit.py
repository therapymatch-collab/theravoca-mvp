"""Iteration-55 tests: admin-configurable patient intake rate limit.

Covers:
 - GET defaults
 - PUT validation (limit < 1, window < 1, out-of-range)
 - PUT round-trip + GET
 - POST /requests then second POST returns 429 (default 1/hour)
 - Raising the limit allows a second submission

NOTE: This test mutates `app_config.intake_rate_limit`. We always
restore it to the documented default (1 / 60min) at the end so other
tests are not affected.
"""
import os
import uuid
import requests
import pytest

from tests.conftest import v2_request_payload

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}

GET_URL = f"{BASE}/api/admin/intake-rate-limit"
PUT_URL = f"{BASE}/api/admin/intake-rate-limit"
REQ_URL = f"{BASE}/api/requests"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(autouse=True)
def _restore_default(s):
    """Make sure every test starts AND ends with the documented default."""
    s.put(
        PUT_URL,
        headers=ADMIN_HEADERS,
        json={"max_requests_per_window": 1, "window_minutes": 60},
    )
    yield
    s.put(
        PUT_URL,
        headers=ADMIN_HEADERS,
        json={"max_requests_per_window": 1, "window_minutes": 60},
    )


# ── (a) GET returns defaults ────────────────────────────────────────────
def test_get_intake_rate_limit_defaults(s):
    r = s.get(GET_URL, headers=ADMIN_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["max_requests_per_window"] == 1
    assert body["window_minutes"] == 60


# ── (b) PUT validation ─────────────────────────────────────────────────
@pytest.mark.parametrize(
    "payload",
    [
        {"max_requests_per_window": 0, "window_minutes": 60},
        {"max_requests_per_window": 51, "window_minutes": 60},
        {"max_requests_per_window": 1, "window_minutes": 0},
        {"max_requests_per_window": 1, "window_minutes": 10081},
        {"max_requests_per_window": "abc", "window_minutes": 60},
    ],
)
def test_put_intake_rate_limit_invalid(s, payload):
    r = s.put(PUT_URL, headers=ADMIN_HEADERS, json=payload)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


# ── (c) PUT round-trip + GET ───────────────────────────────────────────
def test_put_then_get_round_trip(s):
    new_vals = {"max_requests_per_window": 5, "window_minutes": 30}
    r = s.put(PUT_URL, headers=ADMIN_HEADERS, json=new_vals)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == new_vals

    g = s.get(GET_URL, headers=ADMIN_HEADERS)
    assert g.status_code == 200
    assert g.json() == new_vals


# ── (d) Two posts in a row → second is 429 ─────────────────────────────
def test_second_post_blocked_by_default(s):
    email = f"TEST_iter55_{uuid.uuid4().hex[:8]}@example.com"
    p1 = v2_request_payload(email=email)
    r1 = s.post(REQ_URL, json=p1)
    assert r1.status_code == 200, r1.text

    p2 = v2_request_payload(email=email)
    r2 = s.post(REQ_URL, json=p2)
    assert r2.status_code == 429, f"expected 429, got {r2.status_code} {r2.text}"
    detail = r2.json().get("detail", "")
    assert "1 request per hour" in detail, f"detail={detail!r}"


# ── (e) Raising the limit allows a second submission ───────────────────
def test_raised_limit_allows_second_submission(s):
    # Bump to 5 / hour so we can submit twice
    r = s.put(
        PUT_URL,
        headers=ADMIN_HEADERS,
        json={"max_requests_per_window": 5, "window_minutes": 60},
    )
    assert r.status_code == 200, r.text

    email = f"TEST_iter55b_{uuid.uuid4().hex[:8]}@example.com"
    r1 = s.post(REQ_URL, json=v2_request_payload(email=email))
    assert r1.status_code == 200, r1.text

    r2 = s.post(REQ_URL, json=v2_request_payload(email=email))
    assert r2.status_code == 200, f"expected 200 after raising limit, got {r2.status_code} {r2.text}"


# ── Admin auth required ────────────────────────────────────────────────
def test_get_requires_admin(s):
    r = s.get(GET_URL)  # no header
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_put_requires_admin(s):
    r = s.put(PUT_URL, json={"max_requests_per_window": 2, "window_minutes": 60})
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
