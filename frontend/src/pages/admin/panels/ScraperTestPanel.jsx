import { useEffect, useRef, useState } from "react";
import { Loader2, Search, ExternalLink, Phone, Mail, Globe, Zap, CheckCircle2, XCircle } from "lucide-react";
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
//
// The job runs server-side in MongoDB, so it survives page navigation.
// We persist the active job_id to localStorage so revisiting this panel
// re-attaches to the in-progress job (or shows the most recent results).
const ACTIVE_JOB_STORAGE_KEY = "tv_admin_scraper_active_job";

export default function ScraperTestPanel({ client }) {
  const [city, setCity] = useState("");
  const [state, setState] = useState("ID");
  const [issues, setIssues] = useState("");
  const [count, setCount] = useState(20);
  const [job, setJob] = useState(null);
  const [phase, setPhase] = useState(""); // "starting" | "scraping" | "enriching" | "complete" | "error"
  const [error, setError] = useState("");
  const [placesTest, setPlacesTest] = useState(null);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [telnyxTest, setTelnyxTest] = useState(null);
  const [telnyxLoading, setTelnyxLoading] = useState(false);
  const pollTimerRef = useRef(null);

  const runPlacesTest = async () => {
    setPlacesLoading(true);
    setPlacesTest(null);
    try {
      const r = await client.post("/admin/places-test", {});
      setPlacesTest(r.data);
    } catch (e) {
      setPlacesTest({
        diagnosis: e?.response?.data?.detail || e.message || "Diagnostic call failed",
        env_var_set: false,
      });
    } finally {
      setPlacesLoading(false);
    }
  };

  const runTelnyxTest = async () => {
    setTelnyxLoading(true);
    setTelnyxTest(null);
    try {
      const r = await client.post("/admin/telnyx-test", {});
      setTelnyxTest(r.data);
    } catch (e) {
      setTelnyxTest({
        diagnosis: e?.response?.data?.detail || e.message || "Diagnostic call failed",
      });
    } finally {
      setTelnyxLoading(false);
    }
  };

  const telnyxOk = telnyxTest?.api_check?.ok && telnyxTest?.enabled;

  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  // Re-attach to an in-progress (or most recent) job when the panel
  // re-mounts -- e.g. after the admin navigated away and came back.
  // Only reads localStorage on mount; subsequent state changes don't
  // re-trigger this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    const savedId = (() => {
      try { return localStorage.getItem(ACTIVE_JOB_STORAGE_KEY); } catch { return null; }
    })();
    if (!savedId) return;
    (async () => {
      try {
        const r = await client.get(`/admin/scraper-jobs/${savedId}`);
        if (cancelled) return;
        const j = r.data;
        if (!j) return;
        setJob(j);
        setPhase(j?.phase || "scraping");
        if (j.city) setCity(j.city);
        if (j.state) setState(j.state);
        const inProgress =
          ["starting", "scraping", "enriching"].includes(j?.phase) &&
          !j?.completed_at;
        if (inProgress) pollUntilDone(savedId);
      } catch (e) {
        if (e?.response?.status === 404) {
          try { localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY); } catch {}
        }
      }
    })();
    return () => { cancelled = true; };
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
      try { localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, jobId); } catch {}
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
    // Poll every 3s for up to 15 minutes. The scraper is now
    // quantity-first (parallel fan-out + 200-profile PT enrichment +
    // full-set contact enricher) and accepts longer runs in exchange
    // for higher accuracy + more real emails.
    const POLL_INTERVAL_MS = 3000;
    const MAX_TICKS = 300; // 300 * 3s = 15 min
    pollTimerRef.current = setInterval(async () => {
      ticks++;
      try {
        const r = await client.get(`/admin/scraper-jobs/${jobId}`);
        const j = r.data;
        setJob(j);
        setPhase(j?.phase || "scraping");
        if (j?.phase === "complete" || j?.completed_at || ticks > MAX_TICKS) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          if (ticks > MAX_TICKS && j?.phase !== "complete") {
            setError("Job timed out after 15 minutes. Results may be partial.");
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
    }, POLL_INTERVAL_MS);
  };

  const isRunning = phase === "starting" || phase === "scraping" || phase === "enriching";
  const candidates = job?.candidates || [];
  // Email-ready = has a real email (not a guessed info@ placeholder).
  // SMS-ready = has phone BUT no real email (where SMS would actually fire as fallback).
  // Drop = no email AND no phone.
  const emailReady = candidates.filter(
    (c) => c.email && !c.email.startsWith("info@"),
  ).length;
  const smsReady = candidates.filter(
    (c) => c.phone && !(c.email && !c.email.startsWith("info@")),
  ).length;
  const dropCount = candidates.filter(
    (c) => !c.phone && !(c.email && !c.email.startsWith("info@")),
  ).length;
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

      {/* Step 0: Diagnostics -- Places + Telnyx side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Places API diagnostic */}
        <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#6D6A65] font-semibold">
                Step 0a -- email pipeline
              </div>
              <div className="font-semibold text-[#2D4A3E] mt-0.5">
                Google Places + website scrape
              </div>
              <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
                Powers EMAIL outreach. Places returns websites; we scrape
                them for mailto: addresses.
              </p>
            </div>
            <button
              onClick={runPlacesTest}
              disabled={placesLoading}
              className="px-3 py-2 bg-[#2D4A3E] text-white rounded-lg text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-50 flex items-center gap-2"
            >
              {placesLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {placesLoading ? "Testing..." : "Test Places"}
            </button>
          </div>

          {placesTest && (
            <div className="border border-[#E8E5DF] rounded-lg bg-white p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {placesTest.details?.total_results > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[#2D4A3E] font-semibold">
                    <CheckCircle2 size={16} className="text-[#4A6B5D]" /> Places API working
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#8B3220] font-semibold">
                    <XCircle size={16} className="text-[#D45D5D]" /> Places API not returning data
                  </span>
                )}
              </div>
              <div className="text-xs text-[#6D6A65]">
                Env var: <strong>{placesTest.env_var_set ? "set" : "NOT SET"}</strong>
                {placesTest.search?.status_code != null && (
                  <> &middot; HTTP {placesTest.search.status_code}</>
                )}
              </div>
              {placesTest.details && (
                <div className="text-xs text-[#2B2A29] bg-[#FDFBF7] rounded p-2 space-y-0.5">
                  <div><strong>Results:</strong> {placesTest.details.total_results || 0}</div>
                  <div><strong>With phone:</strong> {placesTest.details.with_phone ?? 0} / {placesTest.details.total_results || 0}</div>
                  <div><strong>With website:</strong> {placesTest.details.with_website ?? 0} / {placesTest.details.total_results || 0}</div>
                  <div className="pt-1 border-t border-[#E8E5DF]">
                    <strong>Top match:</strong> {placesTest.details.display_name || "(none)"}
                  </div>
                </div>
              )}
              {placesTest.diagnosis && (
                <div className="text-xs text-[#2B2A29] leading-relaxed whitespace-pre-line bg-[#FBEFE9] border border-[#F4C7BE] rounded p-2">
                  {placesTest.diagnosis}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Telnyx diagnostic */}
        <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#6D6A65] font-semibold">
                Step 0b -- SMS pipeline
              </div>
              <div className="font-semibold text-[#2D4A3E] mt-0.5">
                Telnyx SMS config
              </div>
              <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
                Powers SMS outreach (fallback when therapist's website
                has no email). Doesn't send any actual SMS.
              </p>
            </div>
            <button
              onClick={runTelnyxTest}
              disabled={telnyxLoading}
              className="px-3 py-2 bg-[#2D4A3E] text-white rounded-lg text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-50 flex items-center gap-2"
            >
              {telnyxLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {telnyxLoading ? "Testing..." : "Test Telnyx"}
            </button>
          </div>

          {telnyxTest && (
            <div className="border border-[#E8E5DF] rounded-lg bg-white p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {telnyxOk ? (
                  <span className="inline-flex items-center gap-1 text-[#2D4A3E] font-semibold">
                    <CheckCircle2 size={16} className="text-[#4A6B5D]" /> Telnyx ready to send
                  </span>
                ) : telnyxTest?.api_check?.ok ? (
                  <span className="inline-flex items-center gap-1 text-[#8B5A1F] font-semibold">
                    <XCircle size={16} className="text-[#C8923A]" /> Creds OK, but disabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#8B3220] font-semibold">
                    <XCircle size={16} className="text-[#D45D5D]" /> Telnyx not configured
                  </span>
                )}
              </div>
              {telnyxTest?.env && (
                <div className="text-xs text-[#2B2A29] bg-[#FDFBF7] rounded p-2 space-y-0.5">
                  <div><strong>Enabled:</strong> {telnyxTest.env.TELNYX_ENABLED}</div>
                  <div><strong>API key:</strong> {telnyxTest.env.TELNYX_API_KEY ? telnyxTest.env.TELNYX_API_KEY_starts_with : "(unset)"}</div>
                  <div><strong>Public key:</strong> {telnyxTest.env.TELNYX_PUBLIC_KEY ? `${telnyxTest.env.TELNYX_PUBLIC_KEY_length} chars set` : "(unset)"}</div>
                  <div><strong>From number:</strong> {telnyxTest.env.TELNYX_FROM_NUMBER}</div>
                  <div><strong>Override-to:</strong> {telnyxTest.env.TELNYX_DEV_OVERRIDE_TO}</div>
                  {telnyxTest.api_check?.account_friendly_name && (
                    <div className="pt-1 border-t border-[#E8E5DF]">
                      <strong>Profile:</strong> {telnyxTest.api_check.profile_name}
                      {" "}({telnyxTest.api_check.enabled} -- {telnyxTest.api_check.webhook_url})
                    </div>
                  )}
                </div>
              )}
              {telnyxTest.diagnosis && (
                <div className="text-xs text-[#2B2A29] leading-relaxed whitespace-pre-line bg-[#FBEFE9] border border-[#F4C7BE] rounded p-2">
                  {telnyxTest.diagnosis}
                </div>
              )}
            </div>
          )}
        </div>
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
          {/* Summary tiles -- mirrors the live outreach channel split */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile label="Therapists found" value={job.total || candidates.length} accent="#2D4A3E" />
            <SummaryTile
              label="Email-ready"
              value={emailReady}
              accent="#4A6B5D"
              subtitle="would get email invite"
              highlight
            />
            <SummaryTile
              label="SMS-ready"
              value={smsReady}
              accent="#C87965"
              subtitle="no email, has phone -- SMS fallback"
              highlight
            />
            <SummaryTile
              label="Dropped"
              value={dropCount}
              accent="#9C9893"
              subtitle="no email AND no phone"
            />
          </div>
          <div className="text-xs text-[#6D6A65] -mt-2">
            Real phones found: <strong>{realPhones}</strong> (some of those are
            on Email-ready rows too -- the channel split above shows which
            channel would actually fire).
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
                      <th className="px-3 py-2">Company</th>
                      <th className="px-3 py-2">First name</th>
                      <th className="px-3 py-2">Last name</th>
                      <th className="px-3 py-2">City</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Matching issue</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Website</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c, i) => {
                      const { company, firstName, lastName } = splitNameField(c.name);
                      const matched = matchedIssue(c.specialties, issues);
                      return (
                        <tr key={i} className={`border-t border-[#E8E5DF] ${i % 2 === 0 ? "bg-white" : "bg-[#FAFAF8]"}`}>
                          <td className="px-3 py-2 text-[#9C9893]">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-[#2B2A29]">{company || <span className="text-[#C4C0B8]">—</span>}</td>
                          <td className="px-3 py-2 text-[#2B2A29]">{firstName || <span className="text-[#C4C0B8]">—</span>}</td>
                          <td className="px-3 py-2 text-[#2B2A29]">{lastName || <span className="text-[#C4C0B8]">—</span>}</td>
                          <td className="px-3 py-2 text-[#2B2A29]">{c.city || "—"}</td>
                          <td className="px-3 py-2 text-[#2B2A29]">{c.state || "—"}</td>
                          <td className="px-3 py-2 text-[#2B2A29]">
                            {matched
                              ? <span className="bg-[#EAF2E8] text-[#2D4A3E] px-2 py-0.5 rounded-full text-xs">{matched.replace(/_/g, " ")}</span>
                              : (c.specialties || []).length > 0
                                ? <span className="text-xs text-[#6D6A65]">{(c.specialties || []).slice(0, 2).map(s => s.replace(/_/g, " ")).join(", ")}</span>
                                : <span className="text-[#C4C0B8]">—</span>}
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
                      );
                    })}
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

// Heuristic split of the `name` field into company vs first/last name.
// Google Maps / TherapyDen / GoodTherapy often return practice names
// ("Mind Space Mental Wellness Counseling LLC"); PT returns mostly
// individual names ("Jane Smith, LCSW"). We use a keyword list to
// detect company-ish strings; everything else gets parsed as a person.
const COMPANY_KEYWORDS = [
  "llc", "inc", "pllc", "pc", "llp", "ltd",
  "counseling", "wellness", "center", "centre", "clinic", "office",
  "therapy", "psychology", "psychiatry", "psychiatric",
  "associates", "partners", "group", "services", "practice",
  "institute", "collective", "behavioral", "health",
];
function splitNameField(name) {
  const raw = (name || "").trim();
  if (!raw) return { company: "", firstName: "", lastName: "" };
  // Strip a trailing credential suffix like ", LCSW" / ", PhD" so we
  // don't accidentally treat it as a last name.
  const stripped = raw.replace(
    /,\s*(LCSW|LCPC|LPC|LMFT|LCMHC|LMHC|PsyD|PhD|MD|LMSW|MA|MEd|MSW|EdSP)\s*$/i,
    "",
  ).trim();
  const lower = stripped.toLowerCase();
  const looksLikeCompany = COMPANY_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`, "i").test(lower),
  );
  if (looksLikeCompany) {
    return { company: raw, firstName: "", lastName: "" };
  }
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { company: "", firstName: "", lastName: "" };
  if (tokens.length === 1) {
    return { company: "", firstName: tokens[0], lastName: "" };
  }
  return {
    company: "",
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
}

// Return the candidate specialty that best matches the user's search
// input (comma-separated string of issue slugs). Returns null when no
// overlap; caller falls back to showing the first few specialties.
function matchedIssue(specialties, issuesInput) {
  if (!Array.isArray(specialties) || specialties.length === 0) return null;
  const want = (issuesInput || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (want.length === 0) return null;
  return specialties.find((s) => want.includes((s || "").toLowerCase())) || null;
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
