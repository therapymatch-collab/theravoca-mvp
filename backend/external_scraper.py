"""Live HTTP scraper for admin-registered external directory URLs.

Reads each URL from `app_config.scrape_sources` (managed in the Admin UI),
fetches the HTML, and tries — in order — these extraction strategies:

1. **Schema.org JSON-LD `Person` entries** — same parser used for
   Psychology Today. Many directory sites embed therapists this way
   (group practices, Clinico, etc.).
2. **LLM extraction** — fall back to Claude Sonnet 4.5 with the cleaned
   HTML and a strict JSON schema. Used when the page hasn't published
   structured data but lists therapists in plain HTML.

Each successful candidate is normalized into the same outreach-invite
shape used by `pt_scraper.py` so the outreach agent can drop them into
its existing pipeline without code changes.

Limits:
- 8s timeout per URL (registries can be slow).
- 200 KB max HTML retained for LLM extraction (keeps token bill bounded).
- 30s overall budget across all sources for one outreach run (caller-enforced).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from pt_scraper import (
    _extract_jsonld_persons,
    _person_to_card,
    _parse_license_types,
    _parse_specialties,
    _parse_external_website,
    _guess_email_from_website,
    HEADERS,
)

logger = logging.getLogger("theravoca.external_scraper")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
HTTP_TIMEOUT_SEC = 8.0
MAX_HTML_BYTES_FOR_LLM = 200_000
PER_SOURCE_MAX_CANDIDATES = 25


async def _http_get(url: str, client: httpx.AsyncClient) -> Optional[str]:
    try:
        r = await client.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT_SEC)
        if r.status_code == 200:
            return r.text
        logger.warning("External GET %s -> HTTP %d", url, r.status_code)
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        logger.warning("External GET %s failed: %s", url, e)
    return None


def _strip_html(html: str) -> str:
    """Cheap text extraction — drop scripts/styles, collapse tags to spaces."""
    no_script = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.I)
    no_tags = re.sub(r"<[^>]+>", " ", no_script)
    return re.sub(r"\s+", " ", no_tags).strip()


def _enrich_card_from_html(card: dict, html: str) -> dict:
    """Fill in license / specialties / website / email best-effort from page text."""
    licenses = _parse_license_types(html)
    specialties = _parse_specialties(html)
    website = _parse_external_website(html)
    card.setdefault("license_types", licenses)
    card.setdefault("primary_license", licenses[0] if licenses else "")
    card.setdefault("specialties", specialties)
    card.setdefault("website", website or "")
    card.setdefault("email", _guess_email_from_website(website or "", card.get("name", "")) or "")
    return card


async def _extract_via_llm(
    html: str, source_url: str, label: str | None = None,
) -> list[dict]:
    """Last-resort extractor: feed cleaned HTML to Claude and ask for a
    strict JSON list of therapists. Returns at most PER_SOURCE_MAX_CANDIDATES.
    """
    if not EMERGENT_KEY:
        return []
    text = _strip_html(html)[:MAX_HTML_BYTES_FOR_LLM]
    if len(text) < 200:
        return []  # page is empty or JS-rendered

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        logger.exception("emergentintegrations missing — cannot run LLM extractor")
        return []

    domain = urlparse(source_url).netloc or source_url
    prompt = f"""You are extracting a therapist directory from a webpage.

Source URL: {source_url}
Source label: {label or domain}

Below is the visible text content of the page (HTML stripped). Extract
EVERY mental-health therapist / counselor / psychologist listed on this
page. Do NOT invent — only return people whose name AND city are
clearly stated.

Return a strict JSON array (max {PER_SOURCE_MAX_CANDIDATES} entries).
Each object MUST have:
- name: full display name + license suffix if present (e.g. "Sarah Chen, LCSW")
- license_type: one of LCSW, LMFT, LCPC, LPC, LMHC, LCMHC, PsyD, PhD, MD — empty string if unclear
- city: a real US city present in the text
- state: 2-letter US state code (default "ID" if not stated and the directory is Idaho-focused)
- phone: phone number if listed, else ""
- email: email if listed, else ""
- website: profile or practice URL if stated, else ""
- specialties: zero-to-three specialty slugs from this fixed list:
  anxiety, depression, ocd, adhd, trauma_ptsd, relationship_issues,
  life_transitions, parenting_family, substance_use, eating_concerns,
  autism_neurodivergence, school_academic_stress

Return ONLY the JSON array, no prose, no markdown fences. If the page
clearly isn't a therapist directory, return [].

PAGE TEXT:
{text}
"""

    chat = (
        LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"extscrape_{uuid.uuid4().hex[:10]}",
            system_message=(
                "You are a precise HTML-to-JSON extractor. "
                "Never invent people. Always return valid JSON."
            ),
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("External LLM extract failed for %s: %s", source_url, e)
        return []

    raw = (resp or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
    except json.JSONDecodeError:
        s, e = raw.find("["), raw.rfind("]")
        if s == -1 or e <= s:
            return []
        try:
            data = json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            return []
        if not isinstance(data, list):
            return []

    out: list[dict] = []
    for d in data[:PER_SOURCE_MAX_CANDIDATES]:
        if not isinstance(d, dict) or not d.get("name") or not d.get("city"):
            continue
        out.append({
            "name": d.get("name") or "",
            "license_types": [d["license_type"]] if d.get("license_type") else [],
            "primary_license": d.get("license_type") or "",
            "city": d.get("city") or "",
            "state": (d.get("state") or "ID")[:2].upper(),
            "phone": d.get("phone") or "",
            "email": d.get("email") or "",
            "website": d.get("website") or "",
            "profile_url": d.get("website") or source_url,
            "specialties": d.get("specialties") or [],
            "source": f"external:{domain}",
        })
    return out


async def scrape_one_source(
    source: dict, client: httpx.AsyncClient,
) -> dict[str, Any]:
    """Scrape ONE admin-registered URL. Returns:
        {url, label, candidates: [...], strategy: "jsonld"|"llm"|"none", error?}
    """
    url = (source.get("url") or "").strip()
    label = source.get("label") or ""
    if not url:
        return {"url": url, "label": label, "candidates": [], "strategy": "none",
                "error": "missing url"}

    html = await _http_get(url, client)
    if not html:
        return {"url": url, "label": label, "candidates": [], "strategy": "none",
                "error": "fetch failed"}

    # Strategy 1: JSON-LD Person entries (Schema.org).
    persons = _extract_jsonld_persons(html)
    cards: list[dict] = []
    for p in persons:
        c = _person_to_card(p)
        if not c.get("name"):
            continue
        cards.append(_enrich_card_from_html(c, html))
        if len(cards) >= PER_SOURCE_MAX_CANDIDATES:
            break
    if cards:
        return {"url": url, "label": label, "candidates": cards,
                "strategy": "jsonld"}

    # Strategy 2: LLM extraction over cleaned page text.
    cards = await _extract_via_llm(html, url, label)
    return {"url": url, "label": label, "candidates": cards,
            "strategy": "llm" if cards else "none"}


async def scrape_external_sources(
    sources: list[dict], *, total_budget_sec: float = 30.0,
) -> dict[str, Any]:
    """Scrape every enabled source in parallel under a global budget.

    Returns:
        {results: [{url, label, candidates, strategy, error?}, ...],
         total_candidates: int,
         elapsed_sec: float}
    """
    enabled = [s for s in sources if s.get("enabled", True) and s.get("url")]
    if not enabled:
        return {"results": [], "total_candidates": 0, "elapsed_sec": 0.0}

    started = asyncio.get_event_loop().time()
    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*(scrape_one_source(s, client) for s in enabled),
                               return_exceptions=True),
                timeout=total_budget_sec,
            )
        except asyncio.TimeoutError:
            logger.warning("External scrape budget exceeded (%ss)", total_budget_sec)
            results = []

    cleaned: list[dict] = []
    for r in results:
        if isinstance(r, Exception):
            cleaned.append({"url": "", "label": "", "candidates": [],
                            "strategy": "none", "error": str(r)})
        else:
            cleaned.append(r)
    total = sum(len(r.get("candidates") or []) for r in cleaned)
    return {
        "results": cleaned,
        "total_candidates": total,
        "elapsed_sec": round(asyncio.get_event_loop().time() - started, 2),
    }
