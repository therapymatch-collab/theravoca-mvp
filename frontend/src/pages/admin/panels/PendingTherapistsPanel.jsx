import { Users } from "lucide-react";

// "Pending therapists" tab — list of signups awaiting approval. The
// PendingSignupRow component still lives in AdminDashboard.jsx (it's
// large + tightly coupled to the edit modal); we just thread the
// callbacks through.
export default function PendingTherapistsPanel({
  pendingTherapists,
  filteredPendingTherapists,
  PendingSignupRow,
  onApprove,
  onReject,
  onEdit,
}) {
  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      {pendingTherapists.length === 0 ? (
        <div className="p-12 text-center text-[#6D6A65]">
          <Users
            className="mx-auto mb-3 text-[#C87965]"
            size={28}
            strokeWidth={1.5}
          />
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
  );
}
