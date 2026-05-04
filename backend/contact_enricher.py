"""Real contact-info enrichment for scraped therapist candidates.

Primary strategy: Google Places API (fast, reliable, structured data).
Fallback: scrape the therapist's website for mailto:/tel: links.

Flow:
  1. Search Google Places for "{name} therapist {city}, {state}"
  2. Fetch Place Details → phone, website, (sometimes email)
  3. If Places didn't yield email, fall back to website scraping

Anti-hallucination design: every piece of contact info comes from
Google's business data or actual scraped HTML. Nothing is generated or guessed.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

import httpx

import places_client

logger = logging.getLogger("theravoca.contact_enricher")

# ── Regex patterns ───────────────────────────────────────────────────────────

EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)

PHONE_RE = re.compile(
    r"(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}"
)

# Domains whose emails we should ignore (not therapist contact emails)
SKIP_EMAIL_DOMAINS = {
    "example.com", "sentry.io", "cloudflare.com", "w3.org",
    "wixpress.com", "squarespace.com", "wordpress.com",
    "googleapis.com", "gstatic.com", "google.com",
    "facebook.com", "twitter.com", "instagram.com", "youtube.com",
    "linkedin.com", "pinterest.com", "tiktok.com",
    "psychologytoday.com", "therapyden.com", "goodtherapy.org",
    "simplepractice.com", "therapynotes.com", "headway.co",
}

# Known fake/placeholder phone numbers to filter out
_FAKE_PHONES = {
    "2147483647", "12147483647", "2147483648",
    "0000000000", "1111111111", "1234567890", "9999999999",
}

def _is_fake_phone(raw: str) -> bool:
    digits = re.sub(r"[^\d]", "", raw)
    return digits in _FAKE_PHONES or digits[-10:] in _FAKE_PHONES


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


# ── Extraction helpers ───────────────────────────────────────────────────────

def _extract_emails(html: str) -> list[str]:
    """Extract real email addresses from HTML. Prioritises mailto: links."""
    emails: dict[str, int] = {}  # email -> priority (lower = better)

    # Priority 1: mailto: links (most intentional)
    for m in re.finditer(r'href="mailto:([^"?]+)', html, re.IGNORECASE):
        e = m.group(1).strip().lower()
        if "@" in e:
            emails.setdefault(e, 1)

    # Priority 2: emails in visible text
    text = re.sub(r"<[^>]+>", " ", html)
    for m in EMAIL_RE.finditer(text):
        e = m.group(0).lower().rstrip(".")
        emails.setdefault(e, 2)

    # Priority 3: emails anywhere in raw HTML (catches obfuscated ones)
    for m in EMAIL_RE.finditer(html):
        e = m.group(0).lower().rstrip(".")
        emails.setdefault(e, 3)

    # Filter out junk
    filtered = []
    for email, pri in sorted(emails.items(), key=lambda x: x[1]):
        domain = email.split("@")[1] if "@" in email else ""
        if any(domain == sd or domain.endswith("." + sd) for sd in SKIP_EMAIL_DOMAINS):
            continue
        if domain.endswith((".png", ".jpg", ".gif", ".svg", ".css", ".js")):
            continue
        if "noreply" in email or "no-reply" in email or "donotreply" in email:
            continue
        filtered.append(email)

    return filtered


def _extract_phones(html: str) -> list[str]:
    """Extract phone numbers. Prioritises tel: href links."""
    phones: dict[str, int] = {}  # normalised -> priority

    # Priority 1: tel: links
    for m in re.finditer(r'href="tel:([^"]+)"', html, re.IGNORECASE):
        raw = m.group(1).strip()
        digits = re.sub(r"[^\d]", "", raw)
        if len(digits) >= 10:
            phones.setdefault(digits[-10:], 1)

    # Priority 2: phone numbers in visible text
    text = re.sub(r"<[^>]+>", " ", html)
    for m in PHONE_RE.finditer(text):
        digits = re.sub(r"[^\d]", "", m.group(0))
        if len(digits) >= 10:
            phones.setdefault(digits[-10:], 2)

    return [d for d, _ in sorted(phones.items(), key=lambda x: x[1])]


def _format_phone(digits: str) -> str:
    """Format 10-digit phone string as (XXX) XXX-XXXX."""
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return digits


# ── Main enrichment ─────────────────────────────────────────────────────────

async def _fetch_site(url: str, client: httpx.AsyncClient) -> Optional[str]:
    """Fetch a website with timeout. Returns HTML or None."""
    try:
        r = await client.get(url, headers=HEADERS, timeout=10.0)
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            if "text/html" in ct or "application/xhtml" in ct:
                return r.text[:200_000]  # cap to avoid memory issues
        else:
            logger.debug("Site %s returned HTTP %d", url, r.status_code)
    except Exception as exc:
        logger.debug("Failed to fetch %s: %s", url, exc)
    return None


async def _enrich_from_places(candidate: dict) -> bool:
    """Try Google Places API first. Returns True if we got useful data."""
    if not places_client.is_configured():
        return False
    name = candidate.get("name", "")
    city = candidate.get("city", "")
    state = candidate.get("state", "ID")
    if not name:
        return False

    place = await places_client.search_therapist_business(name, city, state)
    if not place:
        return False

    # Get full details (phone, website)
    pid = place.get("id") or (place.get("name") or "").replace("places/", "")
    if not pid:
        return False

    details = await places_client.get_place_reviews(pid)
    if not details:
        return False

    got_something = False

    # Phone from Google Places
    phone_raw = details.get("internationalPhoneNumber", "")
    if phone_raw:
        digits = re.sub(r"[^\d]", "", phone_raw)
        if len(digits) >= 10 and not _is_fake_phone(digits):
            candidate["phone"] = _format_phone(digits)
            candidate["phone_source"] = "google_places"
            got_something = True

    # Website from Google Places (useful for email fallback)
    website = details.get("websiteUri", "")
    if website and not candidate.get("website"):
        candidate["website"] = website
        got_something = True

    # Store place_id for future use (reviews, etc.)
    candidate["google_place_id"] = pid
    candidate["google_place_name"] = (details.get("displayName") or {}).get("text", "")

    return got_something


async def _enrich_from_website(candidate: dict, client: httpx.AsyncClient) -> None:
    """Fallback: scrape the therapist's website for email/phone."""
    website = candidate.get("website") or ""
    if not website:
        return

    html = await _fetch_site(website, client)
    if not html:
        return

    # Extract real emails (only if we don't already have one)
    if not candidate.get("email"):
        emails = _extract_emails(html)
        if emails:
            domain_m = re.search(r"https?://(?:www\.)?([^/]+)", website)
            site_domain = domain_m.group(1).lower() if domain_m else ""
            matching = [e for e in emails if site_domain and site_domain in e]
            best_email = matching[0] if matching else emails[0]
            candidate["email"] = best_email
            candidate["email_source"] = "website"

    # Extract real phones (only if we don't already have one from Places)
    if not candidate.get("phone") or candidate.get("phone_source") != "google_places":
        phones = [p for p in _extract_phones(html) if not _is_fake_phone(p)]
        if phones:
            candidate["phone"] = _format_phone(phones[0])
            candidate["phone_source"] = "website"


async def enrich_one(candidate: dict, client: httpx.AsyncClient) -> dict:
    """Enrich a single candidate with real contact info.

    Strategy:
      1. Google Places API → phone, website (structured, reliable)
      2. Website scraping → email, phone fallback (regex on HTML)

    Modifies candidate in place.
    """
    # Step 1: Google Places (gets phone + website reliably)
    await _enrich_from_places(candidate)

    # Step 2: Website scraping (gets email, phone if Places missed it)
    await _enrich_from_website(candidate, client)

    return candidate


async def enrich_batch(
    candidates: list[dict],
    *,
    delay_sec: float = 0.4,
    max_enrich: int = 50,
) -> list[dict]:
    """Enrich up to max_enrich candidates via Google Places + website fallback.

    Works on ALL candidates with a name (Places API doesn't need a website).
    Rate-limited to stay within API quotas.
    """
    to_enrich = [c for c in candidates if c.get("name")][:max_enrich]
    if not to_enrich:
        return candidates

    logger.info("Enriching %d candidates (Places API + website fallback)", len(to_enrich))

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for i, c in enumerate(to_enrich):
            await enrich_one(c, client)
            if i < len(to_enrich) - 1:
                await asyncio.sleep(delay_sec)

    got_phone = sum(1 for c in to_enrich if c.get("phone"))
    got_email = sum(1 for c in to_enrich if c.get("email"))
    logger.info("Enrichment done: %d/%d phones, %d/%d emails",
                got_phone, len(to_enrich), got_email, len(to_enrich))

    return candidates
