import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

// ── Master Query: natural-language Q&A backed by /api/admin/master-query.
// Snapshot is loaded lazily so we only hit the backend once the admin
// actually opens the tab.
export default function MasterQueryPanel({ client }) {
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotErr, setSnapshotErr] = useState("");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]); // [{q, a, at}]
  const [asking, setAsking] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);

  const SUGGESTIONS = [
    "How many requests came in over the last 7 days vs the prior 7?",
    "Which presenting concerns are most common right now?",
    "What share of active therapists are publishable?",
    "Which referral sources are driving the most patients in the last 90 days?",
    "Are there repeat-submitter emails I should look at?",
  ];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/master-query/snapshot");
        if (alive) setSnapshot(r.data);
      } catch (e) {
        if (alive)
          setSnapshotErr(
            e?.response?.data?.detail || e.message || "Snapshot unavailable",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  const ask = async (q) => {
    const text = (q || question || "").trim();
    if (!text || asking) return;
    setAsking(true);
    try {
      const r = await client.post("/admin/master-query", { question: text });
      setHistory((h) => [
        { q: text, a: r.data.answer, at: r.data.snapshot_at },
        ...h,
      ]);
      setQuestion("");
    } catch (e) {
      const msg =
        e?.response?.data?.detail || e.message || "Master Query call failed";
      toast.error(msg);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="master-query-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="flex-1">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Ask Master Query
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              Natural-language questions answered from a live business
              snapshot. Numbers are pulled from MongoDB at call time and
              answered by Claude — no guesses, no outside data.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label
            htmlFor="mq-input"
            className="text-xs uppercase tracking-wider text-[#6D6A65]"
          >
            Your question
          </label>
          <div className="mt-1 flex gap-2 flex-col sm:flex-row">
            <input
              id="mq-input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              placeholder="e.g. how many requests this week?"
              className="flex-1 bg-white border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2D4A3E]"
              data-testid="master-query-input"
              maxLength={600}
              disabled={asking}
            />
            <button
              type="button"
              onClick={() => ask()}
              disabled={!question.trim() || asking}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="master-query-ask-btn"
            >
              {asking ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : (
                <Send size={14} className="inline mr-1.5" />
              )}
              Ask
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={asking}
                className="text-xs border border-[#E8E5DF] hover:border-[#2D4A3E] text-[#3F3D3B] hover:text-[#2D4A3E] rounded-full px-3 py-1.5 transition disabled:opacity-50"
                data-testid={`master-query-suggestion-${s.slice(0, 12).replace(/\W+/g, "-").toLowerCase()}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {snapshotErr && (
          <div
            className="mt-4 text-sm text-[#D45D5D] bg-[#FDF1EF] border border-[#F2C9C0] rounded-lg p-3"
            data-testid="master-query-snapshot-error"
          >
            {snapshotErr}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-3" data-testid="master-query-history">
          {history.map((entry, i) => (
            <div
              key={i}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-5"
              data-testid={`master-query-entry-${i}`}
            >
              <div className="text-xs uppercase tracking-wider text-[#6D6A65]">
                Question
              </div>
              <div className="text-sm text-[#2B2A29] mt-1 font-medium">
                {entry.q}
              </div>
              <div className="text-xs uppercase tracking-wider text-[#6D6A65] mt-4">
                Answer
              </div>
              <div className="text-sm text-[#2B2A29] mt-1 whitespace-pre-wrap leading-relaxed">
                {entry.a || "(no answer)"}
              </div>
              {entry.at && (
                <div className="text-[11px] text-[#9A938A] mt-3">
                  Snapshot at {new Date(entry.at).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {snapshot && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <button
            type="button"
            onClick={() => setShowSnapshot((v) => !v)}
            className="text-sm text-[#2D4A3E] hover:underline inline-flex items-center gap-1.5"
            data-testid="master-query-toggle-snapshot"
          >
            {showSnapshot ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
            {showSnapshot ? "Hide" : "Show"} the raw snapshot Master Query is
            reasoning over
          </button>
          {showSnapshot && (
            <pre
              className="mt-3 text-[11px] leading-relaxed text-[#3F3D3B] bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-3 overflow-auto max-h-96"
              data-testid="master-query-snapshot-json"
            >
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Blog admin: list, create, edit, publish/unpublish, delete posts.
