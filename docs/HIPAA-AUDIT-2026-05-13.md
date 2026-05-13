# TheraVoca HIPAA Audit & Compliance Plan

**Date:** 2026-05-13
**Scope:** End-to-end PHI flow audit + vendor BAA matrix + hosting decision + go-live plan

---

## TL;DR

Three blockers between today and a HIPAA-compliant launch:

1. **Email content (Resend)** — outreach/results/intake-receipt emails carry full patient clinical summaries. **Need Resend BAA + reduce what we send in-band.**
2. **Hosting (Render)** — Render does NOT offer a BAA on any tier. Patient data in transit through Render = compliance gap. **Need to either (a) move hosting to a HIPAA-eligible provider OR (b) escalate Render Enterprise quote.**
3. **Vendor BAAs not signed** — Resend, Twilio, Mongo Atlas, Anthropic. None signed yet. **All paperwork, no engineering.**

Two genuine wins to call out — these are already compliant by design:
- **LLM calls (Anthropic)** — every prompt is sanitized through `_sanitize_prompt()` (emails/phones/ZIPs redacted before send) and patient emails are HMAC-hashed before reaching the model in `master_query`. ✅
- **Audit logs** — patient identifiers are HMAC-hashed (never raw) with 7-year TTL. ✅

The remaining items are mostly vendor paperwork + 1-2 weeks of hosting work + ~1 week of email content trimming.

---

## 1. PHI Flow Audit

What "PHI" means in this app: patient email, name (where collected), age, location (state + zip + city), presenting issues, urgency, payment/insurance info, modality + gender + style preferences, free-text "anything else", prior therapy notes, request IDs paired with any of the above, match scores + breakdowns paired with patient identity, survey responses, feedback content.

| Boundary | Status | What flows | Files |
|---|---|---|---|
| **Email (Resend)** | 🔴 **Significant PHI** | Therapist notification: full patient `summary` dict (match_breakdown, score, request_id, often presenting issues + age + location through summary text). Patient results: top-3 match reasons derived from patient's presenting issues. Intake receipt: complete intake answers including free-text "anything else". | `backend/email_service.py:244-543` |
| **SMS (Twilio)** | 🟡 Minimal | Therapist referral SMS includes `{match_score}` (number only) + signed apply URL token. Magic-code SMS is just the code. No clinical content. | `backend/sms_service.py:145-177` |
| **LLM (Anthropic)** | ✅ **Sanitized** | Every prompt + system message passes through `_sanitize_prompt()` which redacts emails → `[REDACTED_EMAIL]`, phones → `[REDACTED_PHONE]`, 5-digit ZIPs → `[REDACTED_ZIP]`. `master_query.py` HMAC-hashes patient emails before mentioning them to the LLM. | `backend/llm_client.py:54-69`, `backend/routes/master_query.py:28-42`, `backend/research_enrichment.py` |
| **MongoDB Atlas** | ✅ Internal + TLS | Prod refuses to start unless MONGO_URL has `mongodb+srv://` or `tls=true`. Database is private; only the FastAPI backend talks to it. **Atlas BAA still required** — see vendor matrix. | `backend/deps.py:29-41` |
| **Audit logs** | ✅ Hashed | Patient emails → HMAC(JWT_SECRET, email)[:32] before logging. Resources are UUIDs. 7-year TTL index for HIPAA 6-year retention + 1-year buffer. | `backend/audit.py:32-43` |
| **Stripe** | ✅ Billing only | Therapist `customer_email`, `therapist_name`, `therapist_id` UUID in checkout metadata. No patient data. | `backend/stripe_service.py`, `backend/routes/stripe_webhook.py` |
| **Exports** | 🟡 Therapist plaintext | `/exports/therapists_export_*.json` contains real_email, phone, addresses. **No patient exports found.** Make sure `/exports/` is gitignored and not synced to S3/Dropbox/etc. | `/exports/` directory |
| **PostHog (frontend)** | 🟡 **High risk if identified** | Active in `frontend/build/index.html`. `person_profiles: "identified_only"` (good — anonymous unless we call `posthog.identify()`). **Session recording is ON** (`recordCrossOriginIframes:true`) — could capture form data. No `posthog.identify()` calls found in source today. | `frontend/build/index.html` |
| **Other 3rd party JS** | ✅ Clean | No Google Analytics / Sentry / Segment / Amplitude / Intercom found. Only Google Fonts (no analytics in font CDN). | n/a |

### Most-cited finding from the audit

**The therapist notification email + patient results email + intake receipt email all carry full patient clinical summaries through Resend's pipeline.** This is the single biggest in-band PHI exposure. Two ways to fix:

- **Easier**: sign a Resend BAA (Resend supports HIPAA on paid plans). No code change.
- **Harder but better**: trim email content to "you have a new referral, click to view" + secure portal link. Even with BAA, principle-of-least-disclosure is best practice and reduces blast radius if Resend ever has a breach.

---

## 2. Vendor BAA Matrix

| Vendor | BAA available? | Tier required | Cost impact | Action |
|---|---|---|---|---|
| **Resend** | Yes | Pro plan or higher (verify with sales for current minimum) | ~$20/mo Pro, possibly Enterprise for BAA | Email sales → request BAA |
| **Twilio** | Yes | Any paid account | No additional cost (paperwork only) | Open Twilio support → request HIPAA addendum |
| **Anthropic** | Yes | Two paths — direct API contract (Enterprise sales) OR via AWS Bedrock (covered under AWS BAA) | Direct: variable. Bedrock: AWS pricing, comparable to direct API | Decision: direct API or migrate LLM calls to Bedrock |
| **MongoDB Atlas** | Yes | M10 Dedicated cluster or higher with private endpoint | M10 ≈ $60/mo + private endpoint cost | Upgrade from current tier if not already there; sign BAA |
| **Render** | **NO** (as of 2026-05) | n/a | n/a | **Migrate hosting** (see §3) |
| **Stripe** | Stripe doesn't typically need a BAA for payment data — but if you ever add patient names/treatment to metadata, you would. Currently fine. | n/a | n/a | Verify status when you add features that touch Stripe |
| **PostHog** | Yes (PostHog Cloud + HIPAA addendum on enterprise) | Pricey for early-stage | Significant | **Recommended: disable PostHog session recording on patient pages** until volume justifies enterprise contract |

**Important caveats:** Vendor BAA terms + tiers change frequently. Verify each by emailing sales and asking explicitly: "Do you offer a Business Associate Agreement for HIPAA covered entities? On which plan? At what cost?" Save the email thread.

---

## 3. Hosting Decision

### The blocker

Render's Standard / Pro / Team plans do not include a BAA. Render Enterprise terms exist but require a sales conversation; pricing is not public. Several other PaaS providers in the same category (Fly.io, Railway, DigitalOcean App Platform) also don't offer BAAs.

### Options

| Option | Effort | Monthly cost (low scale) | Pros | Cons |
|---|---|---|---|---|
| **A. Migrate to AWS (ECS Fargate or EC2 + RDS/DocumentDB)** | 2-4 wks engineering | $200-500 | Industry standard for HIPAA. AWS BAA covers all eligible services. Easy to add Bedrock for Anthropic later. | Steepest learning curve. Need infrastructure-as-code or someone who knows AWS. |
| **B. Migrate to Google Cloud (Cloud Run + Cloud SQL or Mongo Atlas via private)** | 2-4 wks | $150-400 | Cloud Run feels like Render. GCP BAA covers eligible services. | Smaller HIPAA ecosystem than AWS. |
| **C. Negotiate Render Enterprise BAA** | Sales call + paperwork | Unknown — likely $$$$ | Zero engineering work. Stay on familiar platform. | Cost unpredictable; no public pricing; smaller company → less mature HIPAA story. |
| **D. Stay on Render, defer launch** | 0 wks | $0 | Cheapest now. | Can't legally serve real patients until resolved. |

### Recommendation

**Option A (AWS) for a HIPAA-serious launch.** Sequence:
1. Move backend container to ECS Fargate (FastAPI runs unchanged in Docker)
2. Move DB to Atlas M10+ with private endpoint (Atlas BAA covers it; no need to switch to RDS)
3. Move LLM calls to Bedrock OR keep direct Anthropic API + sign Anthropic BAA
4. Email + SMS providers stay (Resend / Twilio) once BAAs signed
5. Decommission Render

If you want to keep operations simple with one vendor for hosting + BAA paperwork, Option A is the well-trodden path. Most healthcare startups land here.

**Option C (Render Enterprise) only if you can get a BAA quote within budget and want zero migration risk.** Worth a single sales call to find out.

---

## 4. Concrete Action Plan

Ordered by dependency, with rough effort.

### Phase 1 — Vendor paperwork (parallel, no code work)
- [ ] Email Resend sales: request BAA quote + plan minimum (~30 min)
- [ ] Open Twilio support ticket: request HIPAA addendum (~30 min, free)
- [ ] Email Anthropic sales: BAA terms for direct API OR confirm Bedrock as path (~30 min)
- [ ] Confirm Mongo Atlas tier + sign BAA via Atlas console (30 min)
- [ ] Email Render sales: ask for Enterprise BAA quote (just to know the option) (15 min)

### Phase 2 — Quick code wins (1-2 days)
- [ ] **Disable PostHog session recording on patient-facing routes** (intake form, results page). Easy: pass `disable_session_recording: true` to `posthog.init()` OR use route-based opt-out.
- [ ] **Trim therapist notification email** to: "You have a new referral that scored {score}%. View details: {portal_url}" — push the full clinical summary into the secure portal instead. Reduces Resend exposure even with BAA.
- [ ] **Trim patient results email** similarly: "Your matches are ready. View them here: {portal_url}". Don't include match reasons in the email body.
- [ ] **Trim intake receipt email** to "We received your request (ref: {short_id}). View full receipt: {portal_url}". Don't include the full intake answers.
- [ ] Add `/exports/` to `.gitignore` if not already; rotate any historical exports out of cloud sync.

### Phase 3 — Hosting migration (2-4 weeks if Option A)
- [ ] Decision: A vs B vs C above. Get the Render Enterprise quote first to inform.
- [ ] If A: Spin up AWS account, set up VPC + private subnets, ECS cluster, ECR, RDS or migrate Atlas to private endpoint
- [ ] Containerize backend (Dockerfile + Render.yaml → Fargate task definition)
- [ ] Set up secrets management (AWS Secrets Manager) and migrate env vars
- [ ] Add CloudWatch logging
- [ ] Cutover plan: deploy to AWS, run both in parallel for a week, flip DNS
- [ ] Sign AWS BAA (free, self-serve via AWS Artifact)
- [ ] Decommission Render after 30 days of clean traffic on AWS

### Phase 4 — Pre-launch verification (~1 day)
- [ ] Penetration test (small SaaS scope, ~$2-5K)
- [ ] Document data retention + breach notification procedures (one-page each, can use templates)
- [ ] Review email templates one more time for inadvertent PHI leakage
- [ ] Confirm all BAAs filed in the same place (e.g. a shared Drive folder)

### Phase 5 — Go live
- [ ] Run the **Operations → Settings → Go-Live runbook** master button (already shipped)
- [ ] Update Render env vars per runbook prompts
- [ ] Flip DNS

---

## 5. Risk-Tiered Launch Options

If you're considering launching sooner than the full Phase 3 migration:

| Tier | What you launch with | Compliance posture | Acceptable for |
|---|---|---|---|
| **Friends & family / pilot (no PHI)** | Current Render stack, current emails. Use ONLY synthetic data or volunteers who explicitly consent in writing to data handling outside HIPAA. | Not HIPAA-covered (no patients) | Demo, investor pitches, alpha testing |
| **Limited pilot (small patient cohort with paper-trail consent)** | Phase 1 + Phase 2 done. Hosting still on Render, but with a one-off written acknowledgment from each patient that data flows through non-BAA infrastructure during pilot. | Defensible if scoped tightly + documented; not strictly compliant | Beta with handful of patients, time-limited |
| **Compliant launch** | All phases done. AWS hosting + signed BAAs everywhere + trimmed email content + PostHog session recording disabled. | HIPAA-compliant | General availability |

**Important:** I'm not a HIPAA attorney. This audit is engineering-grade — it tells you what your code does and what vendor BAAs need to be in place. For the actual legal posture (especially around the limited-pilot scenario above), engage a healthcare attorney before serving any real patient.

---

## 6. What's already done (don't redo)

- Strict TLS for Mongo
- HMAC-hashed patient identifiers in audit logs
- 7-year audit log retention
- LLM prompt sanitization (regex-based PII redaction before every Anthropic call)
- Patient email HMAC-hashing in master_query
- Security headers middleware
- JWT 8h expiry for admin sessions
- Stripe ownership checks + webhook signature verification
- Rate limiting on patient intake + therapist signup + magic-code endpoints
- Pre-launch email safety guard (EMAIL_OVERRIDE_TO + EMAIL_LIVE_MODE three-state guard)
- Hard-bounce registry + cooldown skip
- Wipe / strip / restore tools for the test → live data transition

The HIPAA hygiene foundation is solid. The remaining work is paperwork (BAAs) + content trimming + hosting migration — not a rebuild.
