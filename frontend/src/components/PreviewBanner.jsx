import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { clearSiteCopyPreview } from "@/lib/useSiteCopy";

/**
 * Tiny dismissible bar pinned to the bottom of the viewport when the
 * page is being viewed in Site Copy preview mode (i.e. the
 * `tv_copy_preview` sessionStorage key has overrides). Clicking
 * "Exit preview" clears the overrides and reloads the page.
 *
 * Mounted globally from App.js so every previewed page surfaces it.
 */
export default function PreviewBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("tv_copy_preview");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
          setActive(true);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }, []);

  if (!active) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#2D4A3E] text-white text-sm rounded-full pl-4 pr-2 py-2 shadow-lg flex items-center gap-3"
      data-testid="preview-banner"
    >
      <span>
        <strong>Preview mode</strong> — viewing unsaved Site Copy override
      </span>
      <button
        type="button"
        onClick={() => {
          clearSiteCopyPreview();
          window.location.reload();
        }}
        className="bg-white/15 hover:bg-white/25 rounded-full px-3 py-1 text-xs inline-flex items-center gap-1.5 transition"
        data-testid="preview-banner-exit"
      >
        <X size={12} /> Exit preview
      </button>
    </div>
  );
}
