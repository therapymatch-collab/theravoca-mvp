import { useEffect, useState, useMemo } from "react";
import { Loader2, RotateCw, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

// Bulk profile audit. One scannable matrix of every active therapist
// with a check / warn / fail icon per field group, so the admin can
// see at a glance whether the directory is match-ready after a
// backfill (or spot which therapists still have gaps before launch).
//
// Sorted by completeness ascending by default -- the most incomplete
// rows float to the top so they're the obvious targets to fix. Click
// a row to open the Preview modal for that therapist.
export default function BulkProfileAuditPanel({ client, onPreview }) {
  const [therapists, setTherapists] = useState(null);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await client.get("/admin/therapists");
      setTherapists(r.data || []);
    } catch (e) {
      // soft-fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const rows = useMemo(() => {
    if (!therapists) return [];
    let filtered = therapists.filter((t) =>
      includeInactive ? true : t.is_active !== false && !t.pending_approval,
    );
    const q = (search || "").trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (t) =>
          (t.name || "").toLowerCase().includes(q) ||
          (t.email || "").toLowerCase().includes(q),
      );
    }
    return filtered
      .map((t) => ({ ...t, _audit: audit(t) }))
      .sort((a, b) => a._audit.score - b._audit.score);
  }, [therapists, includeInactive, search]);

  const matchReady = rows.filter((r) => r._audit.score === GROUPS.length).length;
  const partial = rows.filter((r) => r._audit.score < GROUPS.length && r._audit.score >= GROUPS.length - 2).length;
  const broken = rows.filter((r) => r._audit.score < GROUPS.length - 2).length;

  if (loading && !therapists) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65]">
        <Loader2 className="animate-spin inline mr-2" /> Loading provider audit...
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="bulk-profile-audit">
      {/* Summary strip */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Provider profile audit</h3>
            <p className="text-sm text-[#6D6A65] mt-1 max-w-2xl leading-relaxed">
              Bulk view of every provider's profile completeness across
              the field groups that the matching engine actually uses.
              Sort by completeness ascending so the most incomplete
              float to the top. Click a row to open the full preview.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard
            label="Match-ready"
            value={matchReady}
            total={rows.length}
            color="#4A6B5D"
            icon={<CheckCircle2 size={16} />}
          />
          <SummaryCard
            label="Partial (1-2 gaps)"
            value={partial}
            total={rows.length}
            color="#C8923A"
            icon={<AlertCircle size={16} />}
          />
          <SummaryCard
            label="Major gaps (3+)"
            value={broken}
            total={rows.length}
            color="#D45D5D"
            icon={<XCircle size={16} />}
          />
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-sm w-72"
          />
          <label className="text-xs text-[#6D6A65] inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="accent-[#2D4A3E]"
            />
            Include inactive + pending-approval
          </label>
          <div className="text-xs text-[#6D6A65] ml-auto">
            Showing {rows.length} of {therapists?.length || 0} therapists
          </div>
        </div>
      </div>

      {/* Matrix */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FDFBF7] text-[#6D6A65] uppercase tracking-wider">
              <tr>
                <th className="text-left p-3 sticky left-0 bg-[#FDFBF7] z-10">Therapist</th>
                {GROUPS.map((g) => (
                  <th key={g.key} className="p-3 text-center" title={g.tooltip}>
                    {g.short}
                  </th>
                ))}
                <th className="p-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E5DF]">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={GROUPS.length + 2} className="p-10 text-center text-[#6D6A65]">
                    No therapists match the current filter.
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-[#FDFBF7] cursor-pointer"
                  onClick={() => onPreview && onPreview(t)}
                >
                  <td className="p-3 sticky left-0 bg-white hover:bg-[#FDFBF7] z-10 max-w-[220px]">
                    <div className="font-medium text-[#2B2A29] truncate">{t.name || "(no name)"}</div>
                    <div className="text-[10px] text-[#9C9893] truncate">{t.email || ""}</div>
                  </td>
                  {GROUPS.map((g) => {
                    const state = t._audit.groups[g.key];
                    return (
                      <td key={g.key} className="p-3 text-center">
                        <StateIcon state={state} />
                      </td>
                    );
                  })}
                  <td className="p-3 text-right">
                    <span className={`font-semibold ${
                      t._audit.score === GROUPS.length ? "text-[#4A6B5D]" :
                      t._audit.score >= GROUPS.length - 2 ? "text-[#C8923A]" :
                      "text-[#D45D5D]"
                    }`}>
                      {t._audit.score}/{GROUPS.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-[#6D6A65] mt-3 px-2">
        <span className="inline-flex items-center gap-1 mr-4">
          <StateIcon state="ok" /> Filled
        </span>
        <span className="inline-flex items-center gap-1 mr-4">
          <StateIcon state="partial" /> Partial / weak
        </span>
        <span className="inline-flex items-center gap-1">
          <StateIcon state="missing" /> Missing
        </span>
      </div>
    </div>
  );
}


// ============= group definitions =============
// Each group = one column in the matrix. `check(t)` returns 'ok' /
// 'partial' / 'missing' based on whether the matching engine has
// enough data on that axis to scoring well.
const GROUPS = [
  {
    key: "identity", short: "Identity",
    tooltip: "name + credential + email",
    check: (t) => {
      if (!t.name) return "missing";
      if (!t.credential_type || !t.email) return "partial";
      return "ok";
    },
  },
  {
    key: "license", short: "License",
    tooltip: "licensed_states + license_number",
    check: (t) => {
      const states = t.licensed_states || [];
      if (states.length === 0) return "missing";
      if (!t.license_number) return "partial";
      return "ok";
    },
  },
  {
    key: "specialty", short: "Specialty",
    tooltip: "primary_specialties (required for HARD filter on patient's #1 concern)",
    check: (t) => {
      const primary = t.primary_specialties || [];
      const secondary = t.secondary_specialties || [];
      if (primary.length === 0) return "missing";
      if (primary.length < 2 && secondary.length === 0) return "partial";
      return "ok";
    },
  },
  {
    key: "modality", short: "Modality",
    tooltip: "modalities (CBT/DBT) + modality_offering (telehealth/in-person/both)",
    check: (t) => {
      const m = t.modalities || [];
      if (!t.modality_offering) return "missing";
      if (m.length === 0) return "partial";
      return "ok";
    },
  },
  {
    key: "location", short: "Location",
    tooltip: "office_locations or office_addresses (required for in-person matching)",
    check: (t) => {
      const offering = (t.modality_offering || "").toLowerCase();
      if (offering === "telehealth") return "ok"; // location irrelevant
      const cities = t.office_locations || [];
      const addrs = t.office_addresses || [];
      if (cities.length === 0 && addrs.length === 0) return "missing";
      if (addrs.length === 0) return "partial";
      return "ok";
    },
  },
  {
    key: "clinical", short: "Clinical fit",
    tooltip: "age_groups + client_types",
    check: (t) => {
      const ages = t.age_groups || [];
      const types = t.client_types || [];
      if (ages.length === 0 || types.length === 0) return "missing";
      if (ages.length < 2 || types.length < 1) return "partial";
      return "ok";
    },
  },
  {
    key: "payment", short: "Payment",
    tooltip: "cash_rate + (insurance_accepted OR sliding_scale)",
    check: (t) => {
      if (t.cash_rate == null) return "missing";
      const ins = t.insurance_accepted || [];
      if (ins.length === 0 && !t.sliding_scale) return "partial";
      return "ok";
    },
  },
  {
    key: "schedule", short: "Schedule",
    tooltip: "availability_windows + urgency_capacity + years_experience",
    check: (t) => {
      const avail = t.availability_windows || [];
      if (avail.length === 0) return "missing";
      if (!t.urgency_capacity || t.years_experience == null) return "partial";
      return "ok";
    },
  },
  {
    key: "deepmatch", short: "Deep match",
    tooltip: "T6 session expectations + T5 lived experience (signals used by deep-match)",
    check: (t) => {
      const t6 = t.t6_session_expectations || [];
      if (t6.length === 0) return "missing";
      if (!t.t5_lived_experience) return "partial";
      return "ok";
    },
  },
  {
    key: "bio", short: "Bio",
    tooltip: "bio + profile_picture (patient-facing)",
    check: (t) => {
      const bio = t.bio || "";
      if (bio.length === 0) return "missing";
      if (bio.length < 100) return "partial";
      return "ok";
    },
  },
];

function audit(t) {
  const groups = {};
  let score = 0;
  for (const g of GROUPS) {
    const state = g.check(t);
    groups[g.key] = state;
    if (state === "ok") score += 1;
  }
  return { groups, score };
}

function StateIcon({ state }) {
  if (state === "ok") return <CheckCircle2 size={16} className="inline text-[#4A6B5D]" />;
  if (state === "partial") return <AlertCircle size={16} className="inline text-[#C8923A]" />;
  return <XCircle size={16} className="inline text-[#D45D5D]" />;
}

function SummaryCard({ label, value, total, color, icon }) {
  return (
    <div className="border border-[#E8E5DF] rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-[#6D6A65]" style={{ color }}>
        {icon} {label}
      </div>
      <div className="mt-1">
        <span className="font-serif text-2xl text-[#2D4A3E]">{value}</span>
        <span className="text-xs text-[#6D6A65] ml-1">/ {total}</span>
      </div>
    </div>
  );
}
