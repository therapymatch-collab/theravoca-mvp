"""Iter-48 backend tests — outreach opt-out link flow.

Verifies:
  - POST-hoc opt-out URL is reachable without auth
  - Clicking the URL persists an opt-out row (by email AND phone)
  - `_filter_existing_contacts` excludes opted-out candidates on next run
  - Admin can list opt-outs
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_opt_out_records_email_and_phone():
    """Direct unit test of the opt-out helper — no HTTP."""
    from outreach_optout import record_opt_out, is_opted_out

    email = f"optout_{uuid.uuid4().hex[:8]}@example.com"
    phone = "(208) 555-0199"

    async def go():
        r = await record_opt_out(email=email, phone=phone, reason="not_a_fit",
                                  source="unit_test")
        assert r["ok"] is True
        assert r["email"] == email.lower()
        assert r["phone"].startswith("+1")
        assert await is_opted_out(email=email) is True
        # phone match also works
        assert await is_opted_out(phone=phone) is True
        # re-record is idempotent
        r2 = await record_opt_out(email=email, phone=phone, source="unit_test")
        assert r2["ok"] is True

    _run(go())


def test_opt_out_public_endpoint_marks_invite():
    """End-to-end: create an invite row, hit the public opt-out link,
    verify the opt-out record exists and the invite is flagged."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")

    # Create a synthetic invite row directly via a dedicated admin seed path —
    # we piggyback the admin list endpoint first to ensure the backend has
    # the collection created, then drop a row via motor.
    from deps import db

    async def seed_invite():
        inv_id = f"test-inv-{uuid.uuid4().hex[:8]}"
        email = f"optoutlink_{uuid.uuid4().hex[:6]}@example.com"
        phone = f"+1208555{uuid.uuid4().int % 10000:04d}"
        await db.outreach_invites.insert_one({
            "id": inv_id,
            "request_id": "test-req-noop",
            "candidate": {"name": "Test Person", "email": email, "phone": phone},
            "email_sent": True,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        return inv_id, email, phone

    inv_id, email, phone = _run(seed_invite())

    # Hit the public opt-out URL — no auth header
    r = requests.get(f"{BASE_URL}/api/outreach/opt-out/{inv_id}", timeout=15)
    assert r.status_code == 200
    assert "unsubscribed" in r.text.lower() or "You're unsubscribed" in r.text
    assert "TheraVoca" in r.text

    # Verify the opt-out row exists
    r2 = requests.get(
        f"{BASE_URL}/api/admin/outreach/opt-outs",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=15,
    )
    assert r2.status_code == 200
    entries = r2.json().get("opt_outs") or []
    matched = [e for e in entries if e.get("email") == email.lower()]
    assert len(matched) == 1, f"Expected 1 opt-out for {email}, got {len(matched)}"
    assert matched[0].get("last_invite_id") == inv_id
    assert matched[0].get("last_source") == "outreach_email_link"

    # Verify the invite itself is flagged
    async def check_invite():
        doc = await db.outreach_invites.find_one({"id": inv_id}, {"_id": 0})
        assert doc is not None
        assert doc.get("opted_out_at") is not None
    _run(check_invite())


def test_invalid_invite_id_returns_404():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(
        f"{BASE_URL}/api/outreach/opt-out/does-not-exist-{uuid.uuid4().hex}",
        timeout=15,
    )
    assert r.status_code == 404
    assert "couldn't process" in r.text.lower() or "couldn" in r.text.lower()


def test_filter_existing_contacts_drops_opted_out():
    """After opt-out, the outreach dedupe drops that candidate too."""
    from outreach_optout import record_opt_out
    from outreach_agent import _filter_existing_contacts

    email = f"dedupe_optout_{uuid.uuid4().hex[:8]}@example.com"
    phone_raw = "(208) 555-0777"

    async def go():
        await record_opt_out(email=email, phone=phone_raw, source="unit_test")
        cands = [
            {"name": "Opted Out Therapist", "email": email, "phone": phone_raw},
            {"name": "Still Valid", "email": f"valid_{uuid.uuid4().hex[:6]}@example.com"},
        ]
        kept, stats = await _filter_existing_contacts(cands)
        kept_names = [c["name"] for c in kept]
        assert "Opted Out Therapist" not in kept_names
        assert "Still Valid" in kept_names
        assert stats.get("skipped_opted_out", 0) >= 1

    _run(go())
