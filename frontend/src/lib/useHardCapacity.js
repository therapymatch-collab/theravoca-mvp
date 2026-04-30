import { useEffect, useState } from "react";
import { api } from "./api";

// Patient-intake HARD-capacity fetch. The backend
// `/api/config/hard-capacity` returns which HARD options we should
// grey out in the UI because fewer than MIN_REQUIRED therapists in
// our directory would pass them — preventing the patient from
// accidentally pinning themselves into a zero-pool.
//
// Consumers receive `{capacity, isDisabled(axis, value?)}` where
// `isDisabled` is a convenience that works for both list-type axes
// (language_strict: ["Mandarin","Korean"]) and boolean axes
// (in_person_only: true).
export default function useHardCapacity() {
  const [capacity, setCapacity] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/config/hard-capacity");
        if (alive) setCapacity(r.data || null);
      } catch (_) {
        // Silent fail — grey-out is a nice-to-have, not critical.
        // Without the data we simply leave all HARD toggles enabled.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isDisabled = (axis, value) => {
    if (!capacity || !capacity.disabled) return false;
    const bucket = capacity.disabled[axis];
    if (bucket === true) return true;
    if (bucket === false || bucket == null) return false;
    if (Array.isArray(bucket)) {
      if (!value) return false;
      return bucket.some((v) => String(v).toLowerCase() === String(value).toLowerCase());
    }
    return false;
  };

  const reasonFor = (axis, value) => {
    if (!capacity?.protections) return "";
    const p = capacity.protections.find(
      (r) =>
        r.axis === axis &&
        (value == null || String(r.value).toLowerCase() === String(value).toLowerCase()),
    );
    return p?.label || "";
  };

  return { capacity, isDisabled, reasonFor };
}
