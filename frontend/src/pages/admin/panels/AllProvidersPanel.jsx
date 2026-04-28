import { Th } from "./_shared";

// "All providers" tab — paginated, column-customizable table of every
// approved therapist. The ProviderTableControls / ProviderRow /
// ProviderTablePager / PROVIDER_COLUMNS registry still live in
// AdminDashboard.jsx because they're tightly coupled to the column-prefs
// hook and the edit modal — we just slot them in here.
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
  onArchive,
  onRestore,
  onDelete,
}) {
  const filtered = showOnlyReapproval
    ? filteredAllTherapists.filter((t) => t.pending_reapproval)
    : filteredAllTherapists;
  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <ProviderTableControls
        total={allTherapists.length}
        visibleTotal={filtered.length}
        showOnlyReapproval={showOnlyReapproval}
        setShowOnlyReapproval={setShowOnlyReapproval}
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
                  onArchive={() => onArchive(t)}
                  onRestore={() => onRestore(t)}
                  onDelete={() => onDelete(t)}
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
