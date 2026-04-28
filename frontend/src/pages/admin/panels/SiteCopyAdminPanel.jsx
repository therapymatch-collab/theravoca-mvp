import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, ExternalLink } from "lucide-react";
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
    fallback: "Pilot live in Idaho",
    previewPath: "/",
  },
  {
    key: "landing.hero.headline",
    label: "Landing · Hero headline",
    fallback: "Let therapists come to you.",
    previewPath: "/",
  },
  {
    key: "landing.hero.promise",
    label: "Landing · Hero promise (large)",
    fallback: "3+ matched therapists in 24 hours, guaranteed.",
    previewPath: "/",
  },
  {
    key: "landing.hero.subhead",
    label: "Landing · Hero subhead",
    fallback:
      "No more searching, cold-calls, or waiting to hear back. Pick what matters, and we'll route your request to therapists in your network who actually want to work with you.",
    previewPath: "/",
  },
  {
    key: "landing.hero.cta",
    label: "Landing · Hero CTA",
    fallback: "Get matched — free",
    previewPath: "/",
  },
  // How it works
  {
    key: "landing.how.heading",
    label: "Landing · How it works heading",
    fallback: "How it works",
    previewPath: "/#how",
  },
  {
    key: "landing.how.subhead",
    label: "Landing · How it works subhead",
    fallback: "Three steps. No forms-overload.",
    previewPath: "/#how",
  },
  // Why TheraVoca
  {
    key: "landing.different.eyebrow",
    label: "Landing · Why TheraVoca eyebrow",
    fallback: "How we're different",
    previewPath: "/#different",
  },
  {
    key: "landing.different.heading",
    label: "Landing · Why TheraVoca heading",
    fallback: "Finding the right therapist shouldn't feel like a full-time job.",
    previewPath: "/#different",
  },
  // FAQ
  {
    key: "landing.faq.eyebrow",
    label: "Landing · FAQ eyebrow",
    fallback: "FAQs",
    previewPath: "/#faq",
  },
  {
    key: "landing.faq.heading",
    label: "Landing · FAQ heading",
    fallback: "Things people ask",
    previewPath: "/#faq",
  },
  // Therapist join hero
  {
    key: "therapist.hero.eyebrow",
    label: "Therapist · Hero eyebrow",
    fallback: "Join the network",
    previewPath: "/therapists/join",
  },
  {
    key: "therapist.hero.headline",
    label: "Therapist · Hero headline",
    fallback: "Get matched with patients who fit your practice",
    previewPath: "/therapists/join",
  },
  {
    key: "therapist.hero.subhead",
    label: "Therapist · Hero subhead",
    fallback:
      "Stop chasing leads. Stop fighting insurance forms. We send you only the patients you can actually help.",
    previewPath: "/therapists/join",
  },
  // Footer
  {
    key: "footer.tagline",
    label: "Footer · Tagline",
    fallback:
      "Let therapists come to you. We do the logistical work so you can focus on healing.",
    previewPath: "/",
  },
  // ─── Button labels (CTA copy) ──────────────────────────────────────
  {
    key: "btn.therapist.cta.headline",
    label: "Button — Therapist hero CTA headline",
    fallback: "Get more referrals",
    previewPath: "/therapists/join",
  },
  {
    key: "btn.therapist.cta.subline",
    label: "Button — Therapist hero CTA subline",
    fallback: "30-day free trial · Cancel anytime",
    previewPath: "/therapists/join",
  },
  {
    key: "btn.therapist.signup_cta",
    label: "Button — Therapist signup hero CTA",
    fallback: "Sign up — start free trial",
    previewPath: "/therapists/join",
  },
  {
    key: "btn.intake.start",
    label: "Button — Patient intake primary",
    fallback: "Get matched — free",
    previewPath: "/get-matched",
  },
  {
    key: "btn.intake.next",
    label: "Button — Intake form 'Continue' label",
    fallback: "Continue",
    previewPath: "/#start",
  },
  {
    key: "btn.intake.back",
    label: "Button — Intake form 'Back' label",
    fallback: "← Back",
    previewPath: "/#start",
  },
  {
    key: "btn.intake.submit",
    label: "Button — Intake form 'Review & submit'",
    fallback: "Review & submit",
    previewPath: "/#start",
  },
  {
    key: "btn.intake.preview_edit",
    label: "Button — Review modal 'Edit answers'",
    fallback: "← Edit answers",
    previewPath: "/#start",
  },
  {
    key: "btn.intake.preview_submit",
    label: "Button — Review modal 'Confirm & submit'",
    fallback: "Confirm & find my matches",
    previewPath: "/#start",
  },
  {
    key: "intake.priorities.label",
    label: "Intake · 'What matters most?' question",
    fallback: "Which of these matter most to you?",
    previewPath: "/#start",
  },
  {
    key: "intake.priorities.hint",
    label: "Intake · 'What matters most?' hint",
    fallback:
      "Tap any that really matter — we'll lean your matches toward those. Skip if you'd rather we use our default ranking.",
    previewPath: "/#start",
  },
  {
    key: "intake.priorities.strict_label",
    label: "Intake · Strict-priorities toggle label",
    fallback: "Strict mode",
    previewPath: "/#start",
  },
  {
    key: "intake.priorities.strict_desc",
    label: "Intake · Strict-priorities toggle description",
    fallback:
      "only show me therapists who are a real fit on every priority I picked. (Fewer matches, but tighter.)",
    previewPath: "/#start",
  },
  {
    key: "btn.signin.send_code",
    label: "Button — Sign-in 'Send me a code'",
    fallback: "Send me a code",
    previewPath: "/sign-in",
  },
  {
    key: "btn.signin.verify",
    label: "Button — Sign-in 'Verify & sign in'",
    fallback: "Verify & sign in",
    previewPath: "/sign-in",
  },
  {
    key: "btn.therapist.add_payment",
    label: "Button — Therapist add payment method",
    fallback: "Add payment method & start free trial",
    previewPath: "/therapists/join",
  },
  {
    key: "btn.therapist.skip_payment",
    label: "Button — Therapist skip payment",
    fallback: "I'll do this later",
    previewPath: "/therapists/join",
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
                        <button
                          type="button"
                          onClick={() => {
                            // Build a preview URL with the current draft
                            // (or override) for THIS key only — keeps the
                            // preview focused on what the admin is
                            // actually editing.
                            const payload = encodeURIComponent(
                              btoa(
                                JSON.stringify({
                                  [seed.key]: current,
                                }),
                              ),
                            );
                            const path = seed.previewPath || "/";
                            const sep = path.includes("?") ? "&" : "?";
                            const hashIdx = path.indexOf("#");
                            const url =
                              hashIdx >= 0
                                ? `${path.slice(0, hashIdx)}${sep}preview=${payload}${path.slice(hashIdx)}`
                                : `${path}${sep}preview=${payload}`;
                            window.open(url, "_blank", "noopener");
                          }}
                          disabled={!current.trim()}
                          className="text-[#C87965] hover:underline text-xs inline-flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
                          title={`Open ${seed.previewPath || "/"} in a new tab with this override applied`}
                          data-testid={`copy-preview-${seed.key}`}
                        >
                          <ExternalLink size={11} />
                          Preview
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
