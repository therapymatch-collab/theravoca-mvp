import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import { StatBox } from "./_panelShared";
import AutoRecruitSection from "./AutoRecruitSection";

// ─── Matching Outcome Simulator ─────────────────────────────────────────────
// Admin-only audit tool. Generates synthetic patient requests, runs them
// through the real matching pipeline, and produces a report with
// suggestions for fixing coverage holes / scoring inconsistencies.
// Backend: `/api/admin/simulator/run` (see backend/simulator.py).

const SEVERITY_STYLES = {
  critical: {
    wrap: "border-[#C87965] bg-[#FBECE6]",
    badge: "bg-[#C87965] text-white",
    icon: <AlertCircle size={16} className="text-[#C87965]" />,
    label: "Critical",
  },
  warning: {
    wrap: "border-[#E5B267] bg-[#FBF3E0]",
    badge: "bg-[#E5B267] text-[#3F3D3B]",
    icon: <AlertTriangle size={16} className="text-[#B37E35]" />,
    label: "Warning",
  },
  info: {
    wrap: "border-[#9BB5C5] bg-[#EEF4F8]",
    badge: "bg-[#9BB5C5] text-white",
    icon: <Info size={16} className="text-[#5F7E94]" />,
    label: "Info",
  },
  ok: {
    wrap: "border-[#A5C8A1] bg-[#EAF2E8]",
    badge: "bg-[#2D4A3E] text-white",
    icon: <CheckCircle2 size={16} className="text-[#2D4A3E]" />,
    label: "Healthy",
  },
};

const FILTER_LABELS = {
  client_type: "Client type",
  age_group: "Age group",
  primary_concern: "Primary concern",
  payment: "Payment / insurance",
  modality: "Format (in-person / telehealth)",
  gender: "Gender preference (HARD)",
  availability: "Availability (HARD)",
  urgency: "Urgency (HARD)",
  language: "Preferred language (HARD)",
  state: "Licensed state",
};

const HARD_LABELS = {
  insurance: "Insurance",
  availability: "Availability",
  urgency: "Urgency",
  gender: "Gender required",
  language: "Non-English language",
  format_in_person: "In-person only",
  format_telehealth: "Telehealth only",
  strict_priorities: "Strict priorities",
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Histogram({ data }) {
  const entries = Object.entries(data || {});
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="flex items-end gap-2 h-32 mt-3" data-testid="sim-histogram">
      {entries.map(([k, v]) => {
        const pct = (v / max) * 100;
        const empty = v === 0;
        return (
          <div key={k} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="flex-1 w-full flex items-end">
              <div
                className={`w-full rounded-t ${
                  empty ? "bg-[#E8E5DF]" : "bg-[#2D4A3E]"
                }`}
                style={{ height: `${empty ? 2 : pct}%` }}
              />
            </div>
            <div className="text-[10px] text-[#6D6A65] uppercase tracking-wider">{k}</div>
            <div className="text-xs font-semibold text-[#3F3D3B]">{v}</div>
          </div>
        );
      })}
    </div>
  );
}

function FilterBars({ failures }) {
  const entries = Object.entries(failures || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="space-y-2 mt-3" data-testid="sim-filter-bars">
      {entries.map(([k, v]) => {
        const pct = (v / max) * 100;
        const label = FILTER_LABELS[k] || k.replace(/_/g, " ");
        return (
          <div key={k} className="flex items-center gap-3 text-sm">
            <div className="w-44 shrink-0 text-[#3F3D3B] truncate">{label}</div>
            <div className="flex-1 bg-[#F2EFE9] rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-[#C87965]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-14 text-right text-xs font-semibold text-[#6D6A65] tabular-nums">
              {v.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SuggestionCard({ item, onAction, disabled }) {
  const style = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.info;
  const btnClass =
    item.severity === "critical"
      ? "bg-[#C87965] text-white hover:bg-[#9B5343]"
      : item.severity === "warning"
      ? "bg-[#E5B267] text-[#3F3D3B] hover:bg-[#C99944]"
      : item.severity === "ok"
      ? "bg-[#2D4A3E] text-white hover:bg-[#1F362D]"
      : "bg-[#5F7E94] text-white hover:bg-[#4B6778]";
  return (
    <div
      className={`border rounded-2xl p-4 ${style.wrap}`}
      data-testid={`sim-suggestion-${item.severity}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{style.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
              {style.label}
            </span>
          </div>
          <div className="mt-1.5 font-semibold text-[#2D4A3E]">{item.title}</div>
          <p className="mt-1 text-sm text-[#3F3D3B] leading-relaxed">{item.body}</p>
          {item.action && item.action_type && (
            <button
              type="button"
              onClick={() => onAction?.(item)}
              disabled={disabled}
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${btnClass}`}
              data-testid={`sim-suggestion-action-${item.action_type}`}
            >
              {item.action}
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HardBadges({ flags }) {
  if (!flags?.length) {
    return (
      <span className="text-[11px] text-[#6D6A65] italic">No HARD filters</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#C87965] text-white"
        >
          {HARD_LABELS[f] || f.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function RequestRow({ req, idx, open, onToggle }) {
  const poolClass =
    req.notified_count === 0
      ? "text-[#C87965]"
      : req.notified_count < 10
      ? "text-[#B37E35]"
      : "text-[#2D4A3E]";
  return (
    <div
      className="border border-[#E8E5DF] rounded-xl bg-white"
      data-testid={`sim-req-${idx}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left"
        data-testid={`sim-req-toggle-${idx}`}
      >
        <div className="text-xs font-semibold text-[#6D6A65] w-6 tabular-nums">
          #{idx + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[#2D4A3E] capitalize text-sm">
              {req.primary_concern?.replace(/_/g, " ") || "—"}
            </span>
            {req.deep_match_opt_in && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF4F8] text-[#5F7E94]">
                deep-match
              </span>
            )}
          </div>
          <div className="mt-1">
            <HardBadges flags={req.hard_flags} />
          </div>
        </div>
        <div className="hidden sm:block text-right text-xs text-[#6D6A65] w-24">
          eligible
          <div className="font-semibold text-[#2D4A3E] text-sm">
            {req.eligible_count}
          </div>
        </div>
        <div className="text-right text-xs text-[#6D6A65] w-20">
          notified
          <div className={`font-semibold text-sm ${poolClass}`}>
            {req.notified_count}
          </div>
        </div>
        <div className="hidden sm:block text-right text-xs text-[#6D6A65] w-16">
          apps
          <div className="font-semibold text-[#2D4A3E] text-sm">
            {req.applications}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`text-[#6D6A65] transition shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          className="border-t border-[#E8E5DF] p-3 sm:p-4 space-y-4 bg-[#FDFBF7]"
          data-testid={`sim-req-detail-${idx}`}
        >
          <p className="text-sm text-[#3F3D3B] italic">{req.summary}</p>

          {Object.keys(req.filter_failures || {}).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">
                Why the pool shrank
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {Object.entries(req.filter_failures)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 rounded-full bg-white border border-[#E8E5DF] text-[#3F3D3B]"
                    >
                      {FILTER_LABELS[k] || k.replace(/_/g, " ")}:{" "}
                      <span className="font-semibold">{v}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {(req.top10_step1 || []).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">
                Step-1 top 10 (algorithm match scores)
              </div>
              <div className="bg-white border border-[#E8E5DF] rounded-lg divide-y divide-[#E8E5DF] overflow-hidden text-sm">
                {req.top10_step1.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-xs text-[#6D6A65] w-5 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-[#3F3D3B]">
                      {t.therapist_name || t.therapist_id}
                    </span>
                    <span className="text-sm font-semibold text-[#2D4A3E] tabular-nums">
                      {Math.round(t.step1_score ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(req.final_top5 || []).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">
                Step-2 final top 5 (after synthetic applications)
              </div>
              <div className="space-y-2">
                {req.final_top5.map((a, i) => {
                  const delta = a.step2_delta;
                  const deltaColor =
                    delta > 0
                      ? "text-[#2D4A3E]"
                      : delta < 0
                      ? "text-[#C87965]"
                      : "text-[#6D6A65]";
                  return (
                    <div
                      key={i}
                      className="bg-white border border-[#E8E5DF] rounded-lg p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[#6D6A65] tabular-nums">
                          {i + 1}
                        </span>
                        <span className="font-semibold text-[#2D4A3E] flex-1 min-w-0 truncate">
                          {a.therapist_name || a.therapist_id}
                        </span>
                        <span className="text-xs text-[#6D6A65]">
                          Step-1:{" "}
                          <span className="text-[#3F3D3B] font-semibold">
                            {Math.round(a.step1_score ?? 0)}
                          </span>
                        </span>
                        <span className="text-xs text-[#6D6A65]">
                          Step-2:{" "}
                          <span className="text-[#2D4A3E] font-semibold">
                            {Math.round(a.step2_score ?? 0)}
                          </span>
                        </span>
                        <span className={`text-xs font-semibold ${deltaColor}`}>
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-[#3F3D3B] italic leading-relaxed line-clamp-2">
                        "{a.blurb}"
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[#6D6A65]">
                        {Object.entries(a.step2_breakdown || {}).map(([k, v]) => (
                          <span
                            key={k}
                            className={`px-1.5 py-0.5 rounded ${
                              v < 0
                                ? "bg-[#FBECE6] text-[#C87965]"
                                : "bg-[#EAF2E8] text-[#2D4A3E]"
                            }`}
                          >
                            {k.replace(/_/g, " ")}: {v > 0 ? "+" : ""}
                            {v}
                          </span>
                        ))}
                        {Object.entries(a.toggles || {})
                          .filter(([, v]) => !v)
                          .map(([k]) => (
                            <span
                              key={k}
                              className="px-1.5 py-0.5 rounded bg-[#F2EFE9] text-[#6D6A65]"
                            >
                              ✕ {k.replace(/_/g, " ")}
                            </span>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SimulatorPanel({ client, setTab }) {
  const [numRequests, setNumRequests] = useState(50);
  const [notifyTopN, setNotifyTopN] = useState(30);
  const [seed, setSeed] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [runs, setRuns] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [openIdx, setOpenIdx] = useState(null);
  const filtersRef = useRef(null);
  const clustersRef = useRef(null);

  const loadRuns = async () => {
    setListLoading(true);
    try {
      const r = await client.get("/admin/simulator/runs", { params: { limit: 20 } });
      setRuns(r.data?.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load simulator history");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const runSim = async (overrides = {}) => {
    if (running) return;
    setRunning(true);
    setReport(null);
    setOpenIdx(null);
    try {
      const payload = {
        num_requests: Number(overrides.num_requests ?? numRequests) || 50,
        notify_top_n: Number(overrides.notify_top_n ?? notifyTopN) || 30,
      };
      const rawSeed = overrides.random_seed ?? seed;
      const parsedSeed = rawSeed === "" || rawSeed == null ? null : Number(rawSeed);
      if (parsedSeed !== null && !Number.isNaN(parsedSeed)) {
        payload.random_seed = parsedSeed;
      }
      const r = await client.post("/admin/simulator/run", payload);
      setReport(r.data);
      if (r.data?.status === "error") {
        toast.error(r.data?.error || "Simulator returned an error");
      } else {
        toast.success(`Ran ${r.data?.params?.num_requests || 0} synthetic requests in ${r.data?.duration_sec}s`);
        loadRuns();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Simulator run failed");
    } finally {
      setRunning(false);
    }
  };

  const scrollToRef = (ref) => {
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const dispatchAction = (item) => {
    const t = item.action_type;
    if (!t) return;
    if (t === "open_coverage_gaps") {
      if (typeof setTab === "function") {
        setTab("coverage_gap");
        toast.message("Opening Coverage gaps — recruit therapists to close this filter gap.");
      }
      return;
    }
    if (t === "open_settings") {
      if (typeof setTab === "function") {
        setTab("settings");
        toast.message("Opening Settings — adjust match weights or filter thresholds here.");
      }
      return;
    }
    if (t === "scroll_filters") {
      scrollToRef(filtersRef);
      return;
    }
    if (t === "scroll_clusters") {
      scrollToRef(clustersRef);
      return;
    }
    if (t === "rerun_larger") {
      setNumRequests(100);
      runSim({ num_requests: 100 });
      return;
    }
    if (t === "rerun") {
      runSim();
    }
  };

  const loadPriorRun = async (id) => {
    try {
      const r = await client.get(`/admin/simulator/runs/${id}`);
      setReport(r.data);
      setOpenIdx(null);
      toast.success("Loaded prior run");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load run");
    }
  };

  const deleteRun = async (id) => {
    if (!window.confirm("Delete this simulator run and all its synthetic requests?")) return;
    try {
      await client.delete(`/admin/simulator/runs/${id}`);
      toast.success("Run deleted");
      if (report?.id === id) setReport(null);
      loadRuns();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  const cov = report?.coverage || {};

  return (
    <div className="mt-6 space-y-6" data-testid="simulator-panel">
      {/* ── Auto-recruit closed-loop section ─────────────────── */}
      <AutoRecruitSection client={client} setTab={setTab} />

      {/* ── Header + controls ───────────────────────────── */}
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-[#2D4A3E]" />
              <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
                Matching Outcome Simulator
              </h2>
            </div>
            <p className="mt-1 text-sm text-[#3F3D3B] max-w-2xl">
              Generates synthetic patient requests, runs them through the real
              matching pipeline (Step-1 scoring + synthetic Step-2 applications),
              and surfaces coverage holes, filter dominance, and scoring
              inconsistencies — then suggests what to fix.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold block">
            # of requests
            <input
              type="number"
              min={10}
              max={200}
              value={numRequests}
              onChange={(e) => setNumRequests(e.target.value)}
              className="mt-1 block w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm text-[#3F3D3B] bg-white focus:outline-none focus:border-[#2D4A3E]"
              data-testid="sim-num-requests"
            />
          </label>
          <label className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold block">
            Notify top N
            <input
              type="number"
              min={5}
              max={50}
              value={notifyTopN}
              onChange={(e) => setNotifyTopN(e.target.value)}
              className="mt-1 block w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm text-[#3F3D3B] bg-white focus:outline-none focus:border-[#2D4A3E]"
              data-testid="sim-notify-top-n"
            />
          </label>
          <label className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold block col-span-2 sm:col-span-1">
            Seed (optional)
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              className="mt-1 block w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm text-[#3F3D3B] bg-white focus:outline-none focus:border-[#2D4A3E]"
              data-testid="sim-seed"
            />
          </label>
          <button
            type="button"
            onClick={runSim}
            disabled={running}
            className="mt-auto inline-flex items-center justify-center gap-2 bg-[#2D4A3E] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#1F362D] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="sim-run-btn"
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Running…
              </>
            ) : (
              <>
                <Play size={14} /> Run simulation
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────── */}
      {report?.status === "error" && (
        <div
          className="bg-[#FBECE6] border border-[#C87965] rounded-2xl p-4 text-[#C87965]"
          data-testid="sim-error"
        >
          <div className="font-semibold">Simulator error</div>
          <p className="mt-1 text-sm">{report.error}</p>
        </div>
      )}

      {report?.status === "ok" && (
        <div className="space-y-6" data-testid="sim-report">
          {/* Top stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox
              label="Requests"
              value={cov.total_requests}
            />
            <StatBox
              label="Therapist pool"
              value={cov.pool_size}
            />
            <StatBox
              label="Zero-pool rate"
              value={`${cov.zero_pool_rate_pct ?? 0}%`}
              highlight={(cov.zero_pool_rate_pct ?? 0) > 10}
            />
            <StatBox
              label="Score σ (across runs)"
              value={cov.step1_mean_std_across_runs ?? 0}
              highlight={(cov.step1_mean_std_across_runs ?? 0) > 8}
            />
          </div>

          {/* Suggestions */}
          {report.suggestions?.length > 0 && (
            <div>
              <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h3 className="font-serif-display text-xl text-[#2D4A3E]">
                    Suggested fixes
                  </h3>
                  <p className="text-xs text-[#6D6A65] mt-0.5">
                    Take the action, then re-run — keep iterating until this list is empty.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => runSim()}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white rounded-full px-4 py-1.5 text-xs font-semibold hover:bg-[#1F362D] disabled:opacity-50"
                  data-testid="sim-rerun-btn"
                >
                  {running ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Running…
                    </>
                  ) : (
                    <>
                      <Play size={12} /> Re-run with same params
                    </>
                  )}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.suggestions.map((s, i) => (
                  <SuggestionCard
                    key={i}
                    item={s}
                    onAction={dispatchAction}
                    disabled={running}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Histogram */}
          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5">
            <h3 className="font-serif-display text-lg text-[#2D4A3E]">
              Notified pool distribution
            </h3>
            <p className="text-xs text-[#6D6A65] mt-1">
              How many therapists each synthetic request surfaced. Target: 30.
            </p>
            <Histogram data={cov.notified_histogram} />
            <div className="mt-4 flex gap-4 text-xs text-[#6D6A65] flex-wrap">
              <span className="text-[#C87965] font-semibold">
                ● Zero-pool: {cov.zero_pool_count}
              </span>
              <span className="text-[#B37E35] font-semibold">
                ● Scarce (&lt;10): {cov.scarce_pool_count}
              </span>
              <span className="text-[#2D4A3E] font-semibold">
                ● Healthy (≥10): {cov.healthy_pool_count}
              </span>
            </div>
          </div>

          {/* Filter failures */}
          {Object.keys(cov.filter_failure_totals || {}).length > 0 && (
            <div
              ref={filtersRef}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5 scroll-mt-24"
              data-testid="sim-filters-section"
            >
              <h3 className="font-serif-display text-lg text-[#2D4A3E]">
                Which filters knocked therapists out
              </h3>
              <p className="text-xs text-[#6D6A65] mt-1">
                Total exclusions across the whole run. The top bar is where
                you're losing the most coverage.
              </p>
              <FilterBars failures={cov.filter_failure_totals} />
            </div>
          )}

          {/* Inconsistencies */}
          {report.inconsistencies?.length > 0 && (
            <div
              ref={clustersRef}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5 scroll-mt-24"
              data-testid="sim-clusters-section"
            >
              <h3 className="font-serif-display text-lg text-[#2D4A3E]">
                Inconsistency clusters
              </h3>
              <p className="text-xs text-[#6D6A65] mt-1">
                Similar requests that produced very different notification counts.
                May indicate an over-sensitive axis weight.
              </p>
              <div className="mt-3 space-y-2">
                {report.inconsistencies.map((c, i) => (
                  <div
                    key={i}
                    className="border border-[#E5B267] bg-[#FBF3E0] rounded-lg p-3 text-sm"
                    data-testid={`sim-inconsistency-${i}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[#E5B267] text-[#3F3D3B]">
                        spread {c.spread_pct}%
                      </span>
                      <span className="font-semibold text-[#2D4A3E] capitalize">
                        {c.bucket?.primary_concern?.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-[#6D6A65]">
                        notified range {c.notified_range?.[0]} → {c.notified_range?.[1]}
                      </span>
                    </div>
                    <p className="mt-1 text-[#3F3D3B]">{c.explanation}</p>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="bg-white rounded p-2 border border-[#E8E5DF]">
                        <div className="text-[10px] text-[#6D6A65] uppercase tracking-wider font-semibold">
                          Low — {c.low_request_id}
                        </div>
                        <div className="mt-1">
                          <HardBadges flags={c.low_hard_flags} />
                        </div>
                      </div>
                      <div className="bg-white rounded p-2 border border-[#E8E5DF]">
                        <div className="text-[10px] text-[#6D6A65] uppercase tracking-wider font-semibold">
                          High — {c.high_request_id}
                        </div>
                        <div className="mt-1">
                          <HardBadges flags={c.high_hard_flags} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-request drilldown */}
          <div>
            <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-3">
              Per-request results ({report.requests?.length || 0})
            </h3>
            <div className="space-y-2">
              {(report.requests || []).map((req, idx) => (
                <RequestRow
                  key={req.request_id}
                  req={req}
                  idx={idx}
                  open={openIdx === idx}
                  onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Prior runs ──────────────────────────────────── */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5">
        <h3 className="font-serif-display text-lg text-[#2D4A3E]">Prior runs</h3>
        {listLoading ? (
          <div className="mt-3 text-sm text-[#6D6A65] flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : runs.length === 0 ? (
          <p className="mt-2 text-sm text-[#6D6A65] italic">
            No prior simulator runs yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[#E8E5DF]" data-testid="sim-runs-list">
            {runs.map((r) => {
              const zr = r.coverage?.zero_pool_rate_pct ?? 0;
              const zrColor = zr > 20 ? "text-[#C87965]" : zr > 10 ? "text-[#B37E35]" : "text-[#2D4A3E]";
              return (
                <div
                  key={r.id}
                  className="py-2.5 flex items-center gap-3 flex-wrap"
                  data-testid={`sim-run-row-${r.id}`}
                >
                  <div className="flex-1 min-w-[160px]">
                    <div className="text-sm font-semibold text-[#3F3D3B]">
                      {fmtDate(r.started_at)}
                    </div>
                    <div className="text-xs text-[#6D6A65]">
                      {r.params?.num_requests} requests · pool{" "}
                      {r.params?.therapist_pool_size} · {r.duration_sec}s
                      {r.params?.random_seed != null && (
                        <> · seed {r.params.random_seed}</>
                      )}
                    </div>
                  </div>
                  <div className="text-xs">
                    <span className="text-[#6D6A65]">zero-pool </span>
                    <span className={`font-semibold ${zrColor}`}>{zr}%</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadPriorRun(r.id)}
                    className="text-xs font-semibold text-[#2D4A3E] hover:underline"
                    data-testid={`sim-run-load-${r.id}`}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRun(r.id)}
                    className="text-[#C87965] hover:text-[#9B5343]"
                    aria-label="Delete run"
                    data-testid={`sim-run-delete-${r.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
