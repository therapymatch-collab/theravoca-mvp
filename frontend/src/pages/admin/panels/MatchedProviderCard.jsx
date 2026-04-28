import { useState } from "react";

export default function MatchedProviderCard({ t }) {
  const [open, setOpen] = useState(false);
  const breakdown = t.match_breakdown || {};
  const breakdownEntries = Object.entries(breakdown).filter(([, v]) => v > 0);
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
        <span className="font-mono text-xs bg-[#2D4A3E] text-white px-2.5 py-0.5 rounded shrink-0">
          {Math.round(t.match_score)}%
        </span>
      </button>
      {open && (
        <div className="border-t border-[#E8E5DF] bg-[#FDFBF7] px-4 py-3 text-xs space-y-3">
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
          {breakdownEntries.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
                Score breakdown ({Math.round(breakdownEntries.reduce((a, [, v]) => a + v, 0))} pts)
              </div>
              <div className="grid grid-cols-2 gap-1">
                {breakdownEntries.map(([axis, pts]) => (
                  <div key={axis} className="flex items-center justify-between bg-white border border-[#E8E5DF] rounded px-2 py-1">
                    <span className="text-[#6D6A65]">{axis.replace(/_/g, " ")}</span>
                    <span className="font-mono text-[#2D4A3E]">+{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
