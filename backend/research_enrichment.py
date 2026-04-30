"""LLM web-research enrichment for therapist↔patient matches.

Adds three score axes on TOP of the existing 100-point match engine:

1. **evidence_depth (0-10)** — does the therapist's web presence
   (website + bio) actually demonstrate experience treating the patient's
   primary concern? Or is it just a long checkbox list of specialties?
2. **approach_alignment (0-5)** — does their stated philosophy line up
   with what the patient asked for (style preference, prior-therapy
   experience, modality preferences)?
3. **apply_fit (0-5)** — when the therapist clicks Apply and writes a
   reply, does it directly address THIS patient's concerns?

Each axis comes with a one-sentence rationale citing the evidence so
the admin and the patient can see WHY the score moved.

Caching:
- Per-therapist web research (`research_summary`, `research_themes`)
  is cached in the therapist document for 30 days. Most patients reuse
  the same cached summary.
- Per-(therapist, request) scoring is stored on the request document
  under `research_scores[therapist_id]`.
- Per-application apply_fit is stored on the application document.

Toggle: `app_config.research_enrichment.enabled` (bool, default False).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from deps import db

logger = logging.getLogger("theravoca.research")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
HTTP_TIMEOUT_SEC = 8.0
MAX_HTML_TEXT_BYTES = 20_000  # ~5K tokens — keeps each call cheap
MAX_DEEP_TEXT_BYTES = 40_000  # bigger budget for the deep-research mode
DEEP_FETCH_LIMIT = 5          # fetch up to N search results per therapist
RESEARCH_TTL_DAYS = 30
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


# ─── DuckDuckGo HTML search (no API key required) ──────────────────────────
async def _ddg_search(query: str, *, limit: int = DEEP_FETCH_LIMIT) -> list[str]:
    """Return up to `limit` non-DDG result URLs for `query`.
    Uses the `html.duckduckgo.com` endpoint which works without JS or
    an API key. Best-effort — failures return [] silently so the
    enrichment pipeline degrades to website-only mode."""
    url = "https://html.duckduckgo.com/html/"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as c:
            r = await c.post(
                url,
                data={"q": query, "kl": "us-en"},
                headers={"User-Agent": USER_AGENT},
                timeout=HTTP_TIMEOUT_SEC,
            )
            if r.status_code != 200:
                return []
            html = r.text
    except (httpx.HTTPError, Exception):  # noqa: BLE001
        return []
    # The DDG HTML endpoint redirects through `//duckduckgo.com/l/?uddg=<encoded>`.
    raw_urls = re.findall(r'href="(?:https?:)?//duckduckgo\.com/l/\?uddg=([^"&]+)', html)
    out: list[str] = []
    seen: set[str] = set()
    from urllib.parse import unquote
    for u in raw_urls:
        decoded = unquote(u)
        if any(bad in decoded for bad in (
            "duckduckgo.com", "google.com/search", "bing.com",
            "youtube.com/results", "/ads/", "facebook.com/share",
        )):
            continue
        if decoded in seen:
            continue
        seen.add(decoded)
        out.append(decoded)
        if len(out) >= limit:
            break
    return out


async def _bing_search(query: str, *, limit: int = DEEP_FETCH_LIMIT) -> list[str]:
    """Return up to `limit` result URLs for `query` from Bing's HTML
    SERP. No API key, similar resilience profile to `_ddg_search`. We
    add Bing as a second source because it surfaces LinkedIn and
    Healthgrades links DuckDuckGo sometimes misses, broadening the
    evidence base for the research summary.
    """
    url = "https://www.bing.com/search"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as c:
            r = await c.get(
                url,
                params={"q": query, "form": "QBLH"},
                headers={"User-Agent": USER_AGENT},
                timeout=HTTP_TIMEOUT_SEC,
            )
            if r.status_code != 200:
                return []
            html = r.text
    except (httpx.HTTPError, Exception):  # noqa: BLE001
        return []
    # Bing wraps each result in `<li class="b_algo">…<a href="https://...">`
    candidates = re.findall(
        r'<li class="b_algo[^"]*">.*?<a href="(https?://[^"\']+)"',
        html, flags=re.DOTALL,
    )
    out: list[str] = []
    seen: set[str] = set()
    for u in candidates:
        if any(bad in u for bad in (
            "bing.com", "go.microsoft.com", "duckduckgo.com",
            "google.com/search", "/ads/", "facebook.com/share",
        )):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= limit:
            break
    return out


async def _multi_search(query: str, *, limit: int = DEEP_FETCH_LIMIT) -> list[str]:
    """Run DuckDuckGo + Bing in parallel and merge into a single
    deduped list (DDG order first, Bing fills the rest). Falls through
    to whichever engine is reachable when one is rate-limited."""
    ddg, bing = await asyncio.gather(
        _ddg_search(query, limit=limit),
        _bing_search(query, limit=limit),
        return_exceptions=True,
    )
    if isinstance(ddg, Exception):
        ddg = []
    if isinstance(bing, Exception):
        bing = []
    out: list[str] = []
    seen: set[str] = set()
    for u in [*ddg, *bing]:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= limit:
            break
    return out


# ─── Admin toggle ───────────────────────────────────────────────────────────

async def is_enabled() -> bool:
    doc = await db.app_config.find_one({"key": "research_enrichment"}, {"_id": 0})
    return bool((doc or {}).get("enabled", False))


async def set_enabled(enabled: bool) -> bool:
    await db.app_config.update_one(
        {"key": "research_enrichment"},
        {"$set": {"key": "research_enrichment", "enabled": bool(enabled)}},
        upsert=True,
    )
    return bool(enabled)


# ─── Web fetch + text strip ─────────────────────────────────────────────────

async def _fetch_website_text(url: str) -> Optional[str]:
    if not url:
        return None
    try:
        async with httpx.AsyncClient(follow_redirects=True) as c:
            r = await c.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT_SEC,
            )
            if r.status_code != 200:
                return None
            html = r.text
    except (httpx.HTTPError, Exception) as e:  # noqa: BLE001
        logger.warning("research fetch %s failed: %s", url, e)
        return None
    no_script = re.sub(
        r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.I,
    )
    text = re.sub(r"<[^>]+>", " ", no_script)
    return re.sub(r"\s+", " ", text).strip()[:MAX_HTML_TEXT_BYTES]


# ─── Research summary (cached per therapist) ────────────────────────────────

def _is_research_fresh(t: dict) -> bool:
    rt = t.get("research_refreshed_at")
    if not rt:
        return False
    try:
        dt = datetime.fromisoformat(rt.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    return datetime.now(timezone.utc) - dt < timedelta(days=RESEARCH_TTL_DAYS)


async def _build_research_summary(t: dict, *, deep: bool = False) -> dict[str, Any]:
    """One LLM call per therapist that returns a structured summary of
    what we can verify about them from their public web presence.

    `deep=True` also runs a DuckDuckGo search for the therapist's
    name and pulls up to 5 additional pages (PT profile, podcast
    episodes, blog posts, papers) before sending the combined corpus
    to Claude. Costs more but materially raises evidence_depth
    precision — recommended for the marquee 30-50 therapists in your
    directory rather than every cold pull.
    """
    if not EMERGENT_KEY:
        return {"summary": "", "themes": {}, "no_web": True}

    name = t.get("name") or ""
    web_text = await _fetch_website_text(t.get("website") or "")
    bio = (t.get("bio") or "").strip()

    extra_sources: list[str] = []
    deep_text = ""
    if deep and name:
        # Build a focused query — name + license + state + practice keywords
        license_str = (t.get("credential_type") or "").strip()
        city = (t.get("office_locations") or [None])[0] or "Idaho"
        query = f'"{name}" {license_str} {city} therapist'
        urls = await _multi_search(query)
        # Skip URLs we already have (the therapist's primary website domain)
        primary_host = ""
        if t.get("website"):
            from urllib.parse import urlparse
            primary_host = (urlparse(t["website"]).netloc or "").lower().lstrip("www.")
        chunks: list[str] = []
        for u in urls:
            from urllib.parse import urlparse
            host = (urlparse(u).netloc or "").lower().lstrip("www.")
            if primary_host and host.endswith(primary_host):
                continue
            page = await _fetch_website_text(u)
            if not page:
                continue
            chunks.append(f"=== SOURCE: {u} ===\n{page[:8000]}")
            extra_sources.append(u)
            if sum(len(c) for c in chunks) > MAX_DEEP_TEXT_BYTES:
                break
        deep_text = "\n\n".join(chunks)[:MAX_DEEP_TEXT_BYTES]

    if not web_text and not bio and not deep_text:
        return {"summary": "", "themes": {}, "no_web": True}

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        return {"summary": "", "themes": {}, "no_web": True}

    listed_primary = t.get("primary_specialties") or []
    listed_modalities = t.get("modalities") or []

    deep_block = (
        f"\n\nADDITIONAL WEB SOURCES ({len(extra_sources)} pages — "
        f"PT profiles, podcasts, blogs, etc.):\n{deep_text}"
        if deep_text else ""
    )

    prompt = f"""You are reviewing a therapist's PUBLIC WEB PRESENCE to extract
*evidence* of what they actually practice — not just what they list.

THERAPIST: {name}
PROFILE-CLAIMED PRIMARY SPECIALTIES: {", ".join(listed_primary) or "(none)"}
PROFILE-CLAIMED MODALITIES: {", ".join(listed_modalities) or "(none)"}

BIO (from our directory):
{bio or "(no bio)"}

PRIMARY WEBSITE TEXT (extracted):
{web_text or "(no website)"}{deep_block}

Return a STRICT JSON object with these keys:
- summary: 2-3 sentence factual summary of their public-facing approach
- evidence_themes: object mapping each specialty slug they HAVE EVIDENCE FOR
  to a short citation (≤15 words) of where the evidence appears. Use these
  slugs ONLY: anxiety, depression, ocd, adhd, trauma_ptsd, relationship_issues,
  life_transitions, parenting_family, substance_use, eating_concerns,
  autism_neurodivergence, school_academic_stress, perinatal, lgbtq, grief.
  EXAMPLE entry: "ocd": "Site has dedicated 'OCD & ERP' service page with case examples"
- modality_evidence: object slug → citation, slugs from: cbt, dbt, emdr, ifs,
  act, somatic, psychodynamic, narrative, art_therapy, play_therapy.
- style_signals: short list of 1–4 plain-English style descriptors evident
  on the site/bio (e.g. "warm", "structured", "directive", "trauma-informed").
- depth_signal: one of "deep" (multiple service pages, blog posts, podcasts
  on a primary topic), "moderate" (mentioned but not detailed), "shallow"
  (just a checkbox list), "none" (no web content).
- public_footprint: zero-to-three short citations of OTHER public web
  presence beyond their main site (e.g. "Guest on Anxiety Sisters podcast
  Ep 47", "Author of 2023 paper on trauma-informed care in JCP"). Empty
  list when none. Cite ONLY what appears in the source text above.

Rules:
- Cite ONLY what appears in the bio or website or additional sources.
  Never invent.
- If the website is just a Calendly or PT shell AND no extra sources
  yielded content, mark depth_signal="shallow".
- Return ONLY the JSON. No prose, no markdown fences.
"""

    chat = (
        LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"research_{uuid.uuid4().hex[:10]}",
            system_message=(
                "You are a precise evidence-extractor. Cite only what is in "
                "the source text. Always return valid JSON."
            ),
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("research LLM call failed for %s: %s", name, e)
        return {"summary": "", "themes": {}, "no_web": True}

    raw = (resp or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        if s == -1 or e <= s:
            return {"summary": "", "themes": {}, "no_web": True}
        try:
            data = json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            return {"summary": "", "themes": {}, "no_web": True}

    return {
        "summary": (data.get("summary") or "").strip()[:600],
        "themes": data.get("evidence_themes") or {},
        "modality_evidence": data.get("modality_evidence") or {},
        "style_signals": data.get("style_signals") or [],
        "depth_signal": data.get("depth_signal") or "none",
        "public_footprint": data.get("public_footprint") or [],
        "no_web": False,
        "deep_mode": bool(deep),
        "extra_sources": extra_sources,
    }


async def get_or_build_research(
    t: dict, *, force: bool = False, deep: bool = False,
) -> dict[str, Any]:
    """Return the therapist's cached web-research summary, building it if
    stale or missing. Writes the result back to the therapist document.

    `deep=True` always rebuilds (deep research is opt-in per call so the
    admin can promote a therapist from shallow → deep on demand).
    """
    if not force and not deep and _is_research_fresh(t):
        return {
            "summary": t.get("research_summary") or "",
            "themes": t.get("research_themes") or {},
            "modality_evidence": t.get("research_modality_evidence") or {},
            "style_signals": t.get("research_style_signals") or [],
            "depth_signal": t.get("research_depth_signal") or "none",
            "public_footprint": t.get("research_public_footprint") or [],
            "no_web": bool(t.get("research_no_web")),
            "deep_mode": bool(t.get("research_deep_mode")),
            "extra_sources": t.get("research_extra_sources") or [],
        }
    res = await _build_research_summary(t, deep=deep)
    await db.therapists.update_one(
        {"id": t["id"]},
        {"$set": {
            "research_summary": res.get("summary") or "",
            "research_themes": res.get("themes") or {},
            "research_modality_evidence": res.get("modality_evidence") or {},
            "research_style_signals": res.get("style_signals") or [],
            "research_depth_signal": res.get("depth_signal") or "none",
            "research_public_footprint": res.get("public_footprint") or [],
            "research_no_web": bool(res.get("no_web")),
            "research_deep_mode": bool(res.get("deep_mode")),
            "research_extra_sources": res.get("extra_sources") or [],
            "research_refreshed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return res


# ─── Per-(therapist, request) scoring ───────────────────────────────────────

def _score_axes(research: dict, request: dict) -> dict[str, Any]:
    """Compute evidence_depth (0-10) + approach_alignment (0-5) + rationale
    using ONLY the cached research dict — no LLM call here so this is
    cheap to call N times per request."""
    if research.get("no_web"):
        return {
            "evidence_depth": 0.0,
            "approach_alignment": 0.0,
            "rationale": "No public web presence to grade — score reflects directory profile only.",
            "themes": {},
        }
    themes = research.get("themes") or {}
    issues = [i.lower() for i in (request.get("presenting_issues") or [])]
    primary = issues[0] if issues else None

    # evidence_depth — purely DRIVEN by patient-specific theme overlap.
    # Web-presence depth alone (deep/moderate/shallow) only adds a small
    # baseline because a "deep depth" therapist who doesn't treat the
    # patient's concern shouldn't out-rank one who does.
    primary_hit = primary in themes if primary else False
    secondary_hits = sum(1 for i in issues[1:] if i in themes)

    if primary_hit:
        # Strong evidence the therapist treats the patient's primary concern.
        depth_word = (research.get("depth_signal") or "none").lower()
        primary_quality = {
            "deep": 7.0, "moderate": 5.0, "shallow": 3.0, "none": 2.0,
        }.get(depth_word, 2.0)
        base_depth = primary_quality
        if secondary_hits:
            base_depth += min(2.0, secondary_hits * 0.7)
    elif secondary_hits:
        # Some secondary-concern overlap — small partial credit.
        base_depth = min(3.0, secondary_hits * 1.0)
    else:
        # No theme overlap with patient's concerns at all. Pure
        # web-presence depth gets at most 1 point so it can't outweigh
        # better-matched therapists.
        depth_word = (research.get("depth_signal") or "none").lower()
        base_depth = 1.0 if depth_word in ("deep", "moderate") else 0.0
    evidence_depth = round(min(10.0, base_depth), 1)

    # approach_alignment — patient style prefs + modality prefs vs evidence
    style_signals = {s.lower() for s in (research.get("style_signals") or [])}
    style_prefs = {
        s.lower() for s in (request.get("style_preference") or [])
        if s and s != "no_pref"
    }
    style_overlap = len(style_signals & style_prefs)

    mod_evidence = {m.lower() for m in (research.get("modality_evidence") or {})}
    mod_prefs = {
        m.lower() for m in (request.get("modality_preferences") or []) if m
    }
    mod_overlap = len(mod_evidence & mod_prefs)

    approach = 0.0
    if style_overlap >= 2:
        approach += 2.5
    elif style_overlap == 1:
        approach += 1.5
    if mod_overlap >= 2:
        approach += 2.5
    elif mod_overlap == 1:
        approach += 1.5
    approach_alignment = round(min(5.0, approach), 1)

    # Rationale text — concrete + cites the evidence
    bits: list[str] = []
    if primary_hit and themes.get(primary):
        bits.append(f"Web evidence on {primary.replace('_', ' ')}: {themes[primary]}")
    elif primary and not primary_hit:
        bits.append(
            f"No web evidence yet for patient's primary concern "
            f"({primary.replace('_', ' ')}) — score from profile only.",
        )
    if mod_overlap:
        bits.append(
            f"Patient asked for {', '.join(sorted(mod_prefs & mod_evidence))} — "
            "therapist's site references the same modality."
        )
    if style_overlap:
        bits.append(
            f"Style match: {', '.join(sorted(style_signals & style_prefs))}.",
        )
    if not bits:
        bits.append(
            f"Public site shows {depth_word} depth on listed specialties; "
            "no overlap with patient's specific preferences yet.",
        )
    rationale = " ".join(bits)[:400]

    return {
        "evidence_depth": evidence_depth,
        "approach_alignment": approach_alignment,
        "rationale": rationale,
        "themes": {k: themes[k] for k in (issues or []) if k in themes},
    }


async def score_research_axes(therapist: dict, request: dict) -> dict[str, Any]:
    """Top-level entry point: ensure the therapist's research is fresh,
    then compute the per-request axes + rationale."""
    research = await get_or_build_research(therapist)
    return _score_axes(research, request)


# ─── Apply-time fit (LLM grades the actual reply) ──────────────────────────

async def score_apply_fit(
    apply_text: str, request: dict, therapist: dict,
) -> dict[str, Any]:
    """Reads the therapist's apply message and grades how directly it
    addresses THIS patient's concerns. 0-5 + 1-sentence rationale."""
    if not (apply_text or "").strip():
        return {"apply_fit": 0.0, "rationale": "No apply message provided."}
    if not EMERGENT_KEY:
        # Fallback — length-based heuristic so the field is always populated.
        n = len(apply_text)
        score = round(min(5.0, n / 400.0 * 5.0), 1)
        return {
            "apply_fit": score,
            "rationale": f"Heuristic only (LLM unavailable): {n}-char reply.",
        }
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        return {"apply_fit": 0.0, "rationale": "LLM integration unavailable."}

    issues = ", ".join(request.get("presenting_issues") or []) or "(none stated)"
    style = ", ".join(request.get("style_preference") or []) or "(no style preference)"
    prior = request.get("prior_therapy") or "not_sure"
    prior_notes = (request.get("prior_therapy_notes") or "")[:200]
    # Patient's free-text "Anything else?" context. Was previously not
    # passed into the grader; experiment_text_impact run showed variant E
    # only got +0.24 lift from rich patient context — because the grader
    # never saw it. Now we feed it in so therapists are graded on whether
    # they engage the WHOLE brief, not just the slug list.
    other_issue = (request.get("other_issue") or "").strip()[:500]

    extra_brief = (
        f"\n- Patient also wrote (free text): \"{other_issue}\"" if other_issue else ""
    )
    prompt = f"""You are grading a therapist's APPLY-message for fit with a
specific patient request. Score 0-5 (decimals OK):

- 5: addresses the patient's primary concern by name AND speaks to their
     prior-therapy experience or style preference AND engages any
     free-text context the patient wrote.
- 3-4: addresses the primary concern and ONE of (style / prior / free text).
- 1-2: generic intro, mentions concerns only in passing.
- 0: doesn't engage the patient's brief at all.

PATIENT BRIEF
- Presenting issues: {issues}
- Style preference: {style}
- Prior therapy: {prior} — notes: {prior_notes}{extra_brief}

THERAPIST ({therapist.get('name')}) APPLY MESSAGE:
\"\"\"
{apply_text[:2000]}
\"\"\"

Return STRICT JSON: {{"apply_fit": <0-5>, "rationale": "<one short sentence>"}}.
No prose, no markdown."""

    chat = (
        LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"applyfit_{uuid.uuid4().hex[:10]}",
            system_message="You grade therapist apply messages. Always JSON.",
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("apply-fit LLM call failed: %s", e)
        return {"apply_fit": 0.0, "rationale": "LLM call failed."}
    raw = (resp or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        if s == -1 or e <= s:
            return {"apply_fit": 0.0, "rationale": "LLM returned non-JSON."}
        try:
            d = json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            return {"apply_fit": 0.0, "rationale": "LLM returned non-JSON."}
    return {
        "apply_fit": round(max(0.0, min(5.0, float(d.get("apply_fit") or 0))), 1),
        "rationale": (d.get("rationale") or "")[:300],
    }


# ─── Match enrichment — runs after a request is matched ────────────────────

async def enrich_matches_for_request(request_id: str) -> dict[str, Any]:
    """Background task: for every notified therapist on this request,
    compute the research axes and store them under
    `requests.research_scores[<therapist_id>]` along with the delta vs
    the raw match score so the admin and patient can see the change.

    Therapists are processed in parallel (semaphore=4) — each one needs
    a website fetch + LLM call, so serial iteration over 30 notified
    therapists would take >5 min. With concurrency=4 we typically finish
    in <90s for a fresh batch and <10s when most therapists' research
    is already cached.
    """
    if not await is_enabled():
        return {"skipped": "enrichment disabled"}

    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        return {"error": "request not found"}
    notified_ids = req.get("notified_therapist_ids") or []
    if not notified_ids:
        return {"skipped": "no notified therapists"}

    raw_scores: dict[str, float] = {
        k: float(v) for k, v in (req.get("notified_scores") or {}).items()
    }
    research_scores: dict[str, dict] = req.get("research_scores") or {}
    todo = [tid for tid in notified_ids if tid not in research_scores]
    if not todo:
        return {"enriched": len(research_scores), "request_id": request_id}

    sem = asyncio.Semaphore(4)

    async def one(tid: str) -> Optional[tuple[str, dict]]:
        async with sem:
            t = await db.therapists.find_one({"id": tid}, {"_id": 0})
            if not t:
                return None
            try:
                axes = await score_research_axes(t, req)
            except Exception as e:
                logger.warning("research scoring failed for %s: %s", tid, e)
                return None
            raw = raw_scores.get(tid, 0.0)
            bonus = (axes.get("evidence_depth") or 0) + (
                axes.get("approach_alignment") or 0
            )
            enriched = round(min(120.0, raw + bonus), 1)
            delta = round(enriched - raw, 1)
            return tid, {
                "raw_score": raw,
                "enriched_score": enriched,
                "delta": delta,
                "evidence_depth": axes.get("evidence_depth") or 0,
                "approach_alignment": axes.get("approach_alignment") or 0,
                "rationale": axes.get("rationale") or "",
                "themes": axes.get("themes") or {},
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

    results = await asyncio.gather(*(one(tid) for tid in todo), return_exceptions=False)
    for r in results:
        if r is None:
            continue
        tid, score_dict = r
        research_scores[tid] = score_dict

    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "research_scores": research_scores,
            "research_enriched_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {
        "enriched": len(research_scores),
        "request_id": request_id,
    }
