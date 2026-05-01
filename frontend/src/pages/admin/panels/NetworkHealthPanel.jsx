import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Megaphone,
  Send,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import CoverageGapPanel from "./CoverageGapPanel";
import RecruitDraftsPanel from "./RecruitDraftsPanel";
import ScrapeSourcesPanel from "./ScrapeSourcesPanel";
import SimulatorPanel from "./SimulatorPanel";
import AutoRecruitSection from "./AutoRecruitSection";
import useAdminClient from "@/lib/useAdminClient";

// ─── Dimension labels (shared with CoverageGapPanel) ───────────────────────
const DIM_LABELS = {
  specialty: "Specialties",
  modality: "Modalities",
  age_group: "Age groups",
  client_type: "Formats",
  insurance: "Insurance",
  urgency: "Urgency",
  geography: "Geography",
  fee: "Fee diversity",
};

const DIM_ICONS = {
  specialty: "🧠", modality: "🛠", age_group: "👶", client_type: "👥",
  insurance: "🏥", urgency: "⚡", geography: "📍", fee: "💲",
};

// ─── Main panel ─────────────────────────────────────────────────────────────
export default function NetworkHealthPanel({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;

  // Coverage gap data
  const [gapData, setGapData] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);

  // Recruit drafts
  const [drafts, setDrafts] = useState(null);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Collapsible sections
  const [showFullGaps, setShowFullGaps] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const loadGaps = async () => {
    setGapLoading(true);
    try {
      const r = await client.get("/admin/coverage-gap-analysis");
      setGapData(r.data);
    } catch (e) {
      toast.error("Failed to load coverage analysis");
    } finally {
      setGapLoading(false);
    }
  };

  const loadDrafts = async () => {
    setDraftsLoading(true);
    try {
      const r = await client.get("/admin/gap-recruit/drafts");
      setDrafts(r.data);
    } catch {
      /* soft fail */
    } finally {
      setDraftsLoading(false);
    }
  };

  const generateDrafts = async () => {
    setGenerating(true);
    try {
      const r = await client.post("/admin/gap-recruit/run", { dry_run: true, max_drafts: 30 });
      toast.success(`Generated ${r.data?.drafts_created || 0} recruit drafts`);
      await loadDrafts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Recruit generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const deleteDraft = async (id) => {
    try {
      await client.delete(`/admin/gap-recruit/drafts/${id}`);
      toast.success("Draft deleted");
      await loadDrafts();
    } catch {
      toast.error("Delete failed");
    }
  };

  const sendAllDrafts = async () => {
    try {
      const r = await client.post("/admin/gap-recruit/send-all", {});
      toast.success(`Sent ${r.data?.sent || 0} recruit emails`);
      await loadDrafts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    }
  };

  const sendPreview = async (id) => {
    try {
      await client.post("/admin/gap-recruit/send-preview", { draft_id: id });
      toast.success("Preview sent to admin email");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    }
  };

  useEffect(() => {
    loadGaps();
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived data ──
  const gaps = gapData?.gaps || [];
  const gapSummary = gapData?.gap_summary || {};
  const totalTherapists = gapData?.total_active_therapists || 0;

  // Build scorecard per dimension
  const dimScores = {};
  gaps.forEach((g) => {
    if (!dimScores[g.dimension]) {
      dimScores[g.dimension] = { critical: 0, warning: 0, total: 0, items: [] };
    }
    dimScores[g.dimension].total++;
    if (g.severity === "critical") dimScores[g.dimension].critical++;
    else dimScores[g.dimension].warning++;
    dimScores[g.dimension].items.push(g);
  });

  // Advertisable strengths: dimensions where gaps are few/none
  const allDims = Object.keys(DIM_LABELS);
  const strengths = allDims.filter((d) => !dimScores[d] || dimScores[d].critical === 0);
  const weaknesses = allDims.filter((d) => dimScores[d]?.critical > 0);

  // Pipeline numbers
  const totalGaps = gapSummary.total || 0;
  const draftsTotal = drafts?.total || 0;
  const draftsPending = drafts?.pending || 0;
  const draftsSent = drafts?.sent || 0;
  const draftsConverted = drafts?.converted || 0;

  return (
    <div className="mt-6 space-y-6" data-testid="network-health-panel">
      {/* ── Header ── */}
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight flex items-center gap-2">
              <Activity size={24} /> Network Health
            </h2>
            <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
              <strong className="text-[#2B2A29]">{totalTherapists}</strong> active
              therapists · <strong className="text-[#D45D5D]">{gapSummary.critical || 0}</strong> critical
              gaps · <strong className="text-[#C87965]">{gapSummary.warning || 0}</strong> warnings
              · <strong className="text-[#2D4A3E]">{draftsTotal}</strong> recruit drafts
            </p>
          </div>
          <button
            type="button"
            onClick={loadGaps}
            disabled={gapLoading}
            className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50] disabled:opacity-50"
          >
            {gapLoading ? <Loader2 size={12} className="inline animate-spin mr-1" /> : null}
            Refresh
          </button>
        </div>
      </div>

      {/* ── Section 1: Coverage Scorecard ── */}
      {gapLoading && !gapData ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Analyzing therapist coverage…
        </div>
      ) : gapData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {allDims.map((dim) => {
            const score = dimScores[dim];
            const hasCritical = score?.critical > 0;
            const hasWarning = score?.warning > 0;
            const isHealthy = !score || score.total === 0;
            const borderColor = hasCritical ? "#D45D5D" : hasWarning ? "#C87965" : "#A5C8A1";
            const bgColor = hasCritical ? "#FDF1EF" : hasWarning ? "#FBF3E8" : "#EAF2E8";
            return (
              <div
                key={dim}
                className="rounded-xl border-2 p-3 text-center"
                style={{ borderColor, background: bgColor }}
                data-testid={`scorecard-${dim}`}
              >
                <div className="text-lg mb-1">{DIM_ICONS[dim]}</div>
                <div className="text-xs font-semibold text-[#2B2A29] uppercase tracking-wider">
                  {DIM_LABELS[dim]}
                </div>
                {isHealthy ? (
                  <div className="mt-1.5 flex items-center justify-center gap-1 text-sm text-[#2D4A3E]">
                    <CheckCircle2 size={14} /> <span>Covered</span>
                  </div>
                ) : (
                  <div className="mt-1.5">
                    {score.critical > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#D45D5D] mr-2">
                        <AlertCircle size={11} /> {score.critical} critical
                      </span>
                    )}
                    {score.warning > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#C87965]">
                        <AlertTriangle size={11} /> {score.warning} warning
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Expand full gap analysis */}
      <CollapsibleSection
        open={showFullGaps}
        onToggle={() => setShowFullGaps((v) => !v)}
        title="Full coverage analysis"
        subtitle={`${totalGaps} gap${totalGaps === 1 ? "" : "s"} across ${Object.keys(dimScores).length} dimensions`}
        icon={<Target size={16} />}
      >
        <CoverageGapPanel
          data={gapData}
          loading={gapLoading}
          onReload={loadGaps}
          client={client}
        />
      </CollapsibleSection>

      {/* ── Section 2: Recruitment Pipeline ── */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <h3 className="font-serif-display text-xl text-[#2D4A3E] flex items-center gap-2 mb-4">
          <Users size={20} /> Recruitment Pipeline
        </h3>

        {/* Pipeline funnel visualization */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
          <PipelineStep
            label="Gaps identified"
            value={totalGaps}
            color="#D45D5D"
            icon={<AlertCircle size={14} />}
          />
          <PipelineStep
            label="Drafts generated"
            value={draftsTotal}
            color="#C87965"
            icon={<Target size={14} />}
          />
          <PipelineStep
            label="Ready to send"
            value={draftsPending}
            color="#B37E35"
            icon={<Send size={14} />}
          />
          <PipelineStep
            label="Emails sent"
            value={draftsSent}
            color="#5F7E94"
            icon={<Send size={14} />}
          />
          <PipelineStep
            label="Converted"
            value={draftsConverted}
            color="#2D4A3E"
            icon={<CheckCircle2 size={14} />}
          />
        </div>

        {/* Auto-recruit controls */}
        <AutoRecruitSection client={client} />

        {/* Recruit drafts */}
        {drafts && draftsTotal > 0 && (
          <div className="mt-4">
            <RecruitDraftsPanel
              data={drafts}
              loading={draftsLoading}
              generating={generating}
              search=""
              onLoad={loadDrafts}
              onGenerate={generateDrafts}
              onDelete={deleteDraft}
              onSendAll={sendAllDrafts}
              onSendPreview={sendPreview}
            />
          </div>
        )}
        {drafts && draftsTotal === 0 && (
          <div className="mt-4 text-center text-sm text-[#6D6A65] bg-[#FDFBF7] rounded-xl p-4 border border-[#E8E5DF]">
            No recruit drafts yet. Use the auto-recruit controls above to generate
            candidates based on your coverage gaps, or run the simulator to find
            weaknesses first.
          </div>
        )}
      </div>

      {/* Scrape Sources (collapsible) */}
      <CollapsibleSection
        open={showSources}
        onToggle={() => setShowSources((v) => !v)}
        title="External directory sources"
        subtitle="URLs the recruiter LLM searches for candidates"
        icon={<TrendingUp size={16} />}
      >
        <ScrapeSourcesPanel client={client} />
      </CollapsibleSection>

      {/* Simulator (collapsible) */}
      <CollapsibleSection
        open={showSimulator}
        onToggle={() => setShowSimulator((v) => !v)}
        title="Matching simulator"
        subtitle="Stress-test your matching engine with synthetic patients"
        icon={<Activity size={16} />}
      >
        {showSimulator && <SimulatorPanel client={client} />}
      </CollapsibleSection>

      {/* ── Section 3: Advertisable Strengths ── */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <h3 className="font-serif-display text-xl text-[#2D4A3E] flex items-center gap-2 mb-2">
          <Megaphone size={20} /> Advertisable Strengths
        </h3>
        <p className="text-sm text-[#6D6A65] mb-4 max-w-2xl leading-relaxed">
          Dimensions where your network is strong enough to advertise confidently.
          Use these to target paid ads — you'll be able to serve the referrals that come in.
        </p>

        {gapData ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {strengths.map((dim) => (
                <div
                  key={dim}
                  className="rounded-xl border-2 border-[#A5C8A1] bg-[#EAF2E8] p-3 text-center"
                >
                  <div className="text-lg">{DIM_ICONS[dim]}</div>
                  <div className="text-xs font-semibold text-[#2D4A3E] uppercase tracking-wider mt-1">
                    {DIM_LABELS[dim]}
                  </div>
                  <div className="text-[10px] text-[#3A6E50] mt-1">
                    Ready to advertise
                  </div>
                </div>
              ))}
            </div>

            {/* Specific strong areas to target with ads */}
            {gapData.summary && (
              <AdTargetSuggestions summary={gapData.summary} gaps={gaps} />
            )}

            {weaknesses.length > 0 && (
              <div className="mt-4 bg-[#FBF3E8] border border-[#EAD9B6] rounded-xl p-3">
                <div className="text-xs font-semibold text-[#9A6E1A] uppercase tracking-wider mb-2">
                  Don't advertise yet — recruit first
                </div>
                <div className="flex flex-wrap gap-2">
                  {weaknesses.map((dim) => (
                    <span key={dim} className="text-xs bg-[#FBECE6] border border-[#F2C9C0] text-[#C87965] px-2 py-1 rounded-full">
                      {DIM_LABELS[dim]} ({dimScores[dim]?.critical} critical)
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function PipelineStep({ label, value, color, icon }) {
  return (
    <div className="text-center p-3 rounded-xl bg-[#FDFBF7] border border-[#E8E5DF]">
      <div className="flex items-center justify-center gap-1 mb-1" style={{ color }}>
        {icon}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value ?? "—"}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mt-0.5">
        {label}
      </div>
    </div>
  );
}

function CollapsibleSection({ open, onToggle, title, subtitle, icon, children }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#FDFBF7] transition-colors"
      >
        <span className="text-[#2D4A3E]">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-[#2B2A29]">{title}</div>
          {subtitle && <div className="text-xs text-[#6D6A65]">{subtitle}</div>}
        </div>
        {open ? (
          <ChevronDown size={16} className="text-[#6D6A65]" />
        ) : (
          <ChevronRight size={16} className="text-[#6D6A65]" />
        )}
      </button>
      {open && <div className="px-5 pb-5 border-t border-[#E8E5DF]">{children}</div>}
    </div>
  );
}

function AdTargetSuggestions({ summary, gaps }) {
  // Find specialties, modalities, age groups where we're strong (not in gaps or only warning)
  const gapKeys = new Set(gaps.filter((g) => g.severity === "critical").map((g) => g.key));

  const strongSpecialties = Object.entries(summary.specialties || {})
    .filter(([k, v]) => v >= 5 && !gapKeys.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const strongModalities = Object.entries(summary.modalities || {})
    .filter(([k, v]) => v >= 5 && !gapKeys.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  if (strongSpecialties.length === 0 && strongModalities.length === 0) return null;

  return (
    <div className="bg-[#EAF2E8] border border-[#A5C8A1] rounded-xl p-4">
      <div className="text-xs font-semibold text-[#2D4A3E] uppercase tracking-wider mb-2">
        Suggested ad keywords
      </div>
      <div className="flex flex-wrap gap-2">
        {strongSpecialties.map(([k, v]) => (
          <span key={k} className="text-xs bg-white border border-[#A5C8A1] text-[#2D4A3E] px-2.5 py-1 rounded-full">
            {k.replace(/_/g, " ")} therapy Idaho
            <span className="text-[10px] text-[#6D6A65] ml-1">({v} providers)</span>
          </span>
        ))}
        {strongModalities.map(([k, v]) => (
          <span key={k} className="text-xs bg-white border border-[#A5C8A1] text-[#2D4A3E] px-2.5 py-1 rounded-full">
            {k} therapist Boise
            <span className="text-[10px] text-[#6D6A65] ml-1">({v})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
