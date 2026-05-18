/**
 * ResearchCallout -- small "Why we ask" tip box that sits at the top
 * of therapist-signup steps 3-8. Frames each step's questions as
 * "honest input = better matches for you" with a peer-reviewed
 * citation so the case is grounded, not aspirational marketing copy.
 *
 * 2026-05-18 (Josh): "add help text on each step, not each field, to
 * motivate therapists to enter real, thoughtful, detailed
 * information... add research support and empirically validated
 * snippets from studies to support why we're asking for this info
 * and how it impacts matching and therapy retention and outcomes."
 *
 * Mockup approved at frontend/public/therapist-signup-research-
 * callouts.html before this shipped.
 */
export default function ResearchCallout({ children, citation }) {
  return (
    <div
      className="bg-gradient-to-br from-[#FBE9E5] to-[#F8DAD3] border-l-2 border-[#C87965] rounded-xl px-4 py-3 text-sm leading-relaxed mb-5"
      data-testid="research-callout"
    >
      <p className="text-[#2B2A29]">
        <strong className="text-[#8B3220]">Why we ask:</strong> {children}
      </p>
      {citation && (
        <p className="text-xs italic text-[#8B5A1F] mt-2">
          Source: {citation}
        </p>
      )}
    </div>
  );
}
