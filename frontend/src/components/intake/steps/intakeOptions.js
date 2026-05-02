/**
 * Patient intake wizard — option lists used by the per-step
 * components in this directory.
 *
 * Single source of truth so step files don't duplicate the arrays.
 * Slugs (`v`) are 1:1 with the matching engine + the patient DB
 * schema; keep them stable. Labels (`l`) are the only thing safe to
 * edit for copy tweaks.
 */

export const COVERED_STATES = new Set(["ID"]);

export const US_STATES = [
  { v: "AL", l: "Alabama" }, { v: "AK", l: "Alaska" }, { v: "AZ", l: "Arizona" },
  { v: "AR", l: "Arkansas" }, { v: "CA", l: "California" }, { v: "CO", l: "Colorado" },
  { v: "CT", l: "Connecticut" }, { v: "DE", l: "Delaware" }, { v: "FL", l: "Florida" },
  { v: "GA", l: "Georgia" }, { v: "HI", l: "Hawaii" }, { v: "ID", l: "Idaho" },
  { v: "IL", l: "Illinois" }, { v: "IN", l: "Indiana" }, { v: "IA", l: "Iowa" },
  { v: "KS", l: "Kansas" }, { v: "KY", l: "Kentucky" }, { v: "LA", l: "Louisiana" },
  { v: "ME", l: "Maine" }, { v: "MD", l: "Maryland" }, { v: "MA", l: "Massachusetts" },
  { v: "MI", l: "Michigan" }, { v: "MN", l: "Minnesota" }, { v: "MS", l: "Mississippi" },
  { v: "MO", l: "Missouri" }, { v: "MT", l: "Montana" }, { v: "NE", l: "Nebraska" },
  { v: "NV", l: "Nevada" }, { v: "NH", l: "New Hampshire" }, { v: "NJ", l: "New Jersey" },
  { v: "NM", l: "New Mexico" }, { v: "NY", l: "New York" }, { v: "NC", l: "North Carolina" },
  { v: "ND", l: "North Dakota" }, { v: "OH", l: "Ohio" }, { v: "OK", l: "Oklahoma" },
  { v: "OR", l: "Oregon" }, { v: "PA", l: "Pennsylvania" }, { v: "RI", l: "Rhode Island" },
  { v: "SC", l: "South Carolina" }, { v: "SD", l: "South Dakota" }, { v: "TN", l: "Tennessee" },
  { v: "TX", l: "Texas" }, { v: "UT", l: "Utah" }, { v: "VT", l: "Vermont" },
  { v: "VA", l: "Virginia" }, { v: "WA", l: "Washington" }, { v: "WV", l: "West Virginia" },
  { v: "WI", l: "Wisconsin" }, { v: "WY", l: "Wyoming" }, { v: "DC", l: "Washington D.C." },
];

export const CLIENT_TYPES = [
  { v: "individual", l: "Individual" },
  { v: "couples", l: "Couples" },
  { v: "family", l: "Family" },
  { v: "group", l: "Group" },
];

export const AGE_GROUPS = [
  { v: "child", l: "Child (under 13)" },
  { v: "teen", l: "Teen (13–17)" },
  { v: "young_adult", l: "Young adult (18–25)" },
  { v: "adult", l: "Adult (26–64)" },
  { v: "older_adult", l: "Older adult (65+)" },
];

export const ISSUES = [
  { v: "anxiety", l: "Anxiety" },
  { v: "depression", l: "Depression" },
  { v: "ocd", l: "OCD" },
  { v: "adhd", l: "ADHD" },
  { v: "trauma_ptsd", l: "Trauma / PTSD" },
  { v: "relationship_issues", l: "Relationship issues" },
  { v: "life_transitions", l: "Life transitions" },
  { v: "parenting_family", l: "Parenting / family conflict" },
  { v: "substance_use", l: "Substance use" },
  { v: "eating_concerns", l: "Eating concerns" },
  { v: "autism_neurodivergence", l: "Autism / neurodivergence" },
  { v: "school_academic_stress", l: "School / academic stress" },
  { v: "personality_concerns", l: "Personality concerns" },
  { v: "anger_emotional_regulation", l: "Anger / emotional regulation" },
  { v: "psychosis_reality_testing", l: "Psychosis / reality testing" },
  { v: "self_harm_safety", l: "Self-harm / safety concerns" },
  { v: "grief_loss", l: "Grief / loss" },
  { v: "bipolar_mood_instability", l: "Bipolar / mood instability" },
];

export const MODALITY = [
  { v: "telehealth_only", l: "Telehealth only" },
  { v: "in_person_only", l: "In-person only" },
  { v: "hybrid", l: "Hybrid / either" },
  { v: "prefer_inperson", l: "Prefer in-person, open to telehealth" },
  { v: "prefer_telehealth", l: "Prefer telehealth, open to in-person" },
];

export const PAYMENT = [
  { v: "insurance", l: "Insurance" },
  { v: "cash", l: "Cash / private pay" },
  { v: "either", l: "Either" },
];

export const AVAILABILITY = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
  { v: "flexible", l: "Flexible" },
];

export const URGENCY = [
  { v: "asap", l: "ASAP / this week" },
  { v: "within_2_3_weeks", l: "Within 2–3 weeks" },
  { v: "within_month", l: "Within a month" },
  { v: "flexible", l: "Flexible / just exploring" },
];

export const PRIOR_THERAPY = [
  { v: "no", l: "No, this is the first time" },
  { v: "yes_helped", l: "Yes, and it helped" },
  { v: "yes_not_helped", l: "Yes, but it didn't help" },
  { v: "not_sure", l: "Not sure" },
];

export const EXPERIENCE = [
  { v: "no_pref", l: "No preference" },
  { v: "0-3", l: "0–3 years" },
  { v: "3-7", l: "3–7 years" },
  { v: "7-15", l: "7–15 years" },
  { v: "15+", l: "15+ years" },
];

export const GENDERS = [
  { v: "no_pref", l: "No preference" },
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "nonbinary", l: "Nonbinary" },
];

export const STYLES = [
  { v: "structured", l: "Structured / skills-based" },
  { v: "warm_supportive", l: "Warm and supportive" },
  { v: "direct_practical", l: "Direct and practical" },
  { v: "trauma_informed", l: "Trauma-informed" },
  { v: "insight_oriented", l: "Insight-oriented" },
  { v: "faith_informed", l: "Faith-informed" },
  { v: "culturally_responsive", l: "Culturally responsive" },
  { v: "lgbtq_affirming", l: "LGBTQ+ affirming" },
];

export const MODALITY_PREFS = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];

// ── Expectation alignment ─────────────────────────────────────────────
// Patient: "What do you want the first few sessions to feel like?"
// Pick up to 2. Slugs are 1:1 with therapist T6 options (same concept,
// therapist-worded). Scoring = overlap. This is the #1 ranking signal.
export const EXPECTATION_OPTIONS = [
  { v: "guide_direct",     l: "I want the therapist to guide and give direction" },
  { v: "listen_heard",     l: "I want space to talk and be heard" },
  { v: "tools_fast",       l: "I want practical tools or strategies quickly" },
  { v: "explore_patterns", l: "I want to explore and understand patterns over time" },
  { v: "not_sure",         l: "I'm not sure yet" },
];

// Soft axes only — the "always hard" ones (state, type of therapy,
// main concern, age group) and the patient-toggleable hards
// (insurance, availability, urgency, gender, format/distance) are
// enforced earlier in the form. Priority factors here let the patient
// nudge ranking on the remaining SOFT