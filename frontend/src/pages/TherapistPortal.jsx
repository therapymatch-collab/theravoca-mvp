import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ChevronRight,
  LogOut,
  Inbox,
  CheckCircle2,
  Star,
  ThumbsDown,
  AlertTriangle,
  CreditCard,
  Settings,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { Checkbox } from "@/components/ui/checkbox";
import { api, sessionClient, getSession, clearSession } from "@/lib/api";

const AVAILABILITY = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
];
const URGENCY = [
  { v: "asap", l: "ASAP — this week" },
  { v: "within_2_3_weeks", l: "Within 2–3 weeks" },
  { v: "within_month", l: "Within a month" },
  { v: "full", l: "Currently full" },
];

export default function TherapistPortal() {
  const navigate = useNavigate();
  const session = getSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sub, setSub] = useState(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [availDraft, setAvailDraft] = useState({ availability_windows: [], urgency_capacity: "" });

  const loadAll = () => {
    return sessionClient()
      .get("/portal/therapist/referrals")
      .then((res) => {
        setData(res.data);
        setAvailDraft({
          availability_windows: res.data?.therapist?.availability_windows || [],
          urgency_capacity: res.data?.therapist?.urgency_capacity || "",
        });
        const tid = res.data?.therapist?.id;
        if (tid) {
          api
            .get(`/therapists/${tid}/subscription`)
            .then((s) => setSub(s.data))
            .catch(() => {});
        }
        // Auto-open availability dialog if backend says it's pending
        const params = new URLSearchParams(window.location.search);
        if (
          params.get("confirmAvailability") === "1" ||
          res.data?.therapist?.availability_prompt_pending
        ) {
          setAvailabilityOpen(true);
        }
      })
      .catch((e) => {
        if (e?.response?.status === 401) {
          clearSession();
          navigate("/sign-in?role=therapist", { replace: true });
        } else {
          setError(e?.response?.data?.detail || "Could not load referrals");
        }
      });
  };

  useEffect(() => {
    if (!session || session.role !== "therapist") {
      navigate("/sign-in?role=therapist", { replace: true });
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = async () => {
    const tid = data?.therapist?.id;
    if (!tid) return;
    try {
      const res = await api.post(`/therapists/${tid}/subscribe-checkout`, {});
      if (res.data?.demo_mode) {
        toast.info("Demo mode — fast-forwarding card setup");
        const sync = await api.post(`/therapists/${tid}/sync-payment-method`, {
          session_id: `demo_${tid}_${Date.now()}`,
        });
        if (sync.data?.ok) {
          toast.success("Free trial started!");
          const s = await api.get(`/therapists/${tid}/subscription`);
          setSub(s.data);
        }
      } else if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start checkout");
    }
  };

  const openCustomerPortal = async () => {
    const tid = data?.therapist?.id;
    if (!tid) return;
    try {
      const res = await api.post(`/therapists/${tid}/portal-session`, {});
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        toast.error("Could not open billing portal");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Billing portal unavailable");
    }
  };

  const confirmAvailability = async (windows, urgency) => {
    try {
      await sessionClient().post("/portal/therapist/availability-confirm", {
        availability_windows: windows,
        urgency_capacity: urgency,
      });
      toast.success("Availability confirmed — thanks!");
      setAvailabilityOpen(false);
      // Strip ?confirmAvailability=1 from the URL
      window.history.replaceState({}, "", "/portal/therapist");
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save availability");
    }
  };

  const signOut = () => {
    clearSession();
    navigate("/");
  };

  const therapist = data?.therapist;
  const isPending = therapist?.pending_approval;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-portal">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Therapist portal
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                {therapist?.name?.split(",")[0] || "Your"} referrals
              </h1>
              {therapist && (
                <p className="text-sm text-[#6D6A65] mt-2">
                  Signed in as{" "}
                  <span className="text-[#2D4A3E] font-medium">{therapist.email}</span>
                </p>
              )}
            </div>
            <button
              onClick={signOut}
              className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1.5"
              data-testid="therapist-signout"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          {error && (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-8 text-center">
              <p className="text-[#D45D5D]">{error}</p>
            </div>
          )}

          {!error && data === null && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {/* Pending approval — show the submitted profile preview */}
          {isPending && (
            <div
              className="mt-6 bg-[#FDF7EC] border border-[#E8DCC1] rounded-2xl p-6"
              data-testid="pending-approval-banner"
            >
              <div className="flex items-start gap-3">
                <Clock size={18} className="text-[#C87965] mt-1 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[#2B2A29]">
                    Your profile is under review
                  </div>
                  <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                    Our team is verifying your license and credentials. Most therapists are
                    approved within 1 business day. You'll receive an email as soon as you're live —
                    no action needed on your part.
                  </p>
                </div>
              </div>

              {therapist && (
                <div className="mt-5 bg-white border border-[#E8E5DF] rounded-xl p-5">
                  <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
                    Profile we received
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm" data-testid="pending-profile-preview">
                    <PreviewRow label="Name" value={therapist.name} />
                    <PreviewRow label="Credential" value={therapist.credential_type} />
                    <PreviewRow label="License #" value={therapist.license_number} />
                    <PreviewRow label="License expires" value={therapist.license_expires_at?.slice(0, 10)} />
                    <PreviewRow label="Office phone" value={therapist.office_phone} />
                    <PreviewRow label="Alert phone (private)" value={therapist.phone_alert || therapist.phone} />
                    <PreviewRow label="Cash rate" value={therapist.cash_rate ? `$${therapist.cash_rate}` : "—"} />
                    <PreviewRow label="Sliding scale" value={therapist.sliding_scale ? "Yes" : "No"} />
                    <PreviewRow
                      label="Primary specialties"
                      value={(therapist.primary_specialties || []).join(", ") || "—"}
                      span={2}
                    />
                    <PreviewRow
                      label="Modalities"
                      value={(therapist.modalities || []).join(", ") || "—"}
                      span={2}
                    />
                    <PreviewRow
                      label="Availability"
                      value={
                        (therapist.availability_windows || [])
                          .map((w) => w.replace(/_/g, " "))
                          .join(", ") || "—"
                      }
                      span={2}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Availability prompt banner (Mon/Fri) */}
          {therapist?.availability_prompt_pending && !isPending && (
            <div
              className="mt-6 bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap"
              data-testid="availability-prompt-banner"
            >
              <div className="flex items-start gap-3">
                <Clock size={18} className="text-[#2D4A3E] mt-1 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#2B2A29]">
                    Twice-weekly availability check-in
                  </div>
                  <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                    Is your same-week availability still current? A 10-second confirmation
                    keeps you on top of patient match results.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAvailabilityOpen(true)}
                className="tv-btn-primary !py-2 !px-4 text-sm shrink-0"
                data-testid="availability-prompt-btn"
              >
                Review availability
              </button>
            </div>
          )}

          {/* Subscription banner (incomplete / past_due / canceled / unpaid) */}
          {sub && ["incomplete", "past_due", "canceled", "unpaid"].includes(sub.subscription_status) && (
            <div
              className="mt-6 bg-[#FDF7EC] border border-[#E8DCC1] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap"
              data-testid="subscription-banner"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-[#C87965] mt-1 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#2B2A29]">
                    Add a payment method to continue receiving referrals
                  </div>
                  <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                    {sub.subscription_status === "past_due"
                      ? "Your last payment failed. Update your card to resume matching."
                      : sub.subscription_status === "canceled"
                      ? "Your subscription was canceled. Reactivate to continue."
                      : "Your free trial has not started yet — add a card to begin."}
                  </p>
                </div>
              </div>
              <button
                onClick={startCheckout}
                className="tv-btn-primary !py-2 !px-4 text-sm shrink-0"
                data-testid="portal-checkout-btn"
              >
                <CreditCard size={14} className="inline mr-1.5" /> Add payment method
              </button>
            </div>
          )}

          {/* Trial badge + Manage subscription */}
          {sub && (sub.subscription_status === "trialing" || sub.subscription_status === "active") && (
            <div
              className="mt-6 bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl px-5 py-3 text-sm text-[#6D6A65] flex items-center justify-between gap-3 flex-wrap"
              data-testid="subscription-status-bar"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 size={14} className="text-[#2D4A3E]" />
                {sub.subscription_status === "trialing" && sub.trial_ends_at ? (
                  <>
                    Free trial ends{" "}
                    <span className="text-[#2D4A3E] font-medium">
                      {new Date(sub.trial_ends_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    Active subscription
                    {sub.current_period_end && (
                      <>
                        {" "}— next charge{" "}
                        <span className="text-[#2D4A3E] font-medium">
                          {new Date(sub.current_period_end).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
              {sub.stripe_customer_id && (
                <button
                  onClick={openCustomerPortal}
                  className="text-xs text-[#2D4A3E] hover:underline inline-flex items-center gap-1.5 font-medium"
                  data-testid="manage-subscription-btn"
                >
                  <Settings size={13} /> Manage subscription
                </button>
              )}
            </div>
          )}

          {/* License expiration warning */}
          {therapist?.license_expires_at && (() => {
            const exp = new Date(therapist.license_expires_at);
            const days = Math.floor((exp - new Date()) / (1000 * 60 * 60 * 24));
            if (days < 0 || days > 30) return null;
            return (
              <div
                className="mt-6 bg-[#FDEDEB] border border-[#F2C7BD] rounded-2xl p-5 flex items-start gap-3"
                data-testid="license-expiry-banner"
              >
                <AlertTriangle size={18} className="text-[#D45D5D] mt-1 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#2B2A29]">
                    License expires in {days} days
                  </div>
                  <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                    Renew with your state board and upload an updated copy via the admin so
                    referrals don't pause. Expires{" "}
                    {exp.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Empty state for approved therapists */}
          {!isPending && data?.referrals?.length === 0 && (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-3xl p-12 text-center">
              <Inbox className="mx-auto text-[#C87965] mb-4" size={32} strokeWidth={1.5} />
              <h2 className="font-serif-display text-2xl text-[#2D4A3E]">No referrals yet</h2>
              <p className="text-[#6D6A65] mt-2">
                When a patient request matches your profile (60%+), it will appear here and we'll
                send you an email.
              </p>
            </div>
          )}

          {!isPending && data?.referrals?.length > 0 && (
            <div className="mt-10 space-y-4">
              {data.referrals.map((r) => (
                <Link
                  to={`/therapist/apply/${r.request_id}/${therapist.id}`}
                  key={r.request_id}
                  className="block bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 hover:-translate-y-0.5 transition"
                  data-testid={`therapist-referral-${r.request_id}`}
                >
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                          <Star size={10} fill="currentColor" />
                          {Math.round(r.match_score)}% match
                        </span>
                        {r.referral_status === "interested" ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#4A6B5D]/15 text-[#4A6B5D]">
                            <CheckCircle2 size={11} /> interested
                          </span>
                        ) : r.referral_status === "declined" ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#6D6A65]/15 text-[#6D6A65]">
                            <ThumbsDown size={11} /> declined
                          </span>
                        ) : (
                          <span className="inline-flex text-xs px-2.5 py-1 rounded-full bg-[#C87965]/15 text-[#C87965]">
                            new
                          </span>
                        )}
                        <span className="text-xs text-[#6D6A65]">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#2B2A29] mt-3 leading-relaxed line-clamp-2">
                        {r.presenting_issues_preview}
                        {r.presenting_issues_preview?.length === 140 && "…"}
                      </p>
                      <div className="text-xs text-[#6D6A65] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        <span>{r.summary["Age group"]}</span>
                        <span>{r.summary.State}</span>
                        <span>{r.summary["Session format"]}</span>
                        <span>{r.summary.Payment}</span>
                      </div>
                    </div>
                    <ChevronRight className="text-[#6D6A65] mt-1" size={18} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Availability modal */}
      {availabilityOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-6"
          data-testid="availability-modal"
        >
          <div className="bg-white rounded-3xl border border-[#E8E5DF] max-w-lg w-full p-6 sm:p-8">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Confirm your availability
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1.5">
              We re-check every Monday and Friday so patients only see therapists with
              real same-week openings.
            </p>

            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                When you're available
              </div>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY.map((a) => {
                  const active = availDraft.availability_windows.includes(a.v);
                  return (
                    <button
                      key={a.v}
                      type="button"
                      onClick={() =>
                        setAvailDraft((d) => ({
                          ...d,
                          availability_windows: active
                            ? d.availability_windows.filter((x) => x !== a.v)
                            : [...d.availability_windows, a.v],
                        }))
                      }
                      data-testid={`availability-pill-${a.v}`}
                      className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                        active
                          ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                          : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                      }`}
                    >
                      {a.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                Current caseload
              </div>
              <div className="flex flex-wrap gap-2">
                {URGENCY.map((u) => {
                  const active = availDraft.urgency_capacity === u.v;
                  return (
                    <button
                      key={u.v}
                      type="button"
                      onClick={() => setAvailDraft((d) => ({ ...d, urgency_capacity: u.v }))}
                      data-testid={`urgency-pill-${u.v}`}
                      className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                        active
                          ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                          : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                      }`}
                    >
                      {u.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="tv-btn-secondary !py-2 !px-4 text-sm"
                onClick={() =>
                  confirmAvailability(
                    therapist?.availability_windows || [],
                    therapist?.urgency_capacity || "",
                  )
                }
                data-testid="availability-confirm-as-is"
              >
                Yes, still current
              </button>
              <button
                type="button"
                className="tv-btn-primary !py-2 !px-4 text-sm"
                onClick={() =>
                  confirmAvailability(
                    availDraft.availability_windows,
                    availDraft.urgency_capacity,
                  )
                }
                data-testid="availability-save"
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}

function PreviewRow({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? "sm:col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-medium text-[#2B2A29]">{value || "—"}</div>
    </div>
  );
}

// Silence unused-import warnings on Checkbox (kept for future inline toggles)
void Checkbox;
