import credentialLabel from "@/lib/credentialLabel";

// Patient-eye preview of a single therapist. Mirrors the visual contract
// of <MatchedProviderCard> in PatientResults.jsx — same photo + name +
// credential + experience + modalities + bio — minus interactive bits
// (no contact info, no chips). Lives here as a small component so the
// admin can trust "what I see is what the patient sees".
export default function ProviderPreviewCard({ t }) {
  const photo = t.photo_url || t.photo || "";
  const credLabel = credentialLabel(t.credential_type);
  const yrs = t.years_experience;
  const modalities = (t.modalities || []).slice(0, 3);
  const bio = t.bio || t.about || "";
  const issues = (t.primary_specialties || t.issues_treated || []).slice(0, 6);
  return (
    <div
      className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5"
      data-testid="provider-preview-card"
    >
      <div className="flex items-start gap-4">
        {photo ? (
          <img
            src={photo}
            alt={t.name}
            className="w-20 h-20 rounded-2xl object-cover border border-[#E8E5DF]"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-[#E8E5DF] flex items-center justify-center text-[#6D6A65] text-xl font-serif-display shrink-0">
            {(t.name || "?").charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            {t.name || "Unnamed therapist"}
          </h3>
          <div className="text-xs text-[#6D6A65] mt-1 break-words">
            {credLabel && (
              <span className="text-[#2B2A29] font-medium">{credLabel}</span>
            )}
            {credLabel && (yrs != null || modalities.length > 0) && " · "}
            {yrs != null && (
              <>
                {yrs} year{yrs === 1 ? "" : "s"} experience
                {modalities.length > 0 && " • "}
              </>
            )}
            {modalities.join(" · ")}
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
            Specialties
          </div>
          <div className="flex flex-wrap gap-1.5">
            {issues.map((i) => (
              <span
                key={i}
                className="text-xs bg-white border border-[#E8E5DF] text-[#2B2A29] px-2 py-0.5 rounded-full"
              >
                {String(i).replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
      {bio && (
        <p className="mt-4 text-sm text-[#2B2A29] leading-relaxed whitespace-pre-wrap">
          {bio}
        </p>
      )}
    </div>
  );
}
