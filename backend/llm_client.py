"""Shared Claude LLM client — replaces emergentintegrations.

Every module that previously used `LlmChat` / `UserMessage` from
emergentintegrations now calls `ask_claude()` from this module instead.
"""
from __future__ import annotations

import logging
import os

import anthropic

logger = logging.getLogger("theravoca.llm_client")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"


async def ask_claude(
    prompt: str,
    *,
    system_message: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
) -> str | None:
    """Send a single prompt to Claude and return the text response.

    Returns None if the key is missing or the call fails, matching the
    graceful-degradation pattern the codebase already uses.
    """
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY missing — skipping LLM call")
        return None

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_message,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
    except Exception as e:
        logger.exception("Claude API call failed: %s", e)
        return None
