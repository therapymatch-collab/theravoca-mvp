"""Iter-60 backend tests:
1) FAQ admin CRUD + reorder + seed + public list (Task 3)
2) auto-decline-duplicates returns fast + uses chunked sender (Task 2)
3) /therapists/{id}/sync-payment-method returns session_token (Task 5)
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")
ADMIN_HDR = {"X-Admin-Password": ADMIN_PW}


# ─── FAQ tests ──────────────────────────────────────────────────────
class TestFaqs:
    def test_seed_idempotent(self):
        r = requests.post(f"{BASE_URL}/api/admin/faqs/seed", headers=ADMIN_HDR)
        assert r.status_code == 200
        # second call should not error and should seed 0 (already populated)
        r2 = requests.post(f"{BASE_URL}/api/admin/faqs/seed", headers=ADMIN_HDR)
        assert r2.status_code == 200
        body2 = r2.json().get("seeded", {})
        assert body2.get("patient", 0) == 0
        assert body2.get("therapist", 0) == 0

    def test_public_list_patient(self):
        r = requests.get(f"{BASE_URL}/api/faqs", params={"audience": "patient"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        assert len(items) >= 1
        for it in items:
            assert "q" in it and "a" in it

    def test_public_list_invalid_audience(self):
        r = requests.get(f"{BASE_URL}/api/faqs", params={"audience": "alien"})
        assert r.status_code == 400

    def test_admin_list_filter(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/faqs",
            headers=ADMIN_HDR,
            params={"audience": "therapist"},
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        for it in items:
            assert it["audience"] == "therapist"
            assert "id" in it

    def test_create_update_delete_flow(self):
        # CREATE
        unique_q = f"TEST_q_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/faqs",
            headers=ADMIN_HDR,
            json={
                "audience": "patient",
                "question": unique_q,
                "answer": "TEST_a",
                "published": True,
            },
        )
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        fid = item["id"]
        assert item["question"] == unique_q
        assert item["audience"] == "patient"
        assert "_id" not in item
        assert isinstance(item["position"], int)

        # GET via admin list — verify persistence
        r2 = requests.get(
            f"{BASE_URL}/api/admin/faqs",
            headers=ADMIN_HDR,
            params={"audience": "patient"},
        )
        ids = [i["id"] for i in r2.json()["items"]]
        assert fid in ids

        # UPDATE
        r3 = requests.put(
            f"{BASE_URL}/api/admin/faqs/{fid}",
            headers=ADMIN_HDR,
            json={"answer": "TEST_a_updated", "published": False},
        )
        assert r3.status_code == 200
        assert r3.json()["item"]["answer"] == "TEST_a_updated"
        assert r3.json()["item"]["published"] is False

        # public list should NOT include this unpublished row
        pub = requests.get(
            f"{BASE_URL}/api/faqs", params={"audience": "patient"}
        ).json()["items"]
        assert all(p["q"] != unique_q for p in pub), "unpublished row leaked publicly"

        # DELETE
        r4 = requests.delete(
            f"{BASE_URL}/api/admin/faqs/{fid}", headers=ADMIN_HDR
        )
        assert r4.status_code == 200
        assert r4.json()["deleted"] == 1

        # Update missing -> 404
        r5 = requests.put(
            f"{BASE_URL}/api/admin/faqs/{fid}",
            headers=ADMIN_HDR,
            json={"answer": "x"},
        )
        assert r5.status_code == 404

    def test_reorder(self):
        # Create 2 rows then reorder
        ids = []
        for i in range(2):
            r = requests.post(
                f"{BASE_URL}/api/admin/faqs",
                headers=ADMIN_HDR,
                json={
                    "audience": "patient",
                    "question": f"TEST_reorder_{i}_{uuid.uuid4().hex[:6]}",
                    "answer": "a",
                },
            )
            assert r.status_code == 200
            ids.append(r.json()["item"]["id"])

        # Reorder reversed
        rev = list(reversed(ids))
        r = requests.put(
            f"{BASE_URL}/api/admin/faqs/reorder",
            headers=ADMIN_HDR,
            json={"audience": "patient", "ids": rev},
        )
        assert r.status_code == 200
        assert r.json()["reordered"] == 2

        # Verify positions persisted
        listing = requests.get(
            f"{BASE_URL}/api/admin/faqs",
            headers=ADMIN_HDR,
            params={"audience": "patient"},
        ).json()["items"]
        by_id = {i["id"]: i for i in listing}
        # rev[0] should now have a smaller position than rev[1]
        assert by_id[rev[0]]["position"] < by_id[rev[1]]["position"]

        # Cleanup
        for fid in ids:
            requests.delete(f"{BASE_URL}/api/admin/faqs/{fid}", headers=ADMIN_HDR)

    def test_admin_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/faqs")
        assert r.status_code in (401, 403)


# ─── Auto-decline chunked send test (Task 2) ────────────────────────
class TestAutoDeclineChunked:
    def test_dry_run_fast(self):
        t0 = time.perf_counter()
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/auto-decline-duplicates",
            headers=ADMIN_HDR,
            json={"dry_run": True},
        )
        elapsed = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert "matched" in body
        assert "preview" in body
        # The endpoint should respond quickly (no email sends in dry_run).
        # Generous 5s ceiling to account for network + value-tag aggregation.
        assert elapsed < 5.0, f"dry-run too slow: {elapsed:.2f}s"

    def test_chunked_send_function_exists(self):
        """Source-level check: confirm _chunked_send is wrapped in a SINGLE
        asyncio.create_task call (not one per email)."""
        with open("/app/backend/routes/admin.py", "r") as f:
            src = f.read()
        assert "_chunked_send" in src
        assert "asyncio.create_task(_chunked_send(targets))" in src
        # Ensure chunk size + delay constants are present
        assert "CHUNK = 10" in src
        assert "DELAY_S = 1.1" in src


# ─── Sync payment method returns session_token (Task 5) ─────────────
class TestSyncPaymentReturnsSessionToken:
    def test_sync_demo_returns_session_token(self):
        # Create a throwaway therapist to call sync on
        signup_email = f"TEST_sync_{uuid.uuid4().hex[:8]}@example.com"
        signup = {
            "name": "TEST Sync User",
            "email": signup_email,
            "phone": "+12085551212",
            "credential_type": "LCSW",
            "license_number": "LCSW-TEST",
            "license_expires_at": "2030-12-31",
            "licensed_states": ["ID"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": [],
            "general_treats": [],
            "modalities": ["CBT"],
            "modality_offering": "telehealth",
            "office_locations": [],
            "office_addresses": [],
            "insurance_accepted": [],
            "cash_rate": 100,
            "sliding_scale": False,
            "free_consult": False,
            "years_experience": 5,
            "age_groups": ["adult"],
            "client_types": ["individual"],
            "availability_windows": [],
            "urgency_capacity": False,
            "style_tags": [],
            "bio": "test",
            "gender": "female",
            "notify_email": True,
            "notify_sms": False,
        }
        r = requests.post(f"{BASE_URL}/api/therapists/signup", json=signup)
        if r.status_code == 422:
            pytest.skip(f"Signup payload schema mismatch: {r.text[:200]}")
        if r.status_code == 409:
            pytest.skip("email collision")
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]

        # Call sync-payment-method with a demo session_id
        r2 = requests.post(
            f"{BASE_URL}/api/therapists/{tid}/sync-payment-method",
            json={"session_id": f"demo_{uuid.uuid4().hex[:8]}"},
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("ok") is True
        assert body.get("subscription_status") == "trialing"
        assert "session_token" in body
        token = body["session_token"]
        assert isinstance(token, str) and len(token) > 20, "session_token missing/short"

        # Cleanup — admin update to mark inactive (no hard delete endpoint).
        requests.put(
            f"{BASE_URL}/api/admin/therapists/{tid}",
            headers=ADMIN_HDR,
            json={"is_active": False},
        )
