// Shared bits used by multiple admin panels. Keeping the export surface
// tiny so panels stay decoupled from `AdminDashboard.jsx`.
export function Th({ children }) {
  return (
    <th className="p-4 font-medium text-xs uppercase tracking-wider">{children}</th>
  );
}
