import { Textarea } from "@/components/ui/textarea";
import { Group, PillRow } from "@/components/intake/IntakeUI";
import { CLIENT_TYPES, AGE_GROUPS, ISSUES } from "./intakeOptions";

/**
 * Step "who" — what type of therapy + age group of the client.
 * Idaho-only disclaimer at the bottom.
 */
export function WhoStep({ data, set, hardCapacity }) {
  const hc = hardCapacity || {};
  const ctDisabled = hc.capacity?.disabled?.client_type || [];
  const agDisabled = hc.capacity?.disabled?.age_group || [];
  // Build {value: reason} maps so the disabled pill shows a tooltip.
  const ctReasons = Object.fromEntries(
    (hc.capacity?.protections || [])
      .filter((p) => p.axis === "client_type")
      .map((p) => [String(p.value).toLowerCase(), p.label]),
  );
  const agReasons = Object.fromEntries(
    (hc.capacity?.protections || [])
      .filter((p) => p.axis === "age_group")
      .map((p) => [String(p.value).toLowerCase(), p.label]),
  );
  // Compose a generic "n option(s) unavailable" hint when any pill in
  // the axis is disabled — gives the patient an at-a-glance reason
  // for the struck-through options without forcing them to hover.
  const ctHint =
    ctDisabled.length > 0
      ? `${ctDisabled.length} option${ctDisabled.length === 1 ? "" : "s"} unavailable — we're recruiting more therapists in those formats`
      : "";
  const agHint =
    agDisabled.length > 0
      ? `${agDisabled.length} option${agDisabled.length === 1 ? "" : "s"} unavailable — we're recruiting more therapists for those age groups`
      : "";
  return (
    <div className="space-y-6">
      <Group label="What type of therapy is needed?">
        <PillRow
          items={CLIENT_TYPES}
          selected={[data.client_type]}
          onSelect={(v) => set("client_type", v)}
          testid="client-type"
          disabledValues={ctDisabled}
          disabledReasons={ctReasons}
        />
        {ctHint && (
          <p className="text-xs text-[#B37E35] mt-2" data-testid="client-type-warning">
            {ctHint}
          </p>
        )}
      </Group>
      <Group label="What age group is the client?">
        <PillRow
          items={AGE_GROUPS}
          selected={[data.age_group]}
          onSelect={(v) => set("age_group", v)}
          testid="age-group"
          disabledValues={agDisabled}
          disabledReasons={agReasons}
        />
        {agHint && (
          <p className="text-xs text-[#B37E35] mt-2" data-testid="age-group-warning">
            {agHint}
          </p>
        )}
      </Group>
      <p className="text-xs text-[#6D6A65]">
        Our therapists are currently licensed in <strong>Idaho</strong> only during our beta launch.
      </p>
    </div>
  );
}

/**
 * Step "issues" — main concerns (max 3) + optional free-text "anything else".
 */
export function IssuesStep({ data, set, toggleArr }) {
  return (
    <div>
      <Group
        label="Main concerns the client wants help with"
        hint={`Pick up to 3, in priority order. Top of list = highest priority. (${data.presenting_issues.length}/3)`}
      >
        <PillRow
          items={ISSUES}
          selected={data.presenting_issues}
          onSelect={(v) => toggleArr("presenting_issues", v, 3)}
          testid="issue"
        />
      </Group>
      <div className="mt-6">
        <label className="block text-xs font-semibold text-[#6D6A65] uppercase tracking-wider mb-2">
          Anything else? (optional — no contact or personally identifiable info)
        </label>
        <Textarea
          rows={3}
          value={data.other_issue}
          onChange={(e) => set("other_issue", e.target.value)}
          placeholder="e.g. recent loss, perinatal, prefer culturally-responsive provider"
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid="other-issue"
        />
      </div>
    </div>
  );
}
