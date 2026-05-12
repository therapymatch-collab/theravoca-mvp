import { useEffect, useState } from "react";
import { Loader2, Play, Trash2, Mail, RotateCw, MessageSquare, Eraser, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Test Actions panel -- the "Testing > Test actions" sub-tab from the
// admin reorg mockup. Cards delegate to handlers passed in from
// AdminDashboard (refresh / runBackfill / stripBackfill / openWipeDialog
// / sendTestSms) plus three locally-wired cards: "Run a cron now",
// "Send test email to me", and "Strip legacy flags". The local cards
// fetch their own option lists (cron names, email template keys) on
// mount.
export default function TestActionsPanel({
  client,
  adminEmail,
  refresh,
  runBackfill,
  stripBackfill,
  openWipeDialog,
  sendTestSms,
}) {
  // ── Local state for the three wired cards ──
  const [cronList, setCronList] = useState([]);
  const [cronSelected, setCronSelected] = useState("");
  const [cronRunning, setCronRunning] = useState(false);

  const [tplList, setTplList] = useState([]);
  const [tplSelected, setTplSelected] = useState("");
  const [tplSending, setTplSending] = useState(false);

  const [stripRunning, setStripRunning] = useState(false);

  useEffect(() => {
    if (!client) return;
    client.get("/admin/cron/list")
      .then((r) => setCronList(r.data?.crons || []))
      .catch(() => setCronList([]));
    client.get("/admin/email-templates")
      .then((r) => setTplList(r.data || []))
      .catch(() => setTplList([]));
  }, [client]);

  const onRunCron = async () => {
    if (!cronSelected) {
      toast.error("Pick a cron from the dropdown first");
      return;
    }
    setCronRunning(true);
    try {
      const res = await client.post("/admin/cron/run", { name: cronSelected });
      const summary = JSON.stringify(res.data?.result || {}, null, 0).slice(0, 120);
      toast.success(`${res.data?.label || cronSelected} ran. ${summary}`, {
        duration: 8000,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cron run failed");
    } finally {
      setCronRunning(false);
    }
  };

  const onSendTestEmail = async () => {
    if (!tplSelected) {
      toast.error("Pick a template from the dropdown first");
      return;
    }
    if (!adminEmail) {
      toast.error("No admin email on file -- can't send to 'me'");
      return;
    }
    setTplSending(true);
    try {
      const res = await client.post(
        `/admin/email-templates/${tplSelected}/send-test`,
        { to: adminEmail },
      );
      toast.success(`Sent "${res.data?.subject}" to ${adminEmail}`, {
        duration: 8000,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setTplSending(false);
    }
  };

  const onStripFlags = async () => {
    if (!confirm(
      "Strip legacy structured_followup_*_sent_at and v1_*_sent_at fields " +
      "from all old request docs?\n\nIdempotent -- safe to re-run."
    )) return;
    setStripRunning(true);
    try {
      const res = await client.post("/admin/cleanup-v1-followup-flags", {});
      toast.success(
        `Cleaned ${res.data?.modified}/${res.data?.candidates} request docs`,
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cleanup failed");
    } finally {
      setStripRunning(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="test-actions-panel">
      <ActionCard
        kicker="Live data refresh"
        title="Refresh all caches"
        description="Bust the matching-defaults cache, snapshot cache, capacity cache, and reload admin counters."
        button={{ label: "Refresh now", icon: <RotateCw size={14} />, onClick: refresh }}
        testid="card-refresh"
      />

      <ActionCard
        kicker="Seed data"
        title="Backfill with test data"
        description="Drop a known set of fake data into every therapist profile (idempotent; only fills missing fields). Pre-launch only."
        button={{ label: "Run backfill", icon: <Sparkles size={14} />, onClick: runBackfill }}
        testid="card-backfill"
      />

      <ActionCard
        kicker="Destructive"
        title="Wipe test data"
        description="Delete every request, application, simulator run, and non-seeded therapist. Keeps seeded directory + admin/site config."
        button={{
          label: "Wipe test data...",
          icon: <Trash2 size={14} />,
          onClick: openWipeDialog,
          danger: true,
        }}
        danger
        testid="card-wipe"
      />

      {/* Cron picker card -- locally wired */}
      <ComboCard
        kicker="Cron triggers"
        title="Run a cron now"
        description="Manually fire any scheduled job without waiting for the next tick. Useful when verifying a fix shipped to staging."
        select={{
          value: cronSelected,
          onChange: setCronSelected,
          placeholder: "Pick a cron...",
          options: cronList.map((c) => ({ value: c.key, label: c.label })),
        }}
        button={{
          label: cronRunning ? "Running..." : "Run",
          icon: cronRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />,
          onClick: onRunCron,
          disabled: cronRunning || !cronSelected,
        }}
        testid="card-run-cron"
      />

      {/* Email template send-test card -- locally wired */}
      <ComboCard
        kicker="Email preview"
        title={`Send test email${adminEmail ? ` to ${adminEmail}` : ""}`}
        description="Render any template against test data and send it to your inbox so you can see what patients/therapists actually receive."
        select={{
          value: tplSelected,
          onChange: setTplSelected,
          placeholder: "Pick a template...",
          options: tplList.map((t) => ({ value: t.key, label: t.title || t.key })),
        }}
        button={{
          label: tplSending ? "Sending..." : "Send",
          icon: tplSending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />,
          onClick: onSendTestEmail,
          disabled: tplSending || !tplSelected,
        }}
        testid="card-send-test-email"
      />

      <ActionCard
        kicker="v1 cleanup"
        title="Strip legacy flags"
        description="One-shot Mongo cleanup that removes legacy structured_followup_*_sent_at and v1_*_sent_at flags from old request docs. Idempotent."
        button={{
          label: stripRunning ? "Cleaning..." : "Run cleanup",
          icon: stripRunning ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />,
          onClick: onStripFlags,
          disabled: stripRunning,
        }}
        testid="card-strip-flags"
      />

      <ActionCard
        kicker="Pre-launch reversal"
        title="Strip backfilled data"
        description="Restore real therapist emails and remove every field that backfill populated. User-edited fields are preserved."
        button={{
          label: "Strip backfill",
          icon: <Eraser size={14} />,
          onClick: stripBackfill,
          danger: true,
        }}
        danger
        testid="card-strip-backfill"
      />

      <ActionCard
        kicker="SMS check"
        title="Send a test SMS"
        description="Send a single SMS to any number through the configured Twilio sender to verify delivery + check Twilio status codes."
        button={{ label: "Send test SMS", icon: <MessageSquare size={14} />, onClick: sendTestSms }}
        testid="card-test-sms"
      />
    </div>
  );
}

function ActionCard({ kicker, title, description, button, danger, testid }) {
  return (
    <div
      className={`bg-white rounded-xl p-5 border ${danger ? "border-[#F4C7BE]" : "border-[#E8E5DF]"}`}
      data-testid={testid}
    >
      <div className={`text-[10px] uppercase tracking-widest ${danger ? "text-[#D45D5D]" : "text-[#6D6A65]"}`}>
        {kicker}
      </div>
      <div className={`font-serif-display text-lg mt-1 ${danger ? "text-[#D45D5D]" : "text-[#2D4A3E]"}`}>
        {title}
      </div>
      <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">{description}</p>
      <button
        type="button"
        onClick={button.onClick}
        disabled={button.disabled}
        className={`mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition disabled:opacity-60 ${
          button.danger
            ? "border border-[#D45D5D] text-[#D45D5D] hover:bg-[#FDF1EF]"
            : "bg-[#2D4A3E] text-white hover:bg-[#3A5E50]"
        }`}
      >
        {button.icon}
        {button.label}
      </button>
    </div>
  );
}

// Card with a dropdown + action button (for "Run a cron now" / "Send test email").
function ComboCard({ kicker, title, description, select, button, testid }) {
  return (
    <div
      className="bg-white rounded-xl p-5 border border-[#E8E5DF]"
      data-testid={testid}
    >
      <div className="text-[10px] uppercase tracking-widest text-[#6D6A65]">{kicker}</div>
      <div className="font-serif-display text-lg mt-1 text-[#2D4A3E]">{title}</div>
      <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">{description}</p>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <select
          value={select.value}
          onChange={(e) => select.onChange(e.target.value)}
          className="text-sm border border-[#E8E5DF] rounded-lg px-2 py-1.5 bg-white max-w-xs"
          data-testid={`${testid}-select`}
        >
          <option value="">{select.placeholder}</option>
          {select.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={button.onClick}
          disabled={button.disabled}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50] transition disabled:opacity-60"
          data-testid={`${testid}-btn`}
        >
          {button.icon}
          {button.label}
        </button>
      </div>
    </div>
  );
}
