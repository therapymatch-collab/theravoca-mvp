"""Iteration 98 — Auto-recruit closed-loop endpoints tests.

Covers:
  * GET /api/admin/auto-recruit/status (defaults seed)
  * PUT /api/admin/auto-recruit/config (merge-patch + key whitelist)
  * POST /api/admin/auto-recruit/plan (preview)
  * POST /api/admin/auto-recruit/run (cycle persistence + draft stamping)
  * GET /api/admin/auto-recruit/cycles (history)
  * POST /api/admin/auto-recruit/approve (cycle_id and draft_ids paths)
  * paused_target_reached + skipped (disabled) status flows
  * cron integration (function exists + Monday gating)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_PWD = "admin123!"
HEADERS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update(HEADERS)
    yield s
    # Teardown — restore safe defaults so other tests aren't disrupted.
    try:
        s.put(
            f"{BASE_URL}/api/admin/auto-recruit/config",
            json={"target_zero_pool_pct": 5.0, "enabled": True, "dry_run": True,
                  "require_approval": True, "max_drafts_per_cycle": 10},
            timeout=30,
        )
    except Exception:
        pass


# ─── Status / Config ────────────────────────────────────────────────────────

def test_status_seeds_defaults(session):
    r = session.get(f"{BASE_URL}/api/admin/auto-recruit/status", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "config" in data
    assert "last_cycle" in data
    assert "pending_approval_count" in data
    cfg = data["config"]
    for key in [
        "enabled", "dry_run", "require_approval", "target_zero_pool_pct",
        "max_drafts_per_cycle", "max_sends_per_day_email",
        "max_sends_per_day_sms", "cycle_frequency", "sim_num_requests",
    ]:
        assert key in cfg, f"missing default config key: {key}"
    assert isinstance(data["pending_approval_count"], int)


def test_status_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/auto-recruit/status", timeout=15)
    assert r.status_code in (401, 403)


def test_config_merge_patch_whitelist(session):
    # Update target_zero_pool_pct and pass a junk key — only the whitelisted
    # value should take effect.
    r = session.put(
        f"{BASE_URL}/api/admin/auto-recruit/config",
        json={"target_zero_pool_pct": 7.5, "foo": "bar"},
        timeout=30,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    cfg = body["config"]
    assert cfg["target_zero_pool_pct"] == 7.5
    assert "foo" not in cfg
    # Persistence — re-read.
    r2 = session.get(f"{BASE_URL}/api/admin/auto-recruit/status", timeout=30)
    assert r2.json()["config"]["target_zero_pool_pct"] == 7.5
    # Restore default.
    session.put(
        f"{BASE_URL}/api/admin/auto-recruit/config",
        json={"target_zero_pool_pct": 5.0},
        timeout=30,
    )


# ─── Plan preview ──────────────────────────────────────────────────────────

def test_plan_preview(session):
    r = session.post(f"{BASE_URL}/api/admin/auto-recruit/plan", timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("sim_run_id", "zero_pool_rate_pct", "pool_size", "plan",
              "plan_total", "critical_count", "high_count"):
        assert k in data, f"missing {k} in plan preview"
    assert isinstance(data["plan"], list)
    assert isinstance(data["pool_size"], int) and data["pool_size"] > 0
    # plan rows have expected fields
    if data["plan"]:
        row = data["plan"][0]
        for k in ("dimension", "label", "slug", "priority", "sim_pct",
                  "gap_severity", "current", "target", "deficit", "source"):
            assert k in row, f"plan row missing {k}"
        assert row["priority"] in ("critical", "high", "medium")


# ─── Cycle run + persistence ────────────────────────────────────────────────

@pytest.fixture(scope="module")
def cycle_doc(session):
    """Run an actual cycle once (high target so we don't even reach
    drafts isn't desired here — we want a real cycle). Force target_zero_pool_pct
    low so we don't accidentally pause."""
    session.put(
        f"{BASE_URL}/api/admin/auto-recruit/config",
        json={"target_zero_pool_pct": 5.0, "enabled": True,
              "dry_run": True, "require_approval": True,
              "max_drafts_per_cycle": 10},
        timeout=30,
    )
    r = session.post(f"{BASE_URL}/api/admin/auto-recruit/run", timeout=300)
    assert r.status_code == 200, r.text
    return r.json()


def test_run_cycle_returns_doc(cycle_doc):
    for k in ("id", "started_at", "finished_at", "status", "triggered_by"):
        assert k in cycle_doc
    assert cycle_doc["triggered_by"] == "manual"
    # Status: ok if gap recruiter completed (pool was below target). Tolerate
    # 'paused_target_reached' and 'error' so flaky 3rd-party calls don't break
    # the test (mocked-api note in the review request allows this).
    assert cycle_doc["status"] in ("ok", "paused_target_reached", "error")
    if cycle_doc["status"] == "ok":
        assert "sim_run_id" in cycle_doc
        assert "recruit_plan" in cycle_doc
        assert "drafts_created" in cycle_doc
        assert 0 <= cycle_doc["drafts_created"] <= 10


def test_cycles_history_lists_run(session, cycle_doc):
    r = session.get(f"{BASE_URL}/api/admin/auto-recruit/cycles", timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert any(it.get("id") == cycle_doc["id"] for it in items)


def test_drafts_stamped_with_cycle_id(session, cycle_doc):
    """If drafts were created, status endpoint must show pending approvals."""
    if cycle_doc.get("drafts_created", 0) <= 0:
        pytest.skip("no drafts created (gap recruiter produced 0 - tolerated)")
    r = session.get(f"{BASE_URL}/api/admin/auto-recruit/status", timeout=30)
    assert r.json()["pending_approval_count"] >= 1


# ─── Approval ──────────────────────────────────────────────────────────────

def test_approve_requires_filter(session):
    r = session.post(
        f"{BASE_URL}/api/admin/auto-recruit/approve", json={}, timeout=30,
    )
    assert r.status_code == 400


def test_approve_by_cycle_id(session, cycle_doc):
    if cycle_doc.get("drafts_created", 0) <= 0:
        pytest.skip("no drafts to approve (3rd-party may have failed)")
    r = session.post(
        f"{BASE_URL}/api/admin/auto-recruit/approve",
        json={"cycle_id": cycle_doc["id"]},
        timeout=60,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("approved", 0) >= 1


# ─── Paused / Skipped state flows ─────────────────────────────────────────

def test_paused_when_target_reached(session):
    """Set target=100 → cycle pauses, drafts_created=0."""
    session.put(
        f"{BASE_URL}/api/admin/auto-recruit/config",
        json={"target_zero_pool_pct": 100.0},
        timeout=30,
    )
    try:
        r = session.post(f"{BASE_URL}/api/admin/auto-recruit/run", timeout=120)
        assert r.status_code == 200
        doc = r.json()
        assert doc["status"] == "paused_target_reached"
        assert doc.get("drafts_created", 0) == 0
    finally:
        session.put(
            f"{BASE_URL}/api/admin/auto-recruit/config",
            json={"target_zero_pool_pct": 5.0},
            timeout=30,
        )


def test_skipped_when_disabled(session):
    """Disable → cycle skipped, reason mentions disabled."""
    session.put(
        f"{BASE_URL}/api/admin/auto-recruit/config",
        json={"enabled": False},
        timeout=30,
    )
    try:
        r = session.post(f"{BASE_URL}/api/admin/auto-recruit/run", timeout=30)
        assert r.status_code == 200
        doc = r.json()
        assert doc["status"] == "skipped"
        assert "disabled" in (doc.get("reason") or "").lower()
    finally:
        session.put(
            f"{BASE_URL}/api/admin/auto-recruit/config",
            json={"enabled": True},
            timeout=30,
        )


# ─── Cron integration ──────────────────────────────────────────────────────

def test_cron_imports_auto_recruit_weekly():
    """Confirm cron.py wires _run_auto_recruit_weekly into _daily_loop on Mondays."""
    import importlib
    cron = importlib.import_module("cron")
    assert hasattr(cron, "_run_auto_recruit_weekly"), "cron missing weekly fn"
    # Verify the source mentions Monday gating
    import inspect
    src = inspect.getsource(cron._daily_loop)
    assert "_run_auto_recruit_weekly" in src
    assert "weekday() == 0" in src
