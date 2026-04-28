"""Shared dependencies, db connection, env constants, auth deps."""
from __future__ import annotations

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
mongo_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = mongo_client[os.environ["DB_NAME"]]


# ─── Env-driven constants ────────────────────────────────────────────────────
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")
DEFAULT_THRESHOLD = float(os.environ.get("DEFAULT_MATCH_THRESHOLD", "70"))
MIN_TARGET_MATCHES = int(os.environ.get("MIN_TARGET_MATCHES", "30"))
AUTO_DELAY_HOURS = float(os.environ.get("AUTO_RESULTS_DELAY_HOURS", "24"))
PATIENT_DEMO_EMAIL = os.environ.get("PATIENT_DEMO_EMAIL", "")
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", "therapymatch@gmail.com")

LICENSE_WARN_DAYS = int(os.environ.get("LICENSE_WARN_DAYS", "30"))
AVAILABILITY_PROMPT_DAYS = (0, 4)  # Mon, Fri
DAILY_TASK_HOUR_LOCAL = int(os.environ.get("DAILY_TASK_HOUR", "2"))
DAILY_TASK_TZ_OFFSET_HOURS = int(os.environ.get("DAILY_TASK_TZ_OFFSET", "-7"))

JWT_SECRET = os.environ.get("JWT_SECRET", "") or secrets.token_urlsafe(48)
JWT_ALGO = "HS256"
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
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
def require_admin(x_admin_password: Optional[str] = Header(None)) -> bool:
    if not x_admin_password or x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin password")
    return True


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
    "DAILY_TASK_HOUR_LOCAL", "DAILY_TASK_TZ_OFFSET_HOURS",
    "JWT_SECRET", "JWT_ALGO", "SESSION_TTL_DAYS", "MAGIC_CODE_TTL_MINUTES",
    "MAGIC_CODE_MAX_PER_HOUR", "LOGIN_MAX_FAILURES", "LOGIN_LOCKOUT_MINUTES",
    "_login_attempts", "_client_ip", "_check_lockout", "_record_failure", "_reset_failures",
    "require_admin", "require_session", "_create_session_token",
    "_decode_session_from_authorization",
]
