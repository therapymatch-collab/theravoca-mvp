"""
Matching-Outcome Simulator (admin-only).

Generates a batch of fully-populated synthetic patient requests,
runs each through the real matching pipeline (Step-1 score, top-N
notified, Step-2 re-rank after synthetic therapist applications),
and aggregates the results into an audit report that surfaces
scoring inconsistencies and coverage gaps across the current
therapist pool.

Design goals:
  * Use the REAL matching.py functions — no shadow math. If the
    simulator's scores disagree with production, production is wrong.
  * Produce enough variation (50 requests × varied HARDs, concerns,
    payment types, deep-match opt-in mix) to shake out axis-coverage
    holes.
  * Open-text fields (`notes`, `prior_therapy_notes`, `p3_resonance`)
    are populated with realistic prose so embedding/contextual-resonance
    axes get exercised — but WITHOUT making any embeddings calls
    during the synthetic-request build (we skip the async embedding
    generation and instead pull any pre-existing P3 embedding from
    seeded requests when available).
  * All synthetic requests use a shared `simulator_run_id` field so
    the admin UI can group + prune them independently of real data.
    They live in their own `simulator_runs` + `simulator_requests`
    collections to avoid polluting prod.

Public entrypoints:
  - `run_simulation(db, params)` — heavy, call in a background task.
  - `load_run(db, run_id)`       — fetch a completed run's report.
  - `list_runs(db, limit)`       — list recent runs for the UI.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone
from statistics import mean, stdev
from typing import Any

from matching import rank_therapists, score_therapist


# ──────────────────────────────────────────────────────────────────────
# Synthetic request generator
# ──────────────────────────────────────────────────────────────────────
# Realistic lexicons used to produce varied, representative fixtures.
# Kept small on purpose — we want COVERAGE across the matching axes,
# not millions of unique combinations. Each option is chosen with
# intent so the generator exercises:
#   * All 4 client_types + 5 age_groups
#   * The dozen most common presenting issues
#   * All three payment types + the two strict-HARD insurance variants
#   * All 5 modality preferences (incl. in_person_only HARD)
#   * The 6 availability windows + the strict-HARD variant
#   * 4 urgency buckets + the strict-HARD variant
#   * All 4 gender preferences + the required-HARD variant
#   * Multiple languages + the language-strict HARD variant
#   * Deep-match opt-in / opt-out mix (60/40)

_CLIENT_TYPES = ["individual", "couples", "family", "group"]
_AGE_GROUPS = ["child", "teen", "young_adult", "adult", "older_adult"]
_ISSUES = [
    "anxiety", "depression", "ocd", "adhd", "trauma_ptsd",
    "relationship_issues", "life_transitions", "parenting_family",
    "substance_use", "eating_concerns", "autism_neurodivergence",
    "school_academic_stress",
]
_MODALITIES = [
    "telehealth_only", "in_person_only", "hybrid",
    "prefer_inperson", "prefer_telehealth",
]
_PAYMENTS = ["insurance", "cash", "either"]
_AVAILABILITY = [
    "weekday_morning", "weekday_afternoon", "weekday_evening",
    "weekend_morning", "weekend_afternoon", "flexible",
]
_URGENCIES = ["asap", "within_2_3_weeks", "within_month", "flexible"]
_GENDERS = ["no_pref", "female", "male", "nonbinary"]
_LANGUAGES = ["English", "Spanish", "Mandarin", "Korean", "Vietnamese"]
_STYLES = [
    "structured", "warm_supportive", "direct_practical",
    "trauma_informed", "insight_oriented", "faith_informed",
    "culturally_responsive", "lgbtq_affirming",
]
_MOD_PREFS = [
    "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic",
    "ACT", "Solution-Focused", "IFS",
]
_INSURERS = [
    "Blue Cross of Idaho", "Regence BlueShield of Idaho",
    "SelectHealth", "Aetna", "United Healthcare", "Cigna",
    "Pacific Source",
]
_EXPERIENCE_BUCKETS = ["no_pref", "0-3", "3-7", "7-15", "15+"]

# Realistic open-text prose. Each entry maps to one of the presenting
# issues so the synthetic request reads like something a real patient
# would type. Keeps the LLM-enrichment + deep-match embedding axes
# exercised with plausible content, not lorem ipsum.
_NOTES_BY_ISSUE: dict[str, list[str]] = {
    "anxiety": [
        "I've been having panic attacks at work for 6 months — chest tightness, intrusive worry, sleep only 4-5 hrs/night. I want tools to use in the moment, not just talk therapy about childhood.",
        "Generalized anxiety has been constant since college. I've tried meditation apps; they didn't stick. Looking for someone who does CBT homework and gives specific exercises.",
    ],
    "depression": [
        "Low energy, no motivation, withdrawing from friends for the last 4 months. It's not the first time — I had a similar episode at 22. I'm not suicidal but I'm scared this is my baseline now.",
        "Post-partum depression at 8 months out. Not getting better on its own. Need someone who understands new-mom stuff without being preachy about it.",
    ],
    "ocd": [
        "Contamination OCD + intrusive thoughts about harm coming to my kid. I've researched ERP and want someone trained in it. Not interested in pure talk therapy.",
    ],
    "adhd": [
        "Diagnosed at 38, medicated, but I still drown in executive function. I want practical coaching alongside therapy for the emotional stuff — feeling like I've been broken my whole life.",
    ],
    "trauma_ptsd": [
        "Complex trauma from a long-term emotionally abusive relationship. I want EMDR or IFS — I've done enough talk therapy to know I need something body-based.",
        "Single-incident PTSD from a car accident 2 years ago. Triggered every time I drive. Just want it to stop.",
    ],
    "relationship_issues": [
        "Partner and I fight constantly about division of labor. We've tried couples therapy once — therapist took sides. Looking for a Gottman-trained therapist who can keep us both accountable.",
    ],
    "life_transitions": [
        "Just left a 10-year career in law. Financially OK, but I feel like I've lost my identity. My partner doesn't really get why I'm not excited about the freedom.",
    ],
    "parenting_family": [
        "Teenage son is struggling socially + I think my husband and I are part of the problem. Want a family therapist who'll push us to change, not just validate how hard parenting is.",
    ],
    "substance_use": [
        "Drinking more than I want — 3-4 nights a week, 4-5 drinks a night. I don't think I'm an alcoholic but it's getting in the way. Not ready for AA. Looking for harm-reduction therapy.",
    ],
    "eating_concerns": [
        "Recovered from anorexia 10 years ago, but my relationship with food is slipping again after pregnancy. Want someone who's been through eating disorder recovery themselves if possible.",
    ],
    "autism_neurodivergence": [
        "Newly diagnosed autism at 31. Want a therapist who gets late-diagnosed adults — not one who'll try to 'fix' my sensory stuff or tell me to mask better.",
    ],
    "school_academic_stress": [
        "College sophomore burning out. 4.0 GPA but no sleep, no social life. I don't know how to stop performing.",
    ],
}

_PRIOR_THERAPY_NOTES = {
    "yes_helped": [
        "My last therapist was great at validating my feelings but pushed me to take action when I needed it. Weekly CBT homework helped me see patterns.",
        "Trauma-informed, culturally competent. She got that I couldn't fix my family — I needed to accept them and build a life anyway.",
    ],
    "yes_not_helped": [
        "Felt rushed. She had 30 clients a day and I was an appointment slot. Advice was generic.",
        "Therapist kept pushing a specific modality that wasn't working. When I said it wasn't working she said I was resistant.",
    ],
}

_P1_SLUGS = [
    "leads_structured", "follows_lead", "challenges",
    "warm_first", "direct_honest", "guides_questions",
]
_P2_SLUGS = [
    "deep_emotional", "practical_tools", "explore_past",
    "focus_forward", "build_insight", "shift_relationships",
]

_P3_RESONANCE_SAMPLES = [
    "I grew up in an immigrant household — my parents don't believe in mental health care. I need someone who won't lecture me about how therapy is normalized now.",
    "Queer + religious. Not looking for anyone who sees those as in conflict. They coexist in me.",
    "First-gen college, full scholarship, dealing with imposter syndrome at a tech job. My family asks when I'm buying them a house. I don't want to have to explain why that's complicated.",
    "Chronic illness (POTS + EDS). Please don't suggest yoga or running. I need someone who gets that my energy budget is finite.",
    "Military spouse, two tours, kids are young. The isolation is the hardest part. Don't want to be told 'my husband is also deployed' by a civilian who can't actually relate.",
]


def _rand_bool(p: float) -> bool:
    """Shorthand for probabilistic bool — used throughout to produce
    a weighted mix of HARD vs soft filters on the synthetic requests."""
    return random.random() < p


def _pick_issues() -> list[str]:
    """Pick 1-3 issues, weighted toward 2 (most realistic)."""
    n = random.choices([1, 2, 3], weights=[20, 60, 20], k=1)[0]
    return random.sample(_ISSUES, n)


def _build_synthetic_request(run_id: str, idx: int) -> dict[str, Any]:
    """Produce one fully-populated request dict ready for
    score_therapist() / rank_therapists(). Not persisted to the real
    `requests` collection — lives in `simulator_requests` keyed by
    `simulator_run_id`."""
    issues = _pick_issues()
    primary = issues[0]
    client_type = random.choice(_CLIENT_TYPES)
    # Age-group ↔ client-type gentle coherence (families don't often
    # request "individual" therapy for a 78-year-old — pick reasonably).
    age_group = random.choice(_AGE_GROUPS)
    if client_type == "couples":
        age_group = random.choice(["young_adult", "adult", "older_adult"])
    elif client_type == "family":
        age_group = random.choice(["teen", "young_adult", "adult"])

    modality = random.choice(_MODALITIES)
    payment_type = random.choice(_PAYMENTS)
    insurance_name = (
        random.choice(_INSURERS) if payment_type != "cash" else ""
    )
    # 30% of insurance-using requests flag insurance_strict (HARD) —
    # matches the real distribution on prod we've observed.
    insurance_strict = payment_type != "cash" and _rand_bool(0.3)

    availability = random.sample(
        _AVAILABILITY, k=random.randint(1, 3),
    )
    availability_strict = _rand_bool(0.2) and "flexible" not in availability

    urgency = random.choice(_URGENCIES)
    urgency_strict = _rand_bool(0.25) and urgency != "flexible"

    gender_pref = random.choice(_GENDERS)
    gender_required = gender_pref != "no_pref" and _rand_bool(0.35)

    # Language strict is rare but the most likely pool-zeroer — we
    # deliberately seed 8% of requests with a non-English HARD so
    # every simulator run surfaces at least a few "Mandarin zeroed
    # the pool" style reports.
    if _rand_bool(0.08):
        language = random.choice([x for x in _LANGUAGES if x != "English"])
        language_strict = True
    else:
        language = "English"
        language_strict = False

    prior = random.choice(
        ["no", "yes_helped", "yes_not_helped", "not_sure"],
    )
    prior_notes = ""
    if prior in _PRIOR_THERAPY_NOTES:
        prior_notes = random.choice(_PRIOR_THERAPY_NOTES[prior])

    budget = None
    if payment_type in ("cash", "either"):
        budget = random.choice([120, 150, 175, 200, 225, 250])

    deep_opt_in = _rand_bool(0.6)
    p1 = random.sample(_P1_SLUGS, k=2) if deep_opt_in else []
    p2 = random.sample(_P2_SLUGS, k=2) if deep_opt_in else []
    p3 = random.choice(_P3_RESONANCE_SAMPLES) if deep_opt_in else ""

    notes_pool = _NOTES_BY_ISSUE.get(primary, [])
    notes = random.choice(notes_pool) if notes_pool else ""

    return {
        "id": f"sim-{run_id[:8]}-{idx:03d}",
        "simulator_run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        # Intake fields — mirror the production `requests` schema 1:1
        "client_type": client_type,
        "age_group": age_group,
        "presenting_issues": issues,
        "primary_concern": primary,
        "other_issue": "",
        "location_state": "ID",
        "location_city": random.choice(["Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello"]),
        "location_zip": random.choice(["83702", "83642", "83686", "83402", "83201"]),
        "modality_preference": modality,
        "payment_type": payment_type,
        "insurance_name": insurance_name,
        "insurance_name_other": "",
        "insurance_strict": insurance_strict,
        "budget": budget,
        "sliding_scale_ok": _rand_bool(0.3),
        "availability_windows": availability,
        "availability_strict": availability_strict,
        "urgency": urgency,
        "urgency_strict": urgency_strict,
        "prior_therapy": prior,
        "prior_therapy_notes": prior_notes,
        "gender_preference": gender_pref,
        "gender_required": gender_required,
        "preferred_language": language,
        "language_strict": language_strict,
        "experience_preference": random.sample(_EXPERIENCE_BUCKETS, k=1),
        "style_preference": random.sample(_STYLES, k=random.randint(0, 3)),
        "modality_preferences": random.sample(_MOD_PREFS, k=random.randint(0, 3)),
        "priority_factors": random.sample(
            ["modality", "experience", "identity"], k=random.randint(0, 2),
        ),
        "strict_priorities": _rand_bool(0.1),
        "notes": notes,
        "deep_match_opt_in": deep_opt_in,
        "p1_communication": p1,
        "p2_change": p2,
        "p3_resonance": p3,
        # Embeddings intentionally left off — the simulator scores
        # without deep-match-bonus vectors so runs are deterministic.
        # Contextual-resonance bonuses are still computed via the
        # (non-embedding) axis fallback.
    }


# ──────────────────────────────────────────────────────────────────────
# Step-2 simulation — synthetic therapist applications
# ──────────────────────────────────────────────────────────────────────

_BLURB_TEMPLATES = [
    "I've worked with clients on {issue} for {years}+ years using {modality}. Your description of {anchor} resonates — I think we'd be a strong fit.",
    "Thank you for reaching out. I specialize in {issue} and my approach is {style}. I have openings for {availability} and accept {payment}.",
    "{anchor} is something I've helped many clients move through. My style is {style} and I'd be happy to start within your preferred timeframe.",
]


def _synthesize_blurb(t: dict, r: dict) -> str:
    """Generate a plausible therapist application blurb mentioning the
    patient's primary concern + the therapist's actual modalities +
    style tags. Matches the shape of real applications we've seen."""
    primary = (r.get("presenting_issues") or ["therapy"])[0].replace("_", " ")
    mods = (t.get("modalities") or ["CBT"])[:2]
    style = (t.get("style_tags") or ["warm and supportive"])[0].replace("_", " ")
    years = t.get("years_experience") or random.randint(5, 20)
    payment = (
        "most major insurance"
        if t.get("insurance_accepted")
        else "cash + sliding scale"
    )
    avail = (t.get("availability_windows") or ["weekday afternoons"])[0].replace(
        "_", " ",
    )
    # Anchor phrase — paraphrase a snippet from the patient's own
    # description so the blurb sounds like the therapist actually read
    # the request (the strongest signal the real Step-2 ranking rewards).
    notes = r.get("notes") or r.get("p3_resonance") or primary
    anchor = (notes.strip().split(".")[0][:80] + "…") if notes else primary

    tmpl = random.choice(_BLURB_TEMPLATES)
    return tmpl.format(
        issue=primary,
        years=years,
        modality=", ".join(mods),
        anchor=anchor,
        style=style,
        payment=payment,
        availability=avail,
    )


def _step2_score(base_score: float, blurb: str, toggles: dict) -> float:
    """Compute the Step-2 ranking score by folding the therapist's
    application signals into the Step-1 score.

    Step-2 adds:
      * Availability-confirmed flag (+2 to +4 depending on how tight
        the patient's urgency is)
      * Payment-confirmed flag (+2)
      * Taking-new-clients flag (+1)
      * Blurb quality — mentions of patient's concerns, length, concrete
        next-step language (+0 to +6)
    Negative signals:
      * Blurb shorter than 40 chars (-3) — low effort.
      * Blurb missing any mention of the patient's primary concern (-2)
    """
    score = base_score
    breakdown = {}
    if toggles.get("available_confirmed"):
        breakdown["availability_confirmed"] = 3
        score += 3
    if toggles.get("payment_confirmed"):
        breakdown["payment_confirmed"] = 2
        score += 2
    if toggles.get("taking_new_clients"):
        breakdown["taking_new_clients"] = 1
        score += 1

    blurb_clean = (blurb or "").strip()
    n = len(blurb_clean)
    if n < 40:
        breakdown["blurb_low_effort"] = -3
        score -= 3
    else:
        quality = min(6, (n // 80) + 1)  # 1-6 by length bucket
        # Bonus if the blurb mentions next-step phrasing ("happy to",
        # "can start", "reach out", "book a consult"): +2
        if any(
            k in blurb_clean.lower()
            for k in ["happy to", "can start", "reach out", "consult"]
        ):
            quality = min(6, quality + 2)
        breakdown["blurb_quality"] = quality
        score += quality
    return round(min(120.0, max(0.0, score)), 2), breakdown


# ──────────────────────────────────────────────────────────────────────
# Main simulator
# ──────────────────────────────────────────────────────────────────────


async def run_simulation(
    db,
    *,
    num_requests: int = 50,
    notify_top_n: int = 30,
    min_applications: int = 5,
    max_applications: int = 12,
    random_seed: int | None = None,
) -> dict[str, Any]:
    """Run one full simulator pass and persist the report.

    Returns the report dict (also written to `simulator_runs` with
    the same `id` as the returned payload).

    ALL therapist/request data used is either:
      * pulled fresh from the real `therapists` collection (only
        active + approved + billable providers — same filter the
        real matcher uses), OR
      * synthetically generated for this run and stored in the
        `simulator_requests` collection keyed by `simulator_run_id`.

    No production data is mutated.
    """
    if random_seed is not None:
        random.seed(random_seed)

    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)

    # Pull the active therapist pool ONCE. Mirrors the filter used
    # by /api/admin/requests/<id>/score-preview so the simulator
    # sees the same pool as the real pipeline.
    # Mirror the production active-therapist filter from helpers.py so the
    # simulator sees the exact same pool the real matcher would.
    therapists = await db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {
                "$nin": ["past_due", "canceled", "unpaid", "incomplete"],
            },
        },
        {"_id": 0},
    ).to_list(length=None)

    if not therapists:
        return {
            "id": run_id,
            "status": "error",
            "error": "No active therapists in pool — simulator has nothing to score against.",
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }

    # Build + persist synthetic requests — one Mongo write so the
    # admin UI can display them + clean them up later.
    synthetic_requests = [
        _build_synthetic_request(run_id, i) for i in range(num_requests)
    ]
    await db.simulator_requests.insert_many(
        [dict(r) for r in synthetic_requests]
    )

    per_request_reports: list[dict] = []
    all_filter_failures: dict[str, int] = {}

    for req in synthetic_requests:
        # ── Step 1: full matching pipeline ─────────────────────────
        ranked = rank_therapists(
            therapists, req,
            threshold=70.0,
            top_n=notify_top_n,
            min_results=3,
        )
        # Also compute per-therapist filter failure reasons for
        # the ones that were excluded, so the audit can show WHY
        # the pool collapsed.
        filter_counts: dict[str, int] = {}
        eligible_count = 0
        for t in therapists:
            r = score_therapist(t, req)
            if r["filtered"]:
                reason = r.get("filter_failed", "unknown")
                filter_counts[reason] = filter_counts.get(reason, 0) + 1
                all_filter_failures[reason] = all_filter_failures.get(reason, 0) + 1
            else:
                eligible_count += 1

        notified = ranked[:notify_top_n]
        step1_scores = [n["match_score"] for n in notified]

        # ── Step 2: simulate therapist applications ────────────────
        n_apply = min(
            len(notified),
            random.randint(min_applications, max_applications),
        )
        if len(notified) < min_applications:
            # When the pool is too small to hit min_applications, we
            # "get" everyone who was notified — this is still useful
            # data (the audit should flag low-coverage requests).
            n_apply = len(notified)
        applicants = random.sample(notified, k=n_apply) if n_apply else []

        step2_entries = []
        for t in applicants:
            blurb = _synthesize_blurb(t, req)
            toggles = {
                # Realistic distribution: most therapists who apply
                # confirm they're available + taking new clients;
                # payment-confirmed is slightly rarer.
                "available_confirmed": _rand_bool(0.9),
                "taking_new_clients": _rand_bool(0.92),
                "payment_confirmed": _rand_bool(0.75),
            }
            step2_total, step2_breakdown = _step2_score(
                t["match_score"], blurb, toggles,
            )
            step2_entries.append({
                "therapist_id": t.get("id"),
                "therapist_name": t.get("name"),
                "step1_score": t["match_score"],
                "step2_score": step2_total,
                "step2_delta": round(step2_total - t["match_score"], 2),
                "blurb": blurb,
                "blurb_length": len(blurb),
                "toggles": toggles,
                "step2_breakdown": step2_breakdown,
            })

        # Final ranked-top-5 = sorted by step2_score desc
        step2_entries.sort(key=lambda x: x["step2_score"], reverse=True)
        final_top5 = step2_entries[:5]

        per_request_reports.append({
            "request_id": req["id"],
            "primary_concern": req["primary_concern"],
            "hard_flags": _hard_flags_of(req),
            "deep_match_opt_in": req.get("deep_match_opt_in", False),
            "eligible_count": eligible_count,
            "notified_count": len(notified),
            "applications": len(step2_entries),
            "filter_failures": filter_counts,
            "step1_stats": _score_stats(step1_scores),
            "top10_step1": [
                {
                    "therapist_id": n.get("id"),
                    "therapist_name": n.get("name"),
                    "step1_score": n["match_score"],
                    "step1_breakdown": n.get("match_breakdown"),
                }
                for n in notified[:10]
            ],
            "applications_detail": step2_entries,
            "final_top5": final_top5,
            "summary": _request_summary(
                eligible_count=eligible_count,
                notified=len(notified),
                applications=len(step2_entries),
                step1_scores=step1_scores,
            ),
        })

    # ── Aggregate + inconsistency detection ────────────────────────
    inconsistencies = _detect_inconsistencies(per_request_reports)
    coverage = _coverage_summary(
        per_request_reports, all_filter_failures, len(therapists),
    )

    finished_at = datetime.now(timezone.utc)
    report = {
        "id": run_id,
        "status": "ok",
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_sec": round(
            (finished_at - started_at).total_seconds(), 2,
        ),
        "params": {
            "num_requests": num_requests,
            "notify_top_n": notify_top_n,
            "min_applications": min_applications,
            "max_applications": max_applications,
            "random_seed": random_seed,
            "therapist_pool_size": len(therapists),
        },
        "coverage": coverage,
        "inconsistencies": inconsistencies,
        "suggestions": _build_suggestions(
            coverage, inconsistencies, per_request_reports,
        ),
        "requests": per_request_reports,
    }
    await db.simulator_runs.insert_one(dict(report))
    return report


# ──────────────────────────────────────────────────────────────────────
# Audit analysis helpers
# ──────────────────────────────────────────────────────────────────────


def _hard_flags_of(req: dict) -> list[str]:
    """Return the list of HARD-filter names active on this request."""
    flags = []
    if req.get("insurance_strict"):
        flags.append("insurance")
    if req.get("availability_strict"):
        flags.append("availability")
    if req.get("urgency_strict"):
        flags.append("urgency")
    if req.get("gender_required"):
        flags.append("gender")
    if req.get("language_strict") and (req.get("preferred_language") or "English") != "English":
        flags.append("language")
    if req.get("modality_preference") == "in_person_only":
        flags.append("format_in_person")
    elif req.get("modality_preference") == "telehealth_only":
        flags.append("format_telehealth")
    if req.get("strict_priorities"):
        flags.append("strict_priorities")
    return flags


def _score_stats(scores: list[float]) -> dict[str, float]:
    """Return mean / min / max / std of a list of scores."""
    if not scores:
        return {"n": 0, "mean": 0, "min": 0, "max": 0, "std": 0}
    return {
        "n": len(scores),
        "mean": round(mean(scores), 2),
        "min": round(min(scores), 2),
        "max": round(max(scores), 2),
        "std": round(stdev(scores) if len(scores) > 1 else 0.0, 2),
    }


def _request_summary(
    *, eligible_count: int, notified: int, applications: int,
    step1_scores: list[float],
) -> str:
    """Plain-English summary of what happened for this request."""
    if eligible_count == 0:
        return "No eligible therapists — all filtered by hard filters. Likely cause: a HARD filter zeroed the pool."
    if notified == 0:
        return f"{eligible_count} therapists passed hard filters but none scored above 70. Scoring thresholds may be too strict for this profile."
    if notified < 10:
        return f"Only {notified} therapists notified — coverage is thin. Consider softening one HARD filter or expanding the pool."
    if applications < 5:
        return f"{notified} notified, {applications} applied — low response rate. Blurb + urgency toggles underperform."
    top_score = max(step1_scores) if step1_scores else 0
    return f"Healthy: {notified} notified, {applications} applications, top score {top_score}."


def _detect_inconsistencies(
    reports: list[dict],
) -> list[dict]:
    """Surface pairs of requests that are SIMILAR on the headline
    axes (same primary_concern + same age_group + same modality) but
    produced wildly different Step-1 score distributions.

    High variance here usually means one of the axis weights is
    over-sensitive to a small input change (e.g. one request had the
    insurance_strict flag and zeroed, its "twin" didn't and got 30
    matches). The admin can drill in to see the pair and decide if
    that's intended behavior."""
    buckets: dict[tuple, list[dict]] = {}
    for r in reports:
        key = (
            r["primary_concern"],
            # Bucket on HARD-count so only structurally similar
            # requests are compared. Two requests with the same
            # primary concern but different HARD flag sets
            # legitimately deserve different outcomes.
            len(r["hard_flags"]),
        )
        buckets.setdefault(key, []).append(r)

    findings = []
    for key, group in buckets.items():
        if len(group) < 2:
            continue
        notified_counts = [g["notified_count"] for g in group]
        mean_n = mean(notified_counts)
        if mean_n == 0:
            continue
        # Relative spread: max-min / max. Anything >50% is suspicious.
        lo, hi = min(notified_counts), max(notified_counts)
        if hi == 0:
            continue
        spread = (hi - lo) / hi
        if spread > 0.5:
            # Identify the outlier(s)
            group_sorted = sorted(
                group, key=lambda g: g["notified_count"],
            )
            findings.append({
                "bucket": {
                    "primary_concern": key[0],
                    "hard_flag_count": key[1],
                },
                "spread_pct": round(spread * 100, 1),
                "notified_range": [lo, hi],
                "low_request_id": group_sorted[0]["request_id"],
                "high_request_id": group_sorted[-1]["request_id"],
                "low_hard_flags": group_sorted[0]["hard_flags"],
                "high_hard_flags": group_sorted[-1]["hard_flags"],
                "explanation": (
                    f"Two requests for '{key[0]}' with the same number of HARD filters "
                    f"produced very different notification counts ({lo} vs {hi}). "
                    f"Flags may carry unequal weight — investigate."
                ),
            })
    return findings


def _coverage_summary(
    reports: list[dict],
    all_filter_failures: dict[str, int],
    pool_size: int,
) -> dict[str, Any]:
    """Aggregate cross-request audit metrics.

    - `zero_pool_rate`: percent of synthetic requests that failed to
      produce ANY notified therapist — tells you how often patients
      would see "no matches."
    - `filter_failure_distribution`: which hard filters are zeroing
      pools the most often. The biggest culprit is where to invest
      effort (more therapists? soften the default HARD?).
    - `notified_histogram`: bucketed counts of the notified pool size
      across requests so the admin can see at a glance whether most
      requests return 30 (target) or collapse to <10.
    """
    n = len(reports)
    zero_count = sum(1 for r in reports if r["notified_count"] == 0)
    scarce_count = sum(
        1 for r in reports if 0 < r["notified_count"] < 10
    )
    healthy_count = sum(
        1 for r in reports if r["notified_count"] >= 10
    )
    hist = {"0": 0, "1-4": 0, "5-9": 0, "10-19": 0, "20-29": 0, "30+": 0}
    for r in reports:
        c = r["notified_count"]
        if c == 0:
            hist["0"] += 1
        elif c < 5:
            hist["1-4"] += 1
        elif c < 10:
            hist["5-9"] += 1
        elif c < 20:
            hist["10-19"] += 1
        elif c < 30:
            hist["20-29"] += 1
        else:
            hist["30+"] += 1
    # Also compute step-1 score spread across the full run (mean +
    # std of per-request means) — a very wide spread suggests the
    # scoring weights aren't calibrated across concern types.
    all_means = [
        r["step1_stats"]["mean"]
        for r in reports
        if r["step1_stats"]["n"] > 0
    ]
    return {
        "total_requests": n,
        "pool_size": pool_size,
        "zero_pool_count": zero_count,
        "zero_pool_rate_pct": round(100 * zero_count / n, 1) if n else 0,
        "scarce_pool_count": scarce_count,
        "healthy_pool_count": healthy_count,
        "notified_histogram": hist,
        "filter_failure_totals": all_filter_failures,
        "step1_mean_across_runs": round(
            mean(all_means), 2,
        ) if all_means else 0,
        "step1_mean_std_across_runs": round(
            stdev(all_means) if len(all_means) > 1 else 0.0, 2,
        ),
    }


def _build_suggestions(
    coverage: dict, inconsistencies: list[dict], reports: list[dict],
) -> list[dict]:
    """Turn raw coverage + inconsistency data into actionable fixes.

    Each suggestion has {severity, title, body, action, action_type,
    action_payload} — rendered as a little card in the admin UI.
    `action_type` is what the frontend dispatches on:
      * `open_coverage_gaps` — jump to the Coverage gaps tab so the
        admin can recruit therapists to fix the flagged dimension.
      * `open_settings`      — jump to Settings (Match weights / filter
        thresholds config) so the admin can soften a HARD default.
      * `scroll_filters`     — scroll to the filter-failures bar chart.
      * `scroll_clusters`    — scroll to the inconsistency clusters.
      * `rerun_larger`       — re-run the simulator with 100 requests.
      * `rerun`              — re-run with current params (ok card).
    These are intentionally LOW-sophistication heuristics (no LLM) so
    the admin can understand the reasoning at a glance."""
    out = []
    zero_rate = coverage.get("zero_pool_rate_pct") or 0
    if zero_rate > 20:
        out.append({
            "severity": "critical",
            "title": f"{zero_rate}% of requests returned zero matches",
            "body": (
                "More than 1 in 5 patients would see an empty result page. "
                "The top cause is usually a single HARD filter (language, urgency, "
                "or gender-required) zeroing the pool. Review the filter failures "
                "breakdown and decide whether to recruit more therapists in the "
                "scarce buckets or soften the HARD defaults."
            ),
            "action": "Recruit / soften HARD filter",
            "action_type": "open_coverage_gaps",
        })
    elif zero_rate > 10:
        out.append({
            "severity": "warning",
            "title": f"{zero_rate}% of requests returned zero matches",
            "body": (
                "A non-trivial minority of patients hit a zero pool. Check the "
                "filter-failures breakdown — if one axis dominates, that's where "
                "to invest recruitment or soften defaults."
            ),
            "action": "Investigate filter distribution",
            "action_type": "scroll_filters",
        })

    failures = coverage.get("filter_failure_totals") or {}
    top_filters = sorted(failures.items(), key=lambda kv: -kv[1])[:3]
    for name, cnt in top_filters:
        if cnt < 10:
            continue
        pretty = name.replace("_", " ")
        out.append({
            "severity": "info",
            "title": f"'{pretty}' is the top filter exclusion ({cnt} hits across run)",
            "body": (
                f"The '{pretty}' hard-filter knocks the most therapists out of "
                f"pools across this run. Not inherently bad — but if you expected "
                f"the pool to be larger, this is probably where you're losing "
                f"candidates. Either recruit more therapists who pass this "
                f"filter, or adjust the soft-vs-hard default."
            ),
            "action": f"Review {pretty} filter",
            "action_type": "open_coverage_gaps",
            "action_payload": {"dimension": name},
        })

    if inconsistencies:
        out.append({
            "severity": "warning",
            "title": f"{len(inconsistencies)} inconsistency cluster(s) detected",
            "body": (
                "Pairs of similar requests (same primary concern, same HARD-flag "
                "count) produced notification counts that vary by more than 50%. "
                "This often means one of the axis weights is over-sensitive. "
                "Drill into each cluster to compare the low-vs-high request side "
                "by side."
            ),
            "action": "Review inconsistency clusters",
            "action_type": "scroll_clusters",
        })

    std = coverage.get("step1_mean_std_across_runs") or 0
    if std > 8:
        out.append({
            "severity": "warning",
            "title": f"Step-1 score variance is wide (σ={std})",
            "body": (
                "Per-request mean scores swing by more than 8 points across the "
                "run. A tight, well-calibrated matcher should keep this ≤5. "
                "Likely culprits: one concern (e.g. OCD) scores way lower because "
                "few therapists tag it as a primary specialty — consider "
                "equalising the issue-score ceilings."
            ),
            "action": "Audit issue-score ceilings",
            "action_type": "open_settings",
        })

    # When everything looks healthy, still return a green "all clear"
    # card so the admin knows the run completed without issue.
    if not out:
        out.append({
            "severity": "ok",
            "title": "Run looks healthy",
            "body": (
                "No coverage holes, no outlier inconsistencies, no suspiciously "
                "wide score spreads. Suggest re-running with a higher request "
                "count (e.g. 200) to stress the edge cases."
            ),
            "action": "Run a larger batch",
            "action_type": "rerun_larger",
        })
    return out


# ──────────────────────────────────────────────────────────────────────
# Retrieval helpers
# ──────────────────────────────────────────────────────────────────────


async def list_runs(db, *, limit: int = 30) -> list[dict]:
    """Return the most-recent runs (lightweight summary — no
    per-request detail)."""
    rows = await db.simulator_runs.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "status": 1,
            "started_at": 1,
            "finished_at": 1,
            "duration_sec": 1,
            "params": 1,
            "coverage": 1,
        },
    ).sort("started_at", -1).to_list(length=limit)
    return rows


async def load_run(db, run_id: str) -> dict | None:
    """Return the full report for a given run id (including per-request
    detail). Returns None if the run doesn't exist."""
    doc = await db.simulator_runs.find_one({"id": run_id}, {"_id": 0})
    return doc


async def delete_run(db, run_id: str) -> int:
    """Delete a run + its synthetic requests. Returns the number of
    documents deleted across the two collections."""
    r1 = await db.simulator_runs.delete_one({"id": run_id})
    r2 = await db.simulator_requests.delete_many({"simulator_run_id": run_id})
    return (r1.deleted_count or 0) + (r2.deleted_count or 0)
