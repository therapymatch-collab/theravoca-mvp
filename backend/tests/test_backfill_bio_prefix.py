"""Regression tests for the credential-aware bio + license prefix logic
in `backfill.backfill_therapist`.

Background: `_resolve_license_pool` used to do a case-sensitive lookup
against lowercase internal tokens (`lcsw`, `lpc`, ...) which silently
fell back to the LCSW pool whenever a therapist's stored
`credential_type` was an uppercase abbreviation (`LPC`) or a full title
(`Licensed Professional Counselor (LPC)`). Result: an LPC's bio said
"Ann is a LCSW" and the license_number prefix came out wrong too.
"""
from __future__ import annotations

import random


def test_resolve_license_pool_handles_case_and_titles():
    from backfill import _resolve_license_pool

    # Lowercase internal tokens
    assert _resolve_license_pool("lpc")[0] in {"LPC", "LPCC", "LCPC", "LCMHC"}
    assert _resolve_license_pool("lcsw") == ["LCSW", "LICSW"]
    assert _resolve_license_pool("psychologist") == ["PhD", "PsyD"]

    # Uppercase abbreviations (signup-form values)
    assert _resolve_license_pool("LPC")[0] in {"LPC", "LPCC", "LCPC", "LCMHC"}
    assert _resolve_license_pool("LCSW") == ["LCSW", "LICSW"]
    assert _resolve_license_pool("PhD") == ["PhD", "PsyD"]
    assert _resolve_license_pool("LMFT") == ["LMFT"]

    # Full title with parenthesised abbreviation
    assert _resolve_license_pool("Licensed Professional Counselor (LPC)") == [
        "LPC", "LPCC", "LCPC", "LCMHC",
    ]
    assert "LCSW" in _resolve_license_pool("Licensed Clinical Social Worker (LCSW)")

    # Empty / unknown safely falls back to LCSW pool
    assert _resolve_license_pool("") == ["LCSW"]
    assert _resolve_license_pool("Unknown") == ["LCSW"]


def test_backfill_uses_actual_credential_in_bio_and_license():
    from backfill import backfill_therapist

    random.seed(42)
    t = {
        "id": "t-lpc",
        "name": "Ann Omodt",
        "email": "therapymatch+t001@gmail.com",
        "credential_type": "LPC",  # uppercase, like the signup form ships
    }
    out = backfill_therapist(t, 1)

    # The bio should reference an LPC-family suffix, never LCSW.
    bio = out["bio"]
    assert bio.startswith("Ann is a "), bio
    suffix = bio.split("Ann is a ", 1)[1].split(" ", 1)[0]
    assert suffix in {"LPC", "LPCC", "LCPC", "LCMHC"}, (suffix, bio)
    assert "LCSW" not in bio.split(".")[0], bio

    # license_number prefix must match the credential family too.
    assert out["license_number"].split("-")[0] in {"LPC", "LCP"}, out["license_number"]


def test_backfill_lcsw_path_still_works():
    from backfill import backfill_therapist

    random.seed(7)
    t = {
        "id": "t-lcsw",
        "name": "Sam Smith",
        "email": "therapymatch+t002@gmail.com",
        "credential_type": "LCSW",
    }
    out = backfill_therapist(t, 2)
    assert out["bio"].startswith("Sam is a ")
    suf = out["bio"].split("Sam is a ", 1)[1].split(" ", 1)[0]
    assert suf in {"LCSW", "LICSW"}
    assert out["license_number"].startswith("LCS-")
