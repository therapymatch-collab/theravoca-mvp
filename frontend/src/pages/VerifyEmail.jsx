import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api, setSession } from "@/lib/api";
import { ICON_SIZE_LG } from "@/lib/constants";
import useSiteCopy from "@/lib/useSiteCopy";

export default function VerifyEmail() {
  const t = useSiteCopy();
  const { token } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isPending = token === "pending";
  // 2026-05-18 (Josh): sentinel route /verify/preview renders the
  // post-verification state WITHOUT hitting the API. Lets the Site
  // Copy admin Preview button land on the success screen so admins
  // can preview edits to intake.verified.heading / .body before
  // saving. Same pattern as the existing `token === "pending"`
  // sentinel above.
  const isPreview = token === "preview";
  const requestId = params.get("id");
  const [state, setState] = useState(
    isPending ? "pending" : isPreview ? "verified" : "loading",
  );
  const [verifiedId, setVerifiedId] = useState(isPreview ? "preview" : null);
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [offerAccount, setOfferAccount] = useState(false);

  useEffect(() => {
    if (isPending || isPreview) return;
    api
      .get(`/requests/verify/${token}`)
      .then((res) => {
        setVerifiedId(res.data.id);
        setVerifiedEmail(res.data.email || null);
        setState("verified");
        // Mint a patient session locally so the "Create my account" CTA
        // can drop the user straight into a password-setup form without
        // a second magic-code round-trip.
        if (res.data.session_token && res.data.email) {
          setSession({
            token: res.data.session_token,
            role: "patient",
            email: res.data.email,
          });
        }
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
  }, [token, isPending, isPreview]);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center tv-fade-up">
          {state === "pending" && (
            <>
              <div className="mx-auto w-14 h-14 rounded-full bg-[#C87965]/15 text-[#C87965] flex items-center justify-center">
                <Mail size={ICON_SIZE_LG} strokeWidth={1.6} />
              </div>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
                {t("intake.success.heading", "Check your inbox")}
              </h1>
              <p className="text-[#6D6A65] mt-3 leading-relaxed">
                {t(
                  "intake.success.body",
                  "We just sent you a confirmation link. Click it to start matching with therapists.",
                )}
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
              {/* 2026-05-18 (Josh): now site-copy-editable + copy
                  rewritten to be honest about the review step.
                  Previous defaults claimed "we're reaching out to
                  therapists" but with the admin-review gate (default
                  on), matching hasn't actually started yet here --
                  it kicks off only after admin clicks Release in
                  the Requests panel. New copy reflects the queue
                  state without alarming patients. */}
              <h1
                className="font-serif-display text-4xl text-[#2D4A3E] mt-5"
                data-testid="verify-success-heading"
              >
                {t(
                  "intake.verified.heading",
                  "You're in -- we'll take it from here",
                )}
              </h1>
              <p
                className="text-[#6D6A65] mt-3 leading-relaxed"
                data-testid="verify-success-body"
              >
                {t(
                  "intake.verified.body",
                  "Our team is reviewing your request now. As soon as it's cleared we'll start reaching out to therapists in Idaho who fit your needs. You'll get your personalized list by email -- typically within 24 hours of approval.",
                )}
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
                  <button
                    type="button"
                    onClick={() => navigate("/account/setup-password?next=/portal/patient")}
                    className="tv-btn-primary !py-2 !px-4 text-sm mt-3 inline-flex"
                    data-testid="offer-account-cta"
                  >
                    Create my account
                  </button>
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
