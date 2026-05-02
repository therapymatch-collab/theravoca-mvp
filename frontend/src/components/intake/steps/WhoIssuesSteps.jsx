import { useState } from "react";
import { Group, PillRow } from "@/components/intake/IntakeUI";
import { CLIENT_TYPES, AGE_GROUPS, ISSUES, US_STATES, COVERED_STATES } from "./intakeOptions";
import { api } from "@/lib/api";

/**
 * Step "who" — what type of therapy + age group + state of the client.
 * If the user picks a state we don't serve yet, we show a waitlist
 * signup instead of letting them continue the intake.
 */
export function WhoStep({ data, set, hardCapacity }) {
  const hc = hardCapacity || {};
  const ctDisabled = hc.capacity?.disabled?.client_type || [];
  const agDisabled = hc.capacity?.disabled?.age_group || [];
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
  const ctHint =
    ctDisabled.length > 0
      ? `${ctDisabled.length} option${ctDisabled.length === 1 ? "" : "s"} unavailable — we're recruiting more therapists in those formats`
      : "";
  const agHint =
    agDisabled.length > 0
      ? `${agDisabled.length} option${agDisabled.length === 1 ? "" : "s"} unavailable — we're recruiting more therapists for those age groups`
      : "";

  const isCovered = COVERED_STATES.has(data.location_state);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);

  const handleWaitlist = async () => {
    if (!waitlistEmail) return;
    setWaitlistLoading(true);
    try {
      await api.post("/waitlist", { email: waitlistEmail, state: data.location_state });
      setWaitlistSubmitted(true);
    } catch {
      // still show success — don't leak validation to bots
      setWaitlistSubmitted(true);
    } finally {
      setWaitlistLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Group label="What state is the client located in?">
        <select
          value={data.location_state}
          onChange={(e) => {
            set("location_state", e.target.value);
            setWaitlistSubmitted(false);
          }}
          className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm text-[#2B2A29] focus:outline-none focus:ring-2 focus:ring-[#C87965]/30"
          data-testid="state-select"
        >
          <option value="" disabled>Select a state...</option>
          {US_STATES.map((s) => (
            <option key={s.v} value={s.v}>{s.l}</option>
          ))}
        </select>
      </Group>

      {!isCovered && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6" data-testid="waitlist-panel">
          {waitlistSubmitted ? (
            <div className="text-center">
              <p className="text-[#2D4A3E] font-serif-display text-lg">You're on the list!</p>
              <p className="text-sm text-[#6D6A65] mt-2">
                We'll email you as soon as TheraVoca launches in{" "}
                <strong>{US_STATES.find((s) => s.v === data.location_state)?.l || data.location_state}</strong>.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#2B2A29] leading-relaxed">
                We're currently matching patients in <strong>Idaho</strong> only. We're expanding — join our waitlist and we'll notify you when we launch in{" "}
                <strong>{US_STATES.find((s) => s.v === data.location_state)?.l || data.location_state}</strong>.
              </p>
              <div className="mt-4 flex gap-2">
                <input
                  type="email"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C87965]/30"
                  data-testid="waitlist-email"
                />
                <button
                  onClick={handleWaitlist}
                  disabled={!waitlistEmail || waitlistLoading}
                  className="tv-btn-primary text-sm px-5 py-2.5 disabled:opacity-50"
                  data-testid="waitlist-submit"
                >
                  {waitlistLoading ? "Joining..." : "Notify me"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isCovered && (
        <>
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
        </>
      )}
    </div>
  );
}

/**
 * Step "issues" — main concerns (max 5) + severity scale (1-5) for each.
 */
export function IssuesStep({ data, set, toggleArr }) {
  const severity = data.issue_severity || {};
  const ISSUE_LABELS = Object.fromEntries(ISSUES.map((i) => [i.v, i.l]));

  const setSeverity = (issueKey, level) => {
    set("issue_severity", { ...severity, [issueKey]: level });
  };

  return (
    <div>
      <Group
        label="Main concerns the client wants help with"
        hint={`Pick up to 5, in priority order — your 1st pick is the primary concern (used as a hard filter to find specialists). 2nd & 3rd add bonus weight to the ranking. (${data.presenting_issues.length}/5)`}
      >
        <PillRow
          items={ISSUES}
          selected={data.presenting_issues}
          onSelect={(v) => toggleArr("presenting_issues", v, 5)}
          testid="issue"
          showRank
        />
      </Group>

      {data.presenting_issues.length > 0 && (
        <Group
          label="How much is each concern affecting daily life?"
          hint="1 = mild, occasional · 5 = severe, daily interference"
        >
          <div className="space-y-3">
            {data.presenting_issues.map((issueKey) => (
              <div key={issueKey} className="flex items-center gap-3">
                <span className="text-sm text-