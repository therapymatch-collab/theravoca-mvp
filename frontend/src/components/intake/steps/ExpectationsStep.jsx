import { Group, PillCol } from "@/components/intake/IntakeUI";
import { EXPECTATION_OPTIONS } from "./intakeOptions";

/**
 * Step "expectations" — Expectation alignment (THE primary matching signal).
 *
 * "What do you want the first few sessions to feel like?"
 * Patient picks up to 2 from EXPECTATION_OPTIONS. These are matched
 * against the therapist's T6 picks (same slugs, therapist-worded).
 *
 * This step appears early in the intake (step 3) because expectation
 * alignment is the #1 ranking factor — not a nice-to-have.
 */
export default function ExpectationsStep({ data, set, toggleArr, t }) {
  // "not_sure" is mutually exclusive with concrete picks
  const handleSelect = (v) => {
    if (v === "not_sure") {
      set("session_expectations", ["not_sure"]);
      return;
    }
    const cur = (data.session_expectations || []).filter((x) => x !== "not_sure");
    if (cur.includes(v)) {
      set("session_expectations", cur.filter((x) => x !== v));
    } else if (cur.length < 2) {
      set("session_expectations", [...cur, v]);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#E8F0EB] border border-[#9DBDA8] rounded-xl px-4 py-3">
        <p className="text-xs uppercase tracking-[0.2em] text-[#2D4A3E] font-semibold mb-1">
          {t("intake.expectations.eyebrow", "What matters most")}
        </p>
        <p className="text-sm text-[#2B2A29]/85 leading-relaxed">
          {t(
            "intake.expectations.intro",
            "This is the single biggest predictor of a good therapy experience. We'll match you with a therapist whose first sessions actually feel the way you want them to.",
          )}
        </p>
      </div>
      <Group
        label={t(
          "intake.expectations.label",
          "What do you want the first few sessions to feel like?",
        )}
        hint={t("intake.expectations.hint", "Choose up to 2.")}
      >
        <PillCol
          items={EXPECTATION_OPTIONS}
          selected={data.session_expectations || []}
          onSelect={handleSelect}
          testid="expectations"
        />
        <p className="text-[11px] text-[#6D6A65] mt-2">
          {(data.session_expectations || []).length}/2 selected
        </p>
      </Group>
    </div>
  );
}
