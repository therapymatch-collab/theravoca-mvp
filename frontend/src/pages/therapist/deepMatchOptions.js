/**
 * therapist/deepMatchOptions.js
 *
 * Single source of truth for the v5 T4/T6 option lists used by:
 *   - therapist signup form (step 8 "Style fit")
 *   - therapist self-edit profile (deep-match section)
 *   - signup preview modal
 *   - any future analytics/admin debug views
 *
 * Slugs are 1:1 with the matching engine (`backend/matching.py`) and
 * the patient expectation questions. Wording is therapist-facing.
 *
 * NOTE: T1 (drag-rank) and T3 (pick-2 breakthrough) were deprecated
 * in v5 — their signal is now captured by T6/T6b (session expectations).
 * The backend still reads legacy T1/T3 data for backfilled therapists
 * and derives T1/T3 approximations from T6 for new therapists.
 */

export const T4_OPTIONS = [
  { v: "direct", l: "Head-on — I name it directly and trust the alliance" },
  { v: "incremental", l: "Incrementally — I build toward it across sessions" },
  { v: "questions", l: "Through questions — I let them bump into it themselves" },
  { v: "emotional", l: "Through emotion — I use what's alive in the room" },
  { v: "wait", l: "I wait for the right moment, then gently name it" },
];

// T6 — "What do sessions 1-3 typically look like with you?"
// Slugs match patient EXPECTATION_OPTIONS 1:1. Scoring = overlap.
// This is the #1 ranking signal in the matching engine.
export const T6_OPTIONS = [
  { v: "guide_direct",     l: "I tend to guide sessions and offer direction early" },
  { v: "listen_heard",     l: "I focus on listening and understanding before offering input" },
  { v: "tools_fast",       l: "I introduce tools/strategies early" },
  { v: "explore_patterns", l: "I move at a slower, exploratory pace" },
  { v: "depends",          l: "It depends on the patient" },
];
