"""Multi-source outreach agent for therapist recruiting.

When a patient request has `outreach_needed_count > 0` (we couldn't fill our
max-invites target from the directory), this module cascades through real,
public data sources to find therapist candidates:

1. **Google Places API (New)** — PRIMARY source. Returns real Business
   Profiles with name + website + phone in one call. See
   `directory_scrapers.scrape_google_maps` + `places_client.py`. Requires
   `GOOGLE_PLACES_API_KEY`. Highest quality + fastest path to real emails.
2. **Psychology Today** — secondary. Catches therapists who aren't on
   Google Business but are on PT, and adds specialty tags Places doesn't
   expose. Discovery only (no contact info from PT itself).
3. **Admin-registered external directories** — configurable URLs scraped
   via `external_scraper.py`.
4. **Backup directories** — TherapyDen, GoodTherapy (HTML scraping; Google
   Maps is skipped here since it already ran as Phase 1).
5. **Contact enrichment** — every candidate flows through
   `contact_enricher.enrich_batch` which scrapes the therapist's actual
   website for `mailto:` / visible-text emails. Places-sourced candidates
   already have website + phone; PT/external candidates get a Places
   search at this step too. Candidates with no real contact info are
   silently dropped at send-time.

LLM-generated candidates were retired 2026-05-12: the founder's call was
that low-yield, last-resort suggestions weren't worth the ambiguity
(hallucinated names that the enricher couldn't verify). Sources 1-3 cover
Idaho well; if directory coverage becomes thin in a future market, the
right fix is to register more external directory URLs in admin settings.

Each phase only runs when previous phases haven't filled the count.
Candidates are deduplicated by name+city across all sources.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any


from deps import db
from email_service import _get_app_url, _send, _wrap, BRAND
from helpers import (
    _now_iso,
    _minimal_summary_for_outreach,
    extract_outreach_first_name,
)
from pt_scraper import scrape_pt_candidates
from directory_scrapers import scrape_all_backup_sources
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


async def _find_candidates_places(request: dict, count: int) -> list[dict]:
    """Google Places API (New) as PRIMARY discovery + contact source.

    Places returns real Business Profiles with name + website + phone in a
    single call -- so we skip the PT scrape entirely when Places is
    available, and skip the per-candidate enrichment search later.

    Returns candidates already normalized to the outreach shape with
    website + phone populated. Email still needs the website-scrape
    enrichment step downstream.
    """
    state = request.get("location_state") or "ID"
    city = request.get("location_city") or ""
    try:
        from directory_scrapers import scrape_google_maps
        raw = await scrape_google_maps(
            state_code=state,
            city=city,
            needed=count,
            presenting_issues=request.get("presenting_issues"),
        )
    except Exception as e:
        logger.exception("Google Places (primary) discovery failed: %s", e)
        return []
    out = [_normalize_pt_to_outreach(c, request) for c in raw]
    # Pre-clear the fake info@<domain> guesses the scraper writes so the
    # downstream website-scrape enricher can fill in the real email.
    for c in out:
        if (c.get("email") or "").startswith("info@"):
            c.pop("email", None)
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


async def _find_candidates(request: dict, count: int = 30) -> list[dict]:
    """Parallel multi-source fan-out.

    Design (rewritten 2026-05-12 from a speed-first cascade to a
    quantity-first parallel run):
      - ALL discovery sources fire concurrently. No early-exit -- we
        want as many real candidates as possible, not just enough to
        fill `count`.
      - Sources oversample (PT pulls 10 pages instead of 3; profile
        details fetched for up to 200 candidates).
      - Merge + dedup by name+city.
      - Run contact enrichment on the FULL merged set so every
        candidate gets a shot at having a real website/email/phone.
      - Sort by contact-completeness (real email > phone > website)
        and return up to `count` of the best.

    Reactive outreach has a 24h window before delivery, so a 3-5
    minute scrape is fine. Proactive recruit cron runs daily, same.
    Honours PT_SCRAPING_ENABLED.
    """
    state = request.get("location_state") or "ID"
    city = request.get("location_city") or ""

    # Fan out every discovery source in parallel. Each handles its
    # own errors internally and returns [] on failure.
    async def _safe_places():
        try:
            return await _find_candidates_places(request, count=count * 3)
        except Exception as e:
            logger.warning("Places source failed: %s", e)
            return []

    async def _safe_pt():
        if not PT_SCRAPING_ENABLED:
            return []
        try:
            return await _find_candidates_pt(request, count=count * 3)
        except Exception as e:
            logger.warning("PT source failed: %s", e)
            return []

    async def _safe_ext():
        try:
            return await _find_candidates_external(request)
        except Exception as e:
            logger.warning("External source failed: %s", e)
            return []

    async def _safe_backup():
        try:
            raw = await scrape_all_backup_sources(
                state_code=state,
                city=city,
                needed=count * 3,
                presenting_issues=request.get("presenting_issues"),
                skip_google_maps=True,
            )
            return [_normalize_pt_to_outreach(c, request) for c in raw]
        except Exception as e:
            logger.warning("Backup sources failed: %s", e)
            return []

    places_res, pt_res, ext_res, backup_res = await asyncio.gather(
        _safe_places(), _safe_pt(), _safe_ext(), _safe_backup(),
    )

    logger.info(
        "Discovery fan-out: places=%d pt=%d external=%d backup=%d",
        len(places_res), len(pt_res), len(ext_res), len(backup_res),
    )

    # Merge + dedup by (name, city). Order: Places first (highest data
    # density) so duplicates from later sources don't overwrite real
    # website/phone with weaker data.
    seen: set[tuple[str, str]] = set()
    merged: list[dict] = []
    for source_results in (places_res, pt_res, ext_res, backup_res):
        for c in source_results:
            key = ((c.get("name") or "").lower().strip(),
                   (c.get("city") or "").lower().strip())
            if not key[0] or key in seen:
                continue
            seen.add(key)
            merged.append(c)

    logger.info("Merged unique candidates: %d", len(merged))

    # Enrich the FULL merged set (not a count*2 slice) so we maximize
    # the number of candidates that end up with real contact info.
    await _enrich(merged, count)

    # Sort by completeness: real email > real phone > website > nothing.
    def _completeness(c: dict) -> int:
        score = 0
        email = (c.get("email") or "")
        if email and not email.startswith("info@") and "@" in email:
            score += 100
        if c.get("phone"):
            score += 30
        if c.get("website"):
            score += 10
        if c.get("license_types") or c.get("primary_license"):
            score += 5
        if c.get("specialties"):
            score += 3
        return score

    merged.sort(key=_completeness, reverse=True)

    sendable = sum(1 for c in merged if c.get("email") or c.get("phone"))
    logger.info(
        "After enrichment: %d candidates total, %d sendable (have email or phone). Returning top %d.",
        len(merged), sendable, min(count, len(merged)),
    )
    return merged[:count]


async def _enrich(candidates: list[dict], count: int) -> None:
    """Run contact_enricher.enrich_batch on the merged candidate list.

    Pre-clears fake info@<domain> guesses so the enricher's 'skip if
    email already set' guard doesn't block real-email extraction from
    the therapist's actual website.

    Places-sourced candidates already have website + phone; the
    enricher will hit their website to extract the email. Non-Places
    candidates (PT, external) only have name + city; the enricher
    searches Places for them too.
    """
    for c in candidates:
        if (c.get("email") or "").startswith("info@"):
            c.pop("email", None)
    try:
        from contact_enricher import enrich_batch
        # Enrich the FULL merged set, not a count*2 slice. Maximizes the
        # number of candidates that come out the other side with real
        # contact info. Capped at 500 as a safety net against a runaway
        # PT scrape, but typical runs are well under that.
        await enrich_batch(candidates, max_enrich=500)
    except Exception as e:
        logger.warning("Contact enrichment failed: %s", e)


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
    # Cold outreach to UN-signed-up therapists -- intentionally a
    # trimmed teaser, not the full intake. The full summary unlocks
    # AFTER signup when the therapist actually agrees to receive
    # referrals. See `_minimal_summary_for_outreach` for the rationale.
    summary = _minimal_summary_for_outreach(request)
    # Use the strict outreach-name parser -- scraped names sometimes
    # contain company strings ("Acme Therapy LLC"), and "Hi Acme,"
    # reads broken. Falls back to "there" when the parser can't
    # confidently extract a person's first name.
    first = extract_outreach_first_name(candidate.get("name")) or "there"
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
        # _send returns None on three silent-fail paths: missing
        # RESEND_API_KEY, pre-launch safety-guard block, OR an internal
        # Resend exception that _send caught + logged. Previously this
        # function reported ok=True regardless, which lied to the
        # caller -- sent_email got bumped + the invite row was marked
        # email_sent=True even when the network call never happened.
        # Now we explicitly check the return value and only mark ok
        # when _send returned a result dict.
        email_error: Optional[str] = None
        email_result = None
        try:
            email_result = await _send(
                email,
                subject,
                _wrap(heading, inner),
                template_key="new_referral_inquiry",
            )
            if email_result is None:
                email_error = "send_returned_none"
                logger.warning(
                    "Outreach email returned None for invite=%s recipient=%s "
                    "(missing RESEND_API_KEY, blocked by pre-launch safety guard, "
                    "or Resend exception -- check server logs)",
                    invite_id, email,
                )
        except Exception as e:
            email_error = str(e)
            logger.warning("Outreach email exception for invite=%s: %s", invite_id, e)
        if email_result is not None:
            # Capture Resend's email_id so the inbound webhook can match
            # delivery/bounce/open events back to THIS invite. Without
            # this, the webhook falls back to a (looser) email + recent
            # timestamp match.
            return {
                "ok": True,
                "channel": "email",
                "error": None,
                "resend_email_id": email_result.get("id") if isinstance(email_result, dict) else None,
            }
        # Email failed. Fall through to SMS if a phone number is on file;
        # otherwise return the failure so the invite row + counts reflect reality.
        if not phone:
            return {"ok": False, "channel": "email", "error": email_error or "unknown"}

    # SMS path (no email or email send failed but we have a phone)
    body = _send_invite_sms_body(candidate, request, score, opt_out_url)
    try:
        sent_ok = await _send_outreach_sms(phone, body)
        if sent_ok:
            return {"ok": True, "channel": "sms", "error": None}
        return {"ok": False, "channel": "sms", "error": "twilio_not_configured_or_failed"}
    except Exception as e:
        logger.warning("Outreach SMS failed for invite=%s: %s", invite_id, e)
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
        return [], {"skipped_existing_therapist": 0, "skipped_prior_invite": 0, "skipped_hard_bounced": 0}

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

    # Per-therapist re-invite cooldown: a prior invite within the last
    # INVITE_COOLDOWN_DAYS blocks a re-send. Older invites don't block --
    # if they didn't unsubscribe (caught by the opt-out check above) and
    # didn't sign up (caught by the existing-therapist check above), we
    # try them again. Replies and bounces aren't tracked yet (no Resend
    # webhook), so a "no thanks" reply within the window can still get
    # re-pinged after 30 days. Tracked as a follow-up.
    INVITE_COOLDOWN_DAYS = 30
    cooldown_cutoff = (
        datetime.now(timezone.utc) - timedelta(days=INVITE_COOLDOWN_DAYS)
    ).isoformat()

    invite_query: dict = {"$or": []}
    if emails:
        invite_query["$or"].append({"candidate.email": {"$in": emails}})
    if phones:
        invite_query["$or"].append({"candidate.phone": {"$in": phones}})
    invite_query["created_at"] = {"$gte": cooldown_cutoff}
    invite_rows = await db.outreach_invites.find(
        invite_query,
        {"_id": 0, "candidate.email": 1, "candidate.phone": 1, "created_at": 1},
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

    # Bulk-fetch hard-bounced addresses populated by the Resend webhook.
    # Re-emailing a hard-bounced address wastes a send AND damages our
    # sender reputation, so we skip them permanently (no cooldown
    # expiry).
    bounced_emails: set[str] = set()
    if emails:
        async for row in db.bounced_emails.find(
            {"email": {"$in": emails}}, {"_id": 0, "email": 1},
        ):
            be = (row.get("email") or "").strip().lower()
            if be:
                bounced_emails.add(be)

    skip_b = 0

    for c in candidates:
        e = (c.get("email") or "").strip().lower()
        p = normalize_us_phone(c.get("phone") or "")
        e_for_dedupe = "" if _is_shared_inbox(e) else e
        if (e and e in opted_emails) or (p and p in opted_phones):
            skip_opt += 1
            logger.info("Outreach: skipping candidate (opted out)")
            continue
        if e and e in bounced_emails:
            # Hard-bounced previously per Resend webhook -- never re-send.
            skip_b += 1
            logger.info("Outreach: skipping candidate (hard bounced previously)")
            continue
        if (e_for_dedupe and e_for_dedupe in therapist_emails) or (p and p in therapist_phones):
            skip_t += 1
            logger.info("Outreach: skipping candidate (already in therapists)")
            continue
        if (e_for_dedupe and e_for_dedupe in invite_emails) or (p and p in invite_phones):
            skip_i += 1
            logger.info("Outreach: skipping candidate (already invited)")
            continue
        if not e and not p:
            # No contact info — drop silently, can't reach them
            continue
        out.append(c)
    return out, {
        "skipped_existing_therapist": skip_t,
        "skipped_prior_invite": skip_i,
        "skipped_opted_out": skip_opt,
        "skipped_hard_bounced": skip_b,
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

    # Subtract invites already issued for this request so manual re-runs
    # don't keep firing fresh batches of `needed` on top of each other.
    # Previously: gap=11, manual run #1 -> 11 invites, run #2 -> 11 more,
    # run #5 -> 55 total invites for an 11-therapist gap.
    # Now: each run respects what's already in flight. Once we've invited
    # `outreach_needed_count` total, subsequent runs no-op.
    existing_invites = await db.outreach_invites.count_documents(
        {"request_id": request_id},
    )
    remaining = max(0, needed - existing_invites)
    if remaining <= 0:
        logger.info(
            "Outreach skipped for %s: already invited %d (target gap was %d)",
            request_id, existing_invites, needed,
        )
        return {
            "skipped": "already_invited_enough",
            "existing_invites": existing_invites,
            "needed": needed,
        }

    # Over-fetch so dedupe doesn't shrink us below `remaining`. Cap at 2x.
    raw_candidates = await _find_candidates(req, count=min(remaining * 2, 60))
    candidates, dedupe_stats = await _filter_existing_contacts(raw_candidates)
    candidates = candidates[:remaining]

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
        invite_update: dict = {
            "email_sent": ok and channel == "email",
            "sms_sent": ok and channel == "sms",
            "channel": channel,
            "send_error": result.get("error"),
            "sent_at": _now_iso() if ok else None,
        }
        # Capture Resend's email_id when we have one so the inbound
        # webhook can match delivery/bounce/open events back precisely
        # (not just by recipient + timestamp window).
        resend_id = result.get("resend_email_id")
        if resend_id:
            invite_update["resend_email_id"] = resend_id
        await db.outreach_invites.update_one(
            {"id": invite_id},
            {"$set": invite_update},
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
        "skipped_hard_bounced": dedupe_stats.get("skipped_hard_bounced", 0),
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
