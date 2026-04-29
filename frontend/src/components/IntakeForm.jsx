import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import useSiteCopy from "@/lib/useSiteCopy";
import {
  P1Step,
  P2Step,
  P3Step,
} from "@/components/intake/DeepMatchSteps";
import { WhoStep, IssuesStep } from "@/components/intake/steps/WhoIssuesSteps";
import FormatStep from "@/components/intake/steps/FormatStep";
import PaymentStep from "@/components/intake/steps/PaymentStep";
import LogisticsStep from "@/components/intake/steps/LogisticsStep";
import PrefsStep from "@/components/intake/steps/PrefsStep";
import PriorityStep from "@/components/intake/steps/PriorityStep";
import ContactStep from "@/components/intake/steps/ContactStep";
// Option arrays — imported here only for the Review modal's label
// lookups. Per-step renderers import these directly from the same
// module, so there's just one source of truth.
import {
  CLIENT_TYPES,
  AGE_GROUPS,
  ISSUES,
  MODALITY,
  AVAILABILITY,
  URGENCY,
  PRIOR_THERAPY,
  EXPERIENCE,
  GENDERS,
  STYLES,
} from "@/components/intake/steps/intakeOptions";
import { Progress } from "@/components/ui/progress";

const STEPS_DEFAULTS = [
  "Who is this for?",
  "What's going on?",
  "Format & location",
  "Payment",
  "Logistics",
  "Therapist preferences",
  "What matters most?",
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
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
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
  const turnstileSiteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY || "";
  const turnstileWidgetIdRef = useRef(null);

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
            callback: (tok) => setTurnstileToken(tok || ""),
            "error-callback": () => setTurnstileToken(""),
            "expired-callback": () => setTurnstileToken(""),
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
    other_issue: "",
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
    if (currentId === "who") return data.client_type && data.age_group && data.location_state;
    if (currentId === "issues") return data.presenting_issues.length >= 1;
    if (currentId === "format") {
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
        return true;
      }
      return true;
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
    if (currentId === "logistics")
      return (
        data.availability_windows.length >= 1 && data.urgency && data.prior_therapy
      );
    if (currentId === "prefs") return true;
    if (currentId === "priority") return true; // priority factors are optional
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

  const submit = async () => {
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
      if (status === 429) {
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
      if (!data.client_type) return "Pick who this referral is for.";
      if (!data.age_group) return "Pick the client's age group.";
      if (!data.location_state) return "Pick a state.";
      return "";
    }
    if (currentId === "issues" && data.presenting_issues.length === 0)
      return "Pick at least one issue you'd like help with.";
    if (currentId === "format") {
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
    if (currentId === "logistics") {
      if (data.availability_windows.length === 0)
        return "Pick at least one availability window.";
      if (!data.urgency) return "Pick how urgent this is.";
      if (!data.prior_therapy) return "Tell us about prior therapy experience.";
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
  const BASE_IDS = ["who", "issues", "format", "payment", "logistics", "prefs", "priority", "contact"];
  const STEP_IDS = isDeep
    ? ["who", "issues", "format", "payment", "logistics", "prefs", "priority", "p1", "p2", "p3", "contact"]
    : BASE_IDS;
  const STEP_LABELS = isDeep
    ? [...STEPS_DEFAULTS.slice(0, 7), ...DEEP_MATCH_STEPS, STEPS_DEFAULTS[7]]
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
              <WhoStep data={data} set={set} />
            )}

            {currentId === "issues" && (
              <IssuesStep data={data} set={set} toggleArr={toggleArr} />
            )}

            {currentId === "format" && (
              <FormatStep
                data={data}
                set={set}
                zipMatchesState={zipMatchesState}
                zipError={zipError}
                setZipError={setZipError}
              />
            )}

            {currentId === "payment" && (
              <PaymentStep data={data} set={set} />
            )}

            {currentId === "logistics" && (
              <LogisticsStep data={data} set={set} toggleArr={toggleArr} />
            )}

            {currentId === "prefs" && (
              <PrefsStep data={data} set={set} toggleArr={toggleArr} />
            )}

            {currentId === "priority" && (
              <PriorityStep
                data={data}
                set={set}
                toggleArr={toggleArr}
                t={t}
              />
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
              data-testid="back-btn"
            >
              {t("btn.intake.back", "← Back")}
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                disabled={!canNext()}
                onClick={() => setStep((s) => s + 1)}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="next-btn"
              >
                {t("btn.intake.next", "Continue")} <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canNext() || submitting}
                onClick={() => setShowPreview(true)}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="submit-btn"
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

// Pre-submit review modal — shows the full request the patient is about to
// send so they can scan it once before committing. Edit goes back to the
// form (just closes the modal); Submit triggers the actual POST.
function ReviewPreviewModal({ data, submitting, onClose, onConfirm, onToggleReceipt }) {
  const t = useSiteCopy();
  const issues = (data.presenting_issues || []).join(", ");
  const insurance =
    data.payment_type === "insurance" || data.payment_type === "either"
      ? data.insurance_name === "Other / not listed" &&
        (data.insurance_name_other || "").trim()
        ? `Other: ${data.insurance_name_other.trim()}`
        : data.insurance_name || "—"
      : "Not using insurance";
  const cash =
    data.payment_type === "cash" || data.payment_type === "either"
      ? data.budget
        ? `$${data.budget}/session`
        : "—"
      : "—";
  // Map enum values back to human labels using the same arrays the
  // form uses, so the preview never surfaces raw slugs like
  // "weekday_evening" or "in_person_only" to the patient.
  const lookup = (arr, v) =>
    (arr || []).find((x) => x.v === v)?.l || v || "—";
  const lookupMany = (arr, vs) =>
    (vs || []).map((v) => lookup(arr, v)).join(", ") || "—";

  const referralLine =
    data.referral_source === "Other" && data.referral_source_other
      ? `Other: ${data.referral_source_other}`
      : data.referral_source || "—";
  const notes = (data.notes || "").trim();
  // Which rows count as "hard requirements" for this referral. Always-hard
  // fields are flagged unconditionally. Patient-toggleable hards (insurance,
  // format/distance, availability, urgency) only get the badge when the
  // patient ticked the corresponding `*_strict` box on the form.
  const isInPersonHard = data.modality_preference === "in_person_only";
  const isGenderHard =
    !!data.gender_required &&
    data.gender_preference &&
    data.gender_preference !== "no_pref";
  const hardRows = new Set([
    "Who this referral is for",   // client_type — always hard
    "Age group",                  // always hard
    "Location",                   // state license — always hard
    "Concerns",                   // primary concern — always hard
    ...(data.insurance_strict ? ["Insurance"] : []),
    ...(isInPersonHard ? ["Session format"] : []),
    ...(data.availability_strict ? ["Availability"] : []),
    ...(data.urgency_strict ? ["Urgency"] : []),
    ...(isGenderHard ? ["Preferred gender"] : []),
    ...(data.language_strict &&
      data.preferred_language &&
      data.preferred_language !== "English"
      ? ["Preferred language"]
      : []),
  ]);
  const rows = [
    ["Who this referral is for", lookup(CLIENT_TYPES, data.client_type)],
    ["Age group", lookup(AGE_GROUPS, data.age_group)],
    ["Location", `${data.location_city || "—"}${data.location_zip ? `, ${data.location_zip}` : ""} (${data.location_state})`],
    ["Concerns", lookupMany(ISSUES, data.presenting_issues) || issues || "—"],
    ["Session format", lookup(MODALITY, data.modality_preference)],
    ["Insurance", insurance],
    ["Cash budget", cash],
    ["Availability", lookupMany(AVAILABILITY, data.availability_windows)],
    ["Urgency", lookup(URGENCY, data.urgency)],
    ["Therapy history", lookup(PRIOR_THERAPY, data.prior_therapy)],
    ["Preferred gender", lookup(GENDERS, data.gender_preference) || "Any"],
    [
      "Therapist experience",
      lookupMany(EXPERIENCE, data.experience_preference) || "Any",
    ],
    ["Preferred language", data.preferred_language || "English"],
    [
      "Style preferences",
      lookupMany(STYLES, data.style_preference) || "—",
    ],
    ["Therapy approaches", (data.modality_preferences || []).join(", ") || "—"],
    ["Referred by", referralLine],
    ["Email", data.email || "—"],
    ["Phone", data.phone || "—"],
  ];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
      data-testid="intake-preview-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-[#E8E5DF] w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-[#E8E5DF] p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
              Almost there
            </p>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-0.5">
              Review your referral
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6D6A65] hover:text-[#2D4A3E] text-sm"
            data-testid="intake-preview-close"
          >
            ✕
          </button>
        </div>
        <div className="p-5 sm:p-6">
          {/* Final-submit warning. Lives at the very top so the patient
              sees it before they read through their answers, not after.
              Submitting locks the request — admins can edit later, but
              the patient has no self-serve edit flow. */}
          <div
            className="mb-4 rounded-xl bg-[#FBF2E8] border border-[#F0DEC8] px-4 py-3 flex items-start gap-3"
            data-testid="intake-preview-lock-warning"
          >
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#B8742A] text-white flex items-center justify-center text-xs font-bold">
              !
            </span>
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-[#8B5A1F]">
                {t(
                  "intake.preview.warning.heading",
                  "Once you submit, this can't be changed.",
                )}
              </p>
              <p className="text-[#8B5A1F]/85 text-xs mt-1">
                {t(
                  "intake.preview.warning.body",
                  "Please double-check your answers below before submitting. If something needs to change later, just email us and we'll resend a corrected match.",
                )}
              </p>
            </div>
          </div>
          <p className="text-sm text-[#6D6A65] leading-relaxed">
            Take a quick look — therapists will only see this anonymized
            version (no contact info shared until you reach out).
          </p>
          <div
            className="mt-3 flex items-center gap-2 text-xs text-[#2B2A29] bg-[#FBE9E5] border border-[#F4C7BE] rounded-lg px-3 py-2"
            data-testid="intake-preview-hard-legend"
          >
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-2 py-0.5">
              HARD
            </span>
            <span className="leading-snug">
              Fields marked HARD are filters — therapists must match them
              exactly to appear in your results.
            </span>
          </div>
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {rows.map(([label, value]) => {
              const isHard = hardRows.has(label);
              return (
                <div
                  key={label}
                  className={
                    isHard
                      ? "rounded-lg bg-[#FBE9E5] border border-[#F4C7BE] px-3 py-2 -mx-1"
                      : ""
                  }
                  data-testid={`intake-preview-row-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <dt className="text-[10px] uppercase tracking-wider text-[#6D6A65] flex items-center gap-1.5">
                    {label}
                    {isHard && (
                      <span
                        className="inline-flex text-[9px] font-semibold tracking-wider text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-1.5 py-[1px]"
                        title="This is a hard filter — therapists must match exactly"
                      >
                        HARD
                      </span>
                    )}
                  </dt>
                  <dd className="text-[#2B2A29] font-medium leading-snug break-words mt-1">
                    {value || "—"}
                  </dd>
                </div>
              );
            })}
            {notes && (
              <div className="sm:col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                  Notes you shared
                </dt>
                <dd className="text-[#2B2A29] leading-relaxed mt-1 whitespace-pre-wrap">
                  {notes}
                </dd>
              </div>
            )}
          </dl>
          {/* Deep-match answers (P1/P2/P3). Only rendered when the
              patient opted into the deeper flow. Visually separated from
              the standard rows so the patient can see at a glance which
              extra signals will boost their match scoring. */}
          {data.deep_match_opt_in && (
            <div
              className="mt-6 rounded-2xl bg-[#FBE9E5] border border-[#F4C7BE] p-4 sm:p-5"
              data-testid="intake-preview-deep-section"
            >
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#C8412B] font-semibold">
                ✦ Deep match · 3 extra answers
              </p>
              <p className="text-xs text-[#2B2A29]/80 mt-1 mb-4 leading-relaxed">
                These will boost your matching scores on Relationship Style,
                Way of Working, and Contextual Resonance.
              </p>
              <dl className="space-y-4 text-sm">
                <div data-testid="intake-preview-row-p1">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Relationship style (P1)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-snug">
                    {(data.p1_communication || []).length
                      ? (data.p1_communication || [])
                          .map(
                            (v) =>
                              P1_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div data-testid="intake-preview-row-p2">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Way of working (P2)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-snug">
                    {(data.p2_change || []).length
                      ? (data.p2_change || [])
                          .map(
                            (v) =>
                              P2_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
                <div data-testid="intake-preview-row-p3">
                  <dt className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    What they should already get (P3)
                  </dt>
                  <dd className="text-[#2B2A29] mt-1 leading-relaxed whitespace-pre-wrap">
                    {(data.p3_resonance || "").trim() || (
                      <span className="text-[#6D6A65] italic">
                        Skipped — that's okay.
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-[#E8E5DF] p-5">
          {/* Email-receipt opt-in. Patients can't self-edit a request
              once submitted, so this checkbox lets them keep a paper
              trail with all the same fields they're about to confirm. */}
          <label
            className="flex items-start gap-2.5 mb-3 text-sm cursor-pointer"
            data-testid="intake-preview-receipt-toggle"
          >
            <input
              type="checkbox"
              checked={!!data.email_receipt}
              onChange={(e) => onToggleReceipt && onToggleReceipt(e.target.checked)}
              className="mt-0.5 accent-[#2D4A3E]"
              data-testid="intake-preview-receipt-checkbox"
            />
            <span className="text-[#2B2A29] leading-snug">
              <span className="font-medium">📧 Send me a copy of my answers</span>
              <span className="block text-xs text-[#6D6A65] mt-0.5">
                Useful as a record — you can forward it back to us if you
                spot something to correct after submitting.
              </span>
            </span>
          </label>
          <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="tv-btn-secondary"
            data-testid="intake-preview-edit"
          >
            {t("btn.intake.preview_edit", "← Edit answers")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="tv-btn-primary disabled:opacity-50"
            data-testid="intake-preview-submit"
          >
            {submitting
              ? "Submitting..."
              : t("btn.intake.preview_submit", "Confirm & find my matches")}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Note: Group / Field / PillRow / PillCol / CheckRow used to live
// here. They were extracted to `components/intake/IntakeUI.jsx` so
// the per-step renderers in `components/intake/DeepMatchSteps.jsx`
// (and the planned per-step files) can import them without circular
// references.

