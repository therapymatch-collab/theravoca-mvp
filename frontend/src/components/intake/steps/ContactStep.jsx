import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, CheckRow } from "@/components/intake/IntakeUI";
import { formatUsPhone } from "@/lib/phone";
import { api } from "@/lib/api";

/**
 * Step "contact" — final step before submit. Email + optional SMS
 * receipt + referral source + the three required confirmation
 * checkboxes (terms, 18+, not an emergency).
 *
 * On email blur we prefill stable fields from the patient's most
 * recent prior request via GET /api/requests/prefill — silent
 * failure, nice-to-have UX.
 */
export default function ContactStep({
  data,
  set,
  setData,
  emailLooksOk,
  agreed,
  setAgreed,
  confirmAdult,
  setConfirmAdult,
  confirmNotEmergency,
  setConfirmNotEmergency,
  referralSourceOptions,
  t,
}) {
  const handleEmailBlur = () => {
    // Returning-patient prefill: if this email has filed a prior
    // request, pull stable fields (referral source, zip, language
    // preference, age group, gender preference) so they don't have
    // to re-answer. Silent failure.
    if (!emailLooksOk(data.email)) return;
    api
      .get(`/requests/prefill?email=${encodeURIComponent(data.email)}`)
      .then((r) => {
        const pre = r.data?.prefill;
        if (!r.data?.returning || !pre) return;
        setData((d) => {
          // Only fill fields the patient hasn't already touched
          const merged = { ...d };
          const fields = [
            "referral_source",
            "zip_code",
            "preferred_language",
            "age_group",
            "gender_preference",
          ];
          let changed = 0;
          for (const k of fields) {
            if (!merged[k] && pre[k]) {
              merged[k] = pre[k];
              changed += 1;
            }
          }
          if (changed > 0 && !merged._prefilled_notice_shown) {
            merged._prefilled_notice_shown = true;
          }
          return merged;
        });
        if (Object.values(pre).some(Boolean)) {
          toast.info(
            "Welcome back — we've pre-filled a few fields from your last request. Review and change any if needed.",
            { duration: 6000 },
          );
        }
      })
      .catch(() => {});
  };

  return (
    <div className="space-y-5">
      <Field label="Your email (we'll send your matches here)">
        <Input
          type="email"
          value={data.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={handleEmailBlur}
          placeholder="you@example.com"
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid="email-input"
        />
        {data.email && !emailLooksOk(data.email) && (
          <p
            className="mt-1.5 text-xs text-[#D45D5D]"
            data-testid="email-error"
          >
            Please use a valid personal email — disposable / temp
            addresses aren't accepted.
          </p>
        )}
      </Field>
      <Field label="Phone (optional — for an instant text receipt)">
        <Input
          type="tel"
          inputMode="tel"
          maxLength={12}
          value={data.phone}
          onChange={(e) => set("phone", formatUsPhone(e.target.value))}
          placeholder="208-555-0123"
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid="phone-input"
        />
        {data.phone && (
          <label className="flex items-start gap-3 mt-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 cursor-pointer hover:border-[#2D4A3E] transition">
            <Checkbox
              checked={data.sms_opt_in}
              onCheckedChange={(v) => set("sms_opt_in", !!v)}
              className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
              data-testid="sms-opt-in"
            />
            <span className="text-sm text-[#2B2A29] leading-relaxed">
              Text me a quick receipt confirming my referral was
              received. We'll never share your number. Reply STOP
              anytime.
            </span>
          </label>
        )}
      </Field>
      <Field label="How did you hear about us?">
        <Select
          value={data.referral_source}
          onValueChange={(v) => set("referral_source", v)}
        >
          <SelectTrigger
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="referral-source-trigger"
          >
            <SelectValue placeholder="Select an option…" />
          </SelectTrigger>
          <SelectContent>
            {referralSourceOptions.map((opt) => (
              <SelectItem
                key={opt}
                value={opt}
                data-testid={`referral-source-${opt
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")}`}
              >
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {data.referral_source === "Other" && (
        <Field label="Please specify">
          <Input
            value={data.referral_source_other || ""}
            onChange={(e) => set("referral_source_other", e.target.value)}
            placeholder="e.g. saw your booth at..."
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="referral-source-other-input"
          />
        </Field>
      )}
      <div className="space-y-3 pt-2">
        <CheckRow
          id="agree"
          checked={agreed}
          onChange={setAgreed}
          label={
            <>
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="text-[#2D4A3E] underline hover:no-underline"
                data-testid="agree-terms-link"
              >
                terms of use
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-[#2D4A3E] underline hover:no-underline"
                data-testid="agree-privacy-link"
              >
                privacy notice
              </a>
              .
            </>
          }
          testid="agree-terms"
        />
        <CheckRow
          id="adult"
          checked={confirmAdult}
          onChange={setConfirmAdult}
          label={t("intake.final.adult", "I confirm I am 18 or older.")}
          testid="confirm-adult"
        />
        <CheckRow
          id="emergency"
          checked={confirmNotEmergency}
          onChange={setConfirmNotEmergency}
          label={t(
            "intake.final.not_emergency",
            "I confirm this is not an emergency.",
          )}
          testid="confirm-emergency"
        />
      </div>
    </div>
  );
}
