# TheraVoca — Context Dump for a Brainstorm Chat

_Paste everything below this line into a fresh Claude conversation. It's self-contained._

---

## What it is, in one breath

TheraVoca is a free, anonymous therapist-matching service for people in Idaho. A patient answers a 7–10 minute intake (presenting issues, format, payment, scheduling, plus an optional "deep-match" set of 3 open-text questions about how therapy has gone before and how they describe themselves), and we surface the 3 best-fit therapists ranked by a multi-axis scoring engine. The patient contacts the therapist directly via email/phone/Book-Consult — TheraVoca isn't in the middle of the clinical relationship. We're paid by therapists (subscription, with trial), not by patients.

## Why it exists

The status quo for finding a therapist is awful: Psychology Today / GoodTherapy are paid directories with no fit signal; insurance "find-a-provider" lists are dead-or-wrong near 50%; word-of-mouth doesn't scale. Patients give up. TheraVoca's bet: a good intake + a good scoring engine + a small, vetted, **actually-available** therapist pool beats a giant directory of cold leads. Idaho-only at launch because (a) founder is local, (b) one state = one license-verification regime + one set of laws.

## How a patient experiences it (the public flow)

1. Landing page (`/`) — value prop, testimonials (Cloudflare Stream videos), CTA into intake at `/#start`.
2. Intake form — multi-step wizard, validates per step, scores moderation risk before submission.
3. Submit → 24-hour "soft hold" — we don't immediately reveal matches. The hold lets us batch-fire outreach to therapists in their queue, surface "interested" responses, and assemble the top 3 with apply messages. (Founder-policy decision; previously instant.)
4. `/results/:id` — 3 therapist cards ranked by `patient_rank_score`. Each card: photo, name, credentials, years, modalities, the per-match "Why we recommend" research-LLM blurb, 4-up grid (Format / Cash rate / Sliding scale / Free consult), office address (Google Maps link), website, insurance plans, languages, match-score badge, "Why we matched" green chips, "Where you may not align" gap callout, therapist's apply message, contact buttons (Book free consult / Email / Phone).
5. Optional "Try again" if the matches don't resonate — re-runs intake with tweaked answers.

## How a therapist experiences it

1. Landing → `/therapists/join` — 9-step signup wizard: basics, license + photo (Idaho only), specialties, format/modalities, insurance, style + bio (with an AI bio-drafter button powered by Claude Haiku), deep-match T1–T6 signals (lived experience, session-style prefs, narrative phrases), Cloudflare Turnstile, submit.
2. Admin manually reviews each profile (review-all-by-default policy, toggle in admin Settings).
3. On approval → can sign in to `/therapist-portal` to edit profile, see applications, mark Available/Paused, etc.
4. When a new patient lands in their match queue, they get an email + (eventually) SMS alert with a deep-link to "apply" (write a 2–3 sentence message that becomes the patient-facing apply blurb).
5. Stripe subscription (with trial). Patient never sees billing state.

## The matching engine (1-paragraph mental model)

Two-step. **Step 1**: per-therapist score 0–95% across ~13 weighted axes — issues fit (35), availability (20), modality (15), urgency (10), prior-therapy history (10), payment fit/alignment (10+3), gender (3), language (4), deep-match resonance (15, from the patient's open-text scored via OpenAI embeddings vs the therapist's lived-experience + early-sessions text), plus a 25-point "research bonus" from an LLM-cached snapshot of the therapist's public web presence. **Step 2**: rank the qualifying pool by a `patient_rank_score` that folds Step-1 into apply-quality, blurb-engagement, speed, and commit toggles. Top 3 → results page. Anything that fails a "strict priority" (patient said insurance is required; therapist doesn't take it) is filtered out before scoring.

## The tech stack

- **Frontend**: React (CRA + CRACO), served as static build from the FastAPI backend (no separate React deploy).
- **Backend**: Python / FastAPI / uvicorn.
- **Database**: MongoDB (Atlas in prod/staging, local in CI).
- **Hosting**: Render. One staging service today (`theravoca-production.onrender.com` — the name lies; it's staging). Production service defined in `render.yaml` but not yet pointed at a `main` branch deploy.
- **Auth**: JWT for admin, magic-link + JWT for therapists. Patients are anonymous (keyed by `request_id` only, never an account).
- **AI / models**:
  - Anthropic Claude Sonnet 4.5 — research enrichment, moderation reasoning
  - Anthropic Claude Haiku 4.5 — bio drafter, lightweight LLM tasks
  - OpenAI `text-embedding-3-small` — semantic match on T5/T2 + patient open-text
- **Third-party**: Stripe (subscriptions), Cloudflare Turnstile (CAPTCHA), Cloudflare Stream (testimonial video), Resend (transactional email), Telnyx (SMS — pending CTIA approval), PostHog (anon analytics, session recording disabled per HIPAA scope-out), Sentry (errors).
- **Repo**: `therapymatch-collab/theravoca-mvp`, branch `staging` is the source of truth; `main` is unused for now.

## The HIPAA / legal posture (important — drives a lot of design)

Attorney verdict (2026-05-13, Mason): **TheraVoca is NOT a HIPAA Business Associate today** because we don't receive PHI on behalf of a covered entity — patients self-disclose to us before any therapist relationship exists. Practically this means:

- We never store the patient's intake under their real name. Patient identity is `request_id` + email only.
- No session recordings (PostHog has `disable_session_recording: true` globally).
- No PHI in URL parameters or logs.
- Email allowlist + override mode during pre-launch testing (`EMAIL_OVERRIDE_TO`) to prevent accidental sends to real patient emails.
- A "boundary line" exists: if we ever build therapist-facing features that move clinical data through us (notes, scheduling, billing-on-behalf-of), the BA analysis flips. We're staying clear of that for v1.

## What's already built

- Full patient intake + match flow with the 24h hold gate
- 9-step therapist signup with AI bio drafter, Cloudflare Turnstile, per-step research-backed "Why we ask" callouts, clickable step navigator
- Therapist portal: edit profile, view applications, set availability, deep-match completion meter
- Admin dashboard: requests view with debug breakdown, providers directory with patient-eye preview, Site Copy editor (28+ wired keys), Email Cron Schedules panel, moderation queue with soft-flag risk gate + Release-to-matching, Test Actions (backfill / wipe / send test SMS / send test email / cron runner)
- Matching engine v5 with deprecated T1/T3 fallback derived from T6
- Email templates with editable subject + body via Site Copy, quiet-hours guard (defer to 8 AM Idaho)
- Stripe subscription + webhook signing
- Resend webhook for bounce handling
- Sentry + PostHog wired
- Multi-browser viewport smoke test (chromium + webkit pass; firefox blocked by Windows env)
- Encoding-check + Turnstile-deps regression scripts run on every CI build

## What's NOT yet shipped (external blockers)

- Production hosting decision (currently only staging exists; need to decide whether to keep `theravoca-production.onrender.com` as the prod URL and stand up a new staging, or stand up `theravoca` prod service per `render.yaml`)
- DNS migration for the `theravoca.com` domain
- Telnyx CTIA approval (campaign vetting in progress) — until approved, SMS path defers to Twilio fallback
- BAAs with vendors that might touch identifiers later (Resend has one; PostHog signed; MongoDB Atlas requires M10+ paid for BAA; OpenAI requires Enterprise; Anthropic has one on request)
- Mobile-Safari unmuted-autoplay limitation — currently solved by no-autoplay + tap-inside-iframe, but worth re-evaluating if testimonial engagement is low
- Real provider directory load — currently a mix of seeded fake + a handful of real signups
- Marketing site copy review pass by founder

## What's most valuable to brainstorm

Pick one of these or bring your own:

1. **Patient activation funnel** — landing → intake completion → results-page engagement → outbound-contact. Where do we lose them, and what's the cheapest thing to test? (Founder hasn't run paid traffic yet — every drop-off is hypothetical.)
2. **Therapist growth loop** — we need real therapists with real availability, not seeded data. What's the lowest-friction acquisition channel for the first 50 Idaho therapists who'll actually log in and apply to patients? (Cold outbound? Idaho counselor association partnerships? Referral incentives from existing therapists?)
3. **Match-result quality vs explainability** — the 13-axis scoring is fairly sophisticated, but the patient sees a single % badge + 3 chips + a gap callout. Is the gap callout doing more good (transparency, trust) or harm (anchoring on what's wrong)? How would we measure this?
4. **The "24-hour hold" decision** — instant matches would feel snappier and patients are emotional buyers. We hold to give therapists time to apply with personal messages, which becomes the patient's actual selection criterion. Worth A/B-ing? What would we measure?
5. **Pricing on the therapist side** — currently a flat subscription with trial. Should it be tiered by patient-match volume? Per-patient? Free-up-to-N-matches-then-paid? Founder hasn't pressure-tested with real therapist objections.
6. **The "review every patient request" gate** — currently default-on for safety; admin manually approves every patient before matches release. Doesn't scale past a few patients/day. When do we flip it to default-off + only-review-high-risk, and what defines "high-risk"?
7. **Idaho → next-state expansion** — what's the right second state, and what specifically about TheraVoca's stack changes when we add one? (License-verification, in-state-licensure filtering, distance matching, marketing geography.)
