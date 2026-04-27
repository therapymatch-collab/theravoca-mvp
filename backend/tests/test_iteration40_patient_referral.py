"""Iter-40: patient refer-a-friend attribution.

- Every new request gets a unique `patient_referral_code` issued on creation.
- The `?ref=` query param on the landing page is captured by the frontend and
  posted as `referred_by_patient_code` on the request payload.
- The backend stores it as-is for analytics (no incentive logic).
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

from conftest import v2_request_payload

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env", override=False)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def _create(extra: dict | None = None) -> str:
    payload = v2_request_payload(
        email=f"refer_{int(time.time() * 1000)}@example.com",
    )
    if extra:
        payload.update(extra)
    res = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _admin_request(rid: str) -> dict:
    res = requests.get(
        f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS, timeout=10,
    )
    assert res.status_code == 200, res.text
    return res.json()["request"]


def test_new_request_has_patient_referral_code():
    rid = _create()
    req = _admin_request(rid)
    code = req.get("patient_referral_code")
    assert code, "patient_referral_code missing on new request"
    assert isinstance(code, str)
    assert 6 <= len(code) <= 12, f"unexpected length: {code}"
    assert code == code.upper(), "code should be upper-cased"


def test_referral_codes_are_unique_across_requests():
    rid1 = _create()
    rid2 = _create()
    code1 = _admin_request(rid1)["patient_referral_code"]
    code2 = _admin_request(rid2)["patient_referral_code"]
    assert code1 != code2


def test_request_persists_referred_by_patient_code():
    """A second patient submitting with `referred_by_patient_code=<first patient's code>`
    should have that code stored on their request."""
    inviter = _admin_request(_create())
    inviter_code = inviter["patient_referral_code"]

    invitee_id = _create({"referred_by_patient_code": inviter_code})
    invitee = _admin_request(invitee_id)
    assert invitee["referred_by_patient_code"] == inviter_code


def test_results_endpoint_exposes_patient_referral_code():
    """The patient's own results page must include their `patient_referral_code`
    so the frontend can render the share-link tile."""
    rid = _create()
    res = requests.get(f"{API}/requests/{rid}/results", timeout=10)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["request"].get("patient_referral_code")
