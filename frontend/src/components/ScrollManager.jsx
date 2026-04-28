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
    // The browser may try to restore a cached scroll position once the
    // new route's content makes the page tall enough. To beat that, we
    // force scroll(0,0) across THREE frames: synchronous, next paint,
    // and 60ms post-paint. This covers React's render commit, the
    // browser's scroll-restore window, and any lazy section that grows
    // the document after first paint.
    const jump = () => {
      window.scrollTo(0, 0);
      // Some browsers honour `documentElement.scrollTop` instead.
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    jump();
    const r1 = requestAnimationFrame(() => {
      jump();
      requestAnimationFrame(jump);
    });
    const t1 = setTimeout(jump, 60);
    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, key]);
  return null;
}
