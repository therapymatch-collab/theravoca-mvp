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
    const v = map[key];
    return typeof v === "string" && v.length > 0 ? v : fallback;
  };
}
