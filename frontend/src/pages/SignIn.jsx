import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Mail, KeyRound, ArrowLeft, Lock, Eye, EyeOff } from "lucide-react";
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
  // step: email | code | password | setup-password
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [hasPassword, setHasPassword] = useState(null); // null = unknown, true/false
  const [method, setMethod] = useState(null); // null = auto, 'password' | 'code'
  // Effective sign-in method: if user picked one, honour it; otherwise
  // default to password when we know the account has one, code otherwise.
  const effectiveMethod = method || (hasPassword ? "password" : "code");
  const nextPath = params.get("next");
  const setupFlag = params.get("setup") === "1";

  // If already signed in, bounce straight to the portal (or the requested
  // `next` path).
  useEffect(() => {
    const session = getSession();
    if (session?.role && !setupFlag) {
      navigate(nextPath || ROLE_INFO[session.role]?.portal || "/", { replace: true });
    }
  }, [navigate, nextPath, setupFlag]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Whenever the email input changes (debounced) or role flips, look up
  // whether the account already has a password set so we can choose the
  // right primary input (password vs. magic code).
  useEffect(() => {
    if (step !== "email") return;
    if (!email.includes("@")) {
      setHasPassword(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get(`/auth/password-status?email=${encodeURIComponent(email)}&role=${role}`)
        .then((r) => setHasPassword(!!r.data?.has_password))
        .catch(() => setHasPassword(null));
    }, 350);
    return () => clearTimeout(t);
  }, [email, role, step]);

  const finishLogin = (data) => {
    setSession(data);
    if (setupFlag && !data.has_password) {
      // Returning intake flow asked us to nudge for a password — drop them
      // straight into the setup step instead of bouncing to the portal.
      setStep("setup-password");
      toast.success("Email verified — set a password to finish setup.");
      return;
    }
    toast.success("Signed in");
    navigate(nextPath || ROLE_INFO[role].portal);
  };

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
      finishLogin(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid or expired code");
    } finally {
      setSubmitting(false);
    }
  };

  const loginWithPassword = async () => {
    if (!password) {
      toast.error("Enter your password");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/auth/login-password", { email, password, role });
      finishLogin(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Email or password is incorrect");
    } finally {
      setSubmitting(false);
    }
  };

  const submitNewPassword = async () => {
    if (newPw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPw !== newPw2) {
      toast.error("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/set-password", { password: newPw });
      toast.success("Password set! You can now sign in with email + password.");
      navigate(nextPath || ROLE_INFO[role].portal);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not set password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md bg-white border border-[#E8E5DF] rounded-3xl p-8 sm:p-10" data-testid="signin-card">
          <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] text-center">
            Sign in
          </p>
          <h1 className="font-serif-display text-4xl text-[#2D4A3E] text-center mt-2 leading-tight">
            {step === "setup-password" ? "Almost done" : "Welcome back"}
          </h1>

          {step === "email" && (
            <>
              <div className="mt-7 grid grid-cols-2 gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-full p-1">
                {Object.entries(ROLE_INFO).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setRole(key);
                      setHasPassword(null);
                      setPassword("");
                    }}
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

              {/* Sign-in method toggle — patients & therapists with an
                  existing password can pick "Password"; everyone else
                  uses the one-time "Email code" path. */}
              <div
                className="mt-6 grid grid-cols-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-full p-1 text-sm"
                data-testid="signin-method-toggle"
              >
                <button
                  type="button"
                  onClick={() => setMethod("password")}
                  className={`rounded-full py-2 transition flex items-center justify-center gap-1.5 ${
                    effectiveMethod === "password"
                      ? "bg-[#2D4A3E] text-white font-semibold"
                      : "text-[#6D6A65] hover:text-[#2D4A3E]"
                  }`}
                  data-testid="signin-method-password"
                >
                  <Lock size={13} /> Password
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("code")}
                  className={`rounded-full py-2 transition flex items-center justify-center gap-1.5 ${
                    effectiveMethod === "code"
                      ? "bg-[#2D4A3E] text-white font-semibold"
                      : "text-[#6D6A65] hover:text-[#2D4A3E]"
                  }`}
                  data-testid="signin-method-code"
                >
                  <Mail size={13} /> Email code
                </button>
              </div>

              <label className="mt-6 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (effectiveMethod === "password") loginWithPassword();
                      else sendCode();
                    }
                  }}
                  data-testid="signin-email"
                />
              </div>

              {/* Password input — shown when user picked Password method */}
              {effectiveMethod === "password" && (
                <>
                  {hasPassword === false && email.includes("@") && (
                    <p
                      className="text-xs text-[#C87965] text-center mt-3"
                      data-testid="signin-no-password-warning"
                    >
                      No password is set for this email yet — switch to{" "}
                      <button
                        type="button"
                        onClick={() => setMethod("code")}
                        className="underline hover:text-[#2D4A3E]"
                      >
                        Email code
                      </button>{" "}
                      to sign in, then set a password after.
                    </p>
                  )}
                  {hasPassword && (
                    <p className="text-xs text-[#6D6A65] text-center mt-3">
                      Welcome back — we found an account for{" "}
                      <span className="text-[#2D4A3E] font-medium">{email}</span>.
                    </p>
                  )}
                  <label className="mt-4 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
                    />
                    <Input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-10 pr-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      onKeyDown={(e) => e.key === "Enter" && loginWithPassword()}
                      data-testid="signin-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6D6A65] hover:text-[#2D4A3E]"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={loginWithPassword}
                    disabled={submitting || !password}
                    className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
                    data-testid="signin-login-password"
                  >
                    {submitting ? "Signing in..." : "Sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={submitting}
                    className="w-full mt-3 text-xs text-[#2D4A3E] hover:underline"
                    data-testid="signin-use-code"
                  >
                    Forgot password? Email me a one-time code instead
                  </button>
                </>
              )}

              {/* Magic-code primary path — when user picked Email code */}
              {effectiveMethod === "code" && (
                <>
                  {hasPassword && (
                    <p
                      className="text-xs text-[#6D6A65] text-center mt-3"
                      data-testid="signin-has-password-hint"
                    >
                      This email has a password —{" "}
                      <button
                        type="button"
                        onClick={() => setMethod("password")}
                        className="underline hover:text-[#2D4A3E]"
                      >
                        sign in with password
                      </button>{" "}
                      instead, or get a one-time code below.
                    </p>
                  )}
                  {hasPassword === false && email.includes("@") && (
                    <p
                      className="text-xs text-[#6D6A65] text-center mt-3"
                      data-testid="signin-no-password-hint"
                    >
                      No password yet for this email — we'll send a one-time
                      sign-in code instead. You can set a password after
                      signing in.
                    </p>
                  )}
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
                </>
              )}

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
              <p className="mt-3 text-xs text-[#6D6A65] text-center">
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

          {step === "setup-password" && (
            <>
              <p className="text-sm text-[#6D6A65] text-center mt-6 leading-relaxed">
                Set a password so next time you can sign in with one tap —
                no codes needed.
              </p>
              <label className="mt-6 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                New password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
                />
                <Input
                  type={showPw ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="At least 8 characters"
                  className="pl-10 pr-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  data-testid="signin-newpw-1"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6D6A65] hover:text-[#2D4A3E]"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <label className="mt-4 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                Confirm password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
                />
                <Input
                  type={showPw ? "text" : "password"}
                  value={newPw2}
                  onChange={(e) => setNewPw2(e.target.value)}
                  placeholder="Re-enter password"
                  className="pl-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  onKeyDown={(e) => e.key === "Enter" && submitNewPassword()}
                  data-testid="signin-newpw-2"
                />
              </div>
              <button
                type="button"
                onClick={submitNewPassword}
                disabled={submitting || newPw.length < 8 || newPw !== newPw2}
                className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
                data-testid="signin-newpw-save"
              >
                {submitting ? "Saving..." : "Save & continue"}
              </button>
              <button
                type="button"
                onClick={() => navigate(nextPath || ROLE_INFO[role].portal)}
                className="w-full mt-3 text-xs text-[#6D6A65] hover:text-[#2D4A3E]"
                data-testid="signin-newpw-skip"
              >
                Skip for now — I'll do this later
              </button>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
