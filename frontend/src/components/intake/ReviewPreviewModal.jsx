import useSiteCopy from "@/lib/useSiteCopy";
import { P1_OPTIONS, P2_OPTIONS } from "@/components/intake/deepMatchOptions";
import {
  CLIENT_TYPES,
  AGE_GROUPS,
  ISSUES,
  MODALITY,
  AVAILABILITY,
  URGENCY,
  PRIOR_THERAPY,
  EXPERIENCE,
  GENDERS,
  STYLES,
} from "@/components/intake/steps/intakeOptions";

/**
 * Pre-submit review modal — shows the full request the patient is
 * about to send so they can scan it once before committing. Edit
 * goes back to the form (just closes the modal); Submit triggers
 * the actual POST.
 *
 * Extracted from IntakeForm.jsx to keep the orchestration component
 * focused on state/validation/navigation. Visual + copy unchanged.
 */
export default function ReviewPreviewModal({
  data,
  submitting,
  onClose,
  onConfirm,
  onToggleReceipt,
}) {
  const t = useSiteCopy();
  const issues = (data.presenting_issues || []).join(", ");
  const insurance =
    data.payment_type === "insurance" || data.payment_type === "either"
      ? data.insurance_name === "Other / not listed" &&
        (data.insurance_name_other || "").trim()
        ? `Other: ${data.insurance_name_other.trim()}`
        : data.insurance_name || "—"
      : "Not using insurance";
  const cash =
    data.payment_type === "cash" || data.payment_type === "either"
      ? data.budget
        ? `$${data.budget}/session`
        : "—"
      : "—";
  // Map enum values back to human labels using the same arrays the
  // form uses, so the preview never surfaces raw slugs like
  // "weekday_evening" or "in_person_only" to the patient.
  const lookup = (arr, v) =>
    (arr || []).find((x) => x.v === v)?.l || v || "—";
  const lookupMany = (arr, vs) =>
    (vs || []).map((v) => lookup(arr, v)).join(", ") || "—";

  const referralLine =
    data.referral_source === "Other" && data.referral_source_other
      ? `Other: ${data.referral_source_other}`
      : data.referral_source || "—";
  const notes = (data.notes || "").trim();
  // Which rows count as "hard requirements" for this referral.
  // Always-hard fields are flagged unconditionally. Patient-toggleable
  // hards (insurance, format/distance, availability, urgency) only get
  // the badge when the patient ticked the corresponding `*_strict` box
  // on the form.
  const isInPersonHard = data.modality_preference === "in_person_only";
  const isGenderHard =
    !!data.gender_required &&
    data.gender_preference &&
    data.gender_preference !== "no_pref";
  const hardRows = new Set([
    "Who this referral is for", // client_type — always hard
    "Age group",                // always hard
    "Location",                 // state license — always hard
    "Concerns",                 // primary concern — always hard
    ...(data.insurance_strict ? ["Insurance"] : []),
    ...(isInPersonHard ? ["Session format"] : []),
    ...(data.availability_strict ? ["Availability"] : []),
    ...(data.urgency_strict ? ["Urgency"] : []),
    ...(isGenderHard ? ["Preferred gender"] : []),
    ...(data.language_strict &&
      data.preferred_language &&
      data.preferred_language !== "English"
      ? ["Preferred language"]
      : []),
  ]);
  const rows = [
    ["Who this referral is for", lookup(CLIENT_TYPES, data.client_type)],
    ["Age group", lookup(AGE_GROUPS, data.age_group)],
    [
      "Location",
      `${data.location_city || "—"}${
        data.location_zip ? `, ${data.location_zip}` : ""
      } (${data.location_state})`,
    ],
    ["Concerns", lookupMany(ISSUES, data.presenting_issues) || issues || "—"],
    ["Session format", lookup(MODALITY, data.modality_preference)],
    ["Insurance", insurance],
    ["Cash budget", cash],
    ["Availability", lookupMany(AVAILABILITY, data.availability_windows)],
    ["Urgency", lookup(URGENCY, data.urgency)],
    ["Therapy history", lookup(PRIOR_THERAPY, data.prior_therapy)],
    ["Preferred gender", lookup(GENDERS, data.gender_preference) || "Any"],
    [
      "Therapist experience",
      lookupMany(EXPERIENCE, data.experience_preference) || "Any",
    ],
    ["Preferred language", data.preferred_language || "English"],
    ["Style preferences", lookupMany(STYLES, data.style_preference) || "—"],
    [
      "Therapy approaches",
      (data.modality_preferences || []).join(", ") || "—",
    ],
    ["Referred by", referralLine],
    ["Email", data.email || "—"],
    ["Phone", data.phone || "—"],
    ...(data.other_issue ? [["Anything else", data.other_issue]] : []),
  ];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
      data-testid="intake-preview-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-[#E8E5DF] w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-[#E8E5DF] p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
              Almost there
            </p>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-0.5">
              Review your referral
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6D6A65] hover:text-[#2D4A3E] text-sm"
            data-testid="intake-preview-close"
          >
            ✕
          </button>
        </div>
        <div className="p-5 sm:p-6">
          {/* Final-submit warning. Lives at the very top so the patient
              sees it before they read through their answers, not after.
              Submitting locks the request — admins can edit later, but
              the patient has no self-serve edit flow. */}
          <div
            className="mb-4 rounded-xl bg-[#FBF2E8] border border-[#F0DEC8] px-4 py-3 flex items-start gap-3"
            data-testid="intake-preview-lock-warning"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#B8742A] text-white flex items-center justify-center text-xs font-bold">
              !
            </span>
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-[#8B5A1F]">
                {t(
                  "intake.preview.warning.heading",
                  "Once you submit, this can't be changed.",
                )}
              </p>
              <p className="text-[#8B5A1F]/85 text-xs mt-1">
                {t(
                  "intake.preview.warning.body",
                  "Please double-check your answers below before submitting. If something needs to change later, just email us and we'll resend a corrected match.",
                )}
              </p>
            </div>
          </div>
          <p className="text-sm text-[#6D6A65] leading-relaxed">
            Take a quick look — therapists will only see this anonymized
            version (no contact info shared until you reach out).
          </p>
          <div
            className="mt-3 flex items-center gap-2 text-xs text-[#2B2A29] bg-[#FBE9E5] border border-[#F4C7BE] rounded-lg px-3 py-2"
            data-testid="intake-preview-hard-legend"
          >
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-2 py-0.5">
              HARD
            </span>
            <span className="leading-snug">
              Fields marked HARD are filters — therapists must match them
              exactly to appear in your results.
            </span>
          </div>
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {rows.map(([label, value]) => {
              const isHard = hardRows.has(label);
              return (
                <div
                  key={label}
                  className={
                    isHard
                      ? "rounded-lg bg-[#FBE9E5] border border-[#F4C7BE] px-3 py-2 -mx-1"
                      : ""
                  }
                  data-testid={`intake-preview-row-${label
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <dt className="text-[10px] uppercase tracking-wider text-[#6D6A65] flex items-center gap-1.5">
                    {label}
                    {isHard && (
                      <span
                        className="inline-flex text-[9px] font-semibold tracking-wider text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-1.5 py-[1px]"
                        title="This is a hard filter — therapists must match exactly"
                      >
                        HARD
                      </span>
                    )}
                  </dt>
                  <dd className="text-[#2B2A29] font-medium leading-snug break-words mt-1">
                    {value || "—"}
                  </dd>
                </div>
              );
            })}
            {notes && (
              <div className="sm:col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                  Notes you shared
                </dt>
                <dd className="text-[#2B2A29] leading-relaxed mt-1 whitespace-pre-wrap">
                  {notes}
                </dd>
              </div>
            )}
          </dl>
          {/* Deep-match answers (P1/P2/P3). Only rendered when the
              patient opted into the deeper flow. Visually separated
              from the standard rows so the patient can see at a glance
              which extra signals will boost their match scoring. */}
          {data.deep_match_opt_in && (
            <div
              className="mt-6 rounded-2xl bg-[#FBE9E5] border border-[#F4C7BE] p-4 sm:p-5"
              data-testid="intake-preview-deep-section"
            >
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#C8412B] font-semibold">
                ✦ Deep match · 3 extra answers
              </p>
              <p className="text-xs text-[#2B2A29]/80 mt-1 mb-4 leading-relaxed">
                These will boost your matching scores on Relationship Style,
                Way of Working, and Contextual Resonance.
              </p>
              <dl className="space-y-4 text-sm">
                <div data-testid="intake-preview-row-p1">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Relationship style (P1)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-snug">
                    {(data.p1_communication || []).length
                      ? (data.p1_communication || [])
                          .map(
                            (v) =>
                              P1_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div data-testid="intake-preview-row-p2">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Way of working (P2)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-snug">
                    {(data.p2_change || []).length
                      ? (data.p2_change || [])
                          .map(
                            (v) =>
                              P2_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div data-testid="intake-preview-row-p3">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    What they should already get (P3)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-relaxed whitespace-pre-wrap">
                    {(data.p3_resonance || "").trim() || (
                      <span className="text-[#6D6A65] italic">
                        Skipped — that's okay.
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-[#E8E5DF] p-5">
          {/* Email-receipt opt-in. Patients can't self-edit a request
              once submitted, so this checkbox lets them keep a paper
              trail with all the same fields they're about to confirm. */}
          <label
            className="flex items-start gap-2.5 mb-3 text-sm cursor-pointer"
            data-testid="intake-preview-receipt-toggle"
          >
            <input
              type="checkbox"
              checked={!!data.email_receipt}
              onChange={(e) =>
                onToggleReceipt && onToggleReceipt(e.target.checked)
              }
              className="mt-0.5 accent-[#2D4A3E]"
              data-testid="intake-preview-receipt-checkbox"
            />
            <span className="text-[#2B2A29] leading-snug">
              <span className="font-medium">
                📧 Send me a copy of my answers
              </span>
              <span className="block text-xs text-[#6D6A65] mt-0.5">
                Useful as a record — you can forward it back to us if you
                spot something to correct after submitting.
              </span>
            </span>
          </label>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={onClose}
              className="tv-btn-secondary"
              data-testid="intake-preview-edit"
            >
              {t("btn.intake.preview_edit", "← Edit answers")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={onConfirm}
              className="tv-btn-primary disabled:opacity-50"
              data-testid="intake-preview-submit"
            >
              {submitting
                ? "Submitting..."
                : t("btn.intake.preview_submit", "Confirm & find my matches")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
