# TheraVoca Backlog -- Post-MVP

Tracking work that's been scoped but deferred until after MVP launch.
Each item links back to the conversation that proposed it so the
context isn't lost.

## Outcomes Dashboard -- planned additions

These extend the Outcomes admin dashboard with higher-impact analytics.
Scoped on 2026-05-11 with Josh, deferred to post-launch.

### Recruiting tab

- **Therapist response speed** (~30 min) -- average hours from referral
  sent to therapist replies. Both an admin signal (slow therapists hurt
  patients) and a recruiting pitch ("our therapists respond in 4hr
  median").
- **Coverage gaps as recruiting heatmap** (~20 min) -- surface the
  existing CoverageGapPanel as "where we urgently need more therapists"
  inside the Recruiting tab so admin/biz dev knows who to chase.
- **Therapist activity rate** (~20 min) -- % of approved therapists
  actively responding to leads vs going dark. Reveals whether the
  roster is healthy or padded.

### Satisfaction tab

- **Best/worst therapists by retention leaderboard** (~30 min) -- rank
  therapists by % of their patients still in therapy at 15w. Reveals
  who to feature vs coach.
- **Sentiment themes from free-text comments** (~60 min) -- group
  patient/therapist free-text into themes ("loved them," "scheduling
  problems," "wrong fit") via Claude API. We currently show raw
  quotes; clustering them by theme reveals the pattern.

### Matching Algorithm tab

- **Which factors predict retention** (~45 min, needs more data) --
  break Match Strength into components (bond, tasks, goals, etc.) and
  show which correlate most with patients sticking around. Tunes the
  algorithm with evidence. Needs >=50 patients past 15w to be useful.
- **Failure mode analysis** (~30 min) -- for the patients who dropped
  (red dots on scatter), what do they have in common? Often reveals
  unstated filter bugs.
- **Match Strength -> NPS scatter** (~15 min) -- does a strong match
  also produce *happier* patients, not just longer-staying ones?
  Same scatter chart pattern, different Y axis.

## Known issues carried (not blocking)

- **Funnel cohort math** -- with the date filter, "matches sent" and
  "picked" are counted independently (different cohorts in the same
  number). Statistically a bit fuzzy. A "cohort starting in period"
  mode would be cleaner but requires per-patient journey tracking.

## How to use this list

When the next session starts, paste this file's path
(`docs/BACKLOG.md`) into the prompt and I'll prioritize from here.
