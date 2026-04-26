"""TheraVoca iter-12 features:
- 10-key matching breakdown with 'modality_pref' axis
- Editable email templates GET/PUT /api/admin/email-templates
- 'Hi {first_name},' greeting normalization in therapist notification email
- POST /therapist/apply with empty message (was min_length=10)
- POST /therapist/decline + GET /admin/declines
- Therapist signup/admin update accept profile_picture
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
from matching import score_therapist, MAX_MODALITY_PREF  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PASSWORD = "admin123!"
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"}

EXPECTED_TEMPLATE_KEYS = {
    "verification", "therapist_notification", "patient_results",
    "patient_results_empty", "therapist_signup_received", "therapist_approved",
    "magic_code",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── Module 1: matching modality_pref axis ────────────────────────────────────
class TestModalityPrefScoring:
    def _base_request(self, **overrides):
        base = {
            "location_state": "ID",
            "client_type": "individual",
            "age_group": "adult",
            "payment_type": "either",
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_evening"],
            "modality_preference": "hybrid",
            "urgency": "flexible",
            "prior_therapy": "yes_helped",
            "experience_preference": "no_pref",
            "gender_preference": "no_pref",
            "style_preference": [],
            "modality_preferences": [],
        }
        base.update(overrides)
        return base

    def _base_therapist(self, **overrides):
        base = {
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": [],
            "general_treats": [],
            "availability_windows": ["weekday_evening"],
            "modality_offering": "both",
            "urgency_capacity": "asap",
            "modalities": ["CBT", "DBT", "EMDR"],
            "years_experience": 10,
            "style_tags": ["warm_supportive"],
            "gender": "female",
            "insurance_accepted": [],
            "cash_rate": 100,
            "sliding_scale": False,
        }
        base.update(overrides)
        return base

    def test_breakdown_has_10_keys_including_modality_pref(self):
        result = score_therapist(self._base_therapist(), self._base_request())
        assert "breakdown" in result
        assert set(result["breakdown"].keys()) == {
            "issues", "availability", "modality", "urgency",
            "prior_therapy", "experience", "gender", "style",
            "payment_fit", "modality_pref",
        }
        assert len(result["breakdown"]) == 10

    def test_full_overlap_returns_max(self):
        # Patient prefers CBT + DBT, therapist offers both → MAX
        r = self._base_request(modality_preferences=["CBT", "DBT"])
        t = self._base_therapist(modalities=["CBT", "DBT", "EMDR"])
        result = score_therapist(t, r)
        assert result["breakdown"]["modality_pref"] == MAX_MODALITY_PREF

    def test_zero_overlap_returns_zero(self):
        r = self._base_request(modality_preferences=["EMDR"])
        t = self._base_therapist(modalities=["CBT", "DBT"])
        result = score_therapist(t, r)
        assert result["breakdown"]["modality_pref"] == 0.0

    def test_partial_overlap_one_of_many(self):
        # Patient prefers 3, therapist has 1 of them → 0.6 * MAX
        r = self._base_request(modality_preferences=["CBT", "ACT", "IFS"])
        t = self._base_therapist(modalities=["CBT", "Other"])
        result = score_therapist(t, r)
        assert result["breakdown"]["modality_pref"] == pytest.approx(MAX_MODALITY_PREF * 0.6)

    def test_no_pref_returns_zero(self):
        r = self._base_request(modality_preferences=[])
        t = self._base_therapist(modalities=["CBT"])
        result = score_therapist(t, r)
        assert result["breakdown"]["modality_pref"] == 0.0


# ── Module 2: Email templates admin endpoints ────────────────────────────────
class TestEmailTemplatesAPI:
    def test_list_returns_seven_templates(self, session):
        resp = session.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert "templates" in data
        templates = data["templates"]
        assert len(templates) == 7
        keys = {t["key"] for t in templates}
        assert keys == EXPECTED_TEMPLATE_KEYS
        for t in templates:
            for f in ("key", "title", "description", "subject", "heading",
                      "greeting", "intro", "cta_label", "footer_note", "available_vars"):
                assert f in t, f"template {t.get('key')} missing field {f}"

    def test_put_persists_override_and_get_reflects(self, session):
        # Save originals to restore later
        list_resp = session.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS)
        original = next(
            t for t in list_resp.json()["templates"] if t["key"] == "magic_code"
        )

        marker = f"TEST_{uuid.uuid4().hex[:6]}"
        new_subject = f"Subject override {marker}"
        new_intro = f"Intro override {marker}"
        put = session.put(
            f"{API}/admin/email-templates/magic_code",
            json={"subject": new_subject, "intro": new_intro},
            headers=ADMIN_HEADERS,
        )
        assert put.status_code == 200

        # Verify via list
        list2 = session.get(f"{API}/admin/email-templates", headers=ADMIN_HEADERS).json()["templates"]
        magic = next(t for t in list2 if t["key"] == "magic_code")
        assert magic["subject"] == new_subject
        assert magic["intro"] == new_intro
        # Untouched fields preserved from defaults
        assert magic["heading"] == original["heading"]

        # Restore originals
        session.put(
            f"{API}/admin/email-templates/magic_code",
            json={"subject": original["subject"], "intro": original["intro"]},
            headers=ADMIN_HEADERS,
        )

    def test_put_unknown_key_returns_404(self, session):
        resp = session.put(
            f"{API}/admin/email-templates/does_not_exist",
            json={"subject": "x"},
            headers=ADMIN_HEADERS,
        )
        assert resp.status_code == 404


# ── Module 3: 'Hi Sarah,' greeting normalization ─────────────────────────────
class TestEmailGreetingFirstName:
    def test_first_name_helper_strips_license_and_lastname(self):
        assert email_service._first_name("Sarah Anderson, LCSW") == "Sarah"
        assert email_service._first_name("Bob") == "Bob"
        assert email_service._first_name("") == "there"
        assert email_service._first_name(None) == "there"

    def test_send_therapist_notification_uses_first_name(self, monkeypatch):
        captured = {}

        async def fake_send(to, subject, html, **kwargs):
            captured["to"] = to
            captured["subject"] = subject
            captured["html"] = html
            return True

        monkeypatch.setattr(email_service, "_send", fake_send)

        async def go():
            await email_service.send_therapist_notification(
                to="t@example.com",
                name="Sarah Anderson, LCSW",
                request_id="rid-x",
                therapist_id="tid-x",
                match_score=85,
            )

        asyncio.run(go())
        html = captured.get("html", "")
        assert "Hi Sarah," in html, f"Expected 'Hi Sarah,' in HTML, got: {html[:600]}"
        assert "Hi Sarah Anderson" not in html
        assert "LCSW" not in html.split("Hi Sarah,")[0][-200:] if "Hi Sarah," in html else True


# ── Module 4 + 5: Apply (empty message) + Decline endpoints ─────────────────
class TestApplyAndDecline:
    @pytest.fixture(scope="class")
    def request_and_therapist(self, session):
        # Create a fresh request
        payload = {
            "email": f"theravoca+iter12_{uuid.uuid4().hex[:6]}@gmail.com",
            "location_state": "ID",
            "location_city": "Boise",
            "location_zip": "83702",
            "client_type": "individual",
            "age_group": "adult",
            "payment_type": "cash",
            "budget": 200,
            "presenting_issues": ["anxiety"],
            "availability_windows": ["weekday_evening", "flexible"],
            "modality_preference": "hybrid",
            "urgency": "flexible",
            "prior_therapy": "yes_helped",
            "experience_preference": "no_pref",
            "gender_preference": "no_pref",
            "style_preference": [],
            "modality_preferences": ["CBT"],
            "presenting_text": "anxiety help",
        }
        r = session.post(f"{API}/requests", json=payload)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # Verify
        v = session.post(f"{API}/requests/{rid}/verify", json={})
        assert v.status_code in (200, 204)
        # Trigger matching
        m = session.post(
            f"{API}/admin/requests/{rid}/trigger-matching", headers=ADMIN_HEADERS
        )
        assert m.status_code == 200, m.text
        notified = m.json().get("notified_scores") or m.json().get("notified") or {}
        # Fall back: re-fetch the request to read notified_scores
        if not notified:
            req = session.get(
                f"{API}/admin/requests/{rid}", headers=ADMIN_HEADERS
            )
            if req.status_code == 200:
                notified = req.json().get("notified_scores") or {}
        if not notified:
            pytest.skip("No therapists notified — cannot test apply/decline")
        tid = next(iter(notified.keys()))
        return rid, tid

    def test_apply_with_empty_message_returns_200(self, session, request_and_therapist):
        rid, tid = request_and_therapist
        resp = session.post(
            f"{API}/therapist/apply/{rid}/{tid}",
            json={"message": ""},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("message") == ""
        assert body.get("therapist_id") == tid

    def test_decline_persists_and_aggregates(self, session, request_and_therapist):
        rid, tid = request_and_therapist
        # Need a different therapist for decline (since same one already applied)
        # Reuse same — endpoint is idempotent and independent collection
        resp = session.post(
            f"{API}/therapist/decline/{rid}/{tid}",
            json={
                "reason_codes": ["fee_mismatch", "schedule_mismatch"],
                "notes": "TEST decline note",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("status") == "declined"
        assert "id" in body

        # Idempotent retry
        resp2 = session.post(
            f"{API}/therapist/decline/{rid}/{tid}",
            json={
                "reason_codes": ["caseload_full"],
                "notes": "updated",
            },
        )
        assert resp2.status_code == 200

        # Admin list
        agg = session.get(f"{API}/admin/declines", headers=ADMIN_HEADERS)
        assert agg.status_code == 200
        adata = agg.json()
        assert "declines" in adata and "reason_counts" in adata
        # latest decline has caseload_full now
        ours = [d for d in adata["declines"] if d["request_id"] == rid and d["therapist_id"] == tid]
        assert ours, "Our decline doc not present"
        assert "caseload_full" in ours[0]["reason_codes"]
        assert isinstance(adata["reason_counts"], dict)
        assert adata["reason_counts"].get("caseload_full", 0) >= 1

    def test_decline_unknown_request_returns_404(self, session):
        resp = session.post(
            f"{API}/therapist/decline/no-such-rid/no-such-tid",
            json={"reason_codes": ["other"], "notes": ""},
        )
        assert resp.status_code == 404


# ── Module 6: profile_picture upload ─────────────────────────────────────────
class TestProfilePicture:
    def test_signup_accepts_profile_picture(self, session):
        tiny_b64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAH//2Q=="
        payload = {
            "name": f"TEST Photo Therapist {uuid.uuid4().hex[:5]}",
            "email": f"theravoca+iter12pic_{uuid.uuid4().hex[:6]}@gmail.com",
            "phone": "(208) 555-0123",
            "license_number": "LIC123",
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": [],
            "general_treats": [],
            "modalities": ["CBT"],
            "modality_offering": "both",
            "availability_windows": ["weekday_evening"],
            "urgency_capacity": "within_2_3_weeks",
            "years_experience": 5,
            "gender": "female",
            "style_tags": ["warm_supportive"],
            "insurance_accepted": [],
            "cash_rate": 150,
            "sliding_scale": False,
            "bio": "TEST bio for profile pic test",
            "city": "Boise",
            "zip": "83702",
            "profile_picture": tiny_b64,
        }
        resp = session.post(f"{API}/therapists/signup", json=payload)
        assert resp.status_code in (200, 201), resp.text
        tid = resp.json()["id"]

        # Verify via admin list
        list_resp = session.get(
            f"{API}/admin/therapists", headers=ADMIN_HEADERS
        )
        assert list_resp.status_code == 200
        match = next((t for t in list_resp.json() if t["id"] == tid), None)
        assert match is not None
        assert match.get("profile_picture", "").startswith("data:image/")

    def test_signup_accepts_null_profile_picture(self, session):
        payload = {
            "name": f"TEST NoPhoto {uuid.uuid4().hex[:5]}",
            "email": f"theravoca+iter12np_{uuid.uuid4().hex[:6]}@gmail.com",
            "phone": "(208) 555-0124",
            "license_number": "LIC456",
            "licensed_states": ["ID"],
            "client_types": ["individual"],
            "age_groups": ["adult"],
            "primary_specialties": ["anxiety"],
            "secondary_specialties": [],
            "general_treats": [],
            "modalities": ["CBT"],
            "modality_offering": "both",
            "availability_windows": ["weekday_evening"],
            "urgency_capacity": "within_2_3_weeks",
            "years_experience": 5,
            "gender": "male",
            "style_tags": ["structured"],
            "insurance_accepted": [],
            "cash_rate": 150,
            "sliding_scale": False,
            "bio": "TEST bio without photo",
            "city": "Boise",
            "zip": "83702",
        }
        resp = session.post(f"{API}/therapists/signup", json=payload)
        assert resp.status_code in (200, 201), resp.text

    def test_admin_update_accepts_profile_picture(self, session):
        # Pick any existing therapist
        list_resp = session.get(
            f"{API}/admin/therapists", headers=ADMIN_HEADERS
        )
        assert list_resp.status_code == 200
        therapists = list_resp.json()
        assert therapists
        tid = therapists[0]["id"]
        original_pic = therapists[0].get("profile_picture", "")

        new_pic = "data:image/jpeg;base64,/9j/AAQSkZ_TEST"
        upd = session.put(
            f"{API}/admin/therapists/{tid}",
            json={"profile_picture": new_pic},
            headers=ADMIN_HEADERS,
        )
        assert upd.status_code == 200, upd.text

        # Verify
        list_resp2 = session.get(
            f"{API}/admin/therapists", headers=ADMIN_HEADERS
        )
        match = next(t for t in list_resp2.json() if t["id"] == tid)
        assert match.get("profile_picture") == new_pic

        # Restore
        session.put(
            f"{API}/admin/therapists/{tid}",
            json={"profile_picture": original_pic},
            headers=ADMIN_HEADERS,
        )
