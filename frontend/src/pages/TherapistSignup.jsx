import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import useFaqs from "@/lib/useFaqs";
import useSiteCopy from "@/lib/useSiteCopy";
import { api, sessionClient, setSession } from "@/lib/api";
import { formatUsPhone } from "@/lib/phone";
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
// Deep-match T4/T6 options live in
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
    a: "Yes — email support@theravoca.com with 'Pause referrals' in the subject and we'll stop sending you new patient matches that same business day. Your profile stays visible, your subscription continues, and any referrals already in your inbox are unaffected (you can decline them individually). Email us again to resume.",
  },
  {
    q: "How do I get paid?",
    a: "TheraVoca only handles the intro. Payment for sessions happens directly between you and the patient on whatever billing system you already use.",
  },
  {
    q: "Can I download a copy of my data, or delete my account?",
    a: "Yes to both. Email support@theravoca.com with the subject line 'Download my data' or 'Delete my account'. We'll send you an Excel workbook with everything on file (profile, referrals you received, declines, feedback about you) within one business day, or permanently remove your account on confirmation. Account deletion also cancels your active TheraVoca subscription at end-of-period — no surprise renewals — and is reversible within a 24-hour window. We handle these by email so a real person can confirm what you're asking for and answer questions.",
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
    // SMS opt-in defaults OFF -- therapist must explicitly check the
    // "Also text me" box on step 9 to receive texts. CTIA-compliant
    // disclosure is shown next to the checkbox.
    notify_sms: false,
    // ── Deep-match (v2 spec, Iter-89) ──────────────────────────
    // Required at signup so the matching engine has a complete picture
    // of clinical style. T4 picks 1 of 5.
    // T5 is open text used for embedding-based context scoring.
    t4_hard_truth: "",
    t5_lived_experience: "",
    t6_session_expectations: [],
    t6_early_sessions_description: "",
    // Explicit consent to the Therapist Terms of Use. Required to submit.
    agreed_to_therapist_terms: false,
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
  // Track widget render lifecycle so we can show the user a real
  // status (loading vs failed vs ready) instead of a blank slot
  // when something blocks the Cloudflare script (ad blocker, strict
  // privacy extension, network filter). 2026-05-16 bug: Josh saw a
  // submit error with no visible Turnstile widget on the page --
  // the widget never rendered AND there was no signal explaining
  // why.
  const [turnstileWidgetState, setTurnstileWidgetState] = useState("loading"); // loading|ready|failed
  const turnstileRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const [turnstileEnabled, setTurnstileEnabled] = useState(
    !!process.env.REACT_APP_TURNSTILE_SITE_KEY,
  );
  const [turnstileSiteKeyFromApi, setTurnstileSiteKeyFromApi] = useState(null);
  const turnstileSiteKey = turnstileEnabled
    ? (turnstileSiteKeyFromApi || process.env.REACT_APP_TURNSTILE_SITE_KEY || "")
    : "";
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/config/turnstile");
        if (alive) {
          setTurnstileEnabled(!!r.data?.enabled);
          if (r.data?.site_key) setTurnstileSiteKeyFromApi(r.data.site_key);
        }
      } catch (_) {
        /* keep env-var fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  // 2026-05-17 ROOT-CAUSE FIX (was: render() never called on therapist
  // signup because turnstileRef.current was null when this effect ran
  // on mount — the widget div is only rendered on the FINAL step
  // [step 9], but this useEffect's only dependency was
  // turnstileSiteKey, so it ran exactly once on mount and skipped the
  // render call because the ref was null). IntakeForm.jsx doesn't
  // have this bug because its widget div is in the always-visible
  // form body. Fix: add `step` to the dependency array and gate the
  // render-call branch on `step === totalSteps` so we re-attempt
  // render exactly when the user reaches the page that mounts the
  // div. The 12-second fail timer ALSO only arms once we hit the
  // final step, so a user spending 5 minutes on early steps doesn't
  // burn the timeout against a not-yet-mounted div.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    // Only attempt render when the widget div is actually in the DOM
    // (final step). On earlier steps, the div doesn't exist yet.
    if (step !== totalSteps) return;
    // If a previous render already succeeded, don't double-render.
    if (turnstileWidgetIdRef.current != null) return;
    const SCRIPT_ID = "cf-turnstile-script";
    const ensureScript = () =>
      new Promise((resolve, reject) => {
        if (window.turnstile) return resolve();
        const existing = document.getElementById(SCRIPT_ID);
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("script-onerror")));
          return;
        }
        const s = document.createElement("script");
        s.id = SCRIPT_ID;
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        // Ad blocker / network filter blocking the script.
        s.onerror = () => reject(new Error("script-onerror"));
        document.head.appendChild(s);
      });
    let cancelled = false;
    // Fallback: if the widget hasn't rendered (still no token, still
    // "loading") after 12s, flip to "failed" so the UI tells the
    // user something useful instead of leaving them staring at an
    // empty slot.
    const failTimer = setTimeout(() => {
      if (!cancelled) {
        setTurnstileWidgetState((s) => (s === "loading" ? "failed" : s));
      }
    }, 12000);
    ensureScript()
      .then(() => {
        if (cancelled || !turnstileRef.current || !window.turnstile) return;
        if (turnstileWidgetIdRef.current != null) return; // raced -- skip
        try {
          turnstileWidgetIdRef.current = window.turnstile.render(turnstileRef.current, {
            sitekey: turnstileSiteKey,
            theme: "light",
            size: "flexible",
            // Mobile-stability options -- match IntakeForm. Without these
            // therapists hitting Submit after spending >5 min on the form
            // see a silent "Security check failed." because the widget's
            // token quietly expired.
            "refresh-expired": "auto",
            retry: "auto",
            "retry-interval": 4000,
            callback: (tok) => {
              setTurnstileToken(tok || "");
              if (tok) setTurnstileWidgetState("ready");
            },
            // Log Cloudflare's error args + sitekey prefix so future
            // failures self-document. Common codes:
            //   110100/110200 invalid sitekey
            //   110620 hostname not allowed (since 2024 rename)
            //   400020 invalid sitekey format
            //   600010 timeout
            "error-callback": (...args) => {
              // eslint-disable-next-line no-console
              console.error(
                "[TheraVoca] Turnstile error-callback",
                "args=", args,
                "sitekey_prefix=", String(turnstileSiteKey || "").slice(0, 10) + "...",
                "hostname=", typeof window !== "undefined" ? window.location.hostname : "?",
              );
              setTurnstileToken("");
              setTurnstileWidgetState("failed");
            },
            "expired-callback": () => setTurnstileToken(""),
            "timeout-callback": () => setTurnstileToken(""),
          });
        } catch (_) { /* ignore double-render */ }
      })
      .catch(() => {
        if (!cancelled) setTurnstileWidgetState("failed");
      });
    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      // 2026-05-18 fix (Josh: "if you have to go back to edit and
      // it won't let you submit b/c of security failed, fix that").
      // When the user navigates AWAY from step 9 (Back button OR
      // step-anchor click), tear down the Cloudflare widget AND
      // clear the ID ref. Without this, the early-return guard
      // `if (turnstileWidgetIdRef.current != null) return` would
      // bail next time the user reaches step 9 -- the widget
      // never re-mounts, the token stays stale/empty, and submit
      // fails with no way to recover except a full page reload
      // (which wipes the form). With this cleanup, every visit to
      // step 9 gets a fresh widget + fresh token.
      if (turnstileWidgetIdRef.current != null) {
        try {
          window.turnstile?.remove(turnstileWidgetIdRef.current);
        } catch (_) { /* ignore -- widget may already be gone */ }
        turnstileWidgetIdRef.current = null;
        setTurnstileToken("");
        setTurnstileWidgetState("loading");
      }
    };
  }, [turnstileSiteKey, step, totalSteps]);
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
    // 2026-05-18 (Josh: "getting wrong errors when inputting
    // website, these should work from a copypaste -
    // https://manhattanpsychologygroup.com/, https://theravoca.com/").
    //
    // The browser-side fetch(no-cors) check was UNRELIABLE -- many
    // legitimate sites can't be fetched cross-origin from the browser
    // regardless of whether they're actually live, because of CORS /
    // CORB / mixed-content / TLS handshake quirks the network layer
    // throws BEFORE our try/catch sees a response. Result: real
    // therapists got "couldn't reach that website" on real, working
    // URLs and had to leave the field blank.
    //
    // Replacement strategy:
    //   - websiteIsValid() already URL-constructor-validates the
    //     string (catches typos like "googcom" or "htps://foo").
    //   - normalizeWebsite() prefixes https:// when missing.
    //   - Admin manually reviews every therapist signup for license
    //     verification anyway, so bad URLs get caught there.
    //   - A future server-side reachability check (no CORS in the
    //     backend) could be layered on if we see abuse, but for v1
    //     trust the admin review gate.
    //
    // Function kept on the signature so any call site that still
    // awaits it keeps working; always resolves true.
    if (!normalizeWebsite(raw)) return true;
    return true;
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

  // Check that the name field contains a credential suffix after a comma
  // e.g. "Sarah Lin, LCSW" — not just "Sarah Lin"
  const KNOWN_CREDENTIALS = [
    "LCSW","LPC","LCPC","LPCC","LMFT","LMHC","PhD","PsyD","MD",
    "DO","LICSW","LISW","LMSW","MSW","MFT","NP","PMHNP","RN",
    "LAMFT","LAPC","LGPC","LLPC","LSCSW","LCMHC",
  ];
  const nameHasCredential = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed.includes(",")) return false;
    const afterComma = trimmed.split(",").slice(1).join(",").trim().toUpperCase();
    if (!afterComma) return false;
    // Both sides uppercased so mixed-case entries in KNOWN_CREDENTIALS
    // ("PhD", "PsyD") match against the upper-cased input. Without the
    // .toUpperCase() on the credential, "PHD".includes("PhD") is false
    // and any therapist with PhD / PsyD in their name was blocked at
    // step 1 of signup.
    return KNOWN_CREDENTIALS.some((c) => afterComma.includes(c.toUpperCase()));
  };

  // Per-step validation — mirrors the required-field asterisks. Each step's
  // "Next" button is disabled until canAdvance(step) is true.
  const canAdvance = (s) => {
    if (s === 1) {
      return (
        data.name.trim().length >= 3 &&
        nameHasCredential(data.name) &&
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
    if (s === 6) return data.cash_rate > 0 && data.years_experience >= 1;
    if (s === 7) return data.style_tags.length >= 1;
    if (s === 8) {
      const t6Len = (data.t6_session_expectations || []).length;
      return (
        !!data.t4_hard_truth &&
        (data.t5_lived_experience || "").trim().length >= 30 &&
        t6Len >= 1 && t6Len <= 2 &&
        (data.t6_early_sessions_description || "").trim().length >= 30
      );
    }
    if (s === 9) {
      // Notifications are optional, but Therapist Terms agreement is required.
      return !!data.agreed_to_therapist_terms;
    }
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
      if (!nameHasCredential(data.name))
        return "Include your credential after a comma (e.g. Sarah Lin, LCSW).";
      if (!data.email.includes("@")) return "Enter a valid email address.";
      if (!data.credential_type) return "Select your credential type.";
      // 2026-05-17: private SMS phone moved to Step 9 (notifications)
      // so the consent + the field live together. No longer a Step 1
      // requirement.
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
      if (!data.t4_hard_truth)
        return "Pick how you push a client past their comfort zone.";
      if ((data.t5_lived_experience || "").trim().length < 30)
        return "Share at least 30 characters of lived experience or community knowledge.";
      const t6Len = (data.t6_session_expectations || []).length;
      if (t6Len < 1) return "Pick at least one session expectation.";
      if ((data.t6_early_sessions_description || "").trim().length < 30)
        return "Describe your early sessions (at least 30 characters).";
      return "";
    }
    if (s === 9 && !data.agreed_to_therapist_terms)
      return "You must agree to the Therapist Terms of Use to submit.";
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
      // /sync-payment-method now requires the therapist session set on
      // signup (2026-05-16 security fix). sessionClient attaches the
      // bearer from sessionStorage. The same-tab Stripe redirect
      // preserves sessionStorage, so this call is authenticated as
      // long as the user completes Stripe in the original tab. If
      // they finish in a fresh browser, the session is gone and we
      // fall back to the welcome-email magic-link flow.
      sessionClient()
        .post(`/therapists/${subscribedId}/sync-payment-method`, { session_id: sessionId })
        .then((res) => {
          if (res.data?.ok) {
            setTrialActivated(true);
            setSubmitted(true);
            setTherapistId(subscribedId);
            sessionStorage.removeItem("tv_signup_pending");
            // No session_token issued by the backend anymore -- the
            // signup flow already set one. This branch becomes a
            // no-op for forward-compat with old responses (legacy
            // clients that hit the new backend won't see this field).
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
      setShowPreview(false);
      toast.error(
        "Security check still loading -- close this preview, give the box a few seconds to finish, then try again.",
        { duration: 8000 },
      );
      try {
        setTimeout(() => {
          turnstileRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 50);
      } catch (_) { /* old iOS Safari -- ignore */ }
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
      // T1/T3 removed from the deep-match flow — strip from payload
      // in case stale state lingers.
      delete payload.t1_stuck_ranked;
      delete payload.t3_breakthrough;
      const res = await api.post("/therapists/signup", payload);
      setTherapistId(res.data?.id);
      // Backend now returns a session_token on signup; persist it so
      // the immediate next call to /subscribe-checkout (which requires
      // a therapist session per the 2026-05-16 security fix) succeeds
      // without a magic-link round-trip.
      if (res.data?.session_token) {
        try {
          setSession({
            token: res.data.session_token,
            role: "therapist",
            email: payload.email,
          });
        } catch (e) {
          console.warn("setSession failed:", e?.message);
        }
      }
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
      // sessionClient attaches the bearer token from sessionStorage
      // (set above on signup). /subscribe-checkout now requires a
      // therapist session per the 2026-05-16 security fix.
      const res = await sessionClient().post(
        `/therapists/${therapistId}/subscribe-checkout`,
        {},
      );
      if (res.data?.url) {
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
                  <span className="text-[#6D6A65]">{t("btn.therapist.cta.subline", " · 30-day free trial · cancel anytime")}</span>
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
                {/* Floating "Referral received!" chips -- positioned to
                    avoid the subject's face. Two stacked at the bottom-right
                    over her hands/lap, one high in the top-left above the
                    hair line. */}
                <div className="absolute top-3 left-3 sm:left-4 bg-white/95 backdrop-blur rounded-full pl-2 pr-4 py-1.5 shadow-lg flex items-center gap-2 text-sm">
                  <span className="w-7 h-7 rounded-full bg-[#C87965] text-white text-[11px] flex items-center justify-center font-semibold">JS</span>
                  <span className="text-[#2B2A29] font-medium">Referral received!</span>
                  <span className="text-[#4A6B5D]">&#10003;</span>
                </div>
                <div className="absolute bottom-20 right-3 sm:right-4 bg-white/95 backdrop-blur rounded-full pl-2 pr-4 py-1.5 shadow-lg flex items-center gap-2 text-sm">
                  <span className="w-7 h-7 rounded-full bg-[#4A6B5D] text-white text-[11px] flex items-center justify-center font-semibold">MR</span>
                  <span className="text-[#2B2A29] font-medium">Referral received!</span>
                  <span className="text-[#4A6B5D]">&#10003;</span>
                </div>
                <div className="absolute bottom-6 right-3 sm:right-4 bg-white/95 backdrop-blur rounded-full pl-2 pr-4 py-1.5 shadow-lg flex items-center gap-2 text-sm">
                  <span className="w-7 h-7 rounded-full bg-[#2D4A3E] text-white text-[11px] flex items-center justify-center font-semibold">AK</span>
                  <span className="text-[#2B2A29] font-medium">Referral received!</span>
                  <span className="text-[#4A6B5D]">&#10003;</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="border-b border-[#E8E5DF] py-14 bg-white">
          <div className="max-w-5xl mx-auto px-5 sm:px-8">
            <div className="text-center mb-10 max-w-2xl mx-auto">
              <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
                {t("therapist.why.heading", "Why join TheraVoca")}
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
                  t: t("therapist.why.card1.title", "Only ideal-fit referrals"),
                  d: t("therapist.why.card1.body", "Pre-screened patient leads aligned with your specialties and schedule. Every match scores ≥ 70%."),
                },
                {
                  t: t("therapist.why.card2.title", "You're always in control"),
                  d: t("therapist.why.card2.body", "Review each referral and opt in — or pass. No pressure, no obligations."),
                },
                {
                  t: t("therapist.why.card3.title", "No public profile, no spam"),
                  d: t("therapist.why.card3.body", "Your info stays private until you say yes to a specific match."),
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
              {t("therapist.faq.heading", "FAQs for therapists")}
            </p>
            <h2 className="font-serif-display text-4xl text-[#2D4A3E] leading-tight text-center">
              {t("therapist.faq.subhead", "Common questions")}
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
                {/* Clickable step jump-nav (2026-05-18, Josh: "it's
                    annoying that you have to keep hitting back/next
                    if you want to make edits after you finish, add
                    anchors for each step at the top"). Lets the
                    therapist jump to any step they've already seen
                    -- forward jumps to unvisited steps are
                    permitted too, but the Next button's
                    canAdvance()/valid gates still block bad data
                    from progressing further. The clickable pills
                    sit just below the progress bar so the wizard
                    still feels linear but power-users can
                    teleport. */}
                <div
                  className="mt-3 flex flex-wrap gap-1.5"
                  data-testid="signup-step-nav"
                >
                  {[
                    "Basics",
                    "License",
                    "Who you see",
                    "Specialties",
                    "Format",
                    "Insurance",
                    "Style & bio",
                    "Deep match",
                    "Notifications",
                  ].map((label, i) => {
                    const stepNum = i + 1;
                    const isCurrent = step === stepNum;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setStep(stepNum);
                          scrollFormIntoView();
                        }}
                        title={`Jump to step ${stepNum}: ${label}`}
                        data-testid={`signup-step-jump-${stepNum}`}
                        className={`text-[11px] px-2 py-1 rounded-full border transition leading-none ${
                          isCurrent
                            ? "bg-[#2D4A3E] border-[#2D4A3E] text-white font-semibold"
                            : "bg-white border-[#E8E5DF] text-[#6D6A65] hover:border-[#2D4A3E] hover:text-[#2D4A3E]"
                        }`}
                      >
                        <span className="opacity-60 mr-1">{stepNum}.</span>
                        {label}
                      </button>
                    );
                  })}
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

                {/* ── Deep-match T2/T4/T5/T6/T6b ────────────
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
                  {/* 2026-05-17: private SMS phone moved here from Step 1
                      so the phone + the CTIA consent live in the same
                      place at signup checkout. The grey-out logic that
                      previously gated the SMS checkbox on "no phone
                      typed in step 1" is gone -- the input is right
                      above the checkbox now. */}
                  <div className="mt-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3">
                    <label
                      htmlFor="signup-phone-alert"
                      className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider"
                    >
                      Contact phone (private &mdash; for account issues &amp; SMS alerts)
                    </label>
                    <input
                      id="signup-phone-alert"
                      type="tel"
                      inputMode="tel"
                      maxLength={12}
                      value={data.phone_alert || data.phone || ""}
                      onChange={(e) => set("phone_alert", formatUsPhone(e.target.value))}
                      placeholder="208-555-0123"
                      className="mt-1.5 w-full bg-white border border-[#E8E5DF] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#2D4A3E]"
                      data-testid="signup-phone-alert"
                    />
                    <p className="mt-1.5 text-[11px] text-[#6D6A65]">
                      Not shown to patients. Only used for account issues
                      and (optionally) SMS referral alerts via the
                      checkbox below.
                    </p>
                  </div>
                  {/* SMS opt-in checkbox with full CTIA disclosure --
                      Telnyx + carrier compliance review requires the
                      consent language be visible AT the point of opt-in.
                      Checkbox is always interactive; if the phone above
                      is empty when the user submits, the send path
                      silently drops (and they can fix in the portal
                      later). Backend cron filters out empty phones at
                      send time. */}
                  <label
                    className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 mt-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={!!data.notify_sms}
                      onCheckedChange={(v) => set("notify_sms", !!v)}
                      data-testid="signup-notify-sms"
                      className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E] mt-0.5"
                    />
                    <span className="text-sm text-[#2B2A29] leading-relaxed">
                      <strong>Text me at the number above</strong> when a
                      new patient referral matches my profile.
                      <span className="block text-[11px] text-[#6D6A65] mt-1 leading-snug">
                        By checking this box, you consent to receive
                        recurring SMS from TheraVoca for account &amp;
                        referral notifications at the number above.
                        Message frequency varies (typically 1-3
                        messages/month). Message &amp; data rates may
                        apply. Reply <strong>STOP</strong> to unsubscribe,
                        reply <strong>HELP</strong> for help. See our{" "}
                        <a
                          href="/sms-terms"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2D4A3E] underline"
                        >
                          SMS Terms
                        </a>{" "}
                        and{" "}
                        <a
                          href="/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2D4A3E] underline"
                        >
                          Privacy Notice
                        </a>
                        . Consent is not a condition of using TheraVoca.
                      </span>
                    </span>
                  </label>
                </Group>
                <Group title="Agreement">
                  <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer">
                    <Checkbox
                      checked={data.agreed_to_therapist_terms}
                      onCheckedChange={(v) => set("agreed_to_therapist_terms", !!v)}
                      data-testid="signup-agree-terms"
                      className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E] mt-0.5"
                    />
                    <span className="text-sm text-[#2B2A29] leading-relaxed">
                      I agree to the{" "}
                      <a
                        href="/terms/therapist"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2D4A3E] underline"
                      >
                        Therapist Terms of Use
                      </a>{" "}
                      and the{" "}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2D4A3E] underline"
                      >
                        Privacy Notice
                      </a>
                      . I understand TheraVoca is a marketing/matching platform and
                      not my Business Associate under HIPAA.
                    </span>
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
                  /* Bug Josh caught 2026-05-16: previously the
                     Preview button was enabled even before
                     Turnstile had issued a token, then the actual
                     submit (inside the preview modal) failed with
                     "scroll down to complete it" -- but the
                     widget is on the page BEHIND the modal so
                     scrolling did nothing. Now: disable Preview
                     until the token is in hand, AND show a hint
                     explaining why so the user looks at the
                     widget below instead of giving up.

                     2026-05-17 layout (Josh: "move cloudflare
                     below submit box like on patient request
                     form"): the Turnstile widget moved OUT of
                     the action row and now sits in a centered
                     card below the Back + Preview buttons. Same
                     pattern as IntakeForm -- widget auto-solves
                     in the background; user clicks Preview when
                     it goes green. */
                  <button
                    type="button"
                    className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      !valid
                      || submitting
                      || (turnstileSiteKey && !turnstileToken)
                    }
                    onClick={() => setShowPreview(true)}
                    data-testid="signup-preview"
                  >
                    Preview profile <ArrowRight size={18} />
                  </button>
                )}
                </div>
              </div>
              {/* Step 9 only: Cloudflare Turnstile widget rendered
                  BELOW the Back + Preview button row, in a centered
                  card. Matches the patient intake form layout so
                  users get a consistent "submit -> security check
                  -> success" visual flow on both surfaces. */}
              {step === totalSteps && turnstileSiteKey && (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <div
                    ref={turnstileRef}
                    data-testid="signup-turnstile"
                    className="w-full max-w-md min-h-[70px] flex items-center justify-center"
                  >
                    {turnstileWidgetState === "loading" && !turnstileToken && (
                      <div className="text-xs text-[#6D6A65] flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-[#2D4A3E]" />
                        Loading security check…
                      </div>
                    )}
                  </div>
                  {turnstileWidgetState === "failed" && !turnstileToken && (
                    <div
                      className="text-xs text-[#8B3220] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-3 py-2 mt-1 max-w-md"
                      data-testid="signup-turnstile-failed"
                    >
                      Security check couldn't load. This usually
                      means an ad blocker or strict privacy
                      extension is blocking{" "}
                      <code>challenges.cloudflare.com</code>.
                      Disable it for this page, or try a different
                      browser, then reload.
                    </div>
                  )}
                  {!turnstileToken && valid && turnstileWidgetState !== "failed" && (
                    <p
                      className="text-xs text-[#6D6A65] text-center max-w-md"
                      data-testid="signup-turnstile-hint"
                    >
                      Quick automatic security check. Preview profile activates
                      as soon as it confirms. On mobile, give it a few seconds.
                    </p>
                  )}
                </div>
              )}
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
