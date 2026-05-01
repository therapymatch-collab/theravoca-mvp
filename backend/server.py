"""TheraVoca backend — FastAPI app entrypoint.

Routes live in /app/backend/routes/.
Cron loops live in /app/backend/cron.py.
Helpers + matching/results delivery live in /app/backend/helpers.py.
Auth + db + env constants live in /app/backend/deps.py.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

# Re-exports — back-compat for tests/scripts that imported from server directly.
from cron import (  # noqa: F401
    _daily_loop, _run_availability_prompts, _run_daily_billing_charges,
    _run_license_expiry_alerts, _sweep_loop, _sweep_overdue_results,
)
from deps import (  # noqa: F401
    db, logger, mongo_client, ADMIN_PASSWORD, DEFAULT_THRESHOLD,
    AUTO_DELAY_HOURS, JWT_SECRET, JWT_ALGO, _login_attempts, _check_lockout,
    _client_ip, _record_failure, _reset_failures, require_admin,
    require_session, _create_session_token,
)
from helpers import (  # noqa: F401
    _backfill_therapist_geo, _deliver_results, _now_iso, _parse_iso,
    _safe_summary_for_therapist, _strip_id, _trigger_matching, _ts_to_iso,
)
from routes import api_router
from seed_data import generate_seed_therapists

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


_sweep_task: Optional[asyncio.Task] = None
_daily_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _sweep_task, _daily_task
    # Auto-seed only if the directory is completely empty. This guards against
    # accidental wipes during hot-reload AND respects the iter-42 imported
    # therapist directory (don't double-seed alongside real data).
    therapist_count = await db.therapists.count_documents({})
    if therapist_count == 0:
        therapists = generate_seed_therapists(100)
        await db.therapists.insert_many([t.copy() for t in therapists])
        logger.info("Cold start — seeded %d Idaho therapists with v2 schema", len(therapists))

    asyncio.create_task(_backfill_therapist_geo())
    # Best-effort indexes on the hottest query paths. The rate-limit
    # lookup pounds `intake_ip_log` (TTL drops 24h-old rows so the
    # collection self-bounds). Other indexes back the lookups admins
    # and patients hit most often. Index creation is idempotent and
    # cheap when the index already exists, so we re-run on every boot.
    try:
        await db.intake_ip_log.create_index("ip")
        await db.intake_ip_log.create_index(
            "ts_at", expireAfterSeconds=24 * 3600,
        )
        # Patient/admin lookups by email — used by the patient roster,
        # the per-email rate limit, and the "patients by email" panel.
        await db.requests.create_index("email")
        await db.requests.create_index([("email", 1), ("created_at", -1)])
        await db.requests.create_index("created_at")
        # Therapist directory lookups by email + state + active flag.
        await db.therapists.create_index("email")
        await db.therapists.create_index(
            [("is_active", 1), ("licensed_states", 1)],
        )
        await db.therapists.create_index("pending_approval")
        # Apply / decline lookups: scoped by request_id for /results.
        await db.applications.create_index("request_id")
        await db.applications.create_index(
            [("therapist_id", 1), ("created_at", -1)],
        )
        await db.declines.create_index("request_id")
        # Magic-link auth — codes are looked up by (email, code).
        await db.magic_codes.create_index([("email", 1), ("code", 1)])
        # Site-copy lookups happen on every page load (public GET).
        await db.site_copy.create_index("key", unique=True)
    except Exception as _idx_err:  # noqa: BLE001
        logger.warning("Index setup encountered an error: %s", _idx_err)
    # Allow disabling background cron to save memory on staging (512MB).
    if os.environ.get("DISABLE_CRON", "").lower() in ("1", "true", "yes"):
        logger.info("DISABLE_CRON is set — skipping background sweep/daily tasks")
    else:
        sweep_interval = int(os.environ.get("SWEEP_INTERVAL_SECONDS", "300"))
        _sweep_task = asyncio.create_task(_sweep_loop(sweep_interval))
        _daily_task = asyncio.create_task(_daily_loop())
    # Reset any "running" flags that were left orphaned by a previous
    # supervisorctl restart. Background tasks (deep-research warmup,
    # outreach jobs) live in asyncio tasks that die on restart, but their
    # progress flag is on disk in app_config — clear it so the admin UI
    # doesn't perpetually show "Running…" with no actual work happening.
    await db.app_config.update_many(
        {"key": "deep_research_warmup", "running": True},
        {"$set": {
            "running": False,
            "current_name": None,
            "interrupted_by_restart": True,
        }},
    )
    logger.info(
        "Started results sweep loop (every %ds) + daily-task scheduler",
        sweep_interval,
    )
    try:
        yield
    finally:
        for t in (_sweep_task, _daily_task):
            if t:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        mongo_client.close()


app = FastAPI(title="TheraVoca API", lifespan=lifespan)
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
