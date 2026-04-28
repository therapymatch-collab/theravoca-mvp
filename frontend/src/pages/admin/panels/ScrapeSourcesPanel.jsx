import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ExternalLink, Beaker } from "lucide-react";
import { Input } from "@/components/ui/input";

// Admin-managed registry of EXTRA therapist directory URLs (state board
// rosters, group-practice sites, county clinic listings, etc.) that the
// outreach LLM + gap recruiter consult IN ADDITION TO Psychology Today
// and Idaho DOPL. Backend: GET/PUT /api/admin/scrape-sources.
//
// We keep the data model intentionally tiny: {url, label, notes, enabled}.
// The LLM treats each entry as "research these specific rosters for real
// candidates" — no live HTTP scrape happens server-side yet (that's a
// follow-up); for now this expands what the LLM grounds on.
export default function ScrapeSourcesPanel({ client }) {
  const [loaded, setLoaded] = useState(false);
  const [sources, setSources] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/scrape-sources");
        if (!alive) return;
        setSources(r.data.sources || []);
        setLoaded(true);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Failed to load sources");
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);

  const update = (i, patch) =>
    setSources((s) => s.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const add = () =>
    setSources((s) => [
      ...s,
      { id: `new-${Date.now()}`, url: "", label: "", notes: "", enabled: true },
    ]);

  const remove = (i) => setSources((s) => s.filter((_, idx) => idx !== i));

  // Per-row "Test scrape" — calls POST /admin/scrape-sources/test with the
  // current row's URL and shows the result inline (count + strategy used).
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const testRow = async (i) => {
    const row = sources[i];
    if (!row?.url) {
      toast.error("Add a URL first");
      return;
    }
    setTesting((t) => ({ ...t, [i]: true }));
    setTestResults((r) => ({ ...r, [i]: null }));
    try {
      const res = await client.post("/admin/scrape-sources/test", {
        url: row.url,
        label: row.label || "",
      });
      setTestResults((r) => ({ ...r, [i]: res.data }));
      const n = res.data.candidate_count || 0;
      if (n === 0) {
        toast.warning(
          `No therapists extracted from ${row.url} (strategy: ${res.data.strategy})`,
        );
      } else {
        toast.success(
          `Extracted ${n} candidates via ${res.data.strategy} (${res.data.elapsed_sec}s)`,
        );
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Test failed";
      toast.error(msg);
      setTestResults((r) => ({ ...r, [i]: { error: msg } }));
    } finally {
      setTesting((t) => ({ ...t, [i]: false }));
    }
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const r = await client.put("/admin/scrape-sources", { sources });
      setSources(r.data.sources || []);
      toast.success("External directory sources saved");
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Save failed";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 space-y-6" data-testid="scrape-sources-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              External directory sources
            </h3>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Add roster URLs (state board lists, group-practice sites, county
              clinic directories) for the outreach LLM and gap recruiter to
              consult <em>in addition to</em> Psychology Today and Idaho DOPL.
              Each enabled URL is injected into the candidate-research prompt.
            </p>
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-full border border-[#E8E5DF] hover:bg-[#F4F1EC]"
            data-testid="scrape-sources-add-btn"
          >
            <Plus size={14} /> Add source
          </button>
        </div>

        {!loaded ? (
          <div className="mt-6 text-sm text-[#6D6A65] inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {sources.length === 0 ? (
              <p
                className="mt-6 text-sm text-[#6D6A65] italic"
                data-testid="scrape-sources-empty"
              >
                No external sources yet. Click "Add source" to register a
                directory URL.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-[#E8E5DF]">
                {sources.map((s, i) => (
                  <li
                    key={s.id || i}
                    className="py-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-start"
                    data-testid={`scrape-source-row-${i}`}
                  >
                    <div className="md:col-span-6">
                      <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                        URL
                      </label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          type="url"
                          placeholder="https://example.com/idaho-therapists"
                          value={s.url}
                          onChange={(e) => update(i, { url: e.target.value })}
                          data-testid={`scrape-source-url-${i}`}
                        />
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-2 text-[#6D6A65] hover:text-[#2D4A3E]"
                            title="Open in new tab"
                          >
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="md:col-span-3">
                      <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                        Label
                      </label>
                      <Input
                        placeholder="ID State Board"
                        value={s.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                        className="mt-1"
                        data-testid={`scrape-source-label-${i}`}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                        Notes
                      </label>
                      <Input
                        placeholder="Optional"
                        value={s.notes}
                        onChange={(e) => update(i, { notes: e.target.value })}
                        className="mt-1"
                        data-testid={`scrape-source-notes-${i}`}
                      />
                    </div>
                    <div className="md:col-span-1 flex items-center gap-3 mt-5">
                      <label className="inline-flex items-center gap-1.5 text-xs text-[#2B2A29]">
                        <input
                          type="checkbox"
                          checked={!!s.enabled}
                          onChange={(e) =>
                            update(i, { enabled: e.target.checked })
                          }
                          data-testid={`scrape-source-enabled-${i}`}
                        />
                        On
                      </label>
                      <button
                        type="button"
                        onClick={() => testRow(i)}
                        disabled={!!testing[i] || !s.url}
                        className="text-[#2D4A3E] hover:text-[#1f3a30] disabled:opacity-40"
                        title="Test scrape this URL"
                        data-testid={`scrape-source-test-${i}`}
                      >
                        {testing[i] ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Beaker size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="text-[#B0382A] hover:text-[#8E2A1F]"
                        title="Remove"
                        data-testid={`scrape-source-remove-${i}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {testResults[i] ? (
                      <div
                        className="md:col-span-12 text-xs px-3 py-2 rounded-md bg-[#F4F1EC] border border-[#E8E5DF] text-[#2B2A29]"
                        data-testid={`scrape-source-test-result-${i}`}
                      >
                        {testResults[i].error ? (
                          <span className="text-[#B0382A]">
                            Error: {testResults[i].error}
                          </span>
                        ) : (
                          <>
                            <strong>{testResults[i].candidate_count}</strong>{" "}
                            candidates extracted via{" "}
                            <code>{testResults[i].strategy}</code> in{" "}
                            {testResults[i].elapsed_sec}s.
                            {testResults[i].candidates_preview?.length ? (
                              <span className="text-[#6D6A65]">
                                {" "}
                                Preview:{" "}
                                {testResults[i].candidates_preview
                                  .map((c) => `${c.name || "?"} (${c.city || "?"})`)
                                  .join(", ")}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {err ? (
              <p
                className="mt-4 text-xs text-[#B0382A] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-3 py-2"
                data-testid="scrape-sources-error"
              >
                {err}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs text-[#6D6A65]">
                {sources.filter((s) => s.enabled).length} enabled ·{" "}
                {sources.length} total
              </p>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
                data-testid="scrape-sources-save-btn"
              >
                {saving ? (
                  <Loader2 size={14} className="inline mr-1.5 animate-spin" />
                ) : null}
                Save sources
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
