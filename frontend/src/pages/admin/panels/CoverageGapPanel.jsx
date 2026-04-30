import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
} from "lucide-react";
import { FactStat } from "./_panelShared";
import { api } from "@/lib/api";

const DIMENSION_LABELS = {
  specialty: "Clinical specialties",
  modality: "Treatment modalities",
  age_group: "Age groups",
  client_type: "Therapy formats",
  insurance: "Insurance plans",
  urgency: "Urgent intake capacity",
  geography: "In-person Idaho coverage",
  fee: "Fee diversity",
};

// Pre-launch coverage report — surfaces gaps in our therapist directory
// so the recruiter knows where to focus outreach.
export default function CoverageGapPanel({ data, loading, onReload }) {
  const [hardCap, setHardCap] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/admin/hard-capacity");
        if (alive) setHardCap(r.data);
      } catch (_) { /* soft-fail */ }
    })();
    return () => { alive = false; };
  }, []);
  if (loading || !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]" data-testid="coverage-gap-loading">
        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
        Analyzing therapist coverage…
      </div>
    );
  }
  const { total_active_therapists: total, summary, gaps, gap_summary } = data;
  const groupedGaps = gaps.reduce((acc, g) => {
    (acc[g.dimension] = acc[g.dimension] || []).push(g);
    return acc;
  }, {});
  return (
    <div className="mt-6 space-y-6" data-testid="coverage-gap-panel">
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            Pre-launch coverage report
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Analyzing <strong className="text-[#2B2A29]">{total}</strong> active
            therapists. Targets are calibrated to TheraVoca's matching algorithm
            weights — gaps below tell you where to focus pre-launch outreach.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs bg-[#D45D5D]/15 text-[#D45D5D] rounded-full px-2.5 py-1" data-testid="gap-critical-count">
            <AlertCircle size={12} /> {gap_summary.critical} critical
          </span>
          <span className="inline-flex items-center gap-1 text-xs bg-[#C87965]/15 text-[#C87965] rounded-full px-2.5 py-1" data-testid="gap-warning-count">
            <AlertTriangle size={12} /> {gap_summary.warning} warning
          </span>
          <button
            type="button"
            onClick={onReload}
            className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
            data-testid="gap-refresh-btn"
          >
            Refresh
          </button>
        </div>
      </div>

      {hardCap && (
        <ProtectedHardSection data={hardCap} />
      )}

      {gap_summary.total === 0 ? (
        <div className="bg-white border border-[#2D4A3E]/30 rounded-2xl p-8 text-center" data-testid="gap-zero-state">
          <CheckCircle2 size={32} className="mx-auto text-[#2D4A3E]" />
          <h3 className="font-serif-display text-xl text-[#2D4A3E] mt-3">
            No coverage gaps detected
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-md mx-auto leading-relaxed">
            Your directory hits every recommended target for launch. You can
            still expand individual buckets, but the matching engine will
            return results for nearly every plausible patient profile today.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedGaps).map(([dim, list]) => (
            <div key={dim} className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden" data-testid={`gap-section-${dim}`}>
              <div className="px-5 py-3 border-b border-[#E8E5DF] bg-[#FDFBF7]">
                <h3 className="text-sm font-semibold text-[#2B2A29]">
                  {DIMENSION_LABELS[dim] || dim}
                  <span className="ml-2 text-xs text-[#6D6A65]">
                    {list.length} gap{list.length === 1 ? "" : "s"}
                  </span>
                </h3>
              </div>
              <ul className="divide-y divide-[#E8E5DF]">
                {list.map((g) => (
                  <li
                    key={`${g.dimension}-${g.key}`}
                    className="px-5 py-4 flex items-start gap-3"
                    data-testid={`gap-${g.dimension}-${g.key}`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {g.severity === "critical" ? (
                        <AlertCircle size={16} className="text-[#D45D5D]" />
                      ) : (
                        <AlertTriangle size={16} className="text-[#C87965]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="font-medium text-sm text-[#2B2A29]">
                          {g.key.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-[#6D6A65]">
                          <span className={`font-semibold ${g.severity === "critical" ? "text-[#D45D5D]" : "text-[#C87965]"}`}>
                            {g.have}
                          </span>
                          <span className="mx-1">/</span>
                          <span>{g.target} target</span>
                          {g.demand && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider">
                              · {g.demand} demand
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
                        {g.recommendation}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistBlock title="Specialties" entries={summary.specialties} />
        <DistBlock title="Top modalities" entries={summary.modalities} max={10} />
        <DistBlock title="Age groups served" entries={summary.age_groups} />
        <DistBlock title="Therapy formats" entries={summary.client_types} />
        <DistBlock title="Insurance accepted" entries={summary.insurance} max={12} />
        <DistBlock title="Credentials" entries={summary.credentials} />
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
        <FactStat label="With Idaho office" value={summary.with_idaho_office} />
        <FactStat label="Telehealth-only" value={summary.telehealth_only} />
        <FactStat label="Sliding scale" value={summary.sliding_scale_count} />
        <FactStat label="Free consult" value={summary.free_consult_count} />
      </div>
    </div>
  );
}

function DistBlock({ title, entries, max = 8 }) {
  const list = Object.entries(entries || {}).slice(0, max);
  const total = list.reduce((s, [, v]) => s + v, 0);
  if (list.length === 0) return null;
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">{title}</div>
      <ul className="space-y-1.5">
        {list.map(([k, v]) => (
          <li key={k} className="flex items-center gap-3 text-sm">
            <div className="flex-1 min-w-0 truncate text-[#2B2A29]">{k}</div>
            <div className="w-32 h-1.5 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden">
              <div
                className="h-full bg-[#2D4A3E]"
                style={{ width: `${total ? Math.round((v / total) * 100) : 0}%` }}
              />
            </div>
            <div className="w-8 text-right text-[#6D6A65] tabular-nums">{v}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Protected HARD selections ────────────────────────────────────────────
// Companion to the patient-side hard-capacity guard. When the active
// directory has < min_required therapists passing a given HARD option,
// the intake UI greys out the toggle so patients don't pin themselves
// into a zero-pool shortlist. This section tells the admin which
// toggles are currently protected and why — so recruiting can target
// the dimensions that are throttling patient choice.
const AXIS_LABELS = {
  language_strict: "Language (HARD)",
  gender_required: "Therapist gender required",
  in_person_only: "In-person only",
  telehealth_only: "Telehealth only",
  insurance_strict: "Insurance must accept",
  urgency_strict: "Urgency must match",
};

function ProtectedHardSection({ data }) {
  const protections = data?.protections || [];
  const minReq = data?.min_required || 30;
  // Group by axis for a cleaner layout.
  const byAxis = {};
  protections.forEach((p) => {
    (byAxis[p.axis] = byAxis[p.axis] || []).push(p);
  });
  const axes = Object.keys(byAxis);
  return (
    <div
      className="bg-white border border-[#E8E5DF] rounded-2xl p-5"
      data-testid="protected-hard-section"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="bg-[#EAF2E8] rounded-full p-2">
          <Shield size={18} className="text-[#2D4A3E]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif-display text-xl text-[#2D4A3E]">
            Protected HARD selections
          </h3>
          <p className="text-sm text-[#6D6A65] mt-1 max-w-2xl leading-relaxed">
            Intake greys out these HARD toggles because fewer than{" "}
            <strong>{minReq}</strong> active therapists would pass them —
            so patients don't accidentally pin themselves into a zero-match
            shortlist. Recruit into these axes to unlock them.
          </p>
        </div>
      </div>
      {axes.length === 0 ? (
        <div className="mt-4 text-sm text-[#2D4A3E] bg-[#EAF2E8] border border-[#A5C8A1] rounded-xl p-3">
          <CheckCircle2 size={14} className="inline -mt-0.5 mr-1.5" />
          Every HARD toggle is available right now — no directory-driven
          protections active.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {axes.map((axis) => (
            <div
              key={axis}
              className="border border-[#E8E5DF] rounded-xl p-3"
              data-testid={`protected-axis-${axis}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#FBECE6] text-[#C87965]">
                  greyed out
                </span>
                <span className="font-semibold text-[#2D4A3E] text-sm">
                  {AXIS_LABELS[axis] || axis}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {byAxis[axis].map((p, i) => (
                  <li
                    key={i}
                    className="text-xs text-[#3F3D3B] flex items-start gap-2"
                  >
                    <span className="text-[#B37E35] font-semibold tabular-nums shrink-0 w-12">
                      {p.count}/{minReq}
                    </span>
                    <span className="flex-1">
                      <span className="font-semibold text-[#2D4A3E] capitalize">
                        {String(p.value).replace(/_/g, " ")}
                      </span>
                      <span className="block text-[#6D6A65] leading-relaxed mt-0.5">
                        {p.label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
