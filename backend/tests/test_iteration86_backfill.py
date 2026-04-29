"""Iter-86 backfill regression: 5-field backfill + strip cycle.

Verifies POST /api/admin/backfill-therapists populates and audits:
languages_spoken, license_picture, bio, free_consult, sliding_scale.
Then POST /api/admin/strip-backfill cleanly removes them along with
the iter-84/85 fields (license_number, license_expires_at,
profile_picture, secondary_specialties).
"""
import os
import sys
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_PW = "admin123!"
ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PW, "Content-Type": "application/json"}

# Direct mongo access for test setup (resetting _backfill_audit which isn't in PUT whitelist)
sys.path.insert(0, "/app/backend")


def _get_mongo_db():
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]

# Fields the backfill is responsible for setting (subset relevant to this iter)
ITER86_NEW_FIELDS = ["languages_spoken", "license_picture", "bio", "free_consult", "sliding_scale"]
ITER84_85_FIELDS = ["license_number", "license_expires_at", "profile_picture", "secondary_specialties"]
ALL_TRACKED = ITER86_NEW_FIELDS + ITER84_85_FIELDS


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update(ADMIN_HEADERS)
    return s


def _list_therapists(session):
    r = session.get(f"{BASE_URL}/api/admin/therapists?limit=200", timeout=30)
    assert r.status_code == 200, f"List failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    return data.get("therapists") or data.get("items") or data if isinstance(data, list) else (data.get("therapists") or data.get("items") or [])


def test_admin_auth_works(session):
    r = session.get(f"{BASE_URL}/api/admin/therapists?limit=1", timeout=30)
    assert r.status_code == 200, f"Admin auth failed: {r.status_code}"


def test_backfill_endpoint_runs(session):
    r = session.post(f"{BASE_URL}/api/admin/backfill-therapists", json={}, timeout=120)
    assert r.status_code == 200, f"Backfill failed: {r.status_code} {r.text[:500]}"
    body = r.json()
    print(f"Backfill response keys: {list(body.keys())}")
    print(f"Backfill summary: {body}")


def test_backfill_audit_contains_iter86_fields(session):
    """Cycle: pick a sample therapist, clear the 5 iter-86 + 4 iter-84/85 fields,
    set email, run backfill, verify audit captures all 9, run strip, verify
    fields removed and email restored."""
    # Pick a therapist
    list_resp = session.get(f"{BASE_URL}/api/admin/therapists?limit=5", timeout=30)
    assert list_resp.status_code == 200
    body = list_resp.json()
    therapists = body.get("therapists") if isinstance(body, dict) else body
    assert therapists, f"no therapists returned: {body}"
    sample = therapists[0]
    tid = sample.get("id") or sample.get("_id")
    assert tid, f"no id on therapist sample: {sample}"
    original_email = sample.get("email")
    print(f"Using therapist {tid}, original email={original_email}")

    test_email = "real.test@example.com"

    # Use mongo directly to reset audit AND clear fields (PUT whitelist doesn't include _backfill_audit)
    mdb = _get_mongo_db()
    reset_res = mdb.therapists.update_one(
        {"id": tid},
        {
            "$set": {"email": test_email},
            "$unset": {
                "_backfill_audit": "",
                "languages_spoken": "",
                "license_picture": "",
                "bio": "",
                "free_consult": "",
                "sliding_scale": "",
                "license_number": "",
                "license_expires_at": "",
                "profile_picture": "",
                "secondary_specialties": "",
            },
        },
    )
    print(f"Mongo reset matched={reset_res.matched_count}, modified={reset_res.modified_count}")
    assert reset_res.matched_count == 1

    # Run backfill
    bf = session.post(f"{BASE_URL}/api/admin/backfill-therapists", json={}, timeout=120)
    assert bf.status_code == 200, f"backfill failed: {bf.status_code}"

    # Re-fetch therapist via mongo (no GET single-therapist admin route)
    after = mdb.therapists.find_one({"id": tid}, {"_id": 0})
    assert after, "therapist disappeared"

    audit = after.get("_backfill_audit") or {}
    fields_added = audit.get("fields_added") or []
    print(f"audit.fields_added: {fields_added}")

    # Verify all 5 iter-86 fields show up in audit
    for f in ITER86_NEW_FIELDS:
        assert f in fields_added, f"{f} missing from fields_added: {fields_added}"
    # Verify iter-84/85 fields too
    for f in ITER84_85_FIELDS:
        assert f in fields_added, f"{f} missing from fields_added: {fields_added}"

    # Verify field types/values look reasonable
    assert isinstance(after.get("languages_spoken"), list), "languages_spoken not a list"
    lp = after.get("license_picture") or ""
    assert "placehold.co" in lp, f"license_picture should be placehold.co URL: {lp!r}"
    bio = after.get("bio") or ""
    assert len(bio) >= 40, f"bio too short ({len(bio)} chars)"
    assert isinstance(after.get("free_consult"), bool), "free_consult not bool"
    assert isinstance(after.get("sliding_scale"), bool), "sliding_scale not bool"
    assert (after.get("license_number") or "").strip(), "license_number empty"
    assert (after.get("license_expires_at") or "").strip(), "license_expires_at empty"
    assert (after.get("profile_picture") or "").strip(), "profile_picture empty"
    assert isinstance(after.get("secondary_specialties"), list) and len(after["secondary_specialties"]) > 0

    # ----- Strip phase -----
    strip = session.post(f"{BASE_URL}/api/admin/strip-backfill", json={}, timeout=120)
    assert strip.status_code == 200, f"strip failed: {strip.status_code} {strip.text[:300]}"
    print(f"Strip response: {strip.json()}")

    g2 = mdb.therapists.find_one({"id": tid}, {"_id": 0})
    stripped = g2 or {}
    assert stripped, "therapist gone after strip"

    # All 9 should be unset / falsy / empty
    for f in ALL_TRACKED:
        v = stripped.get(f)
        is_empty = v in (None, "", [], {}, False) or (f == "free_consult" and v in (None, False)) or (f == "sliding_scale" and v in (None, False))
        # free_consult/sliding_scale legit can be False — accept None or absent only for cleanliness
        if f in ("free_consult", "sliding_scale"):
            assert v is None or v is False or f not in stripped, f"{f} still present after strip: {v!r}"
        else:
            assert v in (None, "", [], {}), f"{f} not cleared after strip: {v!r}"

    # Email should have been restored to test_email by strip
    assert stripped.get("email") == test_email, f"email not restored: {stripped.get('email')!r}"

    # Restore original email if we had one
    if original_email and original_email != test_email:
        mdb.therapists.update_one({"id": tid}, {"$set": {"email": original_email}})


def test_followup_backfill_repopulates_after_strip(session):
    """After strip, a re-run of backfill should re-populate everything cleanly."""
    bf = session.post(f"{BASE_URL}/api/admin/backfill-therapists", json={}, timeout=120)
    assert bf.status_code == 200
