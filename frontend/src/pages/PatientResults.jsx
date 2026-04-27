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
      if (!meta) return null;
      const pct = meta.max > 0 ? v / meta.max : 0;
      return { key: k, score: v, max: meta.max, pct, label: meta.label };
    })
    .filter((x) => x && x.pct >= 0.5) // only surface meaningful matches
    // Sort by raw score descending (issues=35 outranks gender=3 on a tie of 100%)
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

  const { request, applications } = data;

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
          <p className="text-[#6D6A65] mt-3 max-w-2xl">
            These therapists read your anonymous referral and submitted interest.
            Reach out to whoever feels right — many offer a free consult.
          </p>

          <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-5 grid sm:grid-cols-3 gap-4 text-sm">
            <Stat label="Status" value={request.status?.replace("_", " ")} />
            <Stat
              label="Therapists notified"
              value={(request.notified_therapist_ids || []).length}
            />
            <Stat label="Responses received" value={applications.length} />
          </div>

          {applications.length === 0 ? (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center">
              <Loader2 className="animate-spin mx-auto text-[#2D4A3E]" />
              <p className="text-[#6D6A65] mt-4">
                Therapists are reviewing your referral. Responses typically arrive within
                24 hours. We'll email you as soon as your matches are ready.
              </p>
            </div>
          ) : (
            <div className="mt-10 space-y-5">
              {applications.map((app, i) => (
                <article
                  key={app.id}
                  className="bg-white border border-[#E8E5DF] rounded-2xl p-6 md:p-8 hover:-translate-y-0.5 transition"
                  data-testid={`result-card-${i}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <div
                        className="w-16 h-16 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0"
                        data-testid={`avatar-${i}`}
                      >
                        {app.therapist.profile_picture ? (
                          <img
                            src={app.therapist.profile_picture}
                            alt={app.therapist.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="font-serif-display text-xl text-[#2D4A3E]">
                            {(app.therapist.name || "")
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
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white text-xs font-semibold px-3 py-1 rounded-full">
                          <Star size={12} fill="currentColor" />
                          {Math.round(app.match_score)}% match
                        </div>
                        <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-3">
                          {app.therapist.name}
                        </h3>
                        <div className="text-sm text-[#6D6A65] mt-1">
                          {app.therapist.years_experience} yrs experience •{" "}
                          {app.therapist.modalities?.slice(0, 3).join(", ")}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-[#2B2A29] font-semibold">
                        ${app.therapist.cash_rate}/session
                      </div>
                      {app.therapist.free_consult && (
                        <div className="text-xs text-[#C87965] mt-1">
                          ✦ Free consult available
                        </div>
                      )}
                    </div>
                  </div>

                  {app.message && app.message.trim().length > 0 ? (
                    <p className="mt-5 text-[#2B2A29] leading-relaxed border-l-4 border-[#C87965] pl-4 italic">
                      "{app.message}"
                    </p>
                  ) : (
                    <p className="mt-5 text-[#6D6A65] leading-relaxed border-l-4 border-[#E8E5DF] pl-4 italic text-sm">
                      This therapist submitted interest without a personal note.
                      Reach out below — many offer a free 15-minute consult to see
                      if you're a fit.
                    </p>
                  )}

                  {topReasons(app.match_breakdown).length > 0 && (
                    <div
                      className="mt-5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4"
                      data-testid={`why-match-${i}`}
                    >
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#6D6A65] mb-2.5">
                        <Sparkles size={14} className="text-[#C87965]" />
                        Why we matched
                      </div>
                      <ul className="flex flex-wrap gap-2">
                        {topReasons(app.match_breakdown).map((r) => (
                          <li
                            key={r.key}
                            className="text-xs sm:text-sm bg-white border border-[#E8E5DF] text-[#2B2A29] px-3 py-1.5 rounded-full"
                            data-testid={`why-match-${i}-${r.key}`}
                          >
                            {r.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-5 grid sm:grid-cols-2 gap-3">
                    <a
                      href={buildConsultMailto(app.therapist, request)}
                      className="flex items-center gap-2 bg-[#2D4A3E] text-white border border-[#2D4A3E] rounded-xl px-4 py-3 text-sm font-medium hover:bg-[#3A5E50] transition col-span-full"
                      data-testid={`consult-btn-${i}`}
                    >
                      <CalendarPlus size={16} />
                      <span>Schedule a free 15-min consult</span>
                    </a>
                    <a
                      href={`mailto:${app.therapist.email}`}
                      className="flex items-center gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm hover:border-[#2D4A3E] transition"
                      data-testid={`contact-email-${i}`}
                    >
                      <Mail size={16} className="text-[#2D4A3E]" />
                      <span className="text-[#2B2A29]">{app.therapist.email}</span>
                    </a>
                    {app.therapist.phone && (
                      <a
                        href={`tel:${app.therapist.phone}`}
                        className="flex items-center gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm hover:border-[#2D4A3E] transition"
                        data-testid={`contact-phone-${i}`}
                      >
                        <Phone size={16} className="text-[#2D4A3E]" />
                        <span className="text-[#2B2A29]">{app.therapist.phone}</span>
                      </a>
                    )}
                  </div>

                  <div className="mt-5 text-xs text-[#6D6A65]">
                    Specialties:{" "}
                    {(app.therapist.specialties || [])
                      .map((s) => s.name)
                      .slice(0, 5)
                      .join(", ")}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.15em] text-[#6D6A65]">{label}</div>
      <div className="font-serif-display text-2xl text-[#2D4A3E] mt-1 capitalize">
        {value}
      </div>
    </div>
  );
}
