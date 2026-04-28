/**
 * FeedbackForm — landing page for the 48h / 2-week follow-up email links.
 *
 * Routes:
 *   /feedback/patient/:requestId?milestone=48h|2w
 *   /feedback/therapist/:therapistId?milestone=2w
 *
 * Three structured questions + optional free-form notes. Submits to
 *   POST /api/feedback/patient/{id}  or
 *   POST /api/feedback/therapist/{id}
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";

const RATINGS = [
  { v: 1, l: "Terrible" },
  { v: 2, l: "Not great" },
  { v: 3, l: "Okay" },
  { v: 4, l: "Good" },
  { v: 5, l: "Excellent" },
];

function StarRow({ value, onChange, testidPrefix }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {RATINGS.map(({ v, l }) => (
        <button
          type="button"
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-2 rounded-full border text-sm transition ${
            value === v
              ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
              : "bg-white text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
          }`}
          data-testid={`${testidPrefix}-${v}`}
        >
          {v} — {l}
        </button>
      ))}
    </div>
  );
}

export default function FeedbackForm({ kind }) {
  const navigate = useNavigate();
  const params = useParams();
  const [sp] = useSearchParams();
  const milestone = sp.get("milestone") || (kind === "patient" ? "48h" : "2w");
  const id = kind === "patient" ? params.requestId : params.therapistId;

  const [rating1, setRating1] = useState(0);
  const [q2, setQ2] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const q1Label = useMemo(
    () =>
      kind === "patient"
        ? "How well did the therapist matches fit what you were looking for?"
        : "Over the last two weeks, how well did TheraVoca referrals match your practice?",
    [kind],
  );
  const q2Options = useMemo(
    () =>
      kind === "patient"
        ? [
            { v: "booked", l: "Booked a session with one of them" },
            { v: "reached_out", l: "Reached out but haven't booked yet" },
            { v: "still_browsing", l: "Still reading through profiles" },
            { v: "none", l: "Didn't reach out to any of them" },
          ]
        : [
            { v: "booked_multiple", l: "Yes — booked multiple intakes" },
            { v: "booked_one", l: "Yes — booked one intake" },
            { v: "no_contact", l: "Patients haven't reached out yet" },
            { v: "no_fit", l: "Contacted but no good fit" },
          ],
    [kind],
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!rating1 || !q2) {
      toast.error("Please answer the first two questions.");
      return;
    }
    setSubmitting(true);
    try {
      const payload =
        kind === "patient"
          ? {
              milestone,
              reached_out: q2,
              match_quality: rating1,
              notes,
            }
          : {
              milestone,
              referrals_quality: rating1,
              booked_any: q2,
              notes,
            };
      await api.post(`/feedback/${kind}/${id}`, payload);
      setDone(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't submit. Try again?");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-[#FDFBF7]">
        <Header />
        <main className="max-w-xl mx-auto px-6 py-24 text-center">
          <CheckCircle2 className="mx-auto text-[#2D4A3E]" size={48} strokeWidth={1.5} />
          <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
            Thank you
          </h1>
          <p className="text-[#6D6A65] mt-3 text-pretty">
            Your answers go directly to the TheraVoca team. They genuinely
            shape how we match the next person.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-8 inline-flex items-center gap-2 text-[#2D4A3E] hover:underline"
            data-testid="feedback-back-home"
          >
            Back to TheraVoca
          </button>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <Header />
      <main className="max-w-2xl mx-auto px-6 py-14" data-testid={`feedback-form-${kind}`}>
        <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
          Quick feedback · {milestone === "48h" ? "48-hour check-in" : "2-week check-in"}
        </p>
        <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2">
          {kind === "patient"
            ? "How are your matches?"
            : "How are the referrals?"}
        </h1>
        <p className="text-[#6D6A65] mt-3 text-pretty">
          Three quick questions. Takes under a minute, and your answers help us
          match smarter for every future{" "}
          {kind === "patient" ? "patient" : "therapist"}.
        </p>

        <form onSubmit={submit} className="space-y-8 mt-8">
          <div>
            <h3 className="font-medium text-[#2B2A29] mb-3">1. {q1Label}</h3>
            <StarRow value={rating1} onChange={setRating1} testidPrefix="q1" />
          </div>
          <div>
            <h3 className="font-medium text-[#2B2A29] mb-3">
              2.{" "}
              {kind === "patient"
                ? "What did you do after reading the matches?"
                : "Have you booked any intakes from our referrals?"}
            </h3>
            <div className="flex flex-col gap-2">
              {q2Options.map((o) => (
                <label
                  key={o.v}
                  className={`flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer transition ${
                    q2 === o.v
                      ? "border-[#2D4A3E] bg-[#F2F4F0]"
                      : "border-[#E8E5DF] hover:border-[#2D4A3E]"
                  }`}
                  data-testid={`q2-${o.v}`}
                >
                  <input
                    type="radio"
                    name="q2"
                    checked={q2 === o.v}
                    onChange={() => setQ2(o.v)}
                    className="accent-[#2D4A3E]"
                  />
                  <span className="text-sm text-[#2B2A29]">{o.l}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium text-[#2B2A29] mb-3">
              3. Anything you'd change? <span className="text-xs text-[#6D6A65] font-normal">(optional)</span>
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full border border-[#E8E5DF] rounded-lg px-3 py-2.5 text-sm focus:border-[#2D4A3E] focus:outline-none resize-none"
              placeholder={
                kind === "patient"
                  ? "Anything missing from the profiles? Thresholds too strict?"
                  : "Wrong specialties? Wrong payment mix? Geographic reach too narrow?"
              }
              data-testid="q3-notes"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 bg-[#2D4A3E] text-white rounded-full py-3 text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-60"
            data-testid="feedback-form-submit"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Submit feedback
          </button>
        </form>
      </main>
      <Footer />
    </div>
  );
}
