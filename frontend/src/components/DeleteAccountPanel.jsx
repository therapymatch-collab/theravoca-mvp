import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { sessionClient } from "@/lib/api";

// Self-serve account-deletion panel, shared by therapist + patient
// portals. Two-step confirmation: (1) type your email exactly,
// (2) type DELETE in caps. Both must match before the destructive
// POST fires. Backend also re-checks (see routes/portal.py).
//
// Endpoint is /portal/<role>/delete-account.
export default function DeleteAccountPanel({ sessionEmail, role }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const canDelete =
    confirmEmail.trim().toLowerCase() === sessionEmail.toLowerCase() &&
    confirmPhrase === "DELETE";

  // Therapists have a Stripe sub to cancel; patients don't. Copy
  // diverges on that one phrase only.
  const isTherapist = role === "therapist";
  const bodyCopy = isTherapist
    ? "Permanently removes your profile, contact details, license document, and login. Cancels any active TheraVoca subscription at end-of-period (no refund mid-cycle, no surprise renewals). We retain anonymized aggregate analytics + records we're legally required to keep."
    : "Permanently removes your account, your match requests, and your login. We retain anonymized aggregate analytics + records we're legally required to keep.";

  const onDelete = async () => {
    if (!canDelete) return;
    if (!window.confirm(
      "This permanently deletes your account. This cannot be undone after 24 hours. Continue?"
    )) return;
    setBusy(true);
    try {
      await sessionClient().post(`/portal/${role}/delete-account`, {
        confirm_email: confirmEmail.trim(),
        confirm_phrase: confirmPhrase,
      });
      toast.success("Account deleted. You'll be signed out.");
      try { localStorage.removeItem("tv_session"); } catch { /* ignore */ }
      setTimeout(() => navigate("/", { replace: true }), 1000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
      setBusy(false);
    }
  };

  return (
    <section
      className="mt-12 bg-[#FDF1EF] border border-[#E8C4BB] rounded-2xl p-6"
      data-testid="delete-account-panel"
    >
      <h2 className="font-serif-display text-xl text-[#8B3220] flex items-center gap-2">
        <AlertTriangle size={18} /> Delete my account
      </h2>
      <p className="text-sm text-[#5C2620] mt-2 leading-relaxed">
        {bodyCopy} <strong>Reversible within 24 hours if you misclick</strong> -- email{" "}
        <a href="mailto:support@theravoca.com" className="underline text-[#8B3220]">
          support@theravoca.com
        </a>{" "}
        within the window. After 24 hours, deletion is permanent.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-[#8B3220] text-[#8B3220] hover:bg-[#8B3220] hover:text-white transition"
          data-testid="delete-account-open"
        >
          <AlertTriangle size={14} /> Start account deletion
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[#5C2620] font-semibold">
              1. Confirm your email
            </span>
            <input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={sessionEmail}
              className="mt-1 w-full bg-white border border-[#E8C4BB] rounded-xl px-3 py-2 text-sm"
              data-testid="delete-account-email"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[#5C2620] font-semibold">
              2. Type <strong>DELETE</strong> (all caps) to confirm
            </span>
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder="DELETE"
              className="mt-1 w-full bg-white border border-[#E8C4BB] rounded-xl px-3 py-2 text-sm font-mono"
              data-testid="delete-account-phrase"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete || busy}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-[#8B3220] text-white hover:bg-[#6F2818] transition disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="delete-account-confirm"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <AlertTriangle size={14} />
              )}
              Permanently delete my account
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmEmail("");
                setConfirmPhrase("");
              }}
              className="text-sm px-4 py-2 rounded-full border border-[#E8C4BB] text-[#5C2620] hover:bg-white transition"
              data-testid="delete-account-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
