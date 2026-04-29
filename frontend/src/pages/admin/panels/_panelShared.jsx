// Tiny presentational primitives shared across multiple admin panels.
// Exported individually so consumer panels can tree-shake.
export function FactStat({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-serif-display text-2xl text-[#2D4A3E] mt-1">{value}</div>
    </div>
  );
}

export function StatBox({ label, value, highlight }) {
  return (
    <div
      className={`bg-white border rounded-2xl p-4 ${
        highlight ? "border-[#C87965] shadow-sm" : "border-[#E8E5DF]"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div
        className={`font-serif-display text-3xl mt-1 ${
          highlight ? "text-[#C87965]" : "text-[#2D4A3E]"
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
