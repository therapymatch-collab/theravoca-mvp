"""Background cron: results sweep + daily billing/license/availability tasks."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

import stripe_service
from deps import (
    db, logger, AUTO_DELAY_HOURS, ADMIN_NOTIFY_EMAIL,
    LICENSE_WARN_DAYS, AVAILABILITY_PROMPT_DAYS,
    DAILY_TASK_HOUR_LOCAL, DAILY_TASK_TZ_OFFSET_HOURS,
)
from email_service import (
    send_availability_prompt,
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


async def _sweep_loop(interval_seconds: int = 300) -> None:
    while True:
        try:
            await _sweep_overdue_results()
        except Exception as e:
            logger.exception("Sweep loop error: %s", e)
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
                    await db.cron_runs.update_one(
                        {"name": "daily_tasks", "date": today_iso},
                        {"$set": {
                            "completed_at": _now_iso(),
                            "billing": bill, "license": lic, "availability": avail,
                        }},
                    )
        except Exception as e:
            logger.exception("Daily-loop error: %s", e)
        await asyncio.sleep(1800)
