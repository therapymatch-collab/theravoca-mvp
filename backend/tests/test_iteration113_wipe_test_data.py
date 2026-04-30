"""iter-113 — Pre-launch wipe-test-data endpoint contract tests.

Verifies:
1. /admin/wipe-test-data/preview returns shape {collections_to_clear,
   therapists_to_delete, therapists_kept, total_documents_to_delete,
   preserved_note}
2. /admin/wipe-test-data without confirm_token returns 400
3. /admin/wipe-test-data with the wrong token returns 400
4. /admin/wipe-test-data without auth returns 401
5. The endpoint exists in the FastAPI route table (catch accidental
   route deletion).
"""
from __future__ import annotations

import os

from fastapi.testclient import TestClient


def _get_client():
    # Lazy import so the env var is set before app constructs.
    from server import app
    return TestClient(app)


ADMIN = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}


def test_route_registered():
    """Catch accidental route removal — the wipe endpoints are
    pre-launch only and easy to delete by mistake."""
    from server import app
    paths = {r.path for r in app.routes}
    assert "/api/admin/wipe-test-data" in paths
    assert "/api/admin/wipe-test-data/preview" in paths


def test_preview_no_auth():
    client = _get_client()
    res = client.get("/api/admin/wipe-test-data/preview")
    assert res.status_code in (401, 403)


def test_preview_with_auth_returns_shape():
    client = _get_client()
    res = client.get("/api/admin/wipe-test-data/preview", headers=ADMIN)
    assert res.status_code == 200
    body = res.json()
    for key in (
        "collections_to_clear",
        "therapists_to_delete",
        "therapists_kept",
        "total_documents_to_delete",
        "preserved_note",
    ):
        assert key in body, f"missing key: {key}"
    # Must include every collection from the expected wipe list
    expected = {
        "requests", "applications", "declines", "patient_accounts",
        "outreach_invites", "outreach_opt_outs", "recruit_drafts",
        "auto_recruit_cycles", "simulator_runs", "simulator_requests",
        "feedback", "followups", "magic_codes",
        "password_login_attempts", "intake_ip_log", "cron_runs",
    }
    assert set(body["collections_to_clear"].keys()) == expected
    # Counts are non-negative ints
    for col, n in body["collections_to_clear"].items():
        assert isinstance(n, int) and n >= 0, f"{col} count must be int>=0"
    assert body["therapists_to_delete"] >= 0
    assert body["therapists_kept"] >= 0


def test_post_no_auth():
    client = _get_client()
    res = client.post(
        "/api/admin/wipe-test-data",
        json={"confirm_token": "WIPE TEST DATA"},
    )
    assert res.status_code in (401, 403)


def test_post_missing_token_400():
    client = _get_client()
    res = client.post(
        "/api/admin/wipe-test-data",
        headers=ADMIN,
        json={},
    )
    assert res.status_code == 400
    assert "confirm_token" in res.json()["detail"]


def test_post_wrong_token_400():
    client = _get_client()
    res = client.post(
        "/api/admin/wipe-test-data",
        headers=ADMIN,
        json={"confirm_token": "wipe test data"},  # wrong case
    )
    assert res.status_code == 400
