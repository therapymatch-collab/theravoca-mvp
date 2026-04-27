"""Patient-facing routes: requests CRUD, verify, results, and admin release."""
from __future__ import annotations

import asyncio
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from deps import db, DEFAULT_THRESHOLD, require_admin
from email_service import send_verification_email
from geocoding import geocode_city, geocode_zip
from helpers import _now_iso, _parse_iso, _trigger_matching
from models import FollowupResponse, RequestCreate

router = APIRouter()


@router.get("/")
async def root():
    return {"app": "TheraVoca", "status": "ok"}


@router.post("/requests", response_model=dict)
async def create_request(payload: RequestCreate):
    rid = str(uuid.uuid4())
    token = secrets.token_urlsafe(24)
    patient_geo = None
    if payload.location_zip:
        coords = await geocode_zip(db, payload.location_zip)
        if coords:
            patient_geo = {"lat": coords[0], "lng": coords[1], "source": "zip"}
    if not patient_geo and payload.location_city:
        coords = await geocode_city(db, payload.location_city, payload.location_state)
        if coords:
            patient_geo = {"lat": coords[0], "lng": coords[1], "source": "city"}

    doc = {
        "id": rid,
        **payload.model_dump(),
        "patient_geo": patient_geo,
        "verification_token": token,
        "verified": False,
        "status": "pending_verification",
        "threshold": DEFAULT_THRESHOLD,
        "notified_therapist_ids": [],
        "notified_scores": {},
        "notified_distances": {},
        "results_sent_at": None,
        "created_at": _now_iso(),
    }
    await db.requests.insert_one(doc.copy())
    await send_verification_email(payload.email, rid, token)
    return {"id": rid, "status": "pending_verification"}


@router.get("/requests/verify/{token}")
async def verify_request(token: str):
    req = await db.requests.find_one({"verification_token": token}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Invalid or expired token")
    if not req.get("verified"):
        await db.requests.update_one(
            {"id": req["id"]},
            {"$set": {"verified": True, "status": "open", "verified_at": _now_iso()}},
        )
        asyncio.create_task(_trigger_matching(req["id"]))
    return {"id": req["id"], "verified": True}


@router.get("/requests/{request_id}/public", response_model=dict)
async def public_request_view(request_id: str):
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)
    return req


@router.get("/followup/{request_id}/{milestone}")
async def followup_view(request_id: str, milestone: str):
    """Surface enough context for the follow-up form: list of therapist
    applications the patient saw, plus any previously submitted response."""
    if milestone not in ("48h", "2wk", "6wk"):
        raise HTTPException(400, "Invalid milestone")
    req = await db.requests.find_one(
        {"id": request_id},
        {"_id": 0, "id": 1, "results_sent_at": 1, "status": 1},
    )
    if not req:
        raise HTTPException(404)
    apps = await db.applications.find(
        {"request_id": request_id},
        {"_id": 0, "therapist_id": 1, "therapist_name": 1, "match_score": 1},
    ).sort("match_score", -1).to_list(50)
    existing = await db.followups.find_one(
        {"request_id": request_id, "milestone": milestone}, {"_id": 0}
    )
    return {
        "request_id": request_id,
        "milestone": milestone,
        "applications": apps,
        "existing": existing,
    }


@router.post("/followup/{request_id}/{milestone}")
async def followup_submit(
    request_id: str, milestone: str, payload: FollowupResponse,
):
    """Patient submits the follow-up survey. Idempotent — last write wins."""
    if milestone not in ("48h", "2wk", "6wk"):
        raise HTTPException(400, "Invalid milestone")
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1, "email": 1})
    if not req:
        raise HTTPException(404)
    doc = {
        "request_id": request_id,
        "patient_email_anon": (req.get("email", "")[:3] + "***") if req.get("email") else "",
        "milestone": milestone,
        **payload.model_dump(),
        "created_at": _now_iso(),
    }
    await db.followups.update_one(
        {"request_id": request_id, "milestone": milestone},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, "milestone": milestone}


@router.post("/admin/requests/{request_id}/release-results")
async def admin_release_results(request_id: str, _: bool = Depends(require_admin)):
    """Manually release the 24h hold on patient results."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    if not req:
        raise HTTPException(404)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"results_released_at": _now_iso()}},
    )
    return {"ok": True, "released_at": _now_iso()}


@router.get("/requests/{request_id}/results", response_model=dict)
async def public_request_results(request_id: str):
    """Patient view of ranked therapist applications.

    24h hold: results are hidden until matched_at + 24h OR admin manually releases.
    """
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        raise HTTPException(404)
    apps_raw = await db.applications.find(
        {"request_id": request_id}, {"_id": 0}
    ).to_list(50)

    released_at = req.get("results_released_at")
    matched_at_str = req.get("matched_at") or req.get("created_at")
    matched_dt = _parse_iso(matched_at_str) if matched_at_str else None
    now = datetime.now(timezone.utc)
    hold_active = False
    hold_ends_at_iso: Optional[str] = None
    if not released_at and matched_dt:
        elapsed_h = (now - matched_dt).total_seconds() / 3600.0
        if elapsed_h < 24.0:
            hold_active = True
            hold_ends_at_iso = (matched_dt + timedelta(hours=24)).isoformat()

    apps = apps_raw if not hold_active else []

    matched_at = req.get("matched_at") or req.get("created_at")
    matched_dt2 = _parse_iso(matched_at) if matched_at else None
    for a in apps:
        ms = float(a.get("match_score") or 0)
        speed_bonus = 0.0
        if matched_dt2:
            applied_dt = _parse_iso(a.get("created_at") or "")
            if applied_dt:
                hours = max(0.0, (applied_dt - matched_dt2).total_seconds() / 3600.0)
                speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))
        msg_len = len(a.get("message") or "")
        quality_bonus = min(10.0, msg_len / 300.0 * 10.0)
        a["patient_rank_score"] = round(min(100.0, ms * 0.6 + speed_bonus + quality_bonus), 1)

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    breakdowns = req.get("notified_breakdowns") or {}
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            enriched.append({
                **a,
                "therapist": t,
                "match_breakdown": breakdowns.get(a["therapist_id"]) or {},
            })
    return {
        "request": req,
        "applications": enriched,
        "hold_active": hold_active,
        "hold_ends_at": hold_ends_at_iso,
        "applications_pending_count": len(apps_raw) if hold_active else 0,
    }
