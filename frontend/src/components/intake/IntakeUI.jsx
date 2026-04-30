import { Checkbox } from "@/components/ui/checkbox";

/**
 * Shared UI primitives for the patient intake form.
 *
 * `Group`/`Field` are layout wrappers used to build labelled input
 * blocks. `PillRow` (horizontal) and `PillCol` (vertical, full-width
 * rows) are the two pickable-tag variants used for single- and
 * multi-select questions throughout the intake. `CheckRow` is a
 * shadcn-Checkbox + label pair used in a few "I agree" / "strict
 * filter" rows.
 *
 * These were previously declared at the bottom of IntakeForm.jsx;
 * extracting them here lets us split the per-step renderers into
 * separate files (see ./DeepMatchSteps.jsx) without circular imports.
 */

export function Group({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#2B2A29] mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-[#6D6A65] mb-3">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

export function PillRow({ items, selected, onSelect, testid, disabledValues, disabledReasons }) {
  // `disabledValues` (Set<string> | string[]) marks options as
  // unavailable — used by hard-capacity to grey out child/teen age
  // groups, family/group client types, etc. when our active
  // therapist directory has < 30 providers in that bucket.
  const disabledSet = new Set(
    Array.isArray(disabledValues)
      ? disabledValues.map((s) => String(s).toLowerCase())
      : disabledValues
        ? Array.from(disabledValues).map((s) => String(s).toLowerCase())
        : [],
  );
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        const isDisabled =
          !active && disabledSet.has(String(it.v).toLowerCase());
        const reason =
          isDisabled && disabledReasons
            ? disabledReasons[String(it.v).toLowerCase()] || disabledReasons[it.v]
            : "";
        return (
          <button
            key={it.v}
            type="button"
            onClick={() => !isDisabled && onSelect(it.v)}
            disabled={isDisabled}
            title={reason || undefined}
            aria-disabled={isDisabled}
            data-testid={`${testid}-${it.v}${isDisabled ? "-disabled" : ""}`}
            className={`text-sm px-4 py-2 rounded-full border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-sm"
                : isDisabled
                  ? "bg-[#F2EFE9] text-[#9C9893] border-[#E8E5DF] cursor-not-allowed line-through opacity-70"
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

export function PillCol({ items, selected, onSelect, testid }) {
  return (
    <div className="grid gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            key={it.v}
            type="button"
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-left text-sm px-4 py-3 rounded-xl border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-sm"
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

export function CheckRow({ id, checked, onChange, label, testid }) {
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
