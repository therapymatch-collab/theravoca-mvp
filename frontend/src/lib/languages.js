// Shared list of additional-languages options used by both the patient
// intake (preferred language picker) and the therapist signup
// (languages-spoken multi-select). Kept short and Idaho-relevant so the
// dropdown stays manageable. "Other" lets the therapist type a free
// language that's not in the canonical list.
export const ADDITIONAL_LANGUAGES = [
  "Spanish",
  "Mandarin",
  "Korean",
  "Vietnamese",
  "Arabic",
  "Russian",
  "Tagalog",
  "ASL",
  "Other",
];

// Patient picker shows English as the default option at the top, then
// the additional-language list. Therapists only pick from the
// additional list (English is implicit for everyone licensed in the US).
export const PATIENT_LANGUAGE_OPTIONS = ["English", ...ADDITIONAL_LANGUAGES];
