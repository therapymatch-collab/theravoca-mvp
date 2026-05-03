"""Helpers for TheraVoca: time, summaries, matching, results delivery."""
from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from deps import db, logger, DEFAULT_THRESHOLD, MIN_TARGET_MATCHES
from email_service import send_patient_results, send_therapist_notification
from geocoding import haversine_miles
from matching import gap_axes, rank_therapists
from sms_service import send_therapist_referral_sms


def _parse_iso(s: str) -> Optional[datetime]:
    """Tolerant ISO-8601 parser. Returns None on bad input."""
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except Exception:
        return None


_ACTION_KEYWORDS = (
    "consult", "available", "open slot", "schedule", "next week",
    "this week", "free 15", "intake call", "appointment", "tomorrow",
    "in-person", "telehealth", "offer", "i can see you",
)
# Theoretical max raw_total used to rescale `patient_rank_score` to a
# 0-99 display number. Keep this in sync with the component caps below.
PATIENT_RANK_MAX = 118.0


def compute_patient_rank_score(application: dict, request: dict) -> dict:
    """Compute the Step-2 patient-facing rank for a single application.

    Returns a dict shaped like:
      {
        "patient_rank_score": 0-99 float (rescaled),
        "response_quality": {...component scores 0-12...},
        "rank_components": {...raw step1 / speed / quality / fit / commit...},
      }

    The breakdown surfaces in the patient's UI (tooltip on score chip)
    AND the admin Applications panel so both views agree on ranking.

    Components (raw, pre-rescale):
      - step1_baseline (0-57)  match_score * 0.6, capped at 95% Step-1
      - speed_bonus    (0-30)  faster reply within first 24h scores higher
      - quality_bonus  (0-12)  length + issue match + action signal + voice
      - apply_fit_bonus(0-10)  apply_fit (LLM grade 0-5) * 2
      - commit_bonus   (0-9)   +3 each for confirms_availability/urgency/payment
    Total max raw = 118. Rescaled to 0-99 (raw / 1.18) so the realistic
    top is ~91 and ceiling is 99 â never display 100% (mirrors the 95%
    Step-1 cap philosophy: no relationship is perfect on paper).
    """
    ms = float(application.get("match_score") or 0)
    matched_at = request.get("matched_at") or request.get("created_at")
    matched_dt = _parse_iso(matched_at) if matched_at else None
    speed_bonus = 0.0
    if matched_dt:
        applied_dt = _parse_iso(application.get("created_at") or "")
        if applied_dt:
            hours = max(0.0, (applied_dt - matched_dt).total_seconds() / 3600.0)
            speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))

    msg = (application.get("message") or "").lower()
    msg_len = len(msg)
    len_score = min(6.0, msg_len / 300.0 * 6.0)
    issue_score = 0.0
    patient_issues = [
        i.lower() for i in (request.get("presenting_issues") or []) if i
    ]
    for issue in patient_issues:
        # Match the slug OR human-readable form ("trauma_ptsd" matches
        # "trauma" / "ptsd"). Tokens shorter than 4 chars are dropped to
        # avoid false positives like "ed".
        tokens = [issue] + issue.replace("_", " ").split()
        if any(tok in msg for tok in tokens if len(tok) >= 4):
            issue_score = 3.0
            break
    action_score = 2.0 if any(k in msg for k in _ACTION_KEYWORDS) else 0.0
    personal_score = 1.0 if re.search(
        r"\b(i\s|i'd|i'll|i've|i'm|my\s)", msg,
    ) else 0.0
    quality_bonus = min(
        12.0, len_score + issue_score + action_score + personal_score,
    )

    apply_fit = float(application.get("apply_fit") or 0)
    apply_fit_bonus = round(apply_fit * 2.0, 1)

    commit_bonus = 0.0
    if application.get("confirms_availability"):
        commit_bonus += 3.0
    if application.get("confirms_urgency"):
        commit_bonus += 3.0
    if application.get("confirms_payment"):
        commit_bonus += 3.0

    raw_step2 = (
        ms * 0.6 + speed_bonus + quality_bonus + apply_fit_bonus + commit_bonus
    )
    patient_rank_score = round(min(99.0, raw_step2 / 1.18), 1)
    return {
        "patient_rank_score": patient_rank_score,
        "response_quality": {
            "length": round(len_score, 1),
            "issue_match": issue_score,
            "action_signal": action_score,
            "personal_voice": personal_score,
            "total": round(quality_bonus, 1),
        },
        "rank_components": {
            "step1_baseline": round(ms * 0.6, 1),
            "speed_bonus": round(speed_bonus, 1),
            "quality_bonus": round(quality_bonus, 1),
            "apply_fit_bonus": apply_fit_bonus,
            "commit_bonus": round(commit_bonus, 1),
            "raw_total": round(raw_step2, 1),
            "max_possible": PATIENT_RANK_MAX,
        },
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ââ Background task registry ââââââââââââââââââââââââââââââââââââââââââââââââ
# `asyncio.create_task()` only holds a weak reference to the resulting task,
# so a fire-and-forget task can be garbage-collected mid-execution. We keep a
# strong reference here so background outreach + email + SMS dispatches always
# complete even after the original request handler returns.
_BG_TASKS: set[asyncio.Task] = set()


def _spawn_bg(coro, *, name: str = "bg_task") -> asyncio.Task:
    """Schedule a coroutine as a background task we'll keep referenced until
    completion. Logs exceptions so silent failures don't disappear."""
    task = asyncio.create_task(coro, name=name)
    _BG_TASKS.add(task)

    def _on_done(t: asyncio.Task):
        _BG_TASKS.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.exception("Background task %s failed: %s", t.get_name(), exc)

    task.add_done_callback(_on_done)
    return task


def _ts_to_iso(ts: Optional[int]) -> Optional[str]:
    """Convert a Stripe Unix timestamp to ISO8601, or None."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _strip_id(doc: dict[str, Any]) -> dict[str, Any]:
    doc.pop("_id", None)
    return doc


def _parse_iso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _safe_summary_for_therapist(req: dict[str, Any]) -> dict[str, Any]:
    """Anonymized referral summary for therapists."""
    location_bits = []
    if req.get("location_city"):
        location_bits.append(req["location_city"])
    if req.get("location_zip"):
        location_bits.append(req["location_zip"])
    location_str = ", ".join(location_bits) or "â"
    issues = req.get("presenting_issues") or []
    severity = req.get("issue_severity") or {}
    if isinstance(issues, list):
        parts = []
        for i in issues:
            if not i:
                continue
            label = i.replace("_", " ").title()
            sev = severity.get(i)
            if sev:
                label += f" ({sev}/5)"
            parts.append(label)
        issues_display = ", ".join(parts)
    else:
        issues_display = str(issues)
    payment_type_raw = (req.get("payment_type") or "either").lower()
    insurance_name = (req.get("insurance_name") or "").strip()
    budget = req.get("budget")
    sliding = bool(req.get("sliding_scale_ok"))

    def _budget_str(b):
        try:
            n = int(b)
            return f"${n}/session" if n > 0 else None
        except (TypeError, ValueError):
            return None

    if payment_type_raw == "insurance":
        if insurance_name:
            payment_label = f"Insurance â {insurance_name}"
        else:
            payment_label = "Insurance â carrier not specified"
    elif payment_type_raw == "cash":
        b = _budget_str(budget)
        if b:
            payment_label = f"Cash â up to {b}"
        else:
            payment_label = "Cash â amount not specified"
        if sliding:
            payment_label += " (open to sliding scale)"
    elif payment_type_raw == "either":
        bits = []
        if insurance_name:
            bits.append(f"Insurance: {insurance_name}")
        else:
            bits.append("Insurance: carrier not specified")
        b = _budget_str(budget)
        if b:
            bits.append(f"Cash up to {b}")
        else:
            bits.append("Cash: amount not specified")
        if sliding:
            bits.append("open to sliding scale")
        payment_label = "Either â " + " Â· ".join(bits)
    else:
        payment_label = payment_type_raw.title() or "Not specified"
    avail = req.get("availability_windows") or []
    avail_display = ", ".join(a.replace("_", " ") for a in avail) or "â"
    style = req.get("style_preference") or []
    style_display = ", ".join(s.replace("_", " ") for s in style if s and s != "no_pref") or "â"
    modality_prefs = req.get("modality_preferences") or []
    modality_prefs_display = ", ".join(modality_prefs) if modality_prefs else "â"

    summary = {
        "Client type": (req.get("client_type") or "").title(),
        "Age group": (req.get("age_group") or "").replace("_", " ").title(),
        "State": req.get("location_state"),
        "Location": location_str,
        "Session format": (req.get("modality_preference") or "").replace("_", " ").title(),
        "Payment": payment_label,
        "Presenting issues": issues_display or "â",
        "Preferred therapy approach": modality_prefs_display,
        "Availability": avail_display,
        "Urgency": (req.get("urgency") or "flexible").replace("_", " ").title(),
        "Prior therapy": (req.get("prior_therapy") or "").replace("_", " ").title(),
        "Style preference": style_display,
    }
    # âââ Deep match answers (P1/P2/P3) âââââââââââââââââââââââââââââââââ
    if req.get("deep_match_opt_in"):
        p1 = req.get("p1_communication") or []
        p2 = req.get("p2_change") or []
        p3 = (req.get("p3_resonance") or "").strip()
        _P1_LABELS = {
            "leads_structured": "Someone who leads with structure and direction",
            "follows_lead": "Someone who follows my lead and lets me set the pace",
            "challenges": "Someone who challenges me, even when it's uncomfortable",
            "warm_first": "Someone who's warm and encouraging above all",
            "direct_honest": "Someone who's direct and tells it like it is",
            "guides_questions": "Someone who asks the right questions so I get there myself",
        }
        _P2_LABELS = {
            "deep_emotional": "Go deep into emotions",
            "practical_tools": "Stay practical â give me tools",
            "explore_past": "Look back â understand patterns",
            "focus_forward": "Look forward â focus on who I'm becoming",
            "build_insight": "Help me understand myself",
            "shift_relationships": "Change how I show up in relationships",
        }
        if p1:
            summary["Relationship style (deep match)"] = ", ".join(
                _P1_LABELS.get(v, v.replace("_", " ").title()) for v in p1
            )
        if p2:
            summary["Way of working (deep match)"] = ", ".join(
                _P2_LABELS.get(v, v.replace("_", " ").title()) for v in p2
            )
        if p3:
            summary["What therapist should already get (deep match)"] = p3[:1500]

    # âââ Gender & experience preferences ââââââââââââââââââââââââââââââ
    gender_pref = req.get("gender_preference") or "no_pref"
    if gender_pref and gender_pref != "no_pref":
        summary["Gender preference"] = gender_pref.replace("_", " ").title()
    exp_pref = req.get("experience_preference") or []
    if isinstance(exp_pref, str):
        exp_pref = [exp_pref] if exp_pref else []
    if exp_pref:
        summary["Experience preference"] = ", ".join(
            e.replace("_", " ").title() for e in exp_pref if e
        )

    # âââ Priority factors âââââââââââââââââââââââââââââââââââââââââââââ
    pf = req.get("priority_factors") or []
    if pf:
        summary["Priority factors"] = ", ".join(
            p.replace("_", " ").title() for p in pf if p
        )

    # Always surface the patient's free-text prior-therapy notes when
    # present, regardless of whether they said "yes_helped" or
    # "yes_not_helped". Previously the notes were ONLY shown when the
    # patient said therapy didn't help â but a patient who DID benefit
    # often writes the most actionable signal ("liked her style, took
    # time to get to know us"), and the therapist needs that to write
    # a relevant reply (which the apply-fit grader rewards). The label
    # changes to match the patient's framing.
    notes = (req.get("prior_therapy_notes") or "").strip()
    if notes:
        prior = req.get("prior_therapy") or ""
        label = (
            "What didn't work last time"
            if prior == "yes_not_helped"
            else "What worked last time" if prior == "yes_helped"
            else "Notes on prior therapy"
        )
        summary[label] = notes
    # `other_issue` (the *Anything else?* textarea) is the patient's own
    # free-text framing of what they're looking for. Was previously not
    # surfaced to the therapist at all â same fix as above. Truncated
    # to 1500 chars in the unlikely event of a wall of text.
    other = (req.get("other_issue") or "").strip()
    if other:
        summary["Anything else (patient note)"] = other[:1500]

    # Deep match answers (P1/P2/P3) â only when patient opted in.
    if req.get("deep_match_opt_in"):
        _P1 = {
            "leads_structured": "Someone who leads with structure and direction",
            "follows_lead": "Someone who follows my lead and lets me set the pace",
            "challenges": "Someone who challenges me, even when itâs uncomfortable",
            "warm_first": "Someone whoâs warm and encouraging above all",
            "direct_honest": "Someone whoâs direct and tells it like it is",
            "guides_questions": "Someone who asks the right questions so I get there myself",
        }
        _P2 = {
            "deep_emotional": "Go deep into emotions â feel what Iâve been avoiding",
            "practical_tools": "Stay practical â give me tools I can use this week",
            "explore_past": "Look back â understand where my patterns started",
            "focus_forward": "Look forward â focus on who Iâm becoming",
            "build_insight": "Help me understand myself and why I do what I do",
            "shift_relationships": "Help me change how I show up in my relationships",
        }
        p1 = req.get("p1_communication") or []
        if p1:
            summary["Relationship style (patient)"] = ", ".join(
                _P1.get(s, s.replace("_", " ").title()) for s in p1
            )
        p2 = req.get("p2_change") or []
        if p2:
            summary["Way of working (patient)"] = ", ".join(
                _P2.get(s, s.replace("_", " ").title()) for s in p2
            )
        p3 = (req.get("p3_resonance") or "").strip()
        if p3:
            summary["What they want you to already get"] = p3[:1500]

    return summary


async def _build_decline_history(
    req: dict, therapist_ids: list[str],
) -> dict[str, dict]:
    """Build a {therapist_id: {has_recent_similar_decline: bool}} map for
    every therapist in `therapist_ids`. A decline is "similar" when the
    declined request's primary presenting issue matches the new request's
    primary presenting issue, AND the decline was within the last 30 days.

    This is used by `rank_therapists` to apply a soft 10pt penalty so
    we stop routing the same kind of referral to providers who routinely
    say no to it. It's not a hard filter â capacity may have changed â
    but it should improve our acceptance rate over time.
    """
    if not therapist_ids:
        return {}
    issues = [
        i.lower() for i in (req.get("presenting_issues") or [])
        if i and i.lower() != "other"
    ]
    if not issues:
        return {}
    primary = issues[0]
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=30)
    ).isoformat()
    history: dict[str, dict] = {}
    # Pull every recent decline for these therapists in ONE query then
    # join against requests in a second batch query â cheaper than per-
    # therapist round-trips.
    decline_cursor = db.declines.find(
        {
            "therapist_id": {"$in": therapist_ids},
            "created_at": {"$gte": cutoff},
        },
        {"_id": 0, "therapist_id": 1, "request_id": 1},
    )
    declines = await decline_cursor.to_list(2000)
    if not declines:
        return {}
    decl_request_ids = list({d["request_id"] for d in declines})
    req_cursor = db.requests.find(
        {"id": {"$in": decl_request_ids}},
        {"_id": 0, "id": 1, "presenting_issues": 1},
    )
    decl_request_issues: dict[str, str] = {}
    async for rdoc in req_cursor:
        rissues = [
            i.lower() for i in (rdoc.get("presenting_issues") or [])
            if i and i.lower() != "other"
        ]
        if rissues:
            decl_request_issues[rdoc["id"]] = rissues[0]
    for d in declines:
        tid = d["therapist_id"]
        decl_primary = decl_request_issues.get(d["request_id"])
        if decl_primary == primary:
            history[tid] = {"has_recent_similar_decline": True}
    return history


async def _trigger_matching(request_id: str, threshold: Optional[float] = None) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if threshold is None:
        threshold = req.get("threshold", DEFAULT_THRESHOLD)
    therapists_cursor = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["past_due", "canceled", "unpaid", "incomplete"]},
        }, {"_id": 0},
    )
    therapists = await therapists_cursor.to_list(2000)
    therapist_ids = [t["id"] for t in therapists if t.get("id")]

    # Pre-fetch research caches in one Mongo round-trip so scoring can
    # fold in the evidence-depth + approach-alignment bonus without N+1
    # queries. Cold-cache therapists score without the bonus; we kick
    # off a background warmup so they're ready next time.
    research_caches: dict[str, dict] = {}
    cold_ids: list[str] = []
    research_enabled = False
    try:
        from research_enrichment import is_enabled as _re_enabled
        research_enabled = await _re_enabled()
    except Exception:
        research_enabled = False
    if research_enabled and therapist_ids:
        cur = db.therapists.find(
            {"id": {"$in": therapist_ids}},
            {"_id": 0, "id": 1, "research_cache": 1},
        )
        async for tdoc in cur:
            cache = tdoc.get("research_cache") or {}
            # A cache is "warm" when the deep-research stage has actually
            # extracted themes for this therapist. Otherwise treat as cold.
            if cache.get("themes"):
                research_caches[tdoc["id"]] = cache
            else:
                cold_ids.append(tdoc["id"])

    # Pre-fetch decline history (last 30 days) for every active
    # therapist who's seen a referral with overlapping presenting issues.
    # Used by `rank_therapists` to apply a soft penalty so we don't keep
    # routing the same kind of referral to providers who routinely
    # decline it.
    decline_history = await _build_decline_history(req, therapist_ids)

    # Stamp the active deep-match weights onto the request so
    # `score_therapist` picks them up. Falls back to defaults when the
    # admin hasn't customised them yet. We do a single Mongo lookup
    # rather than threading through rank_therapists' signature.
    if req.get("deep_match_opt_in"):
        from deps import db as _db
        wcfg = await _db.app_config.find_one(
            {"key": "deep_match_weights"}, {"_id": 0},
        )
        if wcfg:
            from matching import _DEEP_MATCH_DEFAULT_WEIGHTS as _D
            req["_deep_weights"] = {
                "relationship_style": float(
                    wcfg.get("relationship_style") or _D["relationship_style"]
                ),
                "way_of_working": float(
                    wcfg.get("way_of_working") or _D["way_of_working"]
                ),
                "contextual_resonance": float(
                    wcfg.get("contextual_resonance") or _D["contextual_resonance"]
                ),
            }

    matches = rank_therapists(
        therapists,
        req,
        threshold=threshold,
        top_n=MIN_TARGET_MATCHES,
        min_results=3,
        research_caches=research_caches,
        decline_history=decline_history,
    )

    already = set(req.get("notified_therapist_ids") or [])
    new_matches = [m for m in matches if m["id"] not in already]

    notified_ids = list(already) + [m["id"] for m in new_matches]
    notified_scores = req.get("notified_scores") or {}
    notified_scores.update({m["id"]: m["match_score"] for m in new_matches})
    notified_breakdowns: dict[str, dict] = req.get("notified_breakdowns") or {}
    notified_breakdowns.update({m["id"]: m.get("match_breakdown") or {} for m in new_matches})
    # Persist the research axes per match (rationale + chips) so the
    # patient results endpoint can read them directly. Folded into the
    # SAME pass as scoring â no separate enrichment step needed.
    research_scores: dict[str, dict] = req.get("research_scores") or {}
    for m in new_matches:
        axes = m.get("research_axes") or {}
        if not axes:
            continue
        bd = m.get("match_breakdown") or {}
        # research_bonus is the delta the cache contributed to the final
        # score; raw_score is what the score WOULD have been without the
        # cache. Explicit subtraction is clearer than chained and/or.
        research_bonus = float(bd.get("research_bonus") or 0)
        final_score = float(m.get("match_score") or 0)
        raw_score = round(final_score - research_bonus, 2)
        research_scores[m["id"]] = {
            "raw_score": raw_score,
            "enriched_score": final_score,
            "delta": research_bonus,
            "evidence_depth": axes.get("evidence_depth") or 0,
            "approach_alignment": axes.get("approach_alignment") or 0,
            "rationale": axes.get("rationale") or "",
            "themes": axes.get("themes") or {},
            "computed_at": _now_iso(),
        }
    notified_distances: dict[str, float] = req.get("notified_distances") or {}
    patient_geo = req.get("patient_geo")
    if patient_geo:
        for m in new_matches:
            offices = m.get("office_geos") or []
            if offices:
                dists = [
                    haversine_miles(patient_geo["lat"], patient_geo["lng"], o["lat"], o["lng"])
                    for o in offices if "lat" in o and "lng" in o
                ]
                if dists:
                    notified_distances[m["id"]] = round(min(dists), 1)

    summary = _safe_summary_for_therapist(req)
    public_url = os.environ.get("PUBLIC_APP_URL", "")
    for m in new_matches:
        notify_email = m.get("notify_email", True)
        notify_sms = m.get("notify_sms", True)
        gaps = gap_axes(m, req, m.get("match_breakdown") or {}, top_n=3)
        if notify_email:
            await send_therapist_notification(
                to=m["email"],
                therapist_name=m["name"].split(",")[0],
                request_id=req["id"],
                therapist_id=m["id"],
                match_score=m["match_score"],
                summary=summary,
                gaps=gaps,
            )
        phone = m.get("phone_alert") or m.get("phone") or ""
        if phone and notify_sms:
            from routes.therapists import generate_signed_url
            apply_url = generate_signed_url(public_url, req["id"], m["id"], "apply")
            try:
                await send_therapist_referral_sms(
                    to=phone,
                    therapist_first_name=m["name"].split(",")[0],
                    match_score=m["match_score"],
                    apply_url=apply_url,
                )
            except Exception as e:
                logger.warning("SMS send failed for therapist %s: %s", m["id"], e)

    notified_total = len(notified_ids)
    outreach_needed_count = max(0, MIN_TARGET_MATCHES - notified_total)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "notified_therapist_ids": notified_ids,
            "notified_scores": notified_scores,
            "notified_breakdowns": notified_breakdowns,
            "notified_distances": notified_distances,
            "research_scores": research_scores,
            "research_enriched_at": _now_iso() if research_scores else None,
            "matched_at": _now_iso(),
            "status": "matched",
            "outreach_needed_count": outreach_needed_count,
        }},
    )
    logger.info(
        "Matched request %s -> notified %d new (total %d, outreach gap %d) at threshold>=%s",
        request_id, len(new_matches), notified_total, outreach_needed_count, threshold,
    )
    # Auto-fire LLM outreach in background if we have a gap to fill
    if outreach_needed_count > 0 and os.environ.get("OUTREACH_AUTO_RUN", "true").lower() == "true":
        try:
            from outreach_agent import run_outreach_for_request
            _spawn_bg(
                run_outreach_for_request(request_id),
                name=f"outreach_for_{request_id[:8]}",
            )
            logger.info(
                "Scheduled background outreach for %s (gap=%d)",
                request_id, outreach_needed_count,
            )
        except Exception as e:
            logger.warning("Could not schedule outreach for %s: %s", request_id, e)

    # Spawn cold-cache warmup in background â non-blocking. Any therapist
    # who scored without the research bonus this round (cache was missing
    # at match time) gets their cache built now so the NEXT patient's
    # match call has the bonus available. The warmup is itself a
    # _spawn_bg fire-and-forget; we don't await it.
    if research_enabled and cold_ids:
        try:
            from research_enrichment import get_or_build_research

            async def _warmup_cold_caches():
                # Cap parallelism to 4 â same as the previous enrichment
                # path. Each one needs a website fetch + LLM call.
                import asyncio as _asyncio
                sem = _asyncio.Semaphore(4)

                async def _one(tid: str):
                    async with sem:
                        t = await db.therapists.find_one({"id": tid}, {"_id": 0})
                        if t:
                            try:
                                await get_or_build_research(t)
                            except Exception as e:
                                logger.debug(
                                    "Research warmup failed for %s: %s", tid, e,
                                )

                await _asyncio.gather(*(_one(t) for t in cold_ids[:30]))

            _spawn_bg(
                _warmup_cold_caches(),
                name=f"cold_cache_warmup_{request_id[:8]}",
            )
            logger.info(
                "Scheduled cold-cache warmup for %d therapists (request %s)",
                len(cold_ids[:30]), request_id,
            )
        except Exception as e:
            logger.warning("Could not schedule cold-cache warmup for %s: %s", request_id, e)
    return {
        "notified_new": len(new_matches),
        "notified_total": notified_total,
        "outreach_needed_count": outreach_needed_count,
        "matches": [
            {"id": m["id"], "name": m["name"], "match_score": m["match_score"]}
            for m in new_matches
        ],
    }


async def _deliver_results(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    research_scores = req.get("research_scores") or {}
    # Single source of truth â same formula the patient + admin views use.
    # Keeps email ordering consistent with what the patient sees on the
    # results page when they click through.
    for a in apps:
        a.update(compute_patient_rank_score(a, req))
        rs = research_scores.get(a["therapist_id"]) or {}
        a["research_rationale"] = rs.get("rationale") or ""
        a["evidence_depth"] = rs.get("evidence_depth") or 0
        a["approach_alignment"] = rs.get("approach_alignment") or 0

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    breakdowns = req.get("notified_breakdowns") or {}
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            t_view = {
                **t,
                "specialties_display": (t.get("primary_specialties") or [])
                + (t.get("secondary_specialties") or []),
            }
            enriched.append({
                **a,
                "therapist": t_view,
                "match_breakdown": breakdowns.get(a["therapist_id"]) or {},
            })

    await send_patient_results(req["email"], request_id, enriched)
    # Mark sent + auto-release the 24h hold so the patient sees results now.
    now_iso = _now_iso()
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "results_sent_at": now_iso,
            "results_released_at": now_iso,
            "status": "completed",
        }},
    )

    # In testing mode, fire all 4 milestone survey emails immediately
    # so the admin doesn't have to wait for the daily cron cycle.
    testing_doc = await db.app_config.find_one({"key": "feedback_testing"}, {"_id": 0})
    if (testing_doc or {}).get("enabled"):
        from email_service import (
            send_patient_followup_48h, send_patient_followup_3w,
            send_patient_followup_9w, send_patient_followup_15w,
        )
        email = req["email"]
        milestones_sent = []
        for code, sender in [
            ("48h", send_patient_followup_48h),
            ("3w", send_patient_followup_3w),
            ("9w", send_patient_followup_9w),
            ("15w", send_patient_followup_15w),
        ]:
            flag = f"structured_followup_{code}_sent_at"
            try:
                await sender(email, request_id)
                await db.requests.update_one(
                    {"id": request_id},
                    {"$set": {flag: now_iso}},
                )
                milestones_sent.append(code)
            except Exception:
                pass  # logged by email_service

    return {"sent_to": req["email"], "count": len(enriched)}


async def _backfill_therapist_geo() -> None:
    """One-shot backfill: geocode any therapist missing office_geos."""
    from geocoding import geocode_offices
    cursor = db.therapists.find(
        {"office_geos": {"$exists": False}},
        {"_id": 0, "id": 1, "office_locations": 1},
    )
    count = 0
    async for doc in cursor:
        geos = await geocode_offices(db, doc.get("office_locations") or [], "ID")
        await db.therapists.update_one({"id": doc["id"]}, {"$set": {"office_geos": geos}})
        count += 1
    if count:
        logger.info("Backfilled office_geos for %d therapists", count)
