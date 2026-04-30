"""Seed realistic T5 lived-experience + T2 progress-story text on every
active therapist, then embed both. Without this seed, the v2 deep-match
Contextual Resonance axis and the new `other_issue` soft bonus silently
no-op for nearly every match (since seeded therapists never had T2/T5
text populated).

Each therapist gets a stable, deterministic blurb derived from their
top primary specialty + a hash of their id so the data feels diverse
without being random across runs.
"""
from __future__ import annotations
import asyncio
import hashlib
import sys

sys.path.insert(0, "/app/backend")

from deps import db  # noqa: E402
from embeddings import embed_text  # noqa: E402

# 8 short T5 (lived experience) seeds per common specialty. Each is a
# clinically plausible, first-person snippet — what a therapist might
# write in 1-2 sentences if asked "what life experiences do you
# understand from the inside, not from a textbook?".
T5_BY_SPECIALTY: dict[str, list[str]] = {
    "anxiety": [
        "I lived with high-functioning generalized anxiety for most of my twenties — the kind that looks like productivity from outside but never lets you rest. I found my way through somatic work and I bring that lens.",
        "Family of origin was high-stakes, high-volume; I learned vigilance early and have spent years undoing it. That history makes me a quick read on the bodies clients arrive in.",
        "I've sat in my own panic attacks. I know the shape of the thought spirals from the inside, not just the literature.",
        "Long-time meditator before I was a clinician. I treat anxiety as information first, symptom second.",
    ],
    "depression": [
        "I had a major depressive episode in graduate school that took 18 months to climb out of. I don't pathologise the slowness; I respect it.",
        "Caregiving for an aging parent during my training taught me what depression looks like when nobody around you has language for it. That stays with me in session.",
        "Postpartum depression is woven into my own family story across two generations. I keep that lens with parents I work with.",
        "I came to therapy because I needed it before I trained to provide it. That order matters to how I show up.",
    ],
    "trauma_ptsd": [
        "Adult survivor of childhood emotional neglect — I did my own EMDR before I was certified to deliver it. I trust the body's pace because I had to learn to.",
        "Combat veteran in the immediate family; I grew up around hypervigilance long before I had a word for it.",
        "Trained at a community trauma clinic for three years. I work somatically and won't push abreaction.",
        "I've worked with my own intergenerational trauma in long-term therapy. I bring that humility — not expertise — into the room.",
    ],
    "relationship_issues": [
        "Married for 12 years, divorced, remarried — the whole un-textbook arc. I don't pretend relationships are clean; I help clients build the version that fits them.",
        "Polyamorous for the last eight years. I don't 101 my clients about non-monogamy because I've lived the operational reality of it.",
        "Came out at 32 mid-marriage. I bring that lived complexity to clients renegotiating who they are inside a partnership.",
        "Therapist parents — I grew up watching the seams of long-term marriages. I don't romanticize attachment, and I don't doom it either.",
    ],
    "life_transitions": [
        "Career-changed at 38 from corporate finance into clinical work. I know what re-becoming feels like, not just what it sounds like in a textbook.",
        "Immigrated as a teenager. Identity reconstruction is not abstract for me; it's biography.",
        "Lost a parent at 22 and rebuilt my adult self around the absence. I sit easily with grief that doesn't resolve cleanly.",
        "Empty-nested last year. I'm freshly familiar with the dual track of pride and disorientation that comes with it.",
    ],
    "school_academic_stress": [
        "First-generation college student. Academic perfectionism was survival, not aspiration, and I work with students who carry the same weight.",
        "Dyslexia diagnosed in adulthood. I know what it costs to mask, and what it costs to stop.",
        "Former high-school teacher. I've sat across the desk from the kid we'd all later call 'gifted and burned out'.",
        "Two of my own kids are mid-undergraduate right now. I see academic stress from both sides of the kitchen table.",
    ],
    "adhd": [
        "Diagnosed with ADHD at 34. The grief of 'what would I have been if I'd known earlier' is something I can sit with because I've sat with it myself.",
        "Combined-type ADHD, medicated for 8 years, off-label for 3. I know the medication conversation is rarely a single conversation.",
        "Parent of two neurodivergent kids. ADHD shows up at the dinner table for me, not just on the intake form.",
        "Late-diagnosed AuDHD myself. I work mostly with adults realizing they're not lazy; they were undiagnosed.",
    ],
    "substance_use": [
        "Sober 11 years, sponsor for 7. I don't insist on AA, and I don't dismiss it.",
        "I lost my brother to overdose in 2017. I don't treat substance use as a moral question; I treat it as a survival strategy that ran out of room.",
        "Trained in MAT-aware care. I came to it because my own family needed providers who weren't afraid of buprenorphine.",
        "I worked night shifts at a detox clinic for four years. I know the body of withdrawal, not just the chart.",
    ],
    "autism_neurodivergence": [
        "Late-identified autistic adult. I know the cost of the mask intimately.",
        "Sibling on the spectrum, three professionals deep into our family. Neurodivergence isn't a topic for me; it's a dialect I grew up speaking.",
        "Sensory-sensitive myself. I dim the lights in session because I needed the lights dimmed for me, first.",
        "ADHD/ASD parent of an ADHD/ASD kid. I do not pathologise stimming.",
    ],
    "eating_concerns": [
        "Recovered from anorexia in my 20s. I name that openly with eating-disorder clients because the silence was what nearly killed me.",
        "Bulimic for six years before I found care that worked. I know which interventions land and which feel like another diet.",
        "Trained in HAES + intuitive eating. Came to it because the body-positivity language in graduate school still felt like a workaround.",
        "I work with body grief — what was lost to the disorder, not just what's recovered. That comes from my own arc.",
    ],
    "ocd": [
        "OCD myself, on medication for 9 years, in ERP for 4. I know what it's like to walk into therapy hoping the therapist won't accidentally reinforce the rituals.",
        "Pure-O lived experience. I don't conflate OCD with cleanliness; I treat the actual phenomenology.",
        "Sister with severe contamination OCD. I grew up adjacent to the daily texture of it.",
        "ERP-trained. I came to OCD work because my own intrusive thoughts in adolescence went undiagnosed for too long.",
    ],
    "parenting_family": [
        "Three kids, two divorces, one blended household. I don't moralise modern family structures.",
        "Adopted my youngest at age 7. Attachment work is a family practice for me, not an abstraction.",
        "Single parent for the last six years. The exhaustion of doing it alone is part of how I listen.",
        "Multi-generational caregiver — my mother lives with us. I know the specific squeeze of the sandwich generation.",
    ],
}

T2_PROGRESS = [
    "A breakthrough in my work usually looks quieter than people expect — a client laughs at a moment they used to white-knuckle, and they notice they laughed.",
    "I know we're getting somewhere when the same situation that wrecked them in March reads as a small annoyance in October. The trigger didn't change. They did.",
    "Real progress for me is when a client starts to disagree with me out loud. That's a body that has come back online.",
    "When clients begin to bring me dreams or stray childhood memories without my prompting, that's the work doing itself.",
    "I look for the moment a client describes their own mother (or partner, or boss) with curiosity rather than verdict. That's the shift.",
    "A breakthrough often shows up as a small, unprovoked decision — leaving a meeting early, calling a sibling, declining the third drink. The body voted.",
    "It's when a client tells me they sat with discomfort and didn't try to fix it. That's the muscle I'm trying to help build.",
    "Real change is when someone stops auditioning for the relationship in front of them — therapeutic or otherwise — and just shows up.",
]


def _pick(seed_str: str, options: list[str]) -> str:
    """Deterministic pick from `options` based on a hash of `seed_str`."""
    h = int(hashlib.sha256(seed_str.encode("utf-8")).hexdigest(), 16)
    return options[h % len(options)]


async def main() -> None:
    cursor = db.therapists.find(
        {"is_active": {"$ne": False}},
        {
            "_id": 0, "id": 1, "name": 1,
            "primary_specialties": 1, "secondary_specialties": 1,
            "t5_lived_experience": 1, "t5_embedding": 1,
            "t2_progress_story": 1, "t2_embedding": 1,
        },
    )
    n_seed_t5 = n_seed_t2 = n_emb_t5 = n_emb_t2 = 0
    async for t in cursor:
        update: dict = {}
        # ── T5 (lived experience) ─────────────────────────────────
        if not (t.get("t5_lived_experience") or "").strip():
            primary = ((t.get("primary_specialties") or [None])[0] or "").lower()
            pool = T5_BY_SPECIALTY.get(primary)
            if not pool:
                # Fall back to a relationship_issues-flavoured pool
                pool = T5_BY_SPECIALTY["relationship_issues"]
            txt = _pick(t["id"] + "::t5", pool)
            update["t5_lived_experience"] = txt
            n_seed_t5 += 1
        # ── T2 (progress story) ───────────────────────────────────
        if not (t.get("t2_progress_story") or "").strip():
            update["t2_progress_story"] = _pick(t["id"] + "::t2", T2_PROGRESS)
            n_seed_t2 += 1
        if update:
            await db.therapists.update_one({"id": t["id"]}, {"$set": update})
        # ── Embed both fields if they don't have a vector yet ─────
        # We re-read after the update so newly-seeded text is embedded.
        fresh = await db.therapists.find_one(
            {"id": t["id"]},
            {
                "_id": 0,
                "t5_lived_experience": 1, "t5_embedding": 1,
                "t2_progress_story": 1, "t2_embedding": 1,
            },
        )
        emb_update: dict = {}
        if (fresh.get("t5_lived_experience") or "") and not fresh.get("t5_embedding"):
            v = await embed_text(fresh["t5_lived_experience"])
            if v:
                emb_update["t5_embedding"] = v
                n_emb_t5 += 1
        if (fresh.get("t2_progress_story") or "") and not fresh.get("t2_embedding"):
            v = await embed_text(fresh["t2_progress_story"])
            if v:
                emb_update["t2_embedding"] = v
                n_emb_t2 += 1
        if emb_update:
            await db.therapists.update_one({"id": t["id"]}, {"$set": emb_update})
    print(
        f"[done] seeded t5={n_seed_t5}  seeded t2={n_seed_t2}  "
        f"embedded t5={n_emb_t5}  embedded t2={n_emb_t2}"
    )


if __name__ == "__main__":
    asyncio.run(main())
