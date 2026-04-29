import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Group, Field, PillCol } from "@/components/intake/IntakeUI";
import { MODALITY } from "./intakeOptions";

/**
 * Step "format" — telehealth/in-person preference, plus city + ZIP
 * gating (only required for in-person modes), plus an optional
 * hard-distance toggle. ZIP is validated in real time against the
 * patient's selected state via the parent `zipMatchesState` helper.
 */
export default function FormatStep({
  data,
  set,
  zipMatchesState,
  zipError,
  setZipError,
}) {
  return (
    <div className="space-y-6">
      <Group label="How would the client prefer to meet?">
        <PillCol
          items={MODALITY}
          selected={[data.modality_preference]}
          onSelect={(v) => set("modality_preference", v)}
          testid="modality"
        />
      </Group>
      {["in_person_only", "prefer_inperson", "hybrid"].includes(
        data.modality_preference,
      ) && (
        <>
          <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4 text-sm text-[#2B2A29] leading-relaxed">
            <p>
              <strong className="text-[#2D4A3E]">How in-person matching works:</strong>{" "}
              we measure the straight-line distance from the patient's
              ZIP/city center to the therapist's office. By default we
              surface in-person matches within{" "}
              <strong>30&nbsp;miles</strong> — close enough for a weekly
              drive in most parts of Idaho. Therapists outside the radius
              still appear if they offer telehealth.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="City">
              <Input
                value={data.location_city}
                onChange={(e) => set("location_city", e.target.value)}
                placeholder="e.g. Boise"
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                data-testid="city-input"
              />
            </Field>
            <Field label="ZIP code (recommended)">
              <Input
                inputMode="numeric"
                maxLength={5}
                value={data.location_zip}
                onChange={(e) => {
                  const z = e.target.value.replace(/\D/g, "").slice(0, 5);
                  set("location_zip", z);
                  if (z.length === 5 && !zipMatchesState(z, data.location_state)) {
                    setZipError(
                      `ZIP ${z} doesn't appear to be in ${data.location_state}. Please double-check.`,
                    );
                  } else {
                    setZipError("");
                  }
                }}
                placeholder="83702"
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                data-testid="zip-input"
              />
              {zipError && (
                <p
                  className="mt-1.5 text-xs text-[#D45D5D]"
                  data-testid="zip-error"
                >
                  {zipError}
                </p>
              )}
            </Field>
          </div>
          {data.modality_preference === "prefer_inperson" && (
            <label
              className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition"
              data-testid="distance-strict-row"
            >
              <Checkbox
                checked={data.modality_preference === "in_person_only"}
                onCheckedChange={(v) =>
                  set(
                    "modality_preference",
                    v ? "in_person_only" : "prefer_inperson",
                  )
                }
                className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                data-testid="distance-strict-toggle"
              />
              <span className="text-sm text-[#2B2A29] leading-relaxed">
                <strong>Hard requirement:</strong> only show therapists
                with an office within 30 miles AND who offer in-person.{" "}
                <span className="text-[#6D6A65]">
                  Off (default) means telehealth-friendly therapists
                  outside the radius can still appear.
                </span>
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}
