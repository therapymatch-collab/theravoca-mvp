import { createContext, useContext, useMemo } from "react";
import { adminClient } from "@/lib/api";

// AdminClientContext + useAdminClient — single source of truth for the
// authenticated admin axios client.
//
// Background: in iter99 we shipped a CoverageGapPanel bug where the
// panel had been written to call `api.get("/admin/...")` (the *bare*
// axios instance, no auth headers) instead of the parent-injected
// `client.get(...)`. The 401 went unnoticed because the panel
// soft-failed. This context fixes that whole class of bug — any nested
// admin component can pull a guaranteed-authenticated client without
// the parent having to remember to thread it down.
//
// Usage:
//   - At the top of AdminDashboard:
//       <AdminClientProvider password={pwd}>
//         {/* tree */}
//       </AdminClientProvider>
//   - Inside any nested admin panel:
//       const client = useAdminClient();
//       client.get("/admin/foo").then(...)
//
// `useAdminClient` is also exported as a fallback that accepts an
// explicit password — handy for legacy callsites we haven't migrated
// yet, or for tests that need to inject a specific identity.

const AdminClientContext = createContext(null);

export function AdminClientProvider({ password, children }) {
  // Memoize so we don't churn axios instances on every render; the
  // underlying `adminClient(password)` reads sessionStorage tokens too,
  // so we depend only on the explicit password here. If the admin
  // logs out (clears sessionStorage), the parent re-mounts.
  const client = useMemo(() => adminClient(password), [password]);
  return (
    <AdminClientContext.Provider value={client}>
      {children}
    </AdminClientContext.Provider>
  );
}

export default function useAdminClient(fallbackPassword) {
  const ctx = useContext(AdminClientContext);
  // Always-call hook, conditional value: if a context is present use
  // it; otherwise build a fresh client from the fallback password.
  // Memoized so callers can include the returned client in deps lists
  // safely.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fallback = useMemo(
    () => (ctx ? null : adminClient(fallbackPassword)),
    [ctx, fallbackPassword],
  );
  return ctx || fallback;
}
