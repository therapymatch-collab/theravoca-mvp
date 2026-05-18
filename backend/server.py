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
#
# PII scrubbing (HIPAA-adjacent hygiene): a `before_send` hook walks
# the outgoing event and replaces any email-like, phone-like, or
# 6-digit-OTP-like substring with a redaction marker before the event
# leaves the process. This covers exception messages, breadcrumbs,
# request bodies, and log captures -- the places PII most commonly
# leaks into error reports. `send_default_pii=False` ALSO prevents
# Sentry from auto-including cookies, IP addresses, and user objects.
import re as _re  # noqa: E402
import sentry_sdk  # noqa: E402

_sentry_dsn = os.environ.get("SENTRY_DSN", "").strip()

# Patterns wide enough to catch the obvious shapes without being
# expensive. Run on string fields only.
_PII_EMAIL_RE = _re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE_RE = _re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
_PII_OTP_RE = _re.compile(r"(?<!\d)\d{6}(?!\d)")


def _scrub_str(s):
    if not isinstance(s, str) or not s:
        return s
    s = _PII_EMAIL_RE.sub("<email>", s)
    s = _PII_PHONE_RE.sub("<phone>", s)
    s = _PII_OTP_RE.sub("<otp>", s)
    return s


def _scrub_obj(obj, depth=0):
    """Recursively scrub strings inside dicts/lists. Depth cap so a
    pathological object can't blow the stack."""
    if depth > 6:
        return obj
    if isinstance(obj, str):
        return _scrub_str(obj)
    if isinstance(obj, dict):
        return {k: _scrub_obj(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub_obj(v, depth + 1) for v in obj]
    return obj


def _sentry_before_send(event, _hint):
    try:
        return _scrub_obj(event)
    except Exception:
        # If scrubbing itself fails, drop the event entirely rather
        # than risk leaking the unscrubbed version. Safer default.
        return None


if _sentry_dsn:
    try:
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        _sentry_integrations = [FastApiIntegration(), StarletteIntegration()]
    except Exception:
        # Older sentry-sdk -- auto-detection still works.
        _sentry_integrations = []
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=_ENV,
        # Sample 10% of traces in prod (rest are errors-only).
        traces_sample_rate=0.1 if _ENV == "production" else 1.0,
        send_default_pii=False,
        before_send=_sentry_before_send,
        # Optional release tag wired from a git commit env var (Render
        # auto-sets RENDER_GIT_COMMIT). Errors then group by release.
        release=os.environ.get("SENTRY_RELEASE")
        or os.environ.get("RENDER_GIT_COMMIT", "")
        or None,
        integrations=_sentry_integrations,
    )
    logger.info("Sentry initialized for env=%s release=%s",
                _ENV, sentry_sdk.Hub.current.client.options.get("release") or "<none>")


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
        # Applications: one row per (request, therapist). 2026-05-18
        # audit caught a find_one->insert_one race in the apply
        # endpoint -- two rapid Apply clicks before the first finishes
        # both pass the existence check, both insert, two duplicate
        # application records land in the DB and the patient sees the
        # therapist twice in their results. Unique index is defense in
        # depth; the endpoint also catches DuplicateKeyError and falls
        # back to the existing application path. If existing DB rows
        # have duplicates the index creation will fail and _safe_idx
        # will log a warning -- run a dedupe pass before re-deploying
        # in that case.
        await _safe_idx(
            db.applications,
            [("request_id", 1), ("therapist_id", 1)],
            unique=True,
        )
        # Declines: same defense. update_one(upsert=True) is already
        # atomic for (request_id, therapist_id) collisions, but the
        # unique index guards against any future code path that does
        # an unconditional insert.
        await _safe_idx(
            db.declines,
            [("request_id", 1), ("therapist_id", 1)],
            unique=True,
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
    # One-time migration: convert legacy placehold.co license_picture
    # placeholders to the 1x1 data:image/png URL the new backfill writes.
    # Necessary because profile_completeness._has_license_document now
    # rejects https:// placeholder URLs as a real license, which means
    # every existing backfilled therapist (who has the old placehold.co
    # URL) currently fails the publishable check. The new data URL
    # passes the strict check while remaining obviously fake to admin
    # eyes. Strip-backfill still clears it as part of fields_added.
    _new_license_data_url = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg"
        "YGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg=="
    )
    _legacy_license_res = await db.therapists.update_many(
        {
            "license_picture": {"$regex": r"^https?://placehold\.co/", "$options": "i"},
            # Belt + suspenders: only touch backfilled therapists.
            "_backfill_audit": {"$exists": True},
        },
        {"$set": {"license_picture": _new_license_data_url}},
    )
    if _legacy_license_res.modified_count:
        logger.info(
            "Migrated %d backfilled therapist(s) to data: license_picture",
            _legacy_license_res.modified_count,
        )
    # ── FAQ canonical entries (idempotent, honours admin deletions) ────
    # The public /faqs endpoint reads from db.faqs; admin-edited entries
    # win over any in-code defaults. To guarantee a few canonical Q/A
    # pairs land regardless of admin state, we upsert them here on every
    # boot. If an entry exists with the same audience+question, we
    # update its answer to the canonical string; if it's missing AND
    # the admin hasn't tombstoned it, we insert at the next position.
    # Admin can still REWORD or REORDER these afterwards via the FAQ
    # admin panel -- the key is the exact question string, so any tweak
    # to the question text creates a new row instead of overwriting.
    #
    # Tombstones live in db.faqs_deleted_canonicals -- populated by the
    # admin delete endpoint in routes/faqs.py. Without that check the
    # startup migration silently re-inserted any canonical FAQ the
    # admin had just deleted (the bug Josh reported 2026-05-16).
    from datetime import datetime as _dt, timezone as _tz
    import uuid as _uuid
    _CANONICAL_FAQS = [
        # Patient FAQs
        {
            "audience": "patient",
            "question": "Is my information safe and private?",
            "answer": (
                "Yes. Encrypted in transit (TLS) and at rest in our US-hosted "
                "database. Passwords are one-way bcrypt hashed — even our team "
                "can't read them. No third-party tracking pixels, no resale of "
                "your data, and Stripe handles any payment info. See our "
                "Privacy Notice for the full list of safeguards."
            ),
        },
        {
            "audience": "patient",
            "question": "Can I download a copy of my data, or delete my account?",
            "answer": (
                "Yes to both. Email support@theravoca.com with the subject line "
                "\"Download my data\" or \"Delete my account.\" We'll send you an "
                "Excel workbook with everything we have on file (your match "
                "requests, therapist replies, feedback) within one business day, "
                "or permanently remove your account on confirmation. Account "
                "deletion is reversible within a 24-hour window after "
                "confirmation; permanent after that. We handle these by email so "
                "a real person can confirm what you're asking for and answer "
                "questions."
            ),
        },
        # Therapist FAQs
        {
            "audience": "therapist",
            "question": "Can I pause referrals when I'm full?",
            "answer": (
                "Yes — email support@theravoca.com with \"Pause referrals\" "
                "in the subject and we'll stop sending you new patient matches "
                "that same business day. Your profile stays visible, your "
                "subscription continues, and any referrals already in your inbox "
                "are unaffected (you can decline them individually). Email us "
                "again to resume."
            ),
        },
        {
            "audience": "therapist",
            "question": "Can I download a copy of my data, or delete my account?",
            "answer": (
                "Yes to both. Email support@theravoca.com with the subject line "
                "\"Download my data\" or \"Delete my account.\" We'll send you an "
                "Excel workbook with everything on file (profile, referrals you "
                "received, declines, feedback about you) within one business "
                "day, or permanently remove your account on confirmation. "
                "Account deletion also cancels your active TheraVoca "
                "subscription at end-of-period — no surprise renewals — "
                "and is reversible within a 24-hour window. We handle these by "
                "email so a real person can confirm what you're asking for and "
                "answer questions."
            ),
        },
    ]
    _faq_now = _dt.now(_tz.utc).isoformat()
    for _faq in _CANONICAL_FAQS:
        existing = await db.faqs.find_one(
            {"audience": _faq["audience"], "question": _faq["question"]},
            {"_id": 0, "id": 1, "answer": 1},
        )
        if existing:
            if existing.get("answer") != _faq["answer"]:
                await db.faqs.update_one(
                    {"id": existing["id"]},
                    {"$set": {"answer": _faq["answer"], "updated_at": _faq_now}},
                )
            continue
        # Missing -- but did the admin explicitly delete this canonical?
        tombstoned = await db.faqs_deleted_canonicals.find_one(
            {"audience": _faq["audience"], "question": _faq["question"]},
            {"_id": 0, "deleted_at": 1},
        )
        if tombstoned:
            logger.info(
                "FAQ canonical seeder: skipping re-insert of %s/%r "
                "(admin tombstoned %s)",
                _faq["audience"], _faq["question"][:60],
                tombstoned.get("deleted_at"),
            )
            continue
        last = await db.faqs.find(
            {"audience": _faq["audience"]}, {"_id": 0, "position": 1},
        ).sort("position", -1).limit(1).to_list(1)
        next_pos = (last[0]["position"] + 1) if last else 0
        await db.faqs.insert_one({
            "id": str(_uuid.uuid4()),
            "audience": _faq["audience"],
            "question": _faq["question"],
            "answer": _faq["answer"],
            "position": next_pos,
            "published": True,
            "created_at": _faq_now,
            "updated_at": _faq_now,
        })

    # Reset the availability-prompt cron to Mondays only. Josh asked
    # 2026-05-14 to drop the Friday cadence -- the code default in
    # deps.py is already Mon (0) but a DB override or Render env var
    # can still push it to Mon+Fri. Reset the DB override here so the
    # cron honours Mon-only regardless of any historical admin toggle.
    # Admins can still re-set custom days via PUT /admin/availability-prompt
    # after startup if they want to broaden the cadence again later.
    await db.app_config.update_one(
        {"key": "availability_prompt"},
        {"$set": {"key": "availability_prompt", "days": [0]}},
        upsert=True,
    )
    import deps as _deps
    _deps.AVAILABILITY_PROMPT_DAYS = (0,)
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


# ── Global request-body size cap ───────────────────────────────────
# 2026-05-18 DoS audit: FastAPI had no global request-size limit. An
# attacker could send a Content-Length: 50MB request to any endpoint,
# tying up server memory during the body read BEFORE per-endpoint
# validation runs. The license-doc upload had its own 5MB cap on
# decoded bytes (good), but other endpoints accepted arbitrarily large
# JSON bodies.
#
# Cap at 6MB to fit the legitimate biggest payload (license-doc upload
# at 5MB raw + base64 overhead ~33%). Stripe + Resend + Telnyx webhooks
# all stay well under that. Anything bigger gets a 413 before the body
# is fully buffered.
_MAX_BODY_BYTES = int(os.environ.get("MAX_REQUEST_BODY_BYTES", str(6 * 1024 * 1024)))


@app.middleware("http")
async def _enforce_max_body(request, call_next):
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > _MAX_BODY_BYTES:
                from fastapi.responses import JSONResponse as _JR
                return _JR(
                    status_code=413,
                    content={
                        "detail": (
                            f"Request body too large "
                            f"({int(cl) // 1024} KB). "
                            f"Max {_MAX_BODY_BYTES // 1024} KB."
                        ),
                    },
                )
        except (TypeError, ValueError):
            pass
    return await call_next(request)


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

