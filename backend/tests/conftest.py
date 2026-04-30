"""Shared pytest helpers — v2 schema payloads."""
from __future__ import annotations


def v2_request_payload(**overrides):
    """v2 RequestCreate payload — caller can override any field."""
    base = {
        "email": "test_request@example.com",
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
    base.update(overrides)
    return base


def v2_therapist_signup_payload(**overrides):
    """v2 TherapistSignup payload — caller can override any field."""
    base = {
        "name": "Test Therapist, LCSW",
        "email": "test_therapist@example.com",
        "phone_alert": "(208) 555-0001",
        "office_phone": "(208) 555-9999",
        "gender": "female",
        "licensed_states": ["ID"],
        "license_number": "LCSW-TEST",
        "license_expires_at": "2027-12-31",
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "primary_specialties": ["anxiety"],
        "modalities": ["CBT"],
        "modality_offering": "both",
        "office_locations": ["Boise"],
        "insurance_accepted": [],
        "cash_rate": 150,
        "sliding_scale": False,
        "years_experience": 5,
        "availability_windows": ["weekday_morning"],
        "urgency_capacity": "within_2_3_weeks",
        "style_tags": [],
        "free_consult": False,
        "bio": "Test therapist bio.",
        "credential_type": "lcsw",
    }
    base.update(overrides)
    return base



# ─── Turnstile bypass for the test session ────────────────────────────────
# Most legacy integration tests hit `POST /api/requests` and
# `POST /api/therapists/signup` with placeholder turnstile tokens that fail
# real verification, so all those tests bounce with HTTP 400
# `Missing security verification token.`. This autouse fixture has TWO
# strategies, applied together:
#
#   (1) Monkey-patch `turnstile_service.verify_token` for in-process
#       tests that import the matching engine / scoring helpers
#       directly.
#
#   (2) Hit the admin runtime "disable Turnstile" toggle on the live
#       backend so HTTP-driven integration tests (`requests.Session`)
#       also get bypassed. Toggle is restored at session teardown.
import os  # noqa: E402
import sys  # noqa: E402

import pytest  # noqa: E402
import requests as _req  # noqa: E402

# Make the backend top-level dir importable so we can grab `turnstile_service`.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _admin_set_turnstile(disabled: bool) -> None:
    """Best-effort flip of the runtime Turnstile toggle. Silent on
    network errors — most pure-unit tests don't even need this branch."""
    api = os.environ.get("REACT_APP_BACKEND_URL")
    if not api:
        # Local fallback — backend listens on 8001 in supervisor.
        api = "http://localhost:8001"
    try:
        _req.put(
            f"{api}/api/admin/turnstile-settings",
            headers={"X-Admin-Password": "admin123!"},
            json={"disabled": disabled, "reason": "pytest" if disabled else ""},
            timeout=4,
        )
    except Exception:
        pass


@pytest.fixture(autouse=True, scope="session")
def _bypass_turnstile_in_tests():
    """Globally short-circuit Turnstile verification for the test session.
    Restores the real implementation + admin toggle at teardown."""
    # ── In-process monkeypatch ────────────────────────────────────
    real_verify = None
    try:
        import turnstile_service
        real_verify = turnstile_service.verify_token

        async def _bypass(token, ip=None):  # noqa: ARG001
            return True, None

        turnstile_service.verify_token = _bypass
    except ImportError:
        pass

    # ── Live backend admin-toggle disable ─────────────────────────
    _admin_set_turnstile(disabled=True)

    try:
        yield
    finally:
        if real_verify is not None:
            try:
                import turnstile_service
                turnstile_service.verify_token = real_verify
            except ImportError:
                pass
        _admin_set_turnstile(disabled=False)
