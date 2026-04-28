/**
 * Internal documentation panel that shows the team how a patient
 * request flows through the system. Read-only — no API calls. Lives
 * under Admin → "How it works" tab so a new operator can ramp up
 * without spelunking through code.
 */
import {
  ClipboardCheck,
  Mail,
  Brain,
  Globe,
  Users,
  Sparkles,
  ListOrdered,
} from "lucide-react";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "1. Patient submits intake",
    body: "Anonymous form, no login. Patient picks concerns, modality, schedule, payment, and (optionally) which factors matter most. Bot defenses (honeypot + timing + per-IP rate limit) reject obvious spam before any DB write.",
  },
  {
    icon: Mail,
    title: "2. Email verification",
    body: "We send a verification link via Resend. Matching does NOT run until they click. If a request shows '0 matches' but the patient hasn't verified, that's why — not a directory gap.",
  },
  {
    icon: Brain,
    title: "3. Profile match scoring (100-point engine)",
    body: "On verify, every active therapist is scored against the request across 10 axes (issues, schedule, modality, urgency, prior therapy, experience, gender, style, payment fit, modality preference). Hard filters: state license, age group, payment compatibility, gender (if required). Patient priorities multiply selected axes by 1.8×.",
  },
  {
    icon: Globe,
    title: "4. LLM web research enrichment",
    body: "For top candidates we run a deep web pull — DuckDuckGo + Bing search of the therapist's name + license + city, fetch up to 5 result pages (Psychology Today profiles, podcasts, blogs, LinkedIn, Healthgrades), and feed the corpus + their own website + bio to Claude. The LLM returns evidence_depth (0-10), approach_alignment (0-5), and themes — re-ranking who the patient actually sees.",
  },
  {
    icon: Users,
    title: "5. Outreach to non-registered therapists (gap fill)",
    body: "If after profile-matching we have <30 strong matches, an LLM agent searches the open web for therapists matching the patient's exact needs and emails them an invite to apply for THIS specific referral. Acceptance bumps them into the candidate pool.",
  },
  {
    icon: Sparkles,
    title: "6. Therapists opt in",
    body: "Notified therapists click 'Apply' from email, write a short reply to the patient, and confirm availability/payment/urgency. Each application carries a `match_score` from step 3.",
  },
  {
    icon: ListOrdered,
    title: "7. Patient-side re-ranking",
    body: "When the 24h window closes, we re-rank applicants on the patient's screen using: 60% match_score · 30% speed of response · 12% therapist-message quality. Quality includes length, mentions of the patient's concerns, concrete next-step language, and personal voice.",
  },
];

export default function HowItWorksPanel() {
  return (
    <div className="mt-6 space-y-4" data-testid="how-it-works-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          How a request flows through TheraVoca
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          End-to-end flow from intake to ranked results — useful when
          onboarding a new operator or explaining the algorithm to a
          partner. All numbers are tunable in <code>matching.py</code>{" "}
          and <code>routes/patients.py</code>.
        </p>
      </div>
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li
              key={s.title}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-5 flex gap-4"
              data-testid={`how-step-${i}`}
            >
              <div className="w-10 h-10 rounded-full bg-[#FBF3E8] text-[#C87965] flex items-center justify-center shrink-0">
                <Icon size={18} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-[#2B2A29]">{s.title}</h4>
                <p className="text-sm text-[#6D6A65] leading-relaxed mt-1 break-words">
                  {s.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <h4 className="font-medium text-[#2B2A29] mb-2">Why we go beyond the therapist's website</h4>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          A solo therapist's website often lists every specialty they've
          ever trained in. Without independent corroboration, every match
          looks equally strong. By pulling Psychology Today profiles,
          LinkedIn pages, podcasts, blog posts, and local press from
          DuckDuckGo + Bing, we can verify which specialties actually
          appear in their <em>practice</em> — not just their checkbox
          list — and re-rank accordingly. We deliberately skip paid
          search APIs (SerpAPI, Google Custom Search) for now to keep
          unit economics clean during the pilot.
        </p>
      </div>
    </div>
  );
}
