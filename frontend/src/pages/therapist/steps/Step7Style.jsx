import { Textarea } from "@/components/ui/textarea";
import {
  Group,
  Req,
  PillRow,
} from "@/pages/therapist/TherapistSignupUI";
import { STYLE_TAGS } from "./signupOptions";

/**
 * Step 7 — "Style & bio"
 *
 * Style tags (multi-select) + an optional short bio. Bio is shown to
 * patients on the results page, so we encourage 2-3 sentences.
 */
export default function Step7Style({ data, set, toggleArr }) {
  return (
    <>
      <Group title={<>How would you describe your style? <Req /></>}>
        <PillRow
          items={STYLE_TAGS}
          selected={data.style_tags}
          onSelect={(v) => toggleArr("style_tags", v)}
          testid="signup-style"
        />
      </Group>

      <Group
        title="Short bio (optional)"
        hint="2–3 sentences. Patients see this on their results page."
      >
        <Textarea
          rows={4}
          value={data.bio}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="I'm a Boise-based LCSW with 10+ years..."
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid="signup-bio"
        />
      </Group>
    </>
  );
}
