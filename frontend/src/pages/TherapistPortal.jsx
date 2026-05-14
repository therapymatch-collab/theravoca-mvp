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
  Sparkles,
  TrendingUp,
  Calendar,
  AlertCircle,
  Zap,
  ShieldCheck,
  ShieldOff,
  ClipboardList,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Header, Footer } from "@/components/SiteShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { api, sessionClient, getSession, clearSession } from "@/lib/api";
import credentialLabel from "@/lib/credentialLabel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// ─── Deep-match missing helper (Iter-90) ──────────────────────────
// Returns the list of human labels for missing deep-match T-fields.
// Hoisted out of DeepMatchBackfillBanner so PortalActionChips can
// reuse the same trigger logic without duplicating the field checks.
function _deepMatchMissingLabels(therapist) {
  if (!therapist) return [];
  const missing = [];
  if (!therapist.t6_session_expectations || therapist.t6_session_expectations.length < 1)
    missing.push("what sessions 1-3 look like with you");
  if ((therapist.t6_early_sessions_description || "").trim().length < 30)
    missing.push("a description of your early sessions");
  if (!therapist.t4_hard_truth)
    missing.push("how you push past comfort zones");
  if ((therapist.t5_lived_experience || "").trim().length < 30)
    missing.push("life experience you understand from the inside");
  return missing;
}

// ─── Portal action chips (Combo-2 reorg, 2026-05-14) ──────────────
// Collapses what used to be 5+ full-width banners (DeepMatchBackfill,
// AddPaymentMethod, NoSubscription, ProfileCompletionMeter, SetPassword)
// into a single compact row of color-coded chips that vanishes entirely
// when there's nothing to act on -- so a fully-set-up therapist sees a
// clean page with just account/security chips + their referrals.
//
// Each chip routes to the same destination the banner CTA used to, so
// the underlying flows are unchanged.
function PortalActionChips({ therapist, sub, onStartCheckout }) {
  const chips = [];
  const completeness = therapist?.completeness;

  // Profile incomplete -- urgent / red. Tooltip lists the missing labels
  // so the therapist gets a hint without the old full-width meter card.
  if (completeness && completeness.publishable === false) {
    const missing = completeness.required_missing || [];
    const labels = missing.map((m) => m.label).slice(0, 6).join(", ");
    chips.push({
      key: "profile",
      kind: "urgent",
      label: "Profile incomplete",
      badge: missing.length ? `${missing.length} missing` : null,
      title: labels
        ? `Missing: ${labels}${missing.length > 6 ? ", ..." : ""}`
        : "Required fields missing",
      to: "/portal/therapist/edit",
    });
  }

  // Add payment method -- urgent / red. Two subcases:
  //   1. No Stripe subscription at all -> "Start free trial"
  //   2. Existing subscription in a bad state -> "Update billing"
  if (therapist) {
    const subStatus = sub?.subscription_status;
    if (!sub) {
      chips.push({
        key: "billing",
        kind: "urgent",
        label: "Start free trial",
        title: "Add a payment method to start your 30-day free trial",
        onClick: onStartCheckout,
      });
    } else if (["incomplete", "past_due", "canceled", "unpaid"].includes(subStatus)) {
      chips.push({
        key: "billing",
        kind: "urgent",
        label: "Update billing",
        badge: subStatus.replace(/_/g, " "),
        title:
          subStatus === "past_due"
            ? "Your last payment failed -- update your card to resume matching"
            : subStatus === "canceled"
            ? "Subscription canceled -- reactivate to continue"
            : "Subscription needs attention",
        onClick: onStartCheckout,
      });
    }
  }

  // Set password -- todo / amber. Only shown for magic-code-only users
  // who never set a fallback password.
  if (therapist && !therapist.has_password) {
    chips.push({
      key: "password",
      kind: "todo",
      label: "Set password",
      title: "Optional -- adds a password fallback for magic-code-only accounts",
      to: "/portal/therapist/security",
    });
  }

  // Deep-match questions -- todo / amber. Same trigger as the old
  // DeepMatchBackfillBanner; respects the per-session dismissal so a
  // therapist who clicked "Remind me later" doesn't see it bounce back.
  const deepMissing = _deepMatchMissingLabels(therapist);
  const deepDismissed =
    typeof window !== "undefined" &&
    !!window.sessionStorage.getItem("tv_deep_backfill_dismissed");
  if (deepMissing.length > 0 && !deepDismissed) {
    chips.push({
      key: "deepmatch",
      kind: "todo",
      label: "Deep-match questions",
      badge: `${deepMissing.length} left`,
      title: `5 quick questions unlock deep-match scoring. Missing: ${deepMissing.join(", ")}.`,
      to: "/portal/therapist/edit#deep-match",
    });
  }

  // Per Combo-2 spec: the entire row collapses when there's nothing todo.
  if (chips.length === 0) return null;

  const kindClass = (k) =>
    k === "urgent"
      ? "bg-[#FDF1EF] border-[#E8C4BB] text-[#8B3220] hover:bg-[#FBE6E1]"
      : "bg-[#FCF6E5] border-[#E8D7A6] text-[#6D5A29] hover:bg-[#F8EFD2]";

  const badgeClass = (k) =>
    k === "urgent"
      ? "bg-[#8B3220]/15 text-[#8B3220]"
      : "bg-[#6D5A29]/15 text-[#6D5A29]";

  return (
    <div
      className="mt-2 flex items-center gap-2 flex-wrap"
      data-testid="portal-action-chips"
    >
      {chips.map((c) => {
        const inner = (
          <>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                c.kind === "urgent" ? "bg-[#8B3220]" : "bg-[#C8A23E]"
              }`}
            />
            {c.label}
            {c.badge && (
              <span
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold ${badgeClass(c.kind)}`}
              >
                {c.badge}
              </span>
            )}
          </>
        );
        const className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition ${kindClass(c.kind)}`;
        const testid = `portal-chip-${c.key}`;
        if (c.onClick) {
          return (
            <button
              key={c.key}
              type="button"
              onClick={c.onClick}
              className={className}
              title={c.title}
              data-testid={testid}
            >
              {inner}
            </button>
          );
        }
        return (
          <Link
            key={c.key}
            to={c.to}
            className={className}
            title={c.title}
            data-testid={testid}
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

export default function TherapistPortal() {
  const navigate = useNavigate();
  const session = getSession();
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [sub, setSub] = useState(null);
  // 2FA status drives the Security chip color (red/off vs green/on).
  // Null = not yet loaded; chip renders neutral until the fetch lands.
  const [twoFaEnabled, setTwoFaEnabled] = useState(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [availDraft, setAvailDraft] = useState({ availability_windows: [], urgency_capacity: "" });
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulkAvail, setBulkAvail] = useState(false);
  const [bulkUrgency, setBulkUrgency] = useState(false);
  const [bulkPayment, setBulkPayment] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // WS3: tab state (Active / Applied / Past)
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "active";
    return window.sessionStorage.getItem("tv_referral_tab") || "active";
  });
  const changeTab = (t) => {
    setActiveTab(t);
    window.sessionStorage.setItem("tv_referral_tab", t);
  };
  // WS2: filter pill state (all / deep / quick)
  const [signalFilter, setSignalFilter] = useState(() => {
    if (typeof window === "undefined") return "all";
    return window.sessionStorage.getItem("tv_referral_filter") || "all";
  });
  const changeSignalFilter = (f) => {
    setSignalFilter(f);
    window.sessionStorage.setItem("tv_referral_filter", f);
  };

  const toggleSelect = (rid) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

  const submitBulk = async () => {
    if (!bulkAvail || !bulkUrgency || !bulkPayment) {
      toast.error("Please confirm all three commitments before bulk-applying.");
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await sessionClient().post("/portal/therapist/bulk-apply", {
        request_ids: Array.from(selected),
        message: bulkMsg,
        confirms_availability: bulkAvail,
        confirms_urgency: bulkUrgency,
        confirms_payment: bulkPayment,
      });
      toast.success(`Submitted interest on ${res.data?.succeeded || 0} referrals.`);
      setBulkOpen(false);
      setSelected(new Set());
      setBulkMsg("");
      setBulkAvail(false);
      setBulkUrgency(false);
      setBulkPayment(false);
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk apply failed.");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const loadAll = () => {
    sessionClient()
      .get("/portal/therapist/analytics")
      .then((r) => setAnalytics(r.data))
      .catch(() => {});
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
    // Side-fetch the 2FA status so the chip renders the right color
    // without having to wait for the user to navigate into the page.
    sessionClient()
      .get("/portal/therapist/2fa/status")
      .then((r) => setTwoFaEnabled(!!r.data?.enabled))
      .catch(() => setTwoFaEnabled(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = async () => {
    const tid = data?.therapist?.id;
    if (!tid) return;
    try {
      const res = await api.post(`/therapists/${tid}/subscribe-checkout`, {});
      if (res.data?.url) {
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
      <Header />
      <main className="flex-1 px-5 py-8 md:py-10" data-testid="therapist-portal">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Therapist portal
              </p>
              <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] mt-1.5 leading-tight">
                {therapist?.name?.split(",")[0] || "Your"} referrals
              </h1>
              {therapist && (
                <p className="text-xs text-[#6D6A65] mt-1.5 break-words">
                  {therapist.credential_type && (
                    <>
                      <span className="text-[#2B2A29] font-medium">
                        {credentialLabel(therapist.credential_type)}
                      </span>
                      {(therapist.years_experience != null ||
                        (therapist.modalities || []).length > 0) && " · "}
                    </>
                  )}
                  {therapist.years_experience != null && (
                    <>
                      {therapist.years_experience} year
                      {therapist.years_experience === 1 ? "" : "s"} experience
                      {(therapist.modalities || []).length > 0 && " • "}
                    </>
                  )}
                  {(therapist.modalities || []).slice(0, 3).join(" · ")}
                </p>
              )}
              {therapist && (
                <p className="text-xs text-[#6D6A65] mt-1">
                  Signed in as{" "}
                  <span className="text-[#2D4A3E] font-medium">{therapist.email}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {/* Compact subscription pill — replaces the old full-width
                  status bar. Only shown when sub is healthy (trialing /
                  active); the dunning banner still appears further down
                  when payment is required. */}
              {sub && (sub.subscription_status === "trialing" || sub.subscription_status === "active") && (
                <button
                  type="button"
                  onClick={sub.stripe_customer_id ? openCustomerPortal : undefined}
                  disabled={!sub.stripe_customer_id}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#F2F7F1] border border-[#D2E2D0] text-[#3F6F4A] hover:bg-[#E6EFE3] transition disabled:cursor-default"
                  data-testid="subscription-status-pill"
                  title={
                    sub.subscription_status === "trialing" && sub.trial_ends_at
                      ? `Free trial ends ${new Date(sub.trial_ends_at).toLocaleDateString()}`
                      : sub.current_period_end
                      ? `Next charge ${new Date(sub.current_period_end).toLocaleDateString()}`
                      : "Manage subscription"
                  }
                >
                  <CheckCircle2 size={12} strokeWidth={2.2} />
                  {sub.subscription_status === "trialing" ? "Trial active" : "Subscription active"}
                </button>
              )}
              <Link
                to="/portal/therapist/edit"
                className="text-sm text-[#2D4A3E] hover:underline inline-flex items-center gap-1.5"
                data-testid="therapist-edit-profile-link"
              >
                <Settings size={14} /> Edit profile
              </Link>
            </div>
          </div>

          {/* Account + security chips. Visible on every render of the
              therapist portal so they're discoverable without burying
              at the page bottom. The Security chip flips between
              red-tinged "OFF" and calm "ON" so therapists notice when
              they haven't enrolled yet. */}
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <Link
              to="/portal/therapist/security"
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition ${
                twoFaEnabled === true
                  ? "bg-[#F2F7F1] border-[#D2E2D0] text-[#3F6F4A] hover:bg-[#E6EFE3]"
                  : twoFaEnabled === false
                  ? "bg-[#FDF1EF] border-[#E8C4BB] text-[#8B3220] hover:bg-[#FBE6E1]"
                  : "bg-[#FDFBF7] border-[#E8E5DF] text-[#6D6A65]"
              }`}
              data-testid="therapist-2fa-chip"
              title={
                twoFaEnabled === true
                  ? "Two-factor authentication is on"
                  : twoFaEnabled === false
                  ? "Two-factor authentication is OFF -- recommended for therapist accounts"
                  : "Two-factor authentication"
              }
            >
              {twoFaEnabled === true
                ? <ShieldCheck size={13} strokeWidth={2.2} />
                : <ShieldOff size={13} strokeWidth={2.2} />}
              Security &amp; 2FA
              {twoFaEnabled === true && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#3F6F4A]/15 text-[#3F6F4A]">
                  ON
                </span>
              )}
              {twoFaEnabled === false && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#8B3220]/15 text-[#8B3220]">
                  OFF
                </span>
              )}
            </Link>
            <Link
              to="/portal/therapist/login-history"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E8E5DF] bg-[#FDFBF7] text-xs font-medium text-[#2D4A3E] hover:bg-[#E8E5DF] transition"
              data-testid="therapist-login-history-chip"
              title="See your recent sign-ins"
            >
              <ClipboardList size={13} strokeWidth={2.2} />
              Sign-in history
            </Link>
            {therapist?.referral_code && !isPending && (
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/therapists/join?ref=${therapist.referral_code}`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast.success("Invite link copied!");
                  }).catch(() => toast.error("Couldn't copy link"));
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E8E5DF] bg-[#FDFBF7] text-xs font-medium text-[#2D4A3E] hover:bg-[#E8E5DF] transition"
                data-testid="refer-colleague-chip"
                title="Copy your referral invite link -- colleagues skip the waitlist on first matches"
              >
                <Sparkles size={13} className="text-[#C87965]" />
                Refer a colleague
              </button>
            )}
          </div>

          {/* Action chips: only renders when there's at least one urgent
              or todo item (Profile incomplete / Add payment / Set
              password / Deep-match questions). Vanishes entirely once
              the therapist is fully set up so the page is uncluttered
              for live accounts. Replaces 5 separate full-width banners
              + the ProfileCompletionMeter card. */}
          {therapist && !isPending && (
            <PortalActionChips
              therapist={therapist}
              sub={sub}
              onStartCheckout={startCheckout}
            />
          )}

          {error && (
            <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-6 text-center">
              <p className="text-[#D45D5D]">{error}</p>
            </div>
          )}

          {!error && data === null && (
            <div className="flex justify-center py-16">
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
                    Weekly availability check-in
                  </div>
                  <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
                    Is your availability still current? A 10-second Monday morning
                    confirmation keeps you on top of patient match results.
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

          {/* KPI strip — Option C: 4 most important numbers at the top
              so the therapist sees their performance at a glance before
              triaging the list. Empty/loading-state safe (analytics may
              not be loaded yet). Lives BEFORE profile-health on purpose
              so the page leads with stats, not nags. */}
          {therapist && !isPending && (
            <KpiStrip
              analytics={analytics}
              referrals={data?.referrals || []}
              sub={sub}
            />
          )}

          {/* Empty state for approved therapists -- state-aware hero
              that reflects ACTUAL readiness (profile complete + admin-
              approved + subscription healthy). The old version always
              said "PROFILE LIVE" even when the therapist hadn't started
              their trial -- contradicting the trial banner above and
              misleading the user. */}
          {!isPending && data?.referrals?.length === 0 && (
            <HeroState
              completeness={therapist?.completeness}
              sub={sub}
            />
          )}

          {!isPending && data?.referrals?.length > 0 && (() => {
            // WS2 + WS3: apply tab + signal filters
            const allReferrals = data.referrals;
            const tabbed = allReferrals.filter((r) => (r.state || "active") === activeTab);
            const filtered = signalFilter === "all"
              ? tabbed
              : signalFilter === "deep"
              ? tabbed.filter((r) => r.deep_match_opt_in)
              : tabbed.filter((r) => !r.deep_match_opt_in);
            const tabCounts = {
              active: allReferrals.filter((r) => (r.state || "active") === "active").length,
              applied: allReferrals.filter((r) => r.state === "applied").length,
              past: allReferrals.filter((r) => r.state === "past").length,
            };
            return (
            <div className="mt-6">
              {/* WS3: Lifecycle tabs */}
              <div className="flex gap-1 bg-[#F1EFE8] rounded-xl p-1 mb-3" data-testid="referral-tabs">
                {[
                  { k: "active", l: "Active" },
                  { k: "applied", l: "Applied" },
                  { k: "past", l: "Past" },
                ].map((tab) => (
                  <button
                    key={tab.k}
                    onClick={() => changeTab(tab.k)}
                    className={`flex-1 text-sm font-medium px-3 py-1.5 rounded-lg transition ${
                      activeTab === tab.k
                        ? "bg-white text-[#2D4A3E] shadow-sm"
                        : "text-[#6D6A65] hover:text-[#2B2A29]"
                    }`}
                    data-testid={`tab-${tab.k}`}
                  >
                    {tab.l}
                    {tabCounts[tab.k] > 0 && (
                      <span className={`ml-1.5 text-xs ${
                        activeTab === tab.k ? "text-[#C87965]" : "text-[#A4A29E]"
                      }`}>
                        {tabCounts[tab.k]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* WS2: Deep / Quick signal filter pills */}
              <div className="flex gap-2 mb-4" data-testid="signal-filter-pills">
                {[
                  { k: "all", l: "All" },
                  { k: "deep", l: "⚡ Deep responses", icon: null },
                  { k: "quick", l: "⏱ Quick intake", icon: null },
                ].map((pill) => (
                  <button
                    key={pill.k}
                    onClick={() => changeSignalFilter(pill.k)}
                    className={`text-xs font-medium px-3 py-1 rounded-full border transition ${
                      signalFilter === pill.k
                        ? pill.k === "deep"
                          ? "bg-[#EEEDFE] border-[#EEEDFE] text-[#3C3489]"
                          : pill.k === "quick"
                          ? "bg-[#F1EFE8] border-[#F1EFE8] text-[#444441]"
                          : "bg-[#2D4A3E] border-[#2D4A3E] text-white"
                        : "bg-white border-[#E8E5DF] text-[#6D6A65] hover:border-[#2D4A3E]"
                    }`}
                    data-testid={`filter-${pill.k}`}
                  >
                    {pill.l}
                  </button>
                ))}
              </div>

              {/* Bulk action bar -- only shown when >=1 selected */}
              {selected.size > 0 && (
                <div
                  className="sticky top-2 z-10 mb-4 bg-[#2D4A3E] text-white rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap shadow-lg"
                  data-testid="bulk-action-bar"
                >
                  <div className="text-sm">
                    <strong>{selected.size}</strong> referral{selected.size > 1 ? "s" : ""}{" "}
                    selected
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-xs text-white/70 hover:text-white"
                      data-testid="bulk-clear"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setBulkOpen(true)}
                      className="bg-white text-[#2D4A3E] rounded-full px-4 py-1.5 text-sm font-semibold hover:bg-[#FDFBF7] transition"
                      data-testid="bulk-confirm-open"
                    >
                      Confirm interest on all {selected.size}
                    </button>
                  </div>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="bg-white border border-[#E8E5DF] rounded-2xl p-8 text-center">
                  <p className="text-sm text-[#6D6A65]">
                    {signalFilter !== "all"
                      ? `No ${signalFilter === "deep" ? "deep match" : "quick intake"} referrals in this tab.`
                      : activeTab === "active"
                      ? "No active referrals right now."
                      : activeTab === "applied"
                      ? "You haven't applied to any referrals yet."
                      : "No past referrals."}
                  </p>
                </div>
              ) : (
              <div className="space-y-4">
                <TooltipProvider delayDuration={200}>
                {filtered.map((r) => {
                  const isSelected = selected.has(r.request_id);
                  const canBulk = r.referral_status === "pending" && r.state === "active";
                  return (
                    <div
                      key={r.request_id}
                      className={`bg-white border rounded-2xl p-5 sm:p-6 transition ${
                        isSelected
                          ? "border-[#2D4A3E] ring-2 ring-[#2D4A3E]/20"
                          : "border-[#E8E5DF] hover:-translate-y-0.5"
                      }`}
                      data-testid={`therapist-referral-${r.request_id}`}
                    >
                      <div className="flex items-start gap-3">
                        {canBulk && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(r.request_id)}
                            className="mt-1 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E] shrink-0"
                            data-testid={`select-${r.request_id}`}
                          />
                        )}
                        <Link
                          to={`/therapist/apply/${r.request_id}/${therapist.id}`}
                          className="flex-1 min-w-0"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* WS4: score tooltip */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-xs font-semibold px-2.5 py-1 rounded-full cursor-help">
                                  <Star size={10} fill="currentColor" />
                                  {Math.round(r.match_score)}% match
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                className="bg-[#2B2A29] text-white border-none p-3 max-w-[220px]"
                              >
                                <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1.5">
                                  Score breakdown
                                </div>
                                {Object.entries(r.match_breakdown || {}).length > 0 ? (
                                  <div className="space-y-0.5">
                                    {Object.entries(r.match_breakdown)
                                      .sort(([, a], [, b]) => b - a)
                                      .map(([axis, pts]) => (
                                        <div key={axis} className="flex justify-between gap-3 text-[11px]">
                                          <span className="text-white/80 capitalize truncate">
                                            {axis.replace(/_/g, " ")}
                                          </span>
                                          <span className="font-mono tabular-nums shrink-0">
                                            {pts > 0 ? "+" : ""}{Math.round(pts)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-white/60 italic">
                                    Breakdown not available
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                            {/* WS1: Deep / Quick badge */}
                            {r.deep_match_opt_in ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EEEDFE] text-[#3C3489]">
                                <Sparkles size={10} /> Deep
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F1EFE8] text-[#444441]">
                                <Zap size={10} /> Quick
                              </span>
                            )}
                            {/* Status badge */}
                            {r.referral_status === "interested" ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#4A6B5D]/15 text-[#4A6B5D]">
                                <CheckCircle2 size={11} /> interested
                              </span>
                            ) : r.referral_status === "declined" ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#6D6A65]/15 text-[#6D6A65]">
                                <ThumbsDown size={11} /> declined
                              </span>
                            ) : r.state === "past" ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#6D6A65]/10 text-[#A4A29E]">
                                <Clock size={11} /> expired
                              </span>
                            ) : (
                              <span className="inline-flex text-xs px-2.5 py-1 rounded-full bg-[#C87965]/15 text-[#C87965]">
                                new
                              </span>
                            )}
                            <span className="text-xs text-[#6D6A65]">
                              {new Date(r.matched_at || r.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[#2B2A29] mt-3 leading-relaxed line-clamp-2">
                            {r.presenting_issues_preview}
                            {r.presenting_issues_preview?.length === 140 && "…"}
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-3" data-testid={`referral-tags-${r.request_id}`}>
                            {r.summary["Age group"] && <ReferralTag>{r.summary["Age group"]}</ReferralTag>}
                            {r.summary.State && <ReferralTag>{r.summary.State}</ReferralTag>}
                            {r.summary["Session format"] && <ReferralTag>{r.summary["Session format"]}</ReferralTag>}
                            {r.summary.Payment && <ReferralTag>{r.summary.Payment}</ReferralTag>}
                          </div>
                          {/* Bug B: gaps fallback -- hide at 95%+ (cap), show
                              fallback copy when gaps=[] but score < 95% */}
                          {r.referral_status === "pending" && Math.round(r.match_score) < 95 && (
                            <div className="mt-3 text-xs text-[#6D6A65]">
                              {r.gaps && r.gaps.length > 0 ? (
                                <>
                                  <div className="font-semibold text-[#C87965] uppercase tracking-wider text-[10px] mb-1">
                                    Address in reply
                                  </div>
                                  <ul className="space-y-1">
                                    {r.gaps.map((g) => (
                                      <li key={g.key} className="leading-snug">
                                        <span className="font-medium text-[#2B2A29]">{g.label}:</span>{" "}
                                        {g.explanation}
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              ) : (
                                <p className="leading-relaxed" data-testid="gaps-fallback">
                                  Strong match across scored dimensions. Speak to
                                  your overall fit and approach in your reply.
                                </p>
                              )}
                            </div>
                          )}
                        </Link>
                        <ChevronRight className="text-[#6D6A65] mt-1 shrink-0" size={18} />
                      </div>
                    </div>
                  );
                })}
                </TooltipProvider>
              </div>
              )}
            </div>
            );
          })()}

          {/* ─── Secondary content (below referrals) ───────────────────
              Lower priority than the referrals list; collected at the
              bottom so the page leads with what we want the therapist
              to act on first. */}

          {/* Analytics — useful but not blocking action; show below
              referrals so the primary task isn't pushed off-screen. */}
          {analytics && !error && (
            <PortalAnalyticsCard analytics={analytics} />
          )}

          {/* Profile health (red-flag callouts) — moved BELOW referrals
              per iter-74 design. They're nags, not the primary action;
              putting them at the top dominated screen real estate. */}
          {therapist && !isPending && (
            <ProfileHealthCallouts therapist={therapist} />
          )}

        </div>
      </main>

      {/* Bulk-confirm modal */}
      {bulkOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
          data-testid="bulk-modal"
        >
          <div className="bg-white rounded-3xl border border-[#E8E5DF] max-w-lg w-full p-6 sm:p-8">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              Confirm interest on {selected.size} referral{selected.size > 1 ? "s" : ""}
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed">
              Same message + commitments will be applied to all selected referrals.
              Patients only see therapists who confirmed they can actually take them.
            </p>
            <Textarea
              rows={4}
              value={bulkMsg}
              onChange={(e) => setBulkMsg(e.target.value)}
              placeholder="Optional intro that goes to all selected patients."
              className="mt-4 bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="bulk-message"
            />
            <div className="mt-4 space-y-2">
              {[
                { k: "avail", state: bulkAvail, setter: setBulkAvail, label: "I can see them this week", testid: "bulk-confirm-availability" },
                { k: "urgency", state: bulkUrgency, setter: setBulkUrgency, label: "I match their urgency", testid: "bulk-confirm-urgency" },
                { k: "pay", state: bulkPayment, setter: setBulkPayment, label: "I accept their payment method", testid: "bulk-confirm-payment" },
              ].map((row) => (
                <label
                  key={row.k}
                  className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
                    row.state ? "bg-[#F2F4F0] border-[#2D4A3E]" : "bg-[#FDFBF7] border-[#E8E5DF] hover:border-[#2D4A3E]"
                  }`}
                >
                  <Checkbox
                    checked={row.state}
                    onCheckedChange={(v) => row.setter(!!v)}
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                    data-testid={row.testid}
                  />
                  <span className="text-sm font-medium text-[#2B2A29]">{row.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="tv-btn-secondary !py-2 !px-4 text-sm"
                onClick={() => setBulkOpen(false)}
                data-testid="bulk-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkSubmitting || !bulkAvail || !bulkUrgency || !bulkPayment}
                onClick={submitBulk}
                className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="bulk-submit"
              >
                {bulkSubmitting ? "Submitting..." : `Confirm all ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

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

/**
 * Consolidated profile-health callouts for the therapist portal.
 * Surfaces actionable issues so therapists can fix them in one click:
 *  - Expired license (critical, blocks referrals)
 *  - License expiring within 30 days (warning)
 *  - Pending re-approval after a self-edit (info)
 *  - Stale profile (no edits in 90+ days)
 *  - Missing bio
 *  - Missing profile picture
 * Renders nothing when the profile is healthy.
 */
function ProfileHealthCallouts({ therapist }) {
  const flags = [];

  // 1. License status
  if (therapist?.license_expires_at) {
    const exp = new Date(therapist.license_expires_at);
    const days = Math.floor((exp - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0) {
      flags.push({
        key: "license-expired",
        severity: "critical",
        title: `License expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`,
        body: `Referrals are paused until you upload an active license. Expired ${exp.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`,
        cta: { label: "Update license", to: "/portal/therapist/edit", testid: "fix-license-expired" },
      });
    } else if (days <= 30) {
      flags.push({
        key: "license-expiring",
        severity: "warning",
        title: `License expires in ${days} day${days === 1 ? "" : "s"}`,
        body: `Renew with your state board and upload an updated copy so referrals don't pause. Expires ${exp.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`,
        cta: { label: "Update license", to: "/portal/therapist/edit", testid: "fix-license-expiring" },
      });
    }
  }

  // 2. Pending re-approval after a self-edit
  if (therapist?.pending_reapproval) {
    const fields = (therapist.pending_reapproval_fields || [])
      .map((f) => f.replace(/_/g, " "))
      .join(", ");
    flags.push({
      key: "pending-reapproval",
      severity: "info",
      title: "Recent edits awaiting admin review",
      body: fields
        ? `You changed ${fields}. Patients will see the previous values until an admin re-approves (usually within 1 business day).`
        : "Some of your recent edits need admin re-approval before they go live.",
    });
  }

  // 3. Stale profile (>90 days since last update)
  const lastTouched = therapist?.updated_at || therapist?.last_availability_update_at;
  if (lastTouched) {
    const days = Math.floor((new Date() - new Date(lastTouched)) / (1000 * 60 * 60 * 24));
    if (days >= 90) {
      flags.push({
        key: "stale-profile",
        severity: "warning",
        title: `Your profile hasn't been updated in ${days} days`,
        body: "Profiles updated in the last 90 days rank higher in match results. Quickly review your specialties, fees, and availability.",
        cta: { label: "Refresh profile", to: "/portal/therapist/edit", testid: "fix-stale-profile" },
      });
    }
  }

  // 4. Missing bio
  if (!therapist?.bio || (therapist.bio || "").trim().length < 40) {
    flags.push({
      key: "missing-bio",
      severity: "warning",
      title: "Your bio is missing or too short",
      body: "Patients are 3x more likely to choose therapists with a personal 2–4 sentence bio. Add yours so they can see your voice.",
      cta: { label: "Add a bio", to: "/portal/therapist/edit", testid: "fix-missing-bio" },
    });
  }

  // 5. Missing profile picture
  if (!therapist?.profile_picture) {
    flags.push({
      key: "missing-photo",
      severity: "warning",
      title: "No profile photo uploaded",
      body: "Profiles with a photo get clicked through significantly more than those without. Upload a friendly headshot.",
      cta: { label: "Upload photo", to: "/portal/therapist/edit", testid: "fix-missing-photo" },
    });
  }

  // Suppress license-expiring/expired flags here because the existing
  // subscription banner already covers payment, and we don't want noise.
  if (flags.length === 0) return null;

  // Compute the most severe color band so the panel header reads correctly.
  const hasCritical = flags.some((f) => f.severity === "critical");
  const hasWarning = flags.some((f) => f.severity === "warning");
  const headerHue = hasCritical
    ? { bg: "bg-[#FDEDEB]", border: "border-[#F2C7BD]", text: "text-[#D45D5D]", label: "Action required" }
    : hasWarning
    ? { bg: "bg-[#FDF7EC]", border: "border-[#E8DCC1]", text: "text-[#C87965]", label: "Profile improvements" }
    : { bg: "bg-[#F2F4F0]", border: "border-[#D9DDD2]", text: "text-[#2D4A3E]", label: "Just FYI" };

  // Collapsed by default unless there are critical issues — these
  // callouts are nags, not the primary action. They sit BELOW the
  // referrals list now (per iter-74) so the page leads with the
  // therapist's actual workload.
  return <ProfileHealthAccordion flags={flags} headerHue={headerHue} hasCritical={hasCritical} />;
}

function ProfileHealthAccordion({ flags, headerHue, hasCritical }) {
  const [open, setOpen] = useState(hasCritical);
  return (
    <section
      className={`mt-6 ${headerHue.bg} border ${headerHue.border} rounded-2xl overflow-hidden`}
      data-testid="profile-health-callouts"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-black/[0.02] transition text-left"
        data-testid="profile-health-toggle"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className={headerHue.text} />
          <div className={`text-xs uppercase tracking-wider font-semibold ${headerHue.text}`}>
            {headerHue.label}
          </div>
          <span className="text-xs text-[#6D6A65]">
            · {flags.length} item{flags.length === 1 ? "" : "s"}
          </span>
        </div>
        <ChevronRight
          size={14}
          className={`text-[#6D6A65] transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <ul className="px-4 pb-4 space-y-2">
          {flags.map((f) => {
            const sev =
              f.severity === "critical"
                ? { dot: "bg-[#D45D5D]", title: "text-[#D45D5D]" }
                : f.severity === "warning"
                ? { dot: "bg-[#C87965]", title: "text-[#2B2A29]" }
                : { dot: "bg-[#2D4A3E]", title: "text-[#2B2A29]" };
            return (
              <li
                key={f.key}
                className="bg-white/70 backdrop-blur-sm border border-white rounded-xl p-3 flex items-start gap-3"
                data-testid={`flag-${f.key}`}
              >
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${sev.title}`}>{f.title}</div>
                  <p className="text-xs text-[#6D6A65] mt-0.5 leading-relaxed">{f.body}</p>
                </div>
                {f.cta && (
                  <Link
                    to={f.cta.to}
                    className="tv-btn-secondary !py-1 !px-2.5 text-[11px] shrink-0 self-center"
                    data-testid={f.cta.testid}
                  >
                    {f.cta.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PortalAnalyticsCard({ analytics }) {
  const a = analytics;
  const topics = Object.entries(a.top_referral_topics || {}).slice(0, 5);
  // The 4 headline KPIs (Match avg, Apply rate, Total received, etc.)
  // now live in the top-of-page <KpiStrip />. This card is repurposed
  // as a smaller "Insights" block — only the qualitative bits worth a
  // second look (top topics, refer-code redemptions). If there's
  // nothing qualitative to show, render nothing so we don't waste a
  // row of vertical space.
  const hasInsights = topics.length > 0;
  if (!hasInsights) return null;
  return (
    <section
      className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-5"
      data-testid="portal-analytics-card"
    >
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-serif-display text-lg text-[#2D4A3E]">Insights</h2>
        <span className="text-xs text-[#6D6A65]">All-time</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {topics.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-2">
              Top patient concerns you've matched on
            </div>
            <ul className="space-y-1">
              {topics.map(([t, n]) => (
                <li key={t} className="flex items-center justify-between text-sm">
                  <span className="text-[#2B2A29] capitalize">{t.replace(/_/g, " ")}</span>
                  <span className="text-[#6D6A65] tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {a.referral_code && (
        <div className="mt-5 border-t border-[#E8E5DF] pt-4 text-xs text-[#6D6A65]">
          Refer-a-colleague code:{" "}
          <span className="font-mono text-[#2D4A3E] bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5">
            {a.referral_code}
          </span>
          {" — "}
          {a.referrals_made > 0
            ? `${a.referrals_made} colleague${a.referrals_made === 1 ? "" : "s"} have signed up using your code.`
            : "no signups via your code yet."}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hue }) {
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div
        className="font-serif-display text-2xl mt-1"
        style={{ color: hue || "#2D4A3E" }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}


// ─── Option C — top-of-page KPI strip ────────────────────────────────
//
// State-aware "you have no referrals yet" hero. The OLD version always
// said "PROFILE LIVE" / "Patients can find you now" even when the
// therapist's subscription was incomplete -- contradicting the
// trial-not-started banner above and lying to the user. This version
// picks the right state based on profile completeness + subscription
// status. State priority: incomplete -> payment-issue -> trial-not-started
// -> live. (Pending-approval is filtered out by the caller.)
function HeroState({ completeness, sub }) {
  const publishable = !!completeness?.publishable;
  const subStatus = sub?.subscription_status || null;
  let state;
  if (!publishable) state = "incomplete";
  else if (sub && ["past_due", "canceled", "unpaid"].includes(subStatus)) state = "payment_issue";
  else if (!sub) state = "no_subscription";
  else state = "live";

  const config = {
    incomplete: {
      icon: <FileText className="mx-auto text-[#C87965] mb-3" size={28} strokeWidth={1.5} />,
      title: "Finish your profile to go live",
      body: `${(completeness?.required_missing || []).length} required field${(completeness?.required_missing || []).length === 1 ? "" : "s"} missing. Patients can't match with you until your profile is complete.`,
      cards: [
        {
          icon: <AlertTriangle className="mx-auto text-[#8B3220] mb-2" size={20} />,
          label: "Profile incomplete",
          tone: "bad",
          body: `${(completeness?.required_missing || []).length} required field${(completeness?.required_missing || []).length === 1 ? "" : "s"} missing`,
        },
        {
          icon: <Clock className="mx-auto text-[#C8C4BB] mb-2" size={20} />,
          label: "Auto-matching",
          tone: "muted",
          body: "Active once profile is complete",
        },
        {
          icon: <Calendar className="mx-auto text-[#2D4A3E] mb-2" size={20} />,
          label: "Edit profile",
          tone: "ok",
          body: <Link to="/portal/therapist/edit" className="text-[#2D4A3E] underline">Pick up where you left off</Link>,
        },
      ],
    },
    payment_issue: {
      icon: <AlertTriangle className="mx-auto text-[#8B3220] mb-3" size={28} strokeWidth={1.5} />,
      title: "Profile paused — payment needs attention",
      body: "Update your billing to start receiving referrals again.",
      cards: [
        {
          icon: <AlertTriangle className="mx-auto text-[#8B3220] mb-2" size={20} />,
          label: "Profile paused",
          tone: "bad",
          body: "Billing issue blocking referrals",
        },
        {
          icon: <Clock className="mx-auto text-[#C8C4BB] mb-2" size={20} />,
          label: "Auto-matching",
          tone: "muted",
          body: "Resumes once billing is fixed",
        },
        {
          icon: <Calendar className="mx-auto text-[#2D4A3E] mb-2" size={20} />,
          label: "Stay current",
          tone: "ok",
          body: "Edit profile any time",
        },
      ],
    },
    no_subscription: {
      icon: <CreditCard className="mx-auto text-[#C87965] mb-3" size={28} strokeWidth={1.5} />,
      title: "Almost ready — one step left",
      body: "Add a payment method to start your 30-day free trial. You won't be charged until the trial ends.",
      cards: [
        {
          icon: <AlertTriangle className="mx-auto text-[#8B3220] mb-2" size={20} />,
          label: "Profile paused",
          tone: "bad",
          body: "Patients can't see you until trial starts",
        },
        {
          icon: <Clock className="mx-auto text-[#C8C4BB] mb-2" size={20} />,
          label: "Auto-matching",
          tone: "muted",
          body: "Active once trial begins",
        },
        {
          icon: <Calendar className="mx-auto text-[#2D4A3E] mb-2" size={20} />,
          label: "Stay current",
          tone: "ok",
          body: "Edit profile any time",
        },
      ],
    },
    live: {
      icon: <Sparkles className="mx-auto text-[#C87965] mb-3" size={28} strokeWidth={1.5} />,
      title: "You're all set — referrals are on the way",
      body: "Your profile is live and matched against every new patient request. When a patient matches your specialties and location (70%+), it shows up here and we email you.",
      cards: [
        {
          icon: <CheckCircle2 className="mx-auto text-[#4A6B5D] mb-2" size={20} />,
          label: "Profile live",
          tone: "ok",
          body: "Patients can find you now",
        },
        {
          icon: <Clock className="mx-auto text-[#C87965] mb-2" size={20} />,
          label: "Auto-matching",
          tone: "ok",
          body: "We scan requests for you 24/7",
        },
        {
          icon: <Calendar className="mx-auto text-[#2D4A3E] mb-2" size={20} />,
          label: "Stay current",
          tone: "ok",
          body: <><Link to="/portal/therapist/edit" className="text-[#2D4A3E] underline">Update availability</Link> anytime</>,
        },
      ],
    },
  };

  const c = config[state];
  const labelToneClass = {
    ok: "text-[#2B2A29]",
    muted: "text-[#C8C4BB]",
    bad: "text-[#8B3220]",
  };
  return (
    <div className="mt-6 bg-white border border-[#E8E5DF] rounded-3xl p-8 sm:p-10"
         data-testid={`therapist-hero-${state}`}>
      <div className="text-center">
        {c.icon}
        <h2 className="font-serif-display text-xl text-[#2D4A3E]">{c.title}</h2>
        <p className="text-sm text-[#6D6A65] mt-1.5 max-w-lg mx-auto leading-relaxed">{c.body}</p>
      </div>
      <div className="mt-8 grid sm:grid-cols-3 gap-4 text-center">
        {c.cards.map((card, i) => (
          <div key={i} className="bg-[#FDFBF7] rounded-xl p-4">
            {card.icon}
            <p className={`text-xs font-semibold uppercase tracking-wider ${labelToneClass[card.tone] || labelToneClass.ok}`}>
              {card.label}
            </p>
            <p className="text-xs text-[#6D6A65] mt-1">{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}


// 4 most-important numbers laid out in equal-width chips above the
// referrals list. Compact (<60px tall) so it doesn't push the
// referrals off-screen. Each chip is empty-state safe — falls back to
// "—" when analytics hasn't loaded yet.
function KpiStrip({ analytics, referrals, sub }) {
  const a = analytics || {};
  // Days remaining in trial (rounded down). 0 when not in a trial or
  // when current_period_end / trial_ends_at are absent.
  const trialDaysLeft = (() => {
    const end = sub?.trial_ends_at;
    if (!end || sub?.subscription_status !== "trialing") return null;
    const ms = new Date(end).getTime() - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();
  const newCount = (referrals || []).filter(
    (r) => r.referral_status === "pending",
  ).length;
  return (
    <div
      className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2"
      data-testid="kpi-strip"
    >
      <KpiChip
        icon={<Star size={11} />}
        label="Match avg"
        value={a.avg_match_score != null ? `${a.avg_match_score}%` : "—"}
      />
      <KpiChip
        icon={<TrendingUp size={11} />}
        label="Apply rate"
        value={a.apply_rate != null ? `${a.apply_rate}%` : "—"}
      />
      <KpiChip
        icon={<Inbox size={11} />}
        label={newCount === 1 ? "New referral" : "New referrals"}
        value={newCount}
        hue={newCount > 0 ? "#C87965" : "#2D4A3E"}
      />
      <KpiChip
        icon={<Calendar size={11} />}
        label="Trial days left"
        value={trialDaysLeft != null ? trialDaysLeft : "—"}
      />
    </div>
  );
}

function KpiChip({ icon, label, value, hue }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6D6A65]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className="font-serif-display text-xl mt-0.5 tabular-nums"
        style={{ color: hue || "#2D4A3E" }}
      >
        {value}
      </div>
    </div>
  );
}

function ReferralTag({ children }) {
  return (
    <span className="text-[11px] bg-[#FDFBF7] border border-[#E8E5DF] text-[#2B2A29] px-2 py-0.5 rounded-full">
      {children}
    </span>
  );
}