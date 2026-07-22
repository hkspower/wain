// Stable per-device identifier for admin passcode quick-unlock.
// A 256-bit random token, generated once and persisted in localStorage.
const KEY = "sporta_device_id";
const ENROLLED_KEY = "sporta_passcode_enrolled";

function generate(): string {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32); // 256 bits
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback: two UUIDs concatenated (also 256 bits of randomness).
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = generate();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Local hint that this device completed enrollment. The server
// (has_device_passcode) is authoritative; this is only a fast-path fallback.
export const isEnrolledLocally = () => localStorage.getItem(ENROLLED_KEY) === "1";
export const markEnrolled = () => localStorage.setItem(ENROLLED_KEY, "1");
export const clearEnrolled = () => localStorage.removeItem(ENROLLED_KEY);
