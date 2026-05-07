"""One-time migration: rename TAI fields to Match Strength.

Renames:
  feedback.tai_score         -> feedback.match_strength_score
  feedback.tai_data          -> feedback.match_strength_data
  therapists.reliability.avg_tai            -> therapists.reliability.avg_match_strength
  therapists.reliability.tai_sample_count   -> therapists.reliability.match_strength_sample_count

Safe to re-run: $rename is a no-op if the source field doesn't exist.

Usage:
  MONGO_URI=mongodb+srv://... python scripts/migrate_tai_to_match_strength.py
  # or for staging:
  MONGO_URI=mongodb+srv://...staging... python scripts/migrate_tai_to_match_strength.py
"""
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    uri = os.environ.get("MONGO_URI")
    if not uri:
        print("ERROR: Set MONGO_URI env var.", file=sys.stderr)
        sys.exit(1)

    client = AsyncIOMotorClient(uri)
    db = client.get_default_database()

    print("Migrating feedback.tai_score -> feedback.match_strength_score ...")
    r1 = await db.feedback.update_many({}, {"$rename": {"tai_score": "match_strength_score"}})
    print(f"  modified: {r1.modified_count}")

    print("Migrating feedback.tai_data -> feedback.match_strength_data ...")
    r2 = await db.feedback.update_many({}, {"$rename": {"tai_data": "match_strength_data"}})
    print(f"  modified: {r2.modified_count}")

    print("Migrating therapists.reliability.avg_tai -> therapists.reliability.avg_match_strength ...")
    r3 = await db.therapists.update_many(
        {"reliability.avg_tai": {"$exists": True}},
        {"$rename": {"reliability.avg_tai": "reliability.avg_match_strength"}},
    )
    print(f"  modified: {r3.modified_count}")

    print("Migrating therapists.reliability.tai_sample_count -> therapists.reliability.match_strength_sample_count ...")
    r4 = await db.therapists.update_many(
        {"reliability.tai_sample_count": {"$exists": True}},
        {"$rename": {"reliability.tai_sample_count": "reliability.match_strength_sample_count"}},
    )
    print(f"  modified: {r4.modified_count}")

    print("\nDone. Verify by running:")
    print('  db.feedback.countDocuments({"tai_score": {"$exists": true}})  // should be 0')
    print('  db.feedback.countDocuments({"match_strength_score": {"$exists": true}})  // should be > 0')

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
