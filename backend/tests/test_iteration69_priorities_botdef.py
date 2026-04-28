"""Iter-69: bot defenses + priority-factor matching tests."""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

from tests.conftest import v2_request_payload  # type: ignore

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


def _payload(**over):
    p = v2_request_payload(**over)
    # Ensure timing heuristic passes by default (>2s back in time)
    p.setdefault("form_started_at_ms", int(time.time() * 1000) - 5_000)
    p.setdefault("priority_factors", [])
    p.setdefault("strict_priorities", False)
    p.setdefault("fax_number", "")
    return p


# ─── Bot defenses ─────────────────────────────────────────────────────────

class TestBotDefenses:
    def test_honeypot_rejects(self):
        body = _payload(
            email=f"TEST_hp_{uuid.uuid4().hex[:6]}@example.com",
            fax_number="bot-was-here",
        )
        r = requests.post(f"{API}/requests", json=body, timeout=15)
        assert r.status_code == 400, r.text
        assert "Submission rejected" in r.text

    def test_timing_too_fast_rejects(self):
        body = _payload(
            email=f"TEST_fast_{uuid.uuid4().hex[:6]}@example.com",
            form_started_at_ms=int(time.time() * 1000) - 500,  # 0.5s
        )
        r = requests.post(f"{API}/requests", json=body, timeout=15)
        assert r.status_code == 400, r.text
        assert "Submission rejected" in r.text

    def test_ip_rate_limit_4th_is_429(self):
        # Use unique email per call to avoid email rate-limit (1/hr).
        # IP is taken from x-forwarded-for or socket.host. We send xff
        # so all 4 attempts share a synthetic IP unique to this test.
        synthetic_ip = f"10.99.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        headers = {"x-forwarded-for": synthetic_ip}
        statuses = []
        for i in range(4):
            body = _payload(
                email=f"TEST_iprl_{uuid.uuid4().hex[:6]}_{i}@example.com",
            )
            r = requests.post(
                f"{API}/requests", json=body, headers=headers, timeout=15
            )
            statuses.append(r.status_code)
            if i == 3:
                # 4th submission should hit per-IP cap (>=3 already logged)
                assert r.status_code == 429, f"Expected 429, got {r.status_code}: {r.text}"
                assert "Too many submissions from this network" in r.text
        # First 3 should be 200
        assert statuses[:3] == [200, 200, 200], statuses


# ─── Valid intake with new fields ─────────────────────────────────────────

class TestPriorityIntake:
    def test_intake_with_priority_factors_persists(self):
        body = _payload(
            email=f"TEST_pri_{uuid.uuid4().hex[:6]}@example.com",
            priority_factors=["specialty", "schedule"],
            strict_priorities=False,
        )
        # Use unique IP to dodge prior tests
        headers = {"x-forwarded-for": f"10.50.{uuid.uuid4().int % 250}.5"}
        r = requests.post(
            f"{API}/requests", json=body, headers=headers, timeout=15
        )
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # Verify persistence via public view
        get_r = requests.get(f"{API}/requests/{rid}/public", timeout=15)
        assert get_r.status_code == 200
        data = get_r.json()
        assert data.get("priority_factors") == ["specialty", "schedule"]
        assert data.get("strict_priorities") is False
        # Bot-defense fields must NOT be persisted
        assert "fax_number" not in data
        assert "form_started_at_ms" not in data


# ─── Matching weight unit tests ───────────────────────────────────────────

class TestPriorityWeights:
    def test_specialty_priority_boosts_issues_axis(self):
        from matching import _priority_weights, score_therapist

        w = _priority_weights(["specialty"])
        assert w["issues"] == 1.8
        assert w["modality"] == 1.0
        assert w["availability"] == 1.0

        therapist = {
            "id": "t1",
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["anxiety"],
            "modality_offering": "both",
            "gender": "female",
            "years_experience": 5,
            "availability_windows": ["weekday_morning"],
            "urgency_capacity": "within_2_3_weeks",
            "style_tags": [],
            "modalities": ["CBT"],
            "insurance_accepted": [],
        }
        req_no_pri = {
            "location_state": "ID",
            "client_type": "individual",
            "age_group": "adult",
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_morning"],
            "modality_preference": "hybrid",
            "urgency": "flexible",
            "prior_therapy": "not_sure",
            "experience_preference": "no_pref",
            "gender_preference": "no_pref",
            "style_preference": [],
            "payment_type": "either",
        }
        req_pri = {**req_no_pri, "priority_factors": ["specialty"]}

        base = score_therapist(therapist, req_no_pri)
        boosted = score_therapist(therapist, req_pri)
        assert base["filtered"] is False
        assert boosted["filtered"] is False
        # Issues axis must be 1.8x in the boosted breakdown
        base_issues = base["breakdown"]["issues"]
        boosted_issues = boosted["breakdown"]["issues"]
        assert boosted_issues == pytest.approx(base_issues * 1.8, rel=0.02), (
            base_issues, boosted_issues,
        )

    def test_strict_mode_filters_zero_axis(self):
        from matching import score_therapist

        # Therapist scores 0 on identity (no_pref gender → 0, no style overlap)
        therapist = {
            "id": "t2",
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["anxiety"],
            "modality_offering": "both",
            "gender": "male",
            "style_tags": [],
            "years_experience": 5,
            "availability_windows": ["weekday_morning"],
            "urgency_capacity": "within_2_3_weeks",
        }
        req = {
            "location_state": "ID",
            "client_type": "individual",
            "age_group": "adult",
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_morning"],
            "modality_preference": "hybrid",
            "urgency": "flexible",
            "prior_therapy": "not_sure",
            "gender_preference": "female",  # not required → soft
            "gender_required": False,
            "style_preference": ["warm_supportive"],  # therapist has none
            "payment_type": "either",
            "priority_factors": ["identity"],
            "strict_priorities": True,
        }
        result = score_therapist(therapist, req)
        # gender axis = 0 (male != female) and style axis = 0 (no overlap)
        # → strict mode must filter out
        assert result["total"] == -1
        assert result["filtered"] is True
        assert "strict_priority" in result.get("filter_failed", "")
