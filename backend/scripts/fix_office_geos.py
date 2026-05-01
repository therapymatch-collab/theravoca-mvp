"""
Fix therapist office_geos for proper geocoding.

Many seed therapists have office_locations (city names) but no
office_geos (lat/lng coordinates). This script:
1. Finds therapists with office_locations but missing/empty office_geos
2. Geocodes their cities using the existing geocoding module
3. Updates office_geos so the 30-mile matching filter works properly

Usage:
    python scripts/fix_office_geos.py          # dry-run
    python scripts/fix_office_geos.py --apply  # write to DB

Requires MONGO_URL and DB_NAME env vars.
"""
from __future__ import annotations

import asyncio
import os
import sys

# Add backend to path so we can import geocoding
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "theravoca")


async def fix_geos(apply: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Import geocoding after we have the db connection
    from geocoding import geocode_city, geocode_offices, KNOWN_CITY_GEOS

    # Find therapists who need geocoding
    query = {
        "is_active": {"$ne": False},
        "$or": [
            # Has office_locations but no office_geos
            {
                "office_locations": {"$exists": True, "$ne": []},
                "$or": [
                    {"office_geos": {"$exists": False}},
                    {"office_geos": []},
                    {"office_geos": None},
                ],
            },
            # Has office_addresses but no office_geos
            {
                "office_addresses": {"$exists": True, "$ne": []},
                "$or": [
                    {"office_geos": {"$exists": False}},
                    {"office_geos": []},
                    {"office_geos": None},
                ],
            },
            # Modality is in_person or both but has no office data at all
            {
                "modality_offering": {"$in": ["in_person", "both"]},
                "$or": [
                    {"office_geos": {"$exists": False}},
                    {"office_geos": []},
                    {"office_geos": None},
                ],
            },
        ],
    }

    cursor = db.therapists.find(
        query,
        {
            "_id": 0, "id": 1, "name": 1, "email": 1,
            "office_locations": 1, "office_addresses": 1,
            "office_geos": 1, "modality_offering": 1,
        },
    )

    therapists = await cursor.to_list(500)
    print(f"Found {len(therapists)} therapists needing office geocoding\n")

    fixed = 0
    failed = 0
    for t in therapists:
        # Try to extract cities from office_addresses first, then office_locations
        cities = []
        for addr in (t.get("office_addresses") or []):
            # Format: "123 W Main St, Boise, ID 83702"
            parts = addr.split(",")
            if len(parts) >= 2:
                city = parts[1].strip()
                # Strip state/zip if included
                city = city.replace(" ID ", " ").strip()
                for suffix in [" ID", " Idaho"]:
                    if city.endswith(suffix):
                        city = city[:-len(suffix)].strip()
                # Strip zip codes
                import re
                city = re.sub(r"\s*\d{5}(-\d{4})?\s*$", "", city).strip()
                if city:
                    cities.append(city)

        if not cities:
            cities = list(t.get("office_locations") or [])

        if not cities:
            # If they're in-person/both but have no location data, try their bio
            # or just flag them
            print(f"  SKIP {t['name']} ({t['email']}) — no office locations or addresses to geocode")
            failed += 1
            continue

        # Geocode each city
        geos = await geocode_offices(db, cities, state="ID")

        if not geos:
            print(f"  FAIL {t['name']} ({t['email']}) — could not geocode: {cities}")
            failed += 1
            continue

        if apply:
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {
                    "office_geos": geos,
                    # Also ensure office_locations is populated for backwards compat
                    "office_locations": cities,
                }},
            )
            print(f"  FIXED {t['name']} — {len(geos)} office(s): {[g['city'] for g in geos]}")
        else:
            print(f"  [DRY RUN] {t['name']} — would set {len(geos)} office(s): {[g['city'] for g in geos]}")

        fixed += 1

    action = "Fixed" if apply else "Would fix"
    print(f"\n{action} {fixed} therapists, skipped {failed}.")

    # Also report known-good cities for reference
    print(f"\nKnown Idaho cities (no API call needed): {sorted(KNOWN_CITY_GEOS.keys())}")

    if not apply and fixed > 0:
        print("\nRun with --apply to write changes to the database.")

    client.close()


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(fix_geos(apply))
