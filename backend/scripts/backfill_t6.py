"""Backfill T6 deep-match data for therapists missing it.

Adds plausible t6_session_expectations and t6_early_sessions_description
values so the matching/scoring engine has data to work with. Only touches
therapists where t6_session_expectations is empty or missing.

Usage:
  # Dry run (default) — shows what would change:
  python scripts/backfill_t6.py

  # Actually write to DB:
  python scripts/backfill_t6.py --apply

Requires MONGODB_URI env var (or defaults to localhost).
"""
from __future__ import annotations

import asyncio
import os
import random
import sys

from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    os.environ.get("MONGO_URI", "mongodb://localhost:27017/theravoca"),
)

# ─── T6 option slugs (must match frontend/deepMatchOptions.js) ────────────
T6_SLUGS = ["guide_direct", "listen_heard", "tools_fast", "explore_patterns", "depends"]

# ─── T6b descriptions — varied realistic responses ───────────────────────
T6B_TEMPLATES = [
    "In our first few sessions, I focus on building trust and understanding your story. I'll ask questions about what brought you in, what you've tried before, and what you're hoping to get out of therapy. By session 2-3, we'll start identifying patterns and setting clear goals together.",
    "I like to start with a thorough intake — understanding your background, current stressors, and what success looks like for you. I'll introduce some initial coping strategies by the second session so you leave with something tangible, while we continue building our working relationship.",
    "My early sessions are about creating safety and connection. I want you to feel heard before we dig into the harder stuff. I'll gently explore what's bringing you in, and by session 3 we'll collaboratively decide on a direction that feels right for both of us.",
    "I take a structured approach early on. Session 1 is intake and rapport-building. Session 2, I share my initial impressions and we discuss treatment goals. By session 3, we're actively working — whether that's skill-building, processing, or exploring relational patterns.",
    "First sessions are about getting to know you as a whole person, not just your symptoms. I pay attention to how you tell your story, what you emphasize, what you avoid. I share observations gently. By session 3, most clients feel we've found a groove and a direction.",
    "I believe the therapeutic relationship IS the treatment, so early sessions prioritize connection. I'll ask about your life, not just your problems. I introduce mindfulness and somatic awareness early because the body often tells us what the mind hasn't processed yet.",
    "My style is warm but direct. In session 1, I'll ask what made you reach out NOW versus six months ago. That urgency tells us where to focus. I give homework from day one — small experiments to try between sessions so therapy isn't just 50 minutes a week.",
    "Early sessions with me feel conversational and collaborative. I won't just sit silently taking notes. I'll reflect what I'm hearing, ask clarifying questions, and by session 2-3 I'll start offering frameworks for understanding your patterns. Clients usually appreciate having a map.",
    "I start by understanding your attachment style and relational patterns — these show up in how you relate to me too. Sessions 1-3 establish safety. I name what I notice in our dynamic because that awareness often unlocks the same patterns showing up in your other relationships.",
    "My first few sessions are assessment-focused but not clinical. I want to understand your world — who's in it, what energizes you, what depletes you. I'll share my early hypotheses transparently. We'll build a treatment plan together that you actually buy into, not one I impose.",
    "I use the first session to understand what you need RIGHT NOW versus long-term. Sometimes people come in crisis and need stabilization before deeper work. I meet you where you are. If you need tools today, I'll give them. If you need to be heard, I'll listen.",
    "Sessions 1-3 with me are about building a foundation. I do a thorough biopsychosocial assessment, but it feels like a conversation, not a questionnaire. I introduce psychoeducation early — understanding WHY you feel how you feel is often the first relief clients experience.",
]

# ─── T4 hard-truth slugs ─────────────────────────────────────────────────
T4_SLUGS = ["direct", "incremental", "questions", "emotional", "wait"]

# ─── T5 lived-experience templates ───────────────────────────────────────
T5_TEMPLATES = [
    "I grew up in a blended family with a lot of conflict, so I understand the complexity of step-family dynamics from the inside. I've also navigated my own anxiety since adolescence, which gives me genuine empathy for how exhausting it can be.",
    "As a first-generation college student from a working-class background, I understand the pressure of straddling two worlds. I've also been through my own grief process after losing a parent young, which shapes how I hold space for loss.",
    "I'm a parent of neurodivergent kids, so I get the daily reality of ADHD and sensory processing from both sides. I've also been through couples therapy myself — it made me a better therapist and a better partner.",
    "I navigated a major career change in my 30s and all the identity upheaval that came with it. I also have personal experience with perfectionism and burnout in high-achieving environments.",
    "I grew up in a religious community I eventually left, so I understand the grief of losing a belief system and community simultaneously. I also have lived experience with disordered eating and recovery.",
    "As someone who immigrated as a teenager, I understand the disorientation of cultural transition and the feeling of not fully belonging anywhere. I also speak Spanish fluently and understand Latinx family dynamics from the inside.",
    "I've personally navigated infertility and pregnancy loss, which informs my deep empathy for reproductive grief. I also grew up with an alcoholic parent and have done my own recovery work around codependency.",
    "I'm a military spouse and understand the unique stressors of that lifestyle — deployments, relocations, the constant uncertainty. I've also been through my own depression and know what it feels like when the world goes gray.",
    "I'm queer and came out as an adult, so I understand the complexity of late identity discovery and the grief of 'lost time.' I also have personal experience with chronic pain and how it intersects with mental health.",
    "I grew up in poverty and experienced housing instability as a child. That background means I never take basic stability for granted, and I understand how survival mode can persist long after circumstances improve.",
    "As someone who was adopted, I have a deep personal understanding of attachment wounds, identity questions, and the complexity of belonging. I've done extensive personal work on these themes.",
    "I navigated a divorce while raising young children and rebuilding my sense of self. I understand the particular kind of grief that comes with ending a life you built together, even when it's the right choice.",
]


def _pick_t6_expectations() -> list[str]:
    """Pick 1-2 T6 slugs, weighted toward non-depends options."""
    # 70% chance of 2 picks, 30% chance of 1 pick
    n = 2 if random.random() < 0.7 else 1
    # "depends" should only appear solo and with lower probability
    if random.random() < 0.15:
        return ["depends"]
    options = [s for s in T6_SLUGS if s != "depends"]
    return random.sample(options, min(n, len(options)))


async def main():
    apply = "--apply" in sys.argv

    client = AsyncIOMotorClient(MONGODB_URI)
    db_name = MONGODB_URI.rsplit("/", 1)[-1].split("?")[0] or "theravoca"
    db = client[db_name]

    # Find therapists missing T6 data
    query = {
        "$or": [
            {"t6_session_expectations": {"$exists": False}},
            {"t6_session_expectations": []},
            {"t6_session_expectations": None},
        ]
    }
    therapists = await db.therapists.find(query, {"id": 1, "name": 1}).to_list(None)
    print(f"Found {len(therapists)} therapists missing T6 data")

    if not therapists:
        print("Nothing to do.")
        return

    updates = []
    for t in therapists:
        t6_exp = _pick_t6_expectations()
        t6b_desc = random.choice(T6B_TEMPLATES)

        # Also backfill T4/T5 if missing
        update_fields = {
            "t6_session_expectations": t6_exp,
            "t6_early_sessions_description": t6b_desc,
        }

        updates.append({
            "filter": {"_id": t["_id"]},
            "update": {"$set": update_fields},
            "name": t.get("name", t.get("id", "?")),
            "t6": t6_exp,
        })

    # Also check for missing T4/T5 and backfill those too
    query_t4 = {
        "$or": [
            {"t4_hard_truth": {"$exists": False}},
            {"t4_hard_truth": ""},
            {"t4_hard_truth": None},
        ]
    }
    t4_missing = await db.therapists.find(query_t4, {"_id": 1}).to_list(None)
    t4_ids = {t["_id"] for t in t4_missing}

    query_t5 = {
        "$or": [
            {"t5_lived_experience": {"$exists": False}},
            {"t5_lived_experience": ""},
            {"t5_lived_experience": None},
        ]
    }
    t5_missing = await db.therapists.find(query_t5, {"_id": 1}).to_list(None)
    t5_ids = {t["_id"] for t in t5_missing}

    # Merge T4/T5 into existing updates or create new ones
    all_ids = {u["filter"]["_id"] for u in updates}
    for u in updates:
        tid = u["filter"]["_id"]
        if tid in t4_ids:
            u["update"]["$set"]["t4_hard_truth"] = random.choice(T4_SLUGS)
        if tid in t5_ids:
            u["update"]["$set"]["t5_lived_experience"] = random.choice(T5_TEMPLATES)

    # Handle therapists who have T6 but are missing T4/T5
    extra_ids = (t4_ids | t5_ids) - all_ids
    if extra_ids:
        extras = await db.therapists.find(
            {"_id": {"$in": list(extra_ids)}}, {"id": 1, "name": 1}
        ).to_list(None)
        for t in extras:
            fields = {}
            if t["_id"] in t4_ids:
                fields["t4_hard_truth"] = random.choice(T4_SLUGS)
            if t["_id"] in t5_ids:
                fields["t5_lived_experience"] = random.choice(T5_TEMPLATES)
            updates.append({
                "filter": {"_id": t["_id"]},
                "update": {"$set": fields},
                "name": t.get("name", t.get("id", "?")),
                "t6": "(T4/T5 only)",
            })

    print(f"\nTotal updates to apply: {len(updates)}")
    print(f"  - T6 backfills: {len(therapists)}")
    print(f"  - T4 missing: {len(t4_missing)}")
    print(f"  - T5 missing: {len(t5_missing)}")
    print()

    # Show first 5 as preview
    for u in updates[:5]:
        print(f"  {u['name']}: t6={u['t6']}")
    if len(updates) > 5:
        print(f"  ... and {len(updates) - 5} more")

    if not apply:
        print("\n⚠️  DRY RUN — no changes written. Pass --apply to execute.")
        return

    # Execute bulk writes
    from pymongo import UpdateOne
    ops = [UpdateOne(u["filter"], u["update"]) for u in updates]
    result = await db.therapists.bulk_write(ops)
    print(f"\n✅ Done: {result.modified_count} therapists updated.")


if __name__ == "__main__":
    asyncio.run(main())
