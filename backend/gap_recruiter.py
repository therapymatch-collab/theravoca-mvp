"""Pre-launch gap-recruiter agent.

Fills systemic holes in the therapist directory regardless of any specific
patient request. Reads the live coverage gap analysis, asks Claude to find
real Idaho therapists matching each gap (specialty, age group, city), and
writes them to `recruit_drafts` as DRY-RUN invites.

Pre-launch behavior (configured): emails are NEVER sent; we use fake
`therapymatch+recruit{NNN}@gmail.com` addresses so the user can preview
the workflow without spamming real therapists.

Daily cron (2am MT) runs this in `dry_run=True` mode to keep the queue fresh.
Admin can review drafts in the UI and click "Send all" once ready post-launch.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

from deps import db
from helpers import _now_iso

logger = logging.getLogger("theravoca.gap_recruiter")

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# Cap how many candidates we ask Claude to find per gap, to keep run-time short.
PER_GAP_CANDIDATES = 5
DRAFT_LIMIT_PER_RUN = 30


async def _ask_for_candidates(gap: dict, count: int = PER_GAP_CANDIDATES) -> list[dict]:
    """Ask Claude for `count` real Idaho therapists who would close `gap`."""
    if not EMERGENT_KEY:
        logger.warning("EMERGENT_LLM_KEY missing — gap recruiter idle")
        return []
    dim = gap.get("dimension")
    key = gap.get("key")

    if dim == "specialty":
        focus = (
            f"specialize in `{key.replace('_', ' ')}` and accept new patients in Idaho"
        )
    elif dim == "modality":
        focus = f"are formally trained in {key} and licensed in Idaho"
    elif dim == "age_group":
        age_label = {
            "child": "children (0–12)", "teen": "adolescents (13–17)",
            "young_adult": "young adults (18–25)", "adult": "adults (26–64)",
            "older_adult": "older adults (65+)",
        }.get(key, key)
        focus = f"see {age_label} as their primary client population in Idaho"
    elif dim == "geography":
        focus = (
            f"have a physical practice office in {key}, Idaho (in-person sessions)"
        )
    elif dim == "client_type":
        focus = f"offer {key} therapy in Idaho"
    elif dim == "insurance":
        focus = f"accept {key} insurance and practice in Idaho"
    else:
        focus = key

    prompt = f"""You are TheraVoca's pre-launch recruiting researcher. Find {count} REAL Idaho-licensed mental-health therapists who {focus}.

CRITICAL RULES:
1. ONLY return therapists you have HIGH CONFIDENCE actually exist (you've seen their name + license + Idaho practice in your training data on Psychology Today, Idaho DOPL, group-practice websites, or established Idaho clinics). Do NOT invent.
2. If you can't find {count} confident matches, return FEWER. Three real candidates is better than ten fabricated ones.
3. Cities MUST be real Idaho cities (Boise, Meridian, Nampa, Idaho Falls, Pocatello, Caldwell, Coeur d'Alene, Twin Falls, Lewiston, Eagle, Post Falls, Rexburg, Moscow, Sun Valley, Ketchum, etc.).
4. License_type must match what their actual license is.

Return a strict JSON array. Each object:
- name: full name + license suffix (e.g. "Sarah Chen, LCSW")
- license_type: one of LCSW, LMFT, LCPC, LPC, PsyD, PhD
- city: a real Idaho city
- state: "ID"
- website: their public profile URL if you remember it, else ""
- specialties: 1–3 patient-relevant specialty slugs from this list ONLY: anxiety, depression, ocd, adhd, trauma_ptsd, relationship_issues, life_transitions, parenting_family, substance_use, eating_concerns, autism_neurodivergence, school_academic_stress
- modalities: 1–3 modality names (e.g. "CBT", "DBT", "EMDR", "IFS", "ACT", "Play Therapy")
- match_rationale: one sentence on why this person fits the gap
- estimated_score: integer 70–95 reflecting your confidence

Return ONLY a JSON array. No prose, no markdown fences. Empty array `[]` is acceptable."""

    chat = (
        LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"gap_recruit_{uuid.uuid4().hex[:10]}",
            system_message=(
                "You are a precise research agent. Never invent therapists. "
                "If unsure, return fewer or none. Always return valid JSON."
            ),
        )
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.exception("Gap recruit LLM call failed: %s", e)
        return []

    text = (resp or "").strip()
    if text.startswith("```"):
        text = text.strip("`").lstrip("json").strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        start, end = text.find("["), text.rfind("]")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                logger.warning("Gap recruit LLM returned non-JSON: %s", text[:200])
                return []
        return []


async def _existing_emails() -> tuple[set[str], set[str]]:
    """Return (therapist_emails, prior_invite_emails) — both lowercased — so
    we don't re-recruit anyone we already have or already invited."""
    t_emails: set[str] = set()
    async for t in db.therapists.find({}, {"_id": 0, "email": 1, "real_email": 1}):
        for k in ("email", "real_email"):
            v = (t.get(k) or "").strip().lower()
            if v:
                t_emails.add(v)
    i_emails: set[str] = set()
    async for inv in db.recruit_drafts.find({}, {"_id": 0, "candidate.email": 1}):
        v = ((inv.get("candidate") or {}).get("email") or "").strip().lower()
        if v:
            i_emails.add(v)
    async for inv in db.outreach_invites.find({}, {"_id": 0, "candidate.email": 1}):
        v = ((inv.get("candidate") or {}).get("email") or "").strip().lower()
        if v:
            i_emails.add(v)
    return t_emails, i_emails


async def _next_fake_email_index() -> int:
    """Pre-launch we use therapymatch+recruitNNN@gmail.com so we can preview
    the workflow without contacting real therapists. Find the next free idx."""
    cur = db.recruit_drafts.find(
        {"candidate.email": {"$regex": r"^therapymatch\+recruit\d+@gmail\.com$"}},
        {"_id": 0, "candidate.email": 1},
    )
    max_n = 100
    async for r in cur:
        e = (r.get("candidate") or {}).get("email") or ""
        try:
            n = int(e.split("recruit")[1].split("@")[0])
            max_n = max(max_n, n)
        except (IndexError, ValueError):
            continue
    return max_n + 1


async def run_gap_recruitment(dry_run: bool = True, max_drafts: int = DRAFT_LIMIT_PER_RUN) -> dict[str, Any]:
    """Identify the top gaps and queue recruit candidates for each.

    Pre-launch (`dry_run=True`): emails set to fake `therapymatch+recruitNNN@gmail.com`
    so we can preview the workflow without spamming. Drafts land in the
    `recruit_drafts` collection with `dry_run=True, sent=False`.

    Post-launch (`dry_run=False`): real candidate email is used and the draft
    is ready for the admin to fire via "Send all".
    """
    # Lazy-import to avoid circular dependency with admin route module.
    from routes.admin import _compute_coverage_gap_analysis

    coverage = await _compute_coverage_gap_analysis()
    gaps = coverage.get("gaps", [])
    if not gaps:
        return {"ok": True, "drafts_created": 0, "skipped": "no_gaps"}

    # Prioritize critical → warning, biggest gap first (admin endpoint already sorts).
    therapist_emails, invite_emails = await _existing_emails()
    next_fake_n = await _next_fake_email_index()
    drafts_created = 0
    candidates_seen = 0

    # Pre-fetch real-name set so we can flag fuzzy duplicates against the
    # imported directory.
    real_names: list[str] = []
    async for t in db.therapists.find({}, {"_id": 0, "name": 1}):
        real_names.append((t.get("name") or "").lower())

    from places_client import is_configured, search_therapist_business
    use_google = is_configured()

    for gap in gaps:
        if drafts_created >= max_drafts:
            break
        candidates = await _ask_for_candidates(gap)
        for c in candidates:
            if drafts_created >= max_drafts:
                break
            if not isinstance(c, dict):
                continue
            real_email = (c.get("email") or "").strip().lower()
            name = (c.get("name") or "").strip()
            if not name:
                continue
            # Dedupe vs existing therapists + prior invites/drafts.
            if real_email and (real_email in therapist_emails or real_email in invite_emails):
                continue
            candidates_seen += 1

            # Pre-launch: replace real email with predictable fake.
            if dry_run:
                fake_email = f"therapymatch+recruit{next_fake_n}@gmail.com"
                next_fake_n += 1
                send_to = fake_email
            else:
                if not real_email:
                    continue
                send_to = real_email

            # Fuzzy name-match flag: did the LLM propose someone whose name
            # already lives in our therapists directory?
            cand_lower = name.lower()
            cand_last = cand_lower.split(",")[0].split()[-1] if cand_lower else ""
            cand_first = cand_lower.split()[0] if cand_lower else ""
            name_match = any(
                cand_last and cand_last in r and cand_first and cand_first in r
                for r in real_names
            )

            # Optional grounding via Google Places: confirm this person has a
            # real Google Business Profile in our state.
            google_meta: dict | None = None
            if use_google:
                try:
                    place = await search_therapist_business(
                        name, c.get("city") or "Boise", c.get("state") or "ID",
                    )
                    if place:
                        google_meta = {
                            "place_id": place.get("id"),
                            "place_name": (place.get("displayName") or {}).get("text", ""),
                            "address": place.get("formattedAddress", ""),
                        }
                except Exception as e:
                    logger.warning("Places lookup failed for %s: %s", name, e)

            await db.recruit_drafts.insert_one({
                "id": str(uuid.uuid4()),
                "gap": {
                    "dimension": gap.get("dimension"),
                    "key": gap.get("key"),
                    "severity": gap.get("severity"),
                },
                "candidate": {
                    "name": name,
                    "email": send_to,
                    "real_email": real_email,
                    "license_type": c.get("license_type") or "",
                    "city": c.get("city") or "",
                    "state": c.get("state") or "ID",
                    "website": c.get("website") or "",
                    "specialties": c.get("specialties") or [],
                    "modalities": c.get("modalities") or [],
                    "match_rationale": c.get("match_rationale") or "",
                    "estimated_score": int(c.get("estimated_score") or 75),
                },
                "name_match_directory": name_match,
                "google_place": google_meta,
                "google_verified": bool(google_meta),
                "dry_run": bool(dry_run),
                "sent": False,
                "sent_at": None,
                "created_at": _now_iso(),
            })
            invite_emails.add(send_to.lower())
            if real_email:
                invite_emails.add(real_email)
            drafts_created += 1

    return {
        "ok": True,
        "drafts_created": drafts_created,
        "candidates_seen": candidates_seen,
        "gaps_processed": len(gaps),
        "dry_run": dry_run,
    }


def _build_recruit_email(candidate: dict) -> tuple[str, str]:
    """Render the recruit email subject + HTML body for a single candidate."""
    from email_service import _wrap, BRAND, _get_app_url

    first = (candidate.get("name") or "there").split(" ")[0]
    rationale = candidate.get("match_rationale") or "Your specialties align with where we're growing."
    signup_url = (
        f"{_get_app_url()}/therapists/join"
        f"?utm_source=gap_recruit&utm_campaign=pre_launch"
    )
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      I'm reaching out from TheraVoca, a small Idaho-based therapist matching service.
      We're building our directory ahead of launch, and your practice came up as a strong fit
      for an underserved area we're trying to fill.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      <em>{rationale}</em>
    </p>
    <p style="margin:28px 0;">
      <a href="{signup_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;
        text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">
        See if TheraVoca is a fit
      </a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      30-day free trial, $45/mo after — no clients, no charge. We don't sell your email.
    </p>
    """
    subject = "Idaho therapist outreach — joining TheraVoca's launch network"
    return subject, _wrap("Pre-launch invite", inner)


async def send_pending_drafts() -> dict[str, Any]:
    """Post-launch: send all unsent, non-dry-run drafts via Resend."""
    from email_service import _send

    cur = db.recruit_drafts.find(
        {"sent": False, "dry_run": False}, {"_id": 0},
    )
    sent = 0
    failed = 0
    async for d in cur:
        c = d.get("candidate") or {}
        subject, html = _build_recruit_email(c)
        try:
            await _send(c.get("email"), subject, html)
            await db.recruit_drafts.update_one(
                {"id": d["id"]},
                {"$set": {
                    "sent": True,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            sent += 1
        except Exception as e:
            logger.warning("Recruit-draft send failed for %s: %s", c.get("email"), e)
            failed += 1
    return {"sent": sent, "failed": failed}


async def send_draft_preview(limit: int = 3, ids: list[str] | None = None) -> dict[str, Any]:
    """Send a small sample of dry-run drafts to their fake recipient address
    so the admin can preview the email's look-and-feel in their own inbox
    (via the Gmail `+alias` trick). Marks the draft `sent_at_preview`."""
    from email_service import _send

    if ids:
        cur = db.recruit_drafts.find({"id": {"$in": ids}}, {"_id": 0})
        rows = await cur.to_list(length=limit * 2)
    else:
        # One per gap dimension up to limit.
        seen_dims: set[str] = set()
        rows: list[dict] = []
        async for d in db.recruit_drafts.find(
            {"sent_at_preview": {"$exists": False}, "dry_run": True}, {"_id": 0},
        ).sort("created_at", -1):
            dim = (d.get("gap") or {}).get("dimension") or ""
            if dim in seen_dims:
                continue
            seen_dims.add(dim)
            rows.append(d)
            if len(rows) >= limit:
                break

    sent = 0
    failed: list[dict] = []
    for d in rows:
        c = d.get("candidate") or {}
        subject, html = _build_recruit_email(c)
        try:
            await _send(c.get("email"), f"[PREVIEW] {subject}", html)
            await db.recruit_drafts.update_one(
                {"id": d["id"]},
                {"$set": {"sent_at_preview": _now_iso()}},
            )
            sent += 1
        except Exception as e:
            failed.append({"id": d["id"], "name": c.get("name"), "error": str(e)})

    return {
        "sent": sent,
        "failed": len(failed),
        "errors": failed,
        "previewed": [{"id": d["id"], "name": (d.get("candidate") or {}).get("name"),
                       "email": (d.get("candidate") or {}).get("email")} for d in rows],
    }
