import { useMemo, useState } from "react";

// Requests -> Analytics subtab.
// Computed entirely client-side from the `requests` array AdminDashboard
// already loads -- no new backend endpoint required.
//
// Date picker defaults to last 30 days. KPI tiles + a per-day volume
// bar chart + a source breakdown table.
function toDateInput(d) {
  // YYYY-MM-DD for <input type="date"> -- the HTML spec requires it.
  // Don't expose this string to humans; use displayDate() for that.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Reformat a YYYY-MM-DD string (the canonical key we use for grouping)
// into the MM-DD-YYYY display format requested by Josh.
function displayDate(ymd) {
  if (!ymd || typeof ymd !== "string") return ymd || "";
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[2]}-${m[3]}-${m[1]}`;
}

const TARGET_NOTIFIED = 30;

export default function RequestsAnalyticsPanel({ requests }) {
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
    [today],
  );
  const [startDate, setStartDate] = useState(toDateInput(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(toDateInput(today));

  const inRange = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    return (requests || []).filter((r) => {
      if (!r.created_at) return false;
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t)) return false;
      if (startMs != null && t < startMs) return false;
      if (endMs != null && t > endMs) return false;
      return true;
    });
  }, [requests, startDate, endDate]);

  // KPIs
  const total = inRange.length;
  const completedStatuses = ["matched", "delivered", "results_sent", "completed"];
  const completed = inRange.filter((r) =>
    completedStatuses.includes(String(r.status || "").toLowerCase()),
  ).length;
  const matchRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const notifiedCounts = inRange
    .map((r) => r.notified_count || 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const medianMatches = notifiedCounts.length
    ? notifiedCounts[Math.floor(notifiedCounts.length / 2)]
    : 0;
  const thinCount = inRange.filter(
    (r) =>
      (r.notified_count || 0) > 0 &&
      (r.notified_count || 0) < TARGET_NOTIFIED &&
      completedStatuses.includes(String(r.status || "").toLowerCase()),
  ).length;

  // Per-day volume
  const dailyVolume = useMemo(() => {
    const map = new Map();
    for (const r of inRange) {
      const d = new Date(r.created_at);
      const key = toDateInput(d);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [inRange]);
  const maxDay = dailyVolume.reduce((m, [, n]) => Math.max(m, n), 0);

  // Source breakdown
  const sourceStats = useMemo(() => {
    const map = new Map();
    for (const r of inRange) {
      const key = (r.referral_source || "Unknown").trim() || "Unknown";
      if (!map.has(key)) {
        map.set(key, { label: key, total: 0, completed: 0, notifiedSum: 0 });
      }
      const s = map.get(key);
      s.total += 1;
      if (completedStatuses.includes(String(r.status || "").toLowerCase())) {
        s.completed += 1;
      }
      s.notifiedSum += r.notified_count || 0;
    }
    return Array.from(map.values())
      .map((s) => ({
        ...s,
        matchRate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
        medianMatches: s.total > 0 ? Math.round(s.notifiedSum / s.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [inRange]);

  return (
    <div className="mt-6 space-y-4" data-testid="requests-analytics-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
              Requests &mdash; analytics
            </h2>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Patient-to-therapist matches over time. Quantity, quality, source.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold">Range</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-[#E8E5DF] rounded-md px-2 py-1 text-sm"
            />
            <span className="text-[#6D6A65]">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-[#E8E5DF] rounded-md px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setStartDate(toDateInput(thirtyDaysAgo));
                setEndDate(toDateInput(today));
              }}
              className="text-xs text-[#2D4A3E] underline"
            >
              Last 30d
            </button>
            <button
              type="button"
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="text-xs text-[#6D6A65] underline"
            >
              All time
            </button>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total requests" value={total} />
        <Kpi label="Completed" value={completed} sub={`${matchRate}% match rate`} />
        <Kpi label="Median matches / req" value={medianMatches} sub={`target: ${TARGET_NOTIFIED}`} />
        <Kpi label="Thin shortlists" value={thinCount} sub={`< ${TARGET_NOTIFIED} therapists`} warn={thinCount > 0} />
      </div>

      {/* Daily volume chart */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="font-serif-display text-lg text-[#2D4A3E] mb-3">
          Requests per day
        </div>
        {dailyVolume.length === 0 ? (
          <div className="text-sm text-[#6D6A65] py-8 text-center">
            No requests in this date range.
          </div>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {dailyVolume.map(([day, n]) => {
              const pct = maxDay > 0 ? (n / maxDay) * 100 : 0;
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${displayDate(day)}: ${n}`}>
                  <div
                    className="w-full bg-[#2D4A3E] rounded-t"
                    style={{ height: `${Math.max(pct, 2)}%`, minHeight: 2 }}
                  />
                </div>
              );
            })}
          </div>
        )}
        {dailyVolume.length > 0 && (
          <div className="flex justify-between text-[10px] text-[#6D6A65] mt-2">
            <span>{displayDate(dailyVolume[0][0])}</span>
            <span>{displayDate(dailyVolume[dailyVolume.length - 1][0])}</span>
          </div>
        )}
      </div>

      {/* Source breakdown */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E8E5DF] font-serif-display text-lg text-[#2D4A3E]">
          By referral source
        </div>
        {sourceStats.length === 0 ? (
          <div className="p-8 text-center text-[#6D6A65] text-sm">No data in range.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[#6D6A65]">
              <tr className="text-left">
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Source</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Requests</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Match rate</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Avg matches</th>
              </tr>
            </thead>
            <tbody>
              {sourceStats.map((s, i) => (
                <tr key={i} className="border-t border-[#E8E5DF]">
                  <td className="p-4 text-[#2B2A29]">{s.label}</td>
                  <td className="p-4 text-right font-semibold text-[#2D4A3E]">{s.total}</td>
                  <td className="p-4 text-right">
                    <span className={s.matchRate >= 80 ? "text-[#2D4A3E] font-semibold" : s.matchRate < 50 ? "text-[#C8412B]" : ""}>
                      {s.matchRate}%
                    </span>
                  </td>
                  <td className="p-4 text-right text-[#6D6A65]">{s.medianMatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${warn ? "text-[#C8412B]" : "text-[#2D4A3E]"}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#6D6A65] mt-1">{sub}</div>}
    </div>
  );
}
