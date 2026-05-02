import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { scanIntakeData, buildWarningMessage } from "@/lib/contentGuard";
import useSiteCopy from "@/lib/useSiteCopy";
import useHardCapacity from "@/lib/useHardCapacity";
import {
  P1Step,
  P2Step,
  P3Step,
} from "@/components/intake/DeepMatchSteps";
import ReviewPreviewModal from "@/components/intake/ReviewPreviewModal";
import { WhoStep, IssuesStep } from "@/components/intake/steps/WhoIssuesSteps";
import { COVERED_STATES } from "@/components/intake/steps/intakeOptions";
import FormatStep from "@/components/intake/steps/FormatStep";
import PaymentStep from "@/components/intake/steps/PaymentStep";
import LogisticsStep from "@/components/intake/steps/LogisticsStep";
import PrefsStep from "@/components/intake/steps/PrefsStep";
import ExpectationsStep from "@/components/intake/steps/ExpectationsStep";
import ContactStep from "@/components/intake/steps/ContactStep";
import { Progress } from "@/components/ui/progress";

const STEPS_DEFAULTS = [
  "Who is this for?",
  "What's going on?",
  "First sessions",
  "Format & logistics",
  "Payment",
  "Therapist preferences",
  "Where to reach you",
];

// Extra steps inserted into the flow when the patient taps "Yes — go
// deeper" on the Start-A banner. Each maps to one of the P1/P2/P3
// questions from the v2 scoring map. Inserted BEFORE the contact step
// so the patient finishes on the familiar "where to reach you" finale.
const DEEP_MATCH_STEPS = [
  "Relationship style (pick 2)",
  "Way of working (pick 2)",
  "What they should already get",
];

// P1 + P2 deep-match option lists live in
// `@/components/intake/deepMatchOptions` so the Review modal, the
// step renderers, and any future analytics code share one source of
// truth.

// Option arrays (CLIENT_TYPES / AGE_GROUPS / ISSUES / MODALITY /
// PAYMENT / AVAILABILITY / URGENCY / PRIOR_THERAPY / EXPERIENCE /
// GENDERS / STYLES / MODALITY_PREFS / PRIORITY_FACTORS) all live in
// `@/components/intake/steps/intakeOptions.js`. The per-step
// components import what they need; this file imports a subset for
// the Review modal's label lookups.


export default function IntakeForm() {
  const navigate = useNavigate();
  const t = useSiteCopy();
  const hardCapacity = useHardCapacity();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [contentWarningAcked, setContentWarningAcked] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [confirmNotEmergency, setConfirmNotEmergency] = useState(false);
  // Bot-defense: capture the moment the form first mounts. We pass this
  // to the backend on submit; if the delta is < 2s, the request is
  // dropped as bot-likely. Real humans can't fill this form in <2s.
  const [formStartedAt] = useState(() => Date.now());
  // Honeypot field — kept off-screen via aria-hidden + tabindex=-1 so
  // real users won't see/tab into it. Bots auto-fill it.
  const [fax, setFax] = useState("");
  // Cloudflare Turnstile token (optional CAPTCHA replacement). The
  // widget renders only when REACT_APP_TURNSTILE_SITE_KEY is set, so
  // dev/preview without keys keeps working. The token is sent on
  // submit; backend fail-softs if Turnstile isn't configured there.
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef(null);
  // Runtime config: the admin can disable Turnstile at runtime via
  // Settings → "Disable Turnstile during AI testing". We fetch the
  // effective enabled flag from the backend and fall back to the
  // compile-time env var when the fetch hasn't resolved yet.
  const [turnstileEnabled, setTurnstileEnabled] = useState(
    !!process.env.REACT_APP_TURNSTILE_SITE_KEY,
  );
  const turnstileSiteKey =
    turnstileEnabled ? (process.env.REACT_APP_TURNSTILE_SITE_KEY || "") : "";
  const turnstileWidgetIdRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/config/turnstile");
        if (alive) setTurnstileEnabled(!!r.data?.enabled);
      } catch (_) {
        // Keep the env-var fallback on network error.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Inject the Turnstile script once (when configured) and render the
  // widget into our container. Explicit-render mode lets us re-use the
  // same component instance and reset the widget after a failed submit.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const SCRIPT_ID = "cf-turnstile-script";
    const ensureScript = () =>
      new Promise((resolve) => {
        if (window.turnstile) {
          resolve();
          return;
        }
        const existing = document.getElementById(SCRIPT_ID);
        if (existing) {
          existing.addEventListener("load", () => resolve());
          return;
        }
        const s = document.createElement("script");
        s.id = SCRIPT_ID;
        s.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    let cancelled = false;
    ensureScript().then(() => {
      if (cancelled || !turnstileRef.current || !window.turnstile) return;
      try {
        turnstileWidgetIdRef.current = window.turnstile.render(
          turnstileRef.current,
          {
            sitekey: turnstileSiteKey,
            theme: "light",
            size: "flexible",
            // Let Cloudflare auto-refresh tokens that expire while the
            // user is still filling the form (common on mobile where
            // forms take >5 min). Without this, the widget silently
            // loses its token and submit fails with "Security check
            // failed." even though the widget still looks green.
            "refresh-expired": "auto",
            // Also auto-retry on transient errors (CF recommends this
            // specifically for patchy mobile networks).
            retry: "auto",
            "retry-interval": 4000,
            callback: (tok) => setTurnstileToken(tok || ""),
            "error-callback": () => setTurnstileToken(""),
            "expired-callback": () => setTurnstileToken(""),
            "timeout-callback": () => setTurnstileToken(""),
          },
        );
      } catch (_) {
        /* ignore double-render */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [turnstileSiteKey]);
  // Scroll the form card into view on step change. Without this the step
  // animation re-renders mid-scroll and the page lurches up/down on
  // mobile when the new step has a different content height. We pin the
  // top of the white card just below the page header so users see the
  // step heading + first input immediately.
  const cardRef = useRef(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    const top =
      el.getBoundingClientRect().top + window.scrollY - 80; /* header offset */
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [step]);
  const [data, setData] = useState({
    client_type: "",
    age_group: "",
    location_state: "ID",
    location_city: "",
    location_zip: "",
    presenting_issues: [],
    modality_preference: "",
    modality_preferences: [],
    payment_type: "",
    insurance_name: "",
    insurance_name_other: "",
    insurance_strict: false,
    budget: "",
    sliding_scale_ok: false,
    availability_windows: [],
    availability_strict: false,
    urgency: "",
    urgency_strict: false,
    prior_therapy: "",
    prior_therapy_notes: "",
    prior_therapy_helped: "",
    experience_preference: ["no_pref"],
    gender_preference: "no_pref",
    gender_required: false,
    preferred_language: "English",
    language_strict: false,
    style_preference: [],
    referral_source: "",
    email: "",
    phone: "",
    sms_opt_in: false,
    session_expectations: [],   // pick up to 2 from EXPECTATION_OPTIONS
    priority_factors: [],
    strict_priorities: false,
    // ── Deep-match opt-in fields (P1/P2/P3 — only collected when the
    // patient taps "Yes — go deeper" on the Start-A banner above the
    // form. `deep_match_opt_in === null` means they haven't decided yet,
    // `false` means they explicitly chose standard, `true` means they
    // unlocked the 3 extra questions.
    deep_match_opt_in: null,
    p1_communication: [],   // pick 2 from P1_OPTIONS
    p2_change: [],          // pick 2 from P2_OPTIONS
    p3_resonance: "",       // open text — what should the therapist 'get' about you
    email_receipt: false,   // patient ticked "send me a copy" in Review modal
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const toggleArr = (k, v, max) =>
    setData((d) => {
      const arr = d[k];
      if (arr.includes(v)) return { ...d, [k]: arr.filter((x) => x !== v) };
      if (max && arr.length >= max) return d;
      return { ...d, [k]: [...arr, v] };
    });

  // ── Admin-managed referral source dropdown options ────────────────────
  const [referralSourceOptions, setReferralSourceOptions] = useState([]);
  useEffect(() => {
    const reorder = (opts) => {
      // Always show "Other" and "Prefer not to say" at the bottom of the list,
      // regardless of how the admin saved them.
      const tailKeys = new Set(["other", "prefer not to say"]);
      const head = opts.filter((o) => !tailKeys.has(o.trim().toLowerCase()));
      const other = opts.find((o) => o.trim().toLowerCase() === "other");
      const prefer = opts.find(
        (o) => o.trim().toLowerCase() === "prefer not to say",
      );
      return [...head, ...(other ? [other] : []), ...(prefer ? [prefer] : [])];
    };
    api
      .get("/config/referral-source-options")
      .then((r) => setReferralSourceOptions(reorder(r.data?.options || [])))
      .catch(() => setReferralSourceOptions([]));
  }, []);

  // ── Refer-a-friend capture: `?ref=PATXXXXX` on the landing URL — we
  // forward this to the backend as `referred_by_patient_code`, and pre-select
  // "Friend / family" for `referral_source` if no value has been chosen yet.
  const [referredByPatientCode, setReferredByPatientCode] = useState(null);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && /^[A-Z0-9]{4,16}$/i.test(ref)) {
      setReferredByPatientCode(ref.toUpperCase());
      setData((d) =>
        d.referral_source ? d : { ...d, referral_source: "Friend / family" },
      );
    }
  }, []);

  // ── ZIP validation: state-prefix sanity (catches "10001 in Idaho" before
  // the user moves on, instead of failing at final submit). Mirrors the
  // backend's zip3-prefix table.
  const ZIP3_TO_STATES = {
    ID: [832, 833, 834, 835, 836, 837, 838, 839],
  };
  const zipMatchesState = (zip, state) => {
    const z = (zip || "").trim();
    const s = (state || "").trim().toUpperCase();
    if (!z || z.length < 5 || !/^\d{5}$/.test(z.slice(0, 5))) return true;
    const prefixes = ZIP3_TO_STATES[s];
    if (!prefixes) return true; // unknown state — let backend handle
    return prefixes.includes(parseInt(z.slice(0, 3), 10));
  };
  const [zipError, setZipError] = useState("");

  // Cheap client-side guard against typos / disposable inboxes — backend
  // does the real validation, but this catches obvious mistakes early.
  const DISPOSABLE_HINT = /(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|throwawaymail|trashmail|fakeinbox|getnada)/i;
  const emailLooksOk = (email) => {
    if (!email) return false;
    const m = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}$/.test(email);
    if (!m) return false;
    if (DISPOSABLE_HINT.test(email)) return false;
    return true;
  };

  const canNext = () => {
    if (currentId === "who") return data.client_type && data.age_group && data.location_state && COVERED_STATES.has(data.location_state);
    if (currentId === "issues") return data.presenting_issues.length >= 1;
    if (currentId === "format_logistics") {
      if (!data.modality_preference) return false;
      if (
        ["in_person_only", "prefer_inperson", "hybrid"].includes(
          data.modality_preference,
        )
      ) {
        if (!(data.location_city || data.location_zip)) return false;
        if (data.location_zip && !zipMatchesState(data.location_zip, data.location_state)) {
          return false;
        }
      }
      return (
        data.availability_windows.length >= 1 && data.urgency && data.prior_therapy
      );
    }
    if (currentId === "payment") {
      if (!data.payment_type) return false;
      if (data.payment_type === "cash") return !!data.budget;
      const insName = data.insurance_name;
      const insOk =
        !!insName &&
        (insName !== "Other / not listed"
          || (data.insurance_name_other || "").trim().length >= 2);
      if (data.payment_type === "insurance") return insOk;
      if (data.payment_type === "either") return insOk && !!data.budget;
      return true;
    }
    if (currentId === "prefs") return true;
    if (currentId === "expectations") {
      const len = (data.session_expectations || []).length;
      return len >= 1 && len <= 2;  // pick 1 or 2 (including "not_sure")
    }
    if (currentId === "p1") return data.p1_communication.length === 2;
    if (currentId === "p2") return data.p2_change.length === 2;
    if (currentId === "p3") return true; // open-text — optional
    if (currentId === "contact")
      return (
        emailLooksOk(data.email) &&
        !!data.referral_source &&
        agreed &&
        confirmAdult &&
        confirmNotEmergency
      );
    return false;
  };

  /**
   * Reset the Turnstile widget and clear the staged token. Used when
   * the backend returns "Security check failed" — the cached token is
   * almost certainly expired or bound to an IP the user no longer has
   * (common on mobile when switching between wifi and cellular mid-
   * form). Forcing a fresh challenge lets the user retry without
   * reloading the whole page.
   */
  const resetTurnstile = () => {
    setTurnstileToken("");
    try {
      if (window.turnstile && turnstileWidgetIdRef.current != null) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    } catch (_) {
      /* safe to ignore — widget may already be re-rendering */
    }
  };

  const submit = async () => {
    // Preflight: if Turnstile is enabled but we don't have a token yet,
    // don't even hit the backend — show a clear, mobile-friendly
    // message and scroll the widget into view so the user knows where
    // to look. Otherwise they'd see the backend's generic "Security
    // check failed" message with no obvious next step.
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
      } catch (_) {
        /* old iOS Safari lacks smooth scroll — ignore */
      }
      return;
    }
    setSubmitting(true);
    try {
      const refSrc =
        data.referral_source === "Other" && data.referral_source_other
          ? `Other: ${data.referral_source_other}`
          : data.referral_source;
      // Mirror the same pattern for insurance — when the patient picks
      // "Other / not listed", we ship the typed-in value to the backend
      // (prefixed with "Other:") so the admin can read what they actually
      // have. Validation above guarantees a typed value when this branch
      // fires.
      const insName =
        data.insurance_name === "Other / not listed" &&
        (data.insurance_name_other || "").trim()
          ? `Other: ${data.insurance_name_other.trim()}`
          : data.insurance_name;
      const payload = {
        ...data,
        referral_source: refSrc,
        insurance_name: insName,
        referred_by_patient_code: referredByPatientCode,
        budget: data.budget ? parseInt(data.budget, 10) : null,
        // Bot-defense fields — backend rejects if honeypot has any value
        // OR if form completion took less than ~2s.
        fax_number: fax,
        form_started_at_ms: formStartedAt,
        // Cloudflare Turnstile (optional). Backend fail-softs when not
        // configured, so an empty string here is harmless in dev.
        turnstile_token: turnstileToken,
      };
      delete payload.referral_source_other;
      delete payload.insurance_name_other;
      const res = await api.post("/requests", payload);
      toast.success("Request received — please check your email to confirm.");
      navigate(`/verify/pending?id=${res.data.id}`, { replace: true });
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || "Something went wrong.";
      // A 400 whose message mentions "security" or "verification" means
      // Turnstile rejected our token — typically because the token
      // expired mid-form or the user's IP changed (wifi → cellular).
      // Reset the widget so the user can solve a fresh challenge in
      // place, without reloading the page and losing their answers.
      const looksLikeTurnstile =
        status === 400 &&
        typeof detail === "string" &&
        /security|verif/i.test(detail);
      if (looksLikeTurnstile) {
        resetTurnstile();
        toast.error(
          "Security check expired. We've refreshed it — please complete it again and tap Submit.",
          {
            duration: 8000,
            action: {
              label: "Show me",
              onClick: () => {
                try {
                  turnstileRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                } catch (_) {
                  /* ignore */
                }
              },
            },
          },
        );
      } else if (status === 429) {
        // Rate-limited — likely a duplicate referral within the window.
        // Offer a deep-link to the patient portal so they can check the
        // status of the request they already submitted instead of just
        // seeing a wall of error text.
        toast.error(detail, {
          duration: 10000,
          action: {
            label: "View my referral",
            onClick: () => navigate("/portal/patient"),
          },
        });
      } else {
        toast.error(detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stepBlockReason = () => {
    if (currentId === "who") {
      if (!data.location_state) return "Pick a state.";
      if (!COVERED_STATES.has(data.location_state)) return "We're not in that state yet — join the waitlist above!";
      if (!data.client_type) return "Pick who this referral is for.";
      if (!data.age_group) return "Pick the client's age group.";
      return "";
    }
    if (currentId === "issues" && data.presenting_issues.length === 0)
      return "Pick at least one issue you'd like help with.";
    if (currentId === "format_logistics") {
      if (!data.modality_preference) return "Choose how the client prefers to meet.";
      if (
        ["in_person_only", "prefer_inperson", "hybrid"].includes(
          data.modality_preference,
        )
      ) {
        if (!data.location_city && !data.location_zip)
          return "Add your city or ZIP for in-person matching.";
        if (
          data.location_zip &&
          !zipMatchesState(data.location_zip, data.location_state)
        )
          return `ZIP ${data.location_zip} doesn't appear to be in ${data.location_state}.`;
      }
      if (data.availability_windows.length === 0)
        return "Pick at least one availability window.";
      if (!data.urgency) return "Pick how urgent this is.";
      if (!data.prior_therapy) return "Tell us about prior therapy experience.";
      return "";
    }
    if (currentId === "payment") {
      if (!data.payment_type) return "Pick how the client will pay.";
      if (data.payment_type === "cash" && !data.budget)
        return "Enter the per-session cash budget.";
      const insMissing = !data.insurance_name;
      const insOtherMissing =
        data.insurance_name === "Other / not listed" &&
        (data.insurance_name_other || "").trim().length < 2;
      if (data.payment_type === "insurance") {
        if (insMissing) return "Pick the insurance plan.";
        if (insOtherMissing) return "Type the insurance plan name.";
      }
      if (data.payment_type === "either") {
        if (insMissing || !data.budget)
          return "Pick the insurance plan and a cash budget for backup.";
        if (insOtherMissing) return "Type the insurance plan name.";
      }
      return "";
    }
    if (currentId === "expectations") {
      const len = (data.session_expectations || []).length;
      if (len < 1) return "Pick at least one.";
      return "";
    }
    if (currentId === "p1" && data.p1_communication.length !== 2)
      return "Pick exactly 2.";
    if (currentId === "p2" && data.p2_change.length !== 2)
      return "Pick exactly 2.";
    if (currentId === "contact") {
      if (!emailLooksOk(data.email))
        return "Enter a valid personal email — disposable / temp addresses aren't accepted.";
      if (!data.referral_source) return "Pick how you heard about us.";
      if (!agreed) return "Agree to the terms of use to continue.";
      if (!confirmAdult) return "Confirm you are 18 or older.";
      if (!confirmNotEmergency) return "Confirm this is not an emergency.";
      return "";
    }
    return "";
  };

  // Resolve step titles via t() so admins can edit them in Site Copy.
  // Step list grows by 3 (P1/P2/P3) when the patient opted into the
  // deep match. We carry semantic IDs alongside the labels so render
  // logic doesn't depend on numeric indices (which shift when deep is
  // enabled). `currentId` is the active step's ID — used in place of
  // literal `step === N` checks below.
  const isDeep = data.deep_match_opt_in === true;
  const BASE_IDS = ["who", "issues", "expectations", "format_logistics", "payment", "prefs", "contact"];
  const STEP_IDS = isDeep
    ? ["who", "issues", "expectations", "format_logistics", "payment", "prefs", "p1", "p2", "p3", "contact"]
    : BASE_IDS;
  const STEP_LABELS = isDeep
    ? [...STEPS_DEFAULTS.slice(0, 6), ...DEEP_MATCH_STEPS, STEPS_DEFAULTS[6]]
    : STEPS_DEFAULTS;
  const STEPS = STEP_LABELS.map((d, i) => t(`intake.step.${STEP_IDS[i]}`, d));
  const currentId = STEP_IDS[step] || BASE_IDS[step];
  const progressPct = ((step + 1) / STEPS.length) * 100;

  return (
    <section
      id="start"
      className="bg-[#FDFBF7] py-20 md:py-28 border-t border-[#E8E5DF]"
      data-testid="intake-section"
    >
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965] mb-3">
            Get started
          </p>
          <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight">
            Get your personalized list of <em>pre-qualified</em> therapists
          </h2>
          <p className="mt-4 text-[#6D6A65]">
            Free during our pilot. Under 2 minutes. No account required.
          </p>
        </div>

        {/* Start-A: Deep-match opt-in. Only shown before the patient has
            decided. Once they pick yes/no, the banner is replaced with a
            small badge indicating the chosen mode. */}
        {data.deep_match_opt_in === null && (
          <div
            className="mb-8 bg-gradient-to-br from-[#FBE9E5] to-[#FDFBF7] border border-[#F4C7BE] rounded-2xl p-6"
            data-testid="deep-match-banner"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#C8412B] font-semibold mb-2">
              {t("intake.deep.banner.eyebrow", "✦ Optional · ~90 seconds extra")}
            </p>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E] mb-2 leading-snug">
              {t("intake.deep.banner.heading", "Want a deeper match?")}
            </h3>
            <p className="text-sm text-[#2B2A29]/85 leading-relaxed">
              {t(
                "intake.deep.banner.body",
                "Answer 3 extra questions and we'll match you with a therapist who really understands how you think — not just one who treats your diagnosis.",
              )}
            </p>
            <div className="flex flex-wrap gap-3 mt-5">
              <button
                type="button"
                onClick={() => set("deep_match_opt_in", true)}
                className="tv-btn-primary text-sm"
                data-testid="deep-match-yes"
              >
                {t("intake.deep.banner.yes", "Yes — go deeper")}
              </button>
              <button
                type="button"
                onClick={() => set("deep_match_opt_in", false)}
                className="text-sm text-[#6D6A65] underline self-center"
                data-testid="deep-match-skip"
              >
                {t("intake.deep.banner.skip", "Skip — standard match is fine")}
              </button>
            </div>
          </div>
        )}
        {data.deep_match_opt_in !== null && (
          <div
            className="mb-4 flex items-center justify-end gap-3"
            data-testid="deep-match-status"
          >
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider rounded-full px-3 py-1 border ${
                data.deep_match_opt_in
                  ? "bg-[#FBE9E5] text-[#C8412B] border-[#F4C7BE]"
                  : "bg-[#FDFBF7] text-[#6D6A65] border-[#E8E5DF]"
              }`}
            >
              {data.deep_match_opt_in ? "✦ Deep match" : "Standard match"}
            </span>
            <button
              type="button"
              onClick={() => {
                // Allow the patient to switch modes mid-flow. Reset to
                // null and clamp the step index so we don't end up out
                // of bounds when the steps array shrinks.
                set("deep_match_opt_in", null);
                setStep((s) => Math.min(s, BASE_IDS.length - 1));
              }}
              className="text-[11px] text-[#6D6A65] underline hover:text-[#2D4A3E]"
              data-testid="deep-match-change"
            >
              change
            </button>
          </div>
        )}

        <div ref={cardRef} className="bg-white border border-[#E8E5DF] rounded-3xl shadow-sm p-6 sm:p-10">
          <div className="mb-6">
            <div className="flex justify-between text-xs text-[#6D6A65] mb-2">
              <span data-testid="step-label">
                Step {step + 1} of {STEPS.length}: {STEPS[step]}
              </span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <Progress
              value={progressPct}
              className="h-1.5 bg-[#E8E5DF] [&>div]:bg-[#C87965]"
            />
          </div>

          <div className="min-h-[280px] tv-fade-up" key={step}>
            {currentId === "who" && (
              <WhoStep data={data} set={set} hardCapacity={hardCapacity} />
            )}

            {currentId === "issues" && (
              <IssuesStep data={data} set={set} toggleArr={toggleArr} />
            )}

            {currentId === "format_logistics" && (
              <>
                <FormatStep
                  data={data}
                  set={set}
                  zipMatchesState={zipMatchesState}
                  zipError={zipError}
                  setZipError={setZipError}
                  hardCapacity={hardCapacity}
                />
                <LogisticsStep data={data} set={set} toggleArr={toggleArr} hardCapacity={hardCapacity} />
              </>
            )}

            {currentId === "payment" && (
              <PaymentStep data={data} set={set} hardCapacity={hardCapacity} />
            )}

            {currentId === "prefs" && (
              <PrefsStep data={data} set={set} toggleArr={toggleArr} hardCapacity={hardCapacity} />
            )}

            {currentId === "expectations" && (
              <ExpectationsStep data={data} set={set} toggleArr={toggleArr} t={t} />
            )}


            {/* P1 — Communication style. Pick exactly 2. Maps 1:1 to
                therapist T1 ranking on the same five behaviors. */}
            {currentId === "p1" && (
              <P1Step data={data} set={set} toggleArr={toggleArr} t={t} />
            )}

            {/* P2 — Theory of change. Pick exactly 2. Same five concepts
                that therapists rank in T3; matching score is overlap ÷ 2. */}
            {currentId === "p2" && (
              <P2Step data={data} set={set} toggleArr={toggleArr} t={t} />
            )}

            {/* P3 — Contextual resonance. Open text; matched against
                therapist T5 (lived experience) + T2 (best-client narrative)
                via embeddings. Optional — empty submissions skip the
                Contextual axis instead of penalising. */}
            {currentId === "p3" && <P3Step data={data} set={set} t={t} />}

            {currentId === "contact" && (
              <ContactStep
                data={data}
                set={set}
                setData={setData}
                emailLooksOk={emailLooksOk}
                agreed={agreed}
                setAgreed={setAgreed}
                confirmAdult={confirmAdult}
                setConfirmAdult={setConfirmAdult}
                confirmNotEmergency={confirmNotEmergency}
                setConfirmNotEmergency={setConfirmNotEmergency}
                referralSourceOptions={referralSourceOptions}
                t={t}
              />
            )}
          </div>

          <div className="mt-8 flex flex-col gap-3">
            {!canNext() && stepBlockReason() && (
              <p
                className="text-xs text-[#D45D5D] text-right leading-relaxed"
                data-testid="intake-step-error"
              >
                {stepBlockReason()}
              </p>
            )}
            <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] disabled:opacity-30 transition"
              data-testid="intake-back-btn"
            >
              {t("btn.intake.back", "← Back")}
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                disabled={!canNext()}
                onClick={() => setStep((s) => s + 1)}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="intake-next-btn"
              >
                {t("btn.intake.next", "Continue")} <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canNext() || submitting}
                onClick={() => {
                  if (!contentWarningAcked) {
                    const scan = scanIntakeData(data);
                    const msg = buildWarningMessage(scan.findings);
                    if (msg) {
                      toast.warning(msg, { duration: 10000 });
                      setContentWarningAcked(true);
                      // Don't block — they can click again to proceed.
                      return;
                    }
                  }
                  setShowPreview(true);
                }}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="intake-submit-btn"
              >
                {t("btn.intake.submit", "Review & submit")}{" "}
                <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            )}
            </div>
          </div>
        </div>
        {/* ── Turnstile widget (renders only when site key configured) ── */}
        {turnstileSiteKey && (
          <div
            ref={turnstileRef}
            className="mt-6 flex justify-center"
            data-testid="turnstile-widget"
          />
        )}
        {/* ── Honeypot: bots fill this; humans never see it. ────────────── */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: "auto",
            width: 1,
            height: 1,
            overflow: "hidden",
          }}
        >
          <label htmlFor="fax-number-confirm">
            Fax number (leave blank)
          </label>
          <input
            id="fax-number-confirm"
            name="fax_number"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={fax}
            onChange={(e) => setFax(e.target.value)}
            data-testid="intake-honeypot"
          />
        </div>
      </div>
      {showPreview && (
        <ReviewPreviewModal
          data={data}
          submitting={submitting}
          onClose={() => setShowPreview(false)}
          onToggleReceipt={(v) => set("email_receipt", v)}
          onConfirm={async () => {
            await submit();
          }}
        />
      )}
    </section>
  );
}


// Note: Group / Field / PillRow / PillCol / CheckRow used to live
// here. They were extracted to `components/intake/IntakeUI.jsx` so
// the per-step renderers in `components/intake/DeepMatchSteps.jsx`
// (and the planned per-step files) can import them without circular
// references.

