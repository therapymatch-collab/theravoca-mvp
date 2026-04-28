import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { api, setAdminTokenSession, clearAdminSession } from "@/lib/api";
import { STATUS_RATE_LIMITED } from "@/lib/constants";
import { Input } from "@/components/ui/input";

export default function AdminLogin() {
  const navigate = useNavigate();
  // Two modes: master password (legacy super admin) OR per-user email+password
  // (invited team member). Default to "team" since that's the new normal.
  const [mode, setMode] = useState("team");
  const [pwd, setPwd] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const handleErr = (e) => {
    const detail = e?.response?.data?.detail;
    const code = e?.response?.status;
    if (code === STATUS_RATE_LIMITED) {
      toast.error(detail || "Too many attempts. Locked out.");
    } else {
      toast.error(detail || "Sign in failed");
    }
  };

  const submitMaster = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/login", { password: pwd });
      clearAdminSession();
      sessionStorage.setItem("tv_admin_pwd", pwd);
      navigate("/admin/dashboard");
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  };

  const submitTeam = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post("/admin/login-with-email", { email, password: pwd });
      // Clear any stale legacy master-password marker before storing the
      // JWT-based session so adminClient picks up the new token.
      clearAdminSession();
      setAdminTokenSession({ token: res.data.token, email: res.data.email, name: res.data.name });
      navigate("/admin/dashboard");
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <form
          onSubmit={mode === "team" ? submitTeam : submitMaster}
          className="w-full max-w-md bg-white border border-[#E8E5DF] rounded-3xl p-8"
          data-testid="admin-login-form"
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
            <Lock size={20} />
          </div>
          <h1 className="font-serif-display text-3xl text-[#2D4A3E] text-center mt-4">
            Admin
          </h1>
          <p className="text-sm text-[#6D6A65] text-center mt-1">
            {mode === "team"
              ? "Sign in with your team email."
              : "Master password mode."}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-full p-1">
            <button
              type="button"
              onClick={() => setMode("team")}
              className={`text-xs py-2 rounded-full transition ${
                mode === "team"
                  ? "bg-[#2D4A3E] text-white font-semibold"
                  : "text-[#6D6A65]"
              }`}
              data-testid="admin-mode-team"
            >
              Team email
            </button>
            <button
              type="button"
              onClick={() => setMode("master")}
              className={`text-xs py-2 rounded-full transition ${
                mode === "master"
                  ? "bg-[#2D4A3E] text-white font-semibold"
                  : "text-[#6D6A65]"
              }`}
              data-testid="admin-mode-master"
            >
              Master password
            </button>
          </div>

          {mode === "team" && (
            <div className="relative mt-5">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@theravoca.com"
                className="pl-10 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                data-testid="admin-email-input"
              />
            </div>
          )}

          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Password"
            className="mt-3 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="admin-password-input"
          />
          <button
            type="submit"
            disabled={busy || (mode === "team" && !email)}
            className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
            data-testid="admin-login-btn"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="text-[11px] text-[#6D6A65] text-center mt-4 leading-relaxed">
            Don't have a team account yet? Ask another admin to invite you
            from the Team tab.
          </p>
        </form>
      </main>
      <Footer />
    </div>
  );
}
