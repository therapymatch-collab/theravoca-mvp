"""One-shot data-drift detector + fixer for therapist documents.

Finds therapists whose stored values fall outside the canonical
literal sets (urgency_capacity, modality_offering, client_types,
age_groups). Reports them and — when `--fix` is passed — coerces
each invalid value to the most-conservative valid bucket so the
matching engine can score the therapist correctly.

Run with:
    cd /app/backend && python -m scripts.detect_therapist_drift          # dry-run
    cd /app/backend && python -m scripts.detect_therapist_drift --fix    # apply
"""
from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

# Mirror the Pydantic Literals from models.py.
VALID = {
    "urgency_capacity": {
        "asap", "within_2_3_weeks", "within_month",
    },
    "modality_offering": {"telehealth", "in_person", "both"},
    "client_types": {"individual", "couples", "family", "group"},
    "age_groups": {"child", "teen", "young_adult", "adult", "older_adult"},
}

# Conservative coercion targets when a value is invalid — never widens
# capacity (e.g. drift "1_2_per_week" → "within_month", NOT "asap").
DEFAULTS = {
    "urgency_capacity": "within_month",
    "modality_offering": "both",
}


async def main() -> int:
    fix = "--fix" in sys.argv
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    issues: list[tuple[str, str, str, object]] = []  # (id, name, field, bad_value)
    async for t in db.therapists.find(
        {}, {"_id": 0, "id": 1, "name": 1, "urgency_capacity": 1, "modality_offering": 1, "client_types": 1, "age_groups": 1},
    ):
        for field, valid_set in VALID.items():
            v = t.get(field)
            if v is None:
                continue
            if isinstance(v, list):
                bad = [x for x in v if x not in valid_set]
                if bad:
                    issues.append((t["id"], t.get("name", ""), field, bad))
            else:
                if v not in valid_set:
                    issues.append((t["id"], t.get("name", ""), field, v))
    if not issues:
        print("✅ No therapist data drift detected.")
        return 0
    print(f"Found {len(issues)} drift issue(s):")
    for tid, name, field, bad in issues:
        print(f"  {tid[:8]}…  {name:32s}  {field} = {bad!r}")
    if not fix:
        print("\nRun with --fix to auto-coerce.")
        return 1
    fixed = 0
    for tid, _, field, bad in issues:
        if isinstance(bad, list):
            cleaned = [x for x in (await db.therapists.find_one({"id": tid})).get(field, []) if x in VALID[field]]
            await db.therapists.update_one({"id": tid}, {"$set": {field: cleaned}})
        else:
            await db.therapists.update_one({"id": tid}, {"$set": {field: DEFAULTS.get(field)}})
        fixed += 1
    print(f"✅ Fixed {fixed} therapist record(s).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
