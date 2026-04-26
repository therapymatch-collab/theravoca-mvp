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
- Matching engine (`matching.py`) with hard filter on state + 5-axis scoring
- Resend email service (`email_service.py`) with branded HTML templates
- Auto-seed of 100 Idaho therapists on startup (`seed_data.py`)
- React frontend with 6 routes:
  - `/` Landing + multi-step intake
  - `/verify/:token` Email verification (handles `pending` state too)
  - `/therapist/apply/:requestId/:therapistId` therapist application
  - `/results/:requestId` patient results page (live polling)
  - `/admin` password gate
  - `/admin/dashboard` operations console
- Cormorant Garamond + Manrope typography, earthy palette, tested by testing agent
- 24h auto-trigger via `asyncio.create_task` (resets on backend restart)

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
