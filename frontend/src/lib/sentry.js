/**
 * Sentry init for the TheraVoca React frontend.
 *
 * Reads REACT_APP_SENTRY_DSN at build time (CRA inlines REACT_APP_*
 * env vars). If unset, Sentry is silently disabled so local dev /
 * unconfigured deploys don't try to phone home.
 *
 * PII scrubbing: a `beforeSend` hook walks the outgoing event and
 * strips email-like, phone-like, and 6-digit OTP-like substrings from
 * error messages, breadcrumb messages, and request URLs. Mirrors the
 * backend's _sentry_before_send so reports from both stacks have the
 * same hygiene. `sendDefaultPii: false` ALSO prevents Sentry from
 * auto-attaching cookies or IP addresses.
 */
import * as Sentry from "@sentry/react";

const DSN = process.env.REACT_APP_SENTRY_DSN || "";
const ENV =
  process.env.REACT_APP_ENV
  || (typeof window !== "undefined" && window.location.hostname.includes("localhost")
    ? "development"
    : "production");
const RELEASE = process.env.REACT_APP_SENTRY_RELEASE || undefined;

// Pattern set wide enough to catch the obvious shapes without being
// expensive. Kept in sync with backend/server.py PII regexes.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// OTP: 6 digits not surrounded by other digits.
const OTP_RE = /(?<!\d)\d{6}(?!\d)/g;

function scrubString(s) {
  if (typeof s !== "string" || !s) return s;
  return s
    .replace(EMAIL_RE, "<email>")
    .replace(PHONE_RE, "<phone>")
    .replace(OTP_RE, "<otp>");
}

function scrubObject(obj, depth = 0) {
  if (depth > 6) return obj;
  if (typeof obj === "string") return scrubString(obj);
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) {
      out[k] = scrubObject(obj[k], depth + 1);
    }
    return out;
  }
  return obj;
}

export function initSentry() {
  if (!DSN) {
    // Silent no-op so unconfigured builds don't log noise.
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENV,
      release: RELEASE,
      sendDefaultPii: false,
      // Errors only by default in prod; sample traces lightly.
      tracesSampleRate: ENV === "production" ? 0.1 : 1.0,
      // Drop noisy browser-extension / network errors that aren't
      // actionable from our side.
      ignoreErrors: [
        // Chunk-load errors after a deploy (the user is on an old
        // bundle; reloading fixes it; not our bug).
        /Loading chunk \d+ failed/i,
        /ChunkLoadError/i,
        // Cross-origin script errors with no detail.
        /^Script error\.?$/i,
        // ResizeObserver loop -- benign Chrome quirk.
        /ResizeObserver loop limit exceeded/i,
        /ResizeObserver loop completed/i,
      ],
      beforeSend(event) {
        try {
          return scrubObject(event);
        } catch (_e) {
          // If scrubbing fails, drop the event entirely rather than
          // leak the unscrubbed version. Safer default.
          return null;
        }
      },
      beforeBreadcrumb(breadcrumb) {
        try {
          return scrubObject(breadcrumb);
        } catch (_e) {
          return null;
        }
      },
    });
  } catch (e) {
    // Init failure is never fatal to the app.
    // eslint-disable-next-line no-console
    console.warn("[TheraVoca] Sentry init failed:", e?.message || e);
  }
}
