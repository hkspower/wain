// RPC wrappers for admin passcode quick-unlock.
// Uses your existing Supabase client. Adjust the import path if yours differs
// (Lovable default is "@/integrations/supabase/client").
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "./deviceId";

export type VerifyResult = {
  ok: boolean;
  reason?: string | null;
  attempts_left?: number | null;
  locked_until?: string | null;
};

export async function setDevicePasscode(passcode: string, label: string) {
  const { data, error } = await supabase.rpc("set_device_passcode", {
    p_device_id: getDeviceId(),
    p_passcode: passcode,
    p_label: label,
  });
  if (error) throw error;
  return data;
}

export async function verifyDevicePasscode(passcode: string): Promise<VerifyResult> {
  const { data, error } = await supabase.rpc("verify_device_passcode", {
    p_device_id: getDeviceId(),
    p_passcode: passcode,
  });
  if (error) throw error;
  return data as VerifyResult;
}

// Server-authoritative enrollment check. Requires the has_device_passcode
// RPC (see supabase/has_device_passcode.sql). Throws if missing so callers
// can fall back to the local hint.
export async function hasDevicePasscode(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_device_passcode", {
    p_device_id: getDeviceId(),
  });
  if (error) throw error;
  return data === true;
}
