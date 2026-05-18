"""Soft-flag risk scoring for free-text fields that PASSED hard
moderation but have signals worth admin review.

Josh 2026-05-18: "for B, if flagged for suspicious, then make status
'flagged for review' which means admin needs to manually release the
match to therapists - the biggest risk is that bad matches get to
therapists and they think our system is garbage. only quality matches
can get through."

Design:
  - Operates ONLY on text that passed text_moderation.validate_open_text
    (which already blocks profanity / gibberish / all-caps shouting /
    URL spam at submit time with HTTP 400). This module looks for
    SOFTER signals -- low-effort, suspicious-but-not-rejection,
    near-profanity, etc. -- and assigns a 0-100 risk score per field.
  - Caller (a route handler) sums the per-field scores into a request-
    level score, compares against THRESHOLD, and if exceeded, sets the
    request's status to "flagged_for_review" instead of triggering
    matching. Admin then manually releases via the Requests panel.

Why a per-field score (not just yes/no):
  - Lets admin see what specifically tripped (e.g. "p3_resonance
    too short" vs "all-caps fragment in bio") in the panel.
  - Lets us add more signals later without re-tuning the threshold.

Why heuristics, not an LLM:
  - Same trade-off as text_moderation.py -- heuristics catch ~70% of
    obvious low-effort content at zero latency/cost. LLM secondary
    check can layer on top later (Josh's Option D) once we know what
    slips past.

What we detect (each cheap):
  - Very short non-empty answers (low-effort)
  - Near-profanity (Levenshtein distance 1 from wordlist entries)
    -- catches simple obfuscation like "fuk", "sh1t", "biatch"
  - Mid-range all-caps ratio (50-70%) -- below the 70% hard bar
  - Excessive non-alphanumeric characters (spam-like)
  - 6-8 consecutive same chars (just under the 9-char gibberish bar)
"""
from __future__ import annotations

import re
from typing import Optional

from text_moderation import _PROFANITY

# Per-field score >= this means the request is flagged for admin
# review. Tunable; lower = more admin work but tighter quality.
PER_FIELD_FLAG_THRESHOLD = 30

# Per-REQUEST sum threshold (sum of all field scores). Even if no
# single field crosses PER_FIELD_FLAG_THRESHOLD, accumulated low-grade
# signals across many fields trigger review. Tunable.
REQUEST_FLAG_THRESHOLD = 50


_REPEATED_CHAR_MILD = re.compile(r"(.)\1{5,7}")
# Letters allowed inside a word (apostrophes + accented chars handled
# via .casefold() upstream; keeping ASCII here for the wordlist match).
_WORD = re.compile(r"[a-z][a-z']*")


def _levenshtein_le_1(a: str, b: str) -> bool:
    """True if `a` is within edit distance 1 of `b`. Fast specialized
    path -- we don't need the full distance, just '<=1 or not'."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if a == b:
        return True
    if la == lb:
        diff = 0
        for x, y in zip(a, b):
            if x != y:
                diff += 1
                if diff > 1:
                    return False
        return True
    # Length differs by 1 -- check single insertion/deletion
    if la > lb:
        a, b = b, a
        la, lb = lb, la
    i = j = 0
    diff = 0
    while i < la and j < lb:
        if a[i] != b[j]:
            diff += 1
            if diff > 1:
                return False
            j += 1
        else:
            i += 1
            j += 1
    return True


# Common 4-5 letter words that are 1-edit from a profanity but are
# clearly legitimate. Without this whitelist the near-profanity check
# false-fires constantly (e.g. "want" is 1 edit from "wank"; "luck"
# from "fuck"; "shot" from "shit"; "hunt" from "cunt"). Add to this
# set when admin sees a false positive in the User Content Flagging
# panel.
_NEAR_PROFANITY_WHITELIST: set[str] = {
    # near "wank"
    "want", "wand", "ward", "wash", "wave", "wane", "ways",
    # near "cunt"
    "hunt", "runt", "punt", "aunt", "bunt",
    # near "shit"
    "shut", "shot", "ship", "shin", "shim", "shop", "shoe", "shoo",
    "shift", "shirt", "shies", "shies",
    # near "fuck"
    "luck", "puck", "buck", "tuck", "duck", "muck", "suck", "fuse",
    "fucks", "ducks", "lucks", "bucks", "tucks", "ducks", "sucks",
    # near "twat"
    "twit", "twin", "twirl", "twigs",
    # near "damn"
    "damp", "darn", "dame", "dams",
    # near "crap"
    "carp", "crab", "clap", "crop", "crops", "crapy", "craps",
    # near "piss"
    "puss", "pass", "pies", "pits", "pins", "pies", "pits",
    # near "porn"
    "born", "torn", "worn", "horn", "corn",
    # near "nude"
    "node", "name", "dude", "nine",
    # near "tits"
    "tots", "tips", "ties", "kits", "bits", "fits",
    # near "slut"
    "slot", "sult", "smut", "salt",
    # near "kike"
    "like", "bike", "hike", "kite", "mike",
    # near "gook"
    "good", "look", "book", "took", "cook", "hook", "nook", "rook",
    # near "spic"
    "spin", "stic", "spit", "spec",
}


def _near_profanity(word: str) -> Optional[str]:
    """Return the matching profanity entry if `word` looks like simple
    obfuscation of a wordlist entry. We're conservative -- prefer
    false-negatives (missing an obfuscation) over false-positives
    (flagging a normal word like 'want' or 'shut').

    Rules:
      - Skip <5 char candidate words (too noisy at this length)
      - Skip whitelisted words (common false positives)
      - Skip <4 char wordlist entries (too noisy)
      - Require Levenshtein <= 1 from a wordlist entry
      - For 4-char wordlist entries (fuck/shit/etc) require an
        INSERTION-style match only (e.g. "fukk" -> "fuck") so we
        don't flag common 4-char words that happen to be 1 substitution
        away (luck/shut/want).
      - For 5+ char wordlist entries, allow any single edit.
    """
    if len(word) < 5:
        return None
    if word in _NEAR_PROFANITY_WHITELIST:
        return None
    for entry in _PROFANITY:
        if len(entry) < 4:
            continue
        if abs(len(word) - len(entry)) > 1:
            continue
        # For 4-char entries, require the candidate to be LONGER
        # (insertion-style obfuscation only: fukk, shiit, biych, etc.).
        # This eliminates the "want"/"wank" false-positive class.
        if len(entry) == 4 and len(word) <= len(entry):
            continue
        if _levenshtein_le_1(word, entry):
            return entry
    return None


def score_field(text: Optional[str], *, expect_length: int = 0) -> tuple[int, list[str]]:
    """Return (score, signals_list) for one free-text field.

    Args:
      text: the field content (after .strip()).
      expect_length: minimum length where content stops being
        "suspiciously short". Defaults to 0 (no short-content
        penalty). Caller should set this per-field based on the
        question's nature (e.g. bio -> 50, p3 -> 15).

    Returns:
      (score, signals) where signals is a list of human-readable
      strings naming what tripped (admin sees these in the panel).
    """
    raw = (text or "").strip()
    if not raw:
        return 0, []
    score = 0
    signals: list[str] = []
    # Suspiciously short non-empty answer
    if expect_length and len(raw) < expect_length:
        # Scale: under half expected -> 30, between half and full -> 15
        if len(raw) < expect_length // 2:
            score += 30
            signals.append(f"very short ({len(raw)} chars, expected >={expect_length})")
        else:
            score += 15
            signals.append(f"short ({len(raw)} chars, expected >={expect_length})")
    # Mid-range all-caps (50-70%, below the 70% hard-rejection bar)
    letters = [c for c in raw if c.isalpha()]
    if len(letters) > 10:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if 0.5 <= upper_ratio < 0.7:
            score += 20
            signals.append(f"mostly uppercase ({int(upper_ratio * 100)}%)")
    # Excessive non-alphanumeric content (spam-like padding)
    if len(raw) > 10:
        non_alnum = sum(1 for c in raw if not c.isalnum() and not c.isspace())
        ratio = non_alnum / len(raw)
        if ratio > 0.3:
            score += 20
            signals.append(f"heavy punctuation ({int(ratio * 100)}% non-alphanumeric)")
    # 6-8 consecutive same chars (just under the 9-char gibberish bar)
    if _REPEATED_CHAR_MILD.search(raw):
        score += 15
        signals.append("repeated characters (6-8 run)")
    # Near-profanity (Levenshtein 1 from wordlist) -- catches simple
    # obfuscation. We check unique words to avoid hammering on a
    # frequently-repeated near-miss.
    lowered = raw.lower()
    near_hits = set()
    for w in _WORD.findall(lowered):
        match = _near_profanity(w)
        if match:
            near_hits.add((w, match))
    if near_hits:
        # Big signal -- 35 per unique near-hit, capped at 70.
        # One hit alone is enough to cross PER_FIELD_FLAG_THRESHOLD (30).
        bump = min(70, 35 * len(near_hits))
        score += bump
        examples = ", ".join(f'"{w}"~"{m}"' for w, m in list(near_hits)[:3])
        signals.append(f"near-profanity: {examples}")
    return min(100, score), signals


def score_request(fields: dict[str, tuple[Optional[str], int]]) -> tuple[int, dict[str, list[str]], bool]:
    """Score an entire request's free-text content.

    Args:
      fields: mapping of {field_name: (text, expect_length)}. Pass
        the human-readable label (e.g. "P3 (deep match)") as the
        key so admin sees friendly names in the audit row.

    Returns:
      (total_score, per_field_signals, should_flag)
      - total_score: sum of all per-field scores (capped at 200)
      - per_field_signals: {field_name: [signal, ...]} only for
        fields whose score was non-zero
      - should_flag: True if any per-field score >= PER_FIELD_FLAG_THRESHOLD
        OR total_score >= REQUEST_FLAG_THRESHOLD
    """
    total = 0
    per_field: dict[str, list[str]] = {}
    any_field_over_threshold = False
    for label, (text, expect) in fields.items():
        score, signals = score_field(text, expect_length=expect)
        if score > 0:
            per_field[label] = signals
            total += score
            if score >= PER_FIELD_FLAG_THRESHOLD:
                any_field_over_threshold = True
    total = min(200, total)
    should_flag = any_field_over_threshold or total >= REQUEST_FLAG_THRESHOLD
    return total, per_field, should_flag
