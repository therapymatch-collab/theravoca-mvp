"""TheraVoca backend — FastAPI app entrypoint.

Routes live in /app/backend/routes/.
Cron loops live in /app/backend/cron.py.
Helpers + matching/results delivery live in /app/backend/helpers.py.
Auth + db + env constants live in /app/backend/deps.py.

Deploy pipeline verification: 2026-05-03 06:50 EDT
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
    AUTO_DELAY_HOURS, JWT_SECRET, JWT_ALGO, _ENV, _login_attempts, _check_lockout,
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

# -- Sentry error tracking: reads SENTRY_DSN from env. If unset, Sentry
# is silently disabled (safe for local dev).
import sentry_sdk  # noqa: E402

_sentry_dsn = os.environ.get("SENTRY_DSN", "").strip()
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=_ENV,
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
    logger.info("Sentry initialized for env=%s", _ENV)


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
        if _ENV == "production":
            logger.warning("therapists collection is empty in production -- skipping auto-seed")
        else:
            therapists = generate_seed_therapists(100)
            await db.therapists.insert_many([t.copy() for t in therapists])
            logger.info("Cold start -- seeded %d Idaho therapists with v2 schema", len(therapists))

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
        # HIPAA audit trail -- TTL + query indexes for PHI access log.
        from audit import ensure_indexes as _ensure_audit_indexes
        await _ensure_audit_indexes()
        # Login-event TTL + lookup indexes for the new-IP alert path.
        from login_alerts import ensure_indexes as _ensure_login_indexes
        await _ensure_login_indexes()

        # Additional indexes (BACKLOG #21, audited 2026-05-12). Each
        # wrapped individually so a single failure (e.g. a unique
        # constraint that can't be satisfied because of historical
        # duplicates) doesn't stop the rest from being created.
        async def _safe_idx(coll, *args, **kwargs):
            try:
                await coll.create_index(*args, **kwargs)
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "Optional index on %s failed: %s",
                    getattr(coll, "name", "?"), e,
                )

        # Requests: cron sweeps query by results_sent_at (null/old) and
        # unsubscribed; admin direct-lookup by app-level `id` UUID.
        await _safe_idx(db.requests, "id")
        await _safe_idx(db.requests, "results_sent_at")
        await _safe_idx(db.requests, "unsubscribed")
        # Applications: recent-first lookups across all therapists.
        await _safe_idx(db.applications, "created_at")
        # Feedback: one row per (request, milestone). Unique to prevent
        # double-fires from cron/race conditions.
        await _safe_idx(
            db.feedback, [("request_id", 1), ("milestone", 1)], unique=True,
        )
        # Therapist surveys: one row per (therapist, survey number).
        await _safe_idx(
            db.therapist_surveys,
            [("therapist_id", 1), ("survey_number", 1)],
            unique=True,
        )
    except Exception as _idx_err:  # noqa: BLE001
        logger.warning("Index setup encountered an error: %s", _idx_err)
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
    # One-time cleanup: clear the old verbose magic_code footer override
    # if it still matches the pre-2026-05-13 default verbatim. Without
    # this, the DB override shadows the new (de-duped) DEFAULT and the
    # email keeps printing duplicate "if this wasn't you" copy. Safe to
    # leave in place after the cleanup runs -- the match is exact, so
    # any admin-edited value is left alone.
    _old_magic_footer = (
        "If you didn't request this, you can safely ignore this email."
        "<br/><br/>To stop receiving these emails, reply STOP or email "
        "support@theravoca.com."
    )
    await db.email_templates.update_one(
        {"key": "magic_code", "footer_note": _old_magic_footer},
        {"$unset": {"footer_note": ""}},
    )
    # Same one-time cleanup for the cold-outreach template (subject,
    # intro, pricing_note) -- the old copy quoted a specific "{score}%"
    # which was misleading since the actual score depends on factors
    # that vary day-to-day. New default uses "strong fit" wording.
    _old_nri = {
        "subject": "TheraVoca referral request — {score}% estimated match",
        "intro": (
            "I run TheraVoca, a small Idaho-based therapist matching "
            "service. We just received a referral request that looks "
            "like a strong fit for your practice — estimated "
            "<strong>{score}% match</strong> based on your public "
            "practice information."
        ),
        "pricing_note": (
            "To apply, create your free profile (30-day free trial, "
            "$45/mo after). You'll be auto-matched with this referral "
            "the moment your profile is live, and you'll only get "
            "notifications for future patients who score 70%+ on your "
            "specialties and schedule."
        ),
    }
    for _field, _val in _old_nri.items():
        await db.email_templates.update_one(
            {"key": "new_referral_inquiry", _field: _val},
            {"$unset": {_field: ""}},
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

# ── Build version endpoint ──────────────────────────────────────────
_SERVER_START = __import__("datetime").datetime.utcnow().isoformat() + "Z"

@app.get("/api/version")
async def get_version():
    """Return build info so admins can verify what's actually deployed."""
    return {
        "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown"),
        "service": os.environ.get("RENDER_SERVICE_NAME", "local"),
        "branch": os.environ.get("RENDER_GIT_BRANCH", "unknown"),
        "started_at": _SERVER_START,
    }

# -- CORS: never default to wildcard. Production must set CORS_ORIGINS
# explicitly; dev falls back to localhost only.
_cors_raw = os.environ.get("CORS_ORIGINS", "").strip()
if not _cors_raw:
    if _ENV == "production":
        raise RuntimeError(
            "CORS_ORIGINS must be set in production. "
            "Example: https://theravoca.com,https://www.theravoca.com"
        )
    _cors_origins = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
    ]
    logger.warning(
        "CORS_ORIGINS not set -- defaulting to localhost only: %s",
        _cors_origins,
    )
else:
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    # Restrict to the HTTP methods + headers we actually use. Wildcards
    # were the previous default; tightening reduces the abuse surface a
    # CSRF-style attacker could exploit if a token leaks.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Admin-Password",
        "X-Requested-With",
        "stripe-signature",
    ],
)


# ── Security headers middleware ────────────────────────────────────
# HIPAA quick win (2026-05-12): set baseline security headers on every
# response so PHI in transit is protected and the served SPA is harder
# to embed/sniff. Override via env vars if anything in the policy
# breaks a third-party integration the frontend relies on.
_DEFAULT_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' "
    "https://js.stripe.com https://challenges.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https://api.stripe.com https://challenges.cloudflare.com; "
    "frame-src https://js.stripe.com https://challenges.cloudflare.com; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)
_CSP_VALUE = os.environ.get("CONTENT_SECURITY_POLICY", _DEFAULT_CSP)
_HSTS_VALUE = os.environ.get(
    "STRICT_TRANSPORT_SECURITY", "max-age=31536000; includeSubDomains",
)


@app.middleware("http")
async def _security_headers(request, call_next):
    response = await call_next(request)
    # Don't add HSTS on non-HTTPS requests (e.g. local dev) -- the
    # browser will silently treat it as instructions for plain-HTTP
    # which it ignores, but Lighthouse flags it.
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", _HSTS_VALUE)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(), microphone=(), camera=(), payment=(self)",
    )
    response.headers.setdefault("Content-Security-Policy", _CSP_VALUE)
    return response

