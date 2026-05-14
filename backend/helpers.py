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
# Rebalanced 2026-05-12: commit bonus removed (was 9 pts, awarded to
# 100% of applying therapists since the frontend gates submit on all
# three confirmations -- no variance, no signal); apply-message-fit
# and message-quality weights bumped so a thoughtful, on-brief response
# can move the rank meaningfully relative to a generic one.
PATIENT_RANK_MAX = 113.0


def compute_patient_rank_score(application: dict, request: dict) -> dict:
    """Compute the Step-2 patient-facing rank for a single application.

    Returns a dict shaped like:
      {
        "patient_rank_score": 0-99 float (rescaled),
        "response_quality": {...component scores 0-18...},
        "rank_components": {...raw step1 / speed / quality / fit ...},
      }

    The breakdown surfaces in the patient's UI (tooltip on score chip)
    AND the admin Applications panel so both views agree on ranking.

    Components (raw, pre-rescale):
      - step1_baseline (0-45)  match_score * 0.45, capped at ~43 in practice
      - speed_bonus    (0-25)  faster reply within first 24h scores higher
      - quality_bonus  (0-18)  length + issue match + action signal + voice
      - apply_fit_bonus(0-25)  apply_fit (LLM grade 0-5) * 5
      - commit_bonus   (always 0) -- gating only, not scored
    Total max raw = 113. Rescaled to 0-99 (raw / 1.13) so the realistic
    top is ~94 and ceiling is 99 -- never display 100% (mirrors the 95%
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
            speed_bonus = max(0.0, min(25.0, 25.0 * (24.0 - hours) / 24.0))

    msg = (application.get("message") or "").lower()
    msg_len = len(msg)
    len_score = min(9.0, msg_len / 300.0 * 9.0)
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
            issue_score = 4.5
            break
    action_score = 3.0 if any(k in msg for k in _ACTION_KEYWORDS) else 0.0
    personal_score = 1.5 if re.search(
        r"\b(i\s|i'd|i'll|i've|i'm|my\s)", msg,
    ) else 0.0
    quality_bonus = min(
        18.0, len_score + issue_score + action_score + personal_score,
    )

    apply_fit = float(application.get("apply_fit") or 0)
    apply_fit_bonus = round(apply_fit * 5.0, 1)

    # Commit confirmations are now gating-only: the frontend disables
    # submit until all three are checked, so this used to award a flat
    # 9 pts to every applicant -- no variance, no useful signal. Kept
    # as a (0.0) breakdown entry so existing tooltips/admin code that
    # reads rank_components.commit_bonus still find the key.
    commit_bonus = 0.0

    raw_step2 = (
        ms * 0.45 + speed_bonus + quality_bonus + apply_fit_bonus + commit_bonus
    )
    patient_rank_score = round(min(99.0, raw_step2 / 1.13), 1)
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
            "step1_baseline": round(ms * 0.45, 1),
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


# ─── Outreach name parsing ──────────────────────────────────────────────────
# Cold-outreach scrapers (Psychology Today, Google Maps Places, etc.) return
# a "name" field that's USUALLY a person ("Dr. Jane Smith, LCSW") but
# sometimes a business ("Acme Therapy LLC", "Boise Counseling Center").
# Greeting "Hi Acme," reads broken, so this helper tries hard to detect
# company names and returns None when it can't be confident the name is
# a person. Callers should fall back to "Hi there," when None.
#
# This is INTENTIONALLY stricter than email_service._first_name (which is
# used for trusted signup data where the name field is always a person).

_OUTREACH_HONORIFICS = {
    "dr", "dr.", "doctor", "mr", "mr.", "mister", "ms", "ms.", "miss",
    "mrs", "mrs.", "prof", "prof.", "professor", "rev", "rev.", "fr", "fr.",
}

_OUTREACH_CREDENTIALS = {
    # Common mental-health licensure suffixes -- stripped if they appear
    # as a trailing "word" after a person's name.
    "lcsw", "lmft", "lpc", "lcpc", "lpcc", "lmhc", "mft", "msw",
    "phd", "psyd", "md", "do", "ma", "ms", "edd", "np", "pa", "rn",
    "mft-a", "acsw", "csw", "lcsw-r", "lcsw-c", "lcsw-bacs",
    "lp", "lpc-mhsp", "lcdc", "lcdp", "lac", "lpa", "ncc", "ccs",
    "facog", "facp", "facaai",
}

# Words that strongly indicate the "name" field is a business, not a person.
# Conservative on purpose -- when in doubt we'd rather say "Hi there," than
# "Hi Acme,".
_OUTREACH_COMPANY_TOKENS = {
    "therapy", "therapies", "therapeutic", "psychotherapy",
    "counseling", "counselling", "counselors", "counsellors",
    "center", "centre", "clinic", "institute", "foundation",
    "group", "associates", "partners", "services", "solutions",
    "practice", "practices",
    "wellness", "health", "behavioral", "psychological",
    "psychiatric", "mental",
    "network", "alliance", "collective",
    # Legal entity suffixes -- almost always indicate a business.
    "llc", "l.l.c.", "inc", "inc.", "incorporated",
    "pllc", "p.l.l.c.", "pc", "p.c.", "pa", "p.a.",
    "llp", "l.l.p.", "corp", "corporation", "co", "co.",
}


def extract_outreach_first_name(raw_name: Optional[str]) -> Optional[str]:
    """Return a person's first name from a scraped "name" field, or None
    if the value looks like a business / can't be confidently parsed.

    Examples:
      "Sarah Smith"               -> "Sarah"
      "Dr. Sarah Smith"           -> "Sarah"
      "Sarah Smith, LCSW"         -> "Sarah"
      "Sarah Smith LCSW"          -> "Sarah"
      "Dr. Sarah J. Smith, PhD"   -> "Sarah"
      "Acme Therapy LLC"          -> None
      "Boise Counseling Center"   -> None
      "Mental Health Associates"  -> None
      "Smith Counseling"          -> None  (conservative: company-token)
      ""                          -> None
      None                        -> None
      "Sarah"                     -> "Sarah"
    """
    if not raw_name:
        return None
    name = raw_name.strip()
    if not name:
        return None

    # Strip the credentials clause after the FIRST comma. "Sarah Smith,
    # LCSW, MFT" -> "Sarah Smith". This handles the most common signup
    # convention where credentials live after a comma.
    name = name.split(",")[0].strip()
    if not name:
        return None

    # Tokenize. Lowercase copies for matching.
    raw_tokens = name.split()
    lower_tokens = [t.lower().rstrip(".,;:") for t in raw_tokens]

    # Strip leading honorifics (one or more). "Dr. Mr. Smith" -> "Smith".
    while raw_tokens and lower_tokens[0] in _OUTREACH_HONORIFICS:
        raw_tokens.pop(0)
        lower_tokens.pop(0)
    if not raw_tokens:
        return None

    # Strip trailing credentials. "Sarah Smith LCSW PhD" -> "Sarah Smith".
    while raw_tokens and lower_tokens[-1] in _OUTREACH_CREDENTIALS:
        raw_tokens.pop()
        lower_tokens.pop()
    if not raw_tokens:
        return None

    # If ANY remaining token is a company indicator, treat as company.
    for tok in lower_tokens:
        if tok in _OUTREACH_COMPANY_TOKENS:
            return None

    # Take the first remaining token. Strip punctuation that sometimes
    # rides on initials ("J." -> "J").
    first = raw_tokens[0].strip(".,;:'\"")
    if not first:
        return None

    # Reject single-letter "names" (probably an initial like "J. Smith"
    # where the J. was meant to be an initial). Conservative: fall back.
    if len(first) <= 1:
        return None

    # Title-case for display ("SARAH" -> "Sarah", "sarah" -> "Sarah").
    # Credentials + company tokens are already filtered above, so
    # whatever survives is a person's first name.
    return first[:1].upper() + first[1:].lower() if first.isalpha() else first


# -- Background task registry ------------------------------------------------
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
    location_str = ", ".join(location_bits) or " —"
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
            payment_label = f"Insurance — {insurance_name}"
        else:
            payment_label = "Insurance — carrier not specified"
    elif payment_type_raw == "cash":
        b = _budget_str(budget)
        if b:
            payment_label = f"Cash — up to {b}"
        else:
            payment_label = "Cash — amount not specified"
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
        payment_label = "Either — " + " · ".join(bits)
    else:
        payment_label = payment_type_raw.title() or "Not specified"
    avail = req.get("availability_windows") or []
    avail_display = ", ".join(a.replace("_", " ") for a in avail) or " —"
    style = req.get("style_preference") or []
    style_display = ", ".join(s.replace("_", " ") for s in style if s and s != "no_pref") or " —"
    modality_prefs = req.get("modality_preferences") or []
    modality_prefs_display = ", ".join(modality_prefs) if modality_prefs else " —"

    summary = {
        "Client type": (req.get("client_type") or "").title(),
        "Age group": (req.get("age_group") or "").replace("_", " ").title(),
        "State": req.get("location_state"),
        "Location": location_str,
        "Session format": (req.get("modality_preference") or "").replace("_", " ").title(),
        "Payment": payment_label,
        "Presenting issues": issues_display or " —",
        "Preferred therapy approach": modality_prefs_display,
        "Availability": avail_display,
        "Urgency": (req.get("urgency") or "flexible").replace("_", " ").title(),
        "Prior therapy": (req.get("prior_therapy") or "").replace("_", " ").title(),
        "Style preference": style_display,
    }
    # --- Deep match answers (P1/P2/P3) ---------------------------------
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
            "practical_tools": "Stay practical — give me tools",
            "explore_past": "Look back — understand patterns",
            "focus_forward": "Look forward — focus on who I'm becoming",
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

    # --- Gender & experience preferences ------------------------------
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

    # --- Priority factors ---------------------------------------------
    pf = req.get("priority_factors") or []
    if pf:
        summary["Priority factors"] = ", ".join(
            p.replace("_", " ").title() for p in pf if p
        )

    # Always surface the patient's free-text prior-therapy notes when
    # present, regardless of whether they said "yes_helped" or
    # "yes_not_helped". Previously the notes were ONLY shown when the
    # patient said therapy didn't help — but a patient who DID benefit
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
    # surfaced to the therapist at all — same fix as above. Truncated
    # to 1500 chars in the unlikely event of a wall of text.
    other = (req.get("other_issue") or "").strip()
    if other:
        summary["Anything else (patient note)"] = other[:1500]
    return summary


def _minimal_summary_for_outreach(req: dict[str, Any]) -> dict[str, Any]:
    """Trimmed referral summary for COLD outreach to therapists who have
    not signed up yet. The full summary (`_safe_summary_for_therapist`)
    is appropriate AFTER a therapist signs up and explicitly opts into
    referrals; sending it to an un-signed-up therapist surfaces patient
    detail (style/relationship preferences, deep-match answers, prior
    therapy notes, free-text) before they've agreed to anything. Keep
    this teaser to: where the patient is, how they want to meet, how
    they pay, what they're broadly looking for, and how soon -- enough
    for a therapist to decide whether it's worth claiming the referral
    by signing up. The rest unlocks once they're in.
    """
    location_bits = []
    if req.get("location_city"):
        location_bits.append(req["location_city"])
    if req.get("location_zip"):
        location_bits.append(req["location_zip"])
    location_str = ", ".join(location_bits) or "Idaho"

    # Payment: just the type + carrier name when relevant. No specific
    # cash budget (it's a negotiation lever the patient hasn't agreed
    # to share with strangers yet).
    payment_type_raw = (req.get("payment_type") or "either").lower()
    insurance_name = (req.get("insurance_name") or "").strip()
    if payment_type_raw == "insurance":
        payment_label = (
            f"Insurance ({insurance_name})" if insurance_name else "Insurance"
        )
    elif payment_type_raw == "cash":
        payment_label = "Cash / out-of-pocket"
    else:
        payment_label = (
            f"Insurance or cash ({insurance_name})" if insurance_name
            else "Insurance or cash"
        )

    # Issue category: single primary item, no severities, no free-text,
    # no "(4/5)" clinical scoring. Just the category.
    issues = req.get("presenting_issues") or []
    primary_issue = ""
    if isinstance(issues, list) and issues:
        primary_issue = str(issues[0]).replace("_", " ").title()

    summary: dict[str, Any] = {}
    age_group = (req.get("age_group") or "").replace("_", " ").title()
    if age_group:
        summary["Age group"] = age_group
    summary["Location"] = location_str
    fmt = (req.get("modality_preference") or "").replace("_", " ").title()
    if fmt:
        summary["Session format"] = fmt
    summary["Payment"] = payment_label
    if primary_issue:
        summary["Primary concern"] = primary_issue
    urgency = (req.get("urgency") or "").replace("_", " ").title()
    if urgency:
        summary["Urgency"] = urgency
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
    say no to it. It's not a hard filter — capacity may have changed —
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
    # join against requests in a second batch query — cheaper than per-
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


async def _trigger_matching(request_id: str, threshold: Optional[float] = None, top_n: Optional[int] = None) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    # Read global matching defaults from app_config. Per-request body
    # overrides take priority; then global config; then env/hardcoded.
    # No in-memory cache yet (Bug 43 logged for 60s cache).
    if threshold is None or top_n is None:
        mcfg = await db.app_config.find_one(
            {"key": "matching_defaults"}, {"_id": 0},
        ) or {}
        if threshold is None:
            threshold = float(mcfg.get("threshold") or DEFAULT_THRESHOLD)
        if top_n is None:
            top_n = int(mcfg.get("max_invites") or MIN_TARGET_MATCHES)
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

    effective_top_n = top_n if top_n is not None else MIN_TARGET_MATCHES
    all_scored: list[dict] = []
    matches = rank_therapists(
        therapists,
        req,
        threshold=threshold,
        top_n=effective_top_n,
        min_results=3,
        research_caches=research_caches,
        decline_history=decline_history,
        all_scored_out=all_scored,
    )

    already = set(req.get("notified_therapist_ids") or [])
    new_matches = [m for m in matches if m["id"] not in already]

    notified_ids = list(already) + [m["id"] for m in new_matches]
    # Refresh scores and breakdowns for ALL matches (not just new) so
    # re-runs pick up updated therapist data (e.g. newly imported T-fields).
    notified_scores = req.get("notified_scores") or {}
    notified_scores.update({m["id"]: m["match_score"] for m in matches})
    notified_breakdowns: dict[str, dict] = req.get("notified_breakdowns") or {}
    notified_breakdowns.update({m["id"]: m.get("match_breakdown") or {} for m in matches})
    # Persist the research axes per match (rationale + chips) so the
    # patient results endpoint can read them directly. Folded into the
    # SAME pass as scoring — no separate enrichment step needed.
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

    # Build all_scored: every therapist that was scored (including those
    # below threshold or beyond top_n). Enables admin "show all" toggle
    # and flexible cutoff adjustments without re-running matching.
    all_scored_map: dict[str, dict] = {}
    for s in all_scored:
        tid = s.get("id")
        if tid:
            all_scored_map[tid] = {
                "score": s["match_score"],
                "breakdown": s.get("match_breakdown") or {},
            }

    notified_total = len(notified_ids)
    outreach_needed_count = max(0, effective_top_n - notified_total)
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
            "all_scored": all_scored_map,
            "all_scored_at": _now_iso(),
            "effective_threshold": threshold,
            "effective_top_n": effective_top_n,
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

    # Spawn cold-cache warmup in background — non-blocking. Any therapist
    # who scored without the research bonus this round (cache was missing
    # at match time) gets their cache built now so the NEXT patient's
    # match call has the bonus available. The warmup is itself a
    # _spawn_bg fire-and-forget; we don't await it.
    if research_enabled and cold_ids:
        try:
            from research_enrichment import get_or_build_research

            async def _warmup_cold_caches():
                # Cap parallelism to 4 — same as the previous enrichment
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
        "notified": len(new_matches),
        "notified_new": len(new_matches),
        "notified_total": notified_total,
        "all_scored_count": len(all_scored_map),
        "outreach_needed_count": outreach_needed_count,
        "effective_threshold": threshold,
        "effective_top_n": effective_top_n,
        "matches": [
            {"id": m["id"], "name": m["name"], "match_score": m["match_score"]}
            for m in new_matches
        ],
    }


async def _deliver_results(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    # Honor the patient's CAN-SPAM unsubscribe flag. Once a patient has
    # unsubscribed we never send the results email (or any follow-up).
    if req.get("unsubscribed"):
        logger.info(
            f"_deliver_results: skipping unsubscribed patient request={request_id}"
        )
        return {"skipped": "unsubscribed", "request_id": request_id}
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    research_scores = req.get("research_scores") or {}
    # Single source of truth — same formula the patient + admin views use.
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

    # Surveys are NOT auto-fired here. At match-release time the
    # therapists haven't applied yet, so 3w Q1 and 48h Q2b dropdowns
    # would be empty. Surveys are sent only via:
    #   - Daily cron (`_run_patient_surveys_v2`) at the real milestone
    #     windows (48h / 3w / 9w / 15w after results_sent_at).
    #   - Admin "Fire test surveys" button: POST
    #     /admin/requests/{request_id}/fire-test-surveys.
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


async def _next_therapist_survey_number(therapist_id: str) -> int:
    """Return the next survey_number for this therapist (max + 1, or 1 if
    none submitted yet). Keeps survey_number monotonic per-therapist across
    both the cron path (`_run_therapist_surveys`) and the admin manual
    trigger (`/admin/therapists/{tid}/fire-test-survey`)."""
    latest = await db.therapist_surveys.find_one(
        {"therapist_id": therapist_id},
        {"_id": 0, "survey_number": 1},
        sort=[("survey_number", -1)],
    )
    return ((latest or {}).get("survey_number") or 0) + 1
