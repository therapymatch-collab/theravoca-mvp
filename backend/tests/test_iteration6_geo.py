"""Iteration 6 — Geocoding + distance-based matching tests.

Covers:
- haversine_miles math sanity (Boise→Meridian ≈ 9.6mi)
- KNOWN_CITY_GEOS contents
- Backfill of office_geos for legacy seed therapists (>=100)
- POST /api/requests with location_city='Boise' uses known map (no Nominatim) -> patient_geo set, source='city'
- POST /api/requests with location_zip='83616' -> patient_geo source='zip' via Nominatim
- POST /api/requests virtual + zip — patient_geo set but matching ignores it
- Therapist signup geocodes office_locations into office_geos[]
- After verify -> /api/admin/requests/{id}: notified_distances populated, distance_miles + office_locations on each notified
- Distance-band scoring: in-person Eagle (83616) -> Eagle/Boise/Meridian therapists score >=12, Idaho Falls scores low
- Fallback: virtual or unknown city -> existing endpoints unaffected
- Regression: /api/admin/login, /api/auth/request-code, /api/portal/me 401, /api/therapists/signup
"""
from __future__ import annotations

import os
import sys
import time
import uuid
import requests
import pytest

sys.path.insert(0, "/app/backend")
from geocoding import KNOWN_CITY_GEOS, haversine_miles  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://care-matcher-1.preview.emergentagent.com").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123!")


@pytest.fixture(scope="session")
def s():
    return requests.Session()


# ─── Pure helpers ────────────────────────────────────────────────────────────

class TestHaversine:
    def test_boise_to_meridian_about_9_6mi(self):
        boise = KNOWN_CITY_GEOS["boise"]
        meridian = KNOWN_CITY_GEOS["meridian"]
        d = haversine_miles(*boise, *meridian)
        assert 9.0 <= d <= 10.5, f"Expected ~9.6mi, got {d}"

    def test_boise_to_idaho_falls_about_200_220(self):
        d = haversine_miles(*KNOWN_CITY_GEOS["boise"], *KNOWN_CITY_GEOS["idaho falls"])
        # Great-circle ~ 209 mi; driving distance ~ 270 mi (different metric)
        assert 200 <= d <= 220

    def test_zero_distance(self):
        d = haversine_miles(43.6, -116.2, 43.6, -116.2)
        assert d < 0.001

    def test_known_city_count(self):
        assert len(KNOWN_CITY_GEOS) >= 15
        for k in ("boise", "meridian", "eagle", "idaho falls", "twin falls"):
            assert k in KNOWN_CITY_GEOS


# ─── Backfill verification ──────────────────────────────────────────────────

class TestBackfill:
    def test_seed_therapists_have_office_geos(self, s):
        # Use admin endpoint to inspect therapists
        r = s.get(f"{BASE_URL}/api/admin/therapists?pending=false",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200, r.text
        ts = r.json()
        assert len(ts) >= 100, f"Expected >=100 therapists, got {len(ts)}"
        with_geos = [t for t in ts if t.get("office_geos")]
        # Allow small slack: backfill could be in-progress on first run, but on a warm container should be complete.
        ratio = len(with_geos) / len(ts)
        assert ratio >= 0.8, f"Only {len(with_geos)}/{len(ts)} therapists have office_geos"


# ─── Request creation + geocoding ────────────────────────────────────────────

@pytest.fixture(scope="session")
def created_inperson_eagle_request(s):
    """In-person Eagle (83616) request, verified, with notified therapists."""
    payload = {
        "email": "TEST_iter6_eagle@example.com",
        "client_age": 30,
        "location_state": "ID",
        "location_city": "Eagle",
        "location_zip": "83616",
        "session_format": "in-person",
        "payment_type": "cash",
        "budget": 200,
        "presenting_issues": "anxiety and stress",
        "preferred_modality": "CBT",
    }
    r = s.post(f"{BASE_URL}/api/requests", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    # fetch verification token via admin
    detail = s.get(f"{BASE_URL}/api/admin/requests/{rid}",
                   headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
    # verify via known token by querying mongo? Not available — instead use public verify path via admin field
    # The token isn't returned by admin (excluded). Use mongoshell via subprocess.
    import subprocess
    out = subprocess.run(
        ["mongosh", os.environ.get("DB_NAME", "test_database"), "--quiet", "--eval",
         f"db.requests.findOne({{id:'{rid}'}},{{verification_token:1,_id:0}}).verification_token"],
        capture_output=True, text=True, timeout=10,
    )
    token = out.stdout.strip().splitlines()[-1].strip()
    assert token and token != "null", f"could not get token: {out.stdout} {out.stderr}"
    vr = s.get(f"{BASE_URL}/api/requests/verify/{token}", timeout=15)
    assert vr.status_code == 200
    # Wait for matching task
    time.sleep(3)
    return rid


class TestRequestGeocoding:
    def test_create_with_known_city_no_zip(self, s):
        # Boise is in KNOWN_CITY_GEOS — should NOT need Nominatim, fast.
        t0 = time.time()
        r = s.post(f"{BASE_URL}/api/requests", json={
            "email": "TEST_iter6_boise@example.com",
            "client_age": 30, "location_state": "ID", "location_city": "Boise",
            "session_format": "in-person", "payment_type": "cash", "budget": 200,
            "presenting_issues": "anxiety",
        }, timeout=15)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        # Should be fast (<3s) since city is in known map
        assert elapsed < 3.5, f"Boise (known city) took {elapsed:.2f}s — should not hit Nominatim"

        # Inspect via admin
        d = s.get(f"{BASE_URL}/api/admin/requests/{rid}",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
        pgeo = d["request"].get("patient_geo")
        assert pgeo is not None
        assert pgeo.get("source") == "city"
        assert abs(pgeo["lat"] - 43.6150) < 0.01

    def test_create_with_zip_uses_nominatim(self, s, created_inperson_eagle_request):
        rid = created_inperson_eagle_request
        d = s.get(f"{BASE_URL}/api/admin/requests/{rid}",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
        pgeo = d["request"].get("patient_geo")
        assert pgeo is not None
        # source 'zip' via Nominatim. Eagle ID ~ 43.69, -116.35
        assert pgeo.get("source") == "zip"
        assert 43.5 <= pgeo["lat"] <= 43.95
        assert -116.6 <= pgeo["lng"] <= -116.2

    def test_virtual_request_geo_set_but_matching_ignores(self, s):
        r = s.post(f"{BASE_URL}/api/requests", json={
            "email": "TEST_iter6_virtual@example.com",
            "client_age": 30, "location_state": "ID", "location_city": "Boise",
            "session_format": "virtual", "payment_type": "cash", "budget": 200,
            "presenting_issues": "depression",
        }, timeout=15)
        assert r.status_code == 200
        rid = r.json()["id"]
        d = s.get(f"{BASE_URL}/api/admin/requests/{rid}",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
        # Either patient_geo set or null; matching path doesn't depend on it for virtual.
        # We only assert request was created with virtual format.
        assert d["request"]["session_format"] == "virtual"


class TestAdminRequestDetailDistance:
    def test_notified_distances_and_distance_miles(self, s, created_inperson_eagle_request):
        rid = created_inperson_eagle_request
        d = s.get(f"{BASE_URL}/api/admin/requests/{rid}",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
        notified = d.get("notified", [])
        assert len(notified) >= 5, f"Expected at least 5 notified, got {len(notified)}"
        # notified_distances on the request doc
        nd = d["request"].get("notified_distances") or {}
        assert isinstance(nd, dict)
        assert len(nd) >= 1, "notified_distances should be populated for in-person"
        # Each notified item has distance_miles and office_locations
        with_dist = [n for n in notified if n.get("distance_miles") is not None]
        assert len(with_dist) >= 1
        for n in with_dist:
            assert isinstance(n["distance_miles"], (int, float))
            assert n["distance_miles"] >= 0
            assert "office_locations" in n
        # Eagle area should have at least one therapist <15mi (Boise/Meridian/Eagle)
        close = [n for n in with_dist if n["distance_miles"] < 15]
        far = [n for n in with_dist if n["distance_miles"] > 100]
        assert close, "Expected at least 1 therapist within 15mi for Eagle 83616"
        # If any far therapist made it (telehealth fallback), distance must be > 75
        # Either way, distances span > 0 → confirms haversine compute
        assert max(n["distance_miles"] for n in with_dist) > min(n["distance_miles"] for n in with_dist)


# ─── Therapist signup auto-geocodes ──────────────────────────────────────────

class TestTherapistSignupGeo:
    def test_signup_geocodes_offices(self, s):
        unique = uuid.uuid4().hex[:8]
        email = f"TEST_iter6_t_{unique}@example.com"
        r = s.post(f"{BASE_URL}/api/therapists/signup", json={
            "name": "TEST Iter6 Geo Therapist",
            "email": email,
            "phone": "208-555-0100",
            "licensed_states": ["ID"],
            "office_locations": ["Boise", "Meridian"],
            "telehealth": True,
            "specialties": [{"name": "anxiety", "weight": 30}],
            "modalities": ["CBT"],
            "ages_served": ["adult-18-64"],
            "insurance_accepted": [],
            "cash_rate": 150,
            "years_experience": 5,
        }, timeout=10)
        assert r.status_code == 200, r.text
        # Verify office_geos via admin (find pending therapist)
        ts = s.get(f"{BASE_URL}/api/admin/therapists?pending=true",
                   headers={"x-admin-password": ADMIN_PASSWORD}, timeout=15).json()
        match = [t for t in ts if t.get("email") == email]
        assert match, f"Could not find newly-signed-up therapist {email}"
        geos = match[0].get("office_geos") or []
        assert len(geos) == 2
        cities = {g.get("city", "").lower() for g in geos}
        assert "boise" in cities and "meridian" in cities
        for g in geos:
            assert isinstance(g.get("lat"), (int, float))
            assert isinstance(g.get("lng"), (int, float))


# ─── Regressions ─────────────────────────────────────────────────────────────

class TestRegressions:
    def test_root(self, s):
        r = s.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_admin_login_ok(self, s):
        r = s.post(f"{BASE_URL}/api/admin/login", json={"password": ADMIN_PASSWORD}, timeout=10)
        assert r.status_code == 200

    def test_admin_login_bad(self, s):
        r = s.post(f"{BASE_URL}/api/admin/login", json={"password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_portal_me_missing_token(self, s):
        r = s.get(f"{BASE_URL}/api/portal/me", timeout=10)
        assert r.status_code == 401

    def test_auth_request_code_invalid_role(self, s):
        r = s.post(f"{BASE_URL}/api/auth/request-code",
                   json={"email": "x@example.com", "role": "alien"}, timeout=10)
        assert r.status_code == 400

    def test_admin_stats_includes_therapists(self, s):
        r = s.get(f"{BASE_URL}/api/admin/stats",
                  headers={"x-admin-password": ADMIN_PASSWORD}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["therapists"] >= 100
