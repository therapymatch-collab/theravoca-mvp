"""Geocoding helper for TheraVoca.

Strategy:
- Pre-loaded coordinates for known Idaho cities (no API call needed for seed data)
- Nominatim (OpenStreetMap) fallback for unknown cities and ZIP codes (free, ~1 req/sec)
- DB cache (`geocache` collection) to avoid repeat lookups
- Haversine for distance calculation
"""
from __future__ import annotations

import asyncio
import logging
import math
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)


# Pre-loaded Idaho city coordinates (lat, lng) to skip Nominatim for seed data
KNOWN_CITY_GEOS: dict[str, tuple[float, float]] = {
    "boise": (43.6150, -116.2023),
    "meridian": (43.6121, -116.3915),
    "nampa": (43.5407, -116.5635),
    "idaho falls": (43.4917, -112.0339),
    "pocatello": (42.8713, -112.4455),
    "caldwell": (43.6629, -116.6874),
    "coeur d'alene": (47.6777, -116.7804),
    "twin falls": (42.5630, -114.4609),
    "lewiston": (46.4165, -117.0177),
    "post falls": (47.7180, -116.9514),
    "rexburg": (43.8260, -111.7897),
    "eagle": (43.6954, -116.3540),
    "kuna": (43.4924, -116.4201),
    "moscow": (46.7324, -117.0002),
    "ammon": (43.4836, -111.9647),
}

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "TheraVoca/1.0 (contact@theravoca.com)"
_nominatim_lock = asyncio.Lock()  # serialize Nominatim calls (their policy: 1 req/sec)


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in miles."""
    r_miles = 3958.7613
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r_miles * math.asin(math.sqrt(a))


async def _cached_lookup(db: AsyncIOMotorDatabase, key: str) -> Optional[tuple[float, float]]:
    rec = await db.geocache.find_one({"key": key}, {"_id": 0, "lat": 1, "lng": 1})
    if rec:
        return (rec["lat"], rec["lng"])
    return None


async def _cache_store(db: AsyncIOMotorDatabase, key: str, lat: float, lng: float, source: str) -> None:
    await db.geocache.update_one(
        {"key": key},
        {"$set": {"key": key, "lat": lat, "lng": lng, "source": source}},
        upsert=True,
    )


async def _nominatim_query(query: str, params_extra: dict[str, str]) -> Optional[tuple[float, float]]:
    params = {"format": "json", "limit": "1", **params_extra}
    headers = {"User-Agent": USER_AGENT}
    async with _nominatim_lock:
        await asyncio.sleep(1.05)  # respect Nominatim's 1 req/sec policy
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(NOMINATIM_URL, params=params, headers=headers)
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning("Nominatim error for %r: %s", query, e)
            return None
    if not data:
        return None
    try:
        return float(data[0]["lat"]), float(data[0]["lon"])
    except (KeyError, ValueError, IndexError):
        return None


async def geocode_city(db: AsyncIOMotorDatabase, city: str, state: str = "ID") -> Optional[tuple[float, float]]:
    """Return (lat, lng) for a city, using known map first, then cache, then Nominatim."""
    key_clean = (city or "").lower().strip()
    if not key_clean:
        return None
    if key_clean in KNOWN_CITY_GEOS:
        return KNOWN_CITY_GEOS[key_clean]
    cache_key = f"city:{key_clean}|{state.upper()}"
    cached = await _cached_lookup(db, cache_key)
    if cached:
        return cached
    result = await _nominatim_query(
        f"{city}, {state}, USA",
        {"city": city, "state": state, "country": "USA"},
    )
    if result:
        await _cache_store(db, cache_key, result[0], result[1], "nominatim")
    return result


async def geocode_zip(db: AsyncIOMotorDatabase, zip_code: str, country: str = "USA") -> Optional[tuple[float, float]]:
    key_clean = (zip_code or "").strip()
    if not key_clean:
        return None
    cache_key = f"zip:{key_clean}|{country}"
    cached = await _cached_lookup(db, cache_key)
    if cached:
        return cached
    result = await _nominatim_query(
        f"{zip_code}, {country}",
        {"postalcode": zip_code, "country": country},
    )
    if result:
        await _cache_store(db, cache_key, result[0], result[1], "nominatim")
    return result


async def geocode_offices(db: AsyncIOMotorDatabase, office_cities: list[str], state: str = "ID") -> list[dict]:
    """Return [{city, lat, lng}, ...] for each office city we can geocode."""
    out: list[dict] = []
    for city in office_cities or []:
        coords = await geocode_city(db, city, state)
        if coords:
            out.append({"city": city, "lat": coords[0], "lng": coords[1]})
    return out


async def min_distance_miles(
    patient_geo: Optional[tuple[float, float]],
    office_geos: list[dict],
) -> Optional[float]:
    if not patient_geo or not office_geos:
        return None
    distances = [
        haversine_miles(patient_geo[0], patient_geo[1], o["lat"], o["lng"])
        for o in office_geos
        if "lat" in o and "lng" in o
    ]
    return min(distances) if distances else None
