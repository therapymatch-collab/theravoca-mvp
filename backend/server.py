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
    # Best-effort indexes: the rate-limit lookup is the only hot path on
    # `intake_ip_log`. We also use a TTL index so old IPs auto-expire
    # after 24h — keeps the collection bounded without needing a cron.
    try:
        await db.intake_ip_log.create_index("ip")
        await db.intake_ip_log.create_index(
            "ts_at", expireAfterSeconds=24 * 3600,
        )
    except Exception as _idx_err:  # noqa: BLE001
        logger.warning("intake_ip_log index setup failed: %s", _idx_err)
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
