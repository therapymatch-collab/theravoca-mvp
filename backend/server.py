"""TheraVoca backend — FastAPI + MongoDB."""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, status
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from email_service import (
    send_magic_code,
    send_patient_results,
    send_therapist_approved,
    send_therapist_notification,
    send_therapist_signup_received,
    send_verification_email,
)
from geocoding import geocode_city, geocode_offices, geocode_zip, haversine_miles
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
DEFAULT_THRESHOLD = float(os.environ.get("DEFAULT_MATCH_THRESHOLD", "71"))
AUTO_DELAY_HOURS = float(os.environ.get("AUTO_RESULTS_DELAY_HOURS", "24"))
PATIENT_DEMO_EMAIL = os.environ.get("PATIENT_DEMO_EMAIL", "")

# Magic-link auth
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    logger_name = "theravoca"  # ensure logger created later catches this
JWT_ALGO = "HS256"
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
MAGIC_CODE_TTL_MINUTES = int(os.environ.get("MAGIC_CODE_TTL_MINUTES", "30"))
MAGIC_CODE_MAX_PER_HOUR = int(os.environ.get("MAGIC_CODE_MAX_PER_HOUR", "5"))

# Admin login rate limit
LOGIN_MAX_FAILURES = int(os.environ.get("LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.environ.get("LOGIN_LOCKOUT_MINUTES", "15"))
_login_attempts: dict[str, dict[str, Any]] = {}  # ip -> {"failures": int, "locked_until": datetime|None}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_lockout(ip: str) -> Optional[int]:
    """Return seconds remaining in lockout, or None if not locked."""
    rec = _login_attempts.get(ip)
    if not rec or not rec.get("locked_until"):
        return None
    now = datetime.now(timezone.utc)
    if rec["locked_until"] > now:
        return int((rec["locked_until"] - now).total_seconds())
    # lockout expired — reset
    _login_attempts.pop(ip, None)
    return None


def _record_failure(ip: str) -> None:
    rec = _login_attempts.setdefault(ip, {"failures": 0, "locked_until": None})
    rec["failures"] += 1
    if rec["failures"] >= LOGIN_MAX_FAILURES:
        rec["locked_until"] = datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        logger.warning("Admin login locked for ip=%s after %d failures", ip, rec["failures"])


def _reset_failures(ip: str) -> None:
    _login_attempts.pop(ip, None)


# Sweep loop task handle (set in lifespan)
_sweep_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _sweep_task
    # Startup: re-seed if no v2 therapists exist
    has_v2 = await db.therapists.count_documents({"source": "seed_v2"})
    if has_v2 == 0:
        await db.therapists.delete_many({"source": {"$in": ["seed", None]}})
        therapists = generate_seed_therapists(100)
        await db.therapists.insert_many([t.copy() for t in therapists])
        logger.info("Re-seeded %d Idaho therapists with v2 schema", len(therapists))
    # Backfill geo coords for therapists missing them (idempotent)
    asyncio.create_task(_backfill_therapist_geo())
    sweep_interval = int(os.environ.get("SWEEP_INTERVAL_SECONDS", "300"))
    _sweep_task = asyncio.create_task(_sweep_loop(sweep_interval))
    logger.info("Started results sweep loop (every %ds)", sweep_interval)
    try:
        yield
    finally:
        if _sweep_task:
            _sweep_task.cancel()
            try:
                await _sweep_task
            except (asyncio.CancelledError, Exception):
                pass
        client.close()


async def _backfill_therapist_geo() -> None:
    """One-shot backfill: geocode any therapist missing office_geos."""
    cursor = db.therapists.find({"office_geos": {"$exists": False}}, {"_id": 0, "id": 1, "office_locations": 1})
    count = 0
    async for doc in cursor:
        geos = await geocode_offices(db, doc.get("office_locations") or [], "ID")
        await db.therapists.update_one({"id": doc["id"]}, {"$set": {"office_geos": geos}})
        count += 1
    if count:
        logger.info("Backfilled office_geos for %d therapists", count)


app = FastAPI(title="TheraVoca API", lifespan=lifespan)
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


class TherapistSignup(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: Optional[str] = ""
    gender: Optional[str] = ""  # female | male | nonbinary
    licensed_states: list[str] = Field(default_factory=lambda: ["ID"])
    client_types: list[str] = Field(default_factory=lambda: ["individual"])
    age_groups: list[str] = Field(default_factory=list)
    primary_specialties: list[str] = Field(default_factory=list, max_length=2)
    secondary_specialties: list[str] = Field(default_factory=list, max_length=3)
    general_treats: list[str] = Field(default_factory=list, max_length=5)
    modalities: list[str] = Field(default_factory=list, max_length=6)
    modality_offering: str = "both"  # telehealth | in_person | both
    office_locations: list[str] = Field(default_factory=list)
    insurance_accepted: list[str] = Field(default_factory=list)
    cash_rate: int = Field(ge=0, le=1000, default=150)
    sliding_scale: bool = False
    years_experience: int = Field(ge=0, le=70, default=1)
    availability_windows: list[str] = Field(default_factory=list)
    urgency_capacity: str = "within_month"
    style_tags: list[str] = Field(default_factory=list)
    free_consult: bool = False
    bio: Optional[str] = ""


class RequestCreate(BaseModel):
    email: EmailStr
    location_state: str
    location_city: Optional[str] = ""
    location_zip: Optional[str] = ""
    client_type: str  # individual | couples | family | group
    age_group: str  # child | teen | young_adult | adult | older_adult
    client_age: Optional[int] = None  # legacy / optional
    payment_type: str = "either"  # insurance | cash | either
    insurance_name: Optional[str] = ""
    budget: Optional[int] = None
    sliding_scale_ok: bool = False
    presenting_issues: list[str] = Field(default_factory=list, max_length=3)
    other_issue: Optional[str] = ""
    availability_windows: list[str] = Field(default_factory=list)
    modality_preference: str = "hybrid"
    urgency: str = "flexible"
    prior_therapy: str = "not_sure"
    prior_therapy_notes: Optional[str] = ""
    experience_preference: str = "no_pref"
    gender_preference: str = "no_pref"
    gender_required: bool = False
    style_preference: list[str] = Field(default_factory=list)
    referral_source: Optional[str] = ""


class RequestOut(BaseModel):
    id: str
    email: str
    client_age: int
    location_state: str
    location_city: Optional[str] = ""
    location_zip: Optional[str] = ""
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
    location_bits = []
    if req.get("location_city"):
        location_bits.append(req["location_city"])
    if req.get("location_zip"):
        location_bits.append(req["location_zip"])
    location_str = ", ".join(location_bits) or "—"
    issues = req.get("presenting_issues") or []
    if isinstance(issues, list):
        issues_display = ", ".join(i.replace("_", " ").title() for i in issues if i)
    else:
        issues_display = str(issues)
    if req.get("other_issue"):
        issues_display = (issues_display + " · " if issues_display else "") + req["other_issue"]
    payment_label = (req.get("payment_type") or "either").title()
    if req.get("payment_type") == "insurance" and req.get("insurance_name"):
        payment_label += f" ({req['insurance_name']})"
    elif req.get("payment_type") == "cash" and req.get("budget"):
        payment_label += f" — up to ${req['budget']}/session"
    avail = req.get("availability_windows") or []
    avail_display = ", ".join(a.replace("_", " ") for a in avail) or "—"
    style = req.get("style_preference") or []
    style_display = ", ".join(s.replace("_", " ") for s in style if s and s != "no_pref") or "—"

    summary = {
        "Client type": (req.get("client_type") or "").title(),
        "Age group": (req.get("age_group") or "").replace("_", " ").title(),
        "State": req.get("location_state"),
        "Location": location_str,
        "Modality preference": (req.get("modality_preference") or "").replace("_", " ").title(),
        "Payment": payment_label,
        "Presenting issues": issues_display or "—",
        "Availability": avail_display,
        "Urgency": (req.get("urgency") or "flexible").replace("_", " ").title(),
        "Prior therapy": (req.get("prior_therapy") or "").replace("_", " ").title(),
        "Style preference": style_display,
    }
    if req.get("prior_therapy") == "yes_not_helped" and req.get("prior_therapy_notes"):
        summary["What didn't work last time"] = req["prior_therapy_notes"]
    return summary


async def _trigger_matching(request_id: str, threshold: Optional[float] = None) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if threshold is None:
        threshold = req.get("threshold", DEFAULT_THRESHOLD)
    therapists_cursor = db.therapists.find(
        {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}}, {"_id": 0}
    )
    therapists = await therapists_cursor.to_list(2000)
    matches = rank_therapists(therapists, req, threshold=threshold, top_n=30, min_results=3)

    # Skip already-notified therapists (idempotent expand)
    already = set(req.get("notified_therapist_ids") or [])
    new_matches = [m for m in matches if m["id"] not in already]

    notified_ids = list(already) + [m["id"] for m in new_matches]
    notified_scores = req.get("notified_scores") or {}
    notified_scores.update({m["id"]: m["match_score"] for m in new_matches})
    notified_distances: dict[str, float] = req.get("notified_distances") or {}
    patient_geo = req.get("patient_geo")
    if patient_geo:
        for m in new_matches:
            offices = m.get("office_geos") or []
            if offices:
                dists = [
                    haversine_miles(patient_geo["lat"], patient_geo["lng"], o["lat"], o["lng"])
                    for o in offices if "lat" in o and "lng" in o
                ]
                if dists:
                    notified_distances[m["id"]] = round(min(dists), 1)

    summary = _safe_summary_for_therapist(req)
    for m in new_matches:
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
            "notified_scores": notified_scores,
            "notified_distances": notified_distances,
            "matched_at": _now_iso(),
            "status": "matched",
        }},
    )
    logger.info(
        "Matched request %s -> notified %d new (total %d) at threshold>=%s",
        request_id, len(new_matches), len(notified_ids), threshold,
    )
    return {
        "notified_new": len(new_matches),
        "notified_total": len(notified_ids),
        "matches": [
            {"id": m["id"], "name": m["name"], "match_score": m["match_score"]}
            for m in new_matches
        ],
    }


async def _deliver_results(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    # Re-rank for patient view: blend match_score with response speed and message thoughtfulness
    matched_at = req.get("matched_at") or req.get("created_at")
    matched_dt = _parse_iso(matched_at) if matched_at else None
    for a in apps:
        ms = float(a.get("match_score") or 0)
        # Response speed bonus: 0–30 pts (the faster after notification, the better)
        speed_bonus = 0.0
        if matched_dt:
            applied_dt = _parse_iso(a.get("created_at") or "")
            if applied_dt:
                hours = max(0.0, (applied_dt - matched_dt).total_seconds() / 3600.0)
                speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))
        # Message-quality bonus: 0–10 pts based on length (cap at 300 chars)
        msg_len = len(a.get("message") or "")
        quality_bonus = min(10.0, msg_len / 300.0 * 10.0)
        a["patient_rank_score"] = round(min(100.0, ms * 0.6 + speed_bonus + quality_bonus), 1)

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            t_view = {
                **t,
                "specialties_display": (t.get("primary_specialties") or [])
                + (t.get("secondary_specialties") or []),
            }
            enriched.append({**a, "therapist": t_view})

    await send_patient_results(req["email"], request_id, enriched)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"results_sent_at": _now_iso(), "status": "completed"}},
    )
    return {"sent_to": req["email"], "count": len(enriched)}


def _parse_iso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


async def _sweep_overdue_results() -> None:
    """Periodic sweep:
    - For requests verified ≥ AUTO_DELAY_HOURS ago with <3 applications, expand pool.
    - For requests verified ≥ AUTO_DELAY_HOURS ago, deliver results to patient.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=AUTO_DELAY_HOURS)
    cutoff_iso = cutoff.isoformat()
    overdue = await db.requests.find(
        {
            "verified": True,
            "results_sent_at": None,
            "verified_at": {"$lte": cutoff_iso},
        },
        {"_id": 0, "id": 1, "email": 1},
    ).to_list(200)
    for req in overdue:
        try:
            # Check application count; if <3, expand pool first (lower threshold)
            app_count = await db.applications.count_documents({"request_id": req["id"]})
            if app_count < 3:
                logger.info("Sweep: expanding pool for %s (apps=%d)", req["id"], app_count)
                await _trigger_matching(req["id"], threshold=60.0)
            logger.info("Sweep: delivering results for %s", req["id"])
            await _deliver_results(req["id"])
        except Exception as e:
            logger.exception("Sweep failed for %s: %s", req["id"], e)


async def _sweep_loop(interval_seconds: int = 300) -> None:
    while True:
        try:
            await _sweep_overdue_results()
        except Exception as e:
            logger.exception("Sweep loop error: %s", e)
        await asyncio.sleep(interval_seconds)


# ─── Public Routes ────────────────────────────────────────────────────────────

@api.get("/")
async def root():
    return {"app": "TheraVoca", "status": "ok"}


@api.post("/requests", response_model=dict)
async def create_request(payload: RequestCreate):
    rid = str(uuid.uuid4())
    token = secrets.token_urlsafe(24)
    # Geocode patient location (ZIP preferred, fallback to city)
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
        # auto delivery of results is handled by the periodic sweep
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
    """Patient view of ranked therapist applications (uses same re-rank as email)."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "verification_token": 0})
    if not req:
        raise HTTPException(404)
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)

    matched_at = req.get("matched_at") or req.get("created_at")
    matched_dt = _parse_iso(matched_at) if matched_at else None
    for a in apps:
        ms = float(a.get("match_score") or 0)
        speed_bonus = 0.0
        if matched_dt:
            applied_dt = _parse_iso(a.get("created_at") or "")
            if applied_dt:
                hours = max(0.0, (applied_dt - matched_dt).total_seconds() / 3600.0)
                speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))
        msg_len = len(a.get("message") or "")
        quality_bonus = min(10.0, msg_len / 300.0 * 10.0)
        a["patient_rank_score"] = round(min(100.0, ms * 0.6 + speed_bonus + quality_bonus), 1)

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            enriched.append({**a, "therapist": t})
    return {"request": req, "applications": enriched}


# ─── Therapist Routes ─────────────────────────────────────────────────────────

@api.post("/therapists/signup", response_model=dict)
async def therapist_signup(payload: TherapistSignup):
    """Public therapist self-signup. Goes into pending_approval queue."""
    existing = await db.therapists.find_one({"email": payload.email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(409, "A therapist with this email already exists.")
    tid = str(uuid.uuid4())
    office_geos = await geocode_offices(db, payload.office_locations or [], "ID")
    data = payload.model_dump()
    data["telehealth"] = data["modality_offering"] in ("telehealth", "both")
    data["offers_in_person"] = data["modality_offering"] in ("in_person", "both")
    doc = {
        "id": tid,
        **data,
        "office_geos": office_geos,
        "source": "signup",
        "is_active": True,
        "pending_approval": True,
        "created_at": _now_iso(),
    }
    await db.therapists.insert_one(doc.copy())
    asyncio.create_task(send_therapist_signup_received(payload.email, payload.name))
    logger.info("New therapist signup: %s (%s) with %d geocoded offices",
                payload.email, tid, len(office_geos))
    return {"id": tid, "status": "pending_approval"}


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


# ─── Magic-link Auth + Portal Routes ──────────────────────────────────────────

class MagicCodeRequest(BaseModel):
    email: EmailStr
    role: str  # "patient" | "therapist"


class MagicCodeVerify(BaseModel):
    email: EmailStr
    role: str
    code: str


def _create_session_token(email: str, role: str) -> str:
    payload = {
        "email": email.lower(),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def require_session(allowed_roles: tuple[str, ...]):
    """Dependency factory that verifies Bearer JWT and matches role."""
    async def _dep(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Missing bearer token")
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "Session expired")
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Invalid session")
        if payload.get("role") not in allowed_roles:
            raise HTTPException(403, "Wrong role for this resource")
        return payload
    return _dep


@api.post("/auth/request-code")
async def auth_request_code(payload: MagicCodeRequest):
    if payload.role not in ("patient", "therapist"):
        raise HTTPException(400, "Invalid role")
    email = payload.email.lower()

    # Rate limit: max 5 codes per email per hour
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.magic_codes.count_documents({
        "email": email, "role": payload.role, "created_at": {"$gte": one_hour_ago}
    })
    if recent >= MAGIC_CODE_MAX_PER_HOUR:
        raise HTTPException(429, "Too many code requests. Try again in an hour.")

    # For therapist role, require an existing approved+active therapist
    if payload.role == "therapist":
        therapist = await db.therapists.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
             "is_active": {"$ne": False},
             "pending_approval": {"$ne": True}},
            {"_id": 0, "id": 1},
        )
        if not therapist:
            # Don't leak whether email exists; respond as success but skip email
            logger.info("Magic-code requested for unknown/pending therapist email=%s", email)
            return {"ok": True}

    code = f"{secrets.randbelow(900000) + 100000:06d}"
    await db.magic_codes.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "role": payload.role,
        "code": code,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=MAGIC_CODE_TTL_MINUTES)).isoformat(),
        "used": False,
        "created_at": _now_iso(),
    })
    asyncio.create_task(send_magic_code(email, code, payload.role))
    return {"ok": True}


@api.post("/auth/verify-code")
async def auth_verify_code(payload: MagicCodeVerify):
    email = payload.email.lower()
    now_iso = _now_iso()
    rec = await db.magic_codes.find_one({
        "email": email,
        "role": payload.role,
        "code": payload.code,
        "used": False,
        "expires_at": {"$gte": now_iso},
    }, {"_id": 0})
    if not rec:
        raise HTTPException(401, "Invalid or expired code")
    await db.magic_codes.update_one({"id": rec["id"]}, {"$set": {"used": True, "used_at": now_iso}})
    token = _create_session_token(email, payload.role)
    return {"token": token, "role": payload.role, "email": email}


@api.get("/portal/me")
async def portal_me(session: dict[str, Any] = Depends(require_session(("patient", "therapist")))):
    return {"email": session["email"], "role": session["role"]}


@api.get("/portal/patient/requests")
async def portal_patient_requests(
    session: dict[str, Any] = Depends(require_session(("patient",))),
):
    docs = await db.requests.find(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "verification_token": 0},
    ).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        app_count = await db.applications.count_documents({"request_id": d["id"]})
        d["application_count"] = app_count
        d["notified_count"] = len(d.get("notified_therapist_ids") or [])
        out.append(d)
    return out


@api.get("/portal/therapist/referrals")
async def portal_therapist_referrals(
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}}, {"_id": 0}
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")

    # All requests where this therapist was notified
    reqs = await db.requests.find(
        {"notified_therapist_ids": therapist["id"]},
        {"_id": 0, "email": 0, "verification_token": 0},
    ).sort("created_at", -1).to_list(100)

    out = []
    for r in reqs:
        score = (r.get("notified_scores") or {}).get(therapist["id"])
        application = await db.applications.find_one(
            {"request_id": r["id"], "therapist_id": therapist["id"]},
            {"_id": 0, "id": 1, "message": 1, "created_at": 1},
        )
        out.append({
            "request_id": r["id"],
            "match_score": score,
            "created_at": r["created_at"],
            "status": r.get("status"),
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
            "presenting_issues_preview": (r.get("presenting_issues") or "")[:140],
            "applied": bool(application),
            "application": application,
        })
    return {
        "therapist": {"id": therapist["id"], "name": therapist["name"], "email": therapist["email"]},
        "referrals": out,
    }


# ─── Admin Routes ─────────────────────────────────────────────────────────────

@api.post("/admin/login")
async def admin_login(payload: dict, request: Request):
    ip = _client_ip(request)
    remaining = _check_lockout(ip)
    if remaining is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {remaining // 60 + 1} minutes.",
        )
    if payload.get("password") != ADMIN_PASSWORD:
        _record_failure(ip)
        rec = _login_attempts.get(ip, {})
        attempts_left = max(0, LOGIN_MAX_FAILURES - rec.get("failures", 0))
        raise HTTPException(
            status_code=401,
            detail=f"Invalid password. {attempts_left} attempt(s) left before lockout.",
        )
    _reset_failures(ip)
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
    notified_distances = req.get("notified_distances") or {}
    notified = []
    for tid in notified_ids:
        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
        if t:
            notified.append({
                "id": t["id"],
                "name": t["name"],
                "email": t["email"],
                "match_score": (req.get("notified_scores") or {}).get(tid, 0),
                "distance_miles": notified_distances.get(tid),
                "office_locations": t.get("office_locations", []),
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
async def admin_list_therapists(
    pending: Optional[bool] = None, _: bool = Depends(require_admin)
):
    query: dict[str, Any] = {}
    if pending is True:
        query["pending_approval"] = True
    elif pending is False:
        query["pending_approval"] = {"$ne": True}
    return await db.therapists.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/admin/therapists/{therapist_id}/approve")
async def admin_approve_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": True, "approved_at": _now_iso()}},
    )
    asyncio.create_task(send_therapist_approved(t["email"], t["name"]))
    return {"id": therapist_id, "status": "approved"}


@api.post("/admin/therapists/{therapist_id}/reject")
async def admin_reject_therapist(therapist_id: str, _: bool = Depends(require_admin)):
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not t:
        raise HTTPException(404)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {"pending_approval": False, "is_active": False, "rejected_at": _now_iso()}},
    )
    return {"id": therapist_id, "status": "rejected"}


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
    pending_therapists = await db.therapists.count_documents({"pending_approval": True})
    apps = await db.applications.count_documents({})
    return {
        "total_requests": total_requests,
        "pending": pending,
        "open": open_,
        "completed": completed,
        "therapists": therapists,
        "pending_therapists": pending_therapists,
        "applications": apps,
        "default_threshold": DEFAULT_THRESHOLD,
    }


# ─── Lifespan registered above; routes follow ────────────────────────────────

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
