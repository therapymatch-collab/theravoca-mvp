import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  ScatterChart, Scatter, ZAxis,
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

export default function OutcomesPanel({ data, loading, onReload }) {
  const [tab, setTab] = useState("marketing");

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

  return (
    <div className="mt-6" data-testid="outcomes-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF] flex-wrap">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Outcomes</h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              Four business questions, four tabs. Each tells you whether one part of the business is working.
            </p>
          </div>
          <button onClick={onReload}
                  disabled={loading}
                  className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
                  data-testid="outcomes-reload">
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
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
                {c.kpi.delta_6mo !== undefined && c.kpi.delta_6mo !== null && (
                  <span className={`text-xs font-medium ${c.kpi.delta_6mo >= 0 ? "text-[#4A6B5D]" : "text-[#D45D5D]"}`}>
                    {c.kpi.delta_6mo >= 0 ? "↑" : "↓"} {Math.abs(c.kpi.delta_6mo)} in 6mo
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
      <Card title="Patient NPS - last 6 months"
            subtitle="Net Promoter Score across all post-match surveys. Rising = more patients recommending us = cheaper acquisition.">
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
              subtitle="From match release to long-term retention. Where do patients drop off?">
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
      <Card title="Therapist NPS - last 6 months"
            subtitle="Will therapists refer other therapists? Strong recruiting flywheel signal.">
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
