"use client";

import { loadSupabase, supabaseEnabled } from "@/lib/supabase";
import {
  describeNetError,
  isDefinitelyOffline,
  isRetryableSupabaseError,
  retry,
} from "@/lib/net";
import { toArabicDigits, type Place } from "@/lib/places";

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

/* ── money ──────────────────────────────────────────────────────────────
   Kuwait's dinar has three decimal places, not two: 1.250 KWD is one dinar
   and 250 fils. Prices are integer fils throughout, because 0.1 + 0.2 in
   binary floating point is not 0.3, and money that is out by a thousandth is
   money that is wrong. Formatting to a decimal happens once, at the edge. */

export const FILS_PER_DINAR = 1000;

/** "٢٫٧٥٠ د.ك" — Arabic-Indic digits and the Arabic decimal separator, to
 *  match every other number on the site. */
export function formatKwd(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(Math.round(fils));
  const dinars = Math.floor(abs / FILS_PER_DINAR);
  const rest = String(abs % FILS_PER_DINAR).padStart(3, "0");
  return `${sign}${toArabicDigits(dinars)}٫${toArabicDigits(rest)} د.ك`;
}

/** Parse "2.750" or "٢٫٧٥٠" into fils. Returns null for anything unparseable,
 *  so an admin typo becomes a visible error rather than a silent zero. */
export function parseKwd(value: string): number | null {
  const western = value
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[،,\s]/g, "");
  if (!/^\d{1,5}(\.\d{0,3})?$/.test(western)) return null;
  const [whole, frac = ""] = western.split(".");
  return Number(whole) * FILS_PER_DINAR + Number(frac.padEnd(3, "0"));
}

export interface MenuItem {
  /** Stable within one place; used as the line key on an order. */
  id: string;
  nameAr: string;
  /** Integer fils. */
  priceFils: number;
  noteAr?: string;
  /** An item can be listed but unavailable today without being deleted. */
  soldOut?: boolean;
}

export interface OrderLine {
  id: string;
  nameAr: string;
  priceFils: number;
  qty: number;
}

export const MAX_QTY_PER_ITEM = 20;
export const MAX_LINES = 20;

export function lineTotal(line: OrderLine): number {
  return line.priceFils * line.qty;
}

export function orderTotal(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

/**
 * Pickup slots for the rest of today, on the half hour.
 *
 * `from` is passed in rather than read here so this is testable and so a
 * component renders the same slots it validated against — reading the clock
 * twice across a render is how a slot becomes bookable one moment and gone
 * the next.
 */
export function pickupSlots(from: Date, count = 8): { value: string; labelAr: string }[] {
  const out: { value: string; labelAr: string }[] = [];
  const t = new Date(from);
  // The soonest sensible collection: round up to the next half hour, plus a
  // half hour for the business to actually make it.
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 30);
  t.setMinutes(t.getMinutes() <= 30 ? 30 : 60, 0, 0);
  for (let i = 0; i < count; i++) {
    const h = t.getHours();
    const m = t.getMinutes();
    const period = h < 12 ? "ص" : "م";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({
      value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      labelAr: `${toArabicDigits(h12)}:${toArabicDigits(String(m).padStart(2, "0"))} ${period}`,
    });
    t.setMinutes(t.getMinutes() + 30);
  }
  return out;
}

/**
 * The order's id and the secret that proves it is yours.
 *
 * Both are made here, on the customer's device, and that is not a stylistic
 * choice. Anon has no SELECT policy on orders, and PostgreSQL checks the
 * SELECT policy on any row an `INSERT ... RETURNING` hands back — so asking
 * the database for the id it had just generated made the entire insert roll
 * back, and no order could be placed at all. The customer brings its own id,
 * keeps it, and uses it with the token to read the order's state back through
 * a function that is allowed to look.
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
}

const STORE_KEY = "wain:orders";
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
 * Goes through order_status(), which reaches past the deny-all SELECT policy
 * but only for a caller holding both the id and the token. It returns nothing
 * that identifies the customer — no name, no phone — so even a leaked token
 * discloses only what its holder already knew.
 *
 * Retried: the function is declared `stable` and reads one row, so asking
 * twice costs a round trip and changes nothing.
 */
export async function fetchOrderState(
  id: string,
  token: string,
  signal?: AbortSignal | null
): Promise<OrderStateResult> {
  if (!supabaseEnabled) return { ok: false, offline: false };
  const sb = await loadSupabase();
  if (!sb) return { ok: false, offline: false };

  let result;
  try {
    result = await retry(
      // Awaited inside, not returned: the query builder is a thenable rather
      // than a real Promise, so handing it straight back loses .catch().
      async () => {
        const q = sb.rpc("order_status", { p_id: id, p_token: token });
        return await (signal ? q.abortSignal(signal) : q);
      },
      { signal, shouldRetry: (r) => isRetryableSupabaseError(r.error) }
    );
  } catch {
    return { ok: false, offline: isDefinitelyOffline() };
  }

  const { data, error } = result;
  if (error) return { ok: false, offline: isDefinitelyOffline() };
  if (!Array.isArray(data) || data.length === 0) return { ok: true, state: null };

  const r = data[0] as Record<string, unknown>;
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

export interface OrderInput {
  placeSlug: string;
  placeNameAr: string;
  lines: OrderLine[];
  pickupAt: string;
  customerName: string;
  customerPhone: string;
  noteAr: string;
}

export type OrderResult =
  | { ok: true; reference: string; tracked: TrackedOrder }
  | { ok: false; reason: "disabled" | "invalid" | "network"; message: string };

/** Short, readable, and said out loud at a counter without confusion. */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** Kuwaiti mobile numbers are eight digits and start 5, 6 or 9. */
export function normalisePhone(value: string): string | null {
  const digits = value
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\d]/g, "")
    .replace(/^00965/, "")
    .replace(/^965(?=\d{8}$)/, "");
  return /^[569]\d{7}$/.test(digits) ? digits : null;
}

export function validateOrder(input: OrderInput): string[] {
  const errs: string[] = [];
  if (input.lines.length === 0) errs.push("ما اخترت شي بعد.");
  if (input.lines.length > MAX_LINES) errs.push("الطلب كبير — قلّل الأصناف.");
  if (input.lines.some((l) => l.qty < 1 || l.qty > MAX_QTY_PER_ITEM))
    errs.push(`الكمية لازم تكون بين ١ و ${toArabicDigits(MAX_QTY_PER_ITEM)}.`);
  if (input.lines.some((l) => !Number.isInteger(l.priceFils) || l.priceFils < 0))
    errs.push("في سعر مو مضبوط.");
  if (input.customerName.trim().length < 2) errs.push("اكتب اسمك.");
  if (!normalisePhone(input.customerPhone)) errs.push("اكتب رقم كويتي صحيح (٨ أرقام).");
  if (!/^\d{2}:\d{2}$/.test(input.pickupAt)) errs.push("اختر وقت الاستلام.");
  return errs;
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

  if (!supabaseEnabled) {
    return {
      ok: false,
      reason: "disabled",
      message: "الطلب المسبق مو متاح حالياً. اتصل بالمكان مباشرة.",
    };
  }
  const sb = await loadSupabase();
  if (!sb) return { ok: false, reason: "disabled", message: "الطلب المسبق مو متاح حالياً." };

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
      async () => {
        // No .select() here on purpose — see newOrderId(). Asking for the row
        // back makes PostgreSQL apply the SELECT policy to it, and anon has
        // none, so the insert would roll back and the order would never exist.
        const q = sb.from("orders").insert({
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
          status: "placed",
        });
        return await (signal ? q.abortSignal(signal) : q);
      },
      { signal, shouldRetry: (r) => isRetryableSupabaseError(r.error) }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: describeNetError(err, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
    };
  }

  const { error } = result;
  if (!error) return succeed();

  // 23505 is unique_violation on the primary key: this exact order is already
  // in the table. The first attempt landed and only its reply was lost, so
  // this is a success — and reporting it as one is what stops a customer with
  // a bad signal from pressing send until the shop has four of everything.
  if (error.code === "23505") return succeed();

  if (error.code === "23514")
    return { ok: false, reason: "invalid", message: "في معلومة مو مضبوطة. راجع الطلب." };

  return {
    ok: false,
    reason: "network",
    message: describeNetError(error, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
  };
}

/** Whether a place can take a pre-order at all. */
export function acceptsOrders(place: Place): boolean {
  return Boolean(place.acceptsOrders && (place.menuAr?.length ?? 0) > 0);
}
