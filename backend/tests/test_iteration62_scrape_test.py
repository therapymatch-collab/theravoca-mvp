"""Iter-62 backend tests: scrape-sources/test endpoint + outreach dedup + budget."""
import os
import asyncio
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
ADMIN = {"X-Admin-Password": "admin123!"}


# ── Endpoint /api/admin/scrape-sources/test ────────────────────────────
class TestScrapeSourcesTestEndpoint:
    def test_pt_boise_jsonld(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scrape-sources/test",
            headers=ADMIN, timeout=40,
            json={"url": "https://www.psychologytoday.com/us/therapists/id/boise",
                  "label": "PT Boise"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["strategy"] == "jsonld", j
        assert j["candidate_count"] >= 10, j
        prev = j["candidates_preview"]
        assert prev and prev[0].get("name")
        # at least one candidate is in Boise/ID
        assert any(p.get("city") == "Boise" and p.get("state") == "ID" for p in prev), prev

    def test_invalid_url_graceful(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scrape-sources/test",
            headers=ADMIN, timeout=30,
            json={"url": "https://example.invalid/xxx"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["strategy"] == "none"
        assert j.get("error")

    def test_missing_url_400(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scrape-sources/test",
            headers=ADMIN, timeout=10, json={},
        )
        assert r.status_code == 400

    def test_auth_required_no_header(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scrape-sources/test",
            timeout=10, json={"url": "https://example.com"},
        )
        assert r.status_code in (401, 403)

    def test_auth_required_bad_password(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/scrape-sources/test",
            headers={"X-Admin-Password": "wrong!"},
            timeout=10, json={"url": "https://example.com"},
        )
        assert r.status_code in (401, 403)


# ── Iter-61 regressions ────────────────────────────────────────────────
class TestRegressionIter61:
    def test_scrape_sources_get(self):
        r = requests.get(f"{BASE_URL}/api/admin/scrape-sources",
                         headers=ADMIN, timeout=10)
        assert r.status_code == 200
        assert "sources" in r.json()

    def test_rate_limit_get(self):
        r = requests.get(f"{BASE_URL}/api/admin/intake-rate-limit",
                         headers=ADMIN, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "max_requests_per_window" in body
        assert "window_minutes" in body


# ── Unit tests of internal modules ─────────────────────────────────────
class TestExternalScraperBudget:
    def test_budget_returns_quickly(self):
        """Tiny budget against any real URL must NOT raise — returns gracefully."""
        import sys
        sys.path.insert(0, "/app/backend")
        from external_scraper import scrape_external_sources
        result = asyncio.get_event_loop().run_until_complete(
            scrape_external_sources(
                [{"url": "https://www.psychologytoday.com/us/therapists/id/boise",
                  "label": "PT", "enabled": True}],
                total_budget_sec=0.05,
            )
        )
        assert isinstance(result, dict)
        assert "results" in result
        # Budget exceeded → results=[] OR each result has empty candidates
        total = result.get("total_candidates", 0)
        assert total == 0, f"expected 0 with 0.05s budget, got {total}"


class TestOutreachDedup:
    def test_dedupe_by_name_city(self):
        """_find_candidates merges PT + external and dedupes by (name, city)."""
        import sys
        sys.path.insert(0, "/app/backend")
        import outreach_agent

        same_person = {
            "name": "Jane Smith, LCSW", "city": "Boise", "state": "ID",
            "license_types": ["LCSW"], "primary_license": "LCSW",
            "specialties": ["anxiety"], "email": "", "phone": "", "website": "",
            "profile_url": "", "source": "psychology_today",
        }
        diff_person = {**same_person, "name": "John Doe, LMFT"}

        async def fake_pt(req, count):
            from outreach_agent import _normalize_pt_to_outreach
            return [_normalize_pt_to_outreach(same_person, req)]

        async def fake_ext(req):
            from outreach_agent import _normalize_pt_to_outreach
            return [_normalize_pt_to_outreach(same_person, req),
                    _normalize_pt_to_outreach(diff_person, req)]

        async def fake_llm(req, count):
            return []

        orig_pt = outreach_agent._find_candidates_pt
        orig_ext = outreach_agent._find_candidates_external
        orig_llm = outreach_agent._find_candidates_llm
        orig_flag = outreach_agent.PT_SCRAPING_ENABLED
        outreach_agent._find_candidates_pt = fake_pt
        outreach_agent._find_candidates_external = fake_ext
        outreach_agent._find_candidates_llm = fake_llm
        outreach_agent.PT_SCRAPING_ENABLED = True
        try:
            result = asyncio.get_event_loop().run_until_complete(
                outreach_agent._find_candidates(
                    {"presenting_issues": ["anxiety"], "location_state": "ID",
                     "location_city": "Boise"}, count=10)
            )
        finally:
            outreach_agent._find_candidates_pt = orig_pt
            outreach_agent._find_candidates_external = orig_ext
            outreach_agent._find_candidates_llm = orig_llm
            outreach_agent.PT_SCRAPING_ENABLED = orig_flag

        names = [c["name"] for c in result]
        assert names.count("Jane Smith, LCSW") == 1, names
        assert "John Doe, LMFT" in names, names
        assert len(result) == 2, result
