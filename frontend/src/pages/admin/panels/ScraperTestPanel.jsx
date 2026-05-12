import { useEffect, useRef, useState } from "react";
import { Loader2, Search, ExternalLink, Phone, Mail, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";

// Scraper test panel -- runs the live recruiting pipeline (discovery
// cascade + contact enrichment) against a city/state/specialty combo
// without sending any emails. Lets the admin actually see which
// therapists would be invited and which real contact info the
// enricher pulled from their websites.
//
// Backend flow (async):
//   1. POST /admin/scraper-test  -> returns { job_id }
//   2. Poll GET /admin/scraper-jobs/{job_id} until phase === "complete"
//   3. Render the candidates list with completeness sorting
export default function ScraperTestPanel({ client }) {
  const [city, setCity] = useState("");
  const [state, setState] = useState("ID");
  const [issues, setIssues] = useState("");
  const [count, setCount] = useState(20);
  const [job, setJob] = useState(null);
  const [phase, setPhase] = useState(""); // "starting" | "scraping" | "enriching" | "complete" | "error"
  const [error, setError] = useState("");
  const pollTimerRef = useRef(null);

  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  const startJob = async () => {
    if (!city.trim()) return;
    setError("");
    setJob(null);
    setPhase("starting");
    try {
      const payload = {
        city: city.trim(),
        state: state.trim() || "ID",
        count: Math.max(1, Math.min(100, Number(count) || 20)),
      };
      if (issues.trim()) {
        payload.presenting_issues = issues.split(",").map((s) => s.trim()).filter(Boolean);
      }
      const r = await client.post("/admin/scraper-test", payload);
      const jobId = r.data?.job_id;
      if (!jobId) throw new Error("No job_id returned");
      setPhase("scraping");
      pollUntilDone(jobId);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to start scraper job");
      setPhase("error");
    }
  };

  const pollUntilDone = (jobId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    let ticks = 0;
    pollTimerRef.current = setInterval(async () => {
      ticks++;
      try {
        const r = await client.get(`/admin/scraper-jobs/${jobId}`);
        const j = r.data;
        setJob(j);
        setPhase(j?.phase || "scraping");
        if (j?.phase === "complete" || j?.completed_at || ticks > 90) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          if (ticks > 90 && j?.phase !== "complete") {
            setError("Job timed out after 3 minutes. Results may be partial.");
          }
        }
      } catch (e) {
        // Soft-fail on poll errors -- keep trying for a few cycles.
        if (ticks > 5) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setError("Lost connection while polling. Check Admin > Operations.");
          setPhase("error");
        }
      }
    }, 2000);
  };

  const isRunning = phase === "starting" || phase === "scraping" || phase === "enriching";
  const candidates = job?.candidates || [];
  const realEmails = candidates.filter((c) => c.email && !c.email.startsWith("info@")).length;
  const realPhones = candidates.filter((c) => c.phone).length;

  return (
    <div className="space-y-6" data-testid="scraper-test-panel">
      <div>
        <h3 className="font-serif-display text-2xl text-[#2D4A3E] mb-1">
          Scraper test -- see real recruiting results
        </h3>
        <p className="text-sm text-[#6D6A65] leading-relaxed max-w-3xl">
          Runs the full live pipeline (Psychology Today + external directories +
          backup scrapers + Google Places enrichment + website scrape) against
          a city/state/specialty combo. <strong>No emails sent.</strong> Use
          this to verify the system actually finds real therapists with real
          contact info before you trust auto-outreach to do its job.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-[#6D6A65] mb-1">City *</label>
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Boise"
            disabled={isRunning}
            onKeyDown={(e) => e.key === "Enter" && startJob()}
          />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-[#6D6A65] mb-1">State</label>
          <Input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="ID"
            maxLength={2}
            disabled={isRunning}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-[#6D6A65] mb-1">
            Presenting issues (comma-separated, optional)
          </label>
          <Input
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            placeholder="anxiety, depression, trauma_ptsd"
            disabled={isRunning}
            onKeyDown={(e) => e.key === "Enter" && startJob()}
          />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-[#6D6A65] mb-1">Count</label>
          <Input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 20)}
            min={1}
            max={100}
            disabled={isRunning}
          />
        </div>
        <button
          onClick={startJob}
          disabled={isRunning || !city.trim()}
          className="px-4 py-2 bg-[#2D4A3E] text-white rounded-lg text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-50 flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {isRunning ? "Running..." : "Run test"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-[#FDF1EF] border border-[#F4C7BE] rounded-lg text-sm text-[#8B3220]">
          {error}
        </div>
      )}

      {/* Progress strip */}
      {(isRunning || job) && (
        <div className="border border-[#E8E5DF] rounded-lg p-4 bg-[#FDFBF7]">
          <div className="flex items-center gap-3 text-sm">
            <PhasePill label="Discovery" active={phase === "scraping"} done={phase === "enriching" || phase === "complete"} />
            <span className="text-[#9C9893]">&rarr;</span>
            <PhasePill label="Enrichment" active={phase === "enriching"} done={phase === "complete"} />
            <span className="text-[#9C9893]">&rarr;</span>
            <PhasePill label="Complete" active={phase === "complete"} done={phase === "complete"} />
            {job?.total != null && (
              <span className="ml-auto text-xs text-[#6D6A65]">
                {job.enriched_count || 0} of {job.total} enriched
              </span>
            )}
          </div>
        </div>
      )}

      {job && (
        <div className="space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile label="Therapists found" value={job.total || 0} accent="#2D4A3E" />
            <SummaryTile label="Real emails extracted" value={realEmails} accent="#4A6B5D" highlight />
            <SummaryTile label="Real phones extracted" value={realPhones} accent="#4A6B5D" />
            <SummaryTile
              label="Would be invited"
              value={candidates.filter((c) => c.email || c.phone).length}
              accent="#C87965"
              subtitle="have email OR phone"
            />
          </div>

          {/* Source breakdown */}
          {job.sources && Object.keys(job.sources).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(job.sources).map(([src, cnt]) => (
                <span key={src} className="bg-[#F2EFE8] border border-[#E8E5DF] px-2 py-1 rounded-full">
                  <strong className="text-[#2D4A3E]">{cnt}</strong>{" "}
                  <span className="text-[#6D6A65]">from {src.replace(/_/g, " ")}</span>
                </span>
              ))}
            </div>
          )}

          {(job.errors || []).length > 0 && (
            <div className="p-3 bg-[#FBEFE9] border border-[#F4C7BE] rounded-lg text-xs text-[#8B3220]">
              <div className="font-semibold mb-1">Scraper warnings:</div>
              {job.errors.map((e, i) => (<div key={i}>{e}</div>))}
            </div>
          )}

          {/* Results table */}
          {candidates.length > 0 && (
            <div className="border border-[#E8E5DF] rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#FDFBF7] text-left text-xs text-[#6D6A65] uppercase tracking-wider">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">License</th>
                      <th className="px-3 py-2">City</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Website</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c, i) => (
                      <tr key={i} className={`border-t border-[#E8E5DF] ${i % 2 === 0 ? "bg-white" : "bg-[#FAFAF8]"}`}>
                        <td className="px-3 py-2 text-[#9C9893]">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-[#2B2A29]">{c.name}</td>
                        <td className="px-3 py-2 text-[#6D6A65]">
                          {(c.license_types || []).join(", ") || c.primary_license || "—"}
                        </td>
                        <td className="px-3 py-2 text-[#2B2A29]">
                          {c.city}{c.state ? `, ${c.state}` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {c.phone ? (
                            <span className="inline-flex items-center gap-1 text-[#2D4A3E]" title={c.phone_source || ""}>
                              <Phone size={12} /> {c.phone}
                            </span>
                          ) : <span className="text-[#C4C0B8]">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {c.email ? (
                            <span className="inline-flex items-center gap-1 text-[#2D4A3E]" title={c.email_source || ""}>
                              <Mail size={12} /> {c.email}
                            </span>
                          ) : <span className="text-[#C4C0B8]">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {c.website ? (
                            <a href={c.website} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#2D4A3E] hover:underline">
                              <Globe size={12} /> open
                            </a>
                          ) : <span className="text-[#C4C0B8]">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <SourceChip src={c.source} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {phase === "complete" && (
                <div className="text-xs text-[#6D6A65] px-3 py-2 bg-[#FDFBF7] border-t border-[#E8E5DF]">
                  Sorted by completeness (real email + phone + website rank higher). In live outreach, the top
                  {" "}{candidates.filter((c) => c.email || c.phone).length} therapists would receive an invite;
                  rows with no email AND no phone are silently dropped at send-time.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhasePill({ label, active, done }) {
  let cls = "border border-[#E8E5DF] text-[#9C9893] bg-white";
  if (active) cls = "border border-[#C87965] text-[#C87965] bg-[#FBE9E5] animate-pulse";
  if (done) cls = "border border-[#4A6B5D] text-[#4A6B5D] bg-[#EAF2E8]";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
      {done ? "✓" : active ? "●" : "·"} {label}
    </span>
  );
}

function SummaryTile({ label, value, subtitle, accent, highlight }) {
  return (
    <div
      className={`border rounded-lg p-3 ${highlight ? "border-[#4A6B5D] bg-[#EAF2E8]" : "border-[#E8E5DF] bg-white"}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-serif text-2xl mt-1" style={{ color: accent }}>{value}</div>
      {subtitle && <div className="text-[10px] text-[#9C9893] mt-0.5">{subtitle}</div>}
    </div>
  );
}

function SourceChip({ src }) {
  const tone = {
    psychology_today: "bg-[#EFE6F2] text-[#5B3B7A]",
    google_maps:      "bg-[#E6EEF6] text-[#2D5380]",
    therapyden:       "bg-[#E8F0EB] text-[#2D5E40]",
    goodtherapy:      "bg-[#FBEFE9] text-[#8B5A1F]",
  }[src] || "bg-[#F2EFE8] text-[#6D6A65]";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>
      {(src || "unknown").replace(/_/g, " ")}
    </span>
  );
}
