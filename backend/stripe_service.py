"""Stripe payment-method collection + subscription tracking for TheraVoca therapists.

DESIGN: We use Stripe Checkout in **setup mode** to collect a card upfront,
then track the trial + subscription state ourselves in MongoDB. We charge
$45 via a PaymentIntent on day 31 (recurring monthly).

Why setup mode? The Emergent shared Stripe proxy (`sk_test_emergent`) supports
the standard Checkout flow but does NOT persist Subscription/Price objects
across requests. Setup mode + manual charge cycles work reliably.

When a real Stripe key is later swapped in, this same flow remains valid;
the Subscription object would just be optional sugar.

Lifecycle states stored on therapist.subscription_status:
  incomplete → trialing → active → past_due → canceled
  legacy_free (grandfathered, never charged)
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import stripe
from dotenv import load_dotenv

# `override=True` ensures the real key in /app/backend/.env wins over any stale
# `sk_test_emergent` left in the supervisor process environment.
load_dotenv(override=True)

logger = logging.getLogger(__name__)


def _configure() -> bool:
    """Idempotent — set api_key + api_base each call so hot-reload picks up env changes."""
    # Re-load .env on every call with override=True so the real key in
    # /app/backend/.env consistently wins over any stale `sk_test_emergent`
    # left in the supervisor process environment.
    from pathlib import Path
    load_dotenv(Path(__file__).parent / ".env", override=True)
    key = os.environ.get("STRIPE_API_KEY", "").strip()
    if not key:
        return False
    stripe.api_key = key
    if "sk_test_emergent" in key:
        stripe.api_base = "https://integrations.emergentagent.com/stripe"
    else:
        stripe.api_base = stripe.DEFAULT_API_BASE
    return True


def _is_emergent_proxy() -> bool:
    return "sk_test_emergent" in (os.environ.get("STRIPE_API_KEY") or "")


def is_configured() -> bool:
    return _configure()


# ─── Card collection via Checkout (setup mode) ─────────────────────────────

async def create_setup_checkout(
    therapist_id: str,
    therapist_email: str,
    therapist_name: str,
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    """Create a Stripe Checkout in setup mode — collects card, no charge.

    Returns {url, session_id}. After success, the webhook (or a manual sync)
    attaches the payment_method to a customer and starts the 30-day trial.
    """
    if not _configure():
        raise RuntimeError("STRIPE_API_KEY not configured")

    session = stripe.checkout.Session.create(
        mode="setup",
        payment_method_types=["card"],
        customer_email=therapist_email,
        client_reference_id=therapist_id,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "theravoca_therapist_id": therapist_id,
            "theravoca_therapist_name": therapist_name,
        },
    )
    return {"url": session.url, "session_id": session.id}


def retrieve_session(session_id: str) -> Optional[dict[str, Any]]:
    """Fetch a Checkout Session including its setup_intent + customer."""
    if not _configure():
        return None
    try:
        s = stripe.checkout.Session.retrieve(
            session_id, expand=["setup_intent", "customer"]
        )
        si = s.setup_intent if hasattr(s, "setup_intent") else None
        return {
            "id": s.id,
            "status": s.status,
            "customer": s.customer if isinstance(s.customer, str) else (
                getattr(s.customer, "id", None) if s.customer else None
            ),
            "setup_intent_id": getattr(si, "id", None) if si else None,
            "payment_method": getattr(si, "payment_method", None) if si else None,
            "client_reference_id": s.client_reference_id,
        }
    except stripe.error.StripeError as e:
        logger.warning("Stripe session retrieve failed: %s", e)
        return None


# ─── Manual recurring charge ───────────────────────────────────────────────

def charge_monthly_fee(
    customer_id: str,
    payment_method_id: Optional[str],
    amount_cents: int = 4500,
    currency: str = "usd",
    description: str = "TheraVoca therapist subscription — monthly",
) -> dict[str, Any]:
    """Charge $45 via PaymentIntent. Returns Stripe response (or {error}).

    Used by the admin "charge now" endpoint and the daily cron on day 31+.
    """
    if not _configure():
        return {"error": "STRIPE_API_KEY not configured"}
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            customer=customer_id,
            payment_method=payment_method_id,
            confirm=True,
            off_session=True,
            description=description,
        )
        return {
            "id": intent.id,
            "status": intent.status,
            "amount": intent.amount,
            "currency": intent.currency,
        }
    except stripe.error.CardError as e:
        return {"error": "card_declined", "code": e.code, "message": str(e)}
    except stripe.error.StripeError as e:
        return {"error": "stripe_error", "message": str(e)}


# ─── Customer Portal (self-service subscription management) ────────────────

def create_billing_portal_session(
    customer_id: str,
    return_url: str,
) -> Optional[dict[str, Any]]:
    """Create a Stripe Customer Portal session so a therapist can update their
    card, view invoices, or cancel. Returns {url} or None on failure."""
    if not _configure():
        return None
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return {"url": session.url, "id": session.id}
    except stripe.error.StripeError as e:
        logger.warning("Stripe portal session creation failed: %s", e)
        return None


def construct_event(payload: bytes, sig_header: str) -> Any:
    """Verify the Stripe webhook signature and return the event as a plain dict.
    Rejects ALL webhooks if STRIPE_WEBHOOK_SECRET is not configured."""
    import json
    if not _configure():
        raise RuntimeError("STRIPE_API_KEY not configured")
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise RuntimeError(
            "STRIPE_WEBHOOK_SECRET not set — refusing to process unverified webhook. "
            "Set this env var from your Stripe dashboard → Developers → Webhooks → Signing secret."
        )
    # Raises stripe.error.SignatureVerificationError on bad sig — caller
    # turns that into a 400.
    stripe.Webhook.construct_event(payload, sig_header, secret)
    return json.loads(payload)
