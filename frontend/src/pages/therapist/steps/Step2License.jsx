import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Group, Field, Req } from "@/pages/therapist/TherapistSignupUI";
import { imageToDataUrl } from "@/lib/image";

/**
 * Step 2 — "License & verification"
 *
 * License state (Idaho-only for now), license number, expiration
 * date, and a required photo upload of the license card. The photo
 * is staged client-side as a data URL — admin manually verifies it
 * during approval.
 */
export default function Step2License({ data, set }) {
  return (
    <Group
      title="License & verification"
      hint="We verify every therapist's license before they go live."
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={<>License state <Req /></>}
          hint="We're currently live in Idaho only — multi-state coming soon."
        >
          <select
            value={(data.licensed_states && data.licensed_states[0]) || "ID"}
            onChange={(e) => set("licensed_states", [e.target.value])}
            className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
            data-testid="signup-license-state"
          >
            <option value="ID">Idaho (ID)</option>
          </select>
        </Field>
        <Field label={<>License number <Req /></>}>
          <Input
            value={data.license_number}
            onChange={(e) => set("license_number", e.target.value)}
            placeholder="e.g. LCSW-12345"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="signup-license-number"
          />
        </Field>
      </div>
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
    </Group>
  );
}
