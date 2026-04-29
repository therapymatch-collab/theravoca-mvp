/**
 * Internal documentation panel — the operator's "how the whole
 * machine fits together" page. Lives under Admin → "How it works"
 * tab. Read-only, no API calls.
 *
 * Updated to walk a new operator through the *full* business loop:
 * lead generation → conversion → matching → therapist invitations →
 * patient hand-off → automated follow-ups → algorithm self-improvement
 * → marketing self-improvement → pricing.
 *
 * Open questions are surfaced inline so the team has a concrete
 * checklist of what's automated vs. what still needs design / build.
 */
import {
  Megaphone,
  Filter,
  Brain,
  Sparkles,
  UserPlus,
  Globe,
  ListChecks,
  Send,
  Repeat,
  TrendingUp,
  Bot,
  DollarSign,
} from "lucide-react";

const STEPS = [
  {
    icon: Megaphone,
    title: "1. Generate leads",
    body:
      "Run paid ads (Meta, Google, TikTok) plus organic strategies (SEO, partnerships, founder-led content) to drive traffic to the website. Each ad ideally lands on a campaign-specific landing page that mirrors the ad's promise.",
    open: [
      "How can ad campaigns be automated end-to-end (creative refresh, audience expansion, budget pacing)?",
      "Build a system that auto-generates landing pages from each paid ad — same headline + CTA so message-match scores stay high.",
    ],
  },
  {
    icon: Filter,
    title: "2. Convert visitors → submitted requests",
    body:
      "Optimize the website + on-site behavior so as many qualified visitors as possible submit a referral request.",
    open: [
      "For therapists: a website widget that estimates the number of leads/month TheraVoca would send to a clinician (input: their URL → output: estimated patient flow + patient-type breakdown).",
      "For patients: matching education throughout the funnel + an intuitive intake flow that doesn't feel like a clinical form. (✦ Done — current intake is 8 steps standard / 11 with deep-match opt-in.)",
    ],
  },
  {
    icon: Brain,
    title: "3. Analyze the request",
    body:
      "When a request lands, the system breaks it into explicit matching variables (state, modality, payment, urgency, schedule, gender, language) and implicit ones (deep-match P1/P2/P3 — relationship style, way of working, contextual resonance via embeddings).",
  },
  {
    icon: Sparkles,
    title: "4. Score against registered therapists (Step-1 score)",
    body:
      "The matching engine compares each request's variables to every active therapist's profile. Hard filters knock out ineligible therapists; soft axes produce a 0-100 fit score. Deep research (LLM web pull from Psychology Today, podcasts, blogs, LinkedIn) and LLM enrichment add evidence_depth + approach_alignment so the Step-1 score isn't purely self-reported.",
  },
  {
    icon: UserPlus,
    title: "5. Invite high-fit therapists to apply",
    body:
      "Therapists with a Step-1 match score of 70%+ are automatically invited (email + SMS) to apply for THIS specific referral. They have 24 hours to respond.",
  },
  {
    icon: Globe,
    title: "6. Network gap-fill — recruit non-registered therapists",
    body:
      "If the system can't identify at least 30 strong matches from the registered network, it searches the open web for non-registered therapists who appear to fit this exact request and invites them to apply. Every gap-fill effort permanently expands the network for future referrals — the funnel pays for itself.",
  },
  {
    icon: ListChecks,
    title: "7. Therapist application → Step-2 ranking score",
    body:
      "Interested therapists confirm 'Yes', write a short personalized blurb to the patient, and toggle 3 availability confirmations (taking new clients · accepts payment type · can start within urgency window). These responses produce a Step-2 ranking score on top of the Step-1 baseline. Quality of blurb (length, mentions of patient's concerns, concrete next-step language) factors in.",
  },
  {
    icon: Send,
    title: "8. Send the patient a ranked shortlist",
    body:
      "After the 24-hour application window closes, the system shares the final ranked shortlist with the patient — a curated list of therapists who've actually opted in to this specific referral.",
  },
  {
    icon: Repeat,
    title: "9. Automated follow-ups (48h · 2wk · 8wk)",
    body:
      "The system auto-pings both the patient and the matched therapist at 48 hours, 2 weeks, and 8 weeks. The goal: did a real working relationship form? (Definition of 'successful match' = patient is in active sessions at the 8-week check.)",
  },
  {
    icon: TrendingUp,
    title: "10. Feed success back into the matching algorithm",
    body:
      "Every follow-up data point trains the matching algorithm. Successful axes get up-weighted, unsuccessful ones get down-weighted. Over time the engine self-tunes for actual outcomes, not just self-reported preferences.",
  },
  {
    icon: Bot,
    title: "11. Feed success back into the marketing engine",
    body:
      "Successful matches also produce content for the next wave of paid ads — testimonial-style creative targeting look-alike patients (same age, same concerns, same payment situation). The system breathes on its own: matches make ads, ads make leads, leads make matches.",
  },
  {
    icon: DollarSign,
    title: "12. Pricing model",
    body:
      "Therapists pay $0 their first month, then $45/month thereafter to keep receiving referrals. Patients pay $0 per request — for now. (We'll re-evaluate if junk requests or therapists chasing ghost requests get out of hand.)",
  },
];

export default function HowItWorksPanel() {
  return (
    <div className="mt-6 space-y-4" data-testid="how-it-works-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          How TheraVoca works — end to end
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          The full business loop: how leads come in, how requests get
          converted, how the matching engine ranks therapists, how
          gap-filling expands our network, how we hand patients a
          curated shortlist, and how follow-up data trains both the
          algorithm <em>and</em> the next round of ads. Read this
          before your first on-call shift.
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
                {s.open && s.open.length > 0 && (
                  <ul
                    className="mt-3 space-y-1.5 text-xs text-[#2B2A29] bg-[#FBF5F2] border border-[#EBD5CB] rounded-lg p-3"
                    data-testid={`how-step-${i}-open`}
                  >
                    {s.open.map((q, qi) => (
                      <li key={qi} className="flex gap-2 leading-snug">
                        <span className="text-[#A8553F] shrink-0">●</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <h4 className="font-medium text-[#2B2A29] mb-2">
          Why we pull data from outside the therapist's website
        </h4>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          A solo therapist's website often lists every specialty
          they've ever trained in. Without independent corroboration,
          every match looks equally strong. By pulling Psychology Today
          profiles, LinkedIn pages, podcasts, blog posts, and local
          press, we can verify which specialties actually appear in
          their <em>practice</em> — not just their checkbox list — and
          re-rank Step-1 scores accordingly. This is the difference
          between "matches their stated profile" and "matches the
          shape of their actual practice."
        </p>
      </div>
      <div
        className="bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5"
        data-testid="how-it-works-loop"
      >
        <h4 className="font-medium text-[#2B2A29] mb-2">
          The self-improving loop in one line
        </h4>
        <p className="text-sm text-[#2D4A3E] leading-relaxed font-medium">
          Ads → leads → requests → matches → successful matches →
          smarter algorithm + more targeted ads → more leads.
        </p>
        <p className="text-xs text-[#6D6A65] mt-2 leading-relaxed">
          The system breathes on its own. Our job is to make sure
          steps 1, 2, 6 and 11 keep pace — everything in between is
          algorithmic.
        </p>
      </div>
    </div>
  );
}
