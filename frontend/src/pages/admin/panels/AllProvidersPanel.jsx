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
    title: "Therapists who would surface in patient matches RIGHT NOW (passes is_active + approved + billable subscription + valid license + complete profile).",
    test: (t) => t.match_ready === true,
  },
  {
    key: "active",
    label: "Active (any)",
    title: "is_active != false. Includes pending-approval, missing-license, etc -- broader than match-ready.",
    test: (t) => t.is_active !== false,
  },
  {
    key: "pending",
    label: "Pending approval",
    title: "Awaiting admin review.",
    test: (t) => t.pending_approval === true,
  },
  {
    key: "reapproval",
    label: "Needs re-review",
    title: "Therapist edited a sensitive field after approval; admin must re-approve before the change goes live.",
    test: (t) => !!t.pending_reapproval,
  },
  {
    key: "incomplete",
    label: "Active but blocked",
    title: "Active and approved, but failing one or more match-ready gates (license expired, no payment method, missing required profile fields, etc). These won't surface in matches even though their status pill says 'active'.",
    test: (t) =>
      t.is_active !== false &&
      t.pending_approval !== true &&
      t.match_ready === false,
  },
  {
    key: "archived",
    label: "Archived",
    title: "is_active = false (rejected or admin-archived).",
    test: (t) => t.is_active === false,
  },
  {
    key: "all",
    label: "All",
    title: "Every therapist, no filter.",
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
          shows its live count so an admin can spot anomalies at a glance
          (e.g. "Active but blocked: 12" means a dozen therapists look
          active but won't surface in matches). */}
      <div
        className="px-4 pt-4 flex items-center gap-2 flex-wrap"
        data-testid="provider-state-filter"
      >
        {STATE_FILTERS.map((f) => {
          const selected = f.key === stateFilter;
          const count = stateCounts[f.key] ?? 0;
          // Visual emphasis for the "Active but blocked" chip when it's
          // non-zero -- that's the bucket that surprises admins.
          const isAlertChip = f.key === "incomplete" && count > 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStateFilterPersist(f.key)}
              title={f.title}
              data-testid={`state-filter-${f.key}`}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                selected
                  ? "bg-[#2D4A3E] border-[#2D4A3E] text-white"
                  : isAlertChip
                  ? "bg-[#FBF2E8] border-[#F0DEC8] text-[#B8742A] hover:border-[#B8742A]"
                  : "bg-white border-[#E8E5DF] text-[#6D6A65] hover:border-[#2D4A3E]"
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 text-[10px] ${
                  selected ? "opacity-90" : "opacity-70"
                }`}
              >
                ({count})
              </span>
            </button>
          );
        })}
      </div>
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
