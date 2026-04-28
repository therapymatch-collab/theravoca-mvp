import { ArrowRight } from "lucide-react";

/**
 * Inline CTA used at the bottom of each patient-facing landing-page
 * section so the visitor never has to scroll back up to find a "Get
 * matched" button. Keeps copy short + visually unobtrusive — the
 * button is the entire payload, no card or extra chrome.
 */
export default function GetMatchedCTA({ id, label = "Get matched today" }) {
  return (
    <div
      className="mt-12 flex justify-center"
      data-testid={id || "get-matched-cta"}
    >
      <a href="/#start" className="tv-btn-primary" data-testid={`${id || "get-matched"}-btn`}>
        {label} <ArrowRight size={16} className="ml-1.5 inline" />
      </a>
    </div>
  );
}
