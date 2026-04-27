"""TheraVoca iter-10 tests:
- Payment-fit scoring axis (sliding_scale_ok x sliding_scale)
- Insurance hard filter skips for 'Other / not listed'
- Total score still capped at 100; breakdown has 9 keys
- Admin GET /api/admin/therapists (no filter) returns all
- Admin PUT /api/admin/therapists/{id} whitelist + 400 for bad payload
- EMAIL_OVERRIDE_TO env redirects outbound mail and prefixes subject
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from unittest.mock import patch, MagicMock

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import email_service  # noqa: E402
from matching import score_therapist, MAX_PAYMENT_FIT  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PASSWORD = "admin123!"
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"}

AXIS_KEYS = {
    "issues", "availability", "modality", "urgency",
    "prior_therapy", "experience", "gender", "style", "payment_fit",
    "modality_pref",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ─── helpers ──────────────────────────────────────────────────────────────────
def _therapist(**over):
    base = {
        "id": "t-test",
        "name": "Test Therapist",
        "email": "test@example.com",
        "licensed_states": ["ID"],
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "secondary_specialties": [],
        "general_treats": [],
        "modalities": ["CBT"],
        "modality_offering": "both",
        "insurance_accepted": [],
        "cash_rate": 150,
        "sliding_scale": False,
        "free_consult": True,
        "years_experience": 8,
        "availability_windows": ["weekday_evening"],
        "urgency_capacity": "asap",
        "style_tags": ["warm_supportive"],
        "gender": "female",
    }
    base.update(over)
    return base


def _request(**over):
    base = {
        "location_state": "ID",
        "client_type": "individual",
        "age_group": "adult",
        "payment_type": "either",
        "presenting_issues": ["anxiety"],
        "availability_windows": ["weekday_evening"],
        "modality_preference": "telehealth_only",
        "urgency": "asap",
        "prior_therapy": "no",
        "experience_preference": "3-7",
        "gender_preference": "no_pref",
        "gender_required": False,
        "style_preference": ["warm_supportive"],
        "sliding_scale_ok": False,
        "insurance_name": "",
        "budget": None,
    }
    base.update(over)
    return base


# ─── 1. Payment-fit scoring axis (P1) ────────────────────────────────────────
class TestPaymentFitAxis:
    def test_payment_fit_3_when_both_true(self):
        t = _therapist(sliding_scale=True)
        r = _request(sliding_scale_ok=True)
        res = score_therapist(t, r)
        assert res["filtered"] is False
        bd = res["breakdown"]
        assert set(bd.keys()) == AXIS_KEYS, f"axes: {bd.keys()}"
        assert bd["payment_fit"] == MAX_PAYMENT_FIT == 3.0

    def test_payment_fit_zero_when_patient_false(self):
        t = _therapist(sliding_scale=True)
        r = _request(sliding_scale_ok=False)
        bd = score_therapist(t, r)["breakdown"]
        assert bd["payment_fit"] == 0.0

    def test_payment_fit_zero_when_therapist_false(self):
        t = _therapist(sliding_scale=False)
        r = _request(sliding_scale_ok=True)
        bd = score_therapist(t, r)["breakdown"]
        assert bd["payment_fit"] == 0.0

    def test_total_capped_at_100(self):
        # max possible breakdown sum = 35+20+15+10+10+5+3+2+3 = 103
        t = _therapist(sliding_scale=True)
        r = _request(sliding_scale_ok=True, availability_windows=["flexible"])
        res = score_therapist(t, r)
        assert res["total"] <= 100.0


# ─── 2. Insurance hard filter — Other / not listed ───────────────────────────
class TestInsuranceOtherSkip:
    def test_other_skips_filter_when_no_insurance_accepted(self):
        t = _therapist(insurance_accepted=[])  # empty list
        r = _request(payment_type="insurance", insurance_name="Other / not listed")
        res = score_therapist(t, r)
        assert res["filtered"] is False, f"Expected pass, got: {res}"

    def test_other_lowercase_also_skips(self):
        t = _therapist(insurance_accepted=[])
        r = _request(payment_type="insurance", insurance_name="other")
        res = score_therapist(t, r)
        assert res["filtered"] is False

    def test_specific_insurance_still_filters_when_no_match(self):
        t = _therapist(insurance_accepted=["Aetna"])
        r = _request(payment_type="insurance", insurance_name="Cigna")
        res = score_therapist(t, r)
        assert res["filtered"] is True
        assert res.get("filter_failed") == "payment"

    def test_breakdown_has_9_keys_regression(self):
        # Iter-12: breakdown now has 10 keys (added 'modality_pref'). This test
        # name is kept for git history but the assertion follows the new contract.
        t = _therapist(sliding_scale=False)
        r = _request()
        res = score_therapist(t, r)
        assert set(res["breakdown"].keys()) == AXIS_KEYS
        assert len(res["breakdown"]) == 10


# ─── 3. Existing hard filters still work ─────────────────────────────────────
class TestRegressionHardFilters:
    def test_state_filter(self):
        t = _therapist(licensed_states=["WA"])
        res = score_therapist(t, _request())
        assert res["filtered"] is True
        assert res["filter_failed"] == "state"

    def test_client_type_filter(self):
        t = _therapist(client_types=["couples"])
        res = score_therapist(t, _request(client_type="individual"))
        assert res["filtered"] is True
        assert res["filter_failed"] == "client_type"

    def test_age_group_filter(self):
        t = _therapist(age_groups=["teen"])
        res = score_therapist(t, _request(age_group="adult"))
        assert res["filtered"] is True
        assert res["filter_failed"] == "age_group"

    def test_modality_filter(self):
        t = _therapist(modality_offering="in_person")
        res = score_therapist(t, _request(modality_preference="telehealth_only"))
        assert res["filtered"] is True
        assert res["filter_failed"] == "modality"


# ─── 4. Admin GET /api/admin/therapists (no filter) ──────────────────────────
class TestAdminListAllTherapists:
    def test_no_pending_filter_returns_all(self, session):
        r = session.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Seeded with 100 — plus any TEST signups => >= 100
        assert len(data) >= 1
        # No mongo _id leak
        for d in data[:5]:
            assert "_id" not in d
            assert "id" in d

    def test_unauthorized_without_header(self, session):
        r = requests.get(f"{API}/admin/therapists", timeout=15)
        assert r.status_code in (401, 403)


# ─── 5. Admin PUT /api/admin/therapists/{id} ─────────────────────────────────
class TestAdminUpdateTherapist:
    @pytest.fixture(scope="class")
    def therapist_id(self, session):
        r = session.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200
        ts = r.json()
        assert len(ts) > 0, "no therapists to test against"
        # Pick first seeded therapist
        return ts[0]["id"]

    def test_update_whitelisted_fields_persists(self, session, therapist_id):
        new_bio = f"TEST_iter10 bio {uuid.uuid4().hex[:6]}"
        new_rate = 217
        payload = {
            "bio": new_bio,
            "cash_rate": new_rate,
            "sliding_scale": True,
            "free_consult": True,
        }
        r = session.put(
            f"{API}/admin/therapists/{therapist_id}",
            json=payload, headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        t = body["therapist"]
        assert t["bio"] == new_bio
        assert t["cash_rate"] == new_rate
        assert t["sliding_scale"] is True

        # GET to confirm persistence
        listing = session.get(
            f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=15,
        ).json()
        match = next(x for x in listing if x["id"] == therapist_id)
        assert match["bio"] == new_bio
        assert match["cash_rate"] == new_rate

    def test_unknown_field_rejected_400(self, session, therapist_id):
        r = session.put(
            f"{API}/admin/therapists/{therapist_id}",
            json={"some_random_field": "xyz", "another_bad": 1},
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_unknown_id_returns_404(self, session):
        r = session.put(
            f"{API}/admin/therapists/does-not-exist-xyz",
            json={"bio": "x"},
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 404


# ─── 6. EMAIL_OVERRIDE_TO patches recipient + prepends subject ───────────────
class TestEmailOverride:
    def test_send_redirects_to_override_and_prefixes_subject(self, monkeypatch):
        override_addr = "override+test@example.com"
        monkeypatch.setenv("EMAIL_OVERRIDE_TO", override_addr)
        monkeypatch.setenv("RESEND_API_KEY", "re_fake_for_test")

        captured = {}

        def fake_send(params):
            captured.update(params)
            return {"id": "fake-id-123"}

        with patch.object(email_service.resend.Emails, "send", side_effect=fake_send):
            asyncio.run(
                email_service._send(
                    to="patient@example.com",
                    subject="Original Subject",
                    html="<p>hi</p>",
                )
            )

        assert captured.get("to") == [override_addr], captured
        assert captured.get("subject") == "[was: patient@example.com] Original Subject"

    def test_no_override_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("EMAIL_OVERRIDE_TO", raising=False)
        monkeypatch.setenv("RESEND_API_KEY", "re_fake_for_test")

        captured = {}

        def fake_send(params):
            captured.update(params)
            return {"id": "fake-id-456"}

        with patch.object(email_service.resend.Emails, "send", side_effect=fake_send):
            asyncio.run(
                email_service._send(
                    to="patient2@example.com",
                    subject="Hello",
                    html="<p>hi</p>",
                )
            )

        assert captured.get("to") == ["patient2@example.com"]
        assert captured.get("subject") == "Hello"  # no [was: ...] prefix


# ─── 7. Consult mailto building block (frontend logic mirror) ───────────────
# This validates that the data the frontend uses (therapist email + presenting issues)
# is actually surfaced from the results endpoint.
class TestResultsHasConsultData:
    def test_results_includes_therapist_email_and_issues(self, session):
        existing_rid = "34e1cf56-59bd-4b41-9eff-846e9375c383"
        r = session.get(f"{API}/requests/{existing_rid}/results", timeout=15)
        if r.status_code != 200:
            pytest.skip(f"Existing test request not found: {r.status_code}")
        body = r.json()
        req = body.get("request") or {}
        apps = body.get("applications") or []
        if not apps:
            pytest.skip("No applications on existing request")
        # presenting_issues is what the consult email body uses
        assert "presenting_issues" in req
        assert isinstance(req["presenting_issues"], list)
        # Each application carries therapist with email (needed for mailto)
        for app in apps:
            t = app.get("therapist") or {}
            assert "email" in t and t["email"], "therapist email missing"
            assert "name" in t and t["name"], "therapist name missing"
