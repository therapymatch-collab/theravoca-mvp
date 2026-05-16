"""Background cron: results sweep + daily billing/license/availability tasks."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import stripe_service
from deps import (
    db, logger, AUTO_DELAY_HOURS, ADMIN_NOTIFY_EMAIL,
    LICENSE_WARN_DAYS, AVAILABILITY_PROMPT_DAYS,
    DAILY_TASK_HOUR_LOCAL, DAILY_TASK_TZ_OFFSET_HOURS,
    DAILY_TASK_TZ, AVAILABILITY_PROMPT_HOUR_LOCAL,
    PHASE_2_LAUNCH_DATE,
)
import audit
from email_service import (
    send_availability_prompt,
    send_license_expiring_to_admin,
    send_license_expiring_to_therapist,
)
from helpers import _deliver_results, _now_iso, _trigger_matching
from sms_service import send_availability_prompt_sms


# ─── Results sweep ───────────────────────────────────────────────────────────

async def _sweep_overdue_results() -> None:
    audit.emit(
        actor_type="system", actor_id="cron", action="sweep_overdue_results",
        resource="request", detail="limit=200",
    )
    cutoff = datetime.now(timezone.utc) - timedelta(hours=AUTO_DELAY_HOURS)
    cutoff_iso = cutoff.isoformat()
    overdue = await db.requests.find(
        {
            "verified": True,
            "results_sent_at": None,
            "verified_at": {"$lte": cutoff_iso},
        },
        {"_id": 0, "id": 1, "email": 1},
    ).to_list(200)
    for req in overdue:
        try:
            app_count = await db.applications.count_documents({"request_id": req["id"]})
            if app_count < 3:
                logger.info("Sweep: expanding pool for %s (apps=%d)", req["id"], app_count)
                await _trigger_matching(req["id"], threshold=60.0)
            logger.info("Sweep: delivering results for %s", req["id"])
            await _deliver_results(req["id"])
        except Exception as e:
            logger.exception("Sweep failed for %s: %s", req["id"], e)


async def _sweep_pending_outreach() -> None:
    """Self-heal sweep for requests whose LLM outreach got dropped (e.g. due
    to fire-and-forget task GC, transient LLM failure, or backend restart).

    Runs every ~5 minutes. Picks up any verified request that has an
    `outreach_needed_count > 0` and no `outreach_run_at` flag, but only
    >2 minutes after `matched_at` (so we don't race the initial trigger)."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
    cur = db.requests.find(
        {
            "verified": True,
            "outreach_needed_count": {"$gt": 0},
            "outreach_run_at": {"$exists": False},
            "matched_at": {"$lte": cutoff.isoformat()},
        },
        {"_id": 0, "id": 1, "outreach_needed_count": 1},
    )
    pending = await cur.to_list(50)
    if not pending:
        return
    logger.info("Outreach-retry sweep: %d pending request(s)", len(pending))
    from outreach_agent import run_outreach_for_request
    for req in pending:
        try:
            res = await run_outreach_for_request(req["id"])
            logger.info("Outreach-retry for %s -> %s", req["id"][:8], res)
        except Exception as e:
            logger.exception("Outreach-retry failed for %s: %s", req["id"], e)


async def _sweep_loop(interval_seconds: int = 300) -> None:
    while True:
        try:
            await _sweep_overdue_results()
        except Exception as e:
            logger.exception("Sweep loop error: %s", e)
        try:
            await _sweep_pending_outreach()
        except Exception as e:
            logger.exception("Outreach-retry sweep error: %s", e)
        await asyncio.sleep(interval_seconds)


# ─── Daily cron tasks ────────────────────────────────────────────────────────

def _now_local() -> datetime:
    """Wall-clock time in DAILY_TASK_TZ (default America/Boise) -- DST-aware.
    Falls back to the legacy fixed offset if zoneinfo can't resolve the name
    (e.g. tzdata not installed in a stripped container)."""
    try:
        return datetime.now(ZoneInfo(DAILY_TASK_TZ))
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc) + timedelta(
            hours=DAILY_TASK_TZ_OFFSET_HOURS,
        )


async def _get_testing_mode() -> bool:
    """Read the feedback_testing flag from app_config. Used by any cron
    function that needs to collapse time delays for QA."""
    doc = await db.app_config.find_one({"key": "feedback_testing"}, {"_id": 0})
    return bool((doc or {}).get("enabled", False))


async def _safe_run(name: str, fn) -> dict[str, Any]:
    """Per-task safety net for the daily / workday cron bundles.

    Each `_run_*` function ALREADY catches its own exceptions, but
    something not yet covered (a future task added without a try/except,
    a transient Mongo / network blip during an `await`, an OOM) can
    still raise out of the awaited call. Without this wrapper, that
    exception bubbles up, the next tasks in the chain never run, AND
    the final `cron_runs.update_one({completed_at})` never fires --
    the row sits in Mongo as "started but never completed" forever,
    tripping the daily health alert.

    Returns either the task's normal return value or an error dict so
    the bundle can keep going + write a complete `completed_at` row
    that includes the error for forensics.
    """
    try:
        result = await fn()
        return result if isinstance(result, dict) else {"result": result}
    except Exception as e:  # noqa: BLE001 -- intentional catch-all
        logger.exception("Cron task %s raised: %s", name, e)
        return {"error": str(e)[:500], "task": name}


async def _run_daily_billing_charges() -> dict[str, int]:
    now = datetime.now(timezone.utc)

    testing_mode = await _get_testing_mode()
    # SECURITY/CORRECTNESS (2026-05-16 audit):
    #   - paused_at: exclude self-serve-paused therapists (their Stripe
    #     sub is cancel_at_period_end; charging them via our manual
    #     PaymentIntent path would bill a card the user thought they
    #     stopped).
    #   - deleted_at: exclude soft-deleted accounts (24h reversal
    #     window; matcher already excludes them, billing must too).
    #   - cancel_at_period_end: exclude therapists who cancelled in the
    #     Stripe Customer Portal -- Stripe itself won't bill them past
    #     current_period_end, so neither should we.
    #   - stripe_payment_method_id required: skip rows where the PM
    #     wasn't persisted (tab closed mid-checkout etc.) -- the prior
    #     code passed payment_method=None to Stripe, which fell back
    #     unpredictably to the customer's default PM.
    cur = db.therapists.find(
        {
            "subscription_status": {"$in": ["trialing", "active"]},
            "stripe_customer_id": {"$ne": None},
            "stripe_payment_method_id": {"$ne": None},
            "current_period_end": {"$ne": None, "$lte": now.isoformat()},
            "paused_at": None,
            "deleted_at": None,
            "cancel_at_period_end": {"$ne": True},
        },
        {"_id": 0, "id": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1,
         "subscription_status": 1, "name": 1, "email": 1, "current_period_end": 1},
    )
    charged = 0
    failed = 0
    async for t in cur:
        # SECURITY/CORRECTNESS (2026-05-16): pass an idempotency_key so
        # a process crash between successful charge and the Mongo
        # update below doesn't cause the next cron run (or a
        # rolling-deploy second replica) to re-charge. Key is
        # therapist_id + current period end so a different period is a
        # different key. Stripe deduplicates against the same key for
        # 24h.
        idem_key = f"monthly:{t['id']}:{t.get('current_period_end') or 'no-period'}"
        res = stripe_service.charge_monthly_fee(
            customer_id=t["stripe_customer_id"],
            payment_method_id=t.get("stripe_payment_method_id"),
            idempotency_key=idem_key,
        )
        if res.get("error"):
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"subscription_status": "past_due", "updated_at": _now_iso()}},
            )
            logger.warning("Daily billing: therapist=%s charge failed (%s)", t.get("id"), res.get("error"))
            failed += 1
            continue
        next_period = now + timedelta(days=30)
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {
                "subscription_status": "active",
                "current_period_end": next_period.isoformat(),
                "trial_ends_at": None,
                "last_charged_at": _now_iso(),
                "updated_at": _now_iso(),
            }},
        )
        charged += 1
    if charged or failed:
        logger.info("Daily billing: charged=%d failed=%d", charged, failed)
    return {"charged": charged, "failed": failed}


async def _run_license_expiry_alerts() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    cur = db.therapists.find(
        {
            "license_expires_at": {"$exists": True, "$ne": None},
            "is_active": {"$ne": False},
            "license_warn_30_sent_at": {"$exists": False},
        },
        {"_id": 0, "id": 1, "name": 1, "email": 1, "license_expires_at": 1},
    )
    sent = 0
    async for t in cur:
        try:
            exp_str = (t.get("license_expires_at") or "")[:10]
            exp_dt = datetime.fromisoformat(exp_str + "T00:00:00+00:00")
        except Exception:
            continue
        days = (exp_dt - now).days
        if days > LICENSE_WARN_DAYS or days < 0:
            continue
        await send_license_expiring_to_therapist(
            t["email"], t["name"], exp_str, days,
        )
        if ADMIN_NOTIFY_EMAIL:
            await send_license_expiring_to_admin(
                ADMIN_NOTIFY_EMAIL, t["name"], t["email"], exp_str, days,
            )
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {"license_warn_30_sent_at": _now_iso()}},
        )
        sent += 1
    if sent:
        logger.info("License expiry alerts sent: %d", sent)
    return {"sent": sent}


async def _run_availability_prompts() -> dict[str, int]:
    # Check app_config override first, fall back to deps constant
    config_doc = await db.app_config.find_one({"key": "availability_prompt"}, {"_id": 0})
    prompt_days = tuple(config_doc.get("days", []) if config_doc else AVAILABILITY_PROMPT_DAYS)
    local = _now_local()
    if local.weekday() not in prompt_days:
        return {"sent": 0, "reason": f"not a prompt day (configured: {prompt_days})"}
    today_iso = local.date().isoformat()
    cur = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["canceled", "rejected"]},
            "unsubscribed": {"$ne": True},
            "hard_bounced": {"$ne": True},
            "$or": [
                {"availability_prompt_sent_date": {"$ne": today_iso}},
                {"availability_prompt_sent_date": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1,
         "phone_alert": 1, "notify_email": 1, "notify_sms": 1},
    )
    sent_email = 0
    sent_sms = 0
    public_url = os.environ.get("PUBLIC_APP_URL", "")
    portal_url = f"{public_url}/portal/therapist"
    async for t in cur:
        if t.get("notify_email", True):
            try:
                await send_availability_prompt(t["email"], t["name"], t["id"])
                sent_email += 1
            except Exception as e:
                logger.warning("Availability email failed for therapist=%s: %s", t.get("id"), e)
        # SMS gated by SMS_RECRUITING_ONLY (deps.py). Default policy
        # 2026-05-14: skip availability-prompt SMS to signed-up
        # therapists; the email above covers them. Flip the flag to
        # re-enable.
        from deps import SMS_RECRUITING_ONLY
        sms_to = t.get("phone_alert") or t.get("phone") or ""
        if sms_to and t.get("notify_sms", True) and not SMS_RECRUITING_ONLY:
            try:
                await send_availability_prompt_sms(sms_to, t["name"], portal_url)
                sent_sms += 1
            except Exception as e:
                logger.warning("Availability SMS failed for therapist=%s: %s", t.get("id"), e)
        await db.therapists.update_one(
            {"id": t["id"]},
            {"$set": {
                "availability_prompt_sent_date": today_iso,
                "availability_prompt_pending": True,
            }},
        )
    if sent_email or sent_sms:
        logger.info("Availability prompts sent: email=%d sms=%d", sent_email, sent_sms)
    return {"sent_email": sent_email, "sent_sms": sent_sms}


async def _run_gap_recruitment() -> dict[str, int]:
    """Daily gap-fill: keep the directory healthy by recruiting therapists for
    the most-in-demand specialties/cities/age groups we're thin on.

    `dry_run` is read from app_config (key=track_b_config) so admin can flip
    live without a deploy. Default = True (drafts only, fake emails) so a
    missing/never-set config is conservative.
    """
    try:
        from deps import db
        from gap_recruiter import run_gap_recruitment
        cfg = await db.app_config.find_one(
            {"key": "track_b_config"}, {"_id": 0, "dry_run": 1},
        ) or {}
        dry_run = bool(cfg.get("dry_run", True))
        return await run_gap_recruitment(dry_run=dry_run, max_drafts=10)
    except Exception as e:
        logger.warning("Daily gap recruit failed: %s", e)
        return {"error": str(e)}


async def _run_patient_surveys_v2() -> dict[str, int]:
    """Phase 2 patient surveys: 48h, 3w, 9w, 15w milestones.
    Applies only to requests whose results_sent_at >= PHASE_2_LAUNCH_DATE.
    Idempotent via v2_survey_<milestone>_sent_at flags.
    Guard rails: skip unsubscribed, hard-bounced, and test-fired requests."""
    audit.emit(
        actor_type="system", actor_id="cron", action="run_patient_surveys_v2",
        resource="request",
    )
    from email_service import (
        send_patient_survey_v2_48h, send_patient_survey_v2_3w,
        send_patient_survey_v2_9w, send_patient_survey_v2_15w,
    )
    now = datetime.now(timezone.utc)
    testing_mode = await _get_testing_mode()
    milestones = [
        ("48h", 2, "v2_survey_48h_sent_at", send_patient_survey_v2_48h),
        ("3w", 21, "v2_survey_3w_sent_at", send_patient_survey_v2_3w),
        ("9w", 63, "v2_survey_9w_sent_at", send_patient_survey_v2_9w),
        ("15w", 105, "v2_survey_15w_sent_at", send_patient_survey_v2_15w),
    ]
    out: dict[str, int] = {}
    for code, days, flag, sender in milestones:
        effective_days = 0 if testing_mode else days
        cutoff = (now - timedelta(days=effective_days)).isoformat()
        cur = db.requests.find(
            {
                "results_sent_at": {"$ne": None, "$lte": cutoff,
                                    "$gte": PHASE_2_LAUNCH_DATE},
                flag: {"$exists": False},
                "email": {"$ne": None},
                "unsubscribed": {"$ne": True},
                "hard_bounced": {"$ne": True},
                "surveys_test_fired": {"$ne": True},
            },
            {"_id": 0, "id": 1, "email": 1},
        )
        count = 0
        async for r in cur:
            try:
                await sender(r["email"], r["id"])
                await db.requests.update_one(
                    {"id": r["id"]}, {"$set": {flag: _now_iso()}},
                )
                count += 1
            except Exception as e:
                logger.warning("v2 survey %s failed for %s: %s", code, r["id"], e)
        out[code] = count
    return out


async def _run_patient_survey_v2_reminders() -> dict[str, int]:
    """Send reminders for v2 surveys that haven't been submitted yet.
    Each reminder fires 3 days after the initial survey email.
    Idempotent via v2_reminder_<milestone>_sent_at flags.
    Skips if the patient already submitted feedback for that milestone."""
    audit.emit(
        actor_type="system", actor_id="cron", action="run_v2_survey_reminders",
        resource="request",
    )
    from email_service import (
        send_patient_survey_v2_48h_reminder, send_patient_survey_v2_3w_reminder,
        send_patient_survey_v2_9w_reminder, send_patient_survey_v2_15w_reminder,
    )
    now = datetime.now(timezone.utc)
    testing_mode = await _get_testing_mode()
    # reminder_delay_days: how many days after the survey email to send reminder
    reminder_delay_days = 0 if testing_mode else 3
    milestones = [
        ("48h", "v2_survey_48h_sent_at", "v2_reminder_48h_sent_at",
         send_patient_survey_v2_48h_reminder),
        ("3w", "v2_survey_3w_sent_at", "v2_reminder_3w_sent_at",
         send_patient_survey_v2_3w_reminder),
        ("9w", "v2_survey_9w_sent_at", "v2_reminder_9w_sent_at",
         send_patient_survey_v2_9w_reminder),
        ("15w", "v2_survey_15w_sent_at", "v2_reminder_15w_sent_at",
         send_patient_survey_v2_15w_reminder),
    ]
    out: dict[str, int] = {}
    for code, survey_flag, reminder_flag, sender in milestones:
        cutoff = (now - timedelta(days=reminder_delay_days)).isoformat()
        # Find requests where survey was sent but reminder hasn't been,
        # and no feedback doc exists for this milestone yet.
        cur = db.requests.find(
            {
                survey_flag: {"$ne": None, "$lte": cutoff},
                reminder_flag: {"$exists": False},
                "email": {"$ne": None},
                "unsubscribed": {"$ne": True},
                "hard_bounced": {"$ne": True},
                "surveys_test_fired": {"$ne": True},
            },
            {"_id": 0, "id": 1, "email": 1},
        )
        count = 0
        async for r in cur:
            # Skip if patient already submitted feedback for this milestone
            existing = await db.feedback.find_one(
                {"request_id": r["id"], "milestone": code},
                {"_id": 1},
            )
            if existing:
                # Mark reminder as sent so we don't re-check
                await db.requests.update_one(
                    {"id": r["id"]}, {"$set": {reminder_flag: _now_iso()}},
                )
                continue
            try:
                await sender(r["email"], r["id"])
                await db.requests.update_one(
                    {"id": r["id"]}, {"$set": {reminder_flag: _now_iso()}},
                )
                count += 1
            except Exception as e:
                logger.warning("v2 reminder %s failed for %s: %s", code, r["id"], e)
        out[code] = count
    return out


async def _run_therapist_surveys() -> dict[str, int]:
    """Phase 3 therapist surveys -- match fit + NPS + ongoing-client conversion.

    Fires one email per eligible therapist when EITHER trigger is met since
    `last_therapist_survey_sent_at` (or since `created_at` if never sent):
      - 10+ new applications (db.applications.created_at after the anchor), OR
      - 14+ days have passed since the anchor.

    Skip rules:
      - Therapist has zero ever-applications (no signal to give yet)
      - Not active / pending approval / canceled / rejected subscription
      - No email, or unsubscribed/hard_bounced (forward-compat flags)
      - Not yet due (neither trigger met)

    On fire: increment survey_number via `_next_therapist_survey_number`, send
    the email, then stamp `last_therapist_survey_sent_at` + `_sent_number`
    atomically on the therapist doc."""
    audit.emit(
        actor_type="system", actor_id="cron", action="run_therapist_surveys",
        resource="therapist",
    )
    from email_service import send_therapist_survey
    from helpers import _next_therapist_survey_number

    REFERRAL_THRESHOLD = 10
    DAYS_THRESHOLD = 14
    now = datetime.now(timezone.utc)
    cutoff_14d = (now - timedelta(days=DAYS_THRESHOLD)).isoformat()

    cur = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["canceled", "rejected"]},
            "email": {"$ne": None},
            "unsubscribed": {"$ne": True},
            "hard_bounced": {"$ne": True},
        },
        {"_id": 0, "id": 1, "email": 1, "name": 1,
         "created_at": 1, "last_therapist_survey_sent_at": 1},
    )
    sent = 0
    skipped_no_apps = 0
    skipped_not_due = 0
    async for t in cur:
        tid = t["id"]
        last_sent = t.get("last_therapist_survey_sent_at")
        signup = t.get("created_at")

        # Skip if therapist has zero ever-applications -- nothing to ask about.
        total_apps = await db.applications.count_documents({"therapist_id": tid})
        if total_apps == 0:
            skipped_no_apps += 1
            continue

        # Days-based trigger: 14+ days since anchor.
        date_anchor = last_sent or signup
        days_ok = (date_anchor is not None and date_anchor <= cutoff_14d)

        # Referrals-based trigger: 10+ new apps since anchor.
        # When last_sent is null, spec says count ALL applications -- which
        # equals total_apps we already computed above.
        if last_sent:
            new_apps = await db.applications.count_documents(
                {"therapist_id": tid, "created_at": {"$gt": last_sent}}
            )
        else:
            new_apps = total_apps
        referral_ok = new_apps >= REFERRAL_THRESHOLD

        if not (days_ok or referral_ok):
            skipped_not_due += 1
            continue

        try:
            survey_number = await _next_therapist_survey_number(tid)
            await send_therapist_survey(
                t["email"], t.get("name", ""), tid, survey_number,
            )
            now_iso = _now_iso()
            await db.therapists.update_one(
                {"id": tid},
                {"$set": {
                    "last_therapist_survey_sent_at": now_iso,
                    "last_therapist_survey_sent_number": survey_number,
                }},
            )
            sent += 1
        except Exception as e:
            logger.warning("Therapist survey failed for %s: %s", tid, e)

    if sent or skipped_no_apps or skipped_not_due:
        logger.info(
            "Therapist surveys: sent=%d skipped_no_apps=%d skipped_not_due=%d",
            sent, skipped_no_apps, skipped_not_due,
        )
    return {
        "sent": sent,
        "skipped_no_apps": skipped_no_apps,
        "skipped_not_due": skipped_not_due,
    }


async def _run_therapist_2w_followups() -> dict[str, int]:
    """Two weeks after a therapist's first referral, ask them 3 questions
    about referral quality so we can tighten matching. Flag:
    `therapist_2w_followup_sent_at`. Only send to active, non-paused therapists.
    """
    from email_service import send_therapist_followup_2w
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=14)).isoformat()
    cur = db.therapists.find(
        {
            "is_active": True,
            "pending_approval": {"$ne": True},
            "first_referral_sent_at": {"$ne": None, "$lte": cutoff},
            "therapist_2w_followup_sent_at": {"$exists": False},
            "email": {"$ne": None},
            "unsubscribed": {"$ne": True},
            "hard_bounced": {"$ne": True},
        },
        {"_id": 0, "id": 1, "email": 1, "name": 1},
    )
    count = 0
    async for t in cur:
        try:
            await send_therapist_followup_2w(t["email"], t["name"], t["id"])
            await db.therapists.update_one(
                {"id": t["id"]}, {"$set": {"therapist_2w_followup_sent_at": _now_iso()}},
            )
            count += 1
        except Exception as e:
            logger.warning("Therapist 2w follow-up failed for %s: %s", t["id"], e)
    return {"sent": count}


async def _run_stale_profile_nag() -> dict[str, int]:
    """Therapists who haven't updated their profile in 90+ days get a gentle
    reminder so their directory listing stays fresh. Idempotent via
    `stale_profile_nag_sent_at` flag (reset once they update the profile).
    """
    from email_service import send_therapist_stale_profile_nag
    STALE_DAYS = int(os.environ.get("PROFILE_STALE_DAYS", "90"))
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=STALE_DAYS)).isoformat()
    cur = db.therapists.find(
        {
            "is_active": True,
            "pending_approval": {"$ne": True},
            "$or": [
                {"updated_at": {"$lte": cutoff}},
                {"updated_at": {"$exists": False}, "created_at": {"$lte": cutoff}},
            ],
            "stale_profile_nag_sent_at": {"$exists": False},
            "email": {"$ne": None},
            "unsubscribed": {"$ne": True},
            "hard_bounced": {"$ne": True},
        },
        {"_id": 0, "id": 1, "email": 1, "name": 1, "updated_at": 1, "created_at": 1},
    )
    count = 0
    async for t in cur:
        try:
            last = t.get("updated_at") or t.get("created_at") or _now_iso()
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except ValueError:
                last_dt = now
            days_stale = max(STALE_DAYS, (now - last_dt).days)
            await send_therapist_stale_profile_nag(t["email"], t["name"], days_stale, t["id"])
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"stale_profile_nag_sent_at": _now_iso()}},
            )
            count += 1
        except Exception as e:
            logger.warning("Stale-profile nag failed for %s: %s", t["id"], e)
    return {"sent": count}


async def _run_auto_recruit_weekly() -> dict[str, Any]:
    """Weekly self-healing recruiter cycle -- runs simulator, builds plan,
    calls gap recruiter, stamps drafts for admin approval. Skipped if
    disabled in config or if the target zero-pool rate is already met."""
    try:
        import auto_recruit
        doc = await auto_recruit.run_cycle(db, manual_trigger=False)
        return {
            "status": doc.get("status"),
            "cycle_id": doc.get("id"),
            "zero_pool_rate_pct_before": doc.get("zero_pool_rate_pct_before"),
            "drafts_created": doc.get("drafts_created", 0),
        }
    except Exception as e:
        logger.warning("Weekly auto-recruit cycle failed: %s", e)
        return {"error": str(e)}


async def _run_decline_pattern_flags() -> dict[str, Any]:
    """Scan the last 30 days of declines for per-therapist + per-reason
    patterns. If a therapist has 3+ declines for the same reason in
    the window, write/upsert a row in `db.therapist_decline_flags`
    with status="open" so admin sees them in the review queue.
    Re-running is idempotent: existing open flags get their counts
    refreshed; flags whose counts dropped back below threshold are
    auto-closed.

    Threshold + window are intentionally simple v1 -- once we have
    real decline volume we can move to a per-reason threshold (e.g.
    "specialty_mismatch x3 = flag" but "schedule_mismatch x5 = flag"
    since schedule conflicts are noisier signal).
    """
    THRESHOLD = 3  # 3 of same reason in window = pattern
    WINDOW_DAYS = 30
    try:
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz
        cutoff = (_dt.now(_tz.utc) - _td(days=WINDOW_DAYS)).isoformat()
        # Aggregate (therapist_id, reason) -> count + last_decline_at.
        pipeline = [
            {"$match": {"declined_at": {"$gte": cutoff}}},
            {"$unwind": "$reason_codes"},
            {"$group": {
                "_id": {"therapist_id": "$therapist_id", "reason": "$reason_codes"},
                "count": {"$sum": 1},
                "last_decline_at": {"$max": "$declined_at"},
                "therapist_email": {"$last": "$therapist_email"},
            }},
        ]
        cur = db.declines.aggregate(pipeline)
        agg = await cur.to_list(5000)
        # Existing open flags so we know which ones to close-out.
        existing = {}
        async for f in db.therapist_decline_flags.find({"status": "open"}, {"_id": 0}):
            existing[(f.get("therapist_id"), f.get("reason"))] = f
        flagged = 0
        refreshed = 0
        closed = 0
        seen_keys: set[tuple] = set()
        now_iso = _now_iso()
        for row in agg:
            key = (row["_id"]["therapist_id"], row["_id"]["reason"])
            count = row.get("count", 0)
            if count < THRESHOLD:
                continue
            seen_keys.add(key)
            update = {
                "therapist_id": key[0],
                "reason": key[1],
                "count_30d": count,
                "last_decline_at": row.get("last_decline_at"),
                "therapist_email": row.get("therapist_email"),
                "status": "open",
                "updated_at": now_iso,
            }
            if key in existing:
                await db.therapist_decline_flags.update_one(
                    {"therapist_id": key[0], "reason": key[1]},
                    {"$set": update},
                )
                refreshed += 1
            else:
                update["created_at"] = now_iso
                await db.therapist_decline_flags.insert_one(update)
                flagged += 1
        # Auto-close flags whose count dropped below threshold.
        for key, f in existing.items():
            if key not in seen_keys:
                await db.therapist_decline_flags.update_one(
                    {"therapist_id": key[0], "reason": key[1]},
                    {"$set": {"status": "auto_closed",
                              "auto_closed_at": now_iso}},
                )
                closed += 1
        return {
            "threshold": THRESHOLD, "window_days": WINDOW_DAYS,
            "new_flags": flagged, "refreshed": refreshed,
            "auto_closed": closed,
        }
    except Exception as e:
        logger.warning("Decline-pattern flag run failed: %s", e)
        return {"error": str(e)}


async def _run_cron_health_alert() -> dict[str, Any]:
    """Look for stuck / failed / stale cron jobs and email admin.

    Mirrors the read path at /admin/cron/health but actively alerts
    rather than waiting for someone to look. Idempotent + deduped:
    won't re-fire more than once per 24h regardless of how often it's
    invoked (state lives in app_config.cron_alert_state).

    Skips entirely if ADMIN_NOTIFY_EMAIL isn't set.
    """
    from email_service import send_cron_health_alert_to_admin
    if not ADMIN_NOTIFY_EMAIL:
        return {"skipped": "no admin email"}

    now = datetime.now(timezone.utc)
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    cutoff_36h = (now - timedelta(hours=36)).isoformat()
    cutoff_7d = (now - timedelta(days=7)).isoformat()

    stuck = await db.cron_runs.find(
        {"completed_at": None, "started_at": {"$lt": cutoff_24h}},
        {"_id": 0, "name": 1, "started_at": 1},
    ).sort("started_at", 1).limit(50).to_list(50)
    recent_failures = await db.cron_runs.find(
        {"status": "failed", "started_at": {"$gte": cutoff_7d}},
        {"_id": 0, "name": 1, "started_at": 1, "completed_at": 1, "error": 1},
    ).sort("started_at", -1).limit(20).to_list(20)
    # Stalest jobs: ever-completed jobs whose latest completion is >36h ago.
    # If a job has never completed, that's caught by the `stuck` query
    # (or it's a brand-new install -- not our problem).
    last_completion = []
    async for row in db.cron_runs.aggregate([
        {"$match": {"completed_at": {"$ne": None}}},
        {"$sort": {"completed_at": -1}},
        {"$group": {
            "_id": "$name",
            "last_completed_at": {"$first": "$completed_at"},
        }},
    ]):
        last_completion.append({
            "name": row["_id"],
            "last_completed_at": row["last_completed_at"],
        })
    stalest = [
        j for j in last_completion
        if j["last_completed_at"] and j["last_completed_at"] < cutoff_36h
    ]
    stalest.sort(key=lambda j: j["last_completed_at"])

    if not stuck and not recent_failures and not stalest:
        return {"alert_sent": False, "reason": "all clear"}

    # Dedupe: at most one alert per 24h regardless of how many issues.
    state = await db.app_config.find_one(
        {"key": "cron_alert_state"}, {"_id": 0, "last_sent_at": 1}
    ) or {}
    last_sent = state.get("last_sent_at")
    if last_sent and last_sent > cutoff_24h:
        return {
            "alert_sent": False,
            "reason": "deduped",
            "last_sent_at": last_sent,
            "would_have_reported": {
                "stuck": len(stuck),
                "recent_failures": len(recent_failures),
                "stalest": len(stalest),
            },
        }

    try:
        await send_cron_health_alert_to_admin(
            to=ADMIN_NOTIFY_EMAIL,
            stuck=stuck,
            recent_failures=recent_failures,
            stalest_jobs=stalest,
        )
        await db.app_config.update_one(
            {"key": "cron_alert_state"},
            {"$set": {"key": "cron_alert_state", "last_sent_at": _now_iso()}},
            upsert=True,
        )
        return {
            "alert_sent": True,
            "stuck": len(stuck),
            "recent_failures": len(recent_failures),
            "stalest": len(stalest),
        }
    except Exception as e:
        logger.warning("Cron health alert send failed: %s", e)
        return {"alert_sent": False, "error": str(e)}


async def _daily_loop() -> None:
    while True:
        try:
            local = _now_local()
            today_iso = local.date().isoformat()
            if local.hour == DAILY_TASK_HOUR_LOCAL:
                rec = await db.cron_runs.find_one(
                    {"name": "daily_tasks", "date": today_iso}, {"_id": 0}
                )
                if not rec:
                    logger.info("Running daily tasks for %s", today_iso)
                    await db.cron_runs.insert_one(
                        {"name": "daily_tasks", "date": today_iso, "started_at": _now_iso()}
                    )
                    # Each task wrapped in _safe_run so a single failure
                    # never poisons the whole bundle. Without this, an
                    # uncaught exception in (say) _run_gap_recruitment
                    # would skip every task after it AND prevent the
                    # final completed_at update -- the run would sit in
                    # the cron_runs collection forever as "started but
                    # no end time", tripping the daily health alert
                    # every 24h. (Diagnosed 2026-05-16 after 5 stuck
                    # daily_tasks rows from 5/4-5/8 fired the alert.)
                    bill         = await _safe_run("billing", _run_daily_billing_charges)
                    lic          = await _safe_run("license", _run_license_expiry_alerts)
                    # availability prompts have their own hour gate
                    # (AVAILABILITY_PROMPT_HOUR_LOCAL block below) so
                    # therapists get pinged during work hours, not
                    # at 2am with the rest of the daily sweep.
                    avail = {"sent_email": 0, "sent_sms": 0, "reason": "moved_to_workday_hour_block"}
                    t_follow     = await _safe_run("t_follow",  _run_therapist_2w_followups)
                    t_surveys    = await _safe_run("t_surveys", _run_therapist_surveys)
                    stale        = await _safe_run("stale",     _run_stale_profile_nag)
                    recruit      = await _safe_run("recruit",   _run_gap_recruitment)
                    v2_surveys   = await _safe_run("v2_surveys",   _run_patient_surveys_v2)
                    v2_reminders = await _safe_run("v2_reminders", _run_patient_survey_v2_reminders)
                    # Weekly self-healing auto-recruit cycle (Mondays
                    # only -- self-gates internally too).
                    auto_rec = None
                    if local.weekday() == 0:
                        auto_rec = await _safe_run("auto_recruit", _run_auto_recruit_weekly)
                    decline_flags = await _safe_run("decline_flags", _run_decline_pattern_flags)
                    # Health alert sweep -- runs LAST so today's
                    # stuck-job pattern is included. Deduped to one
                    # email per 24h.
                    health        = await _safe_run("health", _run_cron_health_alert)
                    await db.cron_runs.update_one(
                        {"name": "daily_tasks", "date": today_iso},
                        {"$set": {
                            "completed_at": _now_iso(),
                            "billing": bill, "license": lic, "availability": avail,
                            "therapist_followups": t_follow,
                            "therapist_surveys": t_surveys,
                            "stale_profile_nag": stale,
                            "gap_recruit": recruit,
                            "v2_surveys": v2_surveys,
                            "v2_reminders": v2_reminders,
                            "auto_recruit_weekly": auto_rec,
                            "decline_pattern_flags": decline_flags,
                            "cron_health_alert": health,
                        }},
                    )
            # ── Workday-hour block (separate hour gate from 2am bundle) ──
            # Tasks here run during therapists' actual working hours so
            # their inbox/SMS pings them when they're awake. Each task
            # is dedup'd by its own cron_runs row so we don't re-fire
            # on consecutive 30-minute polls within the same hour.
            if local.hour == AVAILABILITY_PROMPT_HOUR_LOCAL:
                rec = await db.cron_runs.find_one(
                    {"name": "workday_tasks", "date": today_iso}, {"_id": 0}
                )
                if not rec:
                    logger.info(
                        "Running workday tasks for %s (local hour=%d, tz=%s)",
                        today_iso, local.hour, DAILY_TASK_TZ,
                    )
                    await db.cron_runs.insert_one(
                        {"name": "workday_tasks", "date": today_iso,
                         "started_at": _now_iso()}
                    )
                    workday_avail = await _run_availability_prompts()
                    await db.cron_runs.update_one(
                        {"name": "workday_tasks", "date": today_iso},
                        {"$set": {
                            "completed_at": _now_iso(),
                            "availability": workday_avail,
                        }},
                    )
        except Exception as e:
            logger.exception("Daily-loop error: %s", e)
        await asyncio.sleep(1800)
