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
    send_availability_prompt,
    send_license_expiring_to_admin,
    send_license_expiring_to_therapist,
    send_magic_code,
    send_patient_results,
    send_therapist_approved,
    send_therapist_notification,
    send_therapist_signup_received,
    send_verification_email,
)
from email_templates import DEFAULTS as EMAIL_TEMPLATE_DEFAULTS, list_templates, upsert_template
from geocoding import geocode_city, geocode_offices, geocode_zip, haversine_miles
from matching import rank_therapists
from seed_data import generate_seed_therapists
from sms_service import send_availability_prompt_sms, send_sms, send_therapist_referral_sms
import stripe_service

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

# Admin alert inbox (license expiry, etc.)
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", "therapymatch@gmail.com")

# Daily-billing + license + availability cron
LICENSE_WARN_DAYS = int(os.environ.get("LICENSE_WARN_DAYS", "30"))
AVAILABILITY_PROMPT_DAYS = (0, 4)  # 0=Monday, 4=Friday (Python weekday())
DAILY_TASK_HOUR_LOCAL = int(os.environ.get("DAILY_TASK_HOUR", "2"))  # 2 AM
DAILY_TASK_TZ_OFFSET_HOURS = int(os.environ.get("DAILY_TASK_TZ_OFFSET", "-7"))  # MT (MDT=-6, MST=-7); user-approved 2am MT

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
_daily_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _sweep_task, _daily_task
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
    _daily_task = asyncio.create_task(_daily_loop())
    logger.info("Started results sweep loop (every %ds) + daily-task scheduler", sweep_interval)
    try:
        yield
    finally:
        for t in (_sweep_task, _daily_task):
            if t:
                t.cancel()
                try:
                    await t
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
    phone: Optional[str] = ""  # legacy alias for phone_alert
    phone_alert: Optional[str] = ""  # private — SMS alerts
    office_phone: Optional[str] = ""  # public — visible to patients
    gender: Optional[str] = ""
    licensed_states: list[str] = Field(default_factory=lambda: ["ID"])
    license_number: Optional[str] = ""
    license_expires_at: Optional[str] = None  # ISO date
    license_picture: Optional[str] = None  # base64 data URL
    client_types: list[str] = Field(default_factory=lambda: ["individual"])
    age_groups: list[str] = Field(default_factory=list)
    primary_specialties: list[str] = Field(default_factory=list, max_length=2)
    secondary_specialties: list[str] = Field(default_factory=list, max_length=3)
    general_treats: list[str] = Field(default_factory=list, max_length=5)
    modalities: list[str] = Field(default_factory=list, max_length=6)
    modality_offering: str = "both"
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
    profile_picture: Optional[str] = None
    credential_type: Optional[str] = ""
    notify_email: bool = True
    notify_sms: bool = True


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
    modality_preferences: list[str] = Field(default_factory=list)  # CBT, DBT, EMDR, etc.
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
    message: str = Field(default="", max_length=1500)


class TherapistDeclineIn(BaseModel):
    reason_codes: list[str] = Field(default_factory=list, max_length=6)
    notes: str = Field(default="", max_length=500)


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

def _now_iso() -> str:    return datetime.now(timezone.utc).isoformat()


def _ts_to_iso(ts: Optional[int]) -> Optional[str]:
    """Convert a Stripe Unix timestamp to ISO8601, or None."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


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
        payment_label = f"Insurance — {req['insurance_name']}"
    elif req.get("payment_type") == "cash":
        if req.get("budget"):
            payment_label = f"Cash — up to ${req['budget']}/session"
        if req.get("sliding_scale_ok"):
            payment_label += " (open to sliding scale)"
    elif req.get("payment_type") == "either":
        bits = []
        if req.get("insurance_name"):
            bits.append(f"Insurance: {req['insurance_name']}")
        if req.get("budget"):
            bits.append(f"Cash up to ${req['budget']}")
        if req.get("sliding_scale_ok"):
            bits.append("open to sliding scale")
        if bits:
            payment_label = "Either — " + " · ".join(bits)
    avail = req.get("availability_windows") or []
    avail_display = ", ".join(a.replace("_", " ") for a in avail) or "—"
    style = req.get("style_preference") or []
    style_display = ", ".join(s.replace("_", " ") for s in style if s and s != "no_pref") or "—"
    modality_prefs = req.get("modality_preferences") or []
    modality_prefs_display = ", ".join(modality_prefs) if modality_prefs else "—"

    summary = {
        "Client type": (req.get("client_type") or "").title(),
        "Age group": (req.get("age_group") or "").replace("_", " ").title(),
        "State": req.get("location_state"),
        "Location": location_str,
        "Session format": (req.get("modality_preference") or "").replace("_", " ").title(),
        "Payment": payment_label,
        "Presenting issues": issues_display or "—",
        "Preferred therapy approach": modality_prefs_display,
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
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            # Suspend matching for therapists whose card payment failed or whose
            # subscription was canceled. Trialing + active + legacy_free still match.
            "subscription_status": {"$nin": ["past_due", "canceled", "unpaid", "incomplete"]},
        }, {"_id": 0},
    )
    therapists = await therapists_cursor.to_list(2000)
    matches = rank_therapists(therapists, req, threshold=threshold, top_n=30, min_results=3)

    # Skip already-notified therapists (idempotent expand)
    already = set(req.get("notified_therapist_ids") or [])
    new_matches = [m for m in matches if m["id"] not in already]

    notified_ids = list(already) + [m["id"] for m in new_matches]
    notified_scores = req.get("notified_scores") or {}
    notified_scores.update({m["id"]: m["match_score"] for m in new_matches})
    notified_breakdowns: dict[str, dict] = req.get("notified_breakdowns") or {}
    notified_breakdowns.update({m["id"]: m.get("match_breakdown") or {} for m in new_matches})
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
    public_url = os.environ.get("PUBLIC_APP_URL", "")
    for m in new_matches:
        # Respect therapist notification preferences (default both on)
        notify_email = m.get("notify_email", True)
        notify_sms = m.get("notify_sms", True)
        if notify_email:
            await send_therapist_notification(
                to=m["email"],
                therapist_name=m["name"].split(",")[0],
                request_id=req["id"],
                therapist_id=m["id"],
                match_score=m["match_score"],
                summary=summary,
            )
        # Best-effort SMS — does not block matching if it fails or is disabled
        phone = m.get("phone") or ""
        if phone and notify_sms:
            apply_url = f"{public_url}/therapist/apply/{req['id']}/{m['id']}"
            try:
                await send_therapist_referral_sms(
                    to=phone,
                    therapist_first_name=m["name"].split(",")[0],
                    match_score=m["match_score"],
                    apply_url=apply_url,
                )
            except Exception as e:
                logger.warning("SMS send failed for therapist %s: %s", m["id"], e)

    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "notified_therapist_ids": notified_ids,
            "notified_scores": notified_scores,
            "notified_breakdowns": notified_breakdowns,
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
    breakdowns = req.get("notified_breakdowns") or {}
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            t_view = {
                **t,
                "specialties_display": (t.get("primary_specialties") or [])
                + (t.get("secondary_specialties") or []),
            }
            enriched.append({
                **a,
                "therapist": t_view,
                "match_breakdown": breakdowns.get(a["therapist_id"]) or {},
            })

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


# ─── Daily cron tasks (billing, license expiry, availability prompt) ─────────

def _now_local() -> datetime:
    """Return 'wall clock' for the configured Mountain-Time office hour rule."""
    return datetime.now(timezone.utc) + timedelta(hours=DAILY_TASK_TZ_OFFSET_HOURS)


async def _run_daily_billing_charges() -> dict[str, int]:
    """Charge therapists whose billing period has ended."""
    now = datetime.now(timezone.utc)
    cur = db.therapists.find(
        {
            "subscription_status": {"$in": ["trialing", "active"]},
            "stripe_customer_id": {"$ne": None},
            "current_period_end": {"$ne": None, "$lte": now.isoformat()},
        },
        {"_id": 0, "id": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1,
         "subscription_status": 1, "name": 1, "email": 1},
    )
    charged = 0
    failed = 0
    async for t in cur:
        res = stripe_service.charge_monthly_fee(
            customer_id=t["stripe_customer_id"],
            payment_method_id=t.get("stripe_payment_method_id"),
        )
        if res.get("error"):
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"subscription_status": "past_due", "updated_at": _now_iso()}},
            )
            logger.warning("Daily billing: %s charge failed (%s)", t.get("email"), res.get("error"))
            failed += 1
            continue
        next_period = now + timedelta(days=30)
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {
                "subscription_status": "active",
                "current_period_end": next_period.isoformat(),
                "trial_ends_at": None,
                "last_charged_at": _now_iso(),
                "updated_at": _now_iso(),
            }},
        )
        charged += 1
    if charged or failed:
        logger.info("Daily billing: charged=%d failed=%d", charged, failed)
    return {"charged": charged, "failed": failed}


async def _run_license_expiry_alerts() -> dict[str, int]:
    """30 days before license expires: email both therapist + admin (idempotent)."""
    now = datetime.now(timezone.utc)
    cur = db.therapists.find(
        {
            "license_expires_at": {"$exists": True, "$ne": None},
            "is_active": {"$ne": False},
            "license_warn_30_sent_at": {"$exists": False},
        },
        {"_id": 0, "id": 1, "name": 1, "email": 1, "license_expires_at": 1},
    )
    sent = 0
    async for t in cur:
        # Compare ISO dates (drop time component)
        try:
            exp_str = (t.get("license_expires_at") or "")[:10]
            exp_dt = datetime.fromisoformat(exp_str + "T00:00:00+00:00")
        except Exception:
            continue
        days = (exp_dt - now).days
        if days > LICENSE_WARN_DAYS or days < 0:
            continue
        await send_license_expiring_to_therapist(
            t["email"], t["name"], exp_str, days,
        )
        if ADMIN_NOTIFY_EMAIL:
            await send_license_expiring_to_admin(
                ADMIN_NOTIFY_EMAIL, t["name"], t["email"], exp_str, days,
            )
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {"license_warn_30_sent_at": _now_iso()}},
        )
        sent += 1
    if sent:
        logger.info("License expiry alerts sent: %d", sent)
    return {"sent": sent}


async def _run_availability_prompts() -> dict[str, int]:
    """Mon/Fri prompt to therapists asking them to refresh availability."""
    local = _now_local()
    if local.weekday() not in AVAILABILITY_PROMPT_DAYS:
        return {"sent": 0, "reason": "not Mon/Fri"}
    today_iso = local.date().isoformat()
    cur = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["canceled", "rejected"]},
            "$or": [
                {"availability_prompt_sent_date": {"$ne": today_iso}},
                {"availability_prompt_sent_date": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1,
         "phone_alert": 1, "notify_email": 1, "notify_sms": 1},
    )
    sent_email = 0
    sent_sms = 0
    public_url = os.environ.get("PUBLIC_APP_URL", "")
    portal_url = f"{public_url}/portal/therapist"
    async for t in cur:
        if t.get("notify_email", True):
            try:
                await send_availability_prompt(t["email"], t["name"])
                sent_email += 1
            except Exception as e:
                logger.warning("Availability email failed for %s: %s", t.get("email"), e)
        sms_to = t.get("phone_alert") or t.get("phone") or ""
        if sms_to and t.get("notify_sms", True):
            try:
                await send_availability_prompt_sms(sms_to, t["name"], portal_url)
                sent_sms += 1
            except Exception as e:
                logger.warning("Availability SMS failed for %s: %s", t.get("email"), e)
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {
                "availability_prompt_sent_date": today_iso,
                "availability_prompt_pending": True,
            }},
        )
    if sent_email or sent_sms:
        logger.info("Availability prompts sent: email=%d sms=%d", sent_email, sent_sms)
    return {"sent_email": sent_email, "sent_sms": sent_sms}


async def _daily_loop() -> None:
    """Runs once a day at the configured local hour. Naively wakes every 30
    minutes and only triggers when local-time hour == DAILY_TASK_HOUR_LOCAL
    AND we haven't already run today (tracked in `cron_runs` collection)."""
    while True:
        try:
            local = _now_local()
            today_iso = local.date().isoformat()
            if local.hour == DAILY_TASK_HOUR_LOCAL:
                rec = await db.cron_runs.find_one(
                    {"name": "daily_tasks", "date": today_iso}, {"_id": 0}
                )
                if not rec:
                    logger.info("Running daily tasks for %s", today_iso)
                    await db.cron_runs.insert_one(
                        {"name": "daily_tasks", "date": today_iso, "started_at": _now_iso()}
                    )
                    bill = await _run_daily_billing_charges()
                    lic = await _run_license_expiry_alerts()
                    avail = await _run_availability_prompts()
                    await db.cron_runs.update_one(
                        {"name": "daily_tasks", "date": today_iso},
                        {"$set": {
                            "completed_at": _now_iso(),
                            "billing": bill, "license": lic, "availability": avail,
                        }},
                    )
        except Exception as e:
            logger.exception("Daily-loop error: %s", e)
        await asyncio.sleep(1800)  # 30 min


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


@api.post("/admin/requests/{request_id}/release-results")
async def admin_release_results(request_id: str, _: bool = Depends(require_admin)):
    """Manually release the 24h hold on patient results — used for testing or
    when the admin decides enough therapists have responded."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    if not req:
        raise HTTPException(404)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"results_released_at": _now_iso()}},
    )
    return {"ok": True, "released_at": _now_iso()}


@api.get("/therapist/{therapist_id}/referrals")
async def therapist_referrals(therapist_id: str):
    """List of all referrals this therapist was notified for, with their status
    (interested / declined / pending). Replaces the email-only workflow."""
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if not t:
        raise HTTPException(404)

    # Find requests where this therapist was notified
    cur = db.requests.find(
        {"notified_therapist_ids": therapist_id},
        {"_id": 0, "verification_token": 0},
    ).sort("matched_at", -1).limit(100)
    requests_list = await cur.to_list(100)

    # Get applications + declines for this therapist
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
            status = "interested"
        elif rid in declines:
            status = "declined"
        else:
            status = "pending"
        out.append({
            "request_id": rid,
            "matched_at": r.get("matched_at"),
            "patient_email_anon": (r.get("email", "")[:3] + "***") if r.get("email") else "",
            "match_score": score,
            "match_breakdown": breakdown,
            "status": status,
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
        })
    return {"therapist": t, "referrals": out}


@api.get("/requests/{request_id}/results", response_model=dict)
async def public_request_results(request_id: str):
    """Patient view of ranked therapist applications (uses same re-rank as email).

    Iter-13: Patient cannot see therapist responses for the first 24h after matching
    OR until admin manually releases via POST /admin/requests/{id}/release-results.
    The hold prevents premature contact with therapists who might not be the best
    matches once all responses are in. We still record application timing for
    matching-algo tuning.
    """
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "verification_token": 0})
    if not req:
        raise HTTPException(404)
    apps_raw = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)

    # Determine if we're still inside the 24h hold window
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

    apps = apps_raw if not hold_active else []  # hide individual apps but keep count

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
        "subscription_status": "incomplete",  # set to 'trialing' once Checkout completes
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": None,
        "current_period_end": None,
        "created_at": _now_iso(),
    }
    await db.therapists.insert_one(doc.copy())
    asyncio.create_task(send_therapist_signup_received(payload.email, payload.name))
    logger.info("New therapist signup: %s (%s) with %d geocoded offices",
                payload.email, tid, len(office_geos))
    return {"id": tid, "status": "pending_approval"}


@api.post("/therapists/{therapist_id}/subscribe-checkout")
async def therapist_subscribe_checkout(therapist_id: str):
    """Return a Stripe Checkout URL for the therapist to add a card.

    DEMO MODE: When STRIPE_API_KEY=sk_test_emergent (the Emergent shared proxy),
    the resulting checkout.stripe.com URL is not actually reachable because the
    proxy's session objects are sandboxed away from real Stripe. We return a
    `demo_mode=true` flag so the frontend can fast-forward the flow by calling
    /sync-payment-method with a synthesized session_id. Switch to a real
    `sk_test_xxx` key to enable the full hosted Checkout experience.
    """
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


@api.post("/therapists/{therapist_id}/sync-payment-method")
async def therapist_sync_payment_method(therapist_id: str, payload: dict):
    """Called by the frontend after Stripe Checkout success — pulls the
    setup session from Stripe and stores customer_id + payment_method_id +
    starts the 30-day trial clock.

    DEMO MODE: When session_id starts with 'demo_' (frontend fast-forward
    around the proxy's unreachable hosted page), we synthesize a customer
    + payment method and start the trial directly."""
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
    return {
        "ok": True,
        "subscription_status": "trialing",
        "trial_ends_at": trial_end.isoformat(),
        "demo_mode": is_demo,
    }


@api.post("/therapists/{therapist_id}/portal-session")
async def therapist_portal_session(therapist_id: str):
    """Return a Stripe Customer Portal URL so the therapist can manage their
    payment method, view invoices, or cancel."""
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


@api.get("/therapists/{therapist_id}/subscription")
async def therapist_subscription_status(therapist_id: str):
    """Read subscription state for a single therapist."""
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "subscription_status": 1, "trial_ends_at": 1,
         "current_period_end": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1},
    )
    if not t:
        raise HTTPException(404)
    return t


@api.post("/admin/therapists/{therapist_id}/charge-now")
async def admin_charge_therapist_now(
    therapist_id: str, _: bool = Depends(require_admin)
):
    """Admin manual trigger to charge the therapist their $45 monthly fee.
    Used for testing the recurring flow + as fallback if cron fails."""
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
        # Mark past_due so matching is suspended
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


@api.post("/stripe/webhook")
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
    obj = (event.get("data") or {}).get("object") if isinstance(event, dict) else event.data.object
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
            sub = stripe_service.retrieve_subscription(sub_id) or {}
            await _set({
                "stripe_customer_id": cust,
                "stripe_subscription_id": sub_id,
                "subscription_status": sub.get("status") or "trialing",
                "trial_ends_at": _ts_to_iso(sub.get("trial_end")),
                "current_period_end": _ts_to_iso(sub.get("current_period_end")),
            })
    elif etype in ("customer.subscription.updated", "customer.subscription.created", "customer.subscription.deleted"):
        sub_id = obj.get("id")
        # Map back to therapist via metadata or customer id
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
        t_match = await db.therapists.find_one({"stripe_customer_id": cust_id}, {"_id": 0, "id": 1})
        if t_match:
            tid = t_match["id"]
            await _set({"subscription_status": "past_due"})
    return {"received": True, "type": etype}


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


@api.post("/therapist/decline/{request_id}/{therapist_id}", response_model=dict)
async def therapist_decline(
    request_id: str, therapist_id: str, payload: TherapistDeclineIn
):
    """Therapist declines a referral. Stored separately from applications,
    used to learn matching weaknesses + suppress this pair from re-notification."""
    req = await db.requests.find_one({"id": request_id}, {"_id": 0, "id": 1})
    therapist = await db.therapists.find_one({"id": therapist_id}, {"_id": 0, "id": 1, "email": 1})
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id) if req else None
    # Allow even if not in notified_scores — admin may be testing
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
        decline = await db.declines.find_one(
            {"request_id": r["id"], "therapist_id": therapist["id"]},
            {"_id": 0},
        )
        if application:
            ref_status = "interested"
        elif decline:
            ref_status = "declined"
        else:
            ref_status = "pending"
        out.append({
            "request_id": r["id"],
            "match_score": score,
            "created_at": r["created_at"],
            "status": r.get("status"),
            "referral_status": ref_status,
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
            "presenting_issues_preview": (r.get("presenting_issues") or "")[:140],
            "applied": bool(application),
            "application": application,
            "declined": bool(decline),
        })
    return {
        "therapist": {
            "id": therapist["id"],
            "name": therapist["name"],
            "email": therapist["email"],
            "phone": therapist.get("phone"),
            "phone_alert": therapist.get("phone_alert"),
            "office_phone": therapist.get("office_phone"),
            "credential_type": therapist.get("credential_type"),
            "license_number": therapist.get("license_number"),
            "license_expires_at": therapist.get("license_expires_at"),
            "license_picture": therapist.get("license_picture"),
            "primary_specialties": therapist.get("primary_specialties", []),
            "secondary_specialties": therapist.get("secondary_specialties", []),
            "general_treats": therapist.get("general_treats", []),
            "modalities": therapist.get("modalities", []),
            "modality_offering": therapist.get("modality_offering"),
            "office_locations": therapist.get("office_locations", []),
            "insurance_accepted": therapist.get("insurance_accepted", []),
            "cash_rate": therapist.get("cash_rate"),
            "sliding_scale": therapist.get("sliding_scale"),
            "free_consult": therapist.get("free_consult"),
            "years_experience": therapist.get("years_experience"),
            "availability_windows": therapist.get("availability_windows", []),
            "urgency_capacity": therapist.get("urgency_capacity"),
            "style_tags": therapist.get("style_tags", []),
            "bio": therapist.get("bio"),
            "profile_picture": therapist.get("profile_picture"),
            "pending_approval": bool(therapist.get("pending_approval")),
            "is_active": therapist.get("is_active", True),
            "availability_prompt_pending": bool(therapist.get("availability_prompt_pending")),
            "last_availability_update_at": therapist.get("last_availability_update_at"),
        },
        "referrals": out,
    }


@api.post("/portal/therapist/availability-confirm")
async def portal_therapist_availability_confirm(
    payload: Optional[dict] = None,
    session: dict[str, Any] = Depends(require_session(("therapist",))),
):
    """Therapist confirms their availability is current, optionally updating
    `availability_windows` if they want to change it."""
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")
    update: dict[str, Any] = {
        "availability_prompt_pending": False,
        "last_availability_update_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    if payload and isinstance(payload.get("availability_windows"), list):
        update["availability_windows"] = [
            str(x) for x in payload["availability_windows"] if x
        ][:10]
    if payload and payload.get("urgency_capacity"):
        update["urgency_capacity"] = str(payload["urgency_capacity"])[:50]
    await db.therapists.update_one({"id": therapist["id"]}, {"$set": update})
    return {"ok": True, "updated": list(update.keys())}


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


@api.put("/admin/therapists/{therapist_id}")
async def admin_update_therapist(
    therapist_id: str, payload: dict, _: bool = Depends(require_admin)
):
    """Admin update of a therapist profile. Only whitelisted fields are persisted."""
    allowed = {
        "name", "email", "phone", "phone_alert", "office_phone",
        "gender", "licensed_states",
        "license_number", "license_expires_at", "license_picture",
        "client_types", "age_groups",
        "primary_specialties", "secondary_specialties", "general_treats",
        "modalities", "modality_offering", "office_locations",
        "insurance_accepted", "cash_rate", "sliding_scale", "free_consult",
        "years_experience", "availability_windows", "urgency_capacity",
        "style_tags", "bio", "is_active", "pending_approval",
        "profile_picture", "credential_type", "notify_email", "notify_sms",
        "next_7_day_capacity", "responsiveness_score", "top_responder",
    }
    update = {k: v for k, v in (payload or {}).items() if k in allowed}
    if not update:
        raise HTTPException(400, "No editable fields provided")
    update["updated_at"] = _now_iso()
    res = await db.therapists.update_one({"id": therapist_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Therapist not found")
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    return {"ok": True, "therapist": t}


@api.post("/admin/test-sms")
async def admin_test_sms(payload: dict, _: bool = Depends(require_admin)):
    """Send a quick verification SMS to the configured Twilio override (or a custom 'to')."""
    to = (payload or {}).get("to") or os.environ.get("TWILIO_DEV_OVERRIDE_TO", "")
    body = (payload or {}).get("body") or "TheraVoca: SMS smoke test — your Twilio integration is wired up."
    if not to:
        raise HTTPException(400, "No recipient and no TWILIO_DEV_OVERRIDE_TO env set")
    result = await send_sms(to, body)
    if not result:
        return {"ok": False, "detail": "SMS send returned no result (check TWILIO_ENABLED + creds + logs)"}
    return {"ok": True, **result}


@api.get("/admin/email-templates")
async def admin_list_email_templates(_: bool = Depends(require_admin)):
    return await list_templates(db)


@api.put("/admin/email-templates/{key}")
async def admin_update_email_template(
    key: str, payload: dict, _: bool = Depends(require_admin)
):
    if key not in EMAIL_TEMPLATE_DEFAULTS:
        raise HTTPException(404, f"Unknown template key: {key}")
    return await upsert_template(db, key, payload or {})


@api.get("/admin/declines")
async def admin_list_declines(_: bool = Depends(require_admin)):
    """Recent therapist declines + reason aggregation (for matching algo tuning)."""
    declines = await db.declines.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # aggregate reason_code counts
    counts: dict[str, int] = {}
    for d in declines:
        for code in d.get("reason_codes") or []:
            counts[code] = counts.get(code, 0) + 1
    return {"declines": declines, "reason_counts": counts}


@api.post("/admin/backfill-therapists")
async def admin_backfill_therapists(_: bool = Depends(require_admin)):
    """One-shot completion of every therapist record with realistic fake data.
    Idempotent: only fills missing fields, never overwrites existing values
    (except the email, which is forced to therapymatch+tNNN@gmail.com so the
    user's verified inbox receives every transactional email)."""
    from backfill import backfill_therapist
    cur = db.therapists.find({}, {"_id": 0}).sort("created_at", 1)
    therapists = await cur.to_list(length=10_000)
    updated = 0
    for idx, t in enumerate(therapists, 1):
        set_fields = backfill_therapist(t, idx)
        if set_fields:
            set_fields["updated_at"] = _now_iso()
            await db.therapists.update_one(
                {"id": t["id"]}, {"$set": set_fields}
            )
            updated += 1
    return {"ok": True, "scanned": len(therapists), "updated": updated}


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


@api.post("/admin/run-daily-tasks")
async def admin_run_daily_tasks(_: bool = Depends(require_admin)):
    """Manual trigger for the daily cron — useful for testing without waiting
    until 2am MT. Idempotent thanks to per-task tracking flags."""
    bill = await _run_daily_billing_charges()
    lic = await _run_license_expiry_alerts()
    avail = await _run_availability_prompts()
    return {"ok": True, "billing": bill, "license": lic, "availability": avail}


# ─── Lifespan registered above; routes follow ────────────────────────────────

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
