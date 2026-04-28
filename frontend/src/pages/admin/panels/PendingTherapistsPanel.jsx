import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

// "Pending therapists" tab — list of signups awaiting approval. The
// PendingSignupRow component still lives in AdminDashboard.jsx (it's
// large + tightly coupled to the edit modal); we just thread the
// callbacks through.
export default function PendingTherapistsPanel({
  client,
  pendingTherapists,
  filteredPendingTherapists,
  PendingSignupRow,
  onApprove,
  onReject,
  onEdit,
  onReload,
}) {
  const [running, setRunning] = useState(false);
  const dupCount = pendingTherapists.filter(
    (t) => (t.value_summary || {}).is_duplicate_only,
  ).length;

  const autoDecline = async () => {
    if (
      !window.confirm(
        `Auto-decline ${dupCount} applicant${dupCount === 1 ? "" : "s"} whose ` +
          "every coverage axis already has 5+ active providers? Each will be " +
          "rejected and sent the standard rejection email.",
      )
    )
      return;
    setRunning(true);
    try {
      const r = await client.post(
        "/admin/therapists/auto-decline-duplicates",
        {},
      );
      toast.success(
        `Auto-declined ${r.data.matched} duplicate-roster applicant${
          r.data.matched === 1 ? "" : "s"
        }.`,
      );
      onReload?.();
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Auto-decline failed",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-6 space-y-3">
      {dupCount > 0 && (
        <div
          className="bg-[#FDF1EF] border border-[#F2C9C0] rounded-2xl p-4 flex items-start gap-3 flex-wrap"
          data-testid="auto-decline-duplicates-banner"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[#D45D5D]">
              {dupCount} pending applicant{dupCount === 1 ? "" : "s"} cover
              only axes we already have 5+ providers for.
            </div>
            <div className="text-xs text-[#6D6A65] mt-0.5">
              Approving them risks diluting referrals to existing therapists.
              Auto-decline sends each a polite rejection email.
            </div>
          </div>
          <button
            type="button"
            onClick={autoDecline}
            disabled={running}
            className="bg-[#D45D5D] hover:bg-[#B84848] text-white text-sm rounded-full px-4 py-2 disabled:opacity-50 inline-flex items-center gap-1.5"
            data-testid="auto-decline-duplicates-btn"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Auto-decline {dupCount}
          </button>
        </div>
      )}

      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        {pendingTherapists.length === 0 ? (
          <div className="p-12 text-center text-[#6D6A65]">
            No therapist signups awaiting review.
          </div>
        ) : (
          <div
            className="divide-y divide-[#E8E5DF]"
            data-testid="pending-therapists-list"
          >
            {filteredPendingTherapists.map((t) => (
              <PendingSignupRow
                key={t.id}
                t={t}
                onApprove={() => onApprove(t.id)}
                onReject={() => onReject(t.id)}
                onEdit={() => onEdit(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
