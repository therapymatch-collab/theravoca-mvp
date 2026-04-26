import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, X, Plus } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

const ALL_SPECIALTIES = [
  "anxiety", "depression", "trauma", "couples", "family", "grief", "addiction",
  "lgbtq", "eating", "ocd", "adhd", "stress", "self-esteem", "career", "identity",
];
const ALL_MODALITIES = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];
const ALL_AGES = [
  { v: "children-5-12", l: "Children (5–12)" },
  { v: "teen-13-17", l: "Teens (13–17)" },
  { v: "adult-18-64", l: "Adults (18–64)" },
  { v: "older-65+", l: "Older adults (65+)" },
];
const COMMON_INSURERS = [
  "Blue Cross Blue Shield", "Aetna", "Cigna", "United Healthcare", "Regence",
  "Mountain Health Co-op", "PacificSource", "Medicaid",
];

export default function TherapistSignup() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState({
    name: "",
    email: "",
    phone: "",
    licensed_states: ["ID"],
    office_locations: [],
    telehealth: true,
    specialties: [],
    modalities: [],
    ages_served: [],
    insurance_accepted: [],
    cash_rate: 150,
    years_experience: 1,
    free_consult: false,
    bio: "",
  });
  const [office, setOffice] = useState("");
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const toggleArr = (key, val) => {
    setData((d) => ({
      ...d,
      [key]: d[key].includes(val) ? d[key].filter((x) => x !== val) : [...d[key], val],
    }));
  };

  const addSpecialty = (name) => {
    if (data.specialties.find((s) => s.name === name)) {
      set(
        "specialties",
        data.specialties.filter((s) => s.name !== name),
      );
    } else if (data.specialties.length < 5) {
      const remaining = 100 - data.specialties.reduce((s, sp) => s + sp.weight, 0);
      const w = data.specialties.length === 0 ? 100 : Math.max(10, Math.floor(remaining / 2));
      set("specialties", [...data.specialties, { name, weight: w }]);
    }
  };

  const updateWeight = (name, weight) => {
    set(
      "specialties",
      data.specialties.map((s) => (s.name === name ? { ...s, weight } : s)),
    );
  };

  const valid =
    data.name.trim().length >= 3 &&
    data.email.includes("@") &&
    data.specialties.length >= 1 &&
    data.ages_served.length >= 1 &&
    data.modalities.length >= 1;

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post("/therapists/signup", data);
      setSubmitted(true);
      toast.success("Profile received — we'll be in touch soon.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header minimal />
        <main className="flex-1 flex items-center justify-center px-5 py-16">
          <div className="max-w-xl w-full bg-white border border-[#E8E5DF] rounded-3xl p-10 text-center tv-fade-up">
            <div className="mx-auto w-14 h-14 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
              <CheckCircle2 size={28} strokeWidth={1.6} />
            </div>
            <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-5">
              Profile received
            </h1>
            <p className="text-[#6D6A65] mt-3 leading-relaxed">
              Thank you for joining the TheraVoca network. Our team will review your
              profile within 1–2 business days. We just sent a confirmation to{" "}
              <span className="text-[#2D4A3E] font-medium">{data.email}</span>.
            </p>
            <Link
              to="/"
              className="tv-btn-secondary mt-8 inline-flex"
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
      <Header />
      <main className="flex-1" data-testid="therapist-signup-page">
        <section className="border-b border-[#E8E5DF] py-16 md:py-20">
          <div className="max-w-4xl mx-auto px-5 sm:px-8 grid md:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
                For licensed therapists
              </p>
              <h1 className="font-serif-display text-5xl sm:text-6xl text-[#2D4A3E] leading-tight">
                Patients come to <em className="not-italic text-[#C87965]">you</em>.
              </h1>
              <p className="mt-5 text-[#2B2A29]/80 leading-relaxed">
                Join the TheraVoca network and receive anonymous referral notifications
                matched to your specialties. No subscription, no dashboards, no marketing
                fluff — just real patients who need your help.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-[#2B2A29]">
              {[
                "Free to join during our pilot",
                "Only get notified when match score ≥ 60%",
                "One-click apply with a personal note",
                "Patient sees only your name, message, and rate until they reach out",
              ].map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-3 bg-white border border-[#E8E5DF] rounded-xl p-4"
                >
                  <CheckCircle2 size={18} className="text-[#2D4A3E] mt-0.5" />
                  <span className="leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-3xl mx-auto px-5 sm:px-8">
            <div className="bg-white border border-[#E8E5DF] rounded-3xl p-6 sm:p-10">
              <h2 className="font-serif-display text-3xl text-[#2D4A3E]">Tell us about your practice</h2>
              <p className="text-sm text-[#6D6A65] mt-1">
                All fields below help us route the right referrals to you.
              </p>

              <div className="mt-8 space-y-7">
                <Group title="Basics">
                  <Field label="Full name + license (e.g. Sarah Anderson, LCSW)">
                    <Input
                      value={data.name}
                      onChange={(e) => set("name", e.target.value)}
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="signup-name"
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={data.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="you@practice.com"
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="signup-email"
                    />
                  </Field>
                  <Field label="Phone (alerts only — never shown publicly)">
                    <Input
                      value={data.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="(208) 555-0123"
                      className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                      data-testid="signup-phone"
                    />
                  </Field>
                </Group>

                <Group title="Practice format">
                  <div className="flex items-center justify-between bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-[#2B2A29]">Telehealth</div>
                      <div className="text-xs text-[#6D6A65]">I see patients virtually</div>
                    </div>
                    <Switch
                      checked={data.telehealth}
                      onCheckedChange={(v) => set("telehealth", v)}
                      data-testid="signup-telehealth"
                    />
                  </div>
                  <Field label="Office cities (Idaho)">
                    <div className="flex gap-2">
                      <Input
                        value={office}
                        onChange={(e) => setOffice(e.target.value)}
                        placeholder="e.g. Boise"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-office-input"
                      />
                      <button
                        type="button"
                        className="tv-btn-secondary !py-2 !px-4 text-sm"
                        onClick={() => {
                          if (office.trim()) {
                            set("office_locations", [
                              ...data.office_locations,
                              office.trim(),
                            ]);
                            setOffice("");
                          }
                        }}
                        data-testid="signup-office-add"
                      >
                        <Plus size={14} className="inline mr-1" /> Add
                      </button>
                    </div>
                    <Tags
                      items={data.office_locations}
                      onRemove={(c) =>
                        set(
                          "office_locations",
                          data.office_locations.filter((x) => x !== c),
                        )
                      }
                    />
                  </Field>
                </Group>

                <Group
                  title="Specialties (top 5, with weight)"
                  hint="Pick up to 5 — adjust weights to reflect your top focus areas. Weights inform match scoring."
                >
                  <Pills
                    items={ALL_SPECIALTIES}
                    selected={data.specialties.map((s) => s.name)}
                    onToggle={addSpecialty}
                    testid="signup-specialty"
                  />
                  {data.specialties.length > 0 && (
                    <div className="mt-4 space-y-2.5">
                      {data.specialties.map((s) => (
                        <div
                          key={s.name}
                          className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2"
                        >
                          <span className="text-sm capitalize w-32 text-[#2B2A29]">
                            {s.name}
                          </span>
                          <input
                            type="range"
                            min="5"
                            max="100"
                            value={s.weight}
                            onChange={(e) =>
                              updateWeight(s.name, parseInt(e.target.value, 10))
                            }
                            className="flex-1 accent-[#2D4A3E]"
                          />
                          <span className="text-sm font-mono text-[#2D4A3E] w-10 text-right">
                            {s.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Group>

                <Group title="Modalities (top 3)">
                  <Pills
                    items={ALL_MODALITIES}
                    selected={data.modalities}
                    onToggle={(m) => {
                      if (data.modalities.includes(m)) toggleArr("modalities", m);
                      else if (data.modalities.length < 6) toggleArr("modalities", m);
                    }}
                    testid="signup-modality"
                  />
                </Group>

                <Group title="Ages served">
                  <div className="grid grid-cols-2 gap-2.5">
                    {ALL_AGES.map((a) => (
                      <label
                        key={a.v}
                        className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 cursor-pointer hover:border-[#2D4A3E] transition"
                      >
                        <Checkbox
                          checked={data.ages_served.includes(a.v)}
                          onCheckedChange={() => toggleArr("ages_served", a.v)}
                          className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                          data-testid={`signup-age-${a.v}`}
                        />
                        <span className="text-sm text-[#2B2A29]">{a.l}</span>
                      </label>
                    ))}
                  </div>
                </Group>

                <Group title="Insurance accepted (optional)">
                  <Pills
                    items={COMMON_INSURERS}
                    selected={data.insurance_accepted}
                    onToggle={(i) => toggleArr("insurance_accepted", i)}
                    testid="signup-insurance"
                  />
                </Group>

                <Group title="Rates & experience">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Cash rate per session ($)">
                      <Input
                        type="number"
                        value={data.cash_rate}
                        onChange={(e) => set("cash_rate", parseInt(e.target.value, 10) || 0)}
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="signup-cash-rate"
                      />
                    </Field>
                    <Field label="Years of experience">
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
                  <label className="flex items-center gap-3 mt-2 cursor-pointer">
                    <Checkbox
                      checked={data.free_consult}
                      onCheckedChange={(v) => set("free_consult", v)}
                      className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                      data-testid="signup-free-consult"
                    />
                    <span className="text-sm text-[#2B2A29]">
                      I offer a free initial consult (recommended — increases match-rate)
                    </span>
                  </label>
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
              </div>

              <div className="mt-10 pt-6 border-t border-[#E8E5DF] flex items-center justify-between flex-wrap gap-4">
                <p className="text-xs text-[#6D6A65] max-w-md">
                  By submitting, you agree to receive anonymous referral notifications. Your
                  profile is reviewed before going live.
                </p>
                <button
                  className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!valid || submitting}
                  onClick={submit}
                  data-testid="signup-submit"
                >
                  {submitting ? "Submitting..." : "Join the network"}{" "}
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Group({ title, hint, children }) {
  return (
    <div>
      <div className="font-semibold text-[#2B2A29] text-sm uppercase tracking-wider">
        {title}
      </div>
      {hint && <div className="text-xs text-[#6D6A65] mt-1">{hint}</div>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#6D6A65] mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function Pills({ items, selected, onToggle, testid }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = selected.includes(item);
        return (
          <button
            type="button"
            key={item}
            onClick={() => onToggle(item)}
            data-testid={`${testid}-${item}`}
            className={`text-sm px-3.5 py-1.5 rounded-full border transition capitalize ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function Tags({ items, onRemove }) {
  if (items.length === 0) return null;
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
