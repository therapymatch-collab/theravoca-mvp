import { useEffect, useState } from "react";
import { Loader2, RotateCw, Filter, Sparkles, TrendingUp, Award } from "lucide-react";

// Admin > Operations > Matching
// Read-only view of the matching pipeline + current scoring weights.
// Sourced from GET /api/admin/matching/pipeline so the displayed
// weights always reflect what the engine is actually running.
export default function MatchingPipelinePanel({ client }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await client.get("/admin/matching/pipeline");
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't load matching pipeline");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading && !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65]">
        <Loader2 className="animate-spin inline mr-2" /> Loading matching pipeline...
      </div>
    );
  }
  if (err) {
    return (
      <div className="mt-6 bg-[#FDF1EF] border border-[#F2C9C0] rounded-2xl p-5 text-sm text-[#8B3220]">
        {err}
      </div>
    );
  }
  if (!data) return null;

  const totalScoringMax = (data.scoring_axes || []).reduce((s, a) => s + (a.max_points || 0), 0);
  const totalBonusMax = (data.bonuses || []).reduce((s, b) => s + (b.max_points || 0), 0);

  return (
    <div className="mt-6 space-y-5" data-testid="matching-pipeline-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#6D6A65] mb-1">Operations</div>
            <h2 className="font-serif-display text-3xl text-[#2D4A3E] leading-tight">Matching pipeline</h2>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">{data.summary}</p>
          </div>
          <button onClick={load} disabled={loading}
                  className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
                  data-testid="matching-reload">
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Step 1: hard filters */}
      <Section
        icon={<Filter size={18} className="text-[#8B3220]" />}
        title="Step 1 — Hard filters"
        subtitle="A therapist must pass EVERY one of these to be considered. Failing any one drops them from the pool before scoring."
        accent="#FBE9E5"
      >
        <ul className="divide-y divide-[#E8E5DF]">
          {(data.hard_filters || []).map((f, i) => (
            <li key={i} className="py-3 flex items-start gap-3">
              <span className="text-[#D45D5D] mt-1">&#x2715;</span>
              <div>
                <div className="font-medium text-[#2B2A29] text-sm">{f.name}</div>
                <div className="text-xs text-[#6D6A65] mt-0.5">Blocks when: {f.blocks_when}</div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Step 2: weighted scoring */}
      <Section
        icon={<TrendingUp size={18} className="text-[#2D4A3E]" />}
        title={`Step 2 — Weighted scoring (up to ${totalScoringMax.toFixed(0)} pts)`}
        subtitle="Each remaining therapist gets a score on every axis below. The axis weights sum to the raw maximum; later normalization maps the raw total to a 0-97 display range."
        accent="#EAF2E8"
      >
        <WeightTable rows={data.scoring_axes || []} totalMax={totalScoringMax} />
      </Section>

      {/* Step 3: bonuses */}
      <Section
        icon={<Sparkles size={18} className="text-[#C87965]" />}
        title={`Step 3 — Bonuses (up to +${totalBonusMax.toFixed(0)} pts)`}
        subtitle="Extra points on top of the structured score when deeper data is available."
        accent="#FBEFE9"
      >
        <WeightTable rows={data.bonuses || []} totalMax={totalBonusMax} />
      </Section>

      {/* Step 4: normalize + deliver */}
      <Section
        icon={<Award size={18} className="text-[#2D4A3E]" />}
        title="Step 4 — Normalize + deliver"
        subtitle="Raw scores are mapped to a 0-97 display range so the top of the curve stays differentiated as weights are tuned."
        accent="#F5F1E8"
      >
        <div className="space-y-2 text-sm">
          <Row label="Max display score" value={`${data.display_normalization?.max_display_score || 97}`} />
          <Row label="Default minimum threshold" value={`${data.display_normalization?.min_threshold_default_pct || 70}%`} />
          <Row label="Default max invites per request" value={`${data.delivery?.max_invites_default || 30}`} />
          <p className="text-xs text-[#6D6A65] italic mt-3 leading-relaxed">
            {data.display_normalization?.description}
            {" "}
            {data.delivery?.description}
          </p>
        </div>
      </Section>
    </div>
  );
}

function Section({ icon, title, subtitle, accent, children }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
      <div className="px-6 py-4 flex items-start gap-3 border-b border-[#E8E5DF]"
           style={{ backgroundColor: accent }}>
        <div className="mt-0.5">{icon}</div>
        <div>
          <h3 className="font-serif-display text-xl text-[#2D4A3E]">{title}</h3>
          <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed max-w-3xl">{subtitle}</p>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function WeightTable({ rows, totalMax }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const pct = totalMax > 0 ? (r.max_points / totalMax) * 100 : 0;
        return (
          <div key={i} className="border border-[#E8E5DF] rounded-lg p-3" data-testid={`axis-${r.key || i}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-[#2B2A29] text-sm">{r.name}</div>
              <div className="text-right">
                <span className="font-serif text-lg text-[#2D4A3E]">{r.max_points}</span>
                <span className="text-xs text-[#6D6A65] ml-1">pts</span>
              </div>
            </div>
            <div className="mt-1.5 bg-[#F2EFE8] rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-[#2D4A3E]" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-[#6D6A65] mt-2 leading-relaxed">{r.description}</p>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[#6D6A65]">{label}</span>
      <span className="font-medium text-[#2D4A3E]">{value}</span>
    </div>
  );
}
