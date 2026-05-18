"""Unit tests for risk_scoring -- soft-flag heuristics for requests
that PASSED hard moderation but have signals worth admin review.

Pin the boundary behavior so future tuning is deliberate.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from risk_scoring import (
    PER_FIELD_FLAG_THRESHOLD,
    REQUEST_FLAG_THRESHOLD,
    score_field,
    score_request,
    _levenshtein_le_1,
    _near_profanity,
)


# ─── Levenshtein helper boundaries ───────────────────────────────


def test_levenshtein_identical():
    assert _levenshtein_le_1("hello", "hello") is True


def test_levenshtein_one_substitution():
    assert _levenshtein_le_1("hello", "hallo") is True


def test_levenshtein_one_insertion():
    assert _levenshtein_le_1("hello", "helllo") is True


def test_levenshtein_one_deletion():
    assert _levenshtein_le_1("hello", "hllo") is True


def test_levenshtein_two_diffs():
    assert _levenshtein_le_1("hello", "halxo") is False


def test_levenshtein_length_diff_two():
    assert _levenshtein_le_1("hi", "hello") is False


# ─── Near-profanity catches obfuscation ──────────────────────────


@pytest.mark.parametrize(
    "obfuscated,should_flag",
    [
        # Too short -- skipped (<5 chars)
        ("fuk", False),
        ("fck", False),
        ("shyt", False),  # 4 chars -- new rule rejects <5
        # Same-length substitution against a 4-char wordlist entry --
        # SKIPPED on purpose (otherwise "luck"/"want"/"shut" etc. all
        # false-positive). The trade-off is documented in
        # _near_profanity: prefer false-negatives over false-positives.
        ("fukk", False),  # vs "fuck" -- 4-char swap, skipped
        # Insertion-style obfuscation against 4-char wordlist entries
        # -- 5+ char candidate, allowed.
        ("biych", True),  # vs "bitch" insertion of y
        ("shiit", True),  # vs "shit" insertion (5 chars)
        # Edit on a 5+ char wordlist entry -- flagged at any candidate
        # length within +/-1 of entry length.
        ("shittt", True),  # vs "shitty"
        ("masturbat", True),  # vs "masturbate" -- deletion
        ("fukking", True),  # vs "fucking" (7-char wordlist entry)
    ],
)
def test_near_profanity_obfuscation(obfuscated: str, should_flag: bool):
    result = _near_profanity(obfuscated)
    if should_flag:
        assert result is not None, f"Expected obfuscation '{obfuscated}' to flag"
    else:
        assert result is None, f"'{obfuscated}' tripped near-profanity (should not)"


# Common English words that are 1-edit from a profanity but MUST NOT
# false-positive. These were tripping the validator before the
# whitelist + insertion-only rule for 4-char entries.
@pytest.mark.parametrize(
    "clean_word",
    [
        # near "wank"
        "want", "wand", "ward", "wash", "wave", "ways",
        # near "shit"
        "shut", "shot", "ship", "shop", "shoe",
        # near "fuck"
        "luck", "puck", "buck", "duck", "suck",
        # near "cunt"
        "hunt", "runt", "punt", "aunt",
        # near "porn"
        "born", "torn", "horn", "corn",
        # near "gook"
        "good", "look", "book", "took",
        # Therapy-relevant clean words
        "therapy", "anxiety", "depression", "trauma", "EMDR", "CBT",
    ],
)
def test_near_profanity_clean_words_pass(clean_word: str):
    """Regression guard: common English words that LOOK like profanity
    at edit-distance-1 must NOT trip the soft-flag layer."""
    result = _near_profanity(clean_word.lower())
    assert result is None, (
        f"FALSE POSITIVE: '{clean_word}' tripped near-profanity (matched '{result}')"
    )


# ─── score_field individual signals ──────────────────────────────


def test_empty_field_zero_score():
    score, signals = score_field("", expect_length=10)
    assert score == 0 and signals == []


def test_short_field_below_half_expected():
    """Very short content (< half expected) -> 30 points."""
    score, signals = score_field("hi", expect_length=20)
    assert score >= 30
    assert any("very short" in s for s in signals)


def test_short_field_between_half_and_full():
    """Mid-short (>= half, < full expected) -> 15 points."""
    score, signals = score_field("ten chars!", expect_length=20)
    assert score == 15
    assert any("short" in s for s in signals)


def test_long_enough_field_no_penalty():
    """Content >= expected_length -> no short-content penalty."""
    score, signals = score_field("a" * 50, expect_length=20)
    assert not any("short" in s for s in signals)


def test_mid_caps_flagged():
    """50-70% caps (below 70% hard-reject bar) -> mild flag."""
    text = "Hello WORLD This Is A NORMAL Sentence WITH Many Caps"
    score, signals = score_field(text)
    assert any("mostly uppercase" in s for s in signals)


def test_clean_sentence_passes():
    text = "I'm looking for a therapist who specializes in CBT and anxiety treatment."
    score, signals = score_field(text)
    # Clean text -- no signals (CBT acronym shouldn't trip caps)
    assert score == 0, f"Unexpected signals: {signals}"


def test_repeated_chars_just_under_hard_bar():
    """6-8 repeats -> mild flag (the 9+ run gets HARD-rejected upstream)."""
    text = "Wow!!!!!! that was great"
    score, signals = score_field(text)
    assert any("repeated characters" in s for s in signals)


def test_near_profanity_in_sentence_flags():
    """Insertion-style obfuscation (fukk, biych, shiit) of a 4-char
    profanity should trip the near-profanity signal."""
    text = "I have fukking issues with my last therapist"
    score, signals = score_field(text)
    assert any("near-profanity" in s for s in signals), f"Signals: {signals}"
    # Near-profanity is a BIG signal -- should push field over threshold
    assert score >= PER_FIELD_FLAG_THRESHOLD


def test_excessive_punctuation_flagged():
    text = "WOW!!!!!! Amazing??? Buy now!!!! ###$$%&*"
    score, signals = score_field(text)
    # 6+ identical chars trips first; then excessive punctuation too.
    assert score > 0


# ─── score_request multi-field aggregation ───────────────────────


def test_clean_request_no_flag():
    fields = {
        "Bio": ("I'm a licensed therapist with 12 years of experience working with adults on anxiety and trauma. I use CBT and EMDR primarily.", 50),
        "P3": ("I want a therapist who understands cultural differences and family dynamics.", 15),
    }
    total, per_field, should_flag = score_request(fields)
    assert total == 0
    assert per_field == {}
    assert should_flag is False


def test_one_field_over_threshold_flags_request():
    """If any single field scores >= PER_FIELD_FLAG_THRESHOLD, flag."""
    fields = {
        "Bio": ("good bio about my therapy practice.", 0),  # clean
        "P3": ("hi", 30),  # very short -> 30 pts -> flags
    }
    total, per_field, should_flag = score_request(fields)
    assert should_flag is True
    assert "P3" in per_field


def test_accumulated_signals_flag_request():
    """Multiple sub-threshold fields can sum to flag the request."""
    fields = {
        "Bio": ("short bio for", 30),       # 15 pts (mid-short)
        "P3": ("brief answer here", 25),    # 15 pts (mid-short)
        "Other": ("some extra notes", 30),  # 15 pts (mid-short)
        "More": ("a quick note", 20),       # 15 pts (mid-short)
    }
    total, per_field, should_flag = score_request(fields)
    # Each individual field < PER_FIELD_FLAG_THRESHOLD (30), but
    # accumulated total >= REQUEST_FLAG_THRESHOLD (50)
    assert total >= REQUEST_FLAG_THRESHOLD
    assert should_flag is True


def test_near_profanity_in_request_flags():
    """Near-profanity in any field should flag the whole request."""
    fields = {
        "Bio": ("I am a licensed therapist with 20 years of experience working with adults.", 50),
        "P3": ("I want a therapist who doesn't put up with fukking nonsense from family.", 15),
    }
    total, per_field, should_flag = score_request(fields)
    assert should_flag is True
    assert "P3" in per_field
    assert any("near-profanity" in s for s in per_field["P3"])


def test_legitimate_trauma_text_does_not_flag():
    """Regression guard: legitimate trauma-disclosure language MUST
    NOT trip the soft-flag layer (same protection as the hard layer
    in test_text_moderation.py)."""
    fields = {
        "Bio": ("", 50),  # empty, no penalty
        "P3": (
            "I was sexually abused as a child and need a therapist who specializes in trauma. I have PTSD and depression.",
            15,
        ),
    }
    total, per_field, should_flag = score_request(fields)
    assert should_flag is False, (
        f"Trauma-disclosure should not flag for review. Got signals: {per_field}"
    )
