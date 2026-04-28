import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const BARRIER_OPTIONS = [
  { v: "none", l: "Nothing — going well" },
  { v: "no_response", l: "Therapist didn't respond" },
  { v: "scheduling", l: "Couldn't find a time that worked" },
  { v: "cost", l: "Cost / insurance issue" },
  { v: "fit", l: "Didn't feel like a fit" },
  { v: "still_searching", l: "Still searching" },
  { v: "found_elsewhere", l: "Found a therapist outside TheraVoca" },
  { v: "other", l: "Other" },
];

const MILESTONE_TITLES = {
  "48h": "48 hours in",
  "2wk": "2 weeks in",
  "6wk": "6 weeks in",
};

export default function FollowupForm() {
  const { requestId, milestone } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [contacted, setContacted] = useState(null);
  const [therapistId, setTherapistId] = useState("");
  const [sessions, setSessions] = useState("");
  const [helpful, setHelpful] = useState(null);
  const [recommend, setRecommend] = useState(null);
  const [barriers, setBarriers] = useState([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    api
      .get(`/followup/${requestId}/${milestone}`)
      .then((res) => {
        setData(res.data);
        const ex = res.data.existing;
        if (ex) {
          setContacted(ex.contacted_therapist);
          setTherapistId(ex.therapist_id || "");
          setSessions(ex.sessions_completed?.toString() || "");
          setHelpful(ex.helpful_score ?? null);
          setRecommend(ex.would_recommend);
          setBarriers(ex.barriers || []);
          setNotes(ex.notes || "");
        }
      })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load"));
  }, [requestId, milestone]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/followup/${requestId}/${milestone}`, {
        contacted_therapist: contacted,
        therapist_id: therapistId || null,
        sessions_completed: sessions ? parseInt(sessions, 10) : null,
        helpful_score: helpful,
        would_recommend: recommend,
        barriers,
        notes,
      });
      setSubmitted(true);
      toast.success("Thank you for sharing!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBarrier = (v) => {
    setBarriers((b) => (b.includes(v) ? b.filter((x) => x !== v) : [...b, v]));
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="followup-form">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            {MILESTONE_TITLES[milestone] || "Check-in"}
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            How's it going?
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-xl leading-relaxed">
            A 30-second update so we can keep improving the matching engine.
            Your therapist never sees your responses.
          </p>

          {error && (
            <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-6 text-[#D45D5D]">
              {error}
            </div>
          )}

          {!data && !error && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {submitted && (
            <div
              className="mt-8 bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-6 flex items-start gap-3"
              data-testid="followup-success"
            >
              <CheckCircle2 className="text-[#2D4A3E] mt-1 shrink-0" size={20} />
              <div>
                <div className="font-semibold text-[#2D4A3E]">Got it — thank you!</div>
                <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                  Your update helps us improve match quality for the next person.
                </p>
                <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-[#2D4A3E] mt-3 hover:underline">
                  Back to home <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}

          {data && !submitted && (
            <div className="mt-8 space-y-6">
              {/* Q1 — contacted? */}
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="text-sm font-semibold text-[#2B2A29]">
                  Did you reach out to a therapist from TheraVoca?
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  {[
                    { v: true, l: "Yes" },
                    { v: false, l: "Not yet" },
                  ].map((o) => (
                    <button
                      key={o.l}
                      type="button"
                      onClick={() => setContacted(o.v)}
                      className={`px-4 py-2 rounded-full border text-sm transition ${
                        contacted === o.v
                          ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                          : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                      }`}
                      data-testid={`followup-contacted-${String(o.v)}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {contacted && data.applications?.length > 0 && (
                <>
                  {/* Q2 — which therapist? */}
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                    <div className="text-sm font-semibold text-[#2B2A29]">
                      Which therapist did you connect with?
                    </div>
                    <select
                      value={therapistId}
                      onChange={(e) => setTherapistId(e.target.value)}
                      className="mt-3 w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
                      data-testid="followup-therapist-select"
                    >
                      <option value="">Select therapist…</option>
                      {data.applications.map((a) => (
                        <option key={a.therapist_id} value={a.therapist_id}>
                          {a.therapist_name} ({Math.round(a.match_score)}% match)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Q3 — sessions */}
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                    <div className="text-sm font-semibold text-[#2B2A29]">
                      How many sessions have you completed?
                    </div>
                    <Input
                      type="number"
                      min="0"
                      value={sessions}
                      onChange={(e) => setSessions(e.target.value)}
                      placeholder="0"
                      className="mt-3 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl max-w-[120px]"
                      data-testid="followup-sessions"
                    />
                  </div>

                  {/* Q4 — helpful score */}
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                    <div className="text-sm font-semibold text-[#2B2A29]">
                      How helpful has this been so far? (1–10)
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setHelpful(n)}
                          className={`w-10 h-10 rounded-full border text-sm font-medium transition ${
                            helpful === n
                              ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                              : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                          }`}
                          data-testid={`followup-helpful-${n}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Q5 — recommend */}
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                    <div className="text-sm font-semibold text-[#2B2A29]">
                      Would you recommend TheraVoca to a friend?
                    </div>
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {[
                        { v: true, l: "Yes" },
                        { v: false, l: "Not yet" },
                      ].map((o) => (
                        <button
                          key={o.l}
                          type="button"
                          onClick={() => setRecommend(o.v)}
                          className={`px-4 py-2 rounded-full border text-sm transition ${
                            recommend === o.v
                              ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                              : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                          }`}
                          data-testid={`followup-recommend-${String(o.v)}`}
                        >
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Q6 — barriers */}
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="text-sm font-semibold text-[#2B2A29]">
                  Anything getting in the way? (select all that apply)
                </div>
                <div className="mt-3 flex flex-wrap gap-2" data-testid="followup-barriers">
                  {BARRIER_OPTIONS.map((b) => {
                    const active = barriers.includes(b.v);
                    return (
                      <button
                        key={b.v}
                        type="button"
                        onClick={() => toggleBarrier(b.v)}
                        className={`px-3 py-1.5 rounded-full border text-xs transition ${
                          active
                            ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                            : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                        }`}
                        data-testid={`followup-barrier-${b.v}`}
                      >
                        {b.l}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="text-sm font-semibold text-[#2B2A29]">
                  Anything else you'd like to share?
                </div>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional. Free-form notes — totally private."
                  className="mt-3 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  data-testid="followup-notes"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  className="tv-btn-primary disabled:opacity-50"
                  disabled={submitting}
                  onClick={submit}
                  data-testid="followup-submit"
                >
                  {submitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Silence unused-import warnings on Checkbox (kept for future radios)
void Checkbox;
