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
        "greeting": "Hello,",
        "intro": "Thank you for trusting TheraVoca to help you find the right therapist. Please confirm your email so we can begin matching you.",
        "cta_label": "Confirm my request",
        "footer_note": "If the button doesn't work, paste the link into your browser.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "verify_url",
    },
    "therapist_notification": {
        "title": "Therapist referral notification",
        "description": "Sent to each therapist newly notified for a request. PHI-trimmed: the email body no longer carries the patient's age, location, presenting issues, or the match score — those live behind the secure apply link.",
        "subject": "New TheraVoca referral — ready for review",
        "heading": "A new referral is waiting",
        "greeting": "Hi {first_name},",
        "intro": "You have a new TheraVoca referral that the matcher flagged as a strong fit for your practice. The full anonymized brief — including the patient's concerns, preferred format, urgency, and payment fit — is in your secure portal.",
        "cta_label": "View referral & decide",
        "footer_note": "Reply to this email any time. To stop receiving referrals, click Unsubscribe in the portal.",
        "available_vars": "first_name, match_score, apply_url, decline_url",
    },
    "patient_results": {
        "title": "Patient results",
        "description": "Sent to the patient when their ranked matches are ready. PHI-trimmed: the email no longer lists therapist names, scores, or 'why we matched' reasons — patients tap the CTA to view their matches in the secure dashboard.",
        "subject": "Your TheraVoca matches are ready",
        "heading": "Your matches are here",
        "greeting": "",
        "intro": "Your therapist matches are ready to view. Tap the button below to open your secure dashboard — you'll see each match's profile, specialties, fees, and a way to reach out directly.",
        "cta_label": "View my matches",
        "footer_note": "To stop receiving these emails, manage preferences in your dashboard.",
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
        "footer_note": "Nothing to do on your end — we'll email you as soon as we have more for you. Reply to this email any time if you want to adjust your preferences.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
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
        "description": (
            "Sent when admin approves a pending therapist signup. The "
            "'Next steps' block + both CTA buttons are admin-editable -- "
            "previously they were hardcoded HTML and only the standard "
            "subject/heading/greeting/intro/footer were editable. The "
            "next-steps list takes one item per line; the two CTA labels "
            "drive the primary (Sign in to your portal) + secondary "
            "(Complete your profile) buttons. Leave next_steps blank to "
            "hide the entire block."
        ),
        "subject": "You're approved — welcome to TheraVoca",
        "heading": "You're live on TheraVoca",
        "greeting": "Hi {first_name},",
        "intro": "Great news — your TheraVoca profile is approved and live. Referrals matched to your specialties start flowing from today.",
        "cta_label": "",
        # New editable fields 2026-05-17 (Josh: "missing text (next steps...)
        # in template that shows up in the live email"). Each newline in
        # `next_steps` becomes an <li> in the rendered list -- so admin
        # can add/remove/reorder items without touching code.
        "next_steps_heading": "Next steps (2 minutes)",
        "next_steps": (
            "<strong>Sign in</strong> with your email — we'll email you a 6-digit code. No password required.\n"
            "<strong>Add a warm bio and your openings</strong> so patients pick you quickly.\n"
            "Watch your inbox for referrals. You'll get an email + text when a patient matches your profile at 70%+."
        ),
        "cta_primary": "Sign in to your portal",
        "cta_secondary": "Complete your profile",
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
    "therapist_survey": {
        "title": "Therapist survey (Phase 3)",
        "description": "Sent every 10 referrals OR 14 days (whichever first) to gauge match fit + NPS + ongoing-client conversion.",
        "subject": "Quick check-in on your TheraVoca matches",
        "heading": "How are your matches working out?",
        "greeting": "Hi {first_name},",
        "intro": "It's been a few weeks since your recent matches. We'd love a quick check-in to help us send you better-fit patients.",
        "cta_label": "Share quick feedback",
        "footer_note": "Takes about 60 seconds. Your responses help us improve match quality for you and other therapists.",
        "available_vars": "first_name, therapist_id, survey_number",
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
        # Footer is intentionally short. The global wrapper already
        # supplies "If this wasn't you, please ignore this message" +
        # support contact, so repeating either here was creating the
        # duplicate-paragraph noise users complained about. Sign-in
        # codes are also transactional -- there is no "STOP" option.
        "footer_note": "Codes are for one-time sign-in only. Never share this code with anyone -- TheraVoca staff will never ask you for it.",
        "available_vars": "code, ttl_minutes",
    },
    "new_referral_inquiry": {
        "title": "New referral inquiry (LLM outreach)",
        "description": (
            "Sent by the LLM outreach agent to UN-signed-up therapists "
            "we found via Google Places + license-board lookups when an "
            "active patient request scores 70%+ against their public "
            "practice info. Different from the gap recruiter (which "
            "targets coverage holes proactively); this fires per-request "
            "to fill specific patient matches."
        ),
        "subject": "TheraVoca referral request -- strong fit",
        "heading": "New referral inquiry",
        "greeting": "Hi {first_name},",
        "intro": (
            "I run TheraVoca, a small Idaho-based therapist matching "
            "service. We just received a referral request that looks "
            "like a strong fit for your practice based on your public "
            "practice information."
        ),
        "rationale": "{rationale}",
        "cta_label": "Apply for this referral",
        "pricing_note": (
            "To apply, create your free profile (30-day free trial, "
            "$45/mo after). You'll be auto-matched with this referral "
            "the moment your profile is live, and you'll only get "
            "notifications for future patients who are a strong fit "
            "for your specialties and schedule."
        ),
        "footer_note": (
            "If this isn't a fit, no need to reply — we won't contact "
            "you again unless we get another high-fit patient. We don't "
            "sell or share your email."
        ),
        "available_vars": "first_name, score, rationale, signup_url, opt_out_url",
    },
    "prelaunch_invite": {
        # NOTE: key kept as "prelaunch_invite" for backwards compatibility
        # with existing admin overrides + tests. User-facing copy is now
        # timeless so this template can run on an ongoing basis, not just
        # pre-launch.
        "title": "Gap-recruit invite",
        "description": (
            "Sent by the gap recruiter to therapists in underserved Idaho "
            "specialties when our directory is thin for a given match "
            "profile. Auto-recruit cycle generates drafts; admin approves "
            "before they go out. Runs ongoing -- not pre-launch-only."
        ),
        "subject": "Idaho therapist outreach — joining TheraVoca's network",
        "heading": "Recruiting invite",
        "greeting": "Hi {first_name},",
        "intro": (
            "I'm reaching out from TheraVoca, a small Idaho-based therapist "
            "matching service. We came across your practice and you look "
            "like a strong fit for an underserved area we're trying to fill."
        ),
        "rationale": "{rationale}",
        "cta_label": "See if TheraVoca is a fit",
        "pricing_note": (
            "30-day free trial, $45/mo after — no clients, no charge. "
            "We don't sell your email."
        ),
        "footer_note": (
            "You're receiving this because TheraVoca is recruiting for an "
            "underserved Idaho specialty. Reference code: {code}. You can "
            "ignore this email — we won't follow up unless you click above."
        ),
        "available_vars": "first_name, rationale, code, signup_url",
    },
    # ── v2 patient survey emails ────────────────────────────────────
    "patient_survey_v2_48h": {
        "title": "48-hour check-in (v2)",
        "description": "Sent 48 hours after patient receives matches. Quick pulse on process.",
        "subject": "[48-Hour Check-in] How did your matches feel?",
        "heading": "How did your matches feel?",
        "greeting": "Hello,",
        "intro": (
            "It's been a couple of days since we sent your therapist matches. "
            "We'd love a quick 15-second check-in -- your answers help us "
            "match the next person better."
        ),
        "cta_label": "Share a quick update",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist. "
            "We use them to improve our matching for the next time you or "
            "someone else needs us. Thanks for paying it forward!"
        ),
        "footer_note": "Just 2 questions. Your responses are private and never shared with your therapist.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_3w": {
        "title": "3-week check-in (v2)",
        "description": "Sent 3 weeks after matches. Selection + first impressions.",
        "subject": "[Week 3 Check-in] How are things going?",
        "heading": "How are things going?",
        "greeting": "Hello,",
        "intro": (
            "It's been about three weeks since we matched you. Whether you've "
            "started sessions or are still deciding, we'd love to hear how "
            "it's going -- takes about a minute."
        ),
        "cta_label": "Share your update",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist. "
            "We use them to improve our matching for the next time you or "
            "someone else needs us. Thanks for paying it forward!"
        ),
        "footer_note": "A few quick questions about your experience. Your feedback directly shapes how we match future patients.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_9w": {
        "title": "9-week check-in (v2)",
        "description": "Sent 9 weeks after matches. Retention + Match Strength.",
        "subject": "[Week 9 Check-in] How is therapy going?",
        "heading": "How's it going with your therapist?",
        "greeting": "Hello,",
        "intro": (
            "It's been about two months since we connected you with your "
            "therapist. We'd love to hear how the relationship is developing "
            "-- your honest answers help us make better matches."
        ),
        "cta_label": "Quick check-in (under 2 minutes)",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist "
            "or use them on public profiles. Internal use only -- to improve "
            "our matching for the next time you or someone else needs us. "
            "Thanks for paying it forward!"
        ),
        "footer_note": "Your answers are private and never shared with your therapist. They help us improve the matching experience for everyone.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_15w": {
        "title": "15-week outcome check-in (v2)",
        "description": "Sent 15 weeks after matches. Final outcome + referral.",
        "subject": "[Week 15 Check-in] Final reflection on your experience",
        "heading": "Looking back",
        "greeting": "Hello,",
        "intro": (
            "It's been a few months since we matched you with a therapist. "
            "This is our last check-in -- we'd love to know how things have "
            "turned out. Your reflections shape how we match the next person."
        ),
        "cta_label": "Share your outcome (under 2 minutes)",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist "
            "or use them on public profiles. Internal use only -- to improve "
            "our matching for the next time you or someone else needs us. "
            "Thanks for paying it forward!"
        ),
        "footer_note": "This is the last survey we'll send. Your responses are completely private and help us improve outcomes for future patients.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    # ── v2 reminder emails (day +3 after original, one per milestone) ──
    "patient_survey_v2_48h_reminder": {
        "title": "48-hour check-in reminder",
        "description": "One reminder 3 days after the 48h survey email. Final ask.",
        "subject": "[48-Hour Check-in] How did your matches feel? — quick reminder",
        "heading": "Quick follow-up",
        "greeting": "Hello,",
        "intro": (
            "Checking back on the quick feedback we sent a few days ago about "
            "your matches. Three questions, 60 seconds. Whatever you share "
            "helps us match the next person better."
        ),
        "cta_label": "Share feedback (60 seconds)",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist. "
            "We use them to improve our matching for the next time you or "
            "someone else needs us. Thanks for paying it forward!"
        ),
        "footer_note": "Three quick questions. Takes 60 seconds.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_3w_reminder": {
        "title": "3-week check-in reminder",
        "description": "One reminder 3 days after the 3w survey email. Final ask.",
        "subject": "[Week 3 Check-in] How are things going? — quick reminder",
        "heading": "Quick follow-up",
        "greeting": "Hello,",
        "intro": (
            "Checking back on the check-in we sent a few days ago. A few "
            "quick questions about how your therapist match is going -- "
            "takes about a minute. Your answers directly improve how we "
            "match the next person."
        ),
        "cta_label": "Share your update",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist. "
            "We use them to improve our matching for the next time you or "
            "someone else needs us. Thanks for paying it forward!"
        ),
        "footer_note": "A few quick questions about your experience. Your feedback directly shapes how we match future patients.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_9w_reminder": {
        "title": "9-week check-in reminder",
        "description": "One reminder 3 days after the 9w survey email. Final ask.",
        "subject": "[Week 9 Check-in] How is therapy going? — quick reminder",
        "heading": "Quick follow-up",
        "greeting": "Hello,",
        "intro": (
            "Checking back on the therapy check-in we sent a few days ago. "
            "Your honest answers about how things are going -- about 2 "
            "minutes -- help us make better matches for the next person."
        ),
        "cta_label": "Quick check-in (under 2 minutes)",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist "
            "or use them on public profiles. Internal use only -- to improve "
            "our matching for the next time you or someone else needs us. "
            "Thanks for paying it forward!"
        ),
        "footer_note": "Your answers are private and never shared with your therapist. They help us improve the matching experience for everyone.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "patient_survey_v2_15w_reminder": {
        "title": "15-week outcome reminder",
        "description": "One reminder 3 days after the 15w survey email. Final ask.",
        "subject": "[Week 15 Check-in] Final reflection on your experience — quick reminder",
        "heading": "Final follow-up",
        "greeting": "Hello,",
        "intro": (
            "Checking back on the final check-in we sent a few days ago. "
            "Your reflections on how things turned out -- about 2 minutes "
            "-- shape how we match the next person."
        ),
        "cta_label": "Share your outcome (under 2 minutes)",
        "privacy_note": (
            "Your answers are private. We don't share them with any therapist "
            "or use them on public profiles. Internal use only -- to improve "
            "our matching for the next time you or someone else needs us. "
            "Thanks for paying it forward!"
        ),
        "footer_note": "This is the last survey we'll send. Your responses are completely private and help us improve outcomes for future patients.<br/><br/>To stop receiving these emails, reply STOP or email support@theravoca.com.",
        "available_vars": "request_id",
    },
    "claim_profile": {
        "title": "Claim & complete profile",
        "description": "Sent to existing imported therapists asking them to claim their profile and complete missing fields. The list of missing fields and the percent-complete progress bar render below the intro -- they're code-controlled and aren't editable here.",
        "subject": "Welcome to TheraVoca -- claim & complete your profile",
        "heading": "Welcome to TheraVoca",
        "greeting": "Hi {first_name},",
        "intro": "We're going live with TheraVoca -- a referral platform that does the logistical work of connecting clients to therapists like you so you can spend more time with patients and less on intake calls.\n\nWe've already pre-loaded your basic credentials. To make sure patients get the best possible match (and so your profile shows up in search), please take 5 minutes to fill in what's missing.",
        "cta_label": "Complete my profile",
        "footer_note": "You'll sign in with a one-time code sent to this email -- no password to remember.",
        "available_vars": "first_name, score, edit_url, portal_url",
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
    allowed = {
        "subject", "heading", "greeting", "intro", "cta_label", "footer_note",
        "rationale", "pricing_note", "body", "privacy_note",
        # therapist_approved-specific editable fields (2026-05-17)
        "next_steps_heading", "next_steps", "cta_primary", "cta_secondary",
    }
    update = {k: v for k, v in fields.items() if k in allowed and isinstance(v, str)}
    update["key"] = key
    await db.email_templates.update_one(
        {"key": key}, {"$set": update}, upsert=True
    )
    return await get_template(db, key)


def render(text: str, **vars_: Any) -> str:
    """Tolerant {var}-style substitution: missing keys leave the placeholder intact.
    Newlines in the source text are converted to <br/> tags so blank lines
    the admin types in the template editor actually render as visible spacing
    in the outgoing email. (Subjects don't contain newlines so this is safe
    for them too -- the input field is single-line.)
    """
    if not text:
        return ""
    result = text
    for k, v in vars_.items():
        result = result.replace("{" + k + "}", str(v))
    result = result.replace("\r\n", "\n").replace("\n", "<br/>\n")
    return result
