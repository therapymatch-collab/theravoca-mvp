import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Group, Field, PillRow, PillCol } from "@/components/intake/IntakeUI";
import { AVAILABILITY, URGENCY, PRIOR_THERAPY } from "./intakeOptions";

/**
 * Step "logistics" — availability windows + optional hard schedule
 * filter, urgency + optional hard urgency filter, prior-therapy
 * status + conditional notes textarea (only for "yes_helped" /
 * "yes_not_helped" so the patient can describe what worked / what
 * didn't).
 */
export default function LogisticsStep({ data, set, toggleArr, hardCapacity }) {
  const hc = hardCapacity || { isDisabled: () => false, reasonFor: () => "" };
  const urgencyHardDisabled = hc.isDisabled("urgency_strict", data.urgency);
  const urgencyReason = hc.reasonFor("urgency_strict", data.urgency);
  return (
    <div className="space-y-6">
      <Group
        label="When is the client generally available?"
        hint="Select all that apply"
      >
        <PillRow
          items={AVAILABILITY}
          selected={data.availability_windows}
          onSelect={(v) => toggleArr("availability_windows", v)}
          testid="availability"
        />
      </Group>
      {data.availability_windows.length > 0 &&
        !data.availability_windows.includes("flexible") && (
          <label
            className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition -mt-3"
            data-testid="availability-strict-row"
          >
            <Checkbox
              checked={data.availability_strict}
              onCheckedChange={(v) => set("availability_strict", !!v)}
              className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
              data-testid="availability-strict-toggle"
            />
            <span className="text-sm text-[#2B2A29] leading-relaxed">
              <strong>Hard requirement:</strong> only show therapists
              whose published schedule overlaps these windows.
            </span>
          </label>
        )}
      <Group label="How soon to start?">
        <PillRow
          items={URGENCY}
          selected={[data.urgency]}
          onSelect={(v) => set("urgency", v)}
          testid="urgency"
        />
      </Group>
      {data.urgency && data.urgency !== "flexible" && (
        <label
          className={`flex items-start gap-3 border rounded-xl px-4 py-3 transition -mt-3 ${
            urgencyHardDisabled
              ? "bg-[#F2EFE9] border-[#E8E5DF] cursor-not-allowed opacity-60"
              : "bg-[#FDFBF7] border-[#E8E5DF] cursor-pointer hover:border-[#2D4A3E]"
          }`}
          data-testid="urgency-strict-row"
        >
          <Checkbox
            checked={!urgencyHardDisabled && data.urgency_strict}
            disabled={urgencyHardDisabled}
            onCheckedChange={(v) => !urgencyHardDisabled && set("urgency_strict", !!v)}
            className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
            data-testid="urgency-strict-toggle"
          />
          <span className="text-sm text-[#2B2A29] leading-relaxed">
            <strong>Hard requirement:</strong> only show therapists who
            can start within this timeframe.
            {urgencyHardDisabled && (
              <span className="block mt-1 text-xs text-[#B37E35]">
                {urgencyReason || "Too few therapists have openings in this timeframe right now — we'll still prioritise them, but can't make it a hard filter."}
              </span>
            )}
          </span>
        </label>
      )}
      <Group label="Has the client been in therapy before?">
        <PillCol
          items={PRIOR_THERAPY}
          selected={[data.prior_therapy]}
          onSelect={(v) => set("prior_therapy", v)}
          testid="prior-therapy"
        />
      </Group>
      {(data.prior_therapy === "yes_helped" ||
        data.prior_therapy === "yes_not_helped") && (
        <Field
          label={
            data.prior_therapy === "yes_helped"
              ? "What worked? Anything you'd want again from a new therapist? (optional)"
              : "What didn't work last time? Anything you'd want different this time? (optional)"
          }
        >
          <Textarea
            rows={3}
            value={data.prior_therapy_notes}
            onChange={(e) => set("prior_therapy_notes", e.target.value)}
            maxLength={600}
            placeholder={
              data.prior_therapy === "yes_helped"
                ? "e.g. CBT homework, weekly cadence, direct feedback style…"
                : "e.g. felt rushed, talked over me, only generic advice…"
            }
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="prior-notes"
          />
          <p className="text-[11px] text-[#6D6A65] mt-1.5 leading-snug">
            We feed this into matching so therapists who fit what you
            valued (or avoid what didn't work) rank higher.
          </p>
        </Field>
      )}
    </div>
  );
}
