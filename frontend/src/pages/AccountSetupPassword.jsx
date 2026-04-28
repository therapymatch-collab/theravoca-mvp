/**
 * Drop-in password-setup page reached from the post-verify "Create my
 * account" CTA. Prerequisite: the user must already have a session token
 * (minted by `/requests/verify/{token}` after they clicked the email
 * verification link). If no session is present, we bounce them to the
 * normal sign-in flow.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { sessionClient, getSession } from "@/lib/api";
import { Input } from "@/components/ui/input";

export default function AccountSetupPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/portal/patient";
  const session = getSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  // No session → user landed here without verifying. Send them through
  // the normal sign-in flow so they can request a code.
  useEffect(() => {
    if (!session?.token) {
      navigate("/sign-in?role=patient", { replace: true });
    }
  }, [session, navigate]);

  const submit = async () => {
    if (pw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      toast.error("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await sessionClient().post("/auth/set-password", { password: pw });
      toast.success("You're all set — welcome to your dashboard.");
      navigate(next);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not set password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div
          className="w-full max-w-md bg-white border border-[#E8E5DF] rounded-3xl p-8 sm:p-10"
          data-testid="account-setup-card"
        >
          <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] text-center">
            Almost there
          </p>
          <h1 className="font-serif-display text-4xl text-[#2D4A3E] text-center mt-2 leading-tight">
            Create your password
          </h1>
          <p className="text-sm text-[#6D6A65] text-center mt-3 leading-relaxed">
            One last step — set a password so you can sign in any time and
            track all your matches in one place. No more email codes.
          </p>
          {session?.email && (
            <p className="text-center text-xs text-[#6D6A65] mt-3">
              Account: <span className="text-[#2D4A3E] font-medium">{session.email}</span>
            </p>
          )}

          <label className="mt-7 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
            New password
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]" />
            <Input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters"
              className="pl-10 pr-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="account-setup-pw-1"
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

          <label className="mt-4 block text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
            Confirm password
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]" />
            <Input
              type={showPw ? "text" : "password"}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Re-enter password"
              className="pl-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              data-testid="account-setup-pw-2"
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={busy || pw.length < 8 || pw !== pw2}
            className="tv-btn-primary w-full mt-6 justify-center disabled:opacity-50"
            data-testid="account-setup-save"
          >
            {busy ? "Saving..." : "Save & enter my dashboard"}
          </button>
          <button
            type="button"
            onClick={() => navigate(next)}
            className="w-full mt-3 text-xs text-[#6D6A65] hover:text-[#2D4A3E]"
            data-testid="account-setup-skip"
          >
            Skip for now — I'll set a password later
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
