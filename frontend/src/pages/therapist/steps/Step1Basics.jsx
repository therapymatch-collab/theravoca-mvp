import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Group, Field, Req, PillRow } from "@/pages/therapist/TherapistSignupUI";
import { formatUsPhone } from "@/lib/phone";
import { imageToDataUrl } from "@/lib/image";
import { CREDENTIAL_TYPES, GENDERS } from "./signupOptions";

/**
 * Step 1 -- "Basics"
 *
 * 2026-05-17 layout (per Josh): profile photo on the left, full name +
 * degree on the right at the top. Then 2-col grid of
 * (credential | email) and (website | office_phone). Gender pinned
 * at the bottom.
 *
 * The private SMS-alert phone + CTIA opt-in block lived here until
 * 2026-05-17; both moved to the final Notifications step so the
 * phone field and the SMS-consent checkbox live together at signup
 * checkout (Josh asked therapists shouldn't have to think about
 * SMS consent until they're confirming their notification
 * preferences).
 */
export default function Step1Basics({
  data,
  set,
  websiteIsValid,
  websiteError,
  setWebsiteError,
}) {
  return (
    <Group title="Basics">
      {/* Top row: profile photo on the left, name + degree on the
          right. On mobile (< sm) they stack: photo first, then name. */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] sm:items-start gap-4">
        <Field label="Profile photo (optional)">
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center">
              {data.profile_picture ? (
                <img
                  src={data.profile_picture}
                  alt="Profile preview"
                  className="w-full h-full object-cover"
                  data-testid="signup-photo-preview"
                />
              ) : (
                <Camera size={22} className="text-[#6D6A65]" />
              )}
            </div>
            <div className="flex-1">
              <label
                className="tv-btn-secondary !py-2 !px-4 text-sm cursor-pointer inline-flex"
                data-testid="signup-photo-label"
              >
                {data.profile_picture ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="signup-photo-input"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const url = await imageToDataUrl(f);
                      set("profile_picture", url);
                    } catch (err) {
                      toast.error(err.message || "Couldn't process image");
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              {data.profile_picture && (
                <button
                  type="button"
                  className="ml-3 text-sm text-[#D45D5D] hover:underline"
                  onClick={() => set("profile_picture", null)}
                  data-testid="signup-photo-remove"
                >
                  Remove
                </button>
              )}
              <p className="text-xs text-[#6D6A65] mt-1.5">
                A square headshot works best. Resized to 256x256, &lt;500KB.
              </p>
            </div>
          </div>
        </Field>
        <Field
          label={<>Full name + degree{" "}<Req /></>}
          hint="e.g. Sarah Lin, LCSW"
        >
          <Input
            value={data.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Sarah Lin, LCSW"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="signup-name"
          />
        </Field>
      </div>

      {/* Body: 2-col grid of (credential | email) and (website | office_phone). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={<>Credential type{" "}<Req /></>}>
          <select
            value={data.credential_type}
            onChange={(e) => set("credential_type", e.target.value)}
            className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-2.5 text-sm"
            data-testid="signup-credential-type"
          >
            <option value="">Select credential type...</option>
            {CREDENTIAL_TYPES.map((c) => (
              <option key={c.v} value={c.v}>{c.l}</option>
            ))}
          </select>
        </Field>
        <Field label={<>Email{" "}<Req /></>}>
          <Input
            type="email"
            value={data.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@practice.com"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="signup-email"
          />
        </Field>
        <Field
          label="Website (public)"
          hint="We'll auto-prefix https:// and check the link works."
        >
          <Input
            type="url"
            value={data.website}
            onChange={(e) => {
              set("website", e.target.value);
              setWebsiteError("");
            }}
            onBlur={() => {
              if (data.website && !websiteIsValid(data.website)) {
                setWebsiteError(
                  "That doesn't look like a valid URL -- try e.g. yourpractice.com",
                );
              }
            }}
            placeholder="yourpractice.com"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="signup-website"
          />
          {websiteError && (
            <p
              className="mt-1.5 text-xs text-[#D45D5D]"
              data-testid="signup-website-error"
            >
              {websiteError}
            </p>
          )}
        </Field>
        <Field
          label={<>Office phone (public){" "}<Req /></>}
          hint="Patients see this on your profile."
        >
          <Input
            type="tel"
            inputMode="tel"
            maxLength={12}
            value={data.office_phone}
            onChange={(e) => set("office_phone", formatUsPhone(e.target.value))}
            placeholder="208-555-0150"
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
            data-testid="signup-office-phone"
          />
        </Field>
      </div>

      {/* Gender pinned at the bottom of the basics group. */}
      <Field label={<>Gender{" "}<Req /></>} hint="Used only when patients have a stated preference.">
        <PillRow
          items={GENDERS}
          selected={[data.gender]}
          onSelect={(v) => set("gender", v)}
          testid="signup-gender"
        />
      </Field>
    </Group>
  );
}
