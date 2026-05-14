import { useState } from "react";
import { Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Th } from "./_shared";
import { sessionClient, getSession } from "@/lib/api";

export default function OptOutsPanel({ data, loading, onReload, filter }) {
  const rows = data?.opt_outs || [];
  const [removingKey, setRemovingKey] = useState(null);
  const session = getSession();
  const client = sessionClient(session?.token);

  const q = (filter || "").trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          (r.email || "").toLowerCase().includes(q) ||
          (r.phone || "").toLowerCase().includes(q) ||
          (r.last_source || "").toLowerCase().includes(q),
      )
    : rows;

  const handleRemove = async (row) => {
    const label = row.email || row.phone || "this opt-out";
    if (!window.confirm(
      `Remove opt-out for ${label}?\n\n` +
      "They'll be eligible for cold outreach again. Use this for test " +
      "addresses that clicked unsubscribe by mistake, or for therapists " +
      "who emailed asking to be put back on the list."
    )) return;
    const key = `${row.email || ""}::${row.phone || ""}`;
    setRemovingKey(key);
    try {
      const params = new URLSearchParams();
      if (row.email) params.set("email", row.email);
      if (row.phone) params.set("phone", row.phone);
      await client.delete(`/admin/outreach/opt-outs?${params.toString()}`);
      toast.success(`Removed opt-out for ${label}`);
      onReload?.();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || "Couldn't remove opt-out",
      );
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden" data-testid="opt-outs-panel">
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF]">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Outreach opt-outs
          </h3>
          <p className="text-sm text-[#6D6A65] mt-1">
            Therapists who clicked "Unsubscribe" in a recruitment email or replied STOP to an SMS.
            These contacts are automatically skipped on future outreach runs.
          </p>
        </div>
        <button
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
          data-testid="opt-outs-reload"
        >
          <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {loading && rows.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin inline" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          {q ? "No opt-outs match your search." : "No opt-outs yet. Nice — nobody has asked to be removed from outreach."}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-[#6D6A65]">
            <tr className="text-left">
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Source</Th>
              <Th>Opted out</Th>
              <Th>Reason</Th>
              <Th>Linked to invite</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, idx) => {
              const rowKey = `${r.email || ""}::${r.phone || ""}`;
              const isRemoving = removingKey === rowKey;
              return (
              <tr
                key={`${r.email || ""}-${r.phone || ""}-${idx}`}
                className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7]"
                data-testid={`opt-out-row-${idx}`}
              >
                <td className="p-4 text-[#2B2A29] break-all">{r.email || <span className="text-[#C8C4BB]">—</span>}</td>
                <td className="p-4 text-[#2B2A29] whitespace-nowrap">{r.phone || <span className="text-[#C8C4BB]">—</span>}</td>
                <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                  {(r.last_source || "manual").replace(/_/g, " ")}
                </td>
                <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                  {r.last_opted_out_at ? new Date(r.last_opted_out_at).toLocaleString() : "—"}
                </td>
                <td className="p-4 text-xs text-[#2B2A29]">{r.last_reason || <span className="text-[#C8C4BB]">—</span>}</td>
                <td className="p-4 text-xs text-[#6D6A65] font-mono break-all">
                  {r.last_invite_id ? r.last_invite_id.slice(0, 8) + "…" : "—"}
                </td>
                <td className="p-4 text-right whitespace-nowrap">
                  <button
                    onClick={() => handleRemove(r)}
                    disabled={isRemoving}
                    className="inline-flex items-center gap-1 text-xs text-[#8B3220] hover:text-[#6E2618] disabled:opacity-40"
                    title="Remove opt-out — therapist becomes eligible for cold outreach again"
                    data-testid={`opt-out-remove-${idx}`}
                  >
                    {isRemoving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
