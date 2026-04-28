import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { bustSiteCopyCache } from "@/lib/useSiteCopy";
import { Th } from "./_shared";

// ── Site-copy editor ────────────────────────────────────────────────
// Lets admins override any text on the public site keyed by a stable
// identifier (e.g. "landing.hero.headline"). The list below seeds the
// editor with every key the React code references; admins can also add
// new keys via the "Add custom key" form (handy when we add new
// sections faster than we update the seed list).
const SEED_KEYS = [
  // Landing — hero
  {
    key: "landing.hero.eyebrow",
    label: "Landing · Hero eyebrow",
    fallback: "Therapy referrals, reimagined",
  },
  {
    key: "landing.hero.headline",
    label: "Landing · Hero headline",
    fallback: "Find the right therapist — without the search",
  },
  {
    key: "landing.hero.subhead",
    label: "Landing · Hero subhead",
    fallback:
      "Tell us what you need. We match you with vetted therapists who actively want to help.",
  },
  {
    key: "landing.hero.cta",
    label: "Landing · Hero CTA",
    fallback: "Get matched",
  },
  // How it works
  {
    key: "landing.how.heading",
    label: "Landing · How it works heading",
    fallback: "How it works",
  },
  {
    key: "landing.how.subhead",
    label: "Landing · How it works subhead",
    fallback: "Three steps from request to first session.",
  },
  // Why TheraVoca
  {
    key: "landing.different.heading",
    label: "Landing · Why TheraVoca heading",
    fallback: "Why TheraVoca",
  },
  {
    key: "landing.different.subhead",
    label: "Landing · Why TheraVoca subhead",
    fallback:
      "We do the search. You meet the therapists who can actually help.",
  },
  // FAQ
  {
    key: "landing.faq.heading",
    label: "Landing · FAQ heading",
    fallback: "Things people ask",
  },
  // Therapist join hero
  {
    key: "therapist.hero.eyebrow",
    label: "Therapist · Hero eyebrow",
    fallback: "Join the network",
  },
  {
    key: "therapist.hero.headline",
    label: "Therapist · Hero headline",
    fallback: "Get matched with patients who fit your practice",
  },
  {
    key: "therapist.hero.subhead",
    label: "Therapist · Hero subhead",
    fallback:
      "Stop chasing leads. Stop fighting insurance forms. We send you only the patients you can actually help.",
  },
  // Footer
  {
    key: "footer.tagline",
    label: "Footer · Tagline",
    fallback:
      "Let therapists come to you. We do the logistical work so you can focus on healing.",
  },
];

export default function SiteCopyAdminPanel({ client }) {
  const [overrides, setOverrides] = useState(null); // {key: {value, updated_at}}
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/site-copy");
        if (!alive) return;
        const map = {};
        (r.data?.rows || []).forEach((row) => {
          map[row.key] = row;
        });
        setOverrides(map);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail || e.message || "Failed to load copy",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, reload]);

  const save = async (key, value) => {
    setSavingKey(key);
    try {
      await client.put("/admin/site-copy", { key, value });
      bustSiteCopyCache();
      toast.success("Saved — refresh the page to see it live.");
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Save failed",
      );
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async (key) => {
    if (!window.confirm(`Reset "${key}" to default copy?`)) return;
    try {
      await client.delete(`/admin/site-copy/${encodeURIComponent(key)}`);
      bustSiteCopyCache();
      toast.success("Reset to default");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Reset failed");
    }
  };

  const addCustom = async () => {
    if (!customKey.trim()) {
      toast.error("Key is required");
      return;
    }
    await save(customKey.trim(), customValue);
    setCustomKey("");
    setCustomValue("");
  };

  return (
    <div className="mt-6 space-y-4" data-testid="site-copy-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          Site copy editor
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          Override any headline / subhead / section copy on the public
          site. Saved values appear within ~60s of a hard refresh. Reset
          to default removes the override and the React fallback wins
          again.
        </p>
      </div>

      {overrides == null ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading copy…
        </div>
      ) : (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[#6D6A65] border-b border-[#E8E5DF]">
              <tr>
                <Th>Section / key</Th>
                <Th>Default</Th>
                <Th>Override</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {SEED_KEYS.map((seed) => {
                const row = overrides[seed.key];
                const draft = drafts[seed.key];
                const current =
                  draft != null ? draft : row?.value ?? "";
                const isOverridden = !!row;
                return (
                  <tr
                    key={seed.key}
                    className="border-b border-[#E8E5DF] last:border-0 align-top"
                    data-testid={`copy-row-${seed.key}`}
                  >
                    <td className="p-4">
                      <div className="text-[#2B2A29] font-medium">
                        {seed.label}
                      </div>
                      <code className="text-[11px] text-[#6D6A65]">
                        {seed.key}
                      </code>
                    </td>
                    <td className="p-4 text-xs text-[#6D6A65] max-w-xs">
                      {seed.fallback}
                    </td>
                    <td className="p-4">
                      {seed.fallback.length > 80 ? (
                        <Textarea
                          rows={3}
                          value={current}
                          placeholder="(using default)"
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [seed.key]: e.target.value,
                            }))
                          }
                          data-testid={`copy-input-${seed.key}`}
                        />
                      ) : (
                        <Input
                          value={current}
                          placeholder="(using default)"
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [seed.key]: e.target.value,
                            }))
                          }
                          data-testid={`copy-input-${seed.key}`}
                        />
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => save(seed.key, current)}
                          disabled={
                            savingKey === seed.key ||
                            (!isOverridden && !current.trim())
                          }
                          className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
                          data-testid={`copy-save-${seed.key}`}
                        >
                          {savingKey === seed.key ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Pencil size={11} />
                          )}
                          Save
                        </button>
                        {isOverridden && (
                          <button
                            type="button"
                            onClick={() => remove(seed.key)}
                            className="text-[#D45D5D] hover:underline text-xs inline-flex items-center gap-1"
                            data-testid={`copy-reset-${seed.key}`}
                          >
                            <Trash2 size={11} />
                            Reset
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <h4 className="text-sm font-medium text-[#2B2A29]">
          Add custom key
        </h4>
        <p className="text-xs text-[#6D6A65] mt-1">
          Use this when the engineering team has wired a new key into a
          page that isn't in the seed list yet.
        </p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder="landing.section.key"
            data-testid="copy-custom-key"
          />
          <Input
            className="md:col-span-2"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Override text"
            data-testid="copy-custom-value"
          />
        </div>
        <button
          type="button"
          onClick={addCustom}
          disabled={!customKey.trim()}
          className="tv-btn-primary !py-2 !px-4 text-sm mt-3 disabled:opacity-50"
          data-testid="copy-custom-save-btn"
        >
          Save custom key
        </button>
      </div>
    </div>
  );
}
