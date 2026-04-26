import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Phone, Mail, Star } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";

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
    const id = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(id);
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
                    <div>
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

                  <p className="mt-5 text-[#2B2A29] leading-relaxed border-l-4 border-[#C87965] pl-4 italic">
                    "{app.message}"
                  </p>

                  <div className="mt-5 grid sm:grid-cols-2 gap-3">
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
