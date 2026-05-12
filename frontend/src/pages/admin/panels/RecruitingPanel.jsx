import { Send, Sparkles, Mail, Search, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

// Recruiting tab -- plain-English explainer of how TheraVoca grows its
// therapist directory. Covers the two tracks (reactive per-request
// outreach + proactive ongoing network building) plus the current
// configuration status so the founder can see at a glance which
// pieces are live, which are in dry-run, and which need setup.
//
// This is documentation-as-UI -- no live data fetches. The numbers
// (max_invites, etc.) come from Settings -> Matching defaults and
// the existing "Invited therapists" tab.
export default function RecruitingPanel() {
  return (
    <div className="mt-6 space-y-5" data-testid="recruiting-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="text-xs uppercase tracking-widest text-[#6D6A65] mb-1">
          Directory
        </div>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] leading-tight">
          Recruiting
        </h2>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          How TheraVoca grows the therapist directory -- in plain English.
          Two tracks: <strong>reactive</strong> outreach fires automatically
          whenever a patient request can't be filled from our directory, and
          <strong> proactive</strong> mechanisms keep building the network
          even when nobody's actively waiting.
        </p>
      </div>

      {/* ============= TRACK 1: REACTIVE ============= */}
      <Section
        icon={<Send size={18} className="text-[#8B3220]" />}
        title="Track 1 -- Reactive outreach (when a patient request needs more therapists)"
        accent="#FBE9E5"
      >
        <Step n="1" title="Trigger">
          When a patient submits a request and matching runs, the engine tries
          to fill <strong>up to your max-invites limit</strong> (set in
          Operations -&gt; Settings -&gt; Matching defaults, currently 20)
          with directory therapists above the patient's threshold. If it
          only finds, say, 12, the system flags the request as needing
          outreach and fires the recruiter <strong>automatically</strong>
          in the background. No admin click required. (The "Run LLM outreach
          now" button in Request detail is just for re-running it manually.)
        </Step>

        <Step n="2" title="Discovery cascade">
          The agent then hits four sources in order, each one only running if
          the previous didn't fill the gap:
          <ul className="list-disc pl-5 mt-2 space-y-1 text-[#2B2A29]">
            <li><strong>Psychology Today scrape</strong> -- pulls real
              therapist names + cities + specialties for the patient's state.
              Discovery only -- no contact info.</li>
            <li><strong>Admin-registered external directories</strong> --
              any URLs you've added in Operations -&gt; Scrape sources get
              scraped.</li>
            <li><strong>Backup directories in parallel</strong> --
              TherapyDen, GoodTherapy (HTML scrape), and Google Maps Places
              API (needs API key, see "Current config" below).</li>
            <li><strong>LLM fallback</strong> -- Claude suggests Idaho
              therapist names from training data. Names only, no contact
              info (so we never invite a fabricated email).</li>
          </ul>
        </Step>

        <Step n="3" title="Contact enrichment (this is where real emails come from)">
          Every candidate from steps above flows through the contact enricher:
          <ul className="list-disc pl-5 mt-2 space-y-1 text-[#2B2A29]">
            <li>Google Places API -&gt; real phone + website (when the
              API key is set).</li>
            <li>Direct website scrape -&gt; pulls <code>mailto:</code> links
              and visible-text emails from the therapist's actual site.</li>
            <li>Filters out junk (Sentry, social media, directory mailboxes,
              <code>noreply@</code>, etc.).</li>
          </ul>
          <p className="mt-2 text-[#2B2A29]">
            If a candidate has no real email AND no real phone after
            enrichment, they're silently dropped -- we never send to fake
            <code> info@</code> guesses.
          </p>
        </Step>

        <Step n="4" title="Invite + landing">
          Each enriched candidate gets the <em>new_referral_inquiry</em>
          email (editable in Content -&gt; Email templates) with a
          sanitized patient brief (no PII) and a signup link pre-stamped
          with a <code>recruit_code</code>. If they sign up, their therapist
          doc gets <code>source = "gap_recruit_signup"</code> so we can
          attribute conversion. They show up in the
          <strong> "Invited therapists" </strong> tab while their invite is open.
        </Step>

        <Step n="5" title="Opt-out">
          Every outgoing invite has a one-click opt-out URL. Clicking it
          adds them to the <strong>"Opt-outs"</strong> tab and they never
          get another invite. Twilio SMS opt-outs (STOP keyword) also
          flow through this list.
        </Step>
      </Section>

      {/* ============= TRACK 2: PROACTIVE ============= */}
      <Section
        icon={<Sparkles size={18} className="text-[#2D4A3E]" />}
        title="Track 2 -- Proactive network building (independent of any single patient)"
        accent="#EAF2E8"
      >
        <Item icon={<Clock size={14} />} title="Daily gap recruitment (cron)">
          Runs once a day, looks at which specialties / cities / age groups
          your directory is thinnest on, and queues outreach drafts for the
          biggest gaps. Max 10 drafts/day. Currently runs in
          <strong> dry-run mode (drafts only, no emails sent)</strong> --
          this is the right pre-launch posture; we'll want to flip it live
          shortly after launch.
        </Item>

        <Item icon={<Sparkles size={14} />} title="Weekly auto-recruit cycle (cron)">
          Once a week, runs the matching simulator to find patient profiles
          that currently get zero matches, builds a recruitment plan against
          those gaps, calls the gap recruiter, and stamps drafts for admin
          approval. Self-skips when the zero-pool rate is already at target,
          so it doesn't churn when the directory is healthy.
        </Item>

        <Item icon={<Mail size={14} />} title="Refer-a-colleague">
          Every therapist gets a unique <code>referral_code</code> at signup,
          visible in their portal. When a new therapist signs up using that
          code, the original therapist gets attributed
          (<code>referred_by_code</code> on the new doc). Attribution works;
          <strong> no automatic payout/reward is wired yet</strong> -- you'd
          set that up if/when you want a referral incentive.
        </Item>

        <Item icon={<Search size={14} />} title="Public therapist signup">
          <code>/therapist/signup</code> is always-on, no invite gate.
          Cloudflare Turnstile + honeypot + IP rate-limit protect against
          bots. Anyone (referrer, walk-in, cold lead) can sign up at any
          time.
        </Item>

        <Item icon={<CheckCircle2 size={14} />} title="One-time xlsx seed (already done)">
          The initial directory was populated from your xlsx import.
          That's static seed data -- there's no ongoing import sync.
          Real emails for those providers live in their
          <code> real_email</code> field, ready to be promoted via the
          launch-day restoration card in Test actions.
        </Item>
      </Section>

      {/* ============= CURRENT CONFIG STATUS ============= */}
      <Section
        icon={<AlertTriangle size={18} className="text-[#C8923A]" />}
        title="Current config -- what's live, what needs setup"
        accent="#FBEFE9"
      >
        <ConfigRow
          status="ok"
          label="Auto-outreach"
          detail="OUTREACH_AUTO_RUN=true -- when a request has fewer matches than max-invites, outreach fires automatically in the background."
        />
        <ConfigRow
          status="ok"
          label="Psychology Today scrape (discovery)"
          detail="PT_SCRAPING_ENABLED=true. Returns real therapist names + cities + specialties. Verified live against PT's Boise listings."
        />
        <ConfigRow
          status="ok"
          label="Contact enricher (real-email finder)"
          detail="Wired into the live outreach flow as of 2026-05-12. Scrapes therapist websites for mailto: + visible emails, filters junk domains, drops candidates with no real contact info before sending."
        />
        <ConfigRow
          status="warn"
          label="Google Places API"
          detail="GOOGLE_PLACES_API_KEY must be set in Render env for the highest-quality contact source. Without it, the enricher falls back to direct website scraping only (still works when a candidate has a known website, but coverage drops). Action: enable the 'Places API (New)' in Google Cloud Console, generate an API key, add it to Render env."
        />
        <ConfigRow
          status="warn"
          label="Daily gap-recruit cron"
          detail="Currently dry-run -- creates draft outreach campaigns but doesn't send. Flip to live once you're confident in the early-launch volume. (Backend: gap_recruiter.run_gap_recruitment(dry_run=False) in cron.py)"
        />
        <ConfigRow
          status="warn"
          label="Refer-a-colleague payout"
          detail="Attribution is wired (we know who referred who). No automatic reward is applied. Decide if/what you want to offer (account credit, discount, branded swag) and wire it as needed."
        />
        <ConfigRow
          status="gap"
          label="Non-active therapist drip campaign"
          detail="None today. We do NOT have a 'we miss you' / 'profile incomplete' nurture sequence for stale therapists. If retention/reactivation becomes important, this is net-new work."
        />
        <ConfigRow
          status="ok"
          label="Resend bounce handling"
          detail="Inbound webhooks track hard bounces and unsubscribes -- bounced emails get flagged so we stop retrying. Visible per-therapist in their provider preview."
        />
      </Section>

      {/* ============= QUICK TEST HOW-TO ============= */}
      <Section
        icon={<Search size={18} className="text-[#2D4A3E]" />}
        title="How to test the pipeline without sending real emails"
        accent="#F5F1E8"
      >
        <p className="text-sm text-[#2B2A29] leading-relaxed">
          The admin <strong>scraper-test endpoint</strong> runs the entire
          discovery + enrichment pipeline against a city/state/specialty
          combo and shows you exactly which candidates would be found and
          which real contact info the enricher extracted -- without
          actually sending anything. Useful for:
        </p>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-[#2B2A29]">
          <li>Verifying a new market (e.g. "what would Twin Falls outreach look like?").</li>
          <li>Confirming the Places API key is working after you add it.</li>
          <li>Sanity-checking a new external scrape source you've registered.</li>
        </ul>
        <p className="text-xs text-[#6D6A65] italic mt-3 leading-relaxed">
          Endpoint: <code>POST /api/admin/scraper-test</code> with
          {" "}<code>&#123; city, state, presenting_issues, count &#125;</code>.
          Poll <code>GET /api/admin/scraper-jobs/&#123;job_id&#125;</code> for
          progress + final candidate list. (No frontend button for this yet --
          it's currently API-only; let me know if you want a UI for it.)
        </p>
      </Section>
    </div>
  );
}

function Section({ icon, title, accent, children }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <div
        className="px-6 py-4 flex items-start gap-3 border-b border-[#E8E5DF]"
        style={{ backgroundColor: accent }}
      >
        <div className="mt-0.5">{icon}</div>
        <h3 className="font-serif-display text-xl text-[#2D4A3E]">{title}</h3>
      </div>
      <div className="p-6 space-y-4 text-sm text-[#2B2A29] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center text-xs font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[#2D4A3E]">{title}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function Item({ icon, title, children }) {
  return (
    <div className="border-l-2 border-[#E8E5DF] pl-4 py-1">
      <div className="font-semibold text-[#2D4A3E] flex items-center gap-2">
        <span className="text-[#6D6A65]">{icon}</span>
        {title}
      </div>
      <div className="mt-1 text-[#2B2A29]">{children}</div>
    </div>
  );
}

function ConfigRow({ status, label, detail }) {
  const styles = {
    ok:   { dot: "#4A6B5D", label: "Live",        bg: "#EAF2E8" },
    warn: { dot: "#C8923A", label: "Needs setup", bg: "#FBEFE9" },
    gap:  { dot: "#9C9893", label: "Not built",   bg: "#F2EFE8" },
  };
  const s = styles[status] || styles.gap;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 items-start border-b border-[#F2EFE8] last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-center gap-2 min-w-[140px]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: s.dot }}
        />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5"
          style={{ color: s.dot, backgroundColor: s.bg }}
        >
          {s.label}
        </span>
      </div>
      <div>
        <div className="font-semibold text-[#2D4A3E]">{label}</div>
        <div className="text-[#2B2A29] mt-0.5">{detail}</div>
      </div>
    </div>
  );
}
