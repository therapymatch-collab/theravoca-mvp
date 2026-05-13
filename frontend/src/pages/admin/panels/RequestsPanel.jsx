import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Th } from "./_shared";

// Coverage threshold — when notified_count drops below this, the row
// gets a red "low coverage" warning so the admin can scan a long
// requests list and immediately see which patients we under-served.
// Mirrors the 30-target used by the matching simulator + hard-capacity
// guard.
const TARGET_NOTIFIED = 30;

// Build a YYYY-MM-DD string from a Date for use with <input type="date">.
function toDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Renders the "Requests" admin tab: the wide table with one row per
// patient request. Click a row to open the detail dialog.
export default function RequestsPanel({
  requests,
  filteredRequests,
  openDetail,
  StatusBadge,
}) {
  // Default date window: last 30 days (inclusive of today).
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
    [today],
  );
  const [startDate, setStartDate] = useState(toDateInput(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(toDateInput(today));

  const dateFilteredRequests = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    return filteredRequests.filter((r) => {
      if (!r.created_at) return true;
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t)) return true;
      if (startMs != null && t < startMs) return false;
      if (endMs != null && t > endMs) return false;
      return true;
    });
  }, [filteredRequests, startDate, endDate]);

  const resetDateRange = () => {
    setStartDate(toDateInput(thirtyDaysAgo));
    setEndDate(toDateInput(today));
  };
  const clearDateRange = () => {
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
        <span className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold">Date range</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="border border-[#E8E5DF] rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#2D4A3E]"
          data-testid="requests-date-start"
        />
        <span className="text-[#6D6A65]">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="border border-[#E8E5DF] rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#2D4A3E]"
          data-testid="requests-date-end"
        />
        <button
          type="button"
          onClick={resetDateRange}
          className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
        >
          Last 30 days
        </button>
        <button
          type="button"
          onClick={clearDateRange}
          className="text-xs text-[#6D6A65] underline hover:text-[#2D4A3E]"
        >
          All time
        </button>
        <span className="ml-auto text-xs text-[#6D6A65]">
          Showing <strong className="text-[#2B2A29]">{dateFilteredRequests.length}</strong> of {requests.length}
        </span>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <table className="w-full text-sm" data-testid="requests-table">
        <thead className="bg-[#FDFBF7] text-[#6D6A65]">
          <tr className="text-left">
            <Th>Date</Th>
            <Th>Email</Th>
            <Th>State</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Notified</Th>
            <Th>Apps</Th>
            <Th>Invited</Th>
            <Th>Threshold</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && (
            <tr>
              <td
                colSpan={10}
                className="p-10 text-center text-[#6D6A65]"
              >
                No requests yet.
              </td>
            </tr>
          )}
          {requests.length > 0 && dateFilteredRequests.length === 0 && (
            <tr>
              <td
                colSpan={10}
                className="p-10 text-center text-[#6D6A65]"
              >
                No requests in this date range.
              </td>
            </tr>
          )}
          {dateFilteredRequests.map((r) => {
            const notified = r.notified_count || 0;
            // Only flag the row when the request has progressed past
            // the matched stage — under-coverage isn't meaningful for
            // a request that's still draft/pending. Compare against
            // the 30-target.
            const isUnderCovered =
              notified > 0 &&
              notified < TARGET_NOTIFIED &&
              ["matched", "delivered", "results_sent"].includes(
                String(r.status || "").toLowerCase(),
              );
            return (
            <tr
              key={r.id}
              className={`border-t border-[#E8E5DF] cursor-pointer ${
                isUnderCovered
                  ? "bg-[#FBECE6]/40 hover:bg-[#FBECE6]/70"
                  : "hover:bg-[#FDFBF7]"
              }`}
              onClick={() => openDetail(r.id)}
              data-testid={`request-row-${r.id}`}
            >
              <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
              </td>
              <td className="p-4">
                <div className="text-[#2B2A29] font-medium flex items-center gap-1.5">
                  {isUnderCovered && (
                    <AlertTriangle
                      size={14}
                      className="text-[#C87965] shrink-0"
                      aria-label="Low match coverage"
                      data-testid={`request-low-coverage-${r.id}`}
                    >
                      <title>
                        Only {notified} of {TARGET_NOTIFIED} target therapists
                        notified — patient may see a thin shortlist.
                      </title>
                    </AlertTriangle>
                  )}
                  {r.email}
                </div>
                <div className="text-xs text-[#6D6A65]">
                  {r.id.slice(0, 8)}
                </div>
              </td>
              <td className="p-4 text-[#2B2A29]">
                {r.location_state || ""}
              </td>
              <td className="p-4">
                <StatusBadge s={r.status} verified={r.verified} />
              </td>
              <td
                className="p-4 text-xs text-[#2B2A29] max-w-[140px] truncate"
                title={r.referral_source || ""}
                data-testid={`request-referral-source-${r.id}`}
              >
                {r.referral_source || (
                  <span className="text-[#C8C4BB] italic">—</span>
                )}
              </td>
              <td
                className={`p-4 font-semibold ${
                  isUnderCovered ? "text-[#C87965]" : "text-[#2B2A29]"
                }`}
                title={
                  isUnderCovered
                    ? `Below 30-target — only ${notified} therapists notified`
                    : ""
                }
              >
                {notified}
                {isUnderCovered && (
                  <span className="text-xs font-normal text-[#C87965]">
                    {" "}
                    /{TARGET_NOTIFIED}
                  </span>
                )}
              </td>
              <td className="p-4 font-semibold text-[#2D4A3E]">
                {r.application_count || 0}
              </td>
              <td
                className="p-4 font-semibold text-[#C87965]"
                data-testid={`request-invited-count-${r.id}`}
                title="LLM outreach invites sent for this request"
              >
                {r.invited_count || 0}
              </td>
              <td className="p-4">{r.effective_threshold ?? r.threshold}%</td>
              <td className="p-4 text-[#6D6A65]">
                <ChevronRight size={16} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
