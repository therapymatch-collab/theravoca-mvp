import { useState, useEffect } from "react";
import { Loader2, ExternalLink, CheckCircle2, Clock, Send } from "lucide-react";
import { Input } from "@/components/ui/input";

const MILESTONES = [
  { code: "48h", label: "48-Hour Check-in", days: 2, color: "bg-blue-100 text-blue-700" },
  { code: "3w", label: "3-Week Selection", days: 21, color: "bg-green-100 text-green-700" },
  { code: "9w", label: "9-Week Retention + TAI", days: 63, color: "bg-purple-100 text-purple-700" },
  { code: "15w", label: "15-Week Outcome", days: 105, color: "bg-orange-100 text-orange-700" },
];

export default function FeedbackTestPanel({ client }) {
  const [requests, setRequests] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [rr, fb] = await Promise.all([
          client.get("/admin/requests?limit=50"),
          client.get("/admin/feedback"),
        ]);
        setRequests(rr.data.requests || rr.data || []);
        setFeedback(fb.data.feedback || fb.data || []);
      } catch (e) { console.error("Load failed", e); }
      finally { setLoading(false); }
    })();
  }, [client]);

  const getFeedback = (requestId) => {
    const items = (Array.isArray(feedback) ? feedback : []).filter(
      (f) => f.request_id === requestId
    );
    const ms = {};
    for (const f of items) { if (f.milestone) ms[f.milestone] = f; }
    return ms;
  };

  const triggerEmail = async (requestId, milestone) => {
    setSending(requestId + "_" + milestone);
    try {
      await client.post("/admin/trigger-feedback-email", {
        request_id: requestId, milestone,
      });
    } catch (e) { console.error("trigger failed", e); }
    finally { setSending(null); }
  };

  const filtered = requests.filter((r) => {
    if (!r.results_sent_at) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (r.email || "").toLowerCase().includes(s) ||
      (r.id || "").toLowerCase().includes(s) ||
      (r.location_city || "").toLowerCase().includes(s)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[#6B7280]">
        <Loader2 size={16} className="animate-spin" /> Loading requests...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[#2E4057] mb-1">Feedback Survey Testing</h3>
        <p className="text-sm text-[#6B7280]">
          Open any milestone survey directly to test it. Click the survey link to fill it out, then check results in the Outcome Tracking tab.
        </p>
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email, city, or request ID..." className="max-w-md" />

      <div className="text-xs text-[#6B7280]">Showing {filtered.length} requests with results sent</div>

      <div className="space-y-3">
        {filtered.slice(0, 20).map((r) => {
          const fb = getFeedback(r.id);
          return (
            <div key={r.id} className="border border-[#E8E5DF] rounded-lg p-4 bg-white">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-medium text-[#2E4057]">{r.email || "No email"}</div>
                  <div className="text-xs text-[#6B7280]">
                    {r.location_city}, {r.location_state} &middot; Results sent{" "}
                    {r.results_sent_at ? new Date(r.results_sent_at).toLocaleDateString() : "N/A"}
                  </div>
                  <div className="text-[10px] text-[#C4C0B8] mt-0.5 font-mono">{r.id}</div>
                </div>
              </div>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[#2E4057] mb-1">Feedback Survey Testing</h3>
        <p className="text-sm text-[#6B7280]">
          Open any milestone survey to test it. After submitting, check Outcome Tracking for TAI/reliability score updates.
        </p>
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email, city, or request ID..." className="max-w-md" />

      <div className="text-xs text-[#6B7280]">Showing {filtered.length} requests with results sent</div>

      <div className="space-y-3">
        {filtered.slice(0, 20).map((r) => {
          const fb = getFeedback(r.id);
          return (
            <div key={r.id} className="border border-[#E8E5DF] rounded-lg p-4 bg-white">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-medium text-[#2E4057]">{r.email || "No email"}</div>
                  <div className="text-xs text-[#6B7280]">
                    {r.location_city}, {r.location_state}
                  </div>
                  <div className="text-[10px] text-[#C4C0B8] mt-0.5 font-mono">{r.id}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {MILESTONES.map((m) => {
                  const done = !!fb[m.code];
                  return (
                    <div key={m.code} className={`rounded-lg border p-3 ${done ? "border-green-200 bg-green-50" : "border-[#E8E5DF] bg-[#FAFAF8]"}`}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.color}`}>{m.code}</span>
                        {done ? <CheckCircle2 size={14} className="text-green-600" /> : <Clock size={14} className="text-[#C4C0B8]" />}
                      </div>
                      <div className="text-xs text-[#6B7280] mb-2">{m.label}</div>
                      <div className="flex gap-1.5">
                        <a href={`/feedback/${r.id}/${m.code}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2E4057] text-white rounded text-[11px] font-medium hover:bg-[#1a2a3a]">
                          <ExternalLink size={11} />{done ? "View" : "Take Survey"}
                        </a>
                        <button onClick={() => triggerEmail(r.id, m.code)}
                          disabled={sending === r.id + "_" + m.code}
                          className="flex items-center gap-1 px-2.5 py-1.5 border border-[#E8E5DF] rounded text-[11px] font-medium text-[#6B7280] hover:bg-[#F5F3EF] disabled:opacity-50">
                          {sending === r.id + "_" + m.code ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          Email
                        </button>
                      </div>
                      {done && fb[m.code].submitted_at && (
                        <div className="text-[10px] text-green-600 mt-1.5">Done {new Date(fb[m.code].submitted_at).toLocaleDateString()}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-[#6B7280] text-sm">No patient requests with results found. Run some test simulations first.</div>
      )}
    </div>
  );
}
