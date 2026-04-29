import { Group } from "@/pages/therapist/TherapistSignupUI";
import { ISSUES, SPECIALTY_TIERS } from "./signupOptions";

/**
 * Step 4 — "Specialties"
 *
 * Each issue can live in exactly ONE tier (primary / secondary /
 * general / none) — handled by the parent `setIssueTier` helper.
 * Tier caps: primary 2, secondary 3, general 5.
 */
export default function Step4Specialties({ data, issueTier, setIssueTier }) {
  return (
    <Group
      title="Specialties"
      hint="Tap an issue, then choose its tier. Higher tier = stronger match score. (At least 1 Primary required.)"
    >
      <div className="space-y-2.5">
        {ISSUES.map((iss) => {
          const tier = issueTier(iss.v);
          const tiersAvail = {
            primary: data.primary_specialties.length < 2 || tier === "primary",
            secondary:
              data.secondary_specialties.length < 3 || tier === "secondary",
            general: data.general_treats.length < 5 || tier === "general",
          };
          return (
            <div
              key={iss.v}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5"
              data-testid={`signup-issue-${iss.v}`}
            >
              <span className="text-sm text-[#2B2A29] sm:flex-1">{iss.l}</span>
              <div className="flex flex-wrap gap-1">
                {SPECIALTY_TIERS.map(([t, lbl, color]) => {
                  const active = tier === t;
                  const disabled = t && !tiersAvail[t];
                  return (
                    <button
                      key={lbl}
                      type="button"
                      disabled={disabled}
                      onClick={() => setIssueTier(iss.v, t)}
                      data-testid={`signup-issue-${iss.v}-${t || "none"}`}
                      className={`text-xs px-2.5 py-1 rounded-md border transition ${
                        active
                          ? "text-white border-transparent"
                          : disabled
                            ? "text-[#6D6A65]/40 border-[#E8E5DF] cursor-not-allowed"
                            : "text-[#6D6A65] border-[#E8E5DF] hover:border-[#2D4A3E]"
                      }`}
                      style={active ? { background: color } : {}}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[#6D6A65] mt-3">
        Primary: {data.primary_specialties.length}/2 · Secondary:{" "}
        {data.secondary_specialties.length}/3 · General:{" "}
        {data.general_treats.length}/5
      </p>
    </Group>
  );
}
