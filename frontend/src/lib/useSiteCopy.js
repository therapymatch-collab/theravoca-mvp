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

// In-memory cache survives same-tab navigation between React routes.
// localStorage cache survives reloads / new tabs / first-paint-of-day --
// without it every page load flashes the hardcoded React fallback for
// ~150-400ms while /api/site-copy is in flight, then snaps to whatever
// the admin edited in the Site Copy editor.
let _cache = null; // { fetched_at: number, map: {} }
const TTL_MS = 60_000;             // in-memory freshness
const LS_TTL_MS = 7 * 24 * 60 * 60_000; // localStorage cap: 7 days
const LS_KEY = "tv_site_copy_v1";
const _listeners = new Set();

function _readLocalCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.fetched_at !== "number" || typeof parsed.map !== "object") {
      return null;
    }
    if (Date.now() - parsed.fetched_at > LS_TTL_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _writeLocalCache(entry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(LS_KEY, JSON.stringify(entry));
  } catch (_) {
    /* quota / private mode -- ignore */
  }
}

// Hydrate the in-memory cache from localStorage at module load so the
// FIRST render of any useSiteCopy() consumer sees the last-known map
// instead of {} (which would force the fallback text to flash through).
(() => {
  const local = _readLocalCache();
  if (local) {
    // Mark as stale (fetched_at older than TTL_MS) so the first mount
    // still triggers a background refresh -- the local copy is just for
    // instant first-paint, not authoritative.
    _cache = { fetched_at: 0, map: local.map };
  }
})();

async function _refreshOverrides() {
  try {
    const r = await api.get("/site-copy");
    const entry = { fetched_at: Date.now(), map: r.data || {} };
    _cache = entry;
    _writeLocalCache(entry);
    _listeners.forEach((fn) => fn(_cache.map));
  } catch (_) {
    _cache = { fetched_at: Date.now(), map: _cache?.map || {} };
    // Don't overwrite localStorage on fetch failure -- keep the last
    // known-good map around for the next page load.
    _listeners.forEach((fn) => fn(_cache.map));
  }
}

export function bustSiteCopyCache() {
  _cache = null;
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(LS_KEY);
    }
  } catch (_) { /* ignore */ }
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
