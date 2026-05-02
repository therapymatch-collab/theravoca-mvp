/**
 * FeedbackSurvey — unified milestone survey page for the feedback loop.
 *
 * Route: /feedback/:requestId/:milestone
 *   where milestone is "48h", "3w", "9w", or "15w"
 *
 * Supports two auth modes:
 *   1. Signed token via query param: ?token=...  (from email links)
 *   2. Session auth (patient logged into portal)
 *
 * Renders milestone-specific questions and POSTs to
 *   /api/feedback/patient/{requestId}/{milestone}
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
/*  Shared UI helpers                                                */
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

function ScaleRow({ value, onChange, min = 1, max = 5, labels = {}, testPrefix = "scale" }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-10 h-10 rounded-full border text-sm font-medium transition ${
              value === n
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
            data-testid={`${testPrefix}-${n}`}
          >
            {n}
          </button>
        ))}
      </div>
      {Object.keys(labels).length > 0 && (
        <div className="flex justify-between mt-1.5 text-[10px] text-[#6D6A65] px-1">
          {Object.entries(labels).map(([k, v]) => (
            <span key={k}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function RangeSlider({ value, onChange, min = 0, max = 100, labels = {}, testId = "slider" }) {
  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2D4A3E] [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-[#2D4A3E] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
        style={{
          background: `linear-gradient(to right, #2D4A3E 0%, #2D4A3E ${((value - min) / (max - min)) * 100}%, #E8E5DF ${((value - min) / (max - min)) * 100}%, #E8E5DF 100%)`,
        }}
        data-testid={testId}
      />
      <div className="flex justify-between mt-1.5 text-[10px] text-[#6D6A65] px-0.5">
        {Object.entries(labels).map(([k, v]) => (
          <span key={k}>{v}</span>
        ))}
      </div>
      <div className="text-center mt-1 text-sm font-semibold text-[#2D4A3E]">{value}</div>
    </div>
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

function TextArea({ value, onChange, placeholder, rows = 3, testId }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      maxLength={2000}
      className="w-full border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm bg-[#FDFBF7]
        focus:border-[#2D4A3E] focus:outline-none resize-none placeholder:text-[#A8A39B]"
      placeholder={placeholder}
      data-testid={testId}
    />
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Milestone headings                                               */
/* ────────────────────────────────────────────────────────────────── */

const MILESTONE_META = {
  "48h": {
    tag: "48-hour check-in",
    title: "How has the process been so far?",
    subtitle: "Just a quick pulse. Takes about 15 seconds.",
  },
  "3w": {
    tag: "3-week check-in",
    title: "How are things going?",
    subtitle: "A few questions about your experience so far. Takes about a minute.",
  },
  "9w": {
    tag: "9-week check-in",
    title: "How is therapy going?",
    subtitle: "Your honest answers help us improve matching for everyone. About 2 minutes.",
  },
  "15w": {
    tag: "15-week check-in",
    title: "Looking back",
    subtitle: "Final check-in. Your reflections shape how we match the next person.",
  },
};

/* ────────────────────────────────────────────────────────────────── */
/*  48h milestone                                                    */
/* ────────────────────────────────────────────────────────────────── */

function Milestone48h({ answers, setAnswer }) {
  return (
    <>
      <QuestionCard number={1} label="How has the process been so far?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "great", l: "Great" },
            { v: "fine", l: "Fine" },
            { v: "had_issues", l: "Had issues" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.process === o.v}
              onClick={() => setAnswer("process", o.v)}
              testId={`q1-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      {answers.process === "had_issues" && (
        <QuestionCard number={2} label="What went wrong?">
          <TextArea
            value={answers.issues || ""}
            onChange={(v) => setAnswer("issues", v)}
            placeholder="Tell us what happened so we can fix it..."
            testId="q2-issues"
          />
        </QuestionCard>
      )}

      <QuestionCard
        number={answers.process === "had_issues" ? 3 : 2}
        label="Have you started reaching out to your matched therapists?"
      >
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "not_yet", l: "Not yet" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.reached_out === o.v}
              onClick={() => setAnswer("reached_out", o.v)}
              testId={`q-reached-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  3w milestone                                                     */
/* ────────────────────────────────────────────────────────────────── */

function Milestone3w({ answers, setAnswer, therapists }) {
  return (
    <>
      <QuestionCard number={1} label="Who did you reach out to?">
        <select
          value={answers.contacted_therapist || ""}
          onChange={(e) => setAnswer("contacted_therapist", e.target.value)}
          className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm
            focus:border-[#2D4A3E] focus:outline-none"
          data-testid="q1-therapist-select"
        >
          <option value="">Select...</option>
          {therapists.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.score ? `(${Math.round(t.score)}% match)` : ""}
            </option>
          ))}
          <option value="still_deciding">Still deciding</option>
          <option value="none">None</option>
        </select>
      </QuestionCard>

      <QuestionCard number={2} label="Have you had a session yet?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "scheduled", l: "Scheduled" },
            { v: "no", l: "No" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.had_session === o.v}
              onClick={() => setAnswer("had_session", o.v)}
              testId={`q2-session-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={3} label="How confident are you this is a good fit?">
        <RangeSlider
          value={answers.fit_confidence ?? 50}
          onChange={(v) => setAnswer("fit_confidence", v)}
          min={0}
          max={100}
          labels={{ 0: "Not at all", 50: "Somewhat", 100: "Very confident" }}
          testId="q3-confidence"
        />
      </QuestionCard>

      <QuestionCard number={4} label="Did the first interaction match what you expected?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "somewhat", l: "Somewhat" },
            { v: "no", l: "No" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.met_expectations === o.v}
              onClick={() => setAnswer("met_expectations", o.v)}
              testId={`q4-expectations-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={5} label="What surprised you (good or bad)?" required={false}>
        <TextArea
          value={answers.surprises || ""}
          onChange={(v) => setAnswer("surprises", v)}
          placeholder="Anything unexpected..."
          testId="q5-surprises"
        />
      </QuestionCard>

      <QuestionCard number={6} label="Anything we should know?" required={false}>
        <TextArea
          value={answers.notes || ""}
          onChange={(v) => setAnswer("notes", v)}
          placeholder="Free-form feedback..."
          testId="q6-notes"
        />
      </QuestionCard>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  9w milestone (retention + TAI)                                   */
/* ────────────────────────────────────────────────────────────────── */

function Milestone9w({ answers, setAnswer }) {
  return (
    <>
      <QuestionCard number={1} label="Are you still seeing this therapist?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "no", l: "No" },
            { v: "switched", l: "Switched" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.still_seeing === o.v}
              onClick={() => setAnswer("still_seeing", o.v)}
              testId={`q1-seeing-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={2} label="How many sessions so far?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "1-3", l: "1-3" },
            { v: "4-6", l: "4-6" },
            { v: "7+", l: "7+" },
            { v: "none", l: "None" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.session_count === o.v}
              onClick={() => setAnswer("session_count", o.v)}
              testId={`q2-sessions-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={3} label="What's working well?">
        <TextArea
          value={answers.working_well || ""}
          onChange={(v) => setAnswer("working_well", v)}
          placeholder="What feels good about your therapy so far?"
          testId="q3-working-well"
        />
      </QuestionCard>

      <QuestionCard number={4} label="What's not working or feels off?" required={false}>
        <TextArea
          value={answers.not_working || ""}
          onChange={(v) => setAnswer("not_working", v)}
          placeholder="Anything you wish were different?"
          testId="q4-not-working"
        />
      </QuestionCard>

      <QuestionCard number={5} label="Do you feel understood by your therapist?">
        <ScaleRow
          value={answers.feel_understood}
          onChange={(v) => setAnswer("feel_understood", v)}
          min={1}
          max={5}
          labels={{ 1: "Not at all", 3: "Somewhat", 5: "Very much" }}
          testPrefix="q5-understood"
        />
      </QuestionCard>

      <QuestionCard
        number={6}
        label="Are you and your therapist on the same page about what you're working on?"
      >
        <ScaleRow
          value={answers.same_page}
          onChange={(v) => setAnswer("same_page", v)}
          min={1}
          max={5}
          labels={{ 1: "Not at all", 3: "Somewhat", 5: "Completely" }}
          testPrefix="q6-same-page"
        />
      </QuestionCard>

      <QuestionCard number={7} label="How likely to recommend this therapist to a friend?">
        <ScaleRow
          value={answers.recommend_therapist}
          onChange={(v) => setAnswer("recommend_therapist", v)}
          min={1}
          max={10}
          labels={{ 1: "Not likely", 5: "Neutral", 10: "Very likely" }}
          testPrefix="q7-rec-therapist"
        />
      </QuestionCard>

      <QuestionCard number={8} label="How likely to recommend TheraVoca?">
        <ScaleRow
          value={answers.recommend_theravoca}
          onChange={(v) => setAnswer("recommend_theravoca", v)}
          min={1}
          max={10}
          labels={{ 1: "Not likely", 5: "Neutral", 10: "Very likely" }}
          testPrefix="q8-rec-theravoca"
        />
      </QuestionCard>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  15w milestone (outcome)                                          */
/* ────────────────────────────────────────────────────────────────── */

function Milestone15w({ answers, setAnswer }) {
  return (
    <>
      <QuestionCard number={1} label="Still seeing this therapist?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "no", l: "No" },
            { v: "switched", l: "Switched" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.still_seeing === o.v}
              onClick={() => setAnswer("still_seeing", o.v)}
              testId={`q1-seeing-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={2} label="How much progress have you made?">
        <RangeSlider
          value={answers.progress ?? 5}
          onChange={(v) => setAnswer("progress", v)}
          min={1}
          max={10}
          labels={{ 1: "None", 5: "Some", 10: "A lot" }}
          testId="q2-progress"
        />
      </QuestionCard>

      <QuestionCard number={3} label="Would you refer a friend to this therapist?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "maybe", l: "Maybe" },
            { v: "no", l: "No" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.refer_therapist === o.v}
              onClick={() => setAnswer("refer_therapist", o.v)}
              testId={`q3-refer-therapist-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={4} label="Would you refer a friend to TheraVoca?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes", l: "Yes" },
            { v: "maybe", l: "Maybe" },
            { v: "no", l: "No" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.refer_theravoca === o.v}
              onClick={() => setAnswer("refer_theravoca", o.v)}
              testId={`q4-refer-theravoca-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      <QuestionCard number={5} label="What changed for you since starting?">
        <TextArea
          value={answers.what_changed || ""}
          onChange={(v) => setAnswer("what_changed", v)}
          placeholder="Reflect on where you were when you started..."
          rows={4}
          testId="q5-what-changed"
        />
      </QuestionCard>

      <QuestionCard number={6} label="Anything else?" required={false}>
        <TextArea
          value={answers.notes || ""}
          onChange={(v) => setAnswer("notes", v)}
          placeholder="Final thoughts, suggestions, or thanks..."
          testId="q6-notes"
        />
      </QuestionCard>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Validation helpers                                               */
/* ────────────────────────────────────────────────────────────────── */

function validate48h(a) {
  if (!a.process) return "Please tell us how the process has been.";
  if (a.process === "had_issues" && !(a.issues || "").trim())
    return "Please describe what went wrong.";
  if (!a.reached_out) return "Please let us know if you've reached out.";
  return null;
}

function validate3w(a) {
  if (!a.contacted_therapist) return "Please select who you reached out to.";
  if (!a.had_session) return "Please tell us about your session status.";
  return null;
}

function validate9w(a) {
  if (!a.still_seeing) return "Please tell us if you're still seeing your therapist.";
  if (!a.session_count) return "Please select how many sessions you've had.";
  if (!(a.working_well || "").trim()) return "Please share what's working well.";
  if (!a.feel_understood) return "Please rate how understood you feel.";
  if (!a.same_page) return "Please rate how aligned you are on goals.";
  if (!a.recommend_therapist) return "Please rate how likely you'd recommend the therapist.";
  if (!a.recommend_theravoca) return "Please rate how likely you'd recommend TheraVoca.";
  return null;
}

function validate15w(a) {
  if (!a.still_seeing) return "Please tell us if you're still seeing your therapist.";
  if (!a.refer_therapist) return "Please answer whether you'd refer a friend to the therapist.";
  if (!a.refer_theravoca) return "Please answer whether you'd refer a friend to TheraVoca.";
  if (!(a.what_changed || "").trim()) return "Please share what changed for you.";
  return null;
}

const VALIDATORS = {
  "48h": validate48h,
  "3w": validate3w,
  "9w": validate9w,
  "15w": validate15w,
};

/* ────────────────────────────────────────────────────────────────── */
/*  Closing messages                                                 */
/* ────────────────────────────────────────────────────────────────── */

const CLOSING_MESSAGES = {
  "48h": "We're here if you need anything. Your next check-in will be in about 2 weeks.",
  "3w": "Thank you for sharing. We'll check in again around the 9-week mark.",
  "9w": "Your feedback directly improves our matching. We'll follow up one more time at 15 weeks.",
  "15w": "Thank you for completing all of our check-ins. Your journey helps shape better matches for everyone.",
};

/* ────────────────────────────────────────────────────────────────── */
/*  Main component                                                   */
/* ────────────────────────────────────────────────────────────────── */

export default function FeedbackSurvey() {
  const { requestId, milestone } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [answers, setAnswers] = useState({});
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const meta = MILESTONE_META[milestone] || MILESTONE_META["48h"];

  // Build the appropriate axios client based on auth mode
  const getClient = useCallback(() => {
    if (token) {
      // Email link auth — pass token as query param; the backend validates it
      return api;
    }
    // Session auth — use the session client with Bearer token
    const session = getSession();
    if (session?.token) {
      return sessionClient();
    }
    return api;
  }, [token]);

  // Build request headers/params for token-based auth
  const authParams = useCallback(() => {
    if (token) return { params: { token } };
    return {};
  }, [token]);

  // Load therapist list for 3w milestone
  useEffect(() => {
    if (milestone === "3w") {
      const client = getClient();
      client
        .get(`/feedback/patient/${requestId}/matches`, authParams())
        .then((res) => {
          const matches = res.data?.matches || res.data || [];
          setTherapists(
            matches.map((m) => ({
              id: m.therapist_id || m.id,
              name: m.therapist_name || m.name || "Therapist",
              score: m.match_score || m.score,
            }))
          );
        })
        .catch(() => {
          // Non-fatal — the dropdown will just be empty
          setTherapists([]);
        });
    }
    setLoading(false);
  }, [milestone, requestId, getClient, authParams]);

  const setAnswer = useCallback((key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async () => {
    const validator = VALIDATORS[milestone];
    if (validator) {
      const err = validator(answers);
      if (err) {
        toast.error(err);
        return;
      }
    }

    setSubmitting(true);
    try {
      const client = getClient();
      await client.post(
        `/feedback/patient/${requestId}/${milestone}`,
        { milestone, ...answers },
        authParams()
      );
      setSubmitted(true);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 401) {
        setError("This link has expired or is invalid. Please sign in to your portal.");
      } else {
        toast.error(detail || "Couldn't submit. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Invalid milestone ──
  if (!MILESTONE_META[milestone]) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 px-5 py-12 md:py-16">
          <div className="max-w-2xl mx-auto text-center py-20">
            <AlertCircle className="mx-auto text-[#A8553F] mb-4" size={32} strokeWidth={1.5} />
            <h1 className="font-serif-display text-3xl text-[#2D4A3E]">Invalid survey link</h1>
            <p className="text-[#6D6A65] mt-3">
              This survey link doesn't look right. Please check your email for the correct link.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

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
            <button
              onClick={() => navigate("/sign-in?role=patient")}
              className="mt-6 bg-[#2D4A3E] text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-[#3A5E50] transition"
            >
              Sign in to portal
            </button>
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
            <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">Thank you</h1>
            <p className="text-[#6D6A65] mt-3 text-pretty leading-relaxed">
              {CLOSING_MESSAGES[milestone]}
            </p>
            <p className="text-[#6D6A65] mt-2 text-sm">
              Your answers go directly to the TheraVoca team. They genuinely
              shape how we match the next person.
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

  // ── Survey form ──
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid={`feedback-survey-${milestone}`}>
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">{meta.tag}</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            {meta.title}
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-xl leading-relaxed">{meta.subtitle}</p>
          <p className="text-xs text-[#A8A39B] mt-1">
            Your therapist never sees your responses.
          </p>

          {/* Questions */}
          <div className="mt-8 space-y-5">
            {milestone === "48h" && (
              <Milestone48h answers={answers} setAnswer={setAnswer} />
            )}
            {milestone === "3w" && (
              <Milestone3w answers={answers} setAnswer={setAnswer} therapists={therapists} />
            )}
            {milestone === "9w" && (
              <Milestone9w answers={answers} setAnswer={setAnswer} />
            )}
            {milestone === "15w" && (
              <Milestone15w answers={answers} setAnswer={setAnswer} />
            )}
          </div>

          {/* Submit */}
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="bg-[#2D4A3E] text-white rounded-xl px-6 py-3 text-sm font-medium
                hover:bg-[#3A5E50] disabled:opacity-50 transition inline-flex items-center gap-2"
              data-testid="survey-submit"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Submit feedback
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
