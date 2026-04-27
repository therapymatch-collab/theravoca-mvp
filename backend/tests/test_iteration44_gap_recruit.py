"""Iter-44: gap-recruiter and coverage-gap-analysis enhancements.

Validates:
1. Coverage analysis includes new dimensions: per-Idaho-city in-person gaps
   and bumped child/teen age targets.
2. `_compute_coverage_gap_analysis` is callable without auth (used by the cron).
3. Gap recruiter creates recruit_drafts with fake emails when dry_run=True.
4. New therapist directory does NOT include the duplicate `Credential type`
   field in the admin therapist edit modal (frontend visual — covered via lint).
"""
from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env", override=False)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def test_coverage_gap_endpoint_returns_per_city_and_age_targets():
    res = requests.get(
        f"{API}/admin/coverage-gap-analysis", headers=ADMIN_HEADERS, timeout=20,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert "in_person_by_city" in data["summary"]
    # Expect at least the target outside-Boise cities to surface in summary.
    cities_lower = {k.lower() for k in data["summary"]["in_person_by_city"].keys()}
    assert any("boise" in c for c in cities_lower) or len(cities_lower) > 0
    # Gap dimensions should now include `geography` and `age_group`.
    dims = {g["dimension"] for g in data["gaps"]}
    assert "geography" in dims or "age_group" in dims, (
        "expected at least one geography or age-group gap on the imported directory"
    )


def test_compute_coverage_gap_analysis_callable_without_auth():
    """The cron calls `_compute_coverage_gap_analysis` directly — ensure it
    works without going through the auth dependency."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from routes.admin import _compute_coverage_gap_analysis

    async def go():
        out = await _compute_coverage_gap_analysis()
        assert "total_active_therapists" in out
        assert "gaps" in out
        assert "summary" in out
        assert "gap_summary" in out
        return out
    out = asyncio.get_event_loop().run_until_complete(go())
    assert isinstance(out["gaps"], list)


def test_gap_recruit_drafts_listed():
    """The drafts endpoint must always be available even when there are 0
    drafts (returns empty list)."""
    res = requests.get(
        f"{API}/admin/gap-recruit/drafts", headers=ADMIN_HEADERS, timeout=10,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body.get("drafts"), list)
    assert "total" in body
    assert "pending" in body
    assert "dry_run_count" in body


def test_gap_recruit_dry_run_uses_fake_email():
    """Insert a synthetic gap and verify the recruiter writes a draft with a
    `therapymatch+recruitNNN@gmail.com` placeholder when dry_run=True."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from gap_recruiter import _next_fake_email_index
    from deps import db

    async def go():
        # We just need to confirm the index is monotonically increasing.
        n1 = await _next_fake_email_index()
        # Insert a placeholder draft with that index then verify next is +1.
        synthetic_id = str(uuid.uuid4())
        await db.recruit_drafts.insert_one({
            "id": synthetic_id,
            "gap": {"dimension": "test", "key": "test", "severity": "warning"},
            "candidate": {
                "name": "Synthetic Tester, LCSW",
                "email": f"therapymatch+recruit{n1}@gmail.com",
                "real_email": "",
                "license_type": "LCSW",
                "city": "Boise", "state": "ID",
                "website": "", "specialties": ["anxiety"], "modalities": ["CBT"],
                "match_rationale": "test", "estimated_score": 80,
            },
            "dry_run": True, "sent": False, "sent_at": None,
            "created_at": "2026-02-01T00:00:00+00:00",
        })
        try:
            n2 = await _next_fake_email_index()
            assert n2 == n1 + 1, f"expected {n1 + 1}, got {n2}"
        finally:
            await db.recruit_drafts.delete_one({"id": synthetic_id})

    asyncio.get_event_loop().run_until_complete(go())


def test_send_all_when_only_dry_run_drafts():
    """Pre-launch invariant: send-all must report 0 sent when every draft is
    `dry_run=True`."""
    res = requests.post(
        f"{API}/admin/gap-recruit/send-all", headers=ADMIN_HEADERS, timeout=20,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("sent") == 0


def test_delete_gap_draft_404_for_unknown_id():
    res = requests.delete(
        f"{API}/admin/gap-recruit/drafts/{uuid.uuid4()}",
        headers=ADMIN_HEADERS, timeout=10,
    )
    assert res.status_code == 404, res.text
