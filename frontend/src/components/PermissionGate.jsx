import { canDo, requiredRole } from "@/lib/admin-permissions";
import { Lock } from "lucide-react";

/**
 * Renders its children only when the current admin has permission for
 * `action`. When they don't, renders a disabled visual stub with a
 * hover tooltip explaining why ("Requires 'edit' role").
 *
 * Use this around any admin action button so the UI clearly signals
 * what the user can vs. can't do, without hiding capability entirely
 * (which leaves users wondering "where did that button go?").
 *
 * Two modes:
 *   - mode="disabled" (default) -- show greyed stub with lock icon
 *     and tooltip
 *   - mode="hide" -- render nothing when no permission. Use sparingly,
 *     only when the disabled visual would be more confusing than
 *     omission (e.g., a whole secondary nav item)
 *
 * Usage:
 *   <PermissionGate action="therapist.approve">
 *     <button onClick={...}>Approve</button>
 *   </PermissionGate>
 */
export default function PermissionGate({
  action,
  mode = "disabled",
  children,
  fallback = null,
  className = "",
}) {
  if (canDo(action)) return <>{children}</>;
  if (mode === "hide") return fallback;

  const required = requiredRole(action);
  return (
    <span
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F2EFE8] text-[#C8C4BB] text-xs font-medium cursor-not-allowed group ${className}`}
      data-testid={`permission-gate-${action}`}
      data-required-role={required}
      aria-disabled="true"
    >
      <Lock size={11} strokeWidth={2.2} />
      {/* Render the children's text content if it's a button/link with
          plain text, so the disabled stub still labels what's blocked.
          Falls back to the action name when children isn't a simple
          string. */}
      <span>{getButtonLabel(children) || action}</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-[#2B2A29] text-white text-[10px] font-normal whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
        Requires "{required}" role
      </span>
    </span>
  );
}

/**
 * Best-effort extraction of the button's label so the disabled stub
 * shows the same text as the original button. Handles common cases:
 * a button/link with a plain string child, or an element with text +
 * an icon. Returns null when it can't tell.
 */
function getButtonLabel(children) {
  if (!children) return null;
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const t = getButtonLabel(c);
      if (t) return t;
    }
    return null;
  }
  // React element -- look at its children prop.
  if (typeof children === "object" && children.props) {
    return getButtonLabel(children.props.children);
  }
  return null;
}
