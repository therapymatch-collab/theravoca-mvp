import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Group,
  Req,
  PillRow,
} from "@/pages/therapist/TherapistSignupUI";
import { STYLE_TAGS } from "./signupOptions";
import { api } from "@/lib/api";

/**
 * Step 7 — "Style & bio"
 *
 * Style tags (multi-select) + an optional short bio. Bio is shown to
 * patients on the results page, so we encourage 2-3 sentences.
 *
 * 2026-05-18: added "Draft my bio with AI" button. Sends the
 * in-progress profile (credential / specialties / modalities /
 * style tags / etc) to the backend's draft-bio endpoint which
 * uses Claude Haiku to generate a 2-3 sentence first-person bio.
 * Saves the therapist the "what do I write?" friction. They can
 * edit the draft freely, or click again for a different cut.
 * Rate-limited per-IP (10/hr) on the backend.
 */
export default function Step7Style({ data, set, toggleArr }) {
  const [drafting, setDrafting] = useState(false);

  const draftBio = async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await api.post("/therapists/draft-bio", {
        name: data.name || "",
        credential_type: data.credential_type || "",
        years_experience: Number(data.years_experience) || 0,
        primary_specialties: data.primary_specialties || [],
        secondary_specialties: data.secondary_specialties || [],
        modalities: data.modalities || [],
        style_tags: data.style_tags || [],
        age_groups: data.age_groups || [],
        client_types: data.client_types || [],
        modality_offering: data.modality_offering || "",
        office_locations: data.office_locations || [],
        t5_lived_experience: data.t5_lived_experience || "",
      });
      if (res.data?.bio) {
        set("bio", res.data.bio);
        toast.success("Drafted! Edit anything you want -- it's just a start.");
      } else {
        toast.error("Couldn't draft a bio. Please try again.");
      }
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
        "AI drafter is unavailable right now -- please write your bio manually.",
      );
    } finally {
      setDrafting(false);
    }
  };

  return (
    <>
      <Group
        title={
          <>
            How would you describe your style?{" "}
            <span className="text-sm text-[#6D6A65] font-normal">(pick up to 4)</span>{" "}
            <Req />
          </>
        }
      >
        <PillRow
          items={STYLE_TAGS}
          selected={data.style_tags}
          onSelect={(v) => toggleArr("style_tags", v, 4)}
          testid="signup-style"
        />
      </Group>

      <Group
        title="Short bio (optional)"
        hint="2–3 sentences. Patients see this on their results page."
      >
        {/* AI bio drafter -- pulls credential / specialties / style
            tags from earlier steps and asks Claude Haiku to draft a
            2-3 sentence first-person bio. Therapist can edit freely
            or click again for a different cut. Backend rate-limits
            10 drafts per IP per hour. */}
        <button
          type="button"
          onClick={draftBio}
          disabled={drafting}
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#2D4A3E] bg-[#FBE9E5] border border-[#F4C7BE] hover:bg-[#F8DAD3] rounded-full px-3 py-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="signup-bio-draft-ai"
          title="Generates a 2-3 sentence bio from the credential + specialties + style you've already entered. You can edit it after."
        >
          {drafting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Drafting your bio...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              {data.bio?.trim() ? "Re-draft with AI" : "Draft my bio with AI"}
            </>
          )}
        </button>
        <Textarea
          rows={4}
          value={data.bio}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="I'm a Boise-based LCSW with 10+ years..."
          className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
          data-testid="signup-bio"
        />
      </Group>
    </>
  );
}
