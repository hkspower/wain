/**
 * Every page's content starts the same distance from the edge.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/page-gutter-test.mjs
 *
 * WHY. Asked for on 2026-09-17 as "make alignment and padding for sporta". The
 * shop was almost entirely right — 16px on every page on a phone, nothing
 * scrolling sideways in either language — and ONE page disagreed on desktop:
 * the bundle gives its wide containers `px-4 md:px-6`, and /shop's carried
 * `px-4` alone, so the product grid sat 8.4px further out than the home page's
 * tiles and stepped back in when the shopper returned home. Small enough that
 * nobody reports it, constant enough to read as a wobble rather than a bug.
 *
 * WHAT IT ASSERTS, per language and at two widths:
 *
 *   1. Every wide container (`max-w-7xl`) has the SAME gutter as the others at
 *      that width. Not a number written here — the value is taken from the
 *      pages themselves and they are required to agree, so the day the design
 *      moves to a different gutter this keeps testing the truth instead of
 *      failing on a constant somebody forgot to update. What it cannot express
 *      that way is which page is wrong, so it prints every page's value.
 *   2. Nothing scrolls sideways. The classic padding bug is an element that
 *      overflows its gutter, and it costs a shopper the whole page.
 *
 * IT DOES NOT ASSERT THAT THE NARROW PAGES MATCH THE WIDE ONES. They are
 * different containers on purpose — the text pages are `max-w-3xl`, centred,
 * so their gutter is whatever is left over at that viewport. /returns is
 * `max-w-4xl` and that is deliberate too: its product picker is a two-column
 * grid and a narrower column would cramp it. Checked by looking at the page
 * before assuming it was a fault, which is the only reason it is still there.
 *
 * BOTH LANGUAGES, because the fix is `padding-inline` and the whole point of
 * that property is that it means the same thing in each direction. Asserting it
 * in Arabic only would pass on a rule that had been written left-to-right.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const PAGES = ['/', '/shop', '/wishlist', '/cart', '/contact', '/about', '/returns', '/terms']

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
      const seen = []      // {path, gutters:[...]}
      const overflow = []

      for (const path of PAGES) {
        const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`
        await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
        await p.waitForTimeout(900)
        const r = await p.evaluate(() => {
          const de = document.documentElement
          const wide = [...document.querySelectorAll('main .max-w-7xl')]
            .filter((el) => el.getBoundingClientRect().width > 0)
            .map((el) => Math.round(parseFloat(getComputedStyle(el).paddingInlineStart)))
          return { wide: [...new Set(wide)], over: Math.max(0, de.scrollWidth - de.clientWidth) }
        })
        if (r.wide.length) seen.push({ path, g: r.wide })
        if (r.over > 0) overflow.push(`${path} +${r.over}px`)
      }
      await p.close()

      console.log(`\n--- ${lang} · ${label}`)
      for (const s of seen) console.log(`     ${s.path.padEnd(11)} ${s.g.join(',')}px`)

      // The rig has to have found containers at all, or every check below
      // passes by measuring nothing — this repository's favourite lie.
      check(seen.length >= 3, `${lang} ${label}: found the wide containers`,
        `${seen.length} page(s) carry one`)

      const all = [...new Set(seen.flatMap((s) => s.g))]
      check(all.length === 1,
        `${lang} ${label}: every wide page has the same gutter`,
        all.length === 1 ? `${all[0]}px on all of them`
          : `they disagree: ${seen.filter((s) => s.g.some((x) => x !== all[0]))
              .map((s) => `${s.path}=${s.g.join('/')}`).join(', ')} against ${all.join('/')}`)

      check(overflow.length === 0, `${lang} ${label}: nothing scrolls sideways`,
        overflow.join(', '))
    }
  }

  console.log(fails ? `\n${fails} failed` : '\nall ok — one gutter, both languages, both widths')
} finally {
  await browser.close()
}

process.exit(fails ? 1 : 0)
