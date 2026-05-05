import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api, getSession, sessionClient } from "@/lib/api";

/**
 * One-click decline page. When a therapist clicks "Not interested" in
 * their referral email, the link lands here and automatically fires the
 * decline POST on mount. No extra clicks required -- they already
 * decided in their inbox.
 */
export default function TherapistDecline() {
  const { requestId, therapistId } = useParams();
  const [searchParams] = useSearchParams();
  const sig = searchParams.get("sig") || "";
  const exp = searchParams.get("exp") || "";
  const sigQs = sig ? `?sig=${encodeURIComponent(sig)}&exp=${encodeURIComponent(exp)}` : "";

  const [status, setStatus] = useState("loading"); // loading | done | error
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const client = getSession() ? sessionClient() : api;
    client
      .post(`/therapist/decline/${requestId}/${therapistId}${sigQs}`, {
        reason_codes: ["declined_via_email"],
        notes: "",
      })
      .then(() => {
        if (!cancelled) setStatus("done");
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(
            e?.response?.data?.detail || "Could not record your decline.",
          );
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, therapistId, sigQs]);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="max-w-md w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center">
          {status === "loading" && (
            <Loader2 className="mx-auto animate-spin text-[#2D4A3E]" size={32} />
          )}
          {status === "done" && (
            <>
              <CheckCircle2 className="mx-auto text-[#2D4A3E]" size={32} />
              <h1 className="font-serif-display text-3xl text-[#2D4A3E] mt-4">
                You've declined this referral
              </h1>
              <p className="text-[#6D6A65] mt-2">
                Thanks for letting us know. We'll factor this into future
                matches so you get better-fit referrals.
              </p>
            </>
          )}
          {status === "error" && (
            <>
              <AlertCircle className="mx-auto text-[#D45D5D]" size={32} />
              <h1 className="font-serif-display text-3xl text-[#2D4A3E] mt-4">
                Something went wrong
              </h1>
              <p className="text-[#6D6A65] mt-2">{errorMsg}</p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
