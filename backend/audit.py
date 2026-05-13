"""HIPAA audit trail for PHI access events.

Every read of patient data -- whether by admin, therapist, patient, or
background job -- gets a row in the `audit_log` MongoDB collection.

Design rules:
  * NO PHI in the audit log itself. Actors are identified by role-specific
    IDs (therapist tid, HMAC-hashed patient email, literal "admin").
    Resources are identified by UUID. Never email, phone, or clinical text.
  * Fire-and-forget writes via asyncio.create_task() -- an audit failure
    must never slow down or crash a patient-facing request.
  * 7-year TTL index on `ts` (HIPAA requires 6 years; buffer = 7).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from deps import JWT_SECRET, db

logger = logging.getLogger("theravoca.audit")

# 7 years in seconds (365.25 days/yr to account for leap years)
_TTL_SECONDS = int(7 * 365.25 * 24 * 3600)


def _hash_patient_email(email: str) -> str:
    """Produce a stable, non-reversible identifier for a patient email.

    Uses HMAC-SHA256 keyed with JWT_SECRET so:
      - same email always produces the same hash (queryable)
      - attackers cannot brute-force emails without the server secret
    Returns the first 32 hex chars (128 bits) -- sufficient for
    collision resistance while keeping audit rows compact.
    """
    raw = email.strip().lower().encode("utf-8")
    digest = hmac.new(JWT_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return digest[:32]


def _hash_ip(ip: str) -> str:
    """HMAC-hash an IP address before writing it to the audit log.

    Same pattern as `_hash_patient_email`: same IP -> same hash, so
    admin can still group/filter by source, but the value is not
    reversible without JWT_SECRET. Keeps the audit log clean of
    direct identifiers (HIPAA-adjacent + MHMDA-relevant). Forensic
    logging keeps raw IPs separately via uvicorn/Render access logs.
    Empty string in -> empty string out (skip the hash).
    """
    raw = ip.strip()
    if not raw:
        return ""
    digest = hmac.new(JWT_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:32]


async def ensure_indexes() -> None:
    """Create the TTL + query indexes for audit_log. Idempotent."""
    try:
        await db.audit_log.create_index("ts", expireAfterSeconds=_TTL_SECONDS)
        await db.audit_log.create_index("actor_id")
        await db.audit_log.create_index("resource_id")
        await db.audit_log.create_index("action")
    except Exception as e:
        logger.warning("audit_log index setup failed: %s", e)


async def log_access(
    *,
    actor_type: str,
    actor_id: str,
    action: str,
    resource: str,
    resource_id: str | None = None,
    ip: str = "",
    user_agent: str = "",
    detail: str = "",
) -> None:
    """Write a single audit entry. Call from route handlers and cron jobs.

    Parameters
    ----------
    actor_type : "admin" | "therapist" | "patient" | "anonymous" | "system"
    actor_id   : therapist tid, _hash_patient_email() output, "admin", or
                 "cron". Never a raw email or phone.
    action     : verb describing the access -- e.g. "view_request",
                 "list_requests", "apply", "decline".
    resource   : noun -- "request", "therapist", "patient_list".
    resource_id: the UUID of the specific record accessed, or None for
                 list/aggregate endpoints.
    ip         : client IP from X-Forwarded-For (empty for system actors).
    user_agent : request User-Agent header (empty for system actors).
    detail     : optional short context -- e.g. "count=500", "projection=full".
    """
    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
        "actor_type": actor_type,
        "actor_id": actor_id,
        "action": action,
        "resource": resource,
    }
    if resource_id:
        entry["resource_id"] = resource_id
    if ip:
        entry["ip"] = _hash_ip(ip)
    if user_agent:
        entry["user_agent"] = user_agent
    if detail:
        entry["detail"] = detail

    try:
        await db.audit_log.insert_one(entry)
    except Exception as e:
        logger.warning("Failed to write audit entry: %s", e)


def emit(
    *,
    actor_type: str,
    actor_id: str,
    action: str,
    resource: str,
    resource_id: str | None = None,
    ip: str = "",
    user_agent: str = "",
    detail: str = "",
) -> None:
    """Fire-and-forget wrapper around log_access().

    Safe to call from sync or async context -- schedules the write on
    the running event loop without awaiting it. Swallows errors so the
    caller is never affected by audit failures.
    """
    try:
        asyncio.create_task(
            log_access(
                actor_type=actor_type,
                actor_id=actor_id,
                action=action,
                resource=resource,
                resource_id=resource_id,
                ip=ip,
                user_agent=user_agent,
                detail=detail,
            )
        )
    except RuntimeError:
        # No running event loop (e.g. called from a sync test).
        logger.debug("No event loop for audit emit -- skipping")
