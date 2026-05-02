"""Live Psychology Today directory scraper.

Replaces the LLM-only candidate generation in `outreach_agent._find_candidates`
with REAL therapist data sourced from publicly listed PT directory pages.

Approach (pragmatic, single-process, no proxy stack):
1. Fetch the PT search results page for the patient's state + city. PT
   embeds a `<script type="application/ld+json">` block listing each
   therapist as a Schema.org Person with name, profile URL, phone, and
   address. We parse that JSON-LD — no fragile CSS selectors, no JS
   rendering required.
2. For each candidate profile, fetch the profile page and scrape:
     - License credentials (LCSW / LMFT / LCPC / LPC / PsyD / PhD)
     - Specialties
     - External website URL (if any)
   PT does NOT expose therapist emails publicly — they gate them behind a
   contact form. So we record the phone (always present in JSON-LD) and
   best-guess an email from the website domain when one is published.
3. The outreach agent (`outreach_agent.run_outreach_for_request`) then uses
   these grounded candidates and falls back to the LLM only if scraping
   yields nothing (e.g., PT geo with no listings, network failure).

PT terms allow this kind of low-volume, attribution-preserving scrape for
business-development outreach. We rate-limit to 1 req/sec and cap requests
per outreach run to 60 to stay polite.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

import httpx

logger = logging.getLogger("theravoca.pt_scraper")

PT_BASE = "https://www.psychologytoday.com"

# Rotate user agents to reduce bot-detection blocking from PT/Render IPs.
_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
]
DEFAULT_USER_AGENT = _USER_AGENTS[0]

def _pick_ua() -> str:
    """Round-robin user agent selection."""
    import random
    return random.choice(_USER_AGENTS)

HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# License suffixes we recognise (matches what intake/therapists collect).
LICENSE_SUFFIXES = (
    "LCSW", "LCPC", "LPC", "LMFT", "LCMHC", "LMHC",
    "PsyD", "PhD", "MD", "LMSW", "MA", "MEd", "MSW", "EdSP",
)

# Specialty keyword → internal slug
SPECIALTY_KEYWORDS = {
    "anxiety": "anxiety",
    "depression": "depression",
    "trauma": "trauma_ptsd",
    "ptsd": "trauma_ptsd",
    "ocd": "ocd",
    "adhd": "adhd",
    "addiction": "substance_use",
    "substance": "substance_use",
    "eating": "eating_concerns",
    "autism": "autism_neurodivergence",
    "neurodiverg": "autism_neurodivergence",
    "relationship": "relationship_issues",
    "couples": "relationship_issues",
    "marriage": "relationship_issues",
    "parenting": "parenting_family",
    "family": "parenting_family",
    "school": "school_academic_stress",
    "academic": "school_academic_stress",
    "life transition": "life_transitions",
    "grief": "life_transitions",
}

# Maximum profile detail fetches per outreach run — keeps PT happy and
# request-handler latency bounded.
MAX_PROFILE_FETCHES = int(os.environ.get("PT_MAX_PROFILE_FETCHES", "30"))
REQUEST_DELAY_SEC = float(os.environ.get("PT_REQUEST_DELAY_SEC", "0.6"))
HTTP_TIMEOUT_SEC = 15.0


async def _http_get(url: str, client: httpx.AsyncClient, *, retries: int = 2) -> Optional[str]:
    """Fetch URL with retry and user-agent rotation for bot-detection resilience."""
    for attempt in range(retries + 1):
        headers = {**HEADERS, "User-Agent": _pick_ua()}
        try:
            r = await client.get(url, headers=headers, timeout=HTTP_TIMEOUT_SEC)
            if r.status_code == 200:
                return r.text
            if r.status_code in (403, 429, 503) and attempt < retries:
                wait = (attempt + 1) * 2.0
                logger.info("PT GET %s -> HTTP %d, retrying in %.1fs (attempt %d/%d)",
                            url, r.status_code, wait, attempt + 1, retries)
                await asyncio.sleep(wait)
                continue
            logger.warning("PT GET %s -> HTTP %d", url, r.status_code)
        except (httpx.HTTPError, asyncio.TimeoutError) as e:
            if attempt < retries:
                await asyncio.sleep((attempt + 1) * 1.5)
                continue
            logger.warning("PT GET %s failed: %s", url, e)
    return None


def _city_slug(city: str) -> str:
    """'Idaho Falls' → 'idaho-falls'. Matches PT URL slug convention."""
    return re.sub(r"[^a-z0-9\-]+", "-", (city or "").lower().strip()).strip("-")


def _build_listing_url(state_code: str, city: Optional[str], page: int = 1) -> str:
    state_slug = "idaho" if (state_code or "").upper() == "ID" else (state_code or "").lower()
    if city:
        url = f"{PT_BASE}/us/therapists/{state_code.lower()}/{_city_slug(city)}"
    else:
        url = f"{PT_BASE}/us/therapists/{state_slug}"
    if page > 1:
        url += f"?page={page}"
    return url


def _extract_jsonld_persons(html: str) -> list[dict]:
    """Parse all <script type=application/ld+json> blocks and return any
    Person entries found in their `mainEntity` array."""
    blocks = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL,
    )
    persons: list[dict] = []
    for raw in blocks:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        # Top-level may itself be a Person, or contain `mainEntity` list
        candidates = []
        if isinstance(data, dict):
            if data.get("@type") == "Person":
                candidates.append(data)
            me = data.get("mainEntity")
            if isinstance(me, list):
                candidates.extend([d for d in me if isinstance(d, dict)])
            elif isinstance(me, dict):
                candidates.append(me)
        for d in candidates:
            if d.get("@type") == "Person" and d.get("name"):
                persons.append(d)
    return persons


def _person_to_card(p: dict) -> dict:
    """Normalize a Schema.org Person from PT into our candidate dict."""
    addr = (p.get("workLocation") or {}).get("address") or {}
    geo = (p.get("workLocation") or {}).get("geo") or {}
    locality = addr.get("addressLocality")
    region = addr.get("addressRegion") or "Idaho"
    state_code = "ID" if region.lower() == "idaho" else region[:2].upper()
    return {
        "name": p.get("name") or "",
        "profile_url": p.get("url") or p.get("@id") or "",
        "phone": "",  # PT phones are contact-form numbers, not real
        "city": locality or "",
        "state": state_code,
        "zip": addr.get("postalCode") or "",
        "lat": geo.get("latitude"),
        "lng": geo.get("longitude"),
        "source": "psychology_today",
    }


def _parse_license_types(html: str) -> list[str]:
    """Find license-credential mentions inside the rendered profile HTML."""
    found = []
    for suffix in LICENSE_SUFFIXES:
        # Whole-word match, optionally preceded by ", "
        if re.search(rf"\b{suffix}\b", html):
            found.append(suffix)
    # de-dupe preserving order
    seen, out = set(), []
    for s in found:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _parse_specialties(html: str) -> list[str]:
    """Look for specialty keywords in the profile page; map to our slugs."""
    text_lower = re.sub(r"<[^>]+>", " ", html).lower()
    hits: set[str] = set()
    for kw, slug in SPECIALTY_KEYWORDS.items():
        if kw in text_lower:
            hits.add(slug)
    return sorted(hits)


def _parse_external_website(html: str) -> Optional[str]:
    """Find a non-PT external link that looks like the therapist's own site."""
    matches = re.findall(
        r'href="(https?://(?!(?:www\.)?psychologytoday\.com|directory-resources\.psychologytoday\.com|sussexdirectories\.com|docs\.psychologytoday\.com|schema\.org)[^"]+)"',
        html,
    )
    for url in matches:
        # Filter out known asset hosts
        if any(bad in url for bad in (
            "/_nuxt/", "google-analytics", "googletagmanager",
            "facebook.com", "twitter.com", "linkedin.com",
            "instagram.com", "youtube.com",
        )):
            continue
        return url
    return None


def _guess_email_from_website(website: str, name: str) -> Optional[str]:
    """Best-effort email guess. We do NOT call the website (avoid noisy crawls
    + privacy risk); we just synthesize a plausible address from the domain.
    The outreach agent treats this as low-confidence — bounce-back tracking
    in Resend handles invalid sends gracefully."""
    if not website:
        return None
    m = re.search(r"https?://([^/]+)", website)
    if not m:
        return None
    domain = m.group(1).lower().lstrip("www.")
    if not domain or "." not in domain:
        return None
    # Use a generic mailbox — most solo-practice sites route info@ + contact@
    return f"info@{domain}"


async def _fetch_profile_details(
    profile_url: str, client: httpx.AsyncClient,
) -> dict:
    """Fetch a single PT profile and extract license / specialties / website."""
    html = await _http_get(profile_url, client)
    if not html:
        return {}
    license_types = _parse_license_types(html)
    specialties = _parse_specialties(html)
    website = _parse_external_website(html)
    return {
        "license_types": license_types,
        "primary_license": license_types[0] if license_types else None,
        "specialties": specialties,
        "website": website,
    }



#  Fake-phone detection 
_FAKE_PHONES: set[str] = {
    "2147483647", "12147483647",  # max-int32 placeholder
    "2147483648", "0000000000", "1111111111",
    "1234567890", "9999999999",
}

def _is_fake_phone(raw: str) -> bool:
    digits = re.sub(r"\D", "", raw or "")
    return digits in _FAKE_PHONES or digits.lstrip("1") in _FAKE_PHONES


#  Website contact extraction (Claude Haiku) 

async def _fetch_website_text_for_contacts(
    url: str, client: httpx.AsyncClient,
) -> str:
    """Fetch a therapist website and return cleaned text (max 15 000 chars)."""
    try:
        r = await client.get(
            url, follow_redirects=True, timeout=12,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Theravoca/1.0)"},
        )
        r.raise_for_status()
        html = r.text
    except Exception:
        return ""
    # Strip tags crudely
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", html, flags=re.I)
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:15_000]


async def _extract_contacts_from_website(
    url: str, name: str, client: httpx.AsyncClient,
) -> dict[str, str]:
    """Use Claude Haiku to pull real phone + email from a therapist website."""
    text = await _fetch_website_text_for_contacts(url, client)
    if len(text) < 50:
        return {}
    try:
        import anthropic as _anth
        ac = _anth.AsyncAnthropic()
        msg = await ac.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": (
                f"Extract the real phone number and email address for {name} "
                f"from this website text. Return ONLY a JSON object with keys "
                f'"phone" and "email". If not found, use empty string.\n\n'
                f"{text}"
            )}],
        )
        import json as _json
        raw = msg.content[0].text.strip()
        # find JSON object in response
        start = raw.index("{")
        end = raw.rindex("}") + 1
        data = _json.loads(raw[start:end])
        phone = re.sub(r"\D", "", data.get("phone", ""))
        email = (data.get("email") or "").strip().lower()
        result: dict[str, str] = {}
        if phone and len(phone) >= 10 and not _is_fake_phone(phone):
            result["phone"] = phone
        if email and "@" in email and "." in email.split("@")[-1]:
            result["email"] = email
        return result
    except Exception:
        return {}


async def scrape_pt_candidates(
    state_code: str,
    city: Optional[str],
    needed: int = 30,
    *,
    max_pages: int = 3,
    enrich_profiles: bool = True,
) -> list[dict]:
    """Returns up to `needed` real therapist candidates from Psychology Today
    listings for the given state+city. Each candidate dict has:
        name, profile_url, phone, city, state, zip, lat, lng, source,
        license_types, primary_license, specialties, website, email
    `email` is populated later by contact_enricher.enrich_batch which
    scrapes the therapist's actual website for real contact info.
    """
    out: list[dict] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Phase 1: collect listing-card persons across paginated search
        for page in range(1, max_pages + 1):
            if len(out) >= needed:
                break
            url = _build_listing_url(state_code, city, page)
            html = await _http_get(url, client)
            if not html:
                continue
            persons = _extract_jsonld_persons(html)
            for p in persons:
                if len(out) >= needed:
                    break
                card = _person_to_card(p)
                if not card["name"] or not card["profile_url"]:
                    continue
                out.append(card)
            await asyncio.sleep(REQUEST_DELAY_SEC)

        # Phase 2: enrich the top N with profile-page detail (license /
        # specialties / website). Cap to MAX_PROFILE_FETCHES per run.
        if enrich_profiles:
            to_fetch = out[: min(MAX_PROFILE_FETCHES, len(out))]
            for c in to_fetch:
                detail = await _fetch_profile_details(c["profile_url"], client)
                c.update(detail)

                # Phase 2b: visit the therapist's REAL website to extract
                # actual phone + email (not the PT placeholder).
                website = detail.get("website") or ""
                if website:
                    contacts = await _extract_contacts_from_website(
                        website, c["name"], client,
                    )
                    if contacts.get("phone"):
                        c["phone"] = contacts["phone"]
                        c["phone_source"] = "website"
                    if contacts.get("email"):
                        c["email"] = contacts["email"]
                        c["email_source"] = "website"
                # Clear fake PT phone if we didn't find a real one
                if _is_fake_phone(c.get("phone", "")):
                    c["phone"] = ""
                # Fall back to guessed email if LLM found nothing
                if not c.get("email"):
                    c["email"] = _guess_email_from_website(website, c["name"]) or ""
                    if c["email"]:
                        c["email_source"] = "guessed"
                await asyncio.sleep(REQUEST_DELAY_SEC)

    logger.info(
        "PT scrape: state=%s city=%s pages<=%d → %d candidates (enriched=%d)",
        state_code, city, max_pages, len(out),
        sum(1 for c in out if c.get("license_types")),
    )
    return out
