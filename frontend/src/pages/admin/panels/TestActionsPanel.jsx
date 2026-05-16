import { useEffect, useState } from "react";
import { Loader2, Play, Trash2, Mail, RotateCw, MessageSquare, Eraser, Sparkles, MailCheck } from "lucide-react";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";

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

  // Pre-launch real-email restoration (imported_xlsx therapists).
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(true);
  const [restoreRunning, setRestoreRunning] = useState(false);

  // Pre-launch strip-real-emails (inverse of restoration).
  const [stripRealRunning, setStripRealRunning] = useState(false);
  const [stripRealPreview, setStripRealPreview] = useState(null);

  // Test-email recipient. Defaults to admin's logged-in email; falls back
  // to therapymatch@gmail.com (the canonical test inbox) when no admin
  // email is on file. With EMAIL_OVERRIDE_TO set on Render, ALL outbound
  // mail lands in therapymatch@gmail.com regardless, so the field mostly
  // documents intent.
  const [testEmailTo, setTestEmailTo] = useState(
    adminEmail || "therapymatch@gmail.com",
  );

  const loadRestorePreview = async () => {
    if (!client) return;
    setRestoreLoading(true);
    try {
      const r = await client.get("/admin/email-restoration/preview");
      setRestorePreview(r.data || null);
    } catch {
      setRestorePreview(null);
    } finally {
      setRestoreLoading(false);
    }
  };

  useEffect(() => {
    if (!client) return;
    client.get("/admin/cron/list")
      .then((r) => setCronList(r.data?.crons || []))
      .catch(() => setCronList([]));
    client.get("/admin/email-templates")
      .then((r) => setTplList(r.data || []))
      .catch(() => setTplList([]));
    loadRestorePreview();
    // eslint-disable-next-line
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
    const recipient = (testEmailTo || "").trim();
    if (!recipient || !recipient.includes("@")) {
      toast.error("Enter a valid recipient email first");
      return;
    }
    setTplSending(true);
    try {
      const res = await client.post(
        `/admin/email-templates/${tplSelected}/send-test`,
        { to: recipient },
      );
      toast.success(`Sent "${res.data?.subject}" to ${recipient}`, {
        duration: 8000,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setTplSending(false);
    }
  };

  const onPreviewStripReal = async () => {
    setStripRealRunning(true);
    try {
      const res = await client.post("/admin/strip-real-emails", { dry_run: true });
      setStripRealPreview(res.data || null);
      toast.success(
        `Dry run: ${res.data?.would_strip ?? 0} therapist(s) have a real email in the email field.`,
        { duration: 8000 },
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    } finally {
      setStripRealRunning(false);
    }
  };

  const onRunStripReal = async () => {
    const n = stripRealPreview?.would_strip ?? null;
    if (n === null) {
      toast.error("Run the dry-run preview first so you can see what would change.");
      return;
    }
    if (n === 0) {
      toast.success("Nothing to strip -- every therapist's email is already a placeholder.");
      return;
    }
    if (!confirm(
      `Move the real email out of \`email\` -> \`real_email\` for ${n} therapist(s), ` +
      `replacing \`email\` with a therapymatch+t<id>@gmail.com placeholder?\n\n` +
      `Pre-launch safety. Reversible via /admin/email-restoration/run at go-live. ` +
      `Idempotent -- safe to re-run.`
    )) return;
    setStripRealRunning(true);
    try {
      const res = await client.post("/admin/strip-real-emails", { dry_run: false });
      toast.success(`Stripped ${res.data?.stripped ?? 0} therapist email(s).`, { duration: 8000 });
      setStripRealPreview(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Strip failed");
    } finally {
      setStripRealRunning(false);
    }
  };

  const onRunRestoration = async () => {
    const restorable = restorePreview?.restorable ?? 0;
    if (restorable === 0) {
      toast.error("Nothing to restore -- no imported therapists still have placeholder emails with a real_email available.");
      return;
    }
    const missing = restorePreview?.missing_real_email ?? 0;
    const warn = missing > 0
      ? `\n\nWARNING: ${missing} placeholder therapists have NO real_email on file and will be SKIPPED. Review those manually.`
      : "";
    if (!confirm(
      `Promote real_email -> email for ${restorable} imported therapist(s)?` +
      `\n\nThis is the pre-launch step that switches the directory from fake test emails ` +
      `to the real emails you imported from xlsx.${warn}\n\nIdempotent -- safe to re-run.`
    )) return;
    setRestoreRunning(true);
    try {
      const res = await client.post("/admin/email-restoration/run", {});
      toast.success(
        `Restored ${res.data?.restored || 0} real email(s). Re-loading preview...`,
        { duration: 8000 },
      );
      await loadRestorePreview();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Restoration failed");
    } finally {
      setRestoreRunning(false);
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

      {/* Email template send-test card -- locally wired. Recipient is
          editable since admin master-password login doesn't capture an
          email. With EMAIL_OVERRIDE_TO set on staging, every send lands
          in therapymatch@gmail.com regardless of the value here. */}
      <div className="bg-white rounded-xl p-5 border border-[#E8E5DF]" data-testid="card-send-test-email">
        <div className="text-[10px] uppercase tracking-widest text-[#6D6A65]">Email preview</div>
        <div className="font-serif-display text-lg mt-1 text-[#2D4A3E]">Send test email</div>
        <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
          Render any template against test data and send it to the recipient below.
          With <code>EMAIL_OVERRIDE_TO</code> set on Render, the actual delivery still
          lands in <strong>therapymatch@gmail.com</strong> regardless.
        </p>
        <div className="mt-3 space-y-2">
          <input
            type="email"
            value={testEmailTo}
            onChange={(e) => setTestEmailTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full border border-[#E8E5DF] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[#2D4A3E]"
            data-testid="test-email-to-input"
          />
          <select
            value={tplSelected}
            onChange={(e) => setTplSelected(e.target.value)}
            className="w-full border border-[#E8E5DF] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[#2D4A3E]"
            data-testid="test-email-template-select"
          >
            <option value="">Pick a template...</option>
            {tplList.map((t) => (
              <option key={t.key} value={t.key}>{t.title || t.key}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onSendTestEmail}
            disabled={tplSending || !tplSelected}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50] disabled:opacity-60"
          >
            {tplSending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            {tplSending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {/* Pre-launch safety: strip real emails out of `email` field. */}
      <div className="bg-white rounded-xl p-5 border border-[#E8E5DF]" data-testid="card-strip-real-emails">
        <div className="text-[10px] uppercase tracking-widest text-[#6D6A65]">Pre-launch safety</div>
        <div className="font-serif-display text-lg mt-1 text-[#2D4A3E]">Strip real emails from directory</div>
        <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
          Walk every therapist whose <code>email</code> is a real address. Tuck the real
          value into <code>real_email</code> and replace <code>email</code> with a
          <code>therapymatch+t&lt;id&gt;@gmail.com</code> placeholder. Idempotent.
          Reversible at go-live via the Restore-emails card below.
        </p>
        {stripRealPreview && (
          <div className="mt-2 text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded p-2 leading-relaxed">
            <strong className="text-[#2D4A3E]">{stripRealPreview.would_strip}</strong> therapist(s)
            have a real email in the <code>email</code> field.
            {(stripRealPreview.samples || []).length > 0 && (
              <ul className="mt-1 text-[#6D6A65]">
                {(stripRealPreview.samples || []).slice(0, 3).map((s) => (
                  <li key={s.id}>&middot; {s.name || s.id}: {s.current_email}</li>
                ))}
                {(stripRealPreview.samples || []).length > 3 && (
                  <li className="italic">... and {stripRealPreview.would_strip - 3} more</li>
                )}
              </ul>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onPreviewStripReal}
            disabled={stripRealRunning}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-60"
          >
            {stripRealRunning ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
            Dry run (preview)
          </button>
          <button
            type="button"
            onClick={onRunStripReal}
            disabled={stripRealRunning || stripRealPreview?.would_strip === 0 || stripRealPreview === null}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#2D4A3E] text-white hover:bg-[#3A5E50] disabled:opacity-60"
          >
            {stripRealRunning ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
            Strip now
          </button>
        </div>
      </div>

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
        action="go_live.toggle"
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
        action="go_live.strip_emails"
        danger
        testid="card-strip-backfill"
      />

      <EmailRestorationCard
        loading={restoreLoading}
        preview={restorePreview}
        running={restoreRunning}
        onRun={onRunRestoration}
        onRefresh={loadRestorePreview}
      />

      <ActionCard
        kicker="SMS check"
        title="Send a test SMS"
        description="Send a single SMS to any number through the configured Telnyx sender to verify delivery + check Telnyx status codes."
        button={{ label: "Send test SMS", icon: <MessageSquare size={14} />, onClick: sendTestSms }}
        action="test.send_sms"
        testid="card-test-sms"
      />
    </div>
  );
}

function ActionCard({ kicker, title, description, button, danger, testid, action }) {
  // `action` (optional) is a permission-map key. When the current admin
  // can't do it, the button renders in a disabled stub via PermissionGate.
  const buttonNode = (
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
  );
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
      {action ? <PermissionGate action={action}>{buttonNode}</PermissionGate> : buttonNode}
    </div>
  );
}

// Pre-launch real-email restoration card. Shows live counts pulled from
// /admin/email-restoration/preview so the admin can sanity-check what
// would be promoted (real_email -> email) before pulling the trigger
// on imported_xlsx therapists.
function EmailRestorationCard({ loading, preview, running, onRun, onRefresh }) {
  const placeholder = preview?.placeholder_emails ?? 0;
  const restorable = preview?.restorable ?? 0;
  const missing = preview?.missing_real_email ?? 0;
  const samples = preview?.samples || [];
  const ready = restorable > 0;

  return (
    <div
      className={`bg-white rounded-xl p-5 border md:col-span-2 ${ready ? "border-[#C8923A]" : "border-[#E8E5DF]"}`}
      data-testid="card-email-restoration"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-[10px] uppercase tracking-widest ${ready ? "text-[#C8923A]" : "text-[#6D6A65]"}`}>
            Pre-launch -- go live with real emails
          </div>
          <div className="font-serif-display text-lg mt-1 text-[#2D4A3E]">
            Restore real provider emails (imported xlsx)
          </div>
          <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Imported therapists currently use fake <code>therapymatch+t...@gmail.com</code>
            {" "}placeholders so testing/backfill notifications stay out of their inboxes.
            Running this swaps each placeholder for the real address from{" "}
            <code>real_email</code>. Idempotent -- safe to re-run.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-[#2D4A3E] hover:underline inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
        >
          <RotateCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="mt-4 text-xs text-[#6D6A65]">
          <Loader2 size={14} className="animate-spin inline mr-1" /> Checking provider directory...
        </div>
      ) : !preview ? (
        <div className="mt-4 text-xs text-[#D45D5D]">Couldn't load preview.</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="border border-[#E8E5DF] rounded-lg p-3">
              <div className="text-[#6D6A65]">Placeholder emails</div>
              <div className="font-serif text-2xl text-[#2D4A3E] mt-0.5">{placeholder}</div>
            </div>
            <div className={`border rounded-lg p-3 ${restorable > 0 ? "border-[#C8923A] bg-[#FBEFE9]" : "border-[#E8E5DF]"}`}>
              <div className="text-[#6D6A65]">Ready to restore</div>
              <div className="font-serif text-2xl text-[#C8923A] mt-0.5">{restorable}</div>
            </div>
            <div className={`border rounded-lg p-3 ${missing > 0 ? "border-[#D45D5D] bg-[#FDF1EF]" : "border-[#E8E5DF]"}`}>
              <div className="text-[#6D6A65]">Missing real_email</div>
              <div className={`font-serif text-2xl mt-0.5 ${missing > 0 ? "text-[#D45D5D]" : "text-[#2D4A3E]"}`}>
                {missing}
              </div>
            </div>
          </div>

          {samples.length > 0 && (
            <div className="mt-3 border border-[#E8E5DF] rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
                Sample of what would change ({samples.length} shown)
              </div>
              <ul className="text-xs space-y-1">
                {samples.map((s) => (
                  <li key={s.id} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    <span className="font-mono text-[11px] text-[#9C9893] truncate">{s.email}</span>
                    <span className="text-[#6D6A65]">&rarr;</span>
                    <span className="font-mono text-[11px] text-[#2B2A29] truncate">{s.real_email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {missing > 0 && (
            <div className="mt-3 text-xs text-[#8B3220] bg-[#FDF1EF] border border-[#F4C7BE] rounded-lg px-3 py-2 leading-relaxed">
              <strong>{missing}</strong> placeholder therapist(s) have no <code>real_email</code> on file
              and will be skipped. Review those manually before launch.
            </div>
          )}

          <button
            type="button"
            onClick={onRun}
            disabled={running || restorable === 0}
            className={`mt-4 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition disabled:opacity-60 ${
              restorable > 0
                ? "bg-[#C8923A] text-white hover:bg-[#B07F2E]"
                : "bg-[#E8E5DF] text-[#6D6A65] cursor-not-allowed"
            }`}
          >
            {running
              ? <Loader2 size={14} className="animate-spin" />
              : <MailCheck size={14} />}
            {running
              ? "Restoring..."
              : restorable > 0
                ? `Restore ${restorable} real email${restorable === 1 ? "" : "s"}`
                : "Nothing to restore"}
          </button>
        </>
      )}
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
