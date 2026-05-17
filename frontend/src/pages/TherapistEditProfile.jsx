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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, AlertTriangle, Eye, FileText, Upload, CheckCircle2 } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sessionClient, getSession } from "@/lib/api";
import credentialLabel from "@/lib/credentialLabel";
import {
  PillCol as DeepMatchPickList,
  RadioCol as DeepMatchRadio,
} from "@/pages/therapist/TherapistDeepMatchStep";
import {
  T4_OPTIONS,
  T6_OPTIONS,
} from "@/pages/therapist/deepMatchOptions";
import { ISSUES } from "@/pages/therapist/steps/signupOptions";

// slug -> human label for the patient-preview specialty chips.
const ISSUE_LABEL_MAP = Object.fromEntries(ISSUES.map((i) => [i.v, i.l]));
const issueLabel = (slug) => ISSUE_LABEL_MAP[slug] || slug.replace(/_/g, " ");

// Values must match the canonical set used in signupOptions.js (and
// in the backend matching engine + patient intake). Earlier versions
// of this file used UI-pluralised values like "children" / "young_adults"
// and lower-cased modalities like "cbt" -- those didn't match what's
// stored in the DB (which uses backend canonical "child" / "young_adult"
// / "CBT"), so chips rendered as unselected even when the therapist
// had data. Keep these values in lock-step with signupOptions.js.
const AGE_GROUP_OPTIONS = [
  { v: "child", l: "Child (under 13)" },
  { v: "teen", l: "Teen (13–17)" },
  { v: "young_adult", l: "Young adult (18–25)" },
  { v: "adult", l: "Adult (26–64)" },
  { v: "older_adult", l: "Older adult (65+)" },
];

const MODALITY_OPTIONS = [
  { v: "CBT", l: "CBT" },
  { v: "DBT", l: "DBT" },
  { v: "EMDR", l: "EMDR" },
  { v: "Mindfulness-Based", l: "Mindfulness-Based" },
  { v: "Psychodynamic", l: "Psychodynamic" },
  { v: "ACT", l: "ACT" },
  { v: "Solution-Focused", l: "Solution-Focused" },
  { v: "Gottman", l: "Gottman" },
  { v: "IFS", l: "Internal Family Systems (IFS)" },
  { v: "Somatic Experiencing", l: "Somatic Experiencing" },
  { v: "Person-Centered", l: "Person-Centered" },
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
  const [previewing, setPreviewing] = useState(false);

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
          // License fields + profile picture were absent from this
          // initializer, so the form rendered them as empty strings via
          // `draft.license_number || ""` even when the DB had values.
          // Backfilled therapists were the most visible victim --
          // backfill writes valid license_number / license_expires_at /
          // license_picture, but the form showed all three blank,
          // leading admins to think the profile was missing license info
          // when it was just a render gap. Seed them here so the form
          // reflects the truth.
          license_number: r.data.license_number || "",
          license_expires_at: r.data.license_expires_at || "",
          profile_picture: r.data.profile_picture || "",
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
          // Backend stores `availability_windows`; the load + save here
          // had been reading/writing a phantom `availability` field that
          // the GET endpoint never returns. Existing data was invisible
          // to the form and form edits never persisted. Realign to the
          // backend name so existing windows surface and saves stick.
          availability_windows: [...(r.data.availability_windows || [])],
          age_groups: [...(r.data.age_groups || [])],
          notify_by_email: r.data.notify_by_email !== false,
          notify_by_sms: r.data.notify_by_sms !== false,
          // Re-approval fields (editable, but flag change)
          primary_specialties: [...(r.data.primary_specialties || [])],
          secondary_specialties: [...(r.data.secondary_specialties || [])],
          // Deep-match v5: T6/T6b are the primary signal; T4/T5 remain.
          t6_session_expectations: [...(r.data.t6_session_expectations || [])],
          t6_early_sessions_description: r.data.t6_early_sessions_description || "",
          t4_hard_truth: r.data.t4_hard_truth || "",
          t5_lived_experience: r.data.t5_lived_experience || "",
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

  // Hash-scroll handler. When the dashboard chips link to
  // /portal/therapist/edit#deep-match, React Router doesn't auto-scroll
  // to the anchor on client-side navigation. We wait for the profile
  // load to finish (sections only mount once `profile` is truthy) then
  // scroll to the targeted element. The element already has
  // `scroll-mt-24` so the sticky header doesn't cover the heading.
  useEffect(() => {
    if (!profile) return;
    const hash = (typeof window !== "undefined" && window.location.hash) || "";
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    // requestAnimationFrame to let layout settle after profile load.
    const r = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(r);
  }, [profile]);

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D4A3E]" />
      </div>
    );
  }

  // `miss` = Set of required-field keys currently missing per backend.
  // `req(key)` returns the props to spread onto a Field so it can show
  // the asterisk + red-tinged "Required to go live" pill.
  const miss = missingKeySet(profile.completeness);
  const req = (key) => ({
    required: REQUIRED_KEYS.has(key),
    missing: miss.has(key),
  });

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
          insurance, languages, modalities, and bio</strong> go live instantly.
          Changes to your <strong>name, credential, gender, years of
          experience, specialties, or license</strong> require a quick admin
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

        <GoLiveBanner profile={profile} />

        {/* 1. About you */}
        <Section title="About you">
          <Field label="Profile photo" {...req("profile_picture")}>
            <PhotoUploader
              value={draft.profile_picture}
              onChange={(v) => set("profile_picture", v)}
            />
          </Field>
          <Field label="Bio (patients read this)" {...req("bio")}>
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

        {/* 2. License & credentials */}
        <Section title="License & credentials">
          <p className="text-xs text-[#6D6A65] -mt-2 mb-2">
            Editing your license number or expiration date triggers an
            admin re-approval review. Your profile stays live during
            review.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="License number" {...req("license_number")}>
              <Input
                value={draft.license_number || ""}
                onChange={(e) => set("license_number", e.target.value)}
                placeholder="e.g. LCSW-12345"
                data-testid="input-license-number"
              />
            </Field>
            <Field label="License expiration date" {...req("license_expires_at")}>
              <Input
                type="date"
                value={(draft.license_expires_at || "").slice(0, 10)}
                onChange={(e) =>
                  set(
                    "license_expires_at",
                    e.target.value
                      ? new Date(e.target.value).toISOString()
                      : "",
                  )
                }
                data-testid="input-license-expires"
              />
            </Field>
          </div>
          <div className="mt-4 pt-4 border-t border-[#E8E5DF]">
            <LicenseDocUploader />
          </div>
        </Section>

        {/* 3. Session fees */}
        <Section title="Session fees">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Cash / out-of-pocket rate (USD)" {...req("cash_rate")}>
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
                <div key={`office-${i}-${(draft.office_addresses || []).length}`} className="flex gap-2 mb-2">
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
          <Field
            label="Which evidence-based approaches do you actively practice?"
            {...req("modalities")}
          >
            <ChipRow
              options={MODALITY_OPTIONS.map((o) => o.v)}
              labels={Object.fromEntries(MODALITY_OPTIONS.map((o) => [o.v, o.l]))}
              selected={draft.modalities}
              onToggle={(v) => toggleList("modalities", v)}
              testidPrefix="modality"
            />
          </Field>
          <div className="pt-5 border-t border-[#E8E5DF]">
            <Field
              label={
                <>
                  Age groups you work with{" "}
                  <span className="text-xs text-[#6D6A65] font-normal">
                    (pick up to 3)
                  </span>
                </>
              }
              {...req("age_groups")}
            >
              <ChipRow
                options={AGE_GROUP_OPTIONS.map((o) => o.v)}
                labels={Object.fromEntries(AGE_GROUP_OPTIONS.map((o) => [o.v, o.l]))}
                selected={draft.age_groups}
                onToggle={(v) => toggleList("age_groups", v, 3)}
                testidPrefix="agegroup"
              />
            </Field>
          </div>
        </Section>

        {/* 5. Availability & alerts */}
        <Section title="Availability & alerts">
          <Field
            label="Time slots where I currently have openings"
            {...req("availability_windows")}
          >
            <ChipRow
              options={AVAILABILITY_OPTIONS.map((o) => o.v)}
              labels={Object.fromEntries(AVAILABILITY_OPTIONS.map((o) => [o.v, o.l]))}
              selected={draft.availability_windows}
              onToggle={(v) => toggleList("availability_windows", v)}
              testidPrefix="avail"
            />
          </Field>
          <Field
            label="Contact phone (private -- for account issues, not shown to patients)"
            {...req("phone")}
          >
            <Input
              value={draft.phone_alert}
              onChange={(e) => {
                // Write to both fields so the asterisk on this input
                // accurately maps to the required `phone` slot. The
                // matching engine reads phone_alert with phone as a
                // fallback (helpers.py:743), and the importer writes
                // identical values to both -- keeping them in sync
                // here removes the historical edit-page divergence
                // where phone_alert had a UI but phone didn't.
                set("phone_alert", e.target.value);
                set("phone", e.target.value);
              }}
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
            {/* SMS opt-in hidden 2026-05-14 -- TheraVoca currently
                reserves SMS for cold-recruit outreach. Signed-up
                therapists get email notifications only. Restore this
                CheckLine to bring back the option. */}
          </div>
        </Section>

        {/* Deep-match style fit (v2 spec). The #deep-match anchor is
            the back-fill banner's deep-link target so therapists land
            here directly. Neutral cream chrome (matching the warm-cream
            Group palette from signup) -- the previous pink/red chrome
            looked alarm-required-and-incomplete, but deep-match
            questions are ENHANCING (not REQUIRED) per
            profile_completeness.py. We reserve the alarm pink for
            sections that are actually required and not done. */}
        <section
          id="deep-match"
          className="mt-10 bg-[#FDF7EC] border border-[#E8DCC1] rounded-2xl p-6 scroll-mt-24"
          data-testid="deep-match-section"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965] font-semibold mb-1">
            ✦ Style fit · how you actually work (optional)
          </p>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
            Deep-match questions
          </h2>
          <p className="text-sm text-[#2B2A29]/85 mt-1.5 leading-relaxed">
            Patients who opt into our deeper intake get scored against
            your answers here. The session expectations question (T6) is
            our #1 matching signal — make sure it reflects how you actually work.
          </p>
          <p
            className="mt-2 text-xs text-[#2D4A3E] bg-white/70 border border-[#E8DCC1] rounded-md px-2.5 py-1.5 inline-block"
            data-testid="edit-deep-privacy"
          >
            <strong>Private to the matching engine.</strong> Patients
            never see your answers — they're only used to score fit.
          </p>

          <div className="mt-6 space-y-6">
            <Field label="T6 — What do sessions 1–3 typically look like with you? (pick 1–2)">
              <DeepMatchPickList
                items={T6_OPTIONS}
                selected={draft.t6_session_expectations}
                onSelect={(v) => toggleList("t6_session_expectations", v, 2)}
                testid="edit-t6"
              />
              <p className="text-[11px] text-[#6D6A65] mt-2">
                {(draft.t6_session_expectations || []).length}/2 selected
              </p>
            </Field>
            <Field label="T6b — Describe what your first few sessions look like in your own words (≥30 chars)">
              <Textarea
                rows={4}
                value={draft.t6_early_sessions_description}
                onChange={(e) => set("t6_early_sessions_description", e.target.value)}
                className="bg-white border-[#E8E5DF] rounded-xl"
                data-testid="edit-t6b"
                placeholder="What should a new patient expect? How do you structure early sessions? What do you typically focus on first?"
              />
              <p className="text-[11px] text-[#6D6A65] mt-1">
                {(draft.t6_early_sessions_description || "").length}/2000
              </p>
            </Field>
            <Field label="T4 — When you need to push a client past their comfort zone, how do you do it? (pick 1)">
              <DeepMatchRadio
                items={T4_OPTIONS}
                value={draft.t4_hard_truth}
                onChange={(v) => set("t4_hard_truth", v)}
                testid="edit-t4"
              />
            </Field>
            <Field label="T5 — What life experiences or communities do you understand from the inside, not from a textbook? (≥30 chars)">
              <Textarea
                rows={4}
                value={draft.t5_lived_experience}
                onChange={(e) => set("t5_lived_experience", e.target.value)}
                className="bg-white border-[#E8E5DF] rounded-xl"
                data-testid="edit-t5"
                placeholder="e.g. first-gen college, immigrant family, queer + Christian, military spouse, navigating chronic illness, sober parent…"
              />
              <p className="text-[11px] text-[#6D6A65] mt-1">
                {(draft.t5_lived_experience || "").length}/2000
              </p>
            </Field>
          </div>
        </section>

        <div className="sticky bottom-4 mt-10 bg-white border border-[#E8E5DF] rounded-2xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap shadow-sm">
          <div className="text-xs text-[#6D6A65] flex-1 min-w-[180px]">
            Saved changes are visible to patients instantly (except
            specialty/license changes, which need a quick admin review).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewing(true)}
              className="inline-flex items-center gap-2 bg-white border border-[#E8E5DF] text-[#2D4A3E] rounded-full px-4 py-2.5 text-sm font-medium hover:border-[#2D4A3E]"
              data-testid="preview-profile-btn"
            >
              <Eye size={14} /> Preview as patient
            </button>
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
        </div>
        {previewing && profile && (
          <ProfilePreviewModal
            profile={{ ...profile, ...draft }}
            onClose={() => setPreviewing(false)}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

// Deep-match T1/T3/T4 options + the PillCol (DeepMatchPickList) +
// RadioCol (DeepMatchRadio) controls now come from
// `@/pages/therapist/TherapistDeepMatchStep` so this file shares one
// source of truth with the signup form. The legacy arrow-based
// `DeepMatchRankList` was replaced with the shared `DraggableRankList`.

function GoLiveBanner({ profile }) {
  if (!profile) return null;
  const completeness = profile.completeness;
  if (!completeness) return null;
  // Mirror the same match_ready logic the dashboard ProfileStatusChip
  // uses. The old banner only checked `publishable` so it cheerfully
  // said "Your profile is live" while the therapist's trial wasn't
  // started and the dashboard correctly said "Trial not started" --
  // two pages, two contradictory truths. Build a single blockers list:
  // anything in here means the profile is NOT actually live.
  const subStatus = profile.subscription_status || null;
  const blockers = [];
  if (profile.is_active === false) blockers.push("Profile archived");
  if (profile.pending_approval) blockers.push("Awaiting admin approval");
  if (!completeness.publishable) {
    const n = (completeness.required_missing || []).length;
    blockers.push(`${n} required field${n === 1 ? "" : "s"} missing`);
  }
  // Key check: real Stripe trial requires `stripe_subscription_id` to be
  // populated. The bare `subscription_status` field is loose -- backfill
  // sets it to "trialing" even when there's no real Stripe sub, which
  // made this banner cheerfully say "live" while the dashboard correctly
  // showed "Trial not started." Use stripe_subscription_id as the actual
  // source of truth.
  if (!profile.stripe_subscription_id) {
    blockers.push("Trial not started -- add a payment method");
  } else if (["past_due", "canceled", "unpaid"].includes(subStatus)) {
    blockers.push(`Subscription: ${subStatus.replace(/_/g, " ")}`);
  }

  const missing = completeness.required_missing || [];
  const live = blockers.length === 0;
  if (live) {
    return (
      <div
        className="mt-6 bg-[#F2F7F1] border border-[#D2E2D0] rounded-xl px-4 py-3 flex items-center gap-3"
        data-testid="go-live-banner-ok"
      >
        <CheckCircle2 className="text-[#3F6F4A] shrink-0" size={18} />
        <div className="text-sm text-[#2D4A3E] flex-1">
          <strong>Your profile is live.</strong> Patients can match with you.
          Keep editing &mdash; changes save instantly.
        </div>
        <span className="text-[11px] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#3F6F4A] text-white font-semibold">
          Live
        </span>
      </div>
    );
  }
  // Profile incomplete -- show the same fields-missing breakdown as
  // before. This branch is reached only when completeness.publishable
  // is false; other blockers (sub, archived, pending) fall through to
  // the non-live banner BELOW this if-block.
  if (!completeness.publishable) {
    return (
      <div
        className="mt-6 bg-[#FDF1EF] border border-[#E8C4BB] rounded-xl px-4 py-3 flex items-start gap-3"
        data-testid="go-live-banner-missing"
      >
        <AlertTriangle className="text-[#8B3220] mt-0.5 shrink-0" size={18} />
        <div className="text-sm text-[#5C2620] flex-1 leading-relaxed">
          <strong>{missing.length} required field{missing.length === 1 ? "" : "s"} missing</strong>
          {" "}before your profile can go live. Look for the
          <span className="text-[#D45D5D] font-bold mx-1">*</span>
          markers below:
          <span className="ml-1">
            {missing.slice(0, 4).map((m, i) => (
              <span key={m.key}>
                <strong>{m.label}</strong>
                {i < Math.min(missing.length, 4) - 1 ? ", " : ""}
              </span>
            ))}
            {missing.length > 4 && ` + ${missing.length - 4} more`}
          </span>
          .
        </div>
        <span className="text-[11px] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#8B3220] text-white font-semibold shrink-0">
          Not live
        </span>
      </div>
    );
  }
  // Profile is publishable but some OTHER gate is failing (sub, archived,
  // pending approval). Show the blocker list so the therapist knows why
  // they aren't live yet -- matches the dashboard chip language.
  return (
    <div
      className="mt-6 bg-[#FBF2E8] border border-[#F0DEC8] rounded-xl px-4 py-3 flex items-start gap-3"
      data-testid="go-live-banner-blocked"
    >
      <AlertTriangle className="text-[#B8742A] mt-0.5 shrink-0" size={18} />
      <div className="text-sm text-[#6D4F1F] flex-1 leading-relaxed">
        <strong>Your profile isn't live yet.</strong> Blocking your
        match-readiness:
        <ul className="ml-4 mt-1 list-disc">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
      <span className="text-[11px] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#B8742A] text-white font-semibold shrink-0">
        Not live
      </span>
    </div>
  );
}

// Returns a Set of required-field keys that are currently missing.
// Drives the per-Field red-asterisk indicator.
function missingKeySet(completeness) {
  if (!completeness) return new Set();
  return new Set((completeness.required_missing || []).map((m) => m.key));
}

// Mapping of REQUIRED keys (from backend profile_completeness.py) to a
// list of form-level field labels they correspond to. Lets us pass
// `required={miss.has(key)}` on each Field below without sprinkling
// the full backend key list across the JSX.
const REQUIRED_KEYS = new Set([
  "name", "email", "phone", "license_number", "license_expires_at",
  "license_document",
  "bio", "profile_picture", "primary_specialties", "age_groups",
  "client_types", "modality_offering", "cash_rate", "office_or_telehealth",
  "modalities", "availability_windows",
]);


function Section({ title, children }) {
  return (
    <section className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-6">
      <h2 className="font-serif-display text-2xl text-[#2D4A3E] mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, required = false, missing = false, children }) {
  // `required` -- this field counts toward go-live readiness
  // `missing`  -- required AND currently empty/invalid (drives the red dot)
  return (
    <label className="block">
      <div className="text-sm font-medium text-[#2B2A29] mb-1.5 flex items-baseline gap-1.5 flex-wrap">
        <span>
          {label}
          {required && (
            <span
              className="text-base font-bold text-[#D45D5D] whitespace-nowrap"
              title={missing ? "Required to go live" : "Required (filled)"}
              aria-label={missing ? "Required, missing" : "Required"}
            >
              {" *"}
            </span>
          )}
        </span>
        {missing && (
          <span className="text-[10px] uppercase tracking-wider text-[#8B3220] bg-[#FBE8E2] px-1.5 py-0.5 rounded-full font-semibold">
            Required to go live
          </span>
        )}
      </div>
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

/**
 * Modal that renders the therapist's profile EXACTLY the way patients see
 * it on the results page. Helps therapists spot issues with bio length,
 * missing fields, etc. before saving.
 */
function ProfilePreviewModal({ profile, onClose }) {
  const t = profile;
  const formats = [];
  if (t.telehealth || t.modality_offering === "virtual" || t.modality_offering === "both")
    formats.push("Virtual");
  if (t.offers_in_person || t.modality_offering === "in_person" || t.modality_offering === "both")
    formats.push("In-person");
  const formatStr = formats.join(" + ") || "Virtual";
  const initials = (t.name || "")
    .split(",")[0]
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
      data-testid="profile-preview-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FDFBF7] rounded-2xl border border-[#E8E5DF] w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[#FDFBF7] border-b border-[#E8E5DF] p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
              Patient view
            </p>
            <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-0.5">
              How patients see your profile
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6D6A65] hover:text-[#2D4A3E] text-sm"
            data-testid="profile-preview-close"
          >
            ✕
          </button>
        </div>
        <div className="p-5 sm:p-6">
          <article className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
            <div className="flex gap-4">
              <div className="w-14 h-14 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0">
                {t.profile_picture ? (
                  <img src={t.profile_picture} alt={t.name || "therapist"} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-serif-display text-base text-[#2D4A3E]">
                    {initials || "T"}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h3 className="font-serif-display text-xl text-[#2D4A3E] leading-tight truncate">
                    {t.name || "Your name"}
                  </h3>
                  <div className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0">
                    <Eye size={10} /> 87%
                  </div>
                </div>
                <div className="text-xs text-[#6D6A65] mt-0.5 break-words">
                  {t.credential_type && (
                    <span className="text-[#2B2A29] font-medium">
                      {credentialLabel(t.credential_type)}
                    </span>
                  )}
                  {t.credential_type && (t.years_experience || (t.modalities || []).length > 0) && " · "}
                  {t.years_experience
                    ? `${t.years_experience} year${t.years_experience === 1 ? "" : "s"} experience`
                    : !t.credential_type && "Experience: —"}{" "}
                  {(t.years_experience || t.credential_type) && (t.modalities || []).length > 0 && "• "}
                  {(t.modalities || []).slice(0, 3).join(" · ")}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-xs">
                  <PreviewKV label="Format" value={formatStr} />
                  <PreviewKV
                    label="Cash rate"
                    value={t.cash_rate ? `$${t.cash_rate} / session` : "—"}
                  />
                  <PreviewKV label="Sliding scale" value={t.sliding_scale ? "Yes" : "No"} />
                  <PreviewKV label="Free consult" value={t.free_consult ? "Yes" : "—"} />
                  {t.office_addresses && t.office_addresses.length > 0 && (
                    <PreviewKV
                      label="Office"
                      value={t.office_addresses[0]}
                      span={2}
                    />
                  )}
                  {t.website && (
                    <PreviewKV label="Website" value={t.website} span={2} />
                  )}
                  {(t.insurance_accepted || []).length > 0 && (
                    <PreviewKV
                      label="Insurance"
                      value={(t.insurance_accepted || []).slice(0, 4).join(", ")}
                      span={2}
                    />
                  )}
                  {(t.languages_spoken || []).length > 0 && (
                    <PreviewKV
                      label="Languages"
                      value={["English", ...(t.languages_spoken || [])].join(", ")}
                      span={2}
                    />
                  )}

                  {/* Specialties chips, color-coded by tier (primary /
                      secondary / general). Same color system patients see
                      in the matched-card chips. */}
                  {((t.primary_specialties || []).length > 0 ||
                    (t.secondary_specialties || []).length > 0 ||
                    (t.general_treats || []).length > 0) && (
                    <div className="col-span-2 sm:col-span-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
                        Specialties
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(t.primary_specialties || []).map((s) => (
                          <SpecialtyChip key={`p-${s}`} label={issueLabel(s)} tier="primary" />
                        ))}
                        {(t.secondary_specialties || []).map((s) => (
                          <SpecialtyChip key={`s-${s}`} label={issueLabel(s)} tier="secondary" />
                        ))}
                        {(t.general_treats || []).map((s) => (
                          <SpecialtyChip key={`g-${s}`} label={issueLabel(s)} tier="general" />
                        ))}
                      </div>
                    </div>
                  )}

                  {(t.client_types || []).length > 0 && (
                    <PreviewKV
                      label="Client types"
                      value={(t.client_types || []).map((x) => x.replace(/_/g, " ")).join(", ")}
                      span={2}
                    />
                  )}
                  {(t.age_groups || []).length > 0 && (
                    <PreviewKV
                      label="Age groups"
                      value={(t.age_groups || []).map((a) => a.replace(/_/g, " ")).join(", ")}
                      span={2}
                    />
                  )}
                  {t.gender && (
                    <PreviewKV
                      label="Gender"
                      value={t.gender}
                    />
                  )}
                  {t.urgency_capacity && (
                    <PreviewKV
                      label="Caseload"
                      value={t.urgency_capacity.replace(/_/g, " ")}
                    />
                  )}

                  {(t.style_tags || []).length > 0 && (
                    <div className="col-span-2 sm:col-span-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1.5">
                        Style
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(t.style_tags || []).map((s) => (
                          <span
                            key={s}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-[#F2EFE8] text-[#2D4A3E] font-medium"
                          >
                            {s.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(t.availability_windows || []).length > 0 && (
                    <PreviewKV
                      label="Availability"
                      value={(t.availability_windows || [])
                        .map((w) => w.replace(/_/g, " "))
                        .join(", ")}
                      span={2}
                    />
                  )}

                  {/* Show any office addresses BEYOND the first one
                      (first one is rendered above in the existing block). */}
                  {(t.office_addresses || []).length > 1 && (
                    <PreviewKV
                      label="Other offices"
                      value={(t.office_addresses || []).slice(1).join(" · ")}
                      span={2}
                    />
                  )}
                </div>
                {t.bio && (
                  <p className="mt-4 text-sm text-[#2B2A29] leading-relaxed border-l-2 border-[#C87965] pl-3">
                    {t.bio}
                  </p>
                )}
              </div>
            </div>
          </article>
          <div className="mt-5 text-xs text-[#6D6A65] leading-relaxed">
            <strong className="text-[#2D4A3E]">Tip:</strong> A 2–4 sentence bio,
            a friendly photo, and at least one office address dramatically
            improve your patient response rate.
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewKV({ label, value, span = 1 }) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
        {label}
      </div>
      <div className="font-medium text-[#2B2A29] break-words">{value || "—"}</div>
    </div>
  );
}

function SpecialtyChip({ label, tier }) {
  const cls =
    tier === "primary"
      ? "bg-[#2D4A3E]/12 text-[#2D4A3E] border border-[#2D4A3E]/35"
      : tier === "secondary"
      ? "bg-[#C87965]/10 text-[#8B4F3B]"
      : "bg-[#F2EFE8] text-[#6D6A65]";
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}
      data-testid={`specialty-chip-${tier}`}
    >
      {label} {tier !== "general" && `(${tier})`}
    </span>
  );
}


// LicenseDocUploader — therapist self-uploads a PDF/JPG of their license
// for admin verification. POSTs base64 to /api/therapists/me/license-document
// which flags the row pending_reapproval. Capped at 5 MB.
function LicenseDocUploader() {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);
  const client = sessionClient();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/therapists/me/license-document");
        if (alive) setMeta(r.data?.present ? r.data : null);
      } catch (e) {
        // 404 is the expected "no doc yet" path — only surface real failures.
        if (e?.response?.status >= 500 || e?.code === "ERR_NETWORK") {
          console.warn("license-document fetch failed:", e?.message);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("License file must be under 5 MB.");
      return;
    }
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      toast.error("Allowed: PDF, JPG, PNG, WEBP.");
      return;
    }
    setBusy(true);
    try {
      const data_base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await client.post("/therapists/me/license-document", {
        filename: file.name,
        content_type: file.type,
        data_base64,
      });
      setMeta({
        present: true,
        filename: r.data.filename,
        content_type: file.type,
        size_bytes: r.data.size_bytes,
        uploaded_at: r.data.uploaded_at,
      });
      toast.success("License uploaded — admin will review for re-approval.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div data-testid="license-doc-uploader">
      <div className="text-sm font-medium text-[#2D4A3E] flex items-center gap-2">
        <FileText size={14} /> License document
      </div>
      <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
        Upload a copy of your active license (PDF, JPG, or PNG, max 5 MB).
        We use this to verify your license number and expiration date.
        Uploads trigger a quick admin re-approval.
      </p>
      {meta?.present ? (
        <div
          className="mt-3 inline-flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-[#FDFBF7] border border-[#E8E5DF]"
          data-testid="license-doc-current"
        >
          <CheckCircle2 size={14} className="text-[#2D4A3E]" />
          <span className="text-[#2B2A29]">
            <strong>{meta.filename}</strong> ·{" "}
            {Math.round((meta.size_bytes || 0) / 1024)} KB · uploaded{" "}
            {meta.uploaded_at
              ? new Date(meta.uploaded_at).toLocaleDateString()
              : ""}
          </span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-[#B0382A]">
          No license document on file yet.
        </div>
      )}
      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="hidden"
          data-testid="license-doc-input"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-[#E8E5DF] hover:bg-[#FDFBF7] disabled:opacity-50"
          data-testid="license-doc-upload-btn"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Upload size={12} />
          )}
          {meta?.present ? "Replace document" : "Upload license"}
        </button>
      </div>
    </div>
  );
}

// PhotoUploader — accepts an image, downscales it client-side to fit
// within 600×600 (whichever side is bigger), encodes it as a JPEG
// data URL, and emits onChange(dataUrl). Avoids needing a separate
// upload endpoint while keeping the document lean (~80–150 KB per
// portrait).
function PhotoUploader({ value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (jpg/png).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Photo must be under 8 MB before resize.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
      });
      const max = 600;
      let { width, height } = img;
      if (width > max || height > max) {
        if (width >= height) {
          height = Math.round((height * max) / width);
          width = max;
        } else {
          width = Math.round((width * max) / height);
          height = max;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL("image/jpeg", 0.85);
      onChange(compressed);
      toast.success("Photo updated — don't forget to Save changes.");
    } catch (e) {
      toast.error(e?.message || "Could not process image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="w-24 h-24 rounded-full bg-[#F4EFE7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center text-[#6D6A65]">
        {value ? (
          <img
            src={value}
            alt="Profile"
            className="w-full h-full object-cover"
            data-testid="profile-photo-preview"
          />
        ) : (
          <span className="text-xs">No photo</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="hidden"
          data-testid="profile-photo-input"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="tv-btn-secondary !py-2 !px-4 text-sm disabled:opacity-50"
          data-testid="profile-photo-upload-btn"
        >
          {busy ? "Processing…" : value ? "Replace photo" : "Upload photo"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-[#D45D5D] hover:underline self-start"
            data-testid="profile-photo-remove-btn"
          >
            Remove photo
          </button>
        )}
        <p className="text-xs text-[#6D6A65]">
          Square crops look best. We resize to 600×600 max.
        </p>
      </div>
    </div>
  );
}
