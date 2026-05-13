# TheraVoca HIPAA Scope-Out Audit

**Date:** 2026-05-13
**Companion to:** `HIPAA-AUDIT-2026-05-13.md` (the "let's get compliant" version)
**This doc:** "let's design to NOT need HIPAA compliance" version

---

## Important caveat

I'm not a healthcare attorney. This is engineering-grade reasoning about how the
data flows and how regulators have historically classified businesses that look
like TheraVoca. The final classification call needs a healthcare lawyer --
ideally one who has worked with companies in the "mental health directory /
matching" space (Zocdoc-adjacent, Psychology Today-adjacent, BetterHelp-adjacent).
Get that conversation before launch.

---

## TL;DR

TheraVoca has a defensible path to "neither Covered Entity nor Business
Associate" -- but the platform has to commit to it in architecture, contracts,
and marketing copy. The pattern is: **consumer-directed marketing platform**,
not "healthcare service." Psychology Today's directory is the closest analog.

The biggest threats to that posture are not federal HIPAA -- they are:
- **Washington's My Health My Data Act (MHMDA)**
- **The FTC's Health Breach Notification Rule (HBNR)**

Both now reach non-HIPAA mental health businesses.

---

## 1. Classification: CE, BA, or Neither?

HIPAA only applies to three kinds of entities:

- **Health plans** -- insurance, Medicare, etc. Not TheraVoca.
- **Healthcare clearinghouses** -- claims-data processors. Not TheraVoca.
- **Healthcare providers who electronically transmit a HIPAA-covered transaction**
  -- providers who bill insurance, check eligibility, etc. electronically. Not
  TheraVoca -- it doesn't render care or bill insurance.

So TheraVoca is clearly not a **Covered Entity**.

The **Business Associate** question is the live one. A platform becomes a BA the
moment it handles PHI *on behalf of* a Covered Entity. Therapists who bill
insurance are CEs. So:

- **NOT a BA if:** patients give info directly to TheraVoca, TheraVoca markets
  therapists to patients, and the therapist-patient relationship begins *after*
  the handoff. TheraVoca is acting on behalf of the *patient* (and the
  therapist, as a marketing client), not as an intake intermediary for a
  therapist's practice.
- **IS a BA if:** a therapist's practice contracts with TheraVoca to handle
  their intake, TheraVoca schedules appointments inside their EHR/practice
  management system, or TheraVoca transmits any HIPAA-covered transaction.

**Defensible classification: NEITHER -- TheraVoca is a consumer-directed
marketing/lead-generation platform.** Psychology Today's directory takes this
posture. BetterHelp historically tried to take it too, before the FTC hammered
them on tracking pixels (separate issue -- see Section 4).

---

## 2. What's Pushing TheraVoca Toward HIPAA Scope

Most of the current intake fields are fine -- what matters is the *relationship*,
not the data. But a few fields in `backend/models.py:143` (RequestCreate) are
riskier than others. Tiered by how much they hurt the "neither" position:

### Tier 1 -- Worst (free-text mental-health history)

| Field | Why it's a problem | Fix |
|---|---|---|
| `prior_therapy_notes` (2000 chars) | Verbatim mental-health history. A regulator looking for "are they handling PHI?" zeros in on this. | Remove from intake OR convert to structured tags only (e.g., "previously seen therapist Y/N", "took medication Y/N"). No free text about treatment history. |
| `p3_resonance` (2000 chars) | Open-ended text about the patient's emotional needs. Powers the optional deep-match feature. | Remove OR convert to multiple-choice. Note: this is load-bearing for the deep-match embedding feature; removing it weakens that ranking signal. |

### Tier 2 -- Moderate

| Field | Why it's a problem | Fix |
|---|---|---|
| `insurance_name` | Insurance carrier + presenting concerns = a record that looks clinical. | Keep, but stop forwarding to therapists in the notification email body. Hide behind portal. (Already done in commit 6277df0.) |
| `presenting_issues` + `issue_severity` | Severity scores look like clinical assessment. | Keep `presenting_issues` (broad categories are fine -- same as Psychology Today's specialties checklist). Drop the 1-5 severity scale OR rename it "importance to you" to make it a preference, not an assessment. |
| `other_issue` (200 chars free text), `session_expectations` | Free text is always the riskiest. | Convert to multiple-choice where possible; cap at very short length where not. |

### Tier 3 -- Fine

ZIP, age, email, gender preference, modality preference, payment preference,
referral source. Consumer-preference fields, identical to what dating apps or
therapist directories collect.

### The pattern

A consumer marketplace asks "what kind of provider are you looking for?" A
healthcare intake asks "what's wrong with you?" The current form does some of
both. Lean hard into the first framing.

---

## 3. The Anonymized Intake / Opaque Token Architecture

Yes, this works, and TheraVoca is already most of the way there. Three layers:

### Layer 1 -- Split storage

Identity (email, phone, name if collected) lives in one collection. Clinical
preferences (presenting issues, prior therapy, etc.) live in another. The join
key is an opaque UUID that is *not derivable* from the email. The application
code is the only thing that can join them, and only at carefully audited moments
(sending an email, showing the patient their own portal).

### Layer 2 -- Therapist-facing notifications never join identity + clinical

When a therapist gets the "new lead" email, they see *only* the patient's
anonymous ID + a "click to view the patient's preferences" link. They see
clinical data *after* logging into the portal, where it is still
identity-suppressed. Identity (email) is only revealed when the therapist clicks
"accept this referral" -- at which point the patient-therapist relationship has
begun and TheraVoca is no longer holding the joined record.

### Layer 3 -- Patient-facing emails carry no PHI in the body

Identity + CTA only, with everything behind one-click HMAC tokens. **Already
shipped in commit 6277df0.**

### What would still need to change

- Currently `RequestOut` (`backend/models.py:253`) joins email + clinical fields
  in a single object. Splitting this in the data layer is real work but not
  huge -- maybe 3-5 days of careful refactoring.
- Therapist notification emails would need to swap `summary` (which currently
  embeds presenting issues) for a fully opaque "Patient #abc123 -- click to
  view" payload.
- A short "we are not handling PHI on your behalf" notice in the therapist
  Terms of Service to make the marketing-platform posture explicit, so
  therapists don't later argue they thought TheraVoca was their BA.

### Side benefit

If a regulator ever asks "could you produce all the clinical info about user X?",
the honest answer is "only if X is logged in." Strong privacy story.

---

## 4. State Laws That Still Apply Even If TheraVoca Scopes Out of Federal HIPAA

This is the part most non-HIPAA mental health businesses get wrong. Scoping out
of HIPAA does not make TheraVoca unregulated.

### WA My Health My Data Act (MHMDA) -- biggest non-HIPAA exposure

- Applies if TheraVoca has any WA residents
- Covers "consumer health data" -- explicitly including mental health --
  regardless of HIPAA status
- Requires: affirmative consent before collection, deletion rights, no sale of
  data without separate authorization, geofencing rules
- Private right of action under WA Consumer Protection Act -- patients can sue
- Effective since March 2024

### FTC Health Breach Notification Rule (HBNR)

- FTC expanded HBNR in 2024 to cover non-HIPAA health apps that "draw" health
  data from multiple sources
- Used against GoodRx and BetterHelp
- Requires: notify FTC + consumers + media within 60 days of unauthorized
  PHI-like disclosure
- Penalties scale with users affected

### FTC Act Section 5 (unfair & deceptive practices)

- Always applies
- BetterHelp action ($7.8M settlement, 2023) was about sharing email + IP with
  Facebook for ad targeting
- **Get all third-party tracking off patient-facing pages** -- this is the
  single biggest current exposure
- Marketing copy is enforceable: if the site says "we protect your privacy,"
  the FTC can sue if it doesn't

### CA CMIA (Confidentiality of Medical Information Act)

- Probably no, but borderline
- CA SB-1223 extended CMIA to "mental health application information" in 2023
  -- open question whether a referral platform counts
- If applicable: written authorization for any disclosure of mental health
  info, private right of action with statutory damages

### NV SB370 / CT CDPA / TX HB-4 (health data)

- Variations on the MHMDA template -- consent, deletion, no sale
- Apply to residents of those states

### State breach notification laws

- All 50 states have one
- Most include "health information" as a triggering category
- Notify affected individuals + AG within state-specific deadlines (30-90 days)

### Practical implications

Even with a clean non-CE/non-BA classification, TheraVoca needs to:

1. **Add MHMDA-compliant consent flow** -- separate consent screen before
   intake, with deletion request mechanism and a Consumer Health Data Privacy
   Policy (separate from general privacy policy)
2. **Remove all third-party tracking from patient-facing routes** --
   especially PostHog session recording (already flagged in prior audit). FTC
   doesn't care about HIPAA status if data leaks to Meta/Google/etc.
3. **Be ready to send breach notifications** even if not federally required

---

## 5. Marketing & Trust Cost of NOT Being HIPAA-Compliant

### For patients

Mostly a non-issue if handled well. The vast majority of patients don't know
what "HIPAA-compliant" means; they care about "is my info private?" Lean into
specific, concrete claims:

> "Your intake is encrypted. We don't sell data, ever. We don't share clinical
> details with insurers, employers, or advertisers. We comply with state health
> privacy laws including Washington's My Health My Data Act."

That's stronger than a vague "HIPAA-compliant" badge, and it's actually true.

### For therapists

Trickier. Therapists are HIPAA Covered Entities and many will instinctively ask
"do you sign a BAA?" The answer is the same answer Psychology Today gives: no,
because we don't need to -- we're a marketing platform, not your intake
processor. Have a one-page explainer ready for the therapist FAQ:

> "TheraVoca is a marketing service. We send you qualified leads from patients
> who choose you. The therapist-patient relationship begins when you accept a
> referral. We never act on your behalf in collecting PHI -- patients give
> their info directly to us, and we share it with you so you can decide whether
> to take them on. This is the same model as Psychology Today, GoodTherapy, and
> other directory services."

This works for ~95% of therapists. The ones who insist on a BAA are typically
larger group practices with a compliance officer, and they're not the
early-stage target customer.

---

## 6. Recommended Sequence (Cheapest → Most Disruptive)

1. **Tighten marketing copy** (1 day). Position as "marketing/matching
   platform." Add a clear "we are not a healthcare provider" disclaimer on the
   homepage and in the Terms.
2. **Drop or harden the free-text PHI fields** (1-2 days). Remove
   `prior_therapy_notes`, `p3_resonance`, and rename the severity scale to
   "importance to you." See `models.py:143` (`RequestCreate`).
3. **Disable PostHog session recording on patient routes** (half a day). Single
   biggest FTC HBNR exposure right now.
4. **Add MHMDA-compliant consent + deletion flow** (3-5 days). Separate consent
   screen, separate health-data privacy policy, deletion request endpoint.
5. **Split the data model** (3-5 days). Identity collection + preferences
   collection joined only via opaque UUID. Audit every place they're joined.
6. **Update therapist notification emails** (already mostly done -- 1 more day).
   Ensure the email body NEVER includes presenting issues or clinical info,
   only an opaque ID + portal link.
7. **Healthcare attorney review** (~$3-5K, 1-2 weeks). Get a 1-page legal
   opinion to show investors and enterprise therapist customers confirming the
   non-CE/non-BA posture.

### Savings vs. the prior compliance plan

- Skip AWS migration ($200-500/mo + 2-4 weeks engineering)
- Skip Resend BAA tier upgrade
- Skip Atlas M10 upgrade ($60/mo)
- Skip Twilio + Anthropic BAA paperwork

Total: **$300-600/mo + 4-8 weeks of work**, in exchange for being more
disciplined about which fields are collected and how communications work.

### Costs that remain

- Healthcare attorney
- MHMDA compliance work (consent screen, deletion endpoint, separate policy)
- Removing third-party tracking

---

## 7. Open Questions for the Attorney

1. Is TheraVoca a "regulated entity" under WA MHMDA, or does the consumer-direct
   posture exclude it? (Likely YES regulated -- broad scope.)
2. Does CA SB-1223's extension of CMIA to "mental health application
   information" sweep in a matching platform?
3. Is a one-line "we are not your Business Associate" disclaimer in the
   therapist Terms of Service enough, or does TheraVoca need explicit written
   acknowledgments from each therapist?
4. If a therapist accepts a referral and the patient never books a session with
   them, does TheraVoca retain a residual BA-like relationship for the data it
   shared? Or does the marketing-handoff posture cleanly terminate?
5. What state-specific breach notification timelines should be wired into the
   incident response runbook?

---

## 8. What's Already Done in This Direction

- Email templates trimmed to identity + CTA (commit 6277df0)
- HMAC-tokenized portal links for sensitive content
- Patient email HMAC-hashing in `master_query`
- LLM prompt sanitization (regex-based PII redaction)
- Audit logs use hashed identifiers, not raw email
- Hard-bounce registry + cooldown skip
- Pre-launch email safety guard (EMAIL_OVERRIDE_TO + EMAIL_LIVE_MODE)

The foundation for the scope-out posture is largely in place. The remaining
work is field trimming, consent UI, and tracking-pixel removal -- not a
rebuild.
