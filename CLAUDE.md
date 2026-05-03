# TheraVoca — Claude Working Notes

## Debugging Rules

- **2-strike rule**: If the same fix category fails twice (e.g. trying different selectors, tweaking the same config), STOP. Step back and find the root cause, not another variation of the symptom. Trace the data flow end-to-end before writing another fix.
- Before fixing a UI interaction failure, verify the data pipeline first: Does the API call succeed? Is the env var set? Is the component receiving data? A missing dropdown option is not a selector problem — it's a data problem.
- Add diagnostics before guessing. One CI run with `console.log` or `page.content()` output is worth more than three blind fix attempts.

## Project Architecture

- **Frontend**: React (CRA + CRACO), served as static build from backend. No package-lock.json — always use `npm install --legacy-peer-deps`.
- **Backend**: Python/FastAPI (uvicorn), serves React SPA from `backend/static_build/`.
- **Database**: MongoDB (Atlas in prod/staging, local in CI).
- **Hosting**: Render (separate staging + production services).
- **Repo**: `therapymatch-collab/theravoca-mvp`, branches: `main` (prod), `staging`.

## CI / E2E Tests

- GitHub Actions workflow: `.github/workflows/e2e-tests.yml`
- `REACT_APP_BACKEND_URL` must be set at frontend build time — CRA bakes env vars into the bundle. Without it, axios baseURL becomes `"undefined/api"` and all API calls silently fail.
- Turnstile CAPTCHA is disabled in CI by not setting `REACT_APP_TURNSTILE_SITE_KEY`.
- Referral source options are admin-managed (stored in `app_config` collection). Must be seeded in test `beforeAll` or the dropdown will be empty.
- Radix UI Select portals dropdown content to `document.body` — use `waitFor` after clicking the trigger to let the portal render.

## Key Gotchas

- `canNext()` in IntakeForm.jsx validates each step — if submit button is disabled, check which validation condition is failing, don't just retry the click.
- Frontend `api.js` has no fallback for missing `REACT_APP_BACKEND_URL` — it will silently produce broken URLs.
- `.catch(() => setX([]))` patterns in the frontend swallow API errors silently — if data is missing, check network calls first.
