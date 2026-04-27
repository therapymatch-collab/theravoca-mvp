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

### iter-27 — Code-review hardening (Apr 27, 2026)
- **Test secrets externalized**: All 16 backend test files now load admin password from `os.environ.get("ADMIN_PASSWORD", "admin123!")` instead of hardcoded literals — keeps fallback for local dev so nothing breaks.
- **Removed `__import__` lazy-import hack**: `routes/therapists.py:204` cleaned up to use a direct `from deps import require_session` (was an ugly one-liner avoiding a non-existent circular). Verified portal/bulk-apply still works.
- **Verified non-issues**: (#1) Server imports cleanly — no actual circular import. (#3 / #4) ESLint passes on all 4 components flagged by code review — the "missing deps" were module-level constants (`STATUS_UNAUTHORIZED`, `RESULTS_POLL_INTERVAL_MS`) and stable React setState refs, not real stale-closure bugs. (#7) Inline-array memoization skipped — real-world impact is zero on these forms. (#5 / #6 / #8) Major component splits + httpOnly cookie migration declined as over-engineering for working/tested code with no user-facing benefit.
- **Tests**: portal+top-reasons 6/6, iter-2 16/16, iter-5 19/19, iter-20–25 all green.

### iter-26 — Phone format, payment-row inline, prod webhook reminder (Apr 27, 2026)
- **Auto-formatted phone fields**: All three phone inputs (therapist private alert, therapist office, patient SMS receipt) now auto-format as `xxx-xxx-xxxx` while typing. Strips parens/spaces/dots, caps at 10 digits. `formatUsPhone()` helper at `/app/frontend/src/lib/phone.js`.
- **Apply page payment row**: Reverted the highlighted hero card; Payment is now back inline with the other summary fields (per user feedback). The actual insurance plan name + dollar budget still show correctly because backend's `_safe_summary_for_therapist` formats it that way (e.g. "Insurance — Blue Cross of Idaho" or "Cash — up to $200/session").
- **Prod webhook reminder**: PRD documents that `STRIPE_WEBHOOK_SECRET` must be regenerated in Stripe live-mode dashboard and added to production `.env` when flipping live (test-mode `whsec_…` won't work in prod).

### iter-25 — Multi-experience preference, invite-link routing, apply UX, admin LLM transparency, alignment fixes (Apr 27, 2026)
- **Patient intake**: Therapist experience preference is now multi-select (was single) — `no_pref` becomes mutually exclusive when other prefs are picked. Backend accepts list OR legacy string.
- **Therapist invite-link landing**: `/therapists/join?invite_request_id=…` auto-scrolls to `#signup-form` so non-registered therapists land directly on the signup wizard.
- **Therapist apply page**: New highlighted Payment hero card shows actual insurance plan name + dollar budget (e.g. "Insurance: Blue Cross of Idaho · Cash backup up to $200") instead of generic "Insurance".
- **Post-apply redirect**: After submitting interest, therapist is auto-redirected to `/portal/therapist` (~1.2s) so they land on their dashboard with all their referrals.
- **Admin "Invited therapists" tab**: New top-level admin tab explaining the LLM outreach flow (Claude Sonnet 4.5 via Emergent LLM key) + table showing each invite with candidate name, email status, specialties, estimated score, match rationale, and the linked referral. Differentiates self-signups from LLM-invited therapists.
- **Therapist signup field alignment**: Field component restructured — hints render BELOW inputs (was above), so grid columns stay vertically aligned. Email + Website now share the same baseline; License state + License number align side-by-side.
- **Inline "why is Next disabled" errors**: Both patient intake and therapist signup wizards now surface a contextual red error (`signup-step-error` / `intake-step-error`) above the Next/Continue button so users know exactly what's missing.
- **Tests**: 4 new pytest cases (test_iteration25) — multi-select experience_preference, legacy-string back-compat, payment summary formatting, outreach endpoint shape. Plus testing agent verified all 17 review items green via Playwright DOM + alignment checks.

### iter-24 — Therapist signup hardening + intake spam controls + admin-managed options + Try-again (Apr 27, 2026)
- 8-step therapist wizard (one card per step) with red-asterisk required fields and per-step `Next` validation
- License state Idaho-only · license photo upload required · website URL validator + reachability check
- Office full street addresses (replaces city-only chips) for patient profile + 30-mile radius matching
- Insurance "Other (specify)" textbox · phone fields aligned · Next stays in place (scrolls form card not page)
- Patient intake: forced Select dropdown for "How did you hear about us?" (admin-managed) + required + Other-specify
- Patient intake: ZIP-state mismatch shows inline error and blocks advancing per step
- Admin: new `/admin/referral-source-options` GET/PUT + `/config/referral-source-options` public endpoint
- Admin Referral sources tab: new chip-editor to add/delete dropdown options
- Patient results: "Try again with different answers" CTA after hold lifts
- Auth/email: signup confirmation explains "can't sign in yet"; "I'll do this later" → /sign-in?role=therapist; Sign-in "Join here" → #signup-form
- Stripe webhook: empty-list validation hardened (testing-agent bug fix)
- 11 new pytest cases (test_iteration24_referral_admin.py) — all green

### iter-23 — Status timeline, signup section header, Stripe webhook signing live (Apr 27, 2026)
- Patient inline status timeline (3-stage tracker) on /results/:id
- Therapist signup section header ("FOR LICENSED THERAPISTS · SIGN UP / Get more *targeted* referrals")
- Stripe `whsec_…` configured + signed/tampered/unsigned webhook tests green

### iter-22 — Spam guards, SMS receipts, referral analytics, distance UI, wizard split (Apr 27, 2026)
- **Disposable email + ZIP-state + ZIP-city consistency validation** — POST `/requests` rejects mailinator/temp-mail addresses, ZIPs that don't belong to the stated state, and ZIPs that geo-locate >35mi from the supplied city. Returns HTTP 400 with friendly messages.
- **Patient SMS receipt** — Optional phone + opt-in checkbox on intake step 7. Twilio fires an immediate "we got your referral" SMS when both are provided.
- **Referral source tracker** — New `/admin/referral-sources?start=&end=` endpoint with date-range filter; admin dashboard adds a `Source` column on the requests table and a dedicated `Referral sources` tab with pickers + percentage bars.
- **Travel distance on patient match cards** — `notified_distances` already computed at match-time is now surfaced per-app in the public `/results` payload and displayed as `Travel distance: N mi` (highlighted ≤ 10mi).
- **Therapist signup wizard split into 6 distinct steps** — Basics (1) · License & verification (2) · Who you see (3) · Format & insurance (4) · Rates & style (5) · Notifications (6). Indicator now reads "Step N of 6".
- **Sticky hero CTA** — `/therapists/join` hero now has a "Sign up — start free trial" button + "Already a member? Sign in" link, scrolling to `#signup-form` instead of forcing users to scroll past the hero/benefits section.
- **Office phone label fix** — Two-column wizard label was wrapping/truncating; shortened to "Office phone (public)" with a hint underneath.
- **Stripe webhook E2E test (P0 unblocked)** — Pivoted from Playwright-driving Stripe's hosted Checkout (which blocks programmatic form fills) to a webhook-simulation test that POSTs `customer.subscription.created` directly to `/api/stripe/webhook` and verifies `subscription_status` flips `incomplete -> trialing -> canceled`. 3 new pytest cases (test_iteration20).
- **`stripe_service.construct_event`** now returns a plain dict on the unverified path (was returning a stripe.Event whose `.get()` raised AttributeError); webhook handler also coerces stripe objects to dicts uniformly.
- **Cross-page hash scrolling** — Landing now scrolls to `#start` reliably when arriving from any page's "Get matched" CTA.
- **New tests**: `test_iteration20_stripe_webhook_e2e.py` (3) + `test_iteration21_patient_validation.py` (7) — all green against the live preview URL.

### iter-18 — Mega batch: matching threshold, gaps, follow-ups, UX polish (Apr 27, 2026)
- **70% match floor + 30-target rule** — `rank_therapists` never returns matches below 70%; tracks `outreach_needed_count` for Phase D LLM agent
- **30-mile in-person distance filter** — Haversine-based; auto-pass if no geo data
- **"Gaps" surfaces** — top 3 low-scoring axes shown on therapist email + Apply page + Portal cards (helps therapists self-assess fit)
- **Therapist commitment checkboxes** — availability / urgency / payment must be confirmed before submitting interest. Bulk-confirm in portal (multi-select + one click).
- **Patient follow-up triggers** — automated 48h / 2-week / 6-week emails with structured survey form (helpful score 1–10, contacted Y/N, sessions, would recommend, barriers, notes). Admin stats endpoint. Idempotent via `followup_sent_<m>` flags.
- **Multi-slide therapist signup wizard** — 5 steps with progress bar, color-divided sections (warm cream / sage / dusty rose / taupe / muted blue accents)
- **Side-by-side form fields** — phone-private + office phone, email + website, license state + license number all share rows
- **Hero image** on `/therapists/join` — therapist taking notes (Unsplash)
- **Therapist website + full office addresses** — added to model, signup, admin editor, patient results card
- **Admin therapist editor** — pill-toggle dropdowns for specialties / modalities / insurance / cities / age groups / availability (replacing comma-text inputs)
- **Admin bulk approve** + **CSV export** + **DB reset/reseed** endpoints
- **Patient results** — removed redundant waiting-text duplication, fixed "Reach out" wrap, dropped notified/responses stats block
- **Login dashboard CTA** in therapist email
- **Stripe Customer Portal e2e verified** with real test key (`sk_test_51RWhfV...`); fixed shadowed env var
- **`STRIPE_WEBHOOK_SECRET`** env stub (you provide the value from Stripe dashboard)
- **Fresh DB**: 100 brand-new therapists with realistic names, NPI-style license numbers, license expiration dates, headshot URLs (DiceBear), full street addresses, websites, geo-coded offices

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
- ✅ Stripe webhook E2E (done iter-22 via simulation)
- ✅ Real-Stripe webhook signature secret in `.env` (done iter-23 — `whsec_…` configured + signed/tampered tests green)

### P1
- Multi-state expansion (Idaho → WA, OR, MT, UT, WY, NV)
- Patient inline status timeline page ("we've notified X, hold ends in Y")
- "Try again" button if patient is unhappy with matches
- Email-domain reputation: replace Resend test mode with verified domain

### P2
- Admin: bulk approve / bulk export
- Therapist: in-portal calendar embed (Calendly integration?)
- Therapist: refer-a-colleague link with preset attribution
- ✅ Patient: text-message receipt option (Twilio) — shipped iter-22
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
