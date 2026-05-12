# TheraVoca Master Backlog

Tracking work scoped but deferred. New items go at the top of the
relevant section.

> **Heads up on Phase 5 dashboard** (was a 🔴 critical item below): the
> Outcomes admin dashboard built 2026-05-11 supersedes the original
> 4-sub-tab design (Overview / All Surveys / Match Strength /
> Therapist Reliability). The new design reorganizes around 4 business
> questions (Marketing / Recruiting / Satisfaction / Matching Algorithm).
> Some sub-features from the original spec are still open: CSV export
> per tab, per-milestone retention donuts, response-rate charts. Treat
> those as additions to the existing Outcomes dashboard rather than a
> separate rebuild.

---

## 🔴 Critical (must fix before launch)

### 1. HIPAA infrastructure sprint
- Render: upgrade to BAA-eligible tier, sign Render BAA
- MongoDB Atlas: upgrade to BAA-eligible tier, sign Atlas BAA
- Email vendor: swap Resend -> BAA-eligible (Postmark BAA, AWS SES BAA, or Paubox)
- LLM calls: ensure no PHI hits non-BAA endpoints
- Notice of Privacy Practices (NPP) document at intake
- Encryption at rest verified end-to-end

**Audit update 2026-05-12 — what code now enforces:**
- ✅ TLS-only Mongo URI in production (deps.py raises on plaintext)
- ✅ Security headers middleware (HSTS / CSP / X-Frame-Options / nosniff)
- ✅ JWT exp claim on admin sessions (8h)
- ✅ Patient emails hashed before reaching the LLM in master_query
- ✅ max_length on intake free-text fields
- ✅ CORS no longer uses wildcard methods/headers
**Still vendor/config work (not code-fixable):**
- Anthropic BAA must cover ANTHROPIC_API_KEY account before production
  patient PHI runs through research_enrichment grader (slugs only, but
  still PHI under HIPAA)
- Resend swap is the biggest remaining gap; Resend sees full email
  bodies including names, presenting concerns, free-text patient notes

**Still code-fixable (deferred — see new items below):**
- Audit log coverage gaps on admin patient-data reads (item NEW-3 below)
- LLM PHI sanitizer helper (item NEW-2 below)

### 2. Universal unsubscribe flow (legally required CAN-SPAM)
**Scope expanded 2026-05-11: applies to therapist emails too, not
just patient emails.** Therapist surveys, weekly pulse, recruiting
emails -- anything recurring/promotional -- needs the same
unsubscribe affordance. Pure transactional emails (verification,
match-released, password reset) are exempt under CAN-SPAM.

- HMAC-signed unsubscribe URL in email footer for ALL recurring emails
- One-click unsubscribe page (no login) -- two flavors:
  - patient unsubscribe -> sets `unsubscribed: True` on request doc
  - therapist unsubscribe -> sets `unsubscribed: True` on therapist doc
- All cron senders + `_deliver_results` skip patients with unsubscribed
- All therapist senders (Phase 3 survey, weekly pulse, recruiting)
  skip therapists with unsubscribed
- Admin dashboard view of unsubscribed patients AND therapists
- Re-subscribe option
- Currently: only have temporary "reply STOP" text footer on patient emails

### 3. Outcomes dashboard -- remaining sub-features (was Phase 5)
*The core dashboard ships 2026-05-11. These are follow-on additions.*
- CSV export per tab
- Per-milestone retention donuts (48hr / 3wk / 9wk / 15wk)
- Response-rate charts per milestone
- Therapist Phase 3 survey dedicated sub-view (currently rolled into
  Recruiting tab)
- Free-text excerpts richer view (currently shows 4 recent quotes)

### 4. Stripe real-world payment test
- Currently in test mode
- End-to-end test with real card, real bank, real payout
- Verify subscription billing for therapists
- Verify proration on upgrades/downgrades
- Verify webhook signature validation under load
- Confirm refund/dispute paths

### 5. Crisis escalation protocol
- What happens if patient submits survey with self-harm indicators
- Crisis resource page (988 Suicide & Crisis Lifeline)
- Whether NPS textareas trigger any alert
- Therapist-to-TheraVoca handoff protocol

---

## 🟠 High priority

### NEW-2. Centralized LLM PHI sanitizer (raised 2026-05-12 audit) -- DONE
`llm_client.ask_claude()` now passes every prompt + system message
through `_sanitize_prompt()` before sending. Regex-redacts:
- Email addresses -> `[REDACTED_EMAIL]`
- US phone numbers -> `[REDACTED_PHONE]`
- 5-digit ZIP / ZIP+4 -> `[REDACTED_ZIP]`
Opt-out flag `allow_pii=True` for legitimate cases (no caller uses it
as of 2026-05-12).

### NEW-3. Audit log coverage on admin patient-data reads -- DONE 2026-05-12
Added `audit.emit()` to the previously-uncovered admin GETs:
- `GET /admin/feedback` -- list_feedback
- `GET /admin/outcome-tracking` -- view_outcome_tracking
- `GET /admin/feedback-dashboard` -- view_feedback_dashboard
- `GET /admin/therapists` -- list_therapists
- `GET /admin/therapists/{therapist_id}` -- view_therapist_detail
Previously-audited GETs were already correct
(`/admin/requests`, `/admin/requests/{id}`, `/admin/patients`,
`/admin/audit-log`). Still TODO: add a regression test that every
admin GET emits, so we catch new endpoints that forget the call.

### NEW. Admin console UI re-org / declutter (raised 2026-05-11)
Josh flagged the admin console has too many buttons, dropdowns, pages,
tabs. Needs a deliberate cleanup pass when reorganizing:
- Inventory every tab in the secondary nav and judge each (keep / merge /
  hide). The Outcomes tab replaced Feedback + Feedback tracking already.
- Inventory all action buttons on rows (Edit, Preview, Archive,
  Delete, Deep research, Test survey, etc.) -- group into a single
  "..." menu where possible.
- Inventory dropdowns and modals; collapse redundant ones.
- Likely scope: 4-6 hours. Best done as one focused session after MVP
  launch, not piecemeal.

### 6. Patient match history view -- ALREADY DONE (verified 2026-05-11)
- Lives at `/portal/patient` (`frontend/src/pages/PatientPortal.jsx`).
- Backed by `GET /api/portal/patient/requests` which returns all
  requests for the signed-in patient, newest first, with application
  counts and notified counts.
- Login is via magic-code (6-digit email code) or password if set.
- No additional work needed for MVP. Could add deeper drilldowns
  later but the core history list is functional.

### 7. Wire admin button for "Fire test therapist survey"
- Backend endpoint exists (`POST /admin/therapists/{tid}/fire-test-survey`)
- No UI button yet
- Add to admin therapists panel as row action

---

## 🟡 Medium priority

### 8. `exports/cron_runs_export.json` security audit -- DONE 2026-05-11
- Audit result: file WAS committed once (commit `77ef6e2` on 2026-04-30)
  but contained `[]` (empty array). No sensitive data leaked.
- Added `exports/cron_runs_export.json`, `exports/feedback_export.json`,
  and `exports/therapist_surveys_export.json` to `.gitignore` to prevent
  future accidental commits.
- No filter-branch/BFG scrub needed -- contents were empty.

### 9. Stale v1 flag cleanup
- Old test requests have `structured_followup_*_sent_at` fields from v1 era
- Harmless dead data, no v1 code reads these flags
- One-shot Mongo cleanup script to remove fields from all docs

### 10. Testing toggle UI bug
- Admin's `feedback_testing` toggle won't switch back to OFF once turned ON
- UI bug only, backend correctly handles both states

### 11. Verification email greeting renders blank
- Code says greeting = "Hello," but template structure shows it blank in actual email
- "Almost there" header carries personality, so works visually
- Cosmetic -- not blocking

### 12. Delete orphan therapist weekly pulse code
- `send_therapist_weekly_pulse` defined in `email_service.py` but never called
- `submit_therapist_pulse` endpoint exists but no corresponding cron trigger
- `weekly_pulse` template exists in `email_templates.py`
- **Scope is larger than first estimated (2026-05-11 review):**
  also touches `frontend/src/pages/TherapistPulse.jsx` (305 lines),
  `/therapist/pulse` route in `App.js`, and the `gen_pulse` helper in
  `scripts/simulate_feedback.py`. Plan ~45-60 min for a clean delete.

---

## 🟢 Nice-to-haves (post-launch)

### 13. Optional `preferred_name` field at patient intake
- Currently no name collected from patients (anonymous-friendly)
- Would let us fall back to "Hello [name]," when present

### 14. Admin nav improvements
- Breadcrumbs for nested admin views
- Saved filters per admin user

### 15. Therapist availability calendar
- Currently simple "available/not" toggle
- Real calendar view with daily/weekly slots

### 16. Patient onboarding email sequence
- Welcome email after verification
- Tips for working with a therapist
- What to expect at first session

---

## 🟢 Outcomes dashboard -- planned additions (scoped 2026-05-11)

Below are the higher-impact analytics for the Outcomes dashboard that
we scoped together but pushed to post-MVP.

### Recruiting tab
- **Therapist response speed** (~30 min) -- avg hours from referral
  sent to therapist reply. Both an admin signal and a recruiting pitch.
- **Coverage gaps as recruiting heatmap** (~20 min) -- surface
  CoverageGapPanel inside Recruiting so admin knows who to chase.
- **Therapist activity rate** (~20 min) -- % of approved therapists
  actively responding vs going dark.

### Satisfaction tab
- **Best/worst therapists by retention leaderboard** (~30 min) -- rank
  therapists by % of their patients still in therapy at 15w.
- **Sentiment themes from free-text comments** (~60 min) -- cluster
  patient/therapist free-text by theme via Claude API.

### Matching Algorithm tab
- **Which factors predict retention** (~45 min, needs >=50 patients
  past 15w) -- break Match Strength into components, show which
  correlate most with retention.
- **Failure mode analysis** (~30 min) -- for patients who dropped,
  what do they have in common? Reveals filter bugs.
- **Match Strength -> NPS scatter** (~15 min) -- does a strong match
  produce happier patients, not just longer-staying ones?

---

## 🟢 Tech debt

### 17. Extract shared survey helpers
- 6 components duplicated between `FeedbackSurvey.jsx` and `TherapistSurvey.jsx`:
  - `PillButton`, `QuestionCard`, `TextArea`, `NpsRow`, `FourButtonScale`, `ReplayBanner`
- Move to `frontend/src/components/survey/`
- Refactor both files to import shared versions

### 18. `scripts/simulate_feedback.py` CRLF drift check
- Phantom-modified file in working tree
- Verify it actually runs after CRLF normalization

### 19. Logger initialization inconsistency
- `void = logger` workaround at end of admin.py and helpers.py
- Clean up after broader refactor

### 20. Missing input validation on intake form -- DONE 2026-05-12
- max_length added to all free-text and list fields on RequestCreate
  as part of the HIPAA quick-wins batch.

### 21. Database indexes audit
- `db.requests` on `id`, `email`, `results_sent_at`, `unsubscribed`
- `db.feedback` on `{request_id, milestone}` (compound, unique)
- `db.applications` on `request_id`, `therapist_id`, `created_at`
- `db.therapist_surveys` on `{therapist_id, survey_number}` (compound, unique)

### 22. HMAC token TTL clarification
- `FEEDBACK_TOKEN_TTL_HOURS` reused for both patient and therapist tokens
- Document current value, consider if therapist tokens need longer TTL

---

## 🟢 Known issues carried (not blocking)

### 23. Funnel cohort math
- With the date filter, "matches sent" and "picked" are counted
  independently (different cohorts in the same number). Statistically
  a bit fuzzy. A "cohort starting in period" mode would be cleaner
  but requires per-patient journey tracking.

---

## 🟢 Operational improvements

### 24. Render deploy notifications
- No Slack/email when deploys go green or fail
- Configure Render webhook -> email or Slack

### 25. Better cron observability
- Cron crashed 4 days before noticed earlier
- Alert on `db.cron_runs` doc where `completed_at` null AND `started_at` > 24hr ago
- Could be Render cron job that pings personal email if cron failed

### 26. Backup strategy verification
- Atlas has automatic backups -- verify retention period
- Consider scripted full export of `db.feedback`, `db.requests`, `db.therapist_surveys` to S3 weekly

---

## 🟢 Documentation backlog

### 27. CLAUDE.md additions
- Document "grep before delete" rule
- Document v2 survey end-to-end test flow
- Document Phase 3 therapist survey trigger logic
- Document `.gitattributes` rules
- (already updated rule 5 for git-from-chat workflow on 2026-05-11)

### 28. Runbook for common ops
- How to reset a test request (the unset script for `surveys_test_fired`, `v2_survey_*_sent_at`, etc.)
- How to verify cron ran successfully (read `db.cron_runs`)
- How to force a v2 survey to fire for a specific request
- How to fire a therapist survey on demand
- How to debug "no surveys fired today" via `_run_*` skip counters

### 29. API documentation
- OpenAPI spec auto-generated from FastAPI exists at `/docs` route
- Review and clean up

---

## ✅ Done (recent)

### 2026-05-12 (HIPAA audit pass 2 + autonomy-mode shipping batch)
- HIPAA hardening:
  - MongoDB TLS enforced in production (deps.py refuses to start with
    plaintext URI).
  - CORS allow_methods / allow_headers no longer wildcards (server.py).
  - LLM PHI sanitizer: every prompt through ask_claude() now strips
    emails, phone numbers, ZIPs before reaching the Anthropic API.
    Default-on; opt-out flag for callers that need raw PII (none today).
  - Audit log coverage extended: GET /admin/feedback,
    /admin/outcome-tracking, /admin/feedback-dashboard,
    /admin/therapists, /admin/therapists/{id} all emit now.
  - research_enrichment grader documented for PHI flow (Anthropic BAA
    required before prod).
  - Untracked the empty exports/cron_runs_export.json (was gitignored
    but still tracked from a pre-gitignore commit).
- Admin console reorg per approved mockup -- 5 primary tabs (Inbox /
  Directory / Outcomes / Content / Operations) + dev-only Testing.
  Master Query moved to top-right modal. Test buttons consolidated
  inside Testing > Test actions.
- Removed Research Reviews feature end-to-end (LLM agent, admin
  endpoints, matching score bonus, frontend display, profile badges,
  PRD docs). Reason: too complex for the signal it added.
- Removed Emergent integration end-to-end (Stripe proxy URL,
  demo_mode plumbing, .emergent/ config folder, frontend demo
  fast-forward branches). Stripe now routes direct via STRIPE_API_KEY.
- CLAUDE.md rule 5 updated to autonomy mode: Claude pushes directly
  to staging, heartbeats with commit hash. Approval upfront via
  mockups/specs only.
- Test Actions panel: Run-a-cron-now (allowlist of 10), Send-test-
  email-to-me, Strip-legacy-flags wired to real backend endpoints.
- Stripe webhook hardening: 4 missing handlers added
  (charge.refunded, charge.dispute.created, payment_intent.succeeded,
  payment_intent.payment_failed) plus retrieve_subscription helper
  that the existing handler had been silently falling back to {} on.
- HIPAA quick wins (4 commits): security headers middleware (HSTS,
  X-Frame-Options, CSP, Permissions-Policy), 8h admin session TTL
  (was 30d), HMAC-hashed patient emails before LLM in master_query,
  max_length on free-text intake fields.
- Matching algo (3 commits): MAX_EXPECTATION_ALIGNMENT 30->40 so
  expectation actually outranks issues (was inverted vs docstring);
  payment_alignment partial credit (50%) when patient signals
  flexibility but no path lands; strict-priorities silent-zero
  guard -- if strict mode wipes everyone, re-run without strict
  and tag results with strict_priorities_relaxed=True.

### 2026-05-12 (BACKLOG cleanup -- items confirmed done in code)
- Item #6 patient match history view -- already shipped, verified.
- Item #7 "Fire test therapist survey" admin button -- already wired
  in ProviderRow at `fire-test-survey-${t.id}`; BACKLOG entry was
  stale.
- Item #8 cron_runs_export.json security audit -- already done
  2026-05-11.
- Item #11 verification email greeting -- already fixed in
  send_verification_email (greeting now renders).
- Item #12 orphan therapist weekly pulse -- all referenced files
  already deleted from the repo.
- Item #20 missing input validation on intake form -- closed by
  the 2026-05-12 HIPAA max_length pass.

### 2026-05-11
- Outcomes admin dashboard built (4 business-question tabs;
  replaces planned Phase 5 design)
- Date range picker (default 90d) on Outcomes
- NPS by referral source chart (Marketing tab)
- Detractor alert list (Satisfaction tab)
- Hide obsolete Feedback admin tab
- Fix mojibake in matching.py / helpers.py / auto_recruit.py
- Tighten encoding-check script (stop false-flagging legit unicode)
- Fix hardcoded `30` in match-gap alert; now reads `max_invites`
  from app_config
- Add `session_expectations` field to patient results page
- CLAUDE.md rule 5 updated: git from chat

## How to use this list

When starting a new session, point me at `docs/BACKLOG.md` and tell me
the priority. I'll work top-down from the section you name.
