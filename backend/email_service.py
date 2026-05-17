"""Email service for TheraVoca via Resend."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

import resend
from dotenv import load_dotenv

from email_templates import get_template, render

# Ensure .env is loaded even if this module is imported before server.py calls load_dotenv()
load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)

# ── Quiet-hours guard 2026-05-17 ─────────────────────────────────
# Josh: "make sure times all emails are sent are always 8-8pm local
# Idaho time. however, new referrals can come in anytime they are
# triggered."
#
# Idaho is in America/Boise (Mountain Time, DST observed). We use
# Resend's native `scheduled_at` field to defer outbound emails to
# the next 8 AM Idaho local time when triggered outside the
# 8 AM–8 PM window. Resend supports scheduling up to 72 hours out,
# which always covers "next 8 AM" from any starting point.
#
# Categorization rule: only DEFER for system-initiated, batched, or
# non-urgent emails. User-initiated flows (sign-in code, intake
# verification, immediate confirmations) and new patient-referral
# notifications to therapists always SEND NOW per Josh.
_IDAHO_TZ = ZoneInfo("America/Boise")
_QUIET_HOURS_START = time(8, 0)    # 8 AM Idaho local
_QUIET_HOURS_END = time(20, 0)     # 8 PM Idaho local

# Templates that respect quiet hours (defer if triggered 8pm–8am).
# Defaults aim to be safe: anything user-facing-batched lives here.
# Add a template key here to start deferring its sends.
_QUIET_HOURS_DEFERRABLE: set[str] = {
    # v2 patient surveys + reminders (research-grade quality, never urgent)
    "patient_survey_v2_48h",
    "patient_survey_v2_3w",
    "patient_survey_v2_9w",
    "patient_survey_v2_15w",
    "patient_survey_v2_48h_reminder",
    "patient_survey_v2_3w_reminder",
    "patient_survey_v2_9w_reminder",
    "patient_survey_v2_15w_reminder",
    # Therapist surveys + follow-ups
    "therapist_followup_2w",
    "therapist_survey",
    # Nudges + maintenance
    "therapist_stale_profile_nag",
    "claim_profile",
    # Cold outbound recruiting (admin can already gate via approval,
    # but quiet-hours is a second belt: don't email a Boise therapist
    # at 11 PM even if the autoreviewer cleared the draft).
    "new_referral_inquiry",
    "prelaunch_invite",
    # Approval / rejection decisions: the therapist isn't actively
    # waiting at a screen; respecting 8–8 is courteous.
    "therapist_approved",
    "therapist_rejected",
    # Status update -- patient is told "we're still working on it";
    # no harm waiting until morning.
    "patient_results_empty",
}

# Templates that ALWAYS send now (user is actively waiting OR Josh's
# rule for referrals). Documented explicitly so the defer set can be
# audited at a glance without inverting the policy in your head.
_QUIET_HOURS_ALWAYS_SEND: set[str] = {
    "verification",                 # user just submitted intake form
    "magic_code",                   # user just clicked sign-in
    "patient_intake_receipt",       # immediate "we got it" confirmation
    "therapist_signup_received",    # immediate "we got your application" confirmation
    "patient_results",              # patient is actively waiting for matches
    "therapist_notification",       # NEW REFERRAL — Josh: always send
}


def _next_idaho_business_hour() -> Optional[datetime]:
    """Return None if current Idaho local time is within 8 AM–8 PM
    (send now); otherwise return the next 8 AM Idaho local time as a
    UTC datetime (suitable for Resend's `scheduled_at` ISO 8601 str).

    Edge cases:
      - 7:59 AM Idaho -> defer to 8:00 AM today
      - 8:00 AM Idaho -> send now (inclusive lower bound)
      - 7:59 PM Idaho -> send now (still inside window)
      - 8:00 PM Idaho -> defer to 8:00 AM tomorrow
      - 11:59 PM Idaho -> defer to 8:00 AM tomorrow
    """
    now_idaho = datetime.now(_IDAHO_TZ)
    now_t = now_idaho.time()
    if _QUIET_HOURS_START <= now_t < _QUIET_HOURS_END:
        return None
    # Compute next 8 AM Idaho local
    if now_t < _QUIET_HOURS_START:
        next_send_local = now_idaho.replace(
            hour=_QUIET_HOURS_START.hour,
            minute=_QUIET_HOURS_START.minute,
            second=0,
            microsecond=0,
        )
    else:
        # past 8 PM -- next 8 AM is tomorrow
        next_send_local = (now_idaho + timedelta(days=1)).replace(
            hour=_QUIET_HOURS_START.hour,
            minute=_QUIET_HOURS_START.minute,
            second=0,
            microsecond=0,
        )
    return next_send_local.astimezone(timezone.utc)


def _compute_scheduled_at(template_key: Optional[str]) -> Optional[str]:
    """Return ISO 8601 string for Resend's scheduled_at if this template
    should defer to next 8 AM Idaho; None means send immediately.

    Unknown template keys (or None) send immediately so any new template
    added later doesn't silently start deferring before being categorized.
    """
    if not template_key:
        return None
    if template_key not in _QUIET_HOURS_DEFERRABLE:
        return None
    scheduled = _next_idaho_business_hour()
    if scheduled is None:
        return None
    return scheduled.isoformat()


def _db():
    """Lazy import to avoid circular dependency with server.py."""
    from server import db  # noqa: WPS433
    return db


def _first_name(name: str) -> str:
    """Strip license suffix and last name. 'Sarah Anderson, LCSW' -> 'Sarah'."""
    return (name or "").split(",")[0].split(" ")[0] or "there"


def _get_api_key() -> str:
    return os.environ.get("RESEND_API_KEY", "")


def _get_sender() -> str:
    """Resend 'from' field. Format: 'Display Name <address>'.
    SENDER_EMAIL env var overrides the address."""
    addr = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    return f"TheraVoca Support <{addr}>"


def _get_reply_to() -> str:
    return os.environ.get("REPLY_TO_EMAIL", "support@theravoca.com")


def _get_app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "")


BRAND = {
    "primary": "#2D4A3E",
    "secondary": "#C87965",
    "bg": "#FDFBF7",
    "text": "#2B2A29",
    "muted": "#6D6A65",
    "border": "#E8E5DF",
}


def _inject_email_block_styles(html: str, *, wysiwyg: bool = False) -> str:
    """Email clients (Gmail, Outlook) aggressively strip default <p>
    margins, so even well-formed HTML renders as one wall-of-text
    block. Inject explicit inline styles on bare opening tags for the
    common block-level elements Quill / hand-written copy produces.
    Tags that already carry a `style=` attribute are left untouched
    to respect author intent.

    Also strips Quill's empty-paragraph artifacts (`<p><br></p>`,
    `<p></p>`, `<p>&nbsp;</p>`) -- when an author hits Enter twice for
    "extra spacing", Quill stores the gap as an empty paragraph. With
    our margin injector, those empty paragraphs balloon into a full
    14px+line-height gap on top of the existing paragraph margin,
    creating signature-line spacing surprises. Cleaner to drop them
    and rely on the consistent 14px paragraph margin instead.
    """
    if not html:
        return html
    import re as _re
    # Non-breaking-space scrub. Quill (and Google-Docs paste through
    # Quill) sometimes stores EVERY inter-word space as `&nbsp;` /
    # ` `. The browser treats those as "do-not-break-here", so
    # the entire paragraph becomes one unbreakable token wider than
    # the 640px email shell -- text overflows horizontally and the
    # preview's `overflow:hidden` clips it mid-word at the right edge.
    # In Gmail the same body wraps only at the em-dashes / `<p>`
    # boundaries (the only break opportunities), making the lines
    # look ragged and unprofessional. Convert ALL `&nbsp;` (and the
    # Unicode   equivalent) to regular spaces: prose emails
    # never need per-word non-break, and the trade-off (a "Dr.\nSmith"
    # wrap is now possible) is much smaller than the wall-of-no-wrap
    # bug Josh caught 2026-05-16.
    html = html.replace("&nbsp;", " ").replace("&#160;", " ").replace(" ", " ")
    # Convert empty paragraphs (Quill's "Enter twice" gap marker --
    # `<p><br></p>`, `<p></p>`, `<p>&nbsp;</p>`, NBSP variants) into a
    # guaranteed-visible spacer div. Bare `<p><br></p>` collapses to
    # zero height in many email clients (and even some browsers) because
    # the `<br>` inside an empty paragraph doesn't reliably take up
    # vertical space the way it does between text. An explicit
    # `<div style="height:14px;...">` always renders.
    #
    # We do this BEFORE the signature-collapse walk so the walk sees
    # only real text paragraphs -- the spacer divs don't match its
    # `<p[^>]*>([^<]*)</p>` pattern, so they're invisible to it but
    # still mark the visual gap the author intended.
    # WYSIWYG mode (broadcasts): keep bare <p><br></p> so editor +
    # preview + Gmail all show the same one-line gap. Without this skip
    # the spacer div added MORE space than the editor, breaking match.
    if not wysiwyg:
        html = _re.sub(
            r"<p(?:\s+[^>]*)?>\s*(?:<br\s*/?>|&nbsp;| |\s)*\s*</p>",
            '<div style="line-height:24px;height:24px;font-size:14px;">&nbsp;</div>',
            html,
            flags=_re.IGNORECASE,
        )

    # Strip mid-paragraph <br> tags that look like hard-wrap artifacts.
    # When an author pastes prose copied from another tool (a draft
    # email, Notes app, anywhere with a fixed-width pane), the line
    # breaks come along as <br> tags. The body then renders with
    # narrow ~60-char lines and a big empty gutter on the right because
    # the email client honours the explicit breaks instead of
    # re-flowing the text to fit its own width.
    #
    # Heuristic: a <br> followed (after optional whitespace) by a
    # lowercase letter is almost always a wrap artifact -- intentional
    # line breaks in prose start a new sentence (capital letter) or a
    # new logical line (signature, list item). Replace those with a
    # single space so the paragraph re-flows. Capital-letter and
    # punctuation cases are preserved.
    #
    # Runs BEFORE signature collapse so the merged signature -- which
    # is built from short text-only paragraphs and gets its OWN <br>
    # separators inside one fresh <p> -- isn't affected. Sig collapse
    # only walks paragraphs matching `<p[^>]*>([^<]*)</p>` (text-only),
    # so paragraphs containing <br> don't qualify in the first place.
    # Aggressive strip: ALL mid-paragraph <br> tags (the lower-case-only
    # heuristic earlier left too many behind when the paste-in source
    # wrapped on a capital letter or punctuation -- "ti<br>mes" might
    # match but "September<br>1st" wouldn't, leaving narrow lines).
    # Trade-off: any author-intended <br> in body text gets eaten too,
    # which is rare for prose broadcasts.
    #
    # Safe to run before signature collapse because the merged signature
    # gets its OWN <br> separators added INSIDE one fresh <p> by the
    # collapse pass below. Pre-collapse paragraphs containing <br> are
    # body text by definition (sig collapse only matches text-only
    # paragraphs `<p[^>]*>([^<]*)</p>`).
    # Strip <br> in two passes so we handle BOTH the common case
    # (between-words <br> from word-wrapped paste) and the surprise
    # case (inside-word <br> from char-wrapped paste). Either case the
    # `<p><br></p>` empty-paragraph marker stays put for the wysiwyg
    # blank-line behaviour.
    #
    # Single pass: <br> followed (after optional whitespace) by a
    # LOWERCASE letter -- a soft-wrap artifact from prose pasted
    # from a narrow pane ("rough<br>for the market" or
    # "ima<br>gine"). Replace with a space so adjacent words don't
    # glue (the worst-case result is "ima gine" which reads as a
    # typo but isn't catastrophic; gluing to "roughfor" would be).
    # Intentional line breaks (sentence starts, signature lines,
    # list items) begin with capitals or punctuation and slip past
    # this heuristic unmodified. The negative lookahead `(?!\s*</p>)`
    # still preserves the empty-paragraph blank-line marker
    # `<br></p>`.
    # 2026-05-16: tightened from "strip ALL <br>" -> "lowercase
    # only" because the all-strip variant collapsed admin-typed
    # signatures like
    #   Best,<br>Joshua Rosenthal, PsyD<br>TheraVoca, Founder
    # onto one wrapped line (Josh caught this in a live sent email).
    # Also dropped a no-space mid-word rejoin pass that was gluing
    # between-word wraps ("rough<br>for" -> "roughfor"). The
    # cost is that the rare char-wrapped paste "ima<br>gine"
    # renders as "ima gine" instead of "imagine"; we judged that
    # acceptable.
    html = _re.sub(
        r"<[Bb][Rr][^>]*>(\s*)(?=[a-z])(?!\s*</p>)",
        r" \1",
        html,
    )
    # Collapse runs of whitespace introduced by the strip back to one
    # space so the paragraph reads cleanly.
    html = _re.sub(r"  +", " ", html)

    # Collapse trailing short <p> tags into a single <p> with <br>
    # separators -- the email-signature pattern. Walk backwards from
    # the end of the body, collecting paragraphs that look like
    # signature lines (short, <= 40 chars). Stop at the first paragraph
    # that's clearly body content (longer, >= 41 chars). Merge the
    # collected signature lines into one tight paragraph.
    #
    # Three guards prevent over-merging:
    #   1. Need at least 2 trailing short paragraphs to merge.
    #   2. There must be at least one longer (body) paragraph BEFORE
    #      the signature run -- otherwise the whole email is short
    #      lines and merging them would destroy the author's
    #      paragraph breaks (e.g. a one-liner email).
    #   3. Cap the merged signature at 6 lines max -- anything longer
    #      is probably not a signature.
    p_iter_pattern = _re.compile(r"<p[^>]*>([^<]*)</p>", _re.IGNORECASE)
    p_matches = list(p_iter_pattern.finditer(html))
    SHORT_MAX = 40
    MAX_SIG_LINES = 6
    sig_start = None
    for i in range(len(p_matches) - 1, -1, -1):
        text = p_matches[i].group(1).strip()
        if 0 < len(text) <= SHORT_MAX:
            sig_start = i
        else:
            break
    can_merge = (
        sig_start is not None
        and sig_start > 0  # body paragraph exists before sig
        and len(p_matches) - sig_start >= 2  # at least 2 sig lines
    )
    if can_merge:
        if len(p_matches) - sig_start > MAX_SIG_LINES:
            sig_start = len(p_matches) - MAX_SIG_LINES
        sig_lines = [
            p_matches[i].group(1).strip()
            for i in range(sig_start, len(p_matches))
        ]
        merged = "<p>" + "<br>".join(sig_lines) + "</p>"
        slice_start = p_matches[sig_start].start()
        slice_end = p_matches[-1].end()
        # Auto-spacer before signature: only in non-wysiwyg mode.
        # In wysiwyg the user controls all spacing -- if they want a
        # gap before "Best," they type a blank line themselves.
        if wysiwyg:
            html = html[:slice_start] + merged + html[slice_end:]
        else:
            # Skip the auto-prepend if the chunk immediately preceding
            # sig_start is already a spacer div (the user did type the
            # blank line, no need to double up).
            preceding_chunk = html[max(0, slice_start - 100):slice_start]
            already_has_spacer = "line-height:24px;height:24px" in preceding_chunk
            spacer = (
                ""
                if already_has_spacer
                else '<div style="line-height:24px;height:24px;font-size:14px;">&nbsp;</div>'
            )
            html = html[:slice_start] + spacer + merged + html[slice_end:]

    # Body paragraph margin restored to 14px after the trailing-short-
    # paragraph collapse handles signatures. Body paragraphs get
    # natural separation; the merged signature renders as one tight
    # block with <br> line breaks (no per-line gap).
    # In wysiwyg mode, drop the `<p>` margin rule so paragraphs
    # render with browser-default (or Gmail's stripped-default) spacing,
    # matching the editor's tight Quill layout. Headings and lists
    # still get their structural margins -- those don't appear in the
    # editor differently because Quill renders them block-level too.
    rules: dict[str, str] = {} if wysiwyg else {
        "p": "margin:0 0 14px 0;",
        "h2": "font-family:Georgia,serif;font-size:20px;color:#2D4A3E;margin:24px 0 8px;line-height:1.3;",
        "h3": "font-family:Georgia,serif;font-size:16px;color:#2D4A3E;margin:20px 0 6px;line-height:1.3;",
        "ul": "margin:0 0 14px 0;padding-left:22px;",
        "ol": "margin:0 0 14px 0;padding-left:22px;",
        "li": "margin:0 0 4px 0;",
        "blockquote": "border-left:3px solid #E8E5DF;margin:14px 0;padding:4px 12px;color:#6D6A65;",
    }
    for tag, style in rules.items():
        # Match `<tag>` or `<tag attr=...>` but skip ones that already
        # have `style=` -- author-set inline styles win.
        pattern = _re.compile(rf"<{tag}(?![^>]*\bstyle=)([^>]*)>", _re.IGNORECASE)
        html = pattern.sub(rf'<{tag}\1 style="{style}">', html)
    return html


def _wrap(
    title: str,
    inner_html: str,
    unsubscribe_url: Optional[str] = None,
    *,
    wysiwyg: bool = False,
) -> str:
    # Inject block-level margins on every <p>, <h2>, <h3>, <ul>, etc. in
    # the body. Without this, Quill-produced HTML (bare <p> tags) renders
    # as a wall of text in Gmail / Outlook because they strip browser
    # default <p> margins.
    #
    # `wysiwyg=True` (broadcasts) skips paragraph-margin injection,
    # spacer-div replacement, and auto-spacer-before-signature so the
    # rendered email exactly mirrors what the author typed in the
    # Quill editor. Transactional emails (verification, license
    # renewal, magic codes) keep wysiwyg=False so system-generated
    # HTML still gets readable paragraph spacing.
    inner_html = _inject_email_block_styles(inner_html, wysiwyg=wysiwyg)
    # CAN-SPAM: any recurring/promotional email gets a one-click unsubscribe
    # link in the footer. Transactional emails (verification, results) pass
    # unsubscribe_url=None to omit the link.
    unsub_line = ""
    if unsubscribe_url:
        unsub_line = (
            f'<br/>Don\'t want these emails? '
            f'<a href="{unsubscribe_url}" style="color:{BRAND["primary"]};text-decoration:underline;">'
            f'Unsubscribe with one click</a>.'
        )
    # Brand header bar (TheraVoca logo) is ALWAYS rendered -- we want
    # consistent branding on every email including broadcasts.
    # The H1 title block is skipped when title is empty so a broadcast
    # opens straight on its greeting (no duplicate "TheraVoca" reading
    # as the email subject). Transactional emails pass a real heading
    # and keep the H1.
    header_block = (
        f"""        <tr><td style="padding:28px 32px;border-bottom:1px solid {BRAND['border']};">
          <span style="font-family:Georgia,serif;font-size:22px;color:{BRAND['primary']};letter-spacing:-0.5px;">TheraVoca</span>
        </td></tr>
"""
    )
    title_block = "" if not (title or "").strip() else (
        f'<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;color:{BRAND["primary"]};line-height:1.2;">{title}</h1>'
    )
    return f"""
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:{BRAND['bg']};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:{BRAND['text']};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{BRAND['bg']};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid {BRAND['border']};border-radius:16px;overflow:hidden;">
{header_block}        <tr><td style="padding:32px;font-size:15px;line-height:1.7;color:{BRAND['text']};">
          {title_block}
          {inner_html}
        </td></tr>
        <tr><td style="padding:20px 32px;background:{BRAND['bg']};color:{BRAND['muted']};font-size:12px;line-height:1.6;border-top:1px solid {BRAND['border']};">
          You received this email from TheraVoca. If this wasn't you, please ignore this message.<br/>
          Questions? Reach us at <a href="mailto:support@theravoca.com" style="color:{BRAND['primary']};text-decoration:underline;">support@theravoca.com</a>.{unsub_line}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""


def _is_safe_test_address(addr: str) -> bool:
    """Pre-launch safety: anything matching `therapymatch+...@gmail.com` is
    a fake placeholder we own (Gmail plus-addressing routes them all to a
    single inbox). Real therapist addresses fail this check.
    """
    a = (addr or "").strip().lower()
    return a.startswith("therapymatch+") and a.endswith("@gmail.com")


async def _log_send(
    *,
    to: str,
    actual_to: str,
    subject: str,
    template_key: Optional[str],
    resend_id: Optional[str],
    sent_ok: bool,
    blocked: bool = False,
    block_reason: Optional[str] = None,
) -> None:
    """Insert one row into `email_sends` for every outbound email attempt.
    Powers the Outbound admin tab's per-template aggregation. Imperfect
    but always-on -- callers don't have to remember to log anything.
    Failures here are swallowed so the email send isn't blocked by a
    logging hiccup.
    """
    try:
        from deps import db as _db
        await _db.email_sends.insert_one({
            "sent_at": _now_iso(),
            "to": (to or "").lower(),
            "actual_to": (actual_to or "").lower(),
            "subject": subject or "",
            "template_key": template_key,
            "resend_email_id": resend_id,
            "sent_ok": bool(sent_ok),
            "blocked": bool(blocked),
            "block_reason": block_reason,
        })
    except Exception as e:
        logger.warning("email_sends log failed: %s", e)


def _now_iso() -> str:
    """Local wrapper to avoid a circular import via helpers.py."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _send(
    to: str,
    subject: str,
    html: str,
    *,
    template_key: Optional[str] = None,
    force: bool = False,
) -> dict[str, Any] | None:
    """Send an email via Resend. Respects the pre-launch safety guard
    unless force=True (reserved for explicit operational sends like an
    incident apology where we MUST reach real addresses outside of the
    normal launch toggle). force=True still respects EMAIL_OVERRIDE_TO
    redirect; it only bypasses the BLOCK on real recipients."""
    api_key = _get_api_key()
    if not api_key:
        logger.warning("RESEND_API_KEY not configured, skipping email send")
        await _log_send(
            to=to, actual_to=to, subject=subject, template_key=template_key,
            resend_id=None, sent_ok=False, blocked=True,
            block_reason="no_resend_api_key",
        )
        return None
    resend.api_key = api_key
    # Dev/test mode: redirect every outbound email to a single inbox (e.g. for Resend test mode)
    override = os.environ.get("EMAIL_OVERRIDE_TO", "").strip()
    # Pre-launch safety guard. Three states:
    #   1. EMAIL_OVERRIDE_TO is set      -> redirect to override (testing safe)
    #   2. EMAIL_LIVE_MODE=true          -> allow real recipient (go-live)
    #   3. neither                       -> BLOCK any send to a real address.
    #      Sends to fake therapymatch+...@gmail.com placeholders still go
    #      through (those route to our own Gmail and can't leak).
    # This is the suspenders for the EMAIL_OVERRIDE_TO belt -- if the
    # override env var ever gets unset by accident, we fail closed.
    live_mode = os.environ.get("EMAIL_LIVE_MODE", "").strip().lower() == "true"
    if not force and not override and not live_mode and not _is_safe_test_address(to):
        # SECURITY (2026-05-16 audit, MEDIUM #9): don't log the full
        # recipient email -- Render's stdout flows to log retention
        # with broader access than the DB. Log the audit-style HMAC
        # hash instead so ops can still grep / correlate. Full
        # address still lands in db.email_sends via _log_send below
        # (which is the authoritative audit source anyway).
        try:
            from audit import _hash_patient_email as _h
            to_id = _h(to)
        except Exception:
            to_id = "<hash-unavailable>"
        logger.warning(
            "PRELAUNCH BLOCK: refusing to send to %s (real address). "
            "Set EMAIL_OVERRIDE_TO to redirect to a test inbox, or "
            "EMAIL_LIVE_MODE=true to go live.",
            f"hash:{to_id}",
        )
        await _log_send(
            to=to, actual_to=to, subject=subject, template_key=template_key,
            resend_id=None, sent_ok=False, blocked=True,
            block_reason="prelaunch_safety_guard",
        )
        return None
    actual_to = override or to
    actual_subject = f"[was: {to}] {subject}" if override and override != to else subject
    params = {
        "from": _get_sender(),
        "to": [actual_to],
        "subject": actual_subject,
        "html": html,
        "reply_to": _get_reply_to(),
    }
    # Quiet-hours guard: defer non-urgent templates to next 8 AM
    # Idaho local. Helper returns None for templates that always
    # send now (referrals, magic codes, intake confirmations) and
    # for sends that happen to land inside the 8 AM–8 PM window.
    # We honor force=True the same way for both -- if the operator
    # is calling _send(force=True), they want immediate delivery
    # regardless of quiet hours.
    scheduled_at = None if force else _compute_scheduled_at(template_key)
    if scheduled_at:
        params["scheduled_at"] = scheduled_at
        actual_subject = f"[scheduled {scheduled_at[:16]}Z] {actual_subject}" if override else actual_subject
        # Don't overwrite the recipient-visible subject in production --
        # only annotate for override-redirected test inboxes so we can
        # confirm the schedule via the inbox listing.
        if override:
            params["subject"] = actual_subject
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(
            "Sent email id=%s template=%s scheduled_at=%s",
            result.get("id"), template_key, scheduled_at,
        )
        await _log_send(
            to=to, actual_to=actual_to, subject=actual_subject,
            template_key=template_key,
            resend_id=result.get("id") if isinstance(result, dict) else None,
            sent_ok=True,
            block_reason=(f"deferred_until:{scheduled_at}" if scheduled_at else None),
        )
        return result
    except Exception as e:
        logger.exception("Failed to send email: %s", e)
        await _log_send(
            to=to, actual_to=actual_to, subject=actual_subject,
            template_key=template_key, resend_id=None, sent_ok=False,
            blocked=False, block_reason=f"resend_exception: {str(e)[:100]}",
        )
        return None


# ─── Templates ─────────────────────────────────────────────────────────────────

async def send_broadcast(
    to: str,
    subject: str,
    body_html: str,
    *,
    heading: str = "",
    unsubscribe_url: Optional[str] = None,
    campaign_id: str = "broadcast",
    force: bool = True,
) -> dict[str, Any] | None:
    """Send one rendered broadcast-campaign email. The body_html is the
    already-substituted body for THIS recipient (variable substitution
    happens upstream in the campaign-send loop). This helper just adds
    the standard wrap + dispatches via _send.

    `heading` defaults to empty so broadcasts render letter-style (no
    brand-logo header bar, no H1) -- the body opens straight on its
    greeting line. Pass an explicit string to restore the branded
    transactional layout.

    campaign_id flows through to email_sends via template_key so the
    Outbound admin tab can group + count per-campaign metrics.
    """
    return await _send(
        to,
        subject,
        _wrap(heading, body_html, unsubscribe_url=unsubscribe_url, wysiwyg=True),
        template_key=f"campaign:{campaign_id}",
        force=force,
    )


async def send_incident_apology(
    to: str, first_name: str, *, force: bool = True,
) -> dict[str, Any] | None:
    """One-shot apology to therapists who received unintended SMS during
    the 2026-05-13 pre-launch test incident. Hard-coded copy (not in
    the editable template store) so it can't drift between draft and
    send for what should be a single batch run.

    `force=True` bypasses the pre-launch safety guard -- we WANT this
    to land on real addresses; that's the entire point of the apology.
    The send is logged in email_sends so we have an audit trail of who
    received it.
    """
    first = first_name or "there"
    subject = "An apology from TheraVoca -- and a promise"
    signup_url = f"{_get_app_url()}/therapists/join"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">Hi {first},</p>

    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      I'm writing to apologize. You may have recently received an
      unexpected text from TheraVoca &mdash; possibly more than one &mdash;
      about a "referral match" for a patient. I owe you a real explanation.
    </p>

    <h3 style="font-family:Georgia,serif;font-size:18px;color:{BRAND['primary']};margin:24px 0 8px;">
      What happened
    </h3>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      TheraVoca is a small Idaho-only patient-therapist matching service,
      currently pre-launch. While testing the system in the past week, a
      configuration mistake on my end caused our outbound SMS path to fire
      real messages to therapists we'd identified from public practice
      listings (Psychology Today, state board directories) &mdash;
      including yours. You never opted in, and we never had a prior
      relationship. I should have caught this before going anywhere near
      a real phone number.
    </p>

    <h3 style="font-family:Georgia,serif;font-size:18px;color:{BRAND['primary']};margin:24px 0 8px;">
      What I did about it
    </h3>
    <ul style="font-size:15px;line-height:1.7;color:{BRAND['text']};padding-left:18px;">
      <li>Added a hard safety guard that physically blocks any SMS or email
          to a real address unless a "live mode" flag is explicitly set.
          The same config mistake can't repeat.</li>
      <li>Built an audit log of every message attempt so I can see exactly
          what shipped, to whom, and when.</li>
      <li>Removed your number from our outreach list. You won't hear from
          us again unless you actively sign up.</li>
    </ul>

    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      If you'd like to opt in &mdash; TheraVoca is genuinely useful for
      Idaho therapists looking for a steady stream of warm patient matches
      without paying for a Psychology Today subscription &mdash; you can
      claim your profile here:
    </p>
    <p style="margin:18px 0;">
      <a href="{signup_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">
        Claim your profile
      </a>
    </p>

    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      But if you'd rather we leave you alone, you don't need to do
      anything. That's the default state from here on out.
    </p>

    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      If you have questions, frustrations, or want me to elaborate on any
      of the above &mdash; reply to this email. It goes to me directly,
      not a support queue.
    </p>

    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};margin-top:24px;">
      Sincerely,<br/>
      Josh Rosenthal<br/>
      Founder, TheraVoca
    </p>
    """
    return await _send(
        to,
        subject,
        _wrap("An apology from TheraVoca", inner),
        template_key="incident_apology_2026_05_13",
        force=force,
    )


async def send_verification_email(to: str, request_id: str, token: str) -> None:
    tpl = await get_template(_db(), "verification")
    verify_url = f"{_get_app_url()}/verify/{token}"
    # Include the template's greeting (e.g. "Hello,") on its own line --
    # matches the pattern used by other emails. Without this, the
    # greeting field on the template renders blank in the actual email.
    greeting = render(tpl.get("greeting", ""), verify_url=verify_url)
    intro = render(tpl["intro"], verify_url=verify_url)
    cta_label = render(tpl["cta_label"], verify_url=verify_url)
    footer_note = render(tpl["footer_note"], verify_url=verify_url)
    cta_html = (
        f'<p style="margin:28px 0;">'
        f'<a href="{verify_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
    ) if cta_label else ""
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:16px;line-height:1.6;color:{BRAND['text']};")}
    {cta_html}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">{footer_note}<br/>
      <span style="word-break:break-all;color:{BRAND['primary']};">{verify_url}</span>
    </p>
    """
    subject = render(tpl["subject"], verify_url=verify_url)
    await _send(to, subject, _wrap(tpl["heading"], inner), template_key="verification")


async def send_therapist_notification(
    to: str,
    therapist_name: str,
    request_id: str,
    therapist_id: str,
    match_score: float,
    summary: dict[str, Any],
    gaps: Optional[list[dict[str, Any]]] = None,
) -> None:
    # PHI-trimmed (HIPAA Phase 2, mockup at /email-trim-mockup.html).
    # The match score, anonymous summary table, and gaps explanation
    # all moved out of the email body and into the secure portal landing
    # page (TherapistApply). The email now carries only: therapist's
    # first name, "you have a referral" copy, and the signed apply/decline
    # CTAs. `summary` and `gaps` are still accepted for backward-compat
    # with callers, but are no longer rendered in the email itself.
    tpl = await get_template(_db(), "therapist_notification")
    first_name = _first_name(therapist_name)
    from routes.therapists import generate_signed_url
    app_url = _get_app_url()
    apply_url = generate_signed_url(app_url, request_id, therapist_id, "apply")
    # decline_url retained in vars_ so admins customizing the template
    # can still reference {decline_url} if they want to add the decline
    # CTA back. The default template no longer includes a "Not interested"
    # button in the email body because the therapist has zero referral
    # detail at email time -- declining without context is a bad UX.
    # The decline action lives on the apply page itself where the
    # therapist has full info.
    decline_url = generate_signed_url(app_url, request_id, therapist_id, "decline")
    portal_url = f"{_get_app_url()}/portal/therapist"
    bulk_cta = (
        f'<p style="color:{BRAND["muted"]};font-size:13px;line-height:1.6;text-align:center;'
        f'margin:18px 0 0;">'
        f'Have multiple referrals waiting? '
        f'<a href="{portal_url}" style="color:{BRAND["primary"]};text-decoration:underline;">'
        f'Open your dashboard</a> to review them all in one place.'
        f'</p>'
    )
    # match_score is no longer rendered in the email body, but we keep
    # it in vars_ so an admin who customizes the template copy can still
    # reference {match_score} if they ever want to put it back.
    vars_ = {"first_name": first_name, "match_score": int(match_score), "apply_url": apply_url, "decline_url": decline_url}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    cta_label = render(tpl["cta_label"], **vars_) or "View referral & decide"
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:16px;line-height:1.6;color:{BRAND['text']};")}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
      <tr>
        <td>
          <a href="{apply_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>
        </td>
      </tr>
    </table>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;text-align:center;margin:6px 0 0;">
      Sign-in is one-click from this email — no password needed.
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:18px;">{footer_note}</p>
    {bulk_cta}
    """
    subject = render(tpl["subject"], **vars_)
    await _send(to, subject, _wrap(tpl["heading"], inner), template_key="therapist_notification")


async def send_patient_results(to: str, request_id: str, applications: list[dict[str, Any]]) -> None:
    # PHI-trimmed (HIPAA Phase 2, mockup at /email-trim-mockup.html).
    # Therapist names, scores, specialties, fees, and "why we matched"
    # reasons all moved out of the email body and into the secure
    # results page (PatientResults at /results/:id?t=<view_token>).
    # The email now carries only: "your matches are ready" copy + a
    # one-click CTA. `applications` is still accepted (and used to
    # decide between the empty-state and ready-state templates) but
    # the per-therapist cards are no longer rendered in the email.
    #
    # patients land on /results/:id?t=<token> which auto-grants access; if
    # they hit the URL later without the token, they'll be prompted to sign
    # in via magic code. See routes/patients.py:public_request_results.
    req = await _db().requests.find_one(
        {"id": request_id}, {"_id": 0, "view_token": 1},
    ) or {}
    view_token = req.get("view_token", "")
    token_query = f"?t={view_token}" if view_token else ""

    if not applications:
        tpl_e = await get_template(_db(), "patient_results_empty")
        intro = render(tpl_e["intro"])
        inner = _text_to_paragraph_html(
            intro,
            p_style=f"font-size:16px;line-height:1.6;color:{BRAND['text']};",
        )
        await _send(to, render(tpl_e["subject"]), _wrap(tpl_e["heading"], inner), template_key="patient_results_empty")
        return

    tpl = await get_template(_db(), "patient_results")
    results_url = f"{_get_app_url()}/results/{request_id}{token_query}"
    count = len(applications[:5])
    vars_ = {"count": count, "results_url": results_url}
    intro = render(tpl["intro"], **vars_)
    cta_label = render(tpl["cta_label"], **vars_) or "View my matches"
    cta_html = (
        f'<p style="margin:28px 0;text-align:center;">'
        f'<a href="{results_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
        f'<p style="color:{BRAND["muted"]};font-size:13px;line-height:1.6;text-align:center;margin:6px 0 0;">'
        f'Many of your matches offer a free 15-minute consult. Sign-in is one-click from this email.'
        f'</p>'
    )
    followup_note = (
        f'<div style="background:{BRAND["bg"]};border:1px solid {BRAND["border"]};border-radius:12px;padding:16px 18px;margin:20px 0;">'
        f'<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:{BRAND["primary"]};">What happens next</p>'
        f'<p style="margin:0;font-size:13px;line-height:1.6;color:{BRAND["text"]};">'
        f'Over the coming weeks we\'ll send you a few short check-ins to see how things are going. '
        f'These quick surveys (under 60 seconds each) help us improve your matches and make TheraVoca better for everyone. '
        f'Your responses are anonymous to therapists and completely optional — but they make a real difference.'
        f'</p></div>'
    )
    inner = f"""
    {_text_to_paragraph_html(intro, p_style=f"font-size:16px;line-height:1.6;color:{BRAND['text']};")}
    {cta_html}
    {followup_note}
    """
    subject = render(tpl["subject"], **vars_)
    await _send(to, subject, _wrap(tpl["heading"], inner), template_key="patient_results")


async def send_therapist_signup_received(to: str, name: str) -> None:
    tpl = await get_template(_db(), "therapist_signup_received")
    first_name = _first_name(name)
    vars_ = {"first_name": first_name}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:15px;line-height:1.7;color:{BRAND['text']};")}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">{footer_note}</p>
    """
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner), template_key="therapist_signup_received")


async def send_intake_receipt(to: str, request_id: str, summary_rows: list[tuple[str, str]]) -> None:
    """Send the patient a confirmation that we received their request.

    PHI-trimmed (HIPAA Phase 2, mockup at /email-trim-mockup.html). The
    full intake answers (age, location, presenting issues, free-text
    "anything else", etc.) used to be rendered into a table inside the
    email body. They now live behind the auto-login token at
    /receipt/:id?t=<view_token>. The email body carries only: a
    "request received" line, the 4-char reference, and a CTA to the
    private receipt page.

    `summary_rows` is still accepted (caller still builds it for the
    page) but is no longer rendered into the email itself. Keeping the
    parameter avoids a breaking signature change for existing callers.
    """
    # Pull the view_token so the receipt link auto-grants access. If the
    # token isn't present (older request), the page itself will redirect
    # the patient to magic-code sign-in.
    req = await _db().requests.find_one(
        {"id": request_id}, {"_id": 0, "view_token": 1},
    ) or {}
    view_token = req.get("view_token", "")
    token_query = f"?t={view_token}" if view_token else ""
    receipt_url = f"{_get_app_url()}/receipt/{request_id}{token_query}"
    short_ref = (request_id[:4] or "----").upper()

    cta_html = (
        f'<p style="margin:24px 0;text-align:center;">'
        f'<a href="{receipt_url}" style="display:inline-block;background:{BRAND["primary"]};'
        f'color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">'
        f'View my submitted answers</a>'
        f'</p>'
        f'<p style="color:{BRAND["muted"]};font-size:13px;line-height:1.6;text-align:center;margin:6px 0 0;">'
        f'Sign-in is one-click from this email — no password needed.'
        f'</p>'
    )
    inner = f"""
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Thanks for submitting your TheraVoca request. Reference number:
      <strong>{short_ref}</strong>.
    </p>
    <p style="font-size:14px;line-height:1.6;color:{BRAND['text']};">
      We'll email you when your therapist matches are ready — usually
      within a few hours. In the meantime you can view a full copy of
      your answers any time:
    </p>
    {cta_html}
    <p style="font-size:13px;line-height:1.6;color:{BRAND['muted']};margin-top:18px;">
      If anything looks wrong, just reply to this email — we can correct
      it before matching.
    </p>
    """
    await _send(
        to,
        "We received your TheraVoca request",
        _wrap("Request received", inner),
        template_key="patient_intake_receipt",
    )


async def send_therapist_approved(to: str, name: str) -> None:
    """Approval email.

    2026-05-17: the Next-steps block + both CTA button labels are now
    admin-editable via the template store (next_steps_heading,
    next_steps, cta_primary, cta_secondary). The list items are split
    on newline -- one <li> per line -- so admin can add/remove items
    from the editor without touching code. Leaving next_steps blank
    hides the entire surrounding card; leaving either CTA label blank
    hides that single button (so admin can drop to a one-button or
    zero-button layout if they want). The hardcoded fallbacks live in
    email_templates.DEFAULTS["therapist_approved"] -- they match the
    original hardcoded HTML so existing recipients get the same email
    until admin saves an override.
    """
    tpl = await get_template(_db(), "therapist_approved")
    first_name = _first_name(name)
    portal_url = f"{_get_app_url()}/sign-in?role=therapist"
    edit_url = f"{_get_app_url()}/portal/therapist/edit"
    vars_ = {"first_name": first_name}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    footer_note = render(tpl["footer_note"], **vars_)
    # New 2026-05-17 editable fields -- fall back to "" when an older
    # DB override didn't include them (get_template merges DEFAULTS so
    # this only happens if someone explicitly saved a null/empty).
    next_steps_heading = (tpl.get("next_steps_heading") or "").strip()
    next_steps_raw = tpl.get("next_steps") or ""
    cta_primary = (tpl.get("cta_primary") or "").strip()
    cta_secondary = (tpl.get("cta_secondary") or "").strip()

    # Build the Next-steps card only if there's content (heading OR
    # items). Each non-blank line becomes a list item. We do NOT pass
    # next_steps through render()'s newline -> <br/> transform because
    # we're already turning each line into its own <li> -- a <br/>
    # inside an <li> would double-space the bullets.
    next_steps_items = [
        ln.strip() for ln in next_steps_raw.replace("\r\n", "\n").split("\n")
        if ln.strip()
    ]
    next_steps_html = ""
    if next_steps_heading or next_steps_items:
        heading_html = (
            f'<div style="font-size:13px;color:{BRAND["muted"]};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">{next_steps_heading}</div>'
            if next_steps_heading else ""
        )
        items_html = "".join(
            f'<li style="margin-bottom:6px;">{item}</li>' for item in next_steps_items
        )
        list_html = (
            f'<ol style="margin:0;padding-left:20px;color:{BRAND["text"]};font-size:14px;line-height:1.7;">{items_html}</ol>'
            if items_html else ""
        )
        next_steps_html = (
            f'<div style="background:{BRAND["bg"]};border:1px solid {BRAND["border"]};border-radius:12px;padding:18px 22px;margin:22px 0;">'
            f'{heading_html}{list_html}'
            f'</div>'
        )

    # CTA row: render whichever button labels are non-empty. Both
    # blank => no button row at all.
    cta_buttons = []
    if cta_primary:
        cta_buttons.append(
            f'<a href="{portal_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">{cta_primary}</a>'
        )
    if cta_secondary:
        cta_buttons.append(
            f'<a href="{edit_url}" style="display:inline-block;background:#ffffff;color:{BRAND["primary"]};border:1px solid {BRAND["primary"]};text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">{cta_secondary}</a>'
        )
    cta_html = (
        f'<p style="margin:28px 0;text-align:center;">{"".join(cta_buttons)}</p>'
        if cta_buttons else ""
    )

    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:15px;line-height:1.7;color:{BRAND['text']};")}
    {next_steps_html}
    {cta_html}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">{footer_note}</p>
    """
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner), template_key="therapist_approved")


async def send_therapist_rejected(to: str, name: str) -> None:
    """Warm rejection email — leaves the door open for a future re-apply once
    the directory opens additional states / specialties."""
    tpl = await get_template(_db(), "therapist_rejected")
    first_name = _first_name(name)
    vars_ = {"first_name": first_name}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    body = render(tpl["body"], **vars_)
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:15px;line-height:1.7;color:{BRAND['text']};")}
    {_text_to_paragraph_html(body, p_style=f"font-size:15px;line-height:1.7;color:{BRAND['text']};")}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">{footer_note}</p>
    """
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner), template_key="therapist_rejected")


async def _send_simple_cta_template(
    template_key: str,
    to: str,
    cta_url: str,
    vars_: dict,
    unsubscribe_url: Optional[str] = None,
) -> None:
    """Shared helper for short CTA-only emails (follow-ups, profile nags).

    Pass `unsubscribe_url` to embed a one-click CAN-SPAM unsubscribe link
    in the footer. Promotional/recurring senders should always pass it;
    transactional senders (verification, password reset, results
    delivery) leave it None."""
    tpl = await get_template(_db(), template_key)
    inner, subject, heading = _build_cta_email_html(tpl, cta_url, vars_)
    await _send(to, subject, _wrap(heading, inner, unsubscribe_url=unsubscribe_url), template_key=template_key)


def _text_to_paragraph_html(text: str, *, p_style: str) -> str:
    """Convert a textarea-style multi-paragraph string to HTML paragraphs.

    Admin email-template fields (`intro`, `body`) are entered in a
    plain <textarea>, so paragraph breaks land as `\\n\\n` and soft
    breaks as single `\\n`. Wrapping the whole thing in one <p> lets
    the browser collapse all whitespace, so what the admin types as
    three paragraphs renders as one wall of text in the preview AND
    in the actual sent email.

    Gotcha: `render()` in email_templates.py runs BEFORE this helper
    in most call sites and already converts every `\\n` to `<br/>\\n`.
    So by the time we see the text, paragraph breaks look like
    `<br/>\\n<br/>\\n` (or any number of consecutive `<br/>` tags),
    not bare `\\n\\n`. We split on BOTH forms.

    This helper:
      - normalises any 2+ consecutive `<br/>`s (post-render) back to
        `\\n\\n` so we can split on a single pattern
      - splits on blank lines (`\\n\\s*\\n+`) -> separate <p>s
      - inside a paragraph, replaces remaining single `\\n` or `<br/>`
        with `<br>` so explicit single-line breaks survive
      - applies the supplied inline style to every <p>

    Empty input returns "" so callers can keep their `if intro` gates.
    """
    if not text or not str(text).strip():
        return ""
    import re as _re
    s = str(text).strip()
    # If render() already happened, undo its `\n -> <br/>\n` swap by
    # normalising 2+ consecutive `<br/>` (optionally surrounded by
    # whitespace) back to a blank-line separator we can split on.
    s = _re.sub(
        r"(?:<br\s*/?>\s*){2,}",
        "\n\n",
        s,
        flags=_re.IGNORECASE,
    )
    # Collapse the WHITESPACE that render() left after each remaining
    # single `<br/>` so the upcoming `\n -> <br>` replace can't double
    # up. Without this step, an admin-typed signature
    #
    #   Best,\nJoshua Rosenthal, PsyD\nTheraVoca, Founder
    #
    # would go through render() -> `<br/>\n` after each line, then
    # step 3 below would replace the surviving `\n`s with `<br>` -- so
    # each intentional newline became `<br/><br>`. The aggressive
    # strip in _inject_email_block_styles then turned ALL those `<br>`s
    # into spaces, collapsing the signature into one wrapped line.
    # Eating the `\n` here keeps the original single `<br>` intact.
    s = _re.sub(r"<br\s*/?>\s*", "<br>", s, flags=_re.IGNORECASE)
    paras = _re.split(r"\n\s*\n+", s)
    out_parts = []
    for p in paras:
        # Soft single-line breaks inside a paragraph -> <br>. Any
        # `\n` left at this point is a textarea soft break the admin
        # typed deliberately (the render-injected ones were eaten
        # above).
        inner = p.strip().replace("\n", "<br>")
        out_parts.append(f'<p style="{p_style}">{inner}</p>')
    return "".join(out_parts)


def _build_cta_email_html(
    tpl: dict, cta_url: str, vars_: dict,
    cta_url_secondary: str | None = None,
) -> tuple[str, str, str]:
    """Build the rendered (inner_html, subject, heading) for a simple CTA
    email given a template dict + CTA URL + substitution vars. Pulled out
    of `_send_simple_cta_template` so the admin preview endpoint can
    re-use the exact same render path.

    2026-05-17: also renders the optional next_steps_heading / next_steps
    list and the cta_primary / cta_secondary button pair when present
    on the template. Those fields are admin-editable (introduced for
    `therapist_approved`); when none are set, the template falls back
    to a single CTA button using `cta_label` + `cta_url` as before.
    Pass `cta_url_secondary` to point the second button at a different
    URL than the first; defaults to the same `cta_url` so previews
    still link somewhere.
    """
    greeting = render(tpl.get("greeting", ""), **vars_)
    intro = render(tpl.get("intro", "") or "", **vars_)
    cta_label = render(tpl.get("cta_label", ""), **vars_)
    footer_note = render(tpl.get("footer_note", ""), **vars_)
    body = render(tpl.get("body", "") or "", **vars_)
    privacy_note = render(tpl.get("privacy_note", "") or "", **vars_)
    # New 2026-05-17 admin-editable fields (currently only the
    # therapist_approved template uses these).
    next_steps_heading = (tpl.get("next_steps_heading") or "").strip()
    next_steps_raw = tpl.get("next_steps") or ""
    cta_primary = render((tpl.get("cta_primary") or "").strip(), **vars_)
    cta_secondary = render((tpl.get("cta_secondary") or "").strip(), **vars_)

    # Next-steps card. Each non-blank line becomes a list item. We
    # intentionally do NOT pass next_steps through render()'s newline
    # -> <br/> transform because we're already turning each line into
    # its own <li>; a <br/> inside an <li> double-spaces the bullets.
    next_steps_items = [
        ln.strip() for ln in next_steps_raw.replace("\r\n", "\n").split("\n")
        if ln.strip()
    ]
    next_steps_html = ""
    if next_steps_heading or next_steps_items:
        heading_html = (
            f'<div style="font-size:13px;color:{BRAND["muted"]};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">{next_steps_heading}</div>'
            if next_steps_heading else ""
        )
        items_html = "".join(
            f'<li style="margin-bottom:6px;">{item}</li>' for item in next_steps_items
        )
        list_html = (
            f'<ol style="margin:0;padding-left:20px;color:{BRAND["text"]};font-size:14px;line-height:1.7;">{items_html}</ol>'
            if items_html else ""
        )
        next_steps_html = (
            f'<div style="background:{BRAND["bg"]};border:1px solid {BRAND["border"]};border-radius:12px;padding:18px 22px;margin:22px 0;">'
            f'{heading_html}{list_html}'
            f'</div>'
        )

    # CTA buttons. If cta_primary / cta_secondary are set, render the
    # paired buttons. Otherwise fall back to the single-button
    # `cta_label` legacy path so all other templates keep their
    # existing behavior.
    if cta_primary or cta_secondary:
        secondary_url = cta_url_secondary or cta_url
        buttons = []
        if cta_primary:
            buttons.append(
                f'<a href="{cta_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">{cta_primary}</a>'
            )
        if cta_secondary:
            buttons.append(
                f'<a href="{secondary_url}" style="display:inline-block;background:#ffffff;color:{BRAND["primary"]};border:1px solid {BRAND["primary"]};text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">{cta_secondary}</a>'
            )
        cta_html = f'<p style="margin:28px 0;text-align:center;">{"".join(buttons)}</p>'
    else:
        cta_html = (
            f'<p style="margin:28px 0;text-align:center;">'
            f'<a href="{cta_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
            f'</p>'
        ) if cta_label else ""
    # intro + body: convert textarea \n\n into real paragraph breaks
    # (was wrapping the whole textarea content in one <p>, collapsing
    # admin-typed paragraph breaks into a wall of text).
    intro_style = f"font-size:15px;line-height:1.7;color:{BRAND['text']};margin:0 0 14px 0;"
    intro_html = _text_to_paragraph_html(intro, p_style=intro_style)
    body_style = f"font-size:15px;line-height:1.7;color:{BRAND['text']};margin:14px 0;"
    body_html = _text_to_paragraph_html(body, p_style=body_style)
    # Privacy note renders just above the CTA button (v2 survey templates)
    privacy_html = (
        f'<p style="color:{BRAND["muted"]};font-size:12px;line-height:1.5;'
        f'margin:20px 0 4px 0;padding:12px 16px;background:{BRAND["bg"]};'
        f'border-radius:8px;">&#x1F512; {privacy_note}</p>'
    ) if privacy_note else ""
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {intro_html}
    {body_html}
    {next_steps_html}
    {privacy_html}
    {cta_html}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">{footer_note}</p>
    """
    return (
        inner,
        render(tpl.get("subject", "") or "TheraVoca", **vars_),
        render(tpl.get("heading", "") or "", **vars_),
    )


# Realistic sample values for each template's `available_vars`. Used by
# the admin preview endpoint so admins can see exactly how their copy
# will look against typical dynamic data — without sending a real email.
_PREVIEW_VARS: dict[str, dict[str, Any]] = {
    "verification":              {"verify_url": "https://theravoca.com/verify/sample"},
    "therapist_notification":    {"first_name": "Alex", "match_score": 87,
                                   "apply_url": "https://theravoca.com/therapist/apply/sample",
                                   "decline_url": "https://theravoca.com/therapist/decline/sample"},
    "patient_results":           {"count": 5, "results_url": "https://theravoca.com/results/sample"},
    "patient_results_empty":     {},
    "therapist_signup_received": {"first_name": "Alex"},
    "therapist_approved":        {"first_name": "Alex"},
    "therapist_rejected":        {"first_name": "Alex"},
    "therapist_followup_2w":     {"first_name": "Alex"},
    "therapist_stale_profile_nag": {"first_name": "Alex", "days_stale": 14},
    "magic_code":                {"code": "123456", "role": "patient"},
    "claim_profile":             {"first_name": "Alex", "claim_url": "https://theravoca.com/claim/sample"},
    # 2026-05-17: sync with DEFAULTS keys. Previously these three
    # rendered literal {first_name} / {code} / {rationale} in the
    # admin preview because no entry existed -- the audit flagged
    # the missing-key warning as cosmetic but it makes the preview
    # genuinely misleading (admin can't see what the substituted
    # email will look like before sending).
    "new_referral_inquiry":      {
        "first_name": "Alex",
        "score": 87,
        "rationale": "Strong fit on anxiety + CBT, schedule overlap, in-network with their insurance.",
        "signup_url": "https://theravoca.com/therapists/join?code=SAMPLE",
        "opt_out_url": "https://theravoca.com/outreach/opt-out/sample",
    },
    "prelaunch_invite":          {
        "first_name": "Alex",
        "rationale": "We saw your Psychology Today profile and you match what an Idaho patient is looking for.",
        "code": "SAMPLE",
        "signup_url": "https://theravoca.com/therapists/join?code=SAMPLE",
    },
    "therapist_survey":          {
        "first_name": "Alex",
        "therapist_id": "sample-therapist-id",
        "survey_number": 1,
    },
    # NOTE 2026-05-17: removed orphan PREVIEW_VARS entries for
    # `patient_followup_*`, `license_expiring_*`,
    # `availability_prompt`, `followup_survey`. Those template keys
    # no longer exist in DEFAULTS (replaced by v2 survey + reminder
    # variants); leaving the orphan entries around was harmless but
    # misleading when reading this file.
    # v2 patient surveys + reminders
    "patient_survey_v2_48h":          {"request_id": "sample-id"},
    "patient_survey_v2_3w":           {"request_id": "sample-id"},
    "patient_survey_v2_9w":           {"request_id": "sample-id"},
    "patient_survey_v2_15w":          {"request_id": "sample-id"},
    "patient_survey_v2_48h_reminder": {"request_id": "sample-id"},
    "patient_survey_v2_3w_reminder":  {"request_id": "sample-id"},
    "patient_survey_v2_9w_reminder":  {"request_id": "sample-id"},
    "patient_survey_v2_15w_reminder": {"request_id": "sample-id"},
}


async def render_template_preview(
    template_key: str, draft: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Render an email template with realistic sample data, returning
    {subject, html} for admin preview. If `draft` is supplied, the
    draft fields override the saved/default copy WITHOUT persisting —
    so the admin can see their edits live before clicking Save.
    """
    base = await get_template(_db(), template_key)
    if draft:
        # 2026-05-17: forward the new admin-editable fields too so the
        # admin "Preview" button reflects unsaved edits to next_steps /
        # cta_primary / cta_secondary / pricing_note / rationale, not
        # just the core six fields.
        for k in (
            "subject", "heading", "greeting", "intro", "cta_label", "footer_note",
            "body", "privacy_note", "rationale", "pricing_note",
            "next_steps_heading", "next_steps", "cta_primary", "cta_secondary",
        ):
            if k in draft and draft[k] is not None:
                base[k] = draft[k]
    vars_ = dict(_PREVIEW_VARS.get(template_key) or {})
    cta_url = (
        vars_.get("verify_url")
        or vars_.get("apply_url")
        or vars_.get("results_url")
        or vars_.get("claim_url")
        or "#preview"
    )
    inner, subject, heading = _build_cta_email_html(base, cta_url, vars_)
    # Pass heading through as-is (incl. ""). _wrap skips the H1 block
    # entirely when heading is empty, which is what letter-style
    # templates / broadcasts want -- they open straight on the
    # greeting. The old `heading or "Preview"` fallback was injecting
    # the literal word "Preview" as an H1 above the body
    # whenever an admin previewed a letter-style template.
    return {"subject": subject, "html": _wrap(heading or "", inner)}


# ── v2 patient survey senders ────────────────────────────────────────

def _patient_unsub_url(request_id: str) -> str:
    from routes.unsubscribe import build_unsubscribe_url
    return build_unsubscribe_url(_get_app_url(), request_id, "patient")


def _therapist_unsub_url(therapist_id: str) -> str:
    from routes.unsubscribe import build_unsubscribe_url
    return build_unsubscribe_url(_get_app_url(), therapist_id, "therapist")


async def send_patient_survey_v2_48h(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/48h?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_48h", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_3w(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/3w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_3w", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_9w(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/9w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_9w", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_15w(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/15w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_15w", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


# ── v2 reminder senders (same link, different template) ─────────────

async def send_patient_survey_v2_48h_reminder(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/48h?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_48h_reminder", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_3w_reminder(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/3w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_3w_reminder", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_9w_reminder(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/9w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_9w_reminder", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_patient_survey_v2_15w_reminder(to: str, request_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(request_id, "patient")
    url = f"{_get_app_url()}/feedback/{request_id}/15w?token={token}&v=2"
    await _send_simple_cta_template(
        "patient_survey_v2_15w_reminder", to, url, {"request_id": request_id},
        unsubscribe_url=_patient_unsub_url(request_id),
    )


async def send_therapist_followup_2w(to: str, name: str, therapist_id: str) -> None:
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(therapist_id, "therapist")
    url = f"{_get_app_url()}/feedback/therapist/{therapist_id}?milestone=2w&token={token}"
    await _send_simple_cta_template(
        "therapist_followup_2w", to, url, {"first_name": _first_name(name)},
        unsubscribe_url=_therapist_unsub_url(therapist_id),
    )


async def send_therapist_survey(
    to: str, name: str, therapist_id: str, survey_number: int,
) -> None:
    """Phase 3 therapist survey -- match fit + NPS + ongoing-client conversion.
    Cron triggers every 10 referrals OR 14 days (whichever first).

    URL points at the frontend route /therapist-feedback/{tid}/{n}, which on
    load fetches GET /api/feedback/therapist/{tid}/survey/{n}. Same HMAC token
    scheme as patient surveys (entity_type='therapist').
    """
    from routes.feedback import generate_feedback_token
    token = generate_feedback_token(therapist_id, "therapist")
    url = (
        f"{_get_app_url()}/therapist-feedback/{therapist_id}/{survey_number}"
        f"?token={token}"
    )
    await _send_simple_cta_template(
        "therapist_survey", to, url,
        {
            "first_name": _first_name(name),
            "therapist_id": therapist_id,
            "survey_number": survey_number,
        },
        unsubscribe_url=_therapist_unsub_url(therapist_id),
    )


async def send_therapist_stale_profile_nag(
    to: str, name: str, days_stale: int, therapist_id: str,
) -> None:
    url = f"{_get_app_url()}/portal/therapist/edit"
    await _send_simple_cta_template(
        "therapist_stale_profile_nag", to, url,
        {"first_name": _first_name(name), "days_stale": days_stale},
        unsubscribe_url=_therapist_unsub_url(therapist_id),
    )


async def send_magic_code(to: str, code: str, role: str) -> None:
    tpl = await get_template(_db(), "magic_code")
    ttl = int(os.environ.get("MAGIC_CODE_TTL_MINUTES", "30"))
    # Magic link — one click signs the user in. SignIn.jsx auto-verifies
    # when both ?email= and ?code= are present.
    from urllib.parse import urlencode
    qs = urlencode({"role": role, "email": to, "code": code})
    magic_url = f"{_get_app_url()}/sign-in?{qs}"
    vars_ = {"code": code, "ttl_minutes": ttl, "role": role}
    intro = render(tpl["intro"], **vars_)
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {_text_to_paragraph_html(intro, p_style=f"font-size:16px;line-height:1.6;color:{BRAND['text']};")}
    <div style="margin:32px 0;text-align:center;">
      <div style="display:inline-block;background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:14px;padding:22px 36px;">
        <div style="font-family:'SFMono-Regular','Menlo','Consolas','Courier New',monospace;font-size:38px;letter-spacing:0.4em;color:{BRAND['primary']};font-weight:700;">{code}</div>
        <div style="font-size:11px;color:{BRAND['muted']};margin-top:8px;text-transform:uppercase;letter-spacing:0.15em;">Expires in {ttl} minutes</div>
      </div>
    </div>
    <p style="margin:8px 0 28px 0;text-align:center;">
      <a href="{magic_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Sign in with one click</a>
    </p>
    <p style="text-align:center;color:{BRAND['muted']};font-size:13px;margin:-12px 0 24px 0;">
      Or copy the 6-digit code above into the sign-in page.
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">{footer_note}</p>
    """
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner), template_key="magic_code")



async def send_license_expiring_to_therapist(
    to: str, therapist_name: str, expires_at: str, days_remaining: int
) -> None:
    """Email therapist 30 days before license expiration."""
    first_name = _first_name(therapist_name)
    portal_url = f"{_get_app_url()}/portal/therapist"
    subject = f"Your TheraVoca license expires in {days_remaining} days"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first_name},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Our records show your professional license is set to expire on
      <strong>{expires_at}</strong> — about <strong>{days_remaining} days</strong> from today.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      To keep receiving referrals without interruption, please renew with your state board
      and upload an updated copy via your therapist portal.
    </p>
    <p style="margin:28px 0;">
      <a href="{portal_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Update license</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      If you've already renewed, you can ignore this email — we'll stop reminding you once the new expiration date is on file.
    </p>
    """
    await _send(to, subject, _wrap("License renewal reminder", inner), template_key="license_renewal_reminder")


async def send_license_expiring_to_admin(
    to: str, therapist_name: str, therapist_email: str, expires_at: str, days_remaining: int
) -> None:
    subject = f"[TheraVoca] {therapist_name} license expiring in {days_remaining}d"
    inner = f"""
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Heads-up: <strong>{therapist_name}</strong> ({therapist_email}) has a license that expires
      on <strong>{expires_at}</strong>. We've notified the therapist directly. Verify renewal documentation
      lands in their profile before that date.
    </p>
    """
    await _send(to, subject, _wrap("License renewal alert", inner), template_key="license_renewal_alert_admin")


async def send_new_login_alert(
    to: str,
    role: str,
    user_agent: str = "",
    when_iso: str = "",
) -> None:
    """Email a user when a new sign-in happens from an IP that hasn't
    been seen for their account before.

    Doesn't include IP itself (we hash IPs server-side and the raw value
    isn't stored). Includes user agent so the user can tell "Chrome on
    my MacBook" from "Firefox on Windows."
    """
    role_label = (role or "").strip().lower()
    if role_label == "patient":
        portal_path = "/portal/patient"
        portal_label = "your TheraVoca portal"
    elif role_label == "therapist":
        portal_path = "/portal/therapist"
        portal_label = "your therapist portal"
    elif role_label == "admin":
        portal_path = "/admin/dashboard"
        portal_label = "the admin dashboard"
    else:
        portal_path = "/sign-in"
        portal_label = "your account"
    portal_url = f"{_get_app_url()}{portal_path}"
    history_url = f"{_get_app_url()}/portal/{role_label}/login-history"

    when_human = when_iso
    try:
        if when_iso:
            when_dt = datetime.fromisoformat(when_iso.replace("Z", "+00:00"))
            when_human = when_dt.strftime("%Y-%m-%d %H:%M UTC")
    except ValueError:
        pass

    ua_short = (user_agent or "").strip()
    if len(ua_short) > 200:
        ua_short = ua_short[:200] + "..."
    ua_block = (
        f'<p style="font-size:13px;color:{BRAND["muted"]};margin:4px 0;">'
        f'<strong>Device / browser:</strong> {ua_short or "(not reported)"}</p>'
    )

    subject = f"New sign-in to {portal_label}"
    inner = f"""
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      We noticed a sign-in to {portal_label} from a device or location
      we haven't seen on your account before.
    </p>
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:10px;padding:14px 18px;margin:18px 0;">
      <p style="font-size:13px;color:{BRAND['muted']};margin:4px 0;">
        <strong>When:</strong> {when_human or "just now"}
      </p>
      {ua_block}
    </div>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      <strong>If this was you</strong>, no action needed. You can ignore
      this message.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      <strong>If this wasn't you</strong>, somebody may have access to
      your email. Sign in and:
    </p>
    <ol style="font-size:14px;color:{BRAND['text']};line-height:1.8;">
      <li>Set or rotate your password from the portal.</li>
      <li>Review your recent sign-ins:
        <a href="{history_url}" style="color:{BRAND['primary']};">login history</a>.
      </li>
      <li>If you can't get in, reply to this email and we'll help you
        recover the account.</li>
    </ol>
    <p style="margin:24px 0;">
      <a href="{portal_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Open {portal_label}</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:12px;line-height:1.6;margin-top:24px;">
      You're getting this because a sign-in just happened on a device
      or network we haven't seen on your account in the last 90 days.
      We send this once per new device, not on every login.
    </p>
    """
    await _send(to, subject, _wrap("New sign-in alert", inner), template_key="new_login_alert")


async def send_cron_health_alert_to_admin(
    to: str,
    stuck: list[dict],
    recent_failures: list[dict],
    stalest_jobs: list[dict],
) -> None:
    """Email admin when the cron health sweep finds stuck jobs, recent
    failures, or jobs that haven't completed in a long time.

    Sent at most once per 24h (dedupe lives in cron._run_cron_health_alert).
    """
    portal_url = f"{_get_app_url()}/admin/dashboard"
    stuck_count = len(stuck)
    fail_count = len(recent_failures)
    stale_count = len(stalest_jobs)

    parts = []
    headline_bits = []
    if stuck_count:
        headline_bits.append(f"{stuck_count} stuck")
    if fail_count:
        headline_bits.append(f"{fail_count} failed (7d)")
    if stale_count:
        headline_bits.append(f"{stale_count} stale (>36h)")
    headline = " · ".join(headline_bits) or "all clear"
    subject = f"[TheraVoca] Cron health alert: {headline}"

    if stuck:
        rows = "".join(
            f'<li style="margin:6px 0;"><strong>{s.get("name", "?")}</strong> '
            f'-- started {s.get("started_at", "?")} (no completion since)</li>'
            for s in stuck[:20]
        )
        parts.append(
            f'<p style="font-size:15px;color:{BRAND["text"]};margin-top:18px;">'
            f'<strong>Stuck jobs</strong> (started >24h ago, never completed):'
            f'</p><ul style="font-size:14px;color:{BRAND["text"]};line-height:1.7;">{rows}</ul>'
        )
    if recent_failures:
        rows = "".join(
            f'<li style="margin:6px 0;"><strong>{f.get("name", "?")}</strong> '
            f'-- {f.get("started_at", "?")} -- '
            f'<code>{(f.get("error") or "")[:120]}</code></li>'
            for f in recent_failures[:20]
        )
        parts.append(
            f'<p style="font-size:15px;color:{BRAND["text"]};margin-top:18px;">'
            f'<strong>Recent failures</strong> (last 7 days):'
            f'</p><ul style="font-size:14px;color:{BRAND["text"]};line-height:1.7;">{rows}</ul>'
        )
    if stalest_jobs:
        rows = "".join(
            f'<li style="margin:6px 0;"><strong>{j.get("name", "?")}</strong> '
            f'-- last completed {j.get("last_completed_at", "?")}</li>'
            for j in stalest_jobs[:10]
        )
        parts.append(
            f'<p style="font-size:15px;color:{BRAND["text"]};margin-top:18px;">'
            f'<strong>Jobs that have not run in >36h</strong> '
            f'(may have silently stopped scheduling):'
            f'</p><ul style="font-size:14px;color:{BRAND["text"]};line-height:1.7;">{rows}</ul>'
        )

    body_html = "".join(parts) or (
        f'<p style="font-size:15px;color:{BRAND["text"]};">'
        f'No problems detected. (This message should not have fired.)</p>'
    )

    inner = f"""
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      The cron health sweep flagged at least one issue. Details below.
      Full health view:
      <a href="{portal_url}" style="color:{BRAND['primary']};">admin dashboard</a>.
    </p>
    {body_html}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.7;margin-top:24px;">
      This alert is sent at most once per 24 hours. If you've already
      fixed the issue, you can ignore -- the next sweep will go quiet.
    </p>
    """
    await _send(to, subject, _wrap("Cron health alert", inner), template_key="cron_health_alert")


async def send_availability_prompt(to: str, therapist_name: str, therapist_id: str) -> None:
    """Monday morning reminder asking the therapist to refresh their availability."""
    first_name = _first_name(therapist_name)
    portal_url = f"{_get_app_url()}/portal/therapist"
    subject = "Quick check — is your TheraVoca availability still current?"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first_name},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Once a week we check in to keep your <strong>same-week availability</strong> accurate.
      A 10-second update keeps you on top of patient match results.
    </p>
    <p style="margin:28px 0;">
      <a href="{portal_url}?confirmAvailability=1" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Confirm or update availability</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      If your availability hasn't changed, just hit "Yes, still current" in the portal.
    </p>
    """
    await _send(
        to,
        subject,
        _wrap("Availability check-in", inner, unsubscribe_url=_therapist_unsub_url(therapist_id)),
        template_key="availability_prompt",
    )



async def send_claim_profile_email(
    to: str,
    therapist_name: str,
    score: int,
    missing_fields: list[str],
    therapist_id: str,
) -> None:
    """One-time go-live outreach email asking each existing therapist to
    claim their profile and fill in any missing information.

    Editable copy (subject / greeting / intro / cta_label / footer_note)
    lives in the `claim_profile` email template -- admin can override via
    Content -> Email templates. The progress bar + missing-fields list
    are code-controlled (structural, not text).
    """
    tpl = await get_template(_db(), "claim_profile")
    first_name = _first_name(therapist_name)
    portal_url = f"{_get_app_url()}/sign-in?role=therapist"
    edit_url = f"{_get_app_url()}/portal/therapist/edit"
    vars_ = {
        "first_name": first_name,
        "score": score,
        "edit_url": edit_url,
        "portal_url": portal_url,
    }
    subject = render(tpl["subject"], **vars_)
    greeting = render(tpl.get("greeting", ""), **vars_)
    intro = render(tpl["intro"], **vars_)
    cta_label = render(tpl.get("cta_label", "Complete my profile"), **vars_)
    footer_note = render(tpl.get("footer_note", ""), **vars_)
    bullets_html = "".join(
        f'<li style="margin:6px 0;">{label}</li>' for label in missing_fields[:10]
    )
    if not bullets_html:
        bullets_html = (
            '<li style="margin:6px 0;">Your profile is already complete '
            '-- feel free to refine it any time.</li>'
        )
    # `intro` already has <br/> tags from render() for newlines the admin
    # entered in the template editor. Wrap it in a single <p> so the line
    # breaks render as visible spacing.
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    {_text_to_paragraph_html(intro, p_style=f"font-size:15px;line-height:1.7;color:{BRAND['text']};")}
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:18px 22px;margin:22px 0;">
      <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
        Your profile is {score}% complete
      </div>
      <div style="background:{BRAND['border']};border-radius:999px;height:8px;overflow:hidden;margin:8px 0 14px;">
        <div style="background:{BRAND['primary']};width:{score}%;height:100%;"></div>
      </div>
      <div style="font-size:14px;color:{BRAND['text']};font-weight:600;margin-bottom:8px;">What's missing:</div>
      <ul style="margin:0;padding-left:18px;color:{BRAND['text']};font-size:14px;line-height:1.7;">
        {bullets_html}
      </ul>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{edit_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">
        {cta_label}
      </a>
    </p>
    {f'<p style="color:{BRAND["muted"]};font-size:13px;line-height:1.6;text-align:center;">{footer_note}</p>' if footer_note else ''}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">
      Already signed in? Pop into your <a href="{portal_url}" style="color:{BRAND['primary']};">portal</a>
      any time. Reply to this email if anything looks off -- we'd love to hear from you.
    </p>
    """
    await _send(
        to,
        subject,
        _wrap(
            tpl.get("heading", "Claim your TheraVoca profile"),
            inner,
            unsubscribe_url=_therapist_unsub_url(therapist_id),
        ),
        template_key="claim_profile",
    )
