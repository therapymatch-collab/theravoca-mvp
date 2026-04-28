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

### iter-28 — Header navigation polish (Apr 27, 2026)
- **Logo click → home top**: `useScrollTopNavigate("/")` forces `window.scrollTo(0,0)` whether the user is already on `/` (where React Router suppresses navigation) or coming from another route.
- **"For therapists" click → form section**: New `useNavigateToSignupForm()` lands users directly on the `#signup-form` section of `/therapists/join` so the "Get more targeted patient referrals" header + wizard are immediately visible (skips the scrolling-past-hero step). Verified scrollY=913 with signup-form bbox.top=95px — exactly where the user wanted.

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
- **152+ tests passing** locally (post iter-38): `pytest tests/ -p no:cacheprovider`
- 1 skip (network-dependent geocoding warm-up)
- 0 failures
- Iter-38 added 4 new tests for the outreach-invite → therapist conversion flow.

## Recent Changes Log
- **Iter-46 (Feb 2026) — Polish + analytics + recruit attribution batch**:
  - **Bug fix**: removed duplicate "Email matches now" / "Release results to
    patient" buttons; single **"Send matches now"** action now triggers
    matching, sends therapist invites, AND auto-releases the 24h hold.
    After click, button label flips to **"Matches sent to patient"**
    (disabled). Backend `_deliver_results` now sets both `results_sent_at`
    and `results_released_at`.
  - **Patient match cards**: `years_experience` now reads "12 years
    experience" not "12 yrs"; insurance shows actual plan names ("Aetna,
    Cigna +3 more") instead of just count; cash rate shows
    "$X / session"; sliding scale + free consult are explicit Yes/No.
  - **Admin request detail enriched**: full RequestFullBrief panel shows
    every intake field grouped (patient, location, prefs, payment, status,
    timestamps); Matched providers list now shows credential, distance,
    review badge, click-to-expand score breakdown with per-axis points.
  - **Provider editor cleaned up**: Credential type moved up next to Name
    + license; major sections now have colored headers
    (Contact / License & credentials / Practice & rates / Clinical fit /
    Insurance & sessions / Locations) with brand-aligned colors.
  - **Threshold display bug**: `7000%` → correct percent regardless of
    whether stored as 0–1 fraction or 0–100 integer.
  - **Gap-recruit attribution**: every recruit email now embeds
    `?recruit_code=XXXXXXXX` on the signup link. Therapist signup captures
    the code, links it back to the originating `recruit_drafts` row,
    flips `converted_therapist_id` for analytics. Email body has a clear
    "Reference code" footer so therapists know they're being invited.
  - **Therapist portal analytics card**: new `/portal/therapist/analytics`
    endpoint + UI section showing referrals received, applied count,
    apply rate, avg match score, top patient concerns, public review
    summary, and refer-a-colleague conversions.
  - **Admin Referrals tab**: new `/admin/referral-analytics` endpoint
    aggregating patient invites, therapist refer-a-colleague chains,
    intake "How did you hear?" breakdown, and gap-recruit conversion rate.
  - **Review research backfill**: cleared LLM-only flags and re-ran with
    Google Places. **85/122 therapists now have real Google reviews**
    auto-folded into match ranking; 36 found on Google with 0 reviews;
    1 not found.
  - Tests: `tests/test_iteration46_polish.py` (4 cases — referral
    analytics shape, request detail breakdown, drafts converted count,
    signup recruit_code persistence). All passing.
- **Iter-45 (Feb 2026) — Google Places integration + draft preview + name-match flag**:
  - **Google Places API (New) integrated** (`places_client.py`). Two-call
    workflow (Text Search → Place Details) with field-mask cost control.
    `GOOGLE_PLACES_API_KEY` set in `/app/backend/.env`.
  - **Review research now Places-first**: `review_research_for_therapist`
    queries Google Places before falling back to LLM. Real-data hits land
    `review_research_source="google_places"`, with `review_avg`, `review_count`,
    and `google_place_id` persisted on the therapist row. Smoke test:
    "Whitney Hebbert" → 5.0★ from 3 Google reviews, auto-folded into
    matching ranking.
  - **Gap recruiter Places-first**: every LLM-proposed candidate is now
    grounded against Google Places. Drafts that get a Place hit are flagged
    `google_verified=true` with the real business address (`google_place`).
  - **Fuzzy name-match flag** on every draft: if the LLM proposes someone
    whose first+last name overlaps with an existing therapist in our
    directory, the draft is flagged `name_match_directory=true`. Renders
    as a `⚠ name in directory` badge on the card.
  - **Email preview**: new endpoint `POST /admin/gap-recruit/send-preview`
    sends 1-per-gap-dimension drafts via Resend to the draft's fake
    `therapymatch+recruitNNN@gmail.com` address. The user controls
    `therapymatch@gmail.com`, so emails land in their own inbox via Gmail's
    `+alias` trick. Subject prefixed `[PREVIEW]` for filtering.
  - **Admin UI**: new "Preview 3 emails" button in the Recruit list
    section. Each draft card shows badges: `dry-run` · `✓ Google verified`
    (with hover tooltip showing real address) · `⚠ name in directory` ·
    `preview sent`.
  - End-to-end: 10 fresh drafts generated, **all 10 Google-verified** with
    real Idaho practice addresses; 3 preview emails delivered to user's
    inbox.
  - Tests: `tests/test_iteration45_places_integration.py` (5 cases — config
    check, real-business search, graceful no-match, preview endpoint
    structure, drafts schema migration).
- **Iter-44 (Feb 2026) — Pre-launch gap recruiter + admin search + UX fixes**:
  - **Pre-launch gap recruiter** (`gap_recruiter.py`): every day at 2am MT
    (and on-demand via "Generate more drafts" button), Claude finds real
    Idaho therapists matching each coverage gap (specialty / age group /
    city / etc.). Drafts land in `recruit_drafts` collection with safe
    `therapymatch+recruitNNN@gmail.com` placeholder emails — **never sends
    real outreach pre-launch**.
  - New endpoints:
    - `POST /admin/gap-recruit/run` — manually trigger (idempotent)
    - `GET /admin/gap-recruit/drafts` — list with sent/pending/dry-run counts
    - `DELETE /admin/gap-recruit/drafts/{id}` — remove a draft
    - `POST /admin/gap-recruit/send-all` — fire pending non-dry-run drafts
      via Resend (post-launch only; pre-launch returns 0 since all are dry).
  - **Coverage Gap analysis extended**:
    - Per-Idaho-city in-person targets (Meridian, Nampa, Idaho Falls,
      Pocatello, Coeur d'Alene, Twin Falls — 3 in-person each).
    - Bumped age targets: child/teen now target 8 (was 5) — historically
      thinnest, most patient demand.
    - Case-insensitive city matching so capitalization variants merge.
    - Helper `_compute_coverage_gap_analysis()` extracted so the cron can
      reuse it without going through the auth dependency.
  - **Admin Coverage Gaps tab** now embeds a "Recruit list" section that
    auto-loads draft candidates grouped by gap target, with Copy email
    (clipboard-ready outreach text) and Delete actions.
  - **Admin search bar** added to every tab (Patient requests, Therapist
    signups, All providers, Invited therapists, Coverage gaps + drafts).
    Filter clears on tab switch.
  - **Bug fix**: removed duplicate "Credential type" field from the admin
    therapist edit modal (was showing once in Contact section, again in
    License section — only the License-section instance is kept).
  - Daily cron at 2am MT now also runs `_run_gap_recruitment` in dry-run
    mode (max 10 drafts/day) so the recruit list stays fresh.
  - Tests: `tests/test_iteration44_gap_recruit.py` (6 cases — endpoint
    shape, helper callability, drafts listing, fake-email indexing,
    send-all dry-run invariant, 404 on unknown id).
- **Iter-43 (Feb 2026) — Coverage gap analysis + review research run**:
  - **New endpoint**: `GET /api/admin/coverage-gap-analysis` — returns counts
    per dimension (specialty, modality, age group, client type, insurance,
    language, urgency, fee tier, geography) and a prioritized recommendations
    list. Targets are calibrated to the matching algorithm weights:
    very_high-demand specialties target 12 therapists, high target 8, etc.
  - **New admin tab "Coverage gaps"** in `AdminDashboard.jsx`. Surfaces
    critical/warning gap counts in the tab badge, shows recommendation cards
    grouped by dimension, plus distribution charts for every axis.
  - **Review research** ran across 78/122 imported therapists (background
    task, conservatively halted by main agent). Outcome: 0 with verifiable
    public-review data — Claude correctly refuses to invent review counts
    for individual private-practice therapists. Guardrail works as intended.
  - **Server lifespan hardened**: only auto-seed if directory is empty
    (was: re-seeded any time `seed_v2` was missing — caused 100 placeholder
    rows to leak in alongside the imported directory).
  - Initial gap analysis on imported directory: **only 2 gaps** flagged
    (school_academic_stress 0/3 critical · eating_concerns 3/5 warning) —
    excellent pre-launch coverage on a 122-therapist Idaho directory.
- **Iter-42 (Feb 2026) — Real-therapist directory import**:
  - Imported **122 real Idaho therapists** from user's Excel
    (`/app/backend/scripts/import_therapists_xlsx.py`).
  - DB wiped + re-seeded: emails faked as
    `therapymatch+t101@gmail.com`...`+t222@gmail.com`; real emails kept in
    `real_email` for reference. All `is_active=True, pending_approval=False,
    subscription_status="trialing", trial_ends_at=null, current_period_end=null`
    (indefinite trial — billing cron skips them since `stripe_customer_id=null`).
  - Distribution: LPC×58, LCSW×31, LMFT×22, PsyD×6, Other×5; top specialties
    anxiety×98, relationship_issues×80, life_transitions×77, depression×77,
    trauma_ptsd×75. 30 with Idaho offices (geocoded), 92 telehealth-only.
  - **New `languages_spoken` field** on therapists, populated from the Excel
    col21 + surfaced on patient match cards.
  - **LLM outreach prompt tightened** (Item D, Option 2): Claude now told
    "ONLY return therapists you have HIGH CONFIDENCE actually exist; if
    unsure, return fewer." Reduces hallucination risk.
  - End-to-end smoke test: a patient request for `anxiety + trauma_ptsd +
    EMDR + Boise + cash $200` matched 30/30 therapists with scores 80–87%,
    notifications sent via Resend + Twilio.
- **Iter-41 (Feb 2026)**:
  - **LLM review-research agent** (`review_research_agent.py`) — Claude
    Sonnet 4.5 is asked to recall *high-confidence* public review data for a
    therapist across Psychology Today / Google / Yelp / Healthgrades. We
    sanitize aggressively: drop sources with `count < 10`, weight-average
    rating by count, persist `review_avg`, `review_count`, `review_sources`,
    `review_research_source: "llm_estimate"`. The matching engine's existing
    `reviews` axis (+5 max) automatically picks them up — top-rated
    therapists get a small ranking boost.
  - Admin endpoints: `POST /admin/therapists/{id}/research-reviews` (single)
    and `POST /admin/therapists/research-reviews-all` (cron-friendly bulk).
  - Admin "Research reviews" toolbar button wired to bulk run.
  - Patient match cards now show a small `4.7★ · 80 reviews` badge under the
    therapist name when `review_count >= 10` and `review_avg >= 4.0`.
  - Tests: `tests/test_iteration41_review_research.py` (5 cases — weight
    averaging, low-volume drop, empty input, invalid rating, matching axis
    integration).
- **Iter-40 (Feb 2026)**:
  - **Patient refer-a-friend** attribution: every new request gets a unique
    8-char `patient_referral_code` issued on creation. The `?ref=` query param
    on the landing page is captured by `IntakeForm.jsx` and posted as
    `referred_by_patient_code`. PatientResults shows a "Copy invite link"
    tile (`data-testid="refer-friend-tile"`). Plain attribution — no
    incentives wired (per user direction).
  - Therapist refer-a-colleague tile already shipped earlier (TherapistPortal).
  - Tests: `tests/test_iteration40_patient_referral.py` (4 cases — code
    issuance, uniqueness, persistence on referred patients, results-endpoint
    exposure).
- **Iter-39 (Feb 2026)**:
  - Outreach agent now **dedupes LLM candidates** against (a) existing
    `therapists.email` and (b) all prior `outreach_invites.candidate.email`.
    Email match is case-insensitive. Over-fetches 2× from the LLM (cap 60) so
    dedupe doesn't shrink the final invite count below the requested target.
  - `run_outreach_for_request` response now includes
    `skipped_existing_therapist`, `skipped_prior_invite`, `candidates_raw` for
    visibility/audit.
  - Tests: `tests/test_iteration39_outreach_dedupe.py` (3 cases — therapist
    dedupe, prior-invite dedupe, empty/missing email handling).
- **Iter-38 (Feb 2026)**:
  - Added clickable Google Maps link on patient results for therapists with full
    `office_addresses` (`PatientResults.jsx` → `data-testid="therapist-office-map-{i}"`).
  - New endpoint `POST /api/admin/outreach/{invite_id}/convert` migrates an
    `outreach_invites` row into a draft `therapists` doc with
    `source="invited"`, `signup_status="invited"`, `pending_approval=True`,
    `is_active=False`. Original invite gets `status="converted"` +
    `converted_therapist_id` for audit.
  - Admin Invited Therapists tab gets a new "Action" column with
    "Convert to signup" button (shows "Converted" badge after success).
  - Tests: `tests/test_iteration38_outreach_convert.py` covers happy path,
    duplicate convert (409), pre-existing therapist email (409), unknown id (404).

### Iteration 47 (2026-04-27) — Outreach GC fix verified + invited therapists in detail view + dropdown reorder
- **Background-task GC fix verified**: `helpers._spawn_bg()` strong-reference
  helper, `_sweep_pending_outreach()` cron, and admin "Run LLM outreach now"
  button at `POST /api/admin/requests/{id}/run-outreach` are live and tested
  (22 backend tests pass, screenshot confirms admin UI button renders).
- **Invited therapists in request detail panel** (`GET /api/admin/requests/{id}`
  now returns `invited` array). New section "LLM-invited therapists (N)" at the
  bottom of the admin request detail dialog shows each candidate's name,
  license, email, location, estimated match score, specialties, match
  rationale, and email-delivery status. Lets admins see directory matches +
  applications + LLM invites in a single screen.
- **Referral source dropdown order**: backend now always pushes "Other" and
  "Prefer not to say" to the end of the options list (in that order) on both
  the public `/config/referral-source-options` and admin endpoints, plus the
  admin save endpoint. IntakeForm also reorders client-side as defense in
  depth. Custom admin orderings of other items are preserved.

### Iteration 48 (2026-04-27) — Live PT scraping + invited column + convert-from-detail + AI assistant option + payment-label hardening
- **Live Psychology Today scraper** (`pt_scraper.py`): real-time directory
  scrape via JSON-LD parsing of PT search-result pages — no JS rendering
  required. Returns name, profile URL, phone, full address, lat/lng, license
  types (extracted from profile body), specialties, and best-guess email
  (info@<published-website>). Rate-limited (1 req/sec, max 60 req/run).
  `outreach_agent._find_candidates()` now tries PT first and tops up with
  LLM-generated candidates only if scraping yields <30 results. Toggleable
  via `PT_SCRAPING_ENABLED=false`.
- **SMS fallback for PT candidates without published email**: when PT
  doesn't expose a website domain to guess an email from, the outreach
  agent sends a Twilio SMS using the listed phone (with STOP-to-opt-out
  copy). Tracking now records `channel` ("email"/"sms"), `sms_sent`,
  `send_error`, and `source` ("psychology_today"/"llm") on every
  `outreach_invites` row.
- **Dedupe by phone too**: `_filter_existing_contacts()` (renamed from
  `_filter_existing_emails`, alias kept for back-compat) now skips PT
  candidates whose phone already lives in `therapists.phone`/`phone_alert`
  or in any prior `outreach_invites.candidate.phone` (E.164 normalized).
- **"Invited" column in admin requests table**: `GET /api/admin/requests`
  rows now include `invited_count` from `outreach_invites`. New orange
  column appears between "Apps" and "Threshold" in the admin UI so admins
  can see notified / apps / invited at a single glance.
- **"Convert" button on each invited card in detail panel**: mirrors the
  Invited Therapists tab action so admins can promote a hot LLM lead to a
  draft therapist profile without leaving the request view. Auto-refreshes
  the open dialog so the card flips to "Converted" inline.
- **"ChatGPT / AI assistant" referral source**: added to defaults; the
  read-side normalizer auto-injects it into well-known referral lists that
  miss it (without touching arbitrary admin custom lists or test fixtures).
- **Payment label hardening** in `_safe_summary_for_therapist()`: every
  therapist referral & invitation email now shows the actual amount or
  carrier (e.g., "Cash — up to $200/session", "Insurance — Aetna",
  "Either — Insurance: BlueCross · Cash up to $175/session"). Explicit
  fallback strings ("amount not specified" / "carrier not specified") for
  legacy records missing required fields, so generic "Cash"/"Insurance"
  labels never appear in outbound emails again.
- Tests: `tests/test_iteration47_pt_scraper.py` covers JSON-LD parsing,
  license/specialty extraction, website filtering, email guessing, scoring,
  payment-label fallbacks, admin list `invited_count`, detail `invited`,
  and AI-assistant injection. 43/43 tests pass.

### Iteration 48b (2026-04-28) — One-click opt-out for recruitment outreach
- **New collection `outreach_opt_outs`** keyed by normalized email +
  E.164 phone. Every recruitment email + SMS includes a one-click opt-out
  URL (`GET /api/outreach/opt-out/{invite_id}`). Backend-rendered branded
  HTML confirmation page. Dedupe now also filters opted-out candidates
  (`skipped_opted_out` stat). Invite rows pre-created before send so the
  opt-out token exists at send time. Admin endpoint
  `GET /api/admin/outreach/opt-outs`. Tests pass.

### Iteration 49 (2026-04-28) — Therapist self-edit + admin opt-outs tab + license badge + patient email redesign + CTA & wrapping fixes
- Therapist self-edit portal page (`/portal/therapist/edit`), admin
  Opt-outs tab, License verification badge + DOPL deep-link, patient
  matches email redesign (contact removed, bio/fees/reviews added, CTA
  click-through), mailto `+` bug fix, 60% → 70% copy fix.

### Iteration 50 (2026-04-28) — Phases 1–3 bundle: admin re-review UI, age-cap, rich signup review, approval/rejection emails, returning-patient prefill, feedback widget + follow-ups, stale-profile nag, DOPL live-API stub

**Phase 1 (admin triage + lifecycle emails)**
- **"Needs re-review" filter + badge** on All providers: orange pill on each
  row with `pending_reapproval=true`, plus a top-of-table filter button to
  show only those rows. Reviewer flow: see the flag → click Edit → approve
  the changes (new endpoint `POST /api/admin/therapists/{id}/clear-reapproval`
  unsets the flag and stamps `reapproved_at`).
- **Richer therapist signup review** — `PendingSignupRow` component now
  shows: inline license-picture thumbnail (click to open full-size), name +
  credential pill, years-exp / license # / expiry / rate / format / gender
  one-liner, bio preview, collapsed specialties/modalities/insurance/ages
  summary, and an expandable "Show all signup answers" side panel that
  exposes 18 fields (primary/secondary specialties, weighted specialties,
  general treats, modalities, age groups, client types, availability
  windows, urgency capacity, insurance, languages, office addresses, office
  phone, website, licensed states, style tags, submission time). Approve /
  Edit fields / Reject action stack.
- **Approval email** upgraded — next-steps card, "Sign in to your portal"
  and "Complete your profile" CTAs, magic-code reminder.
- **Rejection email** (new template `therapist_rejected`) — warm copy,
  door-open-for-future-apply messaging, never blames the applicant.
- **Age groups cap at 3** enforced at three layers:
  (a) Pydantic `TherapistSignup.age_groups: max_length=3` for new signups;
  (b) Admin `PUT /admin/therapists/{id}` clamps to 3 on save;
  (c) Portal `PUT /portal/therapist/profile` clamps to 3 on self-edit.
  Signup UI + portal edit UI show "pick up to 3" label and reject the 4th
  chip with a toast.
- **Returning-patient prefill** — `GET /api/requests/prefill?email=…`
  returns the stable fields from the most recent prior request
  (referral_source, zip, preferred_language, age_group, gender_preference)
  so returning patients don't re-answer. IntakeForm pre-fills on email blur
  and toasts "Welcome back — we've pre-filled a few fields…"

**Phase 2 (feedback capture + follow-up cycle)**
- **Floating `FeedbackWidget`** mounted globally — corner button opens a
  modal with Name (optional) / Email (optional) / Message (5–2000 chars).
  POSTs `/api/feedback/widget` which persists to `feedback` collection and
  relays to `theravoca@gmail.com` (configurable via
  `FEEDBACK_INBOX_EMAIL` env).
- **Structured follow-up forms** at `/feedback/patient/{id}` and
  `/feedback/therapist/{id}` — 3 questions each (rating + action-taken +
  free-form notes), context-aware copy for 48h vs 2w milestones.
- **Email templates** added: `patient_followup_48h`, `patient_followup_2w`,
  `therapist_followup_2w` — each links to the structured form above.
- **Daily cron** (`_run_patient_structured_followups`,
  `_run_therapist_2w_followups`) — idempotent via
  `structured_followup_48h_sent_at`, `structured_followup_2w_sent_at`,
  `therapist_2w_followup_sent_at` flags. Triggered from
  `_daily_loop`.
- **Admin "Feedback" tab** — unified view of all feedback sources with
  kind tag, star rating (when present), structured-question summary, free-
  form notes, contact info, and submission timestamp. Counts per kind.

**Phase 3 (directory hygiene + future-proofing)**
- **90-day stale-profile nag** (`_run_stale_profile_nag` cron + email
  template `therapist_stale_profile_nag`) — idempotent via
  `stale_profile_nag_sent_at`, which is **unset** whenever a therapist
  touches the profile (so they don't get the nag again on normal updates).
  Config: `PROFILE_STALE_DAYS` env (default 90).
- **DOPL live-API stub** (`license_verify.check_dopl_status`) — returns
  `None` today (signal "not available"), ready to swap in the real live
  endpoint when Idaho DOPL publishes it. Documented TODO notes the
  expected return shape + recommended 24h cache.
- **Tests**: `tests/test_iteration50_feedback_and_lifecycle.py` —
  feedback widget persist/validate/admin-list, patient feedback
  submission + 404, age-groups Pydantic cap + admin PUT clamp,
  approve/reject lifecycle + rejected_at stamp, clear-reapproval
  endpoint. **69/69 backend tests pass across all iterations.**
- **Therapist self-edit portal page** (`/portal/therapist/edit`): 5-section
  form (About, Fees, Format/Offices, Modalities, Availability/Alerts) with
  field allowlist, auto-derives `modality_offering`, and flips a
  `pending_reapproval` flag on sensitive changes (specialties, license,
  credential, name). Admin sees the flag in the pending queue. Route:
  `PUT /api/portal/therapist/profile` with strict allowlist.
- **Admin UI tab — "Opt-outs"**: new tab card showing full opt-out roster
  with Email / Phone / Source / Timestamp / Reason / linked invite-id.
  Search filters across all three text columns. Powered by the existing
  `GET /api/admin/outreach/opt-outs` endpoint.
- **License verification badge** on every All-providers row: computed
  status (active / expiring_soon / expired / no_expiry / no_license) with
  severity-color badge + license number + one-click "Verify on DOPL ↗"
  deep-link. Idaho DOPL doesn't publish a JSON API (confirmed via
  research), so we compute from `license_expires_at` + link to their
  public search. Helper: `license_verify.py`. Hook: admin list now
  attaches `license_status` + `license_verify_url` to each therapist.
- **Patient "Your matches are here" email** redesigned
  (`email_service.send_patient_results`): drops Email and Phone rows,
  adds Fee line (cash + sliding + free-consult), Format (in-person /
  telehealth combo), Offices, Approaches (modalities), Insurance,
  Reviews (★ avg + count), and a 240-char bio excerpt. Each card ends
  with a "View full profile & contact" CTA button that deep-links
  `#therapist-<id>` on the results page — patients must click through
  to see contact info, reducing spam risk and driving engagement.
- **"Book free consult" mailto fix**: `URLSearchParams` encoded spaces
  as `+` (form-urlencoded), which iOS/Android Mail render literally.
  Swapped to `encodeURIComponent` so subject/body use %20.
- **Patient-results intro paragraph** now uses `text-pretty` + `max-w-2xl`
  for balanced line-breaks ("These therapists read your anonymous
  referral and submitted interest…").
- **Therapist portal copy**: "matches your profile (60%+)" →
  "matches your profile (70%+)" to match the real match threshold.
- Tests: `tests/test_iteration49_self_edit.py` covers license status
  (all 5 severity states), DOPL URL formatting, admin list license
  metadata, portal GET/PUT profile, re-approval flag behavior, cash_rate
  clamping, unknown-field allowlist enforcement, and unauthenticated
  rejection. 57/57 tests pass.
- **New collection `outreach_opt_outs`** keyed by normalized email +
  E.164 phone. Captures `last_source` ("outreach_email_link"),
  `last_reason`, `last_invite_id`, `last_request_id`, `created_at`,
  `last_opted_out_at`. Idempotent upsert so repeat clicks don't dupe.
- **Every recruitment email + SMS now includes a one-click opt-out URL**
  at `GET /api/outreach/opt-out/{invite_id}` (public, no auth — the
  UUID invite_id is the unguessable token). Email puts it in a clean
  footer ("Not interested in future referrals? Unsubscribe with one
  click"); SMS appends it alongside the standard STOP keyword.
- **Backend-rendered confirmation page**: branded HTML, no React
  dependency — so the link stays fast + robust for the therapists who
  aren't users yet. Shows the email/phone we removed and a friendly
  "already opted out" note on re-click.
- **Dedupe now filters opt-outs**: `_filter_existing_contacts()` bulk-
  fetches all opted-out emails + phones for the candidate batch in a
  single mongo round-trip and drops matches. Stats include a new
  `skipped_opted_out` counter surfaced on the `/run-outreach` response.
- **Invite row pre-creation**: `run_outreach_for_request` now inserts
  the `outreach_invites` row BEFORE sending the email/SMS so the
  opt-out token exists in the DB at send time, then updates the row
  with the send result.
- **Admin endpoint** `GET /api/admin/outreach/opt-outs` lists the full
  opt-out roster for audit.
- Tests: `tests/test_iteration48_opt_out.py` covers unit (record,
  is_opted_out, idempotent), HTTP (200 for valid token, 404 for
  invalid, unsubscribe-text in body, admin list), and dedupe
  integration (opted-out candidate skipped on re-run). 41/41 pass.

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

## Iteration 51 — Patient timeline polish & Therapist red-flag callouts (Apr 28, 2026)

- **PatientPortal.jsx**: Replaced flat status badge with a 5-step visual
  timeline (Submitted → Email verified → Matched → Responses → Results
  ready). Each step shows real metadata (notified count, application
  count, dates) and lights up green when complete or amber while
  active. `data-testid="status-timeline"` and per-step state testids.
- **TherapistPortal.jsx**: New `<ProfileHealthCallouts>` panel
  consolidates 5 actionable warnings and renders nothing when the
  profile is healthy:
    - **License expired** (critical, red, blocks referrals)
    - **License expiring ≤30 days** (warning)
    - **Pending re-approval** after a self-edit (info, lists changed
      fields)
    - **Stale profile** (≥90 days since `updated_at`)
    - **Missing bio** (or <40 chars) and **Missing profile photo**
    Each flag has a one-click CTA pointing at `/portal/therapist/edit`.
    Header colour band auto-escalates: critical (red) → warning
    (amber) → info (green) so therapists see severity at a glance.
- **portal.py**: `GET /api/portal/therapist/referrals` now exposes
  `pending_reapproval`, `pending_reapproval_fields`, and `updated_at`
  on the therapist payload so the new UI panel can compute flags
  client-side without an extra round-trip.


## Iteration 52 — Step-3 crash fix, mobile burger, password auth, repeat-submitter prompt, admin patients tab (Apr 28, 2026)

- **Bug fix — TherapistSignup step 4 crash**: `data.office_addresses` was missing from initial state, so `<Tags>` crashed with `Cannot read properties of undefined (reading 'length')` the moment the user reached step 5 (Modalities & Format). Initialised the field to `[]` and made `<Tags>` defensive.
- **Mobile burger menu**: `SiteShell.Header` now ships a hamburger trigger below `md`, sliding a drawer with all nav links + Sign-in options + Get-matched CTA. Drawer auto-closes on route change and locks body scroll while open.
- **Sign-in page keeps full main nav**: removed `Header minimal` so visitors don't lose their bearings during sign-in.
- **Emergent badge hidden**: `index.html` `#emergent-badge` is now `display:none` so the floating Feedback button isn't covered.
- **Password auth (optional, alongside magic-code)**:
   - `POST /api/auth/login-password` — bcrypt verify + brute-force lockout in `password_login_attempts` (15 min after 5 failures, keyed by `{ip}:{role}:{email}`).
   - `POST /api/auth/set-password` — requires a magic-link session, persists hash on the existing `therapists` row or creates a `patient_accounts` row lazily for patients.
   - `GET /api/auth/password-status?email=...&role=...` — public, lets the SignIn page swap between password input and magic-code based on whether a password is already set.
   - Forgot-password recovery: existing magic-code flow.
- **SignIn page (frontend)**: three-step UX — email → password (if account exists) OR magic-code (fallback) → optional `setup-password` step triggered by `?setup=1` for first-time account creation.
- **Repeat-submitter account prompt**: `VerifyEmail` success state now surfaces a "You've matched with us before — want one place to track everything?" card when `prior_request_count >= 2 && !has_password_account`. Links to `/sign-in?role=patient&setup=1`.
- **In-portal "Set a password" prompt**: shared `<SetPasswordPrompt>` component shown in PatientPortal & TherapistPortal when the user has no password set.
- **Admin: Patients (by email) tab**: new `/api/admin/patients` aggregates `requests` by lowercased email; new `<PatientsByEmailPanel>` shows total emails / repeat / accounts stats + searchable table.

### Tests
- `tests/test_iteration51_password_auth.py` — 9 new tests covering password-status, set-password, login-password, patient_accounts lazy create, admin patients endpoint contract, verify-endpoint email echo, prefill has_password_account flag.
- `tests/test_iteration5_auth.py` — updated for the new dict-shaped `/portal/patient/requests` response.

## Iteration 53 — 9-feature batch (Apr 28, 2026)
1. **Admin Team management**: `admin_users` collection + `POST /api/admin/team` (invite with email/name/initial password), `GET /api/admin/team`, `DELETE /api/admin/team/{id}` (soft deactivate), `POST /api/admin/team/{id}/reset-password`, `POST /api/admin/login-with-email`. `require_admin` now accepts EITHER `X-Admin-Password` header OR Bearer admin JWT. New "Team" admin tab with invite form + member roster.
2. **Patient portal timeline**: removed "Matched" and "Responses" labels — now just "Submitted → Email verified → Matches → Results ready" (4 steps, no notify/application counts exposed). Added persistent "+ Submit another request" CTA at bottom.
3. **Intake review modal**: clicking the final-step submit button now opens a `ReviewPreviewModal` showing every answer the patient gave with "Edit answers" / "Confirm & find my matches" buttons.
4. **Patient results: "Your referral" panel** at top of /results/{id} — collapsible card listing age, state, ZIP, format, insurance, budget, urgency, gender pref, language, concerns, modalities, notes. Patients can compare what they asked for vs. what each match offers.
5. **Match gaps display**: per-therapist `<gaps-{i}>` callout showing "Where you may not align ({100-score}% gap)" — listing missing specialties, schedule mismatch, unsupported modality, cash above budget, insurance not accepted, etc. Computed client-side from `match_breakdown` + request fields.
6. **Therapist preview button**: `Eye` button on /portal/therapist/edit opens `ProfilePreviewModal` showing the therapist exactly how patients see them on the results page (avatar, bio, fees, format, insurance, languages).
7. **Therapist data migration recommendation** (analysis result, not code): seeded directory has 100% missing profile_picture/license_picture/general_treats/style_tags, 89% missing languages_spoken, 78% missing office_addresses, 57% missing sliding_scale, 55% missing insurance_accepted. Recommended self-edit (NOT re-signup) — see finish summary.
8. **Provider table column editor**: All-Providers table refactored around a `PROVIDER_COLUMNS` registry (14 columns). Columns dropdown lets admin toggle each column on/off; "Save as default" persists their preferred set in `localStorage` under `tv_admin_provider_default_cols`; "Reset to default" restores. Table now wraps in `overflow-x-auto` so horizontal scrolling kicks in when needed (per user spec).
9. **Patient results header wrapping** fixed by widening `max-w-2xl` → `max-w-3xl` and removing `text-pretty` so "Reach out to whoever feels right — many offer a free consult." flows on a wider line.

### Tests
- `tests/test_iteration53_admin_team.py` — 13 tests covering invite/list/login-with-email/JWT-grants-admin/wrong-password-401/reset/deactivate/master-password-still-works/no-creds-401/invalid-bearer-401.
- All 47 prior tests still passing (12 + 22 + 13).

## Iteration 54 — Go-live cutover toolkit (Apr 28, 2026)

User asked for the "Claim & complete your profile" outreach campaign to be ready when they wipe the DB and put real therapist emails in.

### Backend
- New `/app/backend/profile_completeness.py` — single source of truth for completeness scoring. **REQUIRED** fields (13): name, email, phone, license_number, license_expires_at, bio≥40 chars, profile_picture, primary_specialties, age_groups, client_types, modality_offering, cash_rate, office_or_telehealth. **ENHANCING** fields (9): years_experience, secondary_specialties, modalities, insurance_accepted, languages_spoken, license_picture, free_consult, sliding_scale, website. Score = 70% weight on REQUIRED + 30% on ENHANCING. `publishable=True` only when ALL REQUIRED pass.
- `email_service.send_claim_profile_email(to, name, score, missing_fields)` — branded email with score, progress bar, missing-fields checklist, and CTA to /portal/therapist/edit.
- New endpoints (admin auth):
   - `GET /api/admin/profile-completeness` → `{therapists:[{id,name,email,score,publishable,required_done,required_total,required_missing,enhancing_missing,claim_email_sent_at}], total, publishable, incomplete, average_score}`. Sorted ascending by score.
   - `POST /api/admin/profile-completeness/send-claim` body: `{mode: "all_incomplete"|"selected", therapist_ids?, dry_run?, resend?}` — defaults skip already-emailed therapists; `dry_run=True` returns recipients without sending.
- `GET /api/portal/therapist/referrals` therapist payload now includes `completeness: {score, publishable, required_missing, enhancing_missing, ...}`.

### Frontend
- New `/app/frontend/src/components/ProfileCompletionMeter.jsx` — top-of-portal banner showing score + progress bar + Action-needed/Publishable chip. Expandable checklist of REQUIRED missing (red) and RECOMMENDED missing (grey) fields. Auto-hides at 100% complete.
- TherapistPortal renders `<ProfileCompletionMeter />` for approved therapists.
- New `/app/frontend/src/pages/AdminDashboard.jsx#ProfileCompletionPanel` — Admin "Profile completion" tab with: 3-stat header (Total/Publishable/Incomplete), Dry-run + Send-claim-emails buttons + Resend toggle, campaign-result toast, full roster table sorted by score with per-row "Send claim email" action.

### Go-live cutover playbook
1. Wipe DB → seed real therapist emails (with whatever fields are available).
2. Admin opens "Profile completion" tab → confirms total / incomplete count.
3. Click "Dry run" → preview recipients, confirm everyone's there.
4. Click "Send claim emails" → therapists receive personalised "Welcome to TheraVoca, here's what's missing" emails.
5. Therapist signs in via magic code → portal prominently shows their score + checklist → 5-minute fix.
6. Admin watches the "Publishable" stat tick up. Stragglers can be re-emailed via the per-row "Send claim email" action.

### Tests
- `tests/test_iteration54_completeness.py` — 11 tests: unit (empty/all-required/telehealth/short-bio/100%) + admin endpoint contract + dry-run + selected-mode + claim_email_sent_at stamping + portal payload includes completeness.

## Iteration 55 — Admin tabs refactor, Master Query UI, Blog Admin UI, mobile intake smooth-scroll (Apr 28, 2026)

User wanted to (a) tame the horizontally-scrolling admin tab bar, (b) get the
Master Query AI panel wired up, (c) get a Blog admin UI wired to the
existing `/api/admin/blog` backend, and (d) stop the abrupt scroll on
mobile when stepping through the intake form.

### AdminTabsBar (`AdminDashboard.jsx`)
- New `AdminTabsBar` component renders **PRIMARY** tabs inline:
  Requests · Pending therapists · All providers · Patients (by email) ·
  Profile completion · Master Query.
- All other tabs (Invited therapists, Coverage gaps, Opt-outs, Feedback,
  Referral analytics, Referral sources, Team, **Blog**, Email templates)
  live under a single "More" dropdown — `tab-more-btn` opens
  `tab-more-menu`. The currently-active secondary tab is also pinned
  inline next to the primary tabs so admins always see where they are.

### Master Query panel (`MasterQueryPanel`)
- Loads `GET /api/admin/master-query/snapshot` on mount, surfaces a 5
  suggestion-chip list, accepts free-form questions (max 600 chars),
  fires `POST /api/admin/master-query` and renders the LLM answer +
  question history. Includes a "Show the raw snapshot" toggle that
  reveals the snapshot JSON pre-formatted so admins can verify Claude is
  reasoning over real data.

### Blog admin panel (`BlogAdminPanel`)
- Full CRUD UI for `/api/admin/blog`:
  - Posts list (title / slug / status / updated / actions).
  - "+ New post" form (title, optional slug, summary, hero image URL,
    Markdown body, published checkbox).
  - Edit / Toggle publish / Delete actions per row.
  - Native `window.confirm()` guards delete.

### IntakeForm mobile smooth-scroll
- Added a `cardRef` + `useEffect` that — on every `step` change after
  the initial mount — smooth-scrolls the form card top to ~80px below
  the viewport top so users always see the new step's heading + first
  input without an abrupt jump. `isFirstRender` ref guards the initial
  mount so the page doesn't auto-scroll on landing.

### Tests / Verification
- Frontend testing agent (iteration_17.json) verified **100%** of the
  refactor: admin tab bar testids all present, "More" dropdown opens,
  Master Query end-to-end Q&A returns an LLM answer, Blog CRUD all work
  (create + toggle publish + edit + delete with confirm), public
  `/api/blog` only returns published posts, and the intake mobile
  smooth-scroll animates between 3 intermediate scrollY samples
  (confirming `behavior:'smooth'` firing) with the card top settling at
  79.9px from viewport top after a `next-btn` click on a 390×844
  viewport.

## Backlog (post iter-57)
### P1
- Replace Resend test mode with verified domain (BLOCKED on user verifying domain on Resend dashboard).
- Multi-state rollout (Idaho → WA, OR, MT, UT, WY, NV).
### P2
- Live DOPL JSON API integration (when Idaho DOPL publishes).
- Continue admin panel refactor: extract `PendingSignupRow` + `MatchGapPanel` + `RequestFullBrief` + `MatchedProviderCard` from AdminDashboard.jsx (still 4425 lines).

## Iteration 57 — 8-task batch (Apr 28, 2026)

User asked for 8 changes; all shipped + verified green by testing agent.

### Refactor (Task 1)
- Extracted Requests / Pending therapists / All providers tabs into
  `RequestsPanel.jsx`, `PendingTherapistsPanel.jsx`,
  `AllProvidersPanel.jsx` under `src/pages/admin/panels/`.
  AdminDashboard.jsx now 4425 lines (started at 5555 pre-iter-56).

### 429 → portal CTA (Task 2)
- `IntakeForm.submit()` now detects HTTP 429 and surfaces the rate-limit
  toast with an action button **"View my referral"** that navigates to
  `/portal/patient` so frustrated users land on a useful page rather
  than a dead-end error.

### Match-gap panel (Task 3)
- `GET /api/admin/requests/{id}` now returns a `match_gap` object when
  `notified < 30`. Shape: `{notified, target, active_directory,
  axes:[{label, count, target, severity}], summary}`. Severity is
  `critical` (count==0), `warning` (count<target), or `ok`.
- Admin Request-detail dialog renders a **"Why we couldn't fill 30
  matches"** card with one chip per axis (state, format, age group, top
  3 issues, top 2 modality prefs, insurance, cash budget, gender) so
  admins can see exactly which filter throttled the result count.

### Auto-trigger LLM outreach (Task 4)
- Already wired: `helpers._trigger_matching` schedules
  `_spawn_bg(run_outreach_for_request(...))` whenever
  `outreach_needed_count > 0` and env `OUTREACH_AUTO_RUN != "false"`
  (default `true`). Test confirms outreach fires automatically when a
  fresh request gets <30 directory matches.

### Therapist signup polish (Tasks 5 + 6)
- Step-1 helper paragraph ("Your profile is reviewed before going
  live…") promoted ABOVE the action row; the right-column with the
  Next button now has `ml-auto`, pinning it to the right edge whether
  or not the Back button is visible.
- "Full name + degree" label split into a clean label + a small hint
  "e.g. Sarah Lin, LCSW" so the line never wraps at 1280×800.

### Pending value tags + duplicate gating (Task 7)
- New helper `_attach_value_tags()` annotates each pending therapist
  with `value_tags:[{label, axis, kind:'fills_gap'|'duplicate', count}]`
  + `value_summary:{fills_gaps, duplicates, is_duplicate_only}`.
  `_DUP_THRESHOLD=5`: axes with ≥5 active providers are duplicates.
- `PendingSignupRow` renders a green **"Fills N gaps"** chip OR a red
  **"Duplicate roster — consider declining"** warning, plus per-axis
  chips (Treats X, Practices Y, Sees Z, Accepts W…) with the active-
  provider count behind each.

### DOPL link upgrade (Task 8)
- `license_verify.DOPL_SEARCH_URL` swapped to
  `https://edopl.idaho.gov/onlineservices/_/#2` per user's request.
  All "Verify on DOPL ↗" links now deep-link to the SPA's License
  Lookup tab.

### Tests / verification
- Backend: `tests/test_iteration57_match_gap.py` (4/4) +
  `tests/test_iteration57_auto_outreach.py` (created by testing
  agent). 22/22 regression green.
- Frontend: testing agent confirmed all 8 items end-to-end (admin tab
  refactor, match-gap panel, value-tag chips + duplicate badges, DOPL
  edopl URL, signup right-aligned Next + label/hint split). **100%
  green.**


## Iteration 56 — Refactor + intake rate limit + 7 UX polishes (Apr 28, 2026)

User asked for 8 changes; all shipped in one batch.

### Refactor (Task 1)
- Extracted 5 admin panels from `AdminDashboard.jsx` into
  `src/pages/admin/panels/`: `OptOutsPanel.jsx`,
  `ProfileCompletionPanel.jsx`, `TeamPanel.jsx`, `MasterQueryPanel.jsx`,
  `BlogAdminPanel.jsx`, plus a tiny `_shared.jsx` exporting the `<Th>`
  helper. New `SettingsPanel.jsx` added (see rate limit below).
- `AdminDashboard.jsx` shrank from **5555 → 4448 lines** (-1107 lines,
  -20%). Each panel imports its own deps; no behavioural changes.

### Therapist signup (Tasks 2 + 3 + 4)
- Help text now reads "Enter your full name + degree (e.g. Sarah Lin,
  LCSW)." (was "title (e.g. ... LCSW)").
- Field label & placeholder shortened to "Sarah Lin, LCSW" so it
  doesn't wrap on narrow screens.
- `phone_alert` (private SMS alert phone) is now **optional**: removed
  the `<Req />` marker, dropped the requirement from `canAdvance(1)` and
  `stepBlockReason`, and updated hint text to "Optional — for SMS alerts
  when new referrals match. Never shown to patients."

### Intake checkout (Task 5)
- Final-step agreement checkbox label is now JSX with two anchor
  links — `agree-terms-link` → `/terms` and `agree-privacy-link` →
  `/privacy`, both `target="_blank"`.

### Patient intake rate limit (Task 6)
- Backend gate inside `POST /api/requests`: counts existing requests
  for the same email within a rolling window; returns HTTP 429 with a
  friendly message when exceeded. Bounds are stored in
  `app_config.intake_rate_limit` (default `{max_requests_per_window: 1,
  window_minutes: 60}`).
- New admin endpoints `GET /api/admin/intake-rate-limit` and
  `PUT /api/admin/intake-rate-limit` (1≤limit≤50, 1≤window≤7 days).
- New **Settings** admin tab (under "More" dropdown) with input fields
  for both values and a "Save rate limit" button. Live "Currently
  allowing X requests per Y minutes" preview updates as the admin
  types.
- Removed the persistent "Submit another request" CTA from
  `PatientPortal.jsx`.

### Patient portal sign-out (Task 7)
- `signOut()` now navigates to `/sign-in?role=patient` (was `/`) so
  users land on a useful page rather than the marketing homepage.

### SignIn password section (Task 8)
- When the typed email has a password set, the page now shows a clear
  divider — uppercase "Sign in with password" between two horizontal
  rules — plus a "Welcome back — we found an account for {email}"
  paragraph above the password input. Testid:
  `signin-password-section`.
- When the typed email does NOT have a password, a small hint
  (`signin-no-password-hint`) appears above "Send me a code"
  explaining that a one-time code will be sent and a password can be
  set after.

### Tests / verification
- Backend testing agent (iteration_18.json):
  - 11/11 new tests in `tests/test_iteration55_rate_limit.py` (GET
    defaults, PUT validation, PUT round-trip, 429 trigger, raised
    limit unblocks, admin auth gating).
  - 11/11 prior `test_iteration3_rate_limit.py` regression.
- Frontend testing agent: every refactored panel still mounts with
  the right testid; therapist signup labels/placeholder/optional phone
  verified; intake checkout terms+privacy links verified; patient
  portal sign-out + missing "Submit another" verified; signin password
  divider + no-password hint verified. **100% pass on all 8 items.**


