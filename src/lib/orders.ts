"use client";

import { ORDERS_STORE_KEY } from "@/lib/live-keys";
import { backendEnabled, call, describeApiFailure, isRetryableApiFailure } from "@/lib/backend";
import { describeNetError, isDefinitelyOffline, retry } from "@/lib/net";
import { acceptsOrders } from "@/lib/place-kit";
import type { Place } from "@/lib/places";
import {
  buildOrderMessage,
  normalisePhone,
  orderReference,
  orderTotal,
  validateOrder,
  whatsappOrderUrl,
  type OrderInput,
  type OrderLine,
} from "@/lib/order-kit";

/**
 * طلب مسبق — order ahead, pay when you collect.
 *
 * Deliberately not a payment system. wain never takes a card, never holds
 * anyone's money, and never sits between a customer and a business: the order
 * is a message saying "have this ready", and the money changes hands at the
 * counter exactly as it would have anyway. That is why nothing here needs a
 * gateway, a merchant account or a server — and why a tampered total cannot
 * cost anyone anything, since the business charges from its own till.
 *
 * The word "مدفوع" appears nowhere for the same reason. Telling someone their
 * order is paid when they have not paid is the one thing this must never do.
 */

/**
 * The pure half — money, slots, the reference, validation and the WhatsApp
 * message — lives in `order-kit.ts` and is re-exported here so every caller
 * that already imports `@/lib/orders` keeps working. New callers that only
 * need the kit should import it directly: this module carries the back-end
 * calls and the device store, which a message builder does not need.
 */
export * from "@/lib/order-kit";

/**
 * Where an order goes. One channel per build, never both.
 *
 * With a database every order is a row the business reads on «الطلبات
 * المسبقة». Without one — which is every build to date — the order leaves
 * the site as a WhatsApp message to the place's own number, and is tracked
 * only on the device that sent it. Two send buttons would be two orders, and
 * a board that saw half of them; so the day the database is switched on,
 * WhatsApp orders stop, and the docs say so. `null` means no panel at all: a
 * place that has not opted in, or has a menu and nowhere for the order to go
 * (audit:places refuses that shape in the catalogue, but a live row can
 * still carry it).
 */
export type OrderChannel = "db" | "whatsapp";

export function orderChannel(place: Place): OrderChannel | null {
  if (!acceptsOrders(place)) return null;
  if (backendEnabled) return "db";
  return place.orderWhatsApp ? "whatsapp" : null;
}

/**
 * The order's id and the secret that proves it is yours.
 *
 * Both are made here, on the customer's device, and that is not a stylistic
 * choice: it is what makes a retry safe. A request sent twice with the same
 * id either writes the row or meets the row it already wrote, and the server
 * answers «placed» both times (`again: true` the second). The token is the
 * customer's proof: the order's state can be read back only by someone
 * holding both, and a wrong pair is answered with nothing rather than with
 * «no such order». (Under Postgres the same pair was also what let an
 * anonymous INSERT work at all — anon had no SELECT policy, so the database
 * could not hand the id back; the reason changed, the shape did not.)
 */
export function newOrderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Older Safari. Only needs to be unique, not unguessable — that is the
  // token's job.
  const h = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

/** 32 hex characters of real randomness. The database requires 20 to 64. */
export function newTrackToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The identity of one attempt to place one basket.
 *
 * Minted once, when the panel opens, and reused for every press of «أرسل
 * الطلب» — which is the whole point. A phone that loses signal after the row
 * has been written but before the response comes back leaves the customer
 * looking at «ما وصل الطلب» beside a button. They press it again. With a fresh
 * id each time, that is a second order, and the shop makes two coffees for one
 * person. With a stable id it is the *same* row: the database refuses the
 * duplicate primary key, and a refused duplicate is proof that the first
 * attempt worked.
 */
export interface OrderAttempt {
  id: string;
  token: string;
}

export function newOrderAttempt(): OrderAttempt {
  return { id: newOrderId(), token: newTrackToken() };
}

export type OrderStatus = "placed" | "ready" | "collected" | "cancelled";

/** What the device remembers so the customer can come back to an order. */
export interface TrackedOrder {
  id: string;
  token: string;
  reference: string;
  placeSlug: string;
  placeNameAr: string;
  totalFils: number;
  pickupAt: string;
  placedAt: string;
  /** Absent on entries written before WhatsApp mode existed; read as "db". */
  channel?: OrderChannel;
  /** The shop's number, WhatsApp mode only — so the card can reopen the thread
   *  even if the place's number changes later. */
  whatsapp?: string;
  /** Kept on the device in WhatsApp mode, because nothing else holds them. */
  lines?: OrderLine[];
  noteAr?: string;
  /** The customer called it off from this device — a different sentence
   *  from the business cancelling it. */
  cancelledByMe?: boolean;
  cancelledAt?: string;
}

/** The customer asked for the order to be cancelled, from here. The database
 *  knows too in db mode; in WhatsApp mode this is the only record. */
export function markCancelledByMe(id: string): void {
  try {
    const all = listOrders().map((o) =>
      o.id === id ? { ...o, cancelledByMe: true, cancelledAt: new Date().toISOString() } : o
    );
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

const STORE_KEY = ORDERS_STORE_KEY;
const KEEP = 20;

export function rememberOrder(order: TrackedOrder): void {
  try {
    const all = [order, ...listOrders().filter((o) => o.id !== order.id)].slice(0, KEEP);
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode — the order is still placed, it just is not remembered */
  }
}

export function listOrders(): TrackedOrder[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is TrackedOrder =>
        !!o && typeof o.id === "string" && typeof o.token === "string" && typeof o.reference === "string"
    );
  } catch {
    return [];
  }
}

export function forgetOrder(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(listOrders().filter((o) => o.id !== id)));
  } catch {
    /* nothing to forget */
  }
}

export interface OrderState {
  status: OrderStatus;
  placeSlug: string;
  placeNameAr: string;
  lines: OrderLine[];
  totalFils: number;
  pickupAt: string;
  noteAr: string;
  createdAt: string;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
}

/**
 * Answered, or not answered.
 *
 * These used to be the same thing: fetchOrderState returned null both when the
 * order was genuinely not there and when the request never made it out of the
 * building, so the screen could not tell "this order is gone" from "your train
 * is in a tunnel". `ok` separates them, and the tracker says something
 * different for each.
 */
export type OrderStateResult =
  | { ok: true; state: OrderState | null }
  | { ok: false; offline: boolean };

/**
 * The live state of one order.
 *
 * `order_status` answers only a caller holding both the id and the token, and
 * returns nothing that identifies the customer — no name, no phone — so even a
 * leaked token discloses only what its holder already knew.
 *
 * Retried: it reads one row and changes nothing, so asking twice costs a
 * round trip and nothing else.
 */
export async function fetchOrderState(
  id: string,
  token: string,
  signal?: AbortSignal | null
): Promise<OrderStateResult> {
  if (!backendEnabled) return { ok: false, offline: false };

  let result;
  try {
    result = await retry(
      () => call<{ order: Record<string, unknown> | null }>("order_status", { id, token }, { signal }),
      { signal, shouldRetry: isRetryableApiFailure }
    );
  } catch {
    return { ok: false, offline: isDefinitelyOffline() };
  }
  if (!result.ok) return { ok: false, offline: isDefinitelyOffline() };
  const r = result.order;
  if (!r) return { ok: true, state: null };

  return {
    ok: true,
    state: {
      status: r.status as OrderStatus,
      placeSlug: String(r.place_slug ?? ""),
      placeNameAr: String(r.place_name_ar ?? ""),
      lines: Array.isArray(r.lines) ? (r.lines as OrderLine[]) : [],
      totalFils: Number(r.total_fils ?? 0),
      pickupAt: String(r.pickup_at ?? ""),
      noteAr: String(r.note_ar ?? ""),
      createdAt: String(r.created_at ?? ""),
      readyAt: (r.ready_at as string) ?? null,
      collectedAt: (r.collected_at as string) ?? null,
      cancelledAt: (r.cancelled_at as string) ?? null,
    },
  };
}

/** Nothing will change after these, so there is nothing left to poll for. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === "collected" || status === "cancelled";
}

export type CancelResult =
  | { ok: true }
  /** The business already started: the food exists, so this is a phone call. */
  | { ok: false; reason: "too-late"; status: OrderStatus; message: string }
  | { ok: false; reason: "unknown" | "network"; message: string };

/**
 * Call the order off.
 *
 * Not retried. A repeat would be harmless — cancelling twice answers
 * 'cancelled' — but a write that has not been proven safe to repeat is not
 * repeated here. One attempt, and the customer can press again.
 */
export async function cancelOrder(
  id: string,
  token: string,
  signal?: AbortSignal | null
): Promise<CancelResult> {
  if (!backendEnabled) {
    return { ok: false, reason: "network", message: "ما نقدر نلغي الحين. اتصل بالمكان." };
  }

  let result;
  try {
    result = await call<{ status: string | null }>("order_cancel", { id, token }, { signal });
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: describeNetError(err, "ما وصل الإلغاء. جرّب مرة ثانية."),
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      reason: "network",
      message: describeApiFailure(result, "ما وصل الإلغاء. جرّب مرة ثانية."),
    };
  }

  // null means no row matched the id and token pair — which for a device that
  // is holding both should not happen, so it is reported rather than hidden.
  if (result.status === null || result.status === undefined) {
    return {
      ok: false,
      reason: "unknown",
      message: "ما لقينا الطلب. اتصل بالمكان عشان يلغونه.",
    };
  }

  const status = String(result.status) as OrderStatus;
  if (status === "cancelled") return { ok: true };

  return {
    ok: false,
    reason: "too-late",
    status,
    message:
      status === "collected"
        ? "الطلب متسلّم أصلاً."
        : "المكان بدأ يجهّز طلبك، فما نقدر نلغيه من هني. اتصل فيهم لو تبي تلغي.",
  };
}

export type OrderResult =
  | { ok: true; reference: string; tracked: TrackedOrder }
  | { ok: false; reason: "disabled" | "invalid" | "network"; message: string };

export type WhatsAppOrderResult =
  | {
      ok: true;
      reference: string;
      tracked: TrackedOrder;
      /** false when the popup was blocked: the caller shows the text and a
       *  plain link, which a gesture-driven anchor can always open. */
      opened: boolean;
      text: string;
      url: string;
    }
  | { ok: false; reason: "invalid"; message: string };

/**
 * Send one basket to the shop's WhatsApp.
 *
 * Synchronous on purpose, and the caller must call it inside the tap: Safari
 * and Chrome block a `window.open` that follows an `await`, so a validation
 * that went to the network first would turn every send into «blocked». The
 * order is remembered BEFORE the window opens — a tab that opens and is lost
 * is still an order the customer sent, and «طلباتي» has to show it.
 *
 * `opener` is nulled rather than passing `noopener` as a feature: with the
 * feature, `window.open` returns null on success as well as on a block, and
 * the two cannot be told apart.
 */
export function sendWhatsAppOrder(
  input: OrderInput,
  digits: string,
  attempt: OrderAttempt,
  pageUrl: string
): WhatsAppOrderResult {
  const problems = validateOrder(input, { phoneRequired: false });
  if (problems.length) return { ok: false, reason: "invalid", message: problems[0] };

  const reference = orderReference(attempt.id);
  const text = buildOrderMessage({
    placeNameAr: input.placeNameAr,
    reference,
    lines: input.lines,
    pickupAt: input.pickupAt,
    customerName: input.customerName,
    noteAr: input.noteAr,
    url: pageUrl,
  });
  const url = whatsappOrderUrl(digits, text);

  const tracked: TrackedOrder = {
    id: attempt.id,
    token: attempt.token,
    reference,
    placeSlug: input.placeSlug,
    placeNameAr: input.placeNameAr,
    totalFils: orderTotal(input.lines),
    pickupAt: input.pickupAt,
    placedAt: new Date().toISOString(),
    channel: "whatsapp",
    whatsapp: digits,
    lines: input.lines,
    noteAr: input.noteAr.trim(),
  };
  rememberOrder(tracked);

  let opened = false;
  try {
    const w = window.open(url, "_blank");
    if (w) {
      w.opener = null;
      opened = true;
    }
  } catch {
    /* blocked — the caller offers the text and a link */
  }
  return { ok: true, reference, tracked, opened, text, url };
}

/**
 * Send one basket.
 *
 * `attempt` carries the id and token, and the caller keeps it across retries —
 * see OrderAttempt. That is what makes this safe to send more than once: the
 * insert is keyed on an id the device chose, so a repeat either writes the row
 * or collides with the row it already wrote. Both mean the order exists.
 */
export async function submitOrder(
  input: OrderInput,
  attempt: OrderAttempt = newOrderAttempt(),
  signal?: AbortSignal | null
): Promise<OrderResult> {
  const problems = validateOrder(input);
  if (problems.length) return { ok: false, reason: "invalid", message: problems[0] };

  if (!backendEnabled) {
    return {
      ok: false,
      reason: "disabled",
      message: "الطلب المسبق مو متاح حالياً. اتصل بالمكان مباشرة.",
    };
  }

  const phone = normalisePhone(input.customerPhone);
  const { id, token } = attempt;
  const totalFils = orderTotal(input.lines);

  const succeed = (): OrderResult => {
    const tracked: TrackedOrder = {
      id,
      token,
      reference: orderReference(id),
      placeSlug: input.placeSlug,
      placeNameAr: input.placeNameAr,
      totalFils,
      pickupAt: input.pickupAt,
      placedAt: new Date().toISOString(),
    };
    rememberOrder(tracked);
    return { ok: true, reference: tracked.reference, tracked };
  };

  let result;
  try {
    result = await retry(
      () =>
        call<{ again: boolean }>(
          "order_place",
          {
            id,
            track_token: token,
            place_slug: input.placeSlug,
            place_name_ar: input.placeNameAr,
            // The line prices are stored as sent, so the business sees exactly
            // what the customer was shown — a mismatch with its own menu is
            // visible to a human rather than silently reconciled.
            lines: input.lines,
            total_fils: totalFils,
            pickup_at: input.pickupAt,
            customer_name: input.customerName.trim(),
            customer_phone: phone,
            note_ar: input.noteAr.trim(),
          },
          { signal }
        ),
      { signal, shouldRetry: isRetryableApiFailure }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: describeNetError(err, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
    };
  }

  // `again: true` is the first attempt's reply arriving by another road: the
  // row was written, only the answer was lost. Either way the order exists.
  if (result.ok) return succeed();

  // `duplicate` is the same fact seen from the server's side — this id is
  // already in the table — and reporting it as a success is what stops a
  // customer with a bad signal from pressing send until the shop has four of
  // everything.
  if (result.error === "duplicate") return succeed();

  if (result.error === "invalid")
    return { ok: false, reason: "invalid", message: "في معلومة مو مضبوطة. راجع الطلب." };

  // The place is not taking orders (or is unpublished) as far as the server
  // knows — the panel was drawn from a snapshot the admin has since changed.
  if (result.error === "closed")
    return { ok: false, reason: "disabled", message: "المكان مو مستقبل طلبات مسبقة الحين. اتصل فيهم مباشرة." };

  return {
    ok: false,
    reason: "network",
    message: describeApiFailure(result, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
  };
}

/**
 * Whether a place can take a pre-order at all.
 *
 * Defined in `place-kit.ts` and re-exported here, so callers that already import
 * this module keep working while callers that only want the question — the
 * search page — can ask it without pulling in the back-end calls. See the
 * note there.
 */
export { acceptsOrders } from "@/lib/place-kit";
