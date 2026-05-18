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
 * 2026-05-17 layout (settled after Josh caught misaligned columns
 * and an ugly empty cell next to Website):
 *
 *   [Profile photo (compact, on its own row at top)]
 *   [Full name + degree     | Credential type]
 *   [Email                  | Office phone (public)]
 *   [Website                | Gender]
 *
 * All form fields share one 2-col grid so widths line up vertically.
 * Name vertically aligns with Email + Website below it, all in the
 * LEFT column (the slot the user's eye lands on first). Photo lives
 * on its own row so the photo container's width doesn't steal space
 * from the name input.
 *
 * The private SMS-alert phone + CTIA opt-in moved out of Step 1 in
 * the 2026-05-17 reshuffle -- they live on the final Notifications
 * step now so the phone + consent live together at checkout.
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
      {/* Profile photo on its own row so its container width doesn't
          push the name input around. Compact -- avatar circle + small
          Upload button inline, hint text below. */}
      <Field label="Profile photo (optional)">
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 shrink-0 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center">
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
          <div className="flex-1 min-w-0">
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

      {/* All form fields in a single 2-col grid so widths line up.
          Reading order top-to-bottom, left-to-right:
            row 1: Name    (LEFT) | Credential   (RIGHT)
            row 2: Email   (LEFT) | Office phone (RIGHT)
            row 3: Website (LEFT) | Gender       (RIGHT)
          Name + Email + Website all live in the LEFT column so the
          most-important fields the user fills are vertically stacked
          and visually anchored to the left edge of the form. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label={<>Full name + degree{" "}<Req /></>}
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
        <Field label={<>Credential type{" "}<Req /></>}>
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
        <Field label={<>Email{" "}<Req /></>}>
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
          label={<>Office phone (public){" "}<Req /></>}
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
        {/* Gender sits in row 3's right column next to Website
            (2026-05-17 -- before this, the right cell was an empty
            placeholder which looked bad). PillRow's 3 options fit
            inside a 50% sm column without wrapping; on mobile the
            grid collapses and Gender stacks below Website. */}
        <Field label={<>Gender{" "}<Req /></>} hint="Used only when patients have a stated preference.">
          <PillRow
            items={GENDERS}
            selected={[data.gender]}
            onSelect={(v) => set("gender", v)}
            testid="signup-gender"
          />
        </Field>
      </div>
    </Group>
  );
}
