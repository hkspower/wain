/**
 * Who is signed in to /backends.
 *
 * Deliberately separate from the shopping cart's provider: a customer and a
 * manager are different sessions on the same device, and the shop must keep
 * working whether or not anyone is signed in to the panel.
 *
 * THERE IS NO STORED TOKEN. admin.php authenticates with a session cookie it
 * sets itself, which the platform's cookie store keeps across restarts — so
 * "am I signed in" is a question for the server (?r=me), not for AsyncStorage.
 * A stored flag would only ever disagree with the cookie in one direction or
 * the other, and both disagreements are bugs: a panel that shows a dashboard
 * to an expired session, or a login form to a live one.
 *
 * `token` remains the field's name because eight call sites gate on its
 * truthiness; it now carries the signed-in email, which is also the one
 * honest thing there is to display.
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

import { adminApi } from '@/lib/admin';

type Ctx = {
  /** The signed-in email, or null. Truthy = the server said so. */
  token: string | null;
  name: string | null;
  /** False until ?r=me has answered — screens must not decide anyone is
   *  signed out before that, or the panel flashes its login form at a
   *  manager who is already signed in. */
  ready: boolean;
  /** 'ok' — signed in. 'code' — the password was right and a second factor
   *  is enrolled: nothing is granted yet, ask for the code. */
  signIn: (email: string, password: string) => Promise<'ok' | 'code'>;
  signInCode: (code: string) => Promise<void>;
  signOut: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi
      .me()
      .then((who) => alive && who && setToken(who.email))
      // Unreachable, signed out, or no admin account yet: all of them render
      // the login screen, which is where each of those is explained.
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    // The password goes out of scope here; the cookie the server set is the
    // only thing kept, and the platform keeps it, not this code.
    const res = await adminApi.login(email.trim(), password);
    if (res.needCode) return 'code' as const;
    setToken(email.trim().toLowerCase());
    return 'ok' as const;
  }, []);

  const signInCode = useCallback(async (code: string) => {
    const who = await adminApi.loginCode(code.trim());
    setToken(who.email);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    // Server-side too: clearing only local state would leave a live session
    // behind the cookie, exactly what a shared or stolen phone should not
    // have. Fire-and-forget — signing out must work offline as well.
    adminApi.logout().catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({ token, name: token, ready, signIn, signInCode, signOut }),
    [token, ready, signIn, signInCode, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
