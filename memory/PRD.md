# TheraVoca — PRD

## Original Problem Statement
Build a lean MVP for **TheraVoca**, a real-time matching engine connecting patients to therapists.

- Patients submit an anonymous intake form (no login required)
- Requests are scored against a seeded therapist DB using a **100-point weighted matching engine**
- Top matches are notified via Resend emails + Twilio SMS to "apply" or "decline"
- Patients receive a results email after 24h (or via manual admin trigger)
- Admin dashboard manages requests, thresholds, email templates, manual triggers, and providers
- Therapists onboard via a **$45/mo Stripe subscription with 30-day free trial**
- Tech: FastAPI + MongoDB + React + Tailwind + Shadcn UI

## Architecture (post iter-17 refactor)

```
/app/backend/
├── server.py               (~95 lines: app + lifespan + middleware + back-compat re-exports)
├── deps.py                 (db, env constants, JWT, login lockout, auth deps)
├── models.py               (pydantic schemas)
├── helpers.py              (matching trigger, results delivery, summaries, time)
├── cron.py                 (sweep loop + daily 2am MT loop: billing/license/availability)
├── routes/
│   ├── __init__.py         (api_router aggregator with /api prefix)
│   ├── patients.py         (request CRUD, verify, public results, admin release)
│   ├── therapists.py       (signup, Stripe checkout/portal/charge, view, apply, decline)
│   ├── portal.py           (magic-link auth, /portal/me, /portal/patient, /portal/therapist)
│   ├── admin.py            (login, requests, therapists CRUD, templates, declines, stats, daily-tasks)
│   └── stripe_webhook.py   (Stripe event handler)
├── matching.py             (100-point weighted scorer + Haversine)
├── email_service.py        (Resend + dynamic DB templates)
├── email_templates.py      (template DEFAULTS + DB upsert)
├── sms_service.py          (Twilio SMS + dev-override + opt-out)
├── stripe_service.py       (Checkout, Customer Portal, charge, webhook construct)
├── geocoding.py            (Nominatim + KNOWN_CITY_GEOS cache)
├── seed_data.py            (147 Idaho seed therapists)
├── backfill.py             (idempotent profile-data backfill)
└── tests/                  (148 passing tests, 0 failures, 1 skip)
```

```
/app/frontend/src/
├── components/
│   ├── IntakeForm.jsx       (7-step patient wizard)
│   └── SiteShell.jsx        (Header + Footer + minimal nav)
├── pages/
│   ├── Landing.jsx
│   ├── IntakeStart.jsx
│   ├── PatientResults.jsx   (compact match cards; 24h hold; raw-score top-3 chips)
│   ├── TherapistSignup.jsx  (license + preview modal + Stripe handoff)
│   ├── TherapistApply.jsx
│   ├── TherapistPortal.jsx  (pending preview, availability prompt, manage subscription)
│   ├── AdminDashboard.jsx   (stats, providers, templates, declines, releases)
│   └── SignIn.jsx
└── lib/api.js               (axios + JWT session helpers)
```

## Implemented (latest first)

### iter-17 — Refactor + legacy test cleanup (Apr 27, 2026)
- Split 1761-line `server.py` → 5 route modules + `deps`/`models`/`helpers`/`cron` (server.py now 95 lines)
- Modernized v1-schema legacy tests with shared `conftest.py` payload helpers
- Removed obsolete v1-only test files (`backend_test.py`, `test_iteration4_matching.py`)
- Result: **148 tests pass, 0 failures**

### iter-17 — Patient dashboard cleanup (Apr 27, 2026)
- Removed "Therapists notified" + "Responses received" stats from `PatientResults.jsx` — patients now only see ranked therapists once 24h hold lifts

### iter-17 — Stripe Customer Portal e2e (Apr 27, 2026)
- Verified `POST /api/therapists/{id}/portal-session` returns a real `billing.stripe.com` URL with the user's real test key (HTTP 200 from Stripe)
- Fixed shadowed env var: `stripe_service._configure()` now calls `load_dotenv(override=True)` so the real key in `.env` always wins over stale `sk_test_emergent` from the supervisor environment
- Added `stripe_customer_id`, `subscription_status`, `trial_ends_at`, `current_period_end` to admin update whitelist
- 2 new pytest tests (iter-16) hitting real Stripe API

### iter-17 — Therapist hero copy refresh (Apr 27, 2026)
- Rewrote `/therapists/join` hero to match the live site (theravoca.com/for-providers/) tone
- Replaced inaccurate "Free to join during our pilot" → "$45/month · 30-day free trial · cancel anytime"
- Replaced inaccurate "Patient sees only your name, message, and rate" → "When you opt-in, the patient sees your full profile and contact info"

### iter-15 — Massive feature batch (Apr 27, 2026)
- **Daily billing cron** at 2am MT — auto-charges therapists whose period ended; handles past_due gracefully
- **License expiration alert** — 30-day warning email to therapist + admin, idempotent via `license_warn_30_sent_at`
- **Mon/Fri availability prompt** — email + SMS + portal banner with confirmation modal
- **Therapist signup expansion** — added `phone_alert` (private), `office_phone` (public), `license_state`, `license_number`, `license_expires_at`, `license_picture` upload
- **Profile preview modal** before final signup submit
- **Pending application view** in `TherapistPortal` so therapists can verify their submitted profile while pending approval
- **Admin Edit Provider** dialog gets the new license fields + credential type
- **Stripe Customer Portal** endpoint + "Manage subscription" button in portal
- **Patient match chips** — drop ≥50% threshold, always show top 3 by raw score (issues=35 outranks gender=3 on ties)

### Earlier iterations (iter-1 to iter-14)
- 100-point weighted matching engine with Haversine distance
- Stripe Checkout for $45/mo subscription with 30-day trial (real test key)
- Resend email + Twilio SMS notifications
- Magic-link auth for patient + therapist portals (JWT + 30d sessions)
- Admin dashboard: stats, requests, providers, email templates, declines, releases
- 24h results hold with manual admin override
- Modality preferences (CBT, EMDR, IFS, etc.) baked into intake + matching
- "Not interested" decline workflow with reason codes
- Profile picture upload (base64) + license image upload
- 147 seeded Idaho therapists with full v2 schema

## Backlog

### P0 (next 1–2 sessions)
- Connect a real Stripe Checkout flow with a test card → verify webhook updates `subscription_status` end-to-end
- Real-Stripe webhook signature secret in `.env` (so production webhooks work)

### P1
- Multi-state expansion (Idaho → WA, OR, MT, UT, WY, NV)
- Patient inline status timeline page ("we've notified X, hold ends in Y")
- "Try again" button if patient is unhappy with matches
- Email-domain reputation: replace Resend test mode with verified domain

### P2
- Admin: bulk approve / bulk export
- Therapist: in-portal calendar embed (Calendly integration?)
- Therapist: refer-a-colleague link with preset attribution
- Patient: text-message receipt option (Twilio)
- Analytics: weekly funnel report to admin email
- A11y polish (DialogDescription on remaining dialogs)

## Test Status
- **148 tests passing** locally (post iter-17): `pytest tests/ -p no:cacheprovider`
- 1 skip (network-dependent geocoding warm-up)
- 0 failures

## Key DB Schemas

**requests**: `{id, email, location_state, location_city, location_zip, patient_geo, client_type, age_group, payment_type, insurance_name, budget, sliding_scale_ok, presenting_issues:[…], modality_preferences:[…], availability_windows, urgency, prior_therapy, gender_preference, gender_required, style_preference, threshold, notified_therapist_ids, notified_scores, notified_breakdowns, notified_distances, results_released_at, results_sent_at, status, verified, verified_at, created_at, matched_at}`

**therapists**: `{id, name, email, phone, phone_alert, office_phone, gender, credential_type, licensed_states, license_number, license_expires_at, license_picture, license_warn_30_sent_at, primary_specialties, secondary_specialties, general_treats, modalities, modality_offering, office_locations, office_geos, insurance_accepted, cash_rate, sliding_scale, free_consult, years_experience, availability_windows, availability_prompt_pending, availability_prompt_sent_date, last_availability_update_at, urgency_capacity, style_tags, bio, profile_picture, notify_email, notify_sms, is_active, pending_approval, subscription_status, stripe_customer_id, stripe_subscription_id, stripe_payment_method_id, trial_ends_at, current_period_end, last_charged_at, created_at}`

**applications**: `{id, request_id, therapist_id, therapist_name, match_score, message, patient_rank_score, created_at}`

**declines**: `{id, request_id, therapist_id, therapist_email, match_score, reason_codes, notes, created_at}`

**email_templates**: `{key, subject, heading, intro, ...editable fields}`

**magic_codes**: `{id, email, role, code, expires_at, used, created_at}`

**cron_runs**: `{name, date, started_at, completed_at, billing, license, availability}`

## Credentials (test only)
- Admin password: `admin123!`
- Magic-link login: any seeded therapist email `therapymatch+t001..t147@gmail.com`
- Stripe test key: real `sk_test_51RWhfV...` in `/app/backend/.env`
