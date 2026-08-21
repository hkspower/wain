"use client";

import { loadSupabase, supabaseEnabled } from "@/lib/supabase";
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
  | { ok: true; reference: string }
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

export async function submitOrder(input: OrderInput): Promise<OrderResult> {
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
  const { data, error } = await sb
    .from("orders")
    .insert({
      place_slug: input.placeSlug,
      place_name_ar: input.placeNameAr,
      // The line prices are stored as sent, so the business sees exactly what
      // the customer was shown — a mismatch with its own menu is visible to a
      // human rather than silently reconciled.
      lines: input.lines,
      total_fils: orderTotal(input.lines),
      pickup_at: input.pickupAt,
      customer_name: input.customerName.trim(),
      customer_phone: phone,
      note_ar: input.noteAr.trim(),
      status: "placed",
    })
    .select("id")
    .single();

  if (!error && data) return { ok: true, reference: orderReference(String(data.id)) };
  if (error?.code === "23514")
    return { ok: false, reason: "invalid", message: "في معلومة مو مضبوطة. راجع الطلب." };
  return {
    ok: false,
    reason: "network",
    message: "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية.",
  };
}

/** Whether a place can take a pre-order at all. */
export function acceptsOrders(place: Place): boolean {
  return Boolean(place.acceptsOrders && (place.menuAr?.length ?? 0) > 0);
}
