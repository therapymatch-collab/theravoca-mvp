"""Backup therapist directory scrapers.

When the primary Psychology Today scraper (`pt_scraper.py`) fails or returns
too few candidates, these scrapers pull from alternative public directories
and the Google Places API to fill the gap.

Sources:
  1. TherapyDen  — public therapist search with HTML parsing
  2. GoodTherapy — public therapist listings, JSON-LD + HTML fallback
  3. Google Maps  — Places API (New) Text Search (most reliable)

All scrapers return candidates in a consistent `list[dict]` shape matching
the format used by pt_scraper and outreach_agent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional
from urllib.parse import quote_plus, urljoin

import httpx

logger = logging.getLogger("theravoca.directory_scrapers")

# ── Shared constants ─────────────────────────────────────────────────────────────────

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

LICENSE_SUFFIXES = (
    "LCSW", "LCPC", "LPC", "LMFT", "LCMHC", "LMHC",
    "PsyD", "PhD", "MD", "LMSW", "MA", "MEd", "MSW", "EdSP",
)

REQUEST_DELAY_SEC = 0.6
HTTP_TIMEOUT_SEC = 15.0

GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
PLACES_BASE_URL = "https://places.googleapis.com/v1"
PLACES_SEARCH_FIELDS = (
    "places.id,places.displayName,places.formattedAddress,"
    "places.internationalPhoneNumber,places.websiteUri,"
    "places.types,places.location"
)


# ── Helpers ──────────────────────────────────────────────────────────────────────

async def _http_get(
    url: str,
    client: httpx.AsyncClient,
    *,
    source_label: str = "",
) -> Optional[str]:
    """Fetch a URL and return body text, or None on failure."""
    try:
        r = await client.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT_SEC)
        if r.status_code == 200:
            return r.text
        logger.warning(
            "%s GET %s -> HTTP %d", source_label or "HTTP", url, r.status_code,
        )
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        logger.warning(
            "%s GET %s failed: %s", source_label or "HTTP", url, exc,
        )
    return None


def _extract_license_types(text: str) -> list[str]:
    """Find license-credential mentions in arbitrary text."""
    seen: set[str] = set()
    out: list[str] = []
    for suffix in LICENSE_SUFFIXES:
        if re.search(rf"\b{suffix}\b", text) and suffix not in seen:
            seen.add(suffix)
            out.append(suffix)
    return out


def _guess_email_from_website(website: str) -> str:
    """Synthesize a plausible contact email from a website domain."""
    if not website:
        return ""
    m = re.search(r"https?://([^/]+)", website)
    if not m:
        return ""
    domain = m.group(1).lower().lstrip("www.")
    if not domain or "." not in domain:
        return ""
    return f"info@{domain}"


def _city_slug(city: str) -> str:
    """'Idaho Falls' -> 'idaho-falls'."""
    return re.sub(r"[^a-z0-9]+", "-", (city or "").lower().strip()).strip("-")


def _dedup_key(candidate: dict) -> str:
    """Case-insensitive name+city key for deduplication."""
    name = (candidate.get("name") or "").strip().lower()
    city = (candidate.get("city") or "").strip().lower()
    return f"{name}|{city}"


def _completeness_score(candidate: dict) -> int:
    """Higher = more complete record. Used for sorting."""
    score = 0
    if candidate.get("email"):
        score += 3
    if candidate.get("phone"):
        score += 3
    if candidate.get("website"):
        score += 2
    if candidate.get("license_types"):
        score += 2
    if candidate.get("specialties"):
        score += 1
    return score


# ── 1. TherapyDen ────────────────────────────────────────────────────────────────

_TD_BASE = "https://www.therapyden.com"


def _parse_therapyden_cards(html: str) -> list[dict]:
    """Extract therapist cards from a TherapyDen search results page.

    TherapyDen renders therapist cards in a list, each containing a link to the
    therapist's profile, their name (often with credentials), location, and a
    short list of specialties.
    """
    candidates: list[dict] = []

    # Each card is typically an <a> or <div> with class containing "therapist"
    # or inside a list structure. We look for profile links + surrounding text.
    # Pattern: links to /therapists/<slug> with the therapist name as anchor text.
    card_blocks = re.findall(
        r'<a[^>]+href="(/therapists/[^"]+)"[^>]*>(.*?)</a>',
        html,
        re.DOTALL,
    )

    seen_urls: set[str] = set()
    for href, inner in card_blocks:
        # Skip non-profile links (e.g., /therapists?page=2)
        if "?" in href or href.count("/") < 2:
            continue
        profile_url = f"{_TD_BASE}{href}"
        if profile_url in seen_urls:
            continue
        seen_urls.add(profile_url)

        # Clean up the inner HTML to get the name
        name_text = re.sub(r"<[^>]+>", " ", inner).strip()
        name_text = re.sub(r"\s+", " ", name_text)
        if not name_text or len(name_text) > 120:
            continue

        candidates.append({
            "name": name_text,
            "profile_url": profile_url,
            "source": "therapyden",
        })

    # Broader fallback: look for structured card divs if the above yields nothing
    if not candidates:
        # Some TherapyDen pages use data attributes or structured HTML
        name_matches = re.findall(
            r'class="[^"]*therapist[^"]*"[^>]*>.*?'
            r'<(?:h[2-4]|strong|span)[^>]*>([^<]{3,80})</(?:h[2-4]|strong|span)>',
            html,
            re.DOTALL,
        )
        for name in name_matches:
            clean = name.strip()
            if clean:
                candidates.append({
                    "name": clean,
                    "profile_url": "",
                    "source": "therapyden",
                })

    return candidates


def _parse_therapyden_profile(html: str, card: dict) -> dict:
    """Enrich a TherapyDen candidate from their profile page."""
    enriched = dict(card)

    # Phone
    phone_match = re.search(
        r'href="tel:([^"]+)"', html,
    )
    if phone_match:
        enriched["phone"] = phone_match.group(1).strip()

    # Website
    website_match = re.search(
        r'href="(https?://(?!(?:www\.)?therapyden\.com)[^"]+)"[^>]*>\s*'
        r'(?:Website|Visit\s+Website|website)',
        html,
        re.IGNORECASE,
    )
    if website_match:
        enriched["website"] = website_match.group(1)
        enriched["email"] = _guess_email_from_website(enriched["website"])

    # Fallback: any external non-social link
    if not enriched.get("website"):
        ext_links = re.findall(
            r'href="(https?://(?!(?:www\.)?therapyden\.com|facebook\.com|'
            r'instagram\.com|twitter\.com|linkedin\.com|youtube\.com)[^"]+)"',
            html,
        )
        for link in ext_links:
            if "google" not in link and "schema.org" not in link:
                enriched["website"] = link
                enriched["email"] = _guess_email_from_website(link)
                break

    # License types from the full page text
    license_types = _extract_license_types(html)
    if license_types:
        enriched["license_types"] = license_types
        enriched["primary_license"] = license_types[0]

    # Specialties — look for lists following "Specialties" heading
    spec_section = re.search(
        r'(?:specialt|issue|concern).*?<(?:ul|div)[^>]*>(.*?)</(?:ul|div)>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if spec_section:
        specs = re.findall(r"<li[^>]*>([^<]+)</li>", spec_section.group(1))
        enriched["specialties"] = [s.strip().lower() for s in specs if s.strip()]

    return enriched


async def scrape_therapyden(
    state_code: str,
    city: str | None = None,
    needed: int = 30,
) -> list[dict]:
    """Scrape TherapyDen for therapist candidates in the given location.

    Returns up to `needed` candidates as list[dict].
    """
    if not city:
        logger.info("TherapyDen requires a city; skipping")
        return []

    search_url = (
        f"{_TD_BASE}/therapists"
        f"?search%5Bcity%5D={quote_plus(city)}"
        f"&search%5Bstate%5D={quote_plus(state_code.upper())}"
    )

    candidates: list[dict] = []
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            html = await _http_get(search_url, client, source_label="TherapyDen")
            if not html:
                return []

            cards = _parse_therapyden_cards(html)
            logger.info("TherapyDen search: %d cards found for %s, %s",
                         len(cards), city, state_code)

            for card in cards[:needed]:
                # Set defaults
                card.setdefault("city", city)
                card.setdefault("state", state_code.upper())
                card.setdefault("email", "")
                card.setdefault("phone", "")
                card.setdefault("website", "")
                card.setdefault("license_types", [])
                card.setdefault("primary_license", "")
                card.setdefault("specialties", [])

                # Enrich from profile page if we have a URL
                if card.get("profile_url"):
                    await asyncio.sleep(REQUEST_DELAY_SEC)
                    profile_html = await _http_get(
                        card["profile_url"], client, source_label="TherapyDen",
                    )
                    if profile_html:
                        enriched = _parse_therapyden_profile(profile_html, card)
                        card.update(enriched)

                candidates.append(card)
                if len(candidates) >= needed:
                    break

    except Exception:
        logger.exception("TherapyDen scrape failed for %s, %s", city, state_code)

    logger.info("TherapyDen: returning %d candidates", len(candidates))
    return candidates


# ── 2. GoodTherapy ───────────────────────────────────────────────────────────────

_GT_BASE = "https://www.goodtherapy.org"


def _parse_goodtherapy_jsonld(html: str) -> list[dict]:
    """Extract Person entries from JSON-LD blocks on a GoodTherapy page."""
    blocks = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    persons: list[dict] = []
    for raw in blocks:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        items = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = [data]
            me = data.get("mainEntity")
            if isinstance(me, list):
                items.extend(me)
            elif isinstance(me, dict):
                items.append(me)
        for item in items:
            if isinstance(item, dict) and item.get("@type") == "Person" and item.get("name"):
                persons.append(item)
    return persons


def _parse_goodtherapy_html_cards(html: str) -> list[dict]:
    """Fallback: parse therapist cards from GoodTherapy HTML."""
    candidates: list[dict] = []

    # GoodTherapy listing cards typically link to /therapists/profile/<id>
    card_matches = re.findall(
        r'<a[^>]+href="(/therapists/profile/[^"]+)"[^>]*>.*?'
        r'<(?:h[2-4]|span|strong)[^>]*>([^<]{3,80})</(?:h[2-4]|span|strong)>',
        html,
        re.DOTALL,
    )
    seen: set[str] = set()
    for href, name_text in card_matches:
        profile_url = f"{_GT_BASE}{href}"
        if profile_url in seen:
            continue
        seen.add(profile_url)
        name = name_text.strip()
        if name:
            candidates.append({
                "name": name,
                "profile_url": profile_url,
            })

    # Broader pattern: look for any profile links
    if not candidates:
        profile_links = re.findall(
            r'href="(/therapists/profile/[^"]+)"[^>]*>\s*([^<]{3,80})',
            html,
        )
        for href, name in profile_links:
            url = f"{_GT_BASE}{href}"
            if url not in seen:
                seen.add(url)
                candidates.append({
                    "name": name.strip(),
                    "profile_url": url,
                })

    return candidates


def _goodtherapy_person_to_card(person: dict) -> dict:
    """Convert a JSON-LD Person to our candidate dict."""
    addr = person.get("address") or person.get("workLocation", {}).get("address", {})
    if isinstance(addr, list):
        addr = addr[0] if addr else {}

    phone = person.get("telephone") or ""
    url = person.get("url") or ""
    website = person.get("sameAs") or ""
    if isinstance(website, list):
        website = website[0] if website else ""

    name = person.get("name", "")
    license_types = _extract_license_types(name)

    return {
        "name": name,
        "profile_url": url,
        "phone": phone,
        "city": addr.get("addressLocality", ""),
        "state": addr.get("addressRegion", ""),
        "website": website,
        "email": _guess_email_from_website(website),
        "license_types": license_types,
        "primary_license": license_types[0] if license_types else "",
        "specialties": [],
        "source": "goodtherapy",
    }


def _parse_goodtherapy_profile(html: str, card: dict) -> dict:
    """Enrich a GoodTherapy candidate from their profile page."""
    enriched = dict(card)

    # Phone
    phone_match = re.search(r'href="tel:([^"]+)"', html)
    if phone_match and not enriched.get("phone"):
        enriched["phone"] = phone_match.group(1).strip()

    # Website
    if not enriched.get("website"):
        website_match = re.search(
            r'href="(https?://(?!(?:www\.)?goodtherapy\.org|facebook\.com|'
            r'instagram\.com|twitter\.com|linkedin\.com|youtube\.com|'
            r'schema\.org|google)[^"]+)"[^>]*>\s*(?:Website|Visit)',
            html,
            re.IGNORECASE,
        )
        if website_match:
            enriched["website"] = website_match.group(1)
            enriched["email"] = _guess_email_from_website(enriched["website"])

    # License types
    if not enriched.get("license_types"):
        lt = _extract_license_types(html)
        if lt:
            enriched["license_types"] = lt
            enriched["primary_license"] = lt[0]

    # Specialties
    spec_section = re.search(
        r'(?:specialt|issues?\s+treated|areas?\s+of\s+expertise).*?'
        r'<(?:ul|div)[^>]*>(.*?)</(?:ul|div)>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if spec_section:
        specs = re.findall(r"<li[^>]*>([^<]+)</li>", spec_section.group(1))
        if specs:
            enriched["specialties"] = [s.strip().lower() for s in specs if s.strip()]

    return enriched


async def scrape_goodtherapy(
    state_code: str,
    city: str | None = None,
    needed: int = 30,
) -> list[dict]:
    """Scrape GoodTherapy for therapist candidates.

    Returns up to `needed` candidates as list[dict].
    """
    if not city:
        logger.info("GoodTherapy requires a city; skipping")
        return []

    # GoodTherapy URL pattern: /therapists/{state}/{city} (lowercase, hyphenated)
    state_name = _state_code_to_name(state_code)
    listing_url = (
        f"{_GT_BASE}/therapists/{_city_slug(state_name)}/{_city_slug(city)}"
    )

    candidates: list[dict] = []
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            html = await _http_get(listing_url, client, source_label="GoodTherapy")
            if not html:
                return []

            # Try JSON-LD first (most reliable)
            persons = _parse_goodtherapy_jsonld(html)
            if persons:
                for p in persons[:needed]:
                    card = _goodtherapy_person_to_card(p)
                    if card["name"]:
                        card.setdefault("city", city)
                        card.setdefault("state", state_code.upper())
                        candidates.append(card)
                logger.info("GoodTherapy JSON-LD: %d candidates for %s, %s",
                             len(candidates), city, state_code)
            else:
                # Fallback to HTML card parsing
                html_cards = _parse_goodtherapy_html_cards(html)
                logger.info("GoodTherapy HTML: %d cards for %s, %s",
                             len(html_cards), city, state_code)

                for card in html_cards[:needed]:
                    card["source"] = "goodtherapy"
                    card.setdefault("city", city)
                    card.setdefault("state", state_code.upper())
                    card.setdefault("email", "")
                    card.setdefault("phone", "")
                    card.setdefault("website", "")
                    card.setdefault("license_types", [])
                    card.setdefault("primary_license", "")
                    card.setdefault("specialties", [])

                    # Enrich from profile
                    if card.get("profile_url"):
                        await asyncio.sleep(REQUEST_DELAY_SEC)
                        profile_html = await _http_get(
                            card["profile_url"], client,
                            source_label="GoodTherapy",
                        )
                        if profile_html:
                            enriched = _parse_goodtherapy_profile(
                                profile_html, card,
                            )
                            card.update(enriched)

                    candidates.append(card)
                    if len(candidates) >= needed:
                        break

    except Exception:
        logger.exception(
            "GoodTherapy scrape failed for %s, %s", city, state_code,
        )

    logger.info("GoodTherapy: returning %d candidates", len(candidates))
    return candidates


# ── 3. Google Maps (Places API) ──────────────────────────────────────────────────


def _parse_name_for_licenses(business_name: str) -> list[str]:
    """Extract license suffixes from a Google Maps business name.

    Examples:
        "Jane Smith, LCSW" -> ["LCSW"]
        "Dr. John Doe PhD LMFT" -> ["LMFT", "PhD"]
    """
    return _extract_license_types(business_name)


def _extract_city_from_address(formatted_address: str) -> str:
    """Best-effort city extraction from a Google Places formatted address.

    Typical format: '123 Main St, Boise, ID 83702, USA'
    """
    parts = [p.strip() for p in formatted_address.split(",")]
    if len(parts) >= 3:
        return parts[-3]  # city is usually third from end
    if len(parts) >= 2:
        return parts[-2]
    return ""


def _extract_state_from_address(formatted_address: str) -> str:
    """Best-effort state code extraction from formatted address."""
    # Look for two-letter state code
    m = re.search(r"\b([A-Z]{2})\s+\d{5}", formatted_address)
    if m:
        return m.group(1)
    return ""


async def scrape_google_maps(
    state_code: str,
    city: str | None = None,
    needed: int = 30,
    presenting_issues: list[str] | None = None,
) -> list[dict]:
    """Search Google Maps for therapists using the Places API (New).

    This is the most reliable backup source since it uses an official API
    rather than HTML scraping. Returns up to `needed` candidates.
    """
    api_key = GOOGLE_PLACES_API_KEY
    if not api_key:
        logger.warning("Google Maps scraper: GOOGLE_PLACES_API_KEY not set")
        return []

    location_str = f"{city}, {state_code}" if city else state_code

    # Build search queries — use specialty terms if provided
    queries: list[str] = []
    if presenting_issues:
        for issue in presenting_issues[:3]:  # cap to avoid too many API calls
            queries.append(f"therapist {issue} {location_str}")
    if not queries:
        queries = [
            f"therapist {location_str}",
            f"mental health counselor {location_str}",
        ]

    candidates: list[dict] = []
    seen_place_ids: set[str] = set()

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
            for query in queries:
                if len(candidates) >= needed:
                    break

                try:
                    resp = await client.post(
                        f"{PLACES_BASE_URL}/places:searchText",
                        headers={
                            "Content-Type": "application/json",
                            "X-Goog-Api-Key": api_key,
                            "X-Goog-FieldMask": PLACES_SEARCH_FIELDS,
                        },
                        json={
                            "textQuery": query,
                            "maxResultCount": min(needed - len(candidates), 20),
                        },
                    )

                    if resp.status_code != 200:
                        logger.warning(
                            "Google Maps search '%s' -> HTTP %d: %s",
                            query, resp.status_code, resp.text[:200],
                        )
                        continue

                    places = (resp.json() or {}).get("places") or []

                except (httpx.TimeoutException, httpx.RequestError) as exc:
                    logger.warning(
                        "Google Maps search '%s' failed: %s", query, exc,
                    )
                    continue

                for place in places:
                    if len(candidates) >= needed:
                        break

                    place_id = place.get("id", "")
                    if place_id in seen_place_ids:
                        continue
                    seen_place_ids.add(place_id)

                    display_name = (
                        (place.get("displayName") or {}).get("text", "")
                    )
                    if not display_name:
                        continue

                    address = place.get("formattedAddress", "")
                    phone = place.get("internationalPhoneNumber", "")
                    website = place.get("websiteUri", "")
                    email = _guess_email_from_website(website)

                    license_types = _parse_name_for_licenses(display_name)
                    result_city = (
                        city or _extract_city_from_address(address)
                    )
                    result_state = (
                        state_code.upper()
                        or _extract_state_from_address(address)
                    )

                    location = place.get("location") or {}

                    candidates.append({
                        "name": display_name,
                        "email": email,
                        "phone": phone,
                        "license_types": license_types,
                        "primary_license": license_types[0] if license_types else "",
                        "specialties": [],
                        "city": result_city,
                        "state": result_state,
                        "website": website,
                        "profile_url": (
                            f"https://www.google.com/maps/place/"
                            f"?q=place_id:{place_id}"
                        ),
                        "source": "google_maps",
                        "lat": location.get("latitude"),
                        "lng": location.get("longitude"),
                    })

    except Exception:
        logger.exception(
            "Google Maps scrape failed for %s, %s", city, state_code,
        )

    logger.info("Google Maps: returning %d candidates", len(candidates))
    return candidates


# ── Combined function ────────────────────────────────────────────────────────────────

async def scrape_all_backup_sources(
    state_code: str,
    city: str | None = None,
    needed: int = 30,
    presenting_issues: list[str] | None = None,
) -> list[dict]:
    """Run all backup scrapers in parallel and return deduplicated candidates.

    Runs TherapyDen, GoodTherapy, and Google Maps concurrently. Deduplicates
    by name+city (case-insensitive), sorts by record completeness (candidates
    with both email AND phone rank higher), and returns up to `needed`.
    """
    # Run all three in parallel; each handles its own errors internally
    therapyden_task = asyncio.create_task(
        scrape_therapyden(state_code, city, needed),
    )
    goodtherapy_task = asyncio.create_task(
        scrape_goodtherapy(state_code, city, needed),
    )
    google_maps_task = asyncio.create_task(
        scrape_google_maps(state_code, city, needed, presenting_issues),
    )

    results = await asyncio.gather(
        therapyden_task, goodtherapy_task, google_maps_task,
        return_exceptions=True,
    )

    all_candidates: list[dict] = []
    source_names = ["TherapyDen", "GoodTherapy", "Google Maps"]
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.warning(
                "%s task raised an exception: %s", source_names[i], result,
            )
            continue
        if isinstance(result, list):
            all_candidates.extend(result)

    # Deduplicate by name+city (case-insensitive), keeping the first occurrence
    # (Google Maps results tend to be more complete, so order matters — but
    # we sort by completeness afterward anyway).
    seen_keys: set[str] = set()
    unique: list[dict] = []
    for c in all_candidates:
        key = _dedup_key(c)
        if key not in seen_keys:
            seen_keys.add(key)
            unique.append(c)

    # Sort by completeness (email + phone + website = higher rank)
    unique.sort(key=_completeness_score, reverse=True)

    final = unique[:needed]
    logger.info(
        "Backup sources combined: %d raw -> %d unique -> %d returned "
        "(TD=%s GT=%s GM=%s)",
        len(all_candidates),
        len(unique),
        len(final),
        sum(1 for c in final if c.get("source") == "therapyden"),
        sum(1 for c in final if c.get("source") == "goodtherapy"),
        sum(1 for c in final if c.get("source") == "google_maps"),
    )
    return final


# ── State code to name mapping (for GoodTherapy URLs) ────────────────────────────

_STATE_NAMES: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def _state_code_to_name(code: str) -> str:
    """Convert 'ID' -> 'Idaho'. Returns the code itself as fallback."""
    return _STATE_NAMES.get(code.upper(), code)
