import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { sessionClient } from "@/lib/api";

// Self-serve data-export panel, shared by therapist + patient
// portals. Fetches GET /portal/<role>/export-data which returns an
// Excel (.xlsx) workbook as a download (server sets
// Content-Disposition). One sheet per data class so a non-technical
// user can open it in Numbers/Excel/Google Sheets and read it
// directly. We pull as a Blob and trigger an anchor click so the
// browser saves it locally; the response is too sensitive to dump
// in a new tab.
//
// Sheets in the file:
//   - Therapist: Summary, Profile, Applications, Declines,
//     Feedback About Me, Login History.
//   - Patient: Summary, Account, Match Requests, Therapist Replies,
//     Feedback I Submitted, Login History.
// Auth artifacts (password hash, TOTP secret, magic codes,
// internal embeddings) are stripped server-side before the
// download is generated.
export default function DataExportPanel({ role }) {
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await sessionClient().get(
        `/portal/${role}/export-data`,
        { responseType: "blob" },
      );
      // Pull filename from Content-Disposition if the server set
      // it; otherwise fall back to a date-stamped default. Axios
      // exposes headers case-insensitively but we check both keys
      // just in case the server changes proxy in the future.
      const cd =
        res.headers?.["content-disposition"] ||
        res.headers?.["Content-Disposition"] ||
        "";
      const match = /filename="?([^"]+)"?/i.exec(cd);
      const filename =
        (match && match[1]) ||
        `theravoca-${role}-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
      toast.error(e?.response?.data?.detail || "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const bodyCopy = role === "therapist"
    ? "Download an Excel snapshot of your account: profile, every patient referral you've received, declines, feedback about you, and sign-in history. One sheet per category — opens in Excel, Numbers, or Google Sheets. Auth secrets are stripped. Useful before pausing or deleting."
    : "Download an Excel snapshot of your account: every match request you've submitted, the therapists who replied, any feedback you've submitted, and sign-in history. One sheet per category — opens in Excel, Numbers, or Google Sheets. Auth secrets are stripped. Useful before pausing or deleting.";

  return (
    <section
      className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-6"
      data-testid="data-export-panel"
    >
      <h2 className="font-serif-display text-xl text-[#2D4A3E] flex items-center gap-2">
        <Download size={18} className="text-[#6D6A65]" />
        Download my data
      </h2>
      <p className="text-sm text-[#2B2A29] mt-2 leading-relaxed">
        {bodyCopy}
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-[#6D6A65] text-[#2D4A3E] hover:bg-[#FDFBF7] transition disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="data-export-download"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Download account data (Excel)
        </button>
      </div>
    </section>
  );
}
