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

let _cache = null; // { fetched_at: number, map: {} }
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

export default function useSiteCopy() {
  const [map, setMap] = useState(_cache?.map || {});
  // Preview overrides: when ?preview=base64-of-{k:v} is in the URL, those
  // values override the saved map for the current page load only — used
  // by the admin Site Copy panel's "Preview on landing" button.
  const previewOverrides = (() => {
    if (typeof window === "undefined") return {};
    const p = new URLSearchParams(window.location.search).get("preview");
    if (!p) return {};
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(p)));
      if (decoded && typeof decoded === "object") return decoded;
    } catch (_) {
      /* ignore malformed preview payloads */
    }
    return {};
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
      if (typeof pv === "string" && pv.length > 0) return pv;
    }
    const v = map[key];
    return typeof v === "string" && v.length > 0 ? v : fallback;
  };
}
