import { useState, useEffect } from "react";
import { Loader2, RotateCw, Download } from "lucide-react";
import { toast } from "sonner";
import useAdminClient from "@/lib/useAdminClient";
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  ScatterChart, Scatter, ZAxis,
  PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell, LabelList,
} from "recharts";

// Palette mirrors the approved mockup.
const C = {
  primary: "#2D4A3E",
  secondary: "#C87965",
  success: "#4A6B5D",
  successLight: "#7C9B8A",
  error: "#D45D5D",
  warn: "#D4A843",
  muted: "#6D6A65",
  border: "#E8E5DF",
  surface: "#FFFFFF",
  surfaceAlt: "#FDFBF7",
  text: "#2B2A29",
};

// Preset date ranges (in days from today). "all" means no params.
const RANGE_PRESETS = [
  { id: "30d",  label: "30d",  days: 30 },
  { id: "90d",  label: "90d",  days: 90 },
  { id: "6mo", label: "6 months", days: 183 },
  { id: "1y",  label: "1 year", days: 365 },
  { id: "all", label: "All time", days: null },
];

function computeRangeParams(rangeId) {
  const preset = RANGE_PRESETS.find((p) => p.id === rangeId);
  if (!preset || preset.days === null) return null;
  const end = new Date();
  const start = new Date(end.getTime() - preset.days * 24 * 60 * 60 * 1000);
  return { start_date: start.toISOString(), end_date: end.toISOString() };
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso.slice(0, 10); }
}

// ───────────────── CSV export utilities ─────────────────
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}
function csvRow(arr) {
  return arr.map(csvCell).join(",");
}
function csvSection(title, headers, rows) {
  const out = [`# ${title}`];
  if (headers && headers.length) out.push(csvRow(headers));
  for (const r of rows || []) out.push(csvRow(r));
  out.push("");
  return out.join("\n");
}
function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function rangeSuffix(range, data) {
  const start = data?.range?.start_date ? data.range.start_date.slice(0, 10) : null;
  const end = data?.range?.end_date ? data.range.end_date.slice(0, 10) : null;
  if (start && end) return `${start}_to_${end}`;
  return range || "all";
}

// Per-tab serializers. Each returns the multi-section CSV body string.
function marketingCsv(d) {
  let out = "";
  out += csvSection(
    "Patient NPS by month",
    ["month", "nps", "n_responses"],
    (d.patient_nps_trend || []).map((p) => [p.month, p.nps, p.n]),
  );
  out += csvSection(
    "Conversion funnel",
    ["stage", "count"],
    [
      ["matches_sent",      d.funnel?.matches_sent ?? 0],
      ["responded_48h",     d.funnel?.responded_48h ?? 0],
      ["picked_3w",         d.funnel?.picked_3w ?? 0],
      ["still_seeing_9w",   d.funnel?.still_seeing_9w ?? 0],
      ["still_seeing_15w",  d.funnel?.still_seeing_15w ?? 0],
    ],
  );
  out += csvSection(
    "Match volume per month",
    ["month", "count"],
    (d.match_volume_monthly || []).map((p) => [p.month, p.count]),
  );
  out += csvSection(
    "NPS by referral source",
    ["source", "nps", "n_responses"],
    (d.nps_by_source || []).map((r) => [r.source, r.nps, r.n]),
  );
  return out;
}

function recruitingCsv(d) {
  let out = "";
  out += csvSection(
    "Therapist NPS by month",
    ["month", "nps", "n_responses"],
    (d.therapist_nps_trend || []).map((p) => [p.month, p.nps, p.n]),
  );
  out += csvSection(
    "New patients per month (therapist-reported)",
    ["month", "count"],
    (d.new_patients_monthly || []).map((p) => [p.month, p.count]),
  );
  out += csvSection(
    "Match fit distribution",
    ["rating", "count"],
    [
      ["poor",      d.match_fit_distribution?.poor ?? 0],
      ["fair",      d.match_fit_distribution?.fair ?? 0],
      ["good",      d.match_fit_distribution?.good ?? 0],
      ["excellent", d.match_fit_distribution?.excellent ?? 0],
    ],
  );
  return out;
}

function satisfactionCsv(d) {
  let out = "";
  out += csvSection(
    "Patient satisfaction summary",
    ["metric", "value"],
    [
      ["nps",                  d.patient?.nps ?? ""],
      ["confidence_3w_avg",    d.patient?.confidence_3w_avg ?? ""],
      ["progress_15w_avg",     d.patient?.progress_15w_avg ?? ""],
      ["n_nps_responses",      d.patient?.n_nps ?? 0],
    ],
  );
  out += csvSection(
    "Patient NPS distribution",
    ["score", "count"],
    (d.patient?.nps_distribution || []).map((c, i) => [i, c]),
  );
  out += csvSection(
    "Therapist satisfaction summary",
    ["metric", "value"],
    [
      ["nps",              d.therapist?.nps ?? ""],
      ["match_fit_avg",    d.therapist?.match_fit_avg ?? ""],
      ["surveyed_count",   d.therapist?.surveyed_count ?? 0],
      ["total_count",      d.therapist?.total_count ?? 0],
      ["n_nps_responses",  d.therapist?.n_nps ?? 0],
    ],
  );
  out += csvSection(
    "Therapist NPS distribution",
    ["score", "count"],
    (d.therapist?.nps_distribution || []).map((c, i) => [i, c]),
  );
  out += csvSection(
    "Selection confidence (3w) by month",
    ["month", "avg", "n_responses"],
    (d.confidence_3w_trend || []).map((p) => [p.month, p.avg, p.n]),
  );
  out += csvSection(
    "Detractor alerts",
    ["nps", "milestone", "patient_email", "referral_source", "submitted_at", "comment"],
    (d.detractors || []).map((r) => [
      r.nps, r.milestone, r.patient_email, r.referral_source, r.submitted_at, r.comment,
    ]),
  );
  const mb = d.milestone_breakdown || {};
  out += csvSection(
    "Milestone breakdown (retention + response rate)",
    [
      "milestone", "due", "responded",
      "picked", "not_picked",
      "still_seeing", "not_still_seeing",
      "response_rate_pct",
    ],
    ["48h", "3w", "9w", "15w"].map((k) => {
      const b = mb[k] || {};
      const due = b.due || 0;
      const responded = b.responded || 0;
      const rate = due > 0 ? Math.round((responded / due) * 100) : "";
      return [
        k, due, responded,
        b.picked ?? "", b.not_picked ?? "",
        b.still_seeing ?? "", b.not_still_seeing ?? "",
        rate,
      ];
    }),
  );
  return out;
}

function matchingCsv(d) {
  let out = "";
  out += csvSection(
    "Match Strength distribution (10-pt buckets)",
    ["bucket_low", "bucket_high", "count"],
    (d.distribution || []).map((c, i) => [
      i * 10, i === 9 ? "100+" : (i + 1) * 10, c,
    ]),
  );
  out += csvSection(
    "Match Strength stats",
    ["metric", "value"],
    [
      ["mean",        d.stats?.mean ?? ""],
      ["median",      d.stats?.median ?? ""],
      ["n",           d.stats?.n ?? 0],
      ["correlation", d.correlation ?? ""],
    ],
  );
  out += csvSection(
    "Avg Match Strength by month",
    ["month", "avg", "n_scored"],
    (d.trend || []).map((p) => [p.month, p.avg, p.n]),
  );
  out += csvSection(
    "Per-patient scatter (Match Strength vs 15w retention)",
    ["match_strength", "retained_at_15w"],
    (d.scatter || []).map((p) => [p.match_strength, p.retained ? 1 : 0]),
  );
  return out;
}

const TAB_CSV_SERIALIZERS = {
  marketing:    marketingCsv,
  recruiting:   recruitingCsv,
  satisfaction: satisfactionCsv,
  matching:     matchingCsv,
};

export default function OutcomesPanel({ data, loading, onReload }) {
  const [tab, setTab] = useState("marketing");
  const [range, setRange] = useState("90d");

  // -- Testing-mode toggle (moved here from the old FeedbackTracking
  //    panel so admins have one consolidated place to control it). --
  const client = useAdminClient();
  const [testingEnabled, setTestingEnabled] = useState(false);
  const [testingBusy, setTestingBusy] = useState(false);

  useEffect(() => {
    client
      .get("/admin/feedback-testing")
      .then((r) => setTestingEnabled(Boolean(r.data?.enabled)))
      .catch(() => {});
  }, [client]);

  const toggleTesting = async () => {
    if (testingBusy) return;
    setTestingBusy(true);
    const next = !testingEnabled;
    try {
      const res = await client.put("/admin/feedback-testing", { enabled: next });
      // Defensive: trust local state if backend response shape is unexpected.
      const serverState =
        typeof res?.data?.enabled === "boolean" ? res.data.enabled : next;
      setTestingEnabled(serverState);
      toast.success(serverState ? "Testing mode ON" : "Testing mode OFF");
    } catch {
      toast.error("Failed to toggle testing mode");
    } finally {
      setTestingBusy(false);
    }
  };

  // On first mount, fetch with the default 90d range so initial load matches.
  // If parent already loaded data with no params, the backend would have
  // defaulted to 90 days anyway, so the values agree.
  const handleRangeChange = (newRangeId) => {
    setRange(newRangeId);
    onReload(computeRangeParams(newRangeId));
  };

  const handleRefresh = () => {
    onReload(computeRangeParams(range));
  };

  const handleExportCsv = () => {
    const serializer = TAB_CSV_SERIALIZERS[tab];
    if (!serializer || !data?.[tab]) {
      toast.error("No data to export for this tab.");
      return;
    }
    const csv = serializer(data[tab]);
    const filename = `outcomes-${tab}-${rangeSuffix(range, data)}.csv`;
    downloadCsv(filename, csv);
    toast.success(`Exported ${filename}`);
  };

  if (loading && !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65]"
           data-testid="outcomes-loading">
        <Loader2 className="animate-spin inline mr-2" /> Loading dashboard data...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65]"
           data-testid="outcomes-empty">
        <p>No data loaded yet.</p>
        <button onClick={onReload}
                className="mt-3 inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline">
          <RotateCw size={14} /> Load now
        </button>
      </div>
    );
  }

  const TABS = [
    { id: "marketing",    label: "Marketing" },
    { id: "recruiting",   label: "Recruiting" },
    { id: "satisfaction", label: "Satisfaction" },
    { id: "matching",     label: "Matching Algorithm" },
  ];

  const rangeStart = data?.range?.start_date;
  const rangeEnd = data?.range?.end_date;

  return (
    <div className="mt-6" data-testid="outcomes-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-[#E8E5DF]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Outcomes</h3>
              <p className="text-sm text-[#6D6A65] mt-1">
                Four business questions, four tabs. Each tells you whether one part of the business is working.
              </p>
              {rangeStart && rangeEnd && (
                <p className="text-xs text-[#6D6A65] mt-2" data-testid="outcomes-range">
                  Showing data from <span className="font-medium text-[#2B2A29]">{formatDate(rangeStart)}</span>
                  {" "}to <span className="font-medium text-[#2B2A29]">{formatDate(rangeEnd)}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2" title="When ON, follow-up survey emails can be fired on-demand for any request (for testing). Turn OFF before launch.">
                <span className="text-xs text-[#6D6A65]">Testing mode</span>
                <button onClick={toggleTesting}
                        disabled={testingBusy}
                        data-testid="feedback-testing-toggle"
                        aria-pressed={testingEnabled}
                        className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                          testingEnabled ? "bg-[#2D4A3E]" : "bg-[#D3D1C7]"
                        }`}>
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 mt-0.5 ${
                    testingEnabled ? "translate-x-5" : "translate-x-0.5"
                  }`} />
                </button>
              </div>
              <button onClick={handleExportCsv}
                      disabled={loading || !data}
                      className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
                      data-testid={`outcomes-export-${tab}`}
                      title={`Download the current ${tab} tab as CSV. Multi-section, opens in Excel.`}>
                <Download size={14} />
                Export CSV
              </button>
              <button onClick={handleRefresh}
                      disabled={loading}
                      className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
                      data-testid="outcomes-reload">
                <RotateCw size={14} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Date range">
            <span className="text-xs uppercase tracking-wider text-[#6D6A65] self-center mr-1">Period:</span>
            {RANGE_PRESETS.map((p) => (
              <button key={p.id}
                      role="radio"
                      aria-checked={range === p.id}
                      onClick={() => handleRangeChange(p.id)}
                      disabled={loading}
                      data-testid={`range-${p.id}`}
                      className={`text-xs px-3 py-1 rounded-full font-medium transition disabled:opacity-50 ${
                        range === p.id
                          ? "bg-[#2D4A3E] text-white"
                          : "bg-[#F2EFE8] text-[#6D6A65] hover:bg-[#E8E5DF]"
                      }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <HeroRow hero={data.hero} />

          <div className="mt-6 flex flex-wrap gap-2" role="tablist">
            {TABS.map((t) => (
              <button key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      data-testid={`outcomes-tab-${t.id}`}
                      className={`inline-flex items-center px-5 py-2 rounded-full text-sm font-medium transition ${
                        tab === t.id
                          ? "bg-[#2D4A3E] text-white"
                          : "bg-[#F2EFE8] text-[#6D6A65] hover:bg-[#E8E5DF]"
                      }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === "marketing"    && <MarketingTab d={data.marketing} />}
            {tab === "recruiting"   && <RecruitingTab d={data.recruiting} />}
            {tab === "satisfaction" && <SatisfactionTab d={data.satisfaction} />}
            {tab === "matching"     && <MatchingTab d={data.matching} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// =================== HERO KPI ROW ===================

function HeroRow({ hero }) {
  const cards = [
    { key: "Marketing",          q: "Would patients recommend us?",          kpi: hero.patient_nps,          fmt: npsFmt,        sub: "Patient NPS" },
    { key: "Recruiting",         q: "Would therapists recommend us?",        kpi: hero.therapist_nps,        fmt: npsFmt,        sub: "Therapist NPS" },
    { key: "Satisfaction",       q: "Is therapy actually working?",          kpi: hero.patient_progress_15w, fmt: ratingFmt,     sub: "Avg progress at 15w" },
    { key: "Matching Algorithm", q: "Does the algorithm predict retention?", kpi: hero.match_correlation,    fmt: corrFmt,       sub: "Match Strength to 15w retention" },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.key} className="bg-white border border-[#E8E5DF] rounded-xl p-5">
          <div className="text-[10px] uppercase tracking-widest text-[#6D6A65] mb-1.5">{c.key}</div>
          <div className="text-xs italic text-[#6D6A65] mb-3">{c.q}</div>
          {c.kpi?.value !== null && c.kpi?.value !== undefined ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-[2.5rem] font-semibold text-[#2D4A3E] leading-none">
                  {c.fmt(c.kpi.value)}
                </span>
                {c.kpi.delta_period !== undefined && c.kpi.delta_period !== null && (
                  <span className={`text-xs font-medium ${c.kpi.delta_period >= 0 ? "text-[#4A6B5D]" : "text-[#D45D5D]"}`}
                        title="Change from first month to last month of selected period">
                    {c.kpi.delta_period >= 0 ? "↑" : "↓"} {Math.abs(c.kpi.delta_period)} in period
                  </span>
                )}
              </div>
              <div className="text-xs text-[#6D6A65] mt-2">{c.sub} &middot; n={c.kpi.n}</div>
            </>
          ) : (
            <NeedsMoreData n={c.kpi?.n || 0} min={c.kpi?.min_n || 0} label={c.sub} />
          )}
        </div>
      ))}
    </div>
  );
}

const npsFmt    = (v) => (v >= 0 ? `+${v}` : `${v}`);
const ratingFmt = (v) => v.toFixed(1);
const corrFmt   = (v) => v.toFixed(2);

function NeedsMoreData({ n, min, label }) {
  const needed = Math.max(0, min - n);
  return (
    <div>
      <div className="font-serif text-lg text-[#6D6A65] italic">Needs more data</div>
      <div className="text-xs text-[#6D6A65] mt-2">
        {label} &middot; have {n}, need {min} ({needed} more)
      </div>
    </div>
  );
}

// =================== TAB 1: MARKETING ===================

function MarketingTab({ d }) {
  const npsData = d.patient_nps_trend.map((p) => ({ month: shortMonth(p.month), nps: p.nps, n: p.n }));
  const npsHasData = npsData.some((p) => p.nps !== null);

  return (
    <div className="space-y-4">
      <Card title="Patient NPS over time"
            subtitle="Net Promoter Score across all post-match surveys for the selected period. Rising = more patients recommending us = cheaper acquisition.">
        {npsHasData ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={npsData} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
              <YAxis domain={[-50, 100]} tick={{ fill: C.muted, fontSize: 12 }} />
              <Tooltip content={<NpsTooltip />} />
              <ReferenceLine y={0} stroke={C.border} />
              <Line type="monotone" dataKey="nps" stroke={C.primary} strokeWidth={3}
                    dot={{ fill: C.primary, r: 5 }} activeDot={{ r: 7 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No NPS responses yet in the last 7 months." />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Conversion funnel"
              subtitle="Events in the selected period at each stage. Note: these aren't strictly the same cohort -- a 9w response counted here belongs to a patient matched 9+ weeks before. Use a wider period for cleaner ratios.">
          <Funnel d={d.funnel} />
        </Card>

        <Card title="Match volume per month"
              subtitle="New patient requests received. Are we growing?">
          {d.match_volume_monthly.some((m) => m.count > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.match_volume_monthly.map((p) => ({ month: shortMonth(p.month), count: p.count }))}
                        margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill={C.primary} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="count" position="top" style={{ fill: C.text, fontSize: 12, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No request data yet." />
          )}
        </Card>
      </div>

      <Card title="NPS by referral source"
            subtitle="Which channels bring the patients who recommend us? Direct ROI signal for marketing spend. Sources with fewer than 3 responses are pooled into 'other'.">
        <NpsBySource rows={d.nps_by_source || []} />
      </Card>
    </div>
  );
}

function NpsBySource({ rows }) {
  if (!rows || rows.length === 0) {
    return <EmptyChart message="No NPS responses linkable to a referral source yet." />;
  }
  const chartData = rows.map((r) => ({
    source: r.source.length > 24 ? r.source.slice(0, 22) + "..." : r.source,
    nps: r.nps,
    n: r.n,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, 50 + chartData.length * 40)}>
      <BarChart layout="vertical" data={chartData} margin={{ top: 10, right: 60, left: 10, bottom: 10 }}>
        <CartesianGrid stroke={C.border} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[-100, 100]} tick={{ fill: C.muted, fontSize: 12 }} />
        <YAxis dataKey="source" type="category" tick={{ fill: C.muted, fontSize: 12 }} width={170} />
        <Tooltip content={<SourceTooltip />} />
        <ReferenceLine x={0} stroke={C.border} />
        <Bar dataKey="nps" radius={[0, 4, 4, 0]}>
          {chartData.map((e, i) => (
            <Cell key={i} fill={e.nps >= 30 ? C.primary : e.nps >= 0 ? C.warn : C.error} />
          ))}
          <LabelList dataKey="nps" position="right"
                     formatter={(v) => v !== null ? (v >= 0 ? `+${v}` : v) : ""}
                     style={{ fill: C.text, fontSize: 12, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SourceTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-md p-2 text-xs shadow-sm">
      <div className="font-medium text-[#2B2A29]">{p.source}</div>
      <div className="text-[#6D6A65]">NPS: <span className="font-semibold text-[#2D4A3E]">{p.nps !== null ? npsFmt(p.nps) : "no data"}</span></div>
      <div className="text-[#6D6A65]">Responses: {p.n}</div>
    </div>
  );
}

function Funnel({ d }) {
  const sent = d.matches_sent || 0;
  const steps = [
    { label: "Matches sent",         count: sent,                  color: C.primary },
    { label: "Responded (48h)",      count: d.responded_48h || 0,  color: "#3A5E50" },
    { label: "Picked therapist (3w)",count: d.picked_3w || 0,      color: C.success },
    { label: "Still in therapy (9w)",count: d.still_seeing_9w || 0,color: "#5E7F70" },
    { label: "Still in therapy (15w)",count: d.still_seeing_15w || 0, color: C.successLight },
  ];
  if (sent === 0) return <EmptyChart message="No matches sent yet." />;
  return (
    <div className="space-y-3 mt-2">
      {steps.map((s) => {
        const pct = sent ? Math.round((s.count / sent) * 100) : 0;
        const width = sent ? Math.max(2, (s.count / sent) * 100) : 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-44 text-sm text-[#2B2A29]">{s.label}</div>
            <div className="flex-1 h-9 bg-[#F2EFE8] rounded-lg relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-lg flex items-center justify-end pr-3 text-white text-sm font-semibold transition-all"
                   style={{ width: `${width}%`, background: s.color }}>
                {s.count}
              </div>
            </div>
            <div className="w-14 text-right text-sm text-[#6D6A65]">{pct}%</div>
          </div>
        );
      })}
    </div>
  );
}

// =================== TAB 2: RECRUITING ===================

function RecruitingTab({ d }) {
  const nps = d.therapist_nps_trend.map((p) => ({ month: shortMonth(p.month), nps: p.nps, n: p.n }));
  const hasNps = nps.some((p) => p.nps !== null);

  const matchFitData = [
    { label: "Poor",      count: d.match_fit_distribution.poor,      color: C.error },
    { label: "Fair",      count: d.match_fit_distribution.fair,      color: C.warn },
    { label: "Good",      count: d.match_fit_distribution.good,      color: C.primary },
    { label: "Excellent", count: d.match_fit_distribution.excellent, color: C.success },
  ];
  const totalFit = matchFitData.reduce((a, b) => a + b.count, 0);
  const goodExcellentPct = totalFit ? Math.round(((d.match_fit_distribution.good + d.match_fit_distribution.excellent) / totalFit) * 100) : null;

  return (
    <div className="space-y-4">
      <Card title="Therapist NPS over time"
            subtitle="Will therapists refer other therapists? Strong recruiting flywheel signal. Scope: selected period.">
        {hasNps ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={nps} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
              <YAxis domain={[-50, 100]} tick={{ fill: C.muted, fontSize: 12 }} />
              <Tooltip content={<NpsTooltip />} />
              <ReferenceLine y={0} stroke={C.border} />
              <Line type="monotone" dataKey="nps" stroke={C.secondary} strokeWidth={3}
                    dot={{ fill: C.secondary, r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No therapist NPS responses yet." />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="New patients per month"
              subtitle="Therapist-reported, from Phase 3 quarterly survey. Volume = retention driver.">
          {d.new_patients_monthly.some((m) => m.count > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.new_patients_monthly.map((p) => ({ month: shortMonth(p.month), count: p.count }))}
                        margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill={C.primary} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="count" position="top" style={{ fill: C.text, fontSize: 12, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No therapist Phase 3 responses yet." />
          )}
        </Card>

        <Card title="Match Fit - how good are referrals?"
              subtitle="Therapist rating of how well incoming patients match their practice focus.">
          {totalFit > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={matchFitData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 12 }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {matchFitData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    <LabelList dataKey="count" position="top" style={{ fill: C.text, fontSize: 12, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="text-sm text-[#6D6A65] mt-3">
                <span className="font-semibold text-[#2D4A3E]">{goodExcellentPct}%</span>
                {" "}of therapists rate referrals "Good" or "Excellent"
              </div>
            </>
          ) : (
            <EmptyChart message="No Match Fit ratings yet." />
          )}
        </Card>
      </div>
    </div>
  );
}

// =================== TAB 3: SATISFACTION ===================

function SatisfactionTab({ d }) {
  const conf = d.confidence_3w_trend.map((p) => ({ month: shortMonth(p.month), avg: p.avg, n: p.n }));
  const hasConf = conf.some((p) => p.avg !== null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SideCard title="Patient satisfaction"
                  kpis={[
                    { label: "NPS",              value: d.patient.nps !== null ? npsFmt(d.patient.nps) : "n/a" },
                    { label: "Confidence (3w)",  value: d.patient.confidence_3w_avg !== null ? d.patient.confidence_3w_avg : "n/a" },
                    { label: "Progress (15w)",   value: d.patient.progress_15w_avg !== null ? d.patient.progress_15w_avg : "n/a" },
                  ]}
                  distribution={d.patient.nps_distribution}
                  n={d.patient.n_nps}
                  quotes={d.patient.recent_quotes} />

        <SideCard title="Therapist satisfaction"
                  kpis={[
                    { label: "NPS",       value: d.therapist.nps !== null ? npsFmt(d.therapist.nps) : "n/a" },
                    { label: "Match Fit", value: d.therapist.match_fit_avg !== null ? d.therapist.match_fit_avg : "n/a" },
                    { label: "Surveyed",  value: `${d.therapist.surveyed_count}/${d.therapist.total_count || "?"}` },
                  ]}
                  distribution={d.therapist.nps_distribution}
                  n={d.therapist.n_nps}
                  quotes={d.therapist.recent_quotes} />
      </div>

      <Card title="Selection confidence (3w) over time"
            subtitle="How sure patients feel about their chosen therapist after 3 weeks. Rising = matching is producing clearer wins early.">
        {hasConf ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={conf} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fill: C.muted, fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="avg" stroke={C.primary} strokeWidth={3}
                    dot={{ fill: C.primary, r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No 3-week confidence data yet." />
        )}
      </Card>

      <MilestoneFunnelCards breakdown={d.milestone_breakdown} />

      <DetractorAlertCard detractors={d.detractors || []} />
    </div>
  );
}

// ─── Retention donuts + response-rate chart per milestone ────────────
function MilestoneFunnelCards({ breakdown }) {
  if (!breakdown) return null;
  const MILESTONES = [
    {
      key: "48h",
      label: "48 hours",
      sub: "Did the patient open the first survey?",
      headline: "responded",
    },
    {
      key: "3w",
      label: "3 weeks",
      sub: "Did the patient pick a therapist?",
      headline: "picked",
    },
    {
      key: "9w",
      label: "9 weeks",
      sub: "Still in therapy at 2 months in?",
      headline: "still_seeing",
    },
    {
      key: "15w",
      label: "15 weeks",
      sub: "Still in therapy at the durability mark?",
      headline: "still_seeing",
    },
  ];
  return (
    <>
      <Card title="Retention by milestone"
            subtitle="Donut shows what happened at each touchpoint. Center number is the headline outcome rate among patients who were due for that survey. 'Not responded' means we never heard back -- a coverage problem, not a treatment problem.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
          {MILESTONES.map((m) => (
            <MilestoneDonut key={m.key} milestone={m} stats={breakdown[m.key] || {}} />
          ))}
        </div>
      </Card>
      <Card title="Survey response rate per milestone"
            subtitle="Of patients who were due for each survey, what % actually answered? Drop-offs here mean we're losing signal -- consider reminder cadence or trimmed surveys.">
        <ResponseRateBars breakdown={breakdown} />
      </Card>
    </>
  );
}

function MilestoneDonut({ milestone, stats }) {
  const due = stats.due || 0;
  const responded = stats.responded || 0;
  const notResponded = Math.max(0, due - responded);

  // Build pie data + headline based on the milestone's outcome of interest.
  let segments;
  let headlinePct;
  let headlineLabel;
  if (milestone.key === "48h") {
    // No "outcome" beyond response itself.
    segments = [
      { name: "Responded",     value: responded,    color: C.success },
      { name: "Not responded", value: notResponded, color: "#E5E1D7" },
    ];
    headlinePct = due > 0 ? Math.round((responded / due) * 100) : null;
    headlineLabel = "responded";
  } else if (milestone.key === "3w") {
    const picked = stats.picked || 0;
    const notPicked = Math.max(0, responded - picked);
    segments = [
      { name: "Picked therapist", value: picked,       color: C.success },
      { name: "Responded, no pick", value: notPicked,  color: C.warn },
      { name: "Not responded",    value: notResponded, color: "#E5E1D7" },
    ];
    headlinePct = due > 0 ? Math.round((picked / due) * 100) : null;
    headlineLabel = "picked";
  } else {
    // 9w + 15w
    const stillSeeing = stats.still_seeing || 0;
    const dropped = Math.max(0, responded - stillSeeing);
    segments = [
      { name: "Still in therapy", value: stillSeeing,  color: C.success },
      { name: "Stopped",          value: dropped,      color: C.error },
      { name: "Not responded",    value: notResponded, color: "#E5E1D7" },
    ];
    headlinePct = due > 0 ? Math.round((stillSeeing / due) * 100) : null;
    headlineLabel = "retained";
  }

  const hasAny = segments.some((s) => s.value > 0);

  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4 text-center"
         data-testid={`milestone-donut-${milestone.key}`}>
      <div className="text-[10px] uppercase tracking-widest text-[#6D6A65]">
        {milestone.label}
      </div>
      <div className="text-xs italic text-[#6D6A65] mt-0.5 mb-2 min-h-[2rem]">
        {milestone.sub}
      </div>
      <div className="relative">
        {hasAny ? (
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={segments}
                dataKey="value"
                innerRadius={42}
                outerRadius={62}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {segments.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [`${v} patient${v === 1 ? "" : "s"}`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-10 text-xs text-[#6D6A65] italic">No data yet</div>
        )}
        {hasAny && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-serif text-2xl text-[#2D4A3E] leading-none">
              {headlinePct !== null ? `${headlinePct}%` : "—"}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-[#6D6A65] mt-1">
              {headlineLabel}
            </div>
          </div>
        )}
      </div>
      <div className="text-[10px] text-[#6D6A65] mt-2">
        {due} due · {responded} responded
      </div>
    </div>
  );
}

function ResponseRateBars({ breakdown }) {
  const rows = ["48h", "3w", "9w", "15w"].map((k) => {
    const b = breakdown[k] || {};
    const due = b.due || 0;
    const responded = b.responded || 0;
    const rate = due > 0 ? Math.round((responded / due) * 100) : null;
    return { milestone: k, due, responded, rate };
  });
  const hasAny = rows.some((r) => r.due > 0);
  if (!hasAny) return <EmptyChart message="No patients have reached the first survey window yet." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
        <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="milestone" tick={{ fill: C.muted, fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fill: C.muted, fontSize: 12 }}
               tickFormatter={(v) => `${v}%`} />
        <Tooltip
          formatter={(v, _name, p) => {
            const row = p?.payload || {};
            return [`${v ?? "—"}% (${row.responded}/${row.due})`, "Response rate"];
          }}
        />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
          {rows.map((r, i) => (
            <Cell key={i}
                  fill={r.rate === null ? "#E5E1D7"
                       : r.rate >= 50 ? C.primary
                       : r.rate >= 25 ? C.warn
                       : C.error} />
          ))}
          <LabelList dataKey="rate"
                     position="top"
                     formatter={(v) => v === null ? "" : `${v}%`}
                     style={{ fill: C.text, fontSize: 12, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DetractorAlertCard({ detractors }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-xl overflow-hidden" data-testid="detractor-card">
      <div className="p-5 border-b border-[#E8E5DF] flex items-start gap-3">
        <div className="mt-1 w-2 h-2 rounded-full bg-[#D45D5D] flex-shrink-0" />
        <div>
          <h4 className="font-serif-display text-xl text-[#2D4A3E]">Detractor alerts</h4>
          <p className="text-sm text-[#6D6A65] mt-1">
            Patients who rated us 0-6 on any NPS survey, newest first. These are the people you want to reach out to personally - a save here is often worth more than acquiring a new patient.
          </p>
          {detractors.length > 0 && (
            <div className="text-xs text-[#6D6A65] mt-2">
              <span className="font-semibold text-[#D45D5D]">{detractors.length}</span> detractor{detractors.length === 1 ? "" : "s"} to follow up with
            </div>
          )}
        </div>
      </div>
      {detractors.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#6D6A65] italic">
          No detractors yet. Good sign.
        </div>
      ) : (
        <div className="divide-y divide-[#E8E5DF]">
          {detractors.map((d, i) => <DetractorRow key={i} d={d} />)}
        </div>
      )}
    </div>
  );
}

function DetractorRow({ d }) {
  const scoreColor = d.nps <= 3 ? C.error : d.nps <= 6 ? C.warn : C.muted;
  const when = d.submitted_at ? new Date(d.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <div className="p-4 flex gap-4 items-start hover:bg-[#FDFBF7]">
      <div className="flex flex-col items-center justify-center w-14 flex-shrink-0">
        <div className="text-3xl font-serif font-semibold leading-none" style={{ color: scoreColor }}>
          {d.nps}
        </div>
        <div className="text-[10px] text-[#6D6A65] uppercase tracking-wide mt-1">NPS</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium text-[#2B2A29] truncate">{d.patient_email || "(no email)"}</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-[#F2EFE8] text-[#6D6A65] rounded">
            {d.milestone}
          </span>
          {d.referral_source && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-[#FBEFE9] text-[#C87965] rounded">
              src: {d.referral_source}
            </span>
          )}
          <span className="text-xs text-[#6D6A65] ml-auto">{when}</span>
        </div>
        {d.comment ? (
          <div className="mt-2 text-xs text-[#2B2A29] leading-relaxed bg-[#FDFBF7] border border-[#E8E5DF] rounded-md p-2.5">
            "{d.comment}"
          </div>
        ) : (
          <div className="mt-2 text-xs text-[#6D6A65] italic">No written comment.</div>
        )}
      </div>
    </div>
  );
}

function SideCard({ title, kpis, distribution, n, quotes }) {
  const histData = (distribution || []).map((c, i) => ({
    score: i, count: c, color: i <= 6 ? C.error : i <= 8 ? C.warn : C.primary,
  }));
  const hasHist = histData.some((h) => h.count > 0);
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-xl p-5">
      <h4 className="font-serif-display text-xl text-[#2D4A3E]">{title}</h4>
      <div className="grid grid-cols-3 gap-3 mt-4">
        {kpis.map((k) => (
          <div key={k.label}>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{k.label}</div>
            <div className="font-serif text-2xl text-[#2D4A3E] mt-1 leading-none">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">NPS distribution (n={n})</div>
        {hasHist ? (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={histData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="score" tick={{ fill: C.muted, fontSize: 10 }} interval={0} />
              <YAxis hide />
              <Tooltip />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {histData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-xs text-[#6D6A65] italic py-6 text-center">No NPS responses yet.</div>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-2">Recent quotes</div>
        {quotes && quotes.length > 0 ? (
          <div className="space-y-2">
            {quotes.slice(0, 3).map((q, i) => (
              <div key={i} className="p-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg text-xs leading-relaxed">
                "{q.text}"
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[#6D6A65] italic">No comments yet.</div>
        )}
      </div>
    </div>
  );
}

// =================== TAB 4: MATCHING ALGORITHM ===================

function MatchingTab({ d }) {
  const dist = d.distribution.map((c, i) => ({
    bucket: i === 9 ? "90+" : `${i * 10}`, count: c,
    color: i < 2 ? C.error : i < 4 ? C.warn : i < 7 ? C.primary : C.success,
  }));
  const hasDist = dist.some((b) => b.count > 0);
  const trend = d.trend.map((p) => ({ month: shortMonth(p.month), avg: p.avg, n: p.n }));
  const hasTrend = trend.some((p) => p.avg !== null);

  const scatterRetained = d.scatter.filter((p) => p.retained).map((p) => ({ x: p.match_strength, y: 1 }));
  const scatterDropped  = d.scatter.filter((p) => !p.retained).map((p) => ({ x: p.match_strength, y: 0 }));
  const scatterN = d.scatter.length;

  return (
    <div className="space-y-4">
      <Card title="Does the algorithm work?"
            subtitle={
              scatterN >= 10
                ? `Each dot is a patient. Green = still seeing therapist at 15w. Red = stopped. ${d.correlation !== null ? `Correlation r = ${d.correlation}` : "Correlation pending more data"}.`
                : `Need at least 10 patients past 15 weeks. Currently have ${scatterN}.`
            }>
        {scatterN >= 10 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="Match Strength" domain={[0, 100]}
                     tick={{ fill: C.muted, fontSize: 12 }}
                     label={{ value: "Match Strength score (0-100)", position: "bottom", fill: C.muted, fontSize: 12 }} />
              <YAxis type="number" dataKey="y" domain={[-0.2, 1.2]} ticks={[0, 1]}
                     tick={{ fill: C.muted, fontSize: 12 }}
                     tickFormatter={(v) => v === 1 ? "Retained" : v === 0 ? "Stopped" : ""} width={80} />
              <ZAxis range={[60, 60]} />
              <Tooltip content={<ScatterTooltip />} />
              <Scatter name="Retained at 15w" data={scatterRetained} fill={C.success} opacity={0.85} />
              <Scatter name="Stopped"         data={scatterDropped}  fill={C.error}   opacity={0.85} />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message={`Need at least 10 patients past 15 weeks (currently ${scatterN}).`} />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Match Strength distribution"
              subtitle={d.stats.n ? `${d.stats.n} scored matches. Most cluster in the strong-fit zone.` : "No Match Strength scores yet."}>
          {hasDist ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dist} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: C.muted, fontSize: 11 }} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {dist.map((e, i) => <Cell key={i} fill={e.color} />)}
                    <LabelList dataKey="count" position="top" style={{ fill: C.text, fontSize: 11, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
                <Stat label="Mean" value={d.stats.mean ?? "-"} />
                <Stat label="Median" value={d.stats.median ?? "-"} />
                <Stat label="n" value={d.stats.n} />
              </div>
            </>
          ) : (
            <EmptyChart message="No Match Strength scores computed yet." />
          )}
        </Card>

        <Card title="Avg Match Strength - trend"
              subtitle="Are matches getting better as the algorithm tunes and the pool grows?">
          {hasTrend ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fill: C.muted, fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="avg" stroke={C.primary} strokeWidth={3}
                      dot={{ fill: C.primary, r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Not enough data for monthly trend yet." />
          )}
        </Card>
      </div>
    </div>
  );
}

// =================== SHARED BITS ===================

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-xl p-5">
      <h4 className="font-serif-display text-xl text-[#2D4A3E]">{title}</h4>
      {subtitle && <p className="text-sm text-[#6D6A65] mt-1">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function EmptyChart({ message }) {
  return (
    <div className="py-12 text-center text-sm text-[#6D6A65] italic">{message}</div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-[#6D6A65]">{label}</div>
      <div className="font-semibold text-[#2D4A3E]">{value}</div>
    </div>
  );
}

function NpsTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-md p-2 text-xs shadow-sm">
      <div className="font-medium text-[#2B2A29]">{p.month}</div>
      <div className="text-[#6D6A65]">NPS: <span className="font-semibold text-[#2D4A3E]">{p.nps !== null ? npsFmt(p.nps) : "no data"}</span></div>
      <div className="text-[#6D6A65]">Responses: {p.n}</div>
    </div>
  );
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-md p-2 text-xs shadow-sm">
      <div className="text-[#6D6A65]">Match Strength: <span className="font-semibold text-[#2D4A3E]">{p.x}</span></div>
      <div className="text-[#6D6A65]">{p.y === 1 ? "Retained at 15w" : "Stopped"}</div>
    </div>
  );
}

// Format "2026-05" -> "May"
function shortMonth(ym) {
  if (!ym || ym.length < 7) return ym || "";
  const m = parseInt(ym.slice(5, 7), 10);
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || ym;
}
