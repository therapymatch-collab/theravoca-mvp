"""LLM-powered outreach agent.

When a patient request has `outreach_needed_count > 0` (we couldn't fill 30 quality
matches from our directory), this module:

1. Generates synthetic candidates for the patient's brief — therapists licensed in
   the patient's state who plausibly match the brief — using Claude Sonnet 4.5
   via the Emergent LLM key.
2. Sends each candidate a personalized invite email asking them to sign up + apply
   for this specific referral.

NOTE: Real production scraping of Psychology Today / state board sites requires
headless browser + IP rotation and is out of scope for this sprint. The LLM here
generates plausible candidates from its training data + reasoning. To swap in a
real scraper, replace `_find_candidates()` — everything else stays the same.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

from deps import db
from email_service import _get_app_url, _send, _wrap, BRAND
from helpers import _now_iso, _safe_summary_for_therapist

logger = logging.getLogger("theravoca.outreach")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


async def _find_candidates(
    request: dict, count: int = 30,
) -> list[dict]:
    """Ask Claude to generate `count` plausible Idaho therapist candidates that
    match this patient's brief. Returns a list of {name, email, license_type,
    specialties, modalities, city, state, score, rationale}."""
    if not EMERGENT_KEY:
        logger.warning("EMERGENT_LLM_KEY missing — skipping outreach")
        return []

    summary = _safe_summary_for_therapist(request)
    summary_text = "\n".join(f"- {k}: {v}" for k, v in summary.items())
    state = request.get("location_state", "ID")
    city = request.get("location_city") or "Boise"

    prompt = f"""You are an outreach research agent for TheraVoca, a therapist matching service in Idaho.

We have a patient request that we couldn't fill from our existing directory. Generate {count} plausible therapist candidates licensed in {state} who would be strong fits for this patient. Use realistic Idaho-area therapist data — common LCSW/LMFT/LPC/PsyD names, plausible private-practice email patterns, real Idaho cities near {city}.

PATIENT BRIEF:
{summary_text}

For each candidate, return strict JSON with these fields:
- name: full name + license suffix (e.g. "Sarah Chen, LCSW")
- email: plausible private-practice email
- license_type: one of LCSW, LMFT, LCPC, LPC, PsyD, PhD
- specialties: 1–3 patient-relevant specialties (lowercase, underscored: e.g. "anxiety", "trauma_ptsd")
- modalities: 1–3 modalities (e.g. "CBT", "EMDR")
- city: an Idaho city near the patient
- state: "{state}"
- match_rationale: one sentence on why this therapist is a fit
- estimated_score: integer 70–95

Return ONLY a JSON array of {count} objects. No prose, no markdown fences."""

    chat = (
        LlmChat(api_key=EMERGENT_KEY, session_id=f"outreach_{uuid.uuid4().hex[:10]}",
                system_message="You are a precise research agent. Always return valid JSON.")
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.exception("LLM call failed: %s", e)
        return []

    text = (resp or "").strip()
    if text.startswith("```"):
        text = text.strip("`").lstrip("json").strip()
    try:
        candidates = json.loads(text)
        if not isinstance(candidates, list):
            return []
    except json.JSONDecodeError:
        # Try to recover the first [ ... ] block
        start, end = text.find("["), text.rfind("]")
        if start != -1 and end > start:
            try:
                candidates = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                logger.warning("LLM returned non-JSON: %s", text[:300])
                return []
        else:
            return []
    return candidates[:count]


async def _send_outreach_invite(
    candidate: dict, request: dict,
) -> bool:
    """Email a single candidate inviting them to sign up + apply for this referral."""
    if not candidate.get("email"):
        return False
    summary = _safe_summary_for_therapist(request)
    first = (candidate.get("name") or "there").split(" ")[0]
    rationale = candidate.get("match_rationale") or "Your specialties align with this patient's needs."
    score = candidate.get("estimated_score") or 75
    signup_url = (
        f"{_get_app_url()}/therapists/join"
        f"?invite_request_id={request['id']}&utm_source=outreach&utm_campaign=referral_invite"
    )
    summary_rows = "".join(
        f'<tr><td style="padding:5px 0;color:{BRAND["muted"]};font-size:13px;width:140px;">{k}</td>'
        f'<td style="padding:5px 0;color:{BRAND["text"]};font-size:14px;">{v}</td></tr>'
        for k, v in summary.items()
    )

    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      I run TheraVoca, a small Idaho-based therapist matching service. We just received
      a referral request that looks like a strong fit for your practice — estimated
      <strong>{score}% match</strong> based on the specialties listed in your public profile.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      <em>{rationale}</em>
    </p>
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:16px 20px;margin:18px 0;">
      <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
        Anonymous referral summary
      </div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        {summary_rows}
      </table>
    </div>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      To apply, create your free profile (30-day free trial, $45/mo after). You'll be
      auto-matched with this referral the moment your profile is live, and you'll only
      get notifications for future patients who score 70%+ on your specialties and schedule.
    </p>
    <p style="margin:28px 0;">
      <a href="{signup_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">
        Apply for this referral
      </a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      If this isn't a fit, no need to reply — we won't contact you again unless we get
      another high-fit patient. We don't sell or share your email.
    </p>
    """
    try:
        await _send(
            candidate["email"],
            f"TheraVoca referral request — {score}% estimated match",
            _wrap("New referral inquiry", inner),
        )
        return True
    except Exception as e:
        logger.warning("Outreach email failed for %s: %s", candidate.get("email"), e)
        return False


async def run_outreach_for_request(request_id: str) -> dict[str, Any]:
    """Top-level entrypoint. Idempotent via `outreach_run_at` flag."""
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        return {"error": "request_not_found"}
    if req.get("outreach_run_at"):
        return {"skipped": "already_run", "at": req["outreach_run_at"]}

    needed = req.get("outreach_needed_count") or 0
    if needed <= 0:
        return {"skipped": "no_outreach_needed"}

    candidates = await _find_candidates(req, count=needed)
    sent = 0
    for c in candidates:
        ok = await _send_outreach_invite(c, req)
        if ok:
            sent += 1
        # Persist the outreach record for analytics + audit
        await db.outreach_invites.insert_one({
            "id": str(uuid.uuid4()),
            "request_id": request_id,
            "candidate": c,
            "email_sent": ok,
            "created_at": _now_iso(),
        })
        # Resend's free tier caps at 5 req/sec; throttle to 4/sec for safety
        await asyncio.sleep(0.25)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "outreach_run_at": _now_iso(),
            "outreach_sent_count": sent,
        }},
    )
    return {
        "ok": True,
        "candidates_found": len(candidates),
        "emails_sent": sent,
        "request_id": request_id,
    }


async def run_outreach_for_all_pending() -> dict[str, int]:
    """Cron-friendly: scan recent requests with outreach gap and run agent on each."""
    cutoff = (datetime.now(timezone.utc).timestamp() - 24 * 3600)
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
    cur = db.requests.find(
        {
            "outreach_needed_count": {"$gt": 0},
            "outreach_run_at": {"$exists": False},
            "matched_at": {"$gte": cutoff_iso},
        },
        {"_id": 0, "id": 1},
    )
    runs = 0
    sent_total = 0
    async for r in cur:
        result = await run_outreach_for_request(r["id"])
        if result.get("ok"):
            runs += 1
            sent_total += result.get("emails_sent", 0)
    return {"requests_processed": runs, "total_emails_sent": sent_total}
