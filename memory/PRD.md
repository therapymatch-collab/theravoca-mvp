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
