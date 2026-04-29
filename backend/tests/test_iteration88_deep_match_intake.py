"""Iter-88 — patient deep-match opt-in fields (P1/P2/P3).

The intake form now offers an optional "deep match" flow that asks 3
nuance questions on top of the existing 8 steps. The fields land on the
same `RequestCreate` model and persist on the request doc; backend
matching wiring lands in a follow-up iteration.
"""
from __future__ import annotations


def test_request_create_accepts_deep_match_fields():
    from models import RequestCreate

    payload = {
        "email": "patient@example.com",
        "location_state": "ID",
        "client_type": "individual",
        "age_group": "adult",
        "presenting_issues": ["anxiety"],
        "deep_match_opt_in": True,
        "p1_communication": ["truth", "listen"],
        "p2_change": ["self_understanding", "relationships"],
        "p3_resonance": "Eldest immigrant child — always holding it together.",
    }
    req = RequestCreate(**payload)
    assert req.deep_match_opt_in is True
    assert req.p1_communication == ["truth", "listen"]
    assert req.p2_change == ["self_understanding", "relationships"]
    assert "Eldest" in req.p3_resonance


def test_request_create_defaults_when_deep_match_skipped():
    """Standard intake (deep_match_opt_in=False or None) leaves every
    deep field empty/null. No validation error."""
    from models import RequestCreate

    base = {
        "email": "patient@example.com",
        "location_state": "ID",
        "client_type": "individual",
        "age_group": "adult",
        "presenting_issues": ["anxiety"],
    }
    req_skip = RequestCreate(**base)
    assert req_skip.deep_match_opt_in is None
    assert req_skip.p1_communication == []
    assert req_skip.p2_change == []
    assert req_skip.p3_resonance == ""

    req_skip2 = RequestCreate(**base, deep_match_opt_in=False)
    assert req_skip2.deep_match_opt_in is False


def test_request_create_caps_pick_lists_at_two():
    """P1/P2 should reject more than 2 picks — the form allows exactly 2,
    so anything more is a malformed payload (or a probe)."""
    import pytest
    from pydantic import ValidationError
    from models import RequestCreate

    base = {
        "email": "patient@example.com",
        "location_state": "ID",
        "client_type": "individual",
        "age_group": "adult",
        "presenting_issues": ["anxiety"],
    }
    with pytest.raises(ValidationError):
        RequestCreate(**base, p1_communication=["a", "b", "c"])
    with pytest.raises(ValidationError):
        RequestCreate(**base, p2_change=["a", "b", "c", "d"])
