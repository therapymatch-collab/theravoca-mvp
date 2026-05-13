"""Email service for TheraVoca via Resend."""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Optional

import resend
from dotenv import load_dotenv

from email_templates import get_template, render

# Ensure .env is loaded even if this module is imported before server.py calls load_dotenv()
load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)


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


def _wrap(title: str, inner_html: str, unsubscribe_url: Optional[str] = None) -> str:
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
    return f"""
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:{BRAND['bg']};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:{BRAND['text']};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{BRAND['bg']};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid {BRAND['border']};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px;border-bottom:1px solid {BRAND['border']};">
          <span style="font-family:Georgia,serif;font-size:22px;color:{BRAND['primary']};letter-spacing:-0.5px;">TheraVoca</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;color:{BRAND['primary']};line-height:1.2;">{title}</h1>
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
) -> dict[str, Any] | None:
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
    if not override and not live_mode and not _is_safe_test_address(to):
        logger.warning(
            "PRELAUNCH BLOCK: refusing to send to %s (real address). "
            "Set EMAIL_OVERRIDE_TO to redirect to a test inbox, or "
            "EMAIL_LIVE_MODE=true to go live.",
            to,
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
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Sent email id=%s", result.get("id"))
        await _log_send(
            to=to, actual_to=actual_to, subject=actual_subject,
            template_key=template_key,
            resend_id=result.get("id") if isinstance(result, dict) else None,
            sent_ok=True,
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
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
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
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
      <tr>
        <td style="padding-right:10px;">
          <a href="{apply_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>
        </td>
        <td>
          <a href="{decline_url}" style="display:inline-block;background:#ffffff;color:{BRAND['muted']};text-decoration:none;padding:13px 22px;border:1px solid {BRAND['border']};border-radius:999px;font-weight:500;">Not interested</a>
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
        inner = f'<p style="font-size:16px;line-height:1.6;color:{BRAND["text"]};">{intro}</p>'
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
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
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
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
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
    tpl = await get_template(_db(), "therapist_approved")
    first_name = _first_name(name)
    portal_url = f"{_get_app_url()}/sign-in?role=therapist"
    edit_url = f"{_get_app_url()}/portal/therapist/edit"
    vars_ = {"first_name": first_name}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:18px 22px;margin:22px 0;">
      <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">
        Next steps (2 minutes)
      </div>
      <ol style="margin:0;padding-left:20px;color:{BRAND['text']};font-size:14px;line-height:1.7;">
        <li><strong>Sign in</strong> with your email — we'll email you a 6-digit code. No password required.</li>
        <li><strong>Add a warm bio and your openings</strong> so patients pick you quickly.</li>
        <li>Watch your inbox for referrals. You'll get an email + text when a patient matches your profile at 70%+.</li>
      </ol>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{portal_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">
        Sign in to your portal
      </a>
      <a href="{edit_url}" style="display:inline-block;background:#ffffff;color:{BRAND['primary']};border:1px solid {BRAND['primary']};text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;margin:4px;">
        Complete your profile
      </a>
    </p>
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
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{body}</p>
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


def _build_cta_email_html(
    tpl: dict, cta_url: str, vars_: dict,
) -> tuple[str, str, str]:
    """Build the rendered (inner_html, subject, heading) for a simple CTA
    email given a template dict + CTA URL + substitution vars. Pulled out
    of `_send_simple_cta_template` so the admin preview endpoint can
    re-use the exact same render path."""
    greeting = render(tpl.get("greeting", ""), **vars_)
    intro = render(tpl.get("intro", "") or "", **vars_)
    cta_label = render(tpl.get("cta_label", ""), **vars_)
    footer_note = render(tpl.get("footer_note", ""), **vars_)
    body = render(tpl.get("body", "") or "", **vars_)
    privacy_note = render(tpl.get("privacy_note", "") or "", **vars_)
    cta_html = (
        f'<p style="margin:28px 0;text-align:center;">'
        f'<a href="{cta_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
    ) if cta_label else ""
    body_html = (
        f'<p style="font-size:15px;line-height:1.7;color:{BRAND["text"]};margin-top:14px;">{body}</p>'
        if body else ""
    )
    # Privacy note renders just above the CTA button (v2 survey templates)
    privacy_html = (
        f'<p style="color:{BRAND["muted"]};font-size:12px;line-height:1.5;'
        f'margin:20px 0 4px 0;padding:12px 16px;background:{BRAND["bg"]};'
        f'border-radius:8px;">&#x1F512; {privacy_note}</p>'
    ) if privacy_note else ""
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
    {body_html}
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
    "patient_followup_48h":      {"request_id": "sample-id"},
    "patient_followup_3w":       {"request_id": "sample-id"},
    "patient_followup_9w":       {"request_id": "sample-id"},
    "patient_followup_15w":      {"request_id": "sample-id"},
    "therapist_followup_2w":     {"first_name": "Alex"},
    "therapist_stale_profile_nag": {"first_name": "Alex", "days_stale": 14},
    "license_expiring_therapist": {"first_name": "Alex", "expires_at": "2026-12-31"},
    "license_expiring_admin":    {"name": "Alex Therapist", "expires_at": "2026-12-31"},
    "magic_code":                {"code": "123456", "role": "patient"},
    "claim_profile":             {"first_name": "Alex", "claim_url": "https://theravoca.com/claim/sample"},
    "availability_prompt":       {"therapist_name": "Alex Therapist"},
    "followup_survey":           {"first_name": "Alex"},
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
        for k in ("subject", "heading", "greeting", "intro", "cta_label", "footer_note", "body", "privacy_note"):
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
    return {"subject": subject, "html": _wrap(heading or "Preview", inner)}


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
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
    <div style="margin:32px 0;text-align:center;">
      <div style="display:inline-block;background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:14px;padding:22px 36px;">
        <div style="font-family:Georgia,serif;font-size:38px;letter-spacing:0.4em;color:{BRAND['primary']};font-weight:600;">{code}</div>
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
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
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
