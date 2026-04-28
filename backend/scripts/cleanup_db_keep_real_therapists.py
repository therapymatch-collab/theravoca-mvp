"""One-shot DB cleanup: keep ONLY the user-imported real therapists
(source='imported_xlsx') plus authored content (site_copy, faqs,
email_templates, app_config), and wipe everything else.

Run with:
    python3 /app/backend/scripts/cleanup_db_keep_real_therapists.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient


async def main(dry_run: bool = False) -> None:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        raise SystemExit("MONGO_URL env var is required")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"Connected to {db_name}")

    # 1) Therapists — keep only source='imported_xlsx' and the gap-recruit
    # signup (the one real recruit who self-onboarded via the gap recruiter).
    real_filter = {
        "$or": [
            {"source": "imported_xlsx"},
            {"source": "gap_recruit_signup"},
        ],
    }
    real_count = await db.therapists.count_documents(real_filter)
    total_t = await db.therapists.count_documents({})
    to_drop_t = total_t - real_count
    print(f"\nTherapists: total={total_t}  keep={real_count}  delete={to_drop_t}")

    if not dry_run:
        res = await db.therapists.delete_many(
            {"$nor": [real_filter]}
        )
        print(f"  → deleted {res.deleted_count} therapists")

    # 2) Wipe transactional collections — every entry is test data per audit.
    for coll in (
        "requests",
        "applications",
        "recruit_drafts",
        "outreach_invites",
        "feedback",
        "patient_accounts",
        "magic_codes",
        "therapist_password_reset_tokens",
        "patient_password_reset_tokens",
    ):
        n = await db[coll].count_documents({})
        if n == 0:
            continue
        print(f"  {coll}: {n} → delete all")
        if not dry_run:
            res = await db[coll].delete_many({})
            print(f"    deleted {res.deleted_count}")

    # 3) Admin team — drop the obvious test fixture, keep the rest.
    test_admins = {"jane@theravoca.test"}
    drop_admin = await db.admin_users.count_documents({"email": {"$in": list(test_admins)}})
    if drop_admin:
        print(f"\nadmin_users: dropping {drop_admin} test fixture(s)")
        if not dry_run:
            await db.admin_users.delete_many({"email": {"$in": list(test_admins)}})

    keep_admins = await db.admin_users.count_documents({})
    print(f"admin_users remaining: {keep_admins}")

    # 4) Reset opt-outs (no real users have opted out yet — collection should
    # already be empty per audit, but double-check).
    n_opt = await db.opt_outs.count_documents({})
    if n_opt:
        print(f"opt_outs: {n_opt} → delete all")
        if not dry_run:
            await db.opt_outs.delete_many({})

    # 5) Reset stripe_events (events from prior test sessions).
    n_events = await db.stripe_events.count_documents({})
    if n_events:
        print(f"stripe_events: {n_events} → delete all")
        if not dry_run:
            await db.stripe_events.delete_many({})

    # 6) Final summary
    print("\n=== POST-CLEANUP COUNTS ===")
    for coll in (
        "therapists", "requests", "applications", "recruit_drafts",
        "outreach_invites", "feedback", "patient_accounts", "admin_users",
        "site_copy", "faqs", "email_templates", "app_config", "blog_posts",
    ):
        try:
            n = await db[coll].count_documents({})
        except Exception:
            n = "n/a"
        print(f"  {coll}: {n}")

    print("\nDone." + (" (DRY RUN — no writes)" if dry_run else ""))


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    asyncio.run(main(dry_run=dry))
