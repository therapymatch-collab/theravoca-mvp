"""One-time migration: copy all collections from staging → production.

DELETE THIS FILE after migration is complete.
"""
from __future__ import annotations

import os
import logging
from fastapi import APIRouter, Query
from motor.motor_asyncio import AsyncIOMotorClient

from deps import db, ADMIN_PASSWORD

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin-migrate"])

STAGING_URI = (
    "mongodb+srv://therapymatch_db_user:4D9du6pafjCZ8aR9"
    "@theravoca-staging.m7yhcjb.mongodb.net/theravoca"
    "?retryWrites=true&w=majority"
)


@router.post("/migrate-from-staging")
async def migrate_from_staging(password: str = Query(...)):
    """Pull all collections from theravoca-staging into this DB (production)."""
    if password != ADMIN_PASSWORD:
        return {"error": "unauthorized"}

    staging_client = AsyncIOMotorClient(STAGING_URI)
    sdb = staging_client["theravoca"]

    results = {}
    try:
        staging_cols = await sdb.list_collection_names()
        staging_cols = [c for c in staging_cols if not c.startswith("system.")]

        for col_name in staging_cols:
            s_col = sdb[col_name]
            p_col = db[col_name]

            s_count = await s_col.count_documents({})
            p_count = await p_col.count_documents({})

            if s_count == 0:
                results[col_name] = {"staging": 0, "skipped": True}
                continue

            # Clear production
            if p_count > 0:
                await p_col.delete_many({})

            # Copy all docs
            docs = await s_col.find({}).to_list(length=None)
            if docs:
                # Remove _id so MongoDB generates new ones (avoids duplicate key)
                # Actually keep _id to preserve references between collections
                await p_col.insert_many(docs)

            final_count = await p_col.count_documents({})
            results[col_name] = {
                "staging": s_count,
                "prod_before": p_count,
                "prod_after": final_count,
                "ok": final_count == s_count,
            }

        return {"status": "done", "collections": results}
    except Exception as e:
        logger.exception("Migration failed")
        return {"status": "error", "error": str(e), "partial": results}
    finally:
        staging_client.close()
