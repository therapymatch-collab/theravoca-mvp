import { useEffect, useState } from "react";
import { api } from "./api";

// Patient-intake capacity fetch.  The backend `/api/config/hard-capacity`
// returns three tiers per axis:
//   disabled  -- count == 0, greyed out + unclickable
//   warned    -- 0 < count < MIN_REQUIRED, selectable with soft warning
//   (normal)  -- count >= MIN_REQUIRED, no flags
//
// Consumers receive helpers for both tiers plus the raw capacity object.
export default function useHardCapacity() {
  const [capacity, setCapacity] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/config/hard-capacity");
        if (alive) setCapacity(r.data || null);
      } catch (_) {
        // Silent fail -- capacity gating is a nice-to-have, not critical.
      } finally {
        if (alive) setLoading(false);
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

  return { capacity, loading, isDisabled, reasonFor, isWarned, warnReasonFor };
}
