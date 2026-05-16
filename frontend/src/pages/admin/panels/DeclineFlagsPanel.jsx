import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";

// Therapist Decline Patterns
//
// Surfaces the cron-built `db.therapist_decline_flags` queue. The cron
// runs daily (see backend/cron.py:_run_decline_pattern_flags) and
// flags any therapist with 3+ declines for the same reason in the
// trailing 30 days. Admin reviews here, closes manually with a
// resolution note, or leaves open until the next cron run auto-closes
// it (if the pattern stops).
//
// Endpoints (already exist):
//   GET  /admin/decline-flags?status=open|all
//   POST /admin/decline-flags/run-now
//   POST /admin/decline-flags/{therapist_id}/{reason}/close { resolution, notes }

const REASON_LABELS = {
  specialty_mismatch: "Specialty mismatch",
  modality_mismatch: "Modality mismatch",
  schedule_mismatch: "Schedule mismatch",
  insurance_mismatch: "Insurance mismatch",
  geo_mismatch: "Geographic mismatch",
  capacity_full: "At capacity",
  population_mismatch: "Age / population mismatch",
  other: "Other",
};

const RESOLUTION_OPTIONS = [
  { value: "spoke_with_therapist", label: "Spoke with therapist" },
  { value: "narrowed_specialty", label: "Narrowed specialty in profile" },
  { value: "updated_capacity", label: "Updated capacity / schedule" },
  { value: "paused_referrals", label: "Paused referrals" },
  { value: "no_action", label: "No action (acceptable pattern)" },
];

const STATUS_PILL_STYLE = {
  open: {
    color: "#B0382A",
    bg: "#FBE9E5",
    border: "#F4C7BE",
    label: "Open",
  },
  admin_closed: {
    color: "#2D4A3E",
    bg: "#E8F0EB",
    border: "#9DBDA8",
    label: "Closed (admin)",
  },
  auto_closed: {
    color: "#6D6A65",
    bg: "#F4F1EC",
    border: "#E8E5DF",
    label: "Auto-closed",
  },
};

export default function DeclineFlagsPanel({ client }) {
  const [flags, setFlags] = useState(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  // Per-row close dialog state: { key: "tid|reason", resolution, notes }
  const [closing, setClosing] = useState(null);
  const [closingBusy, setClosingBusy] = useState(false);

  const refresh = async (filter = statusFilter) => {
    setLoading(true);
    try {
      const res = await client.get(
        `/admin/decline-flags?status=${encodeURIComponent(filter)}`,
      );
      setFlags(res.data?.flags || []);
    } catch (e) {
      // Distinguish load failure from "no flags" -- the prior audit
      // flagged silent-default-to-empty as a bug pattern. Keep prior
      // value (null on first load = unknown) and surface a toast.
      toast.error(
        e?.response?.data?.detail
          || "Couldn't load decline flags (network or auth issue)",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(statusFilter); /* eslint-disable-next-line */ }, []);

  const onRunNow = async () => {
    setRunning(true);
    try {
      const res = await client.post("/admin/decline-flags/run-now", {});
      const d = res.data || {};
      toast.success(
        `Scan complete: ${d.new_flags ?? 0} new · ${d.refreshed ?? 0} refreshed · ${d.auto_closed ?? 0} auto-closed`,
        { duration: 6000 },
      );
      await refresh(statusFilter);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed");
    } finally {
      setRunning(false);
    }
  };

  const onChangeFilter = async (next) => {
    setStatusFilter(next);
    await refresh(next);
  };

  const onCloseFlag = async () => {
    if (!closing) return;
    setClosingBusy(true);
    try {
      await client.post(
        `/admin/decline-flags/${encodeURIComponent(closing.therapist_id)}/${encodeURIComponent(closing.reason)}/close`,
        { resolution: closing.resolution, notes: closing.notes || "" },
      );
      toast.success("Flag closed.");
      setClosing(null);
      await refresh(statusFilter);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Close failed");
    } finally {
      setClosingBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="decline-flags-panel">
      {/* Header + actions */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Therapist decline patterns
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1 max-w-2xl">
              Cron flags any therapist with 3+ declines for the same
              reason in the trailing 30 days. Use it as an early signal:
              their profile may be miscategorized, or capacity / schedule
              has changed. The cron re-runs daily; manually-closed flags
              don't re-open unless the pattern persists past the next run.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => onChangeFilter(e.target.value)}
              className="text-sm border border-[#E8E5DF] rounded-full px-3 py-1.5 bg-white"
              data-testid="decline-flags-status-filter"
            >
              <option value="open">Open only</option>
              <option value="all">All (incl. closed)</option>
            </select>
            <button
              type="button"
              onClick={onRunNow}
              disabled={running}
              className="text-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
              data-testid="decline-flags-run-now"
            >
              {running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Run scan now
            </button>
          </div>
        </div>
      </div>

      {/* Flag list */}
      {loading && flags === null ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading decline flags…
        </div>
      ) : (flags || []).length === 0 ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65]">
          <CheckCircle2 size={28} className="mx-auto mb-3 text-[#2D4A3E]" />
          <p className="font-medium text-[#2D4A3E]">No flags in this view.</p>
          <p className="text-xs mt-1">
            {statusFilter === "open"
              ? "No therapists with 3+ same-reason declines in the last 30 days."
              : "The flag queue is empty."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => {
            const t = f.therapist || {};
            const pill = STATUS_PILL_STYLE[f.status] || STATUS_PILL_STYLE.open;
            const reasonLabel = REASON_LABELS[f.reason] || f.reason || "—";
            const last = f.last_decline_at
              ? new Date(f.last_decline_at).toLocaleDateString()
              : "—";
            return (
              <div
                key={`${f.therapist_id}-${f.reason}`}
                className="bg-white border border-[#E8E5DF] rounded-2xl p-4"
                data-testid={`decline-flag-row-${f.therapist_id}-${f.reason}`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle size={14} className="text-[#B8742A] shrink-0" />
                      <span className="font-medium text-[#2B2A29] truncate">
                        {t.name || f.therapist_email || "Unknown therapist"}
                      </span>
                      {t.credential_type && (
                        <span className="text-xs text-[#6D6A65]">
                          {t.credential_type}
                        </span>
                      )}
                      <span
                        className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border"
                        style={{
                          color: pill.color,
                          background: pill.bg,
                          borderColor: pill.border,
                        }}
                      >
                        {pill.label}
                      </span>
                      {t.is_active === false && (
                        <span className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                          inactive
                        </span>
                      )}
                      {t.pending_approval && (
                        <span className="text-[10px] uppercase tracking-wider text-[#B8742A]">
                          pending approval
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-[#2B2A29]">
                      <span className="font-medium">{reasonLabel}</span>
                      <span className="text-[#6D6A65]"> · {f.count_30d || 0} declines (30d) · last {last}</span>
                    </div>
                    {(t.primary_specialties || []).length > 0 && (
                      <div className="mt-1 text-xs text-[#6D6A65] truncate">
                        Profile specialties: {(t.primary_specialties || []).join(", ")}
                      </div>
                    )}
                    {f.admin_resolution && (
                      <div className="mt-2 text-xs text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-lg px-2 py-1.5">
                        Closed:{" "}
                        <span className="font-medium">
                          {RESOLUTION_OPTIONS.find((o) => o.value === f.admin_resolution)?.label
                            || f.admin_resolution}
                        </span>
                        {f.admin_notes && (
                          <span className="text-[#6D6A65]"> · {f.admin_notes}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {f.status === "open" && (
                    <button
                      type="button"
                      onClick={() => setClosing({
                        therapist_id: f.therapist_id,
                        therapist_name: t.name || f.therapist_email,
                        reason: f.reason,
                        reason_label: reasonLabel,
                        resolution: RESOLUTION_OPTIONS[0].value,
                        notes: "",
                      })}
                      className="text-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] shrink-0"
                      data-testid={`decline-flag-close-${f.therapist_id}-${f.reason}`}
                    >
                      Close flag
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Close-flag dialog */}
      {closing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setClosing(null)}
        >
          <div className="bg-white rounded-2xl border border-[#E8E5DF] w-full max-w-md p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif-display text-xl text-[#2D4A3E]">
                  Close decline flag
                </h3>
                <p className="text-sm text-[#6D6A65] mt-1">
                  {closing.therapist_name} · {closing.reason_label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClosing(null)}
                className="text-[#6D6A65] hover:text-[#2B2A29]"
                aria-label="Cancel"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs uppercase tracking-wider text-[#6D6A65]">
                Resolution
              </label>
              <select
                value={closing.resolution}
                onChange={(e) => setClosing({ ...closing, resolution: e.target.value })}
                className="w-full text-sm border border-[#E8E5DF] rounded-md px-3 py-2"
              >
                {RESOLUTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <label className="block text-xs uppercase tracking-wider text-[#6D6A65] mt-3">
                Notes (optional)
              </label>
              <textarea
                value={closing.notes}
                onChange={(e) => setClosing({ ...closing, notes: e.target.value })}
                rows={3}
                className="w-full text-sm border border-[#E8E5DF] rounded-md px-3 py-2 resize-y"
                placeholder="What you did about this pattern, for the audit trail."
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClosing(null)}
                className="text-sm px-3 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#FDFBF7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCloseFlag}
                disabled={closingBusy}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#2D4A3E] text-white hover:bg-[#1f3a30] disabled:opacity-50"
              >
                {closingBusy && <Loader2 size={14} className="animate-spin" />}
                Close flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
