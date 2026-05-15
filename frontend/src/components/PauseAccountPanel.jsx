import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, Loader2 } from "lucide-react";
import { sessionClient } from "@/lib/api";

// Self-serve pause / resume panel, shared by therapist + patient
// portals. Reversible at any time (no 24h window like deletion).
//
//   - Therapist pause: cancels Stripe sub at period end, sets
//     paused_at, excludes from matching. Resume tries to un-cancel
//     the sub; if it has fully canceled, the panel redirects the
//     therapist to the portal so they can re-subscribe.
//
//   - Patient pause: sets paused_at on the account + every active
//     request. Existing referrals already sent to therapists are
//     NOT retracted (a pause is forward-only). Resume restores the
//     same set of requests.
//
// Profile data, license docs, request history, and feedback-driven
// reliability scores are all preserved -- so algo learning isn't
// lost. See the admin lifecycle docs panel for full impact details.
export default function PauseAccountPanel({ role, pausedAt, onChange }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const isPaused = !!pausedAt;
  const isTherapist = role === "therapist";

  const pausedSince = (() => {
    if (!pausedAt) return null;
    try {
      return new Date(pausedAt).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch {
      return pausedAt;
    }
  })();

  const onPause = async () => {
    if (busy) return;
    const confirmCopy = isTherapist
      ? "Pause your account? You'll stop receiving new patient referrals and your subscription will cancel at the end of the current billing period. You can resume any time."
      : "Pause your account? You'll stop being matched with new therapists. Referrals already sent stay where they are. You can resume any time.";
    if (!window.confirm(confirmCopy)) return;
    setBusy(true);
    try {
      await sessionClient().post(`/portal/${role}/pause`);
      toast.success("Account paused.");
      onChange && onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Pause failed.");
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await sessionClient().post(`/portal/${role}/resume`);
      if (isTherapist && res?.data?.requires_checkout) {
        toast.message(
          "Subscription needs to restart -- redirecting to checkout.",
        );
        // Hand off to the therapist portal, which already has the
        // Subscribe CTA wired to Stripe checkout.
        setTimeout(() => navigate("/portal/therapist"), 1200);
        return;
      }
      toast.success("Account resumed.");
      onChange && onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Resume failed.");
    } finally {
      setBusy(false);
    }
  };

  // Paused-state body copy.
  const pausedBodyCopy = isTherapist
    ? "Your profile is hidden from new patient matches and your Stripe subscription is scheduled to cancel at the end of the current billing period. No further charges. Click Resume any time to restart."
    : "You're not being matched with new therapists. Referrals already sent stay where they are. Click Resume any time to restart matching.";

  // Active-state body copy (offering pause).
  const activeBodyCopy = isTherapist
    ? "Temporarily hide your profile from new patient referrals. Your Stripe subscription will cancel at the end of the current billing period (no surprise renewals); existing access continues through that period. All profile data, license, and reliability history are preserved. Fully reversible -- click Resume any time."
    : "Temporarily stop being matched with new therapists. Active requests stay on file but won't trigger new matches; referrals already sent are unaffected. All your data is preserved. Fully reversible -- click Resume any time.";

  return (
    <section
      className={
        "mt-8 rounded-2xl p-6 " +
        (isPaused
          ? "bg-[#FDFBF7] border border-[#C8B560]"
          : "bg-white border border-[#E8E5DF]")
      }
      data-testid="pause-account-panel"
    >
      <h2 className="font-serif-display text-xl text-[#2D4A3E] flex items-center gap-2">
        {isPaused ? (
          <>
            <PauseCircle size={18} className="text-[#A88B2A]" />
            Account paused
          </>
        ) : (
          <>
            <PauseCircle size={18} className="text-[#6D6A65]" />
            Pause my account
          </>
        )}
      </h2>
      {isPaused && pausedSince && (
        <p className="text-xs text-[#6D6A65] mt-1">
          Paused since {pausedSince}
        </p>
      )}
      <p className="text-sm text-[#2B2A29] mt-2 leading-relaxed">
        {isPaused ? pausedBodyCopy : activeBodyCopy}
      </p>
      <div className="mt-4">
        {isPaused ? (
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-[#2D4A3E] text-white hover:bg-[#23382F] transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="pause-account-resume"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PlayCircle size={14} />
            )}
            Resume my account
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-[#6D6A65] text-[#2D4A3E] hover:bg-[#FDFBF7] transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="pause-account-pause"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PauseCircle size={14} />
            )}
            Pause my account
          </button>
        )}
      </div>
    </section>
  );
}
