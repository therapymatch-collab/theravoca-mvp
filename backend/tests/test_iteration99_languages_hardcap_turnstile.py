"""Iteration 99 backend tests:
- Task 1: languages_spoken cleanup verification
- Task 2: GET /api/config/hard-capacity & /api/admin/hard-capacity
- Task 3: turnstile config + admin toggle endpoints + verify_token short-circuit
- Task 4: outreach invite rationale wording ('Your practice focus')
"""
import os
import re
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_PWD = "admin123!"
H_ADMIN = {"X-Admin-Password": ADMIN_PWD, "Content-Type": "application/json"}

GARBAGE = {
    "❌ online only", "online only", "316 w boone", "suite 656",
    "spokane", "tennessee", "wa",
}
STREET_SUFFIX = re.compile(r"\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pkwy|parkway|w|e|n|s|suite|ste)\b", re.I)


# ---- Task 1 ---------------------------------------------------------
class TestTask1LanguagesCleanup:
    def test_no_garbage_in_languages_spoken(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        async def _check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client[os.environ.get("DB_NAME", "test_database")]
            cursor = db.therapists.find({}, {"_id": 0, "id": 1, "languages_spoken": 1})
            offenders = []
            async for t in cursor:
                for raw in (t.get("languages_spoken") or []):
                    s = str(raw).strip()
                    sl = s.lower()
                    if not s:
                        continue
                    if sl in GARBAGE:
                        offenders.append((t.get("id"), s, "exact-garbage"))
                    elif any(c.isdigit() for c in s):
                        offenders.append((t.get("id"), s, "has-digit"))
                    elif STREET_SUFFIX.search(s) and len(s.split()) > 1:
                        offenders.append((t.get("id"), s, "street-suffix"))
            client.close()
            return offenders
        offenders = asyncio.get_event_loop().run_until_complete(_check())
        assert offenders == [], f"Garbage found in languages_spoken: {offenders[:10]}"


# ---- Task 4 ---------------------------------------------------------
class TestTask4OutreachWording:
    def test_outreach_agent_module_uses_your_practice(self):
        from pathlib import Path
        src = Path("/app/backend/outreach_agent.py").read_text()
        assert "Your practice focus on" in src
        assert "Their practice focus" not in src

    def test_outreach_invite_rationale_contains_your(self):
        # Try to fetch existing outreach invites; not all envs may have any.
        r = requests.get(f"{BASE_URL}/api/admin/outreach-invites", headers=H_ADMIN, timeout=20)
        if r.status_code != 200:
            pytest.skip(f"outreach-invites endpoint returned {r.status_code}")
        body = r.json()
        items = body.get("invites") or body.get("items") or body if isinstance(body, list) else body.get("results", [])
        if isinstance(body, dict) and not items:
            for k in ("invites", "items", "results", "data"):
                if isinstance(body.get(k), list):
                    items = body[k]
                    break
        rats = []
        for it in (items or []):
            for k in ("rationale", "reasons", "match_reasons", "preview", "body", "email_body"):
                v = it.get(k) if isinstance(it, dict) else None
                if isinstance(v, str):
                    rats.append(v)
                elif isinstance(v, list):
                    rats.extend(str(x) for x in v)
        joined = " ".join(rats)
        if not joined:
            pytest.skip("No outreach invite rationale text available in DB")
        # Anywhere it mentions practice focus, must use 'Your practice focus'
        if "practice focus" in joined.lower():
            assert "Their practice focus" not in joined
            assert "Your practice focus" in joined


# ---- Task 3 ---------------------------------------------------------
class TestTask3Turnstile:
    def teardown_method(self, method):
        # Always restore disabled=False
        requests.put(
            f"{BASE_URL}/api/admin/turnstile-settings",
            headers=H_ADMIN,
            json={"disabled": False, "reason": ""},
            timeout=15,
        )

    def test_public_turnstile_config_shape(self):
        r = requests.get(f"{BASE_URL}/api/config/turnstile", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "enabled" in body
        assert isinstance(body["enabled"], bool)

    def test_admin_get_settings_shape(self):
        r = requests.get(f"{BASE_URL}/api/admin/turnstile-settings", headers=H_ADMIN, timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("disabled", "disabled_at", "disabled_reason", "configured"):
            assert k in body, f"missing key {k}"

    def test_toggle_disable_then_enable(self):
        # Disable
        r = requests.put(
            f"{BASE_URL}/api/admin/turnstile-settings",
            headers=H_ADMIN,
            json={"disabled": True, "reason": "test"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["disabled"] is True

        g = requests.get(f"{BASE_URL}/api/admin/turnstile-settings", headers=H_ADMIN, timeout=15).json()
        assert g["disabled"] is True
        assert g["disabled_reason"] == "test"
        assert g["disabled_at"]

        # public should now reflect enabled=false
        pub = requests.get(f"{BASE_URL}/api/config/turnstile", timeout=15).json()
        assert pub["enabled"] is False

        # Re-enable
        r2 = requests.put(
            f"{BASE_URL}/api/admin/turnstile-settings",
            headers=H_ADMIN,
            json={"disabled": False},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["disabled"] is False

        g2 = requests.get(f"{BASE_URL}/api/admin/turnstile-settings", headers=H_ADMIN, timeout=15).json()
        assert g2["disabled"] is False

        pub2 = requests.get(f"{BASE_URL}/api/config/turnstile", timeout=15).json()
        # enabled = configured AND not disabled — depends on whether keys are set
        assert pub2["enabled"] == g2["configured"]

    def test_verify_token_short_circuits_when_disabled(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import turnstile_service

        # Set disabled=True
        requests.put(
            f"{BASE_URL}/api/admin/turnstile-settings",
            headers=H_ADMIN, json={"disabled": True, "reason": "verify_short_circuit"},
            timeout=15,
        )

        async def _go():
            ok, err = await turnstile_service.verify_token("garbage-token-not-a-real-one")
            return ok, err
        ok, err = asyncio.get_event_loop().run_until_complete(_go())
        assert ok is True, f"expected True (short-circuit) when disabled, got ok={ok} err={err}"
        assert err is None


# ---- Task 2 ---------------------------------------------------------
class TestTask2HardCapacity:
    def test_public_hard_capacity_shape(self):
        r = requests.get(f"{BASE_URL}/api/config/hard-capacity", timeout=20)
        assert r.status_code == 200
        body = r.json()
        for k in ("pool_size", "min_required", "disabled", "protections"):
            assert k in body, f"missing {k}"
        assert body["min_required"] == 30
        assert isinstance(body["pool_size"], int)
        d = body["disabled"]
        for axis in ("language_strict", "gender_required", "in_person_only", "telehealth_only", "insurance_strict", "urgency_strict"):
            assert axis in d, f"missing axis {axis}"
        assert isinstance(d["language_strict"], list)
        assert isinstance(d["in_person_only"], bool)
        assert isinstance(d["telehealth_only"], bool)

    def test_public_hard_capacity_excludes_raw_counts(self):
        r = requests.get(f"{BASE_URL}/api/config/hard-capacity", timeout=20).json()
        assert "counts" not in r, "raw counts should be admin-only"

    def test_admin_hard_capacity_includes_counts(self):
        r = requests.get(f"{BASE_URL}/api/admin/hard-capacity", headers=H_ADMIN, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "counts" in body
        c = body["counts"]
        for k in ("language", "gender", "insurance", "urgency", "in_person", "telehealth"):
            assert k in c, f"missing counts.{k}"

    def test_expected_disabled_options_present(self):
        body = requests.get(f"{BASE_URL}/api/config/hard-capacity", timeout=20).json()
        d = body["disabled"]
        # Pool ~122 with the seeded directory.
        # Per spec these languages should be < 30 speakers and thus disabled.
        for lang in ("Mandarin", "Korean", "Vietnamese"):
            # Compare case-insensitively
            assert any(lang.lower() == s.lower() for s in d["language_strict"]), (
                f"Expected '{lang}' in language_strict disabled list, got {d['language_strict']}"
            )
        # nonbinary should be a tiny bucket
        assert any("nonbinary" == g.lower() for g in d["gender_required"]), (
            f"Expected 'nonbinary' in gender_required, got {d['gender_required']}"
        )
        # asap should be a thin urgency bucket
        assert "asap" in [u.lower() for u in d["urgency_strict"]], (
            f"Expected 'asap' in urgency_strict, got {d['urgency_strict']}"
        )

    def test_protections_have_axis_value_count_label(self):
        body = requests.get(f"{BASE_URL}/api/config/hard-capacity", timeout=20).json()
        for p in body["protections"]:
            for k in ("axis", "value", "count", "label"):
                assert k in p, f"protection missing {k}: {p}"
            assert isinstance(p["count"], int)
            assert p["label"]
