"""TheraVoca iter-8: Payment & Insurance UI/data-model sync tests.

Validates new payment fields persist end-to-end:
- Patient request: insurance_name, budget, sliding_scale_ok
- Therapist signup: insurance_accepted, cash_rate, sliding_scale
- Matching engine still filters correctly with new fields
"""
from __future__ import annotations

import os
import sys
import uuid

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from matching import rank_therapists  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PASSWORD = "admin123!"
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ─── Patient intake: payment fields persistence ───────────────────────────────
class TestPatientPaymentFields:
    def _payload(self, **overrides):
        base = {
            "email": f"theravoca+iter8_{uuid.uuid4().hex[:6]}@gmail.com",
            "location_state": "ID",
            "location_city": "Boise",
            "location_zip": "83702",
            "client_type": "individual",
            "age_group": "adult",
            "payment_type": "either",
            "insurance_name": "Blue Cross of Idaho",
            "budget": 175,
            "sliding_scale_ok": True,
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_evening"],
            "modality_preference": "telehealth_only",
            "urgency": "within_month",
            "prior_therapy": "no",
            "experience_preference": "no_pref",
            "gender_preference": "no_pref",
            "gender_required": False,
            "style_preference": ["warm_supportive"],
        }
        base.update(overrides)
        return base

    def test_either_with_insurance_and_budget_persists(self, session):
        r = session.post(f"{API}/requests", json=self._payload())
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        d = session.get(f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS, timeout=15)
        assert d.status_code == 200
        req_doc = d.json()["request"]
        assert req_doc["insurance_name"] == "Blue Cross of Idaho"
        assert req_doc["budget"] == 175
        assert req_doc["sliding_scale_ok"] is True
        assert req_doc["payment_type"] == "either"

    def test_insurance_only_persists(self, session):
        p = self._payload(payment_type="insurance", insurance_name="Aetna",
                          budget=None, sliding_scale_ok=False)
        r = session.post(f"{API}/requests", json=p)
        assert r.status_code == 200
        rid = r.json()["id"]
        d = session.get(f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS).json()
        assert d["request"]["insurance_name"] == "Aetna"
        assert d["request"]["sliding_scale_ok"] is False

    def test_cash_only_persists(self, session):
        p = self._payload(payment_type="cash", insurance_name="",
                          budget=120, sliding_scale_ok=True)
        r = session.post(f"{API}/requests", json=p)
        assert r.status_code == 200
        rid = r.json()["id"]
        d = session.get(f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS).json()
        assert d["request"]["budget"] == 120
        assert d["request"]["sliding_scale_ok"] is True
        assert d["request"]["payment_type"] == "cash"

    def test_idaho_insurer_options_accepted(self, session):
        # Spot-check a few from PATIENT_INSURER_OPTIONS
        for ins in ["Regence BlueShield of Idaho", "SelectHealth", "Idaho Medicaid",
                    "Tricare West", "Other / not listed"]:
            p = self._payload(payment_type="insurance", insurance_name=ins, budget=None)
            r = session.post(f"{API}/requests", json=p)
            assert r.status_code == 200, f"Failed for insurer {ins}: {r.text}"
            rid = r.json()["id"]
            d = session.get(f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS).json()
            assert d["request"]["insurance_name"] == ins


# ─── Therapist signup with sliding_scale + insurance + cash_rate ──────────────
class TestTherapistSignupIter8:
    def test_signup_with_sliding_scale_and_multi_insurance(self, session):
        email = f"theravoca+t_iter8_{uuid.uuid4().hex[:6]}@example.com"
        payload = {
            "name": "TEST Iter8 Therapist",
            "email": email,
            "phone": "208-555-9001",
            "gender": "female",
            "licensed_states": ["ID"],
            "client_types": ["individual", "couples"],
            "age_groups": ["adult", "young_adult"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": ["depression"],
            "general_treats": ["life_transitions"],
            "modalities": ["CBT", "ACT"],
            "modality_offering": "both",
            "office_locations": ["Boise, ID"],
            "insurance_accepted": ["Blue Cross of Idaho", "Aetna", "Idaho Medicaid"],
            "cash_rate": 145,
            "sliding_scale": True,
            "years_experience": 7,
            "availability_windows": ["weekday_evening", "weekend_morning"],
            "urgency_capacity": "within_month",
            "style_tags": ["warm_supportive"],
            "free_consult": True,
            "bio": "Test bio iter8",
        }
        r = session.post(f"{API}/therapists/signup", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        # Verify in admin pending list
        therapists = session.get(
            f"{API}/admin/therapists?pending=true",
            headers=ADMIN_HEADERS, timeout=30,
        ).json()
        match = next((t for t in therapists if t["id"] == tid), None)
        assert match is not None, "Newly signed-up therapist not in pending list"
        assert match["insurance_accepted"] == ["Blue Cross of Idaho", "Aetna", "Idaho Medicaid"]
        assert match["cash_rate"] == 145
        assert match["sliding_scale"] is True
        assert match["telehealth"] is True
        assert match["offers_in_person"] is True

        # Cleanup
        session.post(f"{API}/admin/therapists/{tid}/reject",
                     headers=ADMIN_HEADERS, timeout=15)

    def test_signup_sliding_scale_default_false(self, session):
        email = f"theravoca+t_iter8b_{uuid.uuid4().hex[:6]}@example.com"
        payload = {
            "name": "TEST Iter8b Therapist",
            "email": email,
            "gender": "male",
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["depression"],
            "modalities": ["CBT"],
            "modality_offering": "telehealth",
            "insurance_accepted": [],
            "cash_rate": 200,
            "availability_windows": ["weekday_morning"],
            "urgency_capacity": "asap",
            "style_tags": ["structured"],
        }
        r = session.post(f"{API}/therapists/signup", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        therapists = session.get(
            f"{API}/admin/therapists?pending=true",
            headers=ADMIN_HEADERS, timeout=30,
        ).json()
        match = next((t for t in therapists if t["id"] == tid), None)
        assert match is not None
        assert match.get("sliding_scale") is False, "sliding_scale should default to False"
        session.post(f"{API}/admin/therapists/{tid}/reject",
                     headers=ADMIN_HEADERS, timeout=15)


# ─── Matching engine regression: insurance hard filter still works ────────────
class TestMatchingRegressionIter8:
    @pytest.fixture(scope="class")
    def therapists(self, session):
        r = session.get(f"{API}/admin/therapists", headers=ADMIN_HEADERS, timeout=30)
        return [t for t in r.json() if t.get("source") == "seed_v2"]

    def test_blue_cross_filter(self, therapists):
        req = {
            "email": "x@y.com",
            "location_state": "ID",
            "client_type": "individual",
            "age_group": "adult",
            "payment_type": "insurance",
            "insurance_name": "Blue Cross of Idaho",
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_evening"],
            "modality_preference": "hybrid",
            "urgency": "within_month",
            "prior_therapy": "no",
            "experience_preference": "no_pref",
            "gender_preference": "no_pref",
            "gender_required": False,
            "style_preference": [],
        }
        ranked = rank_therapists(therapists, req, threshold=0, min_results=0)
        assert len(ranked) > 0, "Expected at least some Blue Cross therapists"
        for t in ranked:
            accepted = [i.lower() for i in t.get("insurance_accepted") or []]
            assert "blue cross of idaho" in accepted, (
                f"Therapist {t['id']} doesn't accept Blue Cross of Idaho: {accepted}"
            )


# ─── Regression: admin login + dashboard endpoints still healthy ─────────────
class TestAdminRegressionIter8:
    def test_admin_login(self, session):
        r = session.post(f"{API}/admin/login", json={"password": ADMIN_PASSWORD}, timeout=10)
        assert r.status_code == 200

    def test_admin_stats(self, session):
        r = session.get(f"{API}/admin/stats", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200
        assert "default_threshold" in r.json()

    def test_admin_pending_therapists_list(self, session):
        r = session.get(f"{API}/admin/therapists?pending=true",
                        headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
