import { useEffect } from "react";
import { Loader2, AlertTriangle, ExternalLink } from "lucide-react";

// Recruiting -> General gap-fill (Track B).
// Currently dry-run: nightly cron generates draft invites for each
// coverage gap but doesn't send. This panel surfaces those drafts +
// the path to flip Track B live.
export default function RecruitingGapFillPanel({
  recruitDrafts,
  loadRecruitDrafts,
  generateRecruitDrafts,
  setTab,
}) {
  useEffect(() => {
    if (recruitDrafts === null && loadRecruitDrafts) {
      loadRecruitDrafts();
    }
    // eslint-disable-next-line
  }, []);

  // Group drafts by gap label so admin can see which gaps the agent
  // targeted. The drafts collection itself is flat -- each row is a
  // single therapist draft with a gap_label / gap_dimension stamp.
  const drafts = (recruitDrafts?.drafts) || [];
  const totalDrafts = drafts.length;
  const draftsByGap = (() => {
    const map = new Map();
    for (const d of drafts) {
      const key = d.gap_label || d.gap_dimension_value || d.gap_dimension || "(uncategorized)";
      if (!map.has(key)) {
        map.set(key, { label: key, severity: d.severity || "", draft_count: 0 });
      }
      map.get(key).draft_count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.draft_count - a.draft_count);
  })();

  return (
    <div className="mt-6 space-y-4" data-testid="recruiting-gap-fill-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#6D6A65] mb-1">
              Recruiting &middot; Track B
            </div>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
              General gap-fill
            </h2>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Proactive outreach driven by the Coverage gaps report. Currently{" "}
              <strong>dry-run</strong> &mdash; the nightly cron creates drafts
              but doesn't send. Flip to live by editing{" "}
              <code className="text-xs bg-[#F2EFE8] px-1.5 py-0.5 rounded">cron.py</code>
              {" "}line ~250 (<code className="text-xs">dry_run=False</code>).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {generateRecruitDrafts && (
              <button
                type="button"
                onClick={() => generateRecruitDrafts()}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50]"
              >
                Generate drafts now
              </button>
            )}
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

      <div className="bg-[#FBEFE9] border border-[#F4DDD2] text-[#8B4F3B] rounded-2xl px-5 py-3 text-sm flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" />
        <div>
          <strong>Dry-run mode.</strong> Nothing sends until you flip{" "}
          <code className="text-xs">dry_run=False</code> in cron.py and the
          pre-launch email safety guard is satisfied (set EMAIL_LIVE_MODE=true
          on Render or remove EMAIL_OVERRIDE_TO).
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
            <div className="font-medium text-[#2D4A3E]">Drafts by gap</div>
            <div className="text-xs text-[#6D6A65]">
              <strong className="text-[#2B2A29]">{totalDrafts}</strong> total drafts
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[#6D6A65]">
              <tr className="text-left">
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Gap</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Severity</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Drafts</th>
              </tr>
            </thead>
            <tbody>
              {draftsByGap.map((g, i) => (
                <tr key={i} className="border-t border-[#E8E5DF]">
                  <td className="p-4 text-[#2B2A29]">{g.label || g.dimension_value || g.dimension}</td>
                  <td className="p-4 text-[#2B2A29] capitalize">{g.severity || "—"}</td>
                  <td className="p-4 text-right font-semibold text-[#2D4A3E]">{g.draft_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
