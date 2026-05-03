# TheraVoca Development Workflow

These rules govern all code changes to this repository. No exceptions.

## 1. Staging first, always

All changes go to the `staging` branch first. Never commit directly to `main`. The `main` branch is production-only and only receives code via merge from `staging` after verification.

## 2. Deploy and verify on staging

Every push to `staging` triggers a deploy to the staging URL (`https://theravoca-production.onrender.com`). After deploy completes, verify the change works by checking the site and hitting `/api/version` to confirm the correct commit is live.

## 3. Merge to main only after confirmation

Only after Josh explicitly confirms a change works on staging do we merge `staging` into `main`. No silent promotions. No "it should be fine" merges.

## 4. Clear commit messages

Every commit message clearly describes what changed in plain English. Bad: "fix stuff", "updates", "wip". Good: "fix patient intake severity not persisting to database", "add /api/version endpoint for build verification".

## 5. One logical change per commit

Each commit contains exactly one logical change. Don't batch unrelated fixes into a single commit. If you're fixing a bug and also reformatting a file, that's two commits. This makes rollbacks safe and history readable.

## 6. Discuss before refactoring

Before any multi-file refactor, architectural change, or large-scale modification, we discuss the plan first. No surprise rewrites. Lay out what files change, why, and what could break. Get approval before writing code.

---

## Quick reference

| Action | Command |
|---|---|
| Check what's deployed | `curl https://theravoca-production.onrender.com/api/version` |
| Switch to staging | `git checkout staging` |
| Push to staging | `git push origin staging` |
| Merge staging → main | `git checkout main && git merge staging && git push origin main` |

## Branch layout

```
main (production — theravoca-mvp.onrender.com)
  └── staging (pre-production — theravoca-production.onrender.com)
```

Last updated: 2026-05-03
