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
  // SECURITY (2026-05-16 audit, HIGH #11): typed-confirm flow before
  // a real account delete. The prior single window.confirm allowed a
  // misclick to permanently wipe a live therapist/patient (24h
  // reversal only saves you if you notice in time). Now a modal
  // requires the admin to type the user's email/name exactly before
  // the destructive button enables. Matches the SettingsPanel
  // wipe-test-data pattern.
  const [confirming, setConfirming] = useState(false);
  const [confirmTyped, setConfirmTyped] = useState("");

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

  // Phrase the admin must type to enable the destructive button. Use
  // the user's actual email when available (more specific than name).
  const confirmPhrase = (target.email || target.name || labelName || "").trim();
  const confirmReady =
    confirmPhrase
    && confirmTyped.trim().toLowerCase() === confirmPhrase.toLowerCase();

  const onDelete = async () => {
    if (busy || !confirmReady) return;
    setBusy("delete");
    try {
      await client.post(`${basePath}/delete-account`, {});
      toast.success("Account deleted.");
      setConfirming(false);
      setConfirmTyped("");
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
            onClick={() => {
              setConfirming(true);
              setConfirmTyped("");
            }}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-[#8B3220] text-[#8B3220] hover:bg-[#FDF1EF] transition disabled:opacity-50"
            data-testid="admin-lifecycle-delete"
          >
            <AlertTriangle size={12} />
            Delete account
          </button>
        )}
      </div>
      {/* Typed-confirm modal -- admin must type the email/name
          exactly before the destructive button enables. */}
      {confirming && !isDeleted && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && !busy && setConfirming(false)}
        >
          <div className="bg-white rounded-2xl border border-[#E8C4BB] w-full max-w-md p-5 shadow-xl">
            <div className="flex items-start gap-3 text-[#8B3220]">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              <div>
                <h3 className="font-serif-display text-xl">
                  Delete this account
                </h3>
                <p className="text-sm text-[#2B2A29] mt-1 leading-relaxed">
                  This will wipe profile, login, and sensitive blobs immediately.{" "}
                  {isTherapist
                    ? "Active Stripe subscription is cancelled at period-end."
                    : "All match requests are marked deleted."}{" "}
                  Reversible for 24 hours by emailing support; permanent after that.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs uppercase tracking-wider text-[#6D6A65] mb-1">
                Type <code className="bg-[#FBE9E5] px-1.5 py-0.5 rounded text-[#8B3220]">{confirmPhrase}</code> to confirm
              </label>
              <input
                type="text"
                value={confirmTyped}
                onChange={(e) => setConfirmTyped(e.target.value)}
                autoFocus
                className="w-full text-sm border border-[#E8E5DF] rounded-md px-3 py-2 focus:outline-none focus:border-[#8B3220]"
                placeholder={confirmPhrase}
                data-testid="admin-lifecycle-delete-confirm-input"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmTyped("");
                }}
                disabled={busy === "delete"}
                className="text-sm px-3 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#FDFBF7] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={!confirmReady || busy === "delete"}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#8B3220] text-white hover:bg-[#6e2818] disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="admin-lifecycle-delete-confirm-btn"
              >
                {busy === "delete" && <Loader2 size={12} className="animate-spin" />}
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
