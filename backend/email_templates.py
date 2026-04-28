"""Editable email template store. Admin can override the editable parts
(subject + greeting + intro + cta_label + footer_note) of every transactional email.

The HTML wrapper, brand styling and dynamic data tables stay code-controlled in
email_service.py — only the wording bits below are user-editable from the admin UI.
"""
from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

# Default copy. Editable fields per template: subject, greeting, intro, cta_label, footer_note.
# Variable substitution is simple {var}-style. Available vars per template are documented inline.
DEFAULTS: dict[str, dict[str, str]] = {
    "verification": {
        "title": "Email verification",
        "description": "Sent to a patient after they submit the intake form.",
        "subject": "Confirm your TheraVoca request",
        "heading": "Almost there",
        "greeting": "",
        "intro": "Thank you for trusting TheraVoca to help you find the right therapist. Please confirm your email so we can begin matching you.",
        "cta_label": "Confirm my request",
        "footer_note": "If the button doesn't work, paste the link into your browser.",
        "available_vars": "verify_url",
    },
    "therapist_notification": {
        "title": "Therapist referral notification",
        "description": "Sent to each therapist newly notified for a request.",
        "subject": "New referral match ({match_score}%) — TheraVoca",
        "heading": "New referral matched to you",
        "greeting": "Hi {first_name},",
        "intro": "We have an anonymous referral that looks like a strong fit for your practice.",
        "cta_label": "I'm interested",
        "footer_note": "Click above to view the full anonymous referral and write a short note to the patient. No action is needed if this isn't a fit.",
        "available_vars": "first_name, match_score, apply_url, decline_url",
    },
    "patient_results": {
        "title": "Patient results",
        "description": "Sent to the patient with their ranked therapist matches.",
        "subject": "Your {count} therapist matches are ready",
        "heading": "Your matches are here",
        "greeting": "",
        "intro": "Your personalized therapist matches are ready. These therapists read your anonymous referral and want to work with you. Tap <strong>View full profile &amp; contact</strong> on any match below to see their bio and reach out — many offer a free 15-minute consult.",
        "cta_label": "View full matches",
        "footer_note": "",
        "available_vars": "count, results_url",
    },
    "patient_results_empty": {
        "title": "Patient results — no matches yet",
        "description": "Sent when the 24h window passes and no therapist has responded.",
        "subject": "TheraVoca update on your matches",
        "heading": "We're still working on it",
        "greeting": "",
        "intro": "Thank you for your patience. We weren't able to confirm a match within the first 24 hours. Don't worry — we're still reaching out to additional therapists on your behalf and will follow up soon.",
        "cta_label": "",
        "footer_note": "",
        "available_vars": "",
    },
    "therapist_signup_received": {
        "title": "Therapist signup confirmation",
        "description": "Sent when a therapist self-signs up via /therapists/join.",
        "subject": "Welcome to TheraVoca — profile under review",
        "heading": "Profile received — under review",
        "greeting": "Hi {first_name},",
        "intro": "Thank you for joining the TheraVoca network. We've received your profile and our team will manually verify your license and credentials. Most profiles are approved within 1–2 business days.\n\nA quick heads-up: <strong>you can't sign in to edit your profile yet</strong> — accounts unlock once you're approved. If you need to make any edits before going live, just reply to this email and we'll handle it for you. We'll also email you a sign-in link the moment your profile is approved.",
        "cta_label": "",
        "footer_note": "Once approved, you'll start receiving anonymous referral notifications matched to your specialties — no logins required to view referrals from your inbox. Just real patients who need your help.",
        "available_vars": "first_name",
    },
    "therapist_approved": {
        "title": "Therapist approved",
        "description": "Sent when admin approves a pending therapist signup.",
        "subject": "You're approved — TheraVoca",
        "heading": "You're live on TheraVoca",
        "greeting": "Hi {first_name},",
        "intro": "Great news — your TheraVoca profile is live. You're now eligible to receive anonymous referral notifications matched to your specialties.",
        "cta_label": "",
        "footer_note": "We'll route referrals to you whenever a patient match scores 71% or higher. Watch your inbox.",
        "available_vars": "first_name",
    },
    "magic_code": {
        "title": "Magic sign-in code",
        "description": "Sent for passwordless sign-in (patient or therapist portals).",
        "subject": "Your TheraVoca sign-in code: {code}",
        "heading": "Your sign-in code",
        "greeting": "",
        "intro": "Use this code to sign in. It expires in {ttl_minutes} minutes.",
        "cta_label": "",
        "footer_note": "If you didn't request this, you can safely ignore this email.",
        "available_vars": "code, ttl_minutes",
    },
}


async def get_template(db: AsyncIOMotorDatabase, key: str) -> dict[str, Any]:
    """Fetch a template by key, falling back to DEFAULTS. Returns a flat dict
    of all editable fields with variables NOT YET substituted."""
    base = DEFAULTS.get(key) or {}
    override = await db.email_templates.find_one({"key": key}, {"_id": 0})
    if override:
        return {**base, **{k: v for k, v in override.items() if k in base and v is not None}}
    return dict(base)


async def list_templates(db: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    """Return all templates merged with their overrides — for the admin UI."""
    overrides = {
        d["key"]: d
        async for d in db.email_templates.find({}, {"_id": 0})
    }
    out: list[dict[str, Any]] = []
    for key, base in DEFAULTS.items():
        ov = overrides.get(key) or {}
        merged = {
            "key": key,
            **base,
            **{k: v for k, v in ov.items() if k != "key" and v is not None},
        }
        out.append(merged)
    return out


async def upsert_template(
    db: AsyncIOMotorDatabase, key: str, fields: dict[str, Any]
) -> dict[str, Any]:
    """Persist editable fields for a template. Whitelisted fields only."""
    if key not in DEFAULTS:
        raise ValueError(f"Unknown template key: {key}")
    allowed = {"subject", "heading", "greeting", "intro", "cta_label", "footer_note"}
    update = {k: v for k, v in fields.items() if k in allowed and isinstance(v, str)}
    update["key"] = key
    await db.email_templates.update_one(
        {"key": key}, {"$set": update}, upsert=True
    )
    return await get_template(db, key)


def render(text: str, **vars_: Any) -> str:
    """Tolerant {var}-style substitution: missing keys leave the placeholder intact."""
    if not text:
        return ""
    result = text
    for k, v in vars_.items():
        result = result.replace("{" + k + "}", str(v))
    return result
