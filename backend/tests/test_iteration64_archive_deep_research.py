"""Iteration 64 backend tests:
- POST /api/admin/test-sms (Twilio integration)
- POST /api/admin/therapists/{id}/archive
- POST /api/admin/therapists/{id}/restore
- DELETE /api/admin/therapists/{id} (with apps -> 409, no apps -> 200, missing -> 404)
- POST /api/admin/research-enrichment/deep/{id} (DDG-driven deep enrichment)
- Auth-rejection on the new admin endpoints
- Regression: GET /api/admin/requests/{id} still returns enriched scores
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend env file (we run inside /app)
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_PWD = "admin123!"
ADMIN_HDRS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}

# Existing seed targets supplied in the test brief
ANN_OMODT_ID = "b54d5535-8647-4fe6-9a52-106b1b79632d"
EXISTING_REQ_ID = "14829b06-2d76-4408-a2dc-d920efd3f2e5"


@pytest.fixture(scope="module")
def db():
    client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    return client[os.environ.get("DB_NAME", "test_database")]


# ---------- Twilio SMS ----------
class TestSMS:
    def test_test_sms_returns_ok_and_sid(self):
        r = requests.post(f"{BASE_URL}/api/admin/test-sms", headers=ADMIN_HDRS, json={}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True, data
        sid = data.get("sid") or (data.get("result") or {}).get("sid")
        assert sid and sid.startswith("SM"), f"Expected Twilio SM sid, got: {data}"


# ---------- Archive / Restore ----------
class TestArchiveRestore:
    def test_archive_requires_admin(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/{ANN_OMODT_ID}/archive",
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_restore_requires_admin(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/{ANN_OMODT_ID}/restore",
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_archive_then_restore_roundtrip(self, db):
        # Archive
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/{ANN_OMODT_ID}/archive",
            headers=ADMIN_HDRS, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("archived") is True

        doc = db.therapists.find_one({"id": ANN_OMODT_ID}, {"_id": 0, "is_active": 1, "archived_at": 1})
        assert doc and doc.get("is_active") is False, f"is_active should be False, got {doc}"
        assert doc.get("archived_at"), "archived_at should be set"

        # Restore
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/{ANN_OMODT_ID}/restore",
            headers=ADMIN_HDRS, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("archived") is False

        doc = db.therapists.find_one({"id": ANN_OMODT_ID}, {"_id": 0, "is_active": 1, "archived_at": 1})
        assert doc and doc.get("is_active") is True
        assert "archived_at" not in doc, f"archived_at should be unset, got {doc}"

    def test_archive_nonexistent_returns_404(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/therapists/does-not-exist/archive",
            headers=ADMIN_HDRS, timeout=10,
        )
        assert r.status_code == 404


# ---------- Delete ----------
class TestDeleteTherapist:
    def test_delete_requires_admin(self):
        r = requests.delete(
            f"{BASE_URL}/api/admin/therapists/{ANN_OMODT_ID}",
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_delete_nonexistent_returns_404(self):
        r = requests.delete(
            f"{BASE_URL}/api/admin/therapists/{uuid.uuid4().hex}",
            headers=ADMIN_HDRS, timeout=10,
        )
        assert r.status_code == 404

    def test_delete_with_applications_returns_409(self, db):
        # Insert a temp therapist + a synthetic application referencing it
        tid = "TEST_ITER64_" + uuid.uuid4().hex[:8]
        db.therapists.insert_one({
            "id": tid,
            "name": "TEST_iter64 with apps",
            "source": "test_iter64",
            "is_active": True,
        })
        app_id = "TEST_APP_" + uuid.uuid4().hex[:8]
        db.applications.insert_one({
            "id": app_id,
            "therapist_id": tid,
            "request_id": "TEST_REQ_iter64",
            "status": "pending",
        })
        try:
            r = requests.delete(
                f"{BASE_URL}/api/admin/therapists/{tid}",
                headers=ADMIN_HDRS, timeout=10,
            )
            assert r.status_code == 409, r.text
            detail = (r.json() or {}).get("detail", "")
            assert "Archive instead" in detail, f"Detail should mention 'Archive instead': {detail}"
            # Therapist must still exist
            assert db.therapists.find_one({"id": tid}) is not None
        finally:
            db.applications.delete_one({"id": app_id})
            db.therapists.delete_one({"id": tid})

    def test_delete_fresh_therapist_succeeds(self, db):
        tid = "TEST_ITER64_" + uuid.uuid4().hex[:8]
        db.therapists.insert_one({
            "id": tid,
            "name": "TEST_iter64 fresh delete",
            "source": "test_iter64",
            "is_active": True,
        })
        r = requests.delete(
            f"{BASE_URL}/api/admin/therapists/{tid}",
            headers=ADMIN_HDRS, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True and body.get("deleted") is True
        # Confirm removal
        assert db.therapists.find_one({"id": tid}) is None


# ---------- Deep research enrichment ----------
class TestDeepResearch:
    def test_deep_research_requires_admin(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/deep/{ANN_OMODT_ID}",
            timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_deep_research_nonexistent_returns_404(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/deep/{uuid.uuid4().hex}",
            headers=ADMIN_HDRS, timeout=15,
        )
        assert r.status_code == 404

    def test_deep_research_on_real_therapist(self):
        # DDG + 5 fetches + LLM — generous timeout
        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/deep/{ANN_OMODT_ID}",
            headers=ADMIN_HDRS, timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data.get("deep_mode") is True, data
        assert "summary" in data
        assert "evidence_themes" in data
        assert "depth_signal" in data
        assert isinstance(data.get("public_footprint"), list)
        assert isinstance(data.get("extra_sources"), list)
        assert data.get("therapist_id") == ANN_OMODT_ID


# ---------- Regression: existing enriched request ----------
class TestRegressionEnrichedRequest:
    def test_existing_request_has_enriched_scores(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/requests/{EXISTING_REQ_ID}",
            headers=ADMIN_HDRS, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Look for enriched data on at least one match
        matches = data.get("matches") or data.get("ranked") or []
        if not matches and isinstance(data.get("request"), dict):
            matches = data["request"].get("matches") or []
        # The shape may vary; just ensure that somewhere in the JSON we have enriched_score / research_rationale / score_delta
        blob = repr(data)
        has_enriched = any(k in blob for k in ("enriched_score", "research_rationale", "score_delta", "research_scores"))
        assert has_enriched, "Expected enriched_score / research_rationale / score_delta / research_scores in request detail"
