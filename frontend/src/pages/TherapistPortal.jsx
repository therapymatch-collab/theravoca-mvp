import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ChevronRight,
  LogOut,
  Inbox,
  CheckCircle2,
  Star,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { sessionClient, getSession, clearSession } from "@/lib/api";

export default function TherapistPortal() {
  const navigate = useNavigate();
  const session = getSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session || session.role !== "therapist") {
      navigate("/sign-in?role=therapist", { replace: true });
      return;
    }
    sessionClient()
      .get("/portal/therapist/referrals")
      .then((res) => setData(res.data))
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearSession();
          navigate("/sign-in?role=therapist", { replace: true });
        } else {
          setError(e?.response?.data?.detail || "Could not load referrals");
        }
      });
  }, [session, navigate]);

  const signOut = () => {
    clearSession();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-portal">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Therapist portal
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                {data?.therapist?.name?.split(",")[0] || "Your"} referrals
              </h1>
              {data?.therapist && (
                <p className="text-sm text-[#6D6A65] mt-2">
                  Signed in as{" "}
                  <span className="text-[#2D4A3E] font-medium">
                    {data.therapist.email}
                  </span>
                </p>
              )}
            </div>
            <button
              onClick={signOut}
              className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1.5"
              data-testid="therapist-signout"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          {error && (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-8 text-center">
              <p className="text-[#D45D5D]">{error}</p>
            </div>
          )}

          {!error && data === null && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {data?.referrals?.length === 0 && (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-3xl p-12 text-center">
              <Inbox className="mx-auto text-[#C87965] mb-4" size={32} strokeWidth={1.5} />
              <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
                No referrals yet
              </h2>
              <p className="text-[#6D6A65] mt-2">
                When a patient request matches your profile (60%+), it will appear here
                and we'll send you an email.
              </p>
            </div>
          )}

          {data?.referrals?.length > 0 && (
            <div className="mt-10 space-y-4">
              {data.referrals.map((r) => (
                <Link
                  to={`/therapist/apply/${r.request_id}/${data.therapist.id}`}
                  key={r.request_id}
                  className="block bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 hover:-translate-y-0.5 transition"
                  data-testid={`therapist-referral-${r.request_id}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                          <Star size={10} fill="currentColor" />
                          {Math.round(r.match_score)}% match
                        </span>
                        {r.applied ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#4A6B5D]/15 text-[#4A6B5D]">
                            <CheckCircle2 size={11} /> applied
                          </span>
                        ) : (
                          <span className="inline-flex text-xs px-2.5 py-1 rounded-full bg-[#C87965]/15 text-[#C87965]">
                            new
                          </span>
                        )}
                        <span className="text-xs text-[#6D6A65]">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#2B2A29] mt-3 leading-relaxed line-clamp-2">
                        {r.presenting_issues_preview}
                        {r.presenting_issues_preview?.length === 140 && "…"}
                      </p>
                      <div className="text-xs text-[#6D6A65] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Age {r.summary["Client age"]}</span>
                        <span>{r.summary.State}</span>
                        <span>{r.summary.Format}</span>
                        <span>{r.summary.Payment}</span>
                      </div>
                    </div>
                    <ChevronRight className="text-[#6D6A65] mt-1" size={18} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
