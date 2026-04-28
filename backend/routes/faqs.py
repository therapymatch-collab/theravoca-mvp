"""FAQ admin: CRUD + ordered list of FAQ entries shown on the public
landing page (audience=patient) and the therapist signup page
(audience=therapist).

Public endpoint returns published rows ordered by `position`. Admin
endpoints support full CRUD + reorder.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, require_admin

router = APIRouter()

ALLOWED_AUDIENCES = {"patient", "therapist"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FaqIn(BaseModel):
    audience: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=400)
    answer: str = Field(..., min_length=1, max_length=4000)
    position: Optional[int] = None
    published: bool = True


class FaqUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    position: Optional[int] = None
    published: Optional[bool] = None


class ReorderIn(BaseModel):
    audience: str
    ids: list[str]


# ─── Public read ─────────────────────────────────────────────────────
@router.get("/faqs")
async def public_list_faqs(audience: str) -> dict[str, Any]:
    if audience not in ALLOWED_AUDIENCES:
        raise HTTPException(400, "invalid audience")
    rows = (
        await db.faqs.find(
            {"audience": audience, "published": {"$ne": False}}, {"_id": 0},
        )
        .sort("position", 1)
        .to_list(500)
    )
    return {"items": [{"q": r["question"], "a": r["answer"]} for r in rows]}


# ─── Admin CRUD ──────────────────────────────────────────────────────
@router.get("/admin/faqs", dependencies=[Depends(require_admin)])
async def admin_list_faqs(audience: Optional[str] = None) -> dict[str, Any]:
    q: dict[str, Any] = {}
    if audience:
        if audience not in ALLOWED_AUDIENCES:
            raise HTTPException(400, "invalid audience")
        q["audience"] = audience
    rows = (
        await db.faqs.find(q, {"_id": 0}).sort([("audience", 1), ("position", 1)]).to_list(500)
    )
    return {"items": rows}


@router.post("/admin/faqs", dependencies=[Depends(require_admin)])
async def admin_create_faq(payload: FaqIn) -> dict[str, Any]:
    if payload.audience not in ALLOWED_AUDIENCES:
        raise HTTPException(400, "invalid audience")
    # Auto-assign position to last+1 if not provided
    if payload.position is None:
        last = (
            await db.faqs.find({"audience": payload.audience}, {"_id": 0, "position": 1})
            .sort("position", -1)
            .limit(1)
            .to_list(1)
        )
        next_pos = (last[0]["position"] + 1) if last else 0
    else:
        next_pos = payload.position
    doc = {
        "id": str(uuid.uuid4()),
        "audience": payload.audience,
        "question": payload.question.strip(),
        "answer": payload.answer.strip(),
        "position": next_pos,
        "published": payload.published,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.faqs.insert_one(doc)
    return {"item": {k: v for k, v in doc.items() if k != "_id"}}


@router.put("/admin/faqs/{faq_id}", dependencies=[Depends(require_admin)])
async def admin_update_faq(faq_id: str, payload: FaqUpdate) -> dict[str, Any]:
    update: dict[str, Any] = {"updated_at": _now()}
    if payload.question is not None:
        update["question"] = payload.question.strip()
    if payload.answer is not None:
        update["answer"] = payload.answer.strip()
    if payload.position is not None:
        update["position"] = payload.position
    if payload.published is not None:
        update["published"] = payload.published
    res = await db.faqs.update_one({"id": faq_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "FAQ not found")
    row = await db.faqs.find_one({"id": faq_id}, {"_id": 0})
    return {"item": row}


@router.delete("/admin/faqs/{faq_id}", dependencies=[Depends(require_admin)])
async def admin_delete_faq(faq_id: str) -> dict[str, Any]:
    res = await db.faqs.delete_one({"id": faq_id})
    return {"deleted": res.deleted_count}


@router.put("/admin/faqs/reorder", dependencies=[Depends(require_admin)])
async def admin_reorder_faqs(payload: ReorderIn) -> dict[str, Any]:
    if payload.audience not in ALLOWED_AUDIENCES:
        raise HTTPException(400, "invalid audience")
    for idx, faq_id in enumerate(payload.ids):
        await db.faqs.update_one(
            {"id": faq_id, "audience": payload.audience},
            {"$set": {"position": idx, "updated_at": _now()}},
        )
    return {"reordered": len(payload.ids)}


@router.post("/admin/faqs/seed", dependencies=[Depends(require_admin)])
async def admin_seed_faqs() -> dict[str, Any]:
    """One-time helper — populates the collection from the legacy
    hardcoded lists if it's empty. Idempotent: if any rows already
    exist for an audience the seed for that audience is skipped."""
    seeded = {"patient": 0, "therapist": 0}
    PATIENT_SEED = [
        ("What is TheraVoca, and how does it work?",
         "TheraVoca turns what you need into a structured referral and connects you with therapists who are genuinely interested in helping. No long searching or guesswork on your end."),
        ("Is there a fee for patients?",
         "Nope, not during our pilot. Our goal is to prove value first. You'll never be billed without your explicit consent."),
        ("What happens after I submit my referral request?",
         "We send your anonymous referral to licensed therapists in your state. Within 24 hours, you receive a personalized list of therapists who have read your needs and want to work with you."),
        ("Will therapists know who I am right away?",
         "No. We only share anonymous details about your referral. You always stay in control of when and how you reveal your identity."),
        ("What if I don't feel good about my matches?",
         "We're here to help you explore other options at no added stress, including trying again."),
        ("Is TheraVoca available in my area?",
         "We are launching state by state. Currently live in Idaho. If we're not in your state, we'll add you to our waitlist."),
    ]
    THERAPIST_SEED = [
        ("How does TheraVoca find patients for me?",
         "Patients submit anonymous, structured referrals describing what they need. We score them against your specialties, payment options, and schedule, then notify you only when the match is ≥70%."),
        ("Do I have to commit to every referral?",
         "Never. Each match comes with the patient's full referral context — you opt in or pass with one click. No pressure, no minimums."),
        ("What about insurance?",
         "We don't credential you. You bill insurance the same way you do today (or stay cash-pay). We just route the right patients to you."),
        ("How private is my profile?",
         "Your contact info is hidden until you accept a referral. We never publish a public profile or sell your data."),
        ("How much does it cost?",
         "30-day free trial, then $45/month. Cancel anytime. No setup fees, no per-referral charges."),
    ]
    for audience, seed in [("patient", PATIENT_SEED), ("therapist", THERAPIST_SEED)]:
        existing = await db.faqs.count_documents({"audience": audience})
        if existing > 0:
            continue
        for idx, (q, a) in enumerate(seed):
            await db.faqs.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "audience": audience,
                    "question": q,
                    "answer": a,
                    "position": idx,
                    "published": True,
                    "created_at": _now(),
                    "updated_at": _now(),
                },
            )
            seeded[audience] += 1
    return {"seeded": seeded}
