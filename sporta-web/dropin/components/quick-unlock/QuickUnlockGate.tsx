import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LockScreen } from "./LockScreen";
import { useIdleLock } from "@/hooks/useIdleLock";
import { hasDevicePasscode } from "@/lib/quickUnlock";
import { isEnrolledLocally, markEnrolled, clearEnrolled } from "@/lib/deviceId";

// Wrap your authenticated admin area with this. When a Supabase session
// exists AND a passcode is enrolled on this device, it shows the LockScreen
// (on load and after 15 min idle) until the passcode is verified. Otherwise
// it renders children unchanged.
//
//   <QuickUnlockGate>
//     <AdminRoutes />
//   </QuickUnlockGate>
export function QuickUnlockGate({ children }: { children: React.ReactNode }) {
  const [hasSession, setHasSession] = useState<boolean | undefined>(undefined);
  const [enrolled, setEnrolled] = useState(isEnrolledLocally());
  const [locked, setLocked] = useState(isEnrolledLocally());

  const refreshEnrollment = useCallback(async (sessionPresent: boolean) => {
    if (!sessionPresent) {
      setEnrolled(false);
      return false;
    }
    try {
      const yes = await hasDevicePasscode();
      setEnrolled(yes);
      yes ? markEnrolled() : clearEnrolled();
      return yes;
    } catch {
      const fallback = isEnrolledLocally();
      setEnrolled(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const present = !!data.session;
      setHasSession(present);
      const yes = await refreshEnrollment(present);
      setLocked(present && yes);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      const present = !!s;
      setHasSession(present);
      const yes = await refreshEnrollment(present);
      setLocked(present && yes);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshEnrollment]);

  const relock = useCallback(() => {
    if (hasSession && enrolled) setLocked(true);
  }, [hasSession, enrolled]);
  useIdleLock(relock);

  async function usePasswordInstead() {
    await supabase.auth.signOut();
    setLocked(false);
  }

  if (hasSession === undefined) return null; // brief auth check; render nothing

  if (hasSession && enrolled && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} onUsePassword={usePasswordInstead} />;
  }

  return <>{children}</>;
}
