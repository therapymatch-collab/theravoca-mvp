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
  referralSourceError,
  retryReferralSources,
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
      .catch((e) => {
        // Returning-patient prefill is a nice-to-have; failure here
        // shouldn't pop a toast (the patient hasn't asked for anything
        // -- it's a background lookup on email change). But log so
        // future debugging isn't blind: a real backend issue here
        // means returning patients re-type data they already gave us.
        // 2026-05-18: was bare ".catch(() => {})" -- swapped for a
        // logged catch.
        // eslint-disable-next-line no-console
        console.warn("intake prefill lookup failed:", e?.message);
      });
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
      {/* Phone + SMS opt-in hidden 2026-05-14 -- TheraVoca currently
          reserves SMS for cold-recruit outreach to therapists we can't
          reach by email. Patients always have email; an SMS receipt
          isn't worth the cost and intrusion. Restore this block to
          bring back the option. `phone` and `sms_opt_in` defaults in
          the form data layer are still in place, so re-enabling is
          purely a UI restore. */}
      <Field label="How did you hear about us?">
        {referralSourceError ? (
          <div className="rounded-xl border border-[#D45D5D]/30 bg-[#D45D5D]/5 px-4 py-3 text-sm text-[#6D6A65]">
            <p>Couldn't load form options. Please refresh the page or try again.</p>
            <button
              type="button"
              onClick={retryReferralSources}
              className="mt-2 text-sm font-medium text-[#3B7A6E] underline underline-offset-2 hover:text-[#2B6259]"
            >
              Retry
            </button>
          </div>
        ) : (
        <Select
          value={data.referral_source}
          onValueChange={(v) => set("referral_source", v)}
        >
          <SelectTrigger
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="referral-source-trigger"
          >
            <SelectValue placeholder="Select an option..." />
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
        )}
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
