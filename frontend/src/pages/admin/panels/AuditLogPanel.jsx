import { useState, useEffect, useCallback } from "react";
import { Loader2, RotateCw } from "lucide-react";

const ACTOR_TYPES = ["admin", "therapist", "patient", "anonymous", "system"];

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hour12: false,
    });
  } catch {
    return iso;
  }
}

export default function AuditLogPanel({ client }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const [filterActor, setFilterActor] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async (lim, actor, action) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(lim));
      if (actor) params.set("actor_type", actor);
      if (action) params.set("action", action);
      const res = await client.get(`/admin/audit-log?${params}`);
      setEntries(res.data?.entries || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    load(limit, filterActor, filterAction);
  }, [load, limit, filterActor, filterAction]);

  const actions = [...new Set(entries.map((e) => e.action).filter(Boolean))].sort();

  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF] flex-wrap">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Audit Log</h3>
          <p className="text-sm text-[#6D6A65] mt-1">
            HIPAA PHI access trail — {entries.length} entries
          </p>
        </div>
        <button
          onClick={() => load(limit, filterActor, filterAction)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[#E8E5DF] rounded-lg hover:bg-[#F5F3EF] transition"
        >
          <RotateCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E8E5DF] bg-[#FDFBF7] flex-wrap">
        <label className="text-xs text-[#6D6A65] font-medium">Actor type</label>
        <select
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          className="text-sm border border-[#E8E5DF] rounded-lg px-2 py-1 bg-white"
        >
          <option value="">All</option>
          {ACTOR_TYPES.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <label className="text-xs text-[#6D6A65] font-medium ml-2">Action</label>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="text-sm border border-[#E8E5DF] rounded-lg px-2 py-1 bg-white"
        >
          <option value="">All</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-[#6D6A65]">
          <Loader2 className="animate-spin mr-2" size={18} /> Loading audit log...
        </div>
      )}

      {error && (
        <div className="px-5 py-4 text-sm text-[#D45D5D]">{error}</div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-[#6D6A65]">
          No audit entries found.
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E5DF] bg-[#FDFBF7] text-left text-xs text-[#6D6A65] uppercase tracking-wide">
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Actor ID</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Resource</th>
                <th className="px-4 py-2.5">Resource ID</th>
                <th className="px-4 py-2.5">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[#F0EDE8] hover:bg-[#FDFBF7] transition">
                  <td className="px-4 py-2 text-[#6D6A65] whitespace-nowrap font-mono text-xs">{fmtTs(e.ts)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      e.actor_type === "admin" ? "bg-[#FBE9E6] text-[#C8412B]" :
                      e.actor_type === "therapist" ? "bg-[#FBF2E8] text-[#B8742A]" :
                      e.actor_type === "patient" ? "bg-[#F2F4F0] text-[#2D4A3E]" :
                      e.actor_type === "system" ? "bg-[#EDE8F5] text-[#5B4A8A]" :
                      "bg-[#F0EDE8] text-[#6D6A65]"
                    }`}>
                      {e.actor_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#6D6A65] max-w-[180px] truncate" title={e.actor_id}>
                    {e.actor_id}
                  </td>
                  <td className="px-4 py-2 font-medium text-[#2B2A29]">{e.action}</td>
                  <td className="px-4 py-2 text-[#6D6A65]">{e.resource}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[#6D6A65] max-w-[140px] truncate" title={e.resource_id}>
                    {e.resource_id || "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#6D6A65]">{e.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && entries.length >= limit && (
        <div className="flex justify-center py-4 border-t border-[#E8E5DF]">
          <button
            onClick={() => setLimit((l) => l + 100)}
            className="text-sm text-[#2D4A3E] font-medium hover:underline"
          >
            Load more (showing {entries.length})
          </button>
        </div>
      )}
    </div>
  );
}
