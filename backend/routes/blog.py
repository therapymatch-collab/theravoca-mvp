"""Blog routes — admin-only CRUD plus public list/detail.

Storage: simple `blog_posts` collection. Posts are stored as Markdown so
the marketing person can write naturally without learning HTML; the
public BlogPost frontend renders the markdown via a tiny renderer.

Slugs are auto-generated from titles but can be overridden by the
admin. We never reuse a slug — if a clash happens we suffix an
incrementing number so old links never break.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from deps import db, require_admin
from helpers import _now_iso

router = APIRouter()


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    text = (text or "").lower().strip()
    text = _SLUG_RE.sub("-", text)
    return text.strip("-")[:80] or "post"


async def _ensure_unique_slug(base: str, exclude_id: Optional[str] = None) -> str:
    """Append `-2`, `-3` etc. when the candidate already exists. Skips the
    excluded id (used during update so a post can keep its own slug)."""
    candidate = base
    n = 2
    while True:
        q: dict[str, Any] = {"slug": candidate}
        if exclude_id is not None:
            q["id"] = {"$ne": exclude_id}
        if not await db.blog_posts.find_one(q):
            return candidate
        candidate = f"{base}-{n}"
        n += 1


# ─── Admin endpoints ─────────────────────────────────────────────────────────
@router.get("/admin/blog")
async def admin_list_posts(_: bool = Depends(require_admin)):
    """All posts including drafts. Newest first."""
    rows = await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"posts": rows, "total": len(rows)}


@router.get("/admin/blog/{post_id}")
async def admin_get_post(post_id: str, _: bool = Depends(require_admin)):
    doc = await db.blog_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc


@router.post("/admin/blog")
async def admin_create_post(payload: dict, _: bool = Depends(require_admin)):
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Title is required")
    body = payload.get("body_markdown") or ""
    summary = (payload.get("summary") or "").strip()
    hero = (payload.get("hero_image_url") or "").strip()
    slug_override = (payload.get("slug") or "").strip()
    published = bool(payload.get("published", False))
    base_slug = _slugify(slug_override or title)
    slug = await _ensure_unique_slug(base_slug)
    now = _now_iso()
    post = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "title": title,
        "summary": summary,
        "body_markdown": body,
        "hero_image_url": hero,
        "published": published,
        "published_at": now if published else None,
        "created_at": now,
        "updated_at": now,
    }
    await db.blog_posts.insert_one(post)
    post.pop("_id", None)
    return post


@router.put("/admin/blog/{post_id}")
async def admin_update_post(
    post_id: str, payload: dict, _: bool = Depends(require_admin)
):
    existing = await db.blog_posts.find_one({"id": post_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Post not found")
    update: dict[str, Any] = {"updated_at": _now_iso()}
    for k in ("title", "summary", "body_markdown", "hero_image_url"):
        if k in payload:
            update[k] = payload[k]
    if "slug" in payload:
        update["slug"] = await _ensure_unique_slug(_slugify(payload["slug"]), post_id)
    elif "title" in payload and not existing.get("slug"):
        update["slug"] = await _ensure_unique_slug(_slugify(payload["title"]), post_id)
    if "published" in payload:
        update["published"] = bool(payload["published"])
        # Only stamp published_at the first time it goes live; preserve
        # the original publish date on subsequent edits.
        if update["published"] and not existing.get("published_at"):
            update["published_at"] = _now_iso()
    await db.blog_posts.update_one({"id": post_id}, {"$set": update})
    return await db.blog_posts.find_one({"id": post_id}, {"_id": 0})


@router.delete("/admin/blog/{post_id}")
async def admin_delete_post(post_id: str, _: bool = Depends(require_admin)):
    res = await db.blog_posts.delete_one({"id": post_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Post not found")
    return {"ok": True}


# ─── Public endpoints ────────────────────────────────────────────────────────
@router.get("/blog")
async def public_list_posts():
    rows = await db.blog_posts.find(
        {"published": True},
        {"_id": 0, "body_markdown": 0},  # body lives on the detail endpoint
    ).sort("published_at", -1).to_list(200)
    return {"posts": rows, "total": len(rows)}


@router.get("/blog/{slug}")
async def public_get_post(slug: str):
    doc = await db.blog_posts.find_one({"slug": slug, "published": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc
