import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Group, Field, Req } from "@/pages/therapist/TherapistSignupUI";
import { IDAHO_INSURERS } from "@/lib/insurers";
import { ADDITIONAL_LANGUAGES } from "@/lib/languages";

/**
 * Step 6 — "Insurance, languages, rates & experience"
 *
 * Three sub-Groups:
 *   1. Insurance accepted (chip select + free-text "Other" merge)
 *   2. Languages spoken beyond English (chip select + free-text merge)
 *   3. Cash rate, years of experience, free-consult & sliding-scale toggles
 */
export default function Step6Insurance({
  data,
  set,
  toggleArr,
  insuranceOther,
  setInsuranceOther,
}) {
  const addOtherInsurance = () => {
    const parts = insuranceOther
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...data.insurance_accepted, ...parts]));
    set("insurance_accepted", merged);
    setInsuranceOther("");
  };

  const addOtherLanguage = () => {
    const parts = (data.languages_spoken_other || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const merged = Array.from(new Set([...data.languages_spoken, ...parts]));
    set("languages_spoken", merged);
    set("languages_spoken_other", "");
  };

  return (
    <>
      <Group
        title="Insurance accepted (optional)"
        hint="Tap any plans you're in-network with — this helps patients on insurance see you. If your plan isn't listed, add it under 'Other'."
      >
        <div className="flex flex-wrap gap-2">
          {IDAHO_INSURERS.map((i) => {
            const active = data.insurance_accepted.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleArr("insurance_accepted", i)}
                data-testid={`signup-insurance-${i}`}
                className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                {i}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2 items-end">
          <Field
            label="Other (specify) — added to your accepted list"
            hint="Comma-separated for multiple plans."
          >
            <Input
              value={insuranceOther}
              onChange={(e) => setInsuranceOther(e.target.value)}
              placeholder="e.g. SelectHealth, IEHP"
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-insurance-other"
            />
          </Field>
          <button
            type="button"
            className="tv-btn-secondary !py-2 !px-4 text-sm shrink-0 mb-px"
            onClick={addOtherInsurance}
            data-testid="signup-insurance-other-add"
          >
            <Plus size={14} className="inline mr-1" /> Add
          </button>
        </div>
      </Group>

      <Group
        title="Languages spoken (beyond English)"
        hint="Tap any additional languages you can conduct sessions in. English is implicit — leave everything off if you only see clients in English. Patients searching for non-English-speaking therapists will be matched to you here."
      >
        <div className="flex flex-wrap gap-2">
          {ADDITIONAL_LANGUAGES.filter((l) => l !== "Other").map((lang) => {
            const active = data.languages_spoken.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                onClick={() => toggleArr("languages_spoken", lang)}
                data-testid={`signup-language-${lang.toLowerCase()}`}
                className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                {lang}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2 items-end">
          <Field
            label="Other (specify)"
            hint="Comma-separated. We'll add each entry to your spoken-languages list."
          >
            <Input
              value={data.languages_spoken_other}
              onChange={(e) => set("languages_spoken_other", e.target.value)}
              placeholder="e.g. French, Hindi, Portuguese"
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-language-other"
            />
          </Field>
          <button
            type="button"
            className="tv-btn-secondary !py-2 !px-4 text-sm shrink-0 mb-px"
            onClick={addOtherLanguage}
            data-testid="signup-language-other-add"
          >
            <Plus size={14} className="inline mr-1" /> Add
          </button>
        </div>
      </Group>

      <Group title="Rates & experience">
        <div className="grid grid-cols-2 gap-4">
          <Field label={<>Cash rate per session ($) <Req /></>}>
            <Input
              type="number"
              value={data.cash_rate}
              onChange={(e) =>
                set("cash_rate", parseInt(e.target.value, 10) || 0)
              }
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-cash-rate"
            />
          </Field>
          <Field label={<>Years of experience <Req /></>}>
            <Input
              type="number"
              value={data.years_experience}
              onChange={(e) =>
                set("years_experience", parseInt(e.target.value, 10) || 0)
              }
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-years"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
            <Checkbox
              checked={data.free_consult}
              onCheckedChange={(v) => set("free_consult", v)}
              className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
              data-testid="signup-free-consult"
            />
            <div>
              <div className="text-sm font-medium text-[#2B2A29]">
                Free initial consult
              </div>
              <div className="text-xs text-[#6D6A65]">
                Increases match-rate notably
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
            <Checkbox
              checked={data.sliding_scale}
              onCheckedChange={(v) => set("sliding_scale", v)}
              className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
              data-testid="signup-sliding-scale"
            />
            <div>
              <div className="text-sm font-medium text-[#2B2A29]">
                Sliding-scale rates available
              </div>
              <div className="text-xs text-[#6D6A65]">
                Patients with budget constraints will see you
              </div>
            </div>
          </label>
        </div>
      </Group>
    </>
  );
}
