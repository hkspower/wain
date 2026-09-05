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

// ------------------------------------------------------------------ settings
//
// Two settings the panel can edit, and they are deliberately separate types
// rather than one bag of strings: the server validates them differently, and a
// single `Record<string, string>` would have let the top bar's date window be
// sent as contact details and vice versa, with the mismatch only showing up as
// a 400 from a route that does not say which field it disliked.

/** The strip above the header. Both languages, because the shop is bilingual
 *  and a bar that only exists in one is worse than no bar. */
export interface PromoBar {
  enabled: boolean;
  textEn: string;
  textAr: string;
  /** An INTERNAL path only — the server refuses anything else. Empty = no link. */
  href: string;
  /** YYYY-MM-DD, or null for "no bound". Both ends are independent. */
  startsAt: string | null;
  endsAt: string | null;
}

/** How to reach the shop. Every field is optional; empty means "do not show". */
/** The footer's prose, in both languages. Every field may be '' — which the
 *  server and assets/footer.js both read as "leave the text built into the
 *  page alone", never as "blank it". */
export interface FooterText {
  taglineAr: string; taglineEn: string;
  clubTitleAr: string; clubTitleEn: string;
  clubTextAr: string; clubTextEn: string;
  rightsAr: string; rightsEn: string;
  managedAr: string; managedEn: string;
}

export interface ContactDetails {
  /** As it should be PRINTED, spaces and all. The tel: link is built from it. */
  phone: string;
  /** Digits with the country code — wa.me accepts nothing else. The server
   *  normalises whatever is typed here through the same function the checkout
   *  uses, so this comes back canonical after a save. */
  whatsapp: string;
  email: string;
  addressAr: string;
  addressEn: string;
  hoursAr: string;
  hoursEn: string;
  /** A handle, not a URL — the link is built from it. */
  instagram: string;
}

interface WirePromoBar {
  enabled: boolean;
  text_en: string;
  text_ar: string;
  href: string;
  starts_at: string | null;
  ends_at: string | null;
}

interface WireContact {
  phone: string;
  whatsapp: string;
  email: string;
  address_ar: string;
  address_en: string;
  hours_ar: string;
  hours_en: string;
  instagram: string;
}

// ------------------------------------------------------- product photographs
//
// KEYED ON THE PRODUCT, NOT ON A SIZE. One shoot covers every size of a
// garment, and product_images has a slug column and no size column — so an SKU
// identifies WHICH PRODUCT a photograph belongs to and nothing finer. The
// uploader uses an SKU as a fast way to find the product (it is the code
// printed on the garment's own label) and says on screen which product the
// photographs landed on, so nobody believes they have uploaded a picture of
// the Large only.
export interface ProductImage {
  id: number;
  /** Where it sits in the gallery. The FIRST is the product's main image. */
  sort: number;
  /** Absolute, and already carrying the content hash — cached for a year. */
  url: string;
  width: number | null;
  height: number | null;
}

/** A brand as the panel edits it. name_en and name_ar are both required by the
 *  server: a shop that reads in two languages cannot have a brand that only
 *  names itself in one. */
export type Brand = {
  id: number;
  slug: string;
  name_en: string;
  name_ar: string;
  logo: string | null;
  active: boolean | number;
  sort: number;
};

/** An answer the shop wrote itself, for a question the assistant's intents do
 *  not cover.
 *
 *  `q_ar` / `q_en` are KEYWORDS, not sentences: the server folds both sides and
 *  requires every significant word of the stored phrase to appear in what the
 *  customer typed. Either may be empty when the question only ever arrives in
 *  one language; both answers are required, because replying to Arabic in
 *  English is not replying.
 *
 *  `hits` is how many times this answer has been given. It is the only signal
 *  that separates a phrase customers actually type from one that reads well
 *  and never fires. */
export type Qa = {
  id: number;
  q_ar: string;
  q_en: string;
  a_ar: string;
  a_en: string;
  active: boolean | number;
  hits: number;
  last_hit_at: string | null;
  updated_at: string;
};

/** A garment as the uploader needs to find it: by brand, by size, by sku. */
export interface UploadTarget {
  sku: string;
  slug: string;
  name: string;
  size: string;
  brandSlug: string | null;
}

interface WireProductImage {
  id: number;
  sort: number;
  url: string;
  width: number | null;
  height: number | null;
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


// ------------------------------------------------------------------ returns

/** A return or exchange request, as ?r=returns sends it. */
type WireReturn = {
  id: number;
  ref: string;
  kind: 'return' | 'exchange';
  status: ReturnStatus;
  reason: string | null;
  lang: string;
  phone: string;
  staff_note: string | null;
  created_at: string;
  decided_at: string | null;
  track_id: string;
  customer_name: string | null;
  payment_method: string;
  amount: number;
  ordered_at: string;
  fulfilled_at: string | null;
  items: {
    qty: number;
    want_size: string | null;
    size: string | null;
    unit_price: number;
    name_en: string;
    name_ar: string;
    slug: string;
    image: string | null;
  }[];
};

/** The server's own list, verbatim — the CHECK constraint on
 *  return_requests.status carries exactly these six. */
export type ReturnStatus =
  | 'new' | 'approved' | 'picked_up' | 'refunded' | 'rejected' | 'cancelled';

export type ReturnLine = {
  name: string;
  size: string;
  wantSize: string | null;
  qty: number;
  price: number;
};

export type ReturnRequest = {
  id: number;
  ref: string;
  kind: 'return' | 'exchange';
  status: ReturnStatus;
  reason: string | null;
  phone: string;
  staffNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  trackId: string;
  customerName: string;
  amount: number;
  lines: ReturnLine[];
};

function toReturn(w: WireReturn): ReturnRequest {
  return {
    id: Number(w.id),
    ref: w.ref,
    kind: w.kind,
    status: w.status,
    reason: w.reason,
    phone: w.phone,
    staffNote: w.staff_note,
    createdAt: w.created_at,
    decidedAt: w.decided_at,
    trackId: w.track_id,
    customerName: w.customer_name ?? '',
    // KWD decimals on the wire, integer fils everywhere in the app.
    amount: toFils(w.amount),
    lines: (w.items ?? []).map((i) => ({
      name: i.name_en ?? i.slug,
      size: i.size ?? '—',
      wantSize: i.want_size,
      qty: Number(i.qty),
      price: toFils(i.unit_price),
    })),
  };
}

// -------------------------------------------------------------------- the api

export const adminApi = {
  /** Who is signed in, or null. 409 no_admin_account arrives as an Error
   *  naming exactly that, so the login screen can say what is actually
   *  missing instead of "wrong password". */
  me: () => call<{ email: string } | null>('me'),

  /** Sets the session cookie. `needCode` means a second factor is enrolled
   *  and nothing is granted yet — follow with loginCode().
   *
   *  `via` says WHICH factor, and it matters: "enter your code" is the wrong
   *  instruction for half the accounts, and useless to somebody staring at an
   *  authenticator app they never installed while the code sits in their
   *  inbox. `sentTo` is the masked address; `sent` is false when the shop
   *  could not post the mail, which the screen must say out loud rather than
   *  asking for a code that was never sent. */
  login: async (email: string, password: string) => {
    const res = await call<{
      email: string; need_code: boolean;
      code_via: 'totp' | 'email' | null;
      code_sent_to: string | null;
      code_sent: boolean | null;
    }>('login', { email, password });
    return {
      needCode: !!res.need_code,
      via: res.code_via ?? 'totp',
      sentTo: res.code_sent_to ?? null,
      sent: res.code_sent,
    };
  },

  loginCode: (code: string) => call<{ email: string }>('login_code', { code }),

  /** Post the emailed code again, while sign-in is half done. The server
   *  refuses more than one a minute and can only ever mail the account the
   *  pending marker names. */
  loginCodeResend: () =>
    call<{ sent: boolean; to: string }>('login_code_resend', {}),

  // ------------------------------------------ the emailed code as a factor
  //
  // Enrolling is deliberately two steps: otpBegin SENDS one and otpEnable
  // will not switch the factor on until that code comes back. It proves the
  // mail arrives before the door is locked with it — the one way this feature
  // could take the shop away from its owner.

  otpBegin: (password: string, lang: 'ar' | 'en') =>
    call<{ sent: boolean; to: string }>('otp_begin', { password, lang }),

  otpEnable: (code: string) => call<{ ok: true; email_otp: true }>('otp_enable', { code }),

  /** A fresh code for an admin who is already signed in — the one they signed
   *  in with was consumed on use, and changing a password needs a live one. */
  otpSend: () => call<{ sent: boolean; to: string }>('otp_send', {}),

  otpDisable: (password: string, code: string) =>
    call<{ ok: true; email_otp: false }>('otp_disable', { password, code }),

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

  // ---------------------------------------------------------------- settings
  //
  // THE PROMO BAR IS READ FROM THE STOREFRONT ROUTE, NOT AN ADMIN ONE.
  // admin.php has settings_save but no settings_get; the current values come
  // back on api.php?r=slides, which is where the storefront itself reads them.
  // That is not a workaround — it is the right source. Reading the panel's
  // idea of the bar from a different endpoint than the shop's would let the
  // two disagree, and the disagreement would be invisible until a customer
  // saw a bar the panel said was off.
  promoBar: async (): Promise<PromoBar> => {
    const res = await fetch(`${API_BASE}/api.php?r=slides`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`slides: HTTP ${res.status}`);
    const w = ((await res.json()) as { promo_bar?: WirePromoBar }).promo_bar;
    return {
      enabled: !!w?.enabled,
      textEn: w?.text_en ?? '',
      textAr: w?.text_ar ?? '',
      href: w?.href ?? '',
      // The server stores a datetime and the panel edits a date. Trimming to
      // ten characters here rather than in the screen keeps every consumer
      // reading the same thing.
      startsAt: w?.starts_at ? w.starts_at.slice(0, 10) : null,
      endsAt: w?.ends_at ? w.ends_at.slice(0, 10) : null,
    };
  },

  savePromoBar: (v: PromoBar) =>
    call<WirePromoBar>('settings_save', {
      name: 'promo_bar',
      value: {
        enabled: v.enabled,
        text_en: v.textEn,
        text_ar: v.textAr,
        href: v.href,
        starts_at: v.startsAt,
        ends_at: v.endsAt,
      },
    }),

  /** Also the storefront's own route, for the same reason as the bar. */
  contact: async (): Promise<ContactDetails> => {
    const res = await fetch(`${API_BASE}/api.php?r=contact`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`contact: HTTP ${res.status}`);
    const w = (await res.json()) as WireContact;
    return {
      phone: w.phone ?? '',
      whatsapp: w.whatsapp ?? '',
      email: w.email ?? '',
      addressAr: w.address_ar ?? '',
      addressEn: w.address_en ?? '',
      hoursAr: w.hours_ar ?? '',
      hoursEn: w.hours_en ?? '',
      instagram: w.instagram ?? '',
    };
  },

  saveContact: (v: ContactDetails) =>
    call<WireContact>('settings_save', {
      name: 'contact',
      value: {
        phone: v.phone,
        whatsapp: v.whatsapp,
        email: v.email,
        address_ar: v.addressAr,
        address_en: v.addressEn,
        hours_ar: v.hoursAr,
        hours_en: v.hoursEn,
        instagram: v.instagram,
      },
    }),

  // ----------------------------------------------------------------- footer
  //
  // READ FROM THE STOREFRONT ROUTE, like the promo bar and the contact details
  // and unlike the KNET id below. The footer is public text: the shop reads it
  // from api.php?r=footer to paint the page, so the panel reads the same place
  // and the two cannot drift apart without somebody seeing it.
  footer: async (): Promise<FooterText> => {
    const res = await fetch(`${API_BASE}/api.php?r=footer`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`footer: HTTP ${res.status}`)
    // THE SERVER SPEAKS snake_case, the panel camelCase — the same boundary
    // every other shape in this file crosses, and the same place to get it
    // wrong. Reading w.taglineAr off a response that says tagline_ar returns
    // undefined for all ten fields, which looks exactly like "nothing is set".
    const w = (await res.json()) as Record<string, unknown>
    const g = (k: string) => (typeof w[k] === 'string' ? (w[k] as string) : '')
    return {
      taglineAr: g('tagline_ar'), taglineEn: g('tagline_en'),
      clubTitleAr: g('club_title_ar'), clubTitleEn: g('club_title_en'),
      clubTextAr: g('club_text_ar'), clubTextEn: g('club_text_en'),
      rightsAr: g('rights_ar'), rightsEn: g('rights_en'),
      managedAr: g('managed_ar'), managedEn: g('managed_en'),
    }
  },

  saveFooter: (v: FooterText) =>
    call<{ ok: true }>('settings_save', {
      name: 'footer',
      value: {
        tagline_ar: v.taglineAr, tagline_en: v.taglineEn,
        club_title_ar: v.clubTitleAr, club_title_en: v.clubTitleEn,
        club_text_ar: v.clubTextAr, club_text_en: v.clubTextEn,
        rights_ar: v.rightsAr, rights_en: v.rightsEn,
        managed_ar: v.managedAr, managed_en: v.managedEn,
      },
    }),

  // ------------------------------------------------------------------- knet
  //
  // READ FROM AN ADMIN ROUTE, unlike the promo bar and the contact details
  // above. Those two deliberately come back from api.php?r=slides so the panel
  // and the shop can never disagree about them. api.php is public, and the
  // Tranportal ID is not something to hand to anyone who asks — so this one
  // has its own route on admin.php, behind the session.
  //
  // `source` is 'file' when nothing is saved, meaning knet/config.php's ID is
  // the one taking payments. The screen needs that to avoid showing an empty
  // box beside a shop that is charging cards perfectly well.
  knetSettings: () => call<{ tranportal_id: string; source: 'file' | 'database' }>('knet'),

  /** Empty clears the saved value and hands the gateway back to
   *  knet/config.php — the way out if a saved ID turns out to be wrong. */
  saveKnetId: (tranportalId: string) =>
    call<{ tranportal_id: string }>('settings_save', {
      name: 'knet',
      value: { tranportal_id: tranportalId.trim() },
    }),

  // ------------------------------------------------------- product photographs
  //
  // Every garment, with its brand, so the uploader can narrow by brand then by
  // size then by sku. TWO REQUESTS, because the server offers the two halves
  // separately: ?r=variants knows sizes and skus but not brands, ?r=products_all
  // knows brands but not sizes. Joining them here is cheaper than a new
  // endpoint and keeps admin.php as it is.
  uploadTargets: async (): Promise<UploadTarget[]> => {
    const [variants, products] = await Promise.all([
      call<{ sku: string; slug: string; name_en: string | null; size: string }[]>('variants'),
      call<{ slug: string; name_en: string; brand_slug: string | null }[] |
           { products: { slug: string; name_en: string; brand_slug: string | null }[] }>('products_all'),
    ]);
    const rows = Array.isArray(products) ? products : products.products;
    const brandOf = new Map(rows.map((p) => [p.slug, p.brand_slug ?? null]));
    const nameOf = new Map(rows.map((p) => [p.slug, p.name_en]));
    return variants.map((v) => ({
      sku: v.sku,
      slug: v.slug,
      name: nameOf.get(v.slug) ?? v.name_en ?? v.slug,
      size: v.size,
      brandSlug: brandOf.get(v.slug) ?? null,
    }));
  },

  productImages: async (slug: string): Promise<ProductImage[]> => {
    const r = await call<{ images: WireProductImage[] }>(
      `product_images&slug=${encodeURIComponent(slug)}`);
    // The server sends a RELATIVE url — 'api.php?r=product_image&id=…' — because
    // the website serves the panel from the same folder. The app does not, so
    // it is made absolute here rather than in each screen that renders one.
    return (r.images ?? []).map((i) => ({
      ...i,
      url: i.url.startsWith('http') ? i.url : `${API_BASE}/${i.url}`,
    }));
  },

  /** `image` is a data: URI, ALREADY DOWNSCALED — see lib/shrink-image. The
   *  server refuses anything over ~900 kB of base64, which a phone photograph
   *  exceeds several times over, and it refuses SVG outright. */
  addProductImage: (slug: string, image: string, width: number, height: number) =>
    call<{ id: number; url: string }>('product_image_add', { slug, image, width, height }),

  deleteProductImage: (id: number) => call<{ ok: true }>('product_image_delete', { id }),

  /** The whole order at once, as ids in the order they should appear. The
   *  first is the product's main photograph. */
  reorderProductImages: (slug: string, ids: number[]) =>
    call<{ ok: true }>('product_image_reorder', { slug, ids }),

  // ------------------------------------------------------------------ brands

  /** Every brand, shown or hidden, in the order the storefront lists them.
   *  `logo` is a data URI or null — brands are few and the logos are small, so
   *  the server sends them with the list rather than as one request each. */
  brands: () => call<Brand[]>('brands'),

  /** Create or rename. ONE call for both, because the server is one route and
   *  the difference is whether an id came with it — mirroring that here keeps
   *  the screen's single form honest instead of inventing a second endpoint
   *  the server does not have.
   *
   *  `logo` follows the server's three-way convention exactly: leave it
   *  undefined to keep the logo that is there, pass a data URI to replace it,
   *  pass '' to remove it. Undefined and empty string mean different things,
   *  which is why this takes `logo?: string` rather than `logo: string | null`
   *  — null would have to pick one of the two and would silently be the wrong
   *  one half the time. */
  saveBrand: (b: {
    id?: number;
    name_en: string;
    name_ar: string;
    slug?: string;
    sort?: number;
    logo?: string;
  }) => call<Brand>('brand_save', b),

  /** Show it or stop showing it. There is deliberately no delete: a brand with
   *  orders behind it is history, and hiding is the reversible answer. */
  setBrandActive: (id: number, active: boolean) =>
    call<{ id: number; slug: string; active: boolean }>('brand_active', { id, active }),

  // ------------------------------------------------------- سبورتا AI answers

  /** Every taught answer, shown first, then by how often it has fired. The
   *  order is the server's and is deliberate: the ones earning their place sit
   *  at the top of the screen. */
  qa: () => call<Qa[]>('qa'),

  /** Create or edit — one route, one form, the difference is whether an id
   *  came with it. The server refuses a row with no question phrase and a row
   *  missing either answer, so the screen checks the same two things first and
   *  saves the round trip. */
  saveQa: (q: {
    id?: number;
    q_ar: string;
    q_en: string;
    a_ar: string;
    a_en: string;
  }) => call<Qa>('qa_save', q),

  /** Stop giving this answer, or start again. No delete: an answer that turned
   *  out to be wrong has to stop immediately AND stay readable by whoever asks
   *  why the shop said it. */
  setQaActive: (id: number, active: boolean) =>
    call<{ id: number; active: boolean }>('qa_active', { id, active }),

  /** What would fire if a customer typed this. Read-only — it counts no hit
   *  and hands nothing off. It exists because the one mistake this design
   *  invites is writing the phrase as a sentence, and this is how that shows up
   *  before a customer finds it. Returns the row's id, or null for no match. */
  tryQa: (message: string) =>
    call<{ id: number | null; words: number }>('qa_try', { message }),

  deleteDiscount: (id: number) => call<{ ok: true }>('discount_delete', { id }),

  // ----------------------------------------------------------------- returns

  /** Every return and exchange request, newest first, with its lines. The
   *  server sends the lines WITH the list — one request per screen, not one
   *  per row — so nothing here fans out. */
  returns: async (status?: ReturnStatus | 'all') => {
    const q = status && status !== 'all' ? `returns&status=${status}` : 'returns';
    const res = await call<{ returns: WireReturn[]; counts: Record<string, number> }>(q);
    return { returns: (res.returns ?? []).map(toReturn), counts: res.counts ?? {} };
  },

  /** Move a request along. `note` is REQUIRED by the server for a rejection —
   *  a customer told no is told why — and is optional everywhere else. */
  setReturnStatus: (id: number, status: ReturnStatus, note?: string) =>
    call<{ ok: true }>('return_status', { id, status, note: note ?? null }),
};
