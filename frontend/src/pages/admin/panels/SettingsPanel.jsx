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
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  const save = async () => {
    setSaving(true);
    try {
      await client.put("/admin/intake-rate-limit", {
        max_requests_per_window: Number(maxPer),
        window_minutes: Number(windowMin),
      });
      toast.success("Rate limit saved");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Save failed",
      );
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
                  max={50}
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
                  max={10080}
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
    </div>
  );
}
