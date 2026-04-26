// Idaho-focused insurance list (forced dropdown for patients, multi-select for therapists)
export const IDAHO_INSURERS = [
  "Blue Cross of Idaho",
  "Regence BlueShield of Idaho",
  "Mountain Health Co-op",
  "PacificSource Health Plans",
  "SelectHealth",
  "Aetna",
  "Cigna",
  "UnitedHealthcare",
  "Humana",
  "Idaho Medicaid",
  "Medicare",
  "Tricare West",
  "Optum",
  "Magellan Health",
];

// "Other" is appended to patient dropdown only
export const PATIENT_INSURER_OPTIONS = [...IDAHO_INSURERS, "Other / not listed"];
