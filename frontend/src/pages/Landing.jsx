import { Header, Footer } from "@/components/SiteShell";
import IntakeForm from "@/components/IntakeForm";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Check, X, Sparkles } from "lucide-react";
import { useEffect } from "react";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1760702591586-a46969be7de9?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzB8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwZm9yZXN0JTIwc3Vuc2V0fGVufDB8fHx8MTc3NzIwNjYzM3ww&ixlib=rb-4.1.0&q=85";
const FEATURE_IMAGE =
  "https://images.pexels.com/photos/9064328/pexels-photo-9064328.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const FAQS = [
  {
    q: "What is TheraVoca, and how does it work?",
    a: "TheraVoca turns what you need into a structured referral and connects you with therapists who are genuinely interested in helping. No long searching or guesswork on your end.",
  },
  {
    q: "Is there a fee for patients?",
    a: "Nope, not during our pilot. Our goal is to prove value first. You'll never be billed without your explicit consent.",
  },
  {
    q: "What happens after I submit my referral request?",
    a: "We send your anonymous referral to licensed therapists in your state. Within 24 hours, you receive a personalized list of therapists who have read your needs and want to work with you.",
  },
  {
    q: "Will therapists know who I am right away?",
    a: "No. We only share anonymous details about your referral. You always stay in control of when and how you reveal your identity.",
  },
  {
    q: "What if I don't feel good about my matches?",
    a: "We're here to help you explore other options at no added stress, including trying again.",
  },
  {
    q: "Is TheraVoca available in my area?",
    a: "We are launching state by state. Currently live in Idaho. If we're not in your state, we'll add you to our waitlist.",
  },
];

export default function Landing() {
  // Cross-page anchor links (`/#start`) need a manual scroll on mount because
  // React Router's hashchange handling doesn't fire when content is rendered
  // post-mount. This makes "Get matched" buttons from any page reliably land
  // on the intake form.
  useEffect(() => {
    const hash = window.location.hash?.replace("#", "");
    if (!hash) return;
    const tryScroll = () => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    // Run once after first paint, and once after a short delay to catch
    // sections rendered behind lazy boundaries (e.g. IntakeForm bottom).
    requestAnimationFrame(tryScroll);
    const t = setTimeout(tryScroll, 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-[#E8E5DF]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 md:py-24 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="tv-fade-up">
            <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-5">
              <Sparkles size={14} className="inline mr-1.5 -mt-0.5" strokeWidth={1.8} />
              Pilot live in Idaho
            </p>
            <h1 className="font-serif-display text-5xl sm:text-6xl lg:text-7xl text-[#2D4A3E] leading-[1.05] tracking-tight">
              Let therapists <em className="not-italic text-[#C87965]">come to you</em>.
            </h1>
            <p
              className="mt-5 text-2xl sm:text-3xl text-[#2D4A3E] font-serif-display leading-snug"
              data-testid="hero-promise"
            >
              <span className="font-semibold">3+ matched therapists in 24 hours</span>
              <span className="text-[#C87965]">, guaranteed.</span>
            </p>
            <p className="mt-5 text-lg text-[#2B2A29]/80 leading-relaxed max-w-xl">
              No more searching, cold-calls, or waiting to hear back. Pick what
              matters, and we'll route your request to therapists in your
              network who actually want to work with you.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a href="#start" className="tv-btn-primary" data-testid="hero-cta">
                Get matched — free
              </a>
              <a
                href="#how"
                className="text-sm text-[#2D4A3E] underline underline-offset-4 hover:text-[#3A5E50]"
                data-testid="hero-secondary"
              >
                How it works →
              </a>
            </div>
            <ul className="mt-10 space-y-2.5 text-[#2B2A29]/80 text-sm">
              {[
                "Structured intake — no vague free-text guesses",
                "Smarter matching across 5 weighted axes",
                "Anonymous referrals, contact info revealed last",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-5 w-5 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] items-center justify-center">
                    <Check size={12} strokeWidth={2.4} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative tv-fade-up tv-delay-2">
            <div className="absolute -top-6 -right-6 w-72 h-72 bg-[#C87965]/15 rounded-full blur-3xl" />
            <div className="relative rounded-3xl overflow-hidden border border-[#E8E5DF] shadow-[0_20px_60px_-20px_rgba(45,74,62,0.25)]">
              <img
                src={HERO_IMAGE}
                alt="Sunlight through a forest"
                className="w-full h-[440px] sm:h-[540px] object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -left-6 bg-white border border-[#E8E5DF] rounded-2xl px-5 py-4 shadow-sm hidden sm:flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#2D4A3E] text-white flex flex-col items-center justify-center font-serif-display leading-none">
                <div className="text-base font-semibold">24h</div>
              </div>
              <div className="text-sm">
                <div className="font-semibold text-[#2B2A29]">3+ matches in 24 hours</div>
                <div className="text-[#6D6A65]">guaranteed</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
              How it works
            </p>
            <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight">
              Three steps. No forms-overload.
            </h2>
          </div>
          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {[
              {
                n: "01",
                title: "Tap what fits",
                body:
                  "Pick from a curated list of presenting issues, then a few specifics — age, format, payment. Two minutes, no rambling required.",
              },
              {
                n: "02",
                title: "We reach out for you",
                body:
                  "We anonymously share your referral with our network of pre-qualified therapists in your state.",
              },
              {
                n: "03",
                title: "Therapists come to you",
                body:
                  "Within 24 hours you get a personalized list of therapists who read your needs and want to work with you.",
              },
            ].map((s, i) => (
              <div
                key={s.n}
                className={`bg-white border border-[#E8E5DF] rounded-3xl p-8 hover:-translate-y-1 transition ${
                  i === 1 ? "md:translate-y-6" : ""
                }`}
                data-testid={`how-step-${i}`}
              >
                <div className="font-serif-display text-5xl text-[#C87965]">{s.n}</div>
                <h3 className="mt-4 text-xl font-semibold text-[#2B2A29]">{s.title}</h3>
                <p className="mt-3 text-[#6D6A65] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DIFFERENT */}
      <section
        id="different"
        className="py-20 md:py-28 bg-[#F4EFE7] border-y border-[#E8E5DF]"
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <div className="rounded-3xl overflow-hidden border border-[#E8E5DF]">
            <img
              src={FEATURE_IMAGE}
              alt="Therapy session"
              className="w-full h-[440px] object-cover"
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3">
              How we're different
            </p>
            <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight">
              Finding the right therapist shouldn't feel like a full-time job.
            </h2>
            <div className="mt-8 space-y-5">
              {[
                {
                  title: "Directories",
                  body:
                    "Endless profiles don't tell you who's available, aligned, or responsive. Many never reply.",
                },
                {
                  title: "Search engines & LLMs",
                  body:
                    "SEO and ads favor the best marketers, not the best matches. You're looking for someone who gets you.",
                },
                {
                  title: "Word of mouth",
                  body:
                    "Even trusted suggestions can miss the mark. If it's not a fit, you're back at square one.",
                },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-6 w-6 rounded-full bg-[#D45D5D]/10 text-[#D45D5D] items-center justify-center">
                    <X size={14} strokeWidth={2} />
                  </span>
                  <div>
                    <div className="font-semibold text-[#2B2A29]">{item.title}</div>
                    <p className="text-sm text-[#6D6A65] leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 pt-2 border-t border-[#E8E5DF]/80">
                <span className="mt-1 inline-flex h-6 w-6 rounded-full bg-[#2D4A3E] text-white items-center justify-center">
                  <Check size={14} strokeWidth={2.4} />
                </span>
                <div>
                  <div className="font-semibold text-[#2D4A3E]">
                    TheraVoca does the logistical work
                  </div>
                  <p className="text-sm text-[#6D6A65] leading-relaxed">
                    We start by understanding you, then deliver a personalized list of
                    pre-qualified therapists ready to support you.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTAKE FORM */}
      <IntakeForm />

      {/* FAQ */}
      <section id="faq" className="py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8">
          <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-3 text-center">
            FAQs
          </p>
          <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight text-center">
            Things people ask
          </h2>
          <Accordion type="single" collapsible className="mt-10" data-testid="faq">
            {FAQS.map((f) => (
              <AccordionItem
                key={f.q}
                value={`item-${f.q}`}
                className="border-[#E8E5DF]"
                data-testid={`faq-item-${f.q.slice(0, 20)}`}
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

      <Footer />
    </div>
  );
}
