"""
Backend tests for the Matching-Outcome Simulator (admin-only).
Covers POST/GET/DELETE /api/admin/simulator/* endpoints, auth, validation,
and that the production therapist filter returns a non-empty pool.
"""
import os
import pytest
import requests

def _load_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
ADMIN_PWD = "admin123!"
HDR = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}


# Module-level run created once and used across tests
@pytest.fixture(scope="module")
def created_run():
    r = requests.post(
        f"{BASE_URL}/api/admin/simulator/run",
        json={"num_requests": 20, "random_seed": 7},
        headers=HDR,
        timeout=120,
    )
    assert r.status_code == 200, f"sim run failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    yield data
    # teardown
    rid = data.get("id")
    if rid:
        requests.delete(f"{BASE_URL}/api/admin/simulator/runs/{rid}", headers=HDR, timeout=30)


class TestSimulatorRun:
    def test_run_basic_shape(self, created_run):
        d = created_run
        assert d["status"] == "ok"
        assert isinstance(d.get("coverage"), dict) and d["coverage"]
        assert isinstance(d.get("suggestions"), list)
        assert isinstance(d.get("requests"), list)
        assert len(d["requests"]) == 20
        assert "duration_sec" in d
        assert isinstance(d["duration_sec"], (int, float))

    def test_each_request_report_fields(self, created_run):
        for r in created_run["requests"]:
            for k in ("hard_flags", "filter_failures", "top10_step1",
                      "applications_detail", "final_top5"):
                assert k in r, f"missing {k} in per-request report"
            assert isinstance(r["hard_flags"], list)
            assert isinstance(r["filter_failures"], dict)
            assert isinstance(r["top10_step1"], list)
            assert isinstance(r["applications_detail"], list)
            assert isinstance(r["final_top5"], list)

    def test_therapist_pool_nonzero(self, created_run):
        # Coverage must show a non-empty pool – this validates the prod filter fix.
        cov = created_run["coverage"]
        assert cov.get("pool_size", 0) > 0, f"pool is empty: {cov}"
        # Step-1 mean must be > 0 if pool is real.
        assert cov.get("step1_mean_across_runs", 0) > 0, "step1 mean=0 → filter zeroed pool"


class TestSimulatorRunsList:
    def test_list_runs_after_create(self, created_run):
        r = requests.get(f"{BASE_URL}/api/admin/simulator/runs", headers=HDR, timeout=30)
        assert r.status_code == 200
        items = r.json().get("items")
        assert isinstance(items, list) and len(items) > 0
        ids = [i["id"] for i in items]
        assert created_run["id"] in ids

    def test_get_specific_run(self, created_run):
        rid = created_run["id"]
        r = requests.get(f"{BASE_URL}/api/admin/simulator/runs/{rid}", headers=HDR, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == rid
        assert len(d["requests"]) == 20

    def test_get_unknown_run_404(self):
        r = requests.get(f"{BASE_URL}/api/admin/simulator/runs/does-not-exist-xyz",
                         headers=HDR, timeout=30)
        assert r.status_code == 404


class TestSimulatorAuthAndValidation:
    def test_unauth_run_401(self):
        r = requests.post(f"{BASE_URL}/api/admin/simulator/run",
                          json={"num_requests": 10}, timeout=30)
        assert r.status_code in (401, 403), f"got {r.status_code}"

    def test_unauth_list_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/simulator/runs", timeout=30)
        assert r.status_code in (401, 403)

    def test_unauth_get_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/simulator/runs/anything", timeout=30)
        assert r.status_code in (401, 403)

    def test_unauth_delete_401(self):
        r = requests.delete(f"{BASE_URL}/api/admin/simulator/runs/anything", timeout=30)
        assert r.status_code in (401, 403)

    def test_num_requests_too_small_400(self):
        r = requests.post(f"{BASE_URL}/api/admin/simulator/run",
                          json={"num_requests": 5}, headers=HDR, timeout=30)
        assert r.status_code == 400

    def test_num_requests_too_large_400(self):
        r = requests.post(f"{BASE_URL}/api/admin/simulator/run",
                          json={"num_requests": 500}, headers=HDR, timeout=30)
        assert r.status_code == 400


class TestSimulatorDelete:
    def test_create_then_delete(self):
        # Create a fresh run to delete (independent of module fixture)
        c = requests.post(f"{BASE_URL}/api/admin/simulator/run",
                          json={"num_requests": 10, "random_seed": 11},
                          headers=HDR, timeout=120)
        assert c.status_code == 200
        rid = c.json()["id"]

        d = requests.delete(f"{BASE_URL}/api/admin/simulator/runs/{rid}",
                            headers=HDR, timeout=30)
        assert d.status_code == 200
        body = d.json()
        assert body.get("ok") is True
        assert body.get("deleted", 0) >= 1

        # Confirm gone
        g = requests.get(f"{BASE_URL}/api/admin/simulator/runs/{rid}",
                         headers=HDR, timeout=30)
        assert g.status_code == 404
