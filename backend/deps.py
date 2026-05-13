"""Shared dependencies, db connection, env constants, auth deps."""
from __future__ import annotations

import hmac as _hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import jwt
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, Request, status
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env", override=True)

logger = logging.getLogger("theravoca")

# ─── Mongo ────────────────────────────────────────────────────────────────────
# Enforce TLS in production. PHI in transit between the API and Mongo
# Atlas must be encrypted under HIPAA's Technical Safeguards.
# Accept either:
#   • `mongodb+srv://...` (Atlas standard, TLS implicit)
#   • A `mongodb://...` URI that includes `tls=true` / `ssl=true`
# In production we refuse to start with a non-TLS URI; in dev we just
# warn so local Mongo (mongodb://localhost) still works.
_mongo_url = os.environ["MONGO_URL"]
_env_for_mongo = os.environ.get("ENV", "development").lower()
_mongo_uses_tls = (
    _mongo_url.startswith("mongodb+srv://")
    or "tls=true" in _mongo_url
    or "ssl=true" in _mongo_url
)
if _env_for_mongo == "production" and not _mongo_uses_tls:
    raise RuntimeError(
        "FATAL: MONGO_URL is not TLS-encrypted. "
        "Production requires mongodb+srv:// or a URI with tls=true. "
        "Refusing to start so PHI doesn't traverse the network in plaintext."
    )
if not _mongo_uses_tls:
    logging.getLogger("theravoca").warning(
        "MONGO_URL has no TLS -- OK for local dev, NEVER for production."
    )
mongo_client = AsyncIOMotorClient(_mongo_url)
db = mongo_client[os.environ["DB_NAME"]]


# ─── Env-driven constants ────────────────────────────────────────────────────
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    raise RuntimeError(
        "FATAL: ADMIN_PASSWORD environment variable is not set. "
        "Refusing to start with no admin password."
    )
DEFAULT_THRESHOLD = float(os.environ.get("DEFAULT_MATCH_THRESHOLD", "80"))
MIN_TARGET_MATCHES = int(os.environ.get("MIN_TARGET_MATCHES", "30"))
AUTO_DELAY_HOURS = float(os.environ.get("AUTO_RESULTS_DELAY_HOURS", "24"))
PATIENT_DEMO_EMAIL = os.environ.get("PATIENT_DEMO_EMAIL", "")
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", "therapymatch@gmail.com")

LICENSE_WARN_DAYS = int(os.environ.get("LICENSE_WARN_DAYS", "30"))
# Configurable via app_config.availability_prompt_days in admin.
# Default: Monday only (0). Override with comma-separated day numbers (0=Mon..6=Sun).
_avail_days_env = os.environ.get("AVAILABILITY_PROMPT_DAYS", "0")
AVAILABILITY_PROMPT_DAYS = tuple(int(d.strip()) for d in _avail_days_env.split(",") if d.strip().isdigit())
DAILY_TASK_HOUR_LOCAL = int(os.environ.get("DAILY_TASK_HOUR", "2"))
DAILY_TASK_TZ_OFFSET_HOURS = int(os.environ.get("DAILY_TASK_TZ_OFFSET", "-7"))

# Phase 2 patient surveys: v2 cron only sends for requests whose
# results_sent_at >= this date. v1 cron only sends for requests
# whose results_sent_at < this date. Override via env for staging tests.
PHASE_2_LAUNCH_DATE = os.environ.get("PHASE_2_LAUNCH_DATE", "2026-05-15")

_ENV = os.environ.get("ENV", "development").lower()
_jwt_secret_raw = os.environ.get("JWT_SECRET", "")
if not _jwt_secret_raw and _ENV == "production":
    raise RuntimeError(
        "FATAL: JWT_SECRET environment variable is not set. "
        "Sessions will not persist across deploys. Refusing to start."
    )
if not _jwt_secret_raw:
    _jwt_secret_raw = secrets.token_urlsafe(48)
    logger.warning(
        "JWT_SECRET not set — using random ephemeral secret. "
        "All sessions will be lost on next restart. Set JWT_SECRET env var to fix."
    )
# A short JWT secret is brute-forceable. 32 chars of entropy is the
# floor; 48+ is recommended. Enforce in production only -- dev can
# use short throwaway values.
if _ENV == "production" and len(_jwt_secret_raw) < 32:
    raise RuntimeError(
        "FATAL: JWT_SECRET is too short. Production requires at least "
        "32 characters of entropy. Generate one with `python -c "
        "'import secrets; print(secrets.token_urlsafe(48))'`."
    )
JWT_SECRET = _jwt_secret_raw
JWT_ALGO = "HS256"

# -- Email service: RESEND_API_KEY + PUBLIC_APP_URL are required in
# production. Without them, patient intake is silently broken (emails
# never send, links have no domain).
_resend_key = os.environ.get("RESEND_API_KEY", "").strip()
_public_url = os.environ.get("PUBLIC_APP_URL", "").strip()
if _ENV == "production":
    if not _resend_key:
        raise RuntimeError(
            "RESEND_API_KEY must be set in production -- "
            "without it, verification emails will never send"
        )
    if not _public_url:
        raise RuntimeError(
            "PUBLIC_APP_URL must be set in production -- "
            "without it, all email links will be broken"
        )
else:
    if not _resend_key:
        logger.warning("RESEND_API_KEY not set -- emails will be skipped")
    if not _public_url:
        logger.warning("PUBLIC_APP_URL not set -- email links will have no domain")
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
# Admin sessions get a much tighter TTL (HIPAA hygiene): an attacker who
# steals an admin token has at most this many hours of access. Default
# 8 hours mirrors a typical workday. Override via ADMIN_SESSION_TTL_HOURS.
ADMIN_SESSION_TTL_HOURS = int(os.environ.get("ADMIN_SESSION_TTL_HOURS", "8"))
MAGIC_CODE_TTL_MINUTES = int(os.environ.get("MAGIC_CODE_TTL_MINUTES", "30"))
MAGIC_CODE_MAX_PER_HOUR = int(os.environ.get("MAGIC_CODE_MAX_PER_HOUR", "5"))

LOGIN_MAX_FAILURES = int(os.environ.get("LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCKOUT_MINUTES = int(os.environ.get("LOGIN_LOCKOUT_MINUTES", "15"))


# ─── Admin login lockout (in-memory) ─────────────────────────────────────────
_login_attempts: dict[str, dict[str, Any]] = {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_lockout(ip: str) -> Optional[int]:
    rec = _login_attempts.get(ip)
    if not rec or not rec.get("locked_until"):
        return None
    now = datetime.now(timezone.utc)
    if rec["locked_until"] > now:
        return int((rec["locked_until"] - now).total_seconds())
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


# ─── Auth deps ───────────────────────────────────────────────────────────────
def require_admin(
    x_admin_password: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
) -> bool:
    """Admin authentication accepts EITHER:
      • the legacy `X-Admin-Password` header (matches `ADMIN_PASSWORD` env), OR
      • a Bearer JWT with role=admin (issued by /admin/login-with-email when
        a team member signs in with email + password).
    """
    if x_admin_password and _hmac.compare_digest(
        x_admin_password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")
    ):
        return True
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            payload = None
        if payload and payload.get("role") == "admin":
            return True
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials")


def _create_session_token(email: str, role: str) -> str:
    # Admin tokens get a much shorter TTL than patient/therapist tokens
    # so a stolen admin token has limited blast radius (HIPAA hygiene).
    if role == "admin":
        exp = datetime.now(timezone.utc) + timedelta(hours=ADMIN_SESSION_TTL_HOURS)
    else:
        exp = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    payload = {
        "email": email.lower(),
        "role": role,
        "exp": exp,
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


def _decode_session_from_authorization(authorization: Optional[str]) -> Optional[dict[str, Any]]:
    """Soft session decoder — returns None instead of raising when missing
    or invalid. Used for endpoints that accept multiple auth modes."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


# Re-export Depends for convenience
__all__ = [
    "Depends", "HTTPException", "Header", "Request",
    "db", "logger",
    "ADMIN_PASSWORD", "DEFAULT_THRESHOLD", "AUTO_DELAY_HOURS", "PATIENT_DEMO_EMAIL",
    "ADMIN_NOTIFY_EMAIL", "LICENSE_WARN_DAYS", "AVAILABILITY_PROMPT_DAYS",
    "DAILY_TASK_HOUR_LOCAL", "DAILY_TASK_TZ_OFFSET_HOURS", "PHASE_2_LAUNCH_DATE",
    "JWT_SECRET", "JWT_ALGO", "SESSION_TTL_DAYS", "ADMIN_SESSION_TTL_HOURS",
    "MAGIC_CODE_TTL_MINUTES",
    "MAGIC_CODE_MAX_PER_HOUR", "LOGIN_MAX_FAILURES", "LOGIN_LOCKOUT_MINUTES",
    "_login_attempts", "_client_ip", "_check_lockout", "_record_failure", "_reset_failures",
    "require_admin", "require_session", "_create_session_token",
    "_decode_session_from_authorization",
]
