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
