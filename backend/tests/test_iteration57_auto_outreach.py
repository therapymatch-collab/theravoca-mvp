"""Iter-57 Task 4: auto-LLM outreach fires after /api/requests/verify/{token}
when notified_count < 30.

Posts a fresh request, polls the verify_link, then polls /admin/requests/{id}
for outreach_invites or invited_count.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

API = os.environ.get(
    "API_BASE_URL",
    "https://match-engine-test-1.preview.emergentagent.com/api",
)
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
HDR = {"X-Admin-Password": ADMIN_PWD}


def _lift_rate_limit():
    requests.put(
        f"{API}/admin/intake-rate-limit",
        json={"max_requests_per_window": 50, "window_minutes": 1},
        headers=HDR,
        timeout=10,
    )


def test_auto_outreach_fires_on_verify_under_30():
    _lift_rate_limit()
    payload = {
        "email": f"iter57auto+{uuid.uuid4().hex[:8]}@test.example.com",
        "phone": "",
        "client_type": "individual",
        "age_group": "adult",
        "location_state": "WY",  # rare state to ensure <30 directory matches
        "location_city": "Jackson",
        "location_zip": "83001",
        "presenting_issues": ["anxiety"],
        "modality_preference": "telehealth",
        "payment_type": "cash",
        "budget": 200,
        "urgency": "within_2_3_weeks",
        "previous_therapy": False,
        "gender_preference": "any",
        "preferred_language": "English",
        "sms_opt_in": False,
        "agreed": True,
    }
    r = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    rid = body["id"]
    # POST /requests doesn't expose verify_link; fetch verification_token from Mongo
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _fetch_token():
        client = AsyncIOMotorClient(mongo_url)
        try:
            doc = await client[db_name].requests.find_one(
                {"id": rid}, {"verification_token": 1, "_id": 0}
            )
            return doc.get("verification_token") if doc else None
        finally:
            client.close()

    token = asyncio.get_event_loop().run_until_complete(_fetch_token())
    assert token, f"could not fetch verification_token for {rid}"

    vr = requests.get(f"{API}/requests/verify/{token}", timeout=20)
    assert vr.status_code in (200, 302, 303, 307, 308), vr.text

    # Poll request state until matching has run (notified counts settle)
    deadline = time.time() + 30
    notified = None
    outreach_needed = None
    invited = 0
    while time.time() < deadline:
        d = requests.get(
            f"{API}/admin/requests/{rid}", headers=HDR, timeout=15
        ).json()
        # Response shape: {request:{...}, notified:[...], applications:[...], invited:[...], match_gap:{...}}
        req_doc = d.get("request", {})
        if req_doc.get("status") in ("matched", "matched_partial", "active"):
            notified = len(d.get("notified", []) or [])
            outreach_needed = req_doc.get("outreach_needed_count", 0) or 0
            invited = len(d.get("invited", []) or [])
            if invited > 0:
                break
        time.sleep(3)

    assert notified is not None, f"request {rid} never reached matched status"
    if notified >= 30:
        pytest.skip(f"directory yielded {notified} matches — outreach not triggered (expected behaviour)")
    assert outreach_needed and outreach_needed > 0, (
        f"notified={notified}<30 but outreach_needed_count={outreach_needed}; "
        f"helpers._trigger_matching did not compute the gap"
    )

    # Auto-outreach triggers via background task; confirm via backend log line
    # AND/OR the invited list growing.
    time.sleep(3)
    log_path_candidates = [
        "/var/log/supervisor/backend.out.log",
        "/var/log/supervisor/backend.err.log",
    ]
    found_log = False
    for p in log_path_candidates:
        try:
            with open(p, "r") as f:
                if f"Scheduled background outreach for {rid}" in f.read():
                    found_log = True
                    break
        except FileNotFoundError:
            continue
    # Re-fetch invited count one last time
    d = requests.get(f"{API}/admin/requests/{rid}", headers=HDR, timeout=15).json()
    invited = len(d.get("invited", []) or [])
    assert found_log or invited > 0, (
        f"OUTREACH_AUTO_RUN background task did not fire for {rid} "
        f"(no log line, invited={invited})"
    )
