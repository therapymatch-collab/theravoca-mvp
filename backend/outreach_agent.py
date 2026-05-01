"""LLM-powered + PT-scraped outreach agent.

When a patient request has `outreach_needed_count > 0` (we couldn't fill 30 quality
matches from our directory), this module:

1. Scrapes Psychology Today's public directory for the patient's state + city
   to gather REAL therapist candidates (name, phone, license, specialties,
   website). See `pt_scraper.py`.
2. Falls back to Claude Sonnet 4.5 via the Emergent LLM key when PT yields
   too few or fails (network blocked, geo with no listings).
3. Sends each candidate a personalized invite — email when we can guess one
   from their published website, else SMS via Twilio to the listed phone.

To swap in a different scraper or add another data source (state board /
group-practice sites), edit `pt_scraper.scrape_pt_candidates` or add a new
function and merge results in `_find_candidates`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from llm_client import ask_claude, ANTHROPIC_API_KEY

from deps import db
from email_service import _get_app_url, _send, _wrap, BRAND
from helpers import _now_iso, _safe_summary_for_therapist
from pt_scraper import scrape_pt_candidates
from sms_service import send_therapist_referral_sms

logger = logging.getLogger("theravoca.outreach")

# API key is managed by llm_client module
PT_SCRAPING_ENABLED = os.environ.get("PT_SCRAPING_ENABLED", "true").lower() == "true"

# Module-level cache for the new_referral_inquiry template overrides.
# Refreshed at the start of each outreach campaign so admin edits to
# the template propagate within the next outreach run. Avoids per-send
# DB reads.
_NRI_OVERRIDES_CACHE: dict[str, Any] = {"data": None}


async def _load_template_overrides() -> None:
    """Refresh the new_referral_inquiry template override cache."""
    try:
        doc = await db.email_templates.find_one(
            {"key": "new_referral_inquiry"}, {"_id": 0},
        )
        _NRI_OVERRIDES_CACHE["data"] = doc or {}
    except Exception:
        _NRI_OVERRIDES_CACHE["data"] = {}


def _score_pt_candidate(c: dict, request: dict) -> tuple[int, str]:
    """Lightweight scorer for PT-scraped candidates.

    We can't run our full 100-point matching engine because PT doesn't expose
    fee / insurance / availability publicly. So we estimate with what we have:
    specialty overlap (60pt), license-type match (20pt), location signal
    (20pt). Returns `(score, rationale)` for use in the invite email.
    """
    patient_specs = set(request.get("presenting_issues") or [])
    cand_specs = set(c.get("specialties") or [])
    overlap = patient_specs & cand_specs

    spec_score = min(60, len(overlap) * 20) if overlap else 0
    license_score = 20 if c.get("license_types") else 10
    loc_score = 20 if c.get("city") and c.get("state") else 10

    score = max(70, min(95, 50 + spec_score + license_score + loc_score - 30))
    # Match rationale is shown in the invite email to the therapist and
    # in internal admin dashboards. Do NOT reveal where we sourced the
    # candidate (Psychology Today / BetterHelp / a private directory /
    # state-board list) — we don't want those sources feeling poached.
    # Keep the language generic and focused on practice-fit only.
    if overlap:
        rationale = (
            f"Your practice focus on {', '.join(sorted(overlap)).replace('_', ' ')} "
            f"matches this patient's primary concern."
        )
    else:
        rationale = (
            f"Licensed in {c.get('state', 'ID')}; "
            f"located in {c.get('city') or 'the requested area'} for in-person availability."
        )
    return score, rationale


def _normalize_pt_to_outreach(c: dict, request: dict) -> dict:
    """Reshape a PT-scraped card into our outreach-invite candidate schema."""
    score, rationale = _score_pt_candidate(c, request)
    licenses = c.get("license_types") or []
    primary_license = c.get("primary_license") or (licenses[0] if licenses else "")
    return {
        "name": c.get("name", "").strip(),
        "email": (c.get("email") or "").strip(),
        "phone": c.get("phone") or "",
        "license_type": primary_license,
        "specialties": c.get("specialties") or [],
        "modalities": [],  # PT doesn't expose modality slugs reliably
        "city": c.get("city") or "",
        "state": c.get("state") or request.get("location_state") or "ID",
        "match_rationale": rationale,
        "estimated_score": score,
        "source": c.get("source") or "psychology_today",
        "profile_url": c.get("profile_url") or "",
        "website": c.get("website") or "",
    }


async def _find_candidates_external(request: dict) -> list[dict]:
    """Live HTTP scrape of admin-registered external directory URLs.
    Each enabled `app_config.scrape_sources` entry gets fetched in parallel,
    parsed via JSON-LD first then LLM fallback, then normalized into the
    standard outreach candidate shape."""
    try:
        from routes.admin import get_enabled_scrape_sources
        from external_scraper import scrape_external_sources
    except ImportError:
        return []
    enabled = await get_enabled_scrape_sources()
    if not enabled:
        return []
    try:
        bundle = await scrape_external_sources(enabled, total_budget_sec=30.0)
    except Exception as e:
        logger.warning("External scrape failed: %s", e)
        return []
    out: list[dict] = []
    for r in bundle.get("results") or []:
        for c in r.get("candidates") or []:
            out.append(_normalize_pt_to_outreach(c, request))
    out.sort(key=lambda c: c.get("estimated_score") or 0, reverse=True)
    return out


async def _find_candidates_pt(request: dict, count: int) -> list[dict]:
    """Real PT directory scrape, normalized into outreach candidate shape."""
    state = request.get("location_state") or "ID"
    city = request.get("location_city") or ""
    try:
        raw = await scrape_pt_candidates(
            state_code=state, city=city, needed=count, max_pages=3,
        )
    except Exception as e:
        logger.exception("PT scrape failed: %s", e)
        return []
    out = [_normalize_pt_to_outreach(c, request) for c in raw]
    # Sort highest-confidence first so we send invites to the best fits within `count`
    out.sort(key=lambda c: c.get("estimated_score") or 0, reverse=True)
    return out


async def _find_candidates_llm(
    request: dict, count: int = 30,
) -> list[dict]:
    """Ask Claude to generate `count` plausible Idaho therapist candidates that
    match this patient's brief. Used as a fallback when PT scraping yields too
    few real candidates."""
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY missing — skipping outreach")
        return []

    summary = _safe_summary_for_therapist(request)
    summary_text = "\n".join(f"- {k}: {v}" for k, v in summary.items())
    state = request.get("location_state", "ID")
    city = request.get("location_city") or "Boise"

    # Inject any admin-configured external directory URLs so Claude grounds
    # its candidate suggestions on those rosters in addition to PT/DOPL.
    extra_sources_block = ""
    try:
        from routes.admin import get_enabled_scrape_sources
        extra = await get_enabled_scrape_sources()
    except Exception:
        extra = []
    if extra:
        bullets = "\n".join(
            f"  - {s['url']}" + (f"  ({s.get('label')})" if s.get("label") else "")
            for s in extra
        )
        extra_sources_block = (
            "\n\nADDITIONAL DIRECTORY SOURCES (consult these in addition to PT/DOPL):\n"
            f"{bullets}\n"
        )

    prompt = f"""You are an outreach research agent for TheraVoca, a therapist matching service in Idaho.

We need {count} REAL Idaho-licensed therapist candidates for a patient request that we couldn't fill from our directory. Search your training data for therapists you have HIGH CONFIDENCE about — people with real Idaho licenses (LCSW/LMFT/LPC/LCPC/PsyD/PhD) who have public profiles on Psychology Today, Idaho DOPL, group-practice websites, or established Idaho mental-health clinics.

PATIENT BRIEF:
{summary_text}

CRITICAL RULES:
1. ONLY return therapists you have HIGH CONFIDENCE actually exist (you've seen their name + license_type + Idaho city in training data). Do NOT invent.
2. If you can't find {count} confident matches, return FEWER. Returning 5 real candidates is better than 30 fabricated ones.
3. Cities MUST be real Idaho cities (Boise, Meridian, Nampa, Idaho Falls, Pocatello, Coeur d'Alene, Twin Falls, Lewiston, Caldwell, Eagle, Post Falls, Rexburg, Moscow, Sun Valley, Ketchum, etc.).
4. Email must be plausible (their first.last @ their public website domain, or @gmail.com / @yahoo.com for solo practitioners). Don't invent fake domains.
5. License_type must match what their actual license is — don't guess LMFT for someone you only remember as LCSW.
6. Specialties must come from this exact slug list: anxiety, depression, ocd, adhd, trauma_ptsd, relationship_issues, life_transitions, parenting_family, substance_use, eating_concerns, autism_neurodivergence, school_academic_stress.
7. estimated_score should reflect your CONFIDENCE in the match (70=barely confident, 95=very confident this real person fits this brief).{extra_sources_block}

For each candidate, return strict JSON with these fields:
- name: full name + license suffix (e.g. "Sarah Chen, LCSW")
- email: plausible private-practice email
- license_type: one of LCSW, LMFT, LCPC, LPC, PsyD, PhD
- specialties: 1–3 patient-relevant specialties from the slug list above
- modalities: 1–3 modalities (e.g. "CBT", "EMDR", "IFS", "ACT", "DBT")
- city: a real Idaho city near {city}
- state: "{state}"
- match_rationale: one sentence on why this therapist is a fit
- estimated_score: integer 70–95 reflecting your confidence

Return ONLY a JSON array. No prose, no markdown fences. Empty array `[]` is acceptable if you have zero high-confidence matches."""

    resp = await ask_claude(
        prompt,
        system_message=(
            "You are a precise research agent. Never invent therapists. "
            "If unsure, return fewer candidates. Always return valid JSON."
        ),
    )
    if resp is None:
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


async def _find_candidates(request: dict, count: int = 30) -> list[dict]:
    """Hybrid: PT scrape → admin-registered external directory scrape →
    LLM fallback. Each phase only runs if we still need more candidates.

    Honours the `PT_SCRAPING_ENABLED` env flag so we can disable scraping
    quickly if PT changes their HTML or starts rate-limiting us.
    """
    pt_results: list[dict] = []
    if PT_SCRAPING_ENABLED:
        pt_results = await _find_candidates_pt(request, count=count)
        logger.info("PT scrape returned %d candidates (need %d)", len(pt_results), count)

    if len(pt_results) >= count:
        return pt_results[:count]

    # Phase 2: live HTTP scrape of admin-registered external directory URLs.
    ext_results = await _find_candidates_external(request)
    logger.info("External scrape returned %d candidates", len(ext_results))

    # Dedupe by name+city across phases so we don't double-invite.
    seen: set[tuple[str, str]] = {
        ((c.get("name") or "").lower().strip(), (c.get("city") or "").lower().strip())
        for c in pt_results
    }
    merged = list(pt_results)
    for c in ext_results:
        key = ((c.get("name") or "").lower().strip(), (c.get("city") or "").lower().strip())
        if key in seen:
            continue
        seen.add(key)
        merged.append(c)
    if len(merged) >= count:
        return merged[:count]

    # Top up with LLM-generated candidates so the request gets full coverage
    needed_extra = count - len(merged)
    llm_results = await _find_candidates_llm(request, count=needed_extra)
    logger.info("LLM fallback returned %d candidates (needed %d more)",
                len(llm_results), needed_extra)
    for c in llm_results:
        key = ((c.get("name") or "").lower().strip(), (c.get("city") or "").lower().strip())
        if key in seen:
            continue
        seen.add(key)
        merged.append(c)
    return merged[:count]


def _send_invite_sms_body(candidate: dict, request: dict, score: int, opt_out_url: str) -> str:
    """Short Twilio-friendly SMS body for PT-scraped candidates without an email.
    Includes both STOP keyword (Twilio carrier-level) and a one-click
    opt-out URL that also updates our server-side opt-out list."""
    public_url = _get_app_url()
    signup_url = f"{public_url}/therapists/join?invite_request_id={request['id']}"
    location = (request.get("location_city") or "Idaho")
    issues = request.get("presenting_issues") or []
    issue_str = ", ".join(i.replace("_", " ") for i in issues[:2]) or "general care"
    return (
        f"TheraVoca: we have a {location} patient looking for help with {issue_str} — "
        f"estimated {score}% match for your practice. Apply (free 30-day trial): {signup_url}. "
        f"Opt out: {opt_out_url} (or reply STOP)."
    )


async def _send_outreach_invite(
    candidate: dict, request: dict, *, invite_id: str,
) -> dict:
    """Send the outreach via email when we have one, else SMS via Twilio.
    Returns a dict with `{ok, channel, error}` so callers can record the
    attempt for analytics + audit. `invite_id` is used to build an
    unguessable one-click opt-out URL embedded in every send.
    """
    summary = _safe_summary_for_therapist(request)
    first = (candidate.get("name") or "there").split(" ")[0]
    rationale = candidate.get("match_rationale") or "Your specialties align with this patient's needs."
    score = candidate.get("estimated_score") or 75
    email = (candidate.get("email") or "").strip()
    phone = (candidate.get("phone") or "").strip()
    opt_out_url = f"{_get_app_url()}/api/outreach/opt-out/{invite_id}"

    if not email and not phone:
        return {"ok": False, "channel": None, "error": "no_contact_info"}

    if email:
        signup_url = (
            f"{_get_app_url()}/therapists/join"
            f"?invite_request_id={request['id']}&utm_source=outreach&utm_campaign=referral_invite"
        )
        summary_rows = "".join(
            f'<tr><td style="padding:5px 0;color:{BRAND["muted"]};font-size:13px;width:140px;">{k}</td>'
            f'<td style="padding:5px 0;color:{BRAND["text"]};font-size:14px;">{v}</td></tr>'
            for k, v in summary.items()
        )
        # We intentionally do NOT include a "we found you via <source>"
        # attribution line here. Directories like Psychology Today, the
        # state board, or any private list we pull from don't love
        # being cited as recruiting channels. The invite stands on the
        # merits of the match, not the sourcing story.
        source_note = ""

        opt_out_footer = (
            f'<hr style="border:none;border-top:1px solid {BRAND["border"]};margin:28px 0 14px;">'
            f'<p style="color:{BRAND["muted"]};font-size:12px;line-height:1.6;text-align:center;margin:0;">'
            f'Not interested in future referrals? '
            f'<a href="{opt_out_url}" style="color:{BRAND["muted"]};text-decoration:underline;">'
            f'Unsubscribe with one click</a> and we\'ll never email you again.'
            f'</p>'
        )

        # Editable copy from email_templates → "new_referral_inquiry".
        # We render once per outreach send. Falls back to DEFAULTS when
        # admin hasn't customised yet. Reads sync from a module-level
        # cache (refreshed at the start of each outreach campaign in
        # `_load_template_overrides()` below).
        from email_templates import DEFAULTS, render
        overrides = _NRI_OVERRIDES_CACHE.get("data") or {}
        base = dict(DEFAULTS.get("new_referral_inquiry") or {})
        tpl = {**base, **{k: v for k, v in overrides.items() if k in base}}
        vars_ = {
            "first_name": first,
            "score": score,
            "rationale": rationale,
            "signup_url": signup_url,
            "opt_out_url": opt_out_url,
        }
        greeting = render(tpl.get("greeting", "Hi {first_name},"), **vars_)
        intro_html = render(tpl.get("intro", ""), **vars_)
        rationale_html = render(tpl.get("rationale", "{rationale}"), **vars_)
        cta_label = render(tpl.get("cta_label", "Apply for this referral"), **vars_)
        pricing_note = render(tpl.get("pricing_note", ""), **vars_)
        footer = render(tpl.get("footer_note", ""), **vars_)
        subject = render(tpl.get("subject", "TheraVoca referral request — {score}%"), **vars_)
        heading = tpl.get("heading", "New referral inquiry")

        inner = f"""
        <p style="font-size:16px;line-height:1.6;">{greeting}</p>
        <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
          {intro_html}
        </p>
        <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
          <em>{rationale_html}</em>
        </p>
        {source_note}
        <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
            Anonymous referral summary
          </div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            {summary_rows}
          </table>
        </div>
        <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
          {pricing_note}
        </p>
        <p style="margin:28px 0;">
          <a href="{signup_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">
            {cta_label}
          </a>
        </p>
        <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
          {footer}
        </p>
        {opt_out_footer}
        """
        try:
            await _send(
                email,
                subject,
                _wrap(heading, inner),
            )
            return {"ok": True, "channel": "email", "error": None}
        except Exception as e:
            logger.warning("Outreach email failed for %s: %s", email, e)
            if not phone:
                return {"ok": False, "channel": "email", "error": str(e)}

    # SMS path (no email or email send failed but we have a phone)
    body = _send_invite_sms_body(candidate, request, score, opt_out_url)
    try:
        sent_ok = await _send_outreach_sms(phone, body)
        if sent_ok:
            return {"ok": True, "channel": "sms", "error": None}
        return {"ok": False, "channel": "sms", "error": "twilio_not_configured_or_failed"}
    except Exception as e:
        logger.warning("Outreach SMS failed for %s: %s", phone, e)
        return {"ok": False, "channel": "sms", "error": str(e)}


async def _send_outreach_sms(phone: str, body: str) -> bool:
    """Wrap the existing Twilio helper to send a generic invite SMS."""
    from sms_service import send_sms
    res = await send_sms(phone, body)
    return bool(res)


async def _filter_existing_contacts(candidates: list[dict]) -> tuple[list[dict], dict]:
    """Drop candidates whose email OR phone already lives in `therapists` or in any
    prior `outreach_invites`. Match is case-insensitive for email; phone is matched
    on its E.164-normalized digits.

    Returns `(filtered, stats)` where `stats` reports how many were skipped and why.
    """
    if not candidates:
        return [], {"skipped_existing_therapist": 0, "skipped_prior_invite": 0}

    from sms_service import normalize_us_phone

    emails = sorted(
        {(c.get("email") or "").strip().lower() for c in candidates if c.get("email")}
    )
    phones_norm = {
        normalize_us_phone(c.get("phone") or "")
        for c in candidates
        if c.get("phone")
    }
    phones_norm.discard(None)
    phones = sorted(phones_norm)

    if not emails and not phones:
        # Nothing to dedupe against — keep all (e.g. LLM stub candidates without contact)
        return candidates, {"skipped_existing_therapist": 0, "skipped_prior_invite": 0}

    therapist_query = {"$or": []}
    if emails:
        therapist_query["$or"].append({"email": {"$in": emails}})
    if phones:
        therapist_query["$or"].append({"phone": {"$in": phones}})
        therapist_query["$or"].append({"phone_alert": {"$in": phones}})
    therapist_rows = await db.therapists.find(
        therapist_query, {"_id": 0, "email": 1, "phone": 1, "phone_alert": 1},
    ).to_list(length=len(emails) + len(phones))
    therapist_emails = {(r.get("email") or "").lower() for r in therapist_rows}
    therapist_phones = {
        normalize_us_phone(r.get(k) or "")
        for r in therapist_rows
        for k in ("phone", "phone_alert")
    }
    therapist_phones.discard(None)

    invite_query = {"$or": []}
    if emails:
        invite_query["$or"].append({"candidate.email": {"$in": emails}})
    if phones:
        invite_query["$or"].append({"candidate.phone": {"$in": phones}})
    invite_rows = await db.outreach_invites.find(
        invite_query, {"_id": 0, "candidate.email": 1, "candidate.phone": 1},
    ).to_list(length=5000)
    invite_emails = {
        ((r.get("candidate") or {}).get("email") or "").lower() for r in invite_rows
    }
    invite_phones = {
        normalize_us_phone((r.get("candidate") or {}).get("phone") or "")
        for r in invite_rows
    }
    invite_phones.discard(None)

    skip_t = 0
    skip_i = 0
    skip_opt = 0
    out: list[dict] = []

    # Treat shared-mailbox emails (e.g. `info@member.psychologytoday.com`,
    # `contact@…`) as NON-DEDUPING. Many directory scrapes return the
    # same generic mailbox for hundreds of unique therapists, and prior
    # iter-76 logs showed ALL Psychology Today candidates being skipped
    # because of one shared mailbox row. We dedupe on phone alone for
    # those — and if the candidate also lacks a phone, we let them
    # through (the LLM agent already deduped against the public web).
    SHARED_INBOX_PREFIXES = (
        "info@", "contact@", "hello@", "support@", "admin@", "office@",
    )

    def _is_shared_inbox(email: str) -> bool:
        return any(email.startswith(p) for p in SHARED_INBOX_PREFIXES)

    # Bulk-fetch the opt-out subset so we don't round-trip per candidate.
    from outreach_optout import get_opted_out_set
    opted_emails, opted_phones = await get_opted_out_set(emails, phones)

    for c in candidates:
        e = (c.get("email") or "").strip().lower()
        p = normalize_us_phone(c.get("phone") or "")
        e_for_dedupe = "" if _is_shared_inbox(e) else e
        if (e and e in opted_emails) or (p and p in opted_phones):
            skip_opt += 1
            logger.info("Outreach: skipping %s/%s (opted out)", e, p)
            continue
        if (e_for_dedupe and e_for_dedupe in therapist_emails) or (p and p in therapist_phones):
            skip_t += 1
            logger.info("Outreach: skipping %s/%s (already in therapists)", e, p)
            continue
        if (e_for_dedupe and e_for_dedupe in invite_emails) or (p and p in invite_phones):
            skip_i += 1
            logger.info("Outreach: skipping %s/%s (already invited)", e, p)
            continue
        if not e and not p:
            # No contact info — drop silently, can't reach them
            continue
        out.append(c)
    return out, {
        "skipped_existing_therapist": skip_t,
        "skipped_prior_invite": skip_i,
        "skipped_opted_out": skip_opt,
    }


# Backwards-compat alias kept for existing tests that import the old name.
_filter_existing_emails = _filter_existing_contacts


async def run_outreach_for_request(request_id: str) -> dict[str, Any]:
    """Top-level entrypoint. Idempotent via `outreach_run_at` flag."""
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "verification_token": 0}
    )
    if not req:
        return {"error": "request_not_found"}
    if req.get("outreach_run_at"):
        return {"skipped": "already_run", "at": req["outreach_run_at"]}

    # Pull latest editable copy for the new_referral_inquiry email so
    # admin overrides apply to this campaign.
    await _load_template_overrides()

    needed = req.get("outreach_needed_count") or 0
    if needed <= 0:
        return {"skipped": "no_outreach_needed"}

    # Over-fetch so dedupe doesn't shrink us below `needed`. Cap at 2x.
    raw_candidates = await _find_candidates(req, count=min(needed * 2, 60))
    candidates, dedupe_stats = await _filter_existing_contacts(raw_candidates)
    candidates = candidates[:needed]

    sent_email = 0
    sent_sms = 0
    for c in candidates:
        # Pre-create the invite row so we have an invite_id (UUID) to embed as
        # the opt-out token in the outgoing email/SMS before we actually send.
        invite_id = str(uuid.uuid4())
        await db.outreach_invites.insert_one({
            "id": invite_id,
            "request_id": request_id,
            "candidate": c,
            "email_sent": False,
            "sms_sent": False,
            "channel": None,
            "send_error": None,
            "source": c.get("source") or "llm",
            "created_at": _now_iso(),
        })
        result = await _send_outreach_invite(c, req, invite_id=invite_id)
        ok = bool(result.get("ok"))
        channel = result.get("channel")
        if ok and channel == "email":
            sent_email += 1
        elif ok and channel == "sms":
            sent_sms += 1
        await db.outreach_invites.update_one(
            {"id": invite_id},
            {"$set": {
                "email_sent": ok and channel == "email",
                "sms_sent": ok and channel == "sms",
                "channel": channel,
                "send_error": result.get("error"),
                "sent_at": _now_iso() if ok else None,
            }},
        )
        # Resend free tier caps at 5/sec; Twilio at ~1/sec for trial — throttle for both
        await asyncio.sleep(0.5)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "outreach_run_at": _now_iso(),
            "outreach_sent_count": sent_email + sent_sms,
            "outreach_sent_email_count": sent_email,
            "outreach_sent_sms_count": sent_sms,
        }},
    )
    return {
        "ok": True,
        "candidates_found": len(candidates),
        "candidates_raw": len(raw_candidates),
        "emails_sent": sent_email,
        "sms_sent": sent_sms,
        "total_sent": sent_email + sent_sms,
        "skipped_existing_therapist": dedupe_stats["skipped_existing_therapist"],
        "skipped_prior_invite": dedupe_stats["skipped_prior_invite"],
        "skipped_opted_out": dedupe_stats.get("skipped_opted_out", 0),
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
            sent_total += result.get("total_sent", result.get("emails_sent", 0))
    return {"requests_processed": runs, "total_emails_sent": sent_total}
