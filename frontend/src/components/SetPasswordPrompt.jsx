/**
 * SetPasswordPrompt — collapsible card surfaced in the Patient/Therapist
 * portal when the signed-in user is still on magic-code-only auth. Lets
 * them set a password inline so future sign-ins skip the email round-trip.
 *
 * Stays out of the way (small banner + expand) until the user opts in,
 * and disappears entirely after a successful save (parent re-fetches and
 * stops rendering this component).
 */
import { useState } from "react";
import { Lock, Eye, EyeOff, ChevronDown, KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { sessionClient } from "@/lib/api";
import { Input } from "@/components/ui/input";

export default function SetPasswordPrompt({ onDone }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const save = async () => {
    if (pw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await sessionClient().post("/auth/set-password", { password: pw });
      toast.success("Password set — sign in faster next time.");
      setOpen(false);
      setPw("");
      setPw2("");
      onDone?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not set password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-6 bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5"
      data-testid="set-password-prompt"
    >
      <div className="flex flex-col sm:flex-row items-stretch sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <KeyRound size={18} className="text-[#2D4A3E] mt-1 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#2B2A29]">
              Set a password — skip the codes next time
            </div>
            <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
              You're signed in via a one-time email code. Set a password so
              future sign-ins are one tap, and you can come back any time to
              track your referrals.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 self-end sm:self-start">
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="tv-btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-1.5"
              data-testid="set-password-open"
            >
              Set a password <ChevronDown size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[#6D6A65] hover:text-[#2D4A3E] p-2 rounded-full"
            aria-label="Dismiss"
            data-testid="set-password-dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-5 space-y-3" data-testid="set-password-form">
          <div className="relative">
            <Lock
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
            />
            <Input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="pl-9 pr-9 bg-white border-[#E8E5DF] rounded-xl"
              data-testid="set-password-input-1"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6D6A65] hover:text-[#2D4A3E]"
              tabIndex={-1}
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="relative">
            <Lock
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65]"
            />
            <Input
              type={showPw ? "text" : "password"}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Confirm password"
              className="pl-9 bg-white border-[#E8E5DF] rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && save()}
              data-testid="set-password-input-2"
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPw("");
                setPw2("");
              }}
              className="tv-btn-secondary !py-2 !px-3 text-xs"
              data-testid="set-password-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || pw.length < 8 || pw !== pw2}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="set-password-save"
            >
              {saving ? "Saving..." : "Save password"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
