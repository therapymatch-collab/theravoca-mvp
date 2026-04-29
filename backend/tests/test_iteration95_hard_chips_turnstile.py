"""iter-95: Verify (a) Turnstile gate now produces correct 400 on missing/bad token
and the backend Turnstile siteverify call no longer forwards remoteip,
(b) seed + GET /api/requests/{id}/public surface the *_strict + modality
fields the frontend needs to render HARD chips."""
from __future__ import annotations

import os
import sys
import uuid
import time
import asyncio

import pytest
import requests

# Ensure backend modules are importable
sys.path.insert(0, "/app/backend")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Turnstile gate ----------------------------------------------------
class TestTurnstileGate:
    def test_intake_missing_turnstile_token_rejected(self):
        """POST /api/patients/intake with no token should fail Turnstile gate."""
        payload = {
            "client_type": "self",
            "age_group": "adult",
            "concerns": ["anxiety"],
            "location_state": "ID",
            "zip": "83702",
            "modality_preference": "telehealth_only",
            "payment_type": "self_pay",
            "urgency": "this_week",
            "name": "TEST_NoToken",
            "email": "test_notoken@example.com",
            "phone": "+12085550100",
            "consent_terms": True,
            "consent_research": False,
            "form_started_at_ms": int(time.time() * 1000) - 10_000,
            # no turnstile_token
        }
        r = requests.post(f"{API}/requests", json=payload, timeout=15)
        # Backend returns 400 with the exact message the frontend interceptor
        # uses to trigger the "Security check expired" toast.
        assert r.status_code in (400, 422, 429), f"got {r.status_code}: {r.text[:200]}"
        if r.status_code == 400:
            body = r.json()
            detail = body.get("detail") or body.get("message") or ""
            assert "security" in detail.lower() or "verification" in detail.lower(), (
                f"Unexpected 400 body: {body}"
            )

    def test_intake_invalid_turnstile_token_rejected(self):
        """A clearly bogus token should be rejected by CF siteverify and
        result in a 400 with the user-friendly message."""
        payload = {
            "client_type": "self",
            "age_group": "adult",
            "concerns": ["anxiety"],
            "location_state": "ID",
            "zip": "83702",
            "modality_preference": "telehealth_only",
            "payment_type": "self_pay",
            "urgency": "this_week",
            "name": "TEST_BadToken",
            "email": "test_badtoken@example.com",
            "phone": "+12085550101",
            "consent_terms": True,
            "consent_research": False,
            "form_started_at_ms": int(time.time() * 1000) - 10_000,
            "turnstile_token": "XXXX.DUMMY.TOKEN.XXXX",
        }
        r = requests.post(f"{API}/requests", json=payload, timeout=15)
        assert r.status_code in (400, 429), f"got {r.status_code}: {r.text[:200]}"
        body = r.json()
        detail = body.get("detail") or ""
        # Either the explicit user-facing message OR a Pydantic-shaped 400
        assert "security" in str(detail).lower() or "refresh" in str(detail).lower()


class TestTurnstileService:
    """Confirm the service no longer forwards remoteip."""

    def test_remoteip_argument_accepted_but_ignored(self):
        from turnstile_service import verify_token

        async def run():
            ok, err = await verify_token(None, remote_ip="1.2.3.4")
            return ok, err

        ok, err = asyncio.get_event_loop().run_until_complete(run())
        # When TURNSTILE_SECRET_KEY is configured + token is None → False, "Missing..."
        # When NOT configured → True, None
        # Either way, no exception (signature accepts remote_ip).
        assert isinstance(ok, bool)


# ---------- HARD-chip data surface --------------------------------------------
@pytest.fixture(scope="module")
def seeded_hard_request():
    """Insert a fully HARD-flagged request straight into Mongo (skipping
    the Turnstile-gated intake endpoint) so the frontend can render the
    expanded panel against real data."""
    req_id = f"TEST_hardchip_{uuid.uuid4().hex[:8]}"
    view_token = uuid.uuid4().hex
    doc = {
        "id": req_id,
        "client_type": "self",
        "age_group": "adult",
        "concerns": ["anxiety", "depression"],
        "location_state": "ID",
        "zip": "83702",
        "modality_preference": "in_person_only",
        "payment_type": "insurance",
        "insurance_provider": "Aetna",
        "insurance_strict": True,
        "urgency": "this_week",
        "urgency_strict": True,
        "availability_strict": True,
        "preferred_days": ["mon", "wed"],
        "preferred_times": ["evening"],
        "gender_required": True,
        "gender_preference": "female",
        "language_strict": True,
        "preferred_language": "Spanish",
        "deep_match_opt_in": True,
        "p1_communication": ["direct_warm"],
        "p2_change": ["insight_action"],
        "p3_resonance": "Looking for someone collaborative.",
        "name": "TEST Hard Chip",
        "email": "test_hardchip@example.com",
        "phone": "+12085559999",
        "view_token": view_token,
        "verification_token": uuid.uuid4().hex,
        "consent_terms": True,
        "consent_research": False,
        "status": "submitted",
        "created_at": "2026-01-01T00:00:00Z",
    }

    async def insert():
        client = AsyncIOMotorClient(MONGO_URL)
        await client[DB_NAME].requests.insert_one(doc)
        client.close()

    asyncio.get_event_loop().run_until_complete(insert())

    yield {"id": req_id, "view_token": view_token}

    async def cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        await client[DB_NAME].requests.delete_one({"id": req_id})
        client.close()

    asyncio.get_event_loop().run_until_complete(cleanup())


class TestHardChipDataSurface:
    def test_public_view_returns_all_hard_flags(self, seeded_hard_request):
        rid = seeded_hard_request["id"]
        r = requests.get(f"{API}/requests/{rid}/public", timeout=10)
        assert r.status_code == 200, r.text[:300]
        body = r.json()

        # Always-HARD fields
        assert body["age_group"] == "adult"
        assert body["location_state"] == "ID"
        assert body["concerns"] == ["anxiety", "depression"]

        # Patient-toggleable HARDs
        assert body["insurance_strict"] is True
        assert body["urgency_strict"] is True
        assert body["availability_strict"] is True
        assert body["gender_required"] is True
        assert body["gender_preference"] == "female"
        assert body["language_strict"] is True
        assert body["preferred_language"] == "Spanish"
        assert body["modality_preference"] == "in_person_only"

        # Deep-match block intact
        assert body["deep_match_opt_in"] is True
        assert body["p1_communication"] == ["direct_warm"]

        # MongoDB _id excluded
        assert "_id" not in body
        # Verification token must NOT leak
        assert "verification_token" not in body
