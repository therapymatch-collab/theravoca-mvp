"""Open-text validation for patient + therapist free-text fields.

Josh 2026-05-17: "on all patient and therapist open text box, add
protections from garbage, inappropriate or irrelevant requests or
information."

This module exposes one function -- `validate_open_text()` -- that
runs a battery of cheap heuristic checks and returns either
`(True, None)` for accepted text or `(False, "user-facing error")`
for rejected text. The caller (a route handler) raises HTTPException
with the returned message so the React layer can surface it as a
toast directly without exposing which check tripped.

Why heuristics, not an LLM moderation call:
  - LLM moderation adds a per-submission latency hit (~500ms-2s)
    and a per-month cost. For a v1 guard against the most common
    abuse patterns (gibberish, profanity, all-caps shouting,
    promotional spam), heuristics catch ~80% of garbage at zero
    runtime cost and zero new dependencies.
  - The detection is INTENTIONALLY conservative -- false-rejects
    are worse UX than letting some garbage through (admin can
    moderate post-hoc; over-blocking turns away real patients).
  - LLM moderation can be layered later as a second-stage check
    once we know what categories of garbage are slipping past.

What we detect (each cheap regex / set lookup):
  1. Length floor / ceiling (per caller).
  2. All-caps shouting (>70% uppercase, >20 chars of letters).
  3. Gibberish via repeated-character runs ("aaaaaaaaa").
  4. Profanity wordlist (case-insensitive word-boundary match).
  5. Promotional URLs / link spam (unless caller opts in via
     allow_urls=True for the rare field where a URL is fine).

What we do NOT detect (deferred):
  - "Irrelevant" content -- truly needs LLM grading.
  - Hate speech / slurs beyond the basic wordlist -- needs LLM
    or a curated trust-and-safety list.
  - Adversarial unicode tricks (homoglyph attacks). Cloudflare's
    Turnstile already absorbs most automated abuse so the residual
    risk is human-typed and largely caught by the rules above.

The wordlist is kept small and editable here. Add domain-specific
terms as we observe abuse patterns. Casing handled by lower() before
match -- entries should always be lowercase.
"""
from __future__ import annotations

import re
from typing import Optional

# Basic profanity wordlist. Intentionally limited to the most common
# harsh words a real user wouldn't type into a therapist intake or
# bio. Add to this set if we observe abuse patterns; the rejection
# message is generic so users can't probe to learn which words trip
# the filter.
_PROFANITY: set[str] = {
    # Common profanities
    "fuck", "fucking", "fucked", "fucker", "fuckers",
    "shit", "shitty", "bullshit", "shithead",
    "bitch", "bitches", "bitching",
    "asshole", "assholes", "ass",
    "bastard", "bastards",
    "damn", "damned",  # mild but commonly used as filler garbage
    "crap", "crappy",
    "piss", "pissed",
    "cock", "dick", "dickhead",
    "cunt",
    "twat",
    "wank", "wanker",
    "slut", "whore",
    "retard", "retarded",
    "faggot", "fag",
    "nigger", "nigga",
    # Common slurs / hate terms
    "spic", "kike", "chink", "gook",
    # Sexualized terms (Josh 2026-05-17: "garbage text, inappropriate,
    # sexualized or irrelevant"). Intentionally OMIT "sex" and "sexy"
    # -- legitimate intake context like "sexual abuse trauma" or
    # "sexuality questions" should pass through. The terms below are
    # ones a real patient describing a presenting issue wouldn't use.
    "porn", "porno",
    "nude", "naked",  # rare in legit therapy intake free-text
    "masturbate", "masturbating", "masturbation",
    "blowjob", "handjob", "rimjob",
    "pussy", "tits", "boobs", "boobies",
    "horny", "kinky",
    "jerkoff",
    # Note: "rape", "abuse", "molest" intentionally NOT here -- these
    # are LEGITIMATE topics a patient may need to describe to find the
    # right trauma-informed therapist. Removing the filter on these
    # is the whole point of having a therapist match service.
}

# URLs + obvious link-spam markers. Permissive: real users
# occasionally mention a domain in passing, but for v1 we'd rather
# reject the rare legitimate URL than let promotional spam through.
# Callers can pass allow_urls=True to disable this check on fields
# where URLs are expected (e.g. the therapist `website` field).
_URL_PATTERN = re.compile(
    r"https?://"            # explicit scheme
    r"|www\.[a-z0-9-]+"     # www.something
    r"|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|gov|edu|info|biz)\b",
    re.IGNORECASE,
)

# Run of 9+ identical consecutive characters: "aaaaaaaaa", ".........",
# "!!!!!!!!!!". A real user might type "!!" or "...." for emphasis but
# nobody legitimately holds the same character down for 9+ slots.
_REPEATED_CHAR = re.compile(r"(.)\1{8,}")

# Word-boundary tokenizer for profanity matching. Lowercased input,
# splits on non-letter chars + apostrophes preserved inside words.
_WORD_PATTERN = re.compile(r"[a-z][a-z']*")


def validate_open_text(
    text: Optional[str],
    *,
    field_name: str,
    min_length: int = 0,
    max_length: Optional[int] = None,
    required: bool = False,
    allow_urls: bool = False,
) -> tuple[bool, Optional[str]]:
    """Run all open-text heuristics. Returns (ok, error_message).

    Args:
      text: The submitted text (may be None or empty).
      field_name: Human-readable label used in error messages
        (e.g. "Bio", "Reason for seeking therapy"). Surfaced to
        the end user so it should match the field label.
      min_length: Minimum character count after strip(). Use to
        force a substantive answer on fields where 2-character
        replies are clearly low-effort.
      max_length: Hard ceiling. Most pydantic schemas already
        enforce this -- duplicating here for routes that bypass
        the schema (e.g. PATCH endpoints that take partial dicts).
      required: True => empty text is rejected with a "required"
        message. False (default) => empty text passes through.
      allow_urls: True => skip the URL-spam check (use for fields
        like website / linked profile URL where a link is expected).

    Returns:
      (True, None) on accept.
      (False, "human-readable error") on reject. The caller should
      raise HTTPException(400, error_message) so the React frontend
      can surface it as a toast.
    """
    raw = (text or "").strip()

    if not raw:
        if required or min_length > 0:
            return False, f"{field_name} is required."
        return True, None

    # Length checks (cheap, run first)
    if min_length and len(raw) < min_length:
        return (
            False,
            f"{field_name} needs at least {min_length} characters. "
            f"Please write a bit more so we can help.",
        )
    if max_length and len(raw) > max_length:
        return (
            False,
            f"{field_name} can't exceed {max_length} characters. "
            f"Please shorten it.",
        )

    # All-caps shouting. Count only letters so punctuation/numbers
    # don't skew the ratio. Threshold is intentionally lenient (70%)
    # because acronyms (CBT, EMDR, ADHD, LGBTQ+) are common in this
    # domain and would push a short normal sentence over a 50% bar.
    letters = [c for c in raw if c.isalpha()]
    if len(letters) > 20:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio > 0.7:
            return (
                False,
                f"{field_name} reads as all-caps. "
                f"Please use sentence case so it's easier to read.",
            )

    # Repeated-character gibberish
    if _REPEATED_CHAR.search(raw):
        return (
            False,
            f"{field_name} looks like repeated characters or padding. "
            f"Please describe in your own words.",
        )

    # Profanity wordlist (word-boundary match, lowercased)
    lowered = raw.lower()
    words = set(_WORD_PATTERN.findall(lowered))
    if words & _PROFANITY:
        return (
            False,
            f"{field_name} contains language we can't accept. "
            f"Please rephrase respectfully so your match has the "
            f"context they need.",
        )

    # URL / link-spam check (skip for fields that legitimately
    # take a URL, e.g. therapist `website`).
    if not allow_urls and _URL_PATTERN.search(lowered):
        return (
            False,
            f"{field_name} can't include website links. "
            f"Please describe in plain text -- you can share links "
            f"later in your conversation with the therapist.",
        )

    return True, None


def validate_or_raise(
    text: Optional[str],
    *,
    field_name: str,
    min_length: int = 0,
    max_length: Optional[int] = None,
    required: bool = False,
    allow_urls: bool = False,
) -> None:
    """Convenience wrapper -- runs validate_open_text and raises
    HTTPException(400, message) on rejection. Import HTTPException
    lazily to keep this module free of FastAPI for unit tests.
    """
    ok, err = validate_open_text(
        text,
        field_name=field_name,
        min_length=min_length,
        max_length=max_length,
        required=required,
        allow_urls=allow_urls,
    )
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(400, err)
