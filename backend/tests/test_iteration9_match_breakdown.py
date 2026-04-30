"""TheraVoca iter-9: match_breakdown transparency on patient results.

Validates:
- _trigger_matching writes notified_breakdowns on the request doc
- GET /api/requests/{id}/results returns match_breakdown per application
- Backwards-compat: requests without notified_breakdowns return empty {} per app
- email_service.send_patient_results renders chip block when breakdown present
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from unittest.mock import patch

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import email_service  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"}

AXIS_KEYS = {"issues", "availability", "modality", "urgency",
             "prior_therapy", "experience", "gender", "style", "payment_fit",
             "modality_pref"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _payload(**overrides):
    base = {
        "email": f"theravoca+iter9_{uuid.uuid4().hex[:6]}@gmail.com",
        "location_state": "ID",
        "location_city": "Boise",
        "location_zip": "83702",
        "client_type": "individual",
        "age_group": "adult",
        "payment_type": "either",
        "presenting_issues": ["anxiety", "depression"],
        "availability_windows": ["weekday_evening", "weekend_morning"],
        "modality_preference": "telehealth_only",
        "urgency": "asap",
        "prior_therapy": "no",
        "experience_preference": "3-7",
        "gender_preference": "no_pref",
        "gender_required": False,
        "style_preference": ["warm_supportive"],
    }
    base.update(overrides)
    return base


# ─── Backend: notified_breakdowns persistence ────────────────────────────────
class TestNotifiedBreakdownsPersistence:
    @pytest.fixture(scope="class")
    def matched_request(self, session):
        r = session.post(f"{API}/requests", json=_payload())
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        rr = session.post(f"{API}/admin/requests/{rid}/resend-notifications",
                          headers=ADMIN_HEADERS, timeout=60)
        assert rr.status_code == 200, rr.text
        return rid

    def test_admin_request_doc_has_notified_breakdowns(self, session, matched_request):
        d = session.get(f"{API}/admin/requests/{matched_request}",
                        headers=ADMIN_HEADERS, timeout=15)
        assert d.status_code == 200
        req_doc = d.json()["request"]
        assert "notified_breakdowns" in req_doc, "notified_breakdowns missing on req doc"
        bds = req_doc["notified_breakdowns"]
        assert isinstance(bds, dict)
        notified_ids = req_doc.get("notified_therapist_ids") or []
        if notified_ids:
            assert len(bds) >= 1, "Expected at least one breakdown stored"
            # Each breakdown has all 8 axes with numeric values
            for tid, bd in bds.items():
                assert isinstance(bd, dict)
                assert set(bd.keys()) == AXIS_KEYS, f"Bad axes for {tid}: {bd.keys()}"
                for k, v in bd.items():
                    assert isinstance(v, (int, float)), f"{k}={v!r} not numeric"


# ─── Backend: GET /api/requests/{id}/results includes match_breakdown ────────
class TestResultsEndpointBreakdown:
    @pytest.fixture(scope="class")
    def request_with_application(self, session):
        # 1. create request
        rid = session.post(f"{API}/requests", json=_payload()).json()["id"]
        # 2. trigger matching (creates notified_scores + notified_breakdowns)
        session.post(f"{API}/admin/requests/{rid}/resend-notifications",
                     headers=ADMIN_HEADERS, timeout=60)
        # 3. get a notified therapist id
        d = session.get(f"{API}/admin/requests/{rid}",
                        headers=ADMIN_HEADERS, timeout=15).json()
        notified = d["notified"]
        if not notified:
            pytest.skip("No therapists notified — cannot test results endpoint")
        tid = notified[0]["id"]
        # 4. submit application (long message for nice rendering)
        msg = ("Hello, I would be honored to support you on your journey. "
               "I've worked with similar concerns for years and offer a warm, "
               "structured approach. Looking forward to connecting!" * 2)
        a = session.post(f"{API}/therapist/apply/{rid}/{tid}",
                         json={"message": msg}, timeout=15)
        assert a.status_code == 200, a.text
        return rid, tid

    def test_results_endpoint_returns_match_breakdown(self, session, request_with_application):
        rid, tid = request_with_application
        # Iter-13: release the 24h hold so apps are visible
        session.post(f"{API}/admin/requests/{rid}/release-results",
                     headers=ADMIN_HEADERS, timeout=15)
        r = session.get(f"{API}/requests/{rid}/results", timeout=15)
        assert r.status_code == 200
        body = r.json()
        apps = body["applications"]
        assert len(apps) >= 1, "Expected at least 1 application"
        app = next((a for a in apps if a["therapist_id"] == tid), None)
        assert app is not None, "Application for our therapist not in results"
        assert "match_breakdown" in app, "match_breakdown missing"
        bd = app["match_breakdown"]
        assert isinstance(bd, dict)
        assert set(bd.keys()) == AXIS_KEYS, f"Got axes: {bd.keys()}"
        for k, v in bd.items():
            assert isinstance(v, (int, float)), f"{k}={v!r} not numeric"
        # at least the issues axis should score >0 since we picked anxiety+depression
        assert bd["issues"] > 0, f"Expected issues axis > 0, got {bd}"


# ─── Backend regression: legacy request without notified_breakdowns ──────────
class TestBackwardsCompatLegacyRequest:
    """Simulate an in-flight request that pre-dates iter-9 (no notified_breakdowns key)
    by directly inserting via mongo-equivalent: create new request, manually unset
    notified_breakdowns, then verify endpoint still returns apps with empty {} bd.
    """

    def test_legacy_request_returns_empty_breakdown(self, session):
        # Create + match
        rid = session.post(f"{API}/requests", json=_payload()).json()["id"]
        session.post(f"{API}/admin/requests/{rid}/resend-notifications",
                     headers=ADMIN_HEADERS, timeout=60)
        d = session.get(f"{API}/admin/requests/{rid}",
                        headers=ADMIN_HEADERS, timeout=15).json()
        notified = d["notified"]
        if not notified:
            pytest.skip("No therapists notified")
        tid = notified[0]["id"]
        session.post(f"{API}/therapist/apply/{rid}/{tid}",
                     json={"message": "Short legacy app message for testing."},
                     timeout=15)

        # Wipe notified_breakdowns to simulate legacy doc
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def _unset():
            c = AsyncIOMotorClient(mongo_url)
            await c[db_name].requests.update_one(
                {"id": rid}, {"$unset": {"notified_breakdowns": ""}}
            )
            c.close()

        asyncio.new_event_loop().run_until_complete(_unset())

        # Iter-13: 24h hold — release so apps are visible
        session.post(f"{API}/admin/requests/{rid}/release-results",
                     headers=ADMIN_HEADERS, timeout=15)

        # Endpoint should still respond cleanly
        r = session.get(f"{API}/requests/{rid}/results", timeout=15)
        assert r.status_code == 200, r.text
        apps = r.json()["applications"]
        assert len(apps) >= 1
        for a in apps:
            assert "match_breakdown" in a
            assert a["match_breakdown"] == {}, (
                f"Expected empty dict for legacy req, got {a['match_breakdown']}"
            )


# ─── Email service: send_patient_results renders chips when bd present ────────
class _MockDb:
    """Stand-in for Motor's AsyncIOMotorDatabase. Returns no overrides so
    email_service falls back to DEFAULTS (no event loop binding required).
    `requests` attribute added because `send_patient_results` now reads
    the request doc to surface site-copy / banner overrides; an empty
    find_one is enough to keep that branch happy in the unit test."""

    class _Coll:
        async def find_one(self, *args, **kwargs):
            return None

    email_templates = _Coll()
    requests = _Coll()


class TestEmailRendering:
    def test_send_patient_results_renders_why_chips(self):
        captured = {}

        async def fake_send(to, subject, html):
            captured["to"] = to
            captured["subject"] = subject
            captured["html"] = html

        applications = [
            {
                "id": "a1",
                "request_id": "r1",
                "therapist_id": "t1",
                "match_score": 92,
                "message": "I'd love to help you with anxiety and your schedule.",
                "match_breakdown": {
                    "issues": 35,        # 100% -> surface
                    "availability": 20,  # 100% -> surface
                    "modality": 15,      # 100% -> surface
                    "urgency": 5,        # 50% -> surface (but cap to top 3)
                    "prior_therapy": 0,
                    "experience": 0,
                    "gender": 0,
                    "style": 0,
                },
                "therapist": {
                    "id": "t1",
                    "name": "Dr. Test Therapist",
                    "email": "t@x.com",
                    "phone": "208-555-0101",
                    "cash_rate": 150,
                    "free_consult": True,
                    "years_experience": 8,
                    "specialties_display": ["Anxiety", "Depression"],
                },
            }
        ]

        with patch.object(email_service, "_send", new=fake_send), \
             patch.object(email_service, "_db", new=lambda: _MockDb()):
            asyncio.run(
                email_service.send_patient_results("p@x.com", "r1", applications)
            )

        html = captured.get("html", "")
        assert "Why we matched" in html, "Chip header missing in email html"
        assert "Specializes in your concerns" in html
        assert "Matches your schedule" in html
        assert "Offers your preferred format" in html
        # urgency at 50% should be in there as 3rd chip (top 3)
        # but we ALSO need to make sure axes below 50% don't show
        assert "Aligns with your style preference" not in html
        assert "Matches your gender preference" not in html

    def test_send_patient_results_no_chips_when_breakdown_empty(self):
        captured = {}

        async def fake_send(to, subject, html):
            captured["html"] = html

        applications = [
            {
                "id": "a1",
                "request_id": "r1",
                "therapist_id": "t1",
                "match_score": 65,
                "message": "Short msg.",
                "match_breakdown": {},  # legacy empty
                "therapist": {
                    "id": "t1", "name": "Dr. NoBd", "email": "t@x.com",
                    "phone": "", "cash_rate": 100, "free_consult": False,
                    "years_experience": 3, "specialties_display": ["X"],
                },
            }
        ]

        with patch.object(email_service, "_send", new=fake_send), \
             patch.object(email_service, "_db", new=lambda: _MockDb()):
            asyncio.run(
                email_service.send_patient_results("p@x.com", "r1", applications)
            )
        html = captured["html"]
        # Header should NOT appear when breakdown is empty
        assert "Why we matched" not in html
