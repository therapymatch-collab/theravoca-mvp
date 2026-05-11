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
/*  v2 shared UI components                                          */
/* ────────────────────────────────────────────────────────────────── */

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
  // Default labels: 1=Not great, 2=Just OK, 3=Good, 4=Really good
  const _labels = labels || [
    { v: 1, l: "Not great" },
    { v: 2, l: "Just OK" },
    { v: 3, l: "Good" },
    { v: 4, l: "Really good" },
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

function PrivacyBanner({ long = false }) {
  return (
    <div className="bg-[#F0EDEA] rounded-xl px-4 py-3 text-xs text-[#6D6A65] leading-relaxed">
      <span className="mr-1">{"🔒"}</span>
      {long ? (
        <>
          Your therapist never sees your individual responses. All feedback
          is used in aggregate to improve TheraVoca's matching quality.
          Your identity is never shared with therapists in any reports.
        </>
      ) : (
        <>
          Your therapist never sees your responses. This feedback
          goes only to the TheraVoca team.
        </>
      )}
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
  // The dropdown sets chosen_status + chosen_therapist_id together.
  // A therapist ID means "picked"; the two sentinel values map directly.
  const handleTherapistSelect = (val) => {
    if (val === "still_deciding" || val === "none") {
      setAnswer("chosen_status", val);
      setAnswer("chosen_therapist_id", null);
    } else if (val) {
      setAnswer("chosen_status", "picked");
      setAnswer("chosen_therapist_id", val);
    } else {
      setAnswer("chosen_status", "");
      setAnswer("chosen_therapist_id", null);
    }
  };

  // Derive the dropdown display value from the two answer fields
  const selectValue =
    answers.chosen_status === "picked"
      ? answers.chosen_therapist_id || ""
      : answers.chosen_status || "";

  return (
    <>
      <QuestionCard number={1} label="Who did you reach out to?">
        <select
          value={selectValue}
          onChange={(e) => handleTherapistSelect(e.target.value)}
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
          value={answers.confidence ?? 50}
          onChange={(v) => setAnswer("confidence", v)}
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
              selected={answers.expectation_match === o.v}
              onClick={() => setAnswer("expectation_match", o.v)}
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
/*  9w milestone (retention + match strength)                        */
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
/*  v2 milestone: 48h                                                */
/* ────────────────────────────────────────────────────────────────── */

function V2Milestone48h({ answers, setAnswer, therapists, existingSubmission }) {
  const readOnly = !!existingSubmission;
  // Q2b state: multi-select therapists the patient reached out to.
  const selected48h = answers.selected_therapists_48h || [];
  const toggle48h = (id) => {
    if (id === "_outside") {
      if (selected48h.includes(id)) {
        setAnswer("selected_therapists_48h", []);
      } else {
        setAnswer("selected_therapists_48h", [id]);
      }
      return;
    }
    const without = selected48h.filter((s) => s !== "_outside");
    if (without.includes(id)) {
      setAnswer("selected_therapists_48h", without.filter((s) => s !== id));
    } else {
      setAnswer("selected_therapists_48h", [...without, id]);
    }
  };
  // Q2b shows only if patient indicated they actually reached out AND
  // there are therapists to pick from. Hide entirely otherwise.
  const showQ2b =
    (answers.reached_out === "yes_contacted" ||
      answers.reached_out === "yes_multiple") &&
    therapists &&
    therapists.length > 0;
  const content = (
    <>
      <PrivacyBanner />
      <QuestionCard number={1} label="How do you feel about the therapists matched to you?">
        <FourButtonScale
          value={answers.match_feel}
          onChange={(v) => setAnswer("match_feel", v)}
          labels={[
            { v: 1, l: "Not great" },
            { v: 2, l: "Just OK" },
            { v: 3, l: "Good" },
            { v: 4, l: "Really good" },
          ]}
          testPrefix="q1-match-feel"
        />
      </QuestionCard>

      <QuestionCard number={2} label="Have you started reaching out to your matched therapists?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes_contacted", l: "Yes, I've contacted one" },
            { v: "yes_multiple", l: "Yes, contacted several" },
            { v: "not_yet", l: "Not yet" },
            { v: "message_no_reply", l: "Sent a message but no reply" },
          ].map((o) => (
            <PillButton
              key={o.v}
              selected={answers.reached_out === o.v}
              onClick={() => setAnswer("reached_out", o.v)}
              testId={`q2-reached-${o.v}`}
            >
              {o.l}
            </PillButton>
          ))}
        </div>
      </QuestionCard>

      {showQ2b && (
        <QuestionCard number="2b" label="Which one(s) did you reach out to?">
          <div className="space-y-2">
            {therapists.map((t) => {
              const isSelected = selected48h.includes(t.therapist_id);
              return (
                <button
                  key={t.therapist_id}
                  type="button"
                  onClick={() => toggle48h(t.therapist_id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
                    isSelected
                      ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                      : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                  }`}
                  data-testid={`q2b-therapist-${t.therapist_id}`}
                >
                  <TherapistAvatar name={t.therapist_name} color={isSelected ? "#ffffff30" : t.avatar_color} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.therapist_name}</div>
                    <div className={`text-xs ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                      {[
                        t.credential_type,
                        t.years_experience ? `${t.years_experience} yrs` : null,
                      ].filter(Boolean).join(" · ") || "Therapist"}
                    </div>
                  </div>
                  {t.match_score != null && (
                    <span className={`text-xs font-medium ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                      {Math.round(t.match_score)}%
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => toggle48h("_outside")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
                selected48h.includes("_outside")
                  ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                  : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
              }`}
              data-testid="q2b-therapist-outside"
            >
              Found someone outside my matches
            </button>
          </div>
        </QuestionCard>
      )}

      <QuestionCard number={3} label="Anything we could improve about the matching process?" required={false}>
        <TextArea
          value={answers.improvement_text || ""}
          onChange={(v) => setAnswer("improvement_text", v)}
          placeholder="What would have made the experience better?"
          testId="q3-improvement"
        />
      </QuestionCard>
    </>
  );
  if (readOnly) {
    return (
      <>
        <ReplayBanner submission={existingSubmission} />
        <div className="pointer-events-none opacity-60 select-none space-y-5">
          {content}
        </div>
      </>
    );
  }
  return content;
}

/* ────────────────────────────────────────────────────────────────── */
/*  v2 milestone: 3w                                                 */
/* ────────────────────────────────────────────────────────────────── */

function TherapistAvatar({ name, color }) {
  const initials = (name || "T")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      style={{ backgroundColor: color || "#4F46E5" }}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-semibold shrink-0"
    >
      {initials}
    </span>
  );
}

function V2Milestone3w({ answers, setAnswer, therapists, existingSubmission }) {
  // Multi-select therapists + sentinel options
  const readOnly = !!existingSubmission;
  const selected = answers.selected_therapists || [];

  const toggleTherapist = (id) => {
    // If selecting a sentinel, clear everything else
    if (id === "_outside" || id === "_not_started") {
      if (selected.includes(id)) {
        setAnswer("selected_therapists", []);
      } else {
        setAnswer("selected_therapists", [id]);
      }
      return;
    }
    // If selecting a real therapist, remove any sentinel
    const without = selected.filter((s) => s !== "_outside" && s !== "_not_started");
    if (without.includes(id)) {
      setAnswer("selected_therapists", without.filter((s) => s !== id));
    } else {
      setAnswer("selected_therapists", [...without, id]);
    }
  };

  const content = (
    <>
      <PrivacyBanner />
      <QuestionCard number={1} label="Which therapists have you contacted or started seeing?">
        <div className="space-y-2">
          {therapists.map((t) => {
            const isSelected = selected.includes(t.therapist_id);
            return (
              <button
                key={t.therapist_id}
                type="button"
                onClick={() => toggleTherapist(t.therapist_id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
                  isSelected
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
                data-testid={`q1-therapist-${t.therapist_id}`}
              >
                <TherapistAvatar name={t.therapist_name} color={isSelected ? "#ffffff30" : t.avatar_color} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{t.therapist_name}</div>
                  <div className={`text-xs ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                    {[
                      t.credential_type,
                      t.years_experience ? `${t.years_experience} yrs` : null,
                    ].filter(Boolean).join(" · ") || "Therapist"}
                  </div>
                </div>
                {t.match_score != null && (
                  <span className={`text-xs font-medium ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                    {Math.round(t.match_score)}%
                  </span>
                )}
              </button>
            );
          })}
          {/* Sentinel options */}
          <button
            type="button"
            onClick={() => toggleTherapist("_outside")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
              selected.includes("_outside")
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
            data-testid="q1-therapist-outside"
          >
            Found someone outside my matches
          </button>
          <button
            type="button"
            onClick={() => toggleTherapist("_not_started")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
              selected.includes("_not_started")
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
            data-testid="q1-therapist-not-started"
          >
            Haven't started looking yet
          </button>
        </div>
      </QuestionCard>

      <QuestionCard number={2} label="How is the experience going so far?">
        <FourButtonScale
          value={answers.going_so_far}
          onChange={(v) => setAnswer("going_so_far", v)}
          labels={[
            { v: 1, l: "Not great" },
            { v: 2, l: "Just OK" },
            { v: 3, l: "Good" },
            { v: 4, l: "Really good" },
          ]}
          testPrefix="q2-going"
        />
      </QuestionCard>

      <QuestionCard number={3} label="How likely are you to recommend TheraVoca to a friend?">
        <NpsRow
          value={answers.nps}
          onChange={(v) => setAnswer("nps", v)}
          testPrefix="q3-nps"
        />
      </QuestionCard>
    </>
  );
  if (readOnly) {
    return (
      <>
        <ReplayBanner submission={existingSubmission} />
        <div className="pointer-events-none opacity-60 select-none space-y-5">
          {content}
        </div>
      </>
    );
  }
  return content;
}

/* ────────────────────────────────────────────────────────────────── */
/*  v2 milestone: 9w                                                 */
/* ────────────────────────────────────────────────────────────────── */

function V2Milestone9w({ answers, setAnswer, therapists, allAppliedTherapists, existingSubmission }) {
  const readOnly = !!existingSubmission;
  // Q1b source list depends on Q1 answer:
  //   "yes_same_weekly" / "yes_same_less_often" -> 3wk picks (still
  //     with one of the originally selected therapists)
  //   "yes_different" -> ALL applied therapists (the patient switched,
  //     so they need to see the full pool, not just their old picks)
  const q1bList =
    answers.still_seeing === "yes_different"
      ? (allAppliedTherapists || [])
      : (therapists || []);
  // Q1b shows only if patient is still seeing one of their matches AND
  // the appropriate source list has entries. Hidden when patient went
  // outside, stopped, never started, or both lists are empty.
  const showQ1b =
    (answers.still_seeing === "yes_same_weekly" ||
      answers.still_seeing === "yes_same_less_often" ||
      answers.still_seeing === "yes_different") &&
    q1bList.length > 0;
  const content = (
    <>
      <PrivacyBanner long />
      <QuestionCard number={1} label="Are you still seeing a therapist from your matches?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes_same_weekly", l: "Yes, same therapist (weekly)" },
            { v: "yes_same_less_often", l: "Yes, same therapist (less than weekly)" },
            { v: "yes_different", l: "Yes, a different one from my matches" },
            { v: "outside", l: "Seeing someone outside my matches" },
            { v: "stopped", l: "Stopped therapy" },
            { v: "never_started", l: "Never started" },
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

      {showQ1b && (
        <QuestionCard number="1b" label="Which therapist?">
          <div className="space-y-2">
            {q1bList.map((t) => {
              const isSelected = answers.selected_therapist_9w === t.therapist_id;
              return (
                <button
                  key={t.therapist_id}
                  type="button"
                  onClick={() => setAnswer("selected_therapist_9w", t.therapist_id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
                    isSelected
                      ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                      : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                  }`}
                  data-testid={`q1b-therapist-${t.therapist_id}`}
                >
                  <TherapistAvatar name={t.therapist_name} color={isSelected ? "#ffffff30" : t.avatar_color} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.therapist_name}</div>
                    <div className={`text-xs ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                      {[
                        t.credential_type,
                        t.years_experience ? `${t.years_experience} yrs` : null,
                      ].filter(Boolean).join(" · ") || "Therapist"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </QuestionCard>
      )}

      <QuestionCard number={2} label="Do you feel understood by your therapist?">
        <FourButtonScale
          value={answers.feel_understood}
          onChange={(v) => setAnswer("feel_understood", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "A little" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q2-understood"
        />
      </QuestionCard>

      <QuestionCard number={3} label="Has therapy met your expectations so far?">
        <FourButtonScale
          value={answers.expectations_match}
          onChange={(v) => setAnswer("expectations_match", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "Somewhat" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q3-expectations"
        />
      </QuestionCard>

      <QuestionCard number={4} label="Are you and your therapist aligned on your goals?">
        <FourButtonScale
          value={answers.goals_aligned}
          onChange={(v) => setAnswer("goals_aligned", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "Somewhat" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q4-goals"
        />
      </QuestionCard>

      <QuestionCard number={5} label="How likely are you to recommend TheraVoca to a friend?">
        <NpsRow
          value={answers.nps}
          onChange={(v) => setAnswer("nps", v)}
          testPrefix="q5-nps"
        />
      </QuestionCard>
    </>
  );
  if (readOnly) {
    return (
      <>
        <ReplayBanner submission={existingSubmission} />
        <div className="pointer-events-none opacity-60 select-none space-y-5">
          {content}
        </div>
      </>
    );
  }
  return content;
}

/* ────────────────────────────────────────────────────────────────── */
/*  v2 milestone: 15w                                                */
/* ────────────────────────────────────────────────────────────────── */

function V2Milestone15w({ answers, setAnswer, therapists, allAppliedTherapists, existingSubmission }) {
  const readOnly = !!existingSubmission;
  // Q1b source list depends on Q1 answer:
  //   "yes_same_weekly" / "yes_same_less_often" -> 3wk picks
  //   "yes_different" -> ALL applied therapists (patient switched)
  const q1bList =
    answers.still_seeing === "yes_different"
      ? (allAppliedTherapists || [])
      : (therapists || []);
  // Q1b shows only if patient is still seeing one of their matches AND
  // the appropriate source list has entries.
  const showQ1b =
    (answers.still_seeing === "yes_same_weekly" ||
      answers.still_seeing === "yes_same_less_often" ||
      answers.still_seeing === "yes_different") &&
    q1bList.length > 0;
  const content = (
    <>
      <PrivacyBanner long />
      <QuestionCard number={1} label="Are you still seeing a therapist from your matches?">
        <div className="flex flex-wrap gap-2">
          {[
            { v: "yes_same_weekly", l: "Yes, same therapist (weekly)" },
            { v: "yes_same_less_often", l: "Yes, same therapist (less than weekly)" },
            { v: "yes_different", l: "Yes, a different one from my matches" },
            { v: "outside", l: "Seeing someone outside my matches" },
            { v: "stopped", l: "Stopped therapy" },
            { v: "never_started", l: "Never started" },
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

      {showQ1b && (
        <QuestionCard number="1b" label="Which therapist?">
          <div className="space-y-2">
            {q1bList.map((t) => {
              const isSelected = answers.selected_therapist_15w === t.therapist_id;
              return (
                <button
                  key={t.therapist_id}
                  type="button"
                  onClick={() => setAnswer("selected_therapist_15w", t.therapist_id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition ${
                    isSelected
                      ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                      : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                  }`}
                  data-testid={`q1b-therapist-${t.therapist_id}`}
                >
                  <TherapistAvatar name={t.therapist_name} color={isSelected ? "#ffffff30" : t.avatar_color} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.therapist_name}</div>
                    <div className={`text-xs ${isSelected ? "text-white/70" : "text-[#6D6A65]"}`}>
                      {[
                        t.credential_type,
                        t.years_experience ? `${t.years_experience} yrs` : null,
                      ].filter(Boolean).join(" · ") || "Therapist"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </QuestionCard>
      )}

      <QuestionCard number={2} label="Do you feel understood by your therapist?">
        <FourButtonScale
          value={answers.feel_understood}
          onChange={(v) => setAnswer("feel_understood", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "A little" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q2-understood"
        />
      </QuestionCard>

      <QuestionCard number={3} label="Has therapy met your expectations?">
        <FourButtonScale
          value={answers.expectations_match}
          onChange={(v) => setAnswer("expectations_match", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "Somewhat" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q3-expectations"
        />
      </QuestionCard>

      <QuestionCard number={4} label="Are you and your therapist aligned on your goals?">
        <FourButtonScale
          value={answers.goals_aligned}
          onChange={(v) => setAnswer("goals_aligned", v)}
          labels={[
            { v: 1, l: "Not at all" },
            { v: 2, l: "Somewhat" },
            { v: 3, l: "Mostly" },
            { v: 4, l: "Completely" },
          ]}
          testPrefix="q4-goals"
        />
      </QuestionCard>

      <QuestionCard number={5} label="How likely are you to recommend TheraVoca to a friend?">
        <NpsRow
          value={answers.nps}
          onChange={(v) => setAnswer("nps", v)}
          testPrefix="q5-nps"
        />
      </QuestionCard>

      <QuestionCard number={6} label="Any final reflections on your experience?" required={false}>
        <TextArea
          value={answers.final_reflection || ""}
          onChange={(v) => setAnswer("final_reflection", v)}
          placeholder="Looking back, what stands out about your experience?"
          rows={4}
          testId="q6-reflection"
        />
      </QuestionCard>
    </>
  );
  if (readOnly) {
    return (
      <>
        <ReplayBanner submission={existingSubmission} />
        <div className="pointer-events-none opacity-60 select-none space-y-5">
          {content}
        </div>
      </>
    );
  }
  return content;
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
  if (!a.chosen_status) return "Please select who you reached out to.";
  if (!a.had_session) return "Please tell us about your session status.";
  if (!a.expectation_match) return "Please tell us if the first interaction matched expectations.";
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
/*  v2 validation helpers                                            */
/* ────────────────────────────────────────────────────────────────── */

function validateV2_48h(a) {
  if (!a.match_feel) return "Please rate how you feel about your matches.";
  if (!a.reached_out) return "Please let us know if you've started reaching out.";
  return null;
}

function validateV2_3w(a) {
  if (!a.selected_therapists || a.selected_therapists.length === 0)
    return "Please select which therapists you've contacted.";
  if (!a.going_so_far) return "Please rate how the experience is going.";
  if (a.nps == null) return "Please rate how likely you are to recommend TheraVoca.";
  return null;
}

function validateV2_9w(a) {
  if (!a.still_seeing) return "Please tell us your current therapy status.";
  if (!a.feel_understood) return "Please rate how understood you feel.";
  if (!a.expectations_match) return "Please rate whether therapy has met expectations.";
  if (!a.goals_aligned) return "Please rate goal alignment with your therapist.";
  if (a.nps == null) return "Please rate how likely you are to recommend TheraVoca.";
  return null;
}

function validateV2_15w(a) {
  if (!a.still_seeing) return "Please tell us your current therapy status.";
  if (!a.feel_understood) return "Please rate how understood you feel.";
  if (!a.expectations_match) return "Please rate whether therapy has met expectations.";
  if (!a.goals_aligned) return "Please rate goal alignment with your therapist.";
  if (a.nps == null) return "Please rate how likely you are to recommend TheraVoca.";
  return null;
}

const V2_VALIDATORS = {
  "48h": validateV2_48h,
  "3w": validateV2_3w,
  "9w": validateV2_9w,
  "15w": validateV2_15w,
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
  // v=2 in email links; default to 1 for backward compat
  const surveyVersion = Number(searchParams.get("v")) || 1;

  const [answers, setAnswers] = useState({});
  const [therapists, setTherapists] = useState([]);
  const [allAppliedTherapists, setAllAppliedTherapists] = useState([]);
  const [existingSubmission, setExistingSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [crisisFlagged, setCrisisFlagged] = useState(false);
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

  // Load therapist list for v2 milestones. Backend filters by milestone:
  // 48h/3w return APPLIED therapists; 9w/15w prefer the patient's 3w
  // selection, falling back to applied. Used by 3w Q1, 48h Q2b, and
  // 9w/15w Q1b conditional dropdowns.
  useEffect(() => {
    if (["48h", "3w", "9w", "15w"].includes(milestone)) {
      const client = getClient();
      client
        .get(`/feedback/patient/${requestId}/matches`, {
          params: { ...(authParams().params || {}), milestone },
        })
        .then((res) => {
          const normalize = (m) => ({
            id: m.therapist_id || m.id,
            therapist_id: m.therapist_id || m.id,
            name: m.therapist_name || m.name || "Therapist",
            therapist_name: m.therapist_name || m.name || "Therapist",
            score: m.match_score || m.score,
            match_score: m.match_score || m.score,
            credential_type: m.credential_type,
            years_experience: m.years_experience,
            modality_offering: m.modality_offering,
            avatar_color: m.avatar_color,
          });
          // 9w/15w return both `matches` (3w picks or fallback) AND
          // `all_applied` (full applied list). 48h/3w return only
          // `matches`. all_applied defaults to [] when absent.
          const matches = res.data?.matches || res.data || [];
          const allApplied = res.data?.all_applied || [];
          setTherapists(matches.map(normalize));
          setAllAppliedTherapists(allApplied.map(normalize));
        })
        .catch((e) => {
          // Surface the actual error -- silent catches mask real bugs
          // (CLAUDE.md gotcha). Empty list = either no applied therapists
          // (correct UX for 3w/9w/15w when none applied) OR a real
          // failure that's now visible in the console.
          // eslint-disable-next-line no-console
          console.error("Failed to load /feedback/.../matches:", e);
          setTherapists([]);
        });
    }
    setLoading(false);
  }, [milestone, requestId, getClient, authParams]);

  // Replay mode: check for an existing submission. If one exists, the
  // form renders read-only with a "Submitted on ..." banner and the
  // Submit button is hidden. Only v2 surveys support replay; v1 forms
  // continue as-is.
  useEffect(() => {
    if (!["48h", "3w", "9w", "15w"].includes(milestone)) return;
    if (surveyVersion !== 2) return;
    const client = getClient();
    client
      .get(`/feedback/patient/${requestId}/${milestone}`, {
        params: { ...(authParams().params || {}) },
      })
      .then((res) => {
        // null body = not submitted yet; doc body = replay mode.
        if (res.data) {
          setExistingSubmission(res.data);
          setAnswers(res.data);
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("Failed to load existing submission:", e);
      });
  }, [milestone, requestId, getClient, authParams, surveyVersion]);

  const setAnswer = useCallback((key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = async () => {
    const validatorMap = surveyVersion === 2 ? V2_VALIDATORS : VALIDATORS;
    const validator = validatorMap[milestone];
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
      const res = await client.post(
        `/feedback/patient/${requestId}/${milestone}`,
        { milestone, survey_version: surveyVersion, ...answers },
        authParams()
      );
      // Backend returns crisis_flagged=true when the response triggered
      // a self-harm / suicide alert. Show the 988 resources prominently
      // alongside the thank-you state.
      if (res?.data?.crisis_flagged) {
        setCrisisFlagged(true);
      }
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
          <div className="max-w-xl mx-auto py-12">
            {crisisFlagged && (
              <div
                className="mb-10 bg-[#FDF1EF] border-2 border-[#D45D5D] rounded-2xl p-6 sm:p-7"
                role="alert"
                data-testid="crisis-resources"
              >
                <h2 className="font-serif-display text-2xl text-[#8B3220]">
                  We're here, and so are these resources
                </h2>
                <p className="text-sm text-[#2B2A29] mt-3 leading-relaxed">
                  Some of what you shared sounded heavy, and we want you to
                  have people on the other end right now if you need them.
                  These are free, confidential, and answer 24/7:
                </p>
                <div className="mt-5 space-y-4 text-sm">
                  <div>
                    <div className="font-semibold text-[#2D4A3E]">
                      988 Suicide &amp; Crisis Lifeline
                    </div>
                    <div className="text-[#2B2A29] mt-1">
                      Call or text{" "}
                      <a
                        href="tel:988"
                        className="text-[#8B3220] font-semibold underline"
                        data-testid="crisis-988-link"
                      >
                        988
                      </a>
                      {" "}- 24/7, free, confidential.
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2D4A3E]">
                      Crisis Text Line
                    </div>
                    <div className="text-[#2B2A29] mt-1">
                      Text <strong>HOME</strong> to{" "}
                      <a
                        href="sms:741741"
                        className="text-[#8B3220] font-semibold underline"
                      >
                        741741
                      </a>
                      {" "}from anywhere in the US.
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-[#2D4A3E]">
                      If you're in immediate danger
                    </div>
                    <div className="text-[#2B2A29] mt-1">
                      Call <a href="tel:911" className="text-[#8B3220] font-semibold underline">911</a>{" "}
                      or go to your nearest emergency room.
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[#6D6A65] mt-5 leading-relaxed">
                  Someone from our team will also reach out within 24 hours.
                  Your therapist can be part of this too - please tell them
                  what you shared with us.
                </p>
              </div>
            )}
            <div className="text-center">
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
          {surveyVersion < 2 && (
            <p className="text-xs text-[#A8A39B] mt-1">
              Your therapist never sees your responses.
            </p>
          )}

          {/* Questions */}
          <div className="mt-8 space-y-5">
            {surveyVersion === 2 ? (
              <>
                {milestone === "48h" && (
                  <V2Milestone48h answers={answers} setAnswer={setAnswer} therapists={therapists} existingSubmission={existingSubmission} />
                )}
                {milestone === "3w" && (
                  <V2Milestone3w answers={answers} setAnswer={setAnswer} therapists={therapists} existingSubmission={existingSubmission} />
                )}
                {milestone === "9w" && (
                  <V2Milestone9w answers={answers} setAnswer={setAnswer} therapists={therapists} allAppliedTherapists={allAppliedTherapists} existingSubmission={existingSubmission} />
                )}
                {milestone === "15w" && (
                  <V2Milestone15w answers={answers} setAnswer={setAnswer} therapists={therapists} allAppliedTherapists={allAppliedTherapists} existingSubmission={existingSubmission} />
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Submit (hidden in replay mode) */}
          {!existingSubmission && (
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
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
