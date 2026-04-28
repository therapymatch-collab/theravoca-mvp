import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { formatUsPhone } from "@/lib/phone";
import { toast } from "sonner";
import { ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PATIENT_INSURER_OPTIONS } from "@/lib/insurers";

const STEPS = [
  "Who is this for?",
  "What's going on?",
  "Format & location",
  "Payment",
  "Logistics",
  "Therapist preferences",
  "Where to reach you",
];

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
const MODALITY = [
  { v: "telehealth_only", l: "Telehealth only" },
  { v: "in_person_only", l: "In-person only" },
  { v: "hybrid", l: "Hybrid / either" },
  { v: "prefer_inperson", l: "Prefer in-person, open to telehealth" },
  { v: "prefer_telehealth", l: "Prefer telehealth, open to in-person" },
];
const PAYMENT = [
  { v: "insurance", l: "Insurance" },
  { v: "cash", l: "Cash / private pay" },
  { v: "either", l: "Either" },
];
const AVAILABILITY = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
  { v: "flexible", l: "Flexible" },
];
const URGENCY = [
  { v: "asap", l: "ASAP / this week" },
  { v: "within_2_3_weeks", l: "Within 2–3 weeks" },
  { v: "within_month", l: "Within a month" },
  { v: "flexible", l: "Flexible / just exploring" },
];
const PRIOR_THERAPY = [
  { v: "no", l: "No, this is the first time" },
  { v: "yes_helped", l: "Yes, and it helped" },
  { v: "yes_not_helped", l: "Yes, but it didn't help" },
  { v: "not_sure", l: "Not sure" },
];
const EXPERIENCE = [
  { v: "no_pref", l: "No preference" },
  { v: "0-3", l: "0–3 years" },
  { v: "3-7", l: "3–7 years" },
  { v: "7-15", l: "7–15 years" },
  { v: "15+", l: "15+ years" },
];
const GENDERS = [
  { v: "no_pref", l: "No preference" },
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "nonbinary", l: "Nonbinary" },
];
const STYLES = [
  { v: "structured", l: "Structured / skills-based" },
  { v: "warm_supportive", l: "Warm and supportive" },
  { v: "direct_practical", l: "Direct and practical" },
  { v: "trauma_informed", l: "Trauma-informed" },
  { v: "insight_oriented", l: "Insight-oriented" },
  { v: "faith_informed", l: "Faith-informed" },
  { v: "culturally_responsive", l: "Culturally responsive" },
  { v: "lgbtq_affirming", l: "LGBTQ+ affirming" },
];
const MODALITY_PREFS = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];

export default function IntakeForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [confirmNotEmergency, setConfirmNotEmergency] = useState(false);
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
    budget: "",
    sliding_scale_ok: false,
    availability_windows: [],
    urgency: "",
    prior_therapy: "",
    prior_therapy_notes: "",
    experience_preference: ["no_pref"],
    gender_preference: "no_pref",
    gender_required: false,
    style_preference: [],
    referral_source: "",
    email: "",
    phone: "",
    sms_opt_in: false,
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
    const m = /^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,255}\.[A-Za-z]{2,}$/.test(email);
    if (!m) return false;
    if (DISPOSABLE_HINT.test(email)) return false;
    return true;
  };

  const canNext = () => {
    if (step === 0) return data.client_type && data.age_group && data.location_state;
    if (step === 1) return data.presenting_issues.length >= 1;
    if (step === 2) {
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
    if (step === 3) {
      if (!data.payment_type) return false;
      if (data.payment_type === "cash") return !!data.budget;
      if (data.payment_type === "insurance") return !!data.insurance_name;
      if (data.payment_type === "either")
        return !!data.insurance_name && !!data.budget;
      return true;
    }
    if (step === 4)
      return (
        data.availability_windows.length >= 1 && data.urgency && data.prior_therapy
      );
    if (step === 5) return true;
    if (step === 6)
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
      const payload = {
        ...data,
        referral_source: refSrc,
        referred_by_patient_code: referredByPatientCode,
        budget: data.budget ? parseInt(data.budget, 10) : null,
      };
      delete payload.referral_source_other;
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
    if (step === 0) {
      if (!data.client_type) return "Pick who this referral is for.";
      if (!data.age_group) return "Pick the client's age group.";
      if (!data.location_state) return "Pick a state.";
      return "";
    }
    if (step === 1 && data.presenting_issues.length === 0)
      return "Pick at least one issue you'd like help with.";
    if (step === 2) {
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
    if (step === 3) {
      if (!data.payment_type) return "Pick how the client will pay.";
      if (data.payment_type === "cash" && !data.budget)
        return "Enter the per-session cash budget.";
      if (data.payment_type === "insurance" && !data.insurance_name)
        return "Pick the insurance plan.";
      if (data.payment_type === "either" && (!data.insurance_name || !data.budget))
        return "Pick the insurance plan and a cash budget for backup.";
      return "";
    }
    if (step === 4) {
      if (data.availability_windows.length === 0)
        return "Pick at least one availability window.";
      if (!data.urgency) return "Pick how urgent this is.";
      if (!data.prior_therapy) return "Tell us about prior therapy experience.";
      return "";
    }
    if (step === 6) {
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
            {step === 0 && (
              <div className="space-y-6">
                <Group label="What type of therapy is needed?">
                  <PillRow
                    items={CLIENT_TYPES}
                    selected={[data.client_type]}
                    onSelect={(v) => set("client_type", v)}
                    testid="client-type"
                  />
                </Group>
                <Group label="What age group is the client?">
                  <PillRow
                    items={AGE_GROUPS}
                    selected={[data.age_group]}
                    onSelect={(v) => set("age_group", v)}
                    testid="age-group"
                  />
                </Group>
                <p className="text-xs text-[#6D6A65]">
                  Our therapists are currently licensed in <strong>Idaho</strong> only during our beta launch.
                </p>
              </div>
            )}

            {step === 1 && (
              <div>
                <Group
                  label="Main concerns the client wants help with"
                  hint={`Pick up to 3, in priority order. Top of list = highest priority. (${data.presenting_issues.length}/3)`}
                >
                  <PillRow
                    items={ISSUES}
                    selected={data.presenting_issues}
                    onSelect={(v) => toggleArr("presenting_issues", v, 3)}
                    testid="issue"
                  />
                </Group>
                <div className="mt-6">
                  <label className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider mb-2">
                    Anything else? (optional — no contact or personally identifiable info)
                  </label>
                  <Textarea
                    rows={3}
                    value={data.other_issue}
                    onChange={(e) => set("other_issue", e.target.value)}
                    placeholder="e.g. recent loss, perinatal, prefer culturally-responsive provider"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="other-issue"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <Group label="How would the client prefer to meet?">
                  <PillCol
                    items={MODALITY}
                    selected={[data.modality_preference]}
                    onSelect={(v) => set("modality_preference", v)}
                    testid="modality"
                  />
                </Group>
                {["in_person_only", "prefer_inperson", "hybrid"].includes(
                  data.modality_preference,
                ) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="City">
                      <Input
                        value={data.location_city}
                        onChange={(e) => set("location_city", e.target.value)}
                        placeholder="e.g. Boise"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="city-input"
                      />
                    </Field>
                    <Field label="ZIP code (recommended)">
                      <Input
                        inputMode="numeric"
                        maxLength={5}
                        value={data.location_zip}
                        onChange={(e) => {
                          const z = e.target.value.replace(/\D/g, "").slice(0, 5);
                          set("location_zip", z);
                          if (z.length === 5 && !zipMatchesState(z, data.location_state)) {
                            setZipError(
                              `ZIP ${z} doesn't appear to be in ${data.location_state}. Please double-check.`,
                            );
                          } else {
                            setZipError("");
                          }
                        }}
                        placeholder="83702"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="zip-input"
                      />
                      {zipError && (
                        <p
                          className="mt-1.5 text-xs text-[#D45D5D]"
                          data-testid="zip-error"
                        >
                          {zipError}
                        </p>
                      )}
                    </Field>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <Group label="How would the client like to pay?">
                  <PillRow
                    items={PAYMENT}
                    selected={[data.payment_type]}
                    onSelect={(v) => set("payment_type", v)}
                    testid="payment"
                  />
                </Group>
                {(data.payment_type === "insurance" ||
                  data.payment_type === "either") && (
                  <Field label="Insurance plan">
                    <Select
                      value={data.insurance_name}
                      onValueChange={(v) => set("insurance_name", v)}
                    >
                      <SelectTrigger
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="insurance-select"
                      >
                        <SelectValue placeholder="Select your insurance" />
                      </SelectTrigger>
                      <SelectContent>
                        {PATIENT_INSURER_OPTIONS.map((ins) => (
                          <SelectItem key={ins} value={ins}>
                            {ins}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {(data.payment_type === "cash" ||
                  data.payment_type === "either") && (
                  <>
                    <Field label="Maximum budget per session (USD)">
                      <Input
                        type="number"
                        value={data.budget}
                        onChange={(e) => set("budget", e.target.value)}
                        placeholder="e.g. 175"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="budget-input"
                      />
                    </Field>
                    <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
                      <Checkbox
                        checked={data.sliding_scale_ok}
                        onCheckedChange={(v) => set("sliding_scale_ok", v)}
                        className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                        data-testid="sliding-scale-ok"
                      />
                      <span className="text-sm text-[#2B2A29] leading-relaxed">
                        Open to sliding-scale fees — show me therapists who offer
                        rate flexibility, even if their standard rate is above my
                        budget.
                      </span>
                    </label>
                  </>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <Group
                  label="When is the client generally available?"
                  hint="Select all that apply"
                >
                  <PillRow
                    items={AVAILABILITY}
                    selected={data.availability_windows}
                    onSelect={(v) => toggleArr("availability_windows", v)}
                    testid="availability"
                  />
                </Group>
                <Group label="How soon to start?">
                  <PillRow
                    items={URGENCY}
                    selected={[data.urgency]}
                    onSelect={(v) => set("urgency", v)}
                    testid="urgency"
                  />
                </Group>
                <Group label="Has the client been in therapy before?">
                  <PillCol
                    items={PRIOR_THERAPY}
                    selected={[data.prior_therapy]}
                    onSelect={(v) => set("prior_therapy", v)}
                    testid="prior-therapy"
                  />
                </Group>
                {data.prior_therapy === "yes_not_helped" && (
                  <Field label="What didn't work last time? (optional)">
                    <Textarea
                      rows={3}
                      value={data.prior_therapy_notes}
                      onChange={(e) =>
                        set("prior_therapy_notes", e.target.value)
                      }
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="prior-notes"
                    />
                  </Field>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-6">
                <Group label="Therapist experience preference (pick all that apply)">
                  <PillRow
                    items={EXPERIENCE}
                    selected={data.experience_preference}
                    onSelect={(v) => {
                      // "no_pref" is mutually exclusive with concrete picks
                      if (v === "no_pref") {
                        set("experience_preference", ["no_pref"]);
                        return;
                      }
                      const cur = (data.experience_preference || []).filter(
                        (x) => x !== "no_pref",
                      );
                      if (cur.includes(v)) {
                        const next = cur.filter((x) => x !== v);
                        set(
                          "experience_preference",
                          next.length === 0 ? ["no_pref"] : next,
                        );
                      } else {
                        set("experience_preference", [...cur, v]);
                      }
                    }}
                    testid="experience"
                  />
                </Group>
                <Group label="Therapist gender preference">
                  <PillRow
                    items={GENDERS}
                    selected={[data.gender_preference]}
                    onSelect={(v) => set("gender_preference", v)}
                    testid="gender"
                  />
                  {data.gender_preference !== "no_pref" && (
                    <label className="flex items-center gap-3 mt-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 cursor-pointer">
                      <Switch
                        checked={data.gender_required}
                        onCheckedChange={(v) => set("gender_required", v)}
                        data-testid="gender-required"
                      />
                      <span className="text-sm text-[#2B2A29]">
                        Required (only show therapists matching this gender)
                      </span>
                    </label>
                  )}
                </Group>
                <Group
                  label="Therapist style (optional)"
                  hint="Pick any that resonate"
                >
                  <PillRow
                    items={STYLES}
                    selected={data.style_preference}
                    onSelect={(v) => toggleArr("style_preference", v)}
                    testid="style"
                  />
                </Group>
                <Group
                  label="Preferred therapy approach (optional)"
                  hint="If you have specific evidence-based modalities in mind"
                >
                  <div className="flex flex-wrap gap-2">
                    {MODALITY_PREFS.map((m) => {
                      const active = data.modality_preferences.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleArr("modality_preferences", m)}
                          data-testid={`modality-pref-${m}`}
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
              </div>
            )}

            {step === 6 && (
              <div className="space-y-5">
                <Field label="Your email (we'll send your matches here)">
                  <Input
                    type="email"
                    value={data.email}
                    onChange={(e) => set("email", e.target.value)}
                    onBlur={() => {
                      // Returning-patient prefill: if this email has filed a
                      // prior request, we pull their stable fields (referral
                      // source, zip, language preference) so they don't have
                      // to re-answer. Silent failure — this is a nice-to-have.
                      if (!emailLooksOk(data.email)) return;
                      api
                        .get(`/requests/prefill?email=${encodeURIComponent(data.email)}`)
                        .then((r) => {
                          const pre = r.data?.prefill;
                          if (!r.data?.returning || !pre) return;
                          setData((d) => {
                            // Only fill fields the patient hasn't already touched
                            const merged = { ...d };
                            const fields = [
                              "referral_source",
                              "zip_code",
                              "preferred_language",
                              "age_group",
                              "gender_preference",
                            ];
                            let changed = 0;
                            for (const k of fields) {
                              if (!merged[k] && pre[k]) {
                                merged[k] = pre[k];
                                changed += 1;
                              }
                            }
                            if (changed > 0 && !merged._prefilled_notice_shown) {
                              merged._prefilled_notice_shown = true;
                            }
                            return merged;
                          });
                          if (Object.values(pre).some(Boolean)) {
                            toast.info(
                              "Welcome back — we've pre-filled a few fields from your last request. Review and change any if needed.",
                              { duration: 6000 },
                            );
                          }
                        })
                        .catch(() => {});
                    }}
                    placeholder="you@example.com"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="email-input"
                  />
                  {data.email && !emailLooksOk(data.email) && (
                    <p
                      className="mt-1.5 text-xs text-[#D45D5D]"
                      data-testid="email-error"
                    >
                      Please use a valid personal email — disposable / temp addresses
                      aren't accepted.
                    </p>
                  )}
                </Field>
                <Field label="Phone (optional — for an instant text receipt)">
                  <Input
                    type="tel"
                    inputMode="tel"
                    maxLength={12}
                    value={data.phone}
                    onChange={(e) => set("phone", formatUsPhone(e.target.value))}
                    placeholder="208-555-0123"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="phone-input"
                  />
                  {data.phone && (
                    <label className="flex items-start gap-3 mt-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 cursor-pointer hover:border-[#2D4A3E] transition">
                      <Checkbox
                        checked={data.sms_opt_in}
                        onCheckedChange={(v) => set("sms_opt_in", !!v)}
                        className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                        data-testid="sms-opt-in"
                      />
                      <span className="text-sm text-[#2B2A29] leading-relaxed">
                        Text me a quick receipt confirming my referral was received.
                        We'll never share your number. Reply STOP anytime.
                      </span>
                    </label>
                  )}
                </Field>
                <Field label="How did you hear about us?">
                  <Select
                    value={data.referral_source}
                    onValueChange={(v) => set("referral_source", v)}
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="referral-source-trigger"
                    >
                      <SelectValue placeholder="Select an option…" />
                    </SelectTrigger>
                    <SelectContent>
                      {referralSourceOptions.map((opt) => (
                        <SelectItem
                          key={opt}
                          value={opt}
                          data-testid={`referral-source-${opt
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-+|-+$/g, "")}`}
                        >
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {data.referral_source === "Other" && (
                  <Field label="Please specify">
                    <Input
                      value={data.referral_source_other || ""}
                      onChange={(e) => set("referral_source_other", e.target.value)}
                      placeholder="e.g. saw your booth at..."
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="referral-source-other-input"
                    />
                  </Field>
                )}
                <div className="space-y-3 pt-2">
                  <CheckRow
                    id="agree"
                    checked={agreed}
                    onChange={setAgreed}
                    label={
                      <>
                        I agree to the{" "}
                        <a
                          href="/terms"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#2D4A3E] underline hover:no-underline"
                          data-testid="agree-terms-link"
                        >
                          terms of use
                        </a>{" "}
                        and{" "}
                        <a
                          href="/privacy"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#2D4A3E] underline hover:no-underline"
                          data-testid="agree-privacy-link"
                        >
                          privacy notice
                        </a>
                        .
                      </>
                    }
                    testid="agree-terms"
                  />
                  <CheckRow
                    id="adult"
                    checked={confirmAdult}
                    onChange={setConfirmAdult}
                    label="I confirm I am 18 or older."
                    testid="confirm-adult"
                  />
                  <CheckRow
                    id="emergency"
                    checked={confirmNotEmergency}
                    onChange={setConfirmNotEmergency}
                    label="I confirm this is not an emergency."
                    testid="confirm-emergency"
                  />
                </div>
              </div>
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
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                disabled={!canNext()}
                onClick={() => setStep((s) => s + 1)}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="next-btn"
              >
                Continue <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canNext() || submitting}
                onClick={() => setShowPreview(true)}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="submit-btn"
              >
                Review & submit{" "}
                <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            )}
            </div>
          </div>
        </div>
      </div>
      {showPreview && (
        <ReviewPreviewModal
          data={data}
          submitting={submitting}
          onClose={() => setShowPreview(false)}
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
function ReviewPreviewModal({ data, submitting, onClose, onConfirm }) {
  const issues = (data.presenting_issues || []).join(", ");
  const insurance =
    data.payment_type === "insurance" || data.payment_type === "either"
      ? data.insurance_name || "—"
      : "Not using insurance";
  const cash =
    data.payment_type === "cash" || data.payment_type === "either"
      ? data.budget
        ? `$${data.budget}/session`
        : "—"
      : "—";
  const referralLine =
    data.referral_source === "Other" && data.referral_source_other
      ? `Other: ${data.referral_source_other}`
      : data.referral_source || "—";
  const notes = (data.notes || "").trim();
  const rows = [
    ["Who this referral is for", data.client_type],
    ["Age group", data.age_group],
    ["Location", `${data.location_city || "—"}${data.location_zip ? `, ${data.location_zip}` : ""} (${data.location_state})`],
    ["Concerns", issues || "—"],
    ["Session format", data.modality_preference],
    ["Insurance", insurance],
    ["Cash budget", cash],
    ["Urgency", data.urgency],
    ["Therapy history", data.previous_therapy ? "Has prior therapy" : "First-time"],
    ["Preferred gender", data.gender_preference || "Any"],
    ["Preferred therapist age", data.therapist_age_preference || "Any"],
    ["Preferred language", data.preferred_language || "English"],
    ["Style preferences", (data.style_preferences || []).join(", ") || "—"],
    ["Therapy approaches", (data.preferred_modalities || []).join(", ") || "—"],
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
          <p className="text-sm text-[#6D6A65] leading-relaxed">
            Take a quick look — therapists will only see this anonymized
            version (no contact info shared until you reach out).
          </p>
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                  {label}
                </dt>
                <dd className="text-[#2B2A29] font-medium leading-snug break-words">
                  {value || "—"}
                </dd>
              </div>
            ))}
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
        </div>
        <div className="sticky bottom-0 bg-white border-t border-[#E8E5DF] p-5 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="tv-btn-secondary"
            data-testid="intake-preview-edit"
          >
            ← Edit answers
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="tv-btn-primary disabled:opacity-50"
            data-testid="intake-preview-submit"
          >
            {submitting ? "Submitting..." : "Confirm & find my matches"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#2B2A29] mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-[#6D6A65] mb-3">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function PillRow({ items, selected, onSelect, testid }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            key={it.v}
            type="button"
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-sm px-4 py-2 rounded-full border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-sm"
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

function PillCol({ items, selected, onSelect, testid }) {
  return (
    <div className="grid gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            key={it.v}
            type="button"
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-left text-sm px-4 py-3 rounded-xl border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-sm"
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

function CheckRow({ id, checked, onChange, label, testid }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
        data-testid={testid}
      />
      <span className="text-sm text-[#2B2A29] leading-relaxed">{label}</span>
    </label>
  );
}
