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

/** Percentage off, rounded to a whole number for the badge. */
export function discountPercent(price: Fils, was: Fils): number {
  if (!was || was <= price) return 0;
  return Math.round(((was - price) / was) * 100);
}
