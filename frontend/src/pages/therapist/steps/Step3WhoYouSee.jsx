import { Group, Field, Req, PillRow } from "@/pages/therapist/TherapistSignupUI";
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
    <Group
      title="Who do you see?"
      hint="Required — patients are pre-filtered by these"
    >
      <Field label={<>Client types <Req /></>}>
        <PillRow
          items={CLIENT_TYPES}
          selected={data.client_types}
          onSelect={(v) => toggleArr("client_types", v)}
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
  );
}
