/**
 * Normalises a `credential_type` string to a friendly, patient-facing
 * label. The DB stores values from the signup dropdown which sometimes
 * include the abbreviation in parentheses (e.g. "Licensed Clinical
 * Social Worker (LCSW)") and sometimes only the abbreviation (legacy
 * imports — "LCSW", "PhD", etc.).
 *
 * Patients respond better to the spelled-out title than to letters,
 * so this helper:
 *   1. Strips any "(ABBR)" parenthetical
 *   2. Maps bare abbreviations → spelled-out titles
 *   3. Falls back to the input unchanged if nothing matches
 *
 * Used in every therapist-profile-card subtitle so the patient and
 * the therapist see the same friendly label.
 */
const ABBR_TO_TITLE = {
  PHD: "Psychologist",
  PSYD: "Psychologist",
  MD: "Psychiatrist",
  DO: "Psychiatrist",
  LCSW: "Social Worker",
  LMSW: "Social Worker",
  LICSW: "Social Worker",
  LPC: "Professional Counselor",
  LCPC: "Professional Counselor",
  LPCC: "Professional Counselor",
  LMFT: "Marriage & Family Therapist",
  LMHC: "Mental Health Counselor",
  LP: "Psychologist",
  LCMHC: "Mental Health Counselor",
};

// Map full lowercased title text → friendlier short form. Preserves
// the meaning while dropping the "Licensed " prefix that adds visual
// noise on a 2-line card subtitle.
const TITLE_REWRITES = [
  [/^psychologist.*/i, "Psychologist"],
  [/^psychiatrist.*/i, "Psychiatrist"],
  [/licensed clinical social worker.*/i, "Social Worker"],
  [/licensed master social worker.*/i, "Social Worker"],
  [/licensed independent clinical social worker.*/i, "Social Worker"],
  [/social worker.*/i, "Social Worker"],
  [/licensed professional clinical counselor.*/i, "Professional Counselor"],
  [/licensed professional counselor.*/i, "Professional Counselor"],
  [/licensed clinical professional counselor.*/i, "Professional Counselor"],
  [/licensed marriage (?:and|&) family therapist.*/i, "Marriage & Family Therapist"],
  [/marriage (?:and|&) family therapist.*/i, "Marriage & Family Therapist"],
  [/licensed mental health counselor.*/i, "Mental Health Counselor"],
  [/mental health counselor.*/i, "Mental Health Counselor"],
];

export function credentialLabel(credentialType) {
  if (!credentialType || typeof credentialType !== "string") return "";
  // Strip any "(ABBR)" trailing block so "Licensed Clinical Social
  // Worker (LCSW)" → "Licensed Clinical Social Worker".
  const cleaned = credentialType.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Bare abbreviation case (legacy DB rows).
  const upper = cleaned.replace(/[^A-Z]/gi, "").toUpperCase();
  if (cleaned.length <= 6 && ABBR_TO_TITLE[upper]) {
    return ABBR_TO_TITLE[upper];
  }
  // Title rewrites (preferred — patient-friendly short forms).
  for (const [re, label] of TITLE_REWRITES) {
    if (re.test(cleaned)) return label;
  }
  return cleaned;
}

export default credentialLabel;
