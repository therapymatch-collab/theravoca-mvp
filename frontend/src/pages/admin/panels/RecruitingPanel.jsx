import { useEffect, useState } from "react";
import { Send, Sparkles, Search, AlertTriangle, CheckCircle2, ArrowRight, Inbox, Target, MapPin, Zap, Mail, Loader2 } from "lucide-react";
import ScraperTestPanel from "@/pages/admin/panels/ScraperTestPanel";

// Recruiting tab -- plain-English explainer of how TheraVoca grows its
// therapist directory. Organized around the two distinct tracks the
// founder cares about: REACTIVE (recruits triggered by a specific
// patient request) and PROACTIVE (general gap-fill independent of any
// request). Each track gets a parallel card so the differences are
// at-a-glance comparable.
//
// The "System config" section pulls live status from
// GET /admin/recruiting-status so the badges (Live / Needs setup / Not
// built) reflect actual env + code state, not hardcoded values.
export default function RecruitingPanel({ client }) {
  const [statusRows, setStatusRows] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    (async () => {
      setStatusLoading(true);
      try {
        const r = await client.get("/admin/recruiting-status");
        if (alive) setStatusRows(r.data?.rows || []);
      } catch {
        if (alive) setStatusRows([]);
      } finally {
        if (alive) setStatusLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [client]);

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
            { label: "Discovery sources", value: "Google Places (primary, returns name + website + phone in one call) -> Psychology Today (catches non-Google therapists, adds specialty tags) -> admin-registered directories -> backup HTML scrapers (TherapyDen, GoodTherapy). Each phase only runs if the previous one didn't fill the gap." },
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
            { label: "Discovery sources", value: "Same cascade as Track A (Places primary -> PT -> external dirs -> backup HTML scrapers) but seeded by the gap profile instead of a patient request." },
            { label: "Email finder", value: "Same contact enricher as Track A -- Google Places + website mailto/text scrape. Guessed emails get cleared before sending." },
            { label: "Email template", value: "\"Gap-recruit invite\" -- edit in Content -> Email templates." },
            { label: "See live data", value: "Directory -> Coverage gaps shows the gap analysis + queued drafts awaiting your approval.", link: "coverage_gap" },
          ]}
          statusBadge={{ status: "warn", label: "Dry-run (drafts only)" }}
        />
      </div>

      {/* ============= WHERE REAL EMAILS COME FROM ============= */}
      <Section
        icon={<Mail size={18} className="text-[#2D4A3E]" />}
        title="Where real emails actually come from (directories don't expose them)"
        accent="#EAF2E8"
      >
        <p className="text-sm text-[#2B2A29] leading-relaxed">
          Common misconception: that the recruiting system pulls emails directly
          from the directory listing. <strong>It doesn't.</strong> Psychology
          Today hides emails behind a contact form. Google Places API never
          returns email. TherapyDen + GoodTherapy don't expose them either.
          So how does the pipeline get real addresses?
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold pt-1">Step 1</div>
          <div className="text-[#2B2A29]">
            <strong>Directory gives us a name + website link.</strong> PT
            profiles usually link to the therapist's own external site.
            Places returns <code>websiteUri</code>. TherapyDen / GoodTherapy
            do the same. <em>No email yet -- just a starting point.</em>
          </div>

          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold pt-1">Step 2</div>
          <div className="text-[#2B2A29]">
            <strong>We scrape the therapist's OWN website.</strong> The
            enricher fetches the HTML and pulls emails from three sources,
            in priority order:
            <ol className="list-decimal pl-5 mt-1.5 space-y-0.5">
              <li><code>mailto:</code> href links (highest signal -- intentionally placed).</li>
              <li>Visible-text emails matching the regex on the rendered page.</li>
              <li>Email patterns anywhere in the raw HTML (catches obfuscated/scripted addresses).</li>
            </ol>
            Filters: junk domains (Sentry, social media, googletagmanager),
            <code> noreply@</code>, directory mailboxes, image/asset
            extensions. Then prefers emails whose domain matches the website
            domain (so <code>dr.smith@drsmithcounseling.com</code> beats
            {" "}<code>info@webhosting-corp.com</code>).
          </div>

          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold pt-1">Step 3</div>
          <div className="text-[#2B2A29]">
            <strong>If the website doesn't have a visible email</strong>
            {" "}(many therapist sites use contact forms only), SMS fallback
            kicks in. If Google Places returned a real phone, the invite goes
            out via Telnyx SMS with a shorter body and the same opt-out URL.
          </div>

          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold pt-1">Step 4</div>
          <div className="text-[#2B2A29]">
            <strong>If we have neither email nor phone, the candidate is
            silently dropped</strong> before any send. We never invent
            {" "}<code>info@&lt;domain&gt;</code> addresses or guess.
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold mb-2">
            Scenario -&gt; outcome summary
          </div>
          <div className="border border-[#E8E5DF] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FDFBF7] text-left text-xs text-[#6D6A65] uppercase tracking-wider">
                  <th className="px-3 py-2">Therapist has...</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody>
                <ScenarioRow
                  scenario="Website with mailto: link"
                  outcome="Email invite to the real address."
                  tone="ok"
                />
                <ScenarioRow
                  scenario="Website with visible email in text"
                  outcome="Email invite to that address."
                  tone="ok"
                />
                <ScenarioRow
                  scenario="Website but no email exposed (contact form only)"
                  outcome="SMS invite to phone from Google Places (if available)."
                  tone="ok"
                />
                <ScenarioRow
                  scenario="No website, but phone in Google Places"
                  outcome="SMS invite to that phone."
                  tone="ok"
                />
                <ScenarioRow
                  scenario="No website AND no phone"
                  outcome="Silently dropped -- no invite sent."
                  tone="warn"
                />
                <ScenarioRow
                  scenario="Backup scraper guessed info@<domain>"
                  outcome="Pre-cleared before enrichment, then treated like 'no email'. Falls to SMS or drop."
                  tone="ok"
                />
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-[#6D6A65] italic mt-4 leading-relaxed">
          This is why <strong>GOOGLE_PLACES_API_KEY</strong> matters so much
          -- without it, we lose the most reliable source of real phone
          numbers, which is the SMS fallback when a website doesn't expose
          an email. Many small-practice therapists fall into the
          "website-but-no-mailto" bucket, so SMS coverage is the difference
          between recruiting them and dropping them.
        </p>
      </Section>

      {/* ============= SHARED FUNNEL ============= */}
      <Section
        icon={<ArrowRight size={18} className="text-[#2D4A3E]" />}
        title="What happens after a candidate has real contact info"
        accent="#F5F1E8"
      >
        <FunnelStep
          n="1"
          title="Invite sent"
          body="Personalized email (per-track template, both editable in Content -> Email templates) with a sanitized brief and a signup link pre-stamped with a recruit_code. SMS fallback via Telnyx if no real email was found but phone is real."
        />
        <FunnelStep
          n="2"
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

      {/* ============= CURRENT CONFIG -- LIVE STATUS ============= */}
      <Section
        icon={<AlertTriangle size={18} className="text-[#C8923A]" />}
        title="System config -- what's live, what needs setup"
        accent="#FBEFE9"
      >
        {statusLoading && (
          <div className="text-sm text-[#6D6A65] flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Checking live env state...
          </div>
        )}
        {!statusLoading && (statusRows || []).length === 0 && (
          <div className="text-sm text-[#6D6A65]">
            Couldn't load live status (admin endpoint failed). Refresh the page or
            check the network tab.
          </div>
        )}
        {!statusLoading && (statusRows || []).map((row) => (
          <ConfigRow
            key={row.key}
            status={row.status}
            label={row.label}
            detail={row.detail}
          />
        ))}
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

function ScenarioRow({ scenario, outcome, tone }) {
  const cls = tone === "warn"
    ? "border-t border-[#F4C7BE] bg-[#FBE9E5]"
    : "border-t border-[#E8E5DF]";
  return (
    <tr className={cls}>
      <td className="px-3 py-2 text-[#2B2A29]">{scenario}</td>
      <td className={`px-3 py-2 ${tone === "warn" ? "text-[#8B3220] font-medium" : "text-[#2B2A29]"}`}>
        {outcome}
      </td>
    </tr>
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
