/**
 * ProfileCompletionMeter — top-of-portal banner that shows the therapist
 * exactly where their profile stands and what's missing. Mirrors the
 * checklist from `/app/backend/profile_completeness.py` so the score and
 * label set stays consistent between the email blast and the in-app view.
 *
 * Hidden when `completeness` isn't on the therapist payload (older deploys)
 * and collapses itself once the profile is fully complete (publishable
 * AND no enhancing fields missing) to avoid nagging happy users.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Sparkles } from "lucide-react";

export default function ProfileCompletionMeter({ completeness }) {
  const [expanded, setExpanded] = useState(false);
  if (!completeness) return null;
  const {
    score,
    publishable,
    required_missing = [],
    enhancing_missing = [],
    required_done,
    required_total,
  } = completeness;
  const fullyDone = score >= 100 && publishable && enhancing_missing.length === 0;
  if (fullyDone) return null;

  const tone = publishable
    ? { bar: "bg-[#2D4A3E]", chip: "bg-[#2D4A3E]/10 text-[#2D4A3E]", label: "Publishable" }
    : { bar: "bg-[#C87965]", chip: "bg-[#C87965]/15 text-[#C87965]", label: "Action needed" };

  return (
    <section
      className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6"
      data-testid="profile-completion-meter"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tone.chip}`}>
              {tone.label}
            </span>
            <span className="text-xs text-[#6D6A65]">
              {required_done}/{required_total} required fields complete
            </span>
          </div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-2 leading-tight">
            Your profile is{" "}
            <span data-testid="completion-score">{score}%</span> complete
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed">
            {publishable
              ? "You're live — patients can match with you. Add the rest to stand out and lift your match rate."
              : "Patients won't be matched to your profile until the required fields below are complete."}
          </p>
          {/* Progress bar */}
          <div className="mt-4 h-2 rounded-full bg-[#E8E5DF] overflow-hidden">
            <div
              className={`h-full ${tone.bar} transition-all`}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
              data-testid="completion-bar"
            />
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2">
          <Link
            to="/portal/therapist/edit"
            className="tv-btn-primary !py-2 !px-4 text-sm whitespace-nowrap"
            data-testid="completion-edit-btn"
          >
            <Sparkles size={14} /> Complete profile
          </Link>
          <button
            type="button"
            onClick={() => setExpanded((s) => !s)}
            className="text-xs text-[#2D4A3E] hover:underline inline-flex items-center justify-center gap-1"
            data-testid="completion-toggle"
          >
            {expanded ? "Hide checklist" : "See what's missing"}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5" data-testid="completion-checklist">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold mb-2">
              Required ({required_total - required_missing.length}/{required_total})
            </div>
            <ul className="space-y-1.5">
              {[...required_missing].map((f) => (
                <li
                  key={f.key}
                  className="text-sm text-[#2B2A29] flex items-start gap-2"
                  data-testid={`required-missing-${f.key}`}
                >
                  <AlertCircle size={14} className="text-[#C87965] mt-0.5 shrink-0" />
                  <span>{f.label}</span>
                </li>
              ))}
              {required_missing.length === 0 && (
                <li className="text-sm text-[#6D6A65] flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[#2D4A3E]" />
                  All required fields complete
                </li>
              )}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#2D4A3E] font-semibold mb-2">
              Recommended ({completeness.enhancing_done}/{completeness.enhancing_total})
            </div>
            <ul className="space-y-1.5">
              {enhancing_missing.map((f) => (
                <li
                  key={f.key}
                  className="text-sm text-[#6D6A65] flex items-start gap-2"
                  data-testid={`enhancing-missing-${f.key}`}
                >
                  <span className="w-3.5 h-3.5 mt-1 shrink-0 rounded-full border border-[#C9C5BD]" />
                  <span>{f.label}</span>
                </li>
              ))}
              {enhancing_missing.length === 0 && (
                <li className="text-sm text-[#6D6A65] flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[#2D4A3E]" /> Polished
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
