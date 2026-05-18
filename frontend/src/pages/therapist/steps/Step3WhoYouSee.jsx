import { Group, Field, Req, PillRow } from "@/pages/therapist/TherapistSignupUI";
import ResearchCallout from "@/pages/therapist/ResearchCallout";
import { CLIENT_TYPES, AGE_GROUPS } from "./signupOptions";

/**
 * Step 3 — "Who do you see?"
 *
 * Pre-filter signal: client types (individual/couples/family/group)
 * and age groups (max 3). Patients are routed only to therapists
 * whose `client_types` and `age_groups` overlap with theirs.
 */
export default function Step3WhoYouSee({ data, toggleArr }) {
  return (
    <>
      <ResearchCallout citation="Norcross & Lambert (2019), Psychotherapy Relationships That Work, 3rd ed. — meta-analytic review.">
        Patients who feel their therapist truly understands their life
        stage stay in therapy longer and report stronger alliance early
        on. Only pick groups where you have real depth — vague-fit
        matches drop out fast and damage both sides of the relationship.
      </ResearchCallout>
      <Group
        title="Who do you see?"
        hint="Required — patients are pre-filtered by these"
      >
      <Field
        label={
          <>
            Client types{" "}
            <span className="text-xs text-[#6D6A65] font-normal">(pick up to 3)</span>{" "}
            <Req />
          </>
        }
      >
        <PillRow
          items={CLIENT_TYPES}
          selected={data.client_types}
          onSelect={(v) => toggleArr("client_types", v, 3)}
          testid="signup-client-type"
        />
      </Field>
      <Field
        label={
          <>
            Age groups{" "}
            <span className="text-xs text-[#6D6A65] font-normal">(pick up to 3)</span>{" "}
           <Req />
          </>
        }
      >
        <PillRow
          items={AGE_GROUPS}
          selected={data.age_groups}
          onSelect={(v) => toggleArr("age_groups", v, 3)}
          testid="signup-age-group"
        />
      </Field>
    </Group>
    </>
  );
}
