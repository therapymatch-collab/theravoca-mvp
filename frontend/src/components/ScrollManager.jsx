import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * ScrollManager — defeats the browser's scroll-restoration on every
 * route change. The only exception is when the URL contains a `#hash`,
 * in which case we let the existing per-page anchor effect handle it.
 *
 * Mounted inside the BrowserRouter so it gets the live `useLocation()`.
 * Fixes the bug where clicking the logo from /therapists/join navigated
 * to / but kept the previous scrollY (~3893px) so the user landed
 * mid-page on the intake form.
 */
export default function ScrollManager() {
  const { pathname, hash, key } = useLocation();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hash) return; // let anchor-jumps target their element
    // Use auto (instant) so the user doesn't see the page rocket from
    // 4000px → 0 — the new route hasn't painted yet at this moment so
    // an instant top is what the user perceives as "I'm at the top now".
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, key]);
  return null;
}
