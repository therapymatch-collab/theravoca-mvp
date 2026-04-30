"""
Iter-103 bundle tests:
  1. Matching cap at 95 (was 99)
  2. Email templates: new_referral_inquiry + prelaunch_invite present + editable
  3. Hard-capacity: client_type + age_group disabled buckets surface
  4. Outreach agent imports (sanity)
  5. Regressions: prelaunch_invite still listed; -1 sentinels still preserved
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://care-matcher-1.preview.emergentagent.com").rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")


# ── Module unit tests (matching.py + hard_capacity.py + email_templates.py) ──
class TestScoreCap:
    """matching.score_therapist must cap total at 95.0"""

    def _build_perfect_pair(self):
        from matching import score_therapist
        # Synthetic perfect match request + therapist
        r = {
            "concerns": ["anxiety", "depression"],
            "preferences": ["evidence_based"],
            "language": "en",
            "languages": ["en"],
            "modality": "telehealth",
            "modality_offering": "telehealth",
            "client_type": "individual",
            "client_types": ["individual"],
            "age_group": "adult",
            "age_groups": ["adult"],
            "gender_preference": "any",
            "urgency": "asap",
            "urgency_capacity": "asap",
            "payment_type": "self_pay",
            "self_pay_max_session_fee": 200,
            "session_fee": 100,
            "location_state": "ID",
            "deep_match_opt_in": False,
        }
        t = {
            "id": "t-perfect",
            "is_active": True,
            "specialties": ["anxiety", "depression"],
            "approach_tags": ["evidence_based", "cbt"],
            "languages_spoken": ["en"],
            "modality_offering": "hybrid",
            "client_types": ["individual", "couples"],
            "age_groups": ["adult", "young_adult"],
            "gender": "any",
            "urgency_capacity": "asap",
            "session_fee_min": 80,
            "session_fee_max": 120,
            "licensed_states": ["ID"],
            "insurance_accepted": [],
        }
        return r, t, score_therapist

    def test_total_capped_at_95(self):
        r, t, score = self._build_perfect_pair()
        out = score(t, r)
        assert out["filtered"] is False, f"Expected match, got filtered: {out}"
        assert out["total"] <= 95.0, f"Cap broken: total={out['total']}"
        # And not capped to less than something useful (the match must still be high)
        assert out["total"] >= 50.0, f"Match too weak; suspicious: total={out['total']}"

    def test_filter_minus_one_preserved(self):
        # Unlicensed state therapist -> -1 sentinel must NOT be capped to 95
        r, t, score = self._build_perfect_pair()
        t["licensed_states"] = ["CA"]  # patient is ID
        out = score(t, r)
        assert out["filtered"] is True
        assert out["total"] == -1, f"Filtered sentinel was capped: total={out['total']}"


class TestEmailTemplatesModule:
    def test_defaults_contains_required_keys(self):
        from email_templates import DEFAULTS
        assert "new_referral_inquiry" in DEFAULTS
        assert "prelaunch_invite" in DEFAULTS
        # Sanity on shape — both should have a subject line
        assert DEFAULTS["new_referral_inquiry"].get("subject")
        assert DEFAULTS["prelaunch_invite"].get("subject")


class TestHardCapacityModule:
    @pytest.mark.asyncio
    async def test_disabled_includes_client_type_and_age_group(self):
        from hard_capacity import compute_capacity
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        out = await compute_capacity(db)
        assert "disabled" in out
        assert "client_type" in out["disabled"]
        assert "age_group" in out["disabled"]
        # Per problem statement: family=28, group=11, child=5  → all <30 → disabled
        assert "family" in out["disabled"]["client_type"], f"family not disabled: {out['disabled']['client_type']}"
        assert "group" in out["disabled"]["client_type"], f"group not disabled: {out['disabled']['client_type']}"
        assert "child" in out["disabled"]["age_group"], f"child not disabled: {out['disabled']['age_group']}"

        # protections array
        assert "protections" in out
        ct_axes = [p for p in out["protections"] if p.get("axis") == "client_type"]
        ag_axes = [p for p in out["protections"] if p.get("axis") == "age_group"]
        assert len(ct_axes) >= 1, f"No client_type protection entries: {out['protections']}"
        assert len(ag_axes) >= 1, f"No age_group protection entries: {out['protections']}"

        # counts
        assert "counts" in out
        assert "client_type" in out["counts"]
        assert "age_group" in out["counts"]
        assert isinstance(out["counts"]["client_type"], dict)
        assert isinstance(out["counts"]["age_group"], dict)


class TestOutreachAgentSanity:
    def test_template_overrides_loader_exists(self):
        from outreach_agent import _load_template_overrides, _NRI_OVERRIDES_CACHE
        assert callable(_load_template_overrides)
        assert isinstance(_NRI_OVERRIDES_CACHE, dict)
        assert "data" in _NRI_OVERRIDES_CACHE


# ── HTTP integration tests (admin auth required) ─────────────────────────────
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Master password: send X-Admin-Password header
    s.headers.update({"X-Admin-Password": ADMIN_PWD})
    return s


class TestAdminEmailTemplates:
    def test_list_includes_required_templates(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/email-templates", timeout=30)
        assert r.status_code == 200, f"GET /admin/email-templates -> {r.status_code}: {r.text[:200]}"
        data = r.json()
        # Could be list of dicts or dict-of-dicts
        keys = []
        if isinstance(data, list):
            keys = [d.get("key") for d in data]
        elif isinstance(data, dict):
            keys = list(data.keys()) if "templates" not in data else [d.get("key") for d in data.get("templates", [])]
        assert "new_referral_inquiry" in keys, f"new_referral_inquiry missing. Keys: {keys}"
        assert "prelaunch_invite" in keys, f"prelaunch_invite missing. Keys: {keys}"
        # Per problem statement: 14 templates expected
        assert len(keys) >= 14, f"Expected >=14 templates, got {len(keys)}: {keys}"

    def test_put_new_referral_inquiry_persists(self, admin_session):
        # Snapshot original
        get1 = admin_session.get(f"{BASE_URL}/api/admin/email-templates", timeout=30)
        assert get1.status_code == 200
        data = get1.json()
        original = None
        if isinstance(data, list):
            for d in data:
                if d.get("key") == "new_referral_inquiry":
                    original = d
                    break
        elif isinstance(data, dict):
            original = data.get("new_referral_inquiry") or (data.get("templates") or {}).get("new_referral_inquiry")
        assert original is not None, "could not snapshot original new_referral_inquiry"

        # PUT a custom subject
        custom_subject = "TEST_iter103_subject_marker"
        put_payload = {"subject": custom_subject}
        # Try a couple of likely shapes
        put_url = f"{BASE_URL}/api/admin/email-templates/new_referral_inquiry"
        r = admin_session.put(put_url, json=put_payload, timeout=30)
        assert r.status_code in (200, 204), f"PUT failed {r.status_code}: {r.text[:300]}"

        # GET again — verify persistence
        get2 = admin_session.get(f"{BASE_URL}/api/admin/email-templates", timeout=30)
        assert get2.status_code == 200
        d2 = get2.json()
        found = None
        if isinstance(d2, list):
            for d in d2:
                if d.get("key") == "new_referral_inquiry":
                    found = d
                    break
        elif isinstance(d2, dict):
            found = d2.get("new_referral_inquiry") or (d2.get("templates") or {}).get("new_referral_inquiry")
        assert found is not None
        assert found.get("subject") == custom_subject, f"subject didn't persist: {found}"

        # Reset to default by sending None or original
        reset_subject = original.get("subject") if isinstance(original, dict) else None
        if reset_subject:
            admin_session.put(put_url, json={"subject": reset_subject}, timeout=30)


class TestAdminHardCapacity:
    def test_endpoint_returns_full_axis_data(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/hard-capacity", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        d = r.json()
        assert "disabled" in d
        assert "client_type" in d["disabled"], f"missing client_type in disabled: {d['disabled']}"
        assert "age_group" in d["disabled"], f"missing age_group in disabled: {d['disabled']}"
        assert "family" in d["disabled"]["client_type"]
        assert "group" in d["disabled"]["client_type"]
        assert "child" in d["disabled"]["age_group"]

        # protections includes both axes
        prots = d.get("protections") or []
        ct_axes = [p for p in prots if p.get("axis") == "client_type"]
        ag_axes = [p for p in prots if p.get("axis") == "age_group"]
        assert ct_axes, f"No client_type axis in protections: {prots}"
        assert ag_axes, f"No age_group axis in protections: {prots}"

        # counts
        counts = d.get("counts") or {}
        assert isinstance(counts.get("client_type"), dict) and counts["client_type"], f"empty counts.client_type: {counts}"
        assert isinstance(counts.get("age_group"), dict) and counts["age_group"], f"empty counts.age_group: {counts}"


class TestRegressionScoreCap95:
    """Hit a real /api/match endpoint if reachable — ensure no >95 leaks."""

    def test_no_request_response_exceeds_95(self, admin_session):
        # Get an existing matched request to verify match-scores all <=95
        r = admin_session.get(f"{BASE_URL}/api/admin/requests", timeout=30)
        if r.status_code != 200:
            pytest.skip(f"admin/requests not reachable: {r.status_code}")
        items = r.json()
        if isinstance(items, dict):
            items = items.get("requests") or items.get("items") or []
        # Find first with matches
        sample_id = None
        for it in items[:30]:
            if it.get("matches") or it.get("match_count"):
                sample_id = it.get("id") or it.get("_id")
                break
        if not sample_id:
            # Fall back to first
            sample_id = items[0].get("id") if items else None
        if not sample_id:
            pytest.skip("no requests to inspect")

        rd = admin_session.get(f"{BASE_URL}/api/admin/requests/{sample_id}", timeout=30)
        if rd.status_code != 200:
            pytest.skip(f"detail: {rd.status_code}")
        det = rd.json()
        matches = det.get("matches") or det.get("therapist_matches") or []
        offenders = []
        for m in matches:
            score = m.get("score") or m.get("match_score") or m.get("total")
            if isinstance(score, (int, float)) and score > 95:
                offenders.append((m.get("therapist_id") or m.get("id"), score))
        assert not offenders, f"Match scores > 95 leaked: {offenders}"
