import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, FileText } from "lucide-react";
import { api, getSession } from "@/lib/api";
import { Header, Footer } from "@/components/SiteShell";

// Patient receipt of submitted intake answers. Created so the intake-
// receipt EMAIL can be trimmed of PHI -- the answers live here behind
// the same `?t=<view_token>` auto-login the matches page uses.
//
// Auth model:
//   - URL token (?t=<view_token>) auto-grants access. Backend verifies
//     token matches the request's stored view_token.
//   - Otherwise: backend returns 401 and we redirect to magic-code
//     sign-in with this URL as the `next` param.
export default function PatientReceipt() {
  const { requestId } = useParams();
  const [params] = useSearchParams();
  const t = params.get("t") || "";
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const tokenQuery = t ? `?t=${encodeURIComponent(t)}` : "";
        const session = getSession();
        const headers = session?.token
          ? { Authorization: `Bearer ${session.token}` }
          : undefined;
        const r = await api.get(
          `/requests/${requestId}/receipt${tokenQuery}`,
          { headers },
        );
        setData(r.data || {});
      } catch (e) {
        if (e?.response?.status === 401) {
          navigate(
            `/sign-in?role=patient&next=${encodeURIComponent(
              window.location.pathname + window.location.search,
            )}`,
          );
          return;
        }
        setError(e?.response?.data?.detail || "Could not load your request");
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="max-w-2xl mx-auto px-5 py-16 text-center">
          <Loader2 className="animate-spin mx-auto text-[#2D4A3E]" />
          <p className="mt-3 text-[#6D6A65]">Loading your request...</p>
        </main>
        <Footer />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main className="max-w-2xl mx-auto px-5 py-16 text-center">
          <div className="bg-[#FDF1EF] border border-[#F2C9C0] rounded-2xl p-6 text-[#8B3220]">
            {error}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="mt-6 inline-flex items-center gap-2 text-sm text-[#2D4A3E] underline"
          >
            <ArrowLeft size={14} /> Go back
          </button>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-5 py-12">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-br from-[#FDF7EC] to-[#FDFBF7] border-b border-[#E8DCC1] px-6 py-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#2D4A3E] text-white flex items-center justify-center shrink-0 shadow-sm">
              <FileText size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-[#8B5A1F] font-semibold">
                TheraVoca request &middot; ref {String(requestId).slice(0, 4).toUpperCase()}
              </div>
              <h1 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight mt-0.5">
                Your submitted answers
              </h1>
              <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed">
                If anything looks wrong, reply to your TheraVoca confirmation email and
                we can correct it before matching. Submitted{" "}
                {data?.created_at ? new Date(data.created_at).toLocaleDateString() : "—"}.
              </p>
            </div>
          </div>

          <div className="p-6">
            <Section title="Who you are">
              <Row label="Age" value={data?.client_age || data?.age_group} />
              <Row label="Location" value={[data?.location_city, data?.location_state, data?.location_zip].filter(Boolean).join(", ")} />
              <Row label="Preferred language" value={data?.preferred_language} />
            </Section>

            <Section title="What you're looking for">
              <Row label="Primary concern" value={data?.primary_concern} />
              <Row label="Other concerns" value={joinList(data?.presenting_issues)} />
              <Row label="Other issue (free text)" value={data?.other_issue} multiline />
              <Row label="Urgency" value={data?.urgency} />
            </Section>

            <Section title="Format & approach">
              <Row label="Format" value={data?.format_preference} />
              <Row label="Modality preferences" value={joinList(data?.modality_preferences) || data?.modality_preference} />
              <Row label="Session expectations" value={data?.session_expectations} />
            </Section>

            <Section title="Payment">
              <Row label="Payment type" value={data?.payment_type || data?.payment_method} />
              <Row label="Insurance carrier" value={data?.insurance_carrier} />
              <Row label="Max session fee" value={data?.max_session_fee ? `$${data.max_session_fee}` : null} />
            </Section>

            <Section title="Preferences">
              <Row label="Therapist gender" value={data?.gender_preference} />
              <Row
                label="Top priority factors"
                value={
                  Array.isArray(data?.priority_factors) && data.priority_factors.length
                    ? `${joinList(data.priority_factors)}${data?.strict_priorities ? " (strict)" : ""}`
                    : null
                }
              />
              <Row label="How you heard about us" value={data?.referral_source} />
            </Section>

            {(data?.prior_therapy || data?.prior_therapy_notes) && (
              <Section title="Prior therapy">
                <Row label="Have you tried therapy before?" value={data?.prior_therapy} />
                <Row label="What worked / didn't" value={data?.prior_therapy_notes} multiline />
              </Section>
            )}
          </div>

          <div className="px-6 py-4 bg-[#FDFBF7] border-t border-[#E8E5DF] text-xs text-[#6D6A65]">
            This page is private to you. The link in your email expires after a single
            use; refresh from the magic-link sign-in if you need to view it again.
          </div>
        </div>

        <div className="text-center mt-6">
          <button
            onClick={() => navigate(`/results/${requestId}${t ? `?t=${encodeURIComponent(t)}` : ""}`)}
            className="text-sm text-[#2D4A3E] underline hover:text-[#3A5E50]"
          >
            View my therapist matches &rarr;
          </button>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }) {
  // Render the section only if at least one child has a non-null value.
  const kids = Array.isArray(children) ? children : [children];
  const has = kids.some((c) => c && c.props && c.props.value);
  if (!has) return null;
  return (
    <div className="mb-6 last:mb-0">
      <div className="text-[10px] uppercase tracking-widest text-[#6D6A65] font-semibold mb-2">{title}</div>
      <div className="border border-[#E8E5DF] rounded-xl overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ label, value, multiline }) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5 border-b border-[#E8E5DF] last:border-b-0 text-sm">
      <div className="text-[#6D6A65] text-xs">{label}</div>
      <div className={`text-[#2B2A29] ${multiline ? "whitespace-pre-line" : ""}`}>{value}</div>
    </div>
  );
}

function joinList(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.join(", ");
}
