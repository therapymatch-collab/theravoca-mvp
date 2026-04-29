import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Group, Field, PillRow } from "@/components/intake/IntakeUI";
import { PATIENT_INSURER_OPTIONS } from "@/lib/insurers";
import { PAYMENT } from "./intakeOptions";

/**
 * Step "payment" — how the client wants to pay (insurance / cash /
 * either) plus conditional sub-fields:
 *  - insurance plan picker + free-text "Other" + optional hard
 *    "in-network only" toggle
 *  - cash budget input + optional sliding-scale opt-in
 */
export default function PaymentStep({ data, set }) {
  return (
    <div className="space-y-5">
      <Group label="How would the client like to pay?">
        <PillRow
          items={PAYMENT}
          selected={[data.payment_type]}
          onSelect={(v) => set("payment_type", v)}
          testid="payment"
        />
      </Group>
      {(data.payment_type === "insurance" ||
        data.payment_type === "either") && (
        <Field label="Insurance plan">
          <Select
            value={data.insurance_name}
            onValueChange={(v) => set("insurance_name", v)}
          >
            <SelectTrigger
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="insurance-select"
            >
              <SelectValue placeholder="Select your insurance" />
            </SelectTrigger>
            <SelectContent>
              {PATIENT_INSURER_OPTIONS.map((ins) => (
                <SelectItem key={ins} value={ins}>
                  {ins}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data.insurance_name === "Other / not listed" && (
            <div className="mt-3">
              <Input
                value={data.insurance_name_other}
                onChange={(e) => set("insurance_name_other", e.target.value)}
                placeholder="Type the plan name (e.g., Pacific Source Medicare Advantage)"
                maxLength={80}
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                data-testid="insurance-other-input"
              />
              <p className="text-[11px] text-[#6D6A65] mt-1.5 leading-snug">
                We&rsquo;ll pass this exact wording to the matched
                therapists so they can confirm in-network status before
                booking.
              </p>
            </div>
          )}
        </Field>
      )}
      {data.payment_type === "insurance" && data.insurance_name && (
        <label
          className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition"
          data-testid="insurance-strict-row"
        >
          <Checkbox
            checked={data.insurance_strict}
            onCheckedChange={(v) => set("insurance_strict", !!v)}
            className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
            data-testid="insurance-strict-toggle"
          />
          <span className="text-sm text-[#2B2A29] leading-relaxed">
            <strong>Hard requirement:</strong> only show therapists who
            explicitly accept this insurance.{" "}
            <span className="text-[#6D6A65]">
              Off (default) means out-of-network therapists can still
              appear if they're a strong fit.
            </span>
          </span>
        </label>
      )}
      {(data.payment_type === "cash" || data.payment_type === "either") && (
        <>
          <Field label="Maximum budget per session (USD)">
            <Input
              type="number"
              value={data.budget}
              onChange={(e) => set("budget", e.target.value)}
              placeholder="e.g. 175"
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="budget-input"
            />
          </Field>
          <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
            <Checkbox
              checked={data.sliding_scale_ok}
              onCheckedChange={(v) => set("sliding_scale_ok", v)}
              className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
              data-testid="sliding-scale-ok"
            />
            <span className="text-sm text-[#2B2A29] leading-relaxed">
              Open to sliding-scale fees — show me therapists who offer
              rate flexibility, even if their standard rate is above my
              budget.
            </span>
          </label>
        </>
      )}
    </div>
  );
}
