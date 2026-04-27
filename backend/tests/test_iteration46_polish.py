"""Iter-46: many-thing batch — UI cleanup + referral analytics + recruit
attribution + therapist portal analytics + admin detail enrichment."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env", override=False)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_HEADERS = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "admin123!")}


def _backend_up() -> bool:
    if not BASE_URL:
        return False
    try:
        return requests.get(f"{API}/", timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _backend_up(), reason="Backend not reachable")


def test_referral_analytics_endpoint_shape():
    res = requests.get(
        f"{API}/admin/referral-analytics", headers=ADMIN_HEADERS, timeout=15,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    for k in ("patient_referrals", "therapist_referrals", "referral_sources", "gap_recruit"):
        assert k in body, f"missing key {k}"
    assert "total_invited" in body["patient_referrals"]
    assert "top" in body["patient_referrals"]
    assert "top" in body["therapist_referrals"]
    assert "conversion_rate" in body["gap_recruit"]


def test_admin_request_detail_includes_breakdown():
    """Pick any request that has notified therapists and confirm the new
    enriched fields (match_breakdown, primary_specialties, modalities,
    cash_rate, review_count, etc.) are returned per therapist."""
    res = requests.get(f"{API}/admin/requests", headers=ADMIN_HEADERS, timeout=10)
    assert res.status_code == 200
    rows = res.json()
    sample = next((r for r in rows if (r.get("notified_count") or 0) > 0), None)
    if not sample:
        pytest.skip("no requests with notifications to inspect")
    detail = requests.get(
        f"{API}/admin/requests/{sample['id']}", headers=ADMIN_HEADERS, timeout=10,
    ).json()
    assert detail["notified"], "no notified entries on the detail"
    n0 = detail["notified"][0]
    for k in ("primary_specialties", "modalities", "credential_type",
              "cash_rate", "match_breakdown"):
        assert k in n0, f"notified entry missing {k}: {n0.keys()}"


def test_drafts_response_has_converted_count():
    """The drafts list must report `converted` (gap-recruit signups)."""
    res = requests.get(
        f"{API}/admin/gap-recruit/drafts", headers=ADMIN_HEADERS, timeout=10,
    )
    assert res.status_code == 200
    body = res.json()
    assert "converted" in body
    assert isinstance(body["converted"], int)


def test_therapist_signup_accepts_recruit_code():
    """Signup must accept and persist a recruit_code without crashing."""
    import uuid
    payload = {
        "name": "Test Recruit Signup, LCSW",
        "email": f"recruit_test_{uuid.uuid4().hex[:8]}@example.com",
        "phone": "208-555-0100",
        "phone_alert": "208-555-0100",
        "office_phone": "208-555-0100",
        "gender": "female",
        "credential_type": "LCSW",
        "licensed_states": ["ID"],
        "license_number": "LCSW-99999",
        "license_picture": "",
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "secondary_specialties": [],
        "general_treats": [],
        "modalities": ["CBT"],
        "modality_offering": "telehealth",
        "office_locations": ["Boise"],
        "office_addresses": [],
        "website": "",
        "insurance_accepted": [],
        "cash_rate": 150,
        "sliding_scale": False,
        "free_consult": True,
        "years_experience": 8,
        "availability_windows": ["weekday_morning"],
        "urgency_capacity": "within_2_3_weeks",
        "style_tags": [],
        "bio": "Test bio",
        "profile_picture": "",
        "notify_email": True,
        "notify_sms": False,
        "recruit_code": "ABCD1234",
    }
    res = requests.post(f"{API}/therapists/signup", json=payload, timeout=15)
    assert res.status_code == 200, res.text
    tid = res.json()["id"]
    # Cleanup
    from motor.motor_asyncio import AsyncIOMotorClient

    async def cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = client[os.environ["DB_NAME"]]
            doc = await db.therapists.find_one({"id": tid}, {"_id": 0, "recruit_code": 1, "source": 1})
            assert doc["recruit_code"] == "ABCD1234"
            assert doc["source"] in ("signup", "gap_recruit_signup")
            await db.therapists.delete_one({"id": tid})
        finally:
            client.close()
    asyncio.get_event_loop().run_until_complete(cleanup())
