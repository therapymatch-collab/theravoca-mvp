"""Iteration 61 — backend tests for:
  - Admin master-query snapshot geo aggregates (therapists_by_state/city/zip)
  - Admin master-query NL question about Boise
  - Admin intake rate-limit GET/PUT with boundary validation (1..1000, 1..43200)
  - Admin scrape-sources registry GET/PUT with validation (max 50, http(s) urls)
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PWD = "admin123!"
H = {"Content-Type": "application/json", "X-Admin-Password": ADMIN_PWD}


# --- master-query snapshot ---------------------------------------------------
class TestMasterQuerySnapshot:
    def test_snapshot_has_geo_aggregates(self):
        r = requests.get(f"{BASE_URL}/api/admin/master-query/snapshot", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("therapists_by_state", "therapists_by_city", "therapists_by_zip"):
            assert key in data, f"snapshot missing key {key}"
            assert isinstance(data[key], list), f"{key} should be list"
        # 168 active ID therapists are seeded → expect non-empty state and city arrays
        assert len(data["therapists_by_state"]) > 0, "therapists_by_state empty"
        states = {row["state"] for row in data["therapists_by_state"]}
        assert "ID" in states, f"ID not in states: {states}"
        # city aggregation should also be non-empty
        assert len(data["therapists_by_city"]) > 0, "therapists_by_city empty"
        # cities have proper shape
        assert all("city" in r and "count" in r for r in data["therapists_by_city"])

    def test_snapshot_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/master-query/snapshot", timeout=30)
        assert r.status_code in (401, 403)


class TestMasterQueryAnswer:
    def test_boise_question(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/master-query",
            headers=H,
            json={"question": "How many therapists do we have in Boise?"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        ans = (data.get("answer") or "").strip()
        assert ans, "empty answer"
        # contains digit and references Boise (case-insensitive)
        assert any(ch.isdigit() for ch in ans), f"no number in answer: {ans}"
        assert "boise" in ans.lower(), f"answer does not reference Boise: {ans}"

    def test_empty_question_400(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/master-query", headers=H, json={"question": ""}, timeout=10,
        )
        assert r.status_code == 400


# --- intake rate-limit -------------------------------------------------------
class TestIntakeRateLimit:
    def test_get_returns_defaults_or_persisted(self):
        r = requests.get(f"{BASE_URL}/api/admin/intake-rate-limit", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "max_requests_per_window" in d and "window_minutes" in d
        assert isinstance(d["max_requests_per_window"], int)
        assert isinstance(d["window_minutes"], int)

    def test_put_accepts_bounds(self):
        # save valid mid value
        payload = {"max_requests_per_window": 7, "window_minutes": 120}
        r = requests.put(
            f"{BASE_URL}/api/admin/intake-rate-limit", headers=H, json=payload, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == payload
        # GET reflects persisted
        g = requests.get(f"{BASE_URL}/api/admin/intake-rate-limit", headers=H, timeout=15)
        assert g.json() == payload

    @pytest.mark.parametrize("max_per,window", [
        (1, 1),       # lower bound
        (1000, 43200),  # upper bound
    ])
    def test_put_boundary_inclusive(self, max_per, window):
        payload = {"max_requests_per_window": max_per, "window_minutes": window}
        r = requests.put(
            f"{BASE_URL}/api/admin/intake-rate-limit", headers=H, json=payload, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == payload

    @pytest.mark.parametrize("max_per,window,bad_field", [
        (0, 60, "max_requests_per_window"),
        (1001, 60, "max_requests_per_window"),
        (5, 0, "window_minutes"),
        (5, 43201, "window_minutes"),
    ])
    def test_put_boundary_rejects(self, max_per, window, bad_field):
        payload = {"max_requests_per_window": max_per, "window_minutes": window}
        r = requests.put(
            f"{BASE_URL}/api/admin/intake-rate-limit", headers=H, json=payload, timeout=15,
        )
        assert r.status_code == 400, f"expected 400 for {payload}, got {r.status_code}"

    def teardown_class(cls):
        # restore safe default
        requests.put(
            f"{BASE_URL}/api/admin/intake-rate-limit", headers=H,
            json={"max_requests_per_window": 1, "window_minutes": 60}, timeout=15,
        )


# --- scrape sources ---------------------------------------------------------
class TestScrapeSources:
    def test_get_initial_returns_list(self):
        # reset to empty first
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H,
            json={"sources": []}, timeout=15,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/admin/scrape-sources", headers=H, timeout=15)
        assert g.status_code == 200
        assert g.json() == {"sources": []}

    def test_put_two_valid_sources_persists(self):
        body = {"sources": [
            {"url": "https://example.com/idaho-therapists", "label": "ID Counseling Assoc",
             "notes": "primary directory", "enabled": True},
            {"url": "http://example.org/clinics", "label": "County clinics",
             "notes": "", "enabled": False},
        ]}
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H, json=body, timeout=15,
        )
        assert r.status_code == 200, r.text
        out = r.json()["sources"]
        assert len(out) == 2
        assert out[0]["url"] == body["sources"][0]["url"]
        assert out[0]["label"] == "ID Counseling Assoc"
        assert out[0]["enabled"] is True
        assert out[1]["enabled"] is False
        # all entries have generated id
        for s in out:
            assert "id" in s and s["id"]
        # GET returns same
        g = requests.get(f"{BASE_URL}/api/admin/scrape-sources", headers=H, timeout=15)
        assert g.json()["sources"] == out

    def test_put_invalid_url_400(self):
        body = {"sources": [{"url": "ftp://nope.invalid", "label": "x"}]}
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H, json=body, timeout=15,
        )
        assert r.status_code == 400

    def test_put_missing_url_400(self):
        body = {"sources": [{"label": "no url"}]}
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H, json=body, timeout=15,
        )
        assert r.status_code == 400

    def test_put_over_50_400(self):
        body = {"sources": [
            {"url": f"https://ex.com/{i}", "label": f"x{i}"} for i in range(51)
        ]}
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H, json=body, timeout=15,
        )
        assert r.status_code == 400

    def test_put_non_list_400(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H,
            json={"sources": "nope"}, timeout=15,
        )
        assert r.status_code == 400

    def test_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/scrape-sources", timeout=15)
        assert r.status_code in (401, 403)

    def teardown_class(cls):
        requests.put(
            f"{BASE_URL}/api/admin/scrape-sources", headers=H,
            json={"sources": []}, timeout=15,
        )


# --- light regression: matching/intake healthy -------------------------------
class TestRegression:
    def test_admin_stats_ok(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=H, timeout=15)
        assert r.status_code == 200
        d = r.json()
        # 168 ID therapists seeded — sanity check directory size > 100
        assert d.get("therapists", 0) >= 100, d
