import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Shield, ShieldOff, Rocket, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import useAdminClient from "@/lib/useAdminClient";

// Silent one-time retry for initial admin GETs. Cloudflare's bot-fight
// layer can return a transient 403 on the very first request from a
// fresh browser session before its `__cf_bm` cookie is minted; the
// retry happens after a short delay so by the second attempt the cookie
// is in place and the request sails through. Only the SECOND failure
// surfaces a toast so the admin doesn't see a scary "Failed to load…"
// flash on every page load.
async function _adminGetWithRetry(client, path, { delayMs = 600 } = {}) {
  try {
    return await client.get(path);
  } catch (firstErr) {
    // Don't retry on hard 401 (truly unauthenticated) — that needs a
    // re-login, not a retry. 4xx (incl. CF's 403) and 5xx do retry.
    if (firstErr?.response?.status === 401) throw firstErr;
    await new Promise((r) => setTimeout(r, delayMs));
    return client.get(path);
  }
}

// Runtime Turnstile disable toggle — lets the admin pause Cloudflare
// bot protection during AI / E2E test runs without touching env vars.
// Backend: GET/PUT /api/admin/turnstile-settings. Public consumers
// read the effective state from /api/config/turnstile.
function TurnstileToggleCard({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [loaded, setLoaded] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [reason, setReason] = useState("");
  const [disabledAt, setDisabledAt] = useState(null);
  const [saving, setSaving] = useState(false);
  // Master testing mode overrides this toggle at the backend, so we
  // surface that here too -- otherwise the card claims Turnstile is
  // enabled while the master switch silently bypasses it.
  const [masterTestingOn, setMasterTestingOn] = useState(false);

  const load = async () => {
    try {
      const r = await _adminGetWithRetry(client, "/admin/turnstile-settings");
      setDisabled(!!r.data?.disabled);
      setConfigured(!!r.data?.configured);
      setReason(r.data?.disabled_reason || "");
      setDisabledAt(r.data?.disabled_at || null);
      setLoaded(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load Turnstile settings");
    }
    // Poll master-testing state too so the "bypassed by master" hint
    // appears + disappears in sync with the global toggle.
    try {
      const mr = await client.get("/admin/master-testing-mode");
      setMasterTestingOn(!!mr.data?.enabled);
    } catch (_) { /* soft-fail */ }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);  // refresh master-testing state
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (nextDisabled) => {
    setSaving(true);
    try {
      await client.put("/admin/turnstile-settings", {
        disabled: nextDisabled,
        reason: nextDisabled ? (reason || "AI / E2E testing") : "",
      });
      toast.success(
        nextDisabled
          ? "Turnstile disabled — intake + therapist signup will skip bot checks"
          : "Turnstile re-enabled",
      );
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`border rounded-2xl p-6 ${
        disabled ? "bg-[#FBF3E0] border-[#E5B267]" : "bg-white border-[#E8E5DF]"
      }`}
      data-testid="turnstile-toggle-card"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className={`rounded-full p-2.5 ${disabled ? "bg-[#F5E0B5]" : "bg-[#EAF2E8]"}`}>
          {disabled ? (
            <ShieldOff size={20} className="text-[#B37E35]" />
          ) : (
            <Shield size={20} className="text-[#2D4A3E]" />
          )}
        </div>
        <div className="flex-1 min-w-[200px]">
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Cloudflare Turnstile
          </h3>
          <p className="text-sm text-[#6D6A65] mt-1 max-w-2xl leading-relaxed">
            Bot protection on patient intake and therapist signup.
            Temporarily disable during AI or E2E testing so automated
            browsers don't get blocked. Honeypot + timing + IP
            rate-limit guards stay active either way.
          </p>
          {!configured && (
            <p className="mt-2 text-xs text-[#6D6A65] italic">
              Turnstile keys aren't configured in this environment.
              Set <code>REACT_APP_TURNSTILE_SITE_KEY</code> (frontend)
              and <code>TURNSTILE_SECRET_KEY</code> (backend) in Render
              and redeploy. Until then the widget won't render
              regardless of this toggle.
            </p>
          )}
          {masterTestingOn && (
            <div
              className="mt-3 text-xs bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-2.5 py-1.5 text-[#8B3220]"
              data-testid="turnstile-master-override-notice"
            >
              Currently <strong>bypassed by master testing mode</strong>.
              The toggle below shows Turnstile's own state, but the
              master switch overrides it -- the widget won't appear and
              tokens aren't verified while master testing is on.
            </div>
          )}
        </div>
        {loaded && (
          <label className="inline-flex items-center gap-2 bg-white border border-[#E8E5DF] rounded-lg px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={disabled}
              disabled={saving}
              onChange={(e) => save(e.target.checked)}
              className="h-4 w-4"
              data-testid="turnstile-toggle-input"
            />
            <span className="text-sm font-semibold text-[#3F3D3B]">
              Disable for testing
            </span>
          </label>
        )}
      </div>

      {disabled && loaded && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="ts-reason"
              className="text-xs uppercase tracking-wider text-[#6D6A65] font-semibold"
            >
              Reason (visible in audit log)
            </label>
            <Input
              id="ts-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => save(true)}
              placeholder="AI / E2E testing"
              className="mt-1"
              data-testid="turnstile-reason-input"
              maxLength={240}
            />
          </div>
          {disabledAt && (
            <div className="text-xs text-[#6D6A65] flex items-end">
              <span>
                Disabled since{" "}
                <span className="font-semibold text-[#B37E35]">
                  {new Date(disabledAt).toLocaleString()}
                </span>
                . Remember to re-enable before going live.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Go-Live runbook. Shows the live state of each pre-launch protective
// feature (email override, fake therapist emails, backfilled profile
// data, Track B dry-run, test request data) and lets the admin flip
// them off one at a time -- OR fire them all in sequence with the
// "GO LIVE" master button.
//
// All actions call existing admin endpoints; this card is purely an
// orchestration surface. The Render env-var step (remove
// EMAIL_OVERRIDE_TO, set EMAIL_LIVE_MODE=true) can't be done in-app,
// so it's surfaced as a final reminder with copy-paste values.
function GoLiveCard({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [emailStatus, setEmailStatus] = useState(null);
  const [backfillStatus, setBackfillStatus] = useState(null);
  const [emailPreview, setEmailPreview] = useState(null);
  const [wipePreview, setWipePreview] = useState(null);
  const [trackBConfig, setTrackBConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState("");           // step id currently running
  const [showRenderHelp, setShowRenderHelp] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [masterRunning, setMasterRunning] = useState(false);

  const refreshAll = async () => {
    setLoading(true);
    try {
      const [es, bs, ep, wp, tb] = await Promise.all([
        client.get("/admin/email-safety-status").catch(() => ({ data: null })),
        client.get("/admin/backfill-status").catch(() => ({ data: null })),
        client.get("/admin/email-restoration/preview").catch(() => ({ data: null })),
        client.get("/admin/wipe-test-data/preview").catch(() => ({ data: null })),
        client.get("/admin/track-b-config").catch(() => ({ data: null })),
      ]);
      setEmailStatus(es.data);
      setBackfillStatus(bs.data);
      setEmailPreview(ep.data);
      setWipePreview(wp.data);
      setTrackBConfig(tb.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!client) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // ---- step checks (status pill per row) ----
  const emailReady = emailStatus?.mode === "live";
  const realEmailsReady = (emailPreview?.placeholder_emails || 0) === 0;
  const backfillCleared = (backfillStatus?.backfilled || 0) === 0;
  const testDataCleared = !wipePreview || (
    (wipePreview.requests || 0) === 0 &&
    (wipePreview.applications || 0) === 0 &&
    (wipePreview.outreach_invites || 0) === 0
  );
  const trackBLive = trackBConfig && trackBConfig.dry_run === false;

  const allReady = emailReady && realEmailsReady && backfillCleared && testDataCleared && trackBLive;

  // ---- individual action handlers ----
  const restoreRealEmails = async () => {
    const n = emailPreview?.restorable ?? 0;
    if (n === 0) {
      toast.success("Nothing to restore -- every imported therapist already has their real email.");
      return;
    }
    if (!confirm(
      `Promote real_email -> email for ${n} imported therapist(s)?\n\n` +
      `After this, the directory uses REAL therapist email addresses. ` +
      `Combined with the EMAIL_LIVE_MODE env var, sends will go to those real addresses.`
    )) return;
    setRunning("restore_emails");
    try {
      const r = await client.post("/admin/email-restoration/run", {});
      toast.success(`Restored ${r.data?.restored || 0} real email(s)`);
      await refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Restore failed");
    } finally {
      setRunning("");
    }
  };

  const stripBackfill = async () => {
    const n = backfillStatus?.backfilled ?? 0;
    if (n === 0) {
      toast.success("Nothing to strip -- no backfilled data on file.");
      return;
    }
    if (!confirm(
      `Strip backfilled fields from ${n} therapist(s)?\n\n` +
      `Removes every field that the backfill script populated (specialties, modalities, ` +
      `availability, fees, etc. that were FILLED IN as defaults). User-edited values are ` +
      `preserved. Original emails (from before backfill) are restored.\n\nIdempotent.`
    )) return;
    setRunning("strip_backfill");
    try {
      const r = await client.post("/admin/strip-backfill", {});
      toast.success(`Stripped ${r.data?.restored || 0} therapist(s) of backfilled data`);
      await refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Strip failed");
    } finally {
      setRunning("");
    }
  };

  const flipTrackB = async (newDryRun) => {
    if (!newDryRun) {
      if (!confirm(
        "Flip Track B (gap-recruit) to LIVE?\n\n" +
        "After this, the nightly cron will send real outreach emails to " +
        "candidates it finds for each Coverage gap (subject to the email " +
        "safety guard -- only EMAIL_LIVE_MODE=true gets real sends through; " +
        "EMAIL_OVERRIDE_TO redirects everything to your test inbox).\n\n" +
        "Reversible -- you can flip back to dry-run at any time."
      )) return;
    }
    setRunning("track_b");
    try {
      const r = await client.put("/admin/track-b-config", { dry_run: newDryRun });
      toast.success(
        `Track B is now ${r.data?.dry_run ? "DRY-RUN" : "LIVE"}`,
        { duration: 6000 },
      );
      await refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Track B config update failed");
    } finally {
      setRunning("");
    }
  };

  const wipeTestData = async () => {
    const summary = wipePreview ? (
      `requests=${wipePreview.requests || 0}, applications=${wipePreview.applications || 0}, ` +
      `outreach_invites=${wipePreview.outreach_invites || 0}, simulator_runs=${wipePreview.simulator_runs || 0}, ` +
      `non-seeded therapists=${wipePreview.non_seeded_therapists || 0}`
    ) : "(unknown counts)";
    if (!confirm(
      `WIPE all test data?\n\n${summary}\n\nThis deletes test requests, applications, ` +
      `simulator runs, and non-seeded therapists. Seeded directory + admin config + ` +
      `imported_xlsx therapists are preserved.\n\nNot reversible.`
    )) return;
    setRunning("wipe");
    try {
      const r = await client.post("/admin/wipe-test-data", {});
      toast.success(`Wiped: ${JSON.stringify(r.data || {}).slice(0, 120)}`, { duration: 8000 });
      await refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Wipe failed");
    } finally {
      setRunning("");
    }
  };

  const runMasterGoLive = async () => {
    if (confirmText !== "GO LIVE") return;
    setMasterRunning(true);
    try {
      // Order matters: strip backfill BEFORE restoring real emails so
      // the email-restoration step writes real_email -> email after
      // backfilled values are out of the way. Wipe test data last so
      // any final tests/simulator data we'd want to inspect stay until
      // the very end.
      const steps = [
        { id: "strip_backfill", path: "/admin/strip-backfill", label: "Strip backfilled data" },
        { id: "restore_emails", path: "/admin/email-restoration/run", label: "Restore real emails" },
        { id: "wipe", path: "/admin/wipe-test-data", label: "Wipe test data" },
      ];
      for (const s of steps) {
        setRunning(s.id);
        try {
          await client.post(s.path, {});
          toast.success(`${s.label} -- done`);
        } catch (e) {
          toast.error(`${s.label} failed: ${e?.response?.data?.detail || e.message}`);
          // Don't continue if a step failed -- admin should investigate.
          break;
        }
      }
      setRunning("");
      setConfirmText("");
      setShowRenderHelp(true);     // surface the final Render env reminder
      await refreshAll();
    } finally {
      setMasterRunning(false);
    }
  };

  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden" data-testid="go-live-card">
      {/* Header strip with icon badge + accent gradient */}
      <div className="bg-gradient-to-br from-[#FBEFE9] to-[#FDFBF7] border-b border-[#F4DDD2] px-6 py-5 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#C87965] text-white flex items-center justify-center shrink-0 shadow-sm">
          <Rocket size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[#8B4F1F] font-semibold">Pre-launch checklist</div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight mt-0.5">Go-live runbook</h3>
          <p className="text-sm text-[#6D6A65] mt-1.5 max-w-2xl leading-relaxed">
            Pre-launch protective features that keep test data + fake emails contained.
            Flip them one at a time, or hit <strong>GO LIVE</strong> at the bottom to
            run all in-app steps in sequence. The Render env-var step has to be done
            manually -- the app can't change its own env.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={loading}
          className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50] disabled:opacity-50 shrink-0"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      <div className="p-6">

      <div className="mt-4 space-y-3">
        {/* Step 1: email mode */}
        <GoLiveRow
          ready={emailReady}
          title="Email delivery mode"
          detail={
            emailStatus?.mode === "test_override"
              ? `TEST MODE -- all outbound email redirected to ${emailStatus.override_to}.`
              : emailStatus?.mode === "live"
                ? "LIVE -- emails go to real recipients."
                : "BLOCKED -- safety guard will silently drop sends until you set either EMAIL_OVERRIDE_TO or EMAIL_LIVE_MODE."
          }
          action={
            <button
              type="button"
              onClick={() => setShowRenderHelp(true)}
              className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
            >
              Render env steps
            </button>
          }
        />

        {/* Step 2: real emails restored */}
        <GoLiveRow
          ready={realEmailsReady}
          title="Therapist directory uses real emails"
          detail={
            emailPreview === null
              ? "Loading..."
              : realEmailsReady
                ? "All imported therapists already use their real email in the `email` field."
                : `${emailPreview.placeholder_emails || 0} imported therapist(s) still use the therapymatch+ placeholder. ${emailPreview.restorable || 0} can be restored from real_email; ${emailPreview.missing_real_email || 0} need manual review.`
          }
          action={
            !realEmailsReady && (
              <button
                type="button"
                onClick={restoreRealEmails}
                disabled={running !== ""}
                className="text-xs px-3 py-1.5 rounded-md border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
              >
                {running === "restore_emails" ? (
                  <><Loader2 size={12} className="inline mr-1 animate-spin" /> Restoring...</>
                ) : (
                  "Restore real emails"
                )}
              </button>
            )
          }
        />

        {/* Step 3: backfill stripped */}
        <GoLiveRow
          ready={backfillCleared}
          title="Backfilled profile data stripped"
          detail={
            backfillStatus === null
              ? "Loading..."
              : backfillCleared
                ? "No backfilled data on file."
                : `${backfillStatus.backfilled} therapist(s) still have backfilled fields (specialties, modalities, fees, availability defaults). Strip before launch so therapists never see fabricated data.`
          }
          action={
            !backfillCleared && (
              <button
                type="button"
                onClick={stripBackfill}
                disabled={running !== ""}
                className="text-xs px-3 py-1.5 rounded-md border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
              >
                {running === "strip_backfill" ? (
                  <><Loader2 size={12} className="inline mr-1 animate-spin" /> Stripping...</>
                ) : (
                  "Strip backfill"
                )}
              </button>
            )
          }
        />

        {/* Step 4: test data wiped */}
        <GoLiveRow
          ready={testDataCleared}
          title="Test data wiped"
          detail={
            wipePreview === null
              ? "Loading..."
              : testDataCleared
                ? "No test requests, applications, or simulator runs in the database."
                : `Will delete: ${wipePreview.requests || 0} requests, ${wipePreview.applications || 0} applications, ${wipePreview.outreach_invites || 0} outreach invites, ${wipePreview.simulator_runs || 0} simulator runs, ${wipePreview.non_seeded_therapists || 0} non-seeded therapists.`
          }
          action={
            !testDataCleared && (
              <button
                type="button"
                onClick={wipeTestData}
                disabled={running !== ""}
                className="text-xs px-3 py-1.5 rounded-md border border-[#D45D5D] text-[#D45D5D] hover:bg-[#FDF1EF] disabled:opacity-50"
              >
                {running === "wipe" ? (
                  <><Loader2 size={12} className="inline mr-1 animate-spin" /> Wiping...</>
                ) : (
                  "Wipe test data"
                )}
              </button>
            )
          }
        />

        {/* Step 5: Track B (gap-recruit) live toggle */}
        <GoLiveRow
          ready={trackBLive}
          title="Track B (gap-recruit) live"
          detail={
            trackBConfig === null
              ? "Loading..."
              : trackBLive
                ? `Nightly gap-recruit cron sends real emails (subject to email safety guard). Flipped to live${trackBConfig.updated_at ? ` ${new Date(trackBConfig.updated_at).toLocaleString()}` : ""}${trackBConfig.updated_by ? ` by ${trackBConfig.updated_by}` : ""}.`
                : "Track B runs in DRY-RUN: drafts created, no emails sent. Flip to live when you're ready for proactive outreach beyond per-request matches."
          }
          action={
            <button
              type="button"
              onClick={() => flipTrackB(!trackBLive)}
              disabled={running !== "" || trackBConfig === null}
              className={`text-xs px-3 py-1.5 rounded-md border disabled:opacity-50 ${
                trackBLive
                  ? "border-[#6D6A65] text-[#6D6A65] hover:bg-[#FDFBF7]"
                  : "border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7]"
              }`}
            >
              {running === "track_b" ? (
                <><Loader2 size={12} className="inline mr-1 animate-spin" /> Updating...</>
              ) : trackBLive ? (
                "Flip back to dry-run"
              ) : (
                "Flip to live"
              )}
            </button>
          }
        />
      </div>

      {/* Render env reminder */}
      {showRenderHelp && (
        <div className="mt-5 p-4 bg-[#FDF7EC] border border-[#E8DCC1] rounded-lg text-sm text-[#8B5A1F]">
          <div className="font-semibold text-[#8B4F1F] flex items-center justify-between">
            Final step -- update Render env vars
            <button
              type="button"
              onClick={() => setShowRenderHelp(false)}
              className="text-[10px] underline"
            >
              hide
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed">
            The app can't change its own env. Go to your Render dashboard for this
            service → Environment, then:
          </p>
          <ul className="mt-2 text-xs space-y-1 leading-relaxed">
            <li>
              <strong>Remove</strong> <code className="bg-white/60 px-1 rounded">EMAIL_OVERRIDE_TO</code>
              {" "}(currently <code className="bg-white/60 px-1 rounded">{emailStatus?.override_to || "?"}</code>)
            </li>
            <li>
              <strong>Add</strong> <code className="bg-white/60 px-1 rounded">EMAIL_LIVE_MODE=true</code>
            </li>
          </ul>
          <p className="mt-2 text-xs leading-relaxed italic">
            Both required -- the safety guard fails closed otherwise (no sends at all).
            Render will auto-redeploy in ~3 min. Refresh this card after to verify the
            email-delivery row turns green.
          </p>
        </div>
      )}

      {/* Master GO LIVE button */}
      <div className="mt-5 pt-5 border-t border-[#E8E5DF]">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="font-medium text-[#2D4A3E] text-sm">
              Run all in-app steps in sequence
            </div>
            <div className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
              Runs Strip backfill → Restore real emails → Wipe test data. After it
              finishes, you'll see the Render env-var instructions above.
              Destructive -- type <code className="bg-[#F2EFE8] px-1 rounded">GO LIVE</code>
              to enable the button.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="type GO LIVE"
              className="w-32 text-xs"
              disabled={masterRunning}
            />
            <button
              type="button"
              onClick={runMasterGoLive}
              disabled={confirmText !== "GO LIVE" || masterRunning || allReady}
              className="px-4 py-2 rounded-lg bg-[#D45D5D] text-white text-sm font-medium hover:bg-[#B84D4D] disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="go-live-master-btn"
            >
              {masterRunning ? (
                <><Loader2 size={14} className="inline mr-1.5 animate-spin" /> Running...</>
              ) : allReady ? (
                "Already live"
              ) : (
                "GO LIVE"
              )}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function GoLiveRow({ ready, warningOnly, title, detail, action }) {
  // Visual treatment: status icon in colored circle (sage/yellow/coral)
  // and a matching subtle accent bar on the left of the row.
  const cfg = ready
    ? { icon: <CheckCircle2 size={14} />, bg: "#E8F0EA", border: "#C5DCC9", text: "#2D4A3E", accent: "#4A6B5D" }
    : warningOnly
      ? { icon: <Clock size={14} />, bg: "#FBEFE9", border: "#F4DDD2", text: "#8B5A1F", accent: "#D4A843" }
      : { icon: <AlertCircle size={14} />, bg: "#FBE9E5", border: "#F4C7BE", text: "#8B3220", accent: "#D45D5D" };

  return (
    <div
      className="relative flex items-start gap-3 p-3 pl-4 rounded-lg border bg-white"
      style={{ borderColor: cfg.border }}
    >
      {/* left accent bar */}
      <div
        className="absolute left-0 top-2 bottom-2 w-1 rounded-r"
        style={{ background: cfg.accent }}
      />
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: cfg.bg, color: cfg.accent }}
      >
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[#2D4A3E] text-sm">{title}</div>
        <div className="text-xs text-[#6D6A65] mt-0.5 leading-relaxed">{detail}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// Master testing-mode toggle. ONE switch that bypasses Turnstile +
// timing heuristic + per-IP/per-email rate limits + magic-code limits
// across the entire backend, so AI/E2E test runs aren't blocked.
// Auto-expires server-side after `max_hours`.
function MasterTestingCard({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [state, setState] = useState(null);
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  const load = async () => {
    try {
      const r = await _adminGetWithRetry(client, "/admin/master-testing-mode");
      setState(r.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load testing mode");
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Tick a local clock once per second so the countdown updates without
  // a network round-trip. Server is the source of truth on expiry.
  useEffect(() => {
    if (!state?.enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.enabled]);

  const remaining = (() => {
    if (!state?.enabled || !state.enabled_until) return 0;
    const ms = new Date(state.enabled_until).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  })();
  // Note: `tick` is referenced so React re-renders every second while
  // the timer is active.
  void tick;

  const fmt = (secs) => {
    if (secs <= 0) return "expired";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const enable = async () => {
    setSaving(true);
    try {
      const r = await client.put("/admin/master-testing-mode", {
        enabled: true,
        hours: Math.max(0.1, Math.min(hours, state?.max_hours || 8)),
        reason: reason.trim() || "manual",
      });
      setState(r.data);
      toast.success(
        `Testing mode ON for ${fmt(r.data?.remaining_seconds || 0)} -- ` +
        `all bot defenses bypassed`,
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to enable");
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setSaving(true);
    try {
      const r = await client.put("/admin/master-testing-mode", { enabled: false });
      setState(r.data);
      toast.success("Testing mode OFF -- bot defenses restored");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to disable");
    } finally {
      setSaving(false);
    }
  };

  const active = !!state?.enabled && remaining > 0;
  const cardCls = active
    ? "bg-[#FDF1EF] border-[#D45D5D]"
    : "bg-white border-[#E8E5DF]";
  const iconBg = active ? "bg-[#F4C7BE]" : "bg-[#EAF2E8]";
  const iconColor = active ? "text-[#8B3220]" : "text-[#2D4A3E]";

  return (
    <div
      className={`border-2 rounded-2xl p-6 ${cardCls}`}
      data-testid="master-testing-card"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className={`rounded-full p-2.5 ${iconBg}`}>
          {active ? <ShieldOff size={20} className={iconColor} /> :
                    <Shield size={20} className={iconColor} />}
        </div>
        <div className="flex-1 min-w-[200px]">
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Master testing mode {active && (
              <span className="text-base font-normal text-[#8B3220]">
                &nbsp;-- ON
              </span>
            )}
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
            ONE toggle that bypasses every bot/rate-limit defense at
            once: Turnstile, intake + signup IP rate limits, per-email
            cap, timing heuristic, magic-code 5/hr cap, and magic-code
            wrong-attempt lockout. Honeypot, HMAC tokens, admin login
            lockout, and crisis triggers stay active.
          </p>
          <p className="text-xs text-[#6D6A65] mt-2 italic">
            Auto-expires server-side after the chosen window (max{" "}
            {state?.max_hours || 8}h) so you can't leave it on by
            accident.
          </p>
          {active && (
            <div className="mt-4 bg-[#FBE9E5] border border-[#F4C7BE] rounded-lg p-3 text-sm">
              <div className="font-semibold text-[#8B3220]">
                Bot defenses are OFF -- treat any traffic right now as untrusted.
              </div>
              <div className="text-xs text-[#6D6A65] mt-1">
                Expires in <strong>{fmt(remaining)}</strong>
                {state?.enabled_reason ? (
                  <> &middot; reason: <em>{state.enabled_reason}</em></>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {active ? (
            <button
              onClick={disable}
              disabled={saving}
              className="bg-[#2D4A3E] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              data-testid="master-testing-disable"
            >
              {saving ? "Working..." : "Turn OFF now"}
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#6D6A65]">Hours:</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0.1"
                  max={state?.max_hours || 8}
                  value={hours}
                  onChange={(e) => setHours(parseFloat(e.target.value) || 1)}
                  className="w-20 text-sm"
                  data-testid="master-testing-hours"
                />
              </div>
              <Input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                maxLength={120}
                className="w-56 text-sm"
                data-testid="master-testing-reason"
              />
              <button
                onClick={enable}
                disabled={saving}
                className="bg-[#D45D5D] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                data-testid="master-testing-enable"
              >
                {saving ? "Working..." : "Enable testing mode"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// Platform-wide settings the admin can tune at runtime. Currently exposes
// the patient-intake rate limit (X requests per Y minutes per email).
// Backend: GET/PUT /api/admin/intake-rate-limit.
export default function SettingsPanel({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [loaded, setLoaded] = useState(false);
  const [maxPer, setMaxPer] = useState(1);
  const [windowMin, setWindowMin] = useState(60);
  const [maxPerIp, setMaxPerIp] = useState(8);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Test mode: time-boxed admin bypass of both rate-limit axes so the
  // admin can run end-to-end intake tests without tripping their own
  // anti-spam guards. `testModeUntil` is an ISO timestamp; we re-tick
  // a local countdown every second once it's set.
  const [testModeUntil, setTestModeUntil] = useState(null);
  const [testModeSecsLeft, setTestModeSecsLeft] = useState(0);
  const [testModeMinutes, setTestModeMinutes] = useState(60);
  const [testModeSaving, setTestModeSaving] = useState(false);

  // LLM web-research enrichment toggle + stats.
  const [reEnabled, setReEnabled] = useState(false);
  const [reStats, setReStats] = useState(null);
  const [reSaving, setReSaving] = useState(false);

  // Deep-research warmup state (pre-fills cache for top N therapists)
  const [warmup, setWarmup] = useState(null);
  const [warmupStarting, setWarmupStarting] = useState(false);
  const [warmupCount, setWarmupCount] = useState(30);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await _adminGetWithRetry(client, "/admin/intake-rate-limit");
        if (!alive) return;
        setMaxPer(r.data.max_requests_per_window);
        setWindowMin(r.data.window_minutes);
        if (typeof r.data.max_per_ip_per_hour === "number") {
          setMaxPerIp(r.data.max_per_ip_per_hour);
        }
        if (r.data.test_mode_until) {
          setTestModeUntil(r.data.test_mode_until);
          setTestModeSecsLeft(
            Number(r.data.test_mode_seconds_remaining) || 0,
          );
        } else {
          setTestModeUntil(null);
          setTestModeSecsLeft(0);
        }
        setLoaded(true);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail ||
            e.message ||
            "Failed to load rate-limit settings",
        );
      }
      try {
        const r2 = await _adminGetWithRetry(client, "/admin/research-enrichment");
        if (!alive) return;
        setReEnabled(!!r2.data.enabled);
        setReStats({
          fresh: r2.data.therapists_with_fresh_research,
          enrichedRequests: r2.data.enriched_requests,
        });
      } catch (e) {
        // Soft fail — toggle simply hidden if the endpoint isn't reachable.
        // We deliberately don't toast here so a missing endpoint on older
        // backends doesn't yell at the admin every page load.
        console.warn("research-enrichment status unreachable:", e?.message);
      }
      try {
        const r3 = await _adminGetWithRetry(client, "/admin/research-enrichment/warmup");
        if (!alive) return;
        setWarmup(r3.data || null);
      } catch (e) {
        console.warn("warmup status unreachable:", e?.message);
      }
    })();
    // Poll the warmup status every 5s while it's running so the admin
    // sees live progress without manual refresh.
    const id = setInterval(async () => {
      try {
        const r = await client.get("/admin/research-enrichment/warmup");
        setWarmup(r.data || null);
      } catch (e) {
        // Polling errors are silent by design — we don't want a transient
        // 500 to spam the console. Only warn if it persists across polls.
        if (e?.response?.status >= 500) {
          console.warn("warmup poll 5xx:", e?.response?.status);
        }
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client]);

  const toggleResearch = async (next) => {
    setReSaving(true);
    try {
      const r = await client.put("/admin/research-enrichment", { enabled: next });
      setReEnabled(!!r.data.enabled);
      toast.success(
        r.data.enabled
          ? "LLM web-research enrichment enabled"
          : "LLM web-research enrichment disabled",
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Save failed");
    } finally {
      setReSaving(false);
    }
  };

  const startWarmup = async () => {
    if (!window.confirm(
      `Pre-warm deep research for the top ${warmupCount} therapists?\n\nThis runs in the background (~30 minutes for 30 therapists). Each therapist's research is cached for 30 days, so future patient requests get the bonus instantly.\n\nProceed?`,
    )) return;
    setWarmupStarting(true);
    try {
      const r = await client.post("/admin/research-enrichment/warmup", {
        count: Number(warmupCount),
      });
      toast.success(
        `Warmup started — ${r.data?.queued} therapists queued. Refresh this card to track progress.`,
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Warmup failed to start");
    } finally {
      setWarmupStarting(false);
    }
  };

  // Tick the test-mode countdown locally so the admin sees it shrink in
  // real time. When it hits 0, clear the local state — the next page
  // load (or the next /api/requests submission) confirms it server-side.
  useEffect(() => {
    if (!testModeUntil || testModeSecsLeft <= 0) return undefined;
    const id = setInterval(() => {
      setTestModeSecsLeft((s) => {
        if (s <= 1) {
          setTestModeUntil(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [testModeUntil, testModeSecsLeft]);

  const enableTestMode = async () => {
    const minutes = Math.max(1, Math.min(1440, Number(testModeMinutes) || 60));
    setTestModeSaving(true);
    try {
      const r = await client.post(
        "/admin/intake-rate-limit/test-mode",
        { minutes },
      );
      setTestModeUntil(r.data.test_mode_until);
      setTestModeSecsLeft(Number(r.data.test_mode_seconds_remaining) || 0);
      toast.success(
        `Test mode ON for ${minutes} minute${minutes === 1 ? "" : "s"} — rate limits bypassed.`,
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Failed to enable test mode");
    } finally {
      setTestModeSaving(false);
    }
  };

  const disableTestMode = async () => {
    setTestModeSaving(true);
    try {
      await client.delete("/admin/intake-rate-limit/test-mode");
      setTestModeUntil(null);
      setTestModeSecsLeft(0);
      toast.success("Test mode disabled — rate limits enforced again.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Failed to disable test mode");
    } finally {
      setTestModeSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setErrorMsg("");
    try {
      const r = await client.put("/admin/intake-rate-limit", {
        max_requests_per_window: Number(maxPer),
        window_minutes: Number(windowMin),
        max_per_ip_per_hour: Number(maxPerIp),
      });
      // Reflect the server-confirmed values so the form always matches
      // what's actually persisted (avoids stale-form confusion).
      setMaxPer(r.data.max_requests_per_window);
      setWindowMin(r.data.window_minutes);
      if (typeof r.data.max_per_ip_per_hour === "number") {
        setMaxPerIp(r.data.max_per_ip_per_hour);
      }
      toast.success(
        `Saved — ${r.data.max_requests_per_window}/${r.data.window_minutes}min per email · ${r.data.max_per_ip_per_hour}/hr per IP`,
      );
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Save failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 space-y-6" data-testid="settings-panel">
      <GoLiveCard client={client} />
      <MasterTestingCard client={client} />
      <TurnstileToggleCard client={client} />

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          Patient intake rate limit
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
          Cap how many requests one email can submit within a rolling
          window. While we're still learning real user patterns, keep this
          tight to prevent junk submissions and avoid overwhelming the
          matching engine.
        </p>

        {!loaded ? (
          <div className="mt-6 text-sm text-[#6D6A65] inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mt-5 space-y-4 max-w-md">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="rl-max"
                  className="text-xs uppercase tracking-wider text-[#6D6A65]"
                >
                  Requests per window
                </label>
                <Input
                  id="rl-max"
                  type="number"
                  min={1}
                  max={1000}
                  value={maxPer}
                  onChange={(e) => setMaxPer(e.target.value)}
                  className="mt-1"
                  data-testid="rate-limit-max-input"
                />
              </div>
              <div>
                <label
                  htmlFor="rl-window"
                  className="text-xs uppercase tracking-wider text-[#6D6A65]"
                >
                  Window (minutes)
                </label>
                <Input
                  id="rl-window"
                  type="number"
                  min={1}
                  max={43200}
                  value={windowMin}
                  onChange={(e) => setWindowMin(e.target.value)}
                  className="mt-1"
                  data-testid="rate-limit-window-input"
                />
              </div>
            </div>
            <p className="text-xs text-[#6D6A65]">
              Currently allowing{" "}
              <strong>
                {maxPer} {Number(maxPer) === 1 ? "request" : "requests"}
              </strong>{" "}
              per <strong>{windowMin} minutes</strong> per email address.
            </p>
            <div>
              <label
                htmlFor="rl-ip"
                className="text-xs uppercase tracking-wider text-[#6D6A65]"
              >
                Max submissions per IP per hour
              </label>
              <Input
                id="rl-ip"
                type="number"
                min={1}
                max={10000}
                value={maxPerIp}
                onChange={(e) => setMaxPerIp(e.target.value)}
                className="mt-1 max-w-[160px]"
                data-testid="rate-limit-ip-input"
              />
              <p className="text-[11px] text-[#6D6A65] mt-1.5 leading-snug">
                Network-level cap. A single IP (clinic / family wifi)
                hitting this limit gets a "Too many submissions from this
                network" 429. Default 8 — raise during testing, tighten if
                you see scripted spam.
              </p>
            </div>
            {errorMsg ? (
              <p
                className="text-xs text-[#B0382A] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-3 py-2"
                data-testid="rate-limit-error"
              >
                {errorMsg}
              </p>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={saving || !maxPer || !windowMin || !maxPerIp}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="rate-limit-save-btn"
            >
              {saving ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : null}
              Save rate limit
            </button>
          </div>
        )}
      </div>

      {/* Test mode — time-boxed bypass of rate limits */}
      <div
        className="bg-white border border-[#E8E5DF] rounded-2xl p-6"
        data-testid="test-mode-card"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Test mode
            </h3>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Temporarily bypass <strong>both</strong> rate limits (per-IP
              and per-email) so you can run end-to-end intake tests without
              tripping your own anti-spam guards. Honeypot, timing, and
              Turnstile remain active — only the throttle is relaxed.
            </p>
          </div>
          {testModeUntil ? (
            <span
              className="inline-flex items-center gap-2 rounded-full bg-[#FFF6E8] border border-[#F1C97B] px-3 py-1 text-xs font-semibold text-[#7A4D00] whitespace-nowrap"
              data-testid="test-mode-active-badge"
            >
              <span className="h-2 w-2 rounded-full bg-[#E1A92E] animate-pulse" />
              ACTIVE · {Math.floor(testModeSecsLeft / 60)}m {testModeSecsLeft % 60}s left
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-2 rounded-full bg-[#F5F2EC] border border-[#E0DCD3] px-3 py-1 text-xs text-[#6D6A65] whitespace-nowrap"
              data-testid="test-mode-inactive-badge"
            >
              <span className="h-2 w-2 rounded-full bg-[#A4A29E]" />
              Off
            </span>
          )}
        </div>

        {testModeUntil ? (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={disableTestMode}
              disabled={testModeSaving}
              className="px-4 py-2 rounded-md bg-[#2D4A3E] text-white text-sm font-medium hover:bg-[#1F3A30] disabled:opacity-50"
              data-testid="test-mode-disable-btn"
            >
              {testModeSaving ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : null}
              Turn off now
            </button>
            <span className="text-xs text-[#6D6A65]">
              Auto-expires in {Math.floor(testModeSecsLeft / 60)} min{" "}
              {testModeSecsLeft % 60}s.
            </span>
          </div>
        ) : (
          <div className="mt-5 flex items-end gap-3 flex-wrap">
            <div>
              <label
                htmlFor="tm-mins"
                className="text-xs uppercase tracking-wider text-[#6D6A65]"
              >
                Duration (minutes)
              </label>
              <Input
                id="tm-mins"
                type="number"
                min={1}
                max={1440}
                value={testModeMinutes}
                onChange={(e) => setTestModeMinutes(e.target.value)}
                className="mt-1 max-w-[120px]"
                data-testid="test-mode-minutes-input"
              />
            </div>
            <button
              type="button"
              onClick={enableTestMode}
              disabled={testModeSaving || !testModeMinutes}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="test-mode-enable-btn"
            >
              {testModeSaving ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : null}
              Enable test mode
            </button>
            <span className="text-xs text-[#6D6A65]">
              Caps at 24h. Also clears the IP log so your next submission
              starts fresh.
            </span>
          </div>
        )}
      </div>

      <MatchingDefaultsCard client={client} />

      {/* LLM web-research enrichment */}
      <div
        className="bg-white border border-[#E8E5DF] rounded-2xl p-6"
        data-testid="research-enrichment-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              LLM web-research enrichment
            </h3>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Pulls each therapist's public website + bio through Claude to
              grade <strong>evidence depth</strong> (0-10), <strong>approach
              alignment</strong> (0-5), and <strong>apply-text fit</strong>{" "}
              (0-5) per patient request — adds up to <strong>+20 bonus
              points</strong> on top of the standard 100-point match. Each
              score comes with a one-sentence rationale citing the evidence.
            </p>
            {reStats ? (
              <p className="text-xs text-[#6D6A65] mt-3">
                <strong>{reStats.fresh}</strong> therapists have fresh research
                cached (≤30 days) ·{" "}
                <strong>{reStats.enrichedRequests}</strong> requests enriched
                so far.
              </p>
            ) : null}
          </div>
          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            data-testid="research-enrichment-toggle-label"
          >
            <input
              type="checkbox"
              checked={reEnabled}
              disabled={reSaving}
              onChange={(e) => toggleResearch(e.target.checked)}
              className="w-5 h-5 accent-[#2D4A3E]"
              data-testid="research-enrichment-toggle"
            />
            <span className="text-sm text-[#2B2A29] font-medium">
              {reEnabled ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>

        {/* Deep-research warmup */}
        <div className="mt-6 pt-5 border-t border-[#E8E5DF]">
          <h4 className="text-sm font-semibold text-[#2D4A3E]">
            Pre-warm deep-research cache
          </h4>
          <p className="text-xs text-[#6D6A65] mt-1.5 max-w-2xl leading-relaxed">
            Run deep research on therapists whose cache is missing or
            older than 30 days, in the background (DDG search + 5 page
            fetches + LLM extraction per therapist). Already-fresh
            therapists are skipped automatically, so re-clicking is
            cheap. Cached for 30 days — once done, every patient request
            that matches one of these therapists gets the enrichment
            bonus instantly with no extra latency.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Input
              type="number"
              min={1}
              max={200}
              value={warmupCount}
              onChange={(e) => setWarmupCount(e.target.value)}
              className="w-24"
              data-testid="warmup-count-input"
              disabled={warmup?.running}
            />
            <span className="text-xs text-[#6D6A65]">therapists</span>
            <button
              type="button"
              onClick={startWarmup}
              disabled={warmupStarting || warmup?.running}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="warmup-start-btn"
            >
              {warmupStarting || warmup?.running ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : null}
              {warmup?.running ? "Running…" : "Start warmup"}
            </button>
            {warmup?.running ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await client.post("/admin/research-enrichment/warmup/cancel");
                    toast.success("Warmup cancellation requested");
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Cancel failed");
                  }
                }}
                className="text-xs text-[#B0382A] hover:underline"
                data-testid="warmup-cancel-btn"
              >
                Cancel
              </button>
            ) : null}
          </div>
          {warmup ? (
            <div
              className="mt-3 text-xs text-[#2B2A29] bg-[#FDFBF7] border border-[#E8E5DF] rounded-md px-3 py-2"
              data-testid="warmup-status"
            >
              {warmup.running ? (
                <>
                  <strong>{warmup.done}</strong> / {warmup.total} done
                  {warmup.failed ? ` (${warmup.failed} failed)` : ""} ·
                  currently:{" "}
                  <em>{warmup.current_name || "starting…"}</em>
                </>
              ) : warmup.completed_at ? (
                <>
                  Last run: <strong>{warmup.done}</strong> /{" "}
                  {warmup.total} done
                  {warmup.failed ? ` · ${warmup.failed} failed` : ""} · finished{" "}
                  {new Date(warmup.completed_at).toLocaleString()}
                </>
              ) : (
                <>No warmup runs yet.</>
              )}
            </div>
          ) : null}
        </div>

        <DeepMatchWeightsCard client={client} />
      </div>
    </div>
  );
}

// ─── Deep-match weights card (Iter-90) ──────────────────────────────
// Admins can override the v2-spec default 0.40 / 0.35 / 0.25 weighting
// for the three deep-match axes. Backend renormalises so any input
// Global matching defaults — threshold + max invites. Read by
// _trigger_matching on every new patient request.
function MatchingDefaultsCard({ client: clientProp }) {
  const ctxClient = useAdminClient();
  const client = clientProp || ctxClient;
  const [loaded, setLoaded] = useState(false);
  const [threshold, setThreshold] = useState(70);
  const [maxInvites, setMaxInvites] = useState(30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await _adminGetWithRetry(client, "/admin/matching-defaults");
        if (!alive) return;
        setThreshold(r.data.threshold);
        setMaxInvites(r.data.max_invites);
        setLoaded(true);
      } catch (e) {
        console.warn("matching-defaults unreachable:", e?.message);
        setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [client]);

  const save = async () => {
    setSaving(true);
    try {
      await client.put("/admin/matching-defaults", {
        threshold: Number(threshold),
        max_invites: Number(maxInvites),
      });
      toast.success("Matching defaults saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
      <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
        Matching defaults
      </h3>
      <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
        Global threshold and max invites for all new patient requests.
        Changes take effect immediately on the next match run.
      </p>
      {!loaded ? (
        <div className="mt-6 text-sm text-[#6D6A65] inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </div>
      ) : (
        <div className="mt-5 space-y-4 max-w-md">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="md-threshold"
                className="text-xs uppercase tracking-wider text-[#6D6A65]"
              >
                Threshold (%)
              </label>
              <Input
                id="md-threshold"
                type="number"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="mt-1"
                data-testid="matching-threshold-input"
              />
            </div>
            <div>
              <label
                htmlFor="md-max"
                className="text-xs uppercase tracking-wider text-[#6D6A65]"
              >
                Max invites
              </label>
              <Input
                id="md-max"
                type="number"
                min={1}
                max={200}
                value={maxInvites}
                onChange={(e) => setMaxInvites(e.target.value)}
                className="mt-1"
                data-testid="matching-max-invites-input"
              />
            </div>
          </div>
          <button
            className="tv-btn-primary !py-2 !px-5 text-sm disabled:opacity-60"
            onClick={save}
            disabled={saving}
            data-testid="matching-defaults-save"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// summing to a positive number works; live preview shows what the
// values will normalise to before save.
function DeepMatchWeightsCard({ client }) {
  const [w, setW] = useState({
    relationship_style: 0.40,
    way_of_working: 0.35,
    contextual_resonance: 0.25,
  });
  const [defaults, setDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await _adminGetWithRetry(client, "/admin/deep-match-weights");
        if (cancelled) return;
        setW({
          relationship_style: r.data.relationship_style,
          way_of_working: r.data.way_of_working,
          contextual_resonance: r.data.contextual_resonance,
        });
        setDefaults(r.data.defaults);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail || "Failed to load deep-match weights",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client]);
  const total = w.relationship_style + w.way_of_working + w.contextual_resonance;
  const norm = (v) => (total > 0 ? v / total : 0);
  const allInRange = ["relationship_style", "way_of_working", "contextual_resonance"]
    .every((k) => w[k] >= 0.05 && w[k] <= 0.60);
  const save = async () => {
    if (!allInRange) {
      toast.error("Each weight must be between 0.05 and 0.60");
      return;
    }
    setSaving(true);
    try {
      const r = await client.put("/admin/deep-match-weights", w);
      setW({
        relationship_style: r.data.relationship_style,
        way_of_working: r.data.way_of_working,
        contextual_resonance: r.data.contextual_resonance,
      });
      toast.success("Deep-match weights saved");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Save failed",
      );
    } finally {
      setSaving(false);
    }
  };
  const resetDefaults = () => {
    if (defaults) setW({ ...defaults });
  };
  if (loading) {
    return (
      <div
        className="rounded-2xl bg-white border border-[#E8E5DF] p-5 mt-5"
        data-testid="deep-match-weights-loading"
      >
        <p className="text-sm text-[#6D6A65]">Loading deep-match weights…</p>
      </div>
    );
  }
  const rows = [
    {
      key: "relationship_style",
      label: "Relationship style",
      hint: "P1 ↔ T1 + T4 (cosine sim of pick vector vs. ranked therapist instincts).",
    },
    {
      key: "way_of_working",
      label: "Way of working",
      hint: "P2 ↔ T3 (overlap of 2-of-6 picks ÷ 2).",
    },
    {
      key: "contextual_resonance",
      label: "Contextual resonance",
      hint: "P3 ↔ T5 + T2 (text-embedding cosine sim, 70% T5 + 30% T2).",
    },
  ];
  return (
    <div
      className="rounded-2xl bg-white border border-[#E8E5DF] p-5 mt-5"
      data-testid="deep-match-weights-card"
    >
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#C8412B] font-semibold">
            ✦ Deep match
          </p>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-1">
            Scoring weights
          </h3>
          <p className="text-xs text-[#6D6A65] mt-1 max-w-xl leading-relaxed">
            Three axes that activate when a patient opts into the deeper
            intake. Each weight must be between 0.05 and 0.60. Backend
            renormalises so they always sum to 1.0 — see the "after
            normalisation" column.
          </p>
        </div>
        {defaults && (
          <button
            type="button"
            onClick={resetDefaults}
            className="text-xs text-[#6D6A65] underline hover:text-[#2D4A3E]"
            data-testid="deep-match-weights-reset"
          >
            Reset to defaults
          </button>
        )}
      </div>
      <div className="space-y-4">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-1 sm:grid-cols-3 items-baseline gap-3 border-b border-[#F4EFE7] pb-3 last:border-b-0"
          >
            <div className="sm:col-span-1">
              <p className="text-sm font-medium text-[#2D4A3E]">{row.label}</p>
              <p className="text-[11px] text-[#6D6A65] mt-0.5 leading-snug">
                {row.hint}
              </p>
            </div>
            <div className="sm:col-span-1">
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="0.60"
                value={w[row.key]}
                onChange={(e) =>
                  setW((prev) => ({
                    ...prev,
                    [row.key]: parseFloat(e.target.value) || 0,
                  }))
                }
                className={`w-full px-3 py-1.5 rounded-md bg-[#FDFBF7] border text-sm ${
                  w[row.key] >= 0.05 && w[row.key] <= 0.60
                    ? "border-[#E8E5DF]"
                    : "border-[#C8412B]"
                }`}
                data-testid={`deep-match-weight-${row.key}`}
              />
            </div>
            <div className="sm:col-span-1 text-xs text-[#6D6A65]">
              <span className="font-mono">
                {(norm(w[row.key]) * 100).toFixed(1)}%
              </span>{" "}
              <span className="text-[10px]">after normalisation</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <p className="text-[11px] text-[#6D6A65]">
          Sum of inputs: <span className="font-mono">{total.toFixed(2)}</span>
        </p>
        <button
          type="button"
          onClick={save}
          disabled={!allInRange || saving}
          className="bg-[#2D4A3E] text-white text-sm rounded-full px-5 py-2 hover:bg-[#1F362C] disabled:opacity-50 transition"
          data-testid="deep-match-weights-save"
        >
          {saving ? "Saving…" : "Save weights"}
        </button>
      </div>
    </div>
  );
}
