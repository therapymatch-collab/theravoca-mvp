# TheraVoca Deployment Guide

## Architecture

- **Frontend**: React (CRA + CRACO), built to static files during deploy
- **Backend**: Python 3.11 / FastAPI / Uvicorn, serves the React SPA from `backend/static_build/`
- **Database**: MongoDB Atlas (shared cluster)
- **Hosting**: Render (two services, one per branch)
- **DNS**: 1&1 IONOS (theravoca.com)

## Branch → Service Mapping

| Branch    | Render Service       | URL                                    |
|-----------|---------------------|----------------------------------------|
| `staging` | theravoca-staging   | https://theravoca-staging.onrender.com |
| `main`    | theravoca           | https://theravoca.com (after DNS)      |

Both services auto-deploy on push to their respective branches.

## Build Process

Render runs these steps on every deploy:

```bash
# 1. Install Python deps
pip install -r backend/requirements.txt

# 2. Build React frontend
cd frontend
npm install --legacy-peer-deps
REACT_APP_BACKEND_URL= CI=false npx craco build
cp -r build ../backend/static_build

# 3. Start server
cd backend
uvicorn _start:app --host 0.0.0.0 --port $PORT
```

Key notes:
- `REACT_APP_BACKEND_URL=` (empty) makes axios use relative paths — the SPA is served from the same origin as the API.
- `CI=false` prevents CRA from treating warnings as errors.
- `--legacy-peer-deps` is required because there's no package-lock.json.

## Required Environment Variables

These MUST be set or the app will crash / malfunction:

| Variable | Purpose | Crashes if missing? |
|----------|---------|-------------------|
| `MONGO_URL` | MongoDB Atlas connection string | Yes (import-time) |
| `DB_NAME` | Database name (e.g. `theravoca_staging`) | Yes (import-time) |
| `ADMIN_PASSWORD` | Admin dashboard login | Yes (startup) |
| `JWT_SECRET` | Signs all session tokens — must be stable across deploys | Yes in production, warns in dev |
| `RESEND_API_KEY` | Email delivery via Resend | No — emails silently fail |
| `SENDER_EMAIL` | From address for emails | No — defaults to Resend sandbox |
| `PUBLIC_APP_URL` | Base URL for email links (e.g. `https://theravoca.com`) | No — email links will be broken |
| `ANTHROPIC_API_KEY` | LLM calls (matching enrichment, gap analysis) | No — enrichment skipped |

### Optional but recommended:

| Variable | Purpose |
|----------|---------|
| `STAGING_PASSWORD` | Basic Auth on staging (blocks public access) |
| `STAGING_USER` | Basic Auth username (default: `admin`) |
| `CORS_ORIGINS` | Allowed origins (default: `*`) |
| `TWILIO_ACCOUNT_SID` | SMS notifications |
| `TWILIO_AUTH_TOKEN` | SMS notifications |
| `TWILIO_FROM_NUMBER` | SMS sender number |
| `TWILIO_ENABLED` | `true` to enable SMS (default: `false`) |
| `STRIPE_API_KEY` | Payment collection |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures |
| `REACT_APP_TURNSTILE_SITE_KEY` | Cloudflare Turnstile (bot defense) — baked into frontend at build time |
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile verification |
| `ENV` | `production`, `staging`, or `development` — controls startup checks |

## Recreating from Scratch

1. Create a new Web Service on Render
2. Connect to GitHub repo `therapymatch-collab/theravoca-mvp`
3. Set branch to `staging` or `main`
4. Runtime: Python
5. Build command: (see Build Process above)
6. Start command: `cd backend && uvicorn _start:app --host 0.0.0.0 --port $PORT`
7. Add all env vars from the table above
8. Set PYTHON_VERSION=3.11 and NODE_VERSION=20
9. Health check path: `/api/version`
10. Deploy

## CI / E2E Tests

GitHub Actions runs on push to `staging` and `main` (and PRs to `main`):
- Spins up MongoDB 7, builds frontend, starts backend
- Runs 4 Playwright E2E tests (patient intake, therapist signup, therapist apply/decline)
- Branch protection on `main` requires CI to pass before merge

## DNS (1&1 IONOS)

When ready to go live:
1. Add A record pointing `theravoca.com` to Render's IP
2. Add CNAME for `www.theravoca.com` → `theravoca.onrender.com`
3. Verify domain in Render dashboard
4. Update `PUBLIC_APP_URL` to `https://theravoca.com`
