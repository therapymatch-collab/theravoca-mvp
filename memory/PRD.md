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

## Iteration 3 (2026-02-26)
- **Admin login rate limiting**: 5 failures / 15 min lockout per IP (configurable via `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES` env). Returns helpful 401 detail with attempts remaining; 429 once locked. Lockout precedence: even a correct password is rejected during lockout window. Successful login resets the counter for that IP.
- **FastAPI lifespan migration**: replaced deprecated `@app.on_event` hooks with `@asynccontextmanager lifespan`. No more deprecation warnings; sweep task is properly cancelled and awaited on shutdown.
- **Note**: rate-limit state is in-memory (per-process). Adequate for single-replica MVP; if horizontally scaled, move to Redis.

## Backlog (P1 / P2)
- **P1** Persist scheduled auto-trigger in DB (survive restarts) via cron sweep
- **P1** Verified domain for Resend (so emails actually reach all patients/therapists)
- **P1** Brute-force protection / rate-limit on `/api/admin/login`
- **P2** Therapist self-onboarding portal (currently admin-seeded only)
- **P2** Multi-state expansion (currently Idaho only)
- **P2** Patient inline status page (already partially built — extend with timeline)
- **P2** "Try again" button if patient unhappy with matches
- **P2** Optional $15 fee + Stripe (mentioned on inspiration site)

## Test Credentials
See `/app/memory/test_credentials.md`.
