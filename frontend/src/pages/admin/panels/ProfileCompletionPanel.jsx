import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";

export default function ProfileCompletionPanel({ data, client, onReload, filter }) {
  const [busy, setBusy] = useState(false);
  const [campaignResult, setCampaignResult] = useState(null);
  const [resendAll, setResendAll] = useState(false);

  const rows = data?.therapists || [];
  const q = (filter || "").trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          (r.email || "").toLowerCase().includes(q) ||
          (r.name || "").toLowerCase().includes(q),
      )
    : rows;

  const runCampaign = async ({ dry_run }) => {
    if (!dry_run) {
      const recipientCount = data?.incomplete ?? 0;
      const ok = window.confirm(
        `Send the "Claim & complete your profile" email to ${recipientCount} therapist${
          recipientCount === 1 ? "" : "s"
        }?\n\n${
          resendAll
            ? "ALL targeted recipients (including those already emailed) will receive a new copy."
            : "Therapists already emailed will be SKIPPED automatically. Toggle 'Resend' below if you want to email them again."
        }`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await client.post("/admin/profile-completeness/send-claim", {
        mode: "all_incomplete",
        dry_run,
        resend: resendAll,
      });
      setCampaignResult({ ...res.data, dry_run });
      if (!dry_run) {
        toast.success(`Claim email queued for ${res.data.sent} therapist${res.data.sent === 1 ? "" : "s"}.`);
        onReload();
      } else {
        toast.success(`Dry run: would send to ${res.data.would_send} therapist${res.data.would_send === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Campaign failed");
    } finally {
      setBusy(false);
    }
  };

  const sendOne = async (t) => {
    if (!window.confirm(`Send claim email to ${t.email}?`)) return;
    try {
      await client.post("/admin/profile-completeness/send-claim", {
        mode: "selected",
        therapist_ids: [t.id],
        resend: true,
      });
      toast.success(`Emailed ${t.email}.`);
      onReload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Send failed");
    }
  };

  return (
    <div className="mt-6 space-y-6" data-testid="completion-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Profile completion
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
              Tracks how complete each therapist's profile is. Required fields
              must all pass for the therapist to be "publishable". The
              <strong className="text-[#2B2A29]"> Send claim emails </strong>
              campaign emails every incomplete therapist a personalized list
              of what's missing — perfect for your go-live cutover.
            </p>
          </div>
          {data && (
            <div className="grid grid-cols-3 gap-4 text-center text-xs text-[#6D6A65]">
              <div>
                <div className="font-serif-display text-2xl text-[#2D4A3E]" data-testid="completion-total">
                  {data.total}
                </div>
                Total
              </div>
              <div>
                <div className="font-serif-display text-2xl text-[#2D4A3E]" data-testid="completion-publishable">
                  {data.publishable}
                </div>
                Publishable
              </div>
              <div>
                <div className="font-serif-display text-2xl text-[#C87965]" data-testid="completion-incomplete">
                  {data.incomplete}
                </div>
                Incomplete
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => runCampaign({ dry_run: true })}
            disabled={busy || !data}
            className="tv-btn-secondary !py-2 !px-4 text-sm disabled:opacity-50"
            data-testid="claim-dry-run"
          >
            Dry run (preview recipients)
          </button>
          <button
            type="button"
            onClick={() => runCampaign({ dry_run: false })}
            disabled={busy || !data}
            className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
            data-testid="claim-send-all"
          >
            {busy ? "Sending..." : "Send claim emails"}
          </button>
          <label className="text-xs text-[#6D6A65] inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={resendAll}
              onChange={(e) => setResendAll(e.target.checked)}
              data-testid="claim-resend-toggle"
            />
            Resend to therapists already emailed
          </label>
          <button
            type="button"
            onClick={onReload}
            className="text-xs text-[#2D4A3E] hover:underline ml-auto"
            data-testid="completion-refresh"
          >
            Refresh
          </button>
        </div>
        {campaignResult && (
          <div
            className="mt-4 bg-[#F2F4F0] border border-[#D9DDD2] rounded-xl p-4 text-sm text-[#2B2A29]"
            data-testid="campaign-result"
          >
            {campaignResult.dry_run ? (
              <>
                <strong>Dry run:</strong> would send to{" "}
                <strong>{campaignResult.would_send}</strong> therapist
                {campaignResult.would_send === 1 ? "" : "s"}. No emails were
                actually sent.
              </>
            ) : (
              <>
                <strong>Campaign sent.</strong> Queued{" "}
                <strong>{campaignResult.sent}</strong> emails
                {campaignResult.failed?.length > 0 &&
                  `, ${campaignResult.failed.length} failed`}
                . Therapists already emailed before are skipped unless you
                tick "Resend" above.
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-[#E8E5DF] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Roster</h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              Sorted by score ascending — therapists who need help most
              appear at the top.
            </p>
          </div>
          {data && (
            <div className="text-xs text-[#6D6A65]">
              Average score{" "}
              <strong className="text-[#2B2A29]">{data.average_score}%</strong>
            </div>
          )}
        </div>
        {!data && (
          <div className="p-10 text-center text-[#6D6A65]">Loading roster…</div>
        )}
        {data && visible.length === 0 && (
          <div className="p-10 text-center text-[#6D6A65]">
            {rows.length === 0
              ? "No therapists yet."
              : "No matches for that search."}
          </div>
        )}
        {data && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-[10px] uppercase tracking-wider text-[#6D6A65]">
                <tr>
                  <th className="text-left px-4 py-3">Therapist</th>
                  <th className="text-right px-4 py-3">Score</th>
                  <th className="text-center px-4 py-3">Publishable</th>
                  <th className="text-left px-4 py-3">Top missing fields</th>
                  <th className="text-left px-4 py-3">Email status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const top = (t.required_missing || [])
                    .concat(t.enhancing_missing || [])
                    .slice(0, 3)
                    .map((f) => f.label)
                    .join(", ");
                  const emailedAgo = t.claim_email_sent_at
                    ? new Date(t.claim_email_sent_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    : null;
                  const tone =
                    t.score >= 70
                      ? "text-[#2D4A3E]"
                      : t.score >= 40
                        ? "text-[#C87965]"
                        : "text-[#D45D5D]";
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7]/50 align-top"
                      data-testid={`completion-row-${t.email}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#2B2A29] truncate" title={t.name}>
                          {t.name || t.email}
                        </div>
                        <div className="text-xs text-[#6D6A65] truncate" title={t.email}>
                          {t.email}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right font-serif-display text-lg tabular-nums ${tone}`}>
                        {t.score}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.publishable ? (
                          <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E]">
                            yes
                          </span>
                        ) : (
                          <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#FDEDEB] text-[#D45D5D]">
                            no
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6D6A65] max-w-[280px]">
                        <div className="line-clamp-2 leading-snug" title={top}>
                          {top || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6D6A65] whitespace-nowrap">
                        {emailedAgo ? (
                          <span className="inline-flex items-center gap-1 text-[#2D4A3E]">
                            ✓ Sent {emailedAgo}
                          </span>
                        ) : (
                          <span className="text-[#C87965]">Not contacted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => sendOne(t)}
                          className="text-xs text-[#2D4A3E] hover:underline"
                          data-testid={`completion-send-${t.email}`}
                        >
                          Send claim email
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
