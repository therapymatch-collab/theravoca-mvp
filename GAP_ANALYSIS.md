# TheraVoca Launch-Blocker Gap Analysis

**Date:** 2026-05-04
**Scope:** Everything between current staging state and first 1-2 beta therapists
**Sources:** Prior code audit (buckets 1-3 + PHI inventory), known bug list, fresh codebase scan

---

## SECURITY

1. **BLOCKER -- Unauthenticated Stripe/payment endpoints allow anyone to bypass billing.**
   Anyone with a therapist UUID can call `/therapists/{id}/sync-payment-method` with `session_id="demo_anything"` to skip Stripe entirely and get a valid JWT. Subscribe-checkout and portal-session are also wide open.
   `backend/routes/therapists.py` lines 212-319

2. **BLOCKER -- Unsigned email-link grace period lets anyone apply/decline on behalf of a therapist.**
   `_verify_action_signature()` passes requests through when no `sig` param is present ("Grace period -- remove after migration"). Anyone who knows a request_id + therapist_id can forge actions.
   `backend/routes/therapists.py` lines 62-71

3. **BLOCKER -- CORS defaults to wildcard origin with credentials.**
   If `CORS_ORIGINS` env var is unset, the middleware reflects any requesting origin with `allow_credentials=True`. Any website can make authenticated API calls on behalf of a logged-in user.
   `backend/server.py` lines 144-150

4. **BLOCKER -- Patient results endpoint returns full therapist documents.**
   `db.therapists.find_one({"id": ...}, {"_id": 0})` sends the ENTIRE therapist record to the patient -- including `stripe_customer_id`, `stripe_payment_method_id`, `phone_alert` (private SMS number), `license_document` (base64 of license scan), `verification_token`, all deep-match self-disclosures, and embedding vectors.
   `backend/routes/patients.py` line 647

5. **IMPORTANT -- No rate limiting on magic-code verification.**
   6-digit code = 900K possibilities. Magic code *generation* is rate-limited (5/hr) but verification attempts are unlimited. Brute-forceable.
   `backend/routes/portal.py` lines 168-194

6. **IMPORTANT -- No server-side token revocation or logout.**
   JWTs are stateless with a 30-day TTL. No revocation list, no logout endpoint. A stolen JWT stays valid for up to 30 days. `clearSession()` only removes the token from `sessionStorage` client-side.
   `backend/deps.py` line 62

7. **IMPORTANT -- License upload validated by client-supplied content_type only.**
   Base64 payload is size-checked but the actual file bytes are not inspected (no magic-byte validation). Content_type is trivially spoofable.
   `backend/routes/therapists.py` lines 623-689

8. **IMPORTANT -- Followup endpoints have no auth.**
   Anyone who knows a request UUID can read therapist application data (names, scores) via `GET /followup/{request_id}/{milestone}` and submit responses via POST.
   `backend/routes/patients.py` lines 503-552

9. **IMPORTANT -- Public request view leaks clinical metadata.**
   `GET /requests/{request_id}/public` returns presenting concerns, payment type, insurance carrier, urgency to any caller with the UUID. No auth.
   `backend/routes/patients.py` lines 476-500

10. **IMPORTANT -- Prefill endpoint enables email enumeration.**
    `GET /requests/prefill?email=...` returns prior referral source, ZIP, language, age group, gender preference, and request count for any email address. No auth.
    `backend/routes/patients.py` lines 117-156

11. **POST-LAUNCH -- 30-day session TTL is long for a healthcare app.**
    HIPAA-adjacent apps typically use 15-minute inactivity timeout / 8-12 hour max. Current: 30 days.
    `backend/deps.py` line 62

12. **POST-LAUNCH -- Admin login lockout is in-memory only.**
    `_login_attempts` dict resets on every deploy/restart. Not shared across dynos.
    `backend/deps.py` lines 70-98

13. **POST-LAUNCH -- Full Python traceback returned in simulator error responses.**
    Admin-only, but leaks internal paths and library versions.
    `backend/routes/admin.py` lines 3731-3735

14. **POST-LAUNCH -- python-jose 3.5.0 has known CVEs (unused but installed).**
    Code actually imports PyJWT, not python-jose. Supply-chain hygiene issue.
    `backend/requirements.txt` line 92

15. **POST-LAUNCH -- Feedback widget claims Turnstile protection but has none.**
    No Turnstile verification call in the implementation despite docstring claim.
    `backend/routes/feedback.py` lines 472-510

---

## COMPLIANCE (HIPAA / PHI)

16. **BLOCKER -- PHI logged in plaintext across 14+ locations.**
    Patient emails, therapist emails, phone numbers, and names appear in application logs via `logger.info/warning`. Render logs are stored unencrypted and accessible to anyone with dashboard access.
    `backend/email_service.py` :82,:92 | `backend/cron.py` :126,:214,:221 | `backend/routes/patients.py` :700,:753 | `backend/routes/therapists.py` :187 | `backend/outreach_agent.py` :453,:465,:566-574 | `backend/sms_service.py` :87 | `backend/routes/portal.py` :148

17. **BLOCKER -- No PHI access audit trail.**
    Zero logging of who accessed what patient record, when, or why. HIPAA requires audit controls (45 CFR 164.312(b)).
    No files -- this doesn't exist.

18. **BLOCKER -- Consent checkbox state never persisted to backend.**
    The `agreed` state in IntakeForm is React component state only -- never sent to the server. There is zero proof that any patient agreed to terms/privacy before submitting PHI.
    `frontend/src/components/IntakeForm.jsx` line 66

19. **BLOCKER -- No HIPAA Notice of Privacy Practices.**
    The privacy notice page doesn't mention HIPAA. No HIPAA authorization form. No disclosure that clinical data is shared (anonymized) with multiple therapists or processed by LLMs.
    `frontend/src/pages/PrivacyNotice.jsx`

20. **IMPORTANT -- No BAAs documented or verified.**
    Services touching PHI that need BAAs: MongoDB Atlas, Resend (email), Twilio (SMS), Render (hosting/logs), Anthropic/OpenAI/Google (LLM APIs processing clinical data), Stripe. No documentation of which BAAs are in place.
    Operational -- no code file.

21. **IMPORTANT -- No patient data deletion mechanism.**
    Privacy notice says to contact `privacy@theravoca.com` but no backend endpoint exists to fulfill deletion requests. No data export endpoint. No retention policy (data lives forever).
    `frontend/src/pages/PrivacyNotice.jsx` lines 186-193

22. **IMPORTANT -- Therapist view leaks patient phone + view_token.**
    `db.requests.find_one({"id": request_id}, {"_id": 0, "email": 0, "verification_token": 0})` excludes email but returns phone, location details, all clinical data, and the view_token.
    `backend/routes/therapists.py` lines 424-425

23. **IMPORTANT -- No consent for LLM processing of clinical data.**
    Patient presenting issues, therapy history, and deep-match answers are sent to Anthropic/OpenAI/Google for embeddings and scoring. No disclosure anywhere.
    Design gap -- affects `backend/embeddings.py`, `backend/llm_client.py`

24. **POST-LAUNCH -- Partial email address leaked to therapists.**
    `patient_email_anon` returns `email[:3] + "***"` -- first 3 characters of the email, combinable with state/city/age for re-identification.
    `backend/routes/therapists.py` line 613

25. **POST-LAUNCH -- No application-level encryption of PHI fields in MongoDB.**
    All PHI stored as plaintext. Atlas provides at-rest encryption, but no field-level encryption for sensitive fields like presenting_issues, insurance_name, phone.
    Design gap -- `backend/models.py`

---

## FUNCTIONAL BUGS

26. **BLOCKER -- Missing `RESEND_API_KEY` silently breaks the entire intake flow.**
    Without it, verification emails are never sent. Patients submit PHI, get no verification email, and their intake is stuck forever. No error shown to the user.
    `backend/email_service.py` lines 80-83

27. **BLOCKER -- Missing `PUBLIC_APP_URL` produces broken email links.**
    Verification and results links become `/requests/verify/{token}` with no domain. Clicking them goes nowhere. All email-dependent flows are dead.
    `backend/email_service.py` :41 | `backend/helpers.py` :534 | `backend/cron.py` :206

28. **BLOCKER -- Referral source dropdown empty = form impossible to submit.**
    If `/config/referral-source-options` fails (silently caught with `.catch(() => setReferralSourceOptions([]))`), the referral source dropdown is empty. Since `referral_source` is required by `canNext()`, the Submit button stays disabled forever with no error explanation.
    `frontend/src/components/IntakeForm.jsx` line 259

29. **IMPORTANT -- Zero-match scenario sends "Your matches are ready" email with no matches.**
    If no therapists pass hard filters (or none exist in DB), matching still sets status to "matched" and sends the results email. Patient opens it and sees zero therapists.
    `backend/helpers.py` -- `_trigger_matching` + `_deliver_results`

30. **IMPORTANT -- Server-side model accepts arbitrary strings for enum fields.**
    `client_type`, `payment_type`, `urgency`, `modality_preference`, `prior_therapy` all accept any string (no `Literal` constraint). Invalid values like `client_type: "hacked"` pass validation and silently break matching logic.
    `backend/models.py` lines 126-223

31. **IMPORTANT -- `age_groups` max_length=3 but UI allows selecting 5.**
    TherapistSignup model caps `age_groups` at 3 items, but the frontend allows selecting all 5 (child, teen, young_adult, adult, older_adult). Therapist gets a 422 on submit.
    `backend/models.py` (TherapistSignup) + therapist signup UI

32. **IMPORTANT -- Verification email send failure crashes intake submission.**
    `send_verification_email()` is NOT wrapped in try/except. A Resend network timeout produces a 500. Patient data is already in the DB (inserted at line 361), so a retry hits the rate limit.
    `backend/routes/patients.py` line 434

33. **IMPORTANT -- `p3_resonance` backend caps at 2000 chars but frontend has no maxLength.**
    Patient types 10K characters, gets a 422 on submit with no explanation.
    `frontend/src/components/intake/steps/` (resonance textarea) + `backend/models.py`

34. **POST-LAUNCH -- 12 silent-error-swallowing patterns across the frontend.**
    `.catch(() => setX([]))` or `.catch(() => {})` in IntakeForm, BlogList, SignIn, TherapistPortal (x2), VerifyEmail, NetworkHealthPanel, OutcomeTrackingPanel, ContactStep, useFaqs, VideoTestimonials, FeedbackSurvey.
    Multiple frontend files (see detailed scan)

35. **POST-LAUNCH -- PatientPortal infinite spinner on 500 error.**
    Non-401 errors from `GET /portal/patient/requests` leave `requests === null` forever, showing an infinite loading spinner.
    `frontend/src/pages/PatientPortal.jsx` lines 62-67

36. **POST-LAUNCH -- Email sending has no retry mechanism.**
    Transient Resend API failures mean the email is lost permanently. No queue, no retry.
    `backend/email_service.py`

37. **POST-LAUNCH -- Missing useEffect cleanup in FollowupForm and TherapistApply.**
    No abort controller or `active` flag -- state updates fire on unmounted components.
    `frontend/src/pages/FollowupForm.jsx` :43-60 | `frontend/src/pages/TherapistApply.jsx` :80-98

---

## UX

38. **IMPORTANT -- No phone format/length validation.**
    Patient can enter "1" as a phone number and submit. No client-side or server-side format check.
    `frontend/src/components/intake/steps/ContactStep.jsx` + `backend/models.py` (`phone: Optional[str] = ""`)

39. **IMPORTANT -- Missing aria-labels on dozens of interactive elements.**
    Pill buttons, toggle buttons, and select triggers across IntakeForm, FollowupForm, FeedbackSurvey, and TherapistApply lack `aria-label`. Screen readers announce generic "button."
    Multiple frontend files

40. **POST-LAUNCH -- No visible keyboard focus rings.**
    `tv-btn-primary` and similar classes use `transition` but no `focus:ring` or `focus-visible:ring`. Keyboard users can't see which element is focused.
    Frontend CSS / Tailwind classes

41. **POST-LAUNCH -- No skip-to-content link.**
    `App.js` wraps everything in `<div className="App">` with no skip-nav for keyboard users.
    `frontend/src/App.js`

42. **POST-LAUNCH -- Error text color fails WCAG AA contrast.**
    `#D45D5D` on white at `text-xs` size = ~3.5:1 ratio (AA requires 4.5:1 for small text).
    Frontend CSS

43. **POST-LAUNCH -- Deep-match badge shown even when no deep-match signal exists.**
    If a therapist hasn't answered T1-T5, deep-match axes score 0 but the UI still shows "Deep match" badge. Results look identical to standard matching.
    Frontend results display + `backend/matching.py`

---

## OPERATIONAL

44. **BLOCKER -- Auto-seed injects 100 fake therapists if production collection empties.**
    `generate_seed_therapists(100)` runs when `therapists.count_documents({}) == 0`. No `ENV != "production"` guard. An accidental wipe + restart would populate production with 100 synthetic Idaho therapists.
    `backend/server.py` lines 55-59 | `backend/seed_data.py`

45. **BLOCKER -- No error tracking or alerting in production.**
    No Sentry, no Datadog, no UptimeRobot. If the app throws 500s or crashes, nobody is notified. For a healthcare app serving real patients, you're flying blind.
    No files -- this doesn't exist.

46. **IMPORTANT -- No lockfile = non-deterministic frontend builds.**
    `package.json` uses `^` caret ranges for all deps. No `package-lock.json` or `yarn.lock`. A dependency update on npm could break a build without any code change. `packageManager` field references yarn but npm is actually used.
    `frontend/package.json`

47. **IMPORTANT -- 12+ env vars undocumented in DEPLOYMENT.md.**
    `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `EMAIL_OVERRIDE_TO`, `OUTREACH_AUTO_RUN`, `PT_SCRAPING_ENABLED`, `TWILIO_DEV_OVERRIDE_TO`, `SIGNED_URL_TTL_HOURS`, `SWEEP_INTERVAL_SECONDS`, `PROFILE_STALE_DAYS`, and more are used in code but not documented.
    `backend/DEPLOYMENT.md` vs. actual code usage

48. **IMPORTANT -- No documented backup strategy.**
    No automated backups configured. Relying entirely on MongoDB Atlas defaults (unknown tier/schedule). No documentation of what's backed up or how to restore.
    Operational -- no code file.

49. **IMPORTANT -- No rollback procedure documented.**
    Render supports deploy rollback via dashboard, but this is not documented anywhere. No versioning beyond git commit hash in `/api/version`.
    Operational -- no code file.

50. **POST-LAUNCH -- README.md is a placeholder.**
    Contains `# Here are your Instructions` with no actual content. No local dev setup instructions.
    `README.md`

51. **POST-LAUNCH -- Dev dependencies in production requirements.txt.**
    black, flake8, mypy, pytest, isort are installed on every Render deploy -- adds ~30s build time and unnecessary attack surface.
    `backend/requirements.txt`

52. **POST-LAUNCH -- `.gitignore` has corrupted lines from script injection.**
    Multiple `-e` lines and duplicate blocks. Cosmetic but sloppy.
    `.gitignore`

53. **POST-LAUNCH -- `anthropic>=0.39.0` is the only unpinned Python dependency.**
    Could auto-upgrade and break on next deploy.
    `backend/requirements.txt`

---

## SUMMARY

| Rating | Count |
|--------|-------|
| BLOCKER | 12 |
| IMPORTANT | 18 |
| POST-LAUNCH | 23 |

**The 12 blockers, in recommended fix order:**

1. CORS wildcard default (#3) -- one env var fix
2. Auto-seed guard for production (#44) -- 2-line code change
3. Error tracking setup (#45) -- Sentry free tier, ~30 min
4. Unauthenticated Stripe endpoints (#1) -- add auth middleware
5. Unsigned email-link grace period (#2) -- remove grace period
6. Patient results leaking full therapist docs (#4) -- add field projection
7. PHI in logs (#16) -- replace emails/phones with IDs in all log statements
8. Consent state not persisted (#18) -- send `agreed` flag with intake submission
9. No PHI audit trail (#17) -- add access logging middleware
10. HIPAA Notice of Privacy Practices (#19) -- legal/copy work
11. Missing `RESEND_API_KEY` / `PUBLIC_APP_URL` silent failures (#26, #27) -- startup validation
12. Referral source dropdown empty = stuck form (#28) -- error state + retry
