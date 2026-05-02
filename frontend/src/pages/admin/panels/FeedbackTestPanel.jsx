import { useState, useEffect } from "react";
import { Loader2, ExternalLink, CheckCircle2, Clock, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import useAdminClient from "@/lib/useAdminClient";
import { toast } from "sonner";

const MILESTONES = [
  { code: "48h", label: "48-Hour Check-in", days: 2, color: "bg-blue-100 text-blue-700" },
  { code: "3w", label: "3-Week Selection", days: 21, color: "bg-green-100 text-green-700" },
  { code: "9w", label: "9-Week Retention + TAI", days: 63, color: "bg-purple-100 text-purple-700" },
  { code: "15w", label: "15-Week Outcome", days: 105, color: "bg-orange-100 text-orange-700" },
];

export default function FeedbackTestPanel() {
  const client = useAdminClient();
  const [requests, setRequests] = useState([]);
  const [feedback, setFeedback] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await client.get("/admin/requests");
      const reqs = (res.data?.requests || []).filter((r) => r.results_sent_at);
      setRequests(reqs);
      for (const r of reqs.slice(0, 20)) {
        getFeedback(r.id);
      }
    } catch {
      toast.error("Failed to load requests");
    }
    setLoading(false);
  };



  const getFeedback = async (requestId) => {
    try {
      const res = await client.get(`/feedback/responses/${requestId}`);
      setFeedback((prev) => ({ ...prev, [requestId]: res.data?.responses || [] }));
    } catch {
      /* no feedback yet */
    }
  };

  const triggerEmail = async (requestId, milestone) => {
    const key = `${requestId}-${milestone}`;
    setSending((prev) => ({ ...prev, [key]: true }));
    try {
      await client.post("/admin/feedback-testing/trigger", {
        request_id: requestId,
        milestone,
      });
      toast.success(`${milestone} survey email sent`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Failed to send ${milestone} email`);
    }
    setSending((prev) => ({ ...prev, [key]: false }));
  };

  const filtered = requests.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.email || "").toLowerCase().includes(q) ||
      (r.id || "").toLowerCase().includes(q) ||
      (r.name || "").toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#6D6A65]">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading outcome data...
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4" data-testid="feedback-test-panel">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by email or request ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-[#6D6A65]">
          {filtered.length} request{filtered.length !== 1 ? "s" : ""} with results sent
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[#6D6A65] py-4">
          No requests with results sent yet.
        </p>
      ) : (
        filtered.slice(0, 20).map((r) => {
          const fb = feedback[r.id] || [];
          return (
            <div key={r.id} className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-[#E8E5DF] flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-medium text-[#2D4A3E]">{r.email}</span>
                  <span className="ml-2 text-xs text-[#6D6A65]">
                    Results sent{" "}
                    {r.results_sent_at ? new Date(r.results_sent_at).toLocaleDateString() : "\u2014"}
                  </span>
                </div>
                <a
                  href={`/feedback/patient/${r.id}?milestone=48h`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#2D4A3E] hover:underline flex items-center gap-1"
                >
                  Open survey <ExternalLink size={12} />
                </a>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
                {MILESTONES.map((ms) => {
                  const sent = r[`structured_followup_${ms.code}_sent_at`] || r[`followup_sent_${ms.code}`];
                  const hasFb = fb.some((f) => f.milestone === ms.code);
                  const key = `${r.id}-${ms.code}`;
                  return (
                    <div key={ms.code} className="border border-[#E8E5DF] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ms.color}`}>
                          {ms.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-[#6D6A65]">
                        {sent ? (
                          <><CheckCircle2 size={12} className="text-green-600" /> Email sent</>
                        ) : (
                          <><Clock size={12} /> {ms.days} days</>
                        )}
                      </div>
                      {hasFb && (
                        <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                          Response received
                        </div>
                      )}
                      <div className="flex gap-1">
                        <button
                          onClick={() => triggerEmail(r.id, ms.code)}
                          disabled={sending[key]}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-[#2D4A3E] text-white rounded-lg hover:bg-[#1e332b] disabled:opacity-50"
                        >
                          {sending[key] ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                          Send
                        </button>
                        <a
                          href={`/feedback/patient/${r.id}?milestone=${ms.code}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 border border-[#E8E5DF] rounded-lg hover:bg-[#FDFBF7] text-[#2D4A3E]"
                        >
                          Survey
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
