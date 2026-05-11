"""Simulate realistic feedback data for TheraVoca's feedback pipeline.

Generates patient feedback (48h/3w/9w/15w) data,
then updates therapist reliability subdocuments and calculates Match Strength scores.

Usage:
    python scripts/simulate_feedback.py              # insert into DB
    python scripts/simulate_feedback.py --dry-run    # preview only

Requires MONGO_URL and DB_NAME environment variables.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "theravoca")

# Weighted helpers — skew positive (most matches should be good)
_RNG = random.Random(42)  # reproducible


def _weighted_choice(options: list[tuple[Any, float]]) -> Any:
    """Pick from [(value, weight), ...] using weighted random."""
    values, weights = zip(*options)
    return _RNG.choices(values, weights=weights, k=1)[0]


# ---------------------------------------------------------------------------
# Realistic data generators
# ---------------------------------------------------------------------------

def gen_48h(request_id: str, patient_email: str, base_time: datetime) -> dict:
    process_rating = _weighted_choice([
        ("great", 0.55), ("fine", 0.35), ("had_issues", 0.10),
    ])
    issues_text = None
    if process_rating == "had_issues":
        issues_text = _weighted_choice([
            ("Hard to reach the therapist.", 0.3),
            ("Website was confusing.", 0.2),
            ("Not sure if insurance was accepted.", 0.3),
            ("Took too long to hear back.", 0.2),
        ])
    started_reaching_out = _weighted_choice([("yes", 0.70), ("not_yet", 0.30)])
    return {
        "id": str(uuid.uuid4()),
        "kind": "patient_48h",
        "milestone": "48h",
        "request_id": request_id,
        "patient_email": patient_email,
        "process_rating": process_rating,
        "issues_text": issues_text,
        "started_reaching_out": started_reaching_out,
        "submitted_at": (base_time + timedelta(hours=48, minutes=_RNG.randint(0, 360))).isoformat(),
    }


def gen_3w(request_id: str, patient_email: str, therapist_ids: list[str],
           base_time: datetime) -> dict:
    chosen_status = _weighted_choice([
        ("picked", 0.65), ("still_deciding", 0.20), ("none", 0.15),
    ])
    chosen_therapist_id = None
    if chosen_status == "picked" and therapist_ids:
        chosen_therapist_id = _RNG.choice(therapist_ids)

    had_session = _weighted_choice([
        ("yes", 0.55), ("scheduled", 0.25), ("no", 0.20),
    ])
    if chosen_status == "none":
        had_session = "no"

    confidence = int(_weighted_choice([
        (_RNG.randint(75, 100), 0.50),
        (_RNG.randint(50, 74), 0.35),
        (_RNG.randint(20, 49), 0.15),
    ]))

    expectation_match = _weighted_choice([
        ("yes", 0.55), ("somewhat", 0.30), ("no", 0.15),
    ])

    return {
        "id": str(uuid.uuid4()),
        "kind": "patient_3w",
        "milestone": "3w",
        "request_id": request_id,
        "patient_email": patient_email,
        "chosen_therapist_id": chosen_therapist_id,
        "chosen_status": chosen_status,
        "had_session": had_session,
        "confidence": confidence,
        "expectation_match": expectation_match,
        "surprise_text": None,
        "notes": None,
        "submitted_at": (base_time + timedelta(weeks=3, days=_RNG.randint(0, 3))).isoformat(),
    }


def gen_9w(request_id: str, patient_email: str, therapist_id: str | None,
           base_time: datetime) -> dict:
    still_seeing = _weighted_choice([
        ("yes", 0.65), ("no", 0.20), ("switched", 0.15),
    ])
    session_count = _weighted_choice([
        ("7+", 0.35), ("4-6", 0.35), ("1-3", 0.20), ("none", 0.10),
    ])
    if still_seeing == "no":
        session_count = _weighted_choice([("1-3", 0.5), ("none", 0.5)])

    whats_working_options = [
        "I feel heard and understood.",
        "The therapist gives practical tools I can use.",
        "We have a good rapport and I look forward to sessions.",
        "I'm learning to manage my anxiety better.",
        "The structured approach is really helping.",
        "I feel safe being vulnerable.",
    ]
    whats_not_options = [
        "Sometimes sessions feel repetitive.",
        "I wish we focused more on practical strategies.",
        "Scheduling is difficult.",
        None,
        None,  # many people leave blank
    ]

    feel_understood = _weighted_choice([
        (5, 0.30), (4, 0.40), (3, 0.20), (2, 0.07), (1, 0.03),
    ])
    same_page = _weighted_choice([
        (5, 0.25), (4, 0.40), (3, 0.25), (2, 0.07), (1, 0.03),
    ])
    recommend_therapist = _weighted_choice([
        (_RNG.randint(8, 10), 0.50),
        (_RNG.randint(5, 7), 0.35),
        (_RNG.randint(1, 4), 0.15),
    ])
    recommend_theravoca = _weighted_choice([
        (_RNG.randint(8, 10), 0.50),
        (_RNG.randint(5, 7), 0.35),
        (_RNG.randint(1, 4), 0.15),
    ])

    return {
        "id": str(uuid.uuid4()),
        "kind": "patient_9w",
        "milestone": "9w",
        "request_id": request_id,
        "patient_email": patient_email,
        "therapist_id": therapist_id,
        "still_seeing": still_seeing,
        "session_count": session_count,
        "whats_working": _RNG.choice(whats_working_options),
        "whats_not": _RNG.choice(whats_not_options),
        "feel_understood": feel_understood,
        "same_page": same_page,
        "recommend_therapist": recommend_therapist,
        "recommend_theravoca": recommend_theravoca,
        "match_strength_score": -1.0,  # calculated later
        "submitted_at": (base_time + timedelta(weeks=9, days=_RNG.randint(0, 5))).isoformat(),
    }


def gen_15w(request_id: str, patient_email: str, therapist_id: str | None,
            fb_9w: dict, base_time: datetime) -> dict:
    # If they were seeing at 9w, likely still seeing at 15w
    if fb_9w.get("still_seeing") == "yes":
        still_seeing = _weighted_choice([("yes", 0.75), ("no", 0.15), ("switched", 0.10)])
    else:
        still_seeing = _weighted_choice([("yes", 0.15), ("no", 0.70), ("switched", 0.15)])

    progress = _weighted_choice([
        (_RNG.randint(7, 10), 0.50),
        (_RNG.randint(4, 6), 0.35),
        (_RNG.randint(1, 3), 0.15),
    ])

    refer_therapist = _weighted_choice([
        ("yes", 0.50), ("maybe", 0.30), ("no", 0.20),
    ])
    refer_theravoca = _weighted_choice([
        ("yes", 0.55), ("maybe", 0.30), ("no", 0.15),
    ])

    what_changed_options = [
        "I feel more in control of my emotions.",
        "My relationships have improved.",
        "I have better coping strategies for stress.",
        "I'm sleeping better and feeling more energized.",
        "I've gained a lot of self-awareness.",
        "I'm managing my anxiety much better now.",
        "Not much has changed, honestly.",
        "I feel more confident in social situations.",
    ]

    return {
        "id": str(uuid.uuid4()),
        "kind": "patient_15w",
        "milestone": "15w",
        "request_id": request_id,
        "patient_email": patient_email,
        "therapist_id": therapist_id,
        "still_seeing": still_seeing,
        "progress": progress,
        "refer_therapist": refer_therapist,
        "refer_theravoca": refer_theravoca,
        "what_changed": _RNG.choice(what_changed_options),
        "notes": None,
        "match_strength_score": -1.0,  # calculated later
        "submitted_at": (base_time + timedelta(weeks=15, days=_RNG.randint(0, 5))).isoformat(),
    }


# ---------------------------------------------------------------------------
# Match Strength calculation (mirrors matching.py calculate_match_strength)
# ---------------------------------------------------------------------------

def calculate_match_strength(feedback_data: dict) -> float:
    bond_signals = []
    tasks_signals = []
    goals_signals = []

    if "confidence_3w" in feedback_data:
        bond_signals.append(feedback_data["confidence_3w"])
    if "feel_understood_9w" in feedback_data:
        bond_signals.append((feedback_data["feel_understood_9w"] - 1) * 25)
    if "still_seeing_9w" in feedback_data:
        bond_signals.append(100.0 if feedback_data["still_seeing_9w"] == "yes" else 0.0)
    if "still_seeing_15w" in feedback_data:
        bond_signals.append(100.0 if feedback_data["still_seeing_15w"] == "yes" else 0.0)

    if "expectation_match_3w" in feedback_data:
        mapping = {"yes": 100.0, "somewhat": 50.0, "no": 0.0}
        tasks_signals.append(mapping.get(feedback_data["expectation_match_3w"], 50.0))

    if "same_page_9w" in feedback_data:
        goals_signals.append((feedback_data["same_page_9w"] - 1) * 25)
    if "progress_15w" in feedback_data:
        goals_signals.append((feedback_data["progress_15w"] - 1) * 100 / 9)

    if not bond_signals or not tasks_signals or not goals_signals:
        return -1.0

    bond = sum(bond_signals) / len(bond_signals)
    tasks = sum(tasks_signals) / len(tasks_signals)
    goals = sum(goals_signals) / len(goals_signals)

    return round(bond * 0.40 + tasks * 0.30 + goals * 0.30, 1)


# ---------------------------------------------------------------------------
# Reliability update helpers (mirrors routes/feedback.py)
# ---------------------------------------------------------------------------

def recency_weighted_avg(history: list[float]) -> float:
    if not history:
        return 0.0
    weights = [1 + i * 0.1 for i in range(len(history))]
    return sum(h * w for h, w in zip(history, weights)) / sum(weights)


async def _running_avg_update(
    db, therapist_id: str, field: str, new_value: float, window: int = 20,
) -> None:
    t = await db.therapists.find_one({"id": therapist_id}, {"reliability": 1})
    if not t:
        return
    rel = t.get("reliability", {})
    history_key = f"{field}_history"
    history = rel.get(history_key, [])
    history.append(new_value)
    if len(history) > window:
        history = history[-window:]
    avg = recency_weighted_avg(history)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            f"reliability.{field}": round(avg, 4),
            f"reliability.{history_key}": history,
            "reliability.last_feedback_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

async def main(dry_run: bool = False) -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # ── Discover existing data ──
    therapists = await db.therapists.find(
        {}, {"_id": 0, "id": 1, "email": 1, "name": 1}
    ).to_list(None)
    therapist_map = {t["id"]: t for t in therapists}
    therapist_ids = list(therapist_map.keys())

    requests = await db.requests.find(
        {"notified_therapist_ids": {"$exists": True, "$ne": []}},
        {"_id": 0, "id": 1, "email": 1, "notified_therapist_ids": 1, "created_at": 1},
    ).to_list(None)

    print(f"Found {len(therapist_ids)} therapists, {len(requests)} requests with notified therapists")

    if not requests:
        print("No requests with notified_therapist_ids found. Nothing to simulate.")
        client.close()
        return

    # ── Counters ──
    stats = {
        "patient_48h": 0, "patient_3w": 0, "patient_9w": 0, "patient_15w": 0,
        "ms_computed": 0, "skipped_existing": 0,
    }

    # Track which therapists got chosen / shown for reliability updates
    therapist_selections: dict[str, list[bool]] = {}  # tid -> [True/False, ...]
    therapist_responses: dict[str, list[bool]] = {}
    therapist_retention_9w: dict[str, list[float]] = {}
    therapist_retention_15w: dict[str, list[float]] = {}
    therapist_expectation: dict[str, list[float]] = {}

    all_feedback_docs: list[dict] = []

    for req in requests:
        request_id = req["id"]
        patient_email = req.get("email", "unknown@example.com")
        notified_ids = req.get("notified_therapist_ids", [])
        created_str = req.get("created_at", datetime.now(timezone.utc).isoformat())
        try:
            base_time = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            base_time = datetime.now(timezone.utc) - timedelta(weeks=20)

        # Check idempotency — skip if feedback already exists for this request
        existing = await db.feedback.count_documents({"request_id": request_id})
        if existing > 0:
            stats["skipped_existing"] += 1
            continue

        # All notified therapists get a response_rate entry
        for tid in notified_ids:
            responded = _RNG.random() < 0.85  # 85% response rate
            therapist_responses.setdefault(tid, []).append(responded)

        # ── 48h feedback ──
        fb_48h = gen_48h(request_id, patient_email, base_time)
        all_feedback_docs.append(fb_48h)
        stats["patient_48h"] += 1

        # ── 3w feedback ──
        fb_3w = gen_3w(request_id, patient_email, notified_ids, base_time)
        all_feedback_docs.append(fb_3w)
        stats["patient_3w"] += 1

        chosen_tid = fb_3w.get("chosen_therapist_id")

        # Track selection rates
        if fb_3w["chosen_status"] == "picked" and chosen_tid:
            therapist_selections.setdefault(chosen_tid, []).append(True)
            for tid in notified_ids:
                if tid != chosen_tid:
                    therapist_selections.setdefault(tid, []).append(False)

        # Track expectation accuracy
        if chosen_tid:
            exp_map = {"yes": 1.0, "somewhat": 0.5, "no": 0.0}
            exp_val = exp_map.get(fb_3w["expectation_match"])
            if exp_val is not None:
                therapist_expectation.setdefault(chosen_tid, []).append(exp_val)

        # ── 9w feedback (only if patient picked a therapist) ──
        fb_9w = None
        if fb_3w["chosen_status"] == "picked" and chosen_tid:
            fb_9w = gen_9w(request_id, patient_email, chosen_tid, base_time)

            # Compute partial Match Strength at 9w
            ms_data = {
                "confidence_3w": fb_3w["confidence"],
                "expectation_match_3w": fb_3w["expectation_match"],
                "feel_understood_9w": fb_9w["feel_understood"],
                "same_page_9w": fb_9w["same_page"],
                "still_seeing_9w": fb_9w["still_seeing"],
            }
            ms_9w = calculate_match_strength(ms_data)
            fb_9w["match_strength_score"] = ms_9w

            all_feedback_docs.append(fb_9w)
            stats["patient_9w"] += 1

            # Track retention
            ret_val = 1.0 if fb_9w["still_seeing"] == "yes" else 0.0
            therapist_retention_9w.setdefault(chosen_tid, []).append(ret_val)

        # ── 15w feedback (only if 9w exists) ──
        if fb_9w and chosen_tid:
            fb_15w = gen_15w(request_id, patient_email, chosen_tid, fb_9w, base_time)

            # Full Match Strength at 15w
            ms_data = {
                "confidence_3w": fb_3w["confidence"],
                "expectation_match_3w": fb_3w["expectation_match"],
                "feel_understood_9w": fb_9w["feel_understood"],
                "same_page_9w": fb_9w["same_page"],
                "still_seeing_9w": fb_9w["still_seeing"],
                "still_seeing_15w": fb_15w["still_seeing"],
                "progress_15w": fb_15w["progress"],
            }
            ms_15w = calculate_match_strength(ms_data)
            fb_15w["match_strength_score"] = ms_15w
            if ms_15w > 0:
                stats["ms_computed"] += 1

            all_feedback_docs.append(fb_15w)
            stats["patient_15w"] += 1

            # Track retention 15w
            ret_val = 1.0 if fb_15w["still_seeing"] == "yes" else 0.0
            therapist_retention_15w.setdefault(chosen_tid, []).append(ret_val)

    # (Therapist pulse simulation removed 2026-05-11 with the weekly pulse
    #  feature deletion. See git history if you need to resurrect it.)

    # ── Summary before insert ──
    print(f"\nGenerated feedback documents:")
    for kind in ["patient_48h", "patient_3w", "patient_9w", "patient_15w"]:
        print(f"  {kind}: {stats[kind]}")
    print(f"  Match Strength scores computed: {stats['ms_computed']}")
    print(f"  Skipped (already exists): {stats['skipped_existing']}")

    if dry_run:
        print("\n[DRY RUN] No data inserted.")
        # Show sample docs
        if all_feedback_docs:
            print("\nSample 48h doc:")
            sample = next((d for d in all_feedback_docs if d["kind"] == "patient_48h"), None)
            if sample:
                for k, v in sample.items():
                    print(f"  {k}: {v}")
        if all_feedback_docs:
            sample_3w = next((d for d in all_feedback_docs if d["kind"] == "patient_3w"), None)
            if sample_3w:
                print("\nSample 3w doc:")
                for k, v in sample_3w.items():
                    print(f"  {k}: {v}")
        # Show sample reliability
        print("\nSample reliability data (first 3 therapists with data):")
        shown = 0
        for tid in list(therapist_selections.keys())[:3]:
            sel_hist = therapist_selections.get(tid, [])
            sel_avg = recency_weighted_avg([1.0 if s else 0.0 for s in sel_hist])
            resp_hist = therapist_responses.get(tid, [])
            resp_avg = recency_weighted_avg([1.0 if r else 0.0 for r in resp_hist])
            print(f"  {tid[:12]}... selection_rate={sel_avg:.3f} ({len(sel_hist)} samples), "
                  f"response_rate={resp_avg:.3f} ({len(resp_hist)} samples)")
            shown += 1
        client.close()
        return

    # ── Insert feedback docs ──
    if all_feedback_docs:
        await db.feedback.insert_many(all_feedback_docs)
        print(f"\nInserted {len(all_feedback_docs)} feedback docs.")

    # ── Update therapist reliability subdocuments ──
    print("\nUpdating therapist reliability scores...")
    updated_therapists = set()

    for tid, selections in therapist_selections.items():
        for was_selected in selections:
            await _running_avg_update(db, tid, "selection_rate", 1.0 if was_selected else 0.0)
        updated_therapists.add(tid)

    for tid, responses in therapist_responses.items():
        for responded in responses:
            await _running_avg_update(db, tid, "response_rate", 1.0 if responded else 0.0)
        updated_therapists.add(tid)

    for tid, retentions in therapist_retention_9w.items():
        for val in retentions:
            await _running_avg_update(db, tid, "retention_9w", val)
        updated_therapists.add(tid)

    for tid, retentions in therapist_retention_15w.items():
        for val in retentions:
            await _running_avg_update(db, tid, "retention_15w", val)
        updated_therapists.add(tid)

    for tid, expectations in therapist_expectation.items():
        for val in expectations:
            await _running_avg_update(db, tid, "expectation_accuracy", val)
        updated_therapists.add(tid)

    print(f"Updated reliability for {len(updated_therapists)} therapists.")

    # -- Store Match Strength scores on feedback docs (already set above,
    #    but also store aggregated score on the therapist) --
    ms_by_therapist: dict[str, list[float]] = {}
    for doc in all_feedback_docs:
        score = doc.get("match_strength_score", -1)
        if score > 0 and doc.get("therapist_id"):
            ms_by_therapist.setdefault(doc["therapist_id"], []).append(score)

    for tid, scores in ms_by_therapist.items():
        avg_ms = round(sum(scores) / len(scores), 1)
        await db.therapists.update_one(
            {"id": tid},
            {"$set": {
                "reliability.avg_match_strength": avg_ms,
                "reliability.match_strength_sample_count": len(scores),
            }},
        )

    # -- Final summary --
    print("\n" + "=" * 60)
    print("SIMULATION SUMMARY")
    print("=" * 60)
    print(f"Feedback docs inserted:  {len(all_feedback_docs)}")
    print(f"Therapists updated:      {len(updated_therapists)}")
    print(f"Match Strength computed: {stats['ms_computed']}")
    print(f"Requests skipped:        {stats['skipped_existing']}")

    # Show reliability scores for therapists that have data
    print(f"\nTherapist reliability scores (showing up to 10):")
    print(f"{'Therapist ID':<40} {'Resp%':>6} {'Sel%':>6} {'Ret9w':>6} {'Ret15w':>7} {'ExpAcc':>7} {'MS':>6}")
    print("-" * 80)

    sample_therapists = await db.therapists.find(
        {"reliability": {"$exists": True}},
        {"_id": 0, "id": 1, "name": 1, "reliability": 1},
    ).to_list(10)

    for t in sample_therapists:
        rel = t.get("reliability", {})
        name_or_id = (t.get("name") or t["id"])[:38]
        resp = rel.get("response_rate", 0)
        sel = rel.get("selection_rate", 0)
        r9 = rel.get("retention_9w", 0)
        r15 = rel.get("retention_15w", 0)
        exp = rel.get("expectation_accuracy", 0)
        ms = rel.get("avg_match_strength", -1)
        ms_str = f"{ms:.1f}" if ms > 0 else "N/A"
        print(f"{name_or_id:<40} {resp:>5.1%} {sel:>5.1%} {r9:>5.1%} {r15:>6.1%} {exp:>6.1%} {ms_str:>6}")

    print()
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate feedback data for TheraVoca")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting")
    args = parser.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
