# Render Deploy Notifications -- Setup Runbook

**Owner:** Josh
**Date:** 2026-05-13
**Why:** BACKLOG #24 -- without this, a failed deploy goes silent and
the only way you'd find out is from a user reporting a broken site
(or worse, you wouldn't notice until you next looked at staging).

This is a dashboard config change in Render, **not a code change** --
that's why there's nothing to push for it. Five minutes of clicking.

---

## Option A -- Render's built-in email notifications (simplest)

Render has a notifications setting that emails on deploy success
and/or failure. Free on every plan.

1. Log into [dashboard.render.com](https://dashboard.render.com)
2. Click **Account Settings** (avatar top-right -> Account Settings)
3. Click **Notifications** in the left sidebar
4. Enable:
   - [x] **Deploy failed** -- email me when a deploy fails
   - [x] **Service unhealthy** -- email me when a service goes down
   - [ ] Deploy succeeded -- optional (gets noisy; recommend off unless
         you actively want a per-deploy confirmation)
5. Confirm the recipient email is one you actually check
6. Save

That's the whole thing. Render will send a short email when any
service's deploy fails or it goes unhealthy.

---

## Option B -- Slack webhook (if you prefer Slack)

If you'd rather have a dedicated #deploys Slack channel:

1. In Slack: create a channel (e.g. `#deploys`)
2. Add the **Incoming Webhooks** app to the channel, grab the webhook URL
3. In Render: **Account Settings -> Notifications -> Slack webhook**
4. Paste the URL, pick which events to forward, save

---

## Option C -- Render's "Deploy Hook" -> custom endpoint (advanced)

If you ever want deploys to trigger something on TheraVoca itself
(e.g. clear a cache, post-deploy smoke test), Render supports a
post-deploy webhook to any URL. Skip until you need it.

---

## What to expect

- Failed deploys will email within ~30 seconds of Render giving up.
- "Service unhealthy" fires when the service has been crashing /
  failing health checks for ~5 minutes.
- The notification includes the commit hash + service name. Click
  through to Render's logs.

---

## Verification

Once you've set it up, force a known-bad deploy to confirm notifications
work. Cheapest test:

1. Locally introduce a syntax error in `backend/server.py` (just for
   verification -- you'll revert)
2. Commit + push to staging
3. Watch your inbox -- you should get the deploy-failed email within
   ~2-5 minutes
4. Revert, push again, get the "deploy succeeded" email (if you enabled
   that) or just verify the bad email arrived

---

## Companion alert: cron health (already wired, 2026-05-13)

Cron crashes go silent because they're not deploys -- Render
notifications won't catch them. The companion alert lives in the app:

- `_run_cron_health_alert()` runs daily in the cron loop
- Detects: stuck jobs (started >24h ago, never completed), failed runs
  in the last 7 days, jobs whose last successful completion is >36h ago
- Emails `ADMIN_NOTIFY_EMAIL` (env var) at most once per 24h
- Health endpoint also lives at `/admin/cron/health` for manual checks

Between the two: Render notifies on deploy/service failure; the app
notifies on cron-job failure. That covers the main "you find out from
users" gap from BACKLOG #24 + #25.
