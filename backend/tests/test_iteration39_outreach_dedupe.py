"""Iter-39: outreach agent must skip candidates whose email already exists in
our `therapists` directory or in any prior `outreach_invites` row.

This is a pure unit-style test against `_filter_existing_emails` — it doesn't
hit the LLM or the FastAPI app, only Mongo via the same async client the agent uses."""
from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def _has_db() -> bool:
    return bool(os.environ.get("MONGO_URL")) and bool(os.environ.get("DB_NAME"))


pytestmark = pytest.mark.skipif(not _has_db(), reason="DB not configured")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_filter_drops_existing_therapist_email():
    """A candidate whose email matches an existing therapist (case-insensitive)
    is filtered out."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from deps import db
    from outreach_agent import _filter_existing_emails

    seeded_email = f"existing_{uuid.uuid4().hex[:8]}@example.com"
    seeded_id = str(uuid.uuid4())

    async def go():
        await db.therapists.insert_one({
            "id": seeded_id, "name": "Existing T", "email": seeded_email,
            "is_active": True, "pending_approval": False,
        })
        try:
            cands = [
                # Same email as existing therapist, but uppercased — should be dropped.
                {"name": "Dup", "email": seeded_email.upper()},
                {"name": "Fresh", "email": f"fresh_{uuid.uuid4().hex[:8]}@example.com"},
            ]
            kept, stats = await _filter_existing_emails(cands)
            assert len(kept) == 1
            assert kept[0]["name"] == "Fresh"
            assert stats["skipped_existing_therapist"] == 1
            assert stats["skipped_prior_invite"] == 0
        finally:
            await db.therapists.delete_one({"id": seeded_id})

    _run(go())


def test_filter_drops_prior_invite_email():
    """A candidate whose email shows up in `outreach_invites` (any past request)
    is filtered out."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from deps import db
    from outreach_agent import _filter_existing_emails

    prior_email = f"prior_{uuid.uuid4().hex[:8]}@example.com"
    invite_id = str(uuid.uuid4())

    async def go():
        await db.outreach_invites.insert_one({
            "id": invite_id,
            "request_id": str(uuid.uuid4()),
            "candidate": {"name": "Prior", "email": prior_email},
            "email_sent": True,
            "created_at": "2026-02-01T00:00:00+00:00",
        })
        try:
            cands = [
                {"name": "ReDup", "email": prior_email},
                {"name": "Fresh2", "email": f"fresh2_{uuid.uuid4().hex[:8]}@example.com"},
            ]
            kept, stats = await _filter_existing_emails(cands)
            assert len(kept) == 1
            assert kept[0]["name"] == "Fresh2"
            assert stats["skipped_prior_invite"] == 1
            assert stats["skipped_existing_therapist"] == 0
        finally:
            await db.outreach_invites.delete_one({"id": invite_id})

    _run(go())


def test_filter_handles_empty_and_missing_emails():
    """Candidates with no email are dropped silently; empty input returns empty."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from outreach_agent import _filter_existing_emails

    async def go():
        kept, stats = await _filter_existing_emails([])
        assert kept == []
        assert stats == {"skipped_existing_therapist": 0, "skipped_prior_invite": 0}

        kept2, _ = await _filter_existing_emails([
            {"name": "no email"},
            {"name": "blank", "email": ""},
            {"name": "valid", "email": f"valid_{uuid.uuid4().hex[:8]}@example.com"},
        ])
        assert len(kept2) == 1
        assert kept2[0]["name"] == "valid"

    _run(go())
