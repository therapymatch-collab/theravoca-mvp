import { AlertTriangle, MailQuestion } from "lucide-react";

export default function MatchGapPanel({ gap }) {
  if (!gap) return null;
  const sevColor = (s) =>
    s === "critical"
      ? "bg-[#FDF1EF] border-[#F2C9C0] text-[#D45D5D]"
      : s === "warning"
      ? "bg-[#FBF3E8] border-[#EAD9B6] text-[#9A6E1A]"
      : "bg-[#F2F7F1] border-[#D2E2D0] text-[#3F6F4A]";
  // If the patient never verified their email, matching never ran — so
  // any low notify count is misleading. We swap the headline + icon to
  // make that obvious BEFORE the admin draws conclusions about coverage.
  const unverified = gap.patient_verified === false;
  const headline = unverified
    ? "Patient hasn't verified their email yet"
    : "Why we couldn't fill 30 matches";
  return (
    <div
      className={`border rounded-2xl p-5 ${
        unverified
          ? "bg-[#FBF3E8] border-[#EAD9B6]"
          : "bg-white border-[#E8E5DF]"
      }`}
      data-testid="match-gap-panel"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            unverified
              ? "bg-[#FBE9C7] text-[#9A6E1A]"
              : "bg-[#FBF3E8] text-[#C87965]"
          }`}
        >
          {unverified ? <MailQuestion size={16} /> : <AlertTriangle size={16} />}
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-[#2B2A29]" data-testid="match-gap-headline">
            {headline}
          </h4>
          <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
            {gap.summary}
          </p>
          {unverified && (
            <p className="text-xs text-[#9A6E1A] mt-2 leading-relaxed font-medium">
              Tip: this isn't a directory problem. Matching runs as soon as
              the patient clicks the verification link in their inbox.
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(gap.axes || []).map((a, i) => (
          <div
            key={`${a.label}-${i}`}
            className={`border rounded-xl px-3 py-2 ${sevColor(a.severity)}`}
            data-testid={`match-gap-axis-${i}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{a.label}</span>
              <span className="text-xs font-mono">
                {a.count} <span className="opacity-60">/ {a.target}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
