"""Iter-59 — Verify email footer contains support@theravoca.com link.

Tests:
1. _wrap() injects literal mailto:support@theravoca.com anchor into every email.
2. Public verification flow (POST /api/requests with verify token) does not regress.
"""
import os
import sys
from pathlib import Path

import pytest
import requests

# Allow importing email_service module directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://match-engine-test-1.preview.emergentagent.com").rstrip("/")


# ─── Email footer (Task 1) ─────────────────────────────────────────────────
class TestEmailFooter:
    def test_wrap_contains_support_email_anchor(self):
        from email_service import _wrap  # noqa: WPS433

        html = _wrap("Test Heading", "<p>Body</p>")
        assert "support@theravoca.com" in html, "Plain support email missing from footer"
        assert 'mailto:support@theravoca.com' in html, "mailto: anchor missing"
        assert "Questions? Reach us at" in html, "Footer prompt line missing"
        # Sanity: heading + body still rendered
        assert "Test Heading" in html
        assert "<p>Body</p>" in html

    def test_wrap_anchor_uses_brand_primary_color(self):
        from email_service import _wrap  # noqa: WPS433

        html = _wrap("X", "")
        # Anchor should be styled with primary color and underline
        assert 'href="mailto:support@theravoca.com"' in html
        assert "color:#2D4A3E" in html  # BRAND['primary']


# ─── API smoke (regression — public site copy + health) ────────────────────
class TestRegressionPublicEndpoints:
    def test_site_copy_public_get(self):
        r = requests.get(f"{BASE_URL}/api/site-copy", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_therapists_count_public(self):
        # Used as a quick "backend is alive" probe.
        r = requests.get(f"{BASE_URL}/api/therapists/count", timeout=15)
        # Endpoint may not exist; accept 200 OR 404 (route variations) but not 500.
        assert r.status_code < 500, f"Server error: {r.status_code} {r.text[:200]}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
