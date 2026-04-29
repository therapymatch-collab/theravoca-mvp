/* eslint-disable react/no-unescaped-entities */
import { Header, Footer } from "@/components/SiteShell";
import { Link } from "react-router-dom";
import { Sparkles, Check, X, Heart, ArrowRight, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

// Public preview page for the founder to compare 10 promise-statement
// designs + 4 deep-intake banner designs (start) + 3 (end) before
// committing to which goes live in production.
//
// Lives at /preview/promise — no auth required, internal-only by
// virtue of the hidden URL.

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

const Spacer = ({ children }) => (
  <div className="max-w-5xl mx-auto px-5 sm:px-8 py-12 border-t border-dashed border-[#E8E5DF]">
    {children}
  </div>
);

const Tag = ({ n, where }) => (
  <div className="flex items-baseline gap-3 mb-4">
    <span className="inline-flex items-center justify-center bg-[#2D4A3E] text-white font-mono text-sm rounded-md px-2.5 py-1">
      Option {n}
    </span>
    <span className="text-xs uppercase tracking-wider text-[#6D6A65]">
      Lives on: <span className="text-[#2B2A29]">{where}</span>
    </span>
  </div>
);

// ── Trust / Promise design variants ──────────────────────────────────────

function Option1Hero() {
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-10">
      <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-5">
        <Sparkles size={14} className="inline mr-1.5 -mt-0.5" strokeWidth={1.8} />
        Pilot live in Idaho
      </p>
      <h1 className="font-serif-display text-5xl sm:text-6xl text-[#2D4A3E] leading-[1.05] tracking-tight">
        Let therapists <em className="not-italic text-[#C87965]">come to you</em>.
      </h1>
      <div className="mt-7 max-w-xl border-l-2 border-[#C87965] pl-5 py-1">
        <p className="font-serif-display italic text-xl text-[#2D4A3E] leading-relaxed">
          “{PROMISE_SHORT_PATIENT}”
        </p>
        <p className="text-[10px] uppercase tracking-wider text-[#C87965] mt-2 font-semibold">
          — our promise
        </p>
      </div>
    </div>
  );
}

function Option2Typewriter() {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(PROMISE_MEDIUM.slice(0, i));
      if (i >= PROMISE_MEDIUM.length) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-10 text-center">
      <a className="tv-btn-primary inline-block mb-8">Get matched — free</a>
      <p className="font-serif-display text-2xl text-[#2D4A3E] leading-relaxed min-h-[5rem] max-w-2xl mx-auto">
        {shown}
        <span className="inline-block w-[3px] h-7 bg-[#C87965] ml-1 align-middle animate-pulse" />
      </p>
    </div>
  );
}

function Option3PullQuote() {
  return (
    <div className="bg-[#2D4A3E] rounded-2xl p-12 text-white">
      <p className="text-xs uppercase tracking-[0.25em] text-[#FBE9E5] mb-6">
        Why TheraVoca
      </p>
      <h3 className="font-serif-display text-3xl leading-snug max-w-3xl">
        We don't sell referrals.
      </h3>
      <p className="font-serif-display italic text-2xl text-[#FBE9E5] leading-relaxed max-w-3xl mt-5">
        “{PROMISE_LONG}”
      </p>
      <p className="text-xs uppercase tracking-wider text-white/60 mt-5">
        — TheraVoca's definition of success
      </p>
    </div>
  );
}

function Option4Manifesto() {
  return (
    <div className="bg-[#FBE9E5] border-2 border-[#C87965] rounded-3xl p-10 relative overflow-hidden">
      {/* Two interlocking circles sketch — the "match organism" */}
      <svg
        viewBox="0 0 80 50"
        className="absolute right-6 top-6 w-24 h-16 text-[#C87965]/40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="28" cy="25" r="20" />
        <circle cx="52" cy="25" r="20" />
      </svg>
      <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] font-semibold mb-4">
        the match — our manifesto
      </p>
      <h3 className="font-serif-display text-3xl text-[#2D4A3E] leading-snug max-w-2xl">
        We exist for one outcome.
      </h3>
      <p className="text-lg text-[#2B2A29]/85 mt-4 max-w-2xl leading-relaxed">
        {PROMISE_LONG}
      </p>
      <p className="text-sm text-[#6D6A65] mt-6 max-w-2xl">
        Patient + therapist + time = a third thing — a relationship that
        helps. Everything we build serves that.
      </p>
    </div>
  );
}

function Option5StickyRibbon() {
  return (
    <div>
      <div className="bg-white border border-[#E8E5DF] rounded-xl p-6 text-[#6D6A65] text-sm">
        ↑ Imagine the rest of the page above. ↑
      </div>
      <div className="fixed-stub bg-[#2D4A3E] text-white text-sm py-2.5 px-5 rounded-full shadow-md flex items-center gap-3 mt-3 mx-auto w-fit">
        <Heart size={14} className="text-[#FBE9E5]" />
        <span>{PROMISE_NORTHSTAR}</span>
        <button className="text-white/60 hover:text-white text-xs">
          ✕ dismiss
        </button>
      </div>
      <p className="text-[11px] text-[#6D6A65] text-center mt-2 italic">
        (in production: pinned to bottom of viewport on every page,
        dismissible per-session)
      </p>
    </div>
  );
}

function Option6DedicatedPage() {
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-10">
      <div className="text-xs text-[#6D6A65] mb-4">
        URL: <code className="bg-[#FBE9E5] px-2 py-0.5 rounded">/our-promise</code>
      </div>
      <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-5">
        our promise
      </p>
      <h1 className="font-serif-display text-5xl text-[#2D4A3E] leading-[1.1] mb-8">
        We work for one outcome.
      </h1>
      <p className="text-2xl text-[#2D4A3E] font-serif-display italic leading-relaxed border-l-4 border-[#C87965] pl-6 mb-8">
        {PROMISE_LONG}
      </p>
      <div className="grid sm:grid-cols-3 gap-6 mt-10">
        {[
          ["The patient", "explicit needs + open-text + lived experience"],
          ["The therapist", "training + style + lived experience"],
          ["The match", "a living relationship — measured at 90 days"],
        ].map(([h, b]) => (
          <div
            key={h}
            className="border border-[#E8E5DF] rounded-xl p-5 bg-white"
          >
            <p className="text-xs uppercase tracking-wider text-[#C87965] font-semibold">
              {h}
            </p>
            <p className="text-sm text-[#2B2A29]/85 mt-2 leading-relaxed">
              {b}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Option7ResultsBanner() {
  return (
    <div>
      <div className="bg-[#2D4A3E]/5 border-l-4 border-[#C87965] rounded-r-xl px-5 py-4 flex items-start gap-3 mb-5">
        <Heart size={18} className="text-[#C87965] mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-[#2D4A3E]">
            How TheraVoca measures success
          </p>
          <p className="text-sm text-[#2B2A29]/80 mt-1 leading-relaxed">
            {PROMISE_RESULTS_BANNER} If any of these therapists isn't a fit
            after 2 sessions, just tell us — we'll re-match for free.
          </p>
        </div>
      </div>
      {/* Mock results card */}
      <div className="space-y-3">
        {["Dr. Ana M., LCSW", "James K., LMFT", "Priya S., PsyD"].map((n) => (
          <div
            key={n}
            className="border border-[#E8E5DF] rounded-xl p-4 bg-white flex items-center gap-3"
          >
            <div className="w-12 h-12 rounded-full bg-[#FBE9E5]" />
            <div>
              <p className="font-semibold text-[#2D4A3E]">{n}</p>
              <p className="text-xs text-[#6D6A65]">
                Anxiety · Trauma · 8 yrs · Boise
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Option8TherapistTrust() {
  return (
    <div>
      <div className="bg-[#FBF2E8] border border-[#F0DEC8] rounded-xl px-6 py-5 flex items-start gap-4 mb-5">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#B8742A] text-white flex items-center justify-center">
          ✱
        </div>
        <div>
          <p className="text-sm font-semibold text-[#8B5A1F]">
            Why we don't pay for clicks
          </p>
          <p className="text-sm text-[#2B2A29]/85 mt-1 leading-relaxed">
            {PROMISE_SHORT_THERAPIST} If your patients aren't reporting they
            feel better at 90 days, we tune the matching engine — not your
            ad spend.
          </p>
        </div>
      </div>
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-8">
        <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-4">
          For therapists
        </p>
        <h2 className="font-serif-display text-4xl text-[#2D4A3E]">
          Get matched with patients who actually want to work with you.
        </h2>
      </div>
    </div>
  );
}

function Option9FooterWatermark() {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-xl p-6 text-[#6D6A65] text-sm">
      <p className="mb-4">↑ The rest of every page above. ↑</p>
      <div className="border-t border-[#E8E5DF] pt-5 grid sm:grid-cols-3 gap-6 text-xs text-[#6D6A65]">
        <div>
          <p className="font-serif-display text-[#2D4A3E] text-lg mb-1.5">
            TheraVoca
          </p>
          <p>Let therapists come to you.</p>
        </div>
        <div>
          <p className="font-semibold text-[#2D4A3E] mb-1.5">Crisis support</p>
          <p>If in crisis, call 911 or 988.</p>
        </div>
        <div>
          <p className="font-semibold text-[#2D4A3E] mb-1.5">Privacy</p>
          <p>We never share your info without consent.</p>
        </div>
      </div>
      <p className="mt-6 italic font-serif-display text-[#2D4A3E]/70 text-sm border-t border-[#E8E5DF] pt-4">
        “{PROMISE_MEDIUM}” — our promise
      </p>
      <p className="text-[10px] text-[#6D6A65]/70 mt-2">
        © 2026 TheraVoca · Terms · Privacy
      </p>
    </div>
  );
}

function Option10MultiTouch() {
  return (
    <div className="space-y-6">
      <div className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl p-5">
        <p className="text-sm font-semibold text-[#C8412B] mb-2">
          ✦ Recommended — combines 4 touch-points
        </p>
        <ol className="text-sm text-[#2B2A29]/85 space-y-1.5 list-decimal pl-5">
          <li>Italic serif quote under the Landing hero (Option 1)</li>
          <li>Manifesto card above Landing FAQs (Option 4)</li>
          <li>
            Dedicated <code className="bg-white px-1.5 rounded text-xs">/our-promise</code> page (Option 6)
          </li>
          <li>Patient Results banner (Option 7) + Therapist trust banner (Option 8)</li>
        </ol>
      </div>
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-6">
        <p className="text-xs text-[#6D6A65] mb-3">Preview, hero only:</p>
        <Option1Hero />
      </div>
    </div>
  );
}

// ── Deep-intake design variants ──────────────────────────────────────────

function StartA() {
  return (
    <div className="bg-gradient-to-br from-[#FBE9E5] to-[#FDFBF7] border border-[#F4C7BE] rounded-2xl p-6 max-w-2xl mx-auto">
      <p className="text-xs uppercase tracking-[0.2em] text-[#C8412B] font-semibold mb-3">
        ✦ Optional · ~90 seconds extra
      </p>
      <h3 className="font-serif-display text-2xl text-[#2D4A3E] mb-2 leading-snug">
        Want a deeper match?
      </h3>
      <p className="text-sm text-[#2B2A29]/85 leading-relaxed">
        Answer 3 extra questions and we'll match you with a therapist who
        really understands how you think — not just one who treats your
        diagnosis.
      </p>
      <div className="flex flex-wrap gap-3 mt-5">
        <button className="tv-btn-primary text-sm" type="button">
          Yes — go deeper
        </button>
        <button className="text-sm text-[#6D6A65] underline" type="button">
          Skip — standard match is fine
        </button>
      </div>
    </div>
  );
}

function StartB() {
  return (
    <div className="border border-dashed border-[#2D4A3E] rounded-2xl p-6 bg-white max-w-2xl mx-auto">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#2D4A3E]">
            Standard match (8 questions, ~2 min) ↓
          </p>
          <p className="text-xs text-[#6D6A65] mt-0.5">
            Or unlock <strong>deep match</strong> — 3 nuanced questions about
            how you want a therapist to <em>be</em> with you.
          </p>
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#2D4A3E]"
              defaultChecked
            />
            <span className="text-sm text-[#2B2A29]">
              Use the deep match (recommended)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function StartC() {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden max-w-2xl mx-auto">
      <div className="grid sm:grid-cols-2">
        <div className="p-6 border-r border-[#E8E5DF]">
          <p className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
            Standard match
          </p>
          <p className="font-serif-display text-2xl text-[#2D4A3E] mb-2">
            ~2 min
          </p>
          <ul className="text-xs text-[#2B2A29]/80 space-y-1 mt-3">
            <li>✓ 8 short questions</li>
            <li>✓ Hard filters (insurance, format)</li>
            <li>✓ Soft preferences</li>
          </ul>
          <button
            className="mt-5 w-full text-sm border border-[#2D4A3E] text-[#2D4A3E] rounded-full py-2 hover:bg-[#2D4A3E]/5"
            type="button"
          >
            Standard
          </button>
        </div>
        <div className="p-6 bg-[#FBE9E5]">
          <p className="text-xs uppercase tracking-wider text-[#C8412B] font-semibold mb-2">
            ✦ Deep match
          </p>
          <p className="font-serif-display text-2xl text-[#2D4A3E] mb-2">
            ~3.5 min
          </p>
          <ul className="text-xs text-[#2B2A29]/85 space-y-1 mt-3">
            <li>✓ Everything in standard</li>
            <li>✓ + 3 questions on style fit</li>
            <li>✓ + therapist lived-experience match</li>
          </ul>
          <button className="mt-5 w-full tv-btn-primary text-sm" type="button">
            Go deep →
          </button>
        </div>
      </div>
    </div>
  );
}

function StartD() {
  return (
    <div className="max-w-2xl mx-auto">
      <p className="text-sm text-[#6D6A65] mb-2 italic">
        (after the user picks "Adult" + their state — appears as a single
        toggle pill above step 1)
      </p>
      <div className="inline-flex items-center gap-3 bg-[#FBF2E8] border border-[#F0DEC8] rounded-full px-4 py-2 text-sm">
        <Sparkles size={14} className="text-[#B8742A]" />
        <span className="text-[#8B5A1F]">
          Add 3 nuance questions for a deeper match?
        </span>
        <button
          type="button"
          className="text-xs font-semibold bg-[#2D4A3E] text-white rounded-full px-3 py-0.5 hover:bg-[#1F362C]"
        >
          Yes
        </button>
        <button type="button" className="text-xs text-[#6D6A65] underline">
          Maybe later
        </button>
      </div>
    </div>
  );
}

function EndA() {
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-6 max-w-2xl mx-auto">
      <p className="text-sm text-[#6D6A65] mb-4">
        ↓ End of the existing 8-step intake; right above Review &amp; submit ↓
      </p>
      <div className="bg-gradient-to-br from-[#FBE9E5] to-white border border-[#F4C7BE] rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-[#C8412B] mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-[#2D4A3E]">
              One more thing — want a deeper match?
            </p>
            <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
              You're 90 seconds away from a much better match. 3 extra
              questions and we tune the engine to your style.
            </p>
            <div className="flex gap-3 mt-4 flex-wrap">
              <button className="tv-btn-primary text-sm" type="button">
                Add the 3 questions
              </button>
              <button
                className="text-sm text-[#6D6A65] underline self-center"
                type="button"
              >
                No thanks, just submit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EndB() {
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-6 max-w-2xl mx-auto">
      <p className="text-sm text-[#6D6A65] mb-4">
        ↓ Inside the Review &amp; Submit modal ↓
      </p>
      <div className="bg-white border border-[#E8E5DF] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-[#2D4A3E]">Review your referral</p>
          <span className="text-xs text-[#6D6A65]">8 questions answered</span>
        </div>
        <div className="border-t border-[#E8E5DF] pt-4 bg-[#FBE9E5]/40 -mx-5 -mb-5 px-5 pb-5 rounded-b-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#2D4A3E] flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#C8412B]" />
                Want a deeper match?
              </p>
              <p className="text-xs text-[#6D6A65] mt-0.5">
                Adds 3 nuance questions · ~90 sec
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer">
              <input type="checkbox" className="sr-only peer" />
              <div className="w-11 h-6 bg-[#E8E5DF] rounded-full peer-checked:bg-[#2D4A3E] transition" />
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function EndC() {
  return (
    <div className="max-w-2xl mx-auto">
      <p className="text-sm text-[#6D6A65] mb-3">
        ↓ Right after submit, before "we're matching you" page ↓
      </p>
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-7 text-center">
        <Heart size={28} className="text-[#C87965] mx-auto" />
        <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-3">
          Got it — matching now.
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-md mx-auto">
          You'll get 3+ matches in 24 hours.
        </p>
        <div className="mt-6 bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl p-5 text-left">
          <p className="text-sm font-semibold text-[#2D4A3E]">
            While we're matching — want to go deeper?
          </p>
          <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
            3 more questions about <em>how</em> a therapist should be with
            you can move you up in our ranking. Takes ~90 sec.
          </p>
          <div className="flex gap-3 mt-4 flex-wrap">
            <button className="tv-btn-primary text-sm" type="button">
              Yes — go deeper
            </button>
            <button
              className="text-sm text-[#6D6A65] underline self-center"
              type="button"
            >
              I'll wait for matches
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PromisePreview() {
  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <Header />
      <section className="max-w-5xl mx-auto px-5 sm:px-8 pt-12 pb-6">
        <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] mb-4">
          internal preview · pick & ship
        </p>
        <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight">
          Promise statement & deep-intake — design comparison
        </h1>
        <p className="text-base text-[#2B2A29]/80 mt-4 leading-relaxed max-w-3xl">
          10 promise-statement designs (#1–10) plus 4 "at start" + 3 "at end"
          deep-intake banner designs. Reply with the option numbers you like
          (e.g. <em>"#4 + #7 + Start-C + End-A"</em>) and I'll wire them
          into production. Stand-ins for components like <code className="bg-[#FBE9E5] px-1.5 rounded text-xs">tv-btn-primary</code>{" "}
          are real button styles — what you see is what ships.
        </p>
        <p className="text-sm text-[#6D6A65] mt-3">
          Promise text used:{" "}
          <em>"{PROMISE_LONG}"</em>
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="text-sm text-[#2D4A3E] underline hover:text-[#3A5E50]"
          >
            ← back home
          </Link>
        </div>
      </section>

      {/* Section: 10 promise-statement designs */}
      <Spacer>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] mb-2">
          Promise statement — 10 designs
        </h2>
        <p className="text-sm text-[#6D6A65]">
          Each option lives on a different page and uses a different visual
          treatment. Mix and match.
        </p>
      </Spacer>

      <Spacer>
        <Tag n={1} where="Landing hero (left column, under headline)" />
        <Option1Hero />
      </Spacer>
      <Spacer>
        <Tag n={2} where="Landing hero (centered, beneath the CTA)" />
        <Option2Typewriter />
      </Spacer>
      <Spacer>
        <Tag n={3} where="Landing — replaces the existing &quot;Why TheraVoca&quot; section" />
        <Option3PullQuote />
      </Spacer>
      <Spacer>
        <Tag n={4} where="Landing — full-width card directly above the FAQs" />
        <Option4Manifesto />
      </Spacer>
      <Spacer>
        <Tag n={5} where="Every page — sticky pill bar at the bottom of the viewport, dismissible" />
        <Option5StickyRibbon />
      </Spacer>
      <Spacer>
        <Tag n={6} where="Dedicated /our-promise page (linked from nav + footer + outreach emails)" />
        <Option6DedicatedPage />
      </Spacer>
      <Spacer>
        <Tag n={7} where="Patient Results page — directly above the matched therapist cards" />
        <Option7ResultsBanner />
      </Spacer>
      <Spacer>
        <Tag n={8} where="Therapist signup page + therapist portal dashboard top" />
        <Option8TherapistTrust />
      </Spacer>
      <Spacer>
        <Tag n={9} where="Footer of every page — quiet italic line above the copyright" />
        <Option9FooterWatermark />
      </Spacer>
      <Spacer>
        <Tag n={10} where="Multi-touch combination: 1 + 4 + 6 + 7 + 8" />
        <Option10MultiTouch />
      </Spacer>

      {/* Section: deep-intake — start */}
      <Spacer>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] mb-2">
          Deep intake prompt — at the START
        </h2>
        <p className="text-sm text-[#6D6A65]">
          Shown before the existing 8-step intake form, so the patient
          chooses standard vs. deep up front.
        </p>
      </Spacer>
      <Spacer>
        <Tag n="Start-A" where="Soft coral card — emphasizes &quot;optional&quot;" />
        <StartA />
      </Spacer>
      <Spacer>
        <Tag n="Start-B" where="Two-line callout with checkbox above the form (default ON)" />
        <StartB />
      </Spacer>
      <Spacer>
        <Tag n="Start-C" where="Side-by-side 'Standard vs Deep' picker — hardest commitment, clearest framing" />
        <StartC />
      </Spacer>
      <Spacer>
        <Tag n="Start-D" where="Tiny pill chip — minimal visual weight, easy to ignore" />
        <StartD />
      </Spacer>

      {/* Section: deep-intake — end */}
      <Spacer>
        <h2 className="font-serif-display text-3xl text-[#2D4A3E] mb-2">
          Deep intake prompt — at the END
        </h2>
        <p className="text-sm text-[#6D6A65]">
          Shown after the regular 8 steps as a last upsell. Less efficient
          (already invested time → resistant to "more questions") but lets
          you A/B test friction.
        </p>
      </Spacer>
      <Spacer>
        <Tag n="End-A" where="Coral card pinned above the &quot;Review &amp; submit&quot; button" />
        <EndA />
      </Spacer>
      <Spacer>
        <Tag n="End-B" where="Toggle inside the existing Review &amp; Submit preview modal" />
        <EndB />
      </Spacer>
      <Spacer>
        <Tag n="End-C" where="Post-submit interstitial — &quot;while we're matching you...&quot; upsell" />
        <EndC />
      </Spacer>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-16 text-center">
        <p className="text-sm text-[#6D6A65]">
          Reply with your picks (e.g. <em>"#1 + #4 + #6 + Start-C + End-A"</em>) and I'll wire them into production.
        </p>
      </div>
      <Footer />
    </div>
  );
}
