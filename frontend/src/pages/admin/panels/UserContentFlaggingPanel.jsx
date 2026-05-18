/**
 * UserContentFlaggingPanel
 *
 * Admin > Content > "User Content Flagging" chip.
 *
 * 2026-05-17 (Josh, after p3_resonance miss): "what's the rule for
 * bad content flagging? add it under 'content' in admin as 'User
 * Content Flagging' -- how does it show up in requests and
 * therapist signups?"
 *
 * Three sections:
 *   1. Rules -- what the validator checks for + the user-facing
 *      message shown on rejection.
 *   2. Protected fields -- which routes + fields the validator is
 *      wired into. Single source of truth: if a field doesn't show
 *      up here, it isn't being moderated.
 *   3. Recent rejections (last 100) -- what actually got blocked
 *      recently, grouped by category + route, with full text
 *      snippets so admin can spot abuse patterns and tune the
 *      wordlist.
 *
 * Read-only. To change the rules edit `backend/text_moderation.py`;
 * to add a new protected field add a call to `validate_or_raise()`
 * in the route handler AND a matching entry to
 * `_MODERATION_FIELDS_CATALOG` in `backend/routes/admin.py`.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, Filter, Inbox, Loader2,
  ShieldAlert, ShieldCheck, FileText,
} from "lucide-react";
import useAdminClient from "@/lib/useAdminClient";

const CATEGORY_META = {
  profanity_or_sexualized: { label: "Profanity / sexualized", tone: "bad" },
  gibberish_repeated_chars: { label: "Gibberish", tone: "bad" },
  all_caps_shouting: { label: "All-caps shouting", tone: "mild" },
  url_spam: { label: "URL / link spam", tone: "bad" },
  too_short: { label: "Too short", tone: "mild" },
  too_long: { label: "Too long", tone: "mild" },
  missing_required: { label: "Missing required", tone: "mild" },
  other: { label: "Other", tone: "mild" },
};

export default function UserContentFlaggingPanel() {
  const client = useAdminClient();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .get("/admin/content-moderation?limit=200")
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail || "Failed to load content-moderation data");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#6D6A65] py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading content moderation log...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 text-sm text-[#8B3220] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-4 py-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!data) return null;

  const filtered = categoryFilter
    ? (data.recent_rejections || []).filter((r) => r.category === categoryFilter)
    : (data.recent_rejections || []);

  return (
    <div className="max-w-5xl space-y-8" data-testid="user-content-flagging-panel">
      {/* Header */}
      <header className="space-y-2">
        <h2 className="font-serif-display text-3xl text-[#2D4A3E]">
          User content flagging
        </h2>
        <p className="text-sm text-[#6D6A65] leading-relaxed max-w-3xl">
          Every patient + therapist free-text field is validated
          server-side before any DB write. Rejected submissions get a
          400 with a user-facing error; nothing persists. This panel
          shows the rules, where they apply, and what actually got
          blocked recently.
        </p>
      </header>

      {/* 30-day summary chips */}
      <section className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#2D4A3E]">
          <ShieldAlert size={16} />
          Last 30 days: {data.summary?.total_last_30_days || 0} rejections
        </div>
        <div className="flex flex-wrap gap-2">
          <CategoryChip
            label="All"
            count={data.summary?.total_last_30_days || 0}
            active={!categoryFilter}
            onClick={() => setCategoryFilter("")}
          />
          {Object.entries(data.summary?.by_category || {}).map(([cat, count]) => (
            <CategoryChip
              key={cat}
              label={CATEGORY_META[cat]?.label || cat}
              count={count}
              tone={CATEGORY_META[cat]?.tone}
              active={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat === categoryFilter ? "" : cat)}
            />
          ))}
        </div>
        {(data.summary?.by_route || []).length > 0 && (
          <div className="pt-2 border-t border-[#E8E5DF] mt-2">
            <div className="text-xs uppercase tracking-wide text-[#6D6A65] mb-2">
              By route (last 30 days)
            </div>
            <ul className="text-sm text-[#2B2A29] space-y-1">
              {data.summary.by_route.slice(0, 8).map((r, i) => (
                <li key={r.route + i} className="flex items-baseline gap-2">
                  <code className="text-xs bg-white border border-[#E8E5DF] rounded px-1.5 py-0.5">
                    {r.route}
                  </code>
                  <span className="text-[#6D6A65]">{r.count} rejection{r.count === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Rules */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-[#2D4A3E]" />
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Rules ({data.wordlist_size}-word profanity list)
          </h3>
        </div>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          Each rule below maps to a category in the rejection log. To
          change a rule edit{" "}
          <code className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1 py-0.5">
            backend/text_moderation.py
          </code>.
        </p>
        <div className="space-y-3">
          {(data.rules || []).map((rule) => (
            <article
              key={rule.category}
              className="bg-white border border-[#E8E5DF] rounded-xl p-4"
              data-testid={`rule-${rule.category}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-[#2D4A3E]">{rule.title}</h4>
                <code className="text-[10px] bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5 text-[#6D6A65]">
                  {rule.category}
                </code>
              </div>
              <p className="text-sm text-[#2B2A29] leading-relaxed mb-2">
                {rule.description}
              </p>
              <p className="text-xs text-[#6D6A65] italic">
                Shown to user: "{rule.user_facing_message}"
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Protected fields */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-[#2D4A3E]" />
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Protected fields ({(data.fields_protected || []).length})
          </h3>
        </div>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          Every free-text field below runs the full ruleset on
          submit. Fields NOT in this list are unmoderated.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white border border-[#E8E5DF] rounded-xl">
            <thead>
              <tr className="text-left border-b border-[#E8E5DF] text-xs uppercase tracking-wide text-[#6D6A65]">
                <th className="py-2 px-3 font-semibold">Field</th>
                <th className="py-2 px-3 font-semibold">Route</th>
                <th className="py-2 px-3 font-semibold">Actor</th>
                <th className="py-2 px-3 font-semibold">Limits</th>
              </tr>
            </thead>
            <tbody className="text-[#2B2A29]">
              {(data.fields_protected || []).map((f, i) => (
                <tr key={f.field + i} className="border-b border-[#E8E5DF]/60 last:border-b-0 align-top">
                  <td className="py-3 px-3 align-top">
                    <code className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5">
                      {f.field}
                    </code>
                    <p className="text-xs text-[#6D6A65] mt-1 leading-tight">{f.description}</p>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <code className="text-xs text-[#6D6A65]">{f.route}</code>
                  </td>
                  <td className="py-3 px-3 align-top text-xs text-[#6D6A65]">{f.actor}</td>
                  <td className="py-3 px-3 align-top text-xs whitespace-nowrap text-[#6D6A65]">
                    {f.min_length ? `${f.min_length}-` : ""}
                    {f.max_length || "—"} chars
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent rejections */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Inbox size={18} className="text-[#2D4A3E]" />
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Recent rejections {categoryFilter && (
              <span className="text-base text-[#6D6A65] font-normal">
                · filtered to {CATEGORY_META[categoryFilter]?.label || categoryFilter}
              </span>
            )}
          </h3>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-[#6D6A65] italic bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4">
            {categoryFilter
              ? `No rejections in this category yet.`
              : `No rejections logged yet. The moderation log is populated when a user submission gets blocked.`}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r, i) => (
              <article
                key={r.rejected_at + i}
                className="bg-white border border-[#E8E5DF] rounded-xl p-4"
                data-testid={`rejection-${i}`}
              >
                <header className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CategoryChip
                      label={CATEGORY_META[r.category]?.label || r.category}
                      tone={CATEGORY_META[r.category]?.tone}
                    />
                    <code className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5">
                      {r.field_name}
                    </code>
                    {r.route && (
                      <code className="text-xs text-[#6D6A65]">{r.route}</code>
                    )}
                  </div>
                  <div className="text-xs text-[#6D6A65] flex items-center gap-1 whitespace-nowrap">
                    <Clock size={12} />
                    {formatTs(r.rejected_at)}
                  </div>
                </header>
                {r.actor_email && (
                  <p className="text-xs text-[#6D6A65] mb-2">
                    Actor: <span className="font-mono">{r.actor_email}</span>
                  </p>
                )}
                <blockquote className="text-sm bg-[#FBE9E5] border-l-2 border-[#C87965] pl-3 py-2 italic text-[#2B2A29] mb-2 break-words">
                  "{r.text_snippet}"
                </blockquote>
                <p className="text-xs text-[#6D6A65]">{r.error_message}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryChip({ label, count, tone, active, onClick }) {
  const toneClasses =
    tone === "bad"
      ? "bg-[#FBE9E5] border-[#F4C7BE] text-[#8B3220]"
      : tone === "mild"
        ? "bg-[#FBF3E5] border-[#E8DAB8] text-[#7A5A1F]"
        : "bg-[#FDFBF7] border-[#E8E5DF] text-[#2D4A3E]";
  const activeClasses = active ? "ring-2 ring-[#2D4A3E] ring-offset-1" : "";
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs ${toneClasses} ${activeClasses} rounded-full px-2.5 py-1 whitespace-nowrap ${onClick ? "hover:opacity-90 cursor-pointer" : ""}`}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span className="font-semibold">{count}</span>
      )}
    </Component>
  );
}

function formatTs(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
