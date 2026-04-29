import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

// Platform-wide settings the admin can tune at runtime. Currently exposes
// the patient-intake rate limit (X requests per Y minutes per email).
// Backend: GET/PUT /api/admin/intake-rate-limit.
export default function SettingsPanel({ client }) {
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
        const r = await client.get("/admin/intake-rate-limit");
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
        const r2 = await client.get("/admin/research-enrichment");
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
        const r3 = await client.get("/admin/research-enrichment/warmup");
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
            Run deep research on your top N therapists in the background
            (DDG search + 5 page fetches + LLM extraction per therapist).
            Cached for 30 days — once done, every patient request that
            matches one of these therapists gets the enrichment bonus
            instantly with no extra latency.
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
      </div>
    </div>
  );
}
