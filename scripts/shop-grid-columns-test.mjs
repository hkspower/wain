/**
 * The shop's product grid: 2 columns on a phone, 3 on a tablet, 4 on a
 * desktop — fixed breakpoints, per the product-grid spec given 2026-09-20 —
 * and, more importantly, UNIFORM card widths within a row on every size.
 *
 *   npm run build:web && python3 scripts/serve-dist.py 4173 &
 *   node scripts/shop-grid-columns-test.mjs
 *
 * WHY THIS EXISTS. Asked to "fix images grid layout" after the grid measured
 * stuck at two columns on every viewport up to 1920px, with each card a
 * DIFFERENT width from its neighbours in the same row — 189px, 255px, 153px,
 * 139px side by side, all supposedly the same computed value. The root cause
 * was `useWindowDimensions()` (then a hand-rolled `window.innerWidth` read)
 * returning a value baked in at the STATIC EXPORT's prerender, disagreeing
 * with the real browser, with nothing ever correcting it — the same class of
 * hydration mismatch use-hydrated.ts already documents for a different
 * symptom, on a NUMBER this time rather than on markup. `src/hooks/use-window-width.ts`
 * fixes it by returning the same safe constant on every render before
 * `useHydrated()` flips, so there is nothing for React's hydration recovery
 * to disagree about, and only reading the real width afterwards.
 *
 * A SCREENSHOT CANNOT CATCH THE UNIFORM-WIDTH HALF OF THIS. Every screenshot
 * taken while diagnosing it looked like a normal, if narrow, grid — the
 * varying widths were each individually plausible and only wrong relative to
 * each other. `getBoundingClientRect()` on every card in a row is what this
 * rig checks instead of eyeballing a picture.
 *
 * THE RESIZE HALF PROVES THE FIX IS LIVE, not baked into one page load: the
 * SAME page, resized from phone to desktop and back, must recompute both
 * times — a fix that only worked on FIRST paint (e.g. by hardcoding the
 * safe-default width instead of genuinely reading `window.innerWidth` after
 * hydration) would pass a fresh-load check and fail this one.
 *
 * FOUR ON DESKTOP, NOT UNCAPPED — this used to be a fluid formula (a
 * card-width floor, more columns as the window widened, capped at five) built
 * for "more columns on wide screens". The 2026-09-20 spec asks for a NAMED
 * breakpoint instead — 4 on desktop (>=1024px), 3 on tablet (>=768px), 2
 * below that — so this file now checks the fixed count rather than a
 * plausible-width range, and checks it holds on a very wide monitor too
 * (2560px must still be 4, not more).
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

const cardWidths = () =>
  p.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .filter((a) => a.href.includes('/product/'))
      .map((a) => Math.round(a.parentElement.getBoundingClientRect().width)),
  )

// Cards sharing the same top offset as the first are in its row — the direct
// way to ask "how many columns", rather than inferring it from a pixel width
// that a different column count could coincidentally also produce.
const firstRowCount = () =>
  p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('a'))
      .filter((a) => a.href.includes('/product/'))
      .map((a) => a.parentElement)
    if (cards.length === 0) return 0
    const firstTop = Math.round(cards[0].getBoundingClientRect().top)
    return cards.filter((c) => Math.round(c.getBoundingClientRect().top) === firstTop).length
  })

const uniform = (widths) => widths.every((w) => Math.abs(w - widths[0]) <= 1)

try {
  await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  const phoneWidths = await cardWidths()
  check(phoneWidths.length > 0, 'the shop grid renders cards', `${phoneWidths.length} found`)
  check(uniform(phoneWidths), 'every card on a phone is the SAME width', JSON.stringify(phoneWidths))
  // Two per row: the first two cards' widths summed plus the grid gap should
  // be close to the full column width — checked structurally (same width as
  // each other) rather than against an exact pixel count, which would make
  // this test the second place a column-width formula has to be kept in sync.
  check(phoneWidths[0] > 140 && phoneWidths[0] < 200,
    'and it is a plausible TWO-column width, not a three-or-more-column squeeze',
    `${phoneWidths[0]}px`)
  check((await firstRowCount()) === 2, 'and there really are two cards in the first row',
    `${await firstRowCount()}`)

  // TABLET: the breakpoint the fixed model adds that the old fluid one never
  // named — 3 columns from 768px up, distinct from both phone (2) and
  // desktop (4).
  await p.setViewportSize({ width: 800, height: 900 })
  await p.waitForTimeout(800)
  const tabletWidths = await cardWidths()
  check(uniform(tabletWidths), 'every card on a tablet is the SAME width', JSON.stringify(tabletWidths))
  check((await firstRowCount()) === 3, 'and there are three cards in the first row on a tablet',
    `${await firstRowCount()}`)

  await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForTimeout(800)
  const desktopWidths = await cardWidths()
  check(uniform(desktopWidths), 'every card on a wide desktop is the SAME width after a resize',
    JSON.stringify(desktopWidths))
  check(desktopWidths[0] > phoneWidths[0],
    'and it is WIDER than the phone card — the grid actually used the extra room',
    `${phoneWidths[0]}px -> ${desktopWidths[0]}px`)
  check((await firstRowCount()) === 4,
    'and there really are four cards in the first row, per the spec',
    `${await firstRowCount()}`)

  // AN EVEN WIDER MONITOR MUST NOT ASK FOR A FIFTH COLUMN. The column count is
  // a fixed breakpoint value, not a formula that keeps dividing as the window
  // widens — this is the check that would fail if it ever went fluid again.
  await p.setViewportSize({ width: 2560, height: 1000 })
  await p.waitForTimeout(800)
  const veryWideWidths = await cardWidths()
  check(uniform(veryWideWidths), 'every card is still uniform on a very wide monitor',
    JSON.stringify(veryWideWidths))
  check((await firstRowCount()) === 4,
    'and still four columns, not five — the breakpoint holds on a very wide monitor',
    `${await firstRowCount()}`)
  check(Math.abs(veryWideWidths[0] - desktopWidths[0]) <= 1,
    'and the card width itself does not keep growing past the shop\'s own 1400px content cap',
    `${desktopWidths[0]}px @1440 vs ${veryWideWidths[0]}px @2560`)

  await p.setViewportSize({ width: 390, height: 844 })
  await p.waitForTimeout(800)
  const backToPhone = await cardWidths()
  check(uniform(backToPhone), 'resizing back to a phone is uniform again', JSON.stringify(backToPhone))
  check(Math.abs(backToPhone[0] - phoneWidths[0]) <= 1,
    'and lands on the same width the fresh phone load had',
    `${phoneWidths[0]}px vs ${backToPhone[0]}px`)

  check(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the shop grid is uniform at every size, phone through desktop')
process.exit(fails ? 1 : 0)
