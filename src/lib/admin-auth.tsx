import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PIN_KEY = 'wain.admin.pin';

/** Default PIN seeded on first launch. Admins can change it in the panel. */
export const DEFAULT_PIN = '1379';

type AdminAuthContextValue = {
  /** True once the stored PIN has been loaded. */
  ready: boolean;
  /** In-memory unlock state — resets every time the app restarts. */
  unlocked: boolean;
  /** Attempt to unlock with a PIN. Returns whether it matched. */
  unlock: (pin: string) => Promise<boolean>;
  /** Lock the panel again (e.g. from a "Lock" button). */
  lock: () => void;
  /** Change the stored PIN. Returns false if the current PIN is wrong. */
  changePin: (currentPin: string, nextPin: string) => Promise<boolean>;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [pin, setPin] = useState(DEFAULT_PIN);
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PIN_KEY);
        if (raw) {
          if (active) setPin(raw);
        } else {
          await AsyncStorage.setItem(PIN_KEY, DEFAULT_PIN);
        }
      } catch {
        // Keep the default PIN if storage is unavailable.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const unlock = useCallback(
    async (candidate: string) => {
      const ok = candidate === pin;
      if (ok) setUnlocked(true);
      return ok;
    },
    [pin],
  );

  const lock = useCallback(() => setUnlocked(false), []);

  const changePin = useCallback(
    async (currentPin: string, nextPin: string) => {
      if (currentPin !== pin) return false;
      setPin(nextPin);
      try {
        await AsyncStorage.setItem(PIN_KEY, nextPin);
      } catch {
        // In-memory PIN is still updated even if the write fails.
      }
      return true;
    },
    [pin],
  );

  const value = useMemo<AdminAuthContextValue>(
    () => ({ ready, unlocked, unlock, lock, changePin }),
    [ready, unlocked, unlock, lock, changePin],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return ctx;
}
