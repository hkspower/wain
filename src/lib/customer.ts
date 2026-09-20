/**
 * The customer-account API client — a shopper's own sign-in, separate from
 * the admin panel's.
 *
 * IT IS NOT THE ADMIN CLIENT. Customer routes live on api.php, not admin.php:
 * no X-Sporta-Admin header (that CSRF backstop is the admin gate's own, per
 * store_require_admin_header() — these routes carry no such requirement), a
 * different session cookie, and a different question of who is signed in.
 * See api/customer.php's own header for the two decisions that shaped the
 * server side: a cookie appears only on sign-in, and an account starts with
 * no orders on it because nothing links one by phone number.
 *
 * FAST REGISTRATION, ON PURPOSE. customer_register() on the server already
 * asks for only an email and a password — name and phone are optional there
 * and stay unset until the shopper chooses to add them. This client does not
 * invent a stricter contract than the server has: a full name and a delivery
 * address are what CHECKOUT collects, every time, account or no account —
 * they were never blocking fields here to begin with.
 */

import { API_BASE } from '@/lib/config';

export class Unauthorized extends Error {
  constructor() {
    super('not signed in');
    this.name = 'Unauthorized';
  }
}

export type CustomerProfile = {
  id: number;
  email: string;
  phone: string | null;
  name: string | null;
  created_at: string;
};

export type CustomerOrder = {
  ref: string;
  amount: number;
  payment_status: string;
  fulfilment_status: string;
  created_at: string;
};

const TIMEOUT_MS = 10_000;

async function call<T>(route: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api.php?r=${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      // The shopper cookie IS the credential, same shape as the admin
      // client's own — the platform's cookie store carries it on native,
      // and this asks the browser to send it on web.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.status === 401) throw new Unauthorized();
    const text = await res.text();
    let data: unknown;
    try {
      // JSON.parse, not res.json(): customer_me answers the bare token
      // `null` for "signed out", which is valid JSON some json() helpers
      // mishandle — admin.ts's own client carries the identical note.
      data = JSON.parse(text);
    } catch {
      throw new Error(`${route}: not JSON`);
    }
    if (!res.ok) {
      const err = (data as { error?: string } | null)?.error;
      throw new Error(err ?? `${route}: HTTP ${res.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const customerApi = {
  /** Email and password only. Phone/name are accepted but never required —
   *  see this file's own header for why nothing here asks for more. */
  register: (email: string, password: string) =>
    call<{ customer: CustomerProfile }>('customer_register', { email, password }),

  login: (email: string, password: string) =>
    call<{ customer: CustomerProfile }>('customer_login', { email, password }),

  logout: () => call<{ ok: true }>('customer_logout', {}),

  /** The signed-in account, or null — never throws Unauthorized, since
   *  customer_me answers "nobody" as a normal 200 rather than a 401. */
  me: () => call<{ customer: CustomerProfile | null }>('customer_me'),

  orders: () => call<{ orders: CustomerOrder[]; note: string }>('customer_orders'),
};
