import { ArrowRight, X } from "lucide-react";
import credentialLabel from "@/lib/credentialLabel";
import {
  T4_OPTIONS,
  T6_OPTIONS,
} from "@/pages/therapist/deepMatchOptions";
import { SummaryRow } from "@/pages/therapist/TherapistSignupUI";

/**
 * Pre-submit preview modal for the therapist signup wizard.
 *
 * Shows the therapist exactly what their patient-facing profile +
 * matching-engine inputs look like before they hit "Submit". Split
 * into three visual sections:
 *   1. Card header (avatar + name + credential + experience headline)
 *   2. Public profile summary (everything patients will see)
 *   3. Deep-match answers (T6/T6b/T2/T4/T5, with the "private — patients
 *      never see these" reassurance and an "edit later in your portal" pill)
 *
 * Extracted from TherapistSignup.jsx to keep that file focused on
 * orchestration. Visual + copy unchanged.
 */
export default function PreviewModal({ data, onClose, onConfirm, submitting }) {
  const formats = {
    telehealth: "Telehealth only",
    in_person: "In-person only",
    both: "Telehealth + in-person",
  };
  // Slug → human-readable label lookups so the deep-match summary
  // shows exactly what the therapist selected (not snake_case slugs).
  const labelFromList = (list, slug) =>
    list.find((o) => o.v === slug)?.l || slug;
  const t4Label = (slug) => labelFromList(T4_OPTIONS, slug);
  const t6Label = (slug) => labelFromList(T6_OPTIONS, slug);
  const tier = (issue) => {
    if (data.primary_specialties.includes(issue)) return "Primary";
    if (data.secondary_specialties.includes(issue)) return "Secondary";
    if (data.general_treats.includes(issue)) return "General";
    return null;
  };
  const allIssues = [
    ...data.primary_specialties,
    ...data.secondary_specialties,
    ...data.general_treats,
  ];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      data-testid="signup-preview-modal"
    >
      <div className="bg-white rounded-3xl border border-[#E8E5DF] max-w-2xl w-full p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
              Profile preview
            </p>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-1">
              How patients will see you
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1.5 max-w-md">
              Verify everything looks right before submitting. You can edit
              your profile (including the deep-match answers) any time
              from your portal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6D6A65] hover:text-[#2D4A3E] -m-2 p-2"
            data-testid="signup-preview-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex gap-4">
          <div className="w-16 h-16 rounded-full bg-white border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0">
            {data.profile_picture ? (
              <img
                src={data.profile_picture}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-serif-display text-base text-[#2D4A3E]">
                {(data.name || "")
                  .split(",")[0]
                  .split(" ")
                  .filter(Boolean)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "T"}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-serif-display text-xl text-[#2D4A3E] truncate">
              {data.name || "—"}
            </h4>
            <div className="text-xs text-[#6D6A65] mt-0.5 break-words">
              {data.credential_type && (
                <span className="text-[#2B2A29] font-medium">
                  {credentialLabel(data.credential_type)}
                </span>
              )}
              {data.credential_type &&
                (data.years_experience != null ||
                  (data.modalities || []).length > 0) &&
                " · "}
              {data.years_experience != null
                ? `${data.years_experience} year${
                    data.years_experience === 1 ? "" : "s"
                  } experience`
                : !data.credential_type && "Experience: —"}{" "}
              {(data.years_experience != null || data.credential_type) &&
                (data.modalities || []).length > 0 &&
                "• "}
              {(data.modalities || []).slice(0, 3).join(" · ")}
            </div>
          </div>
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <SummaryRow label="Email" value={data.email} />
          <SummaryRow label="Credential" value={data.credential_type} />
          <SummaryRow label="License #" value={data.license_number} />
          <SummaryRow label="License expires" value={data.license_expires_at} />
          <SummaryRow
            label="Office phone (public)"
            value={data.office_phone || "—"}
          />
          <SummaryRow
            label="Alert phone (private)"
            value={data.phone_alert || data.phone}
          />
          <SummaryRow label="Gender" value={data.gender} />
          <SummaryRow
            label="Format"
            value={formats[data.modality_offering] || data.modality_offering}
          />
          <SummaryRow
            label="Cash rate"
            value={data.cash_rate ? `$${data.cash_rate}` : "—"}
          />
          <SummaryRow
            label="Sliding scale"
            value={data.sliding_scale ? "Yes" : "No"}
          />
          <SummaryRow
            label="Free consult"
            value={data.free_consult ? "Yes" : "No"}
          />
          <SummaryRow
            label="Caseload"
            value={data.urgency_capacity?.replace(/_/g, " ")}
          />
          <SummaryRow
            label="Client types"
            value={data.client_types?.join(", ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Age groups"
            value={
              (data.age_groups || []).map((a) => a.replace(/_/g, " ")).join(", ") ||
              "—"
            }
            span={2}
          />
          <SummaryRow
            label="Specialties"
            value={
              allIssues.length > 0
                ? allIssues
                    .map((i) => `${i.replace(/_/g, " ")} (${tier(i)})`)
                    .join(", ")
                : "—"
            }
            span={2}
          />
          <SummaryRow
            label="Modalities"
            value={(data.modalities || []).join(", ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Offices"
            value={
              (data.office_addresses || data.office_locations || []).join(" · ") ||
              "—"
            }
            span={2}
          />
          <SummaryRow
            label="Insurance"
            value={(data.insurance_accepted || []).join(", ") || "Cash / OON"}
            span={2}
          />
          <SummaryRow
            label="Availability"
            value={
              (data.availability_windows || [])
                .map((w) => w.replace(/_/g, " "))
                .join(", ") || "—"
            }
            span={2}
          />
          <SummaryRow
            label="Style"
            value={
              (data.style_tags || []).map((s) => s.replace(/_/g, " ")).join(", ") ||
              "—"
            }
            span={2}
          />
          {data.bio && <SummaryRow label="Bio" value={data.bio} span={2} />}
        </div>

        {/* Deep-match answers preview — shown below the patient-facing
            summary so therapists can sanity-check the T1–T5 answers
            that drive the matching engine. Patients never see these. */}
        <div
          className="mt-6 bg-[#FBF5F2] border border-[#EBD5CB] rounded-2xl p-5"
          data-testid="signup-preview-deep-match"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#A8553F] font-semibold">
                ✦ Deep-match answers
              </p>
              <h4 className="font-serif-display text-lg text-[#2D4A3E] mt-0.5">
                Style fit (private — patients never see these)
              </h4>
            </div>
            <span className="text-[10px] uppercase tracking-wider bg-white border border-[#EBD5CB] text-[#A8553F] rounded-full px-2 py-0.5">
              You can edit later in your portal
            </span>
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <SummaryRow
              label="T6 — What sessions 1–3 look like"
              value={
                (data.t6_session_expectations || [])
                  .map((s) => t6Label(s))
                  .join("  ·  ") || "—"
              }
              span={2}
            />
            <SummaryRow
              label="T6b — Early sessions in your own words"
              value={data.t6_early_sessions_description || "—"}
              span={2}
            />
            <SummaryRow
              label="T4 — Pushing past comfort zone"
              value={data.t4_hard_truth ? t4Label(data.t4_hard_truth) : "—"}
              span={2}
            />
            <SummaryRow
              label="T5 — Lived experience / community knowledge"
              value={data.t5_lived_experience || "—"}
              span={2}
            />
          </div>
        </div>

        {data.license_picture && (
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
              License upload (admin verification)
            </div>
            <img
              src={data.license_picture}
              alt="License upload"
              className="max-h-40 rounded-lg border border-[#E8E5DF]"
            />
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            className="tv-btn-secondary !py-2 !px-4 text-sm"
            onClick={onClose}
            data-testid="signup-preview-back"
          >
            Back to edit
          </button>
          <button
            type="button"
            className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting}
            onClick={onConfirm}
            data-testid="signup-preview-confirm"
          >
            {submitting ? "Submitting..." : "Looks good — submit"}{" "}
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
                                                                                                                                                                       