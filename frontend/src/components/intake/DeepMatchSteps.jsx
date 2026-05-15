import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { P1_OPTIONS, P2_OPTIONS } from "@/components/intake/deepMatchOptions";
import { Group, Field, PillCol } from "@/components/intake/IntakeUI";

/**
 * Patient deep-match step renderers (P1/P2/P3 from the v2 scoring map).
 *
 * Extracted out of IntakeForm.jsx — they were ~120 lines of nearly
 * identical scaffolding (intro banner + Group/Field wrapper +
 * PillCol/Textarea). The Banner sub-component normalises the
 * "Deep match · N of 3" eyebrow.
 *
 * Each step takes:
 *   - data:       form state object (uses p1_communication / p2_change / p3_resonance)
 *   - set(k, v):  single-field setter
 *   - toggleArr(k, v, max): toggle slug in a multi-select array (P1, P2)
 *   - t(key, fallback): site-copy translator (admins can edit the copy live)
 */

function DeepMatchBanner({ stepIndex, t, body }) {
  return (
    <div className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-[#C8412B] font-semibold mb-1">
        ✦ Deep match · {stepIndex} of 3
      </p>
      {body && (
        <p className="text-sm text-[#2B2A29]/85 leading-relaxed">{body}</p>
      )}
    </div>
  );
}

export function P1Step({ data, set: _set, toggleArr, t }) {
  return (
    <div className="space-y-5">
      <DeepMatchBanner
        stepIndex={1}
        t={t}
        body={t(
          "intake.deep.p1.intro",
          "These 3 questions help us match you with a therapist whose style genuinely fits — not just one who treats your diagnosis.",
        )}
      />
      <Group
        label={t(
          "intake.deep.p1.label",
          "What kind of relationship do you want with your therapist?",
        )}
        hint={t("intake.deep.p1.hint", "Pick exactly 2.")}
      >
        <PillCol
          items={P1_OPTIONS}
          selected={data.p1_communication}
          onSelect={(v) => toggleArr("p1_communication", v, 2)}
          testid="p1"
        />
        <p className="text-[11px] text-[#6D6A65] mt-2">
          {data.p1_communication.length}/2 selected
        </p>
      </Group>
    </div>
  );
}

export function P2Step({ data, set: _set, toggleArr, t }) {
  return (
    <div className="space-y-5">
      <DeepMatchBanner stepIndex={2} t={t} />
      <Group
        label={t(
          "intake.deep.p2.label",
          "How do you want therapy to work?",
        )}
        hint={t("intake.deep.p2.hint", "Pick exactly 2.")}
      >
        <PillCol
          items={P2_OPTIONS}
          selected={data.p2_change}
          onSelect={(v) => toggleArr("p2_change", v, 2)}
          testid="p2"
        />
        <p className="text-[11px] text-[#6D6A65] mt-2">
          {data.p2_change.length}/2 selected
        </p>
      </Group>
    </div>
  );
}

export function P3Step({ data, set, t }) {
  return (
    <div className="space-y-5">
      <DeepMatchBanner stepIndex={3} t={t} />
      {/* Question FIRST, like the other deep-match steps (P1/P2).
          The consent toggle sits BELOW the question so the patient
          reads what would be asked before deciding to share. */}
      <Group
        label={t(
          "intake.deep.p3.label",
          "What should your therapist already get about you without you having to explain it?",
        )}
        hint={t(
          "intake.deep.p3.hint",
          "Optional. Sharing a short note (20-250 characters) helps the matching engine score for lived-experience fit. Please do not include names, addresses, phone numbers, or other identifying info.",
        )}
      >
        {/* Explicit consent gate (HIPAA scope-out, 2026-05-13). Even
            though the patient already opted into deep matching one step
            back, the free-text field gets its own affirmative toggle so
            consent is unambiguous and per-field. Unchecking wipes any
            draft text from form state. */}
        <label
          className="flex items-start gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 cursor-pointer hover:border-[#2D4A3E] transition"
          data-testid="p3-consent-row"
        >
          <Checkbox
            checked={data.share_resonance_context}
            onCheckedChange={(v) => {
              set("share_resonance_context", !!v);
              if (!v) set("p3_resonance", "");
            }}
            data-testid="p3-consent"
          />
          <span className="text-sm leading-snug text-[#2D4A3E]">
            {t(
              "intake.deep.p3.consent.label",
              "Yes, I'd like to share a short note",
            )}
            <span className="block text-[11px] text-[#6D6A65] mt-0.5 font-normal">
              {t(
                "intake.deep.p3.consent.helper_short",
                "Skip this if you'd rather not -- it's optional.",
              )}
            </span>
          </span>
        </label>
        {data.share_resonance_context && (
          <div className="mt-3">
            <Textarea
              rows={4}
              maxLength={250}
              minLength={20}
              value={data.p3_resonance}
              onChange={(e) => set("p3_resonance", e.target.value)}
              placeholder={t(
                "intake.deep.p3.placeholder",
                "Try one of these starters:\n• My background or culture…\n• My work or life situation…\n• What didn't work with a past therapist…",
              )}
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="p3-input"
            />
            <p className="text-[11px] text-[#6D6A65] mt-2 leading-snug">
              {(data.p3_resonance || "").length}/250 characters · 20+
              characters helps the matching engine score for
              lived-experience fit.
            </p>
          </div>
        )}
      </Group>
    </div>
  );
}
