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
        "title": "Patient results — still working on it",
        "description": "Sent when no therapist has responded within the first window. Reassuring, forward-looking — never frames it as a failure.",
        "subject": "Quick update on your TheraVoca match",
        "heading": "We're still working on it",
        "greeting": "",
        "intro": "Just a quick update — we're actively reaching out to additional therapists who fit your needs. Great matches are worth getting right, so we'd rather take a little longer than send you someone who isn't a strong fit. We'll follow up the moment we hear back.",
        "cta_label": "",
        "footer_note": "Nothing to do on your end — we'll email you as soon as we have more for you. Reply to this email any time if you want to adjust your preferences.",
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
        "subject": "You're approved — welcome to TheraVoca",
        "heading": "You're live on TheraVoca",
        "greeting": "Hi {first_name},",
        "intro": "Great news — your TheraVoca profile is approved and live. Referrals matched to your specialties start flowing from today.",
        "cta_label": "",
        "footer_note": "We route referrals to you whenever a patient match scores 70% or higher. No passwords — we'll email a 6-digit code when you sign in. Reply to this email anytime if you need a hand.",
        "available_vars": "first_name",
    },
    "therapist_rejected": {
        "title": "Therapist signup declined",
        "description": "Sent when admin rejects a pending therapist signup. Warm tone, leaves door open for future re-apply.",
        "subject": "A quick update on your TheraVoca application",
        "heading": "Not the right moment — yet",
        "greeting": "Hi {first_name},",
        "intro": "Thank you so much for applying to join the TheraVoca network — we're genuinely grateful for the time you put into your profile.",
        "body": "After a careful review we're not moving forward with your application at this time. This is almost always a signal that our network coverage already overlaps heavily with your specialty / location, or that a small profile detail needs polishing — <strong>it is not a judgement on your practice</strong>. We'd love to revisit this as we expand into new specialties and states — please consider applying again in 3–6 months, or reply to this email with a short note about what you'd like us to reconsider.",
        "cta_label": "",
        "footer_note": "Wishing you and your clients well. — The TheraVoca team",
        "available_vars": "first_name",
    },
    "patient_followup_48h": {
        "title": "Patient follow-up — 48 hours after matches",
        "description": "Short pulse check 48 hours after the patient has received their matches.",
        "subject": "How's it going with your TheraVoca matches?",
        "heading": "Quick check-in",
        "greeting": "Hi there,",
        "intro": "You received your therapist matches a couple of days ago. We'd love a 30-second pulse check so we can keep improving — your answers go straight to the team.",
        "cta_label": "Share feedback (30 seconds)",
        "footer_note": "Three quick multiple-choice questions. Your responses are private and help us get better matches to the next patient.",
        "available_vars": "request_id",
    },
    "patient_followup_2w": {
        "title": "Patient follow-up — 2 weeks after matches",
        "description": "Longer-horizon follow-up 14 days after matches to measure outcome.",
        "subject": "Two weeks in — how did your TheraVoca match work out?",
        "heading": "Checking in on your match",
        "greeting": "Hi there,",
        "intro": "It's been about two weeks since we sent your therapist matches. Whether or not you booked someone, we'd love to hear how it went.",
        "cta_label": "Tell us how it went (under 60 seconds)",
        "footer_note": "Three questions. Your feedback directly shapes how we pick therapists for future patients.",
        "available_vars": "request_id",
    },
    "therapist_followup_2w": {
        "title": "Therapist follow-up — 2 weeks after first referrals",
        "description": "Sent 2 weeks after a therapist's first referral notifications to gather quality feedback.",
        "subject": "How are the TheraVoca referrals going?",
        "heading": "Are we sending you the right patients?",
        "greeting": "Hi {first_name},",
        "intro": "You've had TheraVoca referrals for a couple of weeks now. We'd love a quick sanity check — how well are the matches lining up with your practice?",
        "cta_label": "Share feedback (60 seconds)",
        "footer_note": "Three quick questions. Your input tightens how we filter specialties and availability for every future referral.",
        "available_vars": "first_name",
    },
    "therapist_stale_profile_nag": {
        "title": "Stale profile nudge (90-day)",
        "description": "Sent when a therapist hasn't logged in or updated their profile in 90+ days. Cron: daily sweep.",
        "subject": "A 2-minute update to your TheraVoca profile",
        "heading": "Patients look at your profile before they book",
        "greeting": "Hi {first_name},",
        "intro": "It's been <strong>{days_stale} days</strong> since your TheraVoca profile was last updated. Patients scan your bio, fees, and openings before deciding to reach out — a quick refresh meaningfully boosts bookings.",
        "cta_label": "Update my profile",
        "footer_note": "Takes about two minutes. No password — we email you a sign-in code when you click the button.",
        "available_vars": "first_name, days_stale",
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
    "new_referral_inquiry": {
        "title": "New referral inquiry (LLM outreach)",
        "description": (
            "Sent by the LLM outreach agent to UN-signed-up therapists "
            "we found via Google Places + license-board lookups when an "
            "active patient request scores 70%+ against their public "
            "practice info. Different from the gap recruiter (which "
            "targets coverage holes pre-launch); this fires per-request "
            "to fill specific patient matches."
        ),
        "subject": "TheraVoca referral request — {score}% estimated match",
        "heading": "New referral inquiry",
        "greeting": "Hi {first_name},",
        "intro": (
            "I run TheraVoca, a small Idaho-based therapist matching "
            "service. We just received a referral request that looks "
            "like a strong fit for your practice — estimated "
            "<strong>{score}% match</strong> based on your public "
            "practice information."
        ),
        "rationale": "{rationale}",
        "cta_label": "Apply for this referral",
        "pricing_note": (
            "To apply, create your free profile (30-day free trial, "
            "$45/mo after). You'll be auto-matched with this referral "
            "the moment your profile is live, and you'll only get "
            "notifications for future patients who score 70%+ on your "
            "specialties and schedule."
        ),
        "footer_note": (
            "If this isn't a fit, no need to reply — we won't contact "
            "you again unless we get another high-fit patient. We don't "
            "sell or share your email."
        ),
        "available_vars": "first_name, score, rationale, signup_url, opt_out_url",
    },
    "prelaunch_invite": {
        "title": "Pre-launch invite (gap recruiter)",
        "description": (
            "Sent by the gap recruiter to therapists in underserved Idaho "
            "specialties before public launch. Auto-recruit cycle generates "
            "drafts; admin approves before they go out."
        ),
        "subject": "Idaho therapist outreach — joining TheraVoca's launch network",
        "heading": "Pre-launch invite",
        "greeting": "Hi {first_name},",
        "intro": (
            "I'm reaching out from TheraVoca, a small Idaho-based therapist "
            "matching service. We're building our directory ahead of launch, "
            "and your practice came up as a strong fit for an underserved "
            "area we're trying to fill."
        ),
        "rationale": "{rationale}",
        "cta_label": "See if TheraVoca is a fit",
        "pricing_note": (
            "30-day free trial, $45/mo after — no clients, no charge. "
            "We don't sell your email."
        ),
        "footer_note": (
            "You're receiving this because TheraVoca is recruiting for an "
            "underserved Idaho specialty before public launch. Reference "
            "code: {code}. You can ignore this email — we won't follow up "
            "unless you click above."
        ),
        "available_vars": "first_name, rationale, code, signup_url",
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
    allowed = {"subject", "heading", "greeting", "intro", "cta_label", "footer_note", "rationale", "pricing_note", "body"}
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
