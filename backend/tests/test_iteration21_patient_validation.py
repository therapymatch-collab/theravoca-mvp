"""Iter-21 — Patient intake spam/validation gates + SMS receipt opt-in."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

from conftest import v2_request_payload

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def _payload(**overrides):
    base = {"email": f"valid_{int(time.time() * 1000)}@example.com"}
    base.update(overrides)
    return v2_request_payload(**base)


def test_disposable_email_rejected():
    p = _payload(email="abc@mailinator.com")
    res = requests.post(f"{API}/requests", json=p, timeout=10)
    assert res.status_code == 400, res.text
    assert "disposable" in res.text.lower() or "personal email" in res.text.lower()


def test_implausible_email_rejected_at_pydantic_layer():
    """Pydantic catches `not-an-email` before our validator even runs."""
    p = _payload(email="not-an-email")
    res = requests.post(f"{API}/requests", json=p, timeout=10)
    assert res.status_code == 422, res.text


def test_zip_state_mismatch_rejected():
    """ZIP 10001 (NY) cannot belong to state ID."""
    p = _payload(location_state="ID", location_zip="10001", location_city="Boise")
    res = requests.post(f"{API}/requests", json=p, timeout=10)
    assert res.status_code == 400, res.text
    assert "ZIP" in res.text or "zip" in res.text


def test_zip_city_mismatch_rejected():
    """ZIP 83702 is Boise; pairing it with `Coeur d'Alene` (~400mi away in ID) should be rejected."""
    p = _payload(location_state="ID", location_zip="83702", location_city="Coeur d'Alene")
    res = requests.post(f"{API}/requests", json=p, timeout=15)
    assert res.status_code == 400, res.text
    assert "ZIP" in res.text or "zip" in res.text


def test_valid_payload_accepted():
    p = _payload(location_state="ID", location_zip="83702", location_city="Boise")
    res = requests.post(f"{API}/requests", json=p, timeout=15)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending_verification"


def test_sms_opt_in_field_persisted():
    """Even without Twilio enabled, the opt-in flag persists for audit."""
    p = _payload(
        email=f"smsopt_{int(time.time())}@example.com",
        phone="(208) 555-0123",
        sms_opt_in=True,
    )
    res = requests.post(f"{API}/requests", json=p, timeout=10)
    assert res.status_code == 200
    rid = res.json()["id"]
    # Verify via admin endpoint that the field was persisted
    detail = requests.get(
        f"{API}/admin/requests/{rid}",
        headers={"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")},
        timeout=10,
    )
    assert detail.status_code == 200
    req = detail.json()["request"]
    assert req.get("sms_opt_in") is True
    assert req.get("phone") == "(208) 555-0123"


def test_referral_source_aggregate_endpoint():
    """Admin can pull a counted breakdown of referral_source over time."""
    # Submit 2 requests with explicit referral_source
    for src in ("instagram", "instagram", "google"):
        p = _payload(
            email=f"refsrc_{int(time.time() * 1000)}@example.com",
            referral_source=src,
        )
        res = requests.post(f"{API}/requests", json=p, timeout=10)
        assert res.status_code == 200, res.text
    res = requests.get(
        f"{API}/admin/referral-sources",
        headers={"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")},
        timeout=10,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    src_map = {s["source"]: s["count"] for s in body["sources"]}
    assert src_map.get("instagram", 0) >= 2
    assert src_map.get("google", 0) >= 1
    assert "samples" in body
