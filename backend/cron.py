"""Background cron: results sweep + daily billing/license/availability tasks."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import stripe_service
from deps import (
    db, logger, AUTO_DELAY_HOURS, ADMIN_NOTIFY_EMAIL,
    LICENSE_WARN_DAYS, AVAILABILITY_PROMPT_DAYS,
    DAILY_TASK_HOUR_LOCAL, DAILY_TASK_TZ_OFFSET_HOURS,
)
from email_service import (
    send_availability_prompt,
    send_followup_survey,
    send_license_expiring_to_admin,
    send_license_expiring_to_therapist,
)
from helpers import _deliver_results, _now_iso, _trigger_matching
from sms_service import send_availability_prompt_sms


# ─── Results sweep ───────────────────────────────────────────────────────────

async def _sweep_overdue_results() -> None:
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
            logger.info("Outreach-retry for %s → %s", req["id"][:8], res)
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
    return datetime.now(timezone.utc) + timedelta(hours=DAILY_TASK_TZ_OFFSET_HOURS)


async def _run_daily_billing_charges() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    cur = db.therapists.find(
        {
            "subscription_status": {"$in": ["trialing", "active"]},
            "stripe_customer_id": {"$ne": None},
            "current_period_end": {"$ne": None, "$lte": now.isoformat()},
        },
        {"_id": 0, "id": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1,
         "subscription_status": 1, "name": 1, "email": 1},
    )
    charged = 0
    failed = 0
    async for t in cur:
        res = stripe_service.charge_monthly_fee(
            customer_id=t["stripe_customer_id"],
            payment_method_id=t.get("stripe_payment_method_id"),
        )
        if res.get("error"):
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"subscription_status": "past_due", "updated_at": _now_iso()}},
            )
            logger.warning("Daily billing: %s charge failed (%s)", t.get("email"), res.get("error"))
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
    local = _now_local()
    if local.weekday() not in AVAILABILITY_PROMPT_DAYS:
        return {"sent": 0, "reason": "not Mon/Fri"}
    today_iso = local.date().isoformat()
    cur = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["canceled", "rejected"]},
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
                await send_availability_prompt(t["email"], t["name"])
                sent_email += 1
            except Exception as e:
                logger.warning("Availability email failed for %s: %s", t.get("email"), e)
        sms_to = t.get("phone_alert") or t.get("phone") or ""
        if sms_to and t.get("notify_sms", True):
            try:
                await send_availability_prompt_sms(sms_to, t["name"], portal_url)
                sent_sms += 1
            except Exception as e:
                logger.warning("Availability SMS failed for %s: %s", t.get("email"), e)
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


async def _run_followup_surveys() -> dict[str, int]:
    """Send 48h / 2-week / 6-week follow-ups based on `results_sent_at`.
    Idempotent via `followup_sent_at_<milestone>` flag on the request doc."""
    now = datetime.now(timezone.utc)
    milestones = [
        ("48h", 2, "followup_sent_48h"),
        ("2wk", 14, "followup_sent_2wk"),
        ("6wk", 42, "followup_sent_6wk"),
    ]
    sent: dict[str, int] = {}
    for code, days, flag in milestones:
        cutoff = (now - timedelta(days=days)).isoformat()
        cur = db.requests.find(
            {
                "results_sent_at": {"$ne": None, "$lte": cutoff},
                flag: {"$exists": False},
                "email": {"$ne": None},
            },
            {"_id": 0, "id": 1, "email": 1},
        )
        count = 0
        async for r in cur:
            try:
                await send_followup_survey(r["email"], r["id"], code)
                await db.requests.update_one(
                    {"id": r["id"]},
                    {"$set": {flag: _now_iso()}},
                )
                count += 1
            except Exception as e:
                logger.warning("Followup %s failed for %s: %s", code, r["id"], e)
        if count:
            logger.info("Follow-up %s surveys sent: %d", code, count)
        sent[code] = count
    return sent


async def _run_gap_recruitment() -> dict[str, int]:
    """Daily gap-fill: keep the directory healthy by recruiting therapists for
    the most-in-demand specialties/cities/age groups we're thin on. Pre-launch
    this runs in `dry_run=True` mode (fake emails, drafts only)."""
    try:
        from gap_recruiter import run_gap_recruitment
        return await run_gap_recruitment(dry_run=True, max_drafts=10)
    except Exception as e:
        logger.warning("Daily gap recruit failed: %s", e)
        return {"error": str(e)}


async def _run_patient_structured_followups() -> dict[str, int]:
    """Phase-2 patient follow-ups with links to a structured 3-question form.
    Separate from `_run_followup_surveys` (which sends an unstructured NPS
    survey) — this sends the new `patient_followup_48h` and
    `patient_followup_2w` templates.
    Flags: `structured_followup_48h_sent_at`, `structured_followup_2w_sent_at`.
    """
    from email_service import send_patient_followup_48h, send_patient_followup_2w
    now = datetime.now(timezone.utc)
    milestones = [
        ("48h", 2, "structured_followup_48h_sent_at", send_patient_followup_48h),
        ("2w", 14, "structured_followup_2w_sent_at", send_patient_followup_2w),
    ]
    out: dict[str, int] = {}
    for code, days, flag, sender in milestones:
        cutoff = (now - timedelta(days=days)).isoformat()
        cur = db.requests.find(
            {
                "results_sent_at": {"$ne": None, "$lte": cutoff},
                flag: {"$exists": False},
                "email": {"$ne": None},
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
                logger.warning("Structured follow-up %s failed for %s: %s", code, r["id"], e)
        out[code] = count
    return out


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
            await send_therapist_stale_profile_nag(t["email"], t["name"], days_stale)
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"stale_profile_nag_sent_at": _now_iso()}},
            )
            count += 1
        except Exception as e:
            logger.warning("Stale-profile nag failed for %s: %s", t["id"], e)
    return {"sent": count}


async def _run_auto_recruit_weekly() -> dict[str, Any]:
    """Weekly self-healing recruiter cycle — runs simulator, builds plan,
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
                    bill = await _run_daily_billing_charges()
                    lic = await _run_license_expiry_alerts()
                    avail = await _run_availability_prompts()
                    follow = await _run_followup_surveys()
                    structured = await _run_patient_structured_followups()
                    t_follow = await _run_therapist_2w_followups()
                    stale = await _run_stale_profile_nag()
                    recruit = await _run_gap_recruitment()
                    # Weekly self-healing auto-recruit cycle (Mondays).
                    # _run_auto_recruit_weekly() is itself a no-op on non-
                    # Monday days so we can just invoke it unconditionally
                    # and let it self-gate. Internally it also early-exits
                    # when zero-pool rate is already <= target.
                    auto_rec = None
                    if local.weekday() == 0:  # Monday
                        auto_rec = await _run_auto_recruit_weekly()
                    await db.cron_runs.update_one(
                        {"name": "daily_tasks", "date": today_iso},
                        {"$set": {
                            "completed_at": _now_iso(),
                            "billing": bill, "license": lic, "availability": avail,
                            "followups": follow, "structured_followups": structured,
                            "therapist_followups": t_follow,
                            "stale_profile_nag": stale,
                            "gap_recruit": recruit,
                            "auto_recruit_weekly": auto_rec,
                        }},
                    )
        except Exception as e:
            logger.exception("Daily-loop error: %s", e)
        await asyncio.sleep(1800)
