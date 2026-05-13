import { useMemo, useState } from "react";
import { ChevronRight, Mail, MessageSquare, Search } from "lucide-react";
import EmailSafetyBanner from "./EmailSafetyBanner";

// Recruiting -> Per request (Track A).
// Lists patient requests that triggered an outreach run, with the
// per-channel send counts already computed by the outreach agent.
// Click a row to open the existing request detail dialog.
//
// Data source: the existing `requests` collection -- we look at
// `outreach_run_at`, `outreach_sent_count`, `outreach_sent_email_count`,
// `outreach_sent_sms_count` which are stamped by the agent when it runs.
export default function RecruitingPerRequestPanel({ requests, openDetail, client }) {
  const [search, setSearch] = useState("");

  const recruitingRuns = useMemo(() => {
    const withRun = (requests || []).filter((r) => r.outreach_run_at);
    if (!search) return withRun;
    const q = search.toLowerCase();
    return withRun.filter((r) =>
      [r.email, r.location_state, r.referral_source, r.id]
        .some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }, [requests, search]);

  return (
    <div className="mt-6 space-y-4" data-testid="recruiting-per-request-panel">
      <EmailSafetyBanner client={client} />
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="text-xs uppercase tracking-widest text-[#6D6A65] mb-1">
          Recruiting &middot; Track A
        </div>
        <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
          Per-request outreach
        </h2>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
          Auto-fires when an incoming patient request gets fewer than the target
          number of matches. Each row is a request whose outreach run has been
          completed; click a row for the full request detail (including the
          invited-therapist list).
        </p>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient email, state, source, request id..."
            className="w-full bg-white border border-[#E8E5DF] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2D4A3E]"
          />
        </div>
        <span className="ml-auto text-xs text-[#6D6A65]">
          <strong className="text-[#2B2A29]">{recruitingRuns.length}</strong> recruiting run(s)
        </span>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-[#6D6A65]">
            <tr className="text-left">
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Last run</th>
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Patient</th>
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">State</th>
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Sent</th>
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Email</th>
              <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">SMS</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {recruitingRuns.length === 0 && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-[#6D6A65]">
                  No per-request recruiting runs yet. A run fires automatically
                  when a request's matches fall below the target.
                </td>
              </tr>
            )}
            {recruitingRuns.map((r) => (
              <tr
                key={r.id}
                onClick={() => openDetail && openDetail(r.id)}
                className="border-t border-[#E8E5DF] cursor-pointer hover:bg-[#FDFBF7]"
              >
                <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                  {new Date(r.outreach_run_at).toLocaleString()}
                </td>
                <td className="p-4 text-[#2B2A29]">{r.email}</td>
                <td className="p-4 text-[#2B2A29]">{r.location_state || ""}</td>
                <td className="p-4 text-right font-semibold text-[#2D4A3E]">
                  {r.outreach_sent_count || 0}
                </td>
                <td className="p-4 text-right">
                  <span className="inline-flex items-center gap-1 text-[#2D4A3E]">
                    <Mail size={12} /> {r.outreach_sent_email_count || 0}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <span className="inline-flex items-center gap-1 text-[#C87965]">
                    <MessageSquare size={12} /> {r.outreach_sent_sms_count || 0}
                  </span>
                </td>
                <td className="p-4 text-[#6D6A65]">
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
