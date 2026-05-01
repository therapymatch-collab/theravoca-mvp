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
          You received this email from TheraVoca. If this wasn't you, please ignore this message.<br/>
          Questions? Reach us at <a href="mailto:support@theravoca.com" style="color:{BRAND['primary']};text-decoration:underline;">support@theravoca.com</a>.
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
    from routes.therapists import generate_signed_url
    app_url = _get_app_url()
    apply_url = generate_signed_url(app_url, request_id, therapist_id, "apply")
    decline_url = generate_signed_url(app_url, request_id, therapist_id, "decline")
    portal_url = f"{_get_app_url()}/portal/therapist"
    summary_rows = "".join(
        f'<tr><td style="padding:6px 0;color:{BRAND["muted"]};font-size:13px;width:140px;">{k}</td>'
        f'<td style="padding:6px 0;color:{BRAND["text"]};font-size:14px;">{v}</td></tr>'
        for k, v in summary.items()
    )
    gaps_html = ""
    if gaps:
        rows = "".join(
            f'<li style="margin:10px 0;color:{BRAND["text"]};font-size:14px;line-height:1.55;">'
            f'<div style="font-weight:600;color:{BRAND["primary"]};margin-bottom:2px;">'
            f'{g["label"]}</div>'
            f'<div style="margin-bottom:3px;">{g["explanation"]}</div>'
            f'<div style="color:{BRAND["muted"]};font-size:13px;font-style:italic;">'
            f'→ {g["suggestion"]}</div>'
            f'</li>'
            for g in gaps
        )
        gaps_html = (
            f'<div style="background:#FDF7EC;border:1px solid #E8DCC1;border-radius:12px;'
            f'padding:16px 20px;margin:0 0 20px;">'
            f'<div style="font-size:13px;color:{BRAND["muted"]};text-transform:uppercase;'
            f'letter-spacing:0.08em;margin-bottom:8px;">Why this isn\'t 100% — and what to address</div>'
            f'<ul style="margin:6px 0 0;padding-left:18px;list-style:disc;">{rows}</ul>'
            f'<div style="font-size:12px;color:{BRAND["muted"]};margin-top:10px;line-height:1.5;">'
            f'These don\'t disqualify you — they\'re just the points the patient cares about. '
            f'Speak to them in your reply if you want to apply.'
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
    # Fetch the request once so we can carry its `view_token` into every link
    # — patients land on /results/:id?t=<token> which auto-grants access; if
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

        specialties_list = (t.get("specialties_display") or [])[:5]
        modalities_list = (t.get("modalities") or [])[:4]
        offices_list = (t.get("office_locations") or [])[:3]
        insurance_list = (t.get("insurance_accepted") or [])[:4]
        review_avg = t.get("review_avg")
        review_count = t.get("review_count") or 0
        reviews_line = ""
        if review_count > 0 and review_avg:
            reviews_line = (
                f'<tr><td style="padding:3px 14px 3px 0;color:{BRAND["muted"]};">Reviews</td>'
                f'<td style="padding:3px 0;">★ {review_avg:.1f} · {review_count} review'
                f'{"" if review_count == 1 else "s"}</td></tr>'
            )

        fee_parts = []
        if t.get("cash_rate"):
            fee_parts.append(f"${t['cash_rate']}/session")
        if t.get("sliding_scale"):
            fee_parts.append("sliding scale")
        if t.get("free_consult"):
            fee_parts.append("free consult")
        fee_line = " · ".join(fee_parts) if fee_parts else "—"

        bio_preview = (t.get("bio") or "").strip()
        if len(bio_preview) > 240:
            bio_preview = bio_preview[:237].rstrip() + "…"

        format_label = "Telehealth"
        if t.get("offers_in_person") or offices_list:
            format_label = (
                "In-person & telehealth" if t.get("telehealth") else "In-person"
            ) if offices_list else "Telehealth"
        if t.get("modality_offering") == "both":
            format_label = "In-person & telehealth"

        profile_url = f"{_get_app_url()}/results/{request_id}{token_query}#therapist-{t.get('id', '')}"
        cta_cell = (
            f'<a href="{profile_url}" '
            f'style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;'
            f'text-decoration:none;padding:10px 20px;border-radius:999px;'
            f'font-weight:600;font-size:13px;">View full profile &amp; contact</a>'
        )

        cards += f"""
        <div style="background:#ffffff;border:1px solid {BRAND['border']};border-radius:14px;padding:22px;margin-bottom:14px;">
          <div style="display:inline-block;background:{BRAND['primary']};color:#ffffff;font-size:12px;padding:4px 10px;border-radius:999px;letter-spacing:0.05em;margin-bottom:10px;">{int(round(app.get('patient_rank_score') or app.get('match_score') or 0))}% MATCH</div>
          <h3 style="margin:6px 0 4px;font-family:Georgia,serif;font-size:22px;color:{BRAND['primary']};">{i}. {t['name']}</h3>
          <div style="color:{BRAND['muted']};font-size:13px;margin-bottom:10px;">{', '.join(specialties_list[:3]) or '—'} • {t.get('years_experience', '?')} yrs experience</div>
          {f'<p style="margin:10px 0;color:{BRAND["text"]};font-size:14px;line-height:1.6;font-style:italic;border-left:3px solid {BRAND["secondary"]};padding-left:12px;">"{app.get("message", "")}"</p>' if app.get('message') else ''}
          {reasons_html}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;font-size:13px;color:{BRAND['text']};width:100%;">
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};width:110px;">Fee</td><td style="padding:3px 0;">{fee_line}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:{BRAND['muted']};">Format</td><td style="padding:3px 0;">{format_label}</td></tr>
            {f'<tr><td style="padding:3px 14px 3px 0;color:{BRAND["muted"]};">Offices</td><td style="padding:3px 0;">{", ".join(offices_list)}</td></tr>' if offices_list else ''}
            {f'<tr><td style="padding:3px 14px 3px 0;color:{BRAND["muted"]};">Approaches</td><td style="padding:3px 0;">{", ".join(modalities_list)}</td></tr>' if modalities_list else ''}
            {f'<tr><td style="padding:3px 14px 3px 0;color:{BRAND["muted"]};">Insurance</td><td style="padding:3px 0;">{", ".join(insurance_list)}</td></tr>' if insurance_list else ''}
            {reviews_line}
          </table>
          {f'<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:{BRAND["text"]};">{bio_preview}</p>' if bio_preview else ''}
          <div style="margin-top:16px;">{cta_cell}</div>
        </div>
        """
    results_url = f"{_get_app_url()}/results/{request_id}{token_query}"
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


async def send_intake_receipt(to: str, request_id: str, summary_rows: list[tuple[str, str]]) -> None:
    """Send the patient a read-only receipt of the answers they just
    submitted. Patients can't self-edit a request through the UI, so this
    receipt doubles as their paper trail — they can forward it back to
    support with corrections and we ship a follow-up corrected match.

    `summary_rows` is a list of (label, value) tuples already rendered
    to human-friendly strings by the caller (so the email service stays
    decoupled from intake-form constants). The route layer is
    responsible for ordering + filtering empty rows.
    """
    rows_html = "".join(
        f"""
        <tr>
          <td style="padding:8px 14px 8px 0;color:{BRAND['muted']};font-size:11px;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;width:36%;">{label}</td>
          <td style="padding:8px 0;color:{BRAND['text']};font-size:14px;line-height:1.55;vertical-align:top;">{value or '—'}</td>
        </tr>
        """
        for label, value in summary_rows
    )
    inner = f"""
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      Here's a copy of the referral request you just submitted. We'll start
      matching you with therapists right away — you should hear from us
      within 24 hours.
    </p>
    <p style="font-size:14px;line-height:1.6;color:{BRAND['muted']};">
      Need to correct something? Just reply to this email — once we match,
      we can resend with the right info.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #E8E5DF;width:100%;">
      {rows_html}
    </table>
    <p style="color:{BRAND['muted']};font-size:12px;line-height:1.6;margin-top:28px;">
      Reference: {request_id[:8]} · We'll never share these answers with anyone but the therapists you choose to contact.
    </p>
    """
    await _send(
        to,
        "Your TheraVoca referral — a copy for your records",
        _wrap("Your referral on file", inner),
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
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner))


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
    await _send(to, render(tpl["subject"], **vars_), _wrap(tpl["heading"], inner))


async def _send_simple_cta_template(template_key: str, to: str, cta_url: str, vars_: dict) -> None:
    """Shared helper for short CTA-only emails (follow-ups, profile nags)."""
    tpl = await get_template(_db(), template_key)
    inner, subject, heading = _build_cta_email_html(tpl, cta_url, vars_)
    await _send(to, subject, _wrap(heading, inner))


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
    cta_html = (
        f'<p style="margin:28px 0;text-align:center;">'
        f'<a href="{cta_url}" style="display:inline-block;background:{BRAND["primary"]};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">{cta_label}</a>'
        f'</p>'
    ) if cta_label else ""
    body_html = (
        f'<p style="font-size:15px;line-height:1.7;color:{BRAND["text"]};margin-top:14px;">{body}</p>'
        if body else ""
    )
    inner = f"""
    {f'<p style="font-size:16px;line-height:1.6;">{greeting}</p>' if greeting else ''}
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">{intro}</p>
    {body_html}
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
    "patient_followup_2w":       {"request_id": "sample-id"},
    "patient_followup_6w":       {"request_id": "sample-id"},
    "therapist_followup_2w":     {"first_name": "Alex"},
    "therapist_stale_profile_nag": {"first_name": "Alex", "days_stale": 14},
    "license_expiring_therapist": {"first_name": "Alex", "expires_at": "2026-12-31"},
    "license_expiring_admin":    {"name": "Alex Therapist", "expires_at": "2026-12-31"},
    "magic_code":                {"code": "123456", "role": "patient"},
    "claim_profile":             {"first_name": "Alex", "claim_url": "https://theravoca.com/claim/sample"},
    "availability_prompt":       {"therapist_name": "Alex Therapist"},
    "followup_survey":           {"first_name": "Alex"},
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
        for k in ("subject", "heading", "greeting", "intro", "cta_label", "footer_note", "body"):
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


async def send_patient_followup_48h(to: str, request_id: str) -> None:
    url = f"{_get_app_url()}/feedback/patient/{request_id}?milestone=48h"
    await _send_simple_cta_template("patient_followup_48h", to, url, {"request_id": request_id})


async def send_patient_followup_2w(to: str, request_id: str) -> None:
    url = f"{_get_app_url()}/feedback/patient/{request_id}?milestone=2w"
    await _send_simple_cta_template("patient_followup_2w", to, url, {"request_id": request_id})


async def send_therapist_followup_2w(to: str, name: str, therapist_id: str) -> None:
    url = f"{_get_app_url()}/feedback/therapist/{therapist_id}?milestone=2w"
    await _send_simple_cta_template(
        "therapist_followup_2w", to, url, {"first_name": _first_name(name)},
    )


async def send_therapist_stale_profile_nag(to: str, name: str, days_stale: int) -> None:
    url = f"{_get_app_url()}/portal/therapist/edit"
    await _send_simple_cta_template(
        "therapist_stale_profile_nag", to, url,
        {"first_name": _first_name(name), "days_stale": days_stale},
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
    await _send(to, subject, _wrap("Availability check-in", inner))



async def send_claim_profile_email(
    to: str,
    therapist_name: str,
    score: int,
    missing_fields: list[str],
) -> None:
    """One-time go-live outreach email asking each existing therapist to
    claim their profile and fill in any missing information.

    Renders the actual list of missing fields inline so the therapist
    knows exactly what to fix before they sign in.
    """
    first_name = _first_name(therapist_name)
    portal_url = f"{_get_app_url()}/sign-in?role=therapist"
    edit_url = f"{_get_app_url()}/portal/therapist/edit"
    subject = "Welcome to TheraVoca — claim & complete your profile"
    bullets_html = "".join(
        f'<li style="margin:6px 0;">{label}</li>' for label in missing_fields[:10]
    )
    if not bullets_html:
        bullets_html = '<li style="margin:6px 0;">Your profile is already complete — feel free to refine it any time.</li>'
    inner = f"""
    <p style="font-size:16px;line-height:1.6;">Hi {first_name},</p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      We're going live with TheraVoca — a referral platform that does the
      logistical work of connecting clients to therapists like you so you
      can spend more time with patients and less on intake calls.
    </p>
    <p style="font-size:15px;line-height:1.7;color:{BRAND['text']};">
      We've already pre-loaded your basic credentials. To make sure
      patients get the best possible match (and so your profile shows up
      in search), please take 5 minutes to fill in what's missing.
    </p>
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
        Complete my profile
      </a>
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;text-align:center;">
      You'll sign in with a one-time code sent to this email — no password to remember.
    </p>
    <p style="color:{BRAND['muted']};font-size:13px;line-height:1.6;margin-top:24px;">
      Already signed in? Pop into your <a href="{portal_url}" style="color:{BRAND['primary']};">portal</a>
      any time. Reply to this email if anything looks off — we'd love to hear from you.
    </p>
    """
    await _send(to, subject, _wrap("Claim your TheraVoca profile", inner))
