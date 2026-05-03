import { useState } from "react";
import { Loader2, Search, ExternalLink, Phone, Mail, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function ScraperTestPanel({ client }) {
  const [city, setCity] = useState("");
  const [state, setState] = useState("ID");
  const [issues, setIssues] = useState("");
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const run = async () => {
    if (!city.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const payload = {
        city: city.trim(),
        state: state.trim() || "ID",
        count,
      };
      if (issues.trim()) {
        payload.presenting_issues = issues
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      const r = await client.post("/admin/scraper-test", payload);
      setResult(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[#2E4057] mb-1">
          Scraper Test
        </h3>
        <p className="text-sm text-[#6B7280]">
          Test the directory scraper cascade (Psychology Today, TherapyDen,
          GoodTherapy, Google Maps). Enter a city and optional presenting
          issues to find therapists with contact info.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            City *
          </label>
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Boise"
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            State
          </label>
          <Input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="ID"
            maxLength={2}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            Presenting issues (comma-separated)
          </label>
          <Input
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            placeholder="e.g. anxiety, depression, trauma_ptsd"
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            Count
          </label>
          <Input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 50)}
            min={1}
            max={100}
          />
        </div>
        <button
          onClick={run}
          disabled={loading || !city.trim()}
          className="px-4 py-2 bg-[#2E4057] text-white rounded-lg text-sm font-medium
                     hover:bg-[#1a2a3a] disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          {loading ? "Scraping..." : "Run Scraper"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex flex-wrap gap-4">
            <div className="px-4 py-3 bg-[#F5F3EF] rounded-lg">
              <div className="text-2xl font-bold text-[#2E4057]">
                {result.total}
              </div>
              <div className="text-xs text-[#6B7280]">Total found</div>
            </div>
            {Object.entries(result.sources || {}).map(([src, cnt]) => (
              <div key={src} className="px-4 py-3 bg-[#F5F3EF] rounded-lg">
                <div className="text-2xl font-bold text-[#2E4057]">{cnt}</div>
                <div className="text-xs text-[#6B7280]">
                  {src.replace(/_/g, " ")}
                </div>
              </div>
            ))}
          </div>

          {result.errors?.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              {result.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}

          {/* Results table */}
          <div className="border border-[#E8E5DF] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3EF] text-left text-xs text-[#6B7280]">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">License</th>
                    <th className="px-3 py-2">City</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Website</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.candidates || []).map((c, i) => (
                    <tr
                      key={i}
                      className={`border-t border-[#E8E5DF] ${
                        i % 2 === 0 ? "bg-white" : "bg-[#FAFAF8]"
                      }`}
                    >
                      <td className="px-3 py-2 text-[#6B7280]">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-[#2E4057]">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 text-[#6B7280]">
                        {(c.license_types || []).join(", ") ||
                          c.primary_license ||
                          "-"}
                      </td>
                      <td className="px-3 py-2">
                        {c.city}
                        {c.state ? `, ${c.state}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        {c.phone ? (
                          <span className="flex items-center gap-1 text-green-700">
                            <Phone size={12} />
                            {c.phone}
                          </span>
                        ) : (
                          <span className="text-xs text-red-400" title={c.phone_source || "unknown"}>
                            {c.phone_source === "no website listed" ? "no site" : c.phone_source === "not found on website" ? "not found" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.email ? (
                          <span className="flex items-center gap-1 text-blue-700" title={c.email_source || ""}>
                            <Mail size={12} />
                            {c.email}
                          </span>
                        ) : (
                          <span className="text-xs text-red-400" title={c.email_source || "unknown"}>
                            {c.email_source === "no website listed" ? "no site" : c.email_source === "not found on website" ? "not found" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.website ? (
                          <a
                            href={c.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <Globe size={12} />
                            link
                          </a>
                        ) : (
                          <span className="text-[#C4C0B8]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.source === "psychology_today"
                              ? "bg-purple-100 text-purple-700"
                              : c.source === "google_maps"
                              ? "bg-blue-100 text-blue-700"
                              : c.source === "therapyden"
                              ? "bg-green-100 text-green-700"
                              : c.source === "goodtherapy"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {(c.source || "unknown").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {c.profile_url ? (
                          <a
                            href={c.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            <ExternalLink size={14} />
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
