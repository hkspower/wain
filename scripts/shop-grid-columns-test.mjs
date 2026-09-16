/**
 * The shop's product grid: two columns on a phone, three once there is room
 * — and, more importantly, UNIFORM card widths within a row on every size.
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

  await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForTimeout(800)
  const desktopWidths = await cardWidths()
  check(uniform(desktopWidths), 'every card on a wide desktop is the SAME width after a resize',
    JSON.stringify(desktopWidths))
  check(desktopWidths[0] > phoneWidths[0],
    'and it is WIDER than the phone card — the grid actually used the extra room',
    `${phoneWidths[0]}px -> ${desktopWidths[0]}px`)
  // MaxContentWidth caps the column at 800px regardless of window width —
  // three columns of a ~800px-wide row, not two of a huge one and not four
  // of a cramped one. 220-280 covers the intended ~250px with slack for the
  // gap arithmetic changing without this test needing to track the exact
  // formula.
  check(desktopWidths[0] > 220 && desktopWidths[0] < 280,
    'and it is a plausible THREE-column width within the capped content column',
    `${desktopWidths[0]}px`)

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
