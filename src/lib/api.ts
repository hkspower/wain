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

import { API_BASE, SITE_BASE } from '@/lib/config';
import {
  categories as bundledCategories,
  products as bundledProducts,
  type Category,
  type Product,
} from '@/lib/catalog';
import { toFils, toKwd, type Fils } from '@/lib/money';

// Re-exported because callers have always imported it from here, and moving a
// constant is not a reason to touch every call site. lib/config.ts is where it
// is decided.
export { API_BASE };

const TIMEOUT_MS = 8000;

/**
 * WHAT THE SHOP ACTUALLY SENDS.
 *
 * These types are the storefront's, not this app's, and the two do not match —
 * which is why this file adapts rather than casts. Verified against the real
 * api.php running on the real schema, not inferred from the client that was
 * here before:
 *
 *   * THE ROUTER IS api.php. `store.php` is the shared LIBRARY behind it, and
 *     nothing in it reads `r` — a request to store.php?r=catalogue returns 200
 *     and an empty body. This app asked store.php for everything, so it would
 *     never have received a single product from the real shop; the bundled
 *     catalogue would have covered for it, silently, for ever.
 *   * PRICES ARE KWD, decimal — `"price": 4` is four dinars. This app works in
 *     integer fils throughout, so amounts are multiplied on the way in and
 *     divided on the way out. Getting that backwards is a thousandfold error.
 *   * Names are name_en/name_ar. Stock is a SEPARATE endpoint keyed by
 *     (slug, size); the catalogue carries no sizes at all.
 */
interface LiveProduct {
  slug: string;
  name_en: string;
  name_ar: string;
  desc_en: string | null;
  desc_ar: string | null;
  /** KWD, decimal. */
  price: number;
  list_price: number | null;
  on_sale: boolean;
  category: string;
  brand_name_en: string | null;
  featured: boolean;
  /** Relative to the API directory, e.g. "api.php?r=product_image&id=7&v=…",
   *  or null when the shop has no photograph of this product. */
  image: string | null;
}

interface LiveStock {
  slug: string;
  size: string;
  stock: number;
}

const KNOWN_CATEGORY = (id: string): id is Product['category'] =>
  id === 'men' || id === 'women' || id === 'accessories' || id === 'outlet';

/**
 * The live shape mapped onto this app's model.
 *
 * A product with no stock rows keeps an empty variant list rather than being
 * dropped: it still belongs in the grid, wearing its sold-out badge. A
 * catalogue that silently loses products is worse than one showing an
 * unavailable one.
 */
/**
 * The catalogue reports an image as a path relative to the API directory,
 * because that is where api.php sits and that is what the website's own
 * <img src> needs. This app fetches from wherever API_BASE points, which is a
 * different origin in development and the same one in production, so the
 * relative path has to be resolved against it rather than against the page.
 *
 * An absolute URL is passed through: the shop may one day serve its pictures
 * from somewhere else, and that is its decision to make, not this app's to
 * override.
 */
function photoUrl(image: string | null): string | undefined {
  if (!image) return undefined;
  if (/^https?:\/\//i.test(image)) return image;
  return `${API_BASE}/${image.replace(/^\.?\//, '')}`;
}

function adapt(products: LiveProduct[], stock: LiveStock[]): Product[] {
  const bySlug = new Map<string, LiveStock[]>();
  for (const row of stock) {
    const list = bySlug.get(row.slug) ?? [];
    list.push(row);
    bySlug.set(row.slug, list);
  }

  return products.map((p) => ({
    slug: p.slug,
    name: p.name_en,
    nameAr: p.name_ar,
    brand: p.brand_name_en ?? 'Sporta',
    category: KNOWN_CATEGORY(p.category) ? p.category : 'accessories',
    price: toFils(p.price),
    was: p.on_sale && p.list_price && p.list_price > p.price ? toFils(p.list_price) : undefined,
    emoji: '🛍️',
    color: '#2b3138',
    photo: photoUrl(p.image),
    blurb: p.desc_en ?? '',
    blurbAr: p.desc_ar ?? '',
    details: [],
    detailsAr: [],
    variants: (bySlug.get(p.slug) ?? []).map((r) => ({ size: r.size, stock: r.stock })),
    featured: p.featured,
  }));
}

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
    // Two requests in parallel: the catalogue carries no sizes and the stock
    // endpoint carries nothing else. Sequentially that is two round trips to
    // Kuwait before the first tile can paint. Stock failing alone is survivable
    // — the grid still lists everything, with nothing shown as in stock.
    const [products, stock] = await Promise.all([
      get<LiveProduct[]>('api.php?r=products'),
      get<LiveStock[]>('api.php?r=stock').catch(() => [] as LiveStock[]),
    ]);
    if (!Array.isArray(products) || products.length === 0) throw new Error('catalogue: empty');
    return { products: adapt(products, stock), categories: bundledCategories, source: 'live' };
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
  /** The idempotency key. Generated once per checkout attempt and reused on
   *  retry, so a second tap updates the pending order rather than placing a
   *  second one. 6–30 alphanumerics, which is what the route validates. */
  trackId: string;
  name: string;
  phone: string;
  /** The shop requires one — it sends the confirmation and the invoice. */
  email: string;
  governorate: string;
  area: string;
  block: string;
  street: string;
  house: string;
  notes?: string;
  /**
   * What the shop calls them, not what this app used to call them. `card` was
   * never a payment method the server accepts — the list is knet, tpay, cod —
   * so every card checkout from this app came back `invalid_payment_method`
   * and no card order has ever been placed through it.
   *
   * `tpay` is CBK's T-Pay: the card and QR half of the same Commercial Bank of
   * Kuwait gateway that serves KNET, on the same hosted page.
   */
  payment: 'knet' | 'tpay' | 'cod';
  lines: OrderLine[];
  /** Fils. Kept for the caller's own display; the shop prices the basket
   *  itself from the slugs, which is the only safe place to do it. */
  total: Fils;
  lang: 'ar' | 'en';
}

export interface OrderPlaced {
  ref: string;
  /** Absolute URL of the bank's hosted page. Present for knet and tpay,
   *  absent for cash on delivery — which has nothing to open, not a link that
   *  failed to build. */
  payUrl?: string;
  /** What the shop says the order costs, in fils. The basket's own total is
   *  not authoritative and never was: the price comes from the products table
   *  and the delivery rule, both of them server-side. */
  amount?: Fils;
}

/** What the shop knows about an order's money, after the bank has answered. */
export interface OrderStatus {
  paid: boolean;
  /** 'pending' until the bank calls back, then 'paid' or 'failed'. */
  payment: string;
  method: string;
  amount: Fils;
}

/**
 * The pay URL arrives RELATIVE — "/pay/pay.php?trackid=..." — because that is
 * what the website's own checkout needs and the shop has no idea which host
 * this app was pointed at. It is resolved here against the site rather than
 * against the API, which lives one directory down at /api.
 *
 * An absolute URL is passed through untouched, so the shop can move its
 * payment pages to another host without a release. Anything that is neither
 * is dropped rather than guessed at: a malformed payment link should send the
 * customer nowhere, not somewhere.
 */
export function payUrlFor(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/')) return undefined;
  return `${SITE_BASE}${raw}`;
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
    // THE SHOP'S BODY, not this app's. Every name here was read off the running
    // api.php, and each one was wrong in the version before: it sent `lines`
    // (the shop wants `items`), a flat address (it wants `customer`), `house`
    // (`building`), a governorate LABEL (a slug), `payment` (`payment_method`),
    // and no track_id at all — which is the first thing the route validates.
    //
    // track_id is the idempotency key: retrying with the same one updates the
    // pending order instead of creating a second, which is what stops a
    // customer tapping Pay twice from being charged twice.
    const res = await fetch(`${API_BASE}/api.php?r=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        track_id: draft.trackId,
        payment_method: draft.payment,
        items: draft.lines.map((l) => ({ slug: l.slug, size: l.size, qty: l.qty })),
        customer: {
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          governorate: draft.governorate,
          area: draft.area,
          block: draft.block,
          street: draft.street,
          building: draft.house,
        },
        lang: draft.lang,
      }),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => null)) as
      | { track_id?: string; amount?: number; pay_url?: string | null; error?: string }
      | null;
    if (!res.ok || !body?.track_id) throw new Error(body?.error ?? `order: HTTP ${res.status}`);
    return {
      ref: body.track_id,
      payUrl: payUrlFor(body.pay_url),
      amount: typeof body.amount === 'number' ? toFils(body.amount) : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** KWD out of the app's fils, for anything the shop wants in dinars. */
export const asKwd = toKwd;


/**
 * Has the bank answered yet?
 *
 * The customer comes back from the hosted page and the app cannot tell from
 * that alone whether they paid: the browser sheet closes the same way whether
 * they completed the payment, cancelled it, or gave up. Only the shop knows,
 * and only after CBK has called its callback — so the app asks the shop rather
 * than believing the customer's return.
 *
 * Returns null when the shop cannot be reached or does not know the order.
 * That is deliberately not the same as "not paid": the caller must not tell
 * somebody their payment failed on the strength of a dropped connection.
 */
export async function fetchOrderStatus(track: string): Promise<OrderStatus | null> {
  try {
    const row = await get<{
      payment_status?: string;
      payment_method?: string;
      amount?: number;
    } | null>(`api.php?r=status&id=${encodeURIComponent(track)}`);
    if (!row?.payment_status) return null;
    return {
      paid: row.payment_status === 'paid',
      payment: row.payment_status,
      method: row.payment_method ?? '',
      amount: toFils(row.amount ?? 0),
    };
  } catch {
    return null;
  }
}
