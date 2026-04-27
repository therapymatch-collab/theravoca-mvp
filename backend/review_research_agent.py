"""LLM review-research agent.

Given a therapist (name + city + state), ask Claude Sonnet 4.5 to recall
publicly-available review data for them across platforms (Psychology Today,
Google Business, Yelp, Healthgrades). The model returns *only* what it can
ground in its training data — never invents reviews.

We run the result through strict guardrails:
- Skip the therapist if Claude can't find ≥1 review platform with ≥10 reviews.
- Cap `review_count` at the platform max (avoid double-counting across sources).
- Persist `review_research_source: "llm_estimate"` so admin can see the
  provenance and the result_updated_at timestamp.

The matching engine (`matching.py`) already awards +5 to therapists with
review_avg >= 4.5 and review_count >= 3, +2 if avg >= 4.0. So any therapist
who clears the threshold here will see a small ranking boost automatically.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

from deps import db
from helpers import _now_iso

logger = logging.getLogger("theravoca.review_research")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# Minimum reviews on any single source for us to trust the data.
MIN_REVIEWS_PER_SOURCE = 10


async def _ask_llm(therapist: dict) -> dict | None:
    """Ask Claude what it can recall about this therapist's public reviews.
    Returns parsed JSON dict or None if the call failed / no data found."""
    if not EMERGENT_KEY:
        logger.warning("EMERGENT_LLM_KEY missing — skipping review research")
        return None

    name = therapist.get("name") or ""
    city = ", ".join(therapist.get("office_locations") or []) or "Idaho"
    state = ((therapist.get("licensed_states") or ["ID"])[0] or "ID").upper()
    website = therapist.get("website") or ""

    prompt = f"""Research public review data for this therapist:

Name: {name}
City / State: {city}, {state}
Website: {website or "(none)"}

Look across these public platforms ONLY:
- Psychology Today (psychologytoday.com)
- Google Business Profile / Google Maps
- Yelp
- Healthgrades

Return STRICT JSON in this exact shape:

{{
  "found": true | false,
  "sources": [
    {{
      "platform": "Psychology Today" | "Google" | "Yelp" | "Healthgrades",
      "rating": <float 1.0–5.0>,
      "count": <int reviews count>,
      "url": "<canonical profile URL or empty string>"
    }}
  ],
  "notes": "<short string explaining your confidence>"
}}

CRITICAL RULES:
1. If you cannot recall any verified data for THIS specific person, return {{"found": false, "sources": [], "notes": "..."}}. Do NOT guess.
2. Only include a source if you have HIGH CONFIDENCE the rating + count are real (i.e. you saw this profile in training data, not inferred from a generic listing).
3. Do not invent URLs. If you don't know the canonical URL, use "".
4. Do not include any source where count < {MIN_REVIEWS_PER_SOURCE}.

Return ONLY the JSON. No prose, no markdown fences."""

    chat = (
        LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"reviews_{uuid.uuid4().hex[:10]}",
            system_message=(
                "You are a precise research agent. Never invent data. "
                "Always return valid JSON. If unsure, return found=false."
            ),
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.exception("LLM review research call failed: %s", e)
        return None

    text = (resp or "").strip()
    if text.startswith("```"):
        text = text.strip("`").lstrip("json").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Recover {...} block
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                data = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                logger.warning("Review LLM returned non-JSON: %s", text[:300])
                return None
        else:
            return None
    if not isinstance(data, dict):
        return None
    return data


def _summarize(sources: list[dict]) -> dict:
    """Compute weighted-avg rating and total count across sources."""
    if not sources:
        return {"avg": 0.0, "count": 0}
    total_weighted = 0.0
    total_count = 0
    for s in sources:
        c = int(s.get("count") or 0)
        r = float(s.get("rating") or 0)
        if c < MIN_REVIEWS_PER_SOURCE or not 1.0 <= r <= 5.0:
            continue
        total_weighted += r * c
        total_count += c
    if total_count == 0:
        return {"avg": 0.0, "count": 0}
    return {
        "avg": round(total_weighted / total_count, 2),
        "count": total_count,
    }


async def research_reviews_for_therapist(therapist_id: str) -> dict[str, Any]:
    """Run the LLM agent against one therapist and persist the result."""
    t = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not t:
        return {"error": "therapist_not_found"}

    raw = await _ask_llm(t)
    if not raw or not raw.get("found"):
        await db.therapists.update_one(
            {"id": therapist_id},
            {"$set": {
                "review_research_attempted_at": _now_iso(),
                "review_research_source": "llm_estimate",
                "review_research_notes": (raw or {}).get("notes") or "no_data",
            }},
        )
        return {
            "ok": True,
            "therapist_id": therapist_id,
            "found": False,
            "review_avg": 0.0,
            "review_count": 0,
        }

    # Sanitize + cap each source.
    clean_sources: list[dict] = []
    for s in raw.get("sources") or []:
        if not isinstance(s, dict):
            continue
        platform = s.get("platform")
        rating = s.get("rating")
        count = s.get("count")
        if platform not in ("Psychology Today", "Google", "Yelp", "Healthgrades"):
            continue
        try:
            rating_f = float(rating)
            count_i = int(count)
        except (TypeError, ValueError):
            continue
        if not 1.0 <= rating_f <= 5.0 or count_i < MIN_REVIEWS_PER_SOURCE:
            continue
        clean_sources.append({
            "platform": platform,
            "rating": rating_f,
            "count": count_i,
            "url": (s.get("url") or "")[:500],
        })

    summary = _summarize(clean_sources)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "review_avg": summary["avg"],
            "review_count": summary["count"],
            "review_sources": clean_sources,
            "review_research_attempted_at": _now_iso(),
            "review_research_source": "llm_estimate",
            "review_research_notes": raw.get("notes") or "",
            "review_updated_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    return {
        "ok": True,
        "therapist_id": therapist_id,
        "found": True,
        "review_avg": summary["avg"],
        "review_count": summary["count"],
        "sources_kept": len(clean_sources),
    }


async def research_reviews_for_all(limit: int = 100) -> dict[str, Any]:
    """Cron-friendly: research all active therapists who haven't been
    researched in the last 30 days. Capped at `limit` to keep run-time bounded."""
    import asyncio
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cur = db.therapists.find(
        {
            "is_active": True,
            "$or": [
                {"review_research_attempted_at": {"$exists": False}},
                {"review_research_attempted_at": {"$lt": cutoff}},
            ],
        },
        {"_id": 0, "id": 1},
    )
    runs = 0
    found = 0
    async for r in cur:
        if runs >= limit:
            break
        result = await research_reviews_for_therapist(r["id"])
        runs += 1
        if result.get("found"):
            found += 1
        # Throttle so we don't hammer the LLM rate limit.
        await asyncio.sleep(0.5)
    return {"researched": runs, "with_data": found}
