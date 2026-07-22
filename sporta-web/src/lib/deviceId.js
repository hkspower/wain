// Stable per-device identifier for passcode quick-unlock.
// A 256-bit random token, generated once and persisted in localStorage.
const KEY = 'sporta_device_id'

function generate() {
  // Prefer getRandomValues (32 bytes = 256 bits) -> hex.
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback: two UUIDs concatenated (also 256 bits of randomness).
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

export function getDeviceId() {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = generate()
    localStorage.setItem(KEY, id)
  }
  return id
}

// Local hint that this device has completed enrollment. The backend is the
// source of truth (verify_device_passcode), but this lets us decide whether
// to show the lock screen without an extra round-trip.
const ENROLLED_KEY = 'sporta_passcode_enrolled'
export const isEnrolledLocally = () => localStorage.getItem(ENROLLED_KEY) === '1'
export const markEnrolled = () => localStorage.setItem(ENROLLED_KEY, '1')
export const clearEnrolled = () => localStorage.removeItem(ENROLLED_KEY)
