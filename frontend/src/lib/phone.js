// Auto-format a phone number as the user types into `xxx-xxx-xxxx`.
// We only format US-style 10-digit numbers; anything beyond the first 10 digits
// is dropped. Existing dashes are preserved on display so users see the format
// settle in real-time.
export function formatUsPhone(raw) {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Returns true once the phone has all 10 digits collected.
export function phoneIsComplete(raw) {
  return String(raw || "").replace(/\D/g, "").length === 10;
}
