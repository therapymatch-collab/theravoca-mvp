import { useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Download, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Admin per-user lifecycle actions panel.
 *
 * Renders Pause / Resume / Download / Delete buttons that hit the
 * /admin/{therapists|patients}/... endpoints (added 2026-05-16).
 * Used inside the admin therapist edit modal and patient lookup so
 * an admin can run these on behalf of a user when they email
 * support@theravoca.com asking to pause / download / delete.
 *
 * Props:
 *   client: useAdminClient() instance
 *   role:   "therapist" | "patient"
 *   target: object describing the user. For therapists: { id, name,
 *           email, paused_at, deleted_at }. For patients: { email,
 *           paused_at, deleted_at }.
 *   onChanged: () => void  -- caller invalidates its cache after a
 *           successful pause/resume/delete so the surrounding UI
 *           reflects the new state.
 */
export default function AdminLifecycleActionsPanel({
  client,
  role,
  target,
  onChanged,
}) {
  const [busy, setBusy] = useState(null); // "pause" | "resume" | "delete" | "export"

  if (!target) return null;

  const isTherapist = role === "therapist";
  const isPaused = !!target.paused_at;
  const isDeleted = !!target.deleted_at;
  const userKey = isTherapist ? target.id : encodeURIComponent(target.email || "");
  const labelName =
    target.name ||
    target.email ||
    (isTherapist ? "this therapist" : "this patient");

  const basePath = isTherapist
    ? `/admin/therapists/${userKey}`
    : `/admin/patients/${userKey}`;

  const onPause = async () => {
    if (!isTherapist) return; // patients don't have pause UI per Josh
    if (busy) return;
    setBusy("pause");
    try {
      await client.post(`${basePath}/pause`, {
        reason: "admin_paused_via_lifecycle_panel",
      });
      toast.success("Paused. Therapist won't appear in new matches.");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Pause failed");
    } finally {
      setBusy(null);
    }
  };

  const onResume = async () => {
    if (!isTherapist) return;
    if (busy) return;
    setBusy("resume");
    try {
      await client.post(`${basePath}/resume`, {});
      toast.success("Resumed. Therapist is back in the matching pool.");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Resume failed");
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const res = await client.get(`${basePath}/export-data`, {
        responseType: "blob",
      });
      const cd =
        res.headers?.["content-disposition"] ||
        res.headers?.["Content-Disposition"] ||
        "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const filename =
        (m && m[1]) ||
        `theravoca-${role}-${userKey}-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`;
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Download started.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (busy) return;
    if (
      !window.confirm(
        `Permanently delete account for ${labelName}? Profile, login, sensitive blobs wiped immediately.${
          isTherapist
            ? " Active Stripe subscription cancelled at period-end."
            : " All match requests marked deleted."
        } 24-hour reversal window via support email; permanent after that.`,
      )
    )
      return;
    setBusy("delete");
    try {
      await client.post(`${basePath}/delete-account`, {});
      toast.success("Account deleted.");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="rounded-xl border border-[#E8E5DF] bg-[#FDFBF7] p-4"
      data-testid="admin-lifecycle-panel"
    >
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h3 className="font-medium text-[#2D4A3E]">Account actions</h3>
        <span className="text-[11px] text-[#6D6A65]">
          Run on behalf of the user (typically after they email support).
        </span>
      </div>
      {isDeleted && (
        <div className="mb-3 rounded-lg border border-[#E8C4BB] bg-[#FDF1EF] px-3 py-2 text-xs text-[#8B3220]">
          Account deleted at {new Date(target.deleted_at).toLocaleString()}.
          Reversal window expires 24 hours after deletion.
        </div>
      )}
      {!isDeleted && isPaused && (
        <div className="mb-3 rounded-lg border border-[#F0DEC8] bg-[#FBF2E8] px-3 py-2 text-xs text-[#B8742A]">
          Paused since {new Date(target.paused_at).toLocaleString()}.
          {isTherapist && " Excluded from new matches; existing referrals unaffected."}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {isTherapist && !isDeleted && (
          isPaused ? (
            <button
              type="button"
              onClick={onResume}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-[#2D4A3E] text-[#2D4A3E] hover:bg-white transition disabled:opacity-50"
              data-testid="admin-lifecycle-resume"
            >
              {busy === "resume" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              Resume referrals
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-[#B8742A] text-[#B8742A] hover:bg-[#FBF2E8] transition disabled:opacity-50"
              data-testid="admin-lifecycle-pause"
            >
              {busy === "pause" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Pause size={12} />
              )}
              Pause referrals
            </button>
          )
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-[#6D6A65] text-[#2D4A3E] hover:bg-white transition disabled:opacity-50"
          data-testid="admin-lifecycle-export"
        >
          {busy === "export" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          Download data (Excel)
        </button>
        {!isDeleted && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-[#8B3220] text-[#8B3220] hover:bg-[#FDF1EF] transition disabled:opacity-50"
            data-testid="admin-lifecycle-delete"
          >
            {busy === "delete" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <AlertTriangle size={12} />
            )}
            Delete account
          </button>
        )}
      </div>
    </section>
  );
}
