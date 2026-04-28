import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { ICON_SIZE_LG } from "@/lib/constants";

export default function VerifyEmail() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const isPending = token === "pending";
  const requestId = params.get("id");
  const [state, setState] = useState(isPending ? "pending" : "loading");
  const [verifiedId, setVerifiedId] = useState(null);
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [offerAccount, setOfferAccount] = useState(false);

  useEffect(() => {
    if (isPending) return;
    api
      .get(`/requests/verify/${token}`)
      .then((res) => {
        setVerifiedId(res.data.id);
        setVerifiedEmail(res.data.email || null);
        setState("verified");
        // If this email has filed multiple requests but hasn't set a
        // password yet, surface the "create an account" CTA so they can
        // start tracking everything in one dashboard.
        const emailFromResponse = res.data.email;
        if (emailFromResponse) {
          api
            .get(`/requests/prefill?email=${encodeURIComponent(emailFromResponse)}`)
            .then((p) => {
              const count = p.data?.prior_request_count || 0;
              const hasAcct = !!p.data?.has_password_account;
              if (count >= 2 && !hasAcct) setOfferAccount(true);
            })
            .catch(() => {});
        }
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
                <Mail size={ICON_SIZE_LG} strokeWidth={1.6} />
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
              {offerAccount && (
                <div
                  className="mt-7 bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5 text-left"
                  data-testid="offer-account-prompt"
                >
                  <div className="text-sm font-semibold text-[#2D4A3E]">
                    You've matched with us before — want one place to track everything?
                  </div>
                  <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
                    Create a quick account so you can sign in with a password and see all
                    your past requests, responses, and matches in one dashboard — no more
                    one-time codes.
                  </p>
                  <Link
                    to={`/sign-in?role=patient&email=${encodeURIComponent(verifiedEmail || "")}&setup=1&next=/portal/patient`}
                    className="tv-btn-primary !py-2 !px-4 text-sm mt-3 inline-flex"
                    data-testid="offer-account-cta"
                  >
                    Create my account
                  </Link>
                </div>
              )}
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
