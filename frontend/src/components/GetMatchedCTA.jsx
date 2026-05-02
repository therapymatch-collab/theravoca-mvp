import { ArrowRight } from "lucide-react";
import useSiteCopy from "@/lib/useSiteCopy";

/**
 * Inline CTA used at the bottom of each patient-facing landing-page
 * section so the visitor never has to scroll back up to find a "Get
 * matched" button. Each instance has its own site-copy key so the
 * admin can customise them independently.
 */
export default function GetMatchedCTA({ id, label, copyKey = "cta.default" }) {
  const t = useSiteCopy();
  const text = label || t(copyKey, "Get matched today");
  return (
    <div
      className="mt-12 flex justify-center"
      data-testid={id || "get-matched-cta"}
    >
      <a href="/#start" className="tv-btn-primary" data-testid={`${id || "get-matched"}-btn`}>
        {text} <ArrowRight size={16} className="ml-1.5 inline" />
      </a>
    </div>
  );
}
