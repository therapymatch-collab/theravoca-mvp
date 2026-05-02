import { useState } from "react";
import { Group, PillRow } from "@/components/intake/IntakeUI";
import { CLIENT_TYPES, AGE_GROUPS, ISSUES } from "./intakeOptions";
import { api } from "@/lib/api";

const US_STATES = [
  { v: "AL", l: "Alabama" }, { v: "AK", l: "Alaska" }, { v: "AZ", l: "Arizona" },
  { v: "AR", l: "Arkansas" }, { v: "CA", l: "California" }, { v: "CO", l: "Colorado" },
  { v: "CT", l: "Connecticut" }, { v: "DE", l: "Delaware" }, { v: "FL", l: "Florida" },
  { v: "GA", l: "Georgia" }, { v: "HI", l: "Hawaii" }, { v: "IL", l: "Illinois" },
  { v: "IN", l: "Indiana" }, { v: "IA", l: "Iowa" }, { v: "KS", l: "Kansas" },
  { v: "KY", l: "Kentucky" }, { v: "LA", l: "Louisiana" }, { v: "ME", l: "Maine" },
  { v: "MD", l: "Maryland" }, { v: "MA", l: "Massachusetts" }, { v: "MI", l: "Michigan" },
  { v: "MN", l: "Minnesota" }, { v: "MS", l: "Mississippi" }, { v: "MO", l: "Missouri" },
  { v: "MT", l: "Montana" }, { v: "NE", l: "Nebraska" }, { v: "NV", l: "Nevada" },
  { v: "NH", l: "New Hampshire" }, { v: "NJ", l: "New Jersey" }, { v: "NM", l: "New Mexico" },
  { v: "NY", l: "New York" }, { v: "NC", l: "North Carolina" }, { v: "ND", l: "North Dakota" },
  { v: "OH", l: "Ohio" }, { v: "OK", l: "Oklahoma" }, { v: "OR", l: "Oregon" },
  { v: "PA", l: "Pennsylvania" }, { v: "RI", l: "Rhode Island" }, { v: "SC", l: "South Carolina" },
  { v: "SD", l: "South Dakota" }, { v: "TN", l: "Tennessee" }, { v: "TX", l: "Texas" },
  { v: "UT", l: "Utah" }, { v: "VT", l: "Vermont" }, { v: "VA", l: "Virginia" },
  { v: "WA", l: "Washington" }, { v: "WV", l: "West Virginia" }, { v: "WI", l: "Wisconsin" },
  { v: "WY", l: "Wyoming" }, { v: "DC", l: "Washington D.C." },
];

/**
 * Step "who" — state confirmation, therapy type + age group.
 * If the patient is not in Idaho, show a waitlist signup panel
 * instead of letting them continue the intake.
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

  // State choice: "ID" or "other"
  const [stateChoice, setStateChoice] = useState(
    data.location_state === "ID" ? "ID" : (data.location_state ? "other" : "ID")
  );
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistState, setWaitlistState] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);

  const handleWaitlist = async () => {
    if (!waitlistEmail || !waitlistState) return;
    setWaitlistLoading(true);
    try {
      await api.post("/waitlist", { email: waitlistEmail, state: waitlistState });
      setWaitlistSubmitted(true);
    } catch {
      setWaitlistSubmitted(true);
    } finally {
      setWaitlistLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Group label="Where is the client located?">
        <select
          value={stateChoice}
          onChange={(e) => {
            const v = e.target.value;
            setStateChoice(v);
            if (v === "ID") {
              set("location_state", "ID");
            } else {
              set("location_state", "");
            }
            setWaitlistSubmitted(false);
          }}
          className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-3 text-sm text-[#2B2A29] focus:outline-none focus:ring-2 focus:ring-[#C87965]/30"
          data-testid="state-select"
        >
          <option value="ID">Idaho</option>
          <option value="other">Not in Idaho</option>
        </select>
      </Group>

      {stateChoice === "other" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6" data-testid="waitlist-panel">
          {waitlistSubmitted ? (
            <div className="text-center py-2">
              <p className="text-[#2D4A3E] font-serif-display text-lg">You're on the list!</p>
              <p className="text-sm text-[#6D6A65] mt-2">
                We'll email you as soon as TheraVoca launches in your state.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#2B2A29] leading-relaxed">
                We're currently matching patients in <strong>Idaho</strong> only. We're expanding —
                join our waitlist and we'll notify you when we launch in your state.
              </p>
              <div className="mt-4 space-y-3">
                <select
                  value={waitlistState}
                  onChange={(e) => setWaitlistState(e.target.value)}
                  className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C87965]/30"
                  data-testid="waitlist-state"
                >
                  <option value="" disabled>Select your state...</option>
                  {US_STATES.map((s) => (
                    <option key={s.v} value={s.v}>{s.l}</option>
                  ))}
                </select>
                <input
                  type="email"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C87965]/30"
                  data-testid="waitlist-email"
                />
                <button
                  onClick={handleWaitlist}
                  disabled={!waitlistEmail || !waitlistState || waitlistLoading}
                  className="tv-btn-primary text-sm w-full py-2.5 disabled:opacity-50"
                  data-testid="waitlist-submit"
                >
                  {waitlistLoading ? "Joining..." : "Notify me"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stateChoice === "ID" && (
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
                <span className="text-sm text-[#2B2A29] min-w-[160px] truncate">
                  {ISSUE_LABELS[issueKey] || issueKey}
                </span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSeverity(issueKey, n)}
                      className={`w-9 h-8 rounded-lg text-sm font-medium transition-colors ${
                        severity[issueKey] === n
                          ? "bg-[#C87965] text-white border border-[#C87965]"
                          : "bg-[#FDFBF7] text-[#6D6A65] border border-[#E8E5DF] hover:border-[#C87965]/40"
                      }`}
                      data-testid={`severity-${issueKey}-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
