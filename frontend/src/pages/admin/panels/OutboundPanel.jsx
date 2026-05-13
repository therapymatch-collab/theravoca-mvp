import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, MessageSquare, AlertCircle, CheckCircle2, Eye, XCircle, ChevronRight, Send, Calendar, BarChart3, AlertTriangle, Webhook, FileText, Inbox as InboxIcon } from "lucide-react";

// Outbound primary tab. Aggregated view of email + SMS delivery state
// across the system. Reads /admin/outbound/summary, /by-type,
// /scheduled, plus the existing /admin/email-templates list.
//
// Five subtabs (matches v4 mockup):
//   - Recent: chronological feed of outreach_invites
//   - Scheduled: upcoming cron jobs in next 7d
//   - By type: per-template breakdown w/ open rate + fail %
//   - Failed: hard-bounced registry + send-error rows
//   - Webhook stream: raw email_events from Resend (debug)
//   - Templates: link to Content -> Email templates (no mirror)
export default function OutboundPanel({ client }) {
  const [data, setData] = useState(null);
  const [byType, setByType] = useState(null);
  const [scheduled, setScheduled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("recent");
  const [filter, setFilter] = useState("all");           // recent feed status filter

  const refresh = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const [s, bt, sc] = await Promise.all([
        client.get("/admin/outbound/summary").catch(() => ({ data: null })),
        client.get("/admin/outbound/by-type").catch(() => ({ data: null })),
        client.get("/admin/outbound/scheduled").catch(() => ({ data: null })),
      ]);
      setData(s.data || null);
      setByType(bt.data || null);
      setScheduled(sc.data || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const filteredRecent = useMemo(() => {
    const rows = data?.recent_invites || [];
    if (filter === "all") return rows;
    if (filter === "delivered") return rows.filter((r) => r.delivered_at);
    if (filter === "opened") return rows.filter((r) => r.opened_at);
    if (filter === "bounced") return rows.filter((r) => r.bounced_at);
    if (filter === "failed") return rows.filter((r) => r.send_error);
    if (filter === "queued") return rows.filter((r) => !r.sent_at && !r.send_error);
    return rows;
  }, [data, filter]);

  return (
    <div className="mt-6 space-y-4" data-testid="outbound-panel">
      {/* Section header card with icon badge -- mockup-style */}
      <div className="bg-gradient-to-br from-[#FDF7EC] to-[#FDFBF7] border border-[#E8DCC1] rounded-2xl p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#2D4A3E] text-white flex items-center justify-center shrink-0 shadow-sm">
          <Send size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[#8B5A1F] font-semibold">Operational visibility</div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight mt-0.5">Outbound</h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 max-w-2xl leading-relaxed">
            Every email + SMS the system sends, with delivery state from the
            Resend webhook. Use this pre-launch to verify the right messages
            are firing, post-launch to spot bounces + drift in open rates.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50] disabled:opacity-50 shrink-0"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Subtab pills with icons */}
      <div className="flex items-center gap-2 flex-wrap">
        <SubPill active={sub === "recent"} onClick={() => setSub("recent")} label="Recent" icon={<InboxIcon size={12} />} />
        <SubPill active={sub === "scheduled"} onClick={() => setSub("scheduled")} label="Scheduled" icon={<Calendar size={12} />} />
        <SubPill active={sub === "by_type"} onClick={() => setSub("by_type")} label="By type" icon={<BarChart3 size={12} />} />
        <SubPill
          active={sub === "failed"}
          onClick={() => setSub("failed")}
          label="Failed"
          icon={<AlertTriangle size={12} />}
          badge={(data?.kpis?.failed_7d || 0) > 0 ? data.kpis.failed_7d : null}
        />
        <SubPill active={sub === "stream"} onClick={() => setSub("stream")} label="Webhook stream" icon={<Webhook size={12} />} />
        <SubPill active={sub === "templates"} onClick={() => setSub("templates")} label="Templates" icon={<FileText size={12} />} />
      </div>

      {/* KPI strip with accent borders + icons */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Sent today" value={data?.kpis?.sent_today ?? 0} icon={<Send size={14} />} accent="#2D4A3E" />
        <Kpi label="Sent 7d" value={data?.kpis?.sent_7d ?? 0} icon={<CheckCircle2 size={14} />} accent="#4A6B5D" />
        <Kpi label="Queued (last hour)" value={data?.kpis?.queued ?? 0} icon={<Loader2 size={14} />} accent="#D4A843" />
        <Kpi
          label="Failed (7d)"
          value={data?.kpis?.failed_7d ?? 0}
          warn={(data?.kpis?.failed_7d ?? 0) > 0}
          icon={<XCircle size={14} />}
          accent="#D45D5D"
        />
        <Kpi
          label="Top template (7d)"
          value={byType?.top?.title || byType?.top?.template_key || "—"}
          smallValue
          sub={byType?.top ? `${byType.top.sent_7d} sends` : null}
          icon={<BarChart3 size={14} />}
          accent="#C87965"
        />
      </div>

      {/* RECENT subtab */}
      {sub === "recent" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E5DF] flex items-center gap-2 flex-wrap text-sm">
            <span className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold">Filter</span>
            {["all", "queued", "delivered", "opened", "bounced", "failed"].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs px-3 py-1 rounded-full border ${
                  filter === s
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-white text-[#6D6A65] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                {s}
              </button>
            ))}
            <span className="ml-auto text-xs text-[#6D6A65]">
              {filteredRecent.length} of {data?.recent_invites?.length || 0} recent invites
            </span>
          </div>
          {loading && (
            <div className="p-12 text-center text-[#6D6A65]">
              <Loader2 className="animate-spin mx-auto mb-2" /> Loading...
            </div>
          )}
          {!loading && filteredRecent.length === 0 && (
            <div className="p-12 text-center text-[#6D6A65] text-sm">
              No invites match this filter.
            </div>
          )}
          {!loading && filteredRecent.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">When</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Recipient</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Channel</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Status</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Linked to</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecent.map((r) => (
                  <tr key={r.id} className="border-t border-[#E8E5DF]">
                    <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                    </td>
                    <td className="p-3">
                      <div className="text-[#2B2A29]">{r.candidate?.name || r.candidate?.email || r.candidate?.phone || "—"}</div>
                      <div className="text-[10px] text-[#6D6A65]">{r.candidate?.email || r.candidate?.phone || ""}</div>
                    </td>
                    <td className="p-3">
                      <ChannelChip channel={r.channel} />
                    </td>
                    <td className="p-3">
                      <StatusPills row={r} />
                    </td>
                    <td className="p-3 text-xs text-[#6D6A65]">
                      {r.request_id ? <span>R-{String(r.request_id).slice(0, 6)}</span> : <span className="italic">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* FAILED subtab -- hard-bounced registry */}
      {sub === "failed" && (
        <div className="space-y-3">
          <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E8E5DF] font-medium text-[#2D4A3E]">
              Hard-bounced addresses (registry)
              <span className="text-xs text-[#6D6A65] font-normal ml-2">
                permanently skipped by future outreach runs
              </span>
            </div>
            {loading && <div className="p-8 text-center text-[#6D6A65] text-sm">Loading...</div>}
            {!loading && (data?.bounced || []).length === 0 && (
              <div className="p-8 text-center text-[#6D6A65] text-sm">
                No hard-bounced addresses on file. (Resend webhook populates this when configured.)
              </div>
            )}
            {!loading && (data?.bounced || []).length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                  <tr className="text-left">
                    <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Email</th>
                    <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Bounces</th>
                    <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Last reason</th>
                    <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Last bounce</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.bounced || []).map((b) => (
                    <tr key={b.email} className="border-t border-[#E8E5DF]">
                      <td className="p-3 text-[#2B2A29]">{b.email}</td>
                      <td className="p-3 text-right font-semibold text-[#C8412B]">{b.bounce_count || 1}</td>
                      <td className="p-3 text-xs text-[#6D6A65]">{b.last_bounce_reason || "—"}</td>
                      <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                        {b.last_bounce_at ? new Date(b.last_bounce_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E8E5DF] font-medium text-[#2D4A3E]">
              Outreach send errors (last 50)
            </div>
            {loading && <div className="p-8 text-center text-[#6D6A65] text-sm">Loading...</div>}
            {!loading && (() => {
              const errored = (data?.recent_invites || []).filter((r) => r.send_error);
              if (errored.length === 0) {
                return (
                  <div className="p-8 text-center text-[#6D6A65] text-sm">
                    No outreach send errors in the recent window. ✓
                  </div>
                );
              }
              return (
                <table className="w-full text-sm">
                  <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                    <tr className="text-left">
                      <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">When</th>
                      <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Recipient</th>
                      <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Channel</th>
                      <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errored.map((r) => (
                      <tr key={r.id} className="border-t border-[#E8E5DF]">
                        <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                        </td>
                        <td className="p-3">{r.candidate?.email || r.candidate?.phone || "—"}</td>
                        <td className="p-3"><ChannelChip channel={r.channel} /></td>
                        <td className="p-3 text-xs text-[#C8412B]">{r.send_error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* SCHEDULED subtab -- upcoming cron jobs */}
      {sub === "scheduled" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E5DF] flex items-center justify-between">
            <div>
              <div className="font-medium text-[#2D4A3E]">Scheduled (next 7 days)</div>
              <div className="text-xs text-[#6D6A65]">cron jobs + delayed sends -- estimated targets reflect current data</div>
            </div>
          </div>
          {!scheduled && <div className="p-8 text-center text-[#6D6A65] text-sm">Loading...</div>}
          {scheduled && (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Next fire</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Job</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Schedule</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Targets</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Mode</th>
                </tr>
              </thead>
              <tbody>
                {(scheduled?.jobs || []).map((j, i) => (
                  <tr key={i} className="border-t border-[#E8E5DF]">
                    <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                      {j.next_fire ? new Date(j.next_fire).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-[#2B2A29] font-medium">{j.name}</td>
                    <td className="p-3 text-xs text-[#6D6A65]">{j.schedule_label}</td>
                    <td className="p-3 text-right text-[#2D4A3E]">
                      {j.estimated_targets != null ? j.estimated_targets : "—"}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        j.mode === "LIVE"
                          ? "bg-[#E8F0EA] text-[#2D4A3E]"
                          : "bg-[#FBEFE9] text-[#B8742A]"
                      }`}>
                        {j.mode}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* BY TYPE subtab -- per-template aggregation */}
      {sub === "by_type" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E5DF]">
            <div className="font-medium text-[#2D4A3E]">By template</div>
            <div className="text-xs text-[#6D6A65]">
              counts from email_sends &middot; open rate / fail % computed from
              webhook events on the matching resend_email_id
            </div>
          </div>
          {!byType && <div className="p-8 text-center text-[#6D6A65] text-sm">Loading...</div>}
          {byType && (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Template</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Today</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">7d</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Open rate</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-right">Fail %</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {(byType?.rows || []).map((r) => (
                  <tr key={r.template_key} className="border-t border-[#E8E5DF]">
                    <td className="p-3">
                      <div className="text-[#2B2A29] font-medium">{r.title || r.template_key}</div>
                      <div className="text-[10px] text-[#6D6A65]">{r.template_key}</div>
                    </td>
                    <td className="p-3 text-right text-[#2D4A3E]">{r.sent_today}</td>
                    <td className="p-3 text-right text-[#2D4A3E] font-semibold">{r.sent_7d}</td>
                    <td className="p-3 text-right text-[#6D6A65]">
                      {r.open_rate != null ? `${Math.round(r.open_rate * 100)}%` : "—"}
                    </td>
                    <td className={`p-3 text-right ${r.fail_pct != null && r.fail_pct > 0.1 ? "text-[#C8412B]" : "text-[#6D6A65]"}`}>
                      {r.fail_pct != null ? `${Math.round(r.fail_pct * 100)}%` : "—"}
                    </td>
                    <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                      {r.last_sent_at ? new Date(r.last_sent_at).toLocaleString() : <span className="italic">never</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TEMPLATES subtab -- link to Content -> Email templates */}
      {sub === "templates" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
          <div className="font-medium text-[#2D4A3E]">Templates</div>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
            Editing template copy lives at <strong>Content &rarr; Email templates</strong>.
            Open it in a new tab so you can correlate edits with the per-template
            stats on the <strong>By type</strong> subtab here.
          </p>
          <a
            href="/admin/dashboard"
            onClick={(e) => {
              e.preventDefault();
              // Surface a hint -- the real navigation requires going through
              // the AdminTabsBar. We can't trigger a tab switch from inside
              // this child panel without lifting state, so for now we just
              // tell the admin where to go.
              alert("Click the Content primary tab at the top, then 'Email templates'.");
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50]"
          >
            Go to Email templates
          </a>
        </div>
      )}

      {/* WEBHOOK STREAM subtab -- raw email_events from Resend */}
      {sub === "stream" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E5DF] flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="font-medium text-[#2D4A3E]">Raw Resend webhook events</div>
              <div className="text-xs text-[#6D6A65]">last 50 received events &middot; covers ALL outbound email (not just outreach)</div>
            </div>
            <a
              href="https://resend.com/webhooks"
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-[#2D4A3E] underline"
            >
              Resend dashboard ↗
            </a>
          </div>
          {loading && <div className="p-8 text-center text-[#6D6A65] text-sm">Loading...</div>}
          {!loading && (data?.events_recent || []).length === 0 && (
            <div className="p-8 text-center text-[#6D6A65] text-sm">
              No webhook events recorded yet. If you've sent emails recently, the
              webhook may not be configured (set <code>RESEND_WEBHOOK_SECRET</code> on
              Render + add the endpoint URL in Resend's webhooks dashboard).
            </div>
          )}
          {!loading && (data?.events_recent || []).length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                <tr className="text-left">
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Received</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Event</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Recipient</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Subject</th>
                  <th className="px-4 py-3 text-[11px] uppercase tracking-wider font-semibold">Matched</th>
                </tr>
              </thead>
              <tbody>
                {(data?.events_recent || []).map((e, i) => (
                  <tr key={i} className="border-t border-[#E8E5DF]">
                    <td className="p-3 text-xs text-[#6D6A65] whitespace-nowrap">
                      {e.received_at ? new Date(e.received_at).toLocaleString() : ""}
                    </td>
                    <td className="p-3 text-xs">
                      <EventChip type={e.event_type} />
                    </td>
                    <td className="p-3 text-[#2B2A29] text-xs">{e.to || "—"}</td>
                    <td className="p-3 text-xs text-[#6D6A65] truncate max-w-[280px]">{e.subject || "—"}</td>
                    <td className="p-3 text-xs text-[#6D6A65]">
                      {e.invite_id ? <span className="text-[#2D4A3E]">invite</span> : <span className="italic">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SubPill({ active, onClick, label, badge, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition shadow-sm ${
        active ? "bg-[#2D4A3E] text-white shadow-md" : "bg-white border border-[#E8E5DF] text-[#6D6A65] hover:border-[#2D4A3E] hover:text-[#2D4A3E]"
      }`}
    >
      {icon && <span className={active ? "text-white/90" : "text-[#6D6A65]"}>{icon}</span>}
      {label}
      {badge != null && (
        <span className={`text-[10px] px-1.5 rounded-full font-semibold ${active ? "bg-white/20 text-white" : "bg-[#FBE9E5] text-[#C8412B]"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function Kpi({ label, value, warn, smallValue, sub, icon, accent }) {
  const accentColor = accent || (warn ? "#C8412B" : "#2D4A3E");
  return (
    <div
      className="bg-white border border-[#E8E5DF] rounded-2xl p-4 relative overflow-hidden"
      style={{ boxShadow: "0 1px 2px rgba(45,74,62,0.04)" }}
    >
      {/* Top accent stripe in card color */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accentColor }} />
      <div className="flex items-center gap-2">
        {icon && (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${accentColor}15`, color: accentColor }}
          >
            {icon}
          </div>
        )}
        <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold">{label}</div>
      </div>
      <div
        className={`${smallValue ? "text-base" : "text-3xl"} font-semibold mt-2 truncate`}
        style={{ color: accentColor }}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-[#6D6A65] mt-1">{sub}</div>}
    </div>
  );
}

function ChannelChip({ channel }) {
  if (channel === "email") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#2D4A3E] bg-[#EAF2E8] px-2 py-0.5 rounded">
        <Mail size={11} /> email
      </span>
    );
  }
  if (channel === "sms") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#C87965] bg-[#FBEFE9] px-2 py-0.5 rounded">
        <MessageSquare size={11} /> sms
      </span>
    );
  }
  return <span className="text-xs text-[#6D6A65] italic">—</span>;
}

function StatusPills({ row }) {
  const pills = [];
  if (row.bounced_at) {
    pills.push(<Pill key="bounced" cls="bg-[#FBE9E5] text-[#C8412B]"><XCircle size={10} className="inline mr-1" />bounced</Pill>);
  } else if (row.complained_at) {
    pills.push(<Pill key="complained" cls="bg-[#FBE9E5] text-[#C8412B]">complained</Pill>);
  } else if (row.opened_at) {
    pills.push(<Pill key="opened" cls="bg-[#E8EEF6] text-[#2A4F73]"><Eye size={10} className="inline mr-1" />opened</Pill>);
  } else if (row.delivered_at) {
    pills.push(<Pill key="delivered" cls="bg-[#E8F0EA] text-[#2D4A3E]"><CheckCircle2 size={10} className="inline mr-1" />delivered</Pill>);
  } else if (row.sent_at) {
    pills.push(<Pill key="sent" cls="bg-[#FFF4D9] text-[#8B5A1F]">sent (no webhook event yet)</Pill>);
  } else if (row.send_error) {
    pills.push(<Pill key="error" cls="bg-[#FBE9E5] text-[#C8412B]"><AlertCircle size={10} className="inline mr-1" />error</Pill>);
  } else {
    pills.push(<Pill key="queued" cls="bg-[#F2EFE8] text-[#6D6A65]">queued</Pill>);
  }
  return <div className="flex flex-wrap gap-1">{pills}</div>;
}

function Pill({ children, cls }) {
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {children}
    </span>
  );
}

function EventChip({ type }) {
  const map = {
    "email.delivered": { label: "delivered", cls: "bg-[#E8F0EA] text-[#2D4A3E]" },
    "email.opened": { label: "opened", cls: "bg-[#E8EEF6] text-[#2A4F73]" },
    "email.clicked": { label: "clicked", cls: "bg-[#E8EEF6] text-[#2A4F73]" },
    "email.bounced": { label: "bounced", cls: "bg-[#FBE9E5] text-[#C8412B]" },
    "email.complained": { label: "complained", cls: "bg-[#FBE9E5] text-[#C8412B]" },
    "email.delivery_delayed": { label: "delayed", cls: "bg-[#FFF4D9] text-[#8B5A1F]" },
  };
  const m = map[type] || { label: type, cls: "bg-[#F2EFE8] text-[#6D6A65]" };
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}
