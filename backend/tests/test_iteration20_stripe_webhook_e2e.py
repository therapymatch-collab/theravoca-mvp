"""End-to-end Stripe simulation that does NOT require a real Stripe key.

We pivot from driving Stripe's hosted Checkout (which blocks programmatic form
fills for security) to simulating the post-checkout webhook directly.

This validates the *end of the funnel*: the `customer.subscription.created`
event flips a therapist's `subscription_status` from `incomplete` to `trialing`,
which is the exact state change a real `4242 4242 4242 4242` checkout produces.

Skipped automatically if the backend isn't reachable.
"""
from __future__ import annotations

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


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/admin/stats", headers=ADMIN_HEADERS, timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


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
    """Simulate the exact webhook Stripe sends after a successful test-card checkout.

    This is the equivalent of a user typing `4242 4242 4242 4242` and clicking
    `Subscribe` on the hosted checkout page — Stripe then POSTs this event to
    our `/api/stripe/webhook` endpoint, which is what we're verifying here.
    """
    trial_end_unix = int(time.time()) + 30 * 24 * 60 * 60
    period_end_unix = trial_end_unix
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
                "current_period_end": period_end_unix,
                "metadata": {"theravoca_therapist_id": therapist_id},
            },
        },
    }
    # When STRIPE_WEBHOOK_SECRET is unset (default in test env) the webhook
    # accepts unverified events — this lets us exercise the handler logic end-to-end.
    res = requests.post(
        f"{API}/stripe/webhook",
        data=json.dumps(event),
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    assert res.status_code == 200, res.text
    assert res.json().get("received") is True

    # Verify the therapist record actually flipped
    res2 = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=10)
    found = next(t for t in res2.json() if t["id"] == therapist_id)
    assert found["subscription_status"] == "trialing", found
    assert found.get("trial_ends_at"), "trial_ends_at should be set"
    assert found.get("current_period_end"), "current_period_end should be set"


def test_subscription_canceled_webhook_flips_to_canceled(therapist_id: str):
    """And a cancellation event flips the same therapist to `canceled`."""
    event = {
        "id": f"evt_cancel_{int(time.time())}",
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "id": f"sub_test_{int(time.time())}",
                "status": "canceled",
                "customer": f"cus_test_{int(time.time())}",
                "metadata": {"theravoca_therapist_id": therapist_id},
            },
        },
    }
    res = requests.post(
        f"{API}/stripe/webhook",
        data=json.dumps(event),
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    assert res.status_code == 200

    res2 = requests.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=10)
    found = next(t for t in res2.json() if t["id"] == therapist_id)
    assert found["subscription_status"] == "canceled", found
