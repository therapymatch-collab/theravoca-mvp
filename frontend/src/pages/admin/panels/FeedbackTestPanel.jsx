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
  const [sending, setSending] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [reqRes, fbRes] = await Promise.all([
          client.get("/admin/requests?limit=50"),
          client.get("/admin/feedback"),
        ]);
        setRequests((reqRes.data || []).filter((r) => r.results_sent_at));
        setFeedback(fbRes.data || []);
      } catch (e) {
        console.error("FeedbackTestPanel load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  const getFeedback = (requestId) => {
    const map = {};
    feedback.filter((f) => f.request_id === requestId).forEach((f) => { map[f.milestone] = f; });
    return map;
  };

  const triggerEmail = async (requestId, milestone) => {
    const key = requestId + "_" + milestone;
    setSending((s) => ({ ...s, [key]: true }));
    try {
      await client.post("/admin/trigger-feedback-email", { request_id: requestId, milestone });
    } catch (e) {
      console.error("Trigger error:", e);
    } finally {
      setSending((s) => ({ ...s, [key]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[#6B7280]">
        <Loader2 size={16} className="animate-spin" /> Loading requests...
      </div>
    );
  }

  const filtered = requests.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.email || "").toLowerCase().includes(q) ||
      (r.location_city || "").toLowerCase().includes(q) ||
      (r.id || "").toLowerCase().includes(q);
  });

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
                    {r.location_city}, {r.location_state} &middot; Sent {new Date(r.results_sent_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-xs text-[#9CA3AF] font-mono">{(r.id || "").slice(0, 8)}</div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {MILESTONES.map((m) => {
                  const done = fb[m.code];
                  const key = r.id + "_" + m.code;
                  return (
                    <div key={m.code} className="border border-[#E8E5DF] rounded p-2 text-center">
                      <div className={"text-xs font-medium px-1 py-0.5 rounded mb-1 " + m.color}>
                        {m.label}
                      </div>
                      {done ? (
                        <div className="flex items-center justify-center gap-1 text-green-600 text-xs">
                          <CheckCircle2 size={12} /> Done
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 text-[#9CA3AF] text-xs">
                          <Clock size={12} /> Pending
                        </div>
                      )}
                      <div className="flex gap-1 mt-1 justify-center">
                        <a
                          href={"/feedback/" + r.id + "/" + m.code}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[#3B82F6] hover:underline flex items-center gap-0.5"
                        >
                          <ExternalLink size={10} /> Take Survey
                        </a>
                        <button
                          onClick={() => triggerEmail(r.id, m.code)}
                          disabled={sending[key]}
                          className="text-[10px] text-[#6B7280] hover:text-[#2E4057] flex items-center gap-0.5 disabled:opacity-50"
                        >
                          <Send size={10} /> {sending[key] ? "..." : "Email"}
                        </button>
                      </div>
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
