/**
 * The brand logo on product cards — assets/brand-badge.js, in a real browser.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/brand-badge-test.mjs
 *
 * WHY THIS NEEDS ITS OWN RIG. The sandbox ships with NO brand logos, and the
 * live shop has none either (0 of 8, measured 2026-09-05). So a test that just
 * loaded /shop and looked would find nothing and pass — the exact shape
 * CLAUDE.md warns about, where silence and success look identical. This seeds
 * a logo, proves a badge appears BECAUSE of it, then removes the logo and
 * proves the badge goes away. Both directions, or it is not a test.
 *
 * It also guards the two failure modes that would be invisible in production:
 * a card whose brand has no logo must be left completely alone, and a
 * re-render must not stack a second badge on a card that already has one.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.SITE ?? 'http://127.0.0.1:4300'
const BRAND = 'gymshark'
/* A 1x1 PNG. The bytes do not matter — what is being tested is whether the
   badge appears, is addressed correctly and disappears again. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

/** Load the grid and scroll it, because the branded products are not on the
 *  first screen and a badge nobody scrolled to is not evidence either way. */
const grid = async (page) => {
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(500) }
  await page.waitForTimeout(2000)
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-sporta-brand-chip]')]
    return {
      cards: document.querySelectorAll('a[href*="/product/"] > img').length,
      marked: document.querySelectorAll('[data-sporta-brand]').length,
      chips: chips.length,
      hrefs: chips.map((c) => c.closest('a')?.getAttribute('href') ?? ''),
      alt: chips[0]?.querySelector('img')?.getAttribute('alt') ?? '',
      src: chips[0]?.querySelector('img')?.getAttribute('src') ?? '',
      /* More than one chip inside a single card is the duplicate-append bug. */
      doubled: [...document.querySelectorAll('a[href*="/product/"]')]
        .some((a) => a.querySelectorAll('[data-sporta-brand-chip]').length > 1),
    }
  })
}

const before = sql(`select coalesce(logo, '') from brands where slug = '${BRAND}'`)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

try {
  console.log('--- with a logo on the brand')
  sql(`update brands set logo = '${PNG}' where slug = '${BRAND}'`)
  const on = await grid(page)

  check(on.cards > 0, `the grid rendered cards at all (${on.cards})`)
  check(on.marked > 0, `and brand-badge.js examined them (${on.marked} marked)`)
  check(on.chips > 0, `a badge is drawn on the branded card (${on.chips})`)
  check(on.hrefs.every((h) => h.includes('/product/')),
    'and every badge sits inside a product card')
  check(/r=brand_logo&slug=/.test(on.src),
    `it points at the cacheable logo route — "${on.src.slice(0, 52)}"`)
  check(/&v=/.test(on.src),
    'with the content version, so a replaced logo is not served from cache for a year')
  check(on.alt !== '' && !/logo/i.test(on.alt),
    `alt is the brand NAME, not the word "logo" — "${on.alt}"`)
  check(!on.doubled, 'no card carries two badges')
  /* The point of the marked-vs-chips gap: most cards have no branded logo and
     must be left untouched rather than given an empty box. */
  check(on.marked > on.chips,
    `cards whose brand has no logo are left alone (${on.marked - on.chips} of them)`)
  check(errors.length === 0, `no page errors (${errors.length})`)

  console.log('\n--- with the logo removed')
  sql(`update brands set logo = null where slug = '${BRAND}'`)
  const off = await grid(page)
  check(off.cards > 0, `the grid still renders (${off.cards} cards)`)
  check(off.chips === 0, `and no badge is drawn (${off.chips})`)
} finally {
  /* Put the row back exactly as it was, whatever happened above. */
  if (before) sql(`update brands set logo = '${before.replace(/'/g, "''")}' where slug = '${BRAND}'`)
  else sql(`update brands set logo = null where slug = '${BRAND}'`)
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the badge appears because of the logo, and goes with it')
process.exit(fails ? 1 : 0)
