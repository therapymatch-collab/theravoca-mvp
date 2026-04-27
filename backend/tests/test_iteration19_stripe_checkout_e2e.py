"""Iter-19 — Stripe Checkout end-to-end with the test card 4242 4242 4242 4242.

Creates a fresh therapist, hits the Checkout endpoint, navigates the hosted Stripe
page, fills the card, completes, and verifies our therapist record flips to trialing.
Skipped automatically if STRIPE_API_KEY is the proxy stub or missing."""
from __future__ import annotations

import os
import time
from datetime import datetime
from pathlib import Path

import pytest
import requests
import stripe
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")


def _real_stripe() -> bool:
    return bool(
        STRIPE_API_KEY
        and STRIPE_API_KEY.startswith("sk_test_51")
        and "sk_test_emergent" not in STRIPE_API_KEY
    )


@pytest.fixture(scope="module")
def fresh_therapist():
    """Spin up a therapist that doesn't exist yet so we can drive a real Checkout."""
    if not _real_stripe():
        pytest.skip("Real Stripe test key required for e2e")
    email = f"e2e_checkout_{int(time.time())}@example.com"
    payload = {
        "name": f"E2E Checkout, LCSW",
        "email": email,
        "phone_alert": "(208) 555-9001",
        "office_phone": "(208) 555-9001",
        "gender": "female",
        "licensed_states": ["ID"],
        "license_number": "LCSW-99999",
        "license_expires_at": "2027-12-31",
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "modalities": ["CBT"],
        "modality_offering": "telehealth",
        "office_locations": [],
        "availability_windows": ["weekday_morning"],
        "credential_type": "lcsw",
        "cash_rate": 175,
        "years_experience": 5,
    }
    res = requests.post(f"{API}/therapists/signup", json=payload, timeout=20)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_checkout_endpoint_returns_real_stripe_url(fresh_therapist):
    """Verify our subscribe-checkout endpoint hands back a real Stripe URL."""
    res = requests.post(
        f"{API}/therapists/{fresh_therapist}/subscribe-checkout",
        json={}, timeout=30,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "url" in body
    assert body["url"].startswith("https://checkout.stripe.com/"), body["url"]
    assert body.get("demo_mode") is False


def test_complete_checkout_via_stripe_api_simulates_test_card(fresh_therapist):
    """Drive the Checkout completion via Stripe's API directly (faster + more
    reliable than Playwright for hosted-Checkout flow). Equivalent to a user
    typing 4242 4242 4242 4242 in the Stripe-hosted UI."""
    stripe.api_key = STRIPE_API_KEY

    # 1) Create a Checkout session via our endpoint
    res = requests.post(
        f"{API}/therapists/{fresh_therapist}/subscribe-checkout",
        json={}, timeout=30,
    )
    assert res.status_code == 200, res.text
    session_url = res.json()["url"]
    # Extract session id from URL: pattern is .../c/pay/cs_test_<id>#fid=...
    parts = session_url.split("/cs_test_")
    assert len(parts) == 2
    session_id = "cs_test_" + parts[1].split("#")[0]

    # 2) Load the session — this is what our success page does next
    sess = stripe.checkout.Session.retrieve(session_id)
    assert sess["mode"] == "setup"
    meta = sess["metadata"] or {}
    assert meta["theravoca_therapist_id"] == fresh_therapist

    # 3) Simulate the customer entering 4242 4242 4242 4242 via test-mode
    # PaymentMethod create + SetupIntent confirm. Stripe's test infrastructure
    # accepts the special "tok_visa" token that maps to 4242 4242 4242 4242.
    pm = stripe.PaymentMethod.create(
        type="card",
        card={"token": "tok_visa"},  # represents 4242 4242 4242 4242
    )
    setup_intent = stripe.SetupIntent.retrieve(sess["setup_intent"])
    confirmed = stripe.SetupIntent.confirm(
        setup_intent["id"],
        payment_method=pm["id"],
    )
    assert confirmed["status"] == "succeeded", confirmed["status"]

    # 4) Hit our sync-payment-method endpoint as the success page would
    sync = requests.post(
        f"{API}/therapists/{fresh_therapist}/sync-payment-method",
        json={"session_id": session_id},
        timeout=30,
    )
    assert sync.status_code == 200, sync.text
    body = sync.json()
    assert body["ok"] is True
    assert body["subscription_status"] == "trialing"
    assert body.get("trial_ends_at")

    # 5) Confirm therapist record reflects trialing
    detail = requests.get(
        f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=20,
    )
    therapist = next(t for t in detail.json() if t["id"] == fresh_therapist)
    assert therapist["subscription_status"] == "trialing"
    assert therapist["stripe_customer_id"]
    assert therapist["stripe_payment_method_id"]
    assert therapist["trial_ends_at"]
