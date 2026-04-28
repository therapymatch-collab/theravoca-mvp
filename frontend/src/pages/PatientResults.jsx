import { useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Phone, Mail, Star, Sparkles, CalendarPlus, Send, Inbox, CheckCircle2, Clock, ArrowRight, ArrowLeft, Share2, FileText, AlertCircle, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api, getSession } from "@/lib/api";
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
  reviews: { max: 5, label: "Highly rated online" },
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
  // `mailto:` URLs require RFC-3986 percent-encoding (%20 for spaces), NOT
  // the application/x-www-form-urlencoded scheme that URLSearchParams uses
  // (which encodes spaces as `+`). iOS/Android Mail read the `+` literally
  // so subjects looked like "Free+15-min+consult". Use encodeURIComponent.
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${therapist?.email || ""}?${q}`;
}

// Computes "where you may not align" gaps from a per-therapist match breakdown.
// Returns at most 4 short, patient-friendly bullets describing what wasn't
// fully covered. We only surface gaps where the score on a meaningful axis
// is < 50% of max — small (≥50%) gaps would just create noise.
function matchGaps(breakdown, request, therapist) {
  if (!breakdown || !request) return [];
  const out = [];
  const issuesAsked = request.presenting_issues || [];
  const therapistIssues = new Set([
    ...(therapist?.primary_specialties || []),
    ...(therapist?.secondary_specialties || []),
    ...(therapist?.general_treats || []),
  ]);

  // Issue coverage — explicit bullet listing any concern the therapist
  // doesn't mark as a specialty. This is the highest-signal gap.
  const uncovered = issuesAsked.filter((iss) => !therapistIssues.has(iss));
  if (uncovered.length > 0 && issuesAsked.length > 0) {
    const labels = uncovered
      .slice(0, 3)
      .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
      .join(", ");
    out.push({
      key: "issues",
      label: `Doesn't list ${labels} as a specialty`,
    });
  }

  // Generic axis-based gaps (score < 50% of max on a meaningful axis).
  const axisGapLabels = {
    availability: "Schedule may be limited compared to what you need",
    modality: "Doesn't fully cover your preferred session format",
    urgency: "May not be able to start as quickly as you'd like",
    payment_fit: "Cash rate is above what you indicated as comfortable",
    modality_pref: "Doesn't primarily practice your preferred therapy approach",
    gender: "Different gender than you preferred",
    style: "Different working style than you preferred",
  };
  Object.entries(breakdown).forEach(([k, v]) => {
    const meta = AXIS_META[k];
    if (!meta || !axisGapLabels[k]) return;
    const pct = meta.max > 0 ? v / meta.max : 1;
    if (pct < 0.5) out.push({ key: k, label: axisGapLabels[k] });
  });

  // Insurance gap — patient asked for a specific plan and the therapist
  // doesn't accept any of them.
  const insAsked = (request.insurance_plans || []).filter(Boolean);
  const insAccepted = (therapist?.insurance_accepted || []).map((s) =>
    String(s).toLowerCase(),
  );
  if (insAsked.length > 0) {
    const matchAny = insAsked.some((p) =>
      insAccepted.includes(String(p).toLowerCase()),
    );
    if (!matchAny && insAccepted.length > 0) {
      out.push({
        key: "insurance",
        label: `Doesn't accept your insurance plan(s): ${insAsked
          .slice(0, 2)
          .join(", ")}`,
      });
    } else if (!matchAny) {
      out.push({
        key: "insurance",
        label: "Cash-only practice — no in-network insurance",
      });
    }
  }

  // De-dupe by key, cap at 4 items.
  const seen = new Set();
  return out
    .filter((g) => {
      if (seen.has(g.key)) return false;
      seen.add(g.key);
      return true;
    })
    .slice(0, 4);
}

// Compact summary panel of the patient's original referral so they can
// scan their inputs side-by-side with the matches below.
function YourReferralPanel({ request }) {
  const [open, setOpen] = useState(false);
  const issues = (request.presenting_issues || [])
    .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
    .join(", ");
  const insurances = (request.insurance_plans || []).join(", ");
  const summary = [
    request.client_age && `Age ${request.client_age}`,
    request.location_state,
    request.session_format,
    issues && `concerns: ${issues}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      className="mt-7 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6"
      data-testid="your-referral-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full text-left flex items-start justify-between gap-4 group"
        data-testid="referral-toggle"
      >
        <div className="flex items-start gap-3 min-w-0">
          <FileText size={18} className="text-[#2D4A3E] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
              Your referral
            </div>
            <div className="font-serif-display text-lg text-[#2D4A3E] leading-tight mt-0.5">
              What you asked for
            </div>
            {!open && (
              <div className="text-xs text-[#6D6A65] mt-1.5 line-clamp-1">
                {summary}
              </div>
            )}
          </div>
        </div>
        <span className="text-xs text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1 shrink-0">
          {open ? (
            <>
              Collapse <ChevronUp size={14} />
            </>
          ) : (
            <>
              Expand <ChevronDown size={14} />
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <RefDetail label="Age" value={request.client_age} />
          <RefDetail label="State" value={request.location_state} />
          <RefDetail label="ZIP" value={request.zip_code} />
          <RefDetail label="Format" value={request.session_format} />
          <RefDetail label="Insurance" value={insurances || "—"} />
          <RefDetail label="Cash-budget / session" value={request.budget_per_session ? `$${request.budget_per_session}` : "—"} />
          <RefDetail label="Therapy history" value={request.previous_therapy ? "Has prior therapy" : "First-time"} />
          <RefDetail label="Urgency" value={request.urgency} />
          <RefDetail label="Preferred gender" value={request.gender_preference || "Any"} />
          <RefDetail label="Preferred language" value={request.preferred_language || "English"} />
          <RefDetail label="Concerns" value={issues || "—"} span={2} />
          {(request.preferred_modalities || []).length > 0 && (
            <RefDetail
              label="Preferred therapy approaches"
              value={(request.preferred_modalities || []).join(", ")}
              span={2}
            />
          )}
          {request.notes && (
            <RefDetail label="Notes you shared" value={request.notes} span={2} />
          )}
        </div>
      )}
    </section>
  );
}

function RefDetail({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? "sm:col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
        {label}
      </div>
      <div className="text-[#2B2A29] font-medium leading-snug break-words">
        {value || "—"}
      </div>
    </div>
  );
}



export default function PatientResults() {
  const { requestId } = useParams();
  const [data, setData] = useState(null);
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const viewToken = sp.get("t") || "";
  const session = getSession();

  useEffect(() => {
    let active = true;
    const headers = session?.token
      ? { Authorization: `Bearer ${session.token}` }
      : undefined;
    const url = viewToken
      ? `/requests/${requestId}/results?t=${encodeURIComponent(viewToken)}`
      : `/requests/${requestId}/results`;
    const load = () =>
      api.get(url, { headers }).then((res) => {
        if (active) setData(res.data);
      }).catch((err) => {
        if (!active) return;
        if (err?.response?.status === 401) {
          // Magic-code login required (no token + no/expired session).
          // Patient signs in with the email that owns this request, then
          // returns here.
          navigate(
            `/sign-in?role=patient&next=${encodeURIComponent(
              `/results/${requestId}`,
            )}`,
            { replace: true },
          );
        }
      });
    load();
    const intervalId = setInterval(load, RESULTS_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [requestId, viewToken, session?.token, navigate]);

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

  // Stage logic for the inline status timeline (no numeric details exposed,
  // per UX direction — just qualitative milestones the patient cares about).
  const matchedAt = request?.matched_at || request?.created_at;
  const releasedAt = request?.results_released_at;
  const stage = !matchedAt
    ? "submitted"
    : hold_active
      ? "matching"
      : applications.length === 0
        ? "waiting"
        : "ready";
  const STAGES = [
    {
      key: "submitted",
      icon: Send,
      title: "Referral submitted",
      sub: "We received your request and started looking for matches.",
    },
    {
      key: "matching",
      icon: Inbox,
      title: "Matching with therapists",
      sub: hold_active
        ? `We'll release your matched therapists within 24 hours — full results unlock ${holdEndsLabel}.`
        : "We'll release your matched therapists within 24 hours.",
    },
    {
      key: "ready",
      icon: CheckCircle2,
      title: "Matches ready",
      sub: releasedAt
        ? "Your matches are live below — reach out whenever you're ready."
        : "Your matched therapists will appear below once the 24-hour window closes.",
    },
  ];
  const stageIdx = { submitted: 0, matching: 1, waiting: 1, ready: 2 }[stage] ?? 0;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="patient-results-page">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Your matches
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                Therapists who want to work with you
              </h1>
            </div>
            {session?.role === "patient" && (
              <Link
                to="/portal/patient"
                className="tv-btn-secondary !py-2 !px-4 text-sm inline-flex items-center gap-1.5"
                data-testid="back-to-dashboard"
              >
                <ArrowLeft size={14} /> Back to dashboard
              </Link>
            )}
          </div>
          <p className="text-[#6D6A65] mt-3 max-w-3xl leading-relaxed">
            These therapists read your anonymous referral and submitted interest.
            Reach out to whoever feels right — many offer a free consult.
          </p>

          {/* Show patient their original request so they can compare */}
          {request && (
            <YourReferralPanel request={request} />
          )}

          {hold_active && (
            <StatusTimeline
              stages={STAGES}
              activeIdx={stageIdx}
              holdEndsLabel={holdEndsLabel}
            />
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
                          {t.years_experience
                            ? `${t.years_experience} year${t.years_experience === 1 ? "" : "s"} experience`
                            : "Experience: —"}{" "}
                          •{" "}
                          {(t.modalities || []).slice(0, 3).join(" · ") || "—"}
                          {t.review_count >= 10 && t.review_avg >= 4.0 && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 text-[10px] text-[#C87965] bg-[#FDFBF7] border border-[#E8E5DF] rounded-full px-1.5 py-0.5 align-middle"
                              data-testid={`review-badge-${i}`}
                              title={`Aggregated from ${(t.review_sources || []).map((s) => s.platform).join(", ") || "online sources"}`}
                            >
                              <Star size={9} fill="currentColor" />
                              {t.review_avg.toFixed(1)} · {t.review_count} reviews
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-3 text-xs">
                          <Detail label="Format" value={formatStr} />
                          <Detail
                            label="Cash rate"
                            value={t.cash_rate ? `$${t.cash_rate} / session` : "—"}
                          />
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
                          {typeof app.distance_miles === "number" && (
                            <Detail
                              label="Travel distance"
                              value={`${Math.round(app.distance_miles)} mi`}
                              highlight={app.distance_miles <= 10}
                            />
                          )}
                          {t.office_addresses && t.office_addresses.length > 0 ? (
                            <div className="col-span-2 text-xs">
                              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                                Office
                              </div>
                              <a
                                href={`https://maps.google.com/?q=${encodeURIComponent(t.office_addresses[0])}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-[#2D4A3E] underline decoration-dotted underline-offset-2 hover:text-[#C87965] break-words"
                                data-testid={`therapist-office-map-${i}`}
                              >
                                {t.office_addresses[0]}
                              </a>
                            </div>
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
                          {(() => {
                            const plans = t.insurance_accepted || [];
                            if (plans.length === 0) {
                              return (
                                <Detail
                                  label="Insurance"
                                  value={`Cash only — $${t.cash_rate || "?"}/session`}
                                  span={2}
                                />
                              );
                            }
                            // Show first 4 plans inline + count for any remainder.
                            const head = plans.slice(0, 4).join(", ");
                            const tailN = Math.max(0, plans.length - 4);
                            return (
                              <Detail
                                label="Insurance"
                                value={tailN > 0 ? `${head} +${tailN} more` : head}
                                span={2}
                              />
                            );
                          })()}
                          {(t.languages_spoken || []).length > 0 && (
                            <Detail
                              label="Languages"
                              value={["English", ...t.languages_spoken].join(", ")}
                              span={2}
                            />
                          )}
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

                        {/* Match gaps — what's missing from a 100% fit. Helps the
                            patient understand why this isn't a perfect match. */}
                        {(() => {
                          const gaps = matchGaps(app.match_breakdown, request, t);
                          if (gaps.length === 0) return null;
                          return (
                            <div
                              className="mt-3 bg-[#FDF7EC] border border-[#E8DCC1] rounded-lg p-3"
                              data-testid={`gaps-${i}`}
                            >
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#C87965] font-semibold">
                                <AlertCircle size={11} />
                                Where you may not align ({Math.round(100 - app.match_score)}% gap)
                              </div>
                              <ul className="mt-1.5 space-y-0.5">
                                {gaps.map((g) => (
                                  <li
                                    key={g.key}
                                    className="text-xs text-[#6D6A65] leading-relaxed flex items-start gap-1.5"
                                    data-testid={`gap-${i}-${g.key}`}
                                  >
                                    <span className="text-[#C87965] mt-0.5">•</span>
                                    <span>{g.label}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}

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

          {/* Refer-a-friend — quietly suggest the patient share TheraVoca with
              someone they know who's looking. Plain attribution, no incentive. */}
          {request?.patient_referral_code && (
            <ReferFriendTile code={request.patient_referral_code} />
          )}

          {/* "Try again" — give patients a way to re-run intake if matches don't feel right.
              We send them back to /#start — the homepage's intake form is the canonical entry. */}
          {!hold_active && applications.length > 0 && (
            <div
              className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-6 text-center"
              data-testid="results-try-again-section"
            >
              <h3 className="font-serif-display text-xl text-[#2D4A3E]">
                Not feeling these matches?
              </h3>
              <p className="text-sm text-[#6D6A65] mt-1.5 max-w-md mx-auto leading-relaxed">
                Sometimes a few tweaks to your answers surfaces a totally different
                set of therapists. Run the intake again — it takes 2 minutes.
              </p>
              <Link
                to="/#start"
                className="tv-btn-primary mt-5 inline-flex"
                data-testid="results-try-again-btn"
                onClick={() => {
                  setTimeout(() => {
                    document
                      .getElementById("start")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 250);
                }}
              >
                Try again with different answers <ArrowRight size={16} />
              </Link>
            </div>
          )}

          {/* Submit-another-request CTA — always visible at the very bottom of the results page */}
          <div
            className="mt-10 text-center"
            data-testid="submit-another-request-section"
          >
            <Link
              to="/#start"
              className="tv-btn-primary inline-flex items-center gap-2"
              data-testid="submit-another-request-btn"
              onClick={() => {
                setTimeout(() => {
                  document
                    .getElementById("start")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 250);
              }}
            >
              <Plus size={16} /> Submit another request
            </Link>
            <p className="text-xs text-[#6D6A65] mt-2">
              Looking for a different therapist for someone else, or for a separate concern?
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ReferFriendTile({ code }) {
  const link = `${window.location.origin}/?ref=${code}`;
  const copy = () => {
    navigator.clipboard
      .writeText(link)
      .then(() => toast.success("Invite link copied!"))
      .catch(() => toast.error("Couldn't copy link"));
  };
  return (
    <section
      className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 flex items-start justify-between gap-4 flex-wrap"
      data-testid="refer-friend-tile"
    >
      <div className="flex items-start gap-3 flex-1 min-w-[220px]">
        <Share2 size={18} className="text-[#C87965] mt-1 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-[#2B2A29]">
            Know someone else looking for a therapist?
          </div>
          <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
            Share TheraVoca with a friend or family member. They'll get the same
            anonymous matching service — no signup, no spam.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2 text-xs font-medium text-[#2D4A3E] hover:border-[#2D4A3E] transition shrink-0"
        data-testid="refer-friend-copy-btn"
      >
        Copy invite link
      </button>
    </section>
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

function StatusTimeline({ stages, activeIdx, holdEndsLabel }) {
  return (
    <section
      className="mt-7 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6"
      data-testid="results-status-timeline"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#C87965]">
            What happens next
          </p>
          <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-1 leading-tight">
            We're matching you with therapists right now
          </h2>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-full px-2.5 py-1">
          <Clock size={12} strokeWidth={2} />
          Unlocks {holdEndsLabel}
        </div>
      </div>

      <ol className="relative pl-6 sm:pl-8">
        {stages.map((s, i) => {
          const Icon = s.icon || Sparkles;
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          const isPending = i > activeIdx;
          const dotColor = isPending
            ? "bg-[#E8E5DF] text-[#A8A39A]"
            : isActive
              ? "bg-[#C87965] text-white"
              : "bg-[#2D4A3E] text-white";
          const lineColor =
            i < stages.length - 1
              ? isPending
                ? "bg-[#E8E5DF]"
                : "bg-[#2D4A3E]"
              : "bg-transparent";
          return (
            <li
              key={s.key}
              className="relative pb-6 last:pb-0"
              data-testid={`status-stage-${s.key}`}
            >
              <span
                className={`absolute -left-[3px] sm:-left-[1px] top-0 inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-white ${dotColor} shadow-sm ${
                  isActive ? "ring-2 ring-[#C87965]/30" : ""
                }`}
              >
                <Icon size={13} strokeWidth={2.2} />
              </span>
              <span
                aria-hidden="true"
                className={`absolute left-[10px] sm:left-[12px] top-7 bottom-0 w-0.5 ${lineColor}`}
              />
              <div className="ml-7 sm:ml-9">
                <div
                  className={`text-sm font-semibold ${
                    isPending ? "text-[#A8A39A]" : "text-[#2B2A29]"
                  }`}
                >
                  {s.title}
                  {isActive && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#C87965]">
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-[#C87965] opacity-60 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#C87965]" />
                      </span>
                      In progress
                    </span>
                  )}
                  {isDone && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-[#2D4A3E]">
                      Done
                    </span>
                  )}
                </div>
                <p
                  className={`text-xs mt-1 leading-relaxed ${
                    isPending ? "text-[#A8A39A]" : "text-[#6D6A65]"
                  }`}
                >
                  {s.sub}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
