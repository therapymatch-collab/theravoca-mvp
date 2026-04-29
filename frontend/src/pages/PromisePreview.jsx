/* eslint-disable react/no-unescaped-entities */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  X as XIcon,
  Sparkles,
  Heart,
  ArrowRight,
  Star,
  Phone,
  Mail,
  ChevronDown,
  Leaf,
} from "lucide-react";

// ─── PROMISE COPY ───────────────────────────────────────────────────────
const PROMISE_LONG =
  "A successful match means the patient and therapist work together long enough for the patient to report feeling better about their presenting issue — and to view the relationship and time together as ultimately beneficial in their life.";
const PROMISE_MEDIUM =
  "A successful match means working together long enough for you to feel better — and to look back on the time as time well spent.";
const PROMISE_SHORT_PATIENT =
  "A match isn't just a referral. It's a relationship that helps you feel better.";
const PROMISE_SHORT_THERAPIST =
  "We measure ourselves on your patients' outcomes — not on how many therapists we sign up.";
const PROMISE_RESULTS_BANNER =
  "We measure success by how you feel 90 days from now — not by how many emails we sent.";
const PROMISE_NORTHSTAR =
  "Our north star: matches that help you feel better — not ones that fill slots.";

// ─── REUSABLE BROWSER FRAME ─────────────────────────────────────────────
function MockFrame({ children, label, url }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl shadow-sm overflow-hidden">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F4EFE7] border-b border-[#E8E5DF]">
        <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
        <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
        <span className="w-3 h-3 rounded-full bg-[#28C840]" />
        <div className="ml-3 flex-1 max-w-md bg-white border border-[#E8E5DF] rounded-md text-xs text-[#6D6A65] px-3 py-1 truncate">
          {url}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[#6D6A65] hidden sm:block">
          {label}
        </span>
      </div>
      <div className="bg-[#FDFBF7]">{children}</div>
    </div>
  );
}

function MockHeader() {
  return (
    <div className="bg-white border-b border-[#E8E5DF] px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[#2D4A3E] flex items-center justify-center">
          <Leaf size={14} className="text-white" />
        </div>
        <span className="font-serif-display text-lg text-[#2D4A3E]">
          TheraVoca
        </span>
      </div>
      <div className="hidden md:flex items-center gap-5 text-xs text-[#6D6A65]">
        <span>How it works</span>
        <span>Testimonials</span>
        <span>Why TheraVoca</span>
        <span>FAQs</span>
        <span>For therapists</span>
        <span>Sign in</span>
        <span className="bg-[#2D4A3E] text-white rounded-full px-3 py-1.5 font-medium">
          Get matched
        </span>
      </div>
    </div>
  );
}

function MockFooter({ withWatermark = false }) {
  return (
    <div className="border-t border-[#E8E5DF] bg-white px-6 py-8 mt-12">
      <div className="grid grid-cols-3 gap-6 text-xs text-[#6D6A65]">
        <div>
          <p className="font-serif-display text-base text-[#2D4A3E] mb-1">
            TheraVoca
          </p>
          <p>Let therapists come to you.</p>
        </div>
        <div>
          <p className="font-semibold text-[#2D4A3E] mb-1">Crisis support</p>
          <p>Call 911 or 988 if in crisis.</p>
        </div>
        <div>
          <p className="font-semibold text-[#2D4A3E] mb-1">Privacy</p>
          <p>We never share your info.</p>
        </div>
      </div>
      {withWatermark && (
        <p className="mt-6 italic font-serif-display text-[#2D4A3E]/70 text-sm border-t border-[#E8E5DF] pt-4">
          “{PROMISE_MEDIUM}” — our promise
        </p>
      )}
      <p className="text-[10px] text-[#6D6A65] mt-3">
        © 2026 TheraVoca · Terms · Privacy · Blog
      </p>
    </div>
  );
}

function MockHero({ children }) {
  return (
    <div className="px-6 py-10 grid sm:grid-cols-2 gap-8 items-center">
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965] mb-3">
          ✦ Pilot live in Idaho
        </p>
        <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] leading-[1.05]">
          Let therapists{" "}
          <em className="not-italic text-[#C87965]">come to you</em>.
        </h1>
        <p className="mt-3 text-lg text-[#2D4A3E] font-serif-display">
          <span className="font-semibold">3+ matched therapists in 24 hours</span>
          <span className="text-[#C87965]">, guaranteed.</span>
        </p>
        <p className="mt-3 text-sm text-[#2B2A29]/80 max-w-md">
          No more searching, cold-calls, or waiting to hear back. Pick what
          matters, and we'll route your request to therapists who actually
          want to work with you.
        </p>
        {children}
      </div>
      <div className="bg-[#C87965]/15 rounded-2xl h-48 sm:h-64 flex items-center justify-center text-[#6D6A65] text-sm">
        [hero photo]
      </div>
    </div>
  );
}

// ─── 10 PROMISE MOCKUPS ─────────────────────────────────────────────────

function Mock1() {
  return (
    <MockFrame label="Landing — Option 1" url="theravoca.com/">
      <MockHeader />
      <MockHero>
        <div className="mt-5 max-w-md border-l-2 border-[#C87965] pl-4 py-1">
          <p className="font-serif-display italic text-base text-[#2D4A3E] leading-relaxed">
            “{PROMISE_SHORT_PATIENT}”
          </p>
          <p className="text-[9px] uppercase tracking-wider text-[#C87965] mt-1.5 font-semibold">
            — our promise
          </p>
        </div>
        <div className="mt-5 flex gap-3">
          <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 font-medium">
            Get matched — free
          </span>
          <span className="text-xs text-[#2D4A3E] underline self-center">
            How it works →
          </span>
        </div>
      </MockHero>
      <MockFooter />
    </MockFrame>
  );
}

function Mock2() {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(PROMISE_MEDIUM.slice(0, i));
      if (i >= PROMISE_MEDIUM.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, []);
  return (
    <MockFrame label="Landing — Option 2" url="theravoca.com/">
      <MockHeader />
      <MockHero>
        <div className="mt-5 flex gap-3">
          <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 font-medium">
            Get matched — free
          </span>
        </div>
        <p className="mt-5 font-serif-display text-sm text-[#2D4A3E]/85 leading-relaxed max-w-md min-h-[3rem]">
          {shown}
          <span className="inline-block w-[2px] h-4 bg-[#C87965] ml-1 align-middle animate-pulse" />
        </p>
      </MockHero>
      <MockFooter />
    </MockFrame>
  );
}

function Mock3() {
  return (
    <MockFrame
      label="Landing — Option 3 (replaces 'How we're different')"
      url="theravoca.com/"
    >
      <MockHeader />
      <div className="px-6 py-3 text-xs text-[#6D6A65] italic">
        … hero, How it works, Testimonials …
      </div>
      <div className="bg-[#2D4A3E] text-white px-6 py-12">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#FBE9E5] mb-4">
          What we mean by "match"
        </p>
        <h2 className="font-serif-display text-3xl leading-snug">
          We don't sell referrals.
        </h2>
        <p className="font-serif-display italic text-lg text-[#FBE9E5] leading-relaxed mt-4 max-w-2xl">
          “{PROMISE_LONG}”
        </p>
        <p className="text-[10px] uppercase tracking-wider text-white/60 mt-4">
          — TheraVoca's definition of success
        </p>
      </div>
      <div className="px-6 py-3 text-xs text-[#6D6A65] italic">
        … intake form, FAQs …
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function Mock4() {
  return (
    <MockFrame
      label="Landing — Option 4 (manifesto card above FAQs)"
      url="theravoca.com/#faq"
    >
      <MockHeader />
      <div className="px-6 py-3 text-xs text-[#6D6A65] italic">
        … hero, How it works, intake form …
      </div>
      <div className="px-6 py-8">
        <div className="bg-[#FBE9E5] border-2 border-[#C87965] rounded-3xl p-6 sm:p-8 relative overflow-hidden">
          <svg
            viewBox="0 0 80 50"
            className="absolute right-4 top-4 w-16 h-12 text-[#C87965]/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="28" cy="25" r="20" />
            <circle cx="52" cy="25" r="20" />
          </svg>
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965] font-semibold mb-3">
            the match — our manifesto
          </p>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            We exist for one outcome.
          </h3>
          <p className="text-sm text-[#2B2A29]/85 mt-3 leading-relaxed max-w-lg">
            {PROMISE_LONG}
          </p>
          <p className="text-xs text-[#6D6A65] mt-4 max-w-lg">
            Patient + therapist + time = a third thing — a relationship that
            helps. Everything we build serves that.
          </p>
        </div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965] mt-8 text-center">
          FAQs
        </p>
        <h2 className="font-serif-display text-2xl text-[#2D4A3E] text-center">
          Things people ask
        </h2>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function Mock5() {
  return (
    <MockFrame
      label="Any page — Option 5 (sticky pill ribbon, dismissible)"
      url="theravoca.com/"
    >
      <MockHeader />
      <MockHero>
        <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 font-medium mt-5 inline-block">
          Get matched — free
        </span>
      </MockHero>
      <div className="px-6 py-3 text-xs text-[#6D6A65] italic">
        … rest of page …
      </div>
      <div className="relative">
        <MockFooter />
        {/* Pinned ribbon */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#2D4A3E] text-white text-xs py-2 px-4 rounded-full shadow-lg flex items-center gap-2 max-w-[90%]">
          <Heart size={11} className="text-[#FBE9E5]" />
          <span className="truncate">{PROMISE_NORTHSTAR}</span>
          <XIcon size={11} className="text-white/60" />
        </div>
      </div>
    </MockFrame>
  );
}

function Mock6() {
  return (
    <MockFrame label="New page — Option 6 (/our-promise)" url="theravoca.com/our-promise">
      <MockHeader />
      <div className="px-6 py-10">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965] mb-3">
          ✦ Our promise
        </p>
        <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] leading-[1.05]">
          We work for one outcome.
        </h1>
        <blockquote className="mt-6 border-l-4 border-[#C87965] pl-5 py-1">
          <p className="font-serif-display italic text-lg text-[#2D4A3E] leading-relaxed">
            “{PROMISE_LONG}”
          </p>
          <p className="text-[10px] uppercase tracking-wider text-[#C87965] mt-2 font-semibold">
            — TheraVoca's definition of a successful match
          </p>
        </blockquote>
        <div className="grid grid-cols-3 gap-4 mt-8">
          {[
            ["The patient", "explicit needs + lived experience"],
            ["The therapist", "training + style + lived experience"],
            ["The match", "a relationship over time — measured at 90 days"],
          ].map(([h, b]) => (
            <div
              key={h}
              className="border border-[#E8E5DF] rounded-xl p-4 bg-white"
            >
              <p className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
                {h}
              </p>
              <p className="text-xs text-[#2B2A29]/85 mt-1.5 leading-relaxed">
                {b}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8 bg-[#2D4A3E] rounded-2xl p-6 text-white">
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#FBE9E5] mb-2">
            For therapists
          </p>
          <h2 className="font-serif-display text-xl">
            We grade ourselves on your patients' outcomes — not on how many
            therapists we sign up.
          </h2>
        </div>
        <p className="text-[10px] text-[#6D6A65] mt-6 italic">
          (preview only — production page not built yet)
        </p>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function Mock7() {
  return (
    <MockFrame
      label="Patient Results — Option 7"
      url="theravoca.com/results/abc123"
    >
      <MockHeader />
      <div className="px-6 py-8">
        <p className="text-[10px] uppercase tracking-wider text-[#C87965]">
          Your matches
        </p>
        <h1 className="font-serif-display text-2xl text-[#2D4A3E] mt-1">
          Therapists who want to work with you
        </h1>
        <div className="mt-6 bg-[#2D4A3E]/5 border-l-4 border-[#C87965] rounded-r-xl px-4 py-3 flex items-start gap-2.5">
          <Heart size={16} className="text-[#C87965] mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#2D4A3E]">
              How TheraVoca measures success
            </p>
            <p className="text-xs text-[#2B2A29]/80 mt-1 leading-relaxed">
              {PROMISE_RESULTS_BANNER} If a therapist isn't a fit after 2
              sessions, just tell us — we'll re-match for free.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {[
            ["Dr. Ana M.", "LCSW · Anxiety + Trauma · 8 yrs"],
            ["James K.", "LMFT · Couples · 12 yrs"],
            ["Priya S.", "PsyD · Burnout · 6 yrs"],
          ].map(([n, m]) => (
            <div
              key={n}
              className="border border-[#E8E5DF] rounded-xl p-3 bg-white flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-[#FBE9E5]" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#2D4A3E]">{n}</p>
                <p className="text-xs text-[#6D6A65]">{m}</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#6D6A65]">
                <Star size={10} className="text-[#C87965]" />
                4.9
              </div>
              <Phone size={14} className="text-[#6D6A65]" />
              <Mail size={14} className="text-[#6D6A65]" />
            </div>
          ))}
        </div>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function Mock8() {
  return (
    <MockFrame
      label="Therapist Signup — Option 8"
      url="theravoca.com/therapists/join"
    >
      <MockHeader />
      <div className="px-6 py-6">
        <div className="bg-[#FBF2E8] border border-[#F0DEC8] rounded-xl px-4 py-4 flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#B8742A] text-white flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#8B5A1F]">
              Why we don't pay for clicks
            </p>
            <p className="text-xs text-[#2B2A29]/85 mt-1 leading-relaxed">
              {PROMISE_SHORT_THERAPIST} If your patients aren't reporting
              they feel better at 90 days, we tune the matching engine —
              not your ad spend.
            </p>
          </div>
        </div>
      </div>
      <div className="px-6 py-6 grid sm:grid-cols-2 gap-6 items-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965] mb-2">
            For licensed therapists
          </p>
          <h1 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            You focus on{" "}
            <em className="not-italic text-[#C87965]">care</em> — we provide
            the referrals.
          </h1>
          <p className="mt-3 text-xs text-[#2B2A29]/80">
            Marketing yourself can feel frustrating. We send pre-screened
            referrals straight to your inbox.
          </p>
          <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 font-medium mt-4 inline-block">
            Sign up — start free trial →
          </span>
        </div>
        <div className="bg-[#C87965]/15 rounded-xl h-32" />
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function Mock9() {
  return (
    <MockFrame
      label="Every page — Option 9 (footer watermark)"
      url="theravoca.com/"
    >
      <MockHeader />
      <div className="px-6 py-10 text-xs text-[#6D6A65] italic">
        … any page content …
      </div>
      <MockFooter withWatermark />
    </MockFrame>
  );
}

function Mock10() {
  return (
    <div className="space-y-3">
      <div className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl p-4">
        <p className="text-sm font-semibold text-[#C8412B] mb-1">
          ✦ Recommended — combines 4 touch-points
        </p>
        <ol className="text-xs text-[#2B2A29]/85 space-y-0.5 list-decimal pl-5">
          <li>Hero italic quote (Option 1)</li>
          <li>Manifesto card above FAQs (Option 4)</li>
          <li>
            Dedicated <code className="bg-white px-1 rounded">/our-promise</code> page (Option 6)
          </li>
          <li>Patient Results banner (Option 7) + Therapist banner (Option 8)</li>
        </ol>
      </div>
      <Mock1 />
    </div>
  );
}

// ─── INTAKE FORM MOCKUPS ────────────────────────────────────────────────

function MockIntakeShell({ children, title = "Step 1 of 8: Who is this for?" }) {
  return (
    <MockFrame label="Landing — intake form section" url="theravoca.com/#start">
      <MockHeader />
      <div className="px-6 py-8 bg-[#FDFBF7]">
        <div className="text-center mb-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#C87965] mb-2">
            ✦ Get started
          </p>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
            Get your personalized list of <em>pre-qualified</em> therapists
          </h2>
          <p className="mt-2 text-xs text-[#6D6A65]">
            Free during pilot · Under 2 minutes
          </p>
        </div>
        {children}
        <div className="mt-5 bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="flex items-center justify-between text-[10px] text-[#6D6A65]">
            <span>{title}</span>
            <span>13%</span>
          </div>
          <div className="mt-2 h-1 bg-[#E8E5DF] rounded-full overflow-hidden">
            <div className="h-full w-[13%] bg-[#C87965]" />
          </div>
          <div className="mt-5">
            <p className="text-xs font-semibold text-[#2B2A29] mb-2">
              What type of therapy is needed?
            </p>
            <div className="flex flex-wrap gap-2">
              {["Individual", "Couples", "Family", "Group"].map((c) => (
                <span
                  key={c}
                  className="text-xs px-3 py-1.5 rounded-full border border-[#E8E5DF] bg-[#FDFBF7]"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 inline-flex items-center gap-1">
              Continue <ArrowRight size={11} />
            </span>
          </div>
        </div>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function MockStartA() {
  return (
    <MockIntakeShell>
      <div className="bg-gradient-to-br from-[#FBE9E5] to-[#FDFBF7] border border-[#F4C7BE] rounded-2xl p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#C8412B] font-semibold mb-2">
          ✦ Optional · ~90 seconds extra
        </p>
        <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-1">
          Want a deeper match?
        </h3>
        <p className="text-xs text-[#2B2A29]/85 leading-relaxed">
          Answer 3 extra questions and we'll match you with a therapist
          who really understands how you think — not just one who treats
          your diagnosis.
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 font-medium">
            Yes — go deeper
          </span>
          <span className="text-xs text-[#6D6A65] underline self-center">
            Skip — standard match is fine
          </span>
        </div>
      </div>
    </MockIntakeShell>
  );
}

function MockStartB() {
  return (
    <MockIntakeShell>
      <div className="border border-dashed border-[#2D4A3E] rounded-2xl p-5 bg-white">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center flex-shrink-0">
            <Sparkles size={14} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-[#2D4A3E]">
              Standard match (8 questions, ~2 min) ↓
            </p>
            <p className="text-[11px] text-[#6D6A65] mt-0.5">
              Or unlock <strong>deep match</strong> — 3 nuanced questions
              about how you want a therapist to <em>be</em> with you.
            </p>
            <label className="flex items-center gap-2 mt-3">
              <span className="w-3 h-3 rounded-sm border border-[#2D4A3E] bg-[#2D4A3E] flex items-center justify-center">
                <Check size={9} strokeWidth={3} className="text-white" />
              </span>
              <span className="text-xs text-[#2B2A29]">
                Use the deep match (recommended)
              </span>
            </label>
          </div>
        </div>
      </div>
    </MockIntakeShell>
  );
}

function MockStartC() {
  return (
    <MockIntakeShell>
      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-2">
          <div className="p-5 border-r border-[#E8E5DF]">
            <p className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
              Standard match
            </p>
            <p className="font-serif-display text-xl text-[#2D4A3E]">~2 min</p>
            <ul className="text-[10px] text-[#2B2A29]/80 space-y-0.5 mt-2">
              <li>✓ 8 short questions</li>
              <li>✓ Hard filters</li>
              <li>✓ Soft preferences</li>
            </ul>
            <span className="mt-4 block text-xs border border-[#2D4A3E] text-[#2D4A3E] rounded-full py-1 text-center">
              Standard
            </span>
          </div>
          <div className="p-5 bg-[#FBE9E5]">
            <p className="text-[10px] uppercase tracking-wider text-[#C8412B] font-semibold mb-1">
              ✦ Deep match
            </p>
            <p className="font-serif-display text-xl text-[#2D4A3E]">
              ~3.5 min
            </p>
            <ul className="text-[10px] text-[#2B2A29]/85 space-y-0.5 mt-2">
              <li>✓ Everything in standard</li>
              <li>✓ + style fit</li>
              <li>✓ + lived-experience match</li>
            </ul>
            <span className="mt-4 block text-xs bg-[#2D4A3E] text-white rounded-full py-1 text-center">
              Go deep →
            </span>
          </div>
        </div>
      </div>
    </MockIntakeShell>
  );
}

function MockStartD() {
  return (
    <MockIntakeShell>
      <div className="inline-flex items-center gap-2 bg-[#FBF2E8] border border-[#F0DEC8] rounded-full px-3 py-1.5 text-xs">
        <Sparkles size={11} className="text-[#B8742A]" />
        <span className="text-[#8B5A1F]">
          Add 3 nuance questions for a deeper match?
        </span>
        <span className="text-[10px] font-semibold bg-[#2D4A3E] text-white rounded-full px-2 py-0.5">
          Yes
        </span>
        <span className="text-[10px] text-[#6D6A65] underline">Maybe later</span>
      </div>
    </MockIntakeShell>
  );
}

function MockEndA() {
  return (
    <MockFrame label="Intake — final step (Option End-A)" url="theravoca.com/#start">
      <MockHeader />
      <div className="px-6 py-8 bg-[#FDFBF7]">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="flex items-center justify-between text-[10px] text-[#6D6A65]">
            <span>Step 8 of 8: Where to reach you</span>
            <span>100%</span>
          </div>
          <div className="mt-2 h-1 bg-[#E8E5DF] rounded-full overflow-hidden">
            <div className="h-full w-full bg-[#C87965]" />
          </div>
          <div className="mt-5 space-y-3">
            <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-md p-2.5 text-xs text-[#6D6A65]">
              you@example.com
            </div>
            <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-md p-2.5 text-xs text-[#6D6A65]">
              208-555-0123
            </div>
            <div className="text-[10px] text-[#2B2A29]/70 flex gap-2">
              ✓ I agree to terms · ✓ 18+ · ✓ not an emergency
            </div>
          </div>
          <div className="mt-5 bg-gradient-to-br from-[#FBE9E5] to-white border border-[#F4C7BE] rounded-xl p-4">
            <div className="flex items-start gap-2.5">
              <Sparkles
                size={16}
                className="text-[#C8412B] mt-0.5 flex-shrink-0"
              />
              <div>
                <p className="text-xs font-semibold text-[#2D4A3E]">
                  One more thing — want a deeper match?
                </p>
                <p className="text-[11px] text-[#6D6A65] mt-1 leading-relaxed">
                  You're 90 seconds away from a much better match. 3 extra
                  questions and we tune the engine to your style.
                </p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="bg-[#2D4A3E] text-white text-[10px] rounded-full px-3 py-1 font-medium">
                    Add the 3 questions
                  </span>
                  <span className="text-[10px] text-[#6D6A65] underline self-center">
                    No thanks
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-between items-center">
            <span className="text-xs text-[#6D6A65]">← Back</span>
            <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5 inline-flex items-center gap-1">
              Review & submit <ArrowRight size={11} />
            </span>
          </div>
        </div>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function MockEndB() {
  return (
    <MockFrame label="Intake — Review modal (Option End-B)" url="theravoca.com/#start">
      <MockHeader />
      <div className="px-6 py-8 bg-[#FDFBF7] relative">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 opacity-50">
          <p className="text-xs text-[#6D6A65]">… intake form behind modal …</p>
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-6 py-8">
          <div className="bg-white border border-[#E8E5DF] rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-[#2D4A3E]">
                Review your referral
              </p>
              <span className="text-[10px] text-[#6D6A65]">
                8 questions answered
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {[
                ["Concerns", "Anxiety, Trauma"],
                ["Format", "Telehealth"],
                ["Insurance", "Aetna"],
                ["Urgency", "Within 2 weeks"],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[#6D6A65] uppercase tracking-wider">
                    {k}
                  </p>
                  <p className="text-[#2B2A29] font-medium">{v}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-[#E8E5DF] pt-3 -mx-5 -mb-5 px-5 pb-5 mt-4 bg-[#FBE9E5]/60 rounded-b-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#2D4A3E] flex items-center gap-1.5">
                    <Sparkles size={11} className="text-[#C8412B]" />
                    Want a deeper match?
                  </p>
                  <p className="text-[10px] text-[#6D6A65] mt-0.5">
                    +3 nuance questions · ~90 sec
                  </p>
                </div>
                <div className="relative w-9 h-5 bg-[#2D4A3E] rounded-full">
                  <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
                </div>
              </div>
            </div>
            <div className="flex justify-between mt-3 pt-3">
              <span className="text-xs text-[#6D6A65]">← Edit</span>
              <span className="bg-[#2D4A3E] text-white text-xs rounded-full px-3 py-1.5">
                Confirm & find my matches
              </span>
            </div>
          </div>
        </div>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

function MockEndC() {
  return (
    <MockFrame
      label="Post-submit interstitial (Option End-C)"
      url="theravoca.com/results/abc123"
    >
      <MockHeader />
      <div className="px-6 py-12 bg-[#FDFBF7]">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-7 text-center max-w-md mx-auto">
          <Heart size={24} className="text-[#C87965] mx-auto" />
          <h3 className="font-serif-display text-xl text-[#2D4A3E] mt-2">
            Got it — matching now.
          </h3>
          <p className="text-xs text-[#6D6A65] mt-1">
            You'll get 3+ matches in 24 hours.
          </p>
          <div className="mt-5 bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl p-4 text-left">
            <p className="text-xs font-semibold text-[#2D4A3E]">
              While we're matching — want to go deeper?
            </p>
            <p className="text-[11px] text-[#6D6A65] mt-1 leading-relaxed">
              3 more questions about <em>how</em> a therapist should be
              with you can move you up in our ranking. ~90 sec.
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="bg-[#2D4A3E] text-white text-[10px] rounded-full px-3 py-1 font-medium">
                Yes — go deeper
              </span>
              <span className="text-[10px] text-[#6D6A65] underline self-center">
                I'll wait
              </span>
            </div>
          </div>
        </div>
      </div>
      <MockFooter />
    </MockFrame>
  );
}

// ─── PAGE ───────────────────────────────────────────────────────────────

function Section({ tag, where, children }) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="bg-[#2D4A3E] text-white font-mono text-xs rounded-md px-2.5 py-1">
          {tag}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-[#6D6A65]">
          Lives on: <span className="text-[#2B2A29]">{where}</span>
        </span>
      </div>
      {children}
    </section>
  );
}

export default function PromisePreview() {
  return (
    <div className="min-h-screen bg-[#F4EFE7]">
      <header className="bg-white border-b border-[#E8E5DF] py-3 px-5 sm:px-8 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link
            to="/"
            className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
          >
            ← back home
          </Link>
          <p className="text-[10px] uppercase tracking-[0.25em] text-[#C87965]">
            internal mockups · pick & ship
          </p>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-10 pb-32">
        <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] leading-tight">
          Promise statement & deep-intake — full-page mockups
        </h1>
        <p className="text-sm text-[#2B2A29]/80 mt-3 leading-relaxed max-w-3xl">
          Each frame below is a static mockup of the actual production page
          with that variant baked in — header, footer, and surrounding
          content rendered for context. Reply with your picks
          (e.g. <em>"#4 + #6 + #7 + Start-C + End-A"</em>) and I'll wire
          them into production.
        </p>
        <p className="text-xs text-[#6D6A65] mt-4 italic">
          Promise text used: "{PROMISE_LONG}"
        </p>

        <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-12 border-t border-dashed border-[#E8E5DF] pt-12">
          Promise statement — 10 mockups
        </h2>

        <Section tag="Option 1" where="Landing hero (under headline)">
          <Mock1 />
        </Section>
        <Section tag="Option 2" where="Landing hero (typewriter under CTA)">
          <Mock2 />
        </Section>
        <Section tag="Option 3" where="Landing — replaces 'How we're different' block">
          <Mock3 />
        </Section>
        <Section tag="Option 4" where="Landing — manifesto card directly above FAQs">
          <Mock4 />
        </Section>
        <Section tag="Option 5" where="Every page — sticky pill ribbon (dismissible)">
          <Mock5 />
        </Section>
        <Section tag="Option 6" where="New page at /our-promise (live now)">
          <Mock6 />
        </Section>
        <Section tag="Option 7" where="Patient Results — banner above match cards">
          <Mock7 />
        </Section>
        <Section tag="Option 8" where="Therapist Signup — top banner">
          <Mock8 />
        </Section>
        <Section tag="Option 9" where="Footer of every page (italic watermark)">
          <Mock9 />
        </Section>
        <Section tag="Option 10" where="Multi-touch (1 + 4 + 6 + 7 + 8) — recommended">
          <Mock10 />
        </Section>

        <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-16 border-t border-dashed border-[#E8E5DF] pt-12">
          Deep intake prompt — at the START
        </h2>
        <p className="text-sm text-[#6D6A65] mt-2">
          Shown on the Landing page above the existing 8-step intake form.
        </p>
        <Section
          tag="Start-A"
          where="Soft coral card — emphasises 'optional'"
        >
          <MockStartA />
        </Section>
        <Section
          tag="Start-B"
          where="Two-line callout with checkbox (default ON)"
        >
          <MockStartB />
        </Section>
        <Section
          tag="Start-C"
          where="Side-by-side picker — clearest framing, hardest commitment"
        >
          <MockStartC />
        </Section>
        <Section
          tag="Start-D"
          where="Tiny pill chip — minimal weight, easy to ignore"
        >
          <MockStartD />
        </Section>

        <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-16 border-t border-dashed border-[#E8E5DF] pt-12">
          Deep intake prompt — at the END
        </h2>
        <p className="text-sm text-[#6D6A65] mt-2">
          After the 8 standard steps. Less efficient (already invested) but
          lower-friction for the user.
        </p>
        <Section
          tag="End-A"
          where="Coral card on the final step, above 'Review & submit'"
        >
          <MockEndA />
        </Section>
        <Section
          tag="End-B"
          where="Toggle inside the existing Review preview modal"
        >
          <MockEndB />
        </Section>
        <Section
          tag="End-C"
          where="Post-submit interstitial — 'while we're matching you...'"
        >
          <MockEndC />
        </Section>

        <p className="text-sm text-[#6D6A65] text-center mt-16">
          Reply with your picks and I'll wire them into production.
        </p>
      </main>
    </div>
  );
}
