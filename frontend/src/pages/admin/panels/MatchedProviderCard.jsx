import { useState } from "react";

// Per-axis maxes — kept in sync with matching.py constants. If the
// backend ever changes the weights, update here too. Used to render
// "21 / 35" style chips so the admin can see how close each axis got
// to its ceiling.
const AXIS_MAX = {
  issues: 35,
  availability: 20,
  modality: 15,
  urgency: 10,
  prior_therapy: 10,
  experience: 5,
  modality_pref: 4,
  payment_fit: 3,
  gender: 3,
  style: 2,
  reviews: 5,
  differentiator: 1.5,
  research_bonus: 15,  // evidence_depth (0-10) + approach_alignment (0-5)
  decline_penalty: -10,
};

const AXIS_LABEL = {
  issues: "Issue / specialty fit",
  availability: "Schedule overlap",
  modality: "Format (telehealth / in-person)",
  urgency: "Urgency capacity",
  prior_therapy: "Prior-therapy fit",
  experience: "Years experience",
  modality_pref: "Preferred therapy approach",
  payment_fit: "Sliding-scale fit",
  gender: "Gender preference",
  style: "Style preference",
  reviews: "Verified reviews",
  differentiator: "Tiebreaker",
  research_bonus: "LLM research bonus",
  decline_penalty: "Recent decline penalty",
};

// Hard filters every notified therapist passed by definition. We render
// them as a tiny ✓ checklist so the admin can confirm at a glance.
const HARD_FILTERS_PASSED = [
  "Licensed in patient's state",
  "Treats patient's primary concern",
  "Serves patient's age group",
  "Offers therapy format patient needs",
];

export default function MatchedProviderCard({ t }) {
  const [open, setOpen] = useState(false);
  const breakdown = t.match_breakdown || {};
  // Show every axis the backend reported (including zeros & negatives —
  // a 0 on `issues` is exactly what you want to see when debugging
  // "why did this therapist score so low?"). Sort by max value desc
  // so the heaviest axes lead.
  const breakdownEntries = Object.entries(breakdown).sort(
    (a, b) => (AXIS_MAX[b[0]] || 0) - (AXIS_MAX[a[0]] || 0),
  );
  const totalAchieved = breakdownEntries.reduce((s, [, v]) => s + v, 0);
  return (
    <div
      className="border border-[#E8E5DF] rounded-xl bg-white overflow-hidden"
      data-testid={`matched-provider-${t.id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#FDFBF7] transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[#2B2A29] truncate">{t.name}</span>
            <span className="text-xs text-[#6D6A65]">{t.credential_type || "—"}</span>
            {t.review_count >= 10 && t.review_avg >= 4.0 && (
              <span className="text-[10px] text-[#C87965]">
                ★{t.review_avg.toFixed(1)} · {t.review_count}
              </span>
            )}
          </div>
          <div className="text-xs text-[#6D6A65] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{t.email}</span>
            {t.distance_miles != null && (
              <span className="text-[#C87965]">{t.distance_miles} mi</span>
            )}
            {(t.office_locations || []).length > 0 && (
              <span>{t.office_locations.join(", ")}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {t.enriched_score != null && t.score_delta != null && (
            <span
              className="font-mono text-xs bg-[#C87965] text-white px-2 py-0.5 rounded"
              title="LLM web-research enriched score"
              data-testid={`matched-provider-enriched-${t.id}`}
            >
              {Math.round(t.enriched_score)}
              {t.score_delta > 0 ? (
                <span className="ml-1 opacity-90">+{t.score_delta}</span>
              ) : null}
            </span>
          )}
          <span
            className="font-mono text-xs bg-[#2D4A3E] text-white px-2.5 py-0.5 rounded inline-flex items-center gap-1"
            title="Click to see how this score was computed"
          >
            {Math.round(t.match_score)}%
            <span className="text-[10px] opacity-70">
              {open ? "▴" : "▾"}
            </span>
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[#E8E5DF] bg-[#FDFBF7] px-4 py-3 text-xs space-y-4">
          {/* "Why this score?" — the new unified explainer */}
          <div
            className="bg-white border border-[#E8E5DF] rounded-md p-3"
            data-testid={`matched-why-${t.id}`}
          >
            <div className="text-[11px] font-semibold text-[#2D4A3E] mb-2 flex items-center justify-between">
              <span>Why does this therapist score {Math.round(t.match_score)}%?</span>
              <span className="font-mono text-[10px] text-[#6D6A65]">
                axes total: {Math.round(totalAchieved)}
              </span>
            </div>
            {breakdownEntries.length === 0 ? (
              <div className="text-[#6D6A65] italic">
                No per-axis breakdown was stored for this match. Older
                requests (pre iter-82) won't have one — re-running the
                match will populate it.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {breakdownEntries.map(([axis, pts]) => {
                  const max = AXIS_MAX[axis];
                  const ratio = max && max > 0 ? Math.min(1, pts / max) : 0;
                  const isNeg = pts < 0;
                  const isZero = pts === 0;
                  // When the actual exceeds the documented max it's
                  // because a priority-factor boost (or pre-iter-82
                  // weighting) inflated the axis. Hide the `/max` suffix
                  // in that case to avoid showing nonsensical "+63/35"
                  // chips. Show a small "boosted" hint instead.
                  const isBoosted = max != null && !isNeg && pts > max;
                  return (
                    <div
                      key={axis}
                      className="flex items-center gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded px-2 py-1"
                      data-testid={`matched-axis-${t.id}-${axis}`}
                    >
                      <span className="text-[#2B2A29] flex-1 min-w-0 truncate">
                        {AXIS_LABEL[axis] || axis.replace(/_/g, " ")}
                      </span>
                      {/* Mini bar — fills proportionally; red when negative */}
                      {max != null && !isNeg && (
                        <span className="w-12 h-1 rounded-full bg-[#E8E5DF] overflow-hidden shrink-0">
                          <span
                            className={`block h-full ${
                              isZero ? "bg-[#D45D5D]/40" : "bg-[#2D4A3E]"
                            }`}
                            style={{ width: `${Math.max(2, ratio * 100)}%` }}
                          />
                        </span>
                      )}
                      <span
                        className={`font-mono text-[11px] tabular-nums shrink-0 ${
                          isNeg
                            ? "text-[#D45D5D]"
                            : isZero
                              ? "text-[#A4A29E]"
                              : "text-[#2D4A3E]"
                        }`}
                      >
                        {isNeg ? "" : "+"}
                        {Math.round(pts * 10) / 10}
                        {max != null && !isNeg && !isBoosted && (
                          <span className="text-[#A4A29E]">/{max}</span>
                        )}
                        {isBoosted && (
                          <span
                            className="text-[#C87965] ml-1"
                            title="Priority-boosted axis (the patient asked us to weigh this higher)"
                          >
                            ★
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-[#E8E5DF]">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
                Hard filters passed
              </div>
              <div className="flex flex-wrap gap-1">
                {HARD_FILTERS_PASSED.map((f) => (
                  <span
                    key={f}
                    className="text-[10px] inline-flex items-center gap-1 bg-[#2D4A3E]/10 text-[#2D4A3E] rounded-full px-2 py-0.5"
                  >
                    <span>✓</span>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Existing LLM rationale — kept since it carries patient-facing prose */}
          {t.research_rationale ? (
            <div
              className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-3 py-2 text-[#2B2A29]"
              data-testid={`matched-provider-rationale-${t.id}`}
            >
              <div className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold mb-1">
                LLM web research · +{t.score_delta || 0} bonus
              </div>
              <div className="leading-relaxed">{t.research_rationale}</div>
              <div className="mt-1.5 text-[10px] text-[#6D6A65] flex flex-wrap gap-3">
                <span>Evidence depth: <strong>{t.evidence_depth ?? 0}/10</strong></span>
                <span>Approach align: <strong>{t.approach_alignment ?? 0}/5</strong></span>
              </div>
            </div>
          ) : null}

          {/* Existing therapist-attribute grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Years exp</div>
              <div className="text-[#2B2A29]">{t.years_experience ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Cash rate</div>
              <div className="text-[#2B2A29]">${t.cash_rate ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Sliding scale</div>
              <div className="text-[#2B2A29]">{t.sliding_scale ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Telehealth</div>
              <div className="text-[#2B2A29]">{t.telehealth ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">In-person</div>
              <div className="text-[#2B2A29]">{t.offers_in_person ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Plans</div>
              <div className="text-[#2B2A29]">{(t.insurance_accepted || []).length || 0}</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Specialties</div>
            <div className="text-[#2B2A29]">{(t.primary_specialties || []).join(" · ") || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Modalities</div>
            <div className="text-[#2B2A29]">{(t.modalities || []).join(" · ") || "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
