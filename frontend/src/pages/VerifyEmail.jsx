import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";

export default function VerifyEmail() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const isPending = token === "pending";
  const requestId = params.get("id");
  const [state, setState] = useState(isPending ? "pending" : "loading");
  const [verifiedId, setVerifiedId] = useState(null);

  useEffect(() => {
    if (isPending) return;
    api
      .get(`/requests/verify/${token}`)
      .then((res) => {
        setVerifiedId(res.data.id);
        setState("verified");
      })
      .catch(() => setState("error"));
  }, [token, isPending]);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center tv-fade-up">
          {state === "pending" && (
            <>
              <div className="mx-auto w-14 h-14 rounded-full bg-[#C87965]/15 text-[#C87965] flex items-center justify-center">
                <Mail size={26} strokeWidth={1.6} />
              </div>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
                Check your inbox
              </h1>
              <p className="text-[#6D6A65] mt-3 leading-relaxed">
                We just sent you a confirmation link. Click it to start matching with therapists.
              </p>
              <p className="text-xs text-[#6D6A65] mt-6">
                Don't see it? Check your spam folder. Request ID:{" "}
                <span className="font-mono">{requestId?.slice(0, 8)}</span>
              </p>
            </>
          )}
          {state === "loading" && (
            <div className="py-10">
              <Loader2 className="animate-spin mx-auto text-[#2D4A3E]" />
              <p className="mt-4 text-[#6D6A65]">Confirming your request...</p>
            </div>
          )}
          {state === "verified" && (
            <>
              <div className="mx-auto w-14 h-14 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
                <CheckCircle2 size={28} strokeWidth={1.6} />
              </div>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
                You're matched up!
              </h1>
              <p className="text-[#6D6A65] mt-3 leading-relaxed">
                We're reaching out to therapists in Idaho who are a strong fit for your needs.
                You'll receive your personalized list within 24 hours.
              </p>
              <Link
                to={`/results/${verifiedId}`}
                className="tv-btn-primary mt-8 inline-flex"
                data-testid="view-status-btn"
              >
                Track responses
              </Link>
            </>
          )}
          {state === "error" && (
            <>
              <h1 className="font-serif-display text-3xl text-[#D45D5D]">
                Link expired or invalid
              </h1>
              <p className="text-[#6D6A65] mt-3">
                Please re-submit your request from the homepage.
              </p>
              <Link to="/" className="tv-btn-primary mt-6 inline-flex" data-testid="home-btn">
                Back home
              </Link>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
