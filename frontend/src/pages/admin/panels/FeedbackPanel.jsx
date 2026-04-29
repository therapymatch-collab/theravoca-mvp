import { Loader2, RotateCw } from "lucide-react";

const KIND_META = {
  patient: { label: "Patient follow-up", bg: "#F2F4F0", fg: "#2D4A3E" },
  therapist: { label: "Therapist follow-up", bg: "#FBF2E8", fg: "#B8742A" },
  widget: { label: "Widget", bg: "#FBE9E6", fg: "#C8412B" },
};

// Submissions from the floating widget and 48h/2w follow-up forms.
export default function FeedbackPanel({ data, loading, onReload, filter }) {
  const rows = data?.feedback || [];
  const q = (filter || "").trim().toLowerCase();
  const visible = q
    ? rows.filter((r) =>
        JSON.stringify(r).toLowerCase().includes(q),
      )
    : rows;

  const counts = {
    patient: rows.filter((r) => r.kind === "patient").length,
    therapist: rows.filter((r) => r.kind === "therapist").length,
    widget: rows.filter((r) => r.kind === "widget").length,
  };

  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden" data-testid="feedback-panel">
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF] flex-wrap">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Feedback</h3>
          <p className="text-sm text-[#6D6A65] mt-1">
            Submissions from the floating widget and the 48h/2w follow-up forms.
          </p>
          <div className="mt-2 flex gap-3 text-xs text-[#6D6A65]">
            <span>Patient follow-ups: <strong className="text-[#2B2A29]">{counts.patient}</strong></span>
            <span>Therapist follow-ups: <strong className="text-[#2B2A29]">{counts.therapist}</strong></span>
            <span>Widget messages: <strong className="text-[#2B2A29]">{counts.widget}</strong></span>
          </div>
        </div>
        <button
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
          data-testid="feedback-reload"
        >
          <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {loading && rows.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin inline" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          {q
            ? "No feedback matches your search."
            : "No feedback yet. It'll start showing up after patients/therapists respond to their follow-up emails or use the floating widget."}
        </div>
      ) : (
        <div className="divide-y divide-[#E8E5DF]">
          {visible.map((r, idx) => (
            <FeedbackRow key={r.id || idx} r={r} idx={idx} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({ r, idx }) {
  const meta = KIND_META[r.kind] || { label: r.kind, bg: "#F6F4EE", fg: "#6D6A65" };
  return (
    <div className="p-5" data-testid={`feedback-row-${idx}`}>
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span
          className="text-[11px] rounded-full px-2 py-0.5"
          style={{ background: meta.bg, color: meta.fg }}
        >
          {meta.label}
        </span>
        {r.milestone && (
          <span className="text-[11px] text-[#6D6A65]">{r.milestone}</span>
        )}
        {r.kind === "patient" && r.match_quality && (
          <span className="text-[11px] text-[#2D4A3E] font-medium">
            ★ {r.match_quality}/5 match quality
          </span>
        )}
        {r.kind === "therapist" && r.referrals_quality && (
          <span className="text-[11px] text-[#2D4A3E] font-medium">
            ★ {r.referrals_quality}/5 referral quality
          </span>
        )}
        <span className="text-[11px] text-[#6D6A65] ml-auto">
          {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
        </span>
      </div>
      <div className="text-sm text-[#2B2A29]">
        {r.kind === "patient" && r.reached_out && (
          <div><strong>Did patient reach out:</strong> {r.reached_out.replace(/_/g, " ")}</div>
        )}
        {r.kind === "therapist" && r.booked_any && (
          <div><strong>Booked intakes:</strong> {r.booked_any.replace(/_/g, " ")}</div>
        )}
        {r.kind === "widget" && (
          <div className="text-xs text-[#6D6A65]">
            {r.name || "Anonymous"}
            {r.email && ` · ${r.email}`}
            {r.role && r.role !== "anonymous" && ` · ${r.role}`}
          </div>
        )}
        {(r.notes || r.message) && (
          <div className="mt-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {r.notes || r.message}
          </div>
        )}
        {r.patient_email && (
          <div className="text-xs text-[#6D6A65] mt-2 font-mono">{r.patient_email}</div>
        )}
        {r.therapist_email && (
          <div className="text-xs text-[#6D6A65] mt-2 font-mono">
            {r.therapist_email}
            {r.therapist_name && ` · ${r.therapist_name}`}
          </div>
        )}
      </div>
    </div>
  );
}
