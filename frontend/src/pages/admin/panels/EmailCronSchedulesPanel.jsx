/**
 * EmailCronSchedulesPanel
 *
 * Admin > Content > "Email Cron Schedules" chip.
 *
 * Single-page reference of WHEN every TheraVoca email goes out --
 * both cron-driven sends (results sweep, daily 2 AM bundle, workday
 * 10 AM block) and real-time event-triggered sends (signup
 * confirmations, magic codes, referral notifications, etc.).
 *
 * Data is static -- the cron schedule itself is hardcoded in
 * backend/cron.py + backend/email_service.py -- so this panel is
 * read-only. To change a schedule, edit the catalog in
 * backend/email_schedule_catalog.py and redeploy.
 *
 * The quiet-hours column shows the 2026-05-17 categorization in
 * email_service._QUIET_HOURS_DEFERRABLE: green check = always sends
 * immediately (user actively waiting OR Josh's referral always-send
 * rule); amber clock = defers to next 8 AM Idaho local outside the
 * 8 AM-8 PM window.
 */
import { useEffect, useState } from "react";
import { Clock, CheckCircle2, Loader2, AlertTriangle, Inbox, Calendar, Zap } from "lucide-react";
import useAdminClient from "@/lib/useAdminClient";

export default function EmailCronSchedulesPanel() {
  const client = useAdminClient();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .get("/admin/email-cron-schedules")
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load email schedules");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#6D6A65] py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading email schedules...
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="flex items-start gap-2 text-sm text-[#8B3220] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-4 py-3"
        data-testid="email-cron-error"
      >
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="max-w-5xl space-y-8" data-testid="email-cron-panel">
      {/* Header */}
      <header className="space-y-2">
        <h2 className="font-serif-display text-3xl text-[#2D4A3E]">
          Email cron schedules
        </h2>
        <p className="text-sm text-[#6D6A65] leading-relaxed max-w-3xl">
          Complete catalog of when every TheraVoca email can fire --
          both cron-driven (scheduled background jobs) and real-time
          (triggered by a specific user or admin action). To change a
          schedule edit{" "}
          <code className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5">
            backend/email_schedule_catalog.py
          </code>{" "}
          + the matching cron job.
        </p>
      </header>

      {/* Quiet-hours policy callout */}
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold text-[#2D4A3E] mb-2">
          <Clock size={16} />
          Quiet-hours policy
        </div>
        <p className="text-[#2B2A29]/85 leading-relaxed">
          Window:{" "}
          <strong>{data.policy?.quiet_hours_window_local}</strong> in{" "}
          <strong>{data.policy?.quiet_hours_tz}</strong>{" "}
          (Mountain Time, DST-aware).
        </p>
        <p className="text-[#6D6A65] leading-relaxed mt-2">
          {data.policy?.explanation}
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-[#6D6A65]">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-[#2D4A3E]" />
            <span>Sends immediately</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} className="text-[#C87965]" />
            <span>Defers to next 8 AM Idaho</span>
          </span>
        </div>
      </div>

      {/* Cron-driven sends */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-[#2D4A3E]" />
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Cron-driven sends
          </h3>
        </div>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          These run on a fixed schedule and iterate over the universe
          of users to find who qualifies. Trigger conditions are
          checked inside each loop.
        </p>
        {(data.cron_jobs || []).map((job) => (
          <article
            key={job.job_name}
            className="bg-white border border-[#E8E5DF] rounded-xl p-5"
            data-testid={`cron-job-${slugify(job.job_name)}`}
          >
            <header className="mb-3">
              <h4 className="font-semibold text-[#2D4A3E] text-lg">
                {job.job_name}
              </h4>
              <p className="text-xs text-[#C87965] uppercase tracking-wide mt-0.5">
                {job.schedule}
              </p>
            </header>
            <p className="text-sm text-[#6D6A65] leading-relaxed mb-4">
              {job.schedule_detail}
            </p>
            <EmailTable emails={job.emails || []} />
          </article>
        ))}
      </section>

      {/* Real-time sends */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-[#2D4A3E]" />
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Real-time sends
          </h3>
        </div>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          Fired from a route handler when a specific user or admin
          action happens -- not on the cron clock. The quiet-hours
          column applies (some defer to next 8 AM Idaho).
        </p>
        <article className="bg-white border border-[#E8E5DF] rounded-xl p-5">
          <EmailTable emails={data.real_time || []} />
        </article>
      </section>
    </div>
  );
}

function EmailTable({ emails }) {
  if (!emails || emails.length === 0) {
    return (
      <p className="text-sm text-[#6D6A65] italic flex items-center gap-2">
        <Inbox size={14} /> No emails fire from this job.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-[#E8E5DF] text-xs uppercase tracking-wide text-[#6D6A65]">
            <th className="py-2 pr-3 font-semibold">Template</th>
            <th className="py-2 pr-3 font-semibold">Trigger</th>
            <th className="py-2 pr-3 font-semibold">Recipient</th>
            <th className="py-2 pr-3 font-semibold">Timing</th>
          </tr>
        </thead>
        <tbody className="text-[#2B2A29]">
          {emails.map((e, i) => (
            <tr
              key={e.template_key + i}
              className="border-b border-[#E8E5DF]/60 last:border-b-0 align-top"
              data-testid={`email-row-${e.template_key}`}
            >
              <td className="py-3 pr-3 align-top">
                <code className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5 whitespace-nowrap">
                  {e.template_key}
                </code>
              </td>
              <td className="py-3 pr-3 align-top leading-relaxed">
                {e.trigger}
              </td>
              <td className="py-3 pr-3 align-top whitespace-nowrap text-xs text-[#6D6A65]">
                {e.recipient}
              </td>
              <td className="py-3 pr-3 align-top">
                <TimingChip
                  deferred={e.quiet_hours_deferred}
                  why={e.why_now}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimingChip({ deferred, why }) {
  if (deferred) {
    return (
      <div
        className="inline-flex flex-col gap-1"
        title={why || "Defers to next 8 AM Idaho"}
      >
        <span className="inline-flex items-center gap-1 text-xs bg-[#FBE9E5] border border-[#F4C7BE] text-[#8B3220] rounded-full px-2 py-0.5 whitespace-nowrap">
          <Clock size={12} />
          Defers to 8 AM
        </span>
        {why && (
          <span className="text-[11px] text-[#6D6A65] leading-tight max-w-[200px]">
            {why}
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      className="inline-flex flex-col gap-1"
      title={why || "Sends immediately"}
    >
      <span className="inline-flex items-center gap-1 text-xs bg-[#E7F1EC] border border-[#C3DBCF] text-[#2D4A3E] rounded-full px-2 py-0.5 whitespace-nowrap">
        <CheckCircle2 size={12} />
        Sends now
      </span>
      {why && (
        <span className="text-[11px] text-[#6D6A65] leading-tight max-w-[200px]">
          {why}
        </span>
      )}
    </div>
  );
}

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
