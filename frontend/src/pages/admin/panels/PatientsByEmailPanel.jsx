import { CheckCircle2 } from "lucide-react";

// "Patients by email" — every unique email that has filed at least one
// request, with submission counts and account-conversion status.
export default function PatientsByEmailPanel({ data, filter, onReload }) {
  const rows = data?.patients || [];
  const q = (filter || "").trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => (r.email || "").toLowerCase().includes(q))
    : rows;

  // Two summary stats: how many emails are repeat submitters (>=2 reqs)
  // and how many of those have actually converted to a tracked account.
  const repeatCount = rows.filter((r) => r.request_count >= 2).length;
  const accountCount = rows.filter((r) => r.has_password_account).length;

  return (
    <div
      className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
      data-testid="patients-panel"
    >
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF] flex-wrap">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Patients by email</h3>
          <p className="text-sm text-[#6D6A65] mt-1">
            Every unique email address that has filed at least one request, with
            how many they've submitted total.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#6D6A65]">
          <span data-testid="patients-stat-emails">
            <strong className="text-[#2D4A3E]">{rows.length}</strong> emails
          </span>
          <span data-testid="patients-stat-repeat">
            <strong className="text-[#C87965]">{repeatCount}</strong> repeat
          </span>
          <span data-testid="patients-stat-accounts">
            <strong className="text-[#2D4A3E]">{accountCount}</strong> with account
          </span>
          <button
            type="button"
            onClick={onReload}
            className="text-[#2D4A3E] hover:underline"
            data-testid="patients-reload"
          >
            Refresh
          </button>
        </div>
      </div>

      {!data && (
        <div className="p-10 text-center text-[#6D6A65]">Loading patient roster…</div>
      )}
      {data && visible.length === 0 && (
        <div className="p-10 text-center text-[#6D6A65]">
          {rows.length === 0 ? "No patient requests yet." : "No matches for that search."}
        </div>
      )}
      {data && visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[10px] uppercase tracking-wider text-[#6D6A65]">
              <tr>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-right px-4 py-3"># Requests</th>
                <th className="text-right px-4 py-3">Verified</th>
                <th className="text-right px-4 py-3">Matched</th>
                <th className="text-left px-4 py-3">Last request</th>
                <th className="text-left px-4 py-3">Latest source</th>
                <th className="text-center px-4 py-3">Account</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isRepeat = r.request_count >= 2;
                return (
                  <tr
                    key={r.email}
                    className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7]/50"
                    data-testid={`patient-row-${r.email}`}
                  >
                    <td className="px-4 py-3 text-[#2B2A29] font-medium break-all">
                      {r.email}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        isRepeat ? "text-[#C87965]" : "text-[#2B2A29]"
                      }`}
                    >
                      {r.request_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#6D6A65]">
                      {r.verified_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#6D6A65]">
                      {r.matched_count}
                    </td>
                    <td className="px-4 py-3 text-[#6D6A65] whitespace-nowrap">
                      {r.last_request_at
                        ? new Date(r.last_request_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-[#6D6A65] max-w-[220px] truncate">
                      {r.latest_referral_source || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.has_password_account ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E]">
                          <CheckCircle2 size={11} /> yes
                        </span>
                      ) : (
                        <span className="inline-flex text-xs px-2 py-0.5 rounded-full bg-[#E8E5DF] text-[#6D6A65]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
