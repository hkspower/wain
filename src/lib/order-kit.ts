import {
  DEFAULT_PREP_MINUTES,
  clampPrepMinutes,
  toArabicDigits,
} from "@/lib/place-kit";

/**
 * The pure half of طلب مسبق: money, slots, the reference, the phone shape,
 * validation, and the WhatsApp message an order becomes when there is no
 * database to send it to.
 *
 * Nothing in here may import the catalogue or `backend.ts` — the `place-kit`
 * rule. `orders.ts` (the half that talks to a back end and to localStorage)
 * re-exports all of it, so existing callers keep their import; what this
 * split buys is a module the Flutter app can be replayed against byte for
 * byte, and a place page that can send an order without carrying the
 * back-end client when the build has the back end switched off.
 *
 * Deliberately not a payment system — see the header in orders.ts. The word
 * «مدفوع» appears nowhere, and the message below says who pays and when.
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

/* ── time ───────────────────────────────────────────────────────────── */

/** "18:30" → "٦:٣٠ م". The one place a clock time becomes Arabic, so the
 *  slot list, the confirmation and the WhatsApp message cannot disagree. */
export function timeAr(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const period = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toArabicDigits(h12)}:${toArabicDigits(m[2])} ${period}`;
}

/**
 * Pickup slots for the rest of today, on the half hour.
 *
 * `from` is passed in rather than read here so this is testable and so a
 * component renders the same slots it validated against — reading the clock
 * twice across a render is how a slot becomes bookable one moment and gone
 * the next.
 */
export function pickupSlots(
  from: Date,
  count = 8,
  prepMinutes: number = DEFAULT_PREP_MINUTES
): { value: string; labelAr: string }[] {
  const out: { value: string; labelAr: string }[] = [];
  const t = new Date(from);
  // The soonest sensible collection: the time the business says it needs,
  // rounded up to the next half hour. A blanket half hour was wrong in both
  // directions — too long for a karak somebody wants on the way past, and
  // nowhere near enough for a grill.
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + clampPrepMinutes(prepMinutes));
  t.setMinutes(t.getMinutes() <= 30 ? 30 : 60, 0, 0);
  for (let i = 0; i < count; i++) {
    const value = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    out.push({ value, labelAr: timeAr(value) });
    t.setMinutes(t.getMinutes() + 30);
  }
  return out;
}

/* ── identity ───────────────────────────────────────────────────────── */

/** Short, readable, and said out loud at a counter without confusion. */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** Kuwaiti mobile numbers are eight digits and start 5, 6 or 9. The same
 *  shape serves the customer's phone and a place's `orderWhatsApp`. */
export function normalisePhone(value: string): string | null {
  const digits = value
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\d]/g, "")
    .replace(/^00965/, "")
    .replace(/^965(?=\d{8}$)/, "");
  return /^[569]\d{7}$/.test(digits) ? digits : null;
}

/* ── validation ─────────────────────────────────────────────────────── */

export interface OrderInput {
  placeSlug: string;
  placeNameAr: string;
  lines: OrderLine[];
  pickupAt: string;
  customerName: string;
  customerPhone: string;
  noteAr: string;
}

/** Matches the CHECK on orders.note_ar and the panel's maxLength. */
export const MAX_NOTE_CHARS = 200;

/**
 * `phoneRequired` is false in WhatsApp mode: the shop answers in the thread
 * the customer opened, so the number they would have typed is the number
 * they are writing from. Asking for it anyway is a field with no reader.
 */
export function validateOrder(
  input: OrderInput,
  { phoneRequired = true }: { phoneRequired?: boolean } = {}
): string[] {
  const errs: string[] = [];
  if (input.lines.length === 0) errs.push("ما اخترت شي بعد.");
  if (input.lines.length > MAX_LINES) errs.push("الطلب كبير — قلّل الأصناف.");
  if (input.lines.some((l) => l.qty < 1 || l.qty > MAX_QTY_PER_ITEM))
    errs.push(`الكمية لازم تكون بين ١ و ${toArabicDigits(MAX_QTY_PER_ITEM)}.`);
  if (input.lines.some((l) => !Number.isInteger(l.priceFils) || l.priceFils < 0))
    errs.push("في سعر مو مضبوط.");
  if (input.customerName.trim().length < 2) errs.push("اكتب اسمك.");
  if (phoneRequired && !normalisePhone(input.customerPhone))
    errs.push("اكتب رقم كويتي صحيح (٨ أرقام).");
  if (!/^\d{2}:\d{2}$/.test(input.pickupAt)) errs.push("اختر وقت الاستلام.");
  if (input.noteAr.trim().length > MAX_NOTE_CHARS) errs.push("الملاحظة طويلة.");
  return errs;
}

/* ── the order as a WhatsApp message ────────────────────────────────────
   Without a database the order leaves the site as text to the place's own
   number, and the text IS the order: it has to carry everything a counter
   needs to make it and to find it again — the reference, every line with
   its count, the time, a name — and nothing that overstates what happened.
   «المجموع التقريبي» because the shop charges from its own till; «الدفع عند
   الاستلام» so neither side reads a sent message as a paid one.

   `url` is a parameter rather than read from the page so the Dart port can
   replay the fixture byte for byte. */

export interface OrderMessageInput {
  placeNameAr: string;
  reference: string;
  lines: OrderLine[];
  /** "HH:MM" */
  pickupAt: string;
  customerName: string;
  noteAr?: string;
  /** The place's page, so the shop can see what the customer saw. */
  url: string;
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const items = input.lines.map(
    (l) => `${toArabicDigits(l.qty)}× ${l.nameAr} — ${formatKwd(lineTotal(l))}`
  );
  const note = input.noteAr?.trim();
  return [
    `طلب مسبق من وين — رقم الطلب ${input.reference}`,
    input.placeNameAr,
    "",
    ...items,
    `المجموع التقريبي: ${formatKwd(orderTotal(input.lines))}`,
    "",
    `الاستلام: الساعة ${timeAr(input.pickupAt)}`,
    `الاسم: ${input.customerName.trim()}`,
    ...(note ? [`ملاحظة: ${note}`] : []),
    "",
    "الدفع عند الاستلام 👍",
    input.url,
  ].join("\n");
}

/** `wa.me/965<digits>?text=` — the one WhatsApp link shape that opens a
 *  chat with a specific number on phones, WhatsApp Web and the desktop app
 *  alike. The hangout's `wa.me/?text=` has no number because the visitor
 *  picks the group; an order has exactly one recipient. */
export function whatsappOrderUrl(digits: string, text: string): string {
  return `https://wa.me/965${digits}?text=${encodeURIComponent(text)}`;
}

/** Said to the same thread, so the shop finds the order by its reference. */
export function cancelOrderMessage(reference: string): string {
  return `السلام عليكم، أبي ألغي الطلب رقم ${reference} إذا ما بدأتوا فيه. شكراً`;
}
