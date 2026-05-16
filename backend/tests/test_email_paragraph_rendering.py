r"""Regression tests for the email paragraph helper.

History: this helper has been broken twice in close succession --
  * 8e5b189 added the helper but missed that email_templates.render()
    pre-converts every `\n` to `<br/>\n` BEFORE this helper sees the
    text, so the `\n\s*\n+` split never fired.
  * bbb560d added a leading normalisation step that collapses 2+
    consecutive `<br/>` tags back to `\n\n` BEFORE splitting.

These tests pin both invariants so a future refactor of the splitter
can't silently regress to one-paragraph-soup.

Running just these tests (no live server, no Mongo needed):
  python -m pytest backend/tests/test_email_paragraph_rendering.py -q
"""
from __future__ import annotations

import os
import sys

import pytest

# Make the backend top-level dir importable without env-var ceremony
# (this test doesn't touch Mongo / Stripe / etc.).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Set minimum-required env vars so importing email_service doesn't
# blow up at import time. None of these are actually used by the
# helper under test.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "theravoca_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("CORS_ORIGINS", "*")
os.environ.setdefault("ADMIN_PASSWORD", "test")


def _helper():
    """Late import so env-var setup above lands first."""
    import email_service  # noqa: WPS433 -- intentional late import
    return email_service._text_to_paragraph_html


P_STYLE = "margin:0 0 12px 0"


# ---------------------------------------------------------------------------
# Basic shape
# ---------------------------------------------------------------------------

def test_empty_text_returns_empty_string():
    assert _helper()("", p_style=P_STYLE) == ""


def test_whitespace_only_returns_empty_string():
    assert _helper()("   \n\n  \t  ", p_style=P_STYLE) == ""


def test_single_paragraph_no_breaks():
    """Plain prose with no newlines becomes exactly one <p>."""
    out = _helper()("Hello there.", p_style=P_STYLE)
    assert out == f'<p style="{P_STYLE}">Hello there.</p>'


def test_single_newline_is_a_line_break_not_paragraph():
    """One \\n inside text becomes <br>; still a single <p>."""
    out = _helper()("Line one.\nLine two.", p_style=P_STYLE)
    assert out.count("<p ") == 1
    assert "Line one.<br>Line two." in out


# ---------------------------------------------------------------------------
# The bug Josh caught -- paragraph break preservation
# ---------------------------------------------------------------------------

def test_blank_line_creates_separate_paragraphs():
    """\\n\\n is a paragraph boundary -> two <p> tags."""
    out = _helper()("Para one.\n\nPara two.", p_style=P_STYLE)
    assert out.count("<p ") == 2
    assert "Para one." in out
    assert "Para two." in out


def test_three_paragraphs_round_trip():
    """Three paragraphs separated by blank lines stay distinct."""
    out = _helper()("A.\n\nB.\n\nC.", p_style=P_STYLE)
    assert out.count("<p ") == 3


def test_render_then_helper_preserves_paragraphs():
    """End-to-end regression: email_templates.render() converts
    `\\n` -> `<br/>\\n` BEFORE this helper runs, so naive splitting
    on `\\n\\s*\\n` finds zero matches and collapses everything into
    one paragraph. The helper MUST recognise consecutive <br/> as a
    paragraph break to round-trip correctly.

    This is the exact regression that landed bbb560d.
    """
    raw = "Hi Anna,\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph."
    # Simulate render()'s pre-conversion of \n -> <br/>\n.
    pre_converted = raw.replace("\n", "<br/>\n")
    out = _helper()(pre_converted, p_style=P_STYLE)
    # Four input paragraphs -> four <p> tags in the output.
    assert out.count("<p ") == 4, f"expected 4 paragraphs, got: {out!r}"


def test_helper_handles_multiple_br_variants():
    """The normalisation must catch <br>, <br/>, <br />, and case
    variants -- not just the canonical <br/>."""
    cases = [
        "A.<br><br>B.",
        "A.<br/><br/>B.",
        "A.<br /><br />B.",
        "A.<BR><BR>B.",
        "A.<br/>\n<br/>\nB.",
        "A.<br/> <br/>B.",  # space-separated
    ]
    helper = _helper()
    for src in cases:
        out = helper(src, p_style=P_STYLE)
        assert out.count("<p ") == 2, f"variant {src!r} did not split: {out!r}"


# ---------------------------------------------------------------------------
# Style passthrough
# ---------------------------------------------------------------------------

def test_p_style_is_applied_to_every_paragraph():
    custom = "margin:0;color:red"
    out = _helper()("X.\n\nY.", p_style=custom)
    assert out.count(f'style="{custom}"') == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
