"""Email service for TheraVoca via Resend."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import resend

logger = logging.getLogger(__name__)

resend.api_key = os.environ.get("RESEND_API_KEY", "")
SENDER = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
APP_URL = os.environ.get("PUBLIC_APP_URL", "")

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
    if not resend.api_key:
        logger.warning("RESEND_API_KEY not configured, skipping email to %s", to)
        return None
    params = {"from": SENDER, "to": [to], "subject": subject, "html": html}
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Sent email to %s id=%s", to, result.get("id"))
        return result
    except Exception as e:
        logger.exception("Failed to send email to %s: %s", to, e)
        return None


# ─── Templates ─────────────────────────────────────────────────────────────────

async def send_verification_email(to: str, request_id: str, token: str) -> None:
    verify_url = f"{APP_URL}/verify/{token}"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">
      Thank you for trusting TheraVoca to help you find the right therapist. Please confirm your email so we can begin matching you.
    </p>
    <p style="margin:28px 0;">
      <a href="{verify_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Confirm my request</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">If the button doesn't work, paste this link into your browser:<br/>
      <span style="word-break:break-all;color:{BRAND['primary']};">{verify_url}</span>
    </p>
    """
    await _send(to, "Confirm your TheraVoca request", _wrap("Almost there", inner))


async def send_therapist_notification(
    to: str,
    therapist_name: str,
    request_id: str,
    therapist_id: str,
    match_score: float,
    summary: dict[str, Any],
) -> None:
    apply_url = f"{APP_URL}/therapist/apply/{request_id}/{therapist_id}"
    summary_rows = "".join(
        f'<tr><td style="padding:6px 0;color:{BRAND["muted"]};font-size:13px;width:140px;">{k}</td>'
        f'<td style="padding:6px 0;color:{BRAND["text"]};font-size:14px;">{v}</td></tr>'
        for k, v in summary.items()
    )
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {therapist_name},</p>
    <p style="font-size:16px;line-height:1.6;color:{BRAND['text']};">
      We have an anonymous referral that looks like a strong fit for your practice.
    </p>
    <div style="background:{BRAND['bg']};border:1px solid {BRAND['border']};border-radius:12px;padding:18px 22px;margin:20px 0;">
      <div style="font-size:13px;color:{BRAND['muted']};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Match Score</div>
      <div style="font-family:Georgia,serif;font-size:34px;color:{BRAND['primary']};">{match_score}%</div>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:8px 0 24px;">
      {summary_rows}
    </table>
    <p style="margin:28px 0;">
      <a href="{apply_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">I'm interested</a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;">Click above to view the full anonymous referral and write a short note to the patient. No action is needed if this isn't a fit.</p>
    """
    await _send(to, f"New referral match ({int(match_score)}%) — TheraVoca", _wrap("New referral matched to you", inner))


async def send_patient_results(to: str, request_id: str, applications: list[dict[str, Any]]) -> None:
    if not applications:
        inner = f"""
        <p style="font-size:16px;line-height:1.6;">Thank you for your patience.</p>
        <p style="color:{BRAND['text']};font-size:15px;line-height:1.7;">
          We weren't able to confirm a match within the first 24 hours. Don't worry — we're still reaching out to additional therapists on your behalf and will follow up soon.
        </p>
        """
        await _send(to, "TheraVoca update on your matches", _wrap("We're still working on it", inner))
        return

    cards = ""
    for i, app in enumerate(applications[:5], 1):
        t = app["therapist"]
        cards += f"""
        <div style="background:#ffffff;border:1px solid {BRAND['border']};border-radius:14px;padding:22px;margin-bottom:14px;">
          <div style="display:inline-block;background:{BRAND['primary']};color:#ffffff;font-size:12px;padding:4px 10px;border-radius:999px;letter-spacing:0.05em;margin-bottom:10px;">{int(app['match_score'])}% MATCH</div>
          <h3 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:22px;color:{BRAND['primary']};">{i}. {t['name']}</h3>
          <div style="color:{BRAND['muted']};font-size:13px;margin-bottom:10px;">{', '.join(t.get('specialties_display', [])[:3])} • {t.get('years_experience', '?')} yrs experience</div>
          <p style="margin:10px 0;color:{BRAND['text']};font-size:14px;line-height:1.6;font-style:italic;border-left:3px solid {BRAND['secondary']};padding-left:12px;">"{app.get('message', '')}"</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;font-size:13px;color:{BRAND['text']};">
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Email</td><td style="padding:3px 0;">{t['email']}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Phone</td><td style="padding:3px 0;">{t.get('phone', '—')}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Cash rate</td><td style="padding:3px 0;">${t.get('cash_rate', '?')}/session</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Free consult</td><td style="padding:3px 0;">{'Yes' if t.get('free_consult') else 'No'}</td></tr>
          </table>
        </div>
        """
    results_url = f"{APP_URL}/results/{request_id}"
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Your personalized therapist matches are ready.</p>
    <p style="color:{BRAND['text']};font-size:15px;line-height:1.7;">
      These therapists read your anonymous referral and want to work with you. Reach out directly to whoever feels right — many offer a free consult to see if it's a fit.
    </p>
    <div style="margin:24px 0;">{cards}</div>
    <p style="margin:28px 0;">
      <a href="{results_url}" style="display:inline-block;background:{BRAND['primary']};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">View full matches</a>
    </p>
    """
    await _send(to, f"Your {len(applications[:5])} therapist matches are ready", _wrap("Your matches are here", inner))


async def send_therapist_signup_received(to: str, name: str) -> None:
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {name.split(',')[0]},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Thank you for joining the TheraVoca network. We've received your profile and our team
      will review it shortly. Most profiles are approved within 1–2 business days.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Once approved, you'll start receiving anonymous referral notifications matched to your
      specialties — no logins, no marketing fluff. Just real patients who need your help.
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">
      Questions? Just reply to this email.
    </p>
    """
    await _send(to, "Welcome to TheraVoca — profile under review", _wrap("Profile received", inner))


async def send_therapist_approved(to: str, name: str) -> None:
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {name.split(',')[0]},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Great news — your TheraVoca profile is <strong style="color:{BRAND['primary']}">live</strong>. You're now eligible
      to receive anonymous referral notifications matched to your specialties.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      When a patient request matches your practice (60%+ by default), we'll email you a
      summary and a one-click link to express interest. No dashboards to log into.
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">
      Welcome aboard.
    </p>
    """
    await _send(to, "You're live on TheraVoca", _wrap("You're approved", inner))
