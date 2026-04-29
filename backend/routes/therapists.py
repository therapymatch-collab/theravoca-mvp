"""Therapist routes: signup, Stripe checkout/portal/charge, view + apply/decline."""
from __future__ import annotations

import asyncio
import base64
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from deps import db, logger, require_admin, require_session, _create_session_token
import stripe_service
from email_service import send_therapist_signup_received
from geocoding import geocode_offices
from helpers import _now_iso, _spawn_bg
from models import (
    ApplicationOut, BulkApplyIn, TherapistApplyIn, TherapistDeclineIn, TherapistSignup,
)
from turnstile_service import verify_token as verify_turnstile

router = APIRouter()


# ─── Self-signup + Stripe onboarding ────────────────────────────────────────

@router.post("/therapists/signup", response_model=dict)
async def therapist_signup(payload: TherapistSignup, request: Request):
    # Cloudflare Turnstile gate (fail-soft when secret not configured).
    fwd = request.headers.get("x-forwarded-for") or ""
    client_ip = (fwd.split(",")[0].strip() if fwd else None) or (
        getattr(request.client, "host", None) or ""
    )
    ok, ts_err = await verify_turnstile(
        getattr(payload, "turnstile_token", None), remote_ip=client_ip,
    )
    if not ok:
        raise HTTPException(400, ts_err or "Security check failed.")
    existing = await db.therapists.find_one({"email": payload.email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(409, "A therapist with this email already exists.")
    tid = str(uuid.uuid4())
    office_geos = await geocode_offices(db, payload.office_locations or [], "ID")
    data = payload.model_dump()
    data.pop("turnstile_token", None)  # not persisted
    data["telehealth"] = data["modality_offering"] in ("telehealth", "both")
    data["offers_in_person"] = data["modality_offering"] in ("in_person", "both")
    # Issue a stable refer-a-colleague code (8 chars, base32-ish)
    referral_code = data.get("referral_code") or uuid.uuid4().hex[:8].upper()

    # Gap-recruit attribution: if the signup came in via a recruit_code, find
    # the originating recruit_drafts row, mark it `converted=true`, and store
    # the code on the therapist for future analytics.
    recruit_code = (data.pop("recruit_code", None) or "").strip().upper()
    converted_draft_id: str | None = None
    if recruit_code:
        draft = await db.recruit_drafts.find_one(
            {"id": {"$regex": f"^{recruit_code.lower()}", "$options": "i"}},
            {"_id": 0, "id": 1},
        )
        if draft:
            converted_draft_id = draft["id"]
            await db.recruit_drafts.update_one(
                {"id": converted_draft_id},
                {"$set": {
                    "converted_therapist_id": tid,
                    "converted_at": _now_iso(),
                }},
            )

    doc = {
        "id": tid,
        **data,
        "referral_code": referral_code,
        "office_geos": office_geos,
        "source": "signup" if not recruit_code else "gap_recruit_signup",
        "recruit_code": recruit_code or None,
        "recruit_draft_id": converted_draft_id,
        "is_active": True,
        "pending_approval": True,
        "subscription_status": "incomplete",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": None,
        "current_period_end": None,
        "created_at": _now_iso(),
    }
    await db.therapists.insert_one(doc.copy())
    _spawn_bg(
        send_therapist_signup_received(payload.email, payload.name),
        name=f"signup_email_{tid[:8]}",
    )
    logger.info(
        "New therapist signup: %s (%s) with %d geocoded offices, recruit_code=%s",
        payload.email, tid, len(office_geos), recruit_code or "—",
    )
    # Kick off deep web-research enrichment in the background so by the
    # time admin reviews the application, we already have evidence-graded
    # specialty themes + public footprint cached. Best-effort; failures
    # are logged in research_enrichment but never block signup.
    try:
        from research_enrichment import get_or_build_research

        async def _bg_deep_research():
            try:
                t = await db.therapists.find_one({"id": tid}, {"_id": 0})
                if t:
                    await get_or_build_research(t, force=True, deep=True)
            except Exception as e:
                logger.warning("Auto deep-research for new signup failed: %s", e)

        _spawn_bg(_bg_deep_research(), name=f"deep_research_{tid[:8]}")
    except ImportError:
        pass
    return {"id": tid, "status": "pending_approval"}


@router.post("/therapists/{therapist_id}/subscribe-checkout")
async def therapist_subscribe_checkout(therapist_id: str):
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "subscription_status": 1},
    )
    if not t:
        raise HTTPException(404)
    base = os.environ.get("PUBLIC_APP_URL", "")
    success_url = f"{base}/therapists/join?subscribed={therapist_id}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{base}/therapists/join?canceled={therapist_id}"
    try:
        result = await stripe_service.create_setup_checkout(
            therapist_id=t["id"],
            therapist_email=t["email"],
            therapist_name=t["name"],
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except Exception as e:
        logger.exception("Stripe checkout creation failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    result["demo_mode"] = stripe_service._is_emergent_proxy()
    return result


@router.post("/therapists/{therapist_id}/sync-payment-method")
async def therapist_sync_payment_method(therapist_id: str, payload: dict):
    session_id = (payload or {}).get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "id": 1})
    if not t:
        raise HTTPException(404)

    is_demo = session_id.startswith("demo_") or stripe_service._is_emergent_proxy()
    if is_demo:
        info = {
            "status": "complete",
            "customer": f"cus_demo_{therapist_id[:10]}",
            "setup_intent_id": f"seti_demo_{therapist_id[:10]}",
            "payment_method": f"pm_demo_{therapist_id[:10]}",
        }
    else:
        info = stripe_service.retrieve_session(session_id)
        if not info:
            raise HTTPException(502, "Could not retrieve Stripe session")
        if info.get("status") != "complete":
            return {"ok": False, "status": info.get("status")}

    trial_end = datetime.now(timezone.utc) + timedelta(days=30)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "stripe_customer_id": info.get("customer"),
            "stripe_setup_intent_id": info.get("setup_intent_id"),
            "stripe_payment_method_id": info.get("payment_method"),
            "subscription_status": "trialing",
            "trial_ends_at": trial_end.isoformat(),
            "current_period_end": trial_end.isoformat(),
            "updated_at": _now_iso(),
        }},
    )
    # Issue a portal session token so the user can land directly on
    # /portal/therapist after Stripe success without bouncing through
    # email / magic-code sign-in.
    full = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "email": 1})
    session_token = (
        _create_session_token(full["email"], "therapist") if full else None
    )
    return {
        "ok": True,
        "subscription_status": "trialing",
        "trial_ends_at": trial_end.isoformat(),
        "demo_mode": is_demo,
        "session_token": session_token,
    }


@router.post("/therapists/{therapist_id}/portal-session")
async def therapist_portal_session(therapist_id: str):
    """Stripe Customer Portal — therapist self-serve subscription management."""
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "stripe_customer_id": 1},
    )
    if not t:
        raise HTTPException(404)
    if not t.get("stripe_customer_id"):
        raise HTTPException(400, "No Stripe customer on file. Add a payment method first.")
    base = os.environ.get("PUBLIC_APP_URL", "")
    return_url = f"{base}/portal/therapist"
    res = stripe_service.create_billing_portal_session(t["stripe_customer_id"], return_url)
    if not res:
        raise HTTPException(502, "Could not create Stripe Customer Portal session")
    return res


@router.get("/therapists/{therapist_id}/subscription")
async def therapist_subscription_status(therapist_id: str):
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "subscription_status": 1, "trial_ends_at": 1,
         "current_period_end": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1},
    )
    if not t:
        raise HTTPException(404)
    return t


@router.post("/admin/therapists/{therapist_id}/charge-now")
async def admin_charge_therapist_now(
    therapist_id: str, _: bool = Depends(require_admin),
):
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1, "subscription_status": 1},
    )
    if not t or not t.get("stripe_customer_id"):
        raise HTTPException(400, "Therapist has no Stripe customer on file")
    res = stripe_service.charge_monthly_fee(
        customer_id=t["stripe_customer_id"],
        payment_method_id=t.get("stripe_payment_method_id"),
    )
    if res.get("error"):
        await db.therapists.update_one(
            {"id": therapist_id},
            {"$set": {"subscription_status": "past_due", "updated_at": _now_iso()}},
        )
        return {"ok": False, **res}
    next_period = datetime.now(timezone.utc) + timedelta(days=30)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "subscription_status": "active",
            "current_period_end": next_period.isoformat(),
            "trial_ends_at": None,
            "updated_at": _now_iso(),
        }},
    )
    return {"ok": True, **res, "current_period_end": next_period.isoformat()}


# ─── Therapist-facing referral apply/decline/view ────────────────────────────

from helpers import _safe_summary_for_therapist  # noqa: E402


@router.post("/portal/therapist/bulk-apply")
async def therapist_bulk_apply(
    payload: BulkApplyIn,
    session: dict = Depends(require_session(("therapist",))),
):
    """Confirm interest on N referrals at once. Each referral gets the same
    message + commitment flags. Skips referrals the therapist wasn't notified for."""
    import re
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")
    tid = therapist["id"]
    out: list[dict] = []
    for rid in payload.request_ids[:50]:
        req = await db.requests.find_one({"id": rid}, {"_id": 0, "id": 1, "notified_scores": 1})
        if not req:
            out.append({"request_id": rid, "ok": False, "error": "not_found"})
            continue
        score = (req.get("notified_scores") or {}).get(tid)
        if score is None:
            out.append({"request_id": rid, "ok": False, "error": "not_notified"})
            continue
        existing = await db.applications.find_one(
            {"request_id": rid, "therapist_id": tid}, {"_id": 0, "id": 1}
        )
        all_confirmed = all([
            payload.confirms_availability, payload.confirms_urgency, payload.confirms_payment,
        ])
        doc = {
            "message": payload.message,
            "confirms_availability": payload.confirms_availability,
            "confirms_urgency": payload.confirms_urgency,
            "confirms_payment": payload.confirms_payment,
            "all_confirmed": all_confirmed,
            "updated_at": _now_iso(),
        }
        if existing:
            await db.applications.update_one({"id": existing["id"]}, {"$set": doc})
            out.append({"request_id": rid, "ok": True, "updated": True})
        else:
            doc.update({
                "id": str(uuid.uuid4()),
                "request_id": rid,
                "therapist_id": tid,
                "therapist_name": therapist["name"],
                "match_score": score,
                "created_at": _now_iso(),
            })
            await db.applications.insert_one(doc.copy())
            out.append({"request_id": rid, "ok": True, "created": True})
    return {"results": out, "succeeded": sum(1 for x in out if x["ok"])}


@router.get("/therapist/apply/{request_id}/{therapist_id}", response_model=dict)
async def therapist_view(request_id: str, therapist_id: str):
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "email": 0, "verification_token": 0}
    )
    therapist = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id)
    if score is None:
        raise HTTPException(403, "This therapist was not notified for this request")
    existing = await db.applications.find_one(
        {"request_id": request_id, "therapist_id": therapist_id}, {"_id": 0}
    )
    summary = _safe_summary_for_therapist({**req, "email": ""})
    breakdown = (req.get("notified_breakdowns") or {}).get(therapist_id) or {}
    from matching import gap_axes
    gaps = gap_axes(therapist, req, breakdown, top_n=3) if breakdown else []
    return {
        "request_id": request_id,
        "therapist": {"id": therapist["id"], "name": therapist["name"]},
        "match_score": score,
        "match_breakdown": breakdown,
        "gaps": gaps,
        "summary": summary,
        "presenting_issues": req.get("presenting_issues", ""),
        "already_applied": bool(existing),
        "existing_message": existing.get("message") if existing else None,
        "existing_confirmations": {
            "availability": bool((existing or {}).get("confirms_availability")),
            "urgency": bool((existing or {}).get("confirms_urgency")),
            "payment": bool((existing or {}).get("confirms_payment")),
        } if existing else None,
    }


@router.post("/therapist/apply/{request_id}/{therapist_id}", response_model=ApplicationOut)
async def therapist_apply(request_id: str, therapist_id: str, payload: TherapistApplyIn):
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    therapist = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id)
    if score is None:
        raise HTTPException(403, "Not notified for this request")

    existing = await db.applications.find_one(
        {"request_id": request_id, "therapist_id": therapist_id}, {"_id": 0}
    )
    now = _now_iso()
    if existing:
        await db.applications.update_one(
            {"id": existing["id"]},
            {"$set": {
                "message": payload.message,
                "confirms_availability": payload.confirms_availability,
                "confirms_urgency": payload.confirms_urgency,
                "confirms_payment": payload.confirms_payment,
                "all_confirmed": all([
                    payload.confirms_availability,
                    payload.confirms_urgency,
                    payload.confirms_payment,
                ]),
                "updated_at": now,
            }},
        )
        return ApplicationOut(
            id=existing["id"],
            request_id=request_id,
            therapist_id=therapist_id,
            therapist_name=therapist["name"],
            match_score=score,
            message=payload.message,
            created_at=existing["created_at"],
        )

    app_doc = {
        "id": str(uuid.uuid4()),
        "request_id": request_id,
        "therapist_id": therapist_id,
        "therapist_name": therapist["name"],
        "match_score": score,
        "message": payload.message,
        "confirms_availability": payload.confirms_availability,
        "confirms_urgency": payload.confirms_urgency,
        "confirms_payment": payload.confirms_payment,
        "all_confirmed": all([
            payload.confirms_availability,
            payload.confirms_urgency,
            payload.confirms_payment,
        ]),
        "created_at": now,
    }
    # Score apply-text fit when research enrichment is enabled. Best-effort
    # — failures don't block the apply. Adds 0-5 points + 1-sentence rationale.
    try:
        from research_enrichment import is_enabled as _re_enabled, score_apply_fit
        if await _re_enabled():
            fit = await score_apply_fit(payload.message or "", req, therapist)
            app_doc["apply_fit"] = fit.get("apply_fit") or 0
            app_doc["apply_fit_rationale"] = fit.get("rationale") or ""
    except Exception:
        pass
    await db.applications.insert_one(app_doc.copy())
    return ApplicationOut(**app_doc)


@router.post("/therapist/decline/{request_id}/{therapist_id}", response_model=dict)
async def therapist_decline(
    request_id: str, therapist_id: str, payload: TherapistDeclineIn,
):
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    therapist = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "email": 1}
    )
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id) if req else None
    doc = {
        "id": str(uuid.uuid4()),
        "request_id": request_id,
        "therapist_id": therapist_id,
        "therapist_email": therapist.get("email", ""),
        "match_score": score,
        "reason_codes": payload.reason_codes,
        "notes": payload.notes,
        "created_at": _now_iso(),
    }
    await db.declines.update_one(
        {"request_id": request_id, "therapist_id": therapist_id},
        {"$set": doc},
        upsert=True,
    )
    return {"id": doc["id"], "status": "declined"}


@router.get("/therapist/{therapist_id}/referrals")
async def therapist_referrals(therapist_id: str):
    """Public-by-id list of all referrals this therapist was notified for."""
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "name": 1, "email": 1}
    )
    if not t:
        raise HTTPException(404)

    cur = db.requests.find(
        {"notified_therapist_ids": therapist_id},
        {"_id": 0, "verification_token": 0},
    ).sort("matched_at", -1).limit(100)
    requests_list = await cur.to_list(100)

    apps = {a["request_id"]: a async for a in db.applications.find(
        {"therapist_id": therapist_id}, {"_id": 0}
    )}
    declines = {d["request_id"]: d async for d in db.declines.find(
        {"therapist_id": therapist_id}, {"_id": 0}
    )}

    out = []
    for r in requests_list:
        rid = r["id"]
        score = (r.get("notified_scores") or {}).get(therapist_id) or 0
        breakdown = (r.get("notified_breakdowns") or {}).get(therapist_id) or {}
        if rid in apps:
            ref_status = "interested"
        elif rid in declines:
            ref_status = "declined"
        else:
            ref_status = "pending"
        out.append({
            "request_id": rid,
            "matched_at": r.get("matched_at"),
            "patient_email_anon": (r.get("email", "")[:3] + "***") if r.get("email") else "",
            "match_score": score,
            "match_breakdown": breakdown,
            "status": ref_status,
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
        })
    return {"therapist": t, "referrals": out}



# ─── Self-serve license document upload ─────────────────────────────────────
# Therapist uploads a PDF / JPG / PNG of their license. We base64-store it
# inline on the therapist doc (capped at 5 MB) and flag the row as
# `pending_reapproval` so an admin reviews + re-publishes after upload.
MAX_LICENSE_BYTES = 5 * 1024 * 1024  # 5 MB
LICENSE_ALLOWED_TYPES = {
    "application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp",
}


@router.post("/therapists/me/license-document")
async def therapist_upload_license(
    payload: dict,
    session: dict = Depends(require_session(("therapist",))),
):
    """Therapist uploads a base64-encoded license document. Body:
        {filename, content_type, data_base64}
    """
    email = session.get("email")
    therapist = await db.therapists.find_one({"email": email}, {"_id": 0})
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")

    filename = (payload or {}).get("filename") or ""
    content_type = (payload or {}).get("content_type") or ""
    data_b64 = (payload or {}).get("data_base64") or ""
    if not filename or not data_b64:
        raise HTTPException(400, "filename and data_base64 are required")
    if content_type not in LICENSE_ALLOWED_TYPES:
        raise HTTPException(
            400,
            "Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.",
        )
    try:
        if "," in data_b64:
            data_b64 = data_b64.split(",", 1)[1]
        raw = base64.b64decode(data_b64, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid base64 payload")
    if len(raw) > MAX_LICENSE_BYTES:
        raise HTTPException(
            400,
            f"File too large ({len(raw) // 1024} KB). Max 5 MB.",
        )

    now = _now_iso()
    await db.therapists.update_one(
        {"id": therapist["id"]},
        {"$set": {
            "license_document": {
                "filename": filename[:200],
                "content_type": content_type,
                "size_bytes": len(raw),
                "data_base64": data_b64,
                "uploaded_at": now,
            },
            "pending_reapproval": True,
            "updated_at": now,
        }},
    )
    return {
        "ok": True,
        "filename": filename,
        "size_bytes": len(raw),
        "uploaded_at": now,
        "pending_reapproval": True,
    }


@router.get("/therapists/me/license-document")
async def therapist_get_my_license_doc(
    session: dict = Depends(require_session(("therapist",))),
):
    email = session.get("email")
    t = await db.therapists.find_one(
        {"email": email}, {"_id": 0, "license_document": 1},
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    doc = t.get("license_document") or {}
    if not doc:
        return {"present": False}
    return {
        "present": True,
        "filename": doc.get("filename"),
        "content_type": doc.get("content_type"),
        "size_bytes": doc.get("size_bytes"),
        "uploaded_at": doc.get("uploaded_at"),
    }
