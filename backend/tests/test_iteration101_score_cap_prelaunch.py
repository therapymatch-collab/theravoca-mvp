"""Iteration 101 — backend tests for:
1. Pre-launch invite template appears in /api/admin/email-templates with extended fields
2. Matching score_therapist total is capped at 99 (and -1 sentinels not capped)
3. /api/admin/hard-capacity urgency_strict reflects urgency_capacity as STRING
"""
import os
import sys
import asyncio
import pytest
import requests

# Load REACT_APP_BACKEND_URL from frontend/.env (pytest context doesn't inherit)
if not os.environ.get("REACT_APP_BACKEND_URL"):
    try:
        with open("/app/frontend/.env") as _f:
            for _ln in _f:
                if _ln.startswith("REACT_APP_BACKEND_URL="):
                    os.environ["REACT_APP_BACKEND_URL"] = _ln.split("=", 1)[1].strip()
                    break
    except Exception:
        pass

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": "admin123!"}

# allow importing /app/backend modules
sys.path.insert(0, "/app/backend")


# ---------- Task 1: prelaunch_invite email template ----------

class TestPrelaunchInviteTemplate:
    def test_list_includes_prelaunch_invite(self):
        r = requests.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # Response could be a list of templates or a dict keyed by template name
        templates = data.get("templates", data) if isinstance(data, dict) else data
        if isinstance(templates, list):
            keys = {t.get("key") or t.get("id") or t.get("name") for t in templates}
        else:
            keys = set(templates.keys())
        assert "prelaunch_invite" in keys, f"prelaunch_invite not in templates: {keys}"

    def test_prelaunch_invite_has_expected_fields(self):
        r = requests.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS, timeout=20)
        data = r.json()
        templates = data.get("templates", data) if isinstance(data, dict) else data
        entry = None
        if isinstance(templates, list):
            for t in templates:
                if (t.get("key") or t.get("id") or t.get("name")) == "prelaunch_invite":
                    entry = t
                    break
        else:
            entry = templates.get("prelaunch_invite")
        assert entry is not None
        # Fields we care about (subject/heading/intro/cta_label/footer_note/rationale/pricing_note)
        for f in ["subject", "heading", "intro", "cta_label",
                  "footer_note", "rationale", "pricing_note"]:
            assert f in entry, f"Missing field {f} in prelaunch_invite: keys={list(entry.keys())}"
            assert isinstance(entry[f], str), f"{f} should be string"

    def test_put_prelaunch_invite_persists_and_reset(self):
        # Grab original subject
        r = requests.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS, timeout=20)
        data = r.json()
        templates = data.get("templates", data) if isinstance(data, dict) else data
        entry = None
        if isinstance(templates, list):
            for t in templates:
                if (t.get("key") or t.get("id") or t.get("name")) == "prelaunch_invite":
                    entry = t
                    break
        else:
            entry = templates.get("prelaunch_invite")
        original_subject = entry["subject"]

        # PUT patch subject
        new_subject = "New subject for testing"
        put = requests.put(
            f"{API}/admin/email-templates/prelaunch_invite",
            headers=ADMIN_HEADERS,
            json={"subject": new_subject},
            timeout=20,
        )
        assert put.status_code == 200, put.text

        # GET to verify persistence
        r2 = requests.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS, timeout=20)
        data2 = r2.json()
        templates2 = data2.get("templates", data2) if isinstance(data2, dict) else data2
        e2 = None
        if isinstance(templates2, list):
            for t in templates2:
                if (t.get("key") or t.get("id") or t.get("name")) == "prelaunch_invite":
                    e2 = t
                    break
        else:
            e2 = templates2.get("prelaunch_invite")
        assert e2["subject"] == new_subject

        # Reset back to default
        reset = requests.put(
            f"{API}/admin/email-templates/prelaunch_invite",
            headers=ADMIN_HEADERS,
            json={"subject": original_subject},
            timeout=20,
        )
        assert reset.status_code == 200


# ---------- Task 2: score cap at 99 ----------

class TestScoreCap:
    def test_score_total_capped_at_99(self):
        import matching
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _run():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client[os.environ.get("DB_NAME", "test_database")]
            therapists = await db.therapists.find(
                {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}},
                {"_id": 0},
            ).to_list(length=200)
            # Use a real patient request from DB if available (any shape)
            request = await db.patient_requests.find_one({}, {"_id": 0})
            if not request:
                request = await db.requests.find_one({}, {"_id": 0})
            assert request, "No patient request found in DB to score against"
            tested = 0
            for t in therapists:
                res = matching.score_therapist(t, request)
                total = res.get("total")
                if total == -1 or res.get("filtered"):
                    continue  # sentinel, allowed
                assert isinstance(total, (int, float))
                assert total <= 95.0, f"Uncapped: total={total} therapist={t.get('full_name')}"
                tested += 1
                if tested >= 5:
                    break
            assert tested >= 5, f"Only tested {tested} valid therapists"
            client.close()

        # Isolate: always create a FRESH event loop instead of reaching for
        # the existing one. Earlier tests in the suite use pytest-asyncio
        # which closes the running loop on teardown — calling
        # `get_event_loop().run_until_complete(...)` here would raise
        # `RuntimeError: Event loop is closed`. Pre-existing pollution
        # bug; this fix is local + safe.
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_run())
        finally:
            loop.close()

    def test_filtered_sentinel_not_capped(self):
        import matching
        # Therapist that should fail a hard filter — e.g. state mismatch
        t = {
            "full_name": "Bad State",
            "license_state": "NY",
            "is_active": True,
            "specialties": [], "languages": ["English"],
            "insurance_accepted": [], "payment_methods": ["cash"],
            "urgency_capacity": "asap",
        }
        r = {
            "state": "ID", "city": "Boise",
            "languages": ["English"], "concerns": ["anxiety"],
            "payment_method": "cash",
        }
        res = matching.score_therapist(t, r)
        # When filtered, total is -1 (not capped to 99, not bumped to 0).
        # Accept either -1 sentinel OR filtered=True
        if res.get("filtered"):
            assert res.get("total") == -1, f"Expected -1 sentinel, got {res.get('total')}"


# ---------- Task 3: /api/admin/hard-capacity urgency_strict ----------

class TestHardCapacityUrgency:
    def test_urgency_strict_is_not_all_three(self):
        r = requests.get(f"{API}/admin/hard-capacity", headers=ADMIN_HEADERS, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        disabled = data.get("disabled", {})
        urgency_strict = disabled.get("urgency_strict", [])
        # Pre-fix bug: all three were always in the list. After fix, only those
        # buckets whose *count* is below MIN_REQUIRED (30) appear.
        assert set(urgency_strict) != {"asap", "within_2_3_weeks", "within_month"}, (
            f"urgency_strict still contains all three — urgency_capacity was treated as list: {urgency_strict}"
        )
        # Task spec expects ['asap'] only given seed (0/121/121)
        assert "within_2_3_weeks" not in urgency_strict
        assert "within_month" not in urgency_strict

    def test_urgency_counts_present(self):
        r = requests.get(f"{API}/admin/hard-capacity", headers=ADMIN_HEADERS, timeout=20)
        data = r.json()
        counts = data.get("counts", {}).get("urgency", {})
        # all 3 keys present
        for k in ["asap", "within_2_3_weeks", "within_month"]:
            assert k in counts, f"Missing urgency count key {k} in {counts}"
        # Spec: within_2_3_weeks=121, within_month=121 (asap may vary)
        assert counts["within_2_3_weeks"] >= 30, counts
        assert counts["within_month"] >= 30, counts
