import { X } from "lucide-react";

/**
 * Shared UI primitives for the therapist signup wizard.
 *
 * Previously lived at the bottom of TherapistSignup.jsx (~140 lines).
 * Extracting them here lets the per-step renderers split cleanly into
 * their own files (planned: pages/therapist/steps/Step{1..7}.jsx).
 *
 * `Group` here is *different* from `components/intake/IntakeUI.Group`
 * — it picks a stable accent color from a palette based on the title
 * hash so each section is visually distinct. Used only on the signup
 * wizard; the in-portal edit page uses a flat white card instead.
 */

// Colored card per section — pick a stable accent color based on the
// title hash so each Group is visually distinct without depending on
// render order.
const GROUP_PALETTE = [
  { bg: "#FDF7EC", border: "#E8DCC1", accent: "#C87965" }, // warm cream
  { bg: "#F2F4F0", border: "#D9DDD2", accent: "#2D4A3E" }, // sage
  { bg: "#FBF5F2", border: "#EBD5CB", accent: "#A8553F" }, // dusty rose
  { bg: "#F4F1EC", border: "#E0D9CC", accent: "#6E5530" }, // taupe
  { bg: "#EFF2F6", border: "#D5DCE4", accent: "#3F5775" }, // muted blue
];

function _hash(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Group({ title, hint, children }) {
  const c = GROUP_PALETTE[_hash(title || "x") % GROUP_PALETTE.length];
  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border-l-4"
      style={{ background: c.bg, borderColor: c.accent, borderLeftColor: c.accent }}
    >
      <div
        className="font-semibold text-sm uppercase tracking-wider"
        style={{ color: c.accent }}
      >
        {title}
      </div>
      {hint && <div className="text-xs text-[#6D6A65] mt-1">{hint}</div>}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

// Field with optional hint. Hint renders BELOW the input so labels in
// a grid row stay vertically aligned (otherwise a hint inflates the
// label height and only that column's input drops down). Use `hint`
// for SMS / public-disclosure disclaimers and `topHint` only when
// explicit pre-input context is essential.
export function Field({ label, hint, topHint, children }) {
  return (
    <div className="flex flex-col">
      <label className="block text-xs font-semibold text-[#6D6A65] mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {topHint && (
        <div className="text-[11px] text-[#6D6A65] -mt-1 mb-1.5 normal-case tracking-normal">
          {topHint}
        </div>
      )}
      {children}
      {hint && (
        <p className="mt-1.5 text-[11px] text-[#6D6A65] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

// Red asterisk used inline next to required field labels.
export function Req() {
  return (
    <span className="text-[#D45D5D] ml-0.5" aria-label="required">
      *
    </span>
  );
}

export function PillRow({ items, selected, onSelect, testid }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            type="button"
            key={it.v}
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
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

export function Tags({ items, onRemove }) {
  if (!items || items.length === 0) return null;
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

export function SummaryRow({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? "sm:col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-medium text-[#2B2A29] break-words">{value || "—"}</div>
    </div>
  );
}
