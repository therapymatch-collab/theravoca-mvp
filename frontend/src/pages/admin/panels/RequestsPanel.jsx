import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Th } from "./_shared";
import useAdminClient from "@/lib/useAdminClient";

// Coverage threshold — when notified_count drops below this, the row
// gets a red "low coverage" warning so the admin can scan a long
// requests list and immediately see which patients we under-served.
// Mirrors the 30-target used by the matching simulator + hard-capacity
// guard.
const TARGET_NOTIFIED = 30;

// Status filter options + the actual status sets they map to. Mirrors
// the activeRequestsCount logic in AdminDashboard.jsx -- "active" is
// non-terminal statuses, "matched_completed" + "terminal" cover the
// rest. The Active sub-pill click auto-selects "active" + flips date
// range to "all time" so admins immediately see the requests driving
// the red dot.
const STATUS_FILTERS = {
  all:                  { label: "All statuses",                                 statuses: null }, // null = no filter
  // 2026-05-18 -- review-gate filter. Special: filters on the
  // `admin_review_required` boolean rather than the `status` string.
  // Handled inline below.
  flagged_for_review:   { label: "⚠ Flagged for review",                         statuses: null, requireFlag: true },
  active:               { label: "Active (open + pending verification)",          statuses: ["open", "pending_verification"] },
  pending_verification: { label: "Pending verification",                          statuses: ["pending_verification"] },
  open:                 { label: "Open",                                          statuses: ["open"] },
  matched_completed:    { label: "Matched / completed",                           statuses: ["matched", "completed", "results_sent", "delivered"] },
  terminal:             { label: "Failed / cancelled / expired",                  statuses: ["failed", "cancelled", "expired"] },
};

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
  refresh,
}) {
  const client = useAdminClient();
  const [releasingId, setReleasingId] = useState(null);
  // Default date window: last 30 days (inclusive of today).
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
    [today],
  );
  const [startDate, setStartDate] = useState(toDateInput(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(toDateInput(today));
  // Status filter -- default "all" so existing behavior is unchanged.
  // Admin can scope to "active" / specific statuses via the dropdown.
  // See STATUS_FILTERS map at top of file.
  const [statusFilter, setStatusFilter] = useState("all");

  const fullyFilteredRequests = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    const cfg = STATUS_FILTERS[statusFilter];
    const statusSet = cfg?.statuses;
    const requireFlag = cfg?.requireFlag;
    return filteredRequests.filter((r) => {
      // Date range
      if (r.created_at) {
        const t = new Date(r.created_at).getTime();
        if (!Number.isNaN(t)) {
          if (startMs != null && t < startMs) return false;
          if (endMs != null && t > endMs) return false;
        }
      }
      // Status (null statusSet = "all", skip)
      if (statusSet) {
        const s = String(r.status || "").toLowerCase();
        if (!statusSet.includes(s)) return false;
      }
      // Soft-flag review gate (2026-05-18)
      if (requireFlag && !r.admin_review_required) return false;
      return true;
    });
  }, [filteredRequests, startDate, endDate, statusFilter]);

  // Count of requests currently gated behind admin review -- drives
  // a top-of-panel banner so admin sees the queue immediately.
  const flaggedCount = useMemo(
    () => requests.filter((r) => r.admin_review_required).length,
    [requests],
  );

  // POST /admin/requests/{id}/release. Clears the gate and (if the
  // patient already verified their email) triggers matching now.
  const releaseRequest = async (rid, e) => {
    e.stopPropagation(); // don't open the detail dialog
    setReleasingId(rid);
    try {
      const res = await client.post(`/admin/requests/${rid}/release`);
      if (res.data?.matching_triggered) {
        toast.success("Released — matching is running now.");
      } else if (res.data?.already_released) {
        toast.info("Already released.");
      } else {
        toast.success("Released. Matching will fire when the patient verifies their email.");
      }
      if (refresh) await refresh();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Release failed");
    } finally {
      setReleasingId(null);
    }
  };

  // Backward-compat alias for any code below that still references the
  // old name. Identical content.
  const dateFilteredRequests = fullyFilteredRequests;

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
      {/* Soft-flag review queue banner (2026-05-18). Visible whenever
          there's at least one request gated behind admin review.
          Clicking the chip auto-selects the "Flagged for review"
          status filter so the table shows just the queue. */}
      {flaggedCount > 0 && (
        <div
          className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
          data-testid="requests-flagged-banner"
        >
          <ShieldAlert size={18} className="text-[#8B3220] shrink-0" />
          <span className="text-[#8B3220]">
            <strong>{flaggedCount}</strong> request{flaggedCount === 1 ? "" : "s"} flagged for review — matching is paused until you release each one.
          </span>
          {statusFilter !== "flagged_for_review" && (
            <button
              type="button"
              onClick={() => setStatusFilter("flagged_for_review")}
              className="ml-auto text-xs font-semibold text-[#2D4A3E] underline hover:text-[#3A5E50]"
              data-testid="requests-flagged-filter-link"
            >
              Show flagged →
            </button>
          )}
        </div>
      )}

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

        {/* divider */}
        <span className="w-px h-5 bg-[#E8E5DF] mx-1" aria-hidden="true" />

        <span className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold">Status</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="requests-status-filter"
          className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-[#2D4A3E] ${
            statusFilter === "all"
              ? "border-[#E8E5DF] bg-white text-[#2B2A29]"
              : "border-[#2D4A3E] bg-[#2D4A3E] text-white font-medium"
          }`}
          title="Filter the table by request status. 'Active' = open + pending verification (drives the red dot on the Requests tab)."
        >
          {Object.entries(STATUS_FILTERS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>

        <span className="ml-auto text-xs text-[#6D6A65]">
          Showing <strong className="text-[#2B2A29]">{dateFilteredRequests.length}</strong> of {requests.length}
        </span>
      </div>

      {/* Helpful hint: filtered to "active" but the date range hides them all. */}
      {statusFilter === "active" && dateFilteredRequests.length === 0 && (
        (startDate || endDate) ? (
          <div className="bg-[#FCF6E5] border border-[#E8D7A6] rounded-xl px-4 py-2.5 text-sm text-[#6D5A29] flex items-center gap-3"
               data-testid="requests-active-empty-hint">
            <span>
              No active requests in this date range. They may be older &mdash;
              try widening the window.
            </span>
            <button
              type="button"
              onClick={clearDateRange}
              className="ml-auto text-xs font-semibold text-[#2D4A3E] underline"
            >
              Show all time
            </button>
          </div>
        ) : null
      )}

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
                  {r.admin_review_required && (
                    <ShieldAlert
                      size={14}
                      className="text-[#8B3220] shrink-0"
                      aria-label="Flagged for review — matching paused"
                      data-testid={`request-flagged-${r.id}`}
                    >
                      <title>
                        Flagged for review (risk score {r.risk_score || "?"}).
                        Matching is paused until you click Release.
                      </title>
                    </ShieldAlert>
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
                <div className="flex flex-col gap-1.5 items-start">
                  <StatusBadge s={r.status} verified={r.verified} />
                  {r.admin_review_required && (
                    <button
                      type="button"
                      onClick={(e) => releaseRequest(r.id, e)}
                      disabled={releasingId === r.id}
                      className="text-[11px] font-semibold bg-[#2D4A3E] text-white px-2.5 py-1 rounded-full hover:bg-[#3A5E50] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1 whitespace-nowrap"
                      title={
                        r.risk_signals
                          ? "Signals: " + Object.entries(r.risk_signals)
                              .map(([f, s]) => `${f}: ${(s || []).join(", ")}`)
                              .join(" | ")
                          : "Release this request to matching"
                      }
                      data-testid={`request-release-${r.id}`}
                    >
                      {releasingId === r.id ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />
                          Releasing...
                        </>
                      ) : (
                        "Release to matching"
                      )}
                    </button>
                  )}
                </div>
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
                title="Outreach invites sent for this request (Places + PT + directories)"
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
