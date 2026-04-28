import { useState } from "react";
import { CheckCircle2, XCircle, Pencil } from "lucide-react";

export default function PendingSignupRow({ t, onApprove, onReject, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const specs = (t.specialties || []).map((s) =>
    typeof s === "string" ? s : `${s.name || s.value || ""}${s.weight ? ` (w${s.weight})` : ""}`,
  );
  const generalTreats = t.general_treats || [];
  const offices = t.office_addresses?.length ? t.office_addresses : t.office_locations || [];
  return (
    <div className="p-5 hover:bg-[#FDFBF7]" data-testid={`pending-row-${t.id}`}>
      <div className="flex items-start gap-5">
        {/* License picture preview */}
        <div className="shrink-0">
          {t.license_picture ? (
            <a href={t.license_picture} target="_blank" rel="noopener noreferrer">
              <img
                src={t.license_picture}
                alt="License"
                className="w-20 h-24 object-cover rounded-lg border border-[#E8E5DF] hover:border-[#2D4A3E] transition"
                data-testid={`license-thumb-${t.id}`}
              />
            </a>
          ) : (
            <div className="w-20 h-24 bg-[#FDFBF7] border border-dashed border-[#E8E5DF] rounded-lg flex items-center justify-center text-[10px] text-[#C8C4BB] text-center p-1">
              No license
              <br />
              uploaded
            </div>
          )}
        </div>

        {/* Core identity + quick stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h4 className="font-medium text-[#2B2A29] text-base">{t.name}</h4>
            {t.credential_type && (
              <span className="text-xs text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-full px-2 py-0.5">
                {t.credential_type}
              </span>
            )}
            <span className="text-xs text-[#6D6A65] break-all">{t.email}</span>
            {t.phone && (
              <span className="text-xs text-[#6D6A65]">· {t.phone}</span>
            )}
          </div>
          <div className="text-xs text-[#6D6A65] mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{t.years_experience ?? "?"} yrs exp</span>
            <span>
              Licensed:{" "}
              {t.license_number || "—"}
              {t.license_expires_at && ` · exp ${t.license_expires_at}`}
            </span>
            <span>${t.cash_rate}/session{t.sliding_scale && " (sliding)"}</span>
            <span>
              {t.modality_offering === "both"
                ? "In-person + telehealth"
                : t.modality_offering === "in_person"
                  ? "In-person"
                  : "Telehealth"}
            </span>
            {t.gender && t.gender !== "prefer_not_to_say" && (
              <span>{t.gender}</span>
            )}
          </div>

          {/* Bio preview */}
          {t.bio && (
            <p className="text-sm text-[#2B2A29] mt-3 leading-relaxed bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2">
              {expanded ? t.bio : (t.bio.length > 240 ? t.bio.slice(0, 237) + "…" : t.bio)}
            </p>
          )}

          {/* Collapsed one-liners */}
          {!expanded && (
            <div className="text-xs text-[#6D6A65] mt-3 flex flex-wrap gap-x-3 gap-y-1">
              <span>
                <strong className="text-[#2B2A29]">Specialties:</strong>{" "}
                {specs.slice(0, 4).join(", ") || "—"}
                {specs.length > 4 && ` +${specs.length - 4} more`}
              </span>
              <span>
                <strong className="text-[#2B2A29]">Modalities:</strong>{" "}
                {(t.modalities || []).slice(0, 3).join(", ") || "—"}
              </span>
              <span>
                <strong className="text-[#2B2A29]">Insurance:</strong>{" "}
                {(t.insurance_accepted || []).slice(0, 3).join(", ") || "Cash only"}
              </span>
              <span>
                <strong className="text-[#2B2A29]">Ages:</strong>{" "}
                {(t.age_groups || t.ages_served || []).join(", ") || "—"}
              </span>
            </div>
          )}

          {/* Expanded full side-panel view */}
          {expanded && (
            <div className="mt-4 grid md:grid-cols-2 gap-4 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4">
              <Block label="Primary specialties">
                {(t.primary_specialties || []).join(", ") || "—"}
              </Block>
              <Block label="Secondary specialties">
                {(t.secondary_specialties || []).join(", ") || "—"}
              </Block>
              <Block label="Weighted specialties (signup order)">
                {specs.join(", ") || "—"}
              </Block>
              <Block label="General treats">
                {generalTreats.join(", ") || "—"}
              </Block>
              <Block label="Modalities">
                {(t.modalities || []).join(", ") || "—"}
              </Block>
              <Block label="Age groups">
                {(t.age_groups || t.ages_served || []).join(", ") || "—"}
              </Block>
              <Block label="Client types">
                {(t.client_types || []).join(", ") || "—"}
              </Block>
              <Block label="Availability windows">
                {(t.availability_windows || []).join(", ") || "—"}
              </Block>
              <Block label="Urgency capacity">{t.urgency_capacity || "—"}</Block>
              <Block label="Insurance accepted">
                {(t.insurance_accepted || []).join(", ") || "Cash only"}
              </Block>
              <Block label="Languages">
                {(t.languages_spoken || ["English"]).join(", ")}
              </Block>
              <Block label="Office addresses">
                {offices.length ? (
                  <div className="space-y-1">
                    {offices.map((a, i) => (
                      <div key={`addr-${typeof a === "string" ? a : a?.address || i}`}>
                        {typeof a === "string" ? a : a?.address}
                      </div>
                    ))}
                  </div>
                ) : (
                  "Telehealth only"
                )}
              </Block>
              <Block label="Office phone">{t.office_phone || "—"}</Block>
              <Block label="Website">
                {t.website ? (
                  <a
                    href={t.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2D4A3E] underline break-all"
                  >
                    {t.website}
                  </a>
                ) : (
                  "—"
                )}
              </Block>
              <Block label="Licensed states">
                {(t.licensed_states || []).join(", ") || "—"}
              </Block>
              <Block label="Style tags">
                {(t.style_tags || []).join(", ") || "—"}
              </Block>
              <Block label="Submitted">
                {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
              </Block>
            </div>
          )}

          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[#2D4A3E] hover:underline mt-3"
            data-testid={`toggle-detail-${t.id}`}
          >
            {expanded ? "Hide full details" : "Show all signup answers"}
          </button>

          {/* Value tags — shows what gaps this applicant fills, and warns
              the admin if they're a "duplicate" (axes where we already
              have ≥5 active providers). */}
          {(t.value_tags?.length || 0) > 0 && (
            <div className="mt-4 border-t border-dashed border-[#E8E5DF] pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                  Coverage value
                </span>
                {t.value_summary?.is_duplicate_only ? (
                  <span
                    className="text-xs bg-[#FDF1EF] border border-[#F2C9C0] text-[#D45D5D] rounded-full px-2 py-0.5"
                    data-testid={`pending-duplicate-warning-${t.id}`}
                    title="Every axis this applicant covers already has 5+ active providers. Approving may dilute referrals to existing therapists."
                  >
                    Duplicate roster — consider declining
                  </span>
                ) : (
                  <span
                    className="text-xs bg-[#F2F7F1] border border-[#D2E2D0] text-[#3F6F4A] rounded-full px-2 py-0.5"
                    data-testid={`pending-fills-gap-${t.id}`}
                  >
                    Fills {t.value_summary?.fills_gaps || 0} gap
                    {(t.value_summary?.fills_gaps || 0) === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.value_tags.map((tag, i) => (
                  <span
                    key={`${tag.axis}-${tag.label}-${i}`}
                    className={`text-[11px] rounded-full px-2 py-0.5 border ${
                      tag.kind === "fills_gap"
                        ? "bg-[#F2F7F1] border-[#D2E2D0] text-[#3F6F4A]"
                        : "bg-[#F4F1EC] border-[#E8E5DF] text-[#6D6A65]"
                    }`}
                    title={`${tag.count} active provider${tag.count === 1 ? "" : "s"} already cover this axis`}
                    data-testid={`value-tag-${t.id}-${i}`}
                  >
                    {tag.kind === "fills_gap" ? "✓ " : ""}
                    {tag.label}{" "}
                    <span className="opacity-60">({tag.count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action stack */}
        <div className="flex flex-col gap-2 shrink-0">
          <button
            className="tv-btn-primary !py-1.5 !px-4 text-sm"
            onClick={onApprove}
            data-testid={`approve-${t.id}`}
          >
            <CheckCircle2 size={14} className="inline mr-1.5" /> Approve
          </button>
          <button
            onClick={onEdit}
            className="text-xs text-[#2D4A3E] hover:underline inline-flex items-center gap-1 justify-center"
            data-testid={`edit-pending-${t.id}`}
          >
            <Pencil size={12} /> Edit fields
          </button>
          <button
            className="text-sm text-[#D45D5D] hover:underline"
            onClick={onReject}
            data-testid={`reject-${t.id}`}
          >
            <XCircle size={14} className="inline mr-1.5" /> Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function Block({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
        {label}
      </div>
      <div className="text-sm text-[#2B2A29] leading-snug break-words">
        {children}
      </div>
    </div>
  );
}
