import { createClient } from '@supabase/supabase-js'

// Configure these in sporta-web/.env (see .env.example).
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Non-fatal so the marketing site still builds/runs without admin env vars.
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — admin features disabled.')
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null

// --- RPC wrappers matching the Sporta backend ------------------------------

export async function setDevicePasscode(deviceId, passcode, label) {
  const { data, error } = await supabase.rpc('set_device_passcode', {
    p_device_id: deviceId,
    p_passcode: passcode,
    p_label: label,
  })
  if (error) throw error
  return data
}

// Returns { ok, reason, attempts_left, locked_until }
export async function verifyDevicePasscode(deviceId, passcode) {
  const { data, error } = await supabase.rpc('verify_device_passcode', {
    p_device_id: deviceId,
    p_passcode: passcode,
  })
  if (error) throw error
  return data
}

// Server-authoritative enrollment check (see supabase/has_device_passcode.sql).
// Returns true/false. Throws if the RPC is missing so callers can fall back
// to the local hint.
export async function hasDevicePasscode(deviceId) {
  const { data, error } = await supabase.rpc('has_device_passcode', {
    p_device_id: deviceId,
  })
  if (error) throw error
  return data === true
}
