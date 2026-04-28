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
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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
      }
      try {
        const r3 = await client.get("/admin/research-enrichment/warmup");
        if (!alive) return;
        setWarmup(r3.data || null);
      } catch (_e) {
        // Soft fail
      }
    })();
    // Poll the warmup status every 5s while it's running so the admin
    // sees live progress without manual refresh.
    const id = setInterval(async () => {
      try {
        const r = await client.get("/admin/research-enrichment/warmup");
        setWarmup(r.data || null);
      } catch (_e) {}
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

  const save = async () => {
    setSaving(true);
    setErrorMsg("");
    try {
      const r = await client.put("/admin/intake-rate-limit", {
        max_requests_per_window: Number(maxPer),
        window_minutes: Number(windowMin),
      });
      // Reflect the server-confirmed values so the form always matches
      // what's actually persisted (avoids stale-form confusion).
      setMaxPer(r.data.max_requests_per_window);
      setWindowMin(r.data.window_minutes);
      toast.success(
        `Saved — ${r.data.max_requests_per_window} per ${r.data.window_minutes} min`,
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
              disabled={saving || !maxPer || !windowMin}
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
