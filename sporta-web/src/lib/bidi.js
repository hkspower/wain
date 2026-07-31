// Bidirectional text, for documents that mix Arabic with Latin and digits.
//
// An invoice is the worst case for bidi on this whole site. It is Arabic prose
// wrapped around order numbers, dates, quantities, sizes and money — every one
// of them a left-to-right run sitting inside a right-to-left paragraph. The
// Unicode bidi algorithm resolves those runs by looking at the characters
// AROUND them, so a neutral character on the edge of a run (a +, a #, a hyphen,
// a colon, a full stop, a bracket) gets pulled to whichever side the algorithm
// decides, and the text renders in an order nobody typed.
//
// Concretely, and all three were real:
//
//   +965 99887766   in an Arabic line renders as   99887766 965+
//   SP1A2B3C.       renders as                     .SP1A2B3C
//   Block 4, Street 12   with Arabic either side, the comma migrates
//
// The fix is ISOLATION, not just direction. `dir="ltr"` sets the base direction
// of the run; isolation is what stops the run from participating in the
// surrounding paragraph's ordering at all. In CSS that is `unicode-bidi:
// isolate`, which `dir` on an element already implies in every current browser.
// In a plain string — an email body, a filename, an aria-label — there is no
// element to hang it on, so the Unicode isolate characters do the same job.

// U+2066 LEFT-TO-RIGHT ISOLATE ... U+2069 POP DIRECTIONAL ISOLATE
const LRI = '⁦'
const PDI = '⁩'

// Wrap a left-to-right run so it survives inside Arabic text.
//
// Use this for anything that is read left to right regardless of the language
// around it: order numbers, phone numbers, dates, SKUs, model names, IBANs.
// It is a no-op visually in an English page, so it is always safe to apply.
export const ltr = (s) => (s == null || s === '' ? '' : `${LRI}${s}${PDI}`)

// Strip the isolates again — for comparisons, tests, and anywhere the string
// is going somewhere that does not render them (a URL, a database column).
export const unbidi = (s) => String(s ?? '').replace(/[⁦-⁩‪-‮‎‏]/g, '')

// Does this string contain Arabic letters?
// Used to decide whether a product name needs its own direction, since the
// catalogue mixes "Cloudsoft Jacket" with "جاكيت كلاودسوفت".
export const hasArabic = (s) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(String(s ?? ''))

// The `dir` a fragment should carry, given the page language.
//
// Returning 'auto' rather than guessing is deliberate for user-supplied text: a
// customer's name or a delivery note can be in either script, and the browser's
// first-strong-character heuristic gets it right far more often than the page
// language does. A Kuwaiti shop has customers called both "Fatima Al-Sabah"
// and "فاطمة الصباح", and neither should render backwards.
export const dirFor = (s) => (hasArabic(s) ? 'rtl' : 'ltr')

// An Arabic-Indic rendering of a number, for the places where the design calls
// for it. NOT used for money — formatKWD deliberately keeps Latin digits so
// prices stay scannable next to Latin brand names, and an invoice must not
// disagree with the price the shopper saw on the product page.
export const arDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d])

// A date both languages can read, and that no bidi algorithm can rearrange.
//
// Deliberately ISO-ish (2026-07-30 21:13) rather than a localised long form:
// an invoice is a record, it gets quoted in emails and support chats, and
// "٣٠ يوليو ٢٠٢٦" copied into a Latin context is unusable. Wrapped as an LTR
// run so the hyphens and colon cannot migrate.
export function stamp(iso, { time = true } = {}) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return ltr(time ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date)
}
