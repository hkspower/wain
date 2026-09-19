/**
 * Does the brand colour actually control the shop?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/brand-token-test.mjs
 *
 * WHY. `--brand` was on :root, the theme editor wrote it, and it looked wired.
 * Tailwind v4 had compiled the colour to literal hex in every utility class, so
 * `var(--brand)` was read in ONE place in the whole stylesheet — the skip link.
 * The editor's brand control moved the skip link. I had checked that the token
 * EXISTED and never that anything READ it, which is the same mistake as a route
 * name that exists in the app and in no server.
 *
 * There turned out to be a second half nobody had looked at either: every
 * primary button is `hsl(var(--primary))`, in HSL CHANNELS rather than a hex, so
 * even a working --brand would have left the shop's main call to action orange
 * under a blue theme.
 *
 * So this rig does not read the stylesheet at all. It serves a theme through the
 * shop's own endpoint, paints the page, and reads the colours the browser
 * computed. Three questions, and all three have to be answered:
 *
 *   1. WITH NO THEME SET, is every brand element still exactly the colour it
 *      was? sporta-ui.css re-states 48 rules; a typo in any one of them changes
 *      the shop today, with nobody having asked for a new colour.
 *   2. Does the DERIVED FAMILY reproduce the shipped palette? theme.js computes
 *      --brand-dark and --brand-bright from the one colour the owner picks. Fed
 *      the shop's own orange it must return the shop's own other two — and the
 *      expected values here are the LITERALS FROM THE DESIGN, not numbers this
 *      rig recomputed with the same formula, or it would be testing the formula
 *      against itself.
 *   3. Does a different colour actually repaint the shop, buttons included?
 *
 * A SAMPLE THAT FINDS NOTHING PASSES ALL THREE, so the count is asserted first.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

const ORIGINALS = ['rgb(224, 86, 28)', 'rgb(184, 67, 15)', 'rgb(255, 123, 23)']
/** Deliberately a blue. If a rule were left literal it stays orange, and the
 *  failure message says which — rather than being a near-miss between ambers. */
const NEW_BRAND = '#0055ff'

let fails = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
  if (!ok) fails++
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/** Open the home page with the theme endpoint answering `theme`, or untouched
 *  when it is null. The route is the shop's own — nothing is injected — so what
 *  is measured is the path a real visitor takes. */
async function open(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  if (theme) {
    await page.route('**/api/api.php?r=theme', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(theme) })
    )
  }
  await page.goto(BASE + (process.env.PATH_UNDER_TEST ?? '/'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('header.app-header', { timeout: 20000 })
  await page.waitForTimeout(1800)
  return { ctx, page }
}

/** Every visible element painted in one of a set of colours, by property. Read
 *  from getComputedStyle, so it is what the browser resolved — literal, var()
 *  or color-mix(), which the rig cannot tell apart and should not. */
const paintedIn = (page, colours) =>
  page.evaluate((want) => {
    const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']
    const hits = []
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetParent === null) continue
      const cs = getComputedStyle(el)
      for (const p of PROPS) {
        if (want.includes(cs[p])) {
          hits.push(`${el.tagName.toLowerCase()}.${(el.className?.toString?.() ?? '').split(' ')[0]}:${p}`)
        }
      }
    }
    return hits
  }, colours)

console.log(`--- the brand token, at ${BASE}\n`)

// ── 1. no theme: the shop is exactly what it was ──────────────────────────
{
  const { ctx, page } = await open(null)
  const brandish = await paintedIn(page, ORIGINALS)
  check(brandish.length >= 5, 'the page paints a useful number of brand elements', `found=${brandish.length}`)
  // The primary button is the element this whole exercise nearly missed. It is
  // NOT painted by --primary despite the built rule saying so: sporta-dark.css
  // sets `[data-theme=dark] .btn-primary{background-color:var(--sp-ember-fill)
  // !important}`, and !important beats the rule in the bundle. Naming it here
  // means a future edit that reverts that token fails loudly on the button
  // rather than on an anonymous count.
  const button = brandish.some((h) => h.includes('btn'))
  check(button, 'and one of them is a primary button — the --sp-ember-fill half')
  await ctx.close()
}

// ── 2. the derived family, against the design's own literals ──────────────
{
  const { ctx, page } = await open({ brand: '#e0561c' })
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      brand: cs.getPropertyValue('--brand').trim(),
      dark: cs.getPropertyValue('--brand-dark').trim(),
      bright: cs.getPropertyValue('--brand-bright').trim(),
      primary: cs.getPropertyValue('--primary').trim(),
    }
  })

  /** Within `n` per channel of the expected hex. A derivation that lands one
   *  step off in the last digit is right; one that lands ten off is a formula
   *  with a sign error, and a strict equality here would fail on rounding and
   *  teach the next person to loosen the check. */
  const near = (got, want, n = 3) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    if (!/^#[0-9a-f]{6}$/i.test(got)) return false
    return p(got.toLowerCase()).every((v, i) => Math.abs(v - p(want)[i]) <= n)
  }

  check(near(vars.dark, '#b8430f'), 'the derived dark shade is the shop\'s own #B8430F', `got=${vars.dark}`)
  check(near(vars.bright, '#ff7b17'), 'the derived bright shade is the shop\'s own #FF7B17', `got=${vars.bright}`)
  check(/^17\.\d+ 77\.\d+% 49\.\d+%$/.test(vars.primary),
    '--primary is written as HSL CHANNELS, not a hex', `got=${vars.primary || '(unset)'}`)

  const stillOrange = await paintedIn(page, ORIGINALS)
  check(stillOrange.length >= 5,
    'and setting the shop\'s own colour changes nothing on screen', `unchanged=${stillOrange.length}`)
  await ctx.close()
}

// ── 3. a different colour repaints the shop, on more than one page ────────
//
// THE THRESHOLD IS THE PAGE'S OWN BASELINE, not a number chosen here. A fixed
// "at least five" failed on /shop for a reason that had nothing to do with the
// tokens: with the filters removed and no product photographs, that page simply
// paints two brand-coloured things. Counting what the page shows WITHOUT a
// theme and requiring the same count to move is the assertion that was meant —
// and it cannot be satisfied by an empty page, because the home page's absolute
// count is asserted above.
for (const path of ['/', '/shop']) {
  process.env.PATH_UNDER_TEST = path

  const plain = await open(null)
  const baseline = (await paintedIn(plain.page, ORIGINALS)).length
  await plain.ctx.close()

  const { ctx, page } = await open({ brand: NEW_BRAND })
  const stuck = await paintedIn(page, ORIGINALS)
  const moved = await paintedIn(page, [
    'rgb(0, 85, 255)', 'rgb(0, 68, 204)', 'rgb(51, 136, 255)',
    // the derived pair for #0055ff, to a few units either way
    'rgb(0, 66, 199)', 'rgb(43, 133, 255)', 'rgb(0, 67, 201)', 'rgb(46, 134, 255)',
  ])
  check(baseline > 0, `${path} paints something in the brand colour to begin with`, `baseline=${baseline}`)
  check(moved.length >= baseline, `a new brand colour repaints all ${baseline} of them on ${path}`,
    `repainted=${moved.length}`)
  check(stuck.length === 0, `and nothing on ${path} is stuck on the old orange`,
    stuck.length ? `${stuck.length} stuck: ${[...new Set(stuck)].slice(0, 6).join(', ')}` : '')
  await ctx.close()
}

await browser.close()
console.log(
  fails ? `\n${fails} failed` : '\nall ok — the brand colour is a token the shop reads, not one it merely stores'
)
process.exit(fails ? 1 : 0)
