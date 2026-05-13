import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, ShieldCheck } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { sessionClient, getSession } from "@/lib/api";

/**
 * "My sign-in history" page. Mounted at:
 *   /portal/patient/login-history
 *   /portal/therapist/login-history
 *
 * Same component for both -- only the role prop changes (drives the
 * back-link target + a tiny copy variation in the intro).
 *
 * Data comes from GET /api/portal/login-history (auth-required).
 * Backend returns up to 50 events, newest-first, each annotated with
 * is_new_device.
 *
 * Hardening fix #3 (2026-05-13).
 */
export default function LoginHistory({ role }) {
  const navigate = useNavigate();
  const session = getSession();

  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session || session.role !== role) {
      navigate(`/sign-in?role=${role}`, { replace: true });
      return;
    }
    sessionClient()
      .get("/portal/login-history")
      .then((res) => setEvents(res.data?.events || []))
      .catch((e) => setError(e?.response?.data?.detail || "Couldn't load sign-in history."));
  }, [session, role, navigate]);

  const portalPath = role === "therapist" ? "/portal/therapist" : "/portal/patient";
  const portalLabel = role === "therapist" ? "My referrals" : "My matches";
  const intro =
    role === "therapist"
      ? "Every time you sign in to your therapist portal, we log when + the device you used. Therapist accounts can see incoming patient referral details, so unfamiliar sign-ins should be acted on quickly."
      : "Every time you sign in to TheraVoca, we log when + the device you used. If you see something here that wasn't you, sign out everywhere and reset your password.";

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16">
        <div className="max-w-3xl mx-auto" data-testid="login-history-page">
          <Link
            to={portalPath}
            className="inline-flex items-center gap-1.5 text-sm text-[#6D6A65] hover:text-[#2D4A3E]"
            data-testid="login-history-back"
          >
            <ArrowLeft size={14} /> {portalLabel}
          </Link>
          <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] mt-3">
            My sign-in history
          </h1>
          <p className="text-[#6D6A65] mt-2 leading-relaxed">
            {intro}
          </p>

          <div className="mt-6 bg-white border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm text-[#2B2A29] leading-relaxed">
            <strong className="text-[#2D4A3E]">Showing your last 50 sign-ins.</strong>{" "}
            Older events are deleted automatically after 90 days.
          </div>

          {error && (
            <div className="mt-6 bg-[#FDF1EF] border border-[#E8C4BB] rounded-xl px-4 py-3 text-sm text-[#5C2620]"
                 data-testid="login-history-error">
              {error}
            </div>
          )}

          {events === null && !error && (
            <div className="mt-6 bg-white border border-[#E8E5DF] rounded-xl p-10 text-center text-[#6D6A65]"
                 data-testid="login-history-loading">
              <Loader2 className="animate-spin inline mr-2" /> Loading...
            </div>
          )}

          {events && events.length === 0 && (
            <div className="mt-6 bg-white border border-[#E8E5DF] rounded-xl p-10 text-center text-[#6D6A65]"
                 data-testid="login-history-empty">
              No sign-in events yet.
            </div>
          )}

          {events && events.length > 0 && (
            <div className="mt-6 bg-white border border-[#E8E5DF] rounded-xl overflow-hidden"
                 data-testid="login-history-list">
              {events.map((ev, i) => (
                <EventRow key={i} ev={ev} />
              ))}
            </div>
          )}

          <div className="mt-8 bg-[#FDF1EF] border border-[#E8C4BB] rounded-xl px-5 py-4 text-sm text-[#5C2620] leading-relaxed"
               data-testid="login-history-recovery">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 flex-shrink-0 text-[#8B3220]" />
              <div>
                <strong className="text-[#8B3220]">Don't recognize one of these?</strong>
                {role === "therapist"
                  ? " Open Edit profile and rotate your password. "
                  : " Open your account settings and rotate your password. "}
                If you can't get in, email{" "}
                <a href="mailto:support@theravoca.com" className="font-semibold text-[#8B3220]">
                  support@theravoca.com
                </a>{" "}
                and we'll help recover the account.
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function EventRow({ ev }) {
  const tsStr = useMemo(() => formatTimestamp(ev.ts), [ev.ts]);
  const ago = useMemo(() => formatAgo(ev.ts), [ev.ts]);
  const device = useMemo(() => parseUserAgent(ev.user_agent || ""), [ev.user_agent]);

  return (
    <div className="px-5 py-4 grid grid-cols-[12px_1fr_auto] gap-4 items-center border-b border-[#E8E5DF] last:border-b-0"
         data-testid="login-event-row">
      <span className={`w-2.5 h-2.5 rounded-full ${ev.is_new_device ? "bg-[#C87965]" : "bg-[#4A6B5D]"}`} />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-[#2B2A29] font-medium">{tsStr}</span>
        <span className="text-xs text-[#6D6A65]">{ago}</span>
        <span className="text-xs text-[#6D6A65] mt-0.5">{device}</span>
      </div>
      {ev.is_new_device && (
        <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-[#FBEFE9] text-[#C87965] font-medium"
              data-testid="login-event-new-device">
          new device
        </span>
      )}
    </div>
  );
}

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.round(hr / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

// Cheap UA parser -- pulls browser + OS out of a UA string. Not perfect,
// good enough to say "Chrome / macOS" vs "Safari / iOS". Bot UAs and
// obscure browsers fall through to "(not reported)".
function parseUserAgent(ua) {
  if (!ua) return "(not reported)";
  const s = ua;
  let browser = "Browser";
  if (/edg\//i.test(s)) browser = "Edge";
  else if (/chrome\//i.test(s) && !/edg\//i.test(s)) browser = "Chrome";
  else if (/firefox\//i.test(s)) browser = "Firefox";
  else if (/safari\//i.test(s) && !/chrome\//i.test(s)) browser = "Safari";
  else if (/opera\//i.test(s) || /opr\//i.test(s)) browser = "Opera";

  let os = "device";
  if (/windows/i.test(s)) os = "Windows";
  else if (/mac os x|macintosh/i.test(s)) os = "macOS";
  else if (/iphone|ipad|ios/i.test(s)) os = "iOS";
  else if (/android/i.test(s)) os = "Android";
  else if (/linux/i.test(s)) os = "Linux";

  return `${browser} / ${os}`;
}
