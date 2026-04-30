# TheraVoca DB exports

Snapshot of the Emergent preview MongoDB on `2026-04-30`, exported via
`/api/admin/therapists/export` + a one-shot script over every other
collection in the `test_database`.

## What's safe to push to a public GitHub repo

The following files contain only configuration, marketing copy, and
seed reference data — no PII, no secrets, no credentials:

| File | Docs | Description |
|---|---:|---|
| `therapists_export_20260430T223740Z.json` | 122 | The canonical seed therapist directory (incl. backfilled bios + T2/T5 embeddings) |
| `site_copy_export.json` | 15 | Landing/marketing copy edits |
| `faqs_export.json` | 11 | Patient + therapist FAQs |
| `email_templates_export.json` | 4 | Editable email templates |
| `app_config_export.json` | 8 | Rate limits, scrape sources, Turnstile settings |
| `auto_recruit_config_export.json` | 1 | Auto-recruit dry-run policy |
| `app_settings_export.json` | 1 | Misc admin settings |
| `blog_posts_export.json` | 1 | Marketing blog content |
| `geocache_export.json` | 9 | Cached lat/lng for Idaho cities |

## What's gitignored (never committed)

Files with PII, bcrypt password hashes, active auth tokens, or anything
covered under HIPAA-adjacent data handling — see `.gitignore`:

- `admin_users_export.json` — bcrypt hashes for team admin accounts
- `patient_accounts_export.json` — bcrypt hashes for patient accounts
- `magic_codes_export.json` — active short-lived auth tokens
- `password_login_attempts_export.json` — security audit log
- `requests_export.json` — patient PII (name, email, phone, location, presenting issues)
- `applications_export.json` — therapist↔patient routing data
- `outreach_invites_export.json` — patient↔therapist routing
- `outreach_opt_outs_export.json` — therapist personal data
- `recruit_drafts_export.json` — LLM-drafted outreach (may contain therapist names + emails)
- `intake_ip_log_export.json` — IP addresses of patient submissions
- `feedback_export.json` — patient feedback
- `declines_export.json` — anonymized therapist decline records
- `simulator_runs_export.json`, `simulator_requests_export.json` — synthetic test data
- `auto_recruit_cycles_export.json` — operational logs
- `cron_runs_export.json` — operational logs

These files exist on local disk after running the export script, but
they're NEVER pushed to GitHub. If you need to migrate them between
environments, transfer them out-of-band (encrypted ZIP attached to
email, signed S3 URL, etc.).

## Restoring exports into MongoDB Atlas

Each JSON file is a single array of documents, ready for `mongoimport`.
Run from a machine with the MongoDB tools installed:

```bash
ATLAS_URI="mongodb+srv://USER:PWD@cluster.mongodb.net/theravoca?retryWrites=true&w=majority"

# Restore the seed therapist directory (the big one — 122 docs, 10MB)
mongoimport --uri "$ATLAS_URI" \
            --collection therapists \
            --file therapists_export_20260430T223740Z.json \
            --jsonArray

# Restore each other collection
for f in site_copy faqs email_templates app_config auto_recruit_config \
         app_settings blog_posts geocache; do
  mongoimport --uri "$ATLAS_URI" \
              --collection "$f" \
              --file "${f}_export.json" \
              --jsonArray
done
```

`mongoimport` ships with the **MongoDB Database Tools** package — install
via `brew install mongodb-database-tools` (macOS), `apt install mongodb-database-tools`
(Debian/Ubuntu), or download from
<https://www.mongodb.com/try/download/database-tools>.

## Re-creating admin users on Atlas (post-restore)

Since `admin_users_export.json` is gitignored and won't be in the repo,
you need to re-create your team admin accounts on the new Atlas DB:

1. Set `ADMIN_PASSWORD` in your Render env to your master password
2. Log in to `/admin` using the **Master password** tab
3. Open the **Team** panel and create each team admin account with
   `POST /api/admin/team` (the panel does this for you).

Or, transfer `admin_users_export.json` out-of-band, then:

```bash
mongoimport --uri "$ATLAS_URI" \
            --collection admin_users \
            --file admin_users_export.json \
            --jsonArray
```

## Re-running the export

```bash
# Therapists (via authed admin endpoint, named with timestamp)
curl -O -J -H "X-Admin-Password: $ADMIN_PWD" \
     "${BACKEND_URL}/api/admin/therapists/export"

# All other collections (one-shot script — see chat history for the
# full Python snippet that walks list_collection_names() and dumps each
# to /app/exports/<name>_export.json)
```
