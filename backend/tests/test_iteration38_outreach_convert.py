"""Iter-38: Admin can convert an LLM outreach invite into a draft therapist
profile via POST /api/admin/outreach/{invite_id}/convert.

Validates:
1. A fresh invite converts → creates a therapist with `signup_status="invited"`,
   `pending_approval=True`, `is_active=False`, carrying name/email/license.
2. The invite row is flagged `status="converted"` and gets `converted_therapist_id`.
3. Re-converting the same invite returns 409.
4. Converting an invite whose email already maps to an existing therapist fails 409.
5. Unknown invite id returns 404.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
# Backend .env doesn't have REACT_APP_BACKEND_URL; pull from frontend .env.
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env", override=False)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def _seed_invite(email: str, name: str = "Casey Outreach, LCSW") -> str:
    """Insert a synthetic outreach_invites row and return its id."""

    async def _go():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            invite_id = str(uuid.uuid4())
            await db.outreach_invites.insert_one({
                "id": invite_id,
                "request_id": str(uuid.uuid4()),
                "candidate": {
                    "name": name,
                    "email": email,
                    "license_type": "LCSW",
                    "specialties": ["anxiety", "trauma_ptsd"],
                    "modalities": ["EMDR", "CBT"],
                    "city": "Boise",
                    "state": "ID",
                    "match_rationale": "Strong trauma-informed fit",
                    "estimated_score": 88,
                },
                "email_sent": True,
                "created_at": "2026-02-01T00:00:00+00:00",
            })
            return invite_id
        finally:
            client.close()

    return asyncio.get_event_loop().run_until_complete(_go())


def _fetch_therapist(tid: str) -> dict | None:
    async def _go():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            return await db.therapists.find_one({"id": tid}, {"_id": 0})
        finally:
            client.close()
    return asyncio.get_event_loop().run_until_complete(_go())


def _fetch_invite(invite_id: str) -> dict | None:
    async def _go():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            return await db.outreach_invites.find_one({"id": invite_id}, {"_id": 0})
        finally:
            client.close()
    return asyncio.get_event_loop().run_until_complete(_go())


def _cleanup(emails: list[str], invite_ids: list[str]):
    async def _go():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            await db.therapists.delete_many({"email": {"$in": emails}})
            await db.outreach_invites.delete_many({"id": {"$in": invite_ids}})
        finally:
            client.close()
    asyncio.get_event_loop().run_until_complete(_go())


def test_convert_invite_creates_draft_therapist():
    email = f"convert_ok_{int(time.time() * 1000)}@example.com"
    invite_id = _seed_invite(email)
    try:
        res = requests.post(
            f"{API}/admin/outreach/{invite_id}/convert",
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True
        assert body["status"] == "invited"
        tid = body["therapist_id"]

        t = _fetch_therapist(tid)
        assert t is not None
        assert t["email"] == email
        assert t["source"] == "invited"
        assert t["signup_status"] == "invited"
        assert t["pending_approval"] is True
        assert t["is_active"] is False
        assert t["credential_type"] == "LCSW"
        assert t["licensed_states"] == ["ID"]
        assert "anxiety" in t["primary_specialties"]
        assert "EMDR" in t["modalities"]
        assert t["office_locations"] == ["Boise"]
        assert t["outreach_invite_id"] == invite_id

        inv = _fetch_invite(invite_id)
        assert inv["status"] == "converted"
        assert inv["converted_therapist_id"] == tid
        assert inv.get("converted_at")
    finally:
        _cleanup([email], [invite_id])


def test_convert_twice_returns_409():
    email = f"convert_twice_{int(time.time() * 1000)}@example.com"
    invite_id = _seed_invite(email)
    try:
        first = requests.post(
            f"{API}/admin/outreach/{invite_id}/convert",
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert first.status_code == 200
        second = requests.post(
            f"{API}/admin/outreach/{invite_id}/convert",
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert second.status_code == 409, second.text
        assert "Already converted" in second.json()["detail"]
    finally:
        _cleanup([email], [invite_id])


def test_convert_existing_therapist_email_returns_409():
    """If the candidate email already exists in `therapists`, conversion fails."""
    email = f"convert_dup_{int(time.time() * 1000)}@example.com"
    invite_id = _seed_invite(email)

    async def _seed_pre_existing():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            await db.therapists.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Existing T, LCSW",
                "email": email,
                "is_active": True,
                "pending_approval": False,
                "created_at": "2026-01-01T00:00:00+00:00",
            })
        finally:
            client.close()
    asyncio.get_event_loop().run_until_complete(_seed_pre_existing())

    try:
        res = requests.post(
            f"{API}/admin/outreach/{invite_id}/convert",
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert res.status_code == 409, res.text
        assert "already exists" in res.json()["detail"]
    finally:
        _cleanup([email], [invite_id])


def test_convert_unknown_invite_returns_404():
    res = requests.post(
        f"{API}/admin/outreach/{uuid.uuid4()}/convert",
        headers=ADMIN_HEADERS, timeout=15,
    )
    assert res.status_code == 404, res.text
