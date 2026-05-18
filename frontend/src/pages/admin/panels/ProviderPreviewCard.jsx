import { Mail, Phone, CalendarPlus } from "lucide-react";
import credentialLabel from "@/lib/credentialLabel";

// Admin preview of a single therapist. Two-pane layout:
//
//   1) PATIENT-EYE view (top): mirrors the result card the patient sees
//      on /results/:id -- photo, name, credentials, modalities, the
//      4-up "quick facts" grid, office address with map link, website,
//      insurance, languages, specialties, bio, and the contact-action
//      buttons. So the admin can sanity-check the public face.
//
//      What this view CAN'T show (patient-specific, computed per match):
//      match score %, "Why we recommend" research_rationale, "Why we
//      matched" chips, "Where you may not align" gaps, travel distance,
//      and the therapist's apply-message. Those depend on the specific
//      patient's intake answers and ZIP, so we surface a small note
//      instead of fabricating values.
//
//   2) ADMIN DETAIL (below): every editable field grouped by section.
//      Hidden values render as "--" so an empty field is obvious. The
//      goal: see at a glance whether a therapist's profile is
//      match-ready or has gaps.
export default function ProviderPreviewCard({ t }) {
  const photo = t.photo_url || t.photo || t.profile_picture || "";
  const credLabel = credentialLabel(t.credential_type);
  const yrs = t.years_experience;
  const topModalities = (t.modalities || []).slice(0, 3);
  const bio = t.bio || t.about || "";
  const topIssues = (t.primary_specialties || t.issues_treated || []).slice(0, 6);

  // Patient-card facts (mirrors PatientResults.jsx ~line 920-1200):
  const formats = [];
  if (t.telehealth) formats.push("Virtual");
  if (t.offers_in_person) formats.push("In-person");
  const formatStr = formats.join(" + ") || "Virtual";
  const cashRateStr = t.cash_rate ? `$${t.cash_rate} / session` : "--";
  const insurancePlans = t.insurance_accepted || [];
  const insuranceHead = insurancePlans.slice(0, 4).join(", ");
  const insuranceTail = Math.max(0, insurancePlans.length - 4);
  const insuranceStr = insurancePlans.length === 0
    ? `Cash only -- $${t.cash_rate || "?"}/session`
    : insuranceTail > 0
      ? `${insuranceHead} +${insuranceTail} more`
      : insuranceHead;
  const office1 = (t.office_addresses || [])[0];
  const officeCities = (t.office_locations || []).slice(0, 2).join(", ");

  return (
    <div className="space-y-5" data-testid="provider-preview-card">
      {/* ============= PATIENT-EYE VIEW ============= */}
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-[#C87965] mb-3">
          What the patient sees
        </div>
        <div className="flex items-start gap-4">
          {photo ? (
            <img
              src={photo}
              alt={t.name}
              className="w-14 h-14 rounded-full object-cover border border-[#E8E5DF] shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] flex items-center justify-center text-[#2D4A3E] text-base font-serif-display shrink-0">
              {(t.name || "?").charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-serif-display text-xl text-[#2D4A3E] leading-tight truncate">
              {t.name || "Unnamed therapist"}
            </h3>
            <div className="text-xs text-[#6D6A65] mt-0.5 break-words">
              {credLabel && (
                <span className="text-[#2B2A29] font-medium">{credLabel}</span>
              )}
              {credLabel && (yrs != null || topModalities.length > 0) && " · "}
              {yrs != null && (
                <>
                  {yrs} year{yrs === 1 ? "" : "s"} experience
                  {topModalities.length > 0 && " · "}
                </>
              )}
              {topModalities.join(" · ")}
            </div>
          </div>
        </div>

        {/* 4-up "quick facts" grid -- matches PatientResults.jsx exactly. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-4 text-xs">
          <PreviewDetail label="Format" value={formatStr} />
          <PreviewDetail label="Cash rate" value={cashRateStr} />
          <PreviewDetail
            label="Sliding scale"
            value={t.sliding_scale ? "Yes" : "No"}
            highlight={!!t.sliding_scale}
          />
          <PreviewDetail
            label="Free consult"
            value={t.free_consult ? "Yes" : "--"}
            highlight={!!t.free_consult}
          />
          {office1 ? (
            <div className="col-span-2 text-xs">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                Office
              </div>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(office1)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#2D4A3E] underline decoration-dotted underline-offset-2 hover:text-[#C87965] break-words"
              >
                {office1}
              </a>
            </div>
          ) : officeCities ? (
            <PreviewDetail label="Offices" value={officeCities} span={2} />
          ) : null}
          {t.website && (
            <div className="col-span-2 text-xs">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                Website
              </div>
              <a
                href={t.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2D4A3E] underline break-all hover:text-[#C87965]"
              >
                {t.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          <PreviewDetail label="Insurance" value={insuranceStr} span={2} />
          {(t.languages_spoken || []).length > 0 && (
            <PreviewDetail
              label="Languages"
              value={["English", ...t.languages_spoken].join(", ")}
              span={2}
            />
          )}
        </div>

        {topIssues.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
              Specialties
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topIssues.map((i) => (
                <span key={i} className="text-xs bg-white border border-[#E8E5DF] text-[#2B2A29] px-2 py-0.5 rounded-full">
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

        {/* Contact-action buttons -- the patient sees these as live
            mailto:/tel: buttons that open their email/phone app. Here
            they're visual stubs so the admin can confirm the contact
            info is exposed. */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white rounded-lg px-3 py-1.5 text-xs font-medium opacity-90">
            <CalendarPlus size={13} /> Book free consult
          </span>
          <span className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs text-[#2B2A29]">
            <Mail size={13} className="text-[#2D4A3E]" />
            {t.email || "(no email on file)"}
          </span>
          {(t.office_phone || t.phone) && (
            <span className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs text-[#2B2A29]">
              <Phone size={13} className="text-[#2D4A3E]" />
              {t.office_phone || t.phone}
            </span>
          )}
        </div>

        {/* Patient-specific bits we deliberately don't fake here. */}
        <div className="mt-4 text-[11px] italic text-[#6D6A65] leading-relaxed">
          Not shown above (vary per patient match): match score %, the
          "Why we recommend" research blurb, the "Why we matched"
          green chips, the "Where you may not align" gap callout,
          travel distance from the patient's ZIP, and the therapist's
          custom apply message. All other fields the patient sees are
          rendered above.
        </div>
      </div>

      {/* ============= ADMIN FULL DETAIL ============= */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-[10px] uppercase tracking-widest text-[#C87965] mb-3">
          Full profile (admin view)
        </div>

        <Group title="Identity">
          <Row label="ID" value={t.id} mono />
          <Row label="Name" value={t.name} />
          <Row label="Credential" value={credLabel} />
          <Row label="Gender" value={t.gender} />
          <Row label="Real email (admin only)" value={t.real_email || t.email} mono />
          <Row label="Account email" value={t.email} mono />
          <Row label="Public phone (office)" value={t.office_phone} />
          <Row label="Alert phone (SMS, private)" value={t.phone_alert || t.phone} />
          <Row label="Website" value={t.website} link={t.website} />
          <Row label="Profile picture" value={t.profile_picture || t.photo_url ? "Set" : "(missing)"} />
        </Group>

        <Group title="License">
          <Row label="Licensed states" value={fmtList(t.licensed_states)} />
          <Row label="License number" value={t.license_number} mono />
          <Row label="License expires" value={t.license_expires_at} />
          <Row label="License picture" value={t.license_picture ? "Uploaded" : "(missing)"} />
        </Group>

        <Group title="Specialties">
          <Row label="Primary (HARD-matched on patient's #1 concern)" value={fmtList(t.primary_specialties)} />
          <Row label="Secondary" value={fmtList(t.secondary_specialties)} />
          <Row label="General treats" value={fmtList(t.general_treats)} />
        </Group>

        <Group title="Modalities + format">
          <Row label="Therapy modalities (CBT/DBT/etc)" value={fmtList(t.modalities)} />
          <Row label="Modality offering (in-person / telehealth / both)" value={t.modality_offering} />
          <Row label="Telehealth?" value={fmtBool(t.telehealth)} />
          <Row label="Offers in-person?" value={fmtBool(t.offers_in_person)} />
          <Row label="Languages spoken (English implicit)" value={fmtList(t.languages_spoken)} />
        </Group>

        <Group title="Locations">
          <Row label="Office addresses" value={fmtList(t.office_addresses)} />
          <Row label="Office cities" value={fmtList(t.office_locations)} />
          <Row label="Geocoded offices" value={`${(t.office_geos || []).length} location(s)`} />
        </Group>

        <Group title="Clinical fit">
          <Row label="Age groups served" value={fmtList(t.age_groups)} />
          <Row label="Client types" value={fmtList(t.client_types)} />
          <Row label="Style tags" value={fmtList(t.style_tags)} />
          <Row label="Session style tags" value={fmtList(t.session_style_tags)} />
        </Group>

        <Group title="Payment">
          <Row label="Insurance accepted" value={fmtList(t.insurance_accepted)} />
          <Row label="Cash rate / session" value={t.cash_rate != null ? `$${t.cash_rate}` : null} />
          <Row label="Sliding scale offered?" value={fmtBool(t.sliding_scale)} />
          <Row label="Free 15-min consult?" value={fmtBool(t.free_consult)} />
        </Group>

        <Group title="Schedule + experience">
          <Row label="Years of experience" value={yrs != null ? `${yrs}` : null} />
          <Row label="Availability windows" value={fmtList(t.availability_windows)} />
          <Row label="Urgency capacity" value={t.urgency_capacity} />
        </Group>

        <Group title="Deep-match (T1-T6 -- patient match signals)">
          <Row label="T1 (stuck-rank patient said) - deprecated" value={fmtList(t.t1_stuck_ranked)} muted />
          <Row label="T2 (lived-experience phrases)" value={fmtList(t.t2_lived_phrases)} />
          <Row label="T3 (breakthrough type) - deprecated" value={t.t3_breakthrough_type} muted />
          <Row label="T5 (lived experience)" value={t.t5_lived_experience} long />
          <Row label="T6 (session expectations -- match the patient's)" value={fmtList(t.t6_session_expectations)} />
          <Row label="T6 (early sessions feel)" value={t.t6_early_sessions_description} long />
        </Group>

        <Group title="Reliability (computed from feedback)">
          <Row label="Response rate" value={fmtPct(t.reliability?.response_rate)} />
          <Row label="Selection rate (patients who chose them)" value={fmtPct(t.reliability?.selection_rate)} />
          <Row label="Retention at 9w" value={fmtPct(t.reliability?.retention_9w)} />
          <Row label="Retention at 15w" value={fmtPct(t.reliability?.retention_15w)} />
          <Row label="Expectation accuracy (3w survey)" value={fmtPct(t.reliability?.expectation_accuracy)} />
        </Group>

        <Group title="Deep research (LLM enrichment)">
          <Row label="Has cached research?" value={t.research_enrichment?.cached_at ? `Yes (${t.research_enrichment.cached_at.slice(0, 10)})` : "Not yet"} />
          <Row label="Evidence depth (0-10)" value={t.research_enrichment?.evidence_depth} />
          <Row label="Approach alignment notes" value={t.research_enrichment?.summary} long />
        </Group>

        <Group title="Subscription / billing">
          <Row label="Subscription status" value={t.subscription_status} />
          <Row label="Trial ends at" value={t.trial_ends_at} />
          <Row label="Current period ends" value={t.current_period_end} />
          <Row label="Stripe customer ID" value={t.stripe_customer_id} mono />
        </Group>

        <Group title="Notifications + attribution">
          <Row label="Email notifications" value={fmtBool(t.notify_email)} />
          <Row label="Unsubscribed?" value={fmtBool(t.unsubscribed)} />
          <Row label="Hard-bounced?" value={fmtBool(t.hard_bounced)} />
          <Row label="Refer-a-colleague code" value={t.referral_code} mono />
          <Row label="Referred by code" value={t.referred_by_code} mono />
          <Row label="Gap-recruit code" value={t.recruit_code} mono />
          <Row label="Signup source" value={t.source} />
        </Group>

        <Group title="Lifecycle flags">
          <Row label="Active?" value={fmtBool(t.is_active !== false)} />
          <Row label="Pending approval?" value={fmtBool(t.pending_approval)} />
          <Row label="Pending re-approval?" value={fmtBool(t.pending_reapproval)} />
          <Row label="Created at" value={t.created_at} />
          <Row label="Last login at" value={t.last_login_at} />
          <Row label="Last therapist survey" value={t.last_therapist_survey_sent_at} />
        </Group>

        <Group title="Bio + about (full text)">
          <Row label="Bio" value={bio || null} long />
        </Group>
      </div>
    </div>
  );
}

// ============= helpers =============

// Small label/value cell used inside the patient-eye quick-facts
// grid. Mirrors the <Detail> helper in PatientResults.jsx so the
// preview's visual layout matches the live results card.
function PreviewDetail({ label, value, span, highlight }) {
  const isEmpty = value === undefined || value === null || value === "" || value === "--";
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
        {label}
      </div>
      <div
        className={`text-xs ${
          isEmpty
            ? "italic text-[#9C9893]"
            : highlight
              ? "font-semibold text-[#2D4A3E]"
              : "text-[#2B2A29]"
        }`}
      >
        {isEmpty ? "--" : value}
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div className="border-t border-[#E8E5DF] pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-xs font-semibold text-[#2D4A3E] mb-2 uppercase tracking-wider">
        {title}
      </div>
      <div className="divide-y divide-[#F2EFE8]">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono, link, long, muted }) {
  const isEmpty = value === undefined || value === null || value === "" ||
                  (Array.isArray(value) && value.length === 0);
  const display = isEmpty ? "--" : value;
  return (
    <div className={`grid grid-cols-[minmax(180px,1fr)_2fr] gap-3 py-1.5 text-xs ${muted ? "opacity-50" : ""}`}>
      <div className="text-[#6D6A65]">{label}</div>
      <div className={`break-words ${mono ? "font-mono text-[11px]" : ""} ${long ? "whitespace-pre-wrap leading-relaxed" : ""} ${isEmpty ? "italic text-[#9C9893]" : "text-[#2B2A29]"}`}>
        {link && !isEmpty ? (
          <a href={link} target="_blank" rel="noreferrer noopener" className="text-[#2D4A3E] underline">
            {display}
          </a>
        ) : (
          String(display)
        )}
      </div>
    </div>
  );
}

function fmtList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map((x) => String(x).replace(/_/g, " ")).join(", ");
}

function fmtBool(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return null;
}

function fmtPct(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  // Reliability values are 0-1 floats; render as a percentage.
  return `${Math.round(n * 100)}%`;
}
