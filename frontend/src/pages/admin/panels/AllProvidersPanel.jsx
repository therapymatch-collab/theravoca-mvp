import { useMemo, useState } from "react";
import { Th } from "./_shared";

// "All providers" tab — paginated, column-customizable table of every
// approved therapist. The ProviderTableControls / ProviderRow /
// ProviderTablePager / PROVIDER_COLUMNS registry still live in
// AdminDashboard.jsx because they're tightly coupled to the column-prefs
// hook and the edit modal — we just slot them in here.
//
// Multi-state filter (added 2026-05-15) replaces the older "Active only"
// checkbox. The states map directly to therapist invariants the matcher
// honours, so an admin can answer "who would actually show up in
// patient match results today?" with one click.
const STATE_FILTERS = [
  {
    key: "match_ready",
    label: "Match-ready",
    blurb: "Surfacing in patient matches now",
    title: "Passes every gate: is_active + approved + billable subscription (trialing/active) + valid license + complete profile. These are the therapists who would actually be returned by the matcher right now.",
    test: (t) => t.match_ready === true,
  },
  {
    key: "active",
    label: "Active (any)",
    blurb: "is_active flag on, even if blocked",
    title: "is_active != false. A broader bucket than Match-ready -- includes therapists who are technically active but failing other gates (no license, no payment, etc).",
    test: (t) => t.is_active !== false,
  },
  {
    key: "pending",
    label: "Pending approval",
    blurb: "Awaiting first-time admin review",
    title: "New signups + backfilled rows that haven't been admin-approved yet. They don't appear in matches until you approve them.",
    test: (t) => t.pending_approval === true,
  },
  {
    key: "reapproval",
    label: "Needs re-review",
    blurb: "Edited license/specialty post-approval",
    title: "Therapist edited a sensitive field (license, specialties, name, credential, gender) after their initial approval. The change is staged but won't go live to patients until you re-approve.",
    test: (t) => !!t.pending_reapproval,
  },
  {
    key: "incomplete",
    label: "Active but blocked",
    blurb: "Look active, invisible to matching",
    title: "Active (is_active=true) and approved, but failing one or more match-ready gates -- license expired, no payment method, missing required profile fields, etc. The surprise bucket: these therapists' status pill says 'active' but they don't appear in matches.",
    test: (t) =>
      t.is_active !== false &&
      t.pending_approval !== true &&
      t.match_ready === false,
  },
  {
    key: "archived",
    label: "Archived",
    blurb: "Rejected or admin-archived",
    title: "is_active = false. Either admin-archived or never approved out of pending. Excluded from matching, recruitment, and the daily Active view.",
    test: (t) => t.is_active === false,
  },
  {
    key: "all",
    label: "All",
    blurb: "Every row, no filter",
    title: "Show every therapist regardless of state.",
    test: () => true,
  },
];

export default function AllProvidersPanel({
  allTherapists,
  filteredAllTherapists,
  showOnlyReapproval,
  setShowOnlyReapproval,
  providerPageSize,
  setProviderPageSize,
  providerPage,
  setProviderPage,
  visibleCols,
  setVisibleCols,
  defaultCols,
  setDefaultCols,
  PROVIDER_COLUMNS,
  ProviderTableControls,
  ProviderRow,
  ProviderTablePager,
  onEdit,
  onPreview,
  onArchive,
  onRestore,
  onDelete,
  onDeepResearch,
  onFireTestSurvey,
  onMarkTestAccount,
  onUnmarkTestAccount,
  onBulkMarkIncompleteAsTest,
}) {
  // Defaults to "match_ready" -- the most useful daily view for ops.
  // Persisted per-browser so an admin who prefers a different starting
  // state doesn't have to re-click on every page load.
  const [stateFilter, setStateFilter] = useState(() => {
    try {
      const raw = localStorage.getItem("tv_admin_provider_state_filter");
      if (raw && STATE_FILTERS.some((f) => f.key === raw)) return raw;
    } catch { /* ignore */ }
    return "match_ready";
  });
  const setStateFilterPersist = (key) => {
    setStateFilter(key);
    setProviderPage(0);
    try {
      localStorage.setItem("tv_admin_provider_state_filter", key);
    } catch { /* ignore */ }
  };

  // Counts per state (operates on the parent-filtered list -- so the
  // search box upstream still narrows everything below). Memoised so we
  // don't recount on every keystroke.
  const stateCounts = useMemo(() => {
    const counts = {};
    for (const f of STATE_FILTERS) {
      counts[f.key] = filteredAllTherapists.filter(f.test).length;
    }
    return counts;
  }, [filteredAllTherapists]);

  // Aggregate per-blocker breakdown across all therapists. Surfaces
  // "why is everyone failing?" -- if Match-ready=0 you can see at a
  // glance whether it's pending_approval (admin needs to approve) or
  // license errors or sub issues. Each blocker is bucketed by its
  // category prefix (e.g. "subscription:incomplete" -> "subscription").
  const blockerBreakdown = useMemo(() => {
    const counts = {};
    for (const t of filteredAllTherapists) {
      for (const b of (t.match_ready_blockers || [])) {
        const cat = String(b).split(":", 1)[0];
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredAllTherapists]);

  const activeFilter =
    STATE_FILTERS.find((f) => f.key === stateFilter) || STATE_FILTERS[0];
  const filtered = filteredAllTherapists.filter(activeFilter.test);

  // Keep the old `showOnlyReapproval` prop wired so other panels that
  // toggle it (recruit cards, master query) still work, but the chip in
  // ProviderTableControls becomes redundant -- we fold it into the
  // multi-state row above. Force it off whenever the segmented filter
  // is active so the two filters don't multiply.
  if (showOnlyReapproval) {
    // Defer to after-render -- React state updaters are safe here because
    // the parent's setShowOnlyReapproval is stable.
    setTimeout(() => setShowOnlyReapproval(false), 0);
  }

  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      {/* Multi-state filter row -- segmented control style. Each chip
          shows its live count + a one-line description below so the
          admin doesn't have to hover/tooltip-hunt to know what's in
          each bucket. The "Active but blocked" chip turns amber when
          non-zero -- that's the bucket that surprises admins. */}
      <div
        className="px-4 pt-4 flex items-center gap-2 flex-wrap"
        data-testid="provider-state-filter"
      >
        {STATE_FILTERS.map((f) => {
          const selected = f.key === stateFilter;
          const count = stateCounts[f.key] ?? 0;
          const isAlertChip = f.key === "incomplete" && count > 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStateFilterPersist(f.key)}
              title={f.title}
              data-testid={`state-filter-${f.key}`}
              className={`text-left px-3 py-1.5 rounded-xl border transition leading-tight ${
                selected
                  ? "bg-[#2D4A3E] border-[#2D4A3E] text-white"
                  : isAlertChip
                  ? "bg-[#FBF2E8] border-[#F0DEC8] text-[#B8742A] hover:border-[#B8742A]"
                  : "bg-white border-[#E8E5DF] text-[#6D6A65] hover:border-[#2D4A3E]"
              }`}
            >
              <div className="text-xs font-medium flex items-center gap-1.5">
                <span>{f.label}</span>
                <span
                  className={`text-[10px] ${
                    selected ? "opacity-90" : "opacity-70"
                  }`}
                >
                  ({count})
                </span>
              </div>
              <div
                className={`text-[10px] mt-0.5 ${
                  selected ? "text-white/80" : "text-[#A4A29E]"
                }`}
              >
                {f.blurb}
              </div>
            </button>
          );
        })}
      </div>
      {/* Per-blocker breakdown: only renders when there's at least
          one blocker (i.e. not everyone is match-ready). Answers
          "why is no one match-ready?" without making the admin
          hover every row's tooltip. Each pill is a category name +
          count of therapists tripping that gate. */}
      {blockerBreakdown.length > 0 && (
        <div
          className="px-4 pt-3 flex items-center gap-2 flex-wrap text-[11px] text-[#6D6A65]"
          data-testid="match-ready-blocker-breakdown"
        >
          <span className="font-semibold uppercase tracking-wider text-[10px]">
            Blocked by:
          </span>
          {blockerBreakdown.map(([cat, n]) => (
            <span
              key={cat}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#FDF1EF] border border-[#E8C4BB] text-[#8B3220]"
              title={`${n} therapist${n === 1 ? "" : "s"} blocked by ${cat.replace(/_/g, " ")}`}
            >
              <span>{cat.replace(/_/g, " ")}</span>
              <span className="font-semibold">{n}</span>
            </span>
          ))}
          {/* Test-mode bulk action (2026-05-18) -- only render when
              the "incomplete subscription" gate is what's blocking
              therapists. One click flips all of them to fake-trialing
              test accounts so Josh's QA loop unblocks. Action is
              destructive-ish (writes to many rows) so the handler
              double-confirms first. */}
          {onBulkMarkIncompleteAsTest && blockerBreakdown.some(([cat]) => cat === "subscription") && (
            <button
              type="button"
              onClick={onBulkMarkIncompleteAsTest}
              className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#2D4A3E] text-white text-[11px] font-semibold hover:bg-[#3A5E50]"
              title="Bulk-mark every subscription-blocked therapist as a TEST account so they pass the matching filter without going through Stripe. For testing only."
              data-testid="bulk-mark-test-accounts"
            >
              Bulk mark as test
            </button>
          )}
        </div>
      )}
      <ProviderTableControls
        total={allTherapists.length}
        visibleTotal={filtered.length}
        showOnlyReapproval={false}
        setShowOnlyReapproval={() => {}}
        pageSize={providerPageSize}
        setPageSize={setProviderPageSize}
        page={providerPage}
        setPage={setProviderPage}
        pendingCount={
          allTherapists.filter((t) => t.pending_reapproval).length
        }
        visibleCols={visibleCols}
        setVisibleCols={setVisibleCols}
        defaultCols={defaultCols}
        setDefaultCols={setDefaultCols}
      />
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          data-testid="all-therapists-table"
        >
          <thead className="bg-[#FDFBF7] text-[#6D6A65]">
            <tr className="text-left">
              {PROVIDER_COLUMNS.filter((c) =>
                visibleCols.includes(c.key),
              ).map((c) => (
                <Th key={c.key}>{c.label}</Th>
              ))}
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {allTherapists.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length + 1}
                  className="p-10 text-center text-[#6D6A65]"
                >
                  No providers in the directory yet.
                </td>
              </tr>
            )}
            {allTherapists.length > 0 && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length + 1}
                  className="p-10 text-center text-[#6D6A65]"
                  data-testid="state-filter-empty"
                >
                  No therapists match the "{activeFilter.label}" filter.
                </td>
              </tr>
            )}
            {filtered
              .slice(
                providerPage * providerPageSize,
                providerPage * providerPageSize + providerPageSize,
              )
              .map((t) => (
                <ProviderRow
                  key={t.id}
                  t={t}
                  onEdit={() => onEdit(t)}
                  onPreview={onPreview}
                  onArchive={() => onArchive(t)}
                  onRestore={() => onRestore(t)}
                  onDelete={() => onDelete(t)}
                  onDeepResearch={
                    onDeepResearch ? () => onDeepResearch(t) : undefined
                  }
                  onFireTestSurvey={onFireTestSurvey}
                  onMarkTestAccount={
                    onMarkTestAccount && !t.is_test_account
                      ? () => onMarkTestAccount(t)
                      : undefined
                  }
                  onUnmarkTestAccount={
                    onUnmarkTestAccount && t.is_test_account
                      ? () => onUnmarkTestAccount(t)
                      : undefined
                  }
                  visibleCols={visibleCols}
                />
              ))}
          </tbody>
        </table>
      </div>
      <ProviderTablePager
        total={filtered.length}
        pageSize={providerPageSize}
        page={providerPage}
        setPage={setProviderPage}
      />
    </div>
  );
}
