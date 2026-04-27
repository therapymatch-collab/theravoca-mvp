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
    return os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


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


def _wrap(title: str, inner_html: str) -> str:
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
          You received this email from TheraVoca. If this wasn't you, please ignore this message.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""


async def _send(to: str, subject: str, html: str) -> dict[str, Any] | None:
    api_key = _get_api_key()
    if not api_key:
        logger.warning("RESEND_API_KEY not configured, skipping email to %s", to)
        return None
    resend.api_key = api_key
    # Dev/test mode: redirect every outbound email to a single inbox (e.g. for Resend test mode)
    override = os.environ.get("EMAIL_OVERRIDE_TO", "").strip()
    actual_to = override or to
    actual_subject = f"[was: {to}] {subject}" if override and override != to else subject
    params = {"from": _get_sender(), "to": [actual_to], "subject": actual_subject, "html": html}
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Sent email to %s (intended %s) id=%s", actual_to, to, result.get("id"))
        return result
    except Exception as e:
        logger.exception("Failed to send email to %s: %s", actual_to, e)
        return None


# ─── Templates ─────────────────────────────────────────────────────────────────

async def send_verification_email(to: str, request_id: str, token: str) -> None:
    tpl = await get_template(_db(), "verification")
    verify_url = f"{_get_app_url()}/verify/{token}"
    intro = render(tpl["intro"], verify_url=verify_url)
    cta_label = render(tpl["cta_label"], verify_url=verify_url)
    footer_note = render(tpl["footer_note"], verify_url=verify_url)
    cta_html = (
        f'<p style="margin:28px 0;">'
        f'<a href="{verify_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
    ) if cta_label else ""
    inner = f"""
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
    {cta_html}
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">{footer_note}<br/>
      <span style="word-break:break-all;color:{BRAND['primary']};">{verify_url}</span>
    </p>
    """
    subject = render(tpl["subject"], verify_url=verify_url)
    await _send(to, subject, _wrap(tpl["heading"], inner))


async def send_therapist_notification(
    to: str,
    therapist_name: str,
    request_id: str,
    therapist_id: str,
    match_score: float,
    summary: dict[str, Any],
    gaps: Optional[list[dict[str, Any]]] = None,
) -> None:
    tpl = await get_template(_db(), "therapist_notification")
    first_name = _first_name(therapist_name)
    apply_url = f"{_get_app_url()}/therapist/apply/{request_id}/{therapist_id}"
    decline_url = f"{_get_app_url()}/therapist/apply/{request_id}/{therapist_id}?decline=1"
    portal_url = f"{_get_app_url()}/portal/therapist"
    summary_rows = "".join(
        f'<tr><td style="padding:6px 0;color:{BRAND["muted"]};font-size:13px;width:140px;">{k}</td>'
        f'<td style="padding:6px 0;color:{BRAND["text"]};font-size:14px;">{v}</td></tr>'
        for k, v in summary.items()
    )
    gaps_html = ""
    if gaps:
        rows = "".join(
            f'<li style="margin:6px 0;color:{BRAND["text"]};font-size:14px;line-height:1.5;">'
            f'<strong style="color:{BRAND["primary"]};">{g["label"]}</strong>'
            f' — scored {g["score"]}/{g["max"]}'
            f'</li>'
            for g in gaps
        )
        gaps_html = (
            f'<div style="background:#FDF7EC;border:1px solid #E8DCC1;border-radius:12px;'
            f'padding:14px 18px;margin:0 0 20px;">'
            f'<div style="font-size:13px;color:{BRAND["muted"]};text-transform:uppercase;'
            f'letter-spacing:0.08em;margin-bottom:6px;">Gaps — why this isn\'t 100%</div>'
            f'<ul style="margin:6px 0 0;padding-left:18px;">{rows}</ul>'
            f'<div style="font-size:12px;color:{BRAND["muted"]};margin-top:8px;line-height:1.5;">'
            f'These gaps don\'t disqualify you — they just help you decide whether to take this referral.'
            f'</div>'
            f'</div>'
        )
    bulk_cta = (
        f'<p style="color:{BRAND["muted"]};font-size:13px;line-height:1.6;text-align:center;'
        f'margin:18px 0 0;">'
        f'Have multiple referrals waiting? '
        f'<a href="{portal_url}" style="color:{BRAND["primary"]};text-decoration:underline;">'
        f'Open your dashboard</a> to review them all in one place.'
        f'</p>'
    )
    vars_ = {"first_name": first_name, "match_score": int(match_score), "apply_url": apply_url, "decline_url": decline_url}
    greeting = render(tpl["greeting"], **vars_)
    intro = render(tpl["intro"], **vars_)
    cta_label = render(tpl["cta_label"], **vars_) or "I'm interested"
    footer_note = render(tpl["footer_note"], **vars_)
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:18px 22px;margin:20px 0;">
      <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Match Score</div>
      <div style="font-family:Georgia,serif;font-size:34px;color:{BRAND['primary']};">{match_score}%</div>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:8px 0 24px;">
      {summary_rows}
    </table>
    {gaps_html}
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
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">{footer_note}</p>
    {bulk_cta}
    """
    subject = render(tpl["subject"], **vars_)
    await _send(to, subject, _wrap(tpl["heading"], inner))


async def send_patient_results(to: str, request_id: str, applications: list[dict[str, Any]]) -> None:
    if not applications:
        tpl_e = await get_template(_db(), "patient_results_empty")
        intro = render(tpl_e["intro"])
        inner = f'<p style="font-size:16px;line-height:1.6;color:{BRAND["text"]};">{intro}</p>'
        await _send(to, render(tpl_e["subject"]), _wrap(tpl_e["heading"], inner))
        return

    tpl = await get_template(_db(), "patient_results")
    cards = ""
    axis_meta = {
        "issues": (35, "Specializes in your concerns"),
        "availability": (20, "Matches your schedule"),
        "modality": (15, "Offers your preferred format"),
        "urgency": (10, "Can take you on quickly"),
        "prior_therapy": (10, "Right fit for your therapy history"),
        "experience": (5, "Matches your experience preference"),
        "gender": (3, "Matches your gender preference"),
        "style": (2, "Aligns with your style preference"),
        "payment_fit": (3, "Open to your budget on a sliding scale"),
        "modality_pref": (4, "Practices your preferred therapy approach"),
    }
    for i, app in enumerate(applications[:5], 1):
        t = app["therapist"]
        bd = app.get("match_breakdown") or {}
        reasons = sorted(
            (
                (k, v, axis_meta[k][1])
                for k, v in bd.items()
                if k in axis_meta and axis_meta[k][0] > 0 and v > 0
            ),
            # Always show the top 3 highest-raw-score axes (no % threshold)
            key=lambda x: x[1],
            reverse=True,
        )[:3]
        reasons_html = ""
        if reasons:
            chips = "".join(
                f'<span style="display:inline-block;background:#ffffff;border:1px solid {BRAND["border"]};color:{BRAND["text"]};font-size:12px;padding:5px 10px;border-radius:999px;margin:2px 4px 2px 0;">{label}</span>'
                for _, _, label in reasons
            )
            reasons_html = (
                f'<div style="background:{BRAND["bg"]};border:1px solid {BRAND["border"]};border-radius:10px;padding:10px 12px;margin-top:10px;">'
                f'<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{BRAND["muted"]};margin-bottom:6px;">Why we matched</div>'
                f'<div>{chips}</div>'
                f'</div>'
            )
        cards += f"""
        <div style="background:#ffffff;border:1px solid {BRAND['border']};border-radius:14px;padding:22px;margin-bottom:14px;">
          <div style="display:inline-block;background:{BRAND['primary']};color:#ffffff;font-size:12px;padding:4px 10px;border-radius:999px;letter-spacing:0.05em;margin-bottom:10px;">{int(app['match_score'])}% MATCH</div>
          <h3 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:22px;color:{BRAND['primary']};">{i}. {t['name']}</h3>
          <div style="color:{BRAND['muted']};font-size:13px;margin-bottom:10px;">{', '.join(t.get('specialties_display', [])[:3])} • {t.get('years_experience', '?')} yrs experience</div>
          <p style="margin:10px 0;color:{BRAND['text']};font-size:14px;line-height:1.6;font-style:italic;border-left:3px solid {BRAND['secondary']};padding-left:12px;">"{app.get('message', '')}"</p>
          {reasons_html}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;font-size:13px;color:{BRAND['text']};">
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Email</td><td style="padding:3px 0;">{t['email']}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Phone</td><td style="padding:3px 0;">{t.get('phone', '—')}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Cash rate</td><td style="padding:3px 0;">${t.get('cash_rate', '?')}/session</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Free consult</td><td style="padding:3px 0;">{'Yes' if t.get('free_consult') else 'No'}</td></tr>
          </table>
        </div>
        """
    results_url = f"{_get_app_url()}/results/{request_id}"
    count = len(applications[:5])
    vars_ = {"count": count, "results_url": results_url}
    intro = render(tpl["intro"], **vars_)
    cta_label = render(tpl["cta_label"], **vars_)
    cta_html = (
        f'<p style="margin:28px 0;">'
        f'<a href="{results_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
    ) if cta_label else ""
    inner = f"""
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">{intro}</p>
    <div style="margin:24px 0;">{cards}</div>
    {cta_html}
    """
    subject = render(tpl["subject"], **vars_)
    await _send(to, subject, _wrap(tpl["heading"], inner))


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
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner))


async def send_therapist_approved(to: str, name: str) -> None:
    tpl = await get_template(_db(), "therapist_approved")
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
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner))


async def send_magic_code(to: str, code: str, role: str) -> None:
    tpl = await get_template(_db(), "magic_code")
    ttl = int(os.environ.get("MAGIC_CODE_TTL_MINUTES", "30"))
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
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">{footer_note}</p>
    """
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner))



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
    await _send(to, subject, _wrap("License renewal reminder", inner))


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
    await _send(to, subject, _wrap("License renewal alert", inner))


async def send_followup_survey(
    to: str, request_id: str, milestone: str
) -> None:
    """48h / 2-week / 6-week post-results survey email to the patient."""
    portal_url = f"{_get_app_url()}/followup/{request_id}/{milestone}"
    titles = {
        "48h": ("48 hours in — how's it going?", "Just a quick check-in"),
        "2wk": ("2 weeks in — quick check-in", "How are sessions going?"),
        "6wk": ("6 weeks in — measuring progress", "Last check-in"),
    }
    subject, heading = titles.get(milestone, ("How's therapy going?", "Quick check-in"))
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi there,</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      It's been a {('few days' if milestone == '48h' else 'couple weeks' if milestone == '2wk' else 'few weeks')}
      since we sent you matches. We'd love to know how it's going so we can keep
      improving for everyone.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      It's a 30-second form — totally anonymous to your therapist.
    </p>
    <p style="margin:28px 0;">
      <a href="{portal_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Share an update</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      If you didn't end up working with anyone, that's useful too — let us know what got in the way.
    </p>
    """
    await _send(to, subject, _wrap(heading, inner))


async def send_availability_prompt(to: str, therapist_name: str) -> None:
    """Mon/Fri reminder asking the therapist to refresh their availability."""
    first_name = _first_name(therapist_name)
    portal_url = f"{_get_app_url()}/portal/therapist"
    subject = "Quick check — is your TheraVoca availability still current?"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first_name},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Twice a week we ping you to keep your <strong>same-week availability</strong> accurate.
      A 10-second update keeps you on top of patient match results.
    </p>
    <p style="margin:28px 0;">
      <a href="{portal_url}?confirmAvailability=1" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Confirm or update availability</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">
      If your availability hasn't changed, just hit "Yes, still current" in the portal.
    </p>
    """
    await _send(to, subject, _wrap("Availability check-in", inner))
