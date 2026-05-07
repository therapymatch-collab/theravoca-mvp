import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";

/**
 * CronHealthStrip -- compact horizontal strip showing the last 7 days
 * of daily cron runs. Sits at the top of the admin dashboard so
 * operational issues are visible at a glance.
 */
export default function CronHealthStrip({ client }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await client.get("/admin/cron-health");
        if (!cancelled) setRuns(res.data);
      } catch (e) {
        if (!cancelled) setError("Failed to load cron health");
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  if (error) return null; // silent fail -- don't block dashboard
  if (!runs) {
    return (
      <div className="flex items-center gap-2 text-xs text-[#6D6A65] py-2">
        <Loader2 size={12} className="animate-spin" /> Loading cron health...
      </div>
    );
  }

  // Build a 7-day calendar (today through 6 days ago) so we show gaps
  const today = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const run = runs.find((r) => r.date === iso);
    days.push({ date: iso, run });
  }

  // Warning: today's cron didn't complete and it's past noon ET
  const todayRun = days[0].run;
  const nowET = new Date(
    today.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const pastNoonET = nowET.getHours() >= 12;
  const todayFailed = pastNoonET && (!todayRun || !todayRun.completed_at);

  /** Summarise task counts from a completed cron_runs doc. */
  const summarise = (run) => {
    if (!run || !run.completed_at) return null;
    const parts = [];
    const f = run.followups || {};
    const fTotal = Object.values(f).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0
    );
    if (fTotal > 0) parts.push(`${fTotal} followup${fTotal !== 1 ? "s" : ""}`);

    const sf = run.structured_followups || {};
    const sfTotal = Object.values(sf).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0
    );
    if (sfTotal > 0)
      parts.push(`${sfTotal} structured`);

    const bill = run.billing || {};
    if (bill.charged) parts.push(`${bill.charged} billed`);
    if (bill.failed) parts.push(`${bill.failed} billing fail`);

    const lic = run.license || {};
    if (lic.sent) parts.push(`${lic.sent} license alert${lic.sent !== 1 ? "s" : ""}`);

    const av = run.availability || {};
    const avTotal = (av.sent_email || 0) + (av.sent_sms || 0);
    if (avTotal > 0) parts.push(`${avTotal} avail prompt${avTotal !== 1 ? "s" : ""}`);

    return parts.length > 0 ? parts.join(", ") : "no actions needed";
  };

  const dayLabel = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <div className="mb-6">
      {todayFailed && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-3 text-sm text-red-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span className="font-medium">
            Today's cron did not complete. Production cron may be broken.
          </span>
        </div>
      )}
      <div className="bg-white border border-[#E8E5DF] rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-wider text-[#6D6A65] font-medium">
            Cron health — last 7 days
          </span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map(({ date, run }) => {
            const ok = run && run.completed_at;
            const started = run && run.started_at && !run.completed_at;
            return (
              <div
                key={date}
                className="text-center group relative"
                title={ok ? summarise(run) : started ? "Started but did not complete" : "No cron run"}
              >
                <div className="text-[10px] text-[#6D6A65] mb-1">
                  {dayLabel(date)}
                </div>
                <div
                  className={`
                    inline-flex items-center justify-center w-7 h-7 rounded-full text-sm
                    ${ok
                      ? "bg-green-50 text-green-600"
                      : started
                        ? "bg-red-50 text-red-500"
                        : "bg-gray-100 text-gray-400"
                    }
                  `}
                >
                  {ok ? (
                    <CheckCircle2 size={16} />
                  ) : started ? (
                    <XCircle size={16} />
                  ) : (
                    <span className="text-[10px]">--</span>
                  )}
                </div>
                {ok && (
                  <div className="text-[9px] text-[#6D6A65] mt-1 leading-tight truncate max-w-[90px] mx-auto">
                    {summarise(run)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
