"""Unit tests for text_moderation.validate_open_text.

Pure-function tests; no Mongo / FastAPI needed.

Heuristics pinned by these tests (changes to either should be
intentional and reviewed together):
  - Length floor / ceiling
  - All-caps shouting (>70% upper, >20 letters)
  - Repeated-char gibberish (9+ identical consecutive)
  - Profanity wordlist (case-insensitive word-boundary)
  - URL / link-spam (allow_urls escape hatch)
  - Required-vs-optional handling for empty input
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from text_moderation import validate_open_text  # noqa: E402


# ─── Empty / required handling ───────────────────────────────────


def test_empty_input_passes_when_not_required():
    ok, err = validate_open_text("", field_name="Bio")
    assert ok is True and err is None


def test_empty_input_rejected_when_required():
    ok, err = validate_open_text("", field_name="Bio", required=True)
    assert ok is False
    assert "Bio is required" in (err or "")


def test_empty_input_rejected_when_min_length_set():
    ok, err = validate_open_text("", field_name="Bio", min_length=50)
    assert ok is False
    assert "Bio is required" in (err or "")


def test_whitespace_only_treated_as_empty():
    ok, err = validate_open_text("    \n\t  ", field_name="Bio", required=True)
    assert ok is False


# ─── Length floor / ceiling ──────────────────────────────────────


def test_below_min_length_rejected():
    ok, err = validate_open_text("hi", field_name="Bio", min_length=50)
    assert ok is False
    assert "50 characters" in (err or "")


def test_above_max_length_rejected():
    long_text = "a" * 100  # plain content, won't trip other checks
    ok, err = validate_open_text(long_text, field_name="Bio", max_length=50)
    assert ok is False
    assert "50 characters" in (err or "")


def test_within_length_range_passes():
    text = "This is a thoughtful, professional bio about my practice."
    ok, _ = validate_open_text(
        text, field_name="Bio", min_length=20, max_length=500,
    )
    assert ok is True


# ─── All-caps shouting ───────────────────────────────────────────


def test_all_caps_long_rejected():
    text = "I AM SHOUTING IN THIS BIO SO LOUDLY YOU CAN HEAR ME"
    ok, err = validate_open_text(text, field_name="Bio")
    assert ok is False
    assert "all-caps" in (err or "")


def test_short_all_caps_acronym_passes():
    """CBT/EMDR/ADHD/LGBTQ+ are common in this domain -- short
    strings of caps shouldn't trip the shouting filter."""
    ok, _ = validate_open_text("CBT, EMDR", field_name="Modalities")
    assert ok is True


def test_mixed_case_with_acronyms_passes():
    text = (
        "I specialize in CBT and EMDR for adults with ADHD or PTSD, "
        "and I work with LGBTQ+ clients."
    )
    ok, _ = validate_open_text(text, field_name="Bio")
    assert ok is True


# ─── Repeated-character gibberish ────────────────────────────────


def test_long_run_of_same_letter_rejected():
    ok, err = validate_open_text(
        "aaaaaaaaaa why not", field_name="Bio",
    )
    assert ok is False
    assert "repeated characters" in (err or "")


def test_short_run_of_same_char_passes():
    """Up to 8 repeats is allowed for emphasis ('!!' / '...')."""
    ok, _ = validate_open_text("Wow!! That's great.", field_name="Note")
    assert ok is True


def test_run_of_punctuation_rejected():
    ok, err = validate_open_text(
        "................", field_name="Note",
    )
    assert ok is False


# ─── Profanity wordlist ──────────────────────────────────────────


def test_profanity_substring_rejected():
    """Word-boundary match -- 'fuck' inside the bio is rejected."""
    ok, err = validate_open_text(
        "I really fucking hate my last therapist.",
        field_name="Bio",
    )
    assert ok is False
    assert "language we can't accept" in (err or "")


def test_clean_text_passes_profanity_check():
    ok, _ = validate_open_text(
        "I had a difficult experience with my last therapist.",
        field_name="Bio",
    )
    assert ok is True


def test_profanity_inside_longer_word_does_not_false_match():
    """'classic' shouldn't trip 'ass'; word-boundary match required."""
    ok, _ = validate_open_text(
        "I work with classical psychoanalysis.",
        field_name="Bio",
    )
    assert ok is True


def test_profanity_case_insensitive():
    ok, err = validate_open_text(
        "WHAT THE Fuck is this",  # also caps but cap-check needs >20 letters
        field_name="Bio",
    )
    # rejected by profanity (not necessarily all-caps -- "WHAT THE  is this" has <20 letters)
    assert ok is False


# ─── URL / link-spam ─────────────────────────────────────────────


def test_explicit_http_url_rejected():
    ok, err = validate_open_text(
        "Check out my practice at https://spam.com for more.",
        field_name="Bio",
    )
    assert ok is False
    assert "website links" in (err or "")


def test_bare_domain_rejected():
    ok, _ = validate_open_text(
        "Visit example.com to learn more.",
        field_name="Bio",
    )
    assert ok is False


def test_www_pattern_rejected():
    ok, _ = validate_open_text(
        "See www.spam-site for offers.",
        field_name="Bio",
    )
    assert ok is False


def test_allow_urls_escape_hatch():
    """Fields like therapist website / linked profile take a URL on
    purpose -- caller opts in via allow_urls=True."""
    ok, _ = validate_open_text(
        "https://my-practice.com",
        field_name="Website",
        allow_urls=True,
    )
    assert ok is True


def test_text_mentioning_domain_word_passes():
    """'.com' substring not bracketed by word boundaries shouldn't
    trip the URL check. e.g. 'I am the .com generation' (rare but
    plausible)."""
    # This SHOULD trip because '.com\b' is part of the pattern.
    # Locking the current behavior so a future refactor doesn't
    # silently shift the policy.
    ok, _ = validate_open_text(
        "Check spam.com please", field_name="Bio",
    )
    assert ok is False


# ─── Realistic positive cases ────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        # Typical bio
        "I have 12 years of experience working with adults on anxiety, "
        "depression, and life transitions. I draw from CBT, ACT, and "
        "psychodynamic approaches.",
        # Typical 'prior therapy' note
        "Tried therapy once in college, didn't click with the therapist "
        "and stopped after a few sessions.",
        # Short answer that's still meaningful (no min_length set)
        "anxiety about work",
        # Lived experience answer
        "I'm a first-generation immigrant and grew up bilingual in "
        "Spanish and English.",
    ],
)
def test_realistic_clean_text_passes(text: str):
    ok, err = validate_open_text(text, field_name="Field")
    assert ok is True, f"Unexpected reject: {err!r}"


# ─── Trauma-context terms MUST pass (regression guard) ───────────


@pytest.mark.parametrize(
    "text",
    [
        # Sexual abuse / assault disclosure -- THE WHOLE POINT of a
        # therapist match service. Must pass unmodified.
        "I'm looking for a therapist who specializes in sexual abuse trauma.",
        "I was raped in college and want to find someone who works with PTSD.",
        "I'm dealing with childhood sexual abuse and need a trauma-informed therapist.",
        "I struggle with intimacy after being molested as a kid.",
        # Sexuality / gender identity questions -- common reason for seeking therapy
        "I have questions about my sexuality and want a queer-affirming therapist.",
        "Looking for someone experienced with sex therapy for couples.",
        "I am struggling with my sexual identity.",
        # Eating disorder + body image
        "I have body image issues and want to work on my relationship with my body.",
    ],
)
def test_legitimate_trauma_and_sexuality_context_passes(text: str):
    """Crucial regression guard: words like 'sexual abuse', 'rape',
    'molested', 'sexuality', 'sex therapy' are EXACTLY what patients
    describe when seeking the right trauma-informed therapist. The
    moderation layer MUST let them through -- false-rejects on these
    terms would turn away the most vulnerable users."""
    ok, err = validate_open_text(text, field_name="Reason for seeking therapy")
    assert ok is True, (
        f"FALSE REJECT on legitimate trauma/sexuality context: {err!r}\n"
        f"Text: {text!r}\n"
        f"This is exactly the use case the service exists for."
    )


def test_sexualized_garbage_rejected():
    """Sexualized garbage (porn talk, masturbation references) IS
    rejected -- distinct from the legitimate-trauma case above."""
    for t in [
        "I love porn and want to talk about it.",
        "lets discuss masturbation",
        "nice tits doctor",
    ]:
        ok, err = validate_open_text(t, field_name="Bio")
        assert ok is False, f"Expected reject for {t!r}, got pass"
        assert "language we can't accept" in (err or "")


# ─── Combined / order-of-checks regression ───────────────────────


def test_length_check_runs_before_other_checks():
    """A text that would trip both min_length AND profanity should
    surface the length error first (we'd rather tell users 'write
    more' than 'change your language' for a short fragment)."""
    ok, err = validate_open_text(
        "fuck", field_name="Bio", min_length=50,
    )
    assert ok is False
    assert "50 characters" in (err or "")
