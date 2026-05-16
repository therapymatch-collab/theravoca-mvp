"""Stripe webhook handler — keeps therapist.subscription_status in sync."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

import stripe_service
from deps import db, logger
from helpers import _now_iso, _ts_to_iso

router = APIRouter()


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhook handler. Updates therapist.subscription_status on lifecycle events.

    SECURITY/CORRECTNESS (2026-05-16): event-id deduplication.
    Stripe retries the same event.id for up to 3 days on any non-2xx
    response. Without deduplication, payment_intent.succeeded retries
    would re-stamp last_payment_at and flip subscription_status,
    charge.refunded retries would insert duplicate `refunds` rows
    (inflating the admin dashboard's refund totals), and
    charge.dispute.created retries would create duplicate dispute
    rows. We insert the event_id into db.stripe_events at the top of
    the handler; on the second arrival the unique-key insert fails and
    we short-circuit with `{"received": True, "duplicate": True}`.
    """
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe_service.construct_event(payload, sig)
    except Exception as e:
        logger.warning("Stripe webhook signature verification failed: %s", e)
        raise HTTPException(400, "invalid signature")
    etype = event.get("type") if isinstance(event, dict) else event.type
    if isinstance(event, dict):
        event_id = event.get("id")
        obj = (event.get("data") or {}).get("object") or {}
    else:
        event_id = getattr(event, "id", None)
        # Stripe Event object — coerce its data.object to a plain dict
        try:
            obj = dict(event.data.object)
        except (AttributeError, TypeError):
            obj = {}

    # Event-id dedupe. The _id is the Stripe event id so the unique
    # constraint is implicit. DuplicateKeyError -> we've already
    # processed this event; short-circuit. Failures other than
    # DuplicateKey (e.g. Mongo unavailable) fall through and process
    # the event normally -- losing dedupe is preferable to dropping
    # the event entirely on a transient DB blip.
    if event_id:
        try:
            from pymongo.errors import DuplicateKeyError
            await db.stripe_events.insert_one({
                "_id": event_id,
                "type": etype,
                "received_at": _now_iso(),
            })
        except DuplicateKeyError:
            logger.info("Stripe webhook duplicate event_id=%s type=%s -- skipping", event_id, etype)
            return {"received": True, "duplicate": True, "type": etype}
        except Exception as e:
            logger.warning("Stripe webhook dedupe insert failed (proceeding): %s", e)

    tid: Optional[str] = None

    async def _set(fields: dict[str, Any]):
        if not tid:
            return
        fields["updated_at"] = _now_iso()
        await db.therapists.update_one({"id": tid}, {"$set": fields})

    # Helper: resolve a Stripe customer_id to a therapist_id, or None.
    async def _tid_for_customer(cust_id: Optional[str]) -> Optional[str]:
        if not cust_id:
            return None
        t = await db.therapists.find_one(
            {"stripe_customer_id": cust_id}, {"_id": 0, "id": 1},
        )
        return t["id"] if t else None

    if etype == "checkout.session.completed":
        tid = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("theravoca_therapist_id")
        cust = obj.get("customer")
        sub_id = obj.get("subscription")
        if tid and sub_id:
            sub = stripe_service.retrieve_subscription(sub_id) or {}
            await _set({
                "stripe_customer_id": cust,
                "stripe_subscription_id": sub_id,
                "subscription_status": sub.get("status") or "trialing",
                "trial_ends_at": _ts_to_iso(sub.get("trial_end")),
                "current_period_end": _ts_to_iso(sub.get("current_period_end")),
            })
    elif etype in (
        "customer.subscription.updated",
        "customer.subscription.created",
        "customer.subscription.deleted",
    ):
        sub_id = obj.get("id")
        meta = obj.get("metadata") or {}
        tid = meta.get("theravoca_therapist_id") or await _tid_for_customer(obj.get("customer"))
        if tid:
            # Capture cancel_at_period_end too so the billing cron can
            # exclude therapists whose Stripe sub is set to expire at
            # current_period_end (Stripe itself stops billing them; our
            # manual PaymentIntent path must too). 2026-05-16 audit.
            await _set({
                "stripe_subscription_id": sub_id,
                "subscription_status": obj.get("status") or "canceled",
                "trial_ends_at": _ts_to_iso(obj.get("trial_end")),
                "current_period_end": _ts_to_iso(obj.get("current_period_end")),
                "cancel_at_period_end": bool(obj.get("cancel_at_period_end")),
            })
    elif etype == "setup_intent.succeeded":
        # Webhook fallback for stripe_payment_method_id persistence.
        # The primary path is /therapists/{id}/sync-payment-method
        # which writes the PM id when the user lands on the Stripe
        # success URL. If the user closes their tab BEFORE that
        # redirect, sync never runs and the cron later tries to
        # charge with payment_method=None. This handler covers that
        # edge case: Stripe fires setup_intent.succeeded server-side
        # regardless of the user closing their tab.
        pm = obj.get("payment_method")
        cust = obj.get("customer")
        tid = (
            (obj.get("metadata") or {}).get("theravoca_therapist_id")
            or await _tid_for_customer(cust)
        )
        if tid and pm:
            await _set({
                "stripe_customer_id": cust,
                "stripe_setup_intent_id": obj.get("id"),
                "stripe_payment_method_id": pm,
            })
    elif etype == "invoice.payment_failed":
        tid = await _tid_for_customer(obj.get("customer"))
        if tid:
            await _set({"subscription_status": "past_due"})

    # ─── New handlers (added 2026-05-12) ─────────────────────────────────
    elif etype == "payment_intent.succeeded":
        # Confirmation that one of our manual monthly PaymentIntents
        # cleared. Roll the therapist forward to "active" if they
        # weren't already, and stamp last_payment_at for diagnostics.
        tid = await _tid_for_customer(obj.get("customer"))
        if tid:
            await _set({
                "subscription_status": "active",
                "last_payment_at": _now_iso(),
                "last_payment_intent_id": obj.get("id"),
            })
    elif etype == "payment_intent.payment_failed":
        # Manual monthly charge declined. Mirror the invoice.payment_failed
        # branch: mark past_due. The cron + admin retry path handles
        # follow-up; we don't auto-cancel.
        tid = await _tid_for_customer(obj.get("customer"))
        if tid:
            await _set({
                "subscription_status": "past_due",
                "last_payment_failure_at": _now_iso(),
                "last_payment_failure_code": (obj.get("last_payment_error") or {}).get("code"),
            })
    elif etype == "charge.refunded":
        # Admin issued a refund via Stripe dashboard. Log it to the
        # refunds collection for visibility in the admin UI; don't
        # change subscription_status (refunds can be partial).
        cust_id = obj.get("customer")
        tid = await _tid_for_customer(cust_id)
        await db.refunds.insert_one({
            "stripe_charge_id": obj.get("id"),
            "stripe_customer_id": cust_id,
            "therapist_id": tid,  # may be None if no matching therapist
            "amount_refunded": obj.get("amount_refunded"),
            "currency": obj.get("currency"),
            "created_at": _now_iso(),
        })
    elif etype == "charge.dispute.created":
        # Customer disputed a charge with their bank. Flag the
        # therapist for admin review; do NOT auto-cancel -- disputes
        # often resolve in the merchant's favour.
        cust_id = obj.get("customer")
        tid = await _tid_for_customer(cust_id)
        await db.disputes.insert_one({
            "stripe_dispute_id": obj.get("id"),
            "stripe_charge_id": obj.get("charge"),
            "stripe_customer_id": cust_id,
            "therapist_id": tid,
            "amount": obj.get("amount"),
            "currency": obj.get("currency"),
            "reason": obj.get("reason"),
            "status": obj.get("status"),
            "created_at": _now_iso(),
        })
        if tid:
            await _set({"dispute_pending": True})

    return {"received": True, "type": etype}
