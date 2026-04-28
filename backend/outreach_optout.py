"""Opt-out management for recruitment outreach.

Every outreach email + SMS embeds a one-click opt-out URL (unguessable,
scoped to the original invite). When a recipient clicks it we persist their
email and/or phone into `outreach_opt_outs` so `outreach_agent` never emails
or texts them again — across all future patient requests.

Records in `outreach_opt_outs` are keyed by normalized email (lowercased)
and/or E.164 phone. We keep both when available so a therapist who opts
out via email is also skipped if their phone later shows up in a PT scrape.
"""
from __future__ import annotations

import logging
from typing import Optional

from deps import db
from sms_service import normalize_us_phone

logger = logging.getLogger("theravoca.opt_out")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def record_opt_out(
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    reason: Optional[str] = None,
    source: str = "outreach_email_link",
    invite_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> dict:
    """Persist an opt-out. Idempotent — upserts on (email, phone) so clicking
    the link twice doesn't create duplicate rows. Returns the stored doc."""
    email_norm = (email or "").strip().lower() or None
    phone_norm = normalize_us_phone(phone or "") if phone else None

    if not email_norm and not phone_norm:
        return {"ok": False, "error": "no_contact_info"}

    # Build a match query to upsert against
    or_clauses = []
    if email_norm:
        or_clauses.append({"email": email_norm})
    if phone_norm:
        or_clauses.append({"phone": phone_norm})
    match = {"$or": or_clauses}

    update = {
        "$set": {
            "email": email_norm,
            "phone": phone_norm,
            "last_source": source,
            "last_reason": reason,
            "last_invite_id": invite_id,
            "last_request_id": request_id,
            "last_opted_out_at": _now_iso(),
        },
        "$setOnInsert": {
            "created_at": _now_iso(),
        },
    }
    await db.outreach_opt_outs.update_one(match, update, upsert=True)
    logger.info(
        "Recorded outreach opt-out: email=%s phone=%s source=%s",
        email_norm, phone_norm, source,
    )
    return {"ok": True, "email": email_norm, "phone": phone_norm}


async def is_opted_out(*, email: Optional[str] = None, phone: Optional[str] = None) -> bool:
    email_norm = (email or "").strip().lower() or None
    phone_norm = normalize_us_phone(phone or "") if phone else None
    if not email_norm and not phone_norm:
        return False
    or_clauses = []
    if email_norm:
        or_clauses.append({"email": email_norm})
    if phone_norm:
        or_clauses.append({"phone": phone_norm})
    doc = await db.outreach_opt_outs.find_one({"$or": or_clauses}, {"_id": 1})
    return doc is not None


async def get_opted_out_set(
    emails: list[str], phones: list[str],
) -> tuple[set[str], set[str]]:
    """Return `(opted_out_emails, opted_out_phones)` — subsets of the inputs
    that are already in the opt-out list. Used by `_filter_existing_contacts`
    to drop candidates in bulk without per-row round-trips."""
    emails_norm = [e.strip().lower() for e in emails if e]
    phones_norm = [normalize_us_phone(p) for p in phones if p]
    phones_norm = [p for p in phones_norm if p]
    if not emails_norm and not phones_norm:
        return set(), set()
    or_clauses = []
    if emails_norm:
        or_clauses.append({"email": {"$in": emails_norm}})
    if phones_norm:
        or_clauses.append({"phone": {"$in": phones_norm}})
    cur = db.outreach_opt_outs.find({"$or": or_clauses}, {"_id": 0, "email": 1, "phone": 1})
    out_emails: set[str] = set()
    out_phones: set[str] = set()
    async for d in cur:
        if d.get("email"):
            out_emails.add(d["email"])
        if d.get("phone"):
            out_phones.add(d["phone"])
    return out_emails, out_phones
