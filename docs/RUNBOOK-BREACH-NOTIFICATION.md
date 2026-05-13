# Breach Notification Runbook

**Owner:** Josh Rose (founder)
**Last reviewed:** 2026-05-13
**Scope:** What to do when patient or therapist data on TheraVoca may have been accessed, copied, or exposed without authorization.

> **Important caveat.** This runbook is engineering-grade operational
> guidance, not legal advice. The minute a real incident is suspected,
> engage TheraVoca's healthcare attorney **before** notifying anyone
> externally. The 30/60/90-day clocks in this doc are real but they
> start from "discovery," and what counts as "discovery" can be
> debated -- the lawyer is the one who decides what date you put on the
> notice.

---

## Quick reference: when this runbook fires

| Trigger | Examples |
|---|---|
| Unauthorized access to the database | Compromised Mongo Atlas credentials, exposed connection string in a public repo, a stolen Render env file |
| Unauthorized download or copy of patient/therapist data | A staff laptop with `/exports/` synced to a personal cloud, a CSV emailed to the wrong address, a misconfigured S3 bucket |
| Email delivery to the wrong person | A bulk send that joined the wrong row in the recipient table, a "reply-all" with patient details in the thread |
| Vendor breach affecting our data | Resend / Twilio / Atlas / Anthropic announces an incident that may have touched TheraVoca traffic |
| Lost or stolen device with credentials cached | A team member's MacBook stolen with active admin session, a phone with the password manager unlocked |
| Successful phishing / SIM swap of an admin | Admin password reset captured by an attacker, MFA bypass on the founder account |

**Not a breach:** an internal admin viewing a patient record as part of normal operations, a Patient sharing their own info with a Therapist via the platform's intended flow, audit-log entries showing legitimate access.

---

## Step 0 -- Within the first hour: contain

Before anything else, **stop the bleeding**.

1. **Rotate every credential that could have been used.**
   - `MONGO_URL` (Atlas console -> Database Access -> rotate password)
   - `JWT_SECRET` (Render env -> set new value -> redeploy; all sessions
     invalidate, which is fine)
   - `RESEND_API_KEY`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
     `STRIPE_API_KEY` (rotate even if you don't think they were touched)
   - `ADMIN_PASSWORD` (Render env)
   - `RESEND_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`
2. **Force-logout every admin.** Rotating `JWT_SECRET` does this for
   free -- the Bearer JWTs become invalid.
3. **Take a Mongo Atlas snapshot** before anyone touches data. The
   snapshot is your forensic baseline. Atlas keeps them automatically,
   but trigger a manual one too so you know exactly when "post-breach"
   begins.
4. **Freeze deploys.** Set staging to "do not deploy" until the
   investigation is at least scoped.
5. **Start a timeline doc.** Plain text, one entry per event: "00:14 --
   admin notification received from Atlas about unusual query
   pattern." This is the document the lawyer and any regulator will
   ask for. Don't reconstruct from memory later -- log as you go.

---

## Step 1 -- Within the first 24 hours: scope

Figure out exactly what was accessed and how much.

1. **Pull the audit log** for the suspected window plus a generous
   buffer on each side. Audit log lives in `db.audit_log` with 7-year
   retention. Actor IDs are hashed (HMAC of email or "admin"); IPs are
   hashed; resource IDs are UUIDs. Run admin queries to figure out
   which patient/therapist UUIDs were touched.
2. **Check Render request logs.** Render keeps access logs for
   ~30 days. Look for unusual traffic from unknown IPs hitting admin
   endpoints, mass enumeration patterns, sustained 401/403 spikes
   followed by a 200.
3. **Check Mongo Atlas logs.** Atlas's "Real-Time Performance Panel"
   shows query patterns; the audit log (Atlas-side) shows DBA actions.
4. **Identify the affected individuals.** Build the list:
   - For each patient UUID touched: look up
     `db.requests.find_one({"id": uuid})` and capture the email +
     state of residence (state controls notification law).
   - For each therapist UUID touched: same with `db.therapists`.
   - Save this as a CSV in a secure location (1Password vault, not
     Drive/Slack).
5. **Decide what was actually exposed.** A breach of a UUID is not a
   breach of clinical content if the joined record was never read.
   Refer to the data model: emails live in identity collection,
   clinical preferences live elsewhere, joined only at carefully
   audited moments. Was the join itself touched?
6. **Engage the healthcare attorney.** Now is when you call. Forward
   them the timeline doc + the affected-individuals list. They'll
   tell you whether this rises to "breach" under each applicable law
   and what the notification clock looks like.

---

## Step 2 -- Within the first 60 days: notify

The actual notification rules depend on (a) which law applies and
(b) where the affected people live. Below is the at-a-glance table.

### Federal: FTC Health Breach Notification Rule (HBNR)

| What | When | To whom |
|---|---|---|
| Notice to affected individuals | Without unreasonable delay, no later than **60 days** after discovery | Each affected person, by first-class mail (or email if the person agreed to electronic notice) |
| Notice to the FTC | Same 60 days | FTC online breach-notification form |
| Notice to media | Same 60 days, **only if 500+ residents of a single state are affected** | Major media outlets in the affected state |

**Applies to TheraVoca because:** the FTC's 2024 HBNR expansion
explicitly covers non-HIPAA health apps that "draw" data from multiple
sources. TheraVoca collects patient health-related preferences and
delivers them to therapists; that's enough to put us in scope.

### State: Idaho (primary, today)

Idaho Code § 28-51-104 to 28-51-107 governs breach of "personal
information" of Idaho residents.

| What | When | To whom |
|---|---|---|
| Notice to affected Idaho residents | "Most expedient time possible and without unreasonable delay" | Each affected Idaho resident |
| Notice to Idaho AG | If 50,000+ Idaho residents affected | Idaho Attorney General's office |

Idaho law treats medical / mental-health information as triggering
the notification requirement.

### Other states (forward-looking; only matters after Idaho-only ends)

The table below is reference, not law -- confirm current statutes
with the attorney before relying on these numbers. Most states' clocks
start at "discovery"; a few start at "without unreasonable delay" with
a 30/45/60-day cap.

| State | Window | Notes |
|---|---|---|
| California | "Most expedient time" + 15-day AG notice if 500+ residents | CMIA also applies to mental-health app info (SB-1223). Strict. |
| New York | 30 days | NY SHIELD Act. Includes "biometric" + "private information." |
| Texas | 60 days | HB-300 covers health info specifically. |
| Florida | 30 days | Includes "user name / email + password" combos. |
| Washington | 30 days | **My Health My Data Act** (MHMDA) is the bigger exposure here -- private right of action. |
| Connecticut | 60 days | CDPA covers consumer health data. |
| Nevada | 45 days | SB370 covers consumer health data. |
| Massachusetts | "As soon as practicable, no unreasonable delay" | One of the strictest enforcement records. |

**Rule of thumb:** If you have any affected resident in a state, you
notify under that state's law. Multi-state breaches mean overlapping
clocks -- the **shortest** window wins.

---

## Step 3 -- Notification content

The attorney will draft the final letter, but here's the operational
checklist of what every notice needs (sourced from FTC + Idaho law
+ common state requirements):

- [ ] What happened (one short paragraph, plain English)
- [ ] What information was involved (be specific -- "your email and
      the date you submitted an intake request" vs. "your information")
- [ ] What we're doing about it (steps already taken + steps planned)
- [ ] What the recipient should do (e.g., reset password, watch for
      phishing, monitor credit if SSNs were involved -- not relevant
      here since we don't collect SSNs)
- [ ] How to contact us (dedicated email or phone for incident
      response, plus our regular support channel)
- [ ] Whether free credit monitoring is being offered (state laws
      vary; CA and CT may require it for certain breach types)

Notification channels: email is acceptable for individuals who agreed
to electronic communication, which all TheraVoca patients do at
intake (`agreed_to_terms: True`). For users who unsubscribed, fall
back to first-class mail using the address on file (we don't collect
mailing addresses today, so this is a known gap -- flag for attorney
review).

---

## Step 4 -- After notifications: lessons + audit trail

1. **Write the post-mortem.** What happened, when did we discover it,
   what did we do, what's the gap that allowed it, what's the fix.
   Keep it private; don't publish.
2. **Add the fix to the backlog and prioritize.** Real fix, not a
   patch.
3. **Save everything.** Timeline doc, affected-individuals list,
   draft + final notices, the post-mortem, the attorney's advice.
   Keep for at least 7 years (matches our audit log retention) in a
   secure shared location.
4. **Review this runbook.** If anything was wrong or missing, fix it
   so the next person who reaches for it gets better guidance.

---

## Appendix A -- Contacts (fill in before launch)

- Healthcare attorney: **TBD -- engage before serving first real
  patient. See `HIPAA-SCOPE-OUT-2026-05-13.md` Section 7 for the
  intake questions to send.**
- Cyber-incident response (optional, but worth having a name): TBD
- Cyber-liability insurance carrier: TBD
- Render incident contact: support@render.com (or Render dashboard
  -> Help)
- Mongo Atlas incident contact: support.mongodb.com (priority
  support tier required for fastest response -- check current tier)
- Resend incident contact: support@resend.com
- Twilio incident contact: help.twilio.com -> Security tab
- Stripe incident contact: stripe.com/support -> Fraud / security
- Anthropic incident contact: support@anthropic.com
- FTC breach-notification portal:
  https://www.ftc.gov/business-guidance/privacy-security/health-privacy
- Idaho AG: https://www.ag.idaho.gov/about-the-office/contact/

---

## Appendix B -- Pre-incident checklist

These are the things to set up **before** a breach happens so Step 0
isn't a scramble.

- [ ] Healthcare attorney engaged with retainer or at least a warm
      handoff so they can be reached out-of-hours
- [ ] Cyber-liability insurance policy in place (often required by
      enterprise customers and BAAs anyway)
- [ ] Off-platform comms plan: which Slack channel / phone tree /
      shared doc is used to coordinate during an incident. **Do not**
      rely on email for incident comms if email is the system
      affected.
- [ ] Render env vars documented (which keys exist, what they unlock)
      so rotation order is obvious under pressure
- [ ] Atlas backup retention confirmed (default 2 days for free, 7+
      for paid tiers -- you want at least a week)
- [ ] Patient-facing privacy email address (e.g.,
      privacy@theravoca.com) registered and forwarded somewhere
      a human reads
- [ ] One-page "what to do first" laminated card in the founder's
      home office (sounds silly until you're awake at 3am)

---

## Appendix C -- Things that look like a breach but aren't (yet)

- **A single admin sees a patient record they didn't need to see.**
  This is an audit-log finding, not a breach. Address through
  policy, not notification.
- **A Therapist views a patient referral and then declines it.**
  Designed-for behavior; not a breach.
- **A failed login attempt from a strange IP.** Investigate via
  audit log; rate limiter should already have locked the IP. Not a
  breach unless the attempt eventually succeeded.
- **A patient using TheraVoca on a shared device and accidentally
  showing their answers to someone in the room.** Patient-directed
  disclosure; not our event.
- **A Resend bounce for a patient's results email because their
  inbox is full.** Normal email failure mode; bounce registry
  already handles it.

When in doubt: log it in the timeline, ask the attorney, don't
panic-notify. False positives are just as expensive to the trust
story as actual breaches.
