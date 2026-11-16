// The discount badge: the percentage rule, and the two places that show it.
//
//   npm run test:discount-badge      (no sandbox, no browser)
//
// The rule lives in src/lib/discount.js and is pure, so it is tested directly.
// The two components are checked by reading their source: the badge must be
// computed only from the server's own numbers, must sit behind on_sale, and
// must stay hidden from screen readers (the price sentence already speaks).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discountPercent } from '../src/lib/discount.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

let ok = 0
let fail = 0
const check = (name, cond) => {
  if (cond) {
    ok++
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
  }
}

// ---- the percentage rule
check('a 10.000 -> 7.500 sale is 25%', discountPercent(10, 7.5) === 25)
check('a 20.000 -> 15.000 sale is 25%', discountPercent(20, 15) === 25)
check('rounds to the nearest whole percent (12.345 -> 9.876 is 20%)', discountPercent(12.345, 9.876) === 20)
check('a 2.000 -> 1.990 sale rounds to 1% and still shows', discountPercent(2, 1.99) === 1)
check('no sale (price equal to list) is null', discountPercent(10, 10) === null)
check('a price above the list is null', discountPercent(10, 12) === null)
check('a missing list price is null', discountPercent(undefined, 7) === null)
check('a missing price is null', discountPercent(10, undefined) === null)
check('a zero list price is null', discountPercent(0, 0) === null)
check('a zero price is null (never shows "100% off")', discountPercent(10, 0) === null)
check('a cut that rounds to 100 is null (would read as free)', discountPercent(10, 0.01) === null)
check('a string price from the feed still works', discountPercent('10.000', '7.500') === 25)

// ---- where it is shown
const card = read('src/components/ProductCard.jsx')
const detail = read('src/pages/ProductDetail.jsx')

check('the card imports the helper', /import \{ discountPercent \} from '\.\.\/lib\/discount'/.test(card))
check('the card computes the percentage only behind on_sale',
  /product\.on_sale \? discountPercent\(product\.list_price, product\.price\) : null/.test(card))
check('the card badge is hidden from sold-out products',
  /discountPct !== null && !soldOut/.test(card))
check('the card badge is aria-hidden (the price sentence speaks)',
  /aria-hidden="true"\s+className="absolute start-2\.5 bottom-2\.5/.test(card))
check('the card badge sits bottom-start, clear of the brand badge and the heart',
  card.includes('absolute start-2.5 bottom-2.5') && card.includes('absolute start-2.5 top-2.5'))

check('the product page imports the helper', /import \{ discountPercent \} from '\.\.\/lib\/discount'/.test(detail))
check('the product page shows the badge only while on_sale',
  /product\.on_sale && discountPercent\(product\.list_price, product\.price\) !== null/.test(detail))
check('the product page badge is aria-hidden',
  /aria-hidden="true"\s+className="rounded-lg bg-ink px-2\.5 py-1 font-sans text-sm font-bold tabular-nums text-white"/.test(detail))

// The discount lines may not do their own price arithmetic. (The sticky bar's
// existing price-times-quantity line is not a discount line and is not checked.)
const discountLines = (src) => src.split('\n').filter((l) => /discount/i.test(l))
const arithmetic = /product\.price\s*\*|\*\s*product\.price|product\.price\s*-/
check('the discount lines compute no charged price',
  ![...discountLines(card), ...discountLines(detail)].some((l) => arithmetic.test(l)))

console.log(`\n${ok} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
