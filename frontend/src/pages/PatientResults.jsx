import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Phone, Mail, Star, Sparkles, CalendarPlus } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { RESULTS_POLL_INTERVAL_MS } from "@/lib/constants";

// Friendly labels for each scoring axis. Each entry maps axis -> { max, label }.
// We surface the top 3 axes (where score > 50% of max) on the patient result card.
const AXIS_META = {
  issues: { max: 35, label: "Specializes in your concerns" },
  availability: { max: 20, label: "Matches your schedule" },
  modality: { max: 15, label: "Offers your preferred format" },
  urgency: { max: 10, label: "Can take you on quickly" },
  prior_therapy: { max: 10, label: "Right fit for your therapy history" },
  experience: { max: 5, label: "Matches your experience preference" },
  gender: { max: 3, label: "Matches your gender preference" },
  style: { max: 2, label: "Aligns with your style preference" },
  payment_fit: { max: 3, label: "Open to your budget on a sliding scale" },
  modality_pref: { max: 4, label: "Practices your preferred therapy approach" },
};

// Slug -> friendly label. Mirrors IntakeForm/TherapistSignup ISSUES list.
const ISSUE_LABELS = {
  anxiety: "anxiety",
  depression: "depression",
  ocd: "OCD",
  adhd: "ADHD",
  trauma_ptsd: "trauma / PTSD",
  relationship_issues: "relationship issues",
  life_transitions: "life transitions",
  parenting_family: "parenting / family conflict",
  substance_use: "substance use",
  eating_concerns: "eating concerns",
  autism_neurodivergence: "autism / neurodivergence",
  school_academic_stress: "school / academic stress",
};

function topReasons(breakdown) {
  if (!breakdown) return [];
  const entries = Object.entries(breakdown)
    .map(([k, v]) => {
      const meta = AXIS_META[k];
      if (!meta || !v || v <= 0) return null;
      const pct = meta.max > 0 ? v / meta.max : 0;
      return { key: k, score: v, max: meta.max, pct, label: meta.label };
    })
    .filter(Boolean)
    // Always surface the top 3 axes by raw score (no % threshold);
    // higher-weighted axes (issues=35) outrank lighter ones on ties.
    .sort((a, b) => b.score - a.score || b.pct - a.pct);
  return entries.slice(0, 3);
}

function buildConsultMailto(therapist, request) {
  const firstName = (therapist?.name || "").split(",")[0].split(" ")[0] || "there";
  const issues = (request?.presenting_issues || [])
    .slice(0, 2)
    .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
    .join(" and ");
  const issuesLine = issues
    ? `What I'd like to focus on: ${issues}.`
    : "I'd love to share more about what I'd like to work on.";
  const subject = "Free 15-min consult — TheraVoca match";
  const body = [
    `Hi ${firstName},`,
    "",
    "Thank you for reaching out through TheraVoca — I'd love to set up a free 15-minute consult to see if we're a good fit.",
    "",
    issuesLine,
    "",
    "Could you share 3 time slots that work for you this week or next?",
    "",
    "Looking forward to it,",
  ].join("\n");
  const params = new URLSearchParams({ subject, body });
  return `mailto:${therapist?.email || ""}?${params.toString()}`;
}

export default function PatientResults() {
  const { requestId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api.get(`/requests/${requestId}/results`).then((res) => {
        if (active) setData(res.data);
      });
    load();
    const intervalId = setInterval(load, RESULTS_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [requestId]);

  if (!data) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D4A3E]" />
      </div>
    );
  }

  const { request, applications, hold_active, hold_ends_at, applications_pending_count } = data;
  const holdEndsLabel = hold_ends_at
    ? new Date(hold_ends_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
    : "soon";

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="patient-results-page">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Your matches
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            Therapists who want to work with you
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-xl leading-relaxed">
            These therapists read your anonymous referral and submitted interest.
            Reach out to whoever feels right — many offer a free consult.
          </p>

          {hold_active && (
            <div
              className="mt-6 bg-[#FDF7EC] border border-[#E8DCC1] rounded-2xl p-5 flex items-start gap-3"
              data-testid="results-hold-banner"
            >
              <Sparkles size={18} className="text-[#C87965] mt-1 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-[#2B2A29]">
                  Your matches are still coming in
                </div>
                <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                  We give every therapist a 24-hour window to respond so you can
                  compare the strongest matches side-by-side instead of contacting
                  the first person to reply. Your full results will unlock{" "}
                  <strong className="text-[#2D4A3E]">{holdEndsLabel}</strong>.
                </p>
              </div>
            </div>
          )}

          {applications.length === 0 ? (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center">
              <Loader2 className="animate-spin mx-auto text-[#2D4A3E]" />
              <p className="text-[#6D6A65] mt-4 max-w-md mx-auto leading-relaxed">
                {hold_active
                  ? "We'll show your matches once the 24-hour window closes."
                  : "Therapists are reviewing your referral. Responses typically arrive within 24 hours. We'll email you as soon as your matches are ready."}
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {applications.map((app, i) => {
                const t = app.therapist;
                const formats = [];
                if (t.telehealth) formats.push("Virtual");
                if (t.offers_in_person) formats.push("In-person");
                const formatStr = formats.join(" + ") || "Virtual";
                return (
                  <article
                    key={app.id}
                    className="bg-white border border-[#E8E5DF] rounded-2xl p-4 md:p-5 hover:border-[#2D4A3E] transition"
                    data-testid={`result-card-${i}`}
                  >
                    <div className="flex gap-4">
                      <div
                        className="w-14 h-14 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0"
                        data-testid={`avatar-${i}`}
                      >
                        {t.profile_picture ? (
                          <img
                            src={t.profile_picture}
                            alt={t.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="font-serif-display text-base text-[#2D4A3E]">
                            {(t.name || "")
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
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <h3 className="font-serif-display text-xl text-[#2D4A3E] leading-tight truncate">
                            {t.name}
                          </h3>
                          <div className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0">
                            <Star size={10} fill="currentColor" />
                            {Math.round(app.match_score)}%
                          </div>
                        </div>
                        <div className="text-xs text-[#6D6A65] mt-0.5">
                          {t.years_experience || "—"} yrs •{" "}
                          {(t.modalities || []).slice(0, 3).join(" · ") || "—"}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-3 text-xs">
                          <Detail label="Format" value={formatStr} />
                          <Detail label="Rate" value={`$${t.cash_rate || "?"}`} />
                          <Detail
                            label="Sliding scale"
                            value={t.sliding_scale ? "Yes" : "No"}
                            highlight={t.sliding_scale}
                          />
                          <Detail
                            label="Free consult"
                            value={t.free_consult ? "Yes" : "—"}
                            highlight={t.free_consult}
                          />
                          {t.office_addresses && t.office_addresses.length > 0 ? (
                            <Detail
                              label="Office"
                              value={t.office_addresses.slice(0, 1).join(" · ")}
                              span={2}
                            />
                          ) : t.office_locations && t.office_locations.length > 0 ? (
                            <Detail
                              label="Offices"
                              value={t.office_locations.slice(0, 2).join(", ")}
                              span={2}
                            />
                          ) : null}
                          {t.website && (
                            <div className="col-span-2 text-xs">
                              <span className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                                Website
                              </span>
                              <div>
                                <a
                                  href={t.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2D4A3E] underline break-all hover:text-[#C87965]"
                                  data-testid={`therapist-website-${i}`}
                                >
                                  {t.website.replace(/^https?:\/\//, "")}
                                </a>
                              </div>
                            </div>
                          )}
                          <Detail
                            label="Insurance"
                            value={
                              (t.insurance_accepted || []).length > 0
                                ? `${t.insurance_accepted.length} plans`
                                : "Cash / OON"
                            }
                            span={2}
                          />
                        </div>

                        {topReasons(app.match_breakdown).length > 0 && (
                          <ul
                            className="flex flex-wrap gap-1.5 mt-3"
                            data-testid={`why-match-${i}`}
                          >
                            {topReasons(app.match_breakdown).map((r) => (
                              <li
                                key={r.key}
                                className="text-[11px] bg-[#FDFBF7] border border-[#E8E5DF] text-[#2B2A29] px-2 py-0.5 rounded-full"
                                data-testid={`why-match-${i}-${r.key}`}
                              >
                                {r.label}
                              </li>
                            ))}
                          </ul>
                        )}

                        {app.message && app.message.trim().length > 0 && (
                          <p className="mt-3 text-sm text-[#2B2A29] leading-snug border-l-2 border-[#C87965] pl-3 italic line-clamp-3">
                            "{app.message}"
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2 mt-3">
                          <a
                            href={buildConsultMailto(t, request)}
                            className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#3A5E50] transition"
                            data-testid={`consult-btn-${i}`}
                          >
                            <CalendarPlus size={13} /> Book free consult
                          </a>
                          <a
                            href={`mailto:${t.email}`}
                            className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs hover:border-[#2D4A3E] transition"
                            data-testid={`contact-email-${i}`}
                          >
                            <Mail size={13} className="text-[#2D4A3E]" />
                            Email
                          </a>
                          {t.phone && (
                            <a
                              href={`tel:${t.phone}`}
                              className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs hover:border-[#2D4A3E] transition"
                              data-testid={`contact-phone-${i}`}
                            >
                              <Phone size={13} className="text-[#2D4A3E]" />
                              {t.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Detail({ label, value, span = 1, highlight = false }) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div
        className={`font-medium ${
          highlight ? "text-[#C87965]" : "text-[#2B2A29]"
        } truncate`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
