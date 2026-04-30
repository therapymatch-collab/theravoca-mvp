"""One-off backfill — embed `t5_lived_experience` and `t2_progress_story`
for every active therapist that has the text but not the cached vector.

Without these embeddings, both Contextual Resonance (deep-match V2) and
the new `other_issue` soft bonus silently no-op for nearly every match.
This script is idempotent: it skips therapists whose embeddings already
exist, so we can safely re-run after a seed re-load.
"""
from __future__ import annotations
import asyncio
import sys

sys.path.insert(0, "/app/backend")

from deps import db  # noqa: E402
from embeddings import embed_text  # noqa: E402


async def main() -> None:
    cur = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "$or": [
                {"t5_lived_experience": {"$exists": True, "$ne": ""}},
                {"t2_progress_story": {"$exists": True, "$ne": ""}},
            ],
        },
        {
            "_id": 0, "id": 1, "name": 1,
            "t5_lived_experience": 1, "t5_embedding": 1,
            "t2_progress_story": 1, "t2_embedding": 1,
        },
    )
    n_t5 = n_t2 = n_skip = 0
    async for t in cur:
        update: dict = {}
        t5 = (t.get("t5_lived_experience") or "").strip()
        t2 = (t.get("t2_progress_story") or "").strip()
        if t5 and not t.get("t5_embedding"):
            v = await embed_text(t5)
            if v:
                update["t5_embedding"] = v
                n_t5 += 1
        if t2 and not t.get("t2_embedding"):
            v = await embed_text(t2)
            if v:
                update["t2_embedding"] = v
                n_t2 += 1
        if update:
            await db.therapists.update_one({"id": t["id"]}, {"$set": update})
            print(f"  embedded {t['name'][:40]}: keys={list(update.keys())}")
        else:
            n_skip += 1
    print(f"\n[done] t5 embedded: {n_t5}  ·  t2 embedded: {n_t2}  ·  skipped: {n_skip}")


if __name__ == "__main__":
    asyncio.run(main())
