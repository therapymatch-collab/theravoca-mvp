import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import useFaqs from "@/lib/useFaqs";
import useSiteCopy from "@/lib/useSiteCopy";
import { api } from "@/lib/api";
import { DEFAULT_T1_ORDER } from "@/pages/therapist/deepMatchOptions";
import TherapistDeepMatchStep from "@/pages/therapist/TherapistDeepMatchStep";
import PreviewModal from "@/pages/therapist/SignupPreviewModal";
import { Group } from "@/pages/therapist/TherapistSignupUI";
import Step1Basics from "@/pages/therapist/steps/Step1Basics";
import Step2License from "@/pages/therapist/steps/Step2License";
import Step3WhoYouSee from "@/pages/therapist/steps/Step3WhoYouSee";
import Step4Specialties from "@/pages/therapist/steps/Step4Specialties";
import Step5Format from "@/pages/therapist/steps/Step5Format";
import Step6Insurance from "@/pages/therapist/steps/Step6Insurance";
import Step7Style from "@/pages/therapist/steps/Step7Style";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";

// Note: CLIENT_TYPES / AGE_GROUPS / ISSUES / MODALITIES / CREDENTIAL_TYPES
// / AVAILABILITY / URGENCY_CAPACITIES / STYLE_TAGS / MODALITY_OFFERINGS
// / GENDERS option arrays now live in
// `@/pages/therapist/steps/signupOptions.js` — imported by the Step{1..7}
// components rather than this orchestration file.
//
// Deep-match T1/T3/T4 options live in
// `@/pages/therapist/deepMatchOptions` so this file + the portal-edit
// page share one source of truth.

// Therapist-side FAQ — short, plain answers to the questions clinicians
// ask before signing up. Kept generic and platform-focused so the copy
// holds up across markets.
const THERAPIST_FAQS = [
  {
    q: "How does TheraVoca differ from other directories?",
    a: "Patients fill out a structured intake and our matching engine ranks therapists by fit. You only see referrals scored 71% or higher for your practice — no scrolling through every search result hoping to be picked.",
  },
  {
    q: "How much does it cost?",
    a: "Your first 30 days are free. After that it's $45/month, billed monthly. Cancel any time from your portal — no contracts or per-referral fees.",
  },
  {
    q: "Will patients see my contact info?",
    a: "Not until you accept a referral. We send you the anonymized request first; once you say 'I'll see this client' the patient receives your name, phone, email, and intake link.",
  },
  {
    q: "What information do you need from me?",
    a: "Credentials, license number and expiry, your specialties and modalities, age groups you treat, fees, and whether you offer telehealth or in-person. The signup flow walks you through everything in 8 steps.",
  },
  {
    q: "How do you verify my license?",
    a: "We check your number against the state board's public registry (Idaho DOPL today, additional states rolling out). Profiles with an expired or invalid license aren't shown to patients.",
  },
  {
    q: "How many referrals will I get?",
    a: "It depends on your specialties, fees, capacity, and how many patients in your area match your profile. Therapists with complete profiles, recent availability updates, and competitive pricing tend to receive the most referrals.",
  },
  {
    q: "Can I pause referrals when I'm full?",
    a: "Yes — toggle 'not currently accepting new clients' in your portal and we'll skip you in matching until you flip it back. Your subscription continues so your profile reactivates instantly.",
  },
  {
    q: "How do I get paid?",
    a: "TheraVoca only handles the intro. Payment for sessions happens directly between you and the patient on whatever billing system you already use.",
  },
];

export default function TherapistSignup() {
  const [searchParams] = useSearchParams();
  const inviteRequestId = searchParams.get("invite_request_id");
  const inviteCode = searchParams.get("ref");
  const recruitCode = searchParams.get("recruit_code");
  const therapistFaqs = useFaqs("therapist", THERAPIST_FAQS);
  const t = useSiteCopy();

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState({
    name: "",
    email: "",
    phone: "",
    phone_alert: "",
    office_phone: "",
    website: "",
    gender: "",
    licensed_states: ["ID"],
    license_number: "",
    license_expires_at: "",
    license_picture: null,
    client_types: ["individual"],
    age_groups: [],
    primary_specialties: [],
    secondary_specialties: [],
    general_treats: [],
    modalities: [],
    modality_offering: "both",
    office_locations: [],
    office_addresses: [],
    insurance_accepted: [],
    languages_spoken: [],
    languages_spoken_other: "",
    cash_rate: 150,
    sliding_scale: false,
    years_experience: 1,
    availability_windows: [],
    urgency_capacity: "within_2_3_weeks",
    style_tags: [],
    free_consult: false,
    bio: "",
    profile_picture: null,
    credential_type: "",
    notify_email: true,
    notify_sms: true,
    // ── Deep-match T1–T5 (v2 spec, Iter-89) ──────────────────────────
    // Required at signup so the matching engine has a complete picture
    // of clinical style. T1 is a drag-orderable list (we store as an
    // array of slugs in rank order). T3 picks 2 of 6, T4 picks 1 of 5.
    // T2 + T5 are open text used for embedding-based context scoring.
    t1_stuck_ranked: [...DEFAULT_T1_ORDER],
    t2_progress_story: "",
    t3_breakthrough: [],
    t4_hard_truth: "",
    t5_lived_experience: "",
  });
  const [office, setOffice] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [officeCity, setOfficeCity] = useState("");
  const [officeZip, setOfficeZip] = useState("");
  const [insuranceOther, setInsuranceOther] = useState("");
  const [websiteError, setWebsiteError] = useState("");
  const [websiteChecking, setWebsiteChecking] = useState(false);
  const [stepError, setStepError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [step, setStep] = useState(1);
  const totalSteps = 9;
  const formCardRef = useRef(null);
  // Cloudflare Turnstile (fail-soft) — see comments in IntakeForm.jsx
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const turnstileSiteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY || "";
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const SCRIPT_ID = "cf-turnstile-script";
    const ensureScript = () =>
      new Promise((resolve) => {
        if (window.turnstile) return resolve();
        const existing = document.getElementById(SCRIPT_ID);
        if (existing) {
          existing.addEventListener("load", () => resolve());
          return;
        }
        const s = document.createElement("script");
        s.id = SCRIPT_ID;
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    let cancelled = false;
    ensureScript().then(() => {
      if (cancelled || !turnstileRef.current || !window.turnstile) return;
      try {
        turnstileWidgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: "light",
          size: "flexible",
          // Mobile-stability options — match IntakeForm. Without these
          // therapists hitting Submit after spending >5 min on the form
          // see a silent "Security check failed." because the widget's
          // token quietly expired.
          "refresh-expired": "auto",
          retry: "auto",
          "retry-interval": 4000,
          callback: (tok) => setTurnstileToken(tok || ""),
          "error-callback": () => setTurnstileToken(""),
          "expired-callback": () => setTurnstileToken(""),
          "timeout-callback": () => setTurnstileToken(""),
        });
      } catch (_) { /* ignore double-render */ }
    });
    return () => { cancelled = true; };
  }, [turnstileSiteKey]);
  /**
   * Reset the widget when the backend reports a security failure so
   * the therapist can try again without losing their form state.
   */
  const resetTurnstile = () => {
    setTurnstileToken("");
    try {
      if (window.turnstile && turnstileWidgetIdRef.current != null) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    } catch (_) { /* ignore */ }
  };
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const toggleArr = (k, v, max) =>
    setData((d) => {
      const arr = d[k];
      if (arr.includes(v)) return { ...d, [k]: arr.filter((x) => x !== v) };
      if (max && arr.length >= max) return d;
      return { ...d, [k]: [...arr, v] };
    });

  // Specialty tier helper: ensure each issue lives in exactly ONE tier
  const issueTier = (issue) => {
    if (data.primary_specialties.includes(issue)) return "primary";
    if (data.secondary_specialties.includes(issue)) return "secondary";
    if (data.general_treats.includes(issue)) return "general";
    return null;
  };

  // ── URL helpers — auto-prefix https:// and validate basic structure ────
  const normalizeWebsite = (raw) => {
    const s = (raw || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return `https://${s}`;
  };
  const websiteIsValid = (raw) => {
    const s = (raw || "").trim();
    if (!s) return true; // optional
    try {
      const u = new URL(normalizeWebsite(s));
      // Require a dot in the hostname so "https://foo" is rejected
      if (!u.hostname.includes(".")) return false;
      if (u.hostname.length < 4) return false;
      return true;
    } catch {
      return false;
    }
  };
  const verifyWebsiteReachable = async (raw) => {
    const url = normalizeWebsite(raw);
    if (!url) return true;
    setWebsiteChecking(true);
    try {
      // No-cors so cross-origin doesn't error; we just want a successful round-trip.
      // Most sites respond to HEAD/GET; if the fetch resolves at all, we count it as reachable.
      await fetch(url, { method: "GET", mode: "no-cors", redirect: "follow" });
      setWebsiteError("");
      return true;
    } catch {
      setWebsiteError(
        "We couldn't reach that website — double-check the URL or leave it blank.",
      );
      return false;
    } finally {
      setWebsiteChecking(false);
    }
  };

  // Scroll to top of the form card (NOT the page) on Next/Back so users
  // stay in context and don't watch the hero scroll back into view.
  const scrollFormIntoView = () => {
    requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Honor /therapists/join#signup-form anchor links from /sign-in etc., AND
  // auto-scroll invite-link landings (?invite_request_id) straight to the
  // signup form so non-registered therapists don't waste time scrolling.
  useEffect(() => {
    const hasInvite = new URLSearchParams(window.location.search).get(
      "invite_request_id",
    );
    if (window.location.hash === "#signup-form" || hasInvite) {
      setTimeout(() => {
        document
          .getElementById("signup-form")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    }
  }, []);

  const setIssueTier = (issue, tier) => {
    setData((d) => {
      const stripped = {
        primary_specialties: d.primary_specialties.filter((x) => x !== issue),
        secondary_specialties: d.secondary_specialties.filter((x) => x !== issue),
        general_treats: d.general_treats.filter((x) => x !== issue),
      };
      if (tier === "primary") {
        if (stripped.primary_specialties.length >= 2) return d;
        stripped.primary_specialties = [...stripped.primary_specialties, issue];
      } else if (tier === "secondary") {
        if (stripped.secondary_specialties.length >= 3) return d;
        stripped.secondary_specialties = [...stripped.secondary_specialties, issue];
      } else if (tier === "general") {
        if (stripped.general_treats.length >= 5) return d;
        stripped.general_treats = [...stripped.general_treats, issue];
      }
      return { ...d, ...stripped };
    });
  };

  // Per-step validation — mirrors the required-field asterisks. Each step's
  // "Next" button is disabled until canAdvance(step) is true.
  const canAdvance = (s) => {
    if (s === 1) {
      return (
        data.name.trim().length >= 3 &&
        data.email.includes("@") &&
        !!data.credential_type &&
        !!data.office_phone?.trim() &&
        !!data.gender &&
        websiteIsValid(data.website)
      );
    }
    if (s === 2) {
      return (
        (data.licensed_states && data.licensed_states.length > 0) &&
        !!data.license_number?.trim() &&
        !!data.license_expires_at &&
        !!data.license_picture
      );
    }
    if (s === 3)
      return data.client_types.length >= 1 && data.age_groups.length >= 1;
    if (s === 4) return data.primary_specialties.length >= 1;
    if (s === 5)
      return (
        data.modalities.length >= 1 &&
        !!data.modality_offering &&
        (data.modality_offering === "telehealth" ||
          data.office_addresses.length >= 1) &&
        data.availability_windows.length >= 1
      );
    if (s === 6) return data.cash_rate > 0 && data.years_experience >= 0;
    if (s === 7) return data.style_tags.length >= 1;
    // Deep-match required answers (Iter-89 v2). T1 has a default rank
    // order on mount, so we just gate on T2/T3/T4/T5 actually being
    // filled. Open-text minimums match the v2 spec.
    if (s === 8) {
      return (
        (data.t2_progress_story || "").trim().length >= 50 &&
        data.t3_breakthrough.length === 2 &&
        !!data.t4_hard_truth &&
        (data.t5_lived_experience || "").trim().length >= 30
      );
    }
    if (s === 9) return true; // notifications optional
    return true;
  };

  // Aggregate validity across all steps (used by the Preview button on the
  // final step + the Submit button inside the modal).
  const valid = [1, 2, 3, 4, 5, 6, 7, 8, 9].every(canAdvance);

  // Human-readable reason why the current step's Next is disabled — surfaced
  // under the Next button so therapists aren't left guessing.
  const stepBlockReason = (s) => {
    if (s === 1) {
      if (!data.name || data.name.trim().length < 3)
        return "Enter your full name + degree (e.g. Sarah Lin, LCSW).";
      if (!data.email.includes("@")) return "Enter a valid email address.";
      if (!data.credential_type) return "Select your credential type.";
      if (!(data.phone_alert?.trim() || data.phone?.trim()))
        return "Enter a private alert phone number.";
      if (!data.office_phone?.trim())
        return "Enter your public office phone number.";
      if (!data.gender) return "Select your gender.";
      if (data.website && !websiteIsValid(data.website))
        return "That website doesn't look valid — fix or leave blank.";
      return "";
    }
    if (s === 2) {
      if (!(data.licensed_states && data.licensed_states.length > 0))
        return "Select your license state.";
      if (!data.license_number?.trim()) return "Enter your license number.";
      if (!data.license_expires_at) return "Pick your license expiration date.";
      if (!data.license_picture)
        return "Upload a photo of your license — required for manual verification.";
      return "";
    }
    if (s === 3) {
      if (data.client_types.length === 0)
        return "Pick at least one client type you see.";
      if (data.age_groups.length === 0)
        return "Pick at least one age group you see.";
      return "";
    }
    if (s === 4 && data.primary_specialties.length === 0)
      return "Mark at least one issue as a Primary specialty.";
    if (s === 5) {
      if (data.modalities.length === 0)
        return "Pick at least one modality you practice.";
      if (!data.modality_offering)
        return "Choose where you see clients (telehealth / in-person / both).";
      if (
        data.modality_offering !== "telehealth" &&
        data.office_addresses.length === 0
      )
        return "Add at least one office address (street + city + ZIP).";
      if (data.availability_windows.length === 0)
        return "Pick at least one session availability window.";
      return "";
    }
    if (s === 6) {
      if (!data.cash_rate || data.cash_rate <= 0)
        return "Enter your cash session rate.";
      return "";
    }
    if (s === 7 && data.style_tags.length === 0)
      return "Pick at least one style tag.";
    if (s === 8) {
      if ((data.t2_progress_story || "").trim().length < 50)
        return "Tell us about a real client's progress (at least 50 characters).";
      if (data.t3_breakthrough.length !== 2)
        return "Pick exactly 2 ways your best work unfolds.";
      if (!data.t4_hard_truth)
        return "Pick how you push a client past their comfort zone.";
      if ((data.t5_lived_experience || "").trim().length < 30)
        return "Share at least 30 characters of lived experience or community knowledge.";
      return "";
    }
    return "";
  };

  const [therapistId, setTherapistId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [trialActivated, setTrialActivated] = useState(false);
  const [skippedPayment, setSkippedPayment] = useState(false);

  // Detect ?subscribed=ID&session_id=cs_test_... return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subscribedId = params.get("subscribed");
    const sessionId = params.get("session_id");
    if (subscribedId && sessionId) {
      api
        .post(`/therapists/${subscribedId}/sync-payment-method`, { session_id: sessionId })
        .then((res) => {
          if (res.data?.ok) {
            setTrialActivated(true);
            setSubmitted(true);
            setTherapistId(subscribedId);
            sessionStorage.removeItem("tv_signup_pending");
            // Persist a portal session so the "Go to my dashboard" CTA
            // logs the therapist straight in without an email round-trip.
            if (res.data.session_token) {
              try {
                sessionStorage.setItem(
                  "tv_session_token",
                  res.data.session_token,
                );
                sessionStorage.setItem("tv_session_role", "therapist");
              } catch (e) {
                // sessionStorage can fail in private mode or when
                // storage is full. The user can re-sign-in via
                // magic link if the auto-session didn't stick.
                console.warn("sessionStorage write failed:", e?.message);
              }
            }
            toast.success("Free trial started — you're all set!");
          } else {
            toast.error("Payment session not complete; please try again.");
          }
          // Clean URL
          window.history.replaceState({}, "", "/therapists/join");
        })
        .catch((e) => {
          console.error("Finalize subscription failed:", e);
          toast.error("Could not finalize subscription");
        });
      return;
    }
    // Restore the post-submission "Add payment" screen if the therapist
    // submitted their profile, hit "Add payment", then hit Back from
    // Stripe Checkout. Without this they'd land on a blank form.
    try {
      const raw = sessionStorage.getItem("tv_signup_pending");
      if (raw) {
        const pending = JSON.parse(raw);
        if (pending?.therapist_id && pending?.email) {
          setTherapistId(pending.therapist_id);
          setSubmitted(true);
          if (pending.data) {
            setData((d) => ({ ...d, ...pending.data }));
          }
        }
      }
    } catch (e) {
      // Stale or corrupted JSON — drop it so the next visit isn't
      // perpetually broken.
      console.warn("tv_signup_pending parse failed, clearing:", e?.message);
      try {
        sessionStorage.removeItem("tv_signup_pending");
      } catch (_inner) {
        /* private mode — nothing more we can do */
      }
    }
  }, []);

  const submit = async () => {
    // Preflight: don't hit the backend if Turnstile hasn't issued a
    // token yet. Without this, mobile users who tap Submit before the
    // widget finishes loading get a generic "Security check failed"
    // 400 from the backend.
    if (turnstileSiteKey && !turnstileToken) {
      toast.error(
        "Hold on a second — the security check hasn't finished. Please scroll down to complete it, then tap Submit again.",
        { duration: 7000 },
      );
      try {
        turnstileRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } catch (_) { /* old iOS Safari — ignore */ }
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...data,
        // Keep `phone` mirroring the alert phone for legacy SMS routing
        phone: data.phone_alert?.trim() || data.phone || "",
        referred_by_code: inviteCode || data.referred_by_code || null,
        recruit_code: recruitCode || null,
        turnstile_token: turnstileToken,
      };
      // `languages_spoken_other` is a UI staging field — once Add was
      // clicked the entries already merged into `languages_spoken`.
      // Strip it so the backend model doesn't see an unknown key.
      delete payload.languages_spoken_other;
      const res = await api.post("/therapists/signup", payload);
      setTherapistId(res.data?.id);
      setSubmitted(true);
      // Persist the post-submit context so the back-from-Stripe round
      // trip lands on the same "Add payment method" screen rather than
      // wiping every field they just typed.
      try {
        sessionStorage.setItem(
          "tv_signup_pending",
          JSON.stringify({
            therapist_id: res.data?.id,
            email: data.email,
            data: { name: data.name, email: data.email },
          }),
        );
      } catch (e) {
        // Private-mode storage failure is non-fatal — the user can still
        // continue, they'll just lose the back-button preservation.
        console.warn("tv_signup_pending write failed:", e?.message);
      }
      toast.success("Profile received — please add a payment method to start your free trial.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "Submission failed";
      // Turnstile expired / IP drifted — reset the widget so the
      // therapist can solve a fresh challenge in place. Same pattern
      // as the patient intake flow.
      const looksLikeTurnstile =
        status === 400 &&
        typeof detail === "string" &&
        /security|verif/i.test(detail);
      if (looksLikeTurnstile) {
        resetTurnstile();
        toast.error(
          "Security check expired. We've refreshed it — please complete it again and tap Submit.",
          { duration: 8000 },
        );
      } else {
        toast.error(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const goToCheckout = async () => {
    if (!therapistId) return;
    setCheckoutLoading(true);
    try {
      const res = await api.post(`/therapists/${therapistId}/subscribe-checkout`, {});
      if (res.data?.demo_mode) {
        // Stripe Emergent proxy returns unreachable URLs — fast-forward the
        // sync step locally so the UX is fully testable today. Switch to a
        // real Stripe key in /app/backend/.env to enable hosted Checkout.
        toast.info("Demo mode — fast-forwarding card setup");
        const sync = await api.post(`/therapists/${therapistId}/sync-payment-method`, {
          session_id: `demo_${therapistId}_${Date.now()}`,
        });
        if (sync.data?.ok) {
          setTrialActivated(true);
          window.history.replaceState({}, "", "/therapists/join");
        } else {
          toast.error("Could not finalize trial in demo mode");
        }
      } else if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        toast.error("Could not create checkout session");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Checkout failed");
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (submitted) {
    if (trialActivated) {
      return (
        <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
          <Header />
          <main className="flex-1 flex items-center justify-center px-5 py-16">
            <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center tv-fade-up">
              <div className="mx-auto w-14 h-14 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
                <CheckCircle2 size={28} strokeWidth={1.6} />
              </div>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5" data-testid="trial-activated-heading">
                You're in — free trial active
              </h1>
              <p className="text-[#6D6A65] mt-3 leading-relaxed">
                Your card is saved and your <strong className="text-[#2D4A3E]">30-day free trial</strong> has started.
                You'll receive your first anonymous referral as soon as a patient match scores ≥71%.
                We'll email you 3 days before your first $45 charge — cancel any time before then with no fees.
              </p>
              <div
                className="mt-6 bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 text-left"
                data-testid="check-email-prompt-paid"
              >
                <div className="text-xs uppercase tracking-wider text-[#C87965] font-semibold">
                  Check your email
                </div>
                <p className="text-sm text-[#2B2A29] mt-1.5 leading-relaxed">
                  We just sent a welcome email to{" "}
                  <strong className="text-[#2D4A3E]">{data.email}</strong> with:
                </p>
                <ul className="text-sm text-[#2B2A29] mt-2 space-y-1.5 list-disc ml-5">
                  <li>How patient referrals reach you (email + SMS)</li>
                  <li>How to apply or decline a referral</li>
                  <li>Your portal login link + setup checklist</li>
                  <li>A 5-minute onboarding video walkthrough</li>
                </ul>
                <p className="text-xs text-[#6D6A65] mt-3">
                  Don't see it within 5 minutes? Check spam, or write us at{" "}
                  <a
                    className="text-[#2D4A3E] underline"
                    href="mailto:support@theravoca.com"
                  >
                    support@theravoca.com
                  </a>.
                </p>
              </div>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  to="/portal/therapist"
                  className="tv-btn-primary inline-flex"
                  data-testid="signup-success-dashboard"
                >
                  Go to my dashboard
                </Link>
                <Link
                  to="/"
                  className="tv-btn-secondary inline-flex"
                  data-testid="signup-success-home"
                >
                  Back home
                </Link>
              </div>
            </div>
          </main>
          <Footer />
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-5 py-16">
          <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center tv-fade-up">
            <div className="mx-auto w-14 h-14 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
              <CheckCircle2 size={28} strokeWidth={1.6} />
            </div>
            <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
              Profile received — one more step
            </h1>
            <p className="text-[#6D6A65] mt-3 leading-relaxed">
              We've received your profile and emailed a confirmation to{" "}
              <span className="text-[#2D4A3E] font-medium">{data.email}</span>.
              Add a payment method now to start your <strong className="text-[#2D4A3E]">30-day free trial</strong>.
              You won't be charged until day 31, and you can cancel any time
              from your portal.
            </p>
            <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 mt-6 text-left">
              <div className="text-xs uppercase tracking-wider text-[#6D6A65]">Plan</div>
              <div className="font-serif-display text-2xl text-[#2D4A3E] mt-0.5">$45 / month</div>
              <div className="text-xs text-[#6D6A65] mt-1">After 30-day free trial · Cancel anytime · Card via Stripe</div>
            </div>
            <button
              onClick={goToCheckout}
              disabled={checkoutLoading}
              data-testid="signup-checkout-btn"
              className="tv-btn-primary mt-6 w-full disabled:opacity-50"
            >
              {checkoutLoading
                ? "Redirecting…"
                : t(
                    "btn.therapist.add_payment",
                    "Add payment method & start free trial",
                  )}
              <ArrowRight size={18} className="inline ml-2" />
            </button>
            <button
              type="button"
              onClick={() => setSkippedPayment(true)}
              className="tv-btn-secondary mt-3 inline-flex"
              data-testid="signup-skip-payment-btn"
            >
              {t("btn.therapist.skip_payment", "I'll do this later")}
            </button>
            {skippedPayment ? (
              <div
                className="mt-6 bg-[#FBE9E5] border border-[#F4C7BE] rounded-2xl p-5 text-left"
                data-testid="check-email-prompt-skip"
              >
                <div className="text-xs uppercase tracking-wider text-[#C87965] font-semibold">
                  Check your email — next steps
                </div>
                <p className="text-sm text-[#2B2A29] mt-1.5 leading-relaxed">
                  No problem — your profile is saved as{" "}
                  <strong>pending review</strong>. We just sent a welcome email
                  to <strong className="text-[#2D4A3E]">{data.email}</strong>{" "}
                  with:
                </p>
                <ul className="text-sm text-[#2B2A29] mt-2 space-y-1.5 list-disc ml-5">
                  <li>A link to add your payment method any time</li>
                  <li>How patient referrals work and what we'll send you</li>
                  <li>How to log into your portal and complete onboarding</li>
                  <li>What we need from you before you can start receiving matches</li>
                </ul>
                <p className="text-xs text-[#6D6A65] mt-3">
                  <strong className="text-[#B0382A]">Important:</strong> we
                  can't send patient referrals until your payment method is
                  on file. Most therapists complete this step within 24 hours.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <Link
                    to="/sign-in?role=therapist"
                    className="tv-btn-primary !py-2 inline-flex text-center justify-center"
                    data-testid="signup-skip-signin"
                  >
                    Sign in to my portal
                  </Link>
                  <Link
                    to="/"
                    className="tv-btn-secondary !py-2 inline-flex text-center justify-center"
                  >
                    Back home
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1" data-testid="therapist-signup-page">
        <section className="border-b border-[#E8E5DF] py-16">
          <div className="max-w-5xl mx-auto px-5 sm:px-8 grid md:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
                {t("therapist.hero.eyebrow", "For licensed therapists")}
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-[1.05]">
                {t(
                  "therapist.hero.headline",
                  <>
                    You focus on <em className="not-italic text-[#C87965]">care</em>{" "}
                    — we provide the referrals.
                  </>,
                )}
              </h1>
              <p className="mt-5 text-[#2B2A29]/80 leading-relaxed">
                {t(
                  "therapist.hero.subhead",
                  "Marketing yourself to attract the right patients can feel frustrating and time-consuming. We do all the work by sending pre-screened referrals straight to your inbox — so you can spend your hours on clients, not on SEO.",
                )}
              </p>
              <div className="mt-6 inline-flex items-center gap-3 bg-white border border-[#E8E5DF] rounded-2xl px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-[#2D4A3E]" />
                <div className="text-sm text-[#2B2A29]">
                  <span className="font-semibold text-[#2D4A3E]">$45/month</span>
                  <span className="text-[#6D6A65]"> · 30-day free trial · cancel anytime</span>
                </div>
              </div>
              <div className="mt-7 flex flex-wrap gap-3 items-center">
                <a
                  href="#signup-form"
                  className="tv-btn-primary"
                  data-testid="hero-signup-cta"
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById("signup-form")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {t("btn.therapist.signup_cta", "Sign up — start free trial")}{" "}
                  <ArrowRight size={18} />
                </a>
                <a
                  href="/sign-in?role=therapist"
                  className="text-sm text-[#2D4A3E] underline underline-offset-4 hover:text-[#3A5E50]"
                  data-testid="hero-signin-link"
                >
                  Already a member? Sign in
                </a>
              </div>
            </div>
            <div className="relative">
              <div
                className="aspect-[4/5] rounded-3xl overflow-hidden bg-gradient-to-br from-[#E8DCC1] via-[#FDF7EC] to-[#F2F4F0] relative"
                data-testid="signup-hero-image"
              >
                <img
                  src="https://images.unsplash.com/photo-1573497019418-b400bb3ab074?auto=format&fit=crop&w=720&q=70"
                  alt="A therapist taking notes during a calm session"
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#2D4A3E]/85 via-[#2D4A3E]/30 to-transparent p-5">
                  <div className="text-white text-sm font-medium leading-snug">
                    "I get warm, well-fit referrals every week — and I don't pay
                    per click."
                  </div>
                  <div className="text-white/70 text-xs mt-1">
                    — Licensed clinical social worker, TheraVoca pilot
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="border-b border-[#E8E5DF] py-14 bg-white">
          <div className="max-w-5xl mx-auto px-5 sm:px-8">
            <div className="text-center mb-10 max-w-2xl mx-auto">
              <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
                Why join TheraVoca
              </p>
              <h2 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] leading-[1.1]">
                Built for therapists who want to grow{" "}
                <em className="not-italic text-[#C87965]">slowly and well</em> —
                not chase clicks.
              </h2>
              <p className="mt-4 text-[#2B2A29]/80 leading-relaxed">
                We're a referral network designed by clinicians, for clinicians.
                Every part of the system is built around{" "}
                <strong>protecting your time, your privacy, and the
                therapeutic alliance</strong> — not maximizing the number of
                referrals we can spam you with.
              </p>
            </div>
            <ul className="grid sm:grid-cols-2 gap-4 text-sm text-[#2B2A29]">
              {[
                {
                  t: "Only ideal-fit referrals",
                  d: "Pre-screened patient leads aligned with your specialties and schedule. Every match scores ≥ 70%.",
                },
                {
                  t: "You're always in control",
                  d: "Review each referral and opt in — or pass. No pressure, no obligations.",
                },
                {
                  t: "No public profile, no spam",
                  d: "Your info stays private until you say yes to a specific match.",
                },
                {
                  t: "30-day free trial, then $45/month",
                  d: "Cancel anytime. No setup fees, no per-referral charges, no hidden costs.",
                },
              ].map((b) => (
                <li
                  key={b.t}
                  className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 hover:border-[#2D4A3E] hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-[#2D4A3E] shrink-0" />
                    <div className="font-semibold text-[#2D4A3E]">{b.t}</div>
                  </div>
                  <div className="text-[#6D6A65] mt-2 text-xs leading-relaxed">{b.d}</div>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex justify-center">
              <a
                href="#signup-form"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("signup-form")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="tv-btn-primary"
                data-testid="why-join-cta-btn"
              >
                {t("btn.therapist.cta.headline", "Get more referrals")}
                <ArrowRight size={16} className="ml-1.5 inline" />
              </a>
            </div>
          </div>
        </section>

        {/* Therapist FAQ — answers what new clinicians ask before they sign up. */}
        <section className="border-t border-[#E8E5DF] py-16 bg-white">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3 text-center">
              FAQs for therapists
            </p>
            <h2 className="font-serif-display text-4xl text-[#2D4A3E] leading-tight text-center">
              Common questions
            </h2>
            {/* `therapistFaqs` comes from `useFaqs("therapist", THERAPIST_FAQS)`
                which fetches the admin-edited FAQ list from MongoDB
                (GET /api/faqs/therapist) and falls back to the bundled
                seed array when the DB hasn't been touched. Rendering
                the hardcoded `THERAPIST_FAQS` here instead of
                `therapistFaqs` was the cause of the admin-vs-live
                FAQ drift — every admin edit looked saved but the
                public page still showed the bundled seed copy. */}
            <Accordion type="single" collapsible className="mt-8" data-testid="therapist-faq">
              {therapistFaqs.map((f) => (
                <AccordionItem
                  key={f.q}
                  value={`item-${f.q}`}
                  className="border-[#E8E5DF]"
                  data-testid={`therapist-faq-${f.q.slice(0, 20)}`}
                >
                  <AccordionTrigger className="text-left text-[#2B2A29] hover:text-[#2D4A3E] hover:no-underline py-5">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[#6D6A65] leading-relaxed">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <div className="mt-10 flex justify-center">
              <a
                href="#signup-form"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("signup-form")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="tv-btn-primary"
                data-testid="therapist-faq-cta-btn"
              >
                {t("btn.therapist.cta.headline", "Get more referrals")}
                <ArrowRight size={16} className="ml-1.5 inline" />
              </a>
            </div>
          </div>
        </section>

        <section id="signup-form" className="py-14 scroll-mt-24">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <div
              className="text-center mb-8"
              data-testid="signup-section-header"
            >
              <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
                <Sparkles size={14} className="inline mr-1.5 -mt-0.5" strokeWidth={1.8} />
                For licensed therapists · Sign up
              </p>
              <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-[1.05]">
                Get more <em className="not-italic text-[#C87965]">targeted</em> patient referrals.
              </h2>
              <p className="mt-4 text-[#2B2A29]/80 leading-relaxed max-w-xl mx-auto">
                Build your TheraVoca profile below — patients pre-screened by
                your specialties, schedule, and rates land directly in your
                inbox. Most profiles approved within 1 business day.
              </p>
            </div>
            <div
              ref={formCardRef}
              className="bg-white border border-[#E8E5DF] rounded-3xl p-6 sm:p-10"
            >
              {(inviteRequestId || inviteCode) && (
                <div
                  className="mb-6 bg-[#FDF7EC] border border-[#E8DCC1] rounded-2xl p-4 flex items-start gap-3"
                  data-testid="invite-banner"
                >
                  <Sparkles size={18} className="text-[#C87965] mt-0.5 shrink-0" />
                  <div className="text-sm text-[#2B2A29] leading-relaxed">
                    {inviteRequestId ? (
                      <>
                        <strong>You've been invited to apply</strong> for a specific
                        patient referral. Complete your profile and you'll be
                        auto-matched the moment you go live.
                      </>
                    ) : (
                      <>
                        <strong>Invited by a colleague.</strong> Welcome — you'll
                        start with the same 30-day free trial as everyone else.
                      </>
                    )}
                  </div>
                </div>
              )}
              <h2 className="font-serif-display text-3xl text-[#2D4A3E]">
                Tell us about your practice
              </h2>
              <p className="text-sm text-[#6D6A65] mt-1">
                The more accurate your profile, the better the matches we'll route to you.
              </p>

              <div className="mt-6 mb-7">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[#6D6A65] mb-2">
                  <span>Step {step} of {totalSteps}</span>
                  <span>
                    {[
                      "Basics",
                      "License & verification",
                      "Who you see",
                      "Specialties",
                      "Format & locations",
                      "Insurance & rates",
                      "Style & bio",
                      "Style fit (deep match)",
                      "Notifications",
                    ][step - 1]}
                  </span>
                </div>
                <div className="h-1.5 bg-[#E8E5DF] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#2D4A3E] transition-all"
                    style={{ width: `${(step / totalSteps) * 100}%` }}
                    data-testid="signup-progress"
                  />
                </div>
              </div>

              <div className="mt-8 space-y-7">
                {step === 1 && (
                  <Step1Basics
                    data={data}
                    set={set}
                    websiteIsValid={websiteIsValid}
                    websiteError={websiteError}
                    setWebsiteError={setWebsiteError}
                  />
                )}

                {step === 2 && <Step2License data={data} set={set} />}

                {step === 3 && (
                  <Step3WhoYouSee data={data} toggleArr={toggleArr} />
                )}

                {step === 4 && (
                  <Step4Specialties
                    data={data}
                    issueTier={issueTier}
                    setIssueTier={setIssueTier}
                  />
                )}

                {step === 5 && (
                  <Step5Format
                    data={data}
                    set={set}
                    toggleArr={toggleArr}
                    officeAddress={officeAddress}
                    setOfficeAddress={setOfficeAddress}
                    officeCity={officeCity}
                    setOfficeCity={setOfficeCity}
                    officeZip={officeZip}
                    setOfficeZip={setOfficeZip}
                  />
                )}

                {step === 6 && (
                  <Step6Insurance
                    data={data}
                    set={set}
                    toggleArr={toggleArr}
                    insuranceOther={insuranceOther}
                    setInsuranceOther={setInsuranceOther}
                  />
                )}

                {step === 7 && (
                  <Step7Style data={data} set={set} toggleArr={toggleArr} />
                )}

                {/* ── Deep-match T1–T5 (v2 spec, Iter-89) ────────────
                    All step content lives in `TherapistDeepMatchStep`
                    so the in-portal edit form and signup form stay
                    in sync. */}
                {step === 8 && (
                  <TherapistDeepMatchStep
                    data={data}
                    set={set}
                    toggleArr={toggleArr}
                    testidPrefix="signup"
                    GroupComponent={Group}
                  />
                )}

                {step === 9 && (<>
                <Group title="Notifications">
                  <p className="text-xs text-[#6D6A65] -mt-1 mb-2">
                    Choose how you'd like to be alerted when a new referral matches you.
                  </p>
                  <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer">
                    <Checkbox
                      checked={data.notify_email}
                      onCheckedChange={(v) => set("notify_email", !!v)}
                      data-testid="signup-notify-email"
                      className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                    />
                    <span className="text-sm text-[#2B2A29]">Email me each new referral</span>
                  </label>
                  <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer">
                    <Checkbox
                      checked={data.notify_sms}
                      onCheckedChange={(v) => set("notify_sms", !!v)}
                      data-testid="signup-notify-sms"
                      className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                    />
                    <span className="text-sm text-[#2B2A29]">Text me each new referral</span>
                  </label>
                </Group>
                </>)}
              </div>

              {step === 1 && (
                <p className="mt-6 text-xs text-[#6D6A65]">
                  Your profile is reviewed before going live. You can edit
                  anything later.
                </p>
              )}

              <div className="mt-6 pt-6 border-t border-[#E8E5DF] flex items-center justify-between flex-wrap gap-4">
                {step > 1 ? (
                  <button
                    type="button"
                    className="tv-btn-secondary"
                    onClick={() => {
                      setStep((s) => Math.max(1, s - 1));
                      scrollFormIntoView();
                    }}
                    data-testid="signup-back-btn"
                  >
                    Back
                  </button>
                ) : (
                  <span className="hidden sm:block" aria-hidden="true" />
                )}
                <div className="flex flex-col items-end gap-2 ml-auto">
                  {!canAdvance(step) && stepBlockReason(step) && (
                    <p
                      className="text-xs text-[#D45D5D] max-w-xs text-right leading-relaxed"
                      data-testid="signup-step-error"
                    >
                      {stepBlockReason(step)}
                    </p>
                  )}
                  {websiteError && step === 1 && (
                    <p
                      className="text-xs text-[#D45D5D] max-w-xs text-right"
                      data-testid="signup-website-block-error"
                    >
                      {websiteError}
                    </p>
                  )}
                {step < totalSteps ? (
                  <button
                    type="button"
                    className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!canAdvance(step) || websiteChecking}
                    onClick={async () => {
                      // Step 1: normalize website + check reachability if provided
                      if (step === 1 && data.website?.trim()) {
                        const reachable = await verifyWebsiteReachable(data.website);
                        if (!reachable) return;
                        // Persist normalized form (https:// prefix etc.)
                        set("website", normalizeWebsite(data.website));
                      }
                      setStepError("");
                      setStep((s) => Math.min(totalSteps, s + 1));
                      scrollFormIntoView();
                    }}
                    data-testid="signup-next-btn"
                  >
                    {websiteChecking ? "Checking…" : "Next"} <ArrowRight size={18} />
                  </button>
                ) : (
                  <div className="flex flex-col items-end gap-3">
                    {turnstileSiteKey && (
                      <div ref={turnstileRef} data-testid="signup-turnstile" />
                    )}
                    <button
                      type="button"
                      className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!valid || submitting}
                      onClick={() => setShowPreview(true)}
                      data-testid="signup-preview"
                    >
                      Preview profile <ArrowRight size={18} />
                    </button>
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      {showPreview && (
        <PreviewModal
          data={data}
          onClose={() => setShowPreview(false)}
          onConfirm={async () => {
            await submit();
            setShowPreview(false);
          }}
          submitting={submitting}
        />
      )}
      <Footer />
    </div>
  );
}

// Note: Group / Field / Req / PillRow / Tags / SummaryRow used to
// live here. They moved to `pages/therapist/TherapistSignupUI.jsx`
// so the per-step renderers can be split into separate files in a
// follow-up without circular imports. PillCol / RadioCol / the
// legacy arrow-based RankList that used to live below were
// previously extracted: PillCol+RadioCol → TherapistDeepMatchStep,
// RankList → DraggableRankList (drag-and-drop dnd-kit version).
