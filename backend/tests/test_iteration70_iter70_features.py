"""Iter-70 feature regression tests.

Covers:
- Email template preview endpoint (admin)
- matching.score_therapist no-pref + identity priority regression
- research_enrichment._multi_search smoke test
- turnstile_service fail-soft + intake submit without token
- response_quality dict on patient applications
- _explain_match_gap.patient_verified field
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import pytest
import requests
from pymongo import MongoClient

# Make `backend/` importable when pytest is run from repo root.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import v2_request_payload  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}

# Sync mongo client for direct DB writes in tests (avoids motor loop issues).
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
sync_db = MongoClient(MONGO_URL)[DB_NAME]

assert BASE_URL, "REACT_APP_BACKEND_URL is required"


# ─────────────────────────────────────────────────────────────────────
# 1. Email template preview
# ─────────────────────────────────────────────────────────────────────
class TestEmailTemplatePreview:
    def test_preview_verification_default(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/email-templates/verification/preview",
            headers=ADMIN_HEADERS, json={}, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "subject" in d and "html" in d
        assert isinstance(d["subject"], str) and len(d["subject"]) > 0
        assert "<html" in d["html"].lower() or "<body" in d["html"].lower() or "<table" in d["html"].lower()

    def test_preview_patient_results_default(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/email-templates/patient_results/preview",
            headers=ADMIN_HEADERS, json={}, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["subject"]
        assert "html" in d

    def test_preview_therapist_notification_default(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/email-templates/therapist_notification/preview",
            headers=ADMIN_HEADERS, json={}, timeout=20,
        )
        assert r.status_code == 200
        d = r.json()
        assert "Alex" in d["html"]  # first_name preview var

    def test_preview_draft_overrides_without_persisting(self):
        key = "verification"
        # Snapshot saved template before
        before = requests.get(
            f"{BASE_URL}/api/admin/email-templates", headers=ADMIN_HEADERS, timeout=20,
        ).json()
        before_list = before.get("templates") if isinstance(before, dict) else before
        before_tpl = next(
            (t for t in (before_list or []) if (t.get("key") == key)),
            None,
        )

        draft = {"intro": "X-DRAFT-X-INTRO-MARKER", "cta_label": "X-CTA-X-LABEL"}
        r = requests.post(
            f"{BASE_URL}/api/admin/email-templates/{key}/preview",
            headers=ADMIN_HEADERS, json={"draft": draft}, timeout=20,
        )
        assert r.status_code == 200, r.text
        html = r.json()["html"]
        assert "X-DRAFT-X-INTRO-MARKER" in html, "draft intro not rendered"
        assert "X-CTA-X-LABEL" in html, "draft cta_label not rendered"

        # Confirm not persisted
        after = requests.get(
            f"{BASE_URL}/api/admin/email-templates", headers=ADMIN_HEADERS, timeout=20,
        ).json()
        after_list = after.get("templates") if isinstance(after, dict) else after
        after_tpl = next(
            (t for t in (after_list or []) if (t.get("key") == key)),
            None,
        )
        if after_tpl is not None:
            assert "X-DRAFT-X-INTRO-MARKER" not in (after_tpl.get("intro") or "")
            assert "X-CTA-X-LABEL" not in (after_tpl.get("cta_label") or "")
        # And the saved value is unchanged
        if before_tpl is not None and after_tpl is not None:
            assert before_tpl.get("intro") == after_tpl.get("intro")

    def test_preview_invalid_key_returns_404(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/email-templates/__nope__/preview",
            headers=ADMIN_HEADERS, json={}, timeout=20,
        )
        assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────
# 2. matching.score_therapist — no-pref + strict identity should not zero out
# ─────────────────────────────────────────────────────────────────────
class TestMatchingNoPrefStrictIdentity:
    def test_strict_identity_with_no_gender_pref_does_not_zero(self):
        from matching import score_therapist  # noqa: WPS433
        req = {
            **v2_request_payload(),
            "presenting_issues": ["anxiety"],
            "priority_factors": ["identity"],
            "strict_priorities": True,
            "gender_preference": "no_pref",
            "style_preference": [],
        }
        therapist = {
            "id": "t1",
            "name": "T One",
            "gender": "female",
            "licensed_states": ["ID"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": [],
            "general_treats": ["anxiety"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "modality_offering": "both",
            "telehealth": True,
            "offers_in_person": True,
            "office_locations": ["Boise"],
            "insurance_accepted": [],
            "cash_rate": 150,
            "sliding_scale": False,
            "modalities": ["CBT"],
            "style_tags": [],
            "availability_windows": ["weekday_morning"],
            "urgency_capacity": "within_2_3_weeks",
            "is_active": True,
        }
        result = score_therapist(therapist, req)
        # Should not be filtered (None) just because no_pref + identity strict.
        assert result is not None, "Strict-identity with no_pref filtered everyone (regression)"
        score = result if isinstance(result, (int, float)) else result.get("total")
        assert score is not None and score > 0


# ─────────────────────────────────────────────────────────────────────
# 3. research_enrichment._multi_search smoke
# ─────────────────────────────────────────────────────────────────────
class TestMultiSearchSmoke:
    def test_multi_search_does_not_raise(self):
        from research_enrichment import _multi_search  # noqa: WPS433
        try:
            urls = asyncio.run(_multi_search("John Smith LCSW Boise therapist", limit=3))
        except Exception as e:
            pytest.fail(f"_multi_search raised: {e}")
        assert isinstance(urls, list)


# ─────────────────────────────────────────────────────────────────────
# 4. Turnstile fail-soft + intake without token
# ─────────────────────────────────────────────────────────────────────
class TestTurnstileFailSoft:
    def test_verify_token_unset_returns_true(self):
        # Ensure secret is unset for the TEST process; backend itself
        # is what really matters for the integration test below.
        os.environ.pop("TURNSTILE_SECRET_KEY", None)
        from turnstile_service import verify_token  # noqa: WPS433
        ok, err = asyncio.run(verify_token("anything-token", remote_ip="1.2.3.4"))
        assert ok is True
        assert err is None
        ok2, err2 = asyncio.run(verify_token(None))
        assert ok2 is True and err2 is None

    def test_intake_without_turnstile_token_returns_200(self):
        unique = uuid.uuid4().hex[:8]
        payload = v2_request_payload(
            email=f"TEST_iter70_{unique}@example.com",
        )
        # Unique synthetic IP so we don't hit per-IP rate-limit
        ip_octet = int(unique[:2], 16) % 250
        headers = {
            "Content-Type": "application/json",
            "X-Forwarded-For": f"10.71.{ip_octet}.{(ip_octet * 3) % 250}",
        }
        r = requests.post(
            f"{BASE_URL}/api/requests", headers=headers, json=payload, timeout=20,
        )
        assert r.status_code == 200, f"intake failed: {r.status_code} {r.text}"
        data = r.json()
        assert "id" in data
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/admin/requests/{data['id']}",
            headers=ADMIN_HEADERS, timeout=10,
        )


# ─────────────────────────────────────────────────────────────────────
# 5. response_quality dict on applications
# ─────────────────────────────────────────────────────────────────────
class TestResponseQualityBlock:
    def test_response_quality_present_with_anxiety_and_action(self):
        """Set up request → mark verified+matched in DB → seed application
        in DB → call public results endpoint."""
        from datetime import datetime, timezone

        unique = uuid.uuid4().hex[:8]
        ip_octet = int(unique[:2], 16) % 250
        headers_ip = {
            "Content-Type": "application/json",
            "X-Forwarded-For": f"10.72.{ip_octet}.{(ip_octet * 5) % 250}",
        }
        payload = v2_request_payload(email=f"TEST_iter70_rq_{unique}@example.com")
        r = requests.post(
            f"{BASE_URL}/api/requests", headers=headers_ip, json=payload, timeout=20,
        )
        assert r.status_code == 200, r.text
        request_id = r.json()["id"]

        # Find a real therapist
        t = sync_db.therapists.find_one(
            {"is_active": {"$ne": False}, "pending_approval": {"$ne": True}},
            {"_id": 0, "id": 1},
        )
        if not t:
            sync_db.requests.delete_one({"id": request_id})
            pytest.skip("no active therapist to attach")

        now_iso = datetime.now(timezone.utc).isoformat()
        sync_db.requests.update_one(
            {"id": request_id},
            {"$set": {
                "verified": True,
                "status": "matched",
                "matched_at": "2024-01-01T00:00:00+00:00",
                "results_released_at": now_iso,
                "view_token": "VTOKEN-iter70",
            }},
        )
        msg = (
            "Hi — I'd love to support you with anxiety. "
            "I'm available next week for an intake call."
        )
        sync_db.applications.insert_one({
            "id": f"app-iter70-{unique}",
            "request_id": request_id,
            "therapist_id": t["id"],
            "message": msg,
            "match_score": 75.0,
            "created_at": "2024-01-01T01:00:00+00:00",
        })

        try:
            view = requests.get(
                f"{BASE_URL}/api/requests/{request_id}/results",
                params={"t": "VTOKEN-iter70"},
                timeout=20,
            )
            assert view.status_code == 200, view.text
            apps = view.json().get("applications") or []
            assert apps, "no applications returned"
            rq = apps[0].get("response_quality")
            assert isinstance(rq, dict), "response_quality missing"
            for k in ("length", "issue_match", "action_signal", "personal_voice", "total"):
                assert k in rq, f"response_quality missing {k}"
            assert rq["issue_match"] >= 3.0, "anxiety should match"
            assert rq["action_signal"] >= 2.0, "'available next week' should hit action_signal"
            assert rq["personal_voice"] >= 1.0, "I'd / I'm should hit personal_voice"
        finally:
            sync_db.applications.delete_many({"request_id": request_id})
            sync_db.requests.delete_one({"id": request_id})


# ─────────────────────────────────────────────────────────────────────
# 6. _explain_match_gap.patient_verified field
# ─────────────────────────────────────────────────────────────────────
class TestMatchGapPatientVerified:
    def test_unverified_request_match_gap_patient_verified_false(self):
        unique = uuid.uuid4().hex[:8]
        ip_octet = int(unique[:2], 16) % 250
        headers_ip = {
            "Content-Type": "application/json",
            "X-Forwarded-For": f"10.73.{ip_octet}.{(ip_octet * 7) % 250}",
        }
        payload = v2_request_payload(email=f"TEST_iter70_gap_{unique}@example.com")
        r = requests.post(
            f"{BASE_URL}/api/requests", headers=headers_ip, json=payload, timeout=20,
        )
        assert r.status_code == 200, r.text
        request_id = r.json()["id"]
        try:
            ag = requests.get(
                f"{BASE_URL}/api/admin/requests/{request_id}",
                headers=ADMIN_HEADERS, timeout=20,
            )
            assert ag.status_code == 200, ag.text
            mg = ag.json().get("match_gap") or {}
            assert mg, "match_gap should be populated for unverified low-notify request"
            assert mg.get("patient_verified") is False
            assert "verified" in (mg.get("summary") or "").lower()
        finally:
            requests.delete(
                f"{BASE_URL}/api/admin/requests/{request_id}",
                headers=ADMIN_HEADERS, timeout=10,
            )

    def test_verified_request_match_gap_patient_verified_true(self):
        unique = uuid.uuid4().hex[:8]
        ip_octet = int(unique[:2], 16) % 250
        headers_ip = {
            "Content-Type": "application/json",
            "X-Forwarded-For": f"10.74.{ip_octet}.{(ip_octet * 11) % 250}",
        }
        payload = v2_request_payload(email=f"TEST_iter70_gap2_{unique}@example.com")
        r = requests.post(
            f"{BASE_URL}/api/requests", headers=headers_ip, json=payload, timeout=20,
        )
        assert r.status_code == 200, r.text
        request_id = r.json()["id"]
        try:
            sync_db.requests.update_one(
                {"id": request_id},
                {"$set": {
                    "verified": True,
                    "status": "matched",
                    "notified_therapist_ids": [],
                }},
            )
            ag = requests.get(
                f"{BASE_URL}/api/admin/requests/{request_id}",
                headers=ADMIN_HEADERS, timeout=20,
            )
            assert ag.status_code == 200
            mg = ag.json().get("match_gap")
            assert mg, "match_gap should be populated when notified < 30"
            assert mg.get("patient_verified") is True
            s = (mg.get("summary") or "").lower()
            assert "verified their email" not in s
            assert "notified" in s or "target" in s
        finally:
            sync_db.requests.delete_one({"id": request_id})
