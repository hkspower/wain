/**
 * Hero slides download only near the current one, and the neighbours only when the slider can move
 * (assets/hero-lazy.js, 2026-10-02; the neighbour rule 2026-10-14).
 *
 *   bash scripts/sandbox.sh && node scripts/hero-lazy-test.mjs
 *
 * It seeds the live shop's seven slides (scripts/_hero-seed.mjs) — the sandbox has none, and with
 * none there is nothing to save — and puts the sandbox back exactly afterwards.
 *
 *   PHONE (a touch device can swipe, so the slider can move): after `load` the current slide and its
 *   two neighbours (the wrap-around one included) are fetched, and NEITHER neighbour starts before
 *   the window's load event; "Next" fetches the new neighbour.
 *   DESKTOP WITH NO WAY TO MOVE (autoplay off, arrows and dots hidden — the live shop until
 *   2026-10-14, recreated with a style): only the slide on screen is fetched — the 2026-10-02 version fetched both neighbours (+192 kB) for a slider nobody
 *   could move. If it moves anyway, the new slide and then its neighbours load.
 *   DESKTOP WITH AUTOPLAY ON, and DESKTOP WITH THE CONTROLS DRAWN (the shop since 2026-10-14): the
 *   neighbours are fetched, after load — read from the page's real state.
 *   Everywhere: the slide on screen is never a deferred (hidden) picture and has its bytes.
 */
import { chromium, devices } from 'playwright'
import { snapshotHero, restoreHero, seedLiveHero, setHero } from './_hero-seed.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const strip = (o) => { const c = { ...o }; delete c.defaultBrowserType; return c }
// The controls are drawn by default since 2026-10-14 (css/93-hero-polish.css). The no-way-to-move
// case is still worth holding, for a shop that hides them again: HIDE_CONTROLS recreates it.
const HIDE_CONTROLS = '<style>section[aria-roledescription="carousel"] > div[class~="absolute"][class~="bottom-2"]{display:none!important}</style>'

const saved = snapshotHero()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
try {
  const ids = seedLiveHero({ size: 'full', autoplay: false })   // in sort order
  check(ids.length >= 6, 'the seeded shop has enough slides for a saving to be possible', `${ids.length} active`)
  const around = (cur) => [ids[(cur - 1 + ids.length) % ids.length], ids[cur], ids[(cur + 1) % ids.length]]
  const fmt = (a) => [...new Set(a)].sort((x, y) => x - y).join(',')

  async function visit(nm, dev, { hideControls = false } = {}) {
    const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' })
    if (hideControls) await ctx.route((u) => new URL(u).pathname === '/', async (route) => {
      const r = await route.fetch(); const h = (await r.text()).replace('</head>', HIDE_CONTROLS + '</head>')
      await route.fulfill({ response: r, body: h, headers: { ...r.headers(), 'content-length': String(Buffer.byteLength(h)) } })
    })
    const p = await ctx.newPage(); const got = new Set()
    p.on('request', (r) => { const m = r.url().match(/slide_image&id=(\d+)/); if (m) got.add(+m[1]) })
    await p.goto(`${BASE}/`, { waitUntil: 'load' })
    await p.waitForFunction(() => { const i = document.querySelector('[aria-roledescription=carousel] [aria-hidden="false"] img[src*="slide_image"]'); return i && i.complete && i.naturalWidth }, null, { timeout: 20000 }).catch(() => {})
    await p.waitForTimeout(1500)
    const timing = await p.evaluate(() => {
      const load = performance.getEntriesByType('navigation')[0].loadEventStart
      return { load, starts: performance.getEntriesByType('resource').filter((e) => /slide_image/.test(e.name)).map((e) => [+(e.name.match(/id=(\d+)/) || [])[1], Math.round(e.startTime)]) }
    })
    const shown = async () => p.evaluate(() => { const i = [...document.querySelectorAll('img[src*="r=slide_image"]')].find((x) => x.parentElement.parentElement.getAttribute('aria-hidden') === 'false'); return i ? { id: +(i.src.match(/id=(\d+)/) || [])[1], deferred: i.hasAttribute('data-hero-defer'), h: i.naturalHeight } : null })
    const next = async () => { await p.locator('button[aria-label="الشريحة التالية"], button[aria-label="Next slide"]').first().evaluate((x) => x.click()); await p.waitForTimeout(1500) }
    return { ctx, p, got, timing, shown, next, nm }
  }

  // ---- phone: can swipe
  {
    const v = await visit('phone', strip(devices['Pixel 7']))
    check(fmt([...v.got]) === fmt(around(0)), 'phone: after load, the current slide and its two neighbours are fetched', `${fmt([...v.got])} of ${ids.length}`)
    const early = v.timing.starts.filter(([id, t]) => id !== ids[0] && t < v.timing.load)
    check(v.timing.starts.length >= 3 && early.length === 0, 'phone: no neighbour starts before the window\'s load event', `load at ${Math.round(v.timing.load)}ms; ${v.timing.starts.map(([id, t]) => `${id}@${t}`).join(' ')}`)
    await v.next()
    check(fmt([...v.got]) === fmt([...around(0), ...around(1)]), 'phone: "Next" fetches the new neighbour', fmt([...v.got]))
    const s = await v.shown()
    check(s && s.id === ids[1] && !s.deferred && s.h > 0, 'phone: the slide on screen is shown with its picture loaded', JSON.stringify(s))
    await v.ctx.close()
  }
  // ---- desktop with no way to move (the controls hidden, as the live shop was until 2026-10-14)
  {
    const v = await visit('desktop', { viewport: { width: 1280, height: 900 } }, { hideControls: true })
    check(fmt([...v.got]) === String(ids[0]), 'desktop, autoplay off and no controls: only the slide on screen is fetched', `${fmt([...v.got])} of ${ids.length}`)
    const s0 = await v.shown()
    check(s0 && s0.id === ids[0] && !s0.deferred && s0.h > 0, 'desktop: the slide on screen is shown with its picture loaded', JSON.stringify(s0))
    await v.next()   // nothing a visitor can do — but if it ever moves, it must not show a blank slide
    const s = await v.shown()
    check(s && s.id === ids[1] && !s.deferred && s.h > 0, 'desktop: if the slider moves anyway, the new slide loads', JSON.stringify(s))
    check(fmt([...v.got]) === fmt([...around(0).filter((x) => x === ids[0]), ...around(1)]), 'desktop: and once it has moved, its neighbours load too', fmt([...v.got]))
    await v.ctx.close()
  }
  // ---- desktop with autoplay on
  {
    setHero({ size: 'full', autoplay: true, speed_ms: 60000 })   // on, but nothing advances during the check
    const v = await visit('desktop-autoplay', { viewport: { width: 1280, height: 900 } })
    check(fmt([...v.got]) === fmt(around(0)), 'desktop, autoplay on: the two neighbours are fetched after load', fmt([...v.got]))
    const early = v.timing.starts.filter(([id, t]) => id !== ids[0] && t < v.timing.load)
    check(early.length === 0, 'desktop, autoplay on: none before the load event', v.timing.starts.map(([id, t]) => `${id}@${t}`).join(' '))
    await v.ctx.close()
    setHero({ size: 'full', autoplay: false })
  }
  // ---- desktop as the shop is now: the controls drawn (2026-10-14)
  {
    const v = await visit('desktop-controls', { viewport: { width: 1280, height: 900 } })
    check(fmt([...v.got]) === fmt(around(0)), 'desktop with arrows and dots drawn: the two neighbours are fetched after load', fmt([...v.got]))
    await v.ctx.close()
  }
} finally {
  restoreHero(saved)
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — hero slides download only when they can be reached, and never before load')
process.exit(fails ? 1 : 0)
