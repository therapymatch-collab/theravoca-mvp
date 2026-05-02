/**
 * TherapistPulse — weekly pulse survey for therapists.
 *
 * Route: /therapist/pulse
 * Accessible from the therapist dashboard (session auth required).
 *
 * Q1-Q3: Star ratings (1-5) for referral quality, match accuracy, satisfaction
 * Q4: Free text feedback
 * Q5: Checkbox to adjust availability or referral types
 *
 * POSTs to /api/feedback/therapist/{therapistId}/pulse
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  ArrowRight,
  Star,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { sessionClient, getSession, clearSession } from "@/lib/api";

/* ────────────────────────────────────────────────────────────────── */
/*  Star rating component                                            */
/* ────────────────────────────────────────────────────────────────── */

function StarRating({ value, onChange, testPrefix = "star" }) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (hover || value);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-1 transition-transform hover:scale-110"
            data-testid={`${testPrefix}-${n}`}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            <Star
              size={28}
              strokeWidth={1.5}
              className={`transition ${
                filled
                  ? "fill-[#C87965] text-[#C87965]"
                  : "fill-none text-[#C9C5BD]"
              }`}
            />
          </button>
        );
      })}
      {value > 0 && (
        <span className="text-sm text-[#6D6A65] self-center ml-2">
          {value}/5
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Main component                                                   */
/* ────────────────────────────────────────────────────────────────── */

export default function TherapistPulse() {
  const navigate = useNavigate();
  const rawSession = getSession();
  const session = useMemo(
    () => rawSession,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawSession?.token, rawSession?.role, rawSession?.email],
  );

  const [therapistId, setTherapistId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Ratings
  const [referralQuality, setReferralQuality] = useState(0);
  const [matchAccuracy, setMatchAccuracy] = useState(0);
  const [satisfaction, setSatisfaction] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [adjustAvailability, setAdjustAvailability] = useState(false);

  // Auth check + fetch therapist ID
  useEffect(() => {
    if (!session || session.role !== "therapist") {
      navigate("/sign-in?role=therapist", { replace: true });
      return;
    }
    sessionClient()
      .get("/portal/therapist/profile")
      .then((res) => {
        const profile = res.data?.therapist || res.data;
        setTherapistId(profile?._id || profile?.id);
        setLoading(false);
      })
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearSession();
          navigate("/sign-in?role=therapist", { replace: true });
        } else {
          setLoading(false);
        }
      });
  }, [session, navigate]);

  const submit = async () => {
    if (!referralQuality || !matchAccuracy || !satisfaction) {
      toast.error("Please fill in all three star ratings.");
      return;
    }
    if (!therapistId) {
      toast.error("Could not determine your profile. Please sign in again.");
      return;
    }

    setSubmitting(true);
    try {
      await sessionClient().post(`/feedback/therapist/${therapistId}/pulse`, {
        referral_quality: referralQuality,
        match_accuracy: matchAccuracy,
        satisfaction,
        feedback: feedback.trim() || null,
        adjust_availability: adjustAvailability,
      });
      setSubmitted(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[#2D4A3E]" size={24} />
        </main>
        <Footer />
      </div>
    );
  }

  // ── Thank-you screen ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 px-5 py-12 md:py-16">
          <div className="max-w-xl mx-auto text-center py-16">
            <CheckCircle2 className="mx-auto text-[#2D4A3E]" size={48} strokeWidth={1.5} />
            <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">Thank you</h1>
            <p className="text-[#6D6A65] mt-3 text-pretty leading-relaxed">
              Your weekly pulse helps us improve match quality and referral relevance.
              {adjustAvailability && (
                <> We'll reach out about your availability preferences.</>
              )}
            </p>
            <button
              onClick={() => navigate("/portal/therapist")}
              className="mt-8 inline-flex items-center gap-2 text-[#2D4A3E] hover:underline text-sm font-medium"
              data-testid="pulse-back-portal"
            >
              Back to dashboard <ArrowRight size={14} />
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Survey form ──
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-pulse">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Weekly pulse
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            How are your referrals?
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-xl leading-relaxed">
            A quick check-in that takes under 30 seconds. Your feedback directly
            shapes how we match patients to your practice.
          </p>

          {/* Questions */}
          <div className="mt-8 space-y-5">
            {/* Q1 — Referral quality */}
            <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
              <div className="text-sm font-medium text-[#2B2A29] mb-3">
                <span className="text-[#A8553F] mr-1.5">1.</span>
                How would you rate the quality of recent referrals?
              </div>
              <StarRating
                value={referralQuality}
                onChange={setReferralQuality}
                testPrefix="q1-referral"
              />
            </div>

            {/* Q2 — Match accuracy */}
            <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
              <div className="text-sm font-medium text-[#2B2A29] mb-3">
                <span className="text-[#A8553F] mr-1.5">2.</span>
                How accurate were the matches to your specialties and style?
              </div>
              <StarRating
                value={matchAccuracy}
                onChange={setMatchAccuracy}
                testPrefix="q2-accuracy"
              />
            </div>

            {/* Q3 — Overall satisfaction */}
            <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
              <div className="text-sm font-medium text-[#2B2A29] mb-3">
                <span className="text-[#A8553F] mr-1.5">3.</span>
                Overall satisfaction with TheraVoca this week?
              </div>
              <StarRating
                value={satisfaction}
                onChange={setSatisfaction}
                testPrefix="q3-satisfaction"
              />
            </div>

            {/* Q4 — Free text */}
            <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
              <div className="text-sm font-medium text-[#2B2A29] mb-3">
                <span className="text-[#A8553F] mr-1.5">4.</span>
                Any feedback or suggestions?
                <span className="text-xs text-[#6D6A65] font-normal ml-1.5">(optional)</span>
              </div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm bg-[#FDFBF7]
                  focus:border-[#2D4A3E] focus:outline-none resize-none placeholder:text-[#A8A39B]"
                placeholder="Wrong specialties? Referral timing off? Anything on your mind..."
                data-testid="q4-feedback"
              />
            </div>

            {/* Q5 — Adjust availability */}
            <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjustAvailability}
                  onChange={(e) => setAdjustAvailability(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#E8E5DF] accent-[#2D4A3E]"
                  data-testid="q5-adjust"
                />
                <div>
                  <div className="text-sm font-medium text-[#2B2A29]">
                    <span className="text-[#A8553F] mr-1.5">5.</span>
                    I want to adjust my availability or referral types
                  </div>
                  <p className="text-xs text-[#6D6A65] mt-1">
                    We'll send you a link to update your preferences.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Submit */}
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="bg-[#2D4A3E] text-white rounded-xl px-6 py-3 text-sm font-medium
                hover:bg-[#3A5E50] disabled:opacity-50 transition inline-flex items-center gap-2"
              data-testid="pulse-submit"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Submit pulse
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
