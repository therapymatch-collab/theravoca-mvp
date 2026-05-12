"""Shared Claude LLM client -- replaces emergentintegrations.

Every module that previously used `LlmChat` / `UserMessage` from
emergentintegrations now calls `ask_claude()` from this module instead.
Uses the async Anthropic client so we don't block FastAPI's event loop
for the duration of the LLM call.

PHI redaction (HIPAA hygiene)
-----------------------------
Every prompt + system message is passed through `_sanitize_prompt()`
before it leaves the server. That helper redacts email addresses,
US phone numbers, and 5-digit ZIPs so we don't accidentally leak
patient PII into the Anthropic API.

Callers that legitimately need raw PII (e.g. a diagnostic prompt that
asks Claude to format an email address) can opt out with
`allow_pii=True`. As of 2026-05-12 no caller in the codebase does.
"""
from __future__ import annotations

import logging
import os
import re

import anthropic

logger = logging.getLogger("theravoca.llm_client")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
# Default model. Date-stamped pin for stability -- bump deliberately
# when migrating to a newer Sonnet release.
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"


# ─── PHI sanitizer ───────────────────────────────────────────────────
# These patterns are intentionally a bit aggressive: false-positives
# (over-redaction) are fine; false-negatives are not. Each match is
# replaced with a tagged placeholder so a downstream debugger can tell
# that the model didn't see real PII at the spot in question.

_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"
)
# US phone: optional +1, area code 200-999, then 7 digits with optional
# separators. Catches "(415) 555-1234", "415-555-1234", "+1 415 555 1234".
_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)"
)
# 5-digit ZIP, optionally followed by -NNNN. Avoid matching arbitrary
# 5-digit numbers by requiring a word-boundary on both sides.
_ZIP_RE = re.compile(r"(?<!\d)\d{5}(?:-\d{4})?(?!\d)")


def _sanitize_prompt(text: str) -> str:
    """Redact PHI patterns from a string before it reaches the LLM.

    Patterns redacted:
      - Email addresses          -> [REDACTED_EMAIL]
      - US phone numbers         -> [REDACTED_PHONE]
      - 5-digit ZIP / ZIP+4      -> [REDACTED_ZIP]

    Returns the input unchanged when it's empty / None.
    """
    if not text:
        return text
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = _PHONE_RE.sub("[REDACTED_PHONE]", text)
    text = _ZIP_RE.sub("[REDACTED_ZIP]", text)
    return text


async def ask_claude(
    prompt: str,
    *,
    system_message: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    allow_pii: bool = False,
) -> str | None:
    """Send a single prompt to Claude and return the text response.

    Returns None when the key is missing or the call fails, matching the
    graceful-degradation pattern the codebase already uses.

    PHI redaction is on by default -- pass `allow_pii=True` only when
    the prompt legitimately needs raw email / phone / ZIP data, and
    document the reason at the call site.
    """
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY missing -- skipping LLM call")
        return None

    safe_prompt = prompt if allow_pii else _sanitize_prompt(prompt)
    safe_system = system_message if allow_pii else _sanitize_prompt(system_message)

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    try:
        resp = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=safe_system,
            messages=[{"role": "user", "content": safe_prompt}],
        )
        # Find the first text block in the response. Reasoning models
        # can interleave thinking blocks; we want plain text.
        for block in resp.content:
            text = getattr(block, "text", None)
            if text:
                return text
        return None
    except anthropic.APIError as e:
        logger.exception("Claude API error: %s", e)
        return None
    except Exception as e:
        logger.exception("Claude call failed: %s", e)
        return None
