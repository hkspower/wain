/**
 * Who is signed in as a SHOPPER — separate from useSession() in
 * src/lib/session.tsx, which is the /backends admin's own session.
 *
 * Same shape as the admin provider for the same reason: there is no stored
 * token, because the cookie the server set is the only credential and
 * customer_me() is the question "am I signed in", asked of the server, not
 * of AsyncStorage.
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

import { customerApi, type CustomerProfile } from '@/lib/customer';

type Ctx = {
  customer: CustomerProfile | null;
  /** False until customer_me has answered — a screen must not decide nobody
   *  is signed in before that, or a returning shopper sees a sign-in form
   *  flash past their own account for a moment. */
  ready: boolean;
  /** Email and password only — see customer.ts's own header for why
   *  nothing more is asked here. */
  register: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const CustomerSessionContext = createContext<Ctx | null>(null);

export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    customerApi
      .me()
      .then((res) => {
        if (alive) setCustomer(res.customer);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    // customer_register grants the session itself, the same as admin's
    // register route does — nothing to sign in with afterwards.
    const res = await customerApi.register(email.trim(), password);
    setCustomer(res.customer);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await customerApi.login(email.trim(), password);
    setCustomer(res.customer);
  }, []);

  const signOut = useCallback(() => {
    setCustomer(null);
    // Fire-and-forget, same reasoning as the admin session's signOut: this
    // must work offline, and a stale local sign-in is worse than a request
    // that never lands.
    customerApi.logout().catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({ customer, ready, register, signIn, signOut }),
    [customer, ready, register, signIn, signOut],
  );

  return (
    <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>
  );
}

export function useCustomerSession(): Ctx {
  const ctx = useContext(CustomerSessionContext);
  if (!ctx) throw new Error('useCustomerSession must be used inside <CustomerSessionProvider>');
  return ctx;
}
