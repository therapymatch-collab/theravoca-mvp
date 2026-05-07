"""Count requests with in-flight 3w surveys (results sent < 21 days ago)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    uri = os.environ.get("MONGO_URL") or os.environ.get("MONGO_URI")
    if not uri:
        print("ERROR: Set MONGO_URL env var.", file=sys.stderr)
        sys.exit(1)

    client = AsyncIOMotorClient(uri)
    db = client.get_default_database()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=21)).isoformat()

    count = await db.requests.count_documents({
        "results_sent_at": {"$ne": None, "$gt": cutoff},
        "followup_sent_3w": {"$exists": False},
    })
    print(count)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
