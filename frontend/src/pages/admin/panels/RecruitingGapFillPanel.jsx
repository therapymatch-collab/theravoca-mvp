import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, ExternalLink, Trash2, Radio } from "lucide-react";
import { toast } from "sonner";

// Recruiting -> General gap-fill (Track B).
// Currently dry-run: nightly cron generates draft invites for each
// coverage gap but doesn't send. This panel surfaces those drafts,
// the path to flip Track B live, and a wipe action for stale drafts
// generated against an older Coverage gaps snapshot.
export default function RecruitingGapFillPanel({
  client,
  recruitDrafts,
  loadRecruitDrafts,
  generateRecruitDrafts,
  setTab,
}) {
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (recruitDrafts === null && loadRecruitDrafts) {
      loadRecruitDrafts();
    }
    // eslint-disable-next-line
  }, []);

  // Group drafts by gap so the admin can see which gaps the agent
  // targeted. Schema: each draft has draft.gap = { dimension, key, severity }.
  const drafts = (recruitDrafts?.drafts) || [];
  const totalDrafts = drafts.length;
  const draftsByGap = (() => {
    const map = new Map();
    for (const d of drafts) {
      const dim = d.gap?.dimension || "(uncategorized)";
      const key = d.gap?.key || "";
      const label = key ? `${dim} -> ${key}` : dim;
      if (!map.has(label)) {
        map.set(label, {
          label,
          dimension: dim,
          key,
          severity: d.gap?.severity || "",
          draft_count: 0,
          dry_run_count: 0,
          google_verified_count: 0,
        });
      }
      const row = map.get(label);
      row.draft_count += 1;
      if (d.dry_run) row.dry_run_count += 1;
      if (d.google_verified) row.google_verified_count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.draft_count - a.draft_count);
  })();

  const onWipeAll = async () => {
    if (!client) {
      toast.error("Admin client not available");
      return;
    }
    if (totalDrafts === 0) {
      toast.success("Nothing to wipe -- drafts queue is already empty.");
      return;
    }
    if (!confirm(
      `Delete all ${totalDrafts} recruit draft(s)?\n\n` +
      `These are stale -- they were generated against a previous Coverage gaps ` +
      `snapshot and don't necessarily map to your current gaps. ` +
      `Click "Generate drafts now" after wiping to rebuild against the current gaps.\n\n` +
      `Safe -- nothing has been emailed (dry_run drafts).`
    )) return;
    setWiping(true);
    try {
      const res = await client.delete("/admin/gap-recruit/drafts", {
        data: { confirm: "WIPE" },
      });
      toast.success(`Deleted ${res.data?.deleted ?? 0} draft(s).`, { duration: 6000 });
      if (loadRecruitDrafts) await loadRecruitDrafts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Wipe failed");
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="recruiting-gap-fill-panel">
      <div className="bg-gradient-to-br from-[#FBEFE9] to-[#FDFBF7] border border-[#F4DDD2] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[#C87965] text-white flex items-center justify-center shrink-0 shadow-sm">
              <Radio size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-[#8B4F1F] font-semibold">
                Recruiting &middot; Track B
              </div>
              <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight mt-0.5">
                General gap-fill
              </h2>
              <p className="text-sm text-[#6D6A65] mt-1.5 max-w-2xl leading-relaxed">
                Proactive outreach driven by the Coverage gaps report. Flip
                between dry-run and live from the{" "}
                <strong>Operations &rarr; Settings &rarr; Go-live runbook</strong>{" "}
                (Track B row).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {generateRecruitDrafts && (
              <button
                type="button"
                onClick={() => generateRecruitDrafts()}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50]"
              >
                Generate drafts now
              </button>
            )}
            <button
              type="button"
              onClick={onWipeAll}
              disabled={wiping || totalDrafts === 0}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#D45D5D] text-[#D45D5D] hover:bg-[#FDF1EF] disabled:opacity-50"
            >
              {wiping ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Wipe all drafts ({totalDrafts})
            </button>
            {setTab && (
              <button
                type="button"
                onClick={() => setTab("coverage_gap")}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7]"
              >
                Coverage gaps <ExternalLink size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-[#FBEFE9] border border-[#F4DDD2] text-[#8B4F3B] rounded-2xl px-5 py-3 text-sm flex items-start gap-2">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>
          <strong>Dry-run mode.</strong> Nothing sends until you flip{" "}
          <code className="text-xs">dry_run=False</code> in cron.py and the
          pre-launch email safety guard is satisfied (set EMAIL_LIVE_MODE=true
          on Render or remove EMAIL_OVERRIDE_TO).
          <br />
          <strong>Stale drafts?</strong> Drafts in the table below were generated
          against a prior Coverage gaps snapshot. If they don't match your
          current gaps, click <strong>Wipe all drafts</strong> then{" "}
          <strong>Generate drafts now</strong> to rebuild fresh.
        </div>
      </div>

      {recruitDrafts === null && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3" />
          Loading drafts...
        </div>
      )}

      {recruitDrafts && draftsByGap.length === 0 && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          No drafts yet. Click "Generate drafts now" to run a dry-run pass
          against your current Coverage gaps.
        </div>
      )}

      {recruitDrafts && draftsByGap.length > 0 && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E8E5DF] flex items-center justify-between">
            <div className="font-medium text-[#2D4A3E]">Drafts grouped by gap</div>
            <div className="text-xs text-[#6D6A65]">
              <strong className="text-[#2B2A29]">{totalDrafts}</strong> total drafts
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[#6D6A65]">
              <tr className="text-left">
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Gap (dimension &rarr; value)</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Severity</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Drafts</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Google verified</th>
              </tr>
            </thead>
            <tbody>
              {draftsByGap.map((g, i) => (
                <tr key={i} className="border-t border-[#E8E5DF]">
                  <td className="p-4 text-[#2B2A29]">{g.label}</td>
                  <td className="p-4 text-[#2B2A29] capitalize">{g.severity || "—"}</td>
                  <td className="p-4 text-right font-semibold text-[#2D4A3E]">{g.draft_count}</td>
                  <td className="p-4 text-right text-[#6D6A65]">
                    {g.google_verified_count} / {g.draft_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
