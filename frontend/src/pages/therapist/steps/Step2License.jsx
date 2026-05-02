import { useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Group, Field, Req } from "@/pages/therapist/TherapistSignupUI";
import { imageToDataUrl } from "@/lib/image";
import { api } from "@/lib/api";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX",
  "UT","VT","VA","WA","WV","WI","WY","DC",
];

const CREDENTIAL_TYPES = [
  "LCSW","LCPC/LPC","LMFT","PsyD","PhD","MD/Psychiatrist","LAMFT","Other",
];

/**
 * Step 2 — "License & verification"
 *
 * License state — Idaho or "I'm licensed in another state".
 * If non-Idaho, show a waitlist capture popup instead of the license fields.
 */
export default function Step2License({ data, set }) {
  const [stateChoice, setStateChoice] = useState(
    data.licensed_states?.[0] === "ID" ? "ID" : (data.licensed_states?.[0] ? "other" : "ID")
  );
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistState, setWaitlistState] = useState("");
  const [waitlistCredential, setWaitlistCredential] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);

  const handleWaitlist = async () => {
    if (!waitlistName || !waitlistEmail || !waitlistState) return;
    setWaitlistLoading(true);
    try {
      await api.post("/therapist-waitlist", {
        name: waitlistName,
        email: waitlistEmail,
        state: waitlistState,
        credential_type: waitlistCredential,
      });
      setWaitlistSubmitted(true);
    } catch {
      setWaitlistSubmitted(true);
    } finally {
      setWaitlistLoading(false);
    }
  };

  return (
    <Group
      title="License & verification"
      hint="We verify every therapist's license before they go live."
    >
      <Field
        label={<>License state <Req /></>}
        hint="We're currently live in Idaho only — more states coming soon."
      >
        <select
          value={stateChoice}
          onChange={(e) => {
            const v = e.target.value;
            setStateChoice(v);
            if (v === "ID") {
              set("licensed_states", ["ID"]);
            } else {
              set("licensed_states", []);
            }
            setWaitlistSubmitted(false);
          }}
          className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
          data-testid="signup-license-state"
        >
          <option value="ID">Idaho (ID)</option>
          <option value="other">I'm licensed in another state</option>
        </select>
      </Field>

      {stateChoice === "other" && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6 mt-2" data-testid="therapist-waitlist-panel">
          {waitlistSubmitted ? (
            <div className="text-center py-4">
              <p className="text-[#2D4A3E] font-serif-display text-lg">You're on the list!</p>
              <p className="text-sm text-[#6D6A65] mt-2">
                We'll email you as soon as TheraVoca launches in your state.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-[#2B2A29] leading-relaxed mb-4">
                We're currently accepting therapists licensed in <strong>Idaho</strong> only.
                Join our provider waitlist and we'll notify you when we expand to your state.
              </p>
              <div className="space-y-3">
                <Input
                  value={waitlistName}
                  onChange={(e) => setWaitlistName(e.target.value)}
                  placeholder="Your full name"
                  className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  data-testid="therapist-waitlist-name"
                />
                <Input
                  type="email"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                  data-testid="therapist-waitlist-email"
                />
                <select
                  value={waitlistState}
                  onChange={(e) => setWaitlistState(e.target.value)}
                  className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
                  data-testid="therapist-waitlist-state"
                >
                  <option value="" disabled>Select your state...</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={waitlistCredential}
                  onChange={(e) => setWaitlistCredential(e.target.value)}
                  className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
                  data-testid="therapist-waitlist-credential"
                >
                  <option value="" disabled>Credential type (optional)...</option>
                  {CREDENTIAL_TYPES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  onClick={handleWaitlist}
                  disabled={!waitlistName || !waitlistEmail || !waitlistState || waitlistLoading}
                  className="tv-btn-primary text-sm w-full py-2.5 disabled:opacity-50"
                  data-testid="therapist-waitlist-submit"
                >
                  {waitlistLoading ? "Joining..." : "Notify me when you expand"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stateChoice === "ID" && (
        <>
          <Field label={<>License number <Req /></>}>
            <Input
              value={data.license_number}
              onChange={(e) => set("license_number", e.target.value)}
              placeholder="e.g. LCSW-12345"
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-license-number"
            />
          </Field>
          <Field label={<>License expiration date <Req /></>}>
            <Input
              type="date"
              value={data.license_expires_at || ""}
              onChange={(e) => set("license_expires_at", e.target.value)}
              className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
              data-testid="signup-license-expires"
            />
          </Field>
          <Field
            label={<>Upload a photo of your license <Req /></>}
            hint="Required so we can manually verify your credentials match. PNG, JPG or PDF. Patients never see this."
          >
            <div className="flex items-center gap-4">
              <div className="w-24 h-16 rounded-lg bg-[#FDFBF7] border border-dashed border-[#E8E5DF] overflow-hidden flex items-center justify-center">
                {data.license_picture ? (
                  <img
                    src={data.license_picture}
                    alt="License preview"
                    className="w-full h-full object-cover"
                    data-testid="signup-license-preview"
                  />
                ) : (
                  <Camera size={20} className="text-[#6D6A65]" />
                )}
              </div>
              <div className="flex-1">
                <label
                  className="tv-btn-secondary !py-2 !px-4 text-sm cursor-pointer inline-flex"
                  data-testid="signup-license-label"
                >
                  {data.license_picture ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="hidden"
                    data-testid="signup-license-input"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const url = await imageToDataUrl(f);
                        set("license_picture", url);
                      } catch (err) {
                        toast.error(err.message || "Couldn't process file");
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
                {data.license_picture && (
                  <button
                    type="button"
                    className="ml-3 text-sm text-[#D45D5D] hover:underline"
                    onClick={() => set("license_picture", null)}
                    data-testid="signup-license-remove"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </Field>
        </>
      )}
    </Group>
  );
}
