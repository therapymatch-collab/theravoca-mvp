"""End-to-end Stripe webhook simulation.

Sends real Stripe-shaped events (with `"object": "event"` at top level so the
SDK's `construct_event` accepts them). When `STRIPE_WEBHOOK_SECRET` is set we
sign the payload with HMAC-SHA256; otherwise we POST unsigned and the handler
accepts it (development-only path, logs a warning).

Skipped automatically if the backend isn't reachable.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

from conftest import v2_therapist_signup_payload

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}
WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/admin/stats", headers=ADMIN_HEADERS, timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def _post_event(event: dict) -> requests.Response:
    """POST a Stripe-shaped event with a valid signature header (if secret set)."""
    payload = json.dumps(event).encode()
    headers = {"Content-Type": "application/json"}
    if WEBHOOK_SECRET:
        ts = int(time.time())
        sig = hmac.new(
            WEBHOOK_SECRET.encode(),
            f"{ts}.{payload.decode()}".encode(),
            hashlib.sha256,
        ).hexdigest()
        headers["Stripe-Signature"] = f"t={ts},v1={sig}"
    return requests.post(f"{API}/stripe/webhook", data=payload, headers=headers, timeout=10)


@pytest.fixture(scope="module")
def therapist_id() -> str:
    payload = v2_therapist_signup_payload(
        email=f"webhook_e2e_{int(time.time())}@example.com",
        license_number="LCSW-WEBHOOK",
    )
    res = requests.post(f"{API}/therapists/signup", json=payload, timeout=20)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_initial_status_is_incomplete(therapist_id: str):
    """Right after signup the therapist hasn't paid → status = `incomplete`."""
    res = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=10)
    assert res.status_code == 200
    found = next(t for t in res.json() if t["id"] == therapist_id)
    assert found["subscription_status"] in ("incomplete", "", None), found["subscription_status"]


def test_subscription_created_webhook_flips_to_trialing(therapist_id: str):
    """Equivalent of a user typing 4242 4242 4242 4242 on Stripe-hosted Checkout."""
    trial_end_unix = int(time.time()) + 30 * 24 * 60 * 60
    event = {
        "id": f"evt_test_{int(time.time())}",
        "object": "event",
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": f"sub_test_{int(time.time())}",
                "object": "subscription",
                "status": "trialing",
                "customer": f"cus_test_{int(time.time())}",
                "trial_end": trial_end_unix,
                "current_period_end": trial_end_unix,
                "metadata": {"theravoca_therapist_id": therapist_id},
            },
        },
    }
    res = _post_event(event)
    assert res.status_code == 200, res.text
    assert res.json().get("received") is True

    res2 = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=10)
    found = next(t for t in res2.json() if t["id"] == therapist_id)
    assert found["subscription_status"] == "trialing", found
    assert found.get("trial_ends_at"), "trial_ends_at should be set"
    assert found.get("current_period_end"), "current_period_end should be set"


def test_subscription_canceled_webhook_flips_to_canceled(therapist_id: str):
    """Cancellation event flips the same therapist to `canceled`."""
    event = {
        "id": f"evt_cancel_{int(time.time())}",
        "object": "event",
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "id": f"sub_test_{int(time.time())}",
                "object": "subscription",
                "status": "canceled",
                "customer": f"cus_test_{int(time.time())}",
                "metadata": {"theravoca_therapist_id": therapist_id},
            },
        },
    }
    res = _post_event(event)
    assert res.status_code == 200

    res2 = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=10)
    found = next(t for t in res2.json() if t["id"] == therapist_id)
    assert found["subscription_status"] == "canceled", found


@pytest.mark.skipif(not WEBHOOK_SECRET, reason="STRIPE_WEBHOOK_SECRET not set")
def test_unsigned_event_is_rejected_when_secret_set():
    """When the secret IS set, missing/invalid signatures must return 400."""
    res = requests.post(
        f"{API}/stripe/webhook",
        data=b'{"id":"x","object":"event","type":"x","data":{"object":{}}}',
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    assert res.status_code == 400


@pytest.mark.skipif(not WEBHOOK_SECRET, reason="STRIPE_WEBHOOK_SECRET not set")
def test_tampered_signature_is_rejected():
    """Hand-rolled bad signature must return 400."""
    payload = b'{"id":"evt_tamper","object":"event","type":"customer.subscription.created","data":{"object":{}}}'
    ts = int(time.time())
    res = requests.post(
        f"{API}/stripe/webhook",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Stripe-Signature": f"t={ts},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
        timeout=10,
    )
    assert res.status_code == 400
