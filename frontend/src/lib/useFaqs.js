/**
 * useFaqs — fetches FAQ items for the given audience ('patient' |
 * 'therapist') from the public /api/faqs endpoint. Falls back to the
 * supplied static seed list when the API call fails or returns empty
 * so we never render an empty FAQ section.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const _cache = {}; // { audience: { fetched_at, items } }
const TTL_MS = 60_000;

export default function useFaqs(audience, fallback = []) {
  const [items, setItems] = useState(
    _cache[audience]?.items || fallback,
  );

  useEffect(() => {
    let alive = true;
    const cached = _cache[audience];
    if (cached && Date.now() - cached.fetched_at < TTL_MS) {
      setItems(cached.items.length ? cached.items : fallback);
      return () => {
        alive = false;
      };
    }
    api
      .get(`/faqs?audience=${encodeURIComponent(audience)}`)
      .then((r) => {
        if (!alive) return;
        const list = r.data?.items || [];
        _cache[audience] = { fetched_at: Date.now(), items: list };
        setItems(list.length ? list : fallback);
      })
      .catch(() => {
        if (!alive) return;
        setItems(fallback);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  return items;
}

export function bustFaqsCache(audience) {
  if (audience) {
    delete _cache[audience];
  } else {
    Object.keys(_cache).forEach((k) => delete _cache[k]);
  }
}
