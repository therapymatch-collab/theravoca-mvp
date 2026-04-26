import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/login", { password: pwd });
      sessionStorage.setItem("tv_admin_pwd", pwd);
      navigate("/admin/dashboard");
    } catch {
      toast.error("Invalid password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <form
          onSubmit={submit}
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
            Enter the admin password to continue.
          </p>
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Password"
            className="mt-6 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="admin-password-input"
          />
          <button
            type="submit"
            disabled={busy}
            className="tv-btn-primary w-full mt-5 justify-center disabled:opacity-50"
            data-testid="admin-login-btn"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </main>
      <Footer />
    </div>
  );
}
