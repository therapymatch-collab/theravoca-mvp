"""Iter-63 — LLM web-research enrichment endpoints, in-process scoring,
caching, apply-fit fallback, admin-detail surfacing, auth gating, and
DB-cleanup snapshot. Plus Iter-61 / Iter-62 regression smoke."""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}
ANN_ID = "b54d5535-8647-4fe6-9a52-106b1b79632d"


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def restore_toggle():
    """Whatever the toggle was before the test, restore it after."""
    r = requests.get(f"{API}/admin/research-enrichment", headers=ADMIN_HEADERS, timeout=10)
    initial = r.json().get("enabled") if r.ok else False
    yield
    requests.put(
        f"{API}/admin/research-enrichment",
        json={"enabled": bool(initial)},
        headers=ADMIN_HEADERS,
        timeout=10,
    )


@pytest.fixture(scope="module")
def db():
    """Sync pymongo client to avoid motor's per-event-loop executor issues
    when each test runs its own asyncio.run()."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from pymongo import MongoClient
    c = MongoClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


@pytest.fixture()
def adb():
    """Per-test motor client so each asyncio.run() has its own loop +
    executor binding. Avoids 'Event loop is closed' across tests."""
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test_database")
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    yield c[os.environ["DB_NAME"]]
    c.close()


# ─── 1. Toggle GET / PUT roundtrip ──────────────────────────────────────────

class TestResearchEnrichmentToggle:
    def test_get_returns_expected_shape(self, restore_toggle):
        r = requests.get(f"{API}/admin/research-enrichment", headers=ADMIN_HEADERS, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"enabled", "therapists_with_fresh_research", "enriched_requests"}
        assert isinstance(d["enabled"], bool)
        assert isinstance(d["therapists_with_fresh_research"], int)
        assert isinstance(d["enriched_requests"], int)

    def test_put_enable_then_disable_roundtrip(self, restore_toggle):
        r1 = requests.put(
            f"{API}/admin/research-enrichment",
            json={"enabled": True},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r1.status_code == 200 and r1.json() == {"enabled": True}
        r2 = requests.get(f"{API}/admin/research-enrichment", headers=ADMIN_HEADERS, timeout=10)
        assert r2.json()["enabled"] is True

        r3 = requests.put(
            f"{API}/admin/research-enrichment",
            json={"enabled": False},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r3.status_code == 200 and r3.json() == {"enabled": False}
        r4 = requests.get(f"{API}/admin/research-enrichment", headers=ADMIN_HEADERS, timeout=10)
        assert r4.json()["enabled"] is False

    def test_run_on_missing_request_returns_error_not_500(self, restore_toggle):
        r = requests.post(
            f"{API}/admin/research-enrichment/run/does-not-exist-123",
            headers=ADMIN_HEADERS,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"error": "request not found"}

    # Auth gating
    def test_get_requires_admin_header(self):
        r = requests.get(f"{API}/admin/research-enrichment", timeout=10)
        assert r.status_code in (401, 403)

    def test_put_requires_admin_header(self):
        r = requests.put(
            f"{API}/admin/research-enrichment",
            json={"enabled": True},
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_run_requires_admin_header(self):
        r = requests.post(
            f"{API}/admin/research-enrichment/run/anything",
            timeout=10,
        )
        assert r.status_code in (401, 403)


# ─── 2. In-process LLM scoring + caching ────────────────────────────────────

class TestScoreResearchAxes:
    @pytest.mark.timeout(60)
    def test_ann_omodt_anxiety_evidence_depth(self, adb):
        """End-to-end real LLM call against Ann's cached research."""
        async def _run():
            from research_enrichment import score_research_axes
            t = await adb.therapists.find_one({"id": ANN_ID}, {"_id": 0})
            assert t, "Ann Omodt seed missing"
            request = {"presenting_issues": ["anxiety"]}
            return await score_research_axes(t, request)
        out = asyncio.run(_run())
        assert "evidence_depth" in out and "approach_alignment" in out and "rationale" in out
        assert out["evidence_depth"] >= 5.0, f"expected depth>=5, got {out['evidence_depth']}"

    @pytest.mark.timeout(20)
    def test_get_or_build_research_caches(self, adb):
        """Second call within seconds must NOT update research_refreshed_at."""
        async def _run():
            from research_enrichment import get_or_build_research
            t1 = await adb.therapists.find_one({"id": ANN_ID}, {"_id": 0})
            ts_before = t1.get("research_refreshed_at")
            assert ts_before, "expected fresh research already cached"
            await get_or_build_research(t1)  # should be a no-op
            t2 = await adb.therapists.find_one({"id": ANN_ID}, {"_id": 0})
            return ts_before, t2.get("research_refreshed_at")
        before, after = asyncio.run(_run())
        assert before == after, f"cache miss: ts changed {before} → {after}"


# ─── 3. apply_fit ───────────────────────────────────────────────────────────

class TestScoreApplyFit:
    @pytest.mark.timeout(10)
    def test_empty_apply_message_returns_zero(self, adb):
        async def _run():
            from research_enrichment import score_apply_fit
            t = await adb.therapists.find_one({"id": ANN_ID}, {"_id": 0})
            return await score_apply_fit("", {"presenting_issues": ["anxiety"]}, t)
        out = asyncio.run(_run())
        assert out["apply_fit"] == 0.0
        assert "no apply message" in out["rationale"].lower()

    @pytest.mark.timeout(45)
    def test_non_empty_apply_message_returns_in_range(self, adb):
        async def _run():
            from research_enrichment import score_apply_fit
            t = await adb.therapists.find_one({"id": ANN_ID}, {"_id": 0})
            req = {"presenting_issues": ["anxiety"], "style_preference": ["warm"], "prior_therapy": "yes"}
            msg = (
                "Hi, I read your brief about anxiety. I've worked with adults "
                "navigating anxiety using IFS and somatic practices for 8+ years. "
                "Given you've had prior therapy, we can start where you left off "
                "and explore what shifted. Happy to chat."
            )
            return await score_apply_fit(msg, req, t)
        out = asyncio.run(_run())
        assert 0.0 <= float(out["apply_fit"]) <= 5.0
        assert isinstance(out["rationale"], str) and out["rationale"]


# ─── 4. Admin request-detail surfaces enriched keys ─────────────────────────

class TestAdminRequestDetailKeys:
    @pytest.mark.timeout(30)
    def test_notified_therapists_include_enriched_keys(self, restore_toggle):
        # Seed a request so there's at least one notified therapist.
        # Unique email so the per-email rate-limit (1/hour) doesn't trip on reruns.
        import uuid as _uuid
        from conftest import v2_request_payload
        payload = v2_request_payload(
            email=f"TEST_iter63_{_uuid.uuid4().hex[:8]}@example.com",
        )
        r = requests.post(f"{API}/requests", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        req_id = body.get("request_id") or body.get("id")
        assert req_id, body

        # Fetch the request detail
        r2 = requests.get(
            f"{API}/admin/requests/{req_id}",
            headers=ADMIN_HEADERS,
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        notified = body.get("notified") or []
        # Even when no therapists notified, the schema contract still holds
        # for any present entries.
        for t in notified:
            for k in (
                "enriched_score", "score_delta", "evidence_depth",
                "approach_alignment", "research_rationale", "research_themes",
            ):
                assert k in t, f"missing key {k} in notified therapist {t.get('id')}"


# ─── 5. DB cleanup snapshot ─────────────────────────────────────────────────

class TestDbCleanupSnapshot:
    def test_collection_counts(self, db):
        counts = {
            col: db[col].count_documents({})
            for col in (
                "requests", "applications", "recruit_drafts",
                "outreach_invites", "feedback", "patient_accounts",
                "magic_codes",
            )
        }
        # Note: the seed-a-request test above may have inserted 1 request +
        # downstream rows by the time this test runs — the snapshot we care
        # about is "no leftover production-like junk", so only assert these
        # are not orders-of-magnitude larger than expected.
        assert counts["recruit_drafts"] == 0
        assert counts["feedback"] == 0
        assert counts["patient_accounts"] == 0
        assert counts["magic_codes"] == 0

    def test_therapist_counts_by_source(self, db):
        total = db.therapists.count_documents({})
        imported = db.therapists.count_documents({"source": "imported_xlsx"})
        recruit = db.therapists.count_documents({"source": "gap_recruit_signup"})
        assert imported == 122, f"expected 122 imported_xlsx, got {imported}"
        assert recruit == 1, f"expected 1 gap_recruit_signup, got {recruit}"
        # Allow 1 extra if a test seed therapist sneaks in elsewhere.
        assert 123 <= total <= 124, f"expected 123 therapists (±1), got {total}"


# ─── 6. Iter-61 / Iter-62 regressions ───────────────────────────────────────

class TestRegressionsIter61And62:
    def test_intake_rate_limit_get(self):
        r = requests.get(f"{API}/admin/intake-rate-limit", headers=ADMIN_HEADERS, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "max_requests_per_window" in d and "window_minutes" in d

    def test_scrape_sources_list(self):
        r = requests.get(f"{API}/admin/scrape-sources", headers=ADMIN_HEADERS, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_scrape_sources_test_endpoint_validates(self):
        r = requests.post(
            f"{API}/admin/scrape-sources/test",
            json={},  # missing url
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 400
