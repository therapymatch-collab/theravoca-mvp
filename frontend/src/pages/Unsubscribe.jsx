import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Header, Footer } from "@/components/SiteShell";
import { Loader2, CheckCircle2, AlertCircle, RotateCw } from "lucide-react";

/**
 * One-click unsubscribe page. Reached via the link embedded in
 * recurring email footers. URL shape:
 *   /unsubscribe/patient/:id?token=...
 *   /unsubscribe/therapist/:id?token=...
 *
 * On mount we POST to the corresponding backend endpoint. If it
 * succeeds, show a "you're unsubscribed" message with a resubscribe
 * option. If the token is invalid or the server errors, show a
 * friendly error.
 */
export default function Unsubscribe({ role }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const token = search.get("token");

  const [status, setStatus] = useState("loading"); // loading | done | already | error
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [reSubBusy, setReSubBusy] = useState(false);
  const [reSubbed, setReSubbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!token || !id) {
        setStatus("error");
        setErrorMsg("This unsubscribe link is missing required info. Try the link from the email again.");
        return;
      }
      try {
        const url = `/unsubscribe/${role}/${id}`;
        const res = await api.post(url, null, { params: { token } });
        if (cancelled) return;
        setEmail(res.data?.email || "");
        setStatus(res.data?.already_unsubscribed ? "already" : "done");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err?.response?.data?.detail || "We couldn't process that link. It may be expired or already used.");
      }
    }
    go();
    return () => { cancelled = true; };
  }, [id, role, token]);

  const resubscribe = async () => {
    setReSubBusy(true);
    try {
      await api.post(`/unsubscribe/${role}/${id}/resubscribe`, null, { params: { token } });
      setReSubbed(true);
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || "Couldn't re-subscribe. Email support@theravoca.com for help.");
    } finally {
      setReSubBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full bg-white border border-[#E8E5DF] rounded-2xl p-8 sm:p-10 shadow-sm">
          {status === "loading" && (
            <div className="text-center py-8" data-testid="unsub-loading">
              <Loader2 size={28} className="animate-spin mx-auto text-[#2D4A3E]" />
              <p className="mt-4 text-[#6D6A65]">Processing your unsubscribe request...</p>
            </div>
          )}

          {(status === "done" || status === "already") && !reSubbed && (
            <div className="text-center" data-testid="unsub-success">
              <CheckCircle2 size={40} className="mx-auto text-[#4A6B5D] mb-3" />
              <h1 className="font-serif-display text-2xl text-[#2D4A3E]">
                {status === "already" ? "You were already unsubscribed" : "You're unsubscribed"}
              </h1>
              {email && (
                <p className="text-sm text-[#6D6A65] mt-2">
                  {email}
                </p>
              )}
              <p className="text-[#2B2A29] mt-5 leading-relaxed">
                You won't receive any more recurring emails from TheraVoca. Important
                transactional messages (such as account verification) may still be sent.
              </p>
              <p className="text-sm text-[#6D6A65] mt-6">
                Clicked by mistake?
              </p>
              <button
                onClick={resubscribe}
                disabled={reSubBusy}
                data-testid="unsub-resubscribe"
                className="mt-3 inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
              >
                {reSubBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                Re-subscribe
              </button>
            </div>
          )}

          {reSubbed && (
            <div className="text-center" data-testid="unsub-resubscribed">
              <CheckCircle2 size={40} className="mx-auto text-[#4A6B5D] mb-3" />
              <h1 className="font-serif-display text-2xl text-[#2D4A3E]">You're re-subscribed</h1>
              <p className="text-[#2B2A29] mt-4 leading-relaxed">
                You'll receive TheraVoca emails again. Click the unsubscribe link in any
                email if you change your mind.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="text-center" data-testid="unsub-error">
              <AlertCircle size={40} className="mx-auto text-[#D45D5D] mb-3" />
              <h1 className="font-serif-display text-2xl text-[#2D4A3E]">
                Something went wrong
              </h1>
              <p className="text-[#2B2A29] mt-4 leading-relaxed">{errorMsg}</p>
              <p className="text-sm text-[#6D6A65] mt-6">
                Need help? Email{" "}
                <a
                  href="mailto:support@theravoca.com"
                  className="text-[#2D4A3E] underline"
                >
                  support@theravoca.com
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
