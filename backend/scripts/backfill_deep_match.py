"""
Backfill deep-match T1–T5 fields for seed therapists who don't have them.

Generates realistic fake data based on each therapist's existing profile
(specialties, modalities, bio, style_tags). Marks each record with
`_deep_match_backfilled: true` so admin can track which answers are
synthetic and surface them as "incomplete" fields once fake data is removed.

Usage:
    python scripts/backfill_deep_match.py          # dry-run (prints, doesn't write)
    python scripts/backfill_deep_match.py --apply  # actually writes to DB

Requires MONGO_URL and DB_NAME env vars (or defaults to local dev).
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import random
import sys

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "theravoca")

# ─── Deep-match option slugs ────────────────────────────────────────────
T1_SLUGS = [
    "leads_structured", "follows_lead", "challenges",
    "warm_first", "direct_honest", "guides_questions",
]
T3_SLUGS = [
    "deep_emotional", "practical_tools", "explore_past",
    "focus_forward", "build_insight", "shift_relationships",
]
T4_SLUGS = ["direct", "incremental", "questions", "emotional", "wait"]

# ─── Profile-to-style mapping ──────────────────────────────────────────
# Maps specialties/modalities/style_tags to likely T1 rankings and T4 style
_SPECIALTY_STYLE_MAP = {
    # Directive / structured specialties
    "CBT": {"t1_bias": ["leads_structured", "direct_honest", "challenges"], "t4": "direct"},
    "DBT": {"t1_bias": ["leads_structured", "warm_first", "guides_questions"], "t4": "incremental"},
    "EMDR": {"t1_bias": ["leads_structured", "guides_questions", "warm_first"], "t4": "emotional"},
    "Behavioral Therapy": {"t1_bias": ["leads_structured", "direct_honest", "challenges"], "t4": "direct"},
    # Exploratory / relational specialties
    "Psychodynamic": {"t1_bias": ["guides_questions", "follows_lead", "challenges"], "t4": "questions"},
    "Psychoanalytic": {"t1_bias": ["guides_questions", "follows_lead", "challenges"], "t4": "questions"},
    "Existential": {"t1_bias": ["guides_questions", "challenges", "direct_honest"], "t4": "questions"},
    "Humanistic": {"t1_bias": ["warm_first", "follows_lead", "guides_questions"], "t4": "emotional"},
    "Person-Centered": {"t1_bias": ["warm_first", "follows_lead", "guides_questions"], "t4": "emotional"},
    "Rogerian": {"t1_bias": ["warm_first", "follows_lead", "guides_questions"], "t4": "wait"},
    # Trauma-focused
    "Trauma-Focused": {"t1_bias": ["warm_first", "guides_questions", "leads_structured"], "t4": "incremental"},
    "Somatic": {"t1_bias": ["warm_first", "guides_questions", "follows_lead"], "t4": "emotional"},
    # Solution/brief
    "Solution-Focused": {"t1_bias": ["direct_honest", "leads_structured", "challenges"], "t4": "direct"},
    "Brief Therapy": {"t1_bias": ["direct_honest", "leads_structured", "challenges"], "t4": "direct"},
    # Integrative / eclectic
    "Integrative": {"t1_bias": ["guides_questions", "warm_first", "challenges"], "t4": "questions"},
    "Eclectic": {"t1_bias": ["guides_questions", "warm_first", "challenges"], "t4": "questions"},
    # Family / systemic
    "Family Systems": {"t1_bias": ["guides_questions", "leads_structured", "warm_first"], "t4": "incremental"},
    "Gottman": {"t1_bias": ["leads_structured", "direct_honest", "warm_first"], "t4": "direct"},
    "EFT": {"t1_bias": ["warm_first", "guides_questions", "follows_lead"], "t4": "emotional"},
    # Mindfulness
    "Mindfulness-Based": {"t1_bias": ["follows_lead", "warm_first", "guides_questions"], "t4": "wait"},
    "ACT": {"t1_bias": ["guides_questions", "warm_first", "challenges"], "t4": "questions"},
}

# T3 preferences based on specialty
_SPECIALTY_T3_MAP = {
    "CBT": ["practical_tools", "focus_forward"],
    "DBT": ["practical_tools", "build_insight"],
    "EMDR": ["deep_emotional", "explore_past"],
    "Psychodynamic": ["explore_past", "build_insight"],
    "Psychoanalytic": ["explore_past", "build_insight"],
    "Trauma-Focused": ["deep_emotional", "explore_past"],
    "Solution-Focused": ["practical_tools", "focus_forward"],
    "Humanistic": ["build_insight", "shift_relationships"],
    "Person-Centered": ["deep_emotional", "build_insight"],
    "Family Systems": ["shift_relationships", "build_insight"],
    "EFT": ["deep_emotional", "shift_relationships"],
    "ACT": ["build_insight", "focus_forward"],
    "Mindfulness-Based": ["build_insight", "deep_emotional"],
    "Existential": ["build_insight", "explore_past"],
    "Integrative": ["build_insight", "practical_tools"],
}

# ─── T2/T5 text generators ──────────────────────────────────────────────
_T2_TEMPLATES = [
    "I worked with a {age} client dealing with {issue} who had been in and out of therapy for years without real progress. Through {approach}, we gradually built a foundation of trust and self-awareness. Over about {months} months, they began recognizing their patterns and developing healthier coping strategies. The turning point came when they started applying what they learned in sessions to their daily relationships. By the end of our work together, they reported feeling more confident and connected than they had in years.",
    "One client stands out — a {age} person who came in overwhelmed by {issue}. They were skeptical about therapy and had tried other approaches without success. Using {approach}, we focused on practical tools they could use between sessions. Week by week, small shifts added up. After {months} months, they told me they finally felt like themselves again. What I remember most is the session where they said, 'I don't just cope anymore — I actually feel okay.'",
    "A {age} client came to me after years of struggling with {issue}. They had almost given up on therapy. We used {approach}, starting slowly to build trust. The real progress happened when they began connecting their current struggles to earlier experiences and could see the thread clearly. Over {months} months of consistent work, they developed a strong sense of self and healthier boundaries. Their relationships improved dramatically, and they gained a resilience I could see growing in real time.",
]

_T5_TEMPLATES = [
    "I understand {experience1} from the inside — it shaped how I show up in the therapy room. I also bring personal experience with {experience2}, which helps me connect with clients navigating similar challenges without judgment. These aren't just things I've read about; they're part of my lived story.",
    "My own journey through {experience1} gives me a depth of understanding that goes beyond clinical training. I've also navigated {experience2} in my personal life, which informs how I hold space for clients going through the same. I believe my own healing work makes me a more effective and authentic therapist.",
    "I bring firsthand experience with {experience1} to my practice. I've also walked through {experience2} myself, which gives me a genuine empathy for clients in those spaces. I don't pretend to know everything, but I know what it's like to sit in discomfort and find a way through.",
]

_EXPERIENCES = [
    "career transitions and finding purpose in work",
    "navigating family dynamics in a blended family",
    "managing anxiety and learning to live with uncertainty",
    "the grief of losing a parent and rebuilding after loss",
    "growing up in a rural community and feeling like an outsider",
    "parenting challenges and the pressure to get it right",
    "living with a chronic health condition",
    "immigration and cultural identity questions",
    "religious upbringing and evolving spiritual beliefs",
    "recovery from burnout and learning healthy boundaries",
    "being a first-generation college student",
    "navigating relationships across cultural differences",
    "growing up in a high-conflict household",
    "balancing caregiving responsibilities with personal needs",
    "midlife transitions and questioning life direction",
]

_ISSUE_NAMES = {
    "anxiety": "anxiety", "depression": "depression", "trauma": "trauma",
    "ptsd": "PTSD", "ocd": "OCD", "adhd": "ADHD",
    "grief": "grief and loss", "relationship": "relationship difficulties",
    "couples": "couples conflict", "family": "family dynamics",
    "substance": "substance use", "addiction": "addiction",
    "eating": "disordered eating", "self_esteem": "low self-esteem",
    "stress": "chronic stress", "anger": "anger management",
    "bipolar": "mood instability", "personality": "personality patterns",
}

_APPROACHES = [
    "a blend of CBT and mindfulness techniques",
    "psychodynamic exploration and relational work",
    "EMDR and trauma-focused interventions",
    "DBT skills training and emotional regulation work",
    "solution-focused techniques combined with deeper exploration",
    "a person-centered approach with practical coping strategies",
    "ACT (Acceptance and Commitment Therapy) principles",
    "integrative methods tailored to their needs",
]


def _seed_rng(therapist_id: str) -> random.Random:
    """Deterministic RNG per therapist so re-runs produce the same data."""
    seed = int(hashlib.md5(therapist_id.encode()).hexdigest()[:8], 16)
    return random.Random(seed)


def _generate_t1(rng: random.Random, therapist: dict) -> list[str]:
    """Generate a T1 ranking (all 6 slugs in ranked order) based on profile."""
    modalities = therapist.get("modalities") or []
    specialties = (therapist.get("primary_specialties") or []) + (
        therapist.get("secondary_specialties") or []
    )
    style_tags = therapist.get("style_tags") or []

    # Start with biases from specialties
    score = {s: 0.0 for s in T1_SLUGS}
    for spec in specialties + modalities:
        mapped = _SPECIALTY_STYLE_MAP.get(spec)
        if mapped:
            for i, slug in enumerate(mapped["t1_bias"]):
                score[slug] += 3 - i  # first gets 3, second 2, third 1

    # Add small random noise
    for slug in T1_SLUGS:
        score[slug] += rng.uniform(0, 1)

    # Sort by score descending = highest ranked first
    ranked = sorted(T1_SLUGS, key=lambda s: score[s], reverse=True)
    return ranked


def _generate_t3(rng: random.Random, therapist: dict) -> list[str]:
    """Generate T3 picks (2 of 6 slugs)."""
    specialties = (therapist.get("primary_specialties") or []) + (
        therapist.get("secondary_specialties") or []
    ) + (therapist.get("modalities") or [])

    for spec in specialties:
        if spec in _SPECIALTY_T3_MAP:
            return list(_SPECIALTY_T3_MAP[spec])

    # Fallback: random 2
    return rng.sample(T3_SLUGS, 2)


def _generate_t4(rng: random.Random, therapist: dict) -> str:
    """Generate T4 pick (1 slug)."""
    specialties = (therapist.get("primary_specialties") or []) + (
        therapist.get("secondary_specialties") or []
    ) + (therapist.get("modalities") or [])

    for spec in specialties:
        mapped = _SPECIALTY_STYLE_MAP.get(spec)
        if mapped:
            return mapped["t4"]

    return rng.choice(T4_SLUGS)


def _generate_t2(rng: random.Random, therapist: dict) -> str:
    """Generate T2 progress story based on specialties."""
    specialties = (therapist.get("primary_specialties") or []) + (
        therapist.get("secondary_specialties") or []
    )
    general = therapist.get("general_treats") or []

    # Pick an issue from their specialty
    issue = "persistent anxiety and self-doubt"
    for spec in general + specialties:
        for key, name in _ISSUE_NAMES.items():
            if key in spec.lower():
                issue = name
                break

    approach = rng.choice(_APPROACHES)
    age_group = rng.choice(["young adult", "middle-aged", "adult"])
    months = rng.choice(["4", "6", "8", "10", "5", "7"])
    template = rng.choice(_T2_TEMPLATES)

    return template.format(
        age=age_group, issue=issue, approach=approach, months=months,
    )


def _generate_t5(rng: random.Random, therapist: dict) -> str:
    """Generate T5 lived experience."""
    experiences = list(_EXPERIENCES)
    rng.shuffle(experiences)
    exp1 = experiences[0]
    exp2 = experiences[1]
    template = rng.choice(_T5_TEMPLATES)
    return template.format(experience1=exp1, experience2=exp2)


async def backfill(apply: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Find therapists missing deep match data
    query = {
        "is_active": {"$ne": False},
        "$or": [
            {"t1_stuck_ranked": {"$exists": False}},
            {"t1_stuck_ranked": {"$size": 0}},
            {"t1_stuck_ranked": []},
            {"t2_progress_story": {"$in": ["", None]}},
            {"t2_progress_story": {"$exists": False}},
            {"t3_breakthrough": {"$exists": False}},
            {"t3_breakthrough": {"$size": 0}},
            {"t3_breakthrough": []},
            {"t4_hard_truth": {"$in": ["", None]}},
            {"t4_hard_truth": {"$exists": False}},
            {"t5_lived_experience": {"$in": ["", None]}},
            {"t5_lived_experience": {"$exists": False}},
        ],
    }

    cursor = db.therapists.find(
        query,
        {
            "_id": 0, "id": 1, "name": 1, "email": 1,
            "primary_specialties": 1, "secondary_specialties": 1,
            "general_treats": 1, "modalities": 1, "style_tags": 1,
            "bio": 1, "office_locations": 1, "office_addresses": 1,
            "t1_stuck_ranked": 1, "t2_progress_story": 1,
            "t3_breakthrough": 1, "t4_hard_truth": 1,
            "t5_lived_experience": 1,
        },
    )

    therapists = await cursor.to_list(500)
    print(f"Found {len(therapists)} therapists needing deep match backfill")

    updated = 0
    for t in therapists:
        rng = _seed_rng(t["id"])

        # Only generate what's missing
        update = {}
        missing_fields = []

        existing_t1 = t.get("t1_stuck_ranked") or []
        if len(existing_t1) < 5:
            update["t1_stuck_ranked"] = _generate_t1(rng, t)
            missing_fields.append("t1_stuck_ranked")

        existing_t2 = (t.get("t2_progress_story") or "").strip()
        if len(existing_t2) < 50:
            update["t2_progress_story"] = _generate_t2(rng, t)
            missing_fields.append("t2_progress_story")

        existing_t3 = t.get("t3_breakthrough") or []
        if len(existing_t3) < 2:
            update["t3_breakthrough"] = _generate_t3(rng, t)
            missing_fields.append("t3_breakthrough")

        existing_t4 = (t.get("t4_hard_truth") or "").strip()
        if not existing_t4:
            update["t4_hard_truth"] = _generate_t4(rng, t)
            missing_fields.append("t4_hard_truth")

        existing_t5 = (t.get("t5_lived_experience") or "").strip()
        if len(existing_t5) < 30:
            update["t5_lived_experience"] = _generate_t5(rng, t)
            missing_fields.append("t5_lived_experience")

        if not update:
            continue

        # Mark as backfilled so admin can track
        update["_deep_match_backfilled"] = True
        update["_deep_match_backfilled_fields"] = missing_fields

        if apply:
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": update},
            )
            updated += 1
            print(f"  Updated {t['name']} ({t['email']}) — {', '.join(missing_fields)}")
        else:
            print(f"  [DRY RUN] Would update {t['name']} ({t['email']}) — {', '.join(missing_fields)}")
            if "t1_stuck_ranked" in update:
                print(f"    T1: {update['t1_stuck_ranked']}")
            if "t3_breakthrough" in update:
                print(f"    T3: {update['t3_breakthrough']}")
            if "t4_hard_truth" in update:
                print(f"    T4: {update['t4_hard_truth']}")
            updated += 1

    action = "Updated" if apply else "Would update"
    print(f"\n{action} {updated} therapists total.")

    if not apply and updated > 0:
        print("\nRun with --apply to write changes to the database.")

    client.close()


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(backfill(apply))
