"""Google Places API (New) client.

Two operations only:
1. `search_therapist_business(name, city, state)` — Text Search to find a
   real Google Business Profile for this therapist. Cheap (Essentials SKU).
2. `get_place_reviews(place_id)` — Place Details with reviews + rating.
   Enterprise+Atmosphere SKU — only call after a high-confidence match.

We use httpx (already installed) and the field-mask pattern to keep cost low.

Reference: integration_playbook_expert_v2 (Iter-45 playbook).
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("theravoca.places_client")

API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
BASE_URL = "https://places.googleapis.com/v1"

# ── Field masks (lowest cost that still gets us what we need) ────────────────
SEARCH_FIELDS = (
    "places.id,places.displayName,places.formattedAddress,"
    "places.types,places.location"
)
DETAILS_FIELDS = (
    "id,displayName,formattedAddress,rating,userRatingCount,"
    "reviews,websiteUri,internationalPhoneNumber"
)


def is_configured() -> bool:
    return bool(API_KEY)


async def search_therapist_business(
    name: str, city: str, state: str = "ID",
) -> dict[str, Any] | None:
    """Find the most likely Google Business Profile for this therapist.

    Returns the raw place dict (id, displayName, formattedAddress) or None
    if nothing matches. We constrain the query to "therapist|counselor|
    psychotherapist" so we don't accidentally match a non-therapy business
    with the same name.
    """
    if not API_KEY:
        return None
    name = (name or "").strip()
    if not name:
        return None
    query = f"{name} therapist {city}, {state}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{BASE_URL}/places:searchText",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": API_KEY,
                    "X-Goog-FieldMask": SEARCH_FIELDS,
                },
                json={"textQuery": query, "maxResultCount": 3},
            )
            if resp.status_code != 200:
                logger.warning("Places search %s — HTTP %s: %s",
                               name, resp.status_code, resp.text[:200])
                return None
            places = (resp.json() or {}).get("places") or []
    except (httpx.TimeoutException, httpx.RequestError) as e:
        logger.warning("Places search network error for %s: %s", name, e)
        return None

    if not places:
        return None
    # First result is highest-confidence; we'll trust Google's ranking but
    # filter out any place whose display name doesn't share a token with
    # the therapist's last name, to avoid false matches.
    last = name.split(",")[0].split()[-1].lower() if name else ""
    for p in places:
        display = ((p.get("displayName") or {}).get("text") or "").lower()
        if last and last in display:
            return p
    # Fallback: top result, even if name match is weak.
    return places[0]


async def get_place_reviews(place_id: str) -> dict[str, Any] | None:
    """Fetch reviews + rating for a known place_id."""
    if not API_KEY or not place_id:
        return None
    pid = place_id.replace("places/", "")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{BASE_URL}/places/{pid}",
                headers={
                    "X-Goog-Api-Key": API_KEY,
                    "X-Goog-FieldMask": DETAILS_FIELDS,
                },
            )
            if resp.status_code != 200:
                logger.warning("Places details %s — HTTP %s: %s",
                               pid, resp.status_code, resp.text[:200])
                return None
            return resp.json()
    except (httpx.TimeoutException, httpx.RequestError) as e:
        logger.warning("Places details network error for %s: %s", pid, e)
        return None


async def lookup_therapist_reviews(
    name: str, city: str, state: str = "ID",
) -> dict[str, Any] | None:
    """Two-call workflow: search → details. Returns a normalized dict ready
    to write to `therapists.review_*` fields, or None if no match found."""
    place = await search_therapist_business(name, city, state)
    if not place:
        return None
    pid = place.get("id") or (place.get("name") or "").replace("places/", "")
    if not pid:
        return None
    details = await get_place_reviews(pid)
    if not details:
        return None

    rating = details.get("rating")
    count = details.get("userRatingCount") or 0
    raw_reviews = details.get("reviews") or []
    if rating is None or count == 0:
        return {
            "found": False,
            "place_id": pid,
            "place_name": (details.get("displayName") or {}).get("text", ""),
            "address": details.get("formattedAddress", ""),
            "website": details.get("websiteUri", ""),
            "phone": details.get("internationalPhoneNumber", ""),
        }
    sources = [{
        "platform": "Google",
        "rating": float(rating),
        "count": int(count),
        "url": f"https://www.google.com/maps/place/?q=place_id:{pid}",
    }]
    return {
        "found": True,
        "place_id": pid,
        "place_name": (details.get("displayName") or {}).get("text", ""),
        "address": details.get("formattedAddress", ""),
        "website": details.get("websiteUri", ""),
        "phone": details.get("internationalPhoneNumber", ""),
        "review_avg": round(float(rating), 2),
        "review_count": int(count),
        "review_sources": sources,
        "raw_reviews": raw_reviews,
    }
