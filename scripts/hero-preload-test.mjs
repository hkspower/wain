/**
 * The first hero slide is preloaded early, with the app's own URL, and the slide list is asked for once.
 *
 *   bash scripts/sandbox.sh && node scripts/hero-preload-test.mjs
 *
 * It seeds the live shop's slides (scripts/_hero-seed.mjs; the sandbox has none, so every check
 * failed on "nothing preloaded") and restores them. Since 2026-10-14 the boot script preloads the
 * first slide from seo.php's attributes and hero-preload.js must not add a second <link> for it.
 * The phone is a real phone descriptor: the server picks the phone picture by User-Agent.
 */
import { chromium, devices } from 'playwright'
import { snapshotHero, restoreHero, seedLiveHero } from './_hero-seed.mjs'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const phone = { ...devices['Pixel 7'] }; delete phone.defaultBrowserType
const saved = snapshotHero()
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
try {
  const first = seedLiveHero({ size: 'full', autoplay: false })[0]
  for (const [name, ctxOpts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', phone]]) {
    const p = await (await b.newContext({ ...ctxOpts, serviceWorkers: 'block' })).newPage()
    const slides = [], imgs = []
    p.on('request', (r) => { if (/r=slides/.test(r.url())) slides.push(r.url()); if (new RegExp(`r=slide_image&id=${first}\\b`).test(r.url())) imgs.push(r.url()) })
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
    const links = await p.evaluate(() => [...document.querySelectorAll('link[rel=preload][as=image]')].filter((l) => /slide_image/.test(l.href)).map((l) => [l.href, l.media, l.getAttribute('fetchpriority')]))
    check(links.length === 1 && links[0][2] === 'high', `${name}: exactly one picture is preloaded, at high priority (never the unused mobile copy)`, JSON.stringify(links.map((l) => l[0].slice(-40))))
    const shown = await p.evaluate(() => { const i = document.querySelector('[aria-roledescription=carousel] [aria-hidden="false"] img[src*="slide_image"]'); return i ? (i.currentSrc || i.src) : '' })
    check(links.some((l) => l[0] === shown), `${name}: and it is the very URL the app draws, so the browser reuses it`, shown.slice(-50))
    check(slides.length === 1, `${name}: the slide list is requested once (shared with the app, not asked twice)`, String(slides.length))
    const once = imgs.filter((u) => u === shown)
    check(imgs.length === 1 && once.length === 1, `${name}: the first slide's picture is fetched once`, String(once.length))
    await p.context().close()
  }
  {
    const p = await (await b.newContext()).newPage()
    await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
    check(await p.evaluate(() => document.querySelectorAll('link[rel=preload][as=image][href*="slide_image"]').length) === 0, '/shop preloads no hero slide (home only)')
  }
} finally {
  restoreHero(saved)
  await b.close()
}
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
