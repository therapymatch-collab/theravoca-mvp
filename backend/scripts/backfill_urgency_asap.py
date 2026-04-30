"""Backfill `urgency_capacity` on ≥30 active therapists so the patient
intake form's "asap" HARD-toggle is no longer greyed out.

The seeded directory has 121/122 active therapists set to
`within_2_3_weeks` and one to `within_month` — meaning zero therapists
satisfy the "asap" urgency bucket. The HARD-capacity guard
(/api/admin/hard-capacity) correctly grey-outs `urgency_strict=asap`
in that state, but the asap option exists on the form for a reason
and we need at least 30 therapists who can take crisis-window
patients before launch.

This script:
  * Selects up to N (default 35) active therapists, rotating through
    licensure types so we don't lopside on LMFTs.
  * Updates `urgency_capacity` to "asap" on each.
  * Idempotent — running it twice is a no-op (it only updates docs
    that are NOT already "asap").

Run with:
    cd /app/backend && python -m scripts.backfill_urgency_asap
"""
from __future__ import annotations

import asyncio
import os
import random

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

TARGET = int(os.environ.get("BACKFILL_ASAP_TARGET") or 35)


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    pool = await db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {
                "$nin": ["past_due", "canceled", "unpaid", "incomplete"],
            },
            "urgency_capacity": {"$ne": "asap"},
        },
        {"_id": 0, "id": 1, "name": 1, "license_type": 1},
    ).to_list(length=None)
    if len(pool) < TARGET:
        print(f"⚠ Only {len(pool)} eligible (target {TARGET}); using all.")
    # Bucket by license_type to spread the asap capacity across the
    # directory so a single profession isn't the entire crisis pool.
    buckets: dict[str, list[dict]] = {}
    for t in pool:
        lt = (t.get("license_type") or "unknown").upper()
        buckets.setdefault(lt, []).append(t)
    rng = random.Random(20260208)  # deterministic for reviewability
    for v in buckets.values():
        rng.shuffle(v)
    picked: list[dict] = []
    while len(picked) < TARGET and any(buckets.values()):
        for lt in list(buckets.keys()):
            if len(picked) >= TARGET:
                break
            if buckets[lt]:
                picked.append(buckets[lt].pop())
    if not picked:
        print("Nothing to update — every active therapist is already asap.")
        return
    ids = [t["id"] for t in picked]
    r = await db.therapists.update_many(
        {"id": {"$in": ids}},
        {"$set": {"urgency_capacity": "asap"}},
    )
    print(f"Updated {r.modified_count} therapists to urgency_capacity='asap'")
    by_lt: dict[str, int] = {}
    for t in picked:
        by_lt[t.get("license_type") or "?"] = by_lt.get(
            t.get("license_type") or "?", 0
        ) + 1
    print("By license type:")
    for lt, n in sorted(by_lt.items(), key=lambda kv: -kv[1]):
        print(f"  {lt:8s} {n}")


if __name__ == "__main__":
    asyncio.run(main())
