import { Send, Sparkles, Search, AlertTriangle, CheckCircle2, ArrowRight, Inbox, Target, MapPin, Zap } from "lucide-react";
import ScraperTestPanel from "@/pages/admin/panels/ScraperTestPanel";

// Recruiting tab -- plain-English explainer of how TheraVoca grows its
// therapist directory. Organized around the two distinct tracks the
// founder cares about: REACTIVE (recruits triggered by a specific
// patient request) and PROACTIVE (general gap-fill independent of any
// request). Each track gets a parallel card so the differences are
// at-a-glance comparable.
//
// Pure documentation panel -- no live API fetches. Pointers send the
// admin to the existing data tabs (Invited therapists, Coverage gaps).
export default function RecruitingPanel({ client }) {
  return (
    <div className="mt-6 space-y-5" data-testid="recruiting-panel">
      {/* ============= HEADER ============= */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="text-xs uppercase tracking-widest text-[#6D6A65] mb-1">
          Directory
        </div>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] leading-tight">
          Recruiting
        </h2>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          How we grow the therapist directory. There are two separate
          tracks running side by side -- one fires per patient request,
          the other runs on a schedule to keep the network healthy.
        </p>
      </div>

      {/* ============= TWO PARALLEL TRACK CARDS ============= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrackCard
          accent="#FBE9E5"
          accentText="#8B3220"
          icon={<Zap size={20} className="text-[#8B3220]" />}
          kicker="Track A"
          title="Per patient request"
          subtitle="REACTIVE -- fires when matching can't fill a specific request"
          rows={[
            { label: "When", value: "Automatically, right after matching runs. If the engine finds fewer therapists above threshold than max-invites (currently 20), outreach fires in the background. No admin click needed." },
            { label: "Who we target", value: "Therapists who exactly fit THIS patient's specialty, location, modality, and matching threshold. The brief is sanitized first -- no PII shared." },
            { label: "Discovery sources", value: "Psychology Today scrape -> admin-registered directories -> backup scrapers (TherapyDen, GoodTherapy, Google Maps). Each phase only runs if the previous one didn't fill the gap. LLM fallback was retired 2026-05-12 -- we only invite therapists from real public listings now." },
            { label: "Email finder", value: "After discovery, every candidate runs through the contact enricher (Google Places API + scrape of the therapist's actual website for mailto: links). Candidates with no real email AND no real phone are silently dropped -- we never send to guessed addresses." },
            { label: "Email template", value: "\"New referral inquiry\" -- edit in Content -> Email templates." },
            { label: "See live data", value: "Directory -> Invited therapists shows every per-request invite, channel, and send status.", link: "invited_therapists" },
          ]}
          statusBadge={{ status: "ok", label: "Live" }}
        />

        <TrackCard
          accent="#EAF2E8"
          accentText="#2D4A3E"
          icon={<Target size={20} className="text-[#2D4A3E]" />}
          kicker="Track B"
          title="General gap-fill"
          subtitle="PROACTIVE -- runs on a schedule, independent of any single patient"
          rows={[
            { label: "When", value: "Daily gap-recruit (max 10 drafts/day) finds underserved specialty/city/age-group combos. Weekly auto-recruit cycle runs the matching simulator to find patient profiles that get ZERO matches and queues recruits against those gaps." },
            { label: "Who we target", value: "Therapists who would close a coverage hole in the directory, even when no specific patient is waiting. E.g. \"we have zero EMDR-trained LCSWs in Coeur d'Alene -- recruit some.\"" },
            { label: "Discovery sources", value: "Same cascade as Track A (PT -> external dirs -> backup scrapers) but seeded by the gap profile instead of a patient request." },
            { label: "Email finder", value: "Same contact enricher as Track A -- Google Places + website mailto/text scrape. Guessed emails get cleared before sending." },
            { label: "Email template", value: "\"Gap-recruit invite\" -- edit in Content -> Email templates." },
            { label: "See live data", value: "Directory -> Coverage gaps shows the gap analysis + queued drafts awaiting your approval.", link: "coverage_gap" },
          ]}
          statusBadge={{ status: "warn", label: "Dry-run (drafts only)" }}
        />
      </div>

      {/* ============= SHARED FUNNEL ============= */}
      <Section
        icon={<ArrowRight size={18} className="text-[#2D4A3E]" />}
        title="What happens after a candidate is identified (both tracks)"
        accent="#F5F1E8"
      >
        <FunnelStep
          n="1"
          title="Contact enrichment"
          body="Google Places API returns phone + website. We then scrape the website's HTML for mailto: links + visible-text emails. Junk domains (Sentry, social media, noreply@) are filtered out. If nothing real is found, the candidate is dropped before any send."
        />
        <FunnelStep
          n="2"
          title="Invite sent"
          body="Personalized email (per-track template, both editable in Content -> Email templates) with a sanitized brief and a signup link pre-stamped with a recruit_code. SMS fallback via Twilio if no real email was found but phone is real."
        />
        <FunnelStep
          n="3"
          title="One of three outcomes"
          body={
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li><strong>Signs up</strong> -- their therapist doc is created with source = gap_recruit_signup; conversion shows in Operations -> Referrals.</li>
              <li><strong>Opts out</strong> -- one-click unsubscribe link adds them to Directory -> Opt-outs; never contacted again.</li>
              <li><strong>Silent</strong> -- no follow-up unless a later high-fit patient comes through. We don't drip.</li>
            </ul>
          }
        />
      </Section>

      {/* ============= CURRENT CONFIG ============= */}
      <Section
        icon={<AlertTriangle size={18} className="text-[#C8923A]" />}
        title="System config -- what's live, what needs setup"
        accent="#FBEFE9"
      >
        <ConfigRow
          status="ok"
          label="Track A (per-request) auto-outreach"
          detail="OUTREACH_AUTO_RUN=true. Fires automatically whenever a request has fewer matches than max-invites."
        />
        <ConfigRow
          status="ok"
          label="Psychology Today discovery"
          detail="PT_SCRAPING_ENABLED=true. Returns real therapist names + cities + specialties. Verified live."
        />
        <ConfigRow
          status="ok"
          label="Contact enricher (real-email finder)"
          detail="Wired into the live flow 2026-05-12. Scrapes therapist websites for mailto: + visible emails, filters junk. Drops candidates with no real contact before sending."
        />
        <ConfigRow
          status="warn"
          label="Google Places API key"
          detail="GOOGLE_PLACES_API_KEY must be set in Render env. Without it, the enricher falls back to direct website scraping only -- coverage drops. Action: enable 'Places API (New)' in Google Cloud Console, generate a key, add to Render env."
        />
        <ConfigRow
          status="warn"
          label="Track B (proactive gap-recruit)"
          detail="Currently runs in dry-run mode -- creates drafts but doesn't send emails. Flip to live in cron.py (run_gap_recruitment dry_run=False) when you're ready for ongoing automated recruiting outside of patient requests."
        />
        <ConfigRow
          status="warn"
          label="Refer-a-colleague payout"
          detail="Attribution wired (we know who referred who). No automatic reward is applied. Decide on incentive structure (credit, discount, swag) and wire when ready."
        />
        <ConfigRow
          status="gap"
          label="Re-engagement drip for inactive therapists"
          detail="Not built. No 'we miss you' / 'profile incomplete' nurture sequence. If retention becomes a priority, this is net-new work."
        />
      </Section>

      {/* ============= LIVE TEST ============= */}
      <Section
        icon={<Search size={18} className="text-[#2D4A3E]" />}
        title="Live test -- run the pipeline against a real city right now"
        accent="#F2F4F0"
      >
        <ScraperTestPanel client={client} />
      </Section>
    </div>
  );
}

// ============= subcomponents =============

function TrackCard({ accent, accentText, icon, kicker, title, subtitle, rows, statusBadge }) {
  return (
    <div
      className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden flex flex-col"
      data-testid={`track-card-${kicker.toLowerCase().replace(/\s/g, "-")}`}
    >
      <div className="px-5 py-4 border-b border-[#E8E5DF]" style={{ backgroundColor: accent }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-1">{icon}</div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: accentText }}>
                {kicker}
              </div>
              <div className="font-serif-display text-xl text-[#2D4A3E] leading-tight mt-0.5">
                {title}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] mt-1">
                {subtitle}
              </div>
            </div>
          </div>
          <StatusPill {...statusBadge} />
        </div>
      </div>
      <div className="p-5 space-y-3 text-sm flex-1">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[110px_1fr] gap-3">
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] pt-0.5">{r.label}</div>
            <div className="text-[#2B2A29] leading-relaxed">
              {r.value}
              {r.link && (
                <span className="text-[#6D6A65] italic ml-1">
                  (sub-tab id: <code className="text-[10px]">{r.link}</code>)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelStep({ n, title, body }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center text-xs font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[#2D4A3E] text-sm">{title}</div>
        <div className="mt-0.5 text-sm text-[#2B2A29] leading-relaxed">{body}</div>
      </div>
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
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function StatusPill({ status, label }) {
  const styles = {
    ok:   { dot: "#4A6B5D", bg: "#EAF2E8" },
    warn: { dot: "#C8923A", bg: "#FBEFE9" },
    gap:  { dot: "#9C9893", bg: "#F2EFE8" },
  };
  const s = styles[status] || styles.gap;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-1 shrink-0"
      style={{ color: s.dot, backgroundColor: s.bg, borderColor: s.dot }}
    >
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.dot }} />
      {label}
    </span>
  );
}

function ConfigRow({ status, label, detail }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 items-start border-b border-[#F2EFE8] last:border-b-0 pb-3 last:pb-0">
      <div className="min-w-[140px]">
        <StatusPill status={status} label={status === "ok" ? "Live" : status === "warn" ? "Needs setup" : "Not built"} />
      </div>
      <div>
        <div className="font-semibold text-[#2D4A3E] text-sm">{label}</div>
        <div className="text-[#2B2A29] text-sm mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}
