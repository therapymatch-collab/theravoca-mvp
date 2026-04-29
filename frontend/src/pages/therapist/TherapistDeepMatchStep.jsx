import { Textarea } from "@/components/ui/textarea";
import DraggableRankList from "@/components/intake/DraggableRankList";
import {
  T1_OPTIONS,
  T3_OPTIONS,
  T4_OPTIONS,
} from "@/pages/therapist/deepMatchOptions";

/**
 * TherapistDeepMatchStep
 *
 * Shared T1–T5 deep-match question block used by:
 *   - TherapistSignup.jsx step 8 ("Style fit")
 *   - TherapistEditProfile.jsx in-portal edit form
 *
 * Both surfaces previously inlined 100+ lines of nearly-identical JSX;
 * extracting it here removes the duplication and guarantees the two
 * forms stay 1:1 with the matching engine slugs (P1/P2 ↔ T1/T3).
 *
 * Props:
 *  - data:        { t1_stuck_ranked, t2_progress_story, t3_breakthrough,
 *                   t4_hard_truth, t5_lived_experience }
 *  - set(key, v): single-field setter
 *  - toggleArr(key, v, max): toggle slug in a multi-select array (used by T3)
 *  - testidPrefix: "signup" | "edit" — keeps existing test selectors stable
 *  - layout:      "card" (signup steps wrap each question in a Group card)
 *                 or "field" (edit profile uses inline Field labels)
 *  - GroupComponent / FieldComponent: caller passes the wrapper used in
 *    its own form so visuals stay consistent without prop-drilling
 *    styling.
 */
export default function TherapistDeepMatchStep({
  data,
  set,
  toggleArr,
  testidPrefix = "signup",
  GroupComponent,
  FieldComponent,
  showIntroBanner = true,
}) {
  const Wrap = GroupComponent || DefaultGroup;
  const Field = FieldComponent || DefaultField;

  return (
    <>
      {showIntroBanner && (
        <div
          className="bg-[#FBE9E5] border border-[#F4C7BE] rounded-xl px-4 py-3 mb-4"
          data-testid={`${testidPrefix}-deep-intro`}
        >
          <p className="text-xs uppercase tracking-[0.2em] text-[#C8412B] font-semibold mb-1">
            ✦ Style fit · how you actually work
          </p>
          <p className="text-sm text-[#2B2A29]/85 leading-relaxed">
            These five questions power our deep-match scoring. Patients
            who opt into the deeper intake get matched to therapists
            whose style genuinely fits theirs — not just whoever takes
            their insurance.
          </p>
          <p
            className="mt-2 text-xs text-[#2D4A3E] bg-white/70 border border-[#F4C7BE] rounded-md px-2.5 py-1.5 inline-block"
            data-testid={`${testidPrefix}-deep-privacy`}
          >
            <strong>Private to the matching engine.</strong> Patients
            never see your answers — they're only used to score fit.
          </p>
        </div>
      )}

      <Wrap
        title="T1 — How do you typically show up in session?"
        hint="Drag the handle to reorder. Most instinctive at the top."
      >
        <DraggableRankList
          items={T1_OPTIONS}
          order={data.t1_stuck_ranked}
          onChange={(o) => set("t1_stuck_ranked", o)}
          testid={`${testidPrefix}-t1`}
        />
      </Wrap>

      <Wrap
        title="T2 — Describe a client who made real progress with you"
        hint="What were they like when they walked in? Open text — at least 50 characters."
      >
        <Textarea
          rows={4}
          minLength={50}
          maxLength={2000}
          value={data.t2_progress_story}
          onChange={(e) => set("t2_progress_story", e.target.value)}
          placeholder="A 35-year-old new mom came in feeling like she'd lost herself. She was articulate but kept apologising for taking up space. Six months in, she'd named the pattern, set boundaries with her own mom, and was painting again."
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid={`${testidPrefix}-t2`}
        />
        <p className="text-[11px] text-[#6D6A65] mt-1">
          {(data.t2_progress_story || "").length}/2000 characters
        </p>
      </Wrap>

      <Wrap
        title="T3 — How does your best work typically unfold?"
        hint="Pick exactly 2."
      >
        <PillCol
          items={T3_OPTIONS}
          selected={data.t3_breakthrough}
          onSelect={(v) => toggleArr("t3_breakthrough", v, 2)}
          testid={`${testidPrefix}-t3`}
        />
        <p className="text-[11px] text-[#6D6A65] mt-2">
          {(data.t3_breakthrough || []).length}/2 selected
        </p>
      </Wrap>

      <Wrap
        title="T4 — When you need to push a client past their comfort zone, how do you do it?"
        hint="Pick 1."
      >
        <RadioCol
          items={T4_OPTIONS}
          value={data.t4_hard_truth}
          onChange={(v) => set("t4_hard_truth", v)}
          testid={`${testidPrefix}-t4`}
        />
      </Wrap>

      <Wrap
        title="T5 — What life experiences or communities do you understand from the inside — not from a textbook?"
        hint="Open text — at least 30 characters. This is the strongest signal for matching patients with similar lived experience."
      >
        <Textarea
          rows={4}
          minLength={30}
          maxLength={2000}
          value={data.t5_lived_experience}
          onChange={(e) => set("t5_lived_experience", e.target.value)}
          placeholder="e.g. first-gen college, immigrant family, queer + Christian, military spouse, navigating chronic illness, sober parent, eldest of 5, recovered from anorexia…"
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid={`${testidPrefix}-t5`}
        />
        <p className="text-[11px] text-[#6D6A65] mt-1">
          {(data.t5_lived_experience || "").length}/2000 characters
        </p>
      </Wrap>
    </>
  );
}

// ── Local layout helpers ─────────────────────────────────────────────
// Default Group/Field renderers if the caller doesn't supply its own.
// Edit-profile passes its own `Field`-style wrapper so the visuals
// match the rest of that form.

function DefaultGroup({ title, hint, children }) {
  return (
    <div className="rounded-2xl p-5 sm:p-6 border-l-4 bg-[#FBF5F2] border-[#EBD5CB] border-l-[#A8553F]">
      <div className="font-semibold text-sm uppercase tracking-wider text-[#A8553F]">
        {title}
      </div>
      {hint && <div className="text-xs text-[#6D6A65] mt-1">{hint}</div>}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function DefaultField({ title, hint, children }) {
  return (
    <div className="flex flex-col">
      <label className="block text-sm font-medium text-[#2B2A29] mb-1.5">
        {title}
      </label>
      {hint && <p className="text-xs text-[#6D6A65] mb-2">{hint}</p>}
      {children}
    </div>
  );
}

// Vertical pick-list used for T3 (pick 2 of 6) — full-width rows for
// readability of the long labels. Exported so the in-portal edit form
// can reuse it without re-implementing.
export function PillCol({ items, selected, onSelect, testid }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => {
        const active = selected.includes(it.v);
        return (
          <button
            type="button"
            key={it.v}
            onClick={() => onSelect(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-sm text-left px-4 py-2.5 rounded-xl border transition ${
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

// Vertical radio list used for T4 (pick 1 of 5).
export function RadioCol({ items, value, onChange, testid }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => {
        const active = value === it.v;
        return (
          <button
            type="button"
            key={it.v}
            onClick={() => onChange(it.v)}
            data-testid={`${testid}-${it.v}`}
            className={`text-sm text-left px-4 py-2.5 rounded-xl border transition ${
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
