"""Iteration-58 backend tests:
- /api/site-copy public GET
- /api/admin/site-copy admin GET / PUT / DELETE
- /api/admin/therapists/auto-decline-duplicates dry_run + (no real run, leaves data intact)

Uses admin master password from backend/.env (admin123!).
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://match-engine-test-1.preview.emergentagent.com").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD})
    return s


# ── Site copy ────────────────────────────────────────────────────────
class TestSiteCopy:
    def test_public_get_site_copy_ok(self):
        r = requests.get(f"{BASE_URL}/api/site-copy", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_admin_list_site_copy_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/site-copy", timeout=10)
        assert r.status_code in (401, 403)

    def test_admin_list_site_copy_ok(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/site-copy", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "rows" in body
        assert isinstance(body["rows"], list)

    def test_upsert_get_delete_round_trip(self, admin_session):
        key = f"test.iter58.{uuid.uuid4().hex[:8]}"
        value = "Hello from iter-58 backend test"

        # PUT (upsert)
        r = admin_session.put(
            f"{BASE_URL}/api/admin/site-copy",
            json={"key": key, "value": value},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["key"] == key
        assert body["value"] == value

        # public GET should now include override
        r = requests.get(f"{BASE_URL}/api/site-copy", timeout=10)
        assert r.status_code == 200
        assert r.json().get(key) == value

        # update again (idempotent)
        new_value = value + " (updated)"
        r = admin_session.put(
            f"{BASE_URL}/api/admin/site-copy",
            json={"key": key, "value": new_value},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["value"] == new_value

        # admin GET sees row
        r = admin_session.get(f"{BASE_URL}/api/admin/site-copy", timeout=10)
        assert r.status_code == 200
        keys_in_admin = {row["key"] for row in r.json()["rows"]}
        assert key in keys_in_admin

        # DELETE
        r = admin_session.delete(f"{BASE_URL}/api/admin/site-copy/{key}", timeout=10)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1

        # public GET no longer has key
        r = requests.get(f"{BASE_URL}/api/site-copy", timeout=10)
        assert key not in r.json()

    def test_put_validation(self, admin_session):
        # missing key/value → 422 (pydantic) or 400
        r = admin_session.put(
            f"{BASE_URL}/api/admin/site-copy", json={"key": "", "value": "x"}, timeout=10
        )
        assert r.status_code in (400, 422)


# ── Auto-decline duplicates ─────────────────────────────────────────
class TestAutoDeclineDuplicates:
    def test_unauth_blocked(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/auto-decline-duplicates",
            json={"dry_run": True},
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_dry_run_returns_matched(self, admin_session):
        r = admin_session.post(
            f"{BASE_URL}/api/admin/therapists/auto-decline-duplicates",
            json={"dry_run": True},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert "matched" in body
        assert isinstance(body["matched"], int)
        assert "rejected_ids" in body
        assert body["rejected_ids"] == []  # dry-run never rejects
        assert "preview" in body
        assert isinstance(body["preview"], list)

    def test_dry_run_does_not_change_pending_count(self, admin_session):
        before = admin_session.get(f"{BASE_URL}/api/admin/therapists?pending=true", timeout=15)
        assert before.status_code == 200
        before_count = len(before.json() if isinstance(before.json(), list) else before.json().get("rows", []))

        r = admin_session.post(
            f"{BASE_URL}/api/admin/therapists/auto-decline-duplicates",
            json={"dry_run": True},
            timeout=20,
        )
        assert r.status_code == 200

        after = admin_session.get(f"{BASE_URL}/api/admin/therapists?pending=true", timeout=15)
        after_count = len(after.json() if isinstance(after.json(), list) else after.json().get("rows", []))
        assert after_count == before_count, "dry_run must not change pending count"
