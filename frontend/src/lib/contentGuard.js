/**
 * contentGuard.js
 *
 * Client-side heuristic scanner for patient free-text inputs.
 * Flags two categories:
 *
 *   1. **PHI (Protected Health Information)** — phone numbers, emails,
 *      addresses, SSNs, diagnoses/ICD codes, medication names, full names
 *      that look like "First Last" patterns. We don't block submission,
 *      but we warn the patient so they can remove it before proceeding.
 *
 *   2. **Inappropriate / off-topic content** — requests unrelated to
 *      therapy (e.g. "mow my lawn", "looking for a date"), profanity,
 *      or gibberish. Again, warn — don't block.
 *
 * The backend mirrors these checks (see `content_guard.py`) and tags
 * flagged requests for admin review.
 */

// ── PHI patterns ────────────────────────────────────────────────────────────

const PHI_RULES = [
  {
    id: "phone",
    label: "phone number",
    // US phone: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
    re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  },
  {
    id: "email",
    label: "email address",
    re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  },
  {
    id: "ssn",
    label: "social security number",
    re: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,
  },
  {
    id: "address",
    label: "street address",
    // "123 Main St", "456 Elm Avenue", "789 Oak Blvd Apt 2"
    re: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle)\b/i,
  },
  {
    id: "dob",
    label: "date of birth",
    // "DOB: ...", "born on ...", "birthday: ..."
    re: /\b(?:DOB|date\s+of\s+birth|born\s+on|birthday)\s*[:\s]\s*\d/i,
  },
  {
    id: "icd",
    label: "diagnosis code",
    // ICD-10 codes like F32.1, F41.0
    re: /\b[A-Z]\d{2}\.\d{1,2}\b/,
  },
  {
    id: "medication",
    label: "medication name",
    // Common psych medications — not exhaustive, but catches the big ones.
    re: /\b(?:Prozac|Zoloft|Lexapro|Wellbutrin|Effexor|Cymbalta|Paxil|Celexa|Buspar|Buspirone|Xanax|Klonopin|Ativan|Valium|Ambien|Seroquel|Abilify|Risperdal|Lamictal|Lithium|Adderall|Ritalin|Concerta|Vyvanse|Strattera|Trazodone|Remeron|Gabapentin|Lyrica|Naltrexone|Suboxone|Methadone)\b/i,
  },
];

// ── Inappropriate / off-topic patterns ──────────────────────────────────────

const INAPPROPRIATE_RULES = [
  {
    id: "offtopic_chores",
    label: "off-topic request",
    re: /\b(?:mow(?:ing)?\s+(?:my\s+)?lawn|do(?:ing)?\s+(?:my\s+)?dishes|clean(?:ing)?\s+(?:my\s+)?house|walk(?:ing)?\s+(?:my\s+)?dog|fix(?:ing)?\s+(?:my\s+)?car|cook(?:ing)?\s+(?:my\s+)?(?:food|dinner|meal))\b/i,
  },
  {
    id: "offtopic_dating",
    label: "off-topic request (dating/romantic)",
    re: /\b(?:looking\s+for\s+a\s+date|find\s+me\s+a\s+(?:date|girlfriend|boyfriend|partner|hookup)|want\s+to\s+date|tinder|bumble|hinge)\b/i,
  },
  {
    id: "offtopic_illegal",
    label: "potentially inappropriate request",
    re: /\b(?:buy\s+(?:me\s+)?(?:drugs|weed|pills)|sell\s+(?:me\s+)?(?:drugs|weed|pills)|get\s+(?:me\s+)?(?:drugs|weed|pills|high)|fake\s+(?:prescription|diagnosis|note))\b/i,
  },
];

/**
 * Scan a single text string for PHI and inappropriate content.
 *
 * @param {string} text  The free-text input to scan.
 * @returns {{ phi: Array<{id: string, label: string, match: string}>,
 *             inappropriate: Array<{id: string, label: string, match: string}> }}
 */
export function scanText(text) {
  if (!text || typeof text !== "string") return { phi: [], inappropriate: [] };

  const phi = [];
  for (const rule of PHI_RULES) {
    const m = text.match(rule.re);
    if (m) {
      phi.push({ id: rule.id, label: rule.label, match: m[0] });
    }
  }

  const inappropriate = [];
  for (const rule of INAPPROPRIATE_RULES) {
    const m = text.match(rule.re);
    if (m) {
      inappropriate.push({ id: rule.id, label: rule.label, match: m[0] });
    }
  }

  return { phi, inappropriate };
}

/**
 * Scan all free-text fields in the patient intake data object.
 *
 * @param {object} data  The full intake form state.
 * @returns {{ hasPhi: boolean, hasInappropriate: boolean,
 *             findings: Array<{field: string, ...finding}> }}
 */
export function scanIntakeData(data) {
  const TEXT_FIELDS = [
    { key: "other_issue", label: "Anything else" },
    { key: "session_expectations_notes", label: "Session expectations notes" },
    { key: "insurance_name_other", label: "Insurance (other)" },
    { key: "referral_source_other", label: "Referral source (other)" },
  ];

  const findings = [];
  for (const { key, label } of TEXT_FIELDS) {
    const val = (data[key] || "").trim();
    if (!val) continue;
    const result = scanText(val);
    for (const f of result.phi) {
      findings.push({ field: label, type: "phi", ...f });
    }
    for (const f of result.inappropriate) {
      findings.push({ field: label, type: "inappropriate", ...f });
    }
  }

  return {
    hasPhi: findings.some((f) => f.type === "phi"),
    hasInappropriate: findings.some((f) => f.type === "inappropriate"),
    findings,
  };
}

/**
 * Build a patient-friendly warning message from scan findings.
 * Returns null if no issues found.
 */
export function buildWarningMessage(findings) {
  if (!findings || findings.length === 0) return null;

  const phiFindings = findings.filter((f) => f.type === "phi");
  const inappropriateFindings = findings.filter((f) => f.type === "inappropriate");

  const parts = [];

  if (phiFindings.length > 0) {
    const labels = [...new Set(phiFindings.map((f) => f.label))];
    parts.push(
      `It looks like you may have included personal information (${labels.join(
        ", ",
      )}). For your privacy, we recommend removing it — therapists will contact you through our secure system.`,
    );
  }

  if (inappropriateFindings.length > 0) {
    parts.push(
      "Some of what you wrote doesn't seem related to finding a therapist. Please make sure your response is about your therapy needs.",
    );
  }

  return parts.join("\n\n");
}
