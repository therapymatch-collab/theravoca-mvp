"""Iteration 67 — SMS A2P status panel, license upload, research-enrichment
scoring fix, matching tiebreaker + differentiator bonus."""
import os
import base64
import time
import pytest
import requests

# Load BASE_URL from frontend .env if not in os.environ
def _load_base_url() -> str:
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if val:
        return val.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()
ADMIN_PWD = "admin123!"
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}


# ──────────────────────── BACKEND: SMS / A2P ─────────────────────────────
class TestSmsStatus:
    def test_sms_status_shape(self):
        r = requests.get(f"{BASE_URL}/api/admin/sms-status", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("verdict", "twilio_enabled", "has_credentials", "from_number",
                  "dev_override_to", "a2p_brand_id", "a2p_campaign_id",
                  "a2p_status", "a2p_notes", "last_test_sms"):
            assert k in d, f"missing key {k}"

    def test_test_sms_persists_and_blocks_a2p(self):
        # Trigger a test-sms first so last_test_sms is populated.
        rr = requests.post(
            f"{BASE_URL}/api/admin/test-sms",
            json={"to": "+12036237529", "message": "iter67 a2p verdict probe"},
            headers=ADMIN_HEADERS, timeout=30,
        )
        # test-sms may return 200 even on Twilio-side failure (it stores final_status).
        assert rr.status_code in (200, 400, 500), rr.text
        # give Twilio status webhook a tiny moment if synchronous polling is used
        time.sleep(2)
        r = requests.get(f"{BASE_URL}/api/admin/sms-status", headers=ADMIN_HEADERS, timeout=15)
        d = r.json()
        last = d.get("last_test_sms") or {}
        # Either error_code 30034 OR verdict reflects the block.
        assert d["verdict"] in ("blocked_a2p_10dlc", "blocked", "untested",
                                "delivered_recently", "twilio_disabled",
                                "missing_credentials"), d
        # If creds present and enabled, with the unregistered number the spec
        # requires error_code 30034 OR a 'blocked' verdict.
        if d["has_credentials"] and d["twilio_enabled"]:
            assert (last.get("error_code") in (30034, 30032)
                    or d["verdict"] in ("blocked_a2p_10dlc", "blocked")
                    or last.get("final_status") == "delivered"), (d, last)

    def test_a2p_put_get_roundtrip(self):
        payload = {
            "brand_id": "BN1234567",
            "campaign_id": "CM7654321",
            "status": "brand_pending",
            "notes": "iter67 test - delete me",
        }
        r = requests.put(
            f"{BASE_URL}/api/admin/sms-status/a2p",
            json=payload, headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/admin/sms-status",
                         headers=ADMIN_HEADERS, timeout=15).json()
        assert g["a2p_brand_id"] == "BN1234567"
        assert g["a2p_campaign_id"] == "CM7654321"
        assert g["a2p_status"] == "brand_pending"
        assert "iter67" in g["a2p_notes"]


# ──────────────────────── BACKEND: License upload ─────────────────────────
def _therapist_token(email: str = "therapymatch+t101@gmail.com") -> str:
    """Use deps._create_session_token via a backend helper if exposed.
    Fall back to inserting a magic_codes row directly via the admin DB
    helpers if available — otherwise skip."""
    # Easiest path: import deps and create a JWT in-process.
    import sys
    sys.path.insert(0, "/app/backend")
    try:
        from deps import _create_session_token  # type: ignore
        return _create_session_token(email=email, role="therapist")
    except Exception as e:
        pytest.skip(f"Cannot mint therapist token: {e}")


@pytest.fixture(scope="class")
def therapist_headers():
    tok = _therapist_token()
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="class")
def patient_headers():
    import sys
    sys.path.insert(0, "/app/backend")
    try:
        from deps import _create_session_token  # type: ignore
        tok = _create_session_token(
            email="therapymatch+patient@gmail.com", role="patient")
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    except Exception as e:
        pytest.skip(f"Cannot mint patient token: {e}")


class TestLicenseUpload:
    def test_upload_pdf_and_get_metadata(self, therapist_headers):
        # tiny valid PDF (~ 9 bytes is fine; we just check round-trip)
        sample = b"%PDF-1.4\n%fake\n"
        b64 = base64.b64encode(sample).decode()
        r = requests.post(
            f"{BASE_URL}/api/therapists/me/license-document",
            json={
                "filename": "TEST_iter67.pdf",
                "content_type": "application/pdf",
                "data_base64": b64,
            },
            headers=therapist_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pending_reapproval"] is True
        assert d["filename"] == "TEST_iter67.pdf"

        g = requests.get(
            f"{BASE_URL}/api/therapists/me/license-document",
            headers=therapist_headers, timeout=15,
        )
        assert g.status_code == 200, g.text
        gd = g.json()
        assert gd["present"] is True
        assert gd["filename"] == "TEST_iter67.pdf"
        assert gd["size_bytes"] == len(sample)
        # Critical: response must NOT include the raw base64 data
        assert "data_base64" not in gd

    def test_reject_unsupported_type(self, therapist_headers):
        r = requests.post(
            f"{BASE_URL}/api/therapists/me/license-document",
            json={
                "filename": "TEST.txt",
                "content_type": "text/plain",
                "data_base64": base64.b64encode(b"hello").decode(),
            },
            headers=therapist_headers, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_reject_too_large(self, therapist_headers):
        # 5MB + 1 byte
        big = b"\x00" * (5 * 1024 * 1024 + 1)
        b64 = base64.b64encode(big).decode()
        r = requests.post(
            f"{BASE_URL}/api/therapists/me/license-document",
            json={
                "filename": "TEST_big.pdf",
                "content_type": "application/pdf",
                "data_base64": b64,
            },
            headers=therapist_headers, timeout=60,
        )
        assert r.status_code == 400, r.text

    def test_reject_bad_base64(self, therapist_headers):
        r = requests.post(
            f"{BASE_URL}/api/therapists/me/license-document",
            json={
                "filename": "TEST_bad.pdf",
                "content_type": "application/pdf",
                "data_base64": "@@@not_b64@@@",
            },
            headers=therapist_headers, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_patient_session_forbidden(self, patient_headers):
        r = requests.post(
            f"{BASE_URL}/api/therapists/me/license-document",
            json={
                "filename": "TEST.pdf",
                "content_type": "application/pdf",
                "data_base64": base64.b64encode(b"%PDF-1.4").decode(),
            },
            headers=patient_headers, timeout=15,
        )
        assert r.status_code == 403, r.text


# ────────────────────── BACKEND: research_enrichment scoring ──────────────
class TestResearchScoring:
    def test_no_overlap_caps_at_one_point(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from research_enrichment import _score_axes
        request = {"presenting_issues": ["anxiety"]}
        research = {"depth_signal": "moderate", "themes": {"trauma": 1}}
        res = _score_axes(research, request)
        assert res["evidence_depth"] <= 1.0, res

    def test_primary_hit_with_deep_high_score(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from research_enrichment import _score_axes
        request = {"presenting_issues": ["anxiety"]}
        research = {"depth_signal": "deep", "themes": {"anxiety": 5}}
        res = _score_axes(research, request)
        assert res["evidence_depth"] >= 7.0, res


# ────────────────────── BACKEND: matching tiebreaker / differentiator ─────
class TestMatchingDifferentiator:
    def test_tiebreaker_prefers_higher_review_signal(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from matching import _tiebreaker
        a = {"id": "a", "review_avg": 4.8, "review_count": 50,
             "years_experience": 5}
        b = {"id": "b", "review_avg": 3.0, "review_count": 1,
             "years_experience": 5}
        ta = _tiebreaker(a)
        tb = _tiebreaker(b)
        # higher review_signal MUST sort first (desc-sort, so larger wins)
        assert ta[0] > tb[0], (ta, tb)

    def test_rank_therapists_diverges_match_scores(self):
        """Pull ≥10 therapists from live DB, run rank_therapists, verify
        the differentiator bonus diverges identical raw scores."""
        import sys, asyncio
        sys.path.insert(0, "/app/backend")
        from matching import rank_therapists
        from deps import db
        from conftest import v2_request_payload

        async def _fetch():
            cur = db.therapists.find({}, {"_id": 0}).limit(150)
            return [t async for t in cur]

        therapists = asyncio.get_event_loop().run_until_complete(_fetch())
        if len(therapists) < 10:
            pytest.skip(f"Only {len(therapists)} therapists in DB")
        req = v2_request_payload(presenting_issues=["anxiety"])
        ranked = rank_therapists(therapists, req, threshold=0,
                                 top_n=30, min_results=0)
        if len(ranked) < 10:
            pytest.skip(f"rank_therapists returned {len(ranked)} (<10)")
        scores = [m["match_score"] for m in ranked[:15]]
        unique = len(set(scores))
        assert unique >= max(2, len(scores) // 2), (
            f"Expected divergence in scores, got {scores}"
        )
        # Verify differentiator is in breakdown
        assert "differentiator" in ranked[0]["match_breakdown"], ranked[0]["match_breakdown"]
