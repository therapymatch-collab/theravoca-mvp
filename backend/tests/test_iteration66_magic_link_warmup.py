"""Iter-66 backend tests:
1. Magic-link verify-code returns token for valid code.
2. Patient referral rate-limit: 200 then 429 with wait-minutes msg; different emails OK.
3. Deep-research warmup endpoints (POST/GET) + count clamping.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_PWD = os.environ.get("ADMIN_PASSWORD", "admin123!")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

ADMIN_HEADERS = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}
TEST_THERAPIST_EMAIL = "therapymatch+t101@gmail.com"


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# ─── 1. Magic-link verify ──────────────────────────────────────────────
class TestMagicLink:
    def test_request_then_verify_returns_token(self, db):
        # Request a fresh code
        r = requests.post(
            f"{BASE_URL}/api/auth/request-code",
            json={"email": TEST_THERAPIST_EMAIL, "role": "therapist"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Read latest magic_codes record from DB
        time.sleep(0.5)
        rec = db.magic_codes.find_one(
            {"email": TEST_THERAPIST_EMAIL, "role": "therapist", "used": False},
            sort=[("created_at", -1)],
        )
        assert rec is not None, "magic_codes record not found"
        code = rec["code"]
        assert len(code) == 6 and code.isdigit()

        # Verify
        r2 = requests.post(
            f"{BASE_URL}/api/auth/verify-code",
            json={"email": TEST_THERAPIST_EMAIL, "role": "therapist", "code": code},
            timeout=10,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 10
        assert body["role"] == "therapist"
        assert body["email"] == TEST_THERAPIST_EMAIL
        assert "has_password" in body

    def test_invalid_code_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/verify-code",
            json={"email": TEST_THERAPIST_EMAIL, "role": "therapist", "code": "000000"},
            timeout=10,
        )
        assert r.status_code == 401


# ─── 2. Patient rate-limit ─────────────────────────────────────────────
def _patient_payload(email: str) -> dict:
    return {
        "email": email,
        "location_state": "ID",
        "location_city": "Boise",
        "location_zip": "83702",
        "client_type": "individual",
        "age_group": "adult",
        "payment_type": "cash",
        "budget": 200,
        "sliding_scale_ok": False,
        "presenting_issues": ["anxiety"],
        "availability_windows": ["weekday_morning"],
        "modality_preference": "hybrid",
        "modality_preferences": [],
        "urgency": "flexible",
        "prior_therapy": "not_sure",
        "experience_preference": "no_pref",
        "gender_preference": "no_pref",
        "gender_required": False,
        "style_preference": [],
    }


class TestRateLimit:
    def test_same_email_429_with_wait_minutes(self):
        email = f"ratelimit_test_{uuid.uuid4().hex[:8]}@gmail.com"
        r1 = requests.post(f"{BASE_URL}/api/requests", json=_patient_payload(email), timeout=15)
        assert r1.status_code == 200, r1.text

        r2 = requests.post(f"{BASE_URL}/api/requests", json=_patient_payload(email), timeout=15)
        assert r2.status_code == 429, r2.text
        detail = r2.json().get("detail", "")
        assert "already submitted a referral" in detail
        # Should mention wait minutes (numeric)
        import re
        m = re.search(r"about (\d+) minute", detail)
        assert m is not None, f"no 'about N minute' in detail: {detail}"
        assert int(m.group(1)) > 0

    def test_different_emails_dont_share_limit(self):
        email_a = f"ratelimit_test_a_{uuid.uuid4().hex[:8]}@gmail.com"
        email_b = f"ratelimit_test_b_{uuid.uuid4().hex[:8]}@gmail.com"
        rA = requests.post(f"{BASE_URL}/api/requests", json=_patient_payload(email_a), timeout=15)
        assert rA.status_code == 200, rA.text
        rB = requests.post(f"{BASE_URL}/api/requests", json=_patient_payload(email_b), timeout=15)
        assert rB.status_code == 200, rB.text


# ─── 3. Deep-research warmup ───────────────────────────────────────────
class TestWarmup:
    def test_warmup_count_clamped_low(self, db):
        # Wait for any in-flight warmup to settle, then start with 0 → clamped to 1
        for _ in range(20):
            cur = db.app_config.find_one({"key": "deep_research_warmup"})
            if not cur or not cur.get("running"):
                break
            time.sleep(2)
        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/warmup",
            headers=ADMIN_HEADERS, json={"count": 0}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("started") is True
        assert body.get("queued") == 1

    def test_warmup_count_clamped_high(self, db):
        # Wait for previous warmup to finish
        for _ in range(60):
            cur = db.app_config.find_one({"key": "deep_research_warmup"})
            if not cur or not cur.get("running"):
                break
            time.sleep(2)
        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/warmup",
            headers=ADMIN_HEADERS, json={"count": 9999}, timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Clamped to min(200, available active therapists). 123 expected.
        assert body.get("queued") <= 200
        assert body.get("queued") >= 1

    def test_warmup_status_endpoint_running_then_done(self, db):
        # Wait for previous warmup to finish first
        for _ in range(120):
            cur = db.app_config.find_one({"key": "deep_research_warmup"})
            if not cur or not cur.get("running"):
                break
            time.sleep(2)

        r = requests.post(
            f"{BASE_URL}/api/admin/research-enrichment/warmup",
            headers=ADMIN_HEADERS, json={"count": 2}, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("queued") == 2

        # Poll status
        time.sleep(2)
        r2 = requests.get(
            f"{BASE_URL}/api/admin/research-enrichment/warmup",
            headers=ADMIN_HEADERS, timeout=10,
        )
        assert r2.status_code == 200, r2.text
        s = r2.json()
        assert s.get("total") == 2
        # running True initially, current_name may be set
        assert "running" in s
        assert "done" in s

        # Wait up to 90s for completion
        for _ in range(45):
            r3 = requests.get(
                f"{BASE_URL}/api/admin/research-enrichment/warmup",
                headers=ADMIN_HEADERS, timeout=10,
            )
            s3 = r3.json()
            if not s3.get("running"):
                break
            time.sleep(2)
        assert s3.get("running") is False, f"warmup still running after 90s: {s3}"
        assert s3.get("done", 0) + s3.get("failed", 0) == 2
