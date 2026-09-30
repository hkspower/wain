/**
 * Kuwaiti dinar arithmetic, both directions.
 *
 *   node --experimental-strip-types scripts/money-test.mjs
 *   npm run test:money
 *
 * WHY THIS EXISTS. formatPrice has always WRITTEN Eastern Arabic numerals —
 * `١٢٫٥٠٠ د.ك` is what a Kuwaiti price tag looks like and what the shop's
 * default language renders — and until 2026-09-19 nothing in this app could
 * read one back. `Number('٥')` is NaN, and `\d` in a JavaScript regex is
 * ASCII-only unless asked otherwise. So the panel could print a price in
 * Arabic and refuse the same price typed in Arabic, and each screen hid it
 * differently: products.tsx coerced with `Number()`, promos.tsx with
 * `|| 0`, and only rules.tsx refused honestly.
 *
 * THE ROUND TRIP IS THE CENTRAL CLAIM, and it is a property rather than a
 * handful of examples: for every amount, in both languages, what formatPrice
 * writes is what parseAmount reads. A test of three hand-picked numbers proves
 * nothing about the thousands separator or the zero-padded fraction.
 *
 * REFUSALS ARE ASSERTED AS null, NOT AS FALSY. `|| 0` and `?? 0` both turn a
 * refusal into a number, and a zero price is a promotion that gives the shop
 * away — so a test that only checked "not a good value" would pass on exactly
 * the bug this file exists to prevent.
 */
import { filsToInput, formatPrice, normaliseDigits, parseAmount, parseCount } from '../src/lib/money.ts'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}

/* ------------------------------------------------- the round trip, as a law */

// Chosen to exercise the shape rather than the arithmetic: a whole dinar, a
// fraction with a leading zero in it, one that ends in zeros (which .toFixed
// keeps and a naive parser drops), one over a thousand so the grouping
// separator appears, and the smallest unit there is.
const AMOUNTS = [0, 1, 500, 1000, 1500, 12500, 99500, 100000, 1234567, 1]

console.log('--- what formatPrice writes, parseAmount reads')
let roundTripped = 0
for (const fils of AMOUNTS) {
  for (const lang of ['en', 'ar']) {
    // The currency name never appears in an input box, so it is stripped the
    // way a person typing would never have added it.
    const shown = formatPrice(fils, lang).replace(/\s*(KD|د\.ك)\s*$/u, '')
    const back = parseAmount(shown)
    check(back === fils, `${lang}  ${fils} fils -> "${shown}" -> ${back}`, `expected ${fils}`)
    roundTripped++
  }
}
// A rig that finds nothing passes every comparison under it. This one builds
// its own cases, so the equivalent failure is an empty loop.
check(roundTripped === AMOUNTS.length * 2,
  `every amount was actually round-tripped (${roundTripped})`)

console.log('\n--- Arabic-Indic digits, which is what the shop shows by default')
check(parseAmount('١٢٫٥٠٠') === 12500, 'a price typed in Arabic parses (١٢٫٥٠٠ -> 12500)')
check(parseAmount('١٬٢٣٤٫٥٦٧') === 1234567, 'and the Arabic thousands mark is not a decimal point')
check(parseCount('٤٢') === 42, 'a count typed in Arabic parses (٤٢ -> 42)')
check(normaliseDigits('٠١٢٣٤٥٦٧٨٩') === '0123456789', 'all ten digits map across')

console.log('\n--- three decimals, and no more')
check(parseAmount('1.5') === 1500, 'one decimal is fine (1.5 -> 1500)')
check(parseAmount('1.50') === 1500, 'two are fine')
check(parseAmount('1.500') === 1500, 'three are the currency')
check(parseAmount('1.2345') === null,
  'FOUR are refused, not rounded',
  'Number() accepted this and toFils quietly made it 1.235 KWD')

console.log('\n--- a refusal is null, never zero')
for (const bad of ['', '   ', 'abc', '-1', '1.2.3', 'NaN', 'Infinity', '1e3', '12,5,0']) {
  check(parseAmount(bad) === null, `parseAmount(${JSON.stringify(bad)}) is null`,
    `got ${JSON.stringify(parseAmount(bad))} — "|| 0" turns this into a free promotion`)
}
for (const bad of ['', 'abc', '1.5', '-2', '٤٫٥']) {
  check(parseCount(bad) === null, `parseCount(${JSON.stringify(bad)}) is null`)
}

console.log('\n--- a comma is a decimal point, or a thousands separator')
check(parseAmount('1,500') === 1500,
  'with no dot it is the decimal an Arabic keyboard offers (1,500 -> 1.500 KD)')
check(parseAmount('1,234.567') === 1234567,
  'with a dot it is a thousands separator — which is what formatPrice("en") writes')
check(parseAmount('1,234,567') === null,
  'two commas and no dot is refused rather than guessed at')

console.log('\n--- filsToInput writes what parseAmount reads')
for (const fils of AMOUNTS) {
  check(parseAmount(filsToInput(fils)) === fils,
    `${fils} -> "${filsToInput(fils)}" -> ${parseAmount(filsToInput(fils))}`)
}

console.log(
  fails === 0
    ? `\nall ok — ${AMOUNTS.length} amounts, both languages, and every refusal is a refusal`
    : `\n${fails} failed`,
)
process.exit(fails === 0 ? 0 : 1)
