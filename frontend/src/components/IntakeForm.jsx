import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [agreed, setAgreed] = useState(false);
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [confirmNotEmergency, setConfirmNotEmergency] = useState(false);
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
    experience_preference: "no_pref",
    gender_preference: "no_pref",
    gender_required: false,
    style_preference: [],
    referral_source: "",
    email: "",
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const toggleArr = (k, v, max) =>
    setData((d) => {
      const arr = d[k];
      if (arr.includes(v)) return { ...d, [k]: arr.filter((x) => x !== v) };
      if (max && arr.length >= max) return d;
      return { ...d, [k]: [...arr, v] };
    });

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
        return !!(data.location_city || data.location_zip);
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
      return data.email && agreed && confirmAdult && confirmNotEmergency;
    return false;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        ...data,
        budget: data.budget ? parseInt(data.budget, 10) : null,
      };
      const res = await api.post("/requests", payload);
      toast.success("Request received — please check your email to confirm.");
      navigate(`/verify/pending?id=${res.data.id}`, { replace: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
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

        <div className="bg-white border border-[#E8E5DF] rounded-3xl shadow-sm p-6 sm:p-10">
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
                  We're currently licensed in <strong>Idaho</strong>.
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
                        onChange={(e) =>
                          set(
                            "location_zip",
                            e.target.value.replace(/\D/g, "").slice(0, 5),
                          )
                        }
                        placeholder="83702"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="zip-input"
                      />
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
                <Group label="Therapist experience preference">
                  <PillRow
                    items={EXPERIENCE}
                    selected={[data.experience_preference]}
                    onSelect={(v) => set("experience_preference", v)}
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
                    placeholder="you@example.com"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="email-input"
                  />
                </Field>
                <div className="space-y-3 pt-2">
                  <CheckRow
                    id="agree"
                    checked={agreed}
                    onChange={setAgreed}
                    label="I agree to the terms of use and privacy notice."
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

          <div className="mt-8 flex items-center justify-between">
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
                onClick={submit}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="submit-btn"
              >
                {submitting ? "Submitting..." : "Find my matches"}{" "}
                <Check size={18} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
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
