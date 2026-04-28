"""Iteration 54 — profile completeness scoring + claim-email campaign.

Covers:
  • profile_completeness.evaluate() unit cases
  • GET /api/admin/profile-completeness
  • POST /api/admin/profile-completeness/send-claim (dry_run + selected mode)
  • Therapist portal payload includes `completeness`
"""
import os
import sys
import time
import uuid
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")
sys.path.insert(0, "/app/backend")

from profile_completeness import evaluate  # noqa: E402


def _master():
    return {"X-Admin-Password": ADMIN_PW}


# ─── Unit tests for evaluate() ────────────────────────────────────────────────
class TestProfileCompletenessUnit:
    def test_empty_doc_score_zero(self):
        r = evaluate({})
        assert r["score"] == 0
        assert r["publishable"] is False
        assert r["required_done"] == 0
        assert r["required_total"] >= 10  # 13 currently
        assert all("label" in m for m in r["required_missing"])

    def test_all_required_passing(self):
        t = {
            "name": "Sarah Anderson, LCSW",
            "email": "sarah@example.com",
            "phone": "208-555-1234",
            "license_number": "LCSW-99",
            "license_expires_at": "2027-12-31",
            "bio": "I'm a warm, evidence-based clinician with 10 years experience.",
            "profile_picture": "https://example.com/p.jpg",
            "primary_specialties": ["anxiety"],
            "age_groups": ["adult"],
            "client_types": ["individual"],
            "modality_offering": "both",
            "cash_rate": 150,
            "office_addresses": ["123 Main St, Boise, ID"],
        }
        r = evaluate(t)
        assert r["publishable"] is True
        assert r["required_done"] == r["required_total"]
        # No enhancing fields → score is 70
        assert r["score"] == 70

    def test_telehealth_satisfies_office_requirement(self):
        t = {
            "name": "Sarah Anderson, LCSW", "email": "s@example.com", "phone": "2085551234",
            "license_number": "X1", "license_expires_at": "2027-12-31",
            "bio": "Warm clinician with extensive trauma-focused practice experience.",
            "profile_picture": "p", "primary_specialties": ["anxiety"], "age_groups": ["adult"],
            "client_types": ["individual"], "modality_offering": "telehealth", "cash_rate": 150,
            "telehealth": True,
            # NOTE: no office_addresses set
        }
        r = evaluate(t)
        assert r["publishable"] is True

    def test_short_bio_blocks_publishable(self):
        t = {
            "name": "X", "email": "x@x.com", "phone": "2085551234",
            "license_number": "X", "license_expires_at": "2027-12-31",
            "bio": "too short",  # < 40 chars
            "profile_picture": "p", "primary_specialties": ["anxiety"], "age_groups": ["adult"],
            "client_types": ["individual"], "modality_offering": "both", "cash_rate": 150,
            "office_addresses": ["addr"],
        }
        r = evaluate(t)
        assert r["publishable"] is False
        labels = [m["key"] for m in r["required_missing"]]
        assert "bio" in labels

    def test_all_fields_score_100(self):
        t = {
            "name": "Sarah Anderson, LCSW",
            "email": "sarah@example.com",
            "phone": "208-555-1234",
            "license_number": "LCSW-99",
            "license_expires_at": "2027-12-31",
            "bio": "I'm a warm, evidence-based clinician with 10 years experience.",
            "profile_picture": "p",
            "primary_specialties": ["anxiety"],
            "age_groups": ["adult"],
            "client_types": ["individual"],
            "modality_offering": "both",
            "cash_rate": 150,
            "office_addresses": ["123 Main"],
            # Enhancing
            "years_experience": 10,
            "secondary_specialties": ["depression"],
            "modalities": ["CBT"],
            "insurance_accepted": ["Aetna"],
            "languages_spoken": ["Spanish"],
            "license_picture": "p",
            "free_consult": True,
            "sliding_scale": True,
            "website": "https://example.com",
        }
        r = evaluate(t)
        assert r["score"] == 100
        assert r["publishable"] is True


# ─── /admin/profile-completeness ─────────────────────────────────────────────
class TestAdminCompletenessRoster:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/admin/profile-completeness", timeout=10)
        assert r.status_code == 401

    def test_returns_aggregate(self):
        r = requests.get(
            f"{API}/admin/profile-completeness", headers=_master(), timeout=15
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("therapists", "total", "publishable", "incomplete", "average_score"):
            assert key in body
        # Sorted ascending
        scores = [t["score"] for t in body["therapists"]]
        assert scores == sorted(scores)
        if body["therapists"]:
            sample = body["therapists"][0]
            for key in ("id", "name", "email", "score", "publishable",
                        "required_done", "required_total",
                        "required_missing", "enhancing_missing"):
                assert key in sample


# ─── /admin/profile-completeness/send-claim ──────────────────────────────────
class TestClaimCampaign:
    def test_dry_run_does_not_send(self):
        r = requests.post(
            f"{API}/admin/profile-completeness/send-claim",
            headers=_master(),
            json={"mode": "all_incomplete", "dry_run": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert "would_send" in body
        assert isinstance(body["recipients"], list)
        if body["recipients"]:
            sample = body["recipients"][0]
            for key in ("email", "name", "score", "missing"):
                assert key in sample

    def test_selected_mode_requires_ids(self):
        r = requests.post(
            f"{API}/admin/profile-completeness/send-claim",
            headers=_master(),
            json={"mode": "selected", "dry_run": True},
            timeout=10,
        )
        assert r.status_code == 400

    def test_send_to_specific_therapist_marks_claim_sent(self):
        # Create a fresh therapist in the DB so we can verify the
        # `claim_email_sent_at` timestamp gets stamped after the campaign
        # runs in non-dry mode.
        import asyncio
        from deps import db
        tid = str(uuid.uuid4())
        async def _seed():
            await db.therapists.insert_one({
                "id": tid,
                "email": f"claimtest_{int(time.time())}@example.com",
                "name": "Claim Test, LCSW",
                "phone": "208-555-1234",
                "is_active": True,
                "pending_approval": False,
                "license_number": "X1",
            })
        asyncio.get_event_loop().run_until_complete(_seed())

        r = requests.post(
            f"{API}/admin/profile-completeness/send-claim",
            headers=_master(),
            json={"mode": "selected", "therapist_ids": [tid], "dry_run": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sent"] >= 1

        # Verify timestamp was set on the doc
        async def _check():
            doc = await db.therapists.find_one({"id": tid}, {"_id": 0, "claim_email_sent_at": 1})
            return doc
        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc.get("claim_email_sent_at"), "claim_email_sent_at should have been stamped"

        # Subsequent run WITHOUT resend=True should skip this therapist
        r = requests.post(
            f"{API}/admin/profile-completeness/send-claim",
            headers=_master(),
            json={"mode": "selected", "therapist_ids": [tid], "dry_run": True, "resend": False},
            timeout=10,
        )
        body = r.json()
        emails = [r["email"] for r in body["recipients"]]
        assert all(tid not in e for e in emails)  # type: ignore[comparison-overlap]


# ─── /portal/therapist/referrals payload includes `completeness` ─────────────
class TestPortalCompletenessPayload:
    def test_completeness_block_present(self):
        from deps import _create_session_token
        token = _create_session_token("portaltest@example.com", "therapist")
        r = requests.get(
            f"{API}/portal/therapist/referrals",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        therapist = r.json().get("therapist") or {}
        comp = therapist.get("completeness")
        assert comp, "therapist.completeness must be present"
        for key in ("score", "publishable", "required_missing", "enhancing_missing"):
            assert key in comp
