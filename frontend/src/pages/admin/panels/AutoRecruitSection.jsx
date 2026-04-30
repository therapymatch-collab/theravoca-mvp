import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  Shield,
  Bot,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import useAdminClient from "@/lib/useAdminClient";

// ─── Auto-recruit control section ─────────────────────────────────────────
// Self-healing recruiter — runs simulator, builds recruit plan, calls
// gap-recruiter, stamps drafts for admin approval. Embedded at the top
// of the SimulatorPanel because the UX is tightly coupled.

const PRIORITY_STYLES = {
  critical: "bg-[#C87965] text-white",
  high: "bg-[#E5B267] text-[#3F3D3B]",
  medium: "bg-[#9BB5C5] text-white",
};

function PolicyRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold pt-1.5 w-36 shrink-0">
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    ok: { cls: "bg-[#EAF2E8] text-[#2D4A3E]", label: "Cycle completed" },
    paused_target_reached: {
      cls: "bg-[#EAF2E8] text-[#2D4A3E]",
      label: "Paused — target reached",
    },
    skipped: { cls: "bg-[#F2EFE9] text-[#6D6A65]", label: "Skipped" },
    error: { cls: "bg-[#FBECE6] text-[#C87965]", label: "Error" },
  };
  const m = map[status] || { cls: "bg-[#F2EFE9] text-[#6D6A65]", label: status };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      {m.label}
    </span>
  );
}

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

export default function AutoRecruitSection({ client: clientProp, setTab }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [approving, setApproving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cycles, setCycles] = useState([]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        client.get("/admin/auto-recruit/status"),
        client.get("/admin/auto-recruit/cycles", { params: { limit: 10 } }),
      ]);
      setStatus(s.data);
      setCycles(c.data?.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load auto-recruit status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const saveConfig = async (patch) => {
    try {
      const r = await client.put("/admin/auto-recruit/config", patch);
      setStatus((s) => ({ ...(s || {}), config: r.data.config }));
      toast.success("Policy updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await client.post("/admin/auto-recruit/plan");
      setPreview(r.data);
      setExpanded(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const runCycle = async () => {
    if (!window.confirm(
      "Run an auto-recruit cycle now? This will:\n" +
      "• Run a 200-request simulator pass\n" +
      "• Build a recruit plan\n" +
      "• Generate up to N draft invites (dry-run only)\n" +
      "• Queue them for your approval\n\n" +
      "No real emails will be sent."
    )) return;
    setRunning(true);
    try {
      const r = await client.post("/admin/auto-recruit/run");
      const d = r.data;
      if (d.status === "paused_target_reached") {
        toast.success(`Healthy — zero-pool rate ${d.zero_pool_rate_pct_before}% is already ≤ target. No recruiting needed.`);
      } else if (d.status === "ok") {
        toast.success(`Cycle complete — ${d.drafts_created} new drafts queued for approval`);
      } else {
        toast.error(d.reason || d.status || "Cycle skipped");
      }
      loadStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cycle failed");
    } finally {
      setRunning(false);
    }
  };

  const approveCycle = async (cycleId) => {
    if (!window.confirm("Approve all pending drafts from this cycle? They'll stay in dry-run until you click 'Send all' in Coverage gaps.")) return;
    setApproving(true);
    try {
      const r = await client.post("/admin/auto-recruit/approve", { cycle_id: cycleId });
      toast.success(`Approved ${r.data.approved} draft${r.data.approved === 1 ? "" : "s"}`);
      loadStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Approve failed");
    } finally {
      setApproving(false);
    }
  };

  const cfg = status?.config || {};
  const last = status?.last_cycle;
  const pending = status?.pending_approval_count || 0;

  return (
    <div
      className="bg-white border-2 border-[#2D4A3E] rounded-2xl p-5 sm:p-6"
      data-testid="auto-recruit-section"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="bg-[#EAF2E8] rounded-full p-2.5">
          <Bot size={20} className="text-[#2D4A3E]" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
            Auto-recruit loop
          </h2>
          <p className="mt-1 text-sm text-[#3F3D3B] max-w-2xl leading-relaxed">
            <strong>Simulator → Coverage gaps → Gap recruiter → Admin approval</strong>.
            Weekly cycle runs a 200-request simulation, identifies zero-pool
            hotspots, and generates draft invites to real therapists that
            close those gaps. Cycles pause automatically once the zero-pool
            rate drops to ≤{cfg.target_zero_pool_pct ?? 5}%.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing || running}
            className="inline-flex items-center gap-1.5 border border-[#E8E5DF] text-[#3F3D3B] rounded-lg px-3 py-2 text-xs font-semibold hover:bg-[#FDFBF7] disabled:opacity-50"
            data-testid="auto-recruit-preview-btn"
          >
            {previewing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Previewing…
              </>
            ) : (
              "Preview plan"
            )}
          </button>
          <button
            type="button"
            onClick={runCycle}
            disabled={running || previewing || !cfg.enabled}
            className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white rounded-lg px-3 py-2 text-xs font-semibold hover:bg-[#1F362D] disabled:opacity-50"
            data-testid="auto-recruit-run-btn"
          >
            {running ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Running…
              </>
            ) : (
              <>
                <Play size={12} /> Run cycle now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live status row */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div
          className={`border rounded-xl p-3 ${cfg.enabled ? "border-[#A5C8A1] bg-[#EAF2E8]" : "border-[#E8E5DF] bg-[#F2EFE9]"}`}
          data-testid="auto-recruit-status-enabled"
        >
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold">
            Loop
          </div>
          <div className="mt-1 font-semibold text-[#2D4A3E] flex items-center gap-1.5">
            {cfg.enabled ? (
              <>
                <CheckCircle2 size={14} className="text-[#2D4A3E]" /> Enabled
              </>
            ) : (
              <>
                <AlertTriangle size={14} className="text-[#6D6A65]" /> Disabled
              </>
            )}
          </div>
        </div>
        <div className="border border-[#E8E5DF] bg-[#FDFBF7] rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold">
            Mode
          </div>
          <div className="mt-1 font-semibold text-[#2D4A3E] flex items-center gap-1.5">
            <Shield size={14} className="text-[#2D4A3E]" /> Dry-run
          </div>
        </div>
        <div className="border border-[#E8E5DF] bg-[#FDFBF7] rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold">
            Last cycle
          </div>
          <div className="mt-1 text-xs text-[#3F3D3B] flex items-center gap-1.5">
            <Clock size={12} className="text-[#6D6A65]" />
            {last ? fmtDate(last.started_at) : "Never"}
          </div>
          {last && (
            <div className="mt-1">
              <StatusPill status={last.status} />
            </div>
          )}
        </div>
        <div
          className={`border rounded-xl p-3 ${pending > 0 ? "border-[#E5B267] bg-[#FBF3E0]" : "border-[#E8E5DF] bg-[#FDFBF7]"}`}
          data-testid="auto-recruit-status-pending"
        >
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] font-semibold">
            Drafts awaiting approval
          </div>
          <div className={`mt-1 font-serif-display text-2xl ${pending > 0 ? "text-[#B37E35]" : "text-[#2D4A3E]"}`}>
            {pending}
          </div>
        </div>
      </div>

      {/* Policy config */}
      <details className="mt-4 border border-[#E8E5DF] rounded-xl overflow-hidden">
        <summary
          className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-[#3F3D3B] bg-[#FDFBF7] hover:bg-[#F2EFE9]"
          data-testid="auto-recruit-policy-toggle"
        >
          Policy & safety rails
        </summary>
        <div className="p-4 divide-y divide-[#E8E5DF]">
          <PolicyRow label="Enabled">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!cfg.enabled}
                onChange={(e) => saveConfig({ enabled: e.target.checked })}
                className="h-4 w-4"
                data-testid="auto-recruit-policy-enabled"
              />
              <span className="text-sm text-[#3F3D3B]">
                Run weekly (Mondays, 2am MT) + respond to manual triggers
              </span>
            </label>
          </PolicyRow>
          <PolicyRow label="Target zero-pool rate">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={cfg.target_zero_pool_pct ?? 5}
                onChange={(e) =>
                  saveConfig({ target_zero_pool_pct: Number(e.target.value) || 5 })
                }
                className="w-20 border border-[#E8E5DF] rounded px-2 py-1 text-sm"
                data-testid="auto-recruit-policy-target"
              />
              <span className="text-sm text-[#3F3D3B]">
                % — pause recruiting once zero-pool rate is at or below this.
              </span>
            </div>
          </PolicyRow>
          <PolicyRow label="Drafts per cycle">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={cfg.max_drafts_per_cycle ?? 10}
                onChange={(e) =>
                  saveConfig({ max_drafts_per_cycle: Number(e.target.value) || 10 })
                }
                className="w-20 border border-[#E8E5DF] rounded px-2 py-1 text-sm"
                data-testid="auto-recruit-policy-drafts"
              />
              <span className="text-sm text-[#3F3D3B]">
                Cap on LLM/Places candidate drafts generated per cycle.
              </span>
            </div>
          </PolicyRow>
          <PolicyRow label="Send cap (email/day)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                value={cfg.max_sends_per_day_email ?? 10}
                onChange={(e) =>
                  saveConfig({ max_sends_per_day_email: Number(e.target.value) || 10 })
                }
                className="w-20 border border-[#E8E5DF] rounded px-2 py-1 text-sm"
                data-testid="auto-recruit-policy-send-cap-email"
              />
              <span className="text-sm text-[#3F3D3B]">
                Daily outreach cap per channel (enforced once live).
              </span>
            </div>
          </PolicyRow>
          <PolicyRow label="Require approval">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!cfg.require_approval}
                onChange={(e) => saveConfig({ require_approval: e.target.checked })}
                className="h-4 w-4"
                data-testid="auto-recruit-policy-approval"
              />
              <span className="text-sm text-[#3F3D3B]">
                Admin must approve each batch before drafts become sendable.
              </span>
            </label>
          </PolicyRow>
        </div>
      </details>

      {/* Pending approval action */}
      {pending > 0 && last && (
        <div
          className="mt-4 bg-[#FBF3E0] border border-[#E5B267] rounded-xl p-4 flex items-start gap-3 flex-wrap"
          data-testid="auto-recruit-approval-bar"
        >
          <AlertTriangle size={18} className="text-[#B37E35] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-[#3F3D3B]">
              {pending} draft{pending === 1 ? "" : "s"} awaiting your approval
            </div>
            <p className="text-sm text-[#3F3D3B] mt-0.5">
              Generated by the last cycle. Review them in Coverage gaps, then approve here to let them become sendable.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setTab?.("coverage_gap")}
              className="bg-white border border-[#E8E5DF] text-[#3F3D3B] rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-[#FDFBF7]"
              data-testid="auto-recruit-review-btn"
            >
              Review drafts →
            </button>
            <button
              type="button"
              onClick={() => approveCycle(last.id)}
              disabled={approving}
              className="bg-[#2D4A3E] text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-[#1F362D] disabled:opacity-50"
              data-testid="auto-recruit-approve-btn"
            >
              {approving ? "Approving…" : `Approve all ${pending}`}
            </button>
          </div>
        </div>
      )}

      {/* Plan preview */}
      {preview && expanded && (
        <div
          className="mt-4 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4"
          data-testid="auto-recruit-plan-preview"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-serif-display text-lg text-[#2D4A3E]">
              Plan preview
            </h3>
            <span className="text-xs text-[#6D6A65]">
              zero-pool {preview.zero_pool_rate_pct}% · pool {preview.pool_size} · {preview.plan_total} recruit targets
            </span>
          </div>
          <p className="mt-1 text-xs text-[#6D6A65]">
            What the next cycle would recruit for. Click "Run cycle now" to commit.
          </p>
          <div className="mt-3 divide-y divide-[#E8E5DF]">
            {(preview.plan || []).map((p, i) => (
              <div
                key={i}
                className="py-2 flex items-center gap-3 flex-wrap text-sm"
                data-testid={`auto-recruit-plan-row-${i}`}
              >
                <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[p.priority] || PRIORITY_STYLES.medium}`}>
                  {p.priority}
                </span>
                <span className="font-semibold text-[#2D4A3E] flex-1 min-w-0">
                  {p.label}
                  {p.slug && (
                    <span className="text-[#6D6A65] font-normal"> · {p.slug}</span>
                  )}
                </span>
                <span className="text-xs text-[#6D6A65]">
                  sim {p.sim_pct}% of exclusions
                </span>
                {p.deficit != null && (
                  <span className="text-xs text-[#3F3D3B]">
                    need{" "}
                    <span className="font-semibold text-[#C87965]">
                      +{p.deficit}
                    </span>{" "}
                    (have {p.current} / target {p.target})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycles history */}
      {cycles.length > 0 && (
        <details
          className="mt-4 border border-[#E8E5DF] rounded-xl overflow-hidden"
          data-testid="auto-recruit-cycles-history"
        >
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-[#3F3D3B] bg-[#FDFBF7] hover:bg-[#F2EFE9]">
            Recent cycles ({cycles.length})
          </summary>
          <div className="divide-y divide-[#E8E5DF]">
            {cycles.map((c) => (
              <div
                key={c.id}
                className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm"
              >
                <div className="flex-1 min-w-[160px]">
                  <div className="font-semibold text-[#3F3D3B]">
                    {fmtDate(c.started_at)}
                  </div>
                  <div className="text-xs text-[#6D6A65]">
                    {c.triggered_by === "manual" ? "Manual" : "Cron"} ·{" "}
                    {c.zero_pool_rate_pct_before != null &&
                      `zero-pool ${c.zero_pool_rate_pct_before}%`}
                    {c.drafts_created ? ` · ${c.drafts_created} drafts` : ""}
                  </div>
                </div>
                <StatusPill status={c.status} />
              </div>
            ))}
          </div>
        </details>
      )}

      {loading && (
        <div className="mt-4 text-xs text-[#6D6A65] flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
}
