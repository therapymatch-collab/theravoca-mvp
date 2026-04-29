import { Switch } from "@/components/ui/switch";
import { Group } from "@/components/intake/IntakeUI";
import { PRIORITY_FACTORS } from "./intakeOptions";

/**
 * Step "priority" — soft-axis priority boosters. The patient picks
 * any of: Therapy approach, Therapist experience, Therapist style &
 * gender. If they pick at least one, a "strict mode" toggle appears
 * — strict means we only return therapists who match every priority.
 *
 * Copy is fully site-copy-driven via `t(...)` so admins can edit the
 * "How matching works" explainer without a code change.
 */
export default function PriorityStep({ data, set, toggleArr, t }) {
  return (
    <div className="space-y-5">
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4 text-sm text-[#2B2A29] leading-relaxed">
        <p className="font-semibold text-[#2D4A3E] mb-1.5">
          {t(
            "intake.priorities.howmatching_title",
            "How matching works",
          )}
        </p>
        <p className="text-[#2B2A29] mb-2">
          {t(
            "intake.priorities.howmatching_hard",
            "We always require: state license, the type of therapy you need, your main concern, and the right age group.",
          )}
        </p>
        <p className="text-[#6D6A65]">
          {t(
            "intake.priorities.howmatching_soft",
            "The rest — therapist experience, gender, style, modality — is soft by default. Pick any below to nudge ranking toward what matters most to you. (You've already had the option to mark insurance, schedule, urgency, and gender as hard requirements above.)",
          )}
        </p>
      </div>
      <Group
        label={t(
          "intake.priorities.label",
          "Boost ranking on these factors",
        )}
        hint={t(
          "intake.priorities.hint",
          "Pick the soft factors you'd like us to weigh more heavily. Skip if you'd rather we use our default ranking.",
        )}
      >
        <div className="space-y-2">
          {PRIORITY_FACTORS.map((p) => {
            const on = data.priority_factors.includes(p.v);
            return (
              <button
                key={p.v}
                type="button"
                onClick={() => toggleArr("priority_factors", p.v)}
                data-testid={`priority-${p.v}`}
                className={`w-full text-left rounded-xl border px-4 py-3 transition flex items-center gap-3 ${
                  on
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                    on ? "bg-white border-white" : "border-[#A4A29E]"
                  }`}
                >
                  {on && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#2D4A3E]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold break-words">
                    {p.l}
                  </div>
                  <div
                    className={`text-xs break-words ${
                      on ? "text-white/80" : "text-[#6D6A65]"
                    }`}
                  >
                    {p.d}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Group>
      {data.priority_factors.length > 0 && (
        <label className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition">
          <Switch
            checked={data.strict_priorities}
            onCheckedChange={(v) => set("strict_priorities", !!v)}
            data-testid="strict-priorities"
          />
          <span className="text-sm text-[#2B2A29] leading-relaxed break-words">
            <strong className="text-[#2D4A3E]">
              {t("intake.priorities.strict_label", "Strict mode")}
            </strong>{" "}
            —{" "}
            {t(
              "intake.priorities.strict_desc",
              "only show me therapists who are a real fit on every priority I picked. (Fewer matches, but tighter.)",
            )}
          </span>
        </label>
      )}
    </div>
  );
}
