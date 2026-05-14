/**
 * Frontend permission helper for the view / edit / admin role tiers.
 *
 * Mirrors the backend role hierarchy in deps.py (ADMIN_ROLES tuple +
 * require_role factory). The backend is the source of truth -- this
 * file just makes the UX nicer by hiding/disabling buttons the
 * current user can't actually use. Even if this map is wrong or
 * out-of-date, the backend rejects the call with 403, so wrong
 * frontend gates are a UX problem not a security problem.
 *
 * To change what a tier can do: edit the backend annotations
 * (require_role on the route) and mirror it here.
 */

import { getAdminIdentity } from "@/lib/api";

const ROLE_LEVEL = { view: 1, edit: 2, admin: 3 };

/**
 * Returns the current admin's role tier ("view" | "edit" | "admin")
 * or null if not signed in as admin. Master-password sessions and
 * tokens issued before role-tiering get treated as "admin" (backward
 * compat -- mirrors the backend).
 */
export function currentAdminRole() {
  const id = getAdminIdentity();
  if (!id?.token && !id?.masterPwd) return null;
  return id.adminRole || "admin";
}

/**
 * Compare current role against a minimum required tier.
 * `roleAtLeast("edit")` returns true for "edit" or "admin".
 */
export function roleAtLeast(min) {
  const cur = ROLE_LEVEL[currentAdminRole()] || 0;
  const need = ROLE_LEVEL[min] || 0;
  return need > 0 && cur >= need;
}

/**
 * Action -> minimum-role map. Each action key maps to one of
 * "view" | "edit" | "admin". Keep this in sync with the backend
 * `require_role` annotations.
 *
 * Naming: `domain.verb` so it's easy to scan ("therapist.approve"
 * vs "team.invite").
 */
const ACTION_ROLE_MAP = {
  // Read-only actions (any signed-in admin can do these)
  "outcomes.view": "view",
  "audit.view": "view",
  "team.view": "view",
  "requests.view": "view",
  "therapists.view": "view",

  // Day-to-day writes (edit + admin)
  "therapist.approve": "edit",
  "therapist.reject": "edit",
  "therapist.edit": "edit",
  "therapist.fire_test_survey": "edit",
  "request.cancel": "edit",
  "request.trigger_results": "edit",
  "request.resend_notifications": "edit",
  "request.update_threshold": "edit",
  "content.edit": "edit",
  "blog.edit": "edit",
  "faq.edit": "edit",
  "site_copy.edit": "edit",
  "email_template.edit": "edit",
  "outcomes.export": "edit",

  // Admin-only (sensitive ops)
  "team.invite": "admin",
  "team.set_role": "admin",
  "team.reset_password": "admin",
  "team.deactivate": "admin",
  "go_live.toggle": "admin",
  "go_live.wipe_test_data": "admin",
  "go_live.strip_emails": "admin",
  "go_live.restore_emails": "admin",
  "track_b.toggle": "admin",
  "rate_limit.set": "admin",
  "claim_campaign.send": "admin",
  "auto_recruit.run": "admin",
  "recruit_drafts.send": "admin",
  "test.send_sms": "admin",
  "test.send_email": "admin",
  "test.run_cron": "admin",
  "backfill.run": "admin",
  "stripe.manual_subscription": "admin",
  "stripe.cancel_subscription": "admin",
  "export.dump": "admin",
};

/**
 * Returns true if the current admin can perform the given action.
 * Returns false (not throws) for unknown actions -- safer default
 * is "no permission" so a typo'd action key doesn't accidentally
 * grant access.
 */
export function canDo(action) {
  const required = ACTION_ROLE_MAP[action];
  if (!required) {
    // Unknown action -- assume admin-only. Logs once so we can spot
    // missing entries during development.
    if (typeof console !== "undefined" && !canDo._warned?.has?.(action)) {
      // Avoid noisy double-logging by keeping a small Set of warnings.
      canDo._warned = canDo._warned || new Set();
      canDo._warned.add(action);
      console.warn(`[admin-permissions] Unknown action "${action}" -- defaulting to admin-only.`);
    }
    return roleAtLeast("admin");
  }
  return roleAtLeast(required);
}

/**
 * Returns the minimum role required for an action, useful for
 * tooltips ("Requires 'edit' role"). Falls back to "admin" for
 * unknown actions.
 */
export function requiredRole(action) {
  return ACTION_ROLE_MAP[action] || "admin";
}
