import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api, setSession, getSession } from "@/lib/api";
import { Input } from "@/components/ui/input";

const ROLE_INFO = {
  patient: {
    label: "Patient",
    blurb: "Track your matching status and review responses from therapists.",
    portal: "/portal/patient",
  },
  therapist: {
    label: "Therapist",
    blurb: "See referrals you've been matched with and your responses.",
    portal: "/portal/therapist",
  },
};

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialRole = params.get("role") === "therapist" ? "therapist" : "patient";
  const [role, setRole] = useState(initialRole);
  const [step, setStep] = useState("email"); // email | code
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    const session = getSession();
    if (session?.role) {
      navigate(ROLE_INFO[session.role]?.portal || "/", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendCode = async () => {
    if (!email.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/request-code", { email, role });
      toast.success(`Code sent to ${email}`);
      setStep("code");
      setResendCooldown(30);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send code");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/auth/verify-code", { email, role, code });
      setSession(res.data);
      toast.success("Signed in");
      navigate(ROLE_INFO[role].portal);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid or expired code");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md bg-white border border-[#E8E5DF] rounded-3xl p-8 sm:p-10" data-testid="signin-card">
          <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] text-center">
            Sign in
          </p>
          <h1 className="font-serif-display text-4xl text-[#2D4A3E] text-center mt-2 leading-tight">
            Welcome back
          </h1>

          {step === "email" && (
            <>
              <div className="mt-7 grid grid-cols-2 gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-full p-1">
                {Object.entries(ROLE_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => setRole(key)}
                    className={`text-sm py-2 rounded-full transition ${
                      role === key
                        ? "bg-[#2D4A3E] text-white font-semibold"
                        : "text-[#6D6A65] hover:text-[#2D4A3E]"
                    }`}
                    data-testid={`role-${key}`}
                  >
                    {info.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-[#6D6A65] text-center mt-4 leading-relaxed">
                {ROLE_INFO[role].blurb}
              </p>
              <label className="mt-7 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                Email address
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
                />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  data-testid="signin-email"
                />
              </div>
              <button
                type="button"
                onClick={sendCode}
                disabled={submitting || !email}
                className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
                data-testid="signin-send-code"
              >
                {submitting ? "Sending..." : "Send me a code"}{" "}
                <ArrowRight size={16} />
              </button>
              {role === "therapist" && (
                <p className="mt-5 text-xs text-[#6D6A65] text-center">
                  Not in our network yet?{" "}
                  <Link
                    to="/therapists/join#signup-form"
                    className="text-[#2D4A3E] underline"
                    data-testid="signin-join-link"
                  >
                    Join here
                  </Link>
                </p>
              )}
              <p className="mt-5 text-xs text-[#6D6A65] text-center">
                Admin? <Link to="/admin" className="text-[#2D4A3E] underline">Sign in here</Link>
              </p>
            </>
          )}

          {step === "code" && (
            <>
              <p className="text-sm text-[#6D6A65] text-center mt-6 leading-relaxed">
                We sent a 6-digit code to{" "}
                <span className="text-[#2D4A3E] font-semibold">{email}</span>. It
                expires in 30 minutes.
              </p>
              <label className="mt-7 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                Verification code
              </label>
              <div className="relative">
                <KeyRound
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
                />
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="pl-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl tracking-[0.4em] font-mono text-lg"
                  onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                  data-testid="signin-code"
                />
              </div>
              <button
                type="button"
                onClick={verifyCode}
                disabled={submitting || code.length !== 6}
                className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
                data-testid="signin-verify"
              >
                {submitting ? "Verifying..." : "Verify & sign in"}
              </button>
              <div className="mt-5 flex items-center justify-between text-xs text-[#6D6A65]">
                <button
                  className="flex items-center gap-1 hover:text-[#2D4A3E]"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                  }}
                  data-testid="signin-back"
                >
                  <ArrowLeft size={12} /> Different email
                </button>
                <button
                  className="hover:text-[#2D4A3E] disabled:opacity-50"
                  disabled={resendCooldown > 0}
                  onClick={sendCode}
                  data-testid="signin-resend"
                >
                  {resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend code"}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
