import { useState } from "react";
import { CheckCircle2, Download, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import useAdminClient from "@/lib/useAdminClient";

// "Patients by email" — every unique email that has filed at least one
// request, with submission counts and account-conversion status.
// Each row exposes admin lifecycle actions (download xlsx, delete)
// for when a patient emails support@ asking for those things.
export default function PatientsByEmailPanel({ data, filter, onReload }) {
  const adminClient = useAdminClient();
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
                <th className="text-right px-4 py-3">Actions</th>
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
                    <td className="px-4 py-3 text-right">
                      <PatientRowActions
                        client={adminClient}
                        email={r.email}
                        deleted={!!r.deleted_at}
                        onChanged={onReload}
                      />
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

// Compact per-row actions for patient lifecycle (admin-side).
// Patients don't get pause UI per Josh -- patients can just stop
// using us. Download (xlsx) + Delete are the two real cases.
function PatientRowActions({ client, email, deleted, onChanged }) {
  const [busy, setBusy] = useState(null); // "export" | "delete"
  const userKey = encodeURIComponent(email || "");

  const onDownload = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const res = await client.get(`/admin/patients/${userKey}/export-data`, {
        responseType: "blob",
      });
      const cd =
        res.headers?.["content-disposition"] ||
        res.headers?.["Content-Disposition"] ||
        "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const filename =
        (m && m[1]) ||
        `theravoca-patient-${userKey}-${new Date()
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
        `Permanently delete account for ${email}? Patient account, login, and all match requests marked deleted. 24-hour reversal window via support email; permanent after that.`,
      )
    )
      return;
    setBusy("delete");
    try {
      await client.post(`/admin/patients/${userKey}/delete-account`, {});
      toast.success("Patient account deleted.");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  if (deleted) {
    return (
      <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#FDF1EF] border border-[#E8C4BB] text-[#8B3220]">
        Deleted
      </span>
    );
  }
  return (
    <div className="inline-flex items-center gap-1 justify-end">
      <button
        type="button"
        onClick={onDownload}
        disabled={busy !== null}
        title="Download Excel of this patient's data"
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[#E8E5DF] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
        data-testid={`patient-row-export-${email}`}
      >
        {busy === "export" ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <Download size={10} />
        )}
        Excel
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy !== null}
        title="Permanently delete this patient's account"
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[#E8C4BB] text-[#8B3220] hover:bg-[#FDF1EF] disabled:opacity-50"
        data-testid={`patient-row-delete-${email}`}
      >
        {busy === "delete" ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <AlertTriangle size={10} />
        )}
        Delete
      </button>
    </div>
  );
}
