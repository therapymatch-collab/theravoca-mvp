import { Loader2, Play, Trash2, Mail, RotateCw, MessageSquare, Eraser, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Test Actions panel -- the "Testing > Test actions" sub-tab from the
// admin reorg mockup. Most cards delegate to handlers that already
// exist in AdminDashboard (refresh, runBackfill, stripBackfill,
// openWipeDialog, sendTestSms). Three cards ("Run a cron now",
// "Send test email to me", "Strip legacy flags") don't yet have
// backend endpoints -- they show toasts noting that.
//
// Visual structure mirrors admin-mockup-v1.html (sub-section "test-actions").
export default function TestActionsPanel({
  refresh,
  runBackfill,
  stripBackfill,
  openWipeDialog,
  sendTestSms,
}) {
  const notWired = (label) => () =>
    toast.message(`${label} -- backend endpoint not wired yet`, {
      description: "Tracked in BACKLOG; this card is a placeholder.",
    });

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

      <ActionCard
        kicker="Cron triggers"
        title="Run a cron now"
        description="Manually fire any scheduled job without waiting for the next tick. Useful when verifying a fix shipped to staging."
        button={{ label: "Run", icon: <Play size={14} />, onClick: notWired("Run a cron now") }}
        testid="card-run-cron"
      />

      <ActionCard
        kicker="Email preview"
        title="Send test email to me"
        description="Render any template against test data and send it to your inbox so you can see what patients/therapists actually receive."
        button={{ label: "Send", icon: <Mail size={14} />, onClick: notWired("Send test email") }}
        testid="card-send-test-email"
      />

      <ActionCard
        kicker="v1 cleanup"
        title="Strip legacy flags"
        description="One-shot Mongo cleanup that removes legacy structured_followup_*_sent_at flags from old requests. Idempotent."
        button={{ label: "Run cleanup", icon: <Eraser size={14} />, onClick: notWired("Strip legacy flags") }}
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
