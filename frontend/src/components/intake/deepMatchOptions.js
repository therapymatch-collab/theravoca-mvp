/**
 * intake/deepMatchOptions.js
 *
 * Single source of truth for the v2 P1/P2 option lists used by the
 * patient deep-match flow. Lives outside IntakeForm so the step
 * components, the Review modal, and any future analytics code all
 * import from one place — slugs are 1:1 with the matching engine
 * (matching.py) and the therapist T1/T3 questions.
 */

// P1 — "What kind of relationship do you want with your therapist?"
// Pick 2 of 6. Slugs map 1:1 to therapist T1 ranking.
export const P1_OPTIONS = [
  { v: "leads_structured", l: "Someone who leads with structure and direction" },
  { v: "follows_lead", l: "Someone who follows my lead and lets me set the pace" },
  { v: "challenges", l: "Someone who challenges me, even when it's uncomfortable" },
  { v: "warm_first", l: "Someone who's warm and encouraging above all" },
  { v: "direct_honest", l: "Someone who's direct and tells it like it is" },
  { v: "guides_questions", l: "Someone who asks the right questions so I get there myself" },
];

// P2 — "How do you want therapy to work?" Pick 2 of 6. Slugs map 1:1
// to therapist T3 picks.
export const P2_OPTIONS = [
  { v: "deep_emotional", l: "Go deep into emotions — feel what I've been avoiding" },
  { v: "practical_tools", l: "Stay practical — give me tools I can use this week" },
  { v: "explore_past", l: "Look back — understand where my patterns started" },
  { v: "focus_forward", l: "Look forward — focus on who I'm becoming" },
  { v: "build_insight", l: "Help me understand myself and why I do what I do" },
  { v: "shift_relationships", l: "Help me change how I show up in my relationships" },
];

// Helper used by the Review modal + receipt rendering.
export const labelForP1 = (slug) =>
  P1_OPTIONS.find((o) => o.v === slug)?.l || slug;
export const labelForP2 = (slug) =>
  P2_OPTIONS.find((o) => o.v === slug)?.l || slug;
