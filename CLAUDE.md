# TheraVoca -- Claude Working Notes

These rules govern all code changes. No exceptions.

## Per-Change Workflow (strict rules)

1. **Scope**: Josh tells you exactly what to fix. If the request is vague, ask
   for clarification before making changes. Never assume scope.

2. **Tools**: Always use Edit/Write/Read tools for file modifications. Never use
   bash to write file contents -- encoding gets corrupted via the Linux mount.
   Bash is only for running commands (git, tests, grep, python scripts that
   READ files).

3. **Show diff first**: After editing, show Josh the diff or the changed lines
   BEFORE he commits. Don't say "done" until he has reviewed.

4. **No batching**: One logical change per commit. If you notice another issue
   while fixing the requested one, mention it and add it to a list -- don't fix
   it in the same commit.

5. **Git from chat**: Josh does not use PowerShell. Run `git add`, `git
   commit`, `git push`, `git merge`, and `git checkout` yourself via the
   Bash tool. Confirm with Josh in chat before any action that affects the
   live staging site (push to `staging`, merge into `staging`, anything
   that triggers a Render deploy). Never use `--no-verify`, `--force`, or
   `reset --hard` without an explicit ask. For feature-branch work (no
   live impact), just do it and report what happened.

6. **No marking "done"**: Never say "fixed" or "completed" until Josh has
   verified the change is live on the deployed staging site
   (theravoca-production.onrender.com). Until then, the correct phrase is
   "ready to commit and verify."

7. **Honesty about uncertainty**: If you're not sure whether a change worked,
   say so. If you didn't actually run a command, don't claim you did. If you
   make a mistake, name it directly -- don't hedge.

8. **ASCII in comments**: Use `--` not em-dash, `<=` not less-than-or-equal
   symbol, `->` not arrow symbol in code comments. Unicode is fine in
   user-facing strings only.

9. **Search before adding**: Before creating new components, utilities, or
   constants, search the codebase to see if something similar already exists.
   Don't create duplicates.

10. **CI failures are signal**: If the encoding check or E2E tests fail after a
    push, treat that as feedback that something is wrong. Don't push past
    failures.

---

## Debugging Rules

- **2-strike rule**: If the same fix category fails twice (e.g. trying different
  selectors, tweaking the same config), STOP. Step back and find the root cause,
  not another variation of the symptom. Trace the data flow end-to-end before
  writing another fix.
- Before fixing a UI interaction failure, verify the data pipeline first: Does
  the API call succeed? Is the env var set? Is the component receiving data? A
  missing dropdown option is not a selector problem -- it is a data problem.
- Add diagnostics before guessing. One CI run with `console.log` or
  `page.content()` output is worth more than three blind fix attempts.

## Project-specific notes

### Architecture

- **Frontend**: React (CRA + CRACO), served as static build from backend. No
  package-lock.json -- always use `npm install --legacy-peer-deps`.
- **Backend**: Python/FastAPI (uvicorn), serves React SPA from
  `backend/static_build/`.
- **Database**: MongoDB (Atlas in prod/staging, local in CI).
- **Hosting**: Render (separate staging + production services).
- **Repo**: `therapymatch-collab/theravoca-mvp`, branches: `main` (prod),
  `staging`.

### Environment URLs

- Staging service URL: https://theravoca-production.onrender.com (despite
  name, this IS staging -- only env)
- GitHub: `therapymatch-collab/theravoca-mvp`, branch `staging` is source of
  truth
- `main` branch unused -- no production env exists yet

### CI / E2E Tests

- GitHub Actions workflows: `.github/workflows/e2e-tests.yml` and
  `.github/workflows/encoding-check.yml`
- `REACT_APP_BACKEND_URL` must be set at frontend build time -- CRA bakes env
  vars into the bundle. Without it, axios baseURL becomes `"undefined/api"` and
  all API calls silently fail.
- Turnstile CAPTCHA is disabled in CI by not setting
  `REACT_APP_TURNSTILE_SITE_KEY`.
- Referral source options are admin-managed (stored in `app_config` collection).
  Must be seeded in test `beforeAll` or the dropdown will be empty.
- Radix UI Select portals dropdown content to `document.body` -- use `waitFor`
  after clicking the trigger to let the portal render.

### Test commands

- Backend: from `/backend`, `pytest`
- Frontend: from `/frontend`, `npm test`
- E2E: `cd e2e && npx playwright test`

### Key Gotchas

- `canNext()` in IntakeForm.jsx validates each step -- if submit button is
  disabled, check which validation condition is failing, don't just retry the
  click.
- Frontend `api.js` has no fallback for missing `REACT_APP_BACKEND_URL` -- it
  will silently produce broken URLs.
- `.catch(() => setX([]))` patterns in the frontend swallow API errors silently
  -- if data is missing, check network calls first.

### Do not touch

- `/scripts` directory (historical backfill scripts; keep for forensics)
- `backend/audit.py` (production audit log; never modify)
- `/alembic` and any migration files (fragile; let Josh handle)
