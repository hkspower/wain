/**
 * Kuwaiti dinar arithmetic.
 *
 * KWD has THREE decimal places, and every amount in this app is an integer
 * number of fils — 1 KWD = 1000 fils. Nothing is ever a float. 0.1 + 0.2 is
 * not 0.3 in IEEE 754, and a shop that adds prices in floats eventually shows
 * a basket that does not equal the sum of its lines. The web storefront and
 * the PHP backend both store fils for the same reason, so the wire format
 * needs no conversion in either direction.
 */

export type Fils = number;

export const toFils = (kwd: number): Fils => Math.round(kwd * 1000);
export const toKwd = (fils: Fils): number => fils / 1000;

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * "12.500 KD" / "١٢٫٥٠٠ د.ك"
 *
 * Arabic renders Eastern Arabic numerals with the Arabic decimal separator
 * (U+066B), which is what a Kuwaiti price tag looks like. The digits are
 * mapped by hand rather than left to toLocaleString: React Native's Hermes
 * ships a cut-down ICU on Android, so the same call that formats correctly on
 * iOS can silently return Western digits there.
 */
export function formatPrice(fils: Fils, lang: 'ar' | 'en'): string {
  const negative = fils < 0;
  const n = Math.abs(Math.round(fils));
  const whole = Math.floor(n / 1000);
  const frac = String(n % 1000).padStart(3, '0');

  if (lang === 'en') {
    const grouped = whole.toLocaleString('en-US');
    return `${negative ? '-' : ''}${grouped}.${frac} KD`;
  }

  const ar = (s: string) => s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
  const grouped = whole.toLocaleString('en-US').replace(/,/g, '٬');
  return `${negative ? '؜-' : ''}${ar(grouped)}٫${ar(frac)} د.ك`;
}

/**
 * WHAT THE OWNER TYPED, BACK INTO A NUMBER.
 *
 * formatPrice above WRITES Eastern Arabic numerals, and until now nothing in
 * this app could read them: `Number('٥')` is NaN, and `/^\d+$/` and
 * `/[^\d.]/` are ASCII-only in JavaScript unless asked otherwise. So a price
 * shown in Arabic could not be typed back in Arabic — the round trip through
 * the shop's own default language was lossy, and the failure was silent
 * because each screen coerced the unparseable result to zero or to NaN rather
 * than refusing it.
 *
 * ٫ is the Arabic DECIMAL separator (U+066B) and ٬ the THOUSANDS one
 * (U+066C) — both of which formatPrice emits, so both have to come back.
 *
 * THE WESTERN COMMA IS TWO DIFFERENT CHARACTERS, and which one it is depends
 * on what else is in the string. This was not the first answer: the rule used
 * to be "a comma is always a decimal point", inherited from the shop rules
 * screen, where it is right — an Arabic keyboard offers a comma where a Latin
 * one offers a full stop, and refusing it makes the field look broken to the
 * person most likely to use it.
 *
 * The round-trip test then failed on one case out of twenty, and it was the
 * interesting one: `formatPrice(1234567, 'en')` writes "1,234.567", where the
 * comma is a THOUSANDS separator. So the formatter and the parser disagreed
 * about the same character, and the disagreement only showed above a thousand
 * dinars — a price no rig had thought to try. Arabic never had the problem,
 * because ٫ and ٬ are different characters.
 *
 *   a dot is present   every comma is a thousands separator -> dropped
 *   no dot at all      a single comma is the decimal point  -> becomes one
 *
 * "1,500" is therefore one and a half dinars, which is what a Kuwaiti price
 * tag means by it, and "1,234.567" is one thousand two hundred and thirty-four.
 * "1,234,567" has two commas and no dot, so it parses as nothing at all and is
 * refused — which is the right answer for a string this shop never writes.
 */
const FROM_ARABIC: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '٫': '.', '٬': '',
};

export const normaliseDigits = (text: string): string =>
  text.replace(/[٠-٩٫٬]/g, (c) => FROM_ARABIC[c] ?? c);

/**
 * A typed amount in KWD → integer fils, or null.
 *
 * NULL RATHER THAN ZERO, and that is the whole point of it existing. The
 * promotions screen used `Number(v.replace(/[^\d.]/g, '')) || 0`, which turns
 * anything it cannot read into a silent zero — on the one screen in this panel
 * where a wrong number costs money. A refusal the caller has to handle is the
 * only safe shape.
 *
 * Three decimals, no more: KWD has exactly three and `Number('1.2345')`
 * rounding to 1.235 behind the owner's back is a price they did not set.
 */
export function parseAmount(text: string): Fils | null {
  const t = normaliseDigits(text).trim();
  const raw = t.includes('.') ? t.replace(/,/g, '') : t.replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) return null;
  return Math.round(parseFloat(raw) * 1000);
}

/** A typed whole number — a stock count, a usage limit, a percentage — or
 *  null. Same refusal rule as parseAmount, and the same Arabic digits. */
export function parseCount(text: string): number | null {
  const raw = normaliseDigits(text).trim();
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
}

/** fils → the three-decimal KWD string this shop writes into an input. Not
 *  formatPrice: that one is for READING, with a currency name and grouped
 *  thousands, and neither belongs in a box somebody is about to edit. */
export const filsToInput = (fils: Fils): string => (fils / 1000).toFixed(3);

/**
 * A plain number in the reader's own digits.
 *
 * Arabic copy with Western numerals is the giveaway that a string was
 * assembled by a programme rather than written — «وفّر 21%» beside «١١٫٠٠٠ د.ك»
 * in the same card, with the price localised and the discount not. Every count
 * that reaches a screen goes through here.
 */
export function formatNumber(n: number, lang: 'ar' | 'en'): string {
  const s = String(Math.round(n));
  return lang === 'en' ? s : s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/** Percentage off, rounded to a whole number for the badge. */
export function discountPercent(price: Fils, was: Fils): number {
  if (!was || was <= price) return 0;
  return Math.round(((was - price) / was) * 100);
}
