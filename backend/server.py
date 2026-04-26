"""TheraVoca backend — FastAPI + MongoDB."""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from email_service import (
    send_patient_results,
    send_therapist_notification,
    send_verification_email,
)
from matching import rank_therapists
from seed_data import generate_seed_therapists

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("theravoca")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")
DEFAULT_THRESHOLD = float(os.environ.get("DEFAULT_MATCH_THRESHOLD", "60"))
AUTO_DELAY_HOURS = float(os.environ.get("AUTO_RESULTS_DELAY_HOURS", "24"))
PATIENT_DEMO_EMAIL = os.environ.get("PATIENT_DEMO_EMAIL", "")

app = FastAPI(title="TheraVoca API")
api = APIRouter(prefix="/api")


# ─── Models ────────────────────────────────────────────────────────────────────

class Specialty(BaseModel):
    name: str
    weight: int = 20


class TherapistOut(BaseModel):
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    licensed_states: list[str]
    office_locations: list[str]
    telehealth: bool
    specialties: list[Specialty]
    modalities: list[str]
    ages_served: list[str]
    insurance_accepted: list[str]
    cash_rate: int
    years_experience: int
    free_consult: bool
    bio: Optional[str] = None


class RequestCreate(BaseModel):
    email: EmailStr
    client_age: int = Field(ge=1, le=120)
    location_state: str
    location_city: Optional[str] = ""
    session_format: str = "virtual"  # virtual | in-person | hybrid
    payment_type: str = "cash"  # cash | insurance
    insurance_name: Optional[str] = ""
    budget: Optional[int] = None
    presenting_issues: str
    preferred_gender: Optional[str] = ""
    preferred_modality: Optional[str] = ""
    other_notes: Optional[str] = ""
    referral_source: Optional[str] = ""


class RequestOut(BaseModel):
    id: str
    email: str
    client_age: int
    location_state: str
    location_city: Optional[str] = ""
    session_format: str
    payment_type: str
    insurance_name: Optional[str] = ""
    budget: Optional[int] = None
    presenting_issues: str
    preferred_gender: Optional[str] = ""
    preferred_modality: Optional[str] = ""
    other_notes: Optional[str] = ""
    referral_source: Optional[str] = ""
    verified: bool
    status: str
    threshold: float
    notified_count: int = 0
    created_at: str
    results_sent_at: Optional[str] = None


class TherapistApplyIn(BaseModel):
    message: str = Field(min_length=10, max_length=1500)


class ApplicationOut(BaseModel):
    id: str
    request_id: str
    therapist_id: str
    therapist_name: str
    match_score: float
    message: str
    created_at: str


# ─── Auth helpers ──────────────────────────────────────────────────────────────

def require_admin(x_admin_password: Optional[str] = Header(None)) -> bool:
    if not x_admin_password or x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin password")
    return True


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_id(doc: dict[str, Any]) -> dict[str, Any]:
    doc.pop("_id", None)
    return doc


def _safe_summary_for_therapist(req: dict[str, Any]) -> dict[str, Any]:
    """Anonymized referral summary for therapists."""
    return {
        "Client age": req.get("client_age"),
        "State": req.get("location_state"),
        "Format": req.get("session_format", "virtual"),
        "City": req.get("location_city") or "—",
        "Payment": req.get("payment_type", "cash").title()
        + (f" ({req.get('insurance_name')})" if req.get("payment_type") == "insurance" and req.get("insurance_name") else ""),
        "Budget": (f"${req.get('budget')}/session" if req.get("budget") else "—"),
        "Presenting issues": req.get("presenting_issues", ""),
        "Preferences": ", ".join(
            x for x in [
                f"gender: {req.get('preferred_gender')}" if req.get("preferred_gender") else "",
                f"modality: {req.get('preferred_modality')}" if req.get("preferred_modality") else "",
                req.get("other_notes") or "",
            ] if x
        ) or "—",
    }


async def _trigger_matching(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    threshold = req.get("threshold", DEFAULT_THRESHOLD)
    therapists_cursor = db.therapists.find({}, {"_id": 0})
    therapists = await therapists_cursor.to_list(2000)
    matches = rank_therapists(therapists, req, threshold=threshold, min_results=5)

    # Persist match snapshot
    notified_ids: list[str] = []
    for m in matches:
        notified_ids.append(m["id"])
        # Send email (don't block on failures)
        summary = _safe_summary_for_therapist(req)
        await send_therapist_notification(
            to=m["email"],
            therapist_name=m["name"].split(",")[0],
            request_id=req["id"],
            therapist_id=m["id"],
            match_score=m["match_score"],
            summary=summary,
        )

    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "notified_therapist_ids": notified_ids,
            "notified_scores": {m["id"]: m["match_score"] for m in matches},
            "matched_at": _now_iso(),
            "status": "matched",
        }},
    )
    logger.info("Matched request %s -> notified %d therapists", request_id, len(notified_ids))
    return {"notified": len(notified_ids), "matches": [{"id": m["id"], "name": m["name"], "match_score": m["match_score"]} for m in matches]}


async def _deliver_results(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    apps.sort(key=lambda a: (a["match_score"], a["created_at"]), reverse=True)

    enriched = []
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            t_view = {
                **t,
                "specialties_display": [s["name"] for s in t.get("specialties", [])],
            }
            enriched.append({**a, "therapist": t_view})

    await send_patient_results(req["email"], request_id, enriched)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"results_sent_at": _now_iso(), "status": "completed"}},
    )
    return {"sent_to": req["email"], "count": len(enriched)}


async def _schedule_auto_results(request_id: str, delay_seconds: float) -> None:
    try:
        await asyncio.sleep(delay_seconds)
        req = await db.requests.find_one({"id": request_id}, {"_id": 0})
        if req and not req.get("results_sent_at"):
            await _deliver_results(request_id)
    except Exception as e:
        logger.exception("Auto results delivery failed for %s: %s", request_id, e)


# ─── Public Routes ────────────────────────────────────────────────────────────

@api.get("/")
async def root():
    return {"app": "TheraVoca", "status": "ok"}


@api.post("/requests", response_model=dict)
async def create_request(payload: RequestCreate):
    rid = str(uuid.uuid4())
    token = secrets.token_urlsafe(24)
    doc = {
        "id": rid,
        **payload.model_dump(),
        "verification_token": token,
        "verified": False,
        "status": "pending_verification",
        "threshold": DEFAULT_THRESHOLD,
        "notified_therapist_ids": [],
        "notified_scores": {},
        "results_sent_at": None,
        "created_at": _now_iso(),
    }
    await db.requests.insert_one(doc.copy())
    await send_verification_email(payload.email, rid, token)
    return {"id": rid, "status": "pending_verification"}


@api.get("/requests/verify/{token}")
async def verify_request(token: str):
    req = await db.requests.find_one({"verification_token": token}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Invalid or expired token")
    if not req.get("verified"):
        await db.requests.update_one(
            {"id": req["id"]},
            {"$set": {"verified": True, "status": "open", "verified_at": _now_iso()}},
        )
        # trigger matching in background
        asyncio.create_task(_trigger_matching(req["id"]))
        # schedule auto results delivery
        asyncio.create_task(_schedule_auto_results(req["id"], AUTO_DELAY_HOURS * 3600))
    return {"id": req["id"], "verified": True}


@api.get("/requests/{request_id}/public", response_model=dict)
async def public_request_view(request_id: str):
    """Patient-facing minimal view of their own request (no token required for MVP demo)."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "verification_token": 0})
    if not req:
        raise HTTPException(404)
    return req


@api.get("/requests/{request_id}/results", response_model=dict)
async def public_request_results(request_id: str):
    """Patient view of ranked therapist applications."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "verification_token": 0})
    if not req:
        raise HTTPException(404)
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    apps.sort(key=lambda a: (a["match_score"], a["created_at"]), reverse=True)
    enriched = []
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            enriched.append({**a, "therapist": t})
    return {"request": req, "applications": enriched}


# ─── Therapist Routes ─────────────────────────────────────────────────────────

@api.get("/therapist/apply/{request_id}/{therapist_id}", response_model=dict)
async def therapist_view(request_id: str, therapist_id: str):
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "email": 0, "verification_token": 0})
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
    return {
        "request_id": request_id,
        "therapist": {"id": therapist["id"], "name": therapist["name"]},
        "match_score": score,
        "summary": summary,
        "presenting_issues": req.get("presenting_issues", ""),
        "already_applied": bool(existing),
        "existing_message": existing.get("message") if existing else None,
    }


@api.post("/therapist/apply/{request_id}/{therapist_id}", response_model=ApplicationOut)
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
            {"$set": {"message": payload.message, "updated_at": now}},
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
        "created_at": now,
    }
    await db.applications.insert_one(app_doc.copy())
    return ApplicationOut(**app_doc)


# ─── Admin Routes ─────────────────────────────────────────────────────────────

@api.post("/admin/login")
async def admin_login(payload: dict):
    if payload.get("password") != ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid password")
    return {"ok": True}


@api.get("/admin/requests", response_model=list)
async def admin_list_requests(_: bool = Depends(require_admin)):
    docs = await db.requests.find({}, {"_id": 0, "verification_token": 0}).sort("created_at", -1).to_list(500)
    # add count of applications per request
    out = []
    for d in docs:
        app_count = await db.applications.count_documents({"request_id": d["id"]})
        d["application_count"] = app_count
        d["notified_count"] = len(d.get("notified_therapist_ids") or [])
        out.append(d)
    return out


@api.get("/admin/requests/{request_id}", response_model=dict)
async def admin_request_detail(request_id: str, _: bool = Depends(require_admin)):
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "verification_token": 0})
    if not req:
        raise HTTPException(404)
    notified_ids = req.get("notified_therapist_ids") or []
    notified = []
    for tid in notified_ids:
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        if t:
            notified.append({
                "id": t["id"],
                "name": t["name"],
                "email": t["email"],
                "match_score": (req.get("notified_scores") or {}).get(tid, 0),
            })
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    apps.sort(key=lambda a: a["match_score"], reverse=True)
    return {"request": req, "notified": notified, "applications": apps}


@api.post("/admin/requests/{request_id}/trigger-results")
async def admin_trigger_results(request_id: str, _: bool = Depends(require_admin)):
    return await _deliver_results(request_id)


@api.post("/admin/requests/{request_id}/resend-notifications")
async def admin_resend_notifications(request_id: str, _: bool = Depends(require_admin)):
    return await _trigger_matching(request_id)


@api.put("/admin/requests/{request_id}/threshold")
async def admin_update_threshold(request_id: str, payload: dict, _: bool = Depends(require_admin)):
    threshold = float(payload.get("threshold", DEFAULT_THRESHOLD))
    await db.requests.update_one({"id": request_id}, {"$set": {"threshold": threshold}})
    return {"id": request_id, "threshold": threshold}


@api.get("/admin/therapists", response_model=list)
async def admin_list_therapists(_: bool = Depends(require_admin)):
    return await db.therapists.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@api.post("/admin/seed")
async def admin_seed(_: bool = Depends(require_admin)):
    existing = await db.therapists.count_documents({})
    if existing > 0:
        return {"ok": True, "skipped": True, "existing": existing}
    therapists = generate_seed_therapists(100)
    await db.therapists.insert_many([t.copy() for t in therapists])
    return {"ok": True, "inserted": len(therapists)}


@api.get("/admin/stats")
async def admin_stats(_: bool = Depends(require_admin)):
    total_requests = await db.requests.count_documents({})
    pending = await db.requests.count_documents({"status": "pending_verification"})
    open_ = await db.requests.count_documents({"status": {"$in": ["open", "matched"]}})
    completed = await db.requests.count_documents({"status": "completed"})
    therapists = await db.therapists.count_documents({})
    apps = await db.applications.count_documents({})
    return {
        "total_requests": total_requests,
        "pending": pending,
        "open": open_,
        "completed": completed,
        "therapists": therapists,
        "applications": apps,
        "default_threshold": DEFAULT_THRESHOLD,
    }


# ─── Startup: auto-seed if empty ──────────────────────────────────────────────

@app.on_event("startup")
async def startup_seed():
    count = await db.therapists.count_documents({})
    if count == 0:
        therapists = generate_seed_therapists(100)
        await db.therapists.insert_many([t.copy() for t in therapists])
        logger.info("Auto-seeded %d Idaho therapists", len(therapists))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
