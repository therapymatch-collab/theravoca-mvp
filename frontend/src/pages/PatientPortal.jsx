import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ChevronRight,
  Inbox,
  LogOut,
  Mail,
  CheckCircle2,
  Users,
  Sparkles,
  ClipboardCheck,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import SetPasswordPrompt from "@/components/SetPasswordPrompt";
import useSiteCopy from "@/lib/useSiteCopy";
import { sessionClient, getSession, clearSession } from "@/lib/api";

export default function PatientPortal() {
  const navigate = useNavigate();
  const t = useSiteCopy();
  const rawSession = getSession();
  // Memoize session by its values, not object reference, to prevent
  // infinite useEffect re-runs (getSession returns a new object each call).
  const session = useMemo(
    () => rawSession,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawSession?.token, rawSession?.role, rawSession?.email],
  );
  const [requests, setRequests] = useState(null);
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "patient") {
      navigate("/sign-in?role=patient", { replace: true });
      return;
    }
    sessionClient()
      .get("/portal/patient/requests")
      .then((res) => {
        // Backend returns `{requests, has_password, email}` — fall back to
        // the older array shape just in case (during a rolling deploy).
        if (Array.isArray(res.data)) {
          setRequests(res.data);
          setHasPassword(false);
        } else {
          setRequests(res.data?.requests || []);
          setHasPassword(!!res.data?.has_password);
        }
      })
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearSession();
          navigate("/sign-in?role=patient", { replace: true });
        }
      });
  }, [session, navigate]);

  const signOut = () => {
    clearSession();
    navigate("/sign-in?role=patient");
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="patient-portal">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Patient portal
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                {t("portal.heading", "Your matching journey")}
              </h1>
              {session && (
                <p className="text-sm text-[#6D6A65] mt-2 break-words">
                  Signed in as{" "}
                  <span className="text-[#2D4A3E] font-medium break-all">{session.email}</span>
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
                {t("portal.empty.heading", "No requests yet")}
              </h2>
              <p className="text-[#6D6A65] mt-2">
                {t(
                  "portal.empty.body",
                  "Submit your first request to start matching with therapists.",
                )}
              </p>
              <Link
                to="/#start"
                className="tv-btn-primary mt-6 inline-flex"
                data-testid="patient-portal-cta"
              >
                {t("portal.empty.cta", "Get matched")}
              </Link>
            </div>
          )}

          {requests?.length > 0 && !hasPassword && (
            <SetPasswordPrompt />
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
                          Submitted {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#2B2A29] mt-3 leading-relaxed line-clamp-2 break-words">
                        {r.presenting_issues}
                      </p>
                      <div className="text-xs text-[#6D6A65] mt-3 flex flex-wrap gap-x-4 gap-y-1 break-words">
                        <span>Age {r.client_age}</span>
                        <span>{r.location_state}</span>
                        <span>{r.session_format}</span>
                      </div>
                    </div>
                    <ChevronRight className="text-[#6D6A65] mt-1" size={18} />
                  </div>

                  <StatusTimeline req={r} />
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

/**
 * Visual 4-step timeline: Submitted → Email verified → Matches → Results ready.
 * Steps light up based on the request's flags so patients can see where they
 * are in the process at a glance. The earlier "Matched" + "Responses" axes
 * were collapsed into a single "Matches" stage so we don't expose internal
 * notify/application counts to patients.
 */
function StatusTimeline({ req }) {
  const verified = !!req.verified;
  const notified = req.notified_count > 0;
  const applied = req.application_count > 0;
  const resultsReady = !!req.results_sent_at || req.status === "completed";

  const steps = [
    {
      key: "submitted",
      label: "Submitted",
      sublabel: shortDate(req.created_at),
      icon: ClipboardCheck,
      done: true,
    },
    {
      key: "verified",
      label: "Email verified",
      sublabel: verified ? "Confirmed" : "Check inbox",
      icon: Mail,
      done: verified,
      pending: !verified,
    },
    {
      key: "matches",
      label: "Matches",
      sublabel: applied
        ? "We found your therapists"
        : notified
          ? "Looking now"
          : verified
            ? "Starting"
            : "Waiting",
      icon: Users,
      done: applied || resultsReady,
      pending: verified && !applied && !resultsReady,
    },
    {
      key: "results",
      label: "Results ready",
      sublabel: resultsReady
        ? shortDate(req.results_sent_at)
        : applied
          ? "Sending soon"
          : "—",
      icon: Sparkles,
      done: resultsReady,
      pending: applied && !resultsReady,
    },
  ];

  // Index of the first non-done step (= the active step).
  const activeIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="mt-5 pt-5 border-t border-[#E8E5DF]" data-testid="status-timeline">
      <div className="grid grid-cols-4 gap-1 sm:gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === activeIdx;
          const isDone = step.done;
          const dotClass = isDone
            ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
            : isActive
            ? "bg-white text-[#C87965] border-[#C87965] ring-4 ring-[#C87965]/15"
            : "bg-[#FDFBF7] text-[#C9C5BD] border-[#E8E5DF]";
          const labelColor = isDone
            ? "text-[#2D4A3E]"
            : isActive
            ? "text-[#C87965]"
            : "text-[#A8A39B]";
          const connectorDone = isDone && i < steps.length - 1 && steps[i + 1].done;
          return (
            <div key={step.key} className="relative flex flex-col items-center text-center">
              {/* connector line to next step (rendered as part of this cell, sits behind dot) */}
              {i < steps.length - 1 && (
                <div
                  className={`absolute top-4 left-1/2 right-[-50%] h-0.5 ${
                    connectorDone ? "bg-[#2D4A3E]" : "bg-[#E8E5DF]"
                  }`}
                  aria-hidden
                />
              )}
              <div
                className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition ${dotClass}`}
                data-testid={`timeline-step-${step.key}-${
                  isDone ? "done" : isActive ? "active" : "todo"
                }`}
              >
                <Icon size={14} strokeWidth={2.2} />
              </div>
              <div className={`mt-2 text-[11px] font-semibold leading-tight break-words ${labelColor}`}>
                {step.label}
              </div>
              <div className="text-[10px] text-[#6D6A65] mt-0.5 leading-tight line-clamp-2 break-words">
