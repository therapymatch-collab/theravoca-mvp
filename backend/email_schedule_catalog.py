"""Static catalog of when every TheraVoca email goes out.

Josh 2026-05-17: "give me full list of when all emails go out. put
in admin under 'content' as new chip for 'Email Cron Schedules'."

This module is the single source of truth for the admin-facing
"when does each email fire" answer. It captures both:

  1. CRON-DRIVEN sends (scheduled via cron.py's _daily_loop +
     _sweep_loop -- the loops emit at fixed wall-clock times and
     iterate over the universe of patients/therapists to find who
     qualifies).
  2. REAL-TIME sends (fired from a route handler when a specific
     user action happens -- new signup, intake submit, etc.).

Each entry pairs the template_key with its real trigger (the
condition the codebase actually checks) so admin sees the FACTUAL
schedule, not aspirational marketing copy.

The quiet_hours field reflects the 2026-05-17 categorization in
email_service.py: True = defers to next 8 AM Idaho local outside
the 8 AM–8 PM window; False = always sends now regardless.

How to keep this catalog in sync with code:

  - When you add a new template to email_templates.DEFAULTS, add
    an entry HERE in the matching section (real_time if it fires
    on a route, cron if it fires from a daily loop).
  - When you change a cron trigger (e.g. survey delay from 48h to
    72h), update the `trigger` string here too.
  - When you flip a template between deferrable and always-send
    in email_service._QUIET_HOURS_DEFERRABLE, flip its
    quiet_hours bool here in the same commit.

Because the data is static, the admin panel doesn't need a "last
refreshed" timestamp -- just re-deploy after editing this file.
"""
from __future__ import annotations

from typing import Any

# ── Cron-driven sends ───────────────────────────────────────────
# Grouped by the loop / hour gate that fires them.
CRON_JOBS: list[dict[str, Any]] = [
    {
        "job_name": "Results delivery sweep",
        "schedule": "Every 5 minutes (continuous loop)",
        "schedule_detail": (
            "Backend background loop in cron._sweep_loop (interval "
            "300 s). Picks up verified intake requests whose result "
            "email hasn't been sent yet AND whose verified_at is "
            "older than AUTO_RESULTS_DELAY_HOURS (default 24 h)."
        ),
        "emails": [
            {
                "template_key": "patient_results",
                "trigger": (
                    "Patient match results auto-delivered 24 h after "
                    "intake verification IF the matcher gathered "
                    "enough therapist applications -- OR sooner if "
                    "3+ therapists accept early."
                ),
                "recipient": "Patient (intake submitter)",
                "quiet_hours_deferred": False,
                "why_now": "Patient has been actively waiting for matches",
            },
        ],
    },
    {
        "job_name": "Outreach retry sweep",
        "schedule": "Every 5 minutes (continuous loop)",
        "schedule_detail": (
            "Self-heal sweep in cron._sweep_pending_outreach. Re-runs "
            "the LLM outreach agent for any verified request whose "
            "outreach was queued (outreach_needed_count > 0) but "
            "never executed (no outreach_run_at flag) AND whose "
            "matched_at is older than 2 minutes."
        ),
        "emails": [
            {
                "template_key": "new_referral_inquiry",
                "trigger": (
                    "LLM outreach agent finds an unsigned-up "
                    "therapist via Google Places + license-board "
                    "lookup who scores 70 %+ against an active "
                    "patient request."
                ),
                "recipient": "Cold outbound therapist",
                "quiet_hours_deferred": True,
                "why_now": (
                    "Cold outbound -- never urgent; respects 8 AM–8 PM."
                ),
            },
        ],
    },
    {
        "job_name": "Daily bundle (2 AM Idaho)",
        "schedule": "Once per day at DAILY_TASK_HOUR Idaho local (default 02:00 America/Boise, DST-aware)",
        "schedule_detail": (
            "All time-based maintenance + survey emails fire in this "
            "single bundle so they're done before the workday. Atomic "
            "single-winner gate prevents double-fire on rolling "
            "deploys. Each task wrapped in _safe_run so a single "
            "failure can't poison the rest of the bundle."
        ),
        "emails": [
            {
                "template_key": "license_expiring_to_therapist",
                "trigger": (
                    "Therapist's license_expires_at is within "
                    "LICENSE_WARN_DAYS (default 30) AND no warning "
                    "has been sent yet (license_warn_30_sent_at "
                    "unset)."
                ),
                "recipient": "Therapist",
                "quiet_hours_deferred": False,
                "why_now": (
                    "Bundle already runs at 2 AM Idaho; the email "
                    "lands in their inbox by 2:01 AM and Resend "
                    "delivers it then. (Quiet-hours guard isn't "
                    "wired here because the cron itself is the time "
                    "gate.)"
                ),
            },
            {
                "template_key": "license_expiring_to_admin",
                "trigger": (
                    "Same condition as above; admin gets a parallel "
                    "alert at ADMIN_NOTIFY_EMAIL if configured."
                ),
                "recipient": "Admin (ADMIN_NOTIFY_EMAIL)",
                "quiet_hours_deferred": False,
                "why_now": "Operational alert -- fires with the bundle",
            },
            {
                "template_key": "therapist_followup_2w",
                "trigger": (
                    "14 days after first_referral_sent_at on the "
                    "therapist doc, AND therapist_2w_followup_sent_at "
                    "is unset. Skips unsubscribed / hard_bounced."
                ),
                "recipient": "Therapist (active, post-first-referral)",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "therapist_survey",
                "trigger": (
                    "Every 10 referrals OR 14 days since the last "
                    "therapist_survey was sent (whichever comes "
                    "first). Skipped when the therapist has zero "
                    "applications ever."
                ),
                "recipient": "Therapist",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "therapist_stale_profile_nag",
                "trigger": (
                    "Therapist profile not updated in "
                    "PROFILE_STALE_DAYS (default 90). Idempotent via "
                    "stale_profile_nag_sent_at -- nudge fires once, "
                    "re-arms when the therapist updates the profile."
                ),
                "recipient": "Therapist",
                "quiet_hours_deferred": True,
                "why_now": "Nudge -- defers to next 8 AM",
            },
            {
                "template_key": "prelaunch_invite",
                "trigger": (
                    "Gap recruiter daily cycle -- up to 10 drafts/day "
                    "for underserved Idaho specialties. Drafts queued "
                    "in db.gap_recruit_drafts; admin approves before "
                    "they send. dry_run flag in app_config.track_b_"
                    "config gates live sends."
                ),
                "recipient": "Cold outbound therapist (after admin approval)",
                "quiet_hours_deferred": True,
                "why_now": "Cold outbound -- never urgent",
            },
            {
                "template_key": "patient_survey_v2_48h",
                "trigger": (
                    "48 hours after results_sent_at (testing_mode "
                    "collapses to 0 days). Skipped if unsubscribed / "
                    "hard_bounced / surveys_test_fired."
                ),
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_3w",
                "trigger": "21 days after results_sent_at.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_9w",
                "trigger": "63 days after results_sent_at.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_15w",
                "trigger": "105 days after results_sent_at.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_48h_reminder",
                "trigger": (
                    "3 days after the original 48h survey email if "
                    "the patient hasn't submitted feedback yet."
                ),
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey reminder -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_3w_reminder",
                "trigger": "3 days after the 3w survey email, no feedback.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey reminder -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_9w_reminder",
                "trigger": "3 days after the 9w survey email, no feedback.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey reminder -- defers to next 8 AM",
            },
            {
                "template_key": "patient_survey_v2_15w_reminder",
                "trigger": "3 days after the 15w survey email, no feedback.",
                "recipient": "Patient",
                "quiet_hours_deferred": True,
                "why_now": "Survey reminder -- defers to next 8 AM",
            },
            {
                "template_key": "cron_health_alert_to_admin",
                "trigger": (
                    "Any cron job stuck >24 h, recent failures in the "
                    "last 7 days, or a 'stalest' job whose latest "
                    "completion is >36 h ago. Deduped to at most one "
                    "email per 24 h."
                ),
                "recipient": "Admin (ADMIN_NOTIFY_EMAIL)",
                "quiet_hours_deferred": False,
                "why_now": "Operational alert -- delivered with the bundle",
            },
        ],
    },
    {
        "job_name": "Weekly auto-recruit cycle (Mondays)",
        "schedule": "Mondays at DAILY_TASK_HOUR Idaho local (folded into the daily bundle)",
        "schedule_detail": (
            "Self-gates: skipped entirely when disabled in config or "
            "when target zero-pool rate is already met. Generates "
            "drafts that the regular gap-recruit path then emails."
        ),
        "emails": [
            {
                "template_key": "prelaunch_invite",
                "trigger": (
                    "Auto-recruit cycle identifies a coverage hole "
                    "and creates a draft that the gap recruiter "
                    "later sends (after admin approval)."
                ),
                "recipient": "Cold outbound therapist",
                "quiet_hours_deferred": True,
                "why_now": "Cold outbound -- never urgent",
            },
        ],
    },
    {
        "job_name": "Workday block (10 AM Idaho)",
        "schedule": "Once per day at AVAILABILITY_PROMPT_HOUR_LOCAL Idaho local (default 10:00)",
        "schedule_detail": (
            "Separate hour gate from the 2 AM bundle. Runs during "
            "therapists' working hours so they see the prompt while "
            "awake. Self-gates by day-of-week via "
            "AVAILABILITY_PROMPT_DAYS (default Monday only)."
        ),
        "emails": [
            {
                "template_key": "availability_prompt",
                "trigger": (
                    "Configured day-of-week (default Monday) at "
                    "10:00 Idaho. Skipped if therapist opted out via "
                    "notify_email=False, unsubscribed, or "
                    "hard_bounced."
                ),
                "recipient": "Therapist",
                "quiet_hours_deferred": False,
                "why_now": (
                    "Cron itself gates to 10 AM workday -- already "
                    "inside the quiet-hours window."
                ),
            },
        ],
    },
]


# ── Real-time sends (triggered by a specific user/admin action) ──
REAL_TIME_EMAILS: list[dict[str, Any]] = [
    {
        "template_key": "verification",
        "trigger": "Patient submits intake form (POST /api/requests).",
        "recipient": "Patient",
        "quiet_hours_deferred": False,
        "why_now": "User just submitted the form and needs the confirmation link immediately",
    },
    {
        "template_key": "patient_intake_receipt",
        "trigger": "Same intake submit as above (separate confirmation email).",
        "recipient": "Patient",
        "quiet_hours_deferred": False,
        "why_now": "Immediate 'we got it' acknowledgement",
    },
    {
        "template_key": "magic_code",
        "trigger": (
            "User (patient or therapist) clicks Sign In and requests "
            "a passwordless code."
        ),
        "recipient": "User who clicked sign-in",
        "quiet_hours_deferred": False,
        "why_now": (
            "User is staring at the sign-in screen waiting for the code"
        ),
    },
    {
        "template_key": "therapist_signup_received",
        "trigger": "Therapist submits self-signup at /therapists/join.",
        "recipient": "Therapist",
        "quiet_hours_deferred": False,
        "why_now": "Immediate 'we got your application' acknowledgement",
    },
    {
        "template_key": "therapist_approved",
        "trigger": (
            "Admin clicks Approve on a pending therapist (POST "
            "/api/admin/therapists/{id}/approve)."
        ),
        "recipient": "Therapist",
        "quiet_hours_deferred": True,
        "why_now": "Therapist isn't actively waiting at a screen -- courteous to defer to 8 AM",
    },
    {
        "template_key": "therapist_rejected",
        "trigger": (
            "Admin clicks Reject on a pending therapist (POST "
            "/api/admin/therapists/{id}/reject)."
        ),
        "recipient": "Therapist",
        "quiet_hours_deferred": True,
        "why_now": "Defers to 8 AM Idaho",
    },
    {
        "template_key": "therapist_notification",
        "trigger": (
            "Matcher creates an application -- a patient's request "
            "scored above the notification threshold against the "
            "therapist's profile."
        ),
        "recipient": "Therapist",
        "quiet_hours_deferred": False,
        "why_now": "NEW REFERRAL -- Josh's rule: always send immediately",
    },
    {
        "template_key": "patient_results_empty",
        "trigger": (
            "Patient's intake processed but no therapist accepted "
            "within the matching window."
        ),
        "recipient": "Patient",
        "quiet_hours_deferred": True,
        "why_now": "Status update -- defers to 8 AM",
    },
    {
        "template_key": "claim_profile",
        "trigger": (
            "Admin imports a scraped therapist profile; the system "
            "sends a 'claim & complete' invitation."
        ),
        "recipient": "Imported therapist",
        "quiet_hours_deferred": True,
        "why_now": "Cold-ish outbound -- defers to 8 AM",
    },
]


def build_schedule_response() -> dict[str, Any]:
    """Return the full admin-facing schedule dict.

    Shape used by the EmailCronSchedulesPanel React component:
      {
        "cron_jobs": [ { job_name, schedule, schedule_detail, emails: [...] }, ... ],
        "real_time": [ { template_key, trigger, recipient, quiet_hours_deferred, why_now }, ... ],
        "policy": { "quiet_hours_window_local": "08:00-20:00", "quiet_hours_tz": "America/Boise" },
      }
    """
    return {
        "cron_jobs": CRON_JOBS,
        "real_time": REAL_TIME_EMAILS,
        "policy": {
            "quiet_hours_window_local": "08:00-20:00",
            "quiet_hours_tz": "America/Boise",
            "explanation": (
                "Templates marked 'quiet_hours_deferred=true' use "
                "Resend's native scheduled_at to defer outside the "
                "8 AM-8 PM Idaho window to the next 8 AM Idaho local. "
                "Templates marked false always send immediately "
                "regardless of clock (user actively waiting, or "
                "Josh's referral always-send rule)."
            ),
        },
    }
