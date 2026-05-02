import { AlertTriangle, MailQuestion, Filter, CheckCircle } from "lucide-react";

export default function MatchGapPanel({ gap }) {
  if (!gap) return null;

  const unverified = gap.patient_verified === false;
  const headline = unverified
    ? "Patient hasn't verified their email yet"
    : `Why we couldn't fill ${gap.target || 30} matches`;

  const notified = gap.notified ?? 0;
  const target = gap.target || 30;
  const total = gap.active_directory || 0;

  // Sort axes: critical first, then warning, then ok
  const sevOrder = { critical: 0, warning: 1, ok: 2 };
  const sortedAxes = [...(gap.axes || [])].sort(
    (a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2)
  );

  // Find the tightest bottleneck
  const bottleneck = sortedAxes.find((a) => a.severity === "critical") ||
    sortedAxes.find((a) => a.severity === "warning");

  const sevStyle = (s) =>
    s === "critical"
      ? "bg-[#FDF1EF] border-[#F2C9C0]"
      : s === "warning"
      ? "bg-[#FBF3E8] border-[#EAD9B6]"
      : "bg-[#F2F7F1] border-[#D2E2D0]";

  const sevTextColor = (s) =>
    s === "critical"
      ? "text-[#D45D5D]"
      : s === "warning"
      ? "text-[#9A6E1A]"
      : "text-[#3F6F4A]";

  const sevBadge = (s) =>
    s === "critical"
      ? { label: "Bottleneck", bg: "bg-[#D45D5D]" }
      : s === "warning"
      ? { label: "Low", bg: "bg-[#C8923A]" }
      : { label: "OK", bg: "bg-[#3F6F4A]" };

  // Plain English explanation of what the count/target means
  const explainAxis = (a) => {
    const isHard = a.label.includes("(HARD)");
    const pct = total > 0 ? Math.round((a.count / total) * 100) : 0;
    if (a.count === 0) {
      return isHard
        ? "No therapists in our directory match this hard requirement. This filter alone blocks all matches."
        : "No therapists match this criterion. Major gap in our network.";
    }
    if (a.severity === "critical") {
      return isHard
        ? `Only ${a.count} therapist(s) pass this hard filter (${pct}% of directory). Not enough to reach ${target} matches.`
        : `Only ${a.count} therapist(s) match (${pct}% of directory). This is the main bottleneck.`;
    }
    if (a.severity === "warning") {
      return `${a.count} therapists match (${pct}% of directory) — below our ${a.target}-match target for this filter.`;
    }
    return `${a.count} therapists match (${pct}% of directory) — healthy coverage.`;
  };

  return (
    <div
      className={`border rounded-2xl p-5 ${
        unverified
          ? "bg-[#FBF3E8] border-[#EAD9B6]"
          : "bg-white border-[#E8E5DF]"
      }`}
      data-testid="match-gap-panel"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            unverified
              ? "bg-[#FBE9C7] text-[#9A6E1A]"
              : "bg-[#FBF3E8] text-[#C87965]"
          }`}
        >
          {unverified ? <MailQuestion size={16} /> : <AlertTriangle size={16} />}
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-[#2B2A29]" data-testid="match-gap-headline">
            {headline}
          </h4>

          {/* Quick summary: notified vs target */}
          {!unverified && (
            <div className="mt-2 flex items-center gap-3 text-sm">
              <span className="text-[#6D6A65]">
                Notified <strong className="text-[#2B2A29]">{notified}</strong> of{" "}
                <strong className="text-[#2B2A29]">{target}</strong> target
              </span>
              <span className="text-[#C5C0B8]">|</span>
              <span className="text-[#6D6A65]">
                Directory: <strong className="text-[#2B2A29]">{total}</strong> active therapists
              </span>
            </div>
          )}

          {/* Bottleneck callout */}
          {!unverified && bottleneck && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-[#FDF1EF] border border-[#F2C9C0]">
              <p className="text-sm text-[#8B3A3A] leading-relaxed">
                <strong>Main bottleneck:</strong> {bottleneck.label.replace(" (HARD)", "")}
                {bottleneck.label.includes("(HARD)") && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-[#D45D5D] text-white rounded">
                    HARD FILTER
                  </span>
                )}
                {" — "}only {bottleneck.count} therapist(s) in our directory match this,
                but we need at least {bottleneck.target} to fill the pool.
                {bottleneck.count === 0 && " This single filter blocks ALL matches."}
              </p>
            </div>
          )}

          {unverified && (
            <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
              {gap.summary}
            </p>
          )}
          {unverified && (
            <p className="text-xs text-[#9A6E1A] mt-2 leading-relaxed font-medium">
              Tip: this isn't a directory problem. Matching runs as soon as
              the patient clicks the verification link in their inbox.
            </p>
          )}
        </div>
      </div>

      {/* Filter breakdown */}
      {!unverified && sortedAxes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-[#6D6A65] uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Filter size={12} /> Filter-by-filter breakdown
          </p>
          <div className="space-y-2">
            {sortedAxes.map((a, i) => {
              const badge = sevBadge(a.severity);
              const isHard = a.label.includes("(HARD)");
              const cleanLabel = a.label.replace(" (HARD)", "");
              const barPct = total > 0 ? Math.min(100, Math.round((a.count / total) * 100)) : 0;
              return (
                <div
                  key={`${a.label}-${i}`}
                  className={`border rounded-xl px-4 py-3 ${sevStyle(a.severity)}`}
                  data-testid={`match-gap-axis-${i}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${sevTextColor(a.severity)}`}>
                        {cleanLabel}
                      </span>
                      {isHard && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#D45D5D] text-white rounded">
                          HARD
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold text-white rounded ${badge.bg}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <span className="text-sm font-mono font-bold">
                      <span className={sevTextColor(a.severity)}>{a.count}</span>
                      <span className="text-[#C5C0B8]"> / {total}</span>
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-1.5 h-1.5 bg-black/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        a.severity === "critical"
                          ? "bg-[#D45D5D]"
                          : a.severity === "warning"
                          ? "bg-[#C8923A]"
                          : "bg-[#3F6F4A]"
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
                    {explainAxis(a)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
