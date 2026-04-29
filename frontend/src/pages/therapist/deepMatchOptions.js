/**
 * therapist/deepMatchOptions.js
 *
 * Single source of truth for the v2 T1/T3/T4 option lists used by:
 *   - therapist signup form (step 8 "Style fit")
 *   - therapist self-edit profile (deep-match section)
 *   - any future analytics/admin debug views
 *
 * Slugs are 1:1 with the matching engine (`backend/matching.py`) and
 * the patient P1/P2 questions (where applicable). Wording is
 * therapist-facing.
 */

export const T1_OPTIONS = [
  { v: "leads_structured", l: "I lead with structure and a clear plan" },
  { v: "follows_lead", l: "I follow the client's lead" },
  { v: "challenges", l: "I challenge patterns, even when it creates tension" },
  { v: "warm_first", l: "I prioritize warmth and safety first" },
  { v: "direct_honest", l: "I'm direct — I name what I see" },
  { v: "guides_questions", l: "I guide through questions, letting them arrive at insight" },
];

export const T3_OPTIONS = [
  { v: "deep_emotional", l: "Deep emotional processing — the client lets themselves feel" },
  { v: "practical_tools", l: "Practical skill-building — the client applies tools between sessions" },
  { v: "explore_past", l: "Exploring the past — understanding the origin of patterns" },
  { v: "focus_forward", l: "Present and future-focused — what's happening now and next" },
  { v: "build_insight", l: "Building insight — the client finally sees their patterns" },
  { v: "shift_relationships", l: "Relational shift — the client's key relationships change" },
];

export const T4_OPTIONS = [
  { v: "direct", l: "Head-on — I name it directly and trust the alliance" },
  { v: "incremental", l: "Incrementally — I build toward it across sessions" },
  { v: "questions", l: "Through questions — I let them bump into it themselves" },
  { v: "emotional", l: "Through emotion — I use what's alive in the room" },
  { v: "wait", l: "I wait for the right moment, then gently name it" },
];

// Default rank order used to seed both signup and edit-profile state
// when a therapist hasn't ranked T1 yet.
export const DEFAULT_T1_ORDER = T1_OPTIONS.map((o) => o.v);
