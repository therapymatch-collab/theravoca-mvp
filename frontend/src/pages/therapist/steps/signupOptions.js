/**
 * Therapist signup wizard — option lists used by Steps 1-7.
 *
 * Single source of truth so per-step components don't duplicate the
 * arrays. Slugs (`v`) are 1:1 with the matching engine + the
 * therapist DB schema; keep them stable. Labels (`l`) are the only
 * thing safe to edit for copy tweaks.
 */

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

export const MODALITIES = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];

export const CREDENTIAL_TYPES = [
  { v: "psychologist", l: "Psychologist (PhD / PsyD)" },
  { v: "lcsw", l: "Licensed Clinical Social Worker (LCSW)" },
  { v: "lpc", l: "Licensed Professional Counselor (LPC / LCPC / LPCC)" },
  { v: "lmft", l: "Licensed Marriage & Family Therapist (LMFT)" },
  { v: "lmhc", l: "Licensed Mental Health Counselor (LMHC)" },
  { v: "psychiatrist", l: "Psychiatrist (MD)" },
  { v: "other", l: "Other" },
];

export const AVAILABILITY = [
  { v: "weekday_morning", l: "Weekday mornings" },
  { v: "weekday_afternoon", l: "Weekday afternoons" },
  { v: "weekday_evening", l: "Weekday evenings" },
  { v: "weekend_morning", l: "Weekend mornings" },
  { v: "weekend_afternoon", l: "Weekend afternoons" },
];

export const URGENCY_CAPACITIES = [
  { v: "asap", l: "ASAP — I can take new clients this week" },
  { v: "within_2_3_weeks", l: "Within 2–3 weeks" },
  { v: "within_month", l: "Within a month" },
  { v: "full", l: "Currently full" },
];

export const STYLE_TAGS = [
  { v: "structured", l: "Structured / skills-based" },
  { v: "warm_supportive", l: "Warm & supportive" },
  { v: "direct_practical", l: "Direct & practical" },
  { v: "trauma_informed", l: "Trauma-informed" },
  { v: "insight_oriented", l: "Insight-oriented" },
  { v: "faith_informed", l: "Faith-informed" },
  { v: "culturally_responsive", l: "Culturally responsive" },
  { v: "lgbtq_affirming", l: "LGBTQ+ affirming" },
];

export const MODALITY_OFFERINGS = [
  { v: "telehealth", l: "Telehealth only" },
  { v: "in_person", l: "In-person only" },
  { v: "both", l: "Both telehealth and in-person" },
];

export const GENDERS = [
  { v: "female", l: "Female" },
  { v