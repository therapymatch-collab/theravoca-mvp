# TheraVoca — PRD

## Original Problem Statement
Build a lean MVP for **TheraVoca** — a real-time therapist matching engine.
Patient submits a request → system matches against therapist DB → notifies matching
therapists by email → therapists "apply" with a message → ranked matches emailed
back to patient within 24h.

Tech: FastAPI + MongoDB + React. Email via Resend. ~100 seeded Idaho therapists.

## User Personas
1. **Patient/Referrer** — submits an anonymous request, receives ranked therapist
   matches in their inbox.
2. **Therapist** — receives a notification email with anonymized referral + match
   score, can submit interest with a personal note.
3. **Admin** (TheraVoca operator) — monitors requests, manually triggers results,
   adjusts match threshold, resends notifications.

## Core Requirements (static)
- Multi-step intake form (no login required)
- Email verification before matching
- Scoring algorithm: state (required), issue, age, payment, location, modality
- Configurable match threshold (default 60%, auto-lower if too few matches)
- Anonymous referrals (therapists never see patient identity)
- Therapist contact info only revealed in patient results email
- Admin dashboard (password-gated)
- Resend integration for transactional emails
- Both manual + 24-hour automated results delivery

## What's Implemented (2026-02-26)
- FastAPI backend with full REST API (`/app/backend/server.py`)
- Matching engine (`matching.py`) with hard filter on state + 5-axis scoring; excludes `pending_approval` and `is_active=false` therapists
- Resend email service (`email_service.py`) with branded HTML templates (verification, therapist notify, patient results, signup received, signup approved)
- Auto-seed of 100 Idaho therapists on startup (`seed_data.py`); legacy backfill on startup ensures seed therapists carry `is_active=true`, `pending_approval=false`
- React frontend with 7 routes:
  - `/` Landing + multi-step intake
  - `/therapists/join` Therapist self-signup portal
  - `/verify/:token` Email verification (handles `pending` state too)
  - `/therapist/apply/:requestId/:therapistId` therapist application
  - `/results/:requestId` patient results page (live polling)
  - `/admin` password gate
  - `/admin/dashboard` operations console (tabs: requests, therapist signups)
- Cormorant Garamond + Manrope typography, earthy palette, tested by testing agent

## Iteration 2 (2026-02-26)
- **Therapist self-signup portal** (`/therapists/join`): public form with specialty weight sliders, modality/age/insurance selectors. New signups land in `pending_approval=true` queue.
- **Admin approval workflow**: `/admin/dashboard` "Therapist signups" tab with Approve/Reject buttons. Approved therapists immediately become eligible for matching; rejected therapists are deactivated.
- **Cron sweep loop**: every `SWEEP_INTERVAL_SECONDS` (default 300s), backend scans for requests where `verified=true, results_sent_at=null, verified_at <= now - AUTO_DELAY_HOURS`, and triggers `_deliver_results`. Survives backend restarts (replaces fragile per-request `asyncio.sleep`).
- **Email templates**: signup received + approval emails added.

## Iteration 8 (2026-04-26) — Payment & Insurance UI/data-model sync
- **TherapistSignup.jsx** rewritten with full v2 schema fields: gender, client_types, age_groups, primary/secondary/general specialty tiers, modalities, modality_offering, office_locations, insurance_accepted (multi-select Idaho insurer pills), cash_rate, sliding_scale, years_experience, availability, urgency_capacity, style_tags, free_consult, bio.
- **IntakeForm Step 4 (Payment)** — Idaho insurer Select dropdown (15 options incl. "Other / not listed") for insurance/either; numeric budget input + sliding-scale-ok checkbox for cash/either.
- **`/app/frontend/src/lib/insurers.js`** — single source of truth for Idaho insurer lists (`IDAHO_INSURERS`, `PATIENT_INSURER_OPTIONS`).
- 10/10 backend pytest pass, frontend Playwright validated. Test file: `/app/backend/tests/test_iteration8_payment_insurance.py`.

## Iteration 14 (2026-04-27) — Stripe subscription onboarding ($45/mo, 30-day free trial)

**Therapist subscription flow shipped end-to-end:**
- `stripe_service.py` — uses Stripe Checkout in **setup mode** (collects card without immediate charge), via the Emergent-managed Stripe proxy (`STRIPE_API_KEY=sk_test_emergent` in `/app/backend/.env`).
- After signup, therapist sees a "Add payment method & start free trial" CTA → Stripe Checkout (or fast-forward in demo mode) → returns to `/therapists/join?subscribed=ID&session_id=...` → backend `/sync-payment-method` endpoint stores `stripe_customer_id`/`stripe_payment_method_id` and sets `subscription_status="trialing"` with `trial_ends_at = now+30d`.
- Day-31 charging: `POST /admin/therapists/{id}/charge-now` runs a $45 PaymentIntent (off-session, customer's saved card). On failure → `subscription_status="past_due"` and matching is suspended.
- Webhook handler `POST /stripe/webhook` reacts to `customer.subscription.updated/created/deleted` and `invoice.payment_failed` to keep status in sync (production path).
- **Matching gate**: `_trigger_matching` now skips therapists whose `subscription_status` is in `{past_due, canceled, unpaid, incomplete}`. Trialing + active + legacy_free still match.
- **Therapist Portal banner**: shows "Add a payment method to continue receiving referrals" when status needs attention; shows "Trial ends MMM DD" when trialing.
- **Admin All Providers**: every row now displays a 2nd-line subscription badge (incomplete / trialing / active / past_due / canceled / unpaid / legacy_free).
- **Backfill** updated: all 147 existing therapists set to `trialing` with 30-day clock so they go through the same payment funnel.

**DEMO MODE limitation (transparent fallback):** The Emergent Stripe proxy returns a session ID but the real `checkout.stripe.com` hosted page rejects it. Frontend detects `demo_mode=true` from the backend and fast-forwards the sync step locally so the entire UX is testable today. To switch to real Stripe Checkout, drop a real `sk_test_xxx` key into `/app/backend/.env`.

**Tests**: 44/44 across iter-7/9/12 pass. (Existing tests updated to release the new 24h hold before reading results.)

## Iteration 13 (2026-04-27) — 24h hold + Compact match cards + Therapist credentials/notify-prefs + Profile backfill

**Major UX redesign + 5 new features**:
- **24-hour hold on patient results**. New `results_released_at` field on requests. `GET /requests/{id}/results` returns `hold_active=true`, `hold_ends_at`, and `applications_pending_count` (response *count* visible, but individual responses hidden) for the first 24h. The matching engine still records timing for algo tuning.
- **Admin manual release**. New `POST /admin/requests/{id}/release-results` endpoint + "Release results to patient" button in the admin request detail dialog. Used for testing or once enough therapists have responded.
- **Compact patient match card** (4-col detail grid: Format / Rate / Sliding / Free consult + Offices / Insurance row + chips + small `Book free consult` button — was full-width 50px tall, now 138×30px). 3 cards now visible per viewport vs. 1 before.
- **Therapist credential type** field (psychologist / LCSW / LPC / LMFT / LMHC / psychiatrist / other) on signup form + admin Edit Provider dialog.
- **Therapist notification preferences** — `notify_email` + `notify_sms` toggles in signup form + admin edit. `_trigger_matching` respects them (skips email/SMS if disabled).
- **Therapist portal** now displays referrals with 3 statuses (interested / declined / pending) instead of just "applied / new", reflecting decline data.
- **Admin Edit Provider dialog** now exposes ALL fields: credential_type, primary/secondary specialties, modalities, insurances, office locations, client types, age groups, availability windows, style tags, notify_email, notify_sms — in addition to the existing photo/name/email/phone/rate/sliding-scale/free-consult/etc.
- **One-shot backfill endpoint** `POST /admin/backfill-therapists` + "Backfill profiles" button in admin top bar. Idempotently completes every therapist record with realistic fake data (license-suffixed names, full insurances, modalities, bio, phone, credential_type, notification prefs, etc.) and forces every email to `therapymatch+tNNN@gmail.com` so all transactional emails route to your verified inbox. Confirmed: 147/147 records updated.
- **Why-we-matched sort by raw score** — fixed in both PatientResults.jsx and email_service.py.

**Note**: Stripe subscription onboarding ($45/mo after 30-day trial) — playbook in hand but DEFERRED to next iteration. Significant scope (Checkout Session + webhooks + subscription lifecycle handling).

## Iteration 12 (2026-04-26) — Email-template editor + decline flow + photo upload + payment detail

**7 user-requested features**:
- Patient intake Step 2 helper text now reads "**No contact or personally identifiable info**".
- Patient intake Step 5 — new optional **Preferred therapy approach** chip group (CBT, DBT, EMDR, Mindfulness-Based, Psychodynamic, ACT, Solution-Focused, Gottman, IFS, Somatic Experiencing, Person-Centered) scored as new `modality_pref` axis (max 4 pts) → breakdown is now **10 keys**, total still capped at 100.
- **Editable email templates** stored in `email_templates` MongoDB collection. Admin Dashboard 4th tab "Email templates" lists 7 templates (verification, therapist_notification, patient_results, patient_results_empty, therapist_signup_received, therapist_approved, magic_code) with editable subject/heading/greeting/intro/cta_label/footer_note + available_vars hint. Backed by `GET /api/admin/email-templates` and `PUT /api/admin/email-templates/{key}`. Wraps the HTML branding code-side; only wording is editable.
- Therapist email greeting normalized to "**Hi {first_name},**" via new `_first_name` helper that strips license suffix + last name.
- **"Not interested" button in the therapist notification email** — appears next to "I'm interested" CTA. Links to `/therapist/apply/{rid}/{tid}?decline=1` which auto-opens the decline dialog (6 reason checkboxes + optional notes).
- Therapist application **message is now optional** (was min_length=10). Patient results card shows "_This therapist submitted interest without a personal note..._" placeholder when blank.
- **Therapist profile picture upload** — PNG/JPEG/WebP files resized to 256×256 / 80% JPEG / <500KB → base64 stored on therapist doc. Available on `/therapists/join` form, admin Edit Provider dialog. Patient results render avatar circle (initials fallback when no photo).
- **Richer therapist email summary** — payment line now shows actual insurance carrier name, exact cash budget, and "(open to sliding scale)" tag. New row "Preferred therapy approach" lists patient's selected modalities.

**Tests**: 16/16 new iter-12 tests pass + iter-7/8/9/10 regression updated and aligned. Pre-existing v1-schema tests in `backend_test.py` continue to fail (unrelated to iter-12 — they use the old `client_age`/free-text schema from before iter-7).

## Iteration 11 (2026-04-26) — Twilio SMS notifications for therapists
- **`/app/backend/sms_service.py`** — new module with `send_sms`, `send_therapist_referral_sms`, US phone E.164 normalizer. Honors `TWILIO_ENABLED` kill-switch and `TWILIO_DEV_OVERRIDE_TO` (mirrors email override pattern).
- **Matching flow** — `_trigger_matching` now sends a 1-line SMS to every newly notified therapist alongside the email. Best-effort (try/except wrapped) so SMS failure never breaks matching.
- **Admin UI** — new "Test SMS" button (data-testid=`test-sms-btn`) + `POST /api/admin/test-sms` endpoint sends a smoke-test SMS to the configured override.
- **Verified live**: 1 test SMS + 7 referral SMS landed in the user's verified phone (+12036237529); each carries `[was: <intended-therapist-number>]` prefix so admin can trace which therapist would have received it in production.
- **Env**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (+16467606274), `TWILIO_DEV_OVERRIDE_TO` (+12036237529), `TWILIO_ENABLED=true`.

## Iteration 10 (2026-04-26) — Consult CTA + Admin provider directory + Sliding-scale scoring + Email override
- **Patient Results "Schedule a free 15-min consult" CTA** — prominent green button on every result card (`data-testid="consult-btn-{i}"`) that opens a `mailto:` pre-filled with subject "Free 15-min consult — TheraVoca match" and body containing patient's first 2 presenting issues mapped to friendly labels.
- **Sliding-scale scoring (P1)** — new `payment_fit` axis (max 3 pts) added to matching breakdown: scores 3.0 when `request.sliding_scale_ok=true AND therapist.sliding_scale=true`. Total clamped at 100. Breakdown now has 9 keys.
- **"Other / not listed" insurer no-op (P1)** — `_insurance_match` cleanly skips the entire hard filter when patient picks `Other / not listed` or `other`, so therapists without insurance lists still pass.
- **Admin "All providers" tab** — new third tab in `/admin/dashboard` lists every therapist (active + pending + rejected) with status badges. Edit button opens a dialog with editable name, email, phone, cash_rate, sliding_scale, free_consult, modality_offering, urgency_capacity, is_active, pending_approval, bio. Backed by new `PUT /api/admin/therapists/{id}` whitelist-only endpoint.
- **Email override (`EMAIL_OVERRIDE_TO` env)** — when set, `_send` reroutes every outbound email to that single inbox and prepends `[was: <original>]` to the subject. Currently set to `therapymatch@gmail.com` so user sees every transactional email during dev. Unset in production.
- 20/20 new iter-10 tests + 38/38 regression all pass. Test file: `/app/backend/tests/test_iteration10_consult_admin_payment.py`.

## Iteration 9 (2026-04-26) — Match-breakdown transparency
- **Backend** persists `notified_breakdowns` (axis-by-axis score map) on the request doc when matching runs; exposed via `GET /api/requests/{id}/results` per application.
- **PatientResults.jsx** renders a "Why we matched" chip block (max 3 chips, only axes scoring ≥50% of max) below each therapist's message — `data-testid="why-match-{i}"`, `data-testid="why-match-{i}-{axisKey}"`.
- **Patient results email** mirrors the same chip block in HTML so email + web stay consistent.
- 5/5 backend pytest pass + frontend smoke screenshot validated. Test file: `/app/backend/tests/test_iteration9_match_breakdown.py`.

## Iteration 3 (2026-02-26)
- **Admin login rate limiting**: 5 failures / 15 min lockout per IP (configurable via `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES` env). Returns helpful 401 detail with attempts remaining; 429 once locked. Lockout precedence: even a correct password is rejected during lockout window. Successful login resets the counter for that IP.
- **FastAPI lifespan migration**: replaced deprecated `@app.on_event` hooks with `@asynccontextmanager lifespan`. No more deprecation warnings; sweep task is properly cancelled and awaited on shutdown.
- **Note**: rate-limit state is in-memory (per-process). Adequate for single-replica MVP; if horizontally scaled, move to Redis.

## Backlog (P1 / P2)
- **P1** Verified domain for Resend (so emails reach all patients/therapists in production — currently `EMAIL_OVERRIDE_TO=therapymatch@gmail.com` for dev). User must verify a domain on resend.com and update `SENDER_EMAIL` + unset `EMAIL_OVERRIDE_TO`.
- **P2** Sort "Why we matched" reasons by raw score (not % of max) so the heaviest-weighted axes (issues=35) surface first when tied at 100%.
- **P2** Extract AXIS_META into a single source of truth shared between FE + email_service to prevent drift.
- **P2** Multi-state expansion (currently Idaho only).
- **P2** Patient inline status page (already partially built — extend with timeline).
- **P2** "Try again" button if patient unhappy with matches.
- **P2** Optional $15 fee + Stripe (mentioned on inspiration site).
- **P2** Replace URLSearchParams in `buildConsultMailto` with manual `%20` encoding (RFC 6068 compliant) — currently functional in Gmail/Apple Mail.
- **P3** A11y polish: ensure all dialogs have DialogDescription (done for edit-provider; verify others).

## Test Credentials
See `/app/memory/test_credentials.md`.
