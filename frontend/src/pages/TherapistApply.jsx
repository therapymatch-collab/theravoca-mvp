import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";

export default function TherapistApply() {
  const { requestId, therapistId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api
      .get(`/therapist/apply/${requestId}/${therapistId}`)
      .then((res) => {
        setData(res.data);
        if (res.data.already_applied) {
          setMessage(res.data.existing_message || "");
          setSubmitted(true);
        }
      })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load this referral."));
  }, [requestId, therapistId]);

  const submit = async () => {
    if (message.trim().length < 10) {
      toast.error("Please write at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/therapist/apply/${requestId}/${therapistId}`, { message });
      setSubmitted(true);
      toast.success("Thank you — your interest has been recorded.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header minimal />
        <main className="flex-1 flex items-center justify-center px-5 py-16">
          <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center">
            <AlertCircle className="mx-auto text-[#D45D5D]" size={32} />
            <h1 className="font-serif-display text-3xl text-[#2D4A3E] mt-4">
              Cannot load referral
            </h1>
            <p className="text-[#6D6A65] mt-2">{error}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D4A3E]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-apply-page">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Anonymous referral
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            Hi, {data.therapist.name.split(",")[0]}.
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-2xl">
            Below is an anonymous referral matched to your practice. If it feels like a
            fit, write a brief note — it'll be shared with the patient alongside your
            profile.
          </p>

          <div className="mt-8 grid md:grid-cols-3 gap-5">
            <div className="md:col-span-1 bg-white border border-[#E8E5DF] rounded-2xl p-6">
              <div className="text-xs uppercase tracking-[0.15em] text-[#6D6A65]">
                Match score
              </div>
              <div className="font-serif-display text-5xl text-[#2D4A3E] mt-1">
                {Math.round(data.match_score)}%
              </div>
              <div className="mt-4 h-1.5 bg-[#E8E5DF] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#C87965]"
                  style={{ width: `${data.match_score}%` }}
                />
              </div>
            </div>
            <div className="md:col-span-2 bg-white border border-[#E8E5DF] rounded-2xl p-6">
              <h3 className="font-semibold text-[#2B2A29] mb-3">Referral summary</h3>
              <dl className="space-y-2.5">
                {Object.entries(data.summary).map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-3 gap-3 text-sm border-b border-[#E8E5DF]/70 last:border-0 pb-2 last:pb-0"
                  >
                    <dt className="text-[#6D6A65]">{k}</dt>
                    <dd className="col-span-2 text-[#2B2A29]">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-6 md:p-8">
            <h3 className="font-semibold text-[#2B2A29] text-lg">
              Write a short note to the patient
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              Introduce yourself and how you'd approach this work. Keep it warm and brief.
            </p>
            <Textarea
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitted}
              placeholder="I specialize in working with young adults navigating anxiety and depression. I integrate CBT and mindfulness-based approaches and offer evening telehealth slots. I'd love to set up a free 15-minute consult to see if we're a fit."
              className="mt-4 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="therapist-message"
            />
            <div className="mt-6 flex items-center justify-between flex-wrap gap-4">
              <p className="text-xs text-[#6D6A65]">
                The patient will see your message + profile only. Your contact info is
                shared only with patients you're matched with.
              </p>
              {submitted ? (
                <div
                  className="flex items-center gap-2 text-[#2D4A3E] font-medium"
                  data-testid="apply-success"
                >
                  <CheckCircle2 size={18} /> Interest submitted
                </div>
              ) : (
                <button
                  className="tv-btn-primary disabled:opacity-50"
                  disabled={submitting}
                  onClick={submit}
                  data-testid="apply-submit-btn"
                >
                  {submitting ? "Sending..." : "Submit interest"}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
