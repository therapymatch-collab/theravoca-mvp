import React, { useEffect, useState } from "react";
import useAdminClient from "@/lib/useAdminClient";
import { Loader2, TrendingUp, Users, MessageSquare, BarChart3, ChevronDown, ChevronUp } from "lucide-react";

const MILESTONE_LABELS = {
  "48h": "48-Hour Check-in",
  "3w": "3-Week Selection",
  "9w": "9-Week Retention",
  "15w": "15-Week Outcome",
};

const MILESTONE_ORDER = ["48h", "3w", "9w", "15w"];

function TaiGauge({ score }) {
  const color = score >= 75 ? "#2D8B5E" : score >= 50 ? "#D4A843" : "#D45D5D";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: color + "22", color }}
    >
      TAI {score.toFixed(1)}
    </span>
  );
}

function ReliabilityBar({ label, value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? "#2D8B5E" : pct >= 50 ? "#D4A843" : "#D45D5D";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 text-gray-500 capitalize">{label.replace(/_/g, " ")}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 text-right font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

function FeedbackCard({ entry }) {
  const [open, setOpen] = useState(false);
  const milestone = entry.milestone || "unknown";
  const created = entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "â";

  // Extract notable fields for preview
  const preview = [];
  if (entry.tai_score != null && entry.tai_score >= 0) preview.push(`TAI: ${entry.tai_score.toFixed(1)}`);
  if (entry.still_seeing_9w) preview.push(`Still seeing: ${entry.still_seeing_9w}`);
  if (entry.still_seeing_15w) preview.push(`Still seeing (15w): ${entry.still_seeing_15w}`);
  if (entry.confidence_3w != null) preview.push(`Confidence: ${entry.confidence_3w}/100`);
  if (entry.expectation_match_3w) preview.push(`Expectations met: ${entry.expectation_match_3w}`);
  if (entry.progress_15w != null) preview.push(`Progress: ${entry.progress_15w}/10`);

  // All answer fields (exclude metadata)
  const META_KEYS = new Set(["kind", "milestone", "request_id", "created_at", "patient_email", "tai_score", "tai_data"]);
  const answers = Object.entries(entry).filter(([k]) => !META_KEYS.has(k) && !k.startsWith("_"));

  return (
    <div className="border border-gray-200 rounded-lg p-3 text-sm">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded bg-[#2D4A3E]/10 text-[#2D4A3E] text-xs font-medium">
            {MILESTONE_LABELS[milestone] || milestone}
          </span>
          <span className="text-gray-400 text-xs">{created}</span>
          <span className="text-gray-500 text-xs truncate max-w-[200px]">{entry.patient_email || entry.request_id}</span>
          {entry.tai_score != null && entry.tai_score >= 0 && <TaiGauge score={entry.tai_score} />}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {!open && preview.length > 0 && (
        <div className="mt-1 text-xs text-gray-400">{preview.join(" Â· ")}</div>
      )}
      {open && (
        <div className="mt-3 space-y-1">
          {answers.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-gray-400 w-48 shrink-0 capitalize">{k.replace(/_/g, " ")}:</span>
              <span className="text-gray-700">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OutcomeTrackingPanel() {
  const client = useAdminClient();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [testingEnabled, setTestingEnabled] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  useEffect(() => {
    client.get("/admin/feedback-testing").then(r => setTestingEnabled(r.data?.enabled || false)).catch(() => {});
  }, []);

  const toggleTesting = async () => {
    setToggleLoading(true);
    try {
      const res = await client.put("/admin/feedback-testing", { enabled: !testingEnabled });
      setTestingEnabled(res.data?.enabled || false);
      toast.success(res.data?.enabled ? "Testing mode ON" : "Testing mode OFF");
    } catch { toast.error("Failed to toggle"); }
    setToggleLoading(false);
  };


  useEffect(() => {
    (async () => {
      try {
        const res = await client.get("/admin/outcome-tracking");
        setData(res.data);
      } catch (e) {
        console.error("Failed to load outcome tracking", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[#2D4A3E]" /></div>;
  if (!data) return <p className="text-gray-500 py-8 text-center">Failed to load outcome data.</p>;

  const { summary, feedback_by_milestone, tai_scores, therapist_reliability } = data;
  const hasFeedback = summary.total_feedback > 0;

  const tabs = [
    { id: "overview", label: "Overview", icon: <BarChart3 size={14} /> },
    { id: "surveys", label: "All Surveys", icon: <MessageSquare size={14} />, count: summary.total_feedback },
    { id: "tai", label: "TAI Scores", icon: <TrendingUp size={14} />, count: summary.tai_scores_count },
    { id: "reliability", label: "Therapist Reliability", icon: <Users size={14} />, count: therapist_reliability.length },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition ${
              activeTab === t.id
                ? "bg-[#2D4A3E] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t.icon} {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-xs">{t.count}</span>
            )}
          </button>
        ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-[#6D6A65]">Testing</span>
            <button
              onClick={toggleTesting}
              disabled={toggleLoading}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${testingEnabled ? "bg-[#2D4A3E]" : "bg-[#D3D1C7]"}`}
              data-testid="feedback-testing-toggle"
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${testingEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
      </div>

      {/* Overview */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#2D4A3E]">{summary.total_feedback}</div>
              <div className="text-xs text-gray-500 mt-1">Total Responses</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#2D4A3E]">{summary.tai_scores_count}</div>
              <div className="text-xs text-gray-500 mt-1">TAI Scores</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#2D4A3E]">
                {summary.avg_tai != null ? summary.avg_tai : "â"}
              </div>
              <div className="text-xs text-gray-500 mt-1">Avg TAI Score</div>
            </div>
            <div className="bg-white border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#2D4A3E]">{therapist_reliability.length}</div>
              <div className="text-xs text-gray-500 mt-1">Therapists w/ Reliability</div>
            </div>
          </div>

          {/* Milestone breakdown */}
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold text-[#2D4A3E] mb-3">Responses by Milestone</h3>
            {MILESTONE_ORDER.map((m) => {
              const count = summary.milestone_counts[m] || 0;
              const maxCount = Math.max(...Object.values(summary.milestone_counts || { x: 1 }), 1);
              return (
                <div key={m} className="flex items-center gap-3 mb-2">
                  <span className="w-32 text-sm text-gray-600">{MILESTONE_LABELS[m]}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2D4A3E]/70 rounded-full flex items-center justify-end pr-2"
                      style={{ width: `${Math.max((count / maxCount) * 100, count > 0 ? 8 : 0)}%` }}
                    >
                      {count > 0 && <span className="text-xs text-white font-medium">{count}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!hasFeedback && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              No feedback surveys have been submitted yet. Surveys are sent automatically at 48h, 3w, 9w, and 15w after a patient selects a therapist.
            </div>
          )}
        </div>
      )}

      {/* All Surveys */}
      {activeTab === "surveys" && (
        <div className="space-y-2">
          {!hasFeedback ? (
            <p className="text-gray-500 text-sm py-4">No survey responses yet.</p>
          ) : (
            MILESTONE_ORDER.map((m) => {
              const docs = feedback_by_milestone[m] || [];
              if (docs.length === 0) return null;
              return (
                <div key={m}>
                  <h3 className="font-semibold text-[#2D4A3E] text-sm mb-2 mt-4">
                    {MILESTONE_LABELS[m]} ({docs.length})
                  </h3>
                  <div className="space-y-2">
                    {docs.map((d, i) => <FeedbackCard key={`${m}-${i}`} entry={d} />)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAI Scores */}
      {activeTab === "tai" && (
        <div className="space-y-3">
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold text-[#2D4A3E] mb-1">Therapeutic Alliance Index (TAI)</h3>
            <p className="text-xs text-gray-500 mb-4">
              Composite 0â100 score from patient surveys. Bond (40%) + Tasks (30%) + Goals (30%).
              Computed at 9w and 15w milestones when enough data exists.
            </p>
            {tai_scores.length === 0 ? (
              <p className="text-gray-400 text-sm">No TAI scores computed yet. Scores appear after 9-week surveys.</p>
            ) : (
              <div className="space-y-2">
                {tai_scores.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                    <TaiGauge score={t.tai_score} />
                    <span className="text-sm text-gray-600">{t.patient_email || t.request_id}</span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {t.milestone} Â· {t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Therapist Reliability */}
      {activeTab === "reliability" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Passive behavior scores that feed into the matching engine (25pts max).
            New therapists start at 50% (neutral). Updates automatically from survey responses and referral outcomes.
          </p>
          {therapist_reliability.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No therapists have reliability data yet.</p>
          ) : (
            therapist_reliability.map((t, i) => {
              const rel = t.reliability || {};
              return (
                <div key={i} className="bg-white border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-medium text-[#2D4A3E]">
                        {t.first_name} {t.last_name}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">{t.email}</span>
                    </div>
                    {rel.last_feedback_at && (
                      <span className="text-xs text-gray-400">
                        Last updated: {new Date(rel.last_feedback_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <ReliabilityBar label="response_rate" value={rel.response_rate} />
                    <ReliabilityBar label="expectation_accuracy" value={rel.expectation_accuracy} />
                    <ReliabilityBar label="retention_9w" value={rel.retention_9w} />
                    <ReliabilityBar label="retention_15w" value={rel.retention_15w} />
                    <ReliabilityBar label="selection_rate" value={rel.selection_rate} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
