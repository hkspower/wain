/**
 * The admin API client — the /backends panel, natively.
 *
 * IT SPEAKS admin.php's OWN CONTRACT, and that sentence is here because for a
 * while it did not: this client was written against scripts/mock-admin.py, and
 * the fixture had drifted into a vocabulary of its own — Bearer tokens where
 * the server issues a session cookie, hyphenated route names where every real
 * route is an underscore, and five routes (`summary`, `order`, `order-status`,
 * `stock` GET and POST) that admin.php has never implemented. Every request
 * this panel made against production would have failed, while every test
 * passed. scripts/admin-contract-test.mjs now holds this file and admin.php
 * together, and scripts/admin-live-test.mjs drives the real PHP.
 *
 * The real contract, read off admin.php rather than remembered:
 *
 *   - Auth is a PHP SESSION COOKIE, set by ?r=login, plus the header
 *     `X-Sporta-Admin: 1` on every request (admin.php answers 400 without
 *     it — a CSRF backstop, since no cross-site form can send it). There is
 *     no token. Native fetch keeps the cookie in the platform's own store;
 *     on web the panel is served same-origin with admin.php, exactly as the
 *     website's own AdminApp is.
 *   - Signed-in state is a QUESTION, not a stored fact: ?r=me answers the
 *     account or null, and 409 no_admin_account when there is nothing to
 *     sign in to.
 *   - An order's state is TWO axes — payment_status and fulfilment_status —
 *     and money is KWD decimals in snake_case fields. This file derives the
 *     panel's single display status and converts to fils at the boundary, so
 *     the screens keep their model.
 *
 * The old rules still hold: nothing is fabricated (an admin panel that
 * invents orders ships stock twice), and a 401 signs you out while anything
 * else is reported as itself.
 */

import { API_BASE } from '@/lib/config';
import { toFils, toKwd, type Fils } from '@/lib/money';

const TIMEOUT_MS = 10_000;

export type OrderStatus = 'new' | 'paid' | 'packing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderSummary {
  id: number;
  ref: string;
  name: string;
  phone: string;
  total: Fils;
  /** Derived: the fulfilment axis wins once anything has happened to the
   *  parcel; before that, paid/new is the payment axis. */
  status: OrderStatus;
  payment: 'knet' | 'tpay' | 'cod';
  /** The payment axis on its own. A cash order can be packed, shipped and
   *  delivered while this is still false — the money arrives at the door. */
  paid: boolean;
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

/**
 * The moves this order may make next, derived from BOTH axes.
 *
 * The fulfilment ladder never goes backwards — a delivered order that becomes
 * "new" again is a reporting bug that outlives the tap. 'paid' is not a rung
 * on that ladder at all: it is the cash axis, offered exactly while the order
 * is cash-on-delivery and the cash has not been recorded — including AFTER
 * delivery, because that is when the courier hands the money over. A card
 * order is never offered 'paid' by hand; the bank's callback is the only
 * thing allowed to say a card paid, so an unpaid card order can only be
 * cancelled.
 */
export function nextStatuses(o: Pick<OrderSummary, 'status' | 'payment' | 'paid'>): OrderStatus[] {
  const ladder: OrderStatus[] =
    o.status === 'new' || o.status === 'paid'
      ? o.payment !== 'cod' && !o.paid
        ? ['cancelled']
        : ['packing', 'cancelled']
      : o.status === 'packing'
        ? ['shipped', 'cancelled']
        : o.status === 'shipped'
          ? ['delivered', 'cancelled']
          : [];
  if (o.payment === 'cod' && !o.paid && o.status !== 'cancelled') {
    return ['paid', ...ladder];
  }
  return ladder;
}

export interface Summary {
  todayOrders: number;
  todayRevenue: Fils;
  pending: number;
  lowStock: { slug: string; name: string; size: string; stock: number }[];
}

/**
 * A discount, shaped exactly like the `discounts` table the storefront already
 * has — kind, code, type, value, window, limit — so the panel manages the same
 * rows the website's checkout reads, rather than a parallel idea of a promotion.
 *
 * `value` is FILS when type is 'fixed' and a whole percent when it is
 * 'percent'. One field with two meanings is not ideal, and it is what the
 * schema does; splitting it here would mean translating in both directions and
 * getting it wrong once.
 */
export interface Discount {
  id: number;
  kind: 'code' | 'auto';
  /** Uppercase and unique. Null for an automatic rule. */
  code: string | null;
  label: string;
  type: 'percent' | 'fixed';
  value: number;
  /** Minimum order subtotal in fils. 0 = no minimum. */
  minOrder: Fils;
  /** One category id, or null for the whole shop. */
  category: string | null;
  /** ISO dates, or null for "no limit at this end". */
  startsAt: string | null;
  endsAt: string | null;
  /** 0 = unlimited. */
  usageLimit: number;
  usedCount: number;
  active: boolean;
}

/** What the panel sends when creating or editing. The server assigns id and
 *  owns usedCount — a panel that could set it could rewrite history. */
export type DiscountDraft = Omit<Discount, 'id' | 'usedCount'> & { id?: number };

export interface StockItem {
  /** The variant's primary key, and the handle ?r=set_stock moves stock by.
   *  slug+size identify the row to a person; the sku is what the server
   *  takes, so losing it here would mean a lookup the server already did. */
  sku: string;
  slug: string;
  name: string;
  size: string;
  stock: number;
}

/** Thrown for an expired or rejected session, so callers can sign out on it
 *  rather than string-matching a message. */
export class Unauthorized extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'Unauthorized';
  }
}

// ---------------------------------------------------------------- the wire

async function call<T>(route: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/admin.php?r=${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        // The CSRF backstop admin.php requires on every request — see
        // store_require_admin_header(). Absent, everything answers 400.
        'X-Sporta-Admin': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      // The session cookie IS the credential. On native, fetch keeps it in
      // the platform's cookie store; on web this asks the browser to send it.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.status === 401 || res.status === 403) throw new Unauthorized();
    const text = await res.text();
    let data: unknown;
    try {
      // JSON.parse, not res.json(): ?r=me answers the bare token `null` for
      // "signed out", which is valid JSON that json() helpers mishandle.
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

// --------------------------------------------- the server's shapes, adapted

/** ?r=orders rows, verbatim from admin.php — KWD decimals, two status axes. */
interface WireOrder {
  id: number;
  track_id: string;
  amount: number;
  payment_status: 'paid' | 'pending' | 'review' | 'failed';
  payment_method: 'knet' | 'tpay' | 'cod';
  fulfilment_status: 'unfulfilled' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_governorate: string | null;
  customer_area: string | null;
  customer_block: string | null;
  customer_street: string | null;
  customer_building: string | null;
  customer_note: string | null;
}

function deriveStatus(o: WireOrder): OrderStatus {
  // The parcel's axis wins the moment anything has happened to the parcel:
  // "packed" tells the owner more than "paid" does, whatever the money says.
  switch (o.fulfilment_status) {
    case 'packed':
      return 'packing';
    case 'shipped':
    case 'delivered':
    case 'cancelled':
      return o.fulfilment_status;
    default:
      return o.payment_status === 'paid' ? 'paid' : 'new';
  }
}

function toSummary(o: WireOrder): OrderSummary {
  return {
    id: o.id,
    ref: o.track_id,
    name: o.customer_name ?? '',
    phone: o.customer_phone ?? '',
    total: toFils(o.amount),
    status: deriveStatus(o),
    payment: o.payment_method,
    paid: o.payment_status === 'paid',
    createdAt: o.created_at,
  };
}

interface WireItem {
  qty: number;
  unit_price: number;
  size: string | null;
  products: { slug: string; name_en: string | null; name_ar: string | null };
}

interface WireVariant {
  sku: string;
  slug: string;
  name_en: string | null;
  size: string;
  stock: number;
}

interface WireDiscount {
  id: number;
  kind: 'code' | 'auto';
  code: string | null;
  label: string;
  type: 'percent' | 'fixed';
  value: number;
  min_order: number;
  category: string | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number;
  used_count: number;
  active: boolean;
}

function toDiscount(d: WireDiscount): Discount {
  return {
    id: d.id,
    kind: d.kind,
    code: d.code,
    label: d.label,
    type: d.type,
    // KWD on the wire, fils in the app — but only for money. A percent is a
    // percent, and multiplying one by 1000 was exactly the sort of mistake
    // one field with two meanings invites, so it is spelled out here.
    value: d.type === 'fixed' ? toFils(d.value) : d.value,
    minOrder: toFils(d.min_order),
    category: d.category,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    usageLimit: d.usage_limit,
    usedCount: d.used_count,
    active: d.active,
  };
}

// -------------------------------------------------------------------- the api

export const adminApi = {
  /** Who is signed in, or null. 409 no_admin_account arrives as an Error
   *  naming exactly that, so the login screen can say what is actually
   *  missing instead of "wrong password". */
  me: () => call<{ email: string } | null>('me'),

  /** Sets the session cookie. `needCode` means a second factor is enrolled
   *  and nothing is granted yet — follow with loginCode(). */
  login: async (email: string, password: string) => {
    const res = await call<{ email: string; need_code: boolean }>('login', { email, password });
    return { needCode: !!res.need_code };
  },

  loginCode: (code: string) => call<{ email: string }>('login_code', { code }),

  logout: () => call<{ ok: true }>('logout', {}),

  /** The dashboard: today's takings from ?r=stats, what is running out from
   *  ?r=variants. Two requests, because that is what the server offers. */
  summary: async (): Promise<Summary> => {
    const [stats, variants] = await Promise.all([
      call<{ paid_today: number; revenue_today: number; unfulfilled_count: number }>('stats'),
      call<WireVariant[]>('variants'),
    ]);
    return {
      todayOrders: Number(stats.paid_today),
      todayRevenue: toFils(Number(stats.revenue_today)),
      pending: Number(stats.unfulfilled_count),
      lowStock: variants
        .filter((v) => v.stock <= 3)
        .map((v) => ({ slug: v.slug, name: v.name_en ?? v.slug, size: v.size, stock: v.stock })),
    };
  },

  orders: async (filter?: OrderStatus | 'all') => {
    const rows = await call<WireOrder[]>('orders&limit=200');
    const orders = rows.map(toSummary);
    // Filtered HERE, not by the server: its filters are the raw axes
    // (payment=, fulfilment=), and the panel filters by the derived status,
    // which only exists on this side.
    return { orders: filter && filter !== 'all' ? orders.filter((o) => o.status === filter) : orders };
  },

  /** admin.php has no single-order route — the website's panel keeps the list
   *  it already fetched. Here the list is re-fetched and joined with
   *  ?r=items, which is two requests for one screen and honest about it. */
  order: async (id: number): Promise<{ order: OrderDetail }> => {
    const [rows, items] = await Promise.all([
      call<WireOrder[]>('orders&limit=500'),
      call<WireItem[]>(`items&order=${id}`),
    ]);
    const row = rows.find((o) => o.id === id);
    if (!row) throw new Error('order_not_found');
    const lines: OrderLineDetail[] = items.map((it) => ({
      name: it.products.name_en ?? it.products.slug,
      size: it.size ?? '—',
      qty: it.qty,
      price: toFils(it.unit_price),
    }));
    const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
    return {
      order: {
        ...toSummary(row),
        governorate: row.customer_governorate ?? '',
        area: row.customer_area ?? '',
        block: row.customer_block ?? '',
        street: row.customer_street ?? '',
        house: row.customer_building ?? '',
        notes: row.customer_note ?? undefined,
        lines,
        subtotal,
        // The rows carry no delivery column; what the customer paid beyond
        // the goods is the delivery (a discount would show here as less —
        // never invented, only arithmetic on served numbers).
        delivery: Math.max(0, toFils(row.amount) - subtotal),
      },
    };
  },

  /** One move, routed to the axis it belongs to: 'paid' is the cash axis
   *  (?r=cod_paid — the server refuses it for card orders, correctly);
   *  everything else is the parcel's (?r=fulfilment, whose word for packing
   *  is 'packed'). */
  setStatus: async (
    order: Pick<OrderSummary, 'id' | 'status' | 'paid'>,
    to: OrderStatus,
  ): Promise<{ status: OrderStatus; paid: boolean }> => {
    if (to === 'paid') {
      await call<{ ok: true }>('cod_paid', { order_id: order.id, paid: true });
      // The parcel has not moved; only the money did.
      return { status: order.status === 'new' ? 'paid' : order.status, paid: true };
    }
    const fulfilment = to === 'packing' ? 'packed' : to;
    await call<{ ok: true }>('fulfilment', { order_id: order.id, status: fulfilment });
    return { status: to, paid: order.paid };
  },

  stock: async (): Promise<{ items: StockItem[] }> => {
    const rows = await call<WireVariant[]>('variants');
    return {
      items: rows.map((v) => ({
        sku: v.sku,
        slug: v.slug,
        name: v.name_en ?? v.slug,
        size: v.size,
        stock: v.stock,
      })),
    };
  },

  setStock: (sku: string, stock: number) => call<{ sku: string }>('set_stock', { sku, stock }),

  discounts: async () => {
    const rows = await call<WireDiscount[]>('discounts');
    return { discounts: rows.map(toDiscount) };
  },

  saveDiscount: (draft: DiscountDraft) =>
    call<{ id: number }>('discount_save', {
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      kind: draft.kind,
      code: draft.code,
      label: draft.label,
      type: draft.type,
      value: draft.type === 'fixed' ? toKwd(draft.value) : draft.value,
      min_order: toKwd(draft.minOrder),
      category: draft.category,
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
      usage_limit: draft.usageLimit,
      active: draft.active,
    }),

  /** Active/paused is its own route rather than a full save: it is the one
   *  change made in a hurry, usually because a promotion is costing money. */
  setDiscountActive: (id: number, active: boolean) =>
    call<{ ok: true }>('discount_active', { id, active }),

  deleteDiscount: (id: number) => call<{ ok: true }>('discount_delete', { id }),
};
