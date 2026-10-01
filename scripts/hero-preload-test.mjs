/** The first hero slide is preloaded early, with the app's own URL, and the slide list is asked for once. node scripts/hero-preload-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [name, vp, touch] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
  const slides = [], imgs = []
  p.on('request', (r) => { if (/r=slides/.test(r.url())) slides.push(r.url()); if (/r=slide_image&id=1\b/.test(r.url())) imgs.push(r.url()) })
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
  const links = await p.evaluate(() => [...document.querySelectorAll('link[rel=preload][as=image]')].filter((l) => /slide_image/.test(l.href)).map((l) => [l.href, l.media, l.getAttribute('fetchpriority')]))
  check(links.length === 1 && links[0][2] === 'high', `${name}: exactly one picture is preloaded, at high priority (never the unused mobile copy)`, JSON.stringify(links.map((l) => l[0].slice(-40))))
  const shown = await p.evaluate(() => { const i = document.querySelector('[aria-roledescription=carousel] img[src*="slide_image"], [aria-roledescription=carousel] img'); return i ? (i.currentSrc || i.src) : '' })
  check(links.some((l) => l[0] === shown), `${name}: and it is the very URL the app draws, so the browser reuses it`, shown.slice(-50))
  check(slides.length === 1, `${name}: the slide list is requested once (shared with the app, not asked twice)`, String(slides.length))
  const first = imgs.filter((u) => u === shown)
  check(imgs.length === 1 && first.length === 1, `${name}: the first slide's picture is fetched once`, String(first.length))
  await p.context().close()
}
{
  const p = await (await b.newContext()).newPage()
  await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
  check(await p.evaluate(() => document.querySelectorAll('link[rel=preload][as=image][href*="slide_image"]').length) === 0, '/shop preloads no hero slide (home only)')
}
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
