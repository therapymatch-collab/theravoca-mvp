import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";

// EmailButton — opens a tiny popover with all the realistic ways a
// patient might want to send a message: the OS default mail app
// (mailto:), Gmail web compose, Outlook web compose, Yahoo web compose,
// and a "copy email address" fallback. We render the full menu on
// desktop (where mailto: silently fails for users without a default
// mail handler) and default to the mailto: link on mobile (where mail
// apps always handle it correctly).
//
// Props:
//   urls      — object with {mailto, gmail, outlook, yahoo} pre-built URLs
//   to        — the raw email address (for the Copy action)
//   children  — button label + icon
//   className — wrapper styling for the button
//   testId    — base testid; sub-elements append `-menu`, `-gmail`, etc.
export default function EmailButton({
  urls,
  to,
  children,
  className = "",
  testId,
  isMobile = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // On mobile, single-tap → native mail app. We still keep the chevron
  // visible for the rare user who wants Gmail-web on iPad.
  const onPrimaryClick = (e) => {
    if (isMobile) {
      // Let the <a> default action fire — mailto opens native mail.
      return;
    }
    e.preventDefault();
    setOpen((v) => !v);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(to || "");
      toast.success(`Copied ${to}`);
    } catch (_) {
      toast.error("Couldn't copy — please copy manually");
    }
    setOpen(false);
  };

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      data-testid={testId ? `${testId}-wrap` : undefined}
    >
      <a
        href={urls.mailto}
        onClick={onPrimaryClick}
        className={className}
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children}
        {!isMobile && (
          <ChevronDown
            size={12}
            className={`ml-0.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </a>
      {open && !isMobile && (
        <div
          role="menu"
          className="absolute z-30 top-full mt-1 left-0 min-w-[210px] bg-white border border-[#E8E5DF] rounded-xl shadow-lg overflow-hidden"
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          <a
            href={urls.gmail}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#3F3D3B] hover:bg-[#FDFBF7]"
            data-testid={testId ? `${testId}-gmail` : undefined}
          >
            <span aria-hidden="true">📨</span> Open in Gmail
          </a>
          <a
            href={urls.outlook}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#3F3D3B] hover:bg-[#FDFBF7]"
            data-testid={testId ? `${testId}-outlook` : undefined}
          >
            <span aria-hidden="true">📧</span> Open in Outlook
          </a>
          <a
            href={urls.yahoo}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#3F3D3B] hover:bg-[#FDFBF7]"
            data-testid={testId ? `${testId}-yahoo` : undefined}
          >
            <span aria-hidden="true">💌</span> Open in Yahoo Mail
          </a>
          <a
            href={urls.mailto}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#3F3D3B] hover:bg-[#FDFBF7] border-t border-[#E8E5DF]"
            data-testid={testId ? `${testId}-mailto` : undefined}
          >
            <span aria-hidden="true">💻</span> Open in my mail app
          </a>
          <button
            type="button"
            onClick={onCopy}
            className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-[#3F3D3B] hover:bg-[#FDFBF7] border-t border-[#E8E5DF]"
            data-testid={testId ? `${testId}-copy` : undefined}
          >
            <Copy size={13} className="text-[#6D6A65]" /> Copy email address
          </button>
        </div>
      )}
    </div>
  );
}
