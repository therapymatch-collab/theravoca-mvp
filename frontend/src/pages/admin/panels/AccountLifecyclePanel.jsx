/**
 * Internal documentation panel -- explains the four account-lifecycle
 * states (Active, Paused, Deleted, Purged) and how each one affects
 * matching, algo learning, Stripe billing, and data retention. Lives
 * under Admin -> Operations -> "Account lifecycle". Read-only, no
 * API calls.
 *
 * Keep this panel in sync with:
 *   - backend/routes/portal.py   (delete + pause + resume + export
 *     endpoints, both roles)
 *   - backend/helpers.py         (send_matches + _trigger_matching
 *     filters)
 *   - backend/cron.py            (24h purge job for deleted_at)
 *   - frontend DeleteAccountPanel.jsx, PauseAccountPanel.jsx,
 *     DataExportPanel.jsx
 *
 * Audience: Josh + any future operator who has to explain to a
 * therapist or patient (or auditor) what happens when they hit a
 * lifecycle button. Plain English first; mechanics second.
 */
import {
  CircleDot,
  PauseCircle,
  Trash2,
  ArchiveX,
  Download,
  Brain,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

const STATES = [
  {
    icon: CircleDot,
    color: "#2D4A3E",
    title: "Active",
    summary:
      "The default state. Profile is matchable, subscription billing is current, all features available.",
    fields: [
      "therapists: paused_at = null, deleted_at = null, is_active = true, subscription_status in [trialing, active]",
      "patient_accounts: paused_at = null, deleted_at = null",
      "requests: paused_at = null, deleted_at = null, status in [open, matched]",
    ],
  },
  {
    icon: PauseCircle,
    color: "#A88B2A",
    title: "Paused (reversible, no time limit)",
    summary:
      "User self-serves a pause from their portal. Matching stops; data is preserved entirely. No 24-hour window -- they can resume any time.",
    bullets: [
      "Therapist: Stripe sub is set to cancel_at_period_end. Therapist keeps portal access through the end of the current billing period; no further charges. Resume before the period ends un-cancels the sub. Resume AFTER the period ends requires a fresh Stripe checkout (UI handles the redirect).",
      "Patient: every active request belonging to the patient gets paused_at set. Existing referrals already sent to therapists are NOT retracted -- pause is forward-only. Resume restores paused_at = null on the account and on every request paused with reason = patient_self_pause.",
    ],
  },
  {
    icon: Trash2,
    color: "#8B3220",
    title: "Deleted (24-hour reversible window)",
    summary:
      "User confirms email + types DELETE. Row is flagged deleted_at = now and sensitive blobs are wiped immediately; the doc itself stays around for 24 hours so a misclick can be reversed by support.",
    bullets: [
      "Therapist: license_document, license_picture, totp_secret, totp_recovery_hashes, password_hash, stripe_payment_method_id are $unset immediately. is_active = false. Stripe sub canceled at period_end.",
      "Patient: password_hash, totp_secret, totp_recovery_hashes are $unset. Every match request is marked deleted_at + is_active = false so it never re-enters matching.",
      "Within 24h: support@theravoca.com can manually un-set deleted_at to restore the account. After 24h: permanent (see Purged).",
    ],
  },
  {
    icon: ArchiveX,
    color: "#6D6A65",
    title: "Purged (terminal, post-24h)",
    summary:
      "Nightly cron permanently removes rows whose deleted_at is older than 24 hours. No recovery after this point.",
    bullets: [
      "Cron job: backend/cron.py removes therapist + patient + request docs where deleted_at < now - 24h.",
      "Audit log entries (backend/audit.py) are NEVER purged -- they survive deletion for forensics + compliance.",
    ],
  },
];

const IMPACTS = [
  {
    icon: Brain,
    title: "Impact on matching",
    body:
      "send_matches() in helpers.py filters candidate therapists to {paused_at: null, deleted_at: null, is_active != false, subscription_status not in [past_due, canceled, unpaid, incomplete]}. Paused or deleted therapists drop out of the candidate pool immediately. _trigger_matching() short-circuits with {skipped: \"paused\" | \"deleted\"} if the patient request itself is paused or deleted, so scoring + outreach never run.",
  },
  {
    icon: Brain,
    title: "Impact on algo learning",
    body:
      "The reliability scoring engine (matching.py + routes/feedback.py) reads response_rate, expectation_accuracy, retention_9w/15w, and selection_rate from the therapist's reliability subdoc, which is built from the last 20 patient survey responses. PAUSED therapists keep all their reliability history intact -- the algo still learns from past feedback even while they're paused. DELETED therapists keep their reliability history during the 24h window. PURGED therapists lose the reliability subdoc; feedback referencing them via therapist_id stays in the feedback collection but no longer rolls up to a profile.",
  },
  {
    icon: Brain,
    title: "Past feedback survives pause",
    body:
      "When a paused therapist resumes, their existing reliability scores are still there -- they don't have to rebuild from zero. This is the main reason to encourage Pause-then-Resume rather than Delete-then-re-signup for therapists who are taking a temporary break.",
  },
  {
    icon: CreditCard,
    title: "Stripe billing implications",
    body:
      "Pause + Delete both call stripe_service.cancel_subscription() which sets cancel_at_period_end = true on the subscription. The therapist keeps access through the end of the current billing period (no mid-cycle refunds). Stripe webhooks fire when the period ends and subscription_status flips to 'canceled', which gives matching an additional belt-and-suspenders exclusion. Pause + Resume during the period calls stripe_service.uncancel_subscription() to flip cancel_at_period_end back to false. Resume after the period ends requires fresh Stripe checkout; the UI redirects to /portal/therapist where the existing Subscribe CTA handles the new checkout.",
  },
  {
    icon: Download,
    title: "Data export (snapshot before pause / delete)",
    body:
      "GET /portal/<role>/export-data returns a JSON file with the user's profile + activity + login history. Auth secrets (password_hash, totp_secret, magic codes), internal scoring caches (embeddings), and the therapist license_document base64 blob are stripped before the download. Available in any state except Purged. Users see a Download button between Pause and Delete in their portal.",
  },
  {
    icon: ShieldCheck,
    title: "Audit log retention",
    body:
      "Every self-serve action -- pause, resume, export, delete, and any failed Stripe call along the way -- writes an audit row via backend/audit.py with actor_type, actor_id, action, ip, and user_agent. Patient actor_id is HMAC-hashed (audit._hash_patient_email) so the log doesn't carry raw PHI. Audit rows survive purge.",
  },
];

const OPS_NOTES = [
  "Self-serve reversal of a 24h-window deletion: connect to Mongo, db.{therapists,patient_accounts,requests}.updateOne({email: ...}, {$unset: {deleted_at: '', deleted_reason: ''}, $set: {is_active: true}}). Stripe sub may need manual re-cancellation handling depending on where in the period the deletion landed.",
  "Stuck pause where Stripe cancel failed: search audit log for action=self_pause_stripe_cancel_failed; the pause flag is set but the sub is still active. Either run cancel_subscription manually or guide the therapist to /portal/therapist for the cancel-from-portal CTA.",
  "Mass pause / freeze (e.g. provider taking a break for board investigation): admin can set paused_at directly via Mongo with paused_reason = 'admin_freeze'. Self-serve Resume will only unset paused_at where paused_reason = 'patient_self_pause' / 'self_serve' -- admin freezes survive resume.",
];

function StateCard({ icon: Icon, color, title, summary, fields, bullets }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: color + "22", color }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif-display text-lg text-[#2D4A3E]">{title}</h3>
          <p className="text-sm text-[#2B2A29] mt-1 leading-relaxed">{summary}</p>
          {fields && (
            <ul className="mt-3 space-y-1 text-xs text-[#6D6A65] font-mono">
              {fields.map((f, i) => (
                <li key={i} className="break-words">{f}</li>
              ))}
            </ul>
          )}
          {bullets && (
            <ul className="mt-3 space-y-2 text-sm text-[#2B2A29] list-disc pl-4 leading-relaxed">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ImpactRow({ icon: Icon, title, body }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#E8E5DF] last:border-0">
      <Icon size={18} className="text-[#C87965] mt-1 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <h4 className="font-medium text-[#2D4A3E] text-sm">{title}</h4>
        <p className="text-sm text-[#2B2A29] mt-1 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

export default function AccountLifecyclePanel() {
  return (
    <div className="space-y-8" data-testid="account-lifecycle-panel">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
          Operations
        </p>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] mt-1">
          Account lifecycle
        </h2>
        <p className="text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          Every therapist and patient account moves through up to four
          states: Active, Paused, Deleted (24h reversible), and Purged.
          Self-serve buttons in the user's portal drive transitions
          between Active and Paused/Deleted; the rest is automated. Below:
          what each state means mechanically, how it impacts matching
          and our reliability-scoring algo, and the operator-side notes
          for handling edge cases.
        </p>
      </header>

      <section>
        <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-3">
          The four states
        </h3>
        <div className="space-y-3">
          {STATES.map((s) => (
            <StateCard key={s.title} {...s} />
          ))}
        </div>
      </section>

      <section className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-2">
          Impact on matching + algo learning
        </h3>
        <div>
          {IMPACTS.map((i) => (
            <ImpactRow key={i.title} {...i} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-3">
          Operator notes (edge cases)
        </h3>
        <ul className="space-y-3 list-disc pl-5 text-sm text-[#2B2A29] leading-relaxed">
          {OPS_NOTES.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
