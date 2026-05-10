/**
 * TherapistSurvey -- Phase 3 therapist survey page.
 *
 * Route: /therapist-feedback/:therapistId/:surveyNumber
 *
 * Auth: HMAC token via ?token= query param (entity_type='therapist').
 *
 * On mount:
 *   GET /api/feedback/therapist/{therapistId}/survey/{surveyNumber}
 *   - null body  -> render form (not yet submitted)
 *   - doc body   -> render replay mode (submitted), pre-filled, disabled,
 *                   submit hidden, "Submitted on ..." banner
 *
 * Submit:
 *   POST /api/feedback/therapist/{therapistId}/survey/{surveyNumber}
 *   - 200      -> thank-you screen
 *   - 409      -> already submitted; in-place re-fetch GET and switch to
 *                 replay mode (smoother than a full page reload)
 *   - 401      -> auth error screen
 *   - other    -> toast, allow retry
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api, sessionClient, getSession } from "@/lib/api";

/* ────────────────────────────────────────────────────────────────── */
/*  Shared UI helpers (mirrors FeedbackSurvey.jsx; kept local per     */
/*  C2 spec -- single self-contained file)                            */
/* ────────────────────────────────────────────────────────────────── */

function PillButton({ selected, onClick, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 rounded-full border text-sm font-medium transition ${
        selected
          ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
          : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
      }`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function QuestionCard({ number, label, required, children }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E8E5DF] p-6">
      <div className="text-sm font-medium text-[#2B2A29] mb-3">
        {number && <span className="text-[#A8553F] mr-1.5">{number}.</span>}
        {label}
        {required === false && (
          <span className="text-xs text-[#6D6A65] font-normal ml-1.5">(optional)</span>
        )}
      </div>
      {children}
    </div>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, testId, maxLength = 2000 }) {
  const len = (value || "").length;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        className="w-full border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm bg-[#FDFBF7]
          focus:border-[#2D4A3E] focus:outline-none resize-none placeholder:text-[#A8A39B]"
        placeholder={placeholder}
        data-testid={testId}
      />
      <div className="text-right text-xs text-[#A8A39B] mt-1">
        {len} / {maxLength}
      </div>
    </div>
  );
}

function NumberInput({ value, onChange, min = 0, placeholder, testId }) {
  return (
    <input
      type="number"
      min={min}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") {
          onChange(null);
        } else {
          const n = Number(v);
          onChange(Number.isFinite(n) ? n : null);
        }
      }}
      placeholder={placeholder}
      className="w-full max-w-xs border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm bg-[#FDFBF7]
        focus:border-[#2D4A3E] focus:outline-none placeholder:text-[#A8A39B]"
      data-testid={testId}
    />
  );
}

function NpsRow({ value, onChange, testPrefix = "nps" }) {
  // 0-6 red, 7-8 yellow, 9-10 green
  const colorFor = (n) => {
    if (n <= 6) return { bg: "#FEE2E2", border: "#FECACA", text: "#991B1B", activeBg: "#DC2626", activeText: "#fff" };
    if (n <= 8) return { bg: "#FEF9C3", border: "#FDE68A", text: "#92400E", activeBg: "#D97706", activeText: "#fff" };
    return { bg: "#DCFCE7", border: "#BBF7D0", text: "#166534", activeBg: "#059669", activeText: "#fff" };
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => {
          const c = colorFor(n);
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              style={{
                backgroundColor: active ? c.activeBg : c.bg,
                borderColor: active ? c.activeBg : c.border,
                color: active ? c.activeText : c.text,
                minWidth: "2.25rem",
              }}
              className="h-9 rounded-full border text-sm font-semibold transition px-2"
              data-testid={`${testPrefix}-${n}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-[#6D6A65] px-1">
        <span>Not at all likely</span>
        <span>Extremely likely</span>
      </div>
    </div>
  );
}

function FourButtonScale({ value, onChange, labels, testPrefix = "scale4" }) {
  const _labels = labels || [
    { v: 1, l: "Poor" },
    { v: 2, l: "Fair" },
    { v: 3, l: "Good" },
    { v: 4, l: "Excellent" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {_labels.map((o) => (
        <PillButton
          key={o.v}
          selected={value === o.v}
          onClick={() => onChange(o.v)}
          testId={`${testPrefix}-${o.v}`}
        >
          {o.l}
        </PillButton>
      ))}
    </div>
  );
}

function ReplayBanner({ submission }) {
  if (!submission) return null;
  const date = new Date(submission.submitted_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <div
      className="bg-[#F5F3EF] border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm text-[#6D6A65]"
      data-testid="replay-banner"
    >
      Submitted on {date}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Validation                                                       */
/* ────────────────────────────────────────────────────────────────── */

function validate(a) {
  if (!a.match_fit) return "Please rate how the matches are working out.";
  if (a.nps == null) return "Please rate how likely you are to recommend us.";
  if (a.new_patients == null || a.new_patients < 0) {
    return "Please enter the number of ongoing clients (0 or more).";
  }
  return null;
}

function canSubmit(a) {
  return (
    !!a.match_fit &&
    a.nps != null &&
    a.new_patients != null &&
    a.new_patients >= 0
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Main component                                                   */
/* ────────────────────────────────────────────────────────────────── */

export default function TherapistSurvey() {
  const { therapistId, surveyNumber } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [answers, setAnswers] = useState({});
  const [existingSubmission, setExistingSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Build the appropriate axios client based on auth mode.
  const getClient = useCallback(() => {
    if (token) return api;
    const session = getSession();
    if (session?.token) return sessionClient();
    return api;
  }, [token]);

  // Build axios request config (params merged with token if present).
  const authParams = useCallback(() => {
    if (token) return { params: { token } };
    return {};
  }, [token]);

  // Fetch existing submission on mount. null body = not submitted yet.
  useEffect(() => {
    const client = getClient();
    client
      .get(
        `/feedback/therapist/${therapistId}/survey/${surveyNumber}`,
        { params: { ...(authParams().params || {}) } },
      )
      .then((res) => {
        if (res.data) {
          setExistingSubmission(res.data);
          setAnswers(res.data);
        }
      })
      .catch((e) => {
        if (e?.response?.status === 401) {
          setError(
            "This link has expired or is invalid. Please contact " +
            "support@theravoca.com if you need a new one.",
          );
          return;
        }
        // eslint-disable-next-line no-console
        console.error("Failed to load existing therapist survey:", e);
      })
      .finally(() => setLoading(false));
  }, [therapistId, surveyNumber, getClient, authParams]);

  const setAnswer = useCallback((key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async () => {
    const err = validate(answers);
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const client = getClient();
      const body = {
        match_fit: answers.match_fit,
        nps: answers.nps,
        new_patients: answers.new_patients,
        improvement_text: answers.improvement_text || null,
      };
      await client.post(
        `/feedback/therapist/${therapistId}/survey/${surveyNumber}`,
        body,
        authParams(),
      );
      setSubmitted(true);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401) {
        setError(
          "This link has expired or is invalid. Please contact " +
          "support@theravoca.com if you need a new one.",
        );
      } else if (status === 409) {
        // Already submitted -- in-place refetch, switch to replay mode.
        try {
          const client = getClient();
          const res = await client.get(
            `/feedback/therapist/${therapistId}/survey/${surveyNumber}`,
            { params: { ...(authParams().params || {}) } },
          );
          if (res.data) {
            setExistingSubmission(res.data);
            setAnswers(res.data);
            toast.message(
              "This survey was already submitted. Showing your previous answers.",
            );
          } else {
            toast.error("This survey has already been submitted.");
          }
        } catch {
          toast.error("This survey has already been submitted.");
        }
      } else {
        const detail = e?.response?.data?.detail;
        toast.error(detail || "Couldn't submit. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Auth error ──
  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 px-5 py-12 md:py-16">
          <div className="max-w-2xl mx-auto text-center py-20">
            <AlertCircle className="mx-auto text-[#A8553F] mb-4" size={32} strokeWidth={1.5} />
            <h1 className="font-serif-display text-3xl text-[#2D4A3E]">Something went wrong</h1>
            <p className="text-[#6D6A65] mt-3">{error}</p>
          </div>
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
            <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
              Thanks for the feedback!
            </h1>
            <p className="text-[#6D6A65] mt-3 text-pretty leading-relaxed">
              Your input directly improves how we match patients to your practice.
              We'll send another check-in after your next batch of referrals.
            </p>
            <button
              onClick={() => navigate("/")}
              className="mt-8 inline-flex items-center gap-2 text-[#2D4A3E] hover:underline text-sm font-medium"
              data-testid="survey-back-home"
            >
              Back to TheraVoca <ArrowRight size={14} />
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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

  // ── Survey form (or replay mode) ──
  const readOnly = !!existingSubmission;
  const formContent = (
    <>
      <QuestionCard
        number={1}
        label="How well are the patients we're matching to you fitting your practice?"
      >
        <FourButtonScale
          value={answers.match_fit}
          onChange={(v) => setAnswer("match_fit", v)}
          testPrefix="q1-match-fit"
        />
      </QuestionCard>

      <QuestionCard
        number={2}
        label="How likely are you to recommend TheraVoca to another therapist?"
      >
        <NpsRow
          value={answers.nps}
          onChange={(v) => setAnswer("nps", v)}
          testPrefix="q2-nps"
        />
      </QuestionCard>

      <QuestionCard
        number={3}
        label="How many of your matched patients have become ongoing clients since your last survey?"
      >
        <NumberInput
          value={answers.new_patients}
          onChange={(v) => setAnswer("new_patients", v)}
          min={0}
          placeholder="0"
          testId="q3-new-patients"
        />
      </QuestionCard>

      <QuestionCard
        number={4}
        label="Anything we should know to improve?"
        required={false}
      >
        <TextArea
          value={answers.improvement_text || ""}
          onChange={(v) => setAnswer("improvement_text", v)}
          placeholder="Feedback, suggestions, things that worked..."
          rows={4}
          testId="q4-improvement"
        />
      </QuestionCard>
    </>
  );

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-survey">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Therapist check-in
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            How are your matches working out?
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-xl leading-relaxed">
            Quick check-in to help us send you better-fit patients. Takes about 60 seconds.
          </p>

          {/* Questions (replay-mode wrapper when existingSubmission is set) */}
          <div className="mt-8 space-y-5">
            {readOnly ? (
              <>
                <ReplayBanner submission={existingSubmission} />
                <div className="pointer-events-none opacity-60 select-none space-y-5">
                  {formContent}
                </div>
              </>
            ) : (
              formContent
            )}
          </div>

          {/* Submit (hidden in replay mode) */}
          {!readOnly && (
            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !canSubmit(answers)}
                className="bg-[#2D4A3E] text-white rounded-xl px-6 py-3 text-sm font-medium
                  hover:bg-[#3A5E50] disabled:opacity-50 disabled:cursor-not-allowed transition inline-flex items-center gap-2"
                data-testid="survey-submit"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Submit feedback
              </button>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
