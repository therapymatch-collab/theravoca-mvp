import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, ThumbsDown, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { api, getSession } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DECLINE_REASONS = [
  { v: "wrong_specialty", l: "Outside my specialty area" },
  { v: "schedule_mismatch", l: "Schedule mismatch" },
  { v: "fee_mismatch", l: "Fee outside my range" },
  { v: "caseload_full", l: "Caseload currently full" },
  { v: "location_mismatch", l: "Location/format mismatch" },
  { v: "other", l: "Other" },
];



// Small "← Back to dashboard" affordance shown on the apply page so a
// signed-in therapist can bail out of the referral and return to their
// portal without using the browser back button. Renders to a Sign-in link
// when the visitor isn't signed in (e.g. clicked the email link from a
// fresh device).
function BackToDashboardLink() {
  const session = getSession();
  const role = session?.role;
  const target = role === "patient" ? "/portal/patient"
    : role === "therapist" ? "/portal/therapist"
    : null;
  return (
    <div className="mb-6">
      {target ? (
        <Link
          to={target}
          className="inline-flex items-center gap-1.5 text-sm text-[#6D6A65] hover:text-[#2D4A3E]"
          data-testid="apply-back-to-dashboard"
        >
          <ArrowLeft size={14} /> Back to my dashboard
        </Link>
      ) : (
        <Link
          to="/sign-in?role=therapist"
          className="inline-flex items-center gap-1.5 text-sm text-[#6D6A65] hover:text-[#2D4A3E]"
          data-testid="apply-back-to-signin"
        >
          <ArrowLeft size={14} /> Sign in to your dashboard
        </Link>
      )}
    </div>
  );
}

export default function TherapistApply() {
  const { requestId, therapistId } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [confirmAvail, setConfirmAvail] = useState(false);
  const [confirmUrgency, setConfirmUrgency] = useState(false);
  const [confirmPayment, setConfirmPayment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReasons, setDeclineReasons] = useState([]);
  const [declineNotes, setDeclineNotes] = useState("");
  const [declineSubmitting, setDeclineSubmitting] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    api
      .get(`/therapist/apply/${requestId}/${therapistId}`)
      .then((res) => {
        setData(res.data);
        if (res.data.already_applied) {
          setMessage(res.data.existing_message || "");
          const c = res.data.existing_confirmations || {};
          setConfirmAvail(!!c.availability);
          setConfirmUrgency(!!c.urgency);
          setConfirmPayment(!!c.payment);
          setSubmitted(true);
        }
        if (searchParams.get("decline") === "1" && !res.data.already_applied) {
          setDeclineOpen(true);
        }
      })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load this referral."));
  }, [requestId, therapistId, searchParams]);

  const allConfirmed = confirmAvail && confirmUrgency && confirmPayment;

  const submit = async () => {
    if (!allConfirmed) {
      toast.error("Please confirm all three commitments before submitting interest.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/therapist/apply/${requestId}/${therapistId}`, {
        message,
        confirms_availability: confirmAvail,
        confirms_urgency: confirmUrgency,
        confirms_payment: confirmPayment,
      });
      setSubmitted(true);
      toast.success("Interest submitted — taking you to your dashboard.");
      // Send the therapist to their portal so they can see all their referrals
      // in context. We delay slightly so they see the success state first.
      setTimeout(() => {
        window.location.href = "/portal/therapist";
      }, 1200);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDecline = async () => {
    if (declineReasons.length === 0) {
      toast.error("Please pick at least one reason — it helps us match better next time.");
      return;
    }
    setDeclineSubmitting(true);
    try {
      await api.post(`/therapist/decline/${requestId}/${therapistId}`, {
        reason_codes: declineReasons,
        notes: declineNotes,
      });
      toast.success("Thanks — we'll factor this into future matches.");
      setDeclined(true);
      setDeclineOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't record decline.");
    } finally {
      setDeclineSubmitting(false);
    }
  };

  const toggleReason = (v) => {
    setDeclineReasons((arr) =>
      arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v],
    );
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
            <div className="mt-6">
              <BackToDashboardLink />
            </div>
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
          <BackToDashboardLink />
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Anonymous referral
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            Hi {data.therapist.name.split(",")[0].split(" ")[0]},
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-2xl">
            Below is an anonymous referral matched to your practice. If it feels like a
            fit, write a short note (optional) and submit interest. If it isn't,
            tell us why so we can match you better next time.
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
              {data.gaps && data.gaps.length > 0 && (
                <div className="mt-5 pt-5 border-t border-[#E8E5DF]" data-testid="apply-gaps">
                  <div className="text-xs uppercase tracking-[0.15em] text-[#6D6A65] mb-3">
                    Why not 100% — and what to address
                  </div>
                  <ul className="space-y-3">
                    {data.gaps.map((g) => (
                      <li
                        key={g.key}
                        className="text-xs leading-snug"
                        data-testid={`gap-${g.key}`}
                      >
                        <div className="text-[#C87965] font-semibold">{g.label}</div>
                        <div className="text-[#2B2A29] mt-0.5 leading-relaxed">
                          {g.explanation}
                        </div>
                        <div className="text-[#6D6A65] italic mt-1 leading-relaxed">
                          → {g.suggestion}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-[#6D6A65] mt-3 leading-relaxed">
                    Address these directly in your message below if you want to apply.
                  </p>
                </div>
              )}
            </div>
            <div className="md:col-span-2 bg-white border border-[#E8E5DF] rounded-2xl p-6">
              <h3 className="font-semibold text-[#2B2A29] mb-3">Referral summary</h3>
              <dl className="space-y-2.5">
                {Object.entries(data.summary).map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-3 gap-3 text-sm border-b border-[#E8E5DF]/70 last:border-0 pb-2 last:pb-0"
                    data-testid={
                      k === "Payment" ? "apply-payment-row" : undefined
                    }
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
              Write a short note to the patient (optional)
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              Introduce yourself and how you'd approach this work. Patients respond
              meaningfully more often when there's a personal note — but you can
              submit interest without one.
            </p>
            <Textarea
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitted || declined}
              placeholder="I specialize in working with young adults navigating anxiety and depression. I integrate CBT and mindfulness-based approaches and offer evening telehealth slots. I'd love to set up a free 15-minute consult to see if we're a fit."
              className="mt-4 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="therapist-message"
            />

            <div className="mt-6 pt-6 border-t border-[#E8E5DF]">
              <h4 className="font-semibold text-[#2B2A29]">
                Confirm your commitment
              </h4>
              <p className="text-sm text-[#6D6A65] mt-1">
                Please confirm all three before submitting interest. This protects
                patients from being matched with therapists who can't actually take them.
              </p>
              <div className="mt-4 space-y-2.5">
                {[
                  {
                    k: "avail",
                    state: confirmAvail,
                    setter: setConfirmAvail,
                    title: "I can see this patient this week",
                    sub: `Their availability: ${data.summary["Availability"] || "—"}`,
                    testid: "confirm-availability",
                  },
                  {
                    k: "urgency",
                    state: confirmUrgency,
                    setter: setConfirmUrgency,
                    title: "I can match their urgency",
                    sub: `Patient urgency: ${data.summary["Urgency"] || "—"}`,
                    testid: "confirm-urgency",
                  },
                  {
                    k: "payment",
                    state: confirmPayment,
                    setter: setConfirmPayment,
                    title: "I accept their payment method",
                    sub: `Payment: ${data.summary["Payment"] || "—"}`,
                    testid: "confirm-payment",
                  },
                ].map((row) => (
                  <label
                    key={row.k}
                    className={`flex items-start gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${
                      row.state
                        ? "bg-[#F2F4F0] border-[#2D4A3E]"
                        : "bg-[#FDFBF7] border-[#E8E5DF] hover:border-[#2D4A3E]"
                    } ${submitted || declined ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <Checkbox
                      checked={row.state}
                      onCheckedChange={(v) => row.setter(!!v)}
                      disabled={submitted || declined}
                      className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                      data-testid={row.testid}
                    />
                    <div className="text-sm">
                      <div className="font-medium text-[#2B2A29]">{row.title}</div>
                      <div className="text-xs text-[#6D6A65] mt-0.5 leading-relaxed">
                        {row.sub}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-6 flex items-end justify-between flex-wrap gap-4">
              <p className="text-xs text-[#6D6A65] flex-1 min-w-[260px] max-w-md leading-relaxed">
                The patient will see your name, profile and message only. Your
                contact info is shared only with patients you're matched with.
              </p>
              {submitted ? (
                <div
                  className="flex items-center gap-2 text-[#2D4A3E] font-medium"
                  data-testid="apply-success"
                >
                  <CheckCircle2 size={18} /> Interest submitted
                </div>
              ) : declined ? (
                <div
                  className="flex items-center gap-2 text-[#6D6A65] font-medium"
                  data-testid="decline-success"
                >
                  <ThumbsDown size={18} /> Declined — thanks for the feedback
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    className="text-sm text-[#6D6A65] hover:text-[#D45D5D] inline-flex items-center gap-1.5 transition"
                    onClick={() => setDeclineOpen(true)}
                    data-testid="not-interested-btn"
                  >
                    <ThumbsDown size={14} /> Not interested
                  </button>
                  <button
                    className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting || !allConfirmed}
                    onClick={submit}
                    data-testid="apply-submit-btn"
                  >
                    {submitting ? "Sending..." : "Submit interest"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent
          className="max-w-lg bg-white border-[#E8E5DF]"
          data-testid="decline-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Why isn't this a fit?
            </DialogTitle>
            <DialogDescription className="text-sm text-[#6D6A65]">
              Pick one or more reasons — your answer helps us route better referrals next
              time. Anonymous to the patient.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-3">
            {DECLINE_REASONS.map((r) => (
              <label
                key={r.v}
                className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 cursor-pointer hover:border-[#2D4A3E] transition"
              >
                <Checkbox
                  checked={declineReasons.includes(r.v)}
                  onCheckedChange={() => toggleReason(r.v)}
                  className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  data-testid={`decline-reason-${r.v}`}
                />
                <span className="text-sm text-[#2B2A29]">{r.l}</span>
              </label>
            ))}
          </div>
          <Textarea
            rows={3}
            value={declineNotes}
            onChange={(e) => setDeclineNotes(e.target.value)}
            placeholder="Anything else (optional, no contact or personally identifiable info)"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl mt-3"
            data-testid="decline-notes"
          />
          <DialogFooter className="flex gap-2 justify-end mt-3">
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={() => setDeclineOpen(false)}
              data-testid="decline-cancel"
            >
              Cancel
            </button>
            <button
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              onClick={submitDecline}
              disabled={declineSubmitting || declineReasons.length === 0}
              data-testid="decline-submit"
            >
              {declineSubmitting ? "Sending..." : "Send feedback"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Footer />
    </div>
  );
}
