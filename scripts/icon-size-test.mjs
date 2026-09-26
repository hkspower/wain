/**
 * No icon the shopper can see is oversized.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/icon-size-test.mjs
 *
 * WHY. Asked on 2026-09-17 to "reduce any over large icons", and nothing
 * measured icon size — test:image-sizes weighs the PHOTOGRAPHS against their
 * boxes, test:buttons measures tap targets, and neither asks how big a glyph is
 * drawn. Measured by hand that day: 142 icons across eleven pages, 12px to
 * 28px, and one at 56px. Nothing needed reducing.
 *
 * THE 56px ONE IS WHY THIS RIG EXISTS RATHER THAN A ONE-OFF MEASUREMENT. It
 * appears on EVERY page, which looks damning until you ask where it is:
 *
 *     SVG 56x56 at (-223, 374)   inside aside.cart-drawer
 *
 * x = -223. It is the empty-cart illustration inside the CLOSED cart drawer,
 * parked off the left edge on every page because the drawer is global. Visible
 * to nobody, and an illustration rather than an icon. A rig that measured
 * getBoundingClientRect().width and stopped would fail the shop twelve times
 * over for something no shopper has ever seen — the same family as the
 * headless browser that reported eleven controls too small because it had no
 * fingers, and the `pointer: coarse` rules that were inert because of it.
 *
 * So it judges only what is ON SCREEN: inside the viewport horizontally, not
 * `visibility:hidden`, not zero-opacity, not `display:none`. Everything else is
 * counted and printed and left alone.
 *
 * AND IT CAPS THE CHROME ONLY, which took a second wrong answer to get right.
 * A flat cap over everything visible failed the shop on /wishlist — a 56px
 * heart, on screen, centred above "no saved products yet" and the button back
 * to the shop. Looked at rather than reasoned about: on a 390px phone it is a
 * modest empty-state illustration and the focal point of an otherwise empty
 * page. Shrinking it would be a redesign nobody asked for.
 *
 * (I had checked the 56px on / and /cart, found them off-screen in the closed
 * drawer, and generalised to all twelve. One of them was not the drawer's.
 * Two instances are not a pattern.)
 *
 * So the split is STRUCTURAL rather than a list of exceptions: an icon inside
 * a control, the header or the nav is CHROME and must be small; a standalone
 * graphic is an ILLUSTRATION and is counted, printed and left alone. Measured,
 * the two populations do not overlap — 97 chrome icons top out at 22px, and
 * every graphic over 28px is an empty state. A rule naming the wishlist heart
 * would only ever catch the wishlist heart.
 *
 * THE CAP IS DELIBERATELY LOOSE: 48px against a real maximum of 22, because
 * icon sizes are a design decision and a rig arguing over 22-versus-24 would be
 * drawing the shop's chrome on its own — the same objection text-style-scan
 * records for type sizes. 48px still catches the mistake worth catching: an
 * `h-6 w-6` that loses its class inside a button and falls back to the SVG's
 * intrinsic size.
 *
 * It prints the whole distribution either way, so drift is visible before it
 * is ever a failure.
 *
 * Both languages: the shop is Arabic by default and an icon that only appears
 * in one of them would otherwise go unmeasured.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const CAP = 48
const PAGES = ['/', '/shop', '/cart', '/wishlist', '/contact', '/about',
               '/returns', '/terms', '/checkout', '/track',
               '/product/cagliari-calcio-backpack']

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

try {
  for (const lang of ['ar', 'en']) {
    for (const [w, h, label] of [[1280, 900, 'desktop 1280'], [390, 844, 'phone 390']]) {
      const p = await browser.newPage({ viewport: { width: w, height: h } })
      const onScreen = []
      const offScreen = []

      for (const path of PAGES) {
        const url = `${BASE}${path}?lang=${lang}`
        await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
        await p.waitForTimeout(800)
        const found = await p.evaluate((path) => {
          const vw = document.documentElement.clientWidth
          const out = []
          for (const el of document.querySelectorAll('svg')) {
            const b = el.getBoundingClientRect()
            if (b.width < 1 || b.height < 1) continue
            const s = getComputedStyle(el)
            // "on screen" is horizontal only: a page is scrolled vertically, so
            // something below the fold is still seen. Something parked at
            // x = -223 by a closed drawer is not.
            const visible = s.visibility !== 'hidden' && s.display !== 'none'
              && parseFloat(s.opacity) > 0.01
              && b.right > 0 && b.left < vw
            // Chrome, or an illustration? Structural, not a list of names.
            const chrome = !!el.closest(
              'button, a, [role="button"], header, nav, input, label, select')
            out.push({ path, size: Math.round(Math.max(b.width, b.height)),
                       x: Math.round(b.x), visible, chrome,
                       cls: (el.getAttribute('class') || '').slice(0, 30) })
          }
          return out
        }, path)
        for (const f of found) (f.visible ? onScreen : offScreen).push(f)
      }
      await p.close()

      const chromeIcons = onScreen.filter((i) => i.chrome)
      const graphics = onScreen.filter((i) => !i.chrome)
      const hist = (arr) => {
        const m = {}
        for (const i of arr) m[i.size] = (m[i.size] || 0) + 1
        return Object.keys(m).map(Number).sort((a, b) => a - b)
          .map((k) => `${k}px x${m[k]}`).join('  ')
      }
      console.log(`\n--- ${lang} · ${label}`)
      console.log(`     off screen (not judged): ${offScreen.length}`)
      console.log(`     chrome      ${chromeIcons.length}: ${hist(chromeIcons)}`)
      console.log(`     graphics    ${graphics.length}: ${hist(graphics)}`)

      // A scan that finds nothing passes every comparison under it.
      check(chromeIcons.length >= 20, `${lang} ${label}: found chrome icons to measure`,
        `${chromeIcons.length} on screen`)

      const tooBig = chromeIcons.filter((i) => i.size > CAP)
      check(tooBig.length === 0,
        `${lang} ${label}: no icon in the chrome is over ${CAP}px`,
        tooBig.map((i) => `${i.size}px on ${i.path} (${i.cls})`).join(', '))
    }
  }

  console.log(fails ? `\n${fails} failed` : `\nall ok — every chrome icon is ${CAP}px or under; illustrations reported, not capped`)
} finally {
  await browser.close()
}

process.exit(fails ? 1 : 0)
