"""Iteration 16 — Stripe Customer Portal end-to-end (real Stripe API).

Creates a real Stripe customer via the live test key in /app/backend/.env,
attaches it to a therapist via the admin update endpoint, then validates
that POST /api/therapists/{id}/portal-session returns a real billing.stripe.com URL."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import requests
import stripe
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")


@pytest.fixture(scope="module")
def real_stripe_customer():
    if not STRIPE_API_KEY or "sk_test_emergent" in STRIPE_API_KEY or not STRIPE_API_KEY.startswith("sk_test_"):
        pytest.skip("Real Stripe test key not configured")
    stripe.api_key = STRIPE_API_KEY
    cust = stripe.Customer.create(
        email="iter16_portal@theravoca.app",
        description="iter-16 portal e2e test",
    )
    yield cust.id
    # Cleanup
    try:
        stripe.Customer.delete(cust.id)
    except Exception:
        pass


@pytest.fixture
def therapist_with_real_customer(real_stripe_customer):
    therapists = requests.get(
        f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=20
    ).json()
    target = next(t for t in therapists if t["email"].startswith("therapymatch+t002"))
    tid = target["id"]
    requests.put(
        f"{API}/admin/therapists/{tid}",
        headers=ADMIN_HEADERS,
        json={
            "stripe_customer_id": real_stripe_customer,
            "subscription_status": "trialing",
        },
        timeout=20,
    )
    yield tid
    # Cleanup: clear the customer id
    requests.put(
        f"{API}/admin/therapists/{tid}",
        headers=ADMIN_HEADERS,
        json={"subscription_status": "trialing"},
        timeout=20,
    )


def test_portal_session_returns_real_stripe_url(therapist_with_real_customer):
    """End-to-end: POST /api/therapists/{id}/portal-session returns a real
    billing.stripe.com URL that Stripe accepts (HTTP 200)."""
    res = requests.post(
        f"{API}/therapists/{therapist_with_real_customer}/portal-session",
        json={},
        timeout=30,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "url" in body, body
    url = body["url"]
    assert url.startswith("https://billing.stripe.com/"), f"Not a real Stripe URL: {url}"
    # Verify the URL actually loads
    head = requests.get(url, allow_redirects=False, timeout=20)
    assert head.status_code == 200, f"Stripe rejected url: HTTP {head.status_code}"


def test_portal_session_uses_real_test_key():
    """Sanity: ensure the live config is the user's real key, not the proxy."""
    if not STRIPE_API_KEY:
        pytest.skip("No key set")
    assert STRIPE_API_KEY.startswith("sk_test_51"), (
        "STRIPE_API_KEY should be the user's real test key, "
        "not sk_test_emergent (which routes through the proxy)"
    )
