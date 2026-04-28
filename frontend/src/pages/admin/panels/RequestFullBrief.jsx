import { Phone } from "lucide-react";

export default function RequestFullBrief({ request }) {
  if (!request) return null;
  const fields = [
    { label: "Patient email", value: request.email },
    { label: "Phone", value: request.phone || "—" },
    { label: "Location", value: `${request.location_city || ""} ${request.location_state || ""} ${request.location_zip || ""}`.trim() || "—" },
    { label: "Client age / type", value: `${request.client_age || "—"} · ${request.client_type || "—"}` },
    { label: "Age group", value: request.age_group || "—" },
    { label: "Session format", value: request.session_format || request.modality_preference || "—" },
    { label: "Urgency", value: request.urgency || "—" },
    { label: "Prior therapy", value: request.prior_therapy || "—" },
    { label: "Experience pref", value: Array.isArray(request.experience_preference) ? request.experience_preference.join(", ") : (request.experience_preference || "—") },
    { label: "Gender pref", value: request.gender_preference || "no_pref" },
    { label: "Style pref", value: Array.isArray(request.style_preference) ? request.style_preference.join(", ") : (request.style_preference || "—") },
    { label: "Modality pref", value: Array.isArray(request.modality_preferences) ? request.modality_preferences.join(", ") : (request.modality_preferences || "—") },
    { label: "Payment", value: request.payment_type === "cash" ? `Cash $${request.budget || "?"}` : (request.insurance_name || "Insurance") },
    { label: "Threshold", value: (() => {
      const t = request.threshold;
      if (t == null) return "—";
      const num = Number(t);
      // Backwards-compat: thresholds stored as 0–1 fraction OR 0–100 integer.
      const pct = num <= 1 ? num * 100 : num;
      return `${Math.round(pct)}%`;
    })() },
    { label: "Status", value: request.status || "—" },
    { label: "Referral source", value: request.referral_source || "—" },
    { label: "Referred by code", value: request.referred_by_patient_code || "—" },
    { label: "SMS opt-in", value: request.sms_opt_in ? "Yes" : "No" },
    { label: "Created", value: request.created_at ? new Date(request.created_at).toLocaleString() : "—" },
    { label: "Matched", value: request.matched_at ? new Date(request.matched_at).toLocaleString() : "—" },
    { label: "Results sent", value: request.results_sent_at ? new Date(request.results_sent_at).toLocaleString() : "—" },
  ];
  const issues = Array.isArray(request.presenting_issues)
    ? request.presenting_issues.join(", ")
    : (request.presenting_issues || "—");
  const availability = Array.isArray(request.availability_windows)
    ? request.availability_windows.join(", ")
    : (request.availability_windows || "—");
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-5 space-y-4" data-testid="request-full-brief">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <div key={f.label}>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{f.label}</div>
            <div className="text-[#2B2A29] break-words">{f.value || "—"}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-[#E8E5DF] pt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Presenting issues</div>
          <div className="text-[#2B2A29] mt-0.5 leading-relaxed">{issues}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Availability windows</div>
          <div className="text-[#2B2A29] mt-0.5">{availability}</div>
        </div>
      </div>
    </div>
  );
}
