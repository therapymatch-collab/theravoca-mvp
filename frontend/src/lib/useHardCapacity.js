import { useEffect, useState } from "react";
import { api } from "./api";

// Patient-intake capacity fetch.  The backend `/api/config/hard-capacity`
// returns three tiers per axis:
//   disabled  -- count == 0, greyed out + unclickable
//   warned    -- 0 < count < MIN_REQUIRED, selectable with soft warning
//   (normal)  -- count >= MIN_REQUIRED, no flags
//
// Consumers receive helpers for both tiers plus the raw capacity object.
const CACHE_KEY = "tv_capacity_v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function _readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed._ts || 0) > CACHE_MAX_AGE_MS) return null;
    return parsed.data || null;
  } catch (_) {
    return null;
  }
}

function _writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, _ts: Date.now() }));
  } catch (_) {
    // Quota exceeded or private mode -- ignore.
  }
}

export default function useHardCapacity() {
  const [capacity, setCapacity] = useState(() => _readCache());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/config/hard-capacity");
        const fresh = r.data || null;
        if (alive) setCapacity(fresh);
        if (fresh) _writeCache(fresh);
      } catch (_) {
        // Silent fail -- keep cached or null.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const _check = (dict, axis, value) => {
    if (!dict) return false;
    const bucket = dict[axis];
    if (bucket === true) return true;
    if (bucket === false || bucket == null) return false;
    if (Array.isArray(bucket)) {
      if (!value) return false;
      return bucket.some((v) => String(v).toLowerCase() === String(value).toLowerCase());
    }
    return false;
  };

  const _label = (list, axis, value) => {
    if (!list) return "";
    const p = list.find(
      (r) =>
        r.axis === axis &&
        (value == null || String(r.value).toLowerCase() === String(value).toLowerCase()),
    );
    return p?.label || "";
  };

  const isDisabled = (axis, value) => _check(capacity?.disabled, axis, value);
  const reasonFor = (axis, value) => _label(capacity?.protections, axis, value);

  const isWarned = (axis, value) => _check(capacity?.warned, axis, value);
  const warnReasonFor = (axis, value) => _label(capacity?.warnings, axis, value);

  return { capacity, isDisabled, reasonFor, isWarned, warnReasonFor };
}
