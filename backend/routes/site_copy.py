"""Site-copy admin: lets the marketing person tweak headline / subhead /
section copy on public-facing pages without a code deploy.

Stored in MongoDB collection `site_copy` keyed by a stable string key
(e.g. "landing.hero.headline"). Public reads are unauthenticated; writes
require admin.

Frontend usage: `useSiteCopy("landing.hero.headline", "Find the right…")`
returns the override if present, otherwise the fallback. The hook is
debounced + cached in-memory so the marketing edit takes ≤2s to appear.
"""
from __future__ import annotations

from typing import Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, require_admin

router = APIRouter()


class CopyEntry(BaseModel):
    key: str = Field(..., min_length=1, max_length=120)
    value: str = Field(..., max_length=20000)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Public read ─────────────────────────────────────────────────────
@router.get("/site-copy")
async def list_site_copy() -> dict[str, Any]:
    """Returns all overrides as `{key: value}`. Public — used by the
    React useSiteCopy() hook on every page render so we can't gate it."""
    rows = await db.site_copy.find({}, {"_id": 0}).to_list(2000)
    return {r["key"]: r["value"] for r in rows if "key" in r and "value" in r}


# ─── Admin CRUD ──────────────────────────────────────────────────────
@router.get("/admin/site-copy", dependencies=[Depends(require_admin)])
async def admin_list_site_copy() -> dict[str, Any]:
    rows = await db.site_copy.find({}, {"_id": 0}).sort("key", 1).to_list(2000)
    return {"rows": rows}


@router.put("/admin/site-copy", dependencies=[Depends(require_admin)])
async def admin_upsert_site_copy(entry: CopyEntry) -> dict[str, Any]:
    if not entry.key.strip():
        raise HTTPException(400, "key is required")
    await db.site_copy.update_one(
        {"key": entry.key},
        {
            "$set": {
                "key": entry.key,
                "value": entry.value,
                "updated_at": _now_iso(),
            }
        },
        upsert=True,
    )
    return {"key": entry.key, "value": entry.value}


@router.delete(
    "/admin/site-copy/{key}", dependencies=[Depends(require_admin)],
)
async def admin_delete_site_copy(key: str) -> dict[str, Any]:
    res = await db.site_copy.delete_one({"key": key})
    return {"deleted": res.deleted_count}
