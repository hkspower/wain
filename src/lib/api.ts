/**
 * The one place that talks to the Sporta backend.
 *
 * ONE BACKEND. The storefront and this app are served by the same native
 * PHP + MySQL API; there is no second data source and none should be added.
 * Everything below speaks to it over plain fetch, with three rules:
 *
 *   1. NOTHING BLOCKS THE SHOP. Every read falls back to the bundled
 *      catalogue in lib/catalog.ts. A customer on hotel wifi still gets a
 *      storefront; they simply get one that cannot be a minute old.
 *   2. Money crosses the wire as FILS, integers, in both directions. See
 *      lib/money.ts for why.
 *   3. Requests time out. fetch has no default timeout, so a backend that
 *      accepts a connection and then says nothing would hang the screen
 *      forever rather than falling back.
 */

import Constants from 'expo-constants';

import { categories as bundledCategories, products as bundledProducts, type Category, type Product } from '@/lib/catalog';
import type { Fils } from '@/lib/money';

/**
 * Point the app at a shop. `extra.apiBase` in app.json is the shipped setting;
 * EXPO_PUBLIC_API_BASE overrides it for one build.
 *
 * The environment variable is checked FIRST, and the order is the whole point:
 * app.json always has a value, so reading it first meant the override could
 * never win and every build went to production — including the test rig, which
 * then reported the panel broken when it was merely pointed at a host it
 * cannot reach.
 */
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ??
  (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ??
  'https://www.sporta.com.kw/api';

const TIMEOUT_MS = 8000;

export type Source = 'live' | 'bundled';

export interface Catalogue {
  products: Product[];
  categories: Category[];
  source: Source;
}

async function get<T>(path: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      headers: { Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The live catalogue, or the bundled one.
 *
 * `source` is returned rather than logged, because the difference is something
 * the customer is entitled to see: the account screen says so plainly instead
 * of letting them wonder why a product they were sent is missing.
 */
export async function fetchCatalogue(): Promise<Catalogue> {
  try {
    const data = await get<{ products: Product[]; categories?: Category[] }>('store.php?r=catalogue');
    if (!Array.isArray(data.products) || data.products.length === 0) {
      throw new Error('catalogue: empty');
    }
    return {
      products: data.products,
      categories: data.categories?.length ? data.categories : bundledCategories,
      source: 'live',
    };
  } catch {
    return { products: bundledProducts, categories: bundledCategories, source: 'bundled' };
  }
}

export interface OrderLine {
  slug: string;
  size: string;
  qty: number;
  /** Unit price at the time of adding, in fils. */
  price: Fils;
}

export interface OrderDraft {
  name: string;
  phone: string;
  governorate: string;
  area: string;
  block: string;
  street: string;
  house: string;
  notes?: string;
  payment: 'knet' | 'card' | 'cod';
  lines: OrderLine[];
  /** Fils. Sent so the backend can reject a basket it prices differently. */
  total: Fils;
  lang: 'ar' | 'en';
}

export interface OrderPlaced {
  ref: string;
  /** Present for knet/card: the hosted payment page to open. */
  payUrl?: string;
}

/**
 * Place an order. This one does NOT fall back — an order that quietly did not
 * reach the shop is worse than an error message, because the customer believes
 * it did. The caller shows the failure and keeps the basket.
 */
export async function placeOrder(draft: OrderDraft): Promise<OrderPlaced> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS * 2);
  try {
    const res = await fetch(`${API_BASE}/store.php?r=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(draft),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => null)) as (OrderPlaced & { error?: string }) | null;
    if (!res.ok || !body?.ref) throw new Error(body?.error ?? `order: HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
