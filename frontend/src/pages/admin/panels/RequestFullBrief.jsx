// RequestFullBrief — admin's full read-out of a single patient request.
// Renders the structured fields the matching engine consumes plus a
// dedicated row for the patient's free-text *Anything else?* note,
// and tags every hard-filter field with a small "HARD" pill so the
// admin can see at a glance which inputs caused a small notify_count
// (e.g. only 3 therapists notified because age_group=teen filtered most
// of the pool out).

// Hard-filter axes per `matching._score_one` (in the order they're
// applied). Each axis tags the field below; combined with patient-side
// strict toggles, this is the full "why didn't we find more matches?"
// surface.
const HARD_FILTER_KEYS = new Set([
  "location_state",
  "client_type",
  "age_group",
  "presenting_issues",   // primary (first item) is hard-filtered
  "payment",             // when insurance_strict
  "modality_preference", // when modality_strict (always partially hard)
  "preferred_language",  // when language_strict
  "gender_preference",   // when gender_required
  "availability_windows",// when availability_strict
  "urgency",             // when urgency_strict
]);

function HardPill({ active = true, label = "HARD" }) {
  if (!active) return null;
  return (
    <span
      className="ml-1 inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#7B2D2D] text-white"
      title="Hard filter — therapists who fail this are excluded outright"
      data-testid="hard-filter-pill"
    >
      {label}
    </span>
  );
}

function FieldLabel({ children, hard = false, hint }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] flex items-center">
      <span>{children}</span>
      {hard && <HardPill />}
      {hint && (
        <span
          className="ml-1 text-[#A09C95] cursor-help"
          title={hint}
          aria-label={hint}
        >
          ⓘ
        </span>
      )}
    </div>
  );
}

export default function RequestFullBrief({ request }) {
  if (!request) return null;

  const issuesArr = Array.isArray(request.presenting_issues)
    ? request.presenting_issues
    : (request.presenting_issues ? [request.presenting_issues] : []);
  const primaryIssue = issuesArr[0];
  const secondaryIssues = issuesArr.slice(1);

  const availability = Array.isArray(request.availability_windows)
    ? request.availability_windows.join(", ")
    : (request.availability_windows || "—");

  const otherIssue = (request.other_issue || "").trim();

  // Hard-filter strict-mode flags — patient-toggleable axes that
  // explicitly become hard filters when set.
  const strictTags = [
    request.insurance_strict ? "insurance" : null,
    request.availability_strict ? "availability" : null,
    request.urgency_strict ? "urgency" : null,
    request.language_strict ? "language" : null,
    request.gender_required ? "gender" : null,
  ].filter(Boolean);

  const fields = [
    { label: "Patient email", value: request.email, key: "email" },
    { label: "Phone", value: request.phone || "—", key: "phone" },
    {
      label: "Location",
      value:
        `${request.location_city || ""} ${request.location_state || ""} ${request.location_zip || ""}`.trim() ||
        "—",
      key: "location_state",
    },
    {
      label: "Client age / type",
      value: `${request.client_age || "—"} · ${request.client_type || "—"}`,
      key: "client_type",
    },
    { label: "Age group", value: request.age_group || "—", key: "age_group" },
    {
      label: "Session format",
      value: (() => {
        const m = request.session_format || request.modality_preference || "";
        const labels = {
          telehealth_only: "Telehealth only",
          in_person_only: "In-person only",
          hybrid: "Hybrid / either",
          prefer_inperson: "Prefer in-person",
          prefer_telehealth: "Prefer telehealth",
        };
        return labels[m] || m || "—";
      })(),
      key: "modality_preference",
      hard: request.modality_preference === "in_person_only",
    },
    { label: "Urgency", value: request.urgency || "—", key: "urgency" },
    {
      label: "Prior therapy",
      value: request.prior_therapy || "—",
      key: "prior_therapy",
    },
    {
      label: "Experience pref",
      value: Array.isArray(request.experience_preference)
        ? request.experience_preference.join(", ")
        : (request.experience_preference || "—"),
      key: "experience_preference",
    },
    {
      label: "Gender pref",
      value: request.gender_preference || "no_pref",
      key: "gender_preference",
      hard: !!request.gender_required,
    },
    {
      label: "Style pref",
      value: Array.isArray(request.style_preference)
        ? request.style_preference.join(", ")
        : (request.style_preference || "—"),
      key: "style_preference",
    },
    {
      label: "Modality pref",
      value: Array.isArray(request.modality_preferences)
        ? request.modality_preferences.join(", ")
        : (request.modality_preferences || "—"),
      key: "modality_preferences",
    },
    {
      label: "Payment",
      value:
        request.payment_type === "cash"
          ? `Cash $${request.budget || "?"}`
          : request.insurance_name || "Insurance",
      key: "payment",
      hard: !!request.insurance_strict,
    },
    {
      label: "Preferred language",
      value: request.preferred_language || "English",
      key: "preferred_language",
      hard: !!request.language_strict,
    },
    {
      label: "Threshold",
      value: (() => {
        const t = request.threshold;
        if (t == null) return "—";
        const num = Number(t);
        const pct = num <= 1 ? num * 100 : num;
        return `${Math.round(pct)}%`;
      })(),
      key: "threshold",
    },
    { label: "Status", value: request.status || "—", key: "status" },
    {
      label: "Referral source",
      value: request.referral_source || "—",
      key: "referral_source",
    },
    {
      label: "Referred by code",
      value: request.referred_by_patient_code || "—",
      key: "referred_by_patient_code",
    },
    {
      label: "SMS opt-in",
      value: request.sms_opt_in ? "Yes" : "No",
      key: "sms_opt_in",
    },
    {
      label: "Created",
      value: request.created_at
        ? new Date(request.created_at).toLocaleString()
        : "—",
      key: "created_at",
    },
    {
      label: "Matched",
      value: request.matched_at
        ? new Date(request.matched_at).toLocaleString()
        : "—",
      key: "matched_at",
    },
    {
      label: "Results sent",
      value: request.results_sent_at
        ? new Date(request.results_sent_at).toLocaleString()
        : "—",
      key: "results_sent_at",
    },
  ];

  return (
    <div
      className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-5 space-y-4"
      data-testid="request-full-brief"
    >
      {strictTags.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#6D6A65]"
          data-testid="strict-mode-tags"
        >
          <span className="uppercase tracking-wider font-semibold text-[#7B2D2D]">
            Strict-mode hard filters:
          </span>
          {strictTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FCEEEC] text-[#7B2D2D] border border-[#E8C8C5]"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => {
          const isHard = f.hard ?? HARD_FILTER_KEYS.has(f.key);
          // Some fields (e.g. modality_preference, gender_preference) are
          // only HARD when their strict toggle is set; for those we use
          // f.hard explicitly. The default for HARD_FILTER_KEYS axes is
          // "always hard" (state, client_type, age_group, prior_therapy
          // is NOT hard but soft-scored) — kept conservative so we don't
          // over-tag.
          const alwaysHard = ["location_state", "client_type", "age_group"].includes(
            f.key,
          );
          return (
            <div key={f.label}>
              <FieldLabel hard={alwaysHard || f.hard}>{f.label}</FieldLabel>
              <div className="text-[#2B2A29] break-words">{f.value || "—"}</div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#E8E5DF] pt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <FieldLabel
            hard
            hint="Only the FIRST (primary) issue is hard-filtered. Therapists must list it in primary, secondary, or general specialties. Issues #2 and #3 are soft-scored bonuses."
          >
            Presenting issues
          </FieldLabel>
          <div className="text-[#2B2A29] mt-0.5 leading-relaxed flex flex-wrap gap-1.5">
            {primaryIssue && (
              <span
                className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-[#2D4A3E] text-white"
                title="Primary — hard filter"
              >
                <span className="mr-1 text-[9px] uppercase font-bold tracking-wider opacity-80">
                  1°
                </span>
                {primaryIssue}
              </span>
            )}
            {secondaryIssues.map((iss, i) => (
              <span
                key={iss}
                className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-[#F2EFE9] text-[#2B2A29] border border-[#E8E5DF]"
                title={`#${i + 2} priority — soft scoring bonus only`}
              >
                <span className="mr-1 text-[9px] uppercase font-bold tracking-wider opacity-60">
                  {i + 2}°
                </span>
                {iss}
              </span>
            ))}
            {!issuesArr.length && <span>—</span>}
          </div>
        </div>
        <div>
          <FieldLabel
            hint="Strict-only when the patient toggled `availability_strict`. Otherwise soft-scored."
            hard={!!request.availability_strict}
          >
            Availability windows
          </FieldLabel>
          <div className="text-[#2B2A29] mt-0.5">{availability}</div>
        </div>
      </div>

      {/* Patient's free-text "Anything else?" — surfaced verbatim so the
          admin sees the full picture. The matching engine doesn't yet
          consume this field for ranking (it only feeds the apply-fit
          grader), so this is also a debugging clue when match quality
          looks lower than expected. */}
      <div className="border-t border-[#E8E5DF] pt-3 text-sm">
        <FieldLabel
          hint="Legacy field — removed from intake. Shown here for historical requests that included it."
        >
          Patient note (free text)
        </FieldLabel>
        <div
          className={`mt-1 leading-relaxed whitespace-pre-wrap rounded-lg px-3 py-2 ${
            otherIssue
              ? "bg-[#F8F4EB] text-[#2B2A29]"
              : "italic text-[#9C9893] bg-[#FDFBF7] border border-dashed border-[#E8E5DF]"
          }`}
          data-testid="request-other-issue"
        >
          {otherIssue || "(patient left this blank)"}
        </div>
      </div>

      {request.prior_therapy_notes && (
        <div className="border-t border-[#E8E5DF] pt-3 text-sm">
          <FieldLabel hint="Surfaced to the apply-fit grader (variant E in the experiment).">
            Prior-therapy notes
          </FieldLabel>
          <div className="mt-1 leading-relaxed whitespace-pre-wrap rounded-lg px-3 py-2 bg-[#F8F4EB] text-[#2B2A29]">
            {request.prior_therapy_notes}
          </div>
        </div>
      )}

      {request.content_flags && request.content_flags.length > 0 && (
        <div
          className="border-t border-[#E8E5DF] pt-3 text-sm"
          data-testid="content-flags"
        >
          <FieldLabel hint="Automated scan detected PHI or off-topic content in free-text fields.">
            Content flags
          </FieldLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {request.content_flags.map((f, i) => (
              <span
                key={i}
                className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border ${
                  f.type === "phi"
                    ? "bg-[#FCEEEC] text-[#7B2D2D] border-[#E8C8C5]"
                    : "bg-[#FFF3E0] text-[#8B6914] border-[#E8D9B5]"
                }`}
                title={`Field: ${f.field} · Match: "${f.match}"`}
              >
                {f.type === "phi" ? "PHI" : "Off-topic"}: {f.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
