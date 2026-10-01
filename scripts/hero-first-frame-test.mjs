/**
 * The hero holds ONE height from its first frame — 2026-10-01.
 *
 *   bash scripts/sandbox.sh && node scripts/hero-first-frame-test.mjs
 *
 * Asked for as "fix main hero slide layout, sometimes half view". Measured with
 * the live shop's Size (Full), a FIRST visit painted the default Tall strip —
 * 84px on a phone, 144px on a desktop — and grew to 469px / 442px only when
 * ?r=slides answered; on a desktop it also passed through 600px on EVERY visit,
 * because the bundle draws its built-in slides while the slide list loads and
 * those were a fixed 75svh. On a slow connection the strip is what a shopper
 * saw, for as long as the request took.
 *
 * So, for each of the three Sizes, on a phone (a real phone User-Agent, which
 * is what decides the phone picture) and on a desktop, for a FIRST visit and a
 * RETURN visit: every frame from the first paint to three seconds in must show
 * the hero at the same height. It also checks the server half on its own: the
 * home page's <html> carries the shop's Size, and /shop does not.
 *
 * Every comparison first asserts it measured something — a hero that never
 * rendered has a perfectly steady height of nothing.
 *
 * SANDBOX ONLY: it changes the `hero` settings row and puts it back.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' })

const saved = sql(`select value from settings where name = 'hero'`).trim() || null
const setSize = (size) => {
  const v = JSON.stringify({ speed_ms: 6500, shuffle: false, autoplay: true, ...(saved ? JSON.parse(saved) : {}), size })
  sql(`insert into settings (name, value) values ('hero', '${v}') on duplicate key update value = values(value)`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
const SAMPLE = () => {
  window.__hero = []
  const t0 = performance.now()
  const tick = () => {
    const sec = document.querySelector('section[aria-roledescription="carousel"]')
    const shell = document.querySelector('.boot-hero')
    const el = sec || (shell && getComputedStyle(shell).display !== 'none' ? shell : null)
    if (el) window.__hero.push([Math.round(performance.now() - t0), sec ? 'hero' : 'shell', Math.round(el.getBoundingClientRect().height)])
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

try {
  for (const size of ['full', 'tall', 'short']) {
    setSize(size)
    // the server half, on its own
    const home = await (await fetch(`${BASE}/?lang=en`)).text()
    const shop = await (await fetch(`${BASE}/shop?lang=en`)).text()
    check(new RegExp(`<html[^>]*\\bdata-hero-size="${size}"`).test(home), `${size}: the home page's <html> carries the shop's Size`, (home.match(/<html[^>]*>/) || [''])[0])
    check(!/<html[^>]*\bdata-hero-size=/.test(shop), `${size}: /shop's does not (it has no hero)`)

    for (const [name, opts] of [
      ['phone', { ...devices['Pixel 7'] }],
      ['desktop', { viewport: { width: 1280, height: 800 } }],
    ]) {
      const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' })
      await ctx.addInitScript(SAMPLE)
      const page = await ctx.newPage()
      for (const visit of ['first', 'return']) {
        await page.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(3100)
        const s = await page.evaluate(() => window.__hero)
        const L = `${size} ${name} ${visit} visit:`
        check(s.length > 20 && s.some(([, k]) => k === 'hero'), `${L} the hero was measured from its first frame`, `${s.length} frames`)
        const heights = [...new Set(s.map(([, , h]) => h))]
        const steady = Math.max(...heights) - Math.min(...heights) <= 1
        // the trail of changes, for the message: each distinct height with the time it first appeared
        const trail = s.filter((x, i) => i === 0 || x[2] !== s[i - 1][2]).map(([t, k, h]) => `${t}ms ${k}=${h}`).join(' -> ')
        check(steady, `${L} one height from the first frame to the last`, trail)
      }
      await ctx.close()
    }
  }
} finally {
  if (saved) sql(`update settings set value = '${saved.replace(/'/g, "''")}' where name = 'hero'`)
  else sql(`delete from settings where name = 'hero'`)
  await browser.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok — the hero is the height the shop chose from the first frame, in every Size')
process.exit(fails ? 1 : 0)
