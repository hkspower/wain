/**
 * The back office on a phone.
 *
 *   bash scripts/sandbox.sh
 *   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web --clear
 *   node scripts/admin-mobile.mjs
 *
 * /backends is where the shop is actually run, and it is run from a phone —
 * standing in front of a shelf counting stock, or checking an order in a car.
 * Every other rig in this repo drives it at desktop width, so nothing had ever
 * looked at it small.
 *
 * WHAT IT FOUND, and why each check below is the shape it is.
 *
 *   THE STOCK SCREEN'S SAVE BUTTON WAS UNREACHABLE ON A REAL PHONE. The row is
 *   an input beside a button; the input carried `flex: 1` and no `minWidth`, so
 *   its minimum was its own intrinsic width and it could grow but never shrink.
 *   Measured at 390, 360 and 320 points, the Save button sat at exactly the
 *   same absolute position every time — 290 to 386 — because the row never
 *   responded to the viewport at all. Twenty-six points off the edge of a
 *   360pt Android, sixty-six off a 320pt phone, on the one screen an owner
 *   opens while holding a garment.
 *
 *   That is the class this file exists to catch, and it is invisible at
 *   desktop width: at 1280 the row has room to spare and looks perfect.
 *
 * THREE VIEWPORTS, not one. 390 is an iPhone, 360 is the commonest Android,
 * 320 is the narrowest phone still worth supporting — and the Save bug is
 * INVISIBLE AT 390, where the button ends four points inside the glass. A rig
 * that checked only the iPhone would have passed it.
 *
 * DELIBERATE HORIZONTAL SCROLLERS ARE NOT FAULTS. The panel's nav is seven
 * destinations in a row that is meant to be swiped, and so is the order
 * filter. A control inside one of those is reachable by scrolling, which is
 * the design; only a control that no scroll can bring into view is a bug. The
 * check walks up from each control looking for an ancestor that actually
 * scrolls sideways, and skips it if it finds one.
 *
 * WHAT IT DOES NOT CHECK. Tap-target SIZE is left to the eye and to the note
 * at the end: the panel's chips are 36pt pills inside 48pt hit wrappers, which
 * is a pattern this codebase already settled, and the one control still under
 * 44 is a size chip whose width follows its one-letter label. That is over the
 * 24pt WCAG 2.5.8 floor and under the 44pt AAA target, and closing it means
 * re-spacing rows a customer sees — the owner's call, not a rig's.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8899'
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

// 390 iPhone · 360 the commonest Android · 320 the narrowest still supported.
const WIDTHS = [390, 360, 320]
const PAGES = [
  '/backends',
  '/backends/orders',
  '/backends/returns',
  '/backends/stock',
  '/backends/promos',
  '/backends/images',
  '/backends/settings',
  '/backends/order/2601',
]

let fails = 0
// RETURNS `ok`, so the sign-in guard below can bail out of a width whose
// remaining checks would be meaningless. Written without the return first, and
// `if (!check(...)) continue` then skipped EVERY page at EVERY width while
// printing three green lines — the same vacuous pass this repo's csp-check
// produced from the same missing `return`.
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const browser = await chromium.launch({
  // The image the container ships. Playwright's own download is blocked here,
  // and a rig that cannot start is a rig nobody runs.
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

for (const width of WIDTHS) {
  console.log(`\n--- ${width}pt`)
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    // BOTH of these, and they are not decoration: `@media (pointer: coarse)`
    // rules do not apply without them, and an earlier audit in this repo
    // reported ninety-eight tap targets as too small purely because it
    // measured a phone-width window with a desktop pointer.
    hasTouch: true,
    isMobile: true,
  })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/backends`)
  await page.waitForTimeout(800)
  const email = page.locator('input[type=email], input[autocomplete="username"]').first()
  if (await email.count()) {
    await email.fill(EMAIL)
    await page.locator('input[type=password]').first().fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).first().click()
    await page.waitForTimeout(1400)
  }
  const signedIn = await page.getByRole('button', { name: /sign out/i }).count()
  if (!check(signedIn > 0, `${width}: signed in to the panel`, 'the rest of this width is meaningless without it')) {
    await ctx.close()
    continue
  }

  for (const path of PAGES) {
    await page.goto(BASE + path)
    await page.waitForTimeout(900)

    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const stranded = []
      const sel = '[role=button],[role=link],[role=radio],[role=switch],button,input,select,textarea'
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) continue
        // Inside something that really scrolls sideways? Then it is reachable
        // by swiping, which is the design of the nav and the filter row.
        let swipeable = false
        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a)
          if (/auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) { swipeable = true; break }
        }
        if (swipeable) continue
        if (b.right > vw + 1 || b.left < -1) {
          stranded.push({
            label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
            past: Math.round(b.right > vw ? b.right - vw : -b.left),
          })
        }
      }
      return { stranded, docW: document.documentElement.scrollWidth, vw }
    })

    check(r.stranded.length === 0,
      `${width}: ${path} — every control is on screen`,
      r.stranded.map((s) => `"${s.label}" ${s.past}pt past the edge`).join(', '))

    // The page itself must not scroll sideways. A panel that does is one where
    // every row has to be dragged to be read.
    check(r.docW <= r.vw + 1,
      `${width}: ${path} — the page does not scroll sideways`,
      `${r.docW}pt of content in ${r.vw}pt`)
  }
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the back office is usable on every phone width')
process.exit(fails ? 1 : 0)
