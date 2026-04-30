import { AlertTriangle, ChevronRight } from "lucide-react";
import { Th } from "./_shared";

// Coverage threshold — when notified_count drops below this, the row
// gets a red "low coverage" warning so the admin can scan a long
// requests list and immediately see which patients we under-served.
// Mirrors the 30-target used by the matching simulator + hard-capacity
// guard.
const TARGET_NOTIFIED = 30;

// Renders the "Requests" admin tab: the wide table with one row per
// patient request. Click a row to open the detail dialog.
export default function RequestsPanel({
  requests,
  filteredRequests,
  openDetail,
  StatusBadge,
}) {
  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <table className="w-full text-sm" data-testid="requests-table">
        <thead className="bg-[#FDFBF7] text-[#6D6A65]">
          <tr className="text-left">
            <Th>Email</Th>
            <Th>Age / State</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Notified</Th>
            <Th>Apps</Th>
            <Th>Invited</Th>
            <Th>Threshold</Th>
            <Th>Created</Th>
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
          {filteredRequests.map((r) => {
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
                {r.client_age} / {r.location_state}
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
              <td className="p-4">{r.threshold}%</td>
              <td className="p-4 text-xs text-[#6D6A65]">
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td className="p-4 text-[#6D6A65]">
                <ChevronRight size={16} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
