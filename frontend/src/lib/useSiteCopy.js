/**
 * useSiteCopy — pulls the live `site_copy` map from the backend (cached
 * for 60s so we don't hammer the API on every render), and returns a
 * resolver that swaps in any admin-edited override for a given key,
 * falling back to the literal default text passed in.
 *
 * Usage:
 *   const t = useSiteCopy();
 *   <h1>{t("landing.hero.headline", "Find the right therapist")}</h1>
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Seed the cache from the server-injected site_copy (avoids FOUC).
// _start.py injects <script>window.__SITE_COPY__={...}</script> into
// index.html so the overrides are available synchronously on first render.
const _serverInjected =
  typeof window !== "undefined" && window.__SITE_COPY__
    ? window.__SITE_COPY__
    : null;
let _cache = _serverInjected
  ? { fetched_at: Date.now(), map: _serverInjected }
  : null;
const TTL_MS = 60_000;
const _listeners = new Set();

async function _refreshOverrides() {
  try {
    const r = await api.get("/site-copy");
    _cache = { fetched_at: Date.now(), map: r.data || {} };
    _listeners.forEach((fn) => fn(_cache.map));
  } catch (_) {
    _cache = { fetched_at: Date.now(), map: {} };
    _listeners.forEach((fn) => fn(_cache.map));
  }
}

export function bustSiteCopyCache() {
  _cache = null;
  _refreshOverrides();
}

// Exit preview mode — clears the persisted ?preview= overrides so the
// site re-renders with the saved/fallback copy. Used by the floating
// "Exit preview" banner.
export function clearSiteCopyPreview() {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("tv_copy_preview");
    } catch (_) {
      /* ignore */
    }
  }
  // Force a refresh by busting the cache.
  bustSiteCopyCache();
}

export default function useSiteCopy() {
  const [map, setMap] = useState(_cache?.map || {});
  // Preview overrides: when ?preview=base64-of-{k:v} is in the URL OR
  // a previous tab from the Site Copy editor pinned overrides into
  // sessionStorage, those values override the saved map for this
  // browsing session. sessionStorage carries the override across
  // anchor-jumps and internal nav links inside the previewed page.
  const previewOverrides = (() => {
    if (typeof window === "undefined") return {};
    let merged = {};
    // (1) Start from sessionStorage (set by a previous mount when the
    // ?preview= URL was present).
    try {
      const raw = sessionStorage.getItem("tv_copy_preview");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") merged = { ...parsed };
      }
    } catch (_) {
      /* sessionStorage may be disabled */
    }
    // (2) Layer the URL ?preview= payload on top so the latest tab
    // open from admin still wins.
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p) {
      try {
        const decoded = JSON.parse(atob(decodeURIComponent(p)));
        if (decoded && typeof decoded === "object") {
          merged = { ...merged, ...decoded };
          // Persist so anchor jumps and internal nav inside the
          // previewed page keep showing the override.
          try {
            sessionStorage.setItem("tv_copy_preview", JSON.stringify(merged));
          } catch (_) {
            /* ignore */
          }
        }
      } catch (_) {
        /* ignore malformed preview payloads */
      }
    }
    return merged;
  })();

  useEffect(() => {
    const onChange = (m) => setMap(m);
    _listeners.add(onChange);
    if (!_cache || Date.now() - _cache.fetched_at > TTL_MS) {
      _refreshOverrides();
    } else {
      setMap(_cache.map);
    }
    return () => {
      _listeners.delete(onChange);
    };
  }, []);

  return (key, fallback) => {
    if (key in previewOverrides) {
      const pv = previewOverrides[key];
      // Preview-mode honors the value verbatim (including "") so admins
      // can preview a "hidden / blanked" element before saving.
      if (typeof pv === "string") return pv;
    }
    // When the admin has explicitly saved a value for this key — even an
    // empty string — honor it. An empty override means "hide this text on
    // the public site" (used by the "Hide on site" button in the editor).
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      const v = map[key];
      if (typeof v === "string") return v;
    }
    return fallback;
  };
}
