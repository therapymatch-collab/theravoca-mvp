import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, X, Plus, Camera, Sparkles } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { formatUsPhone } from "@/lib/phone";
import { api } from "@/lib/api";
import { IDAHO_INSURERS } from "@/lib/insurers";
import { imageToDataUrl } from "@/lib/image";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

const CLIENT_TYPES = [
  { v: "individual", l: "Individual" },
  { v: "couples", l: "Couples" },
  { v: "family", l: "Family" },
  { v: "group", l: "Group" },
];
const AGE_GROUPS = [
  { v: "child", l: "Child (under 13)" },
  { v: "teen", l: "Teen (13–17)" },
  { v: "young_adult", l: "Young adult (18–25)" },
  { v: "adult", l: "Adult (26–64)" },
  { v: "older_adult", l: "Older adult (65+)" },
];
const ISSUES = [
  { v: "anxiety", l: "Anxiety" },
  { v: "depression", l: "Depression" },
  { v: "ocd", l: "OCD" },
  { v: "adhd", l: "ADHD" },
  { v: "trauma_ptsd", l: "Trauma / PTSD" },
  { v: "relationship_issues", l: "Relationship issues" },
  { v: "life_transitions", l: "Life transitions" },
  { v: "parenting_family", l: "Parenting / family conflict" },
  { v: "substance_use", l: "Substance use" },
  { v: "eating_concerns", l: "Eating concerns" },
  { v: "autism_neurodivergence", l: "Autism / neurodivergence" },
  { v: "school_academic_stress", l: "School / academic stress" },
];
const MODALITIES = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];
const CREDENTIAL_TYPES = [
  { v: "psychologist", l: "Psychologist (PhD / PsyD)" },
  { v: "lcsw", l: "Licensed Clinical Social Worker (LCSW)" },
  { v: "lpc", l: "Licensed Professional Counselor (LPC / LCPC / LPCC)" },
  { v: "lmft", l: "Licensed Marriage & Family Therapist (LMFT)" },
  { v: "lmhc", l: "Licensed Mental Health Counselor (LMHC)" },
  { v: "psychiatrist", l: "Psychiatrist (MD)" },
  { v: "other", l: "Other" },
];
const AVAILABILITY = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
];
const URGENCY_CAPACITIES = [
  { v: "asap", l: "ASAP — I can take new clients this week" },
  { v: "within_2_3_weeks", l: "Within 2–3 weeks" },
  { v: "within_month", l: "Within a month" },
  { v: "full", l: "Currently full" },
];
const STYLE_TAGS = [
  { v: "structured", l: "Structured / skills-based" },
  { v: "warm_supportive", l: "Warm & supportive" },
  { v: "direct_practical", l: "Direct & practical" },
  { v: "trauma_informed", l: "Trauma-informed" },
  { v: "insight_oriented", l: "Insight-oriented" },
  { v: "faith_informed", l: "Faith-informed" },
  { v: "culturally_responsive", l: "Culturally responsive" },
  { v: "lgbtq_affirming", l: "LGBTQ+ affirming" },
];
const MODALITY_OFFERINGS = [
  { v: "telehealth", l: "Telehealth only" },
  { v: "in_person", l: "In-person only" },
  { v: "both", l: "Both telehealth and in-person" },
];
const GENDERS = [
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "nonbinary", l: "Nonbinary" },
];

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
  // Pre-launch gap-recruit attribution: every recruit email includes
  // `?recruit_code=XXXXXXXX` so we can track which gap-fill invite drove
  // a signup. Sent through to the backend on submit.
  const recruitCode = searchParams.get("recruit_code");

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
  const totalSteps = 8;
  const formCardRef = useRef(null);
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
    if (s === 8) return true; // notifications optional
    return true;
  };

  // Aggregate validity across all steps (used by the Preview button on the
  // final step + the Submit button inside the modal).
  const valid = [1, 2, 3, 4, 5, 6, 7, 8].every(canAdvance);

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
    return "";
  };

  const [therapistId, setTherapistId] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [trialActivated, setTrialActivated] = useState(false);

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
            toast.success("Free trial started — you're all set!");
          } else {
            toast.error("Payment session not complete; please try again.");
          }
          // Clean URL
          window.history.replaceState({}, "", "/therapists/join");
        })
        .catch(() => toast.error("Could not finalize subscription"));
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
    } catch (_) {
      /* ignore parse errors */
    }
  }, []);

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        ...data,
        // Keep `phone` mirroring the alert phone for legacy SMS routing
        phone: data.phone_alert?.trim() || data.phone || "",
        referred_by_code: inviteCode || data.referred_by_code || null,
        recruit_code: recruitCode || null,
      };
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
      } catch (_) {
        /* sessionStorage may be disabled */
      }
      toast.success("Profile received — please add a payment method to start your free trial.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed");
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
          <Header minimal />
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
              <Link
                to="/"
                className="tv-btn-primary mt-8 inline-flex"
                data-testid="signup-success-home"
              >
                Back home
              </Link>
            </div>
          </main>
          <Footer />
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header minimal />
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
              {checkoutLoading ? "Redirecting…" : "Add payment method & start free trial"}
              <ArrowRight size={18} className="inline ml-2" />
            </button>
            <Link
              to="/sign-in?role=therapist"
              className="tv-btn-secondary mt-3 inline-flex"
              data-testid="signup-success-home"
            >
              I'll do this later
            </Link>
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
                For licensed therapists
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-[1.05]">
                You focus on <em className="not-italic text-[#C87965]">care</em> —
                we provide the referrals.
              </h1>
              <p className="mt-5 text-[#2B2A29]/80 leading-relaxed">
                Marketing yourself to attract the right patients can feel
                frustrating and time-consuming. We do all the work by sending
                pre-screened referrals straight to your inbox — so you can spend
                your hours on clients, not on SEO.
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
                  Sign up — start free trial <ArrowRight size={18} />
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
            <Accordion type="single" collapsible className="mt-8" data-testid="therapist-faq">
              {THERAPIST_FAQS.map((f) => (
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
                {step === 1 && (<>
                <Group title="Basics">
                  <Field label="Profile photo (optional)">                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center">
                        {data.profile_picture ? (
                          <img
                            src={data.profile_picture}
                            alt="Profile preview"
                            className="w-full h-full object-cover"
                            data-testid="signup-photo-preview"
                          />
                        ) : (
                          <Camera size={22} className="text-[#6D6A65]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <label
                          className="tv-btn-secondary !py-2 !px-4 text-sm cursor-pointer inline-flex"
                          data-testid="signup-photo-label"
                        >
                          {data.profile_picture ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            data-testid="signup-photo-input"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const url = await imageToDataUrl(f);
                                set("profile_picture", url);
                              } catch (err) {
                                toast.error(err.message || "Couldn't process image");
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {data.profile_picture && (
                          <button
                            type="button"
                            className="ml-3 text-sm text-[#D45D5D] hover:underline"
                            onClick={() => set("profile_picture", null)}
                            data-testid="signup-photo-remove"
                          >
                            Remove
                          </button>
                        )}
                        <p className="text-xs text-[#6D6A65] mt-1.5">
                          A square headshot works best. Resized to 256×256, &lt;500KB.
                        </p>
                      </div>
                    </div>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label={<>Full name + degree <Req /></>}
                      hint="e.g. Sarah Lin, LCSW"
                    >
                      <Input
                        value={data.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Sarah Lin, LCSW"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-name"
                      />
                    </Field>
                    <Field label={<>Credential type <Req /></>}>
                      <select
                        value={data.credential_type}
                        onChange={(e) => set("credential_type", e.target.value)}
                        className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
                        data-testid="signup-credential-type"
                      >
                        <option value="">Select credential type…</option>
                        {CREDENTIAL_TYPES.map((c) => (
                          <option key={c.v} value={c.v}>{c.l}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={<>Email <Req /></>}>
                      <Input
                        type="email"
                        value={data.email}
                        onChange={(e) => set("email", e.target.value)}
                        placeholder="you@practice.com"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-email"
                      />
                    </Field>
                    <Field
                      label="Website (public)"
                      hint="We'll auto-prefix https:// and check the link works."
                    >
                      <Input
                        type="url"
                        value={data.website}
                        onChange={(e) => {
                          set("website", e.target.value);
                          setWebsiteError("");
                        }}
                        onBlur={() => {
                          if (data.website && !websiteIsValid(data.website)) {
                            setWebsiteError(
                              "That doesn't look like a valid URL — try e.g. yourpractice.com",
                            );
                          }
                        }}
                        placeholder="yourpractice.com"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-website"
                      />
                      {websiteError && (
                        <p
                          className="mt-1.5 text-xs text-[#D45D5D]"
                          data-testid="signup-website-error"
                        >
                          {websiteError}
                        </p>
                      )}
                    </Field>
                    <Field
                      label={<>Phone (private, alerts)</>}
                      hint="Optional — for SMS alerts when new referrals match. Never shown to patients."
                    >
                      <Input
                        type="tel"
                        inputMode="tel"
                        maxLength={12}
                        value={data.phone_alert || data.phone}
                        onChange={(e) =>
                          set("phone_alert", formatUsPhone(e.target.value))
                        }
                        placeholder="208-555-0123"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-phone-alert"
                      />
                    </Field>
                    <Field
                      label={<>Office phone (public) <Req /></>}
                      hint="Patients see this on your profile."
                    >
                      <Input
                        type="tel"
                        inputMode="tel"
                        maxLength={12}
                        value={data.office_phone}
                        onChange={(e) =>
                          set("office_phone", formatUsPhone(e.target.value))
                        }
                        placeholder="208-555-0150"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-office-phone"
                      />
                    </Field>
                  </div>
                  <Field label={<>Gender <Req /></>} hint="Used only when patients have a stated preference.">
                    <PillRow
                      items={GENDERS}
                      selected={[data.gender]}
                      onSelect={(v) => set("gender", v)}
                      testid="signup-gender"
                    />
                  </Field>
                </Group>
                </>)}

                {step === 2 && (<>
                <Group
                  title="License & verification"
                  hint="We verify every therapist's license before they go live."
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={<>License state <Req /></>}
                      hint="We're currently live in Idaho only — multi-state coming soon."
                    >
                      <select
                        value={(data.licensed_states && data.licensed_states[0]) || "ID"}
                        onChange={(e) => set("licensed_states", [e.target.value])}
                        className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
                        data-testid="signup-license-state"
                      >
                        <option value="ID">Idaho (ID)</option>
                      </select>
                    </Field>                    <Field label={<>License number <Req /></>}>
                      <Input
                        value={data.license_number}
                        onChange={(e) => set("license_number", e.target.value)}
                        placeholder="e.g. LCSW-12345"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-license-number"
                      />
                    </Field>
                  </div>
                  <Field label={<>License expiration date <Req /></>}>
                    <Input
                      type="date"
                      value={data.license_expires_at || ""}
                      onChange={(e) => set("license_expires_at", e.target.value)}
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="signup-license-expires"
                    />
                  </Field>
                  <Field
                    label={<>Upload a photo of your license <Req /></>}
                    hint="Required so we can manually verify your credentials match. PNG, JPG or PDF. Patients never see this."
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-24 h-16 rounded-lg bg-[#FDFBF7] border border-dashed border-[#E8E5DF] overflow-hidden flex items-center justify-center">
                        {data.license_picture ? (
                          <img
                            src={data.license_picture}
                            alt="License preview"
                            className="w-full h-full object-cover"
                            data-testid="signup-license-preview"
                          />
                        ) : (
                          <Camera size={20} className="text-[#6D6A65]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <label
                          className="tv-btn-secondary !py-2 !px-4 text-sm cursor-pointer inline-flex"
                          data-testid="signup-license-label"
                        >
                          {data.license_picture ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,application/pdf"
                            className="hidden"
                            data-testid="signup-license-input"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const url = await imageToDataUrl(f);
                                set("license_picture", url);
                              } catch (err) {
                                toast.error(err.message || "Couldn't process file");
                              }
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {data.license_picture && (
                          <button
                            type="button"
                            className="ml-3 text-sm text-[#D45D5D] hover:underline"
                            onClick={() => set("license_picture", null)}
                            data-testid="signup-license-remove"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </Field>
                </Group>
                </>)}

                {step === 3 && (<>
                <Group
                  title="Who do you see?"
                  hint="Required — patients are pre-filtered by these"
                >
                  <Field label={<>Client types <Req /></>}>
                    <PillRow
                      items={CLIENT_TYPES}
                      selected={data.client_types}
                      onSelect={(v) => toggleArr("client_types", v)}
                      testid="signup-client-type"
                    />
                  </Field>
                  <Field label={<>Age groups <span className="text-xs text-[#6D6A65] font-normal">(pick up to 3)</span> <Req /></>}>
                    <PillRow
                      items={AGE_GROUPS}
                      selected={data.age_groups}
                      onSelect={(v) => toggleArr("age_groups", v, 3)}
                      testid="signup-age-group"
                    />
                  </Field>
                </Group>
                </>)}

                {step === 4 && (<>
                <Group
                  title="Specialties"
                  hint="Tap an issue, then choose its tier. Higher tier = stronger match score. (At least 1 Primary required.)"
                >
                  <div className="space-y-2.5">
                    {ISSUES.map((iss) => {
                      const tier = issueTier(iss.v);
                      const tiersAvail = {
                        primary: data.primary_specialties.length < 2 || tier === "primary",
                        secondary:
                          data.secondary_specialties.length < 3 || tier === "secondary",
                        general:
                          data.general_treats.length < 5 || tier === "general",
                      };
                      return (
                        <div
                          key={iss.v}
                          className="flex items-center justify-between gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2"
                          data-testid={`signup-issue-${iss.v}`}
                        >
                          <span className="text-sm text-[#2B2A29] flex-1">
                            {iss.l}
                          </span>
                          <div className="flex gap-1">
                            {[
                              ["primary", "Primary", "#2D4A3E"],
                              ["secondary", "Secondary", "#3A5E50"],
                              ["general", "General", "#6D6A65"],
                              [null, "—", "#E8E5DF"],
                            ].map(([t, lbl, color]) => {
                              const active = tier === t;
                              const disabled = t && !tiersAvail[t];
                              return (
                                <button
                                  key={lbl}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => setIssueTier(iss.v, t)}
                                  data-testid={`signup-issue-${iss.v}-${t || "none"}`}
                                  className={`text-xs px-2.5 py-1 rounded-md border transition ${
                                    active
                                      ? "text-white border-transparent"
                                      : disabled
                                        ? "text-[#6D6A65]/40 border-[#E8E5DF] cursor-not-allowed"
                                        : "text-[#6D6A65] border-[#E8E5DF] hover:border-[#2D4A3E]"
                                  }`}
                                  style={active ? { background: color } : {}}
                                >
                                  {lbl}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-[#6D6A65] mt-3">
                    Primary: {data.primary_specialties.length}/2 · Secondary:{" "}
                    {data.secondary_specialties.length}/3 · General:{" "}
                    {data.general_treats.length}/5
                  </p>
                </Group>
                </>)}

                {step === 5 && (<>
                <Group title={<>Modalities you practice (pick 1–6) <Req /></>}>
                  <div className="flex flex-wrap gap-2">
                    {MODALITIES.map((m) => {
                      const active = data.modalities.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleArr("modalities", m, 6)}
                          data-testid={`signup-modality-${m}`}
                          className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                            active
                              ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                              : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                          }`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </Group>

                <Group title="Practice format & availability">
                  <Field label={<>Where do you see clients? <Req /></>}>
                    <PillRow
                      items={MODALITY_OFFERINGS}
                      selected={[data.modality_offering]}
                      onSelect={(v) => set("modality_offering", v)}
                      testid="signup-modality-offering"
                    />
                  </Field>
                  {data.modality_offering !== "telehealth" && (
                    <Field
                      label={<>Office addresses (Idaho) <Req /></>}
                      hint="Patients see these on your profile. We use them to match you within ~30 miles of patient cities/ZIPs."
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <Input
                          value={officeAddress}
                          onChange={(e) => setOfficeAddress(e.target.value)}
                          placeholder="Street address (e.g. 123 W Main St, Suite 200)"
                          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-7"
                          data-testid="signup-office-street"
                        />
                        <Input
                          value={officeCity}
                          onChange={(e) => setOfficeCity(e.target.value)}
                          placeholder="City"
                          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-3"
                          data-testid="signup-office-city"
                        />
                        <Input
                          value={officeZip}
                          onChange={(e) => setOfficeZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                          placeholder="ZIP"
                          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-2"
                          data-testid="signup-office-zip"
                        />
                      </div>
                      <button
                        type="button"
                        className="tv-btn-secondary !py-2 !px-4 text-sm mt-2"
                        onClick={() => {
                          const street = officeAddress.trim();
                          const city = officeCity.trim();
                          const zip = officeZip.trim();
                          if (!street || !city || !zip) {
                            toast.error("Street, city, and ZIP are all required.");
                            return;
                          }
                          const full = `${street}, ${city}, ID ${zip}`;
                          set("office_addresses", [...data.office_addresses, full]);
                          // Keep cities in sync for back-compat geocoder
                          set("office_locations", [...data.office_locations, city]);
                          setOfficeAddress("");
                          setOfficeCity("");
                          setOfficeZip("");
                        }}
                        data-testid="signup-office-add"
                      >
                        <Plus size={14} className="inline mr-1" /> Add office
                      </button>
                      <Tags
                        items={data.office_addresses}
                        onRemove={(addr) => {
                          set(
                            "office_addresses",
                            data.office_addresses.filter((x) => x !== addr),
                          );
                          // Drop the matching city from office_locations too
                          const cityFromAddr = addr.split(",")[1]?.trim();
                          if (cityFromAddr) {
                            set(
                              "office_locations",
                              data.office_locations.filter((c) => c !== cityFromAddr),
                            );
                          }
                        }}
                      />
                    </Field>
                  )}
                  <Field label={<>Sessions you can offer <Req /></>}>
                    <PillRow
                      items={AVAILABILITY}
                      selected={data.availability_windows}
                      onSelect={(v) => toggleArr("availability_windows", v)}
                      testid="signup-availability"
                    />
                  </Field>
                  <Field label="Current caseload">
                    <PillRow
                      items={URGENCY_CAPACITIES}
                      selected={[data.urgency_capacity]}
                      onSelect={(v) => set("urgency_capacity", v)}
                      testid="signup-urgency"
                    />
                  </Field>
                </Group>
                </>)}

                {step === 6 && (<>
                <Group
                  title="Insurance accepted (optional)"
                  hint="Tap any plans you're in-network with — this helps patients on insurance see you. If your plan isn't listed, add it under 'Other'."
                >
                  <div className="flex flex-wrap gap-2">
                    {IDAHO_INSURERS.map((i) => {
                      const active = data.insurance_accepted.includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleArr("insurance_accepted", i)}
                          data-testid={`signup-insurance-${i}`}
                          className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                            active
                              ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                              : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                          }`}
                        >
                          {i}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-2 items-end">
                    <Field label="Other (specify) — added to your accepted list" hint="Comma-separated for multiple plans.">
                      <Input
                        value={insuranceOther}
                        onChange={(e) => setInsuranceOther(e.target.value)}
                        placeholder="e.g. SelectHealth, IEHP"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-insurance-other"
                      />
                    </Field>
                    <button
                      type="button"
                      className="tv-btn-secondary !py-2 !px-4 text-sm shrink-0 mb-px"
                      onClick={() => {
                        const parts = insuranceOther
                          .split(",")
                          .map((p) => p.trim())
                          .filter(Boolean);
                        if (parts.length === 0) return;
                        const merged = Array.from(
                          new Set([...data.insurance_accepted, ...parts]),
                        );
                        set("insurance_accepted", merged);
                        setInsuranceOther("");
                      }}
                      data-testid="signup-insurance-other-add"
                    >
                      <Plus size={14} className="inline mr-1" /> Add
                    </button>
                  </div>
                </Group>

                <Group title="Rates & experience">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label={<>Cash rate per session ($) <Req /></>}>
                      <Input
                        type="number"
                        value={data.cash_rate}
                        onChange={(e) =>
                          set("cash_rate", parseInt(e.target.value, 10) || 0)
                        }
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-cash-rate"
                      />
                    </Field>
                    <Field label={<>Years of experience <Req /></>}>
                      <Input
                        type="number"
                        value={data.years_experience}
                        onChange={(e) =>
                          set("years_experience", parseInt(e.target.value, 10) || 0)
                        }
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-years"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
                      <Checkbox
                        checked={data.free_consult}
                        onCheckedChange={(v) => set("free_consult", v)}
                        className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                        data-testid="signup-free-consult"
                      />
                      <div>
                        <div className="text-sm font-medium text-[#2B2A29]">
                          Free initial consult
                        </div>
                        <div className="text-xs text-[#6D6A65]">
                          Increases match-rate notably
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
                      <Checkbox
                        checked={data.sliding_scale}
                        onCheckedChange={(v) => set("sliding_scale", v)}
                        className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                        data-testid="signup-sliding-scale"
                      />
                      <div>
                        <div className="text-sm font-medium text-[#2B2A29]">
                          Sliding-scale rates available
                        </div>
                        <div className="text-xs text-[#6D6A65]">
                          Patients with budget constraints will see you
                        </div>
                      </div>
                    </label>
                  </div>
                </Group>
                </>)}

                {step === 7 && (<>
                <Group title={<>How would you describe your style? <Req /></>}>
                  <PillRow
                    items={STYLE_TAGS}
                    selected={data.style_tags}
                    onSelect={(v) => toggleArr("style_tags", v)}
                    testid="signup-style"
                  />
                </Group>

                <Group title="Short bio (optional)" hint="2–3 sentences. Patients see this on their results page.">
                  <Textarea
                    rows={4}
                    value={data.bio}
                    onChange={(e) => set("bio", e.target.value)}
                    placeholder="I'm a Boise-based LCSW with 10+ years..."
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="signup-bio"
                  />
                </Group>
                </>)}

                {step === 8 && (<>
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
                    data-testid="signup-back"
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
                    data-testid="signup-next"
                  >
                    {websiteChecking ? "Checking…" : "Next"} <ArrowRight size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!valid || submitting}
                    onClick={() => setShowPreview(true)}
                    data-testid="signup-preview"
                  >
                    Preview profile <ArrowRight size={18} />
                  </button>
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

function PreviewModal({ data, onClose, onConfirm, submitting }) {
  const formats = {
    telehealth: "Telehealth only",
    in_person: "In-person only",
    both: "Telehealth + in-person",
  };
  const tier = (issue) => {
    if (data.primary_specialties.includes(issue)) return "Primary";
    if (data.secondary_specialties.includes(issue)) return "Secondary";
    if (data.general_treats.includes(issue)) return "General";
    return null;
  };
  const allIssues = [
    ...data.primary_specialties,
    ...data.secondary_specialties,
    ...data.general_treats,
  ];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      data-testid="signup-preview-modal"
    >
      <div className="bg-white rounded-3xl border border-[#E8E5DF] max-w-2xl w-full p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
              Profile preview
            </p>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-1">
              How patients will see you
            </h3>
            <p className="text-sm text-[#6D6A65] mt-1.5 max-w-md">
              Verify everything looks right before submitting. You can still edit afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6D6A65] hover:text-[#2D4A3E] -m-2 p-2"
            data-testid="signup-preview-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex gap-4">
          <div className="w-16 h-16 rounded-full bg-white border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0">
            {data.profile_picture ? (
              <img src={data.profile_picture} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-serif-display text-base text-[#2D4A3E]">
                {(data.name || "")
                  .split(",")[0]
                  .split(" ")
                  .filter(Boolean)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "T"}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-serif-display text-xl text-[#2D4A3E] truncate">
              {data.name || "—"}
            </h4>
            <div className="text-xs text-[#6D6A65] mt-0.5">
              {data.years_experience || "—"} yrs •{" "}
              {(data.modalities || []).slice(0, 3).join(" · ") || "—"}
            </div>
          </div>
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <SummaryRow label="Email" value={data.email} />
          <SummaryRow label="Credential" value={data.credential_type} />
          <SummaryRow label="License #" value={data.license_number} />
          <SummaryRow label="License expires" value={data.license_expires_at} />
          <SummaryRow label="Office phone (public)" value={data.office_phone || "—"} />
          <SummaryRow label="Alert phone (private)" value={data.phone_alert || data.phone} />
          <SummaryRow label="Gender" value={data.gender} />
          <SummaryRow label="Format" value={formats[data.modality_offering] || data.modality_offering} />
          <SummaryRow label="Cash rate" value={data.cash_rate ? `$${data.cash_rate}` : "—"} />
          <SummaryRow label="Sliding scale" value={data.sliding_scale ? "Yes" : "No"} />
          <SummaryRow label="Free consult" value={data.free_consult ? "Yes" : "No"} />
          <SummaryRow label="Caseload" value={data.urgency_capacity?.replace(/_/g, " ")} />
          <SummaryRow
            label="Client types"
            value={data.client_types?.join(", ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Age groups"
            value={(data.age_groups || []).map((a) => a.replace(/_/g, " ")).join(", ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Specialties"
            value={
              allIssues.length > 0
                ? allIssues.map((i) => `${i.replace(/_/g, " ")} (${tier(i)})`).join(", ")
                : "—"
            }
            span={2}
          />
          <SummaryRow
            label="Modalities"
            value={(data.modalities || []).join(", ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Offices"
            value={(data.office_addresses || data.office_locations || []).join(" · ") || "—"}
            span={2}
          />
          <SummaryRow
            label="Insurance"
            value={(data.insurance_accepted || []).join(", ") || "Cash / OON"}
            span={2}
          />
          <SummaryRow
            label="Availability"
            value={
              (data.availability_windows || []).map((w) => w.replace(/_/g, " ")).join(", ") || "—"
            }
            span={2}
          />
          <SummaryRow
            label="Style"
            value={(data.style_tags || []).map((s) => s.replace(/_/g, " ")).join(", ") || "—"}
            span={2}
          />
          {data.bio && <SummaryRow label="Bio" value={data.bio} span={2} />}
        </div>

        {data.license_picture && (
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
              License upload (admin verification)
            </div>
            <img
              src={data.license_picture}
              alt="License upload"
              className="max-h-40 rounded-lg border border-[#E8E5DF]"
            />
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            className="tv-btn-secondary !py-2 !px-4 text-sm"
            onClick={onClose}
            data-testid="signup-preview-back"
          >
            Back to edit
          </button>
          <button
            type="button"
            className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting}
            onClick={onConfirm}
            data-testid="signup-preview-confirm"
          >
            {submitting ? "Submitting..." : "Looks good — submit"} <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? "sm:col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-medium text-[#2B2A29] break-words">{value || "—"}</div>
    </div>
  );
}

// Colored card per section — pick a stable accent color based on the title hash
// so each Group is visually distinct without depending on render order.
const GROUP_PALETTE = [
  { bg: "#FDF7EC", border: "#E8DCC1", accent: "#C87965" }, // warm cream
  { bg: "#F2F4F0", border: "#D9DDD2", accent: "#2D4A3E" }, // sage
  { bg: "#FBF5F2", border: "#EBD5CB", accent: "#A8553F" }, // dusty rose
  { bg: "#F4F1EC", border: "#E0D9CC", accent: "#6E5530" }, // taupe
  { bg: "#EFF2F6", border: "#D5DCE4", accent: "#3F5775" }, // muted blue
];
function _hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function Group({ title, hint, children }) {
  const c = GROUP_PALETTE[_hash(title || "x") % GROUP_PALETTE.length];
  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border-l-4"
      style={{ background: c.bg, borderColor: c.accent, borderLeftColor: c.accent }}
    >
      <div
        className="font-semibold text-sm uppercase tracking-wider"
        style={{ color: c.accent }}
      >
        {title}
      </div>
      {hint && <div className="text-xs text-[#6D6A65] mt-1">{hint}</div>}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

// Field with optional hint. Hint renders BELOW the input so labels in a grid
// row stay vertically aligned (otherwise a hint inflates the label height and
// only that column's input drops down). Use `hint` for SMS / public-disclosure
// disclaimers and `topHint` only when explicit pre-input context is essential.
function Field({ label, hint, topHint, children }) {
  return (
    <div className="flex flex-col">
      <label className="block text-xs font-semibold text-[#6D6A65] mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {topHint && (
        <div className="text-[11px] text-[#6D6A65] -mt-1 mb-1.5 normal-case tracking-normal">
          {topHint}
        </div>
      )}
      {children}
      {hint && (
        <p className="mt-1.5 text-[11px] text-[#6D6A65] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

// Red asterisk used inline next to required field labels.
function Req() {
  return (
    <span className="text-[#D45D5D] ml-0.5" aria-label="required">
      *
    </span>
  );
}

function PillRow({ items, selected, onSelect, testid }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            type="button"
            key={it.v}
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
          >
            {it.l}
          </button>
        );
      })}
    </div>
  );
}

function Tags({ items, onRemove }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((c) => (
        <span
          key={c}
          className="inline-flex items-center gap-1.5 text-sm bg-[#2D4A3E]/10 text-[#2D4A3E] px-3 py-1 rounded-full"
        >
          {c}
          <button onClick={() => onRemove(c)} className="hover:text-[#D45D5D]">
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
