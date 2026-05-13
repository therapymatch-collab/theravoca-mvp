# TheraVoca Breach Notification Procedure

**Version:** 1.0
**Last reviewed:** 2026-05-13
**Owner:** Josh Rose, Founder / Privacy Officer
**Backup contact:** [name + email] — designate before launch

This document satisfies the HIPAA Breach Notification Rule (45 CFR §164.400-414) for TheraVoca's processing of Protected Health Information (PHI). It is required for any covered entity or business associate that handles PHI in the United States.

> **Not legal advice.** This is an operational template adapted for TheraVoca's specific stack. Have it reviewed by a healthcare attorney before launch. Update annually or after any incident.

---

## 1. Definitions

**PHI** — Protected Health Information per HIPAA §160.103: any individually identifiable health information transmitted or maintained by TheraVoca. Includes: patient email + name, intake answers (presenting issues, age, location, urgency, payment, modality preferences), free-text "anything else", prior therapy notes, request IDs paired with identifiers, match scores tied to patient identity, survey responses, feedback content.

**Breach** — per §164.402: unauthorized acquisition, access, use, or disclosure of PHI that compromises its security or privacy. **Presumed to be a breach unless TheraVoca demonstrates a low probability of compromise** via the four-factor risk assessment in §3 below.

**Discovery** — a breach is "discovered" the first day it is known, OR by exercising reasonable diligence would have been known, by any TheraVoca workforce member or agent (including contractors, vendors with access to PHI, etc.).

**Workforce member** — any employee, contractor, or other person whose conduct is under TheraVoca's direct control, paid or unpaid.

**Affected individual** — any patient whose PHI was involved in the breach.

---

## 2. Detection & Initial Response (Hour 0–24)

### 2.1 Sources of breach detection

A breach can come to light through any of:

- **Internal monitoring** — an alert from server logs, the audit log, the Outbound admin tab (e.g. unusual bounce spike to addresses you didn't expect to email), Render's monitoring, or a manual security review.
- **Vendor notification** — Resend, Twilio, Mongo Atlas, AWS, Anthropic, Stripe, or another business associate notifies us they had an incident affecting our data. **Vendors are contractually required to notify us within their BAA's stated window** (usually 24-72 hours).
- **External report** — a patient, therapist, journalist, security researcher, or law enforcement contacts `support@theravoca.com` with a concern.
- **Public disclosure** — the data appears on a paste site, dark web, GitHub leak, etc.

### 2.2 First actions (within 1 hour of discovery)

The person who discovered the incident must:

1. **Stop the bleed.** If the cause is still active (an open API endpoint, a leaked credential, an ongoing email send to the wrong list), kill the affected service or revoke the credential immediately. Use the Operations → Settings → Master testing-mode card to disable abuse-defense bypasses; use Render dashboard to roll back the deployment if needed.
2. **Preserve evidence.** Take screenshots, copy log files, snapshot the database state if relevant. Do not delete anything. Audit logs (`backend/audit.py`) are configured for 7-year retention — leave them alone.
3. **Notify the Privacy Officer** (Josh Rose, founder). Email `support@theravoca.com` with subject prefix `[BREACH-INVESTIGATION]`. If Josh is unreachable, use the backup contact.
4. **Open an incident document.** Single Google Doc or Notion page titled `INCIDENT-YYYYMMDD-<short-tag>`. Append every action with a timestamp.

### 2.3 Within 24 hours

The Privacy Officer must:

- Confirm the incident is real (not a false alarm or test).
- Determine the **scope** — how many individuals' PHI is affected? Which fields?
- Begin the **risk assessment** in §3.
- If law enforcement may need to be notified, contact a healthcare attorney before any public disclosure.

---

## 3. Risk Assessment (Four-Factor Analysis)

Per §164.402(2), every suspected breach is presumed reportable unless TheraVoca demonstrates a **low probability that PHI was compromised** based on these four factors. Document the analysis in the incident doc.

| Factor | Question to answer | TheraVoca-specific examples |
|---|---|---|
| **1. Nature & extent of PHI** | What types of identifiers? What clinical data? Could it be re-identified? | "Just emails" is lower-risk than "emails + presenting issues + location" |
| **2. Unauthorized recipient** | Who saw it? Another covered entity (lower risk) or the public internet (high risk)? | A wrong-email send to one therapist is lower-risk than data scraped from an open S3 bucket |
| **3. Was PHI actually acquired or viewed?** | Did the recipient open the email? Did the attacker exfiltrate the data, or just get access to the system? | Forensic analysis: server logs, Resend engagement events, Mongo audit logs |
| **4. Mitigation** | Has the risk been reduced? Did the recipient confirm deletion? Were credentials rotated? | Got the recipient on email confirming "I deleted it and won't share" — lowers risk |

**Conclusion options:**

- **Low probability of compromise** → not reportable. Document the analysis, file the incident doc, no notifications required. Be prepared to defend this analysis if HHS audits later.
- **Reportable breach** → proceed to §4.

---

## 4. Notifications

### 4.1 Affected individuals (always required if reportable)

**Timeline:** Without unreasonable delay, no later than **60 calendar days from discovery**.

**Method:** Written notice via first-class mail. Email is acceptable ONLY if the patient previously agreed to electronic notice. Substitute notice (web posting + media) is required if you cannot reach 10+ affected individuals via standard contact methods.

**Required content** (§164.404(c)):

1. Brief description of what happened, including date of breach + date of discovery (if known)
2. Description of the types of PHI involved (e.g., "your name, email, and the matching answers you provided on intake")
3. Steps the individual should take to protect themselves
4. What TheraVoca is doing to investigate, mitigate, and prevent recurrence
5. Contact info to ask questions: phone number + email address + postal address + website

**Template language is in Appendix A.**

### 4.2 HHS Office for Civil Rights (always required if reportable)

| Affected individuals | Reporting deadline |
|---|---|
| **500 or more** in a single state/jurisdiction | Without unreasonable delay, **no later than 60 days from discovery** |
| **Fewer than 500** | Annual report, due within **60 days after end of calendar year** in which the breach was discovered |

Submit via the HHS Breach Notification Portal: https://ocrportal.hhs.gov/ocr/breach/

### 4.3 Media (required only for breaches affecting 500+ in a single state/jurisdiction)

- Notify "prominent media outlets serving the state or jurisdiction" within 60 days
- Same content requirements as individual notice (§4.1)

### 4.4 Business Associates → Covered Entities

If TheraVoca discovers a breach as a **business associate** to another covered entity, we must notify that covered entity (per the BAA terms, usually within 60 days). For now TheraVoca acts as a covered entity, not a business associate, so this section is unlikely to apply.

### 4.5 Our own business associates (Resend, Twilio, Mongo Atlas, etc.)

If their systems were involved, contact them via their support channel and reference the BAA. They must cooperate with our investigation.

---

## 5. Documentation & Retention

For every incident — whether or not we conclude it was a reportable breach — retain in a secure location for **at least 6 years**:

- The incident document (timeline, actions taken, screenshots, logs)
- The four-factor risk assessment + conclusion
- Copies of all notifications sent (individuals, HHS, media, business associates)
- Any correspondence with affected individuals, vendors, attorneys, or HHS
- Evidence of mitigation steps (e.g., credential rotation logs, code changes deployed)

The audit log in MongoDB (`backend/audit.py`) is already configured for 7-year retention and captures admin actions on requests, therapists, and applications.

---

## 6. Roles & Responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **Privacy Officer** | Josh Rose, Founder | Final decision authority on breach determination + notifications. Manages relationships with attorney, HHS, BA partners. |
| **Security Officer** | Josh Rose (or designate) | Technical investigation, evidence preservation, system remediation. |
| **Communications lead** | Josh Rose (or designate) | Drafts patient + media notifications. Manages support inbox during incident. |
| **Backup contact** | [TO BE DESIGNATED before launch] | Steps in if Privacy Officer is unreachable for >24 hours during an incident. |

For a small team (1-2 people), one person can hold multiple roles. **Designate at least one backup before launch** so a single point of failure (vacation, illness) doesn't extend the incident response window past HIPAA deadlines.

---

## 7. Annual Review

This procedure must be reviewed at least annually and after any incident. Update if:

- The vendor stack changes (new BA added, BA replaced)
- The PHI surface changes (new data fields collected, new export paths)
- The team grows (new roles to assign, new contacts)
- HHS or counsel advises updates

Record review dates + reviewer at the bottom of this document.

---

## Appendix A — Patient Notification Template

> Subject: Important notice regarding your TheraVoca account
>
> Dear [Patient name],
>
> We are writing to inform you of a recent incident that may have affected the security of your information in our system.
>
> **What happened.** On [date of discovery], TheraVoca discovered [brief plain-English description of the incident — e.g., "an unauthorized party gained access to a database that included responses to our intake form"]. We believe the incident occurred on [date of breach, if known].
>
> **What information was involved.** The information that may have been accessed includes: [list the specific fields — e.g., "your name, email address, and the answers you provided on our intake form, which included your reasons for seeking therapy and your location"]. [State explicitly what was NOT involved if relevant — e.g., "Your payment information was not stored in the affected system."]
>
> **What we are doing.** We have [list mitigation steps taken — e.g., "secured the affected database, rotated all access credentials, engaged a third-party security firm to investigate, and reported the incident to the U.S. Department of Health and Human Services"]. We are also [list ongoing improvements — e.g., "implementing additional monitoring and access controls to prevent similar incidents in the future"].
>
> **What you can do.** [Specific recommendations — e.g., "Be alert to phishing emails or unsolicited contact referencing TheraVoca or your personal information. We will never ask you to confirm your password or payment information by email."]
>
> **For more information.** If you have questions, please contact us at:
> - Email: support@theravoca.com
> - Phone: [phone number]
> - Mail: [postal address]
> - Online: https://www.theravoca.com/privacy-incident
>
> We deeply regret the inconvenience and concern this may cause. Protecting your information is among our most important responsibilities, and we are committed to the steps necessary to prevent this from happening again.
>
> Sincerely,
> Josh Rose
> Founder, TheraVoca

---

## Appendix B — HHS OCR Submission Checklist

Before submitting via https://ocrportal.hhs.gov/ocr/breach/, gather:

- [ ] Date of breach
- [ ] Date of discovery
- [ ] Approximate number of affected individuals
- [ ] Type of breach (hacking, theft, loss, unauthorized access, etc.)
- [ ] Location of breached information (network server, email, paper, laptop, etc.)
- [ ] Type of PHI involved (clinical, demographic, financial, etc.)
- [ ] Brief description of what happened (factual, no speculation)
- [ ] Safeguards in place at the time of breach
- [ ] Actions taken in response

---

## Revision history

| Date | Reviewer | Changes |
|---|---|---|
| 2026-05-13 | Josh Rose | Initial draft |
