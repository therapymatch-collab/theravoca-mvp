import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";

const STEPS = [
  { key: "what", label: "What brings you here?" },
  { key: "who", label: "Who is therapy for?" },
  { key: "format", label: "Format & location" },
  { key: "payment", label: "Payment" },
  { key: "preferences", label: "Therapist preferences" },
  { key: "contact", label: "Where to reach you" },
];

const ISSUE_CHIPS = [
  { key: "anxiety", label: "Anxiety" },
  { key: "depression", label: "Depression" },
  { key: "trauma", label: "Trauma / PTSD" },
  { key: "couples", label: "Couples / relationship" },
  { key: "family", label: "Family / parenting" },
  { key: "grief", label: "Grief / loss" },
  { key: "addiction", label: "Addiction / recovery" },
  { key: "lgbtq", label: "LGBTQ+" },
  { key: "eating", label: "Eating / body image" },
  { key: "ocd", label: "OCD" },
  { key: "adhd", label: "ADHD / focus" },
  { key: "stress", label: "Stress / burnout" },
  { key: "self-esteem", label: "Self-esteem" },
  { key: "career", label: "Career / work" },
  { key: "identity", label: "Identity" },
];

export default function IntakeForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [confirmNotEmergency, setConfirmNotEmergency] = useState(false);
  const [data, setData] = useState({
    selected_issues: [],
    issue_context: "",
    client_age: "",
    location_state: "ID",
    location_city: "",
    location_zip: "",
    session_format: "virtual",
    payment_type: "cash",
    insurance_name: "",
    budget: "",
    preferred_gender: "",
    preferred_modality: "",
    other_notes: "",
    referral_source: "",
    email: "",
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const toggleIssue = (k) =>
    setData((d) => ({
      ...d,
      selected_issues: d.selected_issues.includes(k)
        ? d.selected_issues.filter((x) => x !== k)
        : [...d.selected_issues, k],
    }));

  const canNext = () => {
    if (step === 0) return data.selected_issues.length >= 1;
    if (step === 1) return data.client_age && Number(data.client_age) >= 1;
    if (step === 2) return !!data.session_format && !!data.location_state;
    if (step === 3) {
      if (data.payment_type === "cash") return !!data.budget;
      return data.payment_type === "insurance";
    }
    if (step === 4) return true;
    if (step === 5)
      return (
        data.email &&
        agreed &&
        confirmAdult &&
        confirmNotEmergency
      );
    return false;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const issuesLabel = data.selected_issues.join(", ");
      const presenting_issues =
        issuesLabel +
        (data.issue_context.trim() ? `. ${data.issue_context.trim()}` : "");
      const { selected_issues: _si, issue_context: _ic, ...rest } = data;
      const payload = {
        ...rest,
        presenting_issues,
        client_age: parseInt(data.client_age, 10),
        budget: data.budget ? parseInt(data.budget, 10) : null,
      };
      const res = await api.post("/requests", payload);
      toast.success("Request received — please check your email to confirm.");
      navigate(`/verify/pending?id=${res.data.id}`, { replace: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Something went wrong. Please try again.");
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
            Free during our pilot. No account required.
          </p>
        </div>

        <div className="bg-white border border-[#E8E5DF] rounded-3xl shadow-sm p-6 sm:p-10">
          <div className="mb-6">
            <div className="flex justify-between text-xs text-[#6D6A65] mb-2">
              <span data-testid="step-label">
                Step {step + 1} of {STEPS.length}: {STEPS[step].label}
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
              <div>
                <label className="block text-sm font-semibold text-[#2B2A29] mb-2">
                  What brings you here today?
                </label>
                <p className="text-sm text-[#6D6A65] mb-4">
                  Select everything that resonates. Pick at least one.
                </p>
                <div
                  className="flex flex-wrap gap-2"
                  data-testid="issue-chips"
                >
                  {ISSUE_CHIPS.map((c) => {
                    const active = data.selected_issues.includes(c.key);
                    return (
                      <button
                        type="button"
                        key={c.key}
                        onClick={() => toggleIssue(c.key)}
                        data-testid={`issue-chip-${c.key}`}
                        className={`text-sm px-4 py-2 rounded-full border transition ${
                          active
                            ? "bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-sm"
                            : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-7">
                  <label className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider mb-2">
                    Anything else? (optional)
                  </label>
                  <Textarea
                    value={data.issue_context}
                    onChange={(e) => set("issue_context", e.target.value)}
                    rows={4}
                    placeholder="e.g. post-divorce, perinatal, after a recent loss, prefer evening sessions… (Avoid sharing personally identifiable information.)"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl text-[#2B2A29] focus-visible:ring-[#2D4A3E]/30"
                    data-testid="issue-context-input"
                  />
                </div>
                <p className="text-xs text-[#6D6A65] mt-2">
                  {data.selected_issues.length === 0
                    ? "Pick at least one to continue."
                    : `${data.selected_issues.length} selected — the more, the better the match.`}
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <Field label="Client age">
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={data.client_age}
                    onChange={(e) => set("client_age", e.target.value)}
                    placeholder="e.g. 28"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="client-age-input"
                  />
                </Field>
                <Field label="Therapist license state (where the patient lives)">
                  <Select
                    value={data.location_state}
                    onValueChange={(v) => set("location_state", v)}
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="state-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ID">Idaho</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-[#6D6A65] mt-1">
                    We're launching state by state. Currently live in Idaho.
                  </p>
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <Field label="Session format">
                  <Select
                    value={data.session_format}
                    onValueChange={(v) => set("session_format", v)}
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="format-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="virtual">Telehealth (virtual)</SelectItem>
                      <SelectItem value="in-person">In-person</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {(data.session_format === "in-person" ||
                  data.session_format === "hybrid") && (
                  <>
                    <Field label="City preference">
                      <Input
                        value={data.location_city}
                        onChange={(e) => set("location_city", e.target.value)}
                        placeholder="e.g. Boise"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="city-input"
                      />
                    </Field>
                    <Field label="ZIP code (recommended — gives more accurate distance matches)">
                      <Input
                        inputMode="numeric"
                        maxLength={5}
                        value={data.location_zip}
                        onChange={(e) =>
                          set("location_zip", e.target.value.replace(/\D/g, "").slice(0, 5))
                        }
                        placeholder="e.g. 83702"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="zip-input"
                      />
                    </Field>
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <Field label="Payment method">
                  <Select
                    value={data.payment_type}
                    onValueChange={(v) => set("payment_type", v)}
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="payment-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash / out-of-pocket</SelectItem>
                      <SelectItem value="insurance">Insurance</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {data.payment_type === "cash" && (
                  <Field label="Per-session budget (USD)">
                    <Input
                      type="number"
                      value={data.budget}
                      onChange={(e) => set("budget", e.target.value)}
                      placeholder="e.g. 150"
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="budget-input"
                    />
                  </Field>
                )}
                {data.payment_type === "insurance" && (
                  <Field label="Insurance carrier">
                    <Input
                      value={data.insurance_name}
                      onChange={(e) => set("insurance_name", e.target.value)}
                      placeholder="e.g. Blue Cross Blue Shield"
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="insurance-input"
                    />
                  </Field>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <Field label="Therapist gender preference (optional)">
                  <Select
                    value={data.preferred_gender || "any"}
                    onValueChange={(v) =>
                      set("preferred_gender", v === "any" ? "" : v)
                    }
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="gender-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">No preference</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="nonbinary">Non-binary</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Modality preference (optional)">
                  <Input
                    value={data.preferred_modality}
                    onChange={(e) => set("preferred_modality", e.target.value)}
                    placeholder="e.g. CBT, EMDR, Mindfulness"
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="modality-input"
                  />
                </Field>
                <Field label="Anything else? (optional)">
                  <Textarea
                    value={data.other_notes}
                    onChange={(e) => set("other_notes", e.target.value)}
                    rows={3}
                    placeholder="Scheduling, identity considerations, prior therapy experience, etc."
                    className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                    data-testid="notes-input"
                  />
                </Field>
              </div>
            )}

            {step === 5 && (
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
                <Field label="How did you find us? (optional)">
                  <Select
                    value={data.referral_source || "none"}
                    onValueChange={(v) =>
                      set("referral_source", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="referral-source"
                    >
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="google">Google search</SelectItem>
                      <SelectItem value="friend">Friend / family</SelectItem>
                      <SelectItem value="physician">Physician referral</SelectItem>
                      <SelectItem value="social">Social media</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
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
                    label="I confirm this request is not an emergency."
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

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#2B2A29] mb-2">
        {label}
      </label>
      {children}
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
