import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ChevronRight, Inbox, LogOut } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { sessionClient, getSession, clearSession } from "@/lib/api";

export default function PatientPortal() {
  const navigate = useNavigate();
  const session = getSession();
  const [requests, setRequests] = useState(null);

  useEffect(() => {
    if (!session || session.role !== "patient") {
      navigate("/sign-in?role=patient", { replace: true });
      return;
    }
    sessionClient()
      .get("/portal/patient/requests")
      .then((res) => setRequests(res.data))
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearSession();
          navigate("/sign-in?role=patient", { replace: true });
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
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="patient-portal">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Patient portal
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                Your matching journey
              </h1>
              {session && (
                <p className="text-sm text-[#6D6A65] mt-2">
                  Signed in as{" "}
                  <span className="text-[#2D4A3E] font-medium">{session.email}</span>
                </p>
              )}
            </div>
            <button
              onClick={signOut}
              className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1.5"
              data-testid="patient-signout"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          {requests === null && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {requests?.length === 0 && (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-3xl p-12 text-center">
              <Inbox className="mx-auto text-[#C87965] mb-4" size={32} strokeWidth={1.5} />
              <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
                No requests yet
              </h2>
              <p className="text-[#6D6A65] mt-2">
                Submit your first request to start matching with therapists.
              </p>
              <Link
                to="/#start"
                className="tv-btn-primary mt-6 inline-flex"
                data-testid="patient-portal-cta"
              >
                Get matched
              </Link>
            </div>
          )}

          {requests?.length > 0 && (
            <div className="mt-10 space-y-4">
              {requests.map((r) => (
                <Link
                  to={`/results/${r.id}`}
                  key={r.id}
                  className="block bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 hover:-translate-y-0.5 transition"
                  data-testid={`patient-request-${r.id}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <StatusBadge s={r.status} verified={r.verified} />
                        <span className="text-xs text-[#6D6A65]">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#2B2A29] mt-3 leading-relaxed line-clamp-2">
                        {r.presenting_issues}
                      </p>
                      <div className="text-xs text-[#6D6A65] mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Age {r.client_age}</span>
                        <span>{r.location_state}</span>
                        <span>{r.session_format}</span>
                        <span>
                          {r.notified_count} notified · {r.application_count}{" "}
                          response{r.application_count === 1 ? "" : "s"}
                        </span>
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

function StatusBadge({ s, verified }) {
  if (!verified) {
    return (
      <span className="inline-flex text-xs px-2.5 py-1 rounded-full bg-[#C87965]/15 text-[#C87965]">
        check email
      </span>
    );
  }
  const map = {
    open: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    matched: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    completed: "bg-[#4A6B5D]/15 text-[#4A6B5D]",
  };
  return (
    <span
      className={`inline-flex text-xs px-2.5 py-1 rounded-full capitalize ${
        map[s] || "bg-[#E8E5DF]"
      }`}
    >
      {s?.replace("_", " ") || "open"}
    </span>
  );
}
