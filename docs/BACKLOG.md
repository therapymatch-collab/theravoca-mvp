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

### 2. Patient unsubscribe flow (legally required CAN-SPAM)
- HMAC-signed unsubscribe URL in email footer
- One-click unsubscribe page (no login)
- Sets `unsubscribed: True` flag on request doc
- All cron senders + `_deliver_results` skip if unsubscribed
- Admin dashboard view of unsubscribed patients
- Re-subscribe option
- Currently: only have temporary "reply STOP" text footer

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

### 6. Patient match history view
- Let patients re-login (HMAC link) and see past matches
- List who they were matched with, dates, application status
- Useful for re-matching scenarios

### 7. Wire admin button for "Fire test therapist survey"
- Backend endpoint exists (`POST /admin/therapists/{tid}/fire-test-survey`)
- No UI button yet
- Add to admin therapists panel as row action

---

## 🟡 Medium priority

### 8. `exports/cron_runs_export.json` security audit
- Was almost committed due to gitignore corruption
- Verify never made it to git history: `git log --all -- exports/cron_runs_export.json` should be empty
- If committed, use git filter-branch or BFG to scrub

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
- Cleanup commit to delete all three

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

### 20. Missing input validation on intake form
- Some edge cases (very long text, special characters) may not be sanitized
- Audit all `db.requests.insert_one()` callers

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

- **2026-05-11** -- Outcomes admin dashboard built (4 business-question
  tabs; replaces planned Phase 5 design)
- **2026-05-11** -- Date range picker (default 90d) on Outcomes
- **2026-05-11** -- NPS by referral source chart (Marketing tab)
- **2026-05-11** -- Detractor alert list (Satisfaction tab)
- **2026-05-11** -- Hide obsolete Feedback admin tab
- **2026-05-11** -- Fix mojibake in matching.py / helpers.py / auto_recruit.py
- **2026-05-11** -- Tighten encoding-check script (stop false-flagging legit unicode)
- **2026-05-11** -- Fix hardcoded `30` in match-gap alert; now reads `max_invites` from app_config
- **2026-05-11** -- Add `session_expectations` field to patient results page
- **2026-05-11** -- CLAUDE.md rule 5 updated: git from chat

## How to use this list

When starting a new session, point me at `docs/BACKLOG.md` and tell me
the priority. I'll work top-down from the section you name.
