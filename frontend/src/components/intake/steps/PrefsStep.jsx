import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Group, PillRow } from "@/components/intake/IntakeUI";
import { PATIENT_LANGUAGE_OPTIONS } from "@/lib/languages";
import { EXPERIENCE, GENDERS, STYLES, MODALITY_PREFS } from "./intakeOptions";

/**
 * Step "prefs" — therapist experience preference (multi with
 * "no_pref" mutex), gender preference (single + optional hard
 * required-flag), preferred session language with optional hard
 * "language only" toggle, plus optional style / modality preferences.
 */
export default function PrefsStep({ data, set, toggleArr, hardCapacity }) {
  const hc = hardCapacity || { isDisabled: () => false, reasonFor: () => "" };
  const genderHardDisabled = hc.isDisabled("gender_required", data.gender_preference);
  const genderReason = hc.reasonFor("gender_required", data.gender_preference);
  const langHardDisabled = hc.isDisabled("language_strict", data.preferred_language);
  const langReason = hc.reasonFor("language_strict", data.preferred_language);
  return (
    <div className="space-y-6">
      <Group label="Therapist experience preference (pick all that apply)">
        <PillRow
          items={EXPERIENCE}
          selected={data.experience_preference}
          onSelect={(v) => {
            // "no_pref" is mutually exclusive with concrete picks
            if (v === "no_pref") {
              set("experience_preference", ["no_pref"]);
              return;
            }
            const cur = (data.experience_preference || []).filter(
              (x) => x !== "no_pref",
            );
            if (cur.includes(v)) {
              const next = cur.filter((x) => x !== v);
              set(
                "experience_preference",
                next.length === 0 ? ["no_pref"] : next,
              );
            } else {
              set("experience_preference", [...cur, v]);
            }
          }}
          testid="experience"
        />
      </Group>
      <Group label="Therapist gender preference">
        <PillRow
          items={GENDERS}
          selected={[data.gender_preference]}
          onSelect={(v) => set("gender_preference", v)}
          testid="gender"
        />
        {data.gender_preference !== "no_pref" && (
          <label
            className={`flex items-start gap-3 mt-3 border rounded-xl px-3 py-2.5 ${
              genderHardDisabled
                ? "bg-[#F2EFE9] border-[#E8E5DF] cursor-not-allowed opacity-60"
                : "bg-[#FDFBF7] border-[#E8E5DF] cursor-pointer"
            }`}
            data-testid="gender-required-row"
          >
            <Switch
              checked={!genderHardDisabled && !!data.gender_required}
              disabled={genderHardDisabled}
              onCheckedChange={(v) =>
                !genderHardDisabled && set("gender_required", v)
              }
              data-testid="gender-required"
            />
            <span className="text-sm text-[#2B2A29] leading-relaxed">
              Required (only show therapists matching this gender)
              {genderHardDisabled && (
                <span className="block mt-1 text-xs text-[#B37E35]">
                  {genderReason || "Too few therapists match this gender right now — we'll still prioritise them, but can't make it a hard filter."}
                </span>
              )}
            </span>
          </label>
        )}
      </Group>
      <Group
        label="Preferred session language"
        hint="English is the default. Pick a different language if you'd rather have sessions in it — we'll prioritise therapists who speak it."
      >
        <Select
          value={data.preferred_language}
          onValueChange={(v) => {
            set("preferred_language", v);
            if (v === "English") set("language_strict", false);
          }}
        >
          <SelectTrigger
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="language-select"
          >
            <SelectValue placeholder="Pick a language" />
          </SelectTrigger>
          <SelectContent>
            {PATIENT_LANGUAGE_OPTIONS.filter((l) => l !== "Other").map(
              (lang) => (
                <SelectItem key={lang} value={lang}>
                  {lang}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        {data.preferred_language &&
          data.preferred_language !== "English" && (
            <label
              className={`flex items-start gap-3 mt-3 border rounded-xl px-4 py-3 transition ${
                langHardDisabled
                  ? "bg-[#F2EFE9] border-[#E8E5DF] cursor-not-allowed opacity-60"
                  : "bg-[#FDFBF7] border-[#E8E5DF] cursor-pointer hover:border-[#2D4A3E]"
              }`}
              data-testid="language-strict-row"
            >
              <Checkbox
                checked={!langHardDisabled && data.language_strict}
                disabled={langHardDisabled}
                onCheckedChange={(v) =>
                  !langHardDisabled && set("language_strict", !!v)
                }
                className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                data-testid="language-strict-toggle"
              />
              <span className="text-sm text-[#2B2A29] leading-relaxed">
                <strong>Hard requirement:</strong> only show therapists
                who speak {data.preferred_language}.{" "}
                {langHardDisabled ? (
                  <span className="block mt-1 text-xs text-[#B37E35]">
                    {langReason}
                  </span>
                ) : (
                  <span className="text-[#6D6A65]">
                    Off (default) means English-speaking therapists still
                    appear, just ranked lower than{" "}
                    {data.preferred_language}-speaking ones.
                  </span>
                )}
              </span>
            </label>
          )}
      </Group>
      <Group
        label="Therapist style (optional)"
        hint="Pick any that resonate"
      >
        <PillRow
          items={STYLES}
          selected={data.style_preference}
          onSelect={(v) => toggleArr("style_preference", v)}
          testid="style"
        />
      </Group>
      <Group
        label="Preferred therapy approach (optional)"
        hint="If you have specific evidence-based modalities in mind"
      >
        <div className="flex flex-wrap gap-2">
          {MODALITY_PREFS.map((m) => {
            const active = data.modality_preferences.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleArr("modality_preferences", m)}
                data-testid={`modality-pref-${m}`}
                className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
