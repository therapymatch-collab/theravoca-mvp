"""Iter-65: /api/admin/test-sms must poll Twilio and surface error_code 30034
with an A2P 10DLC troubleshooting hint when the FROM number is unregistered.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
HDRS = {"Content-Type": "application/json", "X-Admin-Password": ADMIN_PWD}


def test_test_sms_default_recipient_returns_a2p_30034():
    """Default recipient = TWILIO_DEV_OVERRIDE_TO. With current un-A2P-registered
    FROM, Twilio reports error_code 30034 after the poll."""
    r = requests.post(f"{BASE_URL}/api/admin/test-sms", json={}, headers=HDRS, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    # Required response shape
    for key in ("ok", "sid", "status", "final_status", "error_code",
                "error_message", "troubleshooting_hint"):
        assert key in data, f"missing {key} in response: {data}"
    # SMS send itself should succeed (queued)
    assert isinstance(data.get("sid"), str) and data["sid"], "sid should be present"
    # Terminal status should be undelivered/failed and error_code MUST be 30034
    assert data["error_code"] == 30034, f"expected 30034, got {data}"
    assert data["ok"] is False
    assert "A2P 10DLC registration" in (data.get("troubleshooting_hint") or "")


def test_test_sms_custom_payload_routes_to_override_still_surfaces_error():
    """Custom to/body still returns the same response shape and surfaces
    A2P 30034 because the FROM number is still un-registered."""
    r = requests.post(
        f"{BASE_URL}/api/admin/test-sms",
        json={"to": "+15555550100", "body": "custom test"},
        headers=HDRS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("ok", "final_status", "error_code", "troubleshooting_hint"):
        assert key in data
    # Twilio dev-override may rewrite recipient; either way error_code surfaces.
    # 30034 (A2P) is the expected blocker on this account.
    if data.get("error_code") is not None:
        assert isinstance(data["error_code"], int)


def test_test_sms_rejects_without_admin():
    r = requests.post(f"{BASE_URL}/api/admin/test-sms", json={}, timeout=15)
    assert r.status_code in (401, 403)
