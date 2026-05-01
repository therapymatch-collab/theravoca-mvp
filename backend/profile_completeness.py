"""Profile-completeness scoring for therapists.

Used in three places:
  1. Therapist portal — surfaces a completion meter + checklist so each
     therapist sees exactly what's missing.
  2. Admin dashboard — lets ops see which providers are below the
     "ready-for-go-live" threshold and target them with a claim campaign.
  3. The "Claim & complete your profile" outreach email — embeds the
     checklist directly so therapists know what to fix before they click
     through.

Two tiers of fields:
  REQUIRED   — must all be present for the profile to be "publishable".
               Any missing field zeroes out the publishable flag.
  ENHANCING  — adds polish but isn't a hard gate. Each contributes to the
               soft completeness % only.
"""
from __future__ import annotations

from typing import Any


# Required fields — a therapist must have all of these to be considered
# "publishable" and to count toward the 100% completeness goal. Each tuple
# is (key, friendly_label, validator). The validator returns True if the
# value passes.
def _nonempty_str(min_chars: int = 1):
    def _check(v: Any) -> bool:
        return isinstance(v, str) and len(v.strip()) >= min_chars
    return _check


def _nonempty_list(min_len: int = 1):
    def _check(v: Any) -> bool:
        return isinstance(v, list) and len(v) >= min_len
    return _check


def _truthy(v: Any) -> bool:
    return bool(v)


def _has_office_or_telehealth(t: dict) -> bool:
    if t.get("telehealth") or t.get("modality_offering") in {"telehealth", "both"}:
        return True
    addrs = t.get("office_addresses") or t.get("office_locations") or []
    return isinstance(addrs, list) and len(addrs) > 0


REQUIRED_FIELDS = [
    ("name", "Full name with credentials", _nonempty_str(2)),
    ("email", "Email", _nonempty_str(3)),
    ("phone", "Contact phone", _nonempty_str(7)),
    ("license_number", "License number", _nonempty_str(2)),
    ("license_expires_at", "License expiration date", _truthy),
    ("bio", "Bio (40+ characters)", _nonempty_str(40)),
    ("profile_picture", "Profile photo", _truthy),
    ("primary_specialties", "At least one primary specialty", _nonempty_list(1)),
    ("age_groups", "Age groups you treat", _nonempty_list(1)),
    ("client_types", "Client types (individuals/couples/etc.)", _nonempty_list(1)),
    ("modality_offering", "Session format (virtual / in-person / both)", _truthy),
    ("cash_rate", "Cash rate per session", _truthy),
    # Office vs. telehealth — at least one practice location/option must be set.
    ("__office_or_telehealth__", "At least one office address OR telehealth", _has_office_or_telehealth),
]

ENHANCING_FIELDS = [
    ("years_experience", "Years of experience", _truthy),
    ("secondary_specialties", "Secondary specialties (broadens matches)", _nonempty_list(1)),
    ("modalities", "Therapy modalities (CBT, DBT, etc.)", _nonempty_list(1)),
    ("insurance_accepted", "Insurance plans accepted", _nonempty_list(1)),
    ("languages_spoken", "Languages beyond English", _nonempty_list(1)),
    ("license_picture", "License document upload", _truthy),
    ("free_consult", "Offers a free initial consult", _truthy),
    ("sliding_scale", "Sliding scale availability", _truthy),
    ("website", "Website / Psychology-Today profile", _nonempty_str(4)),
    # Deep match T-fields — needed for advanced matching. Backfilled
    # records are flagged with _deep_match_backfilled=True and should
    # be treated as "incomplete" until the therapist fills them in.
    ("t1_stuck_ranked", "Deep match: session style ranking (T1)", _nonempty_list(5)),
    ("t2_progress_story", "Deep match: client progress story (T2)", _nonempty_str(50)),
    ("t3_breakthrough", "Deep match: breakthrough approach (T3)", _nonempty_list(2)),
    ("t4_hard_truth", "Deep match: hard truth delivery style (T4)", _nonempty_str(1)),
    ("t5_lived_experience", "Deep match: lived experience (T5)", _nonempty_str(30)),
]



def _is_backfilled_field(therapist: dict, field_key: str) -> bool:
    """Check if a specific field was backfilled with synthetic data."""
    if not therapist.get("_deep_match_backfilled"):
        return False
    bf_fields = therapist.get("_deep_match_backfilled_fields") or []
    return field_key in bf_fields

def evaluate(therapist: dict) -> dict:
    """Returns:
      {
        "score": int (0-100),
        "publishable": bool,                 # all REQUIRED fields pass
        "required_missing": list[{key,label}],
        "enhancing_missing": list[{key,label}],
        "required_total": int,
        "required_done": int,
        "enhancing_total": int,
        "enhancing_done": int,
      }

    The score weights REQUIRED at 70% and ENHANCING at 30% — a therapist
    with all required fields but zero enhancing fields shows 70%, signalling
    "you're publishable but not as polished as you could be." A therapist
    who finishes everything reaches a clean 100.
    """
    if not therapist:
        return {
            "score": 0,
            "publishable": False,
            "required_missing": [{"key": k if not k.startswith("__") else k.strip("_"), "label": label}
                                 for (k, label, _v) in REQUIRED_FIELDS],
            "enhancing_missing": [{"key": k, "label": label}
                                  for (k, label, _v) in ENHANCING_FIELDS],
            "required_total": len(REQUIRED_FIELDS),
            "required_done": 0,
            "enhancing_total": len(ENHANCING_FIELDS),
            "enhancing_done": 0,
        }

    req_missing: list[dict] = []
    req_done = 0
    for key, label, validator in REQUIRED_FIELDS:
        if key.startswith("__"):
            ok = validator(therapist)
        else:
            ok = validator(therapist.get(key))
        if ok:
            req_done += 1
        else:
            # For the synthetic key, drop the underscores so the UI gets a
            # clean identifier it can wire test ids against.
            clean = key.strip("_") if key.startswith("__") else key
            req_missing.append({"key": clean, "label": label})

    enh_missing: list[dict] = []
    enh_done = 0
    for key, label, validator in ENHANCING_FIELDS:
        if validator(therapist.get(key)):
            enh_done += 1
        else:
            enh_missing.append({"key": key, "label": label})

    req_pct = req_done / max(1, len(REQUIRED_FIELDS))
    enh_pct = enh_done / max(1, len(ENHANCING_FIELDS))
    score = round(req_pct * 70 + enh_pct * 30)
    publishable = req_done == len(REQUIRED_FIELDS)
    return {
        "score": score,
        "publishable": publishable,
        "required_missing": req_missing,
        "enhancing_missing": enh_missing,
        "required_total": len(REQUIRED_FIELDS),
        "required_done": req_done,
        "enhancing_total": len(ENHANCING_FIELDS),
        "enhancing_done": enh_done,
    }
