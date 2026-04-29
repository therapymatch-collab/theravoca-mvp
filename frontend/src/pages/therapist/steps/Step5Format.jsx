import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Group,
  Field,
  Req,
  PillRow,
  Tags,
} from "@/pages/therapist/TherapistSignupUI";
import {
  MODALITIES,
  MODALITY_OFFERINGS,
  AVAILABILITY,
  URGENCY_CAPACITIES,
} from "./signupOptions";

/**
 * Step 5 — "Format & locations"
 *
 * Modalities practiced (1-6 picks), where they see clients
 * (telehealth/in-person/both), office addresses (only required when
 * not telehealth-only), session availability windows, and current
 * caseload urgency.
 *
 * The office-address sub-form needs its own staging state (street,
 * city, zip) so the parent passes setters in.
 */
export default function Step5Format({
  data,
  set,
  toggleArr,
  officeAddress,
  setOfficeAddress,
  officeCity,
  setOfficeCity,
  officeZip,
  setOfficeZip,
}) {
  const addOffice = () => {
    const street = officeAddress.trim();
    const city = officeCity.trim();
    const zip = officeZip.trim();
    if (!street || !city || !zip) {
      toast.error("Street, city, and ZIP are all required.");
      return;
    }
    const full = `${street}, ${city}, ID ${zip}`;
    set("office_addresses", [...data.office_addresses, full]);
    // Keep cities in sync for back-compat geocoder
    set("office_locations", [...data.office_locations, city]);
    setOfficeAddress("");
    setOfficeCity("");
    setOfficeZip("");
  };

  const removeOffice = (addr) => {
    set(
      "office_addresses",
      data.office_addresses.filter((x) => x !== addr),
    );
    // Drop the matching city from office_locations too
    const cityFromAddr = addr.split(",")[1]?.trim();
    if (cityFromAddr) {
      set(
        "office_locations",
        data.office_locations.filter((c) => c !== cityFromAddr),
      );
    }
  };

  return (
    <>
      <Group title={<>Modalities you practice (pick 1–6) <Req /></>}>
        <div className="flex flex-wrap gap-2">
          {MODALITIES.map((m) => {
            const active = data.modalities.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleArr("modalities", m, 6)}
                data-testid={`signup-modality-${m}`}
                className={`text-sm px-3.5 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                    : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Practice format & availability">
        <Field label={<>Where do you see clients? <Req /></>}>
          <PillRow
            items={MODALITY_OFFERINGS}
            selected={[data.modality_offering]}
            onSelect={(v) => set("modality_offering", v)}
            testid="signup-modality-offering"
          />
        </Field>
        {data.modality_offering !== "telehealth" && (
          <Field
            label={<>Office addresses (Idaho) <Req /></>}
            hint="Patients see these on your profile. We use them to match you within ~30 miles of patient cities/ZIPs."
          >
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <Input
                value={officeAddress}
                onChange={(e) => setOfficeAddress(e.target.value)}
                placeholder="Street address (e.g. 123 W Main St, Suite 200)"
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-7"
                data-testid="signup-office-street"
              />
              <Input
                value={officeCity}
                onChange={(e) => setOfficeCity(e.target.value)}
                placeholder="City"
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-3"
                data-testid="signup-office-city"
              />
              <Input
                value={officeZip}
                onChange={(e) =>
                  setOfficeZip(e.target.value.replace(/\D/g, "").slice(0, 5))
                }
                placeholder="ZIP"
                className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl sm:col-span-2"
                data-testid="signup-office-zip"
              />
            </div>
            <button
              type="button"
              className="tv-btn-secondary !py-2 !px-4 text-sm mt-2"
              onClick={addOffice}
              data-testid="signup-office-add"
            >
              <Plus size={14} className="inline mr-1" /> Add office
            </button>
            <Tags items={data.office_addresses} onRemove={removeOffice} />
          </Field>
        )}
        <Field label={<>Sessions you can offer <Req /></>}>
          <PillRow
            items={AVAILABILITY}
            selected={data.availability_windows}
            onSelect={(v) => toggleArr("availability_windows", v)}
            testid="signup-availability"
          />
        </Field>
        <Field label="Current caseload">
          <PillRow
            items={URGENCY_CAPACITIES}
            selected={[data.urgency_capacity]}
            onSelect={(v) => set("urgency_capacity", v)}
            testid="signup-urgency"
          />
        </Field>
      </Group>
    </>
  );
}
