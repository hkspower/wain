/**
 * Who is signed in to /backends.
 *
 * Deliberately separate from the shopping cart's provider: a customer and a
 * manager are different sessions on the same device, and the shop must keep
 * working whether or not anyone is signed in to the panel.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { adminApi, clearToken, loadToken, saveToken } from '@/lib/admin';

type Ctx = {
  token: string | null;
  name: string | null;
  /** False until the stored token has been read — screens must not decide
   *  anyone is signed out before that, or the panel flashes its login form at
   *  a manager who is already signed in. */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadToken()
      .then((t) => alive && t && setToken(t))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await adminApi.login(email.trim(), password);
    // The password is never stored, never logged, and goes out of scope here.
    setToken(res.token);
    setName(res.name);
    await saveToken(res.token);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setName(null);
    clearToken();
  }, []);

  const value = useMemo<Ctx>(
    () => ({ token, name, ready, signIn, signOut }),
    [token, name, ready, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
