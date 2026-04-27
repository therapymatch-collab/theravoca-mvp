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
    """Stripe webhook handler. Updates therapist.subscription_status on lifecycle events."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe_service.construct_event(payload, sig)
    except Exception as e:
        logger.warning("Stripe webhook signature verification failed: %s", e)
        raise HTTPException(400, "invalid signature")
    etype = event.get("type") if isinstance(event, dict) else event.type
    if isinstance(event, dict):
        obj = (event.get("data") or {}).get("object") or {}
    else:
        # Stripe Event object — coerce its data.object to a plain dict
        try:
            obj = dict(event.data.object)
        except (AttributeError, TypeError):
            obj = {}
    tid: Optional[str] = None

    async def _set(fields: dict[str, Any]):
        nonlocal tid
        if not tid:
            return
        fields["updated_at"] = _now_iso()
        await db.therapists.update_one({"id": tid}, {"$set": fields})

    if etype == "checkout.session.completed":
        tid = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("theravoca_therapist_id")
        cust = obj.get("customer")
        sub_id = obj.get("subscription")
        if tid and sub_id:
            sub = stripe_service.retrieve_subscription(sub_id) or {} if hasattr(stripe_service, "retrieve_subscription") else {}
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
        tid = meta.get("theravoca_therapist_id")
        if not tid:
            cust_id = obj.get("customer")
            t_match = await db.therapists.find_one(
                {"stripe_customer_id": cust_id}, {"_id": 0, "id": 1}
            )
            tid = t_match["id"] if t_match else None
        if tid:
            await _set({
                "stripe_subscription_id": sub_id,
                "subscription_status": obj.get("status") or "canceled",
                "trial_ends_at": _ts_to_iso(obj.get("trial_end")),
                "current_period_end": _ts_to_iso(obj.get("current_period_end")),
            })
    elif etype == "invoice.payment_failed":
        cust_id = obj.get("customer")
        t_match = await db.therapists.find_one(
            {"stripe_customer_id": cust_id}, {"_id": 0, "id": 1}
        )
        if t_match:
            tid = t_match["id"]
            await _set({"subscription_status": "past_due"})
    return {"received": True, "type": etype}
