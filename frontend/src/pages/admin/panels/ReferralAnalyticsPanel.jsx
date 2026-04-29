import { Loader2 } from "lucide-react";
import { FactStat } from "./_panelShared";

// Patient + therapist referral chains, "How did you hear about us?"
// breakdown, and gap-recruit conversion attribution. Pure presentational
// component — all data is fetched in AdminDashboard and passed down.
export default function ReferralAnalyticsPanel({ data, loading, onReload }) {
  if (loading || !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
        Loading referral analytics…
      </div>
    );
  }
  const { patient_referrals: pr, therapist_referrals: tr, referral_sources: srcs, gap_recruit: gr } = data;
  return (
    <div className="mt-6 space-y-6" data-testid="referral-analytics-panel">
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            Referral analytics
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Tracks patient-to-patient invites, therapist refer-a-colleague chains,
            intake-form &ldquo;how did you hear&rdquo; breakdown, and gap-recruit
            conversion attribution.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
          data-testid="referrals-refresh-btn"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FactStat label="Patient referrals" value={pr.total_invited} />
        <FactStat label="Patient referrers" value={pr.unique_referrers} />
        <FactStat label="Therapist referrals" value={tr.total_invited} />
        <FactStat label="Therapist referrers" value={tr.unique_referrers} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
            Top patient referrers
          </div>
          {pr.top.length === 0 ? (
            <div className="text-sm text-[#6D6A65]">No patient invites yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {pr.top.map((r) => (
                <li key={r.code} className="flex items-center justify-between text-sm gap-2">
                  <span className="font-mono text-[11px] text-[#6D6A65] shrink-0">{r.code}</span>
                  <span className="flex-1 truncate text-[#2B2A29]">{r.inviter_email}</span>
                  <span className="font-mono text-[#2D4A3E] tabular-nums">{r.invited_count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
            Top therapist referrers
          </div>
          {tr.top.length === 0 ? (
            <div className="text-sm text-[#6D6A65]">No therapist invites yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {tr.top.map((r) => (
                <li key={r.code} className="flex items-center justify-between text-sm gap-2">
                  <span className="font-mono text-[11px] text-[#6D6A65] shrink-0">{r.code}</span>
                  <span className="flex-1 truncate text-[#2B2A29]">{r.inviter_name}</span>
                  <span className="font-mono text-[#2D4A3E] tabular-nums">{r.invited_count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
          Intake &ldquo;How did you hear?&rdquo; breakdown
        </div>
        {Object.keys(srcs).length === 0 ? (
          <div className="text-sm text-[#6D6A65]">No requests submitted yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(srcs).map(([k, v]) => {
              const total = Object.values(srcs).reduce((s, n) => s + n, 0) || 1;
              const pct = Math.round((v / total) * 100);
              return (
                <li key={k} className="flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0 truncate text-[#2B2A29]">{k}</div>
                  <div className="w-40 h-1.5 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden">
                    <div className="h-full bg-[#2D4A3E]" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-12 text-right text-[#6D6A65] tabular-nums">
                    {v} ({pct}%)
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
          Gap-recruit conversion (pre-launch)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FactStat label="Drafts queued" value={gr.total_drafts} />
          <FactStat label="Sent" value={gr.sent} />
          <FactStat label="Converted to signups" value={gr.converted} />
          <FactStat label="Conversion rate" value={`${gr.conversion_rate}%`} />
        </div>
        {gr.sent === 0 && (
          <p className="text-xs text-[#6D6A65] mt-3 italic">
            Conversion tracking activates once you go live and send real (non-dry-run) recruit emails.
          </p>
        )}
      </div>
    </div>
  );
}
