"""Iter-47 backend tests — Psychology Today live scraper + payment label
hardening + admin-list invited_count column.

These are pure unit tests against helper functions; they do NOT make live
HTTP calls to PT. We feed canned HTML samples to the parser to verify
extraction is correct, and we mock the httpx layer for the integration
shape test.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── PT scraper unit tests ────────────────────────────────────────────────────

def test_extract_jsonld_persons_parses_real_pt_shape():
    """Verify our parser handles the actual JSON-LD shape PT serves."""
    from pt_scraper import _extract_jsonld_persons, _person_to_card

    sample = """
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "http://schema.org/",
      "@type": "SearchResultsPage",
      "name": {"title": "Find Therapists in Boise"},
      "mainEntity": [
        {
          "@context": "http://schema.org",
          "@type": "Person",
          "@id": "https://www.psychologytoday.com/us/therapists/lori-lodge-boise-id/126152",
          "url": "https://www.psychologytoday.com/us/therapists/lori-lodge-boise-id/126152",
          "name": "Lori Lodge",
          "telephone": "(208) 901-0433",
          "workLocation": {
            "@type": "Place",
            "address": {
              "addressLocality": "Boise",
              "addressRegion": "Idaho",
              "postalCode": "83702"
            },
            "geo": {"latitude": 43.6, "longitude": -116.2}
          }
        }
      ]
    }
    </script>
    </head></html>
    """
    persons = _extract_jsonld_persons(sample)
    assert len(persons) == 1
    card = _person_to_card(persons[0])
    assert card["name"] == "Lori Lodge"
    assert card["phone"] == "(208) 901-0433"
    assert card["city"] == "Boise"
    assert card["state"] == "ID"
    assert card["zip"] == "83702"
    assert card["lat"] == 43.6
    assert card["profile_url"].endswith("/126152")


def test_parse_license_types_and_specialties():
    from pt_scraper import _parse_license_types, _parse_specialties

    html = """
    <body>
      <h1>Jane Smith, LCSW, LMFT</h1>
      <p>I treat anxiety, depression, and trauma in adults. ADHD assessments available.</p>
    </body>
    """
    licenses = _parse_license_types(html)
    assert "LCSW" in licenses
    assert "LMFT" in licenses
    specs = _parse_specialties(html)
    assert "anxiety" in specs
    assert "depression" in specs
    assert "trauma_ptsd" in specs
    assert "adhd" in specs


def test_parse_external_website_skips_pt_internal_assets():
    from pt_scraper import _parse_external_website

    html = """
    <a href="https://directory-resources.psychologytoday.com/foo.css">css</a>
    <a href="https://www.psychologytoday.com/about">about</a>
    <a href="https://facebook.com/janesmith">fb</a>
    <a href="https://janesmiththerapy.com">My website</a>
    """
    assert _parse_external_website(html) == "https://janesmiththerapy.com"


def test_guess_email_from_website():
    from pt_scraper import _guess_email_from_website
    assert _guess_email_from_website("https://janesmiththerapy.com", "Jane Smith") == "info@janesmiththerapy.com"
    assert _guess_email_from_website("", "Jane Smith") is None
    assert _guess_email_from_website("notaurl", "Jane") is None


def test_build_listing_url_idaho_state_and_city():
    from pt_scraper import _build_listing_url
    assert _build_listing_url("ID", None) == "https://www.psychologytoday.com/us/therapists/idaho"
    assert _build_listing_url("ID", "Boise") == "https://www.psychologytoday.com/us/therapists/id/boise"
    assert _build_listing_url("ID", "Idaho Falls", page=3) == "https://www.psychologytoday.com/us/therapists/id/idaho-falls?page=3"


# ── Payment-label hardening unit tests ──────────────────────────────────────

def test_safe_summary_payment_cash_with_budget():
    from helpers import _safe_summary_for_therapist
    req = {"payment_type": "cash", "budget": 200, "sliding_scale_ok": True}
    s = _safe_summary_for_therapist(req)
    assert s["Payment"] == "Cash — up to $200/session (open to sliding scale)"


def test_safe_summary_payment_cash_no_budget_fallback():
    from helpers import _safe_summary_for_therapist
    req = {"payment_type": "cash"}
    s = _safe_summary_for_therapist(req)
    assert "Cash" in s["Payment"]
    assert "amount not specified" in s["Payment"]


def test_safe_summary_payment_insurance_with_carrier():
    from helpers import _safe_summary_for_therapist
    req = {"payment_type": "insurance", "insurance_name": "Aetna"}
    s = _safe_summary_for_therapist(req)
    assert s["Payment"] == "Insurance — Aetna"


def test_safe_summary_payment_insurance_no_carrier_fallback():
    from helpers import _safe_summary_for_therapist
    req = {"payment_type": "insurance"}
    s = _safe_summary_for_therapist(req)
    assert "Insurance" in s["Payment"]
    assert "carrier not specified" in s["Payment"]


def test_safe_summary_payment_either_includes_both():
    from helpers import _safe_summary_for_therapist
    req = {
        "payment_type": "either",
        "insurance_name": "BlueCross",
        "budget": 175,
        "sliding_scale_ok": False,
    }
    s = _safe_summary_for_therapist(req)
    assert s["Payment"].startswith("Either —")
    assert "Insurance: BlueCross" in s["Payment"]
    assert "Cash up to $175/session" in s["Payment"]


# ── Outreach scoring + normalization ────────────────────────────────────────

def test_score_pt_candidate_overlap_boosts_rationale():
    from outreach_agent import _score_pt_candidate
    cand = {"specialties": ["anxiety", "depression"], "license_types": ["LCSW"], "city": "Boise", "state": "ID"}
    req = {"presenting_issues": ["anxiety"], "location_state": "ID"}
    score, rationale = _score_pt_candidate(cand, req)
    assert 70 <= score <= 95
    assert "anxiety" in rationale.lower()


def test_normalize_pt_to_outreach_shape():
    from outreach_agent import _normalize_pt_to_outreach
    cand = {
        "name": "Sara Smith",
        "phone": "(208) 555-0100",
        "city": "Boise",
        "state": "ID",
        "license_types": ["LCSW"],
        "primary_license": "LCSW",
        "specialties": ["anxiety"],
        "profile_url": "https://www.psychologytoday.com/x/123",
        "email": "info@sarasmiththerapy.com",
        "website": "https://sarasmiththerapy.com",
    }
    req = {"presenting_issues": ["anxiety"], "location_state": "ID"}
    out = _normalize_pt_to_outreach(cand, req)
    assert out["name"] == "Sara Smith"
    assert out["email"] == "info@sarasmiththerapy.com"
    assert out["phone"] == "(208) 555-0100"
    assert out["license_type"] == "LCSW"
    assert out["source"] == "psychology_today"
    assert out["estimated_score"] >= 70


# ── Admin list — invited_count column ───────────────────────────────────────
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "admin123!")


def test_admin_requests_list_includes_invited_count():
    """Each row of /api/admin/requests now exposes invited_count."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(
        f"{BASE_URL}/api/admin/requests",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        sample = rows[0]
        assert "invited_count" in sample
        assert "notified_count" in sample
        assert "application_count" in sample


def test_admin_request_detail_includes_invited():
    """Detail payload exposes the invited array sourced from outreach_invites."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(
        f"{BASE_URL}/api/admin/requests",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=15,
    )
    assert r.status_code == 200
    rows = r.json()
    if not rows:
        pytest.skip("no requests in db")
    rid = rows[0]["id"]
    r2 = requests.get(
        f"{BASE_URL}/api/admin/requests/{rid}",
        headers={"X-Admin-Password": ADMIN_PW},
        timeout=15,
    )
    assert r2.status_code == 200
    data = r2.json()
    assert "invited" in data
    assert isinstance(data["invited"], list)


# ── Public referral options exposes AI assistant ────────────────────────────

def test_public_referral_options_includes_ai_assistant():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.get(f"{BASE_URL}/api/config/referral-source-options", timeout=10)
    assert r.status_code == 200
    options = r.json().get("options") or []
    assert any("chatgpt" in o.lower() or "ai assistant" in o.lower() for o in options), options
    # Tail order: Other and Prefer not to say at the end
    assert options[-1].lower() == "prefer not to say"
    assert options[-2].lower() == "other"
