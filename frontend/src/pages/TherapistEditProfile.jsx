/**
 * TherapistEditProfile
 *
 * Self-service profile editor accessed from the therapist portal.
 * Backend: PUT /api/portal/therapist/profile (magic-link session auth).
 *
 * Split into 5 small sections so a solo-practice therapist can jump to
 * whatever they need without a giant monolithic form:
 *   1. About you (bio, languages)
 *   2. Session fees (cash rate, sliding, free consult, insurance)
 *   3. Format & offices (telehealth/in-person, addresses, office phone)
 *   4. Specialties & modalities (marks the change as pending re-approval)
 *   5. Contact & availability (website, alert prefs, availability windows)
 *
 * Changes to any "re-approval" field (specialties, license, name, etc.)
 * flip a flag server-side so an admin sees the diff in the pending queue.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, AlertTriangle } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sessionClient, getSession } from "@/lib/api";

const AGE_GROUP_OPTIONS = [
  { v: "children", l: "Children (<12)" },
  { v: "teens", l: "Teens (13–17)" },
  { v: "young_adults", l: "Young adults (18–29)" },
  { v: "adults", l: "Adults (30–64)" },
  { v: "seniors", l: "Seniors (65+)" },
];

const MODALITY_OPTIONS = [
  { v: "cbt", l: "CBT" },
  { v: "dbt", l: "DBT" },
  { v: "emdr", l: "EMDR" },
  { v: "ifs", l: "Internal Family Systems" },
  { v: "aedp", l: "AEDP" },
  { v: "ppt", l: "Positive Psychology / strengths-based" },
  { v: "psychodynamic", l: "Psychodynamic" },
  { v: "mindfulness", l: "Mindfulness / ACT" },
  { v: "somatic", l: "Somatic" },
  { v: "gottman", l: "Gottman Method (couples)" },
  { v: "play_therapy", l: "Play therapy (kids)" },
];

const AVAILABILITY_OPTIONS = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
];

export default function TherapistEditProfile() {
  const navigate = useNavigate();
  const session = getSession();
  const client = useMemo(() => sessionClient(session?.token), [session?.token]);
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session?.token) {
      navigate("/sign-in?role=therapist");
      return;
    }
    client
      .get("/portal/therapist/profile")
      .then((r) => {
        setProfile(r.data);
        setDraft({
          bio: r.data.bio || "",
          cash_rate: r.data.cash_rate ?? 150,
          sliding_scale: !!r.data.sliding_scale,
          free_consult: !!r.data.free_consult,
          office_phone: r.data.office_phone || "",
          phone_alert: r.data.phone_alert || r.data.phone || "",
          website: r.data.website || "",
          office_addresses: [...(r.data.office_addresses || [])],
          office_locations: [...(r.data.office_locations || [])],
          offers_in_person:
            r.data.offers_in_person ?? (r.data.office_addresses?.length > 0),
          telehealth:
            r.data.telehealth ??
            ["telehealth", "both"].includes(r.data.modality_offering || ""),
          modalities: [...(r.data.modalities || [])],
          insurance_accepted: [...(r.data.insurance_accepted || [])],
          languages_spoken: [...(r.data.languages_spoken || ["English"])],
          availability: [...(r.data.availability || [])],
          age_groups: [...(r.data.age_groups || [])],
          notify_by_email: r.data.notify_by_email !== false,
          notify_by_sms: r.data.notify_by_sms !== false,
          // Re-approval fields (editable, but flag change)
          primary_specialties: [...(r.data.primary_specialties || [])],
          secondary_specialties: [...(r.data.secondary_specialties || [])],
        });
      })
      .catch((e) => {
        toast.error(e?.response?.data?.detail || "Couldn't load profile");
        navigate("/portal/therapist");
      });
  }, [client, navigate, session?.token]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const toggleList = (key, value, max = null) => {
    setDraft((d) => {
      const current = d[key] || [];
      const has = current.includes(value);
      if (!has && max != null && current.length >= max) {
        toast.error(`You can pick up to ${max}.`);
        return d;
      }
      return {
        ...d,
        [key]: has ? current.filter((x) => x !== value) : [...current, value],
      };
    });
  };

  const addOfficeAddress = () => {
    setDraft((d) => ({
      ...d,
      office_addresses: [...(d.office_addresses || []), ""],
    }));
  };
  const updateOfficeAddress = (i, value) => {
    setDraft((d) => {
      const arr = [...(d.office_addresses || [])];
      arr[i] = value;
      return { ...d, office_addresses: arr };
    });
  };
  const removeOfficeAddress = (i) => {
    setDraft((d) => ({
      ...d,
      office_addresses: (d.office_addresses || []).filter((_, j) => j !== i),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...draft };
      // Keep derived modality_offering in sync so the matching engine uses
      // the right flag without a separate toggle
      if (payload.offers_in_person && payload.telehealth)
        payload.modality_offering = "both";
      else if (payload.offers_in_person)
        payload.modality_offering = "in_person";
      else payload.modality_offering = "telehealth";
      payload.cash_rate = Number(payload.cash_rate || 0);
      const res = await client.put("/portal/therapist/profile", payload);
      toast.success(
        res.data?.requires_reapproval
          ? "Saved. Specialty changes need admin approval before they go live."
          : "Profile saved",
      );
      setProfile(res.data.profile);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D4A3E]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-12" data-testid="therapist-edit-profile">
        <Link
          to="/portal/therapist"
          className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline mb-6"
          data-testid="back-to-portal"
        >
          <ArrowLeft size={14} /> Back to portal
        </Link>
        <h1 className="font-serif-display text-4xl text-[#2D4A3E]">
          Edit your profile
        </h1>
        <p className="text-[#6D6A65] mt-2 text-pretty max-w-xl">
          Keep your directory listing fresh so patients see what they need to
          choose you. Changes to <strong>fees, availability, office details,
          and bio</strong> go live instantly. Changes to
          <strong> specialties or license info</strong> require a quick admin
          re-review before they're shown to patients.
        </p>

        {profile.pending_reapproval && (
          <div className="mt-6 bg-[#FBF2E8] border border-[#F0DEC8] rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="text-[#B8742A] mt-0.5 shrink-0" size={18} />
            <div className="text-sm text-[#6D4a1f]">
              You have specialty/license changes pending admin re-approval —
              your directory listing shows the previously approved version
              until we've reviewed them. No action needed from you.
            </div>
          </div>
        )}

        {/* 1. About you */}
        <Section title="About you">
          <Field label="Bio (patients read this)">
            <Textarea
              value={draft.bio}
              onChange={(e) => set("bio", e.target.value)}
              rows={5}
              maxLength={800}
              placeholder="A warm, 3–5 sentence description of who you help and how you work. Patients scan this to decide to book."
              data-testid="input-bio"
            />
            <div className="text-xs text-[#6D6A65] mt-1">
              {(draft.bio || "").length}/800
            </div>
          </Field>
          <Field label="Languages you offer sessions in">
            <ChipRow
              options={["English", "Spanish", "ASL", "Mandarin", "French", "Portuguese"]}
              selected={draft.languages_spoken}
              onToggle={(v) => toggleList("languages_spoken", v)}
              testidPrefix="lang"
            />
          </Field>
        </Section>

        {/* 2. Session fees */}
        <Section title="Session fees">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Cash / out-of-pocket rate (USD)">
              <Input
                type="number"
                value={draft.cash_rate}
                min={0}
                max={1000}
                onChange={(e) => set("cash_rate", e.target.value)}
                data-testid="input-cash-rate"
              />
            </Field>
            <div className="space-y-2 pt-6">
              <CheckLine
                checked={draft.sliding_scale}
                onChange={(v) => set("sliding_scale", v)}
                label="I offer a sliding scale for patients who can't afford my full rate"
                testid="chk-sliding"
              />
              <CheckLine
                checked={draft.free_consult}
                onChange={(v) => set("free_consult", v)}
                label="I offer a free 15-minute intro consult"
                testid="chk-free-consult"
              />
            </div>
          </div>
          <Field label="Insurance panels I'm on">
            <ChipRow
              options={[
                "BlueCross BlueShield",
                "Aetna",
                "Cigna",
                "United Healthcare",
                "Regence",
                "PacificSource",
                "Medicaid",
                "Medicare",
                "TriCare",
                "EAP",
              ]}
              selected={draft.insurance_accepted}
              onToggle={(v) => toggleList("insurance_accepted", v)}
              testidPrefix="ins"
            />
          </Field>
        </Section>

        {/* 3. Format & offices */}
        <Section title="Format & offices">
          <div className="flex flex-wrap gap-4">
            <CheckLine
              checked={draft.telehealth}
              onChange={(v) => set("telehealth", v)}
              label="I offer telehealth (video)"
              testid="chk-telehealth"
            />
            <CheckLine
              checked={draft.offers_in_person}
              onChange={(v) => set("offers_in_person", v)}
              label="I see patients in-person"
              testid="chk-in-person"
            />
          </div>
          {draft.offers_in_person && (
            <Field label="Office addresses">
              {(draft.office_addresses || []).map((a, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input
                    value={a}
                    onChange={(e) => updateOfficeAddress(i, e.target.value)}
                    placeholder="123 Main St, Boise, ID 83702"
                    data-testid={`input-office-${i}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeOfficeAddress(i)}
                    className="text-sm text-[#C8412B] hover:underline px-2"
                    data-testid={`remove-office-${i}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addOfficeAddress}
                className="text-sm text-[#2D4A3E] hover:underline"
                data-testid="add-office-btn"
              >
                + Add another office
              </button>
            </Field>
          )}
          <Field label="Public office phone (patients see this)">
            <Input
              value={draft.office_phone}
              onChange={(e) => set("office_phone", e.target.value)}
              placeholder="(208) 555-0100"
              data-testid="input-office-phone"
            />
          </Field>
          <Field label="Website">
            <Input
              value={draft.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://yourpractice.com"
              data-testid="input-website"
            />
          </Field>
        </Section>

        {/* 4. Approaches */}
        <Section title="Therapy approaches & modalities">
          <p className="text-xs text-[#6D6A65] mb-3">
            Which evidence-based approaches do you actively practice?
          </p>
          <ChipRow
            options={MODALITY_OPTIONS.map((o) => o.v)}
            labels={Object.fromEntries(MODALITY_OPTIONS.map((o) => [o.v, o.l]))}
            selected={draft.modalities}
            onToggle={(v) => toggleList("modalities", v)}
            testidPrefix="modality"
          />
          <div className="pt-5 border-t border-[#E8E5DF]">
            <p className="text-sm font-medium text-[#2B2A29] mb-1">
              Age groups you work with{" "}
              <span className="text-xs text-[#6D6A65] font-normal">
                (pick up to 3)
              </span>
            </p>
            <ChipRow
              options={AGE_GROUP_OPTIONS.map((o) => o.v)}
              labels={Object.fromEntries(AGE_GROUP_OPTIONS.map((o) => [o.v, o.l]))}
              selected={draft.age_groups}
              onToggle={(v) => toggleList("age_groups", v, 3)}
              testidPrefix="agegroup"
            />
          </div>
        </Section>

        {/* 5. Availability & alerts */}
        <Section title="Availability & alerts">
          <Field label="Time slots where I currently have openings">
            <ChipRow
              options={AVAILABILITY_OPTIONS.map((o) => o.v)}
              labels={Object.fromEntries(AVAILABILITY_OPTIONS.map((o) => [o.v, o.l]))}
              selected={draft.availability}
              onToggle={(v) => toggleList("availability", v)}
              testidPrefix="avail"
            />
          </Field>
          <Field label="Private alert phone (TheraVoca SMS referrals — not public)">
            <Input
              value={draft.phone_alert}
              onChange={(e) => set("phone_alert", e.target.value)}
              placeholder="(208) 555-0123"
              data-testid="input-phone-alert"
            />
          </Field>
          <div className="space-y-2">
            <CheckLine
              checked={draft.notify_by_email}
              onChange={(v) => set("notify_by_email", v)}
              label="Email me when a new referral matches my profile"
              testid="chk-notify-email"
            />
            <CheckLine
              checked={draft.notify_by_sms}
              onChange={(v) => set("notify_by_sms", v)}
              label="Text my alert phone when a new referral matches"
              testid="chk-notify-sms"
            />
          </div>
        </Section>

        <div className="sticky bottom-4 mt-10 bg-white border border-[#E8E5DF] rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
          <div className="text-xs text-[#6D6A65]">
            Saved changes are visible to patients instantly (except
            specialty/license changes, which need a quick admin review).
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-[#2D4A3E] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-60"
            data-testid="save-profile-btn"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save changes
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-6">
      <h2 className="font-serif-display text-2xl text-[#2D4A3E] mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-[#2B2A29] mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function CheckLine({ checked, onChange, label, testid }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <Checkbox
        checked={!!checked}
        onCheckedChange={onChange}
        className="mt-0.5"
        data-testid={testid}
      />
      <span className="text-sm text-[#2B2A29]">{label}</span>
    </label>
  );
}

function ChipRow({ options, labels, selected = [], onToggle, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onToggle(opt)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              on
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-white text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
            data-testid={`${testidPrefix}-chip-${opt}`}
          >
            {labels?.[opt] || opt}
          </button>
        );
      })}
    </div>
  );
}
