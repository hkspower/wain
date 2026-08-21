/**
 * The admin API client — the /backends panel, natively.
 *
 * Three rules, and they are not the storefront's rules:
 *
 *   1. NOTHING IS FABRICATED. The storefront falls back to a bundled catalogue
 *      when the shop is unreachable, because a customer needs something to look
 *      at. An admin panel must do the opposite: an order list that invents
 *      orders, or silently shows yesterday's, is how stock gets shipped twice
 *      and how a refund gets missed. Every screen here shows loading, error,
 *      empty, or real — never a stand-in.
 *   2. THE TOKEN IS THE ONLY SECRET STORED, never the password. It is kept in
 *      AsyncStorage so the panel survives an app restart, and dropped the
 *      moment the server rejects it.
 *   3. A 401 SIGNS YOU OUT. Anything else is reported as itself. Treating an
 *      expired session and a 500 the same way sends the manager to re-enter a
 *      password that was never the problem.
 */

import { API_BASE } from '@/lib/config';
import { KEYS, readString, remove, writeString } from '@/lib/storage';
import type { Fils } from '@/lib/money';

const TIMEOUT_MS = 10_000;

export type OrderStatus = 'new' | 'paid' | 'packing' | 'shipped' | 'delivered' | 'cancelled';

/** The order a status may move to next. Cancel is available from anywhere but
 *  the end states, and nothing moves backwards — an admin panel that lets a
 *  delivered order become "new" is a reporting bug waiting to happen. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  new: ['paid', 'packing', 'cancelled'],
  paid: ['packing', 'cancelled'],
  packing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export interface OrderSummary {
  id: number;
  ref: string;
  name: string;
  phone: string;
  total: Fils;
  status: OrderStatus;
  payment: 'knet' | 'card' | 'cod';
  createdAt: string;
}

export interface OrderLineDetail {
  name: string;
  size: string;
  qty: number;
  price: Fils;
}

export interface OrderDetail extends OrderSummary {
  governorate: string;
  area: string;
  block: string;
  street: string;
  house: string;
  notes?: string;
  lines: OrderLineDetail[];
  subtotal: Fils;
  delivery: Fils;
}

export interface Summary {
  todayOrders: number;
  todayRevenue: Fils;
  pending: number;
  lowStock: { slug: string; name: string; size: string; stock: number }[];
}

export interface StockItem {
  slug: string;
  name: string;
  size: string;
  stock: number;
}

/** Thrown for an expired or rejected token, so callers can sign out on it
 *  rather than string-matching a message. */
export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'Unauthorized';
  }
}

async function call<T>(
  route: string,
  { token, body }: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/admin.php?r=${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.status === 401 || res.status === 403) throw new Unauthorized();
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new Error(data?.error ?? `${route}: HTTP ${res.status}`);
    if (data === null) throw new Error(`${route}: not JSON`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const adminApi = {
  login: (email: string, password: string) =>
    call<{ token: string; name: string }>('login', { body: { email, password } }),

  summary: (token: string) => call<Summary>('summary', { token }),

  orders: (token: string, status?: OrderStatus | 'all') =>
    call<{ orders: OrderSummary[] }>(
      `orders${status && status !== 'all' ? `&status=${status}` : ''}`,
      { token },
    ),

  order: (token: string, id: number) => call<{ order: OrderDetail }>(`order&id=${id}`, { token }),

  setStatus: (token: string, id: number, status: OrderStatus) =>
    call<{ ok: true; status: OrderStatus }>('order-status', { token, body: { id, status } }),

  stock: (token: string) => call<{ items: StockItem[] }>('stock', { token }),

  setStock: (token: string, slug: string, size: string, stock: number) =>
    call<{ ok: true }>('stock', { token, body: { slug, size, stock } }),
};

export const saveToken = (t: string) => writeString(KEYS.adminToken, t);
export const loadToken = () => readString(KEYS.adminToken);
export const clearToken = () => remove(KEYS.adminToken);
