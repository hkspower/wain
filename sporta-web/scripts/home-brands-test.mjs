// BRANDS-1119 of public/sporta-images.css + BRAND STRIP DOCK of public/sporta-features.js (owner, 2026-11-19: "fix it", after
// HOME-BRANDS-SCAN-2026-11-19.md): the home page's "Brands we trust" strip.
//
//   npm run test:home-brands     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled home page under the add-on files of this repo, Arabic and English, with 1, 2, 4, 5 and 7 brands (the live shop has
// two), at 390 / 768 / 1024 / 1280 / 1536 px:
//   [hb-1] four brands or fewer: no tile is wider than 16rem and the group sits at the start edge; five or more fill the track as before;
//          a phone's two-across row is unchanged; the track never overflows
//   [hb-2] from 1024px the docked strip sits exactly under the header (no slit: the point just under the header is the strip), and it
//          FOLLOWS a header that changes height; below 1024px the strip is not docked
//   [hb-3] from 1024px the "Explore brands" link is centred under the centred heading; below 1024px heading and link keep their row
//   [hb-4] from 1024px the link is 44px tall and the strip is no taller than without the section
//   no sideways scroll, no page error
// MUTATION: the CSS section cut (hb-1, hb-3, hb-4 fail) and the dock block not run (the follow-the-header check fails).
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS = readFileSync(join(PUB, 'sporta-images.css'), 'utf8')
const JS = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const near = (a, b, t = 1.5) => Math.abs(a - b) <= t

const ALL = [['vanquish', 'Vanquish', 'فانكويش'], ['nba', 'NBA', 'إن بي إيه'], ['gymshark', 'Gymshark', 'جيم شارك'], ['ahed', 'AHED', 'AHED'], ['rheo', 'RHEO', 'ريو'], ['sporta', 'Sporta', 'سبورتا'], ['eyesportwear', 'Eyesportwear', 'آي سبورت وير']]
const brands = (n) => ALL.slice(0, n).map(([slug, en, ar]) => ({ slug, name_en: en, name_ar: ar, has_logo: 0, logo_v: 'e3b0c44298fc' }))

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => { const srv = await serveLive(opts); try { return await fn(srv) } finally { await srv.close() } }
const open = async (srv, { w, lang }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'load' })
  await p.waitForSelector('.brand-bar__item', { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(1500)
  return { ctx, p, errs }
}

const MEASURE = () => {
  const bar = document.querySelector('.campaign-brand-bar'), hdr = document.querySelector('header.app-header')
  if (!bar) return { found: false }
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const track = bar.querySelector('.brand-bar__track'), tiles = [...bar.querySelectorAll('.brand-bar__item')].map(R)
  const h2 = bar.querySelector('h2'), cta = bar.querySelector('.brand-bar__cta')
  const rg = document.createRange(); rg.selectNodeContents(h2)
  const tr = rg.getBoundingClientRect()
  const rtl = document.documentElement.dir === 'rtl'
  const bb = R(bar), hb = hdr ? R(hdr) : null
  // what is painted just under the header, in the middle of the window: the strip, or the page scrolling through a slit
  const probe = hb ? document.elementFromPoint(innerWidth / 2, hb.b + 3) : null
  return {
    found: true, rem, rtl, over: document.documentElement.scrollWidth - innerWidth, n: tiles.length,
    pos: getComputedStyle(bar).position, top: getComputedStyle(bar).top, dock: bar.style.getPropertyValue('--sporta-dock-top'),
    bar: bb, hdr: hb, track: { ...R(track), sw: track.scrollWidth, cw: track.clientWidth, gap: parseFloat(getComputedStyle(track).columnGap) || 0 },
    tiles, h2: { ...R(h2), textX: (tr.left + tr.right) / 2, textW: tr.width }, cta: cta ? { ...R(cta), cx: (R(cta).x + R(cta).r) / 2 } : null,
    slit: probe ? !bar.contains(probe) : null, probe: probe ? probe.tagName + '.' + String(probe.className).slice(0, 40) : null,
  }
}
const measure = (p) => p.evaluate(MEASURE)
const dockedAt = async (p, y) => { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(350); return measure(p) }

const WIDTHS = [390, 768, 1024, 1280, 1536]
const run = async (opts, o, scrollY = 0) => withServer(opts, async (srv) => { const t = await open(srv, o); const m = scrollY ? await dockedAt(t.p, scrollY) : await measure(t.p); await t.ctx.close(); return { m, errs: t.errs } })

head('the real files, on the real compiled home page')
for (const lang of ['ar', 'en']) for (const w of WIDTHS) {
  const tag = `${lang} ${w}px`
  // two brands (what is live): the strip as a shopper sees it
  const { m, errs } = await run({ api: { brands: () => brands(2) } }, { w, lang })
  const cap = 16 * m.rem + 0.5
  is(m.found && m.n === 2, `${tag}: two brands, two tiles`, String(m.n))
  is(m.tiles.every((t) => t.w <= cap), `${tag}: no tile is wider than 16rem (${m.tiles.map((t) => Math.round(t.w)).join(', ')} of ${Math.round(cap)}px)`)
  const first = m.rtl ? m.track.r - m.tiles[0].r : m.tiles[0].x - m.track.x
  is(Math.abs(first) <= 1.5, `${tag}: the group sits at the start edge of the track`, String(first))
  is(m.track.sw <= m.track.cw + 1 && m.over <= 0 && errs.length === 0, `${tag}: no overflow in the track, no sideways scroll, no page error`, `${m.track.sw}/${m.track.cw} ${m.over}px ${errs.join('|')}`)
  if (w === 390) is(m.tiles.every((t) => t.w > 150 && t.w < 200), `${tag}: a phone's two-across row is unchanged (${m.tiles.map((t) => Math.round(t.w)).join(', ')}px)`)
  // one, four, five, seven
  for (const n of [1, 4, 5, 7]) {
    const { m: k } = await run({ api: { brands: () => brands(n) } }, { w, lang })
    if (n <= 4) {
      is(k.tiles.every((t) => t.w <= 16 * k.rem + 0.5), `${tag}: ${n} brand(s): no tile is wider than 16rem (${k.tiles.map((t) => Math.round(t.w)).join(', ')})`)
      if (w >= 1024) is(k.track.sw <= k.track.cw + 1, `${tag}: ${n} brand(s): the track does not overflow`, `${k.track.sw}/${k.track.cw}`)
    } else if (w >= 1024) {
      const used = k.tiles.reduce((a, t) => a + t.w, 0) + k.track.gap * (k.n - 1)
      is(near(used, k.track.w, 3), `${tag}: ${n} brands fill the track as before (${Math.round(used)} of ${Math.round(k.track.w)}px)`)
    }
  }
}

head('docked under the header (1024px and up)')
for (const lang of ['ar', 'en']) for (const w of [1024, 1280, 1536]) {
  const tag = `${lang} ${w}px`
  const m = (await run({ api: { brands: () => brands(2) } }, { w, lang }, 1200)).m
  is(m.pos === 'sticky', `${tag}: the strip is docked (sticky)`, m.pos)
  is(near(m.bar.y, m.hdr.b, 1) && m.slit === false, `${tag}: it sits exactly under the header, no slit (strip top ${m.bar.y.toFixed(1)}, header bottom ${m.hdr.b.toFixed(1)}; under the header: ${m.probe})`)
  is(/^\d+(\.\d+)?px$/.test(m.dock) && near(parseFloat(m.dock), m.hdr.h, 0.6), `${tag}: the script wrote the header's height (${m.dock} vs ${m.hdr.h.toFixed(2)}px)`)
}
{ // it follows a header that changes height
  await withServer({ api: { brands: () => brands(2) } }, async (srv) => {
    for (const lang of ['ar', 'en']) {
      const t = await open(srv, { w: 1280, lang })
      await t.p.evaluate(() => window.scrollTo(0, 1200)); await t.p.waitForTimeout(300)
      const a = await measure(t.p)
      await t.p.evaluate(() => { document.querySelector('header.app-header').style.paddingBottom = '30px' }); await t.p.waitForTimeout(400)
      const b = await measure(t.p)
      is(near(b.hdr.h, a.hdr.h + 30, 1) && near(b.bar.y, b.hdr.b, 1) && b.slit === false, `${lang}: a header 30px taller: the strip follows it (header bottom ${a.hdr.b.toFixed(0)} -> ${b.hdr.b.toFixed(0)}, strip top ${b.bar.y.toFixed(0)}, slit ${b.slit})`)
      await t.p.evaluate(() => { document.querySelector('header.app-header').style.paddingBottom = '' }); await t.p.waitForTimeout(400)
      const c = await measure(t.p)
      is(near(c.bar.y, c.hdr.b, 1) && c.slit === false, `${lang}: and back when the header returns to its height`)
      await t.ctx.close()
    }
  })
}
for (const lang of ['ar', 'en']) for (const w of [390, 768]) {
  const m = (await run({ api: { brands: () => brands(2) } }, { w, lang }, 600)).m
  is(m.pos !== 'sticky', `${lang} ${w}px: below 1024px the strip is not docked (${m.pos}), as before`)
}

head('heading, link and strip height')
const baseHeight = {}
for (const lang of ['ar', 'en']) for (const w of WIDTHS) {
  const tag = `${lang} ${w}px`
  const base = (await run({ css: { 'sporta-images.css': CSS.slice(0, CSS.indexOf('/* ==== BRANDS-1119')) }, api: { brands: () => brands(2) } }, { w, lang })).m
  baseHeight[tag] = base.bar.h
  const m = (await run({ api: { brands: () => brands(2) } }, { w, lang })).m
  if (w >= 1024) {
    is(near(m.cta.cx, m.h2.textX, 2.5), `${tag}: the link is centred under the centred heading (link ${m.cta.cx.toFixed(1)}, heading ${m.h2.textX.toFixed(1)})`)
    is(m.cta.h >= 43.5, `${tag}: the link is 44px tall (${m.cta.h.toFixed(1)}px)`)
    is(m.bar.h <= base.bar.h + 1, `${tag}: the strip is no taller than before (${m.bar.h.toFixed(1)} vs ${base.bar.h.toFixed(1)}px)`)
  } else {
    const headLeft = m.h2.textX < m.cta.cx
    is(m.rtl ? !headLeft : headLeft, `${tag}: below 1024px the heading keeps the start and the link the end of the row`)
    is(near(m.bar.h, base.bar.h, 1) && m.cta.h >= 43.5, `${tag}: and the strip is unchanged (${m.bar.h.toFixed(1)} vs ${base.bar.h.toFixed(1)}px, link ${m.cta.h.toFixed(1)}px)`)
  }
}

head('mutants')
{
  const cut = CSS.slice(0, CSS.indexOf('/* ==== BRANDS-1119')) + CSS.slice(CSS.indexOf('/* ==== end BRANDS-1119 */') + '/* ==== end BRANDS-1119 */'.length)
  is(cut !== CSS && CSS.includes('/* ==== BRANDS-1119'), 'the BRANDS-1119 section is in the file')
  const m = (await run({ css: { 'sporta-images.css': cut }, api: { brands: () => brands(2) } }, { w: 1280, lang: 'en' }, 1200)).m
  const cap = 16 * m.rem + 0.5
  is(!m.tiles.every((t) => t.w <= cap), 'mutant "CSS cut": the two tiles are stretched again (hb-1 goes red)', m.tiles.map((t) => Math.round(t.w)).join(','))
  is(!(near(m.bar.y, m.hdr.b, 1) && m.slit === false), 'mutant "CSS cut": the docked strip leaves the slit again (hb-2 goes red)', `${m.bar.y.toFixed(1)} vs ${m.hdr.b.toFixed(1)}`)
  is(!near(m.cta.cx, m.h2.textX, 2.5) && m.cta.h < 43.5, 'mutant "CSS cut": the link is off-centre and 33px tall again (hb-3 / hb-4 go red)')
  const a = JS.indexOf('/* ===== BRAND STRIP DOCK ('), z = JS.indexOf('/* ===== BRAND STRIP DOCK - end')
  const nojs = JS.slice(0, a) + JS.slice(z)
  is(a > 0 && z > a, 'the BRAND STRIP DOCK block is in the file')
  await withServer({ js: { 'sporta-features.js': nojs }, api: { brands: () => brands(2) } }, async (srv) => {
    const t = await open(srv, { w: 1280, lang: 'en' })
    await t.p.evaluate(() => window.scrollTo(0, 1200)); await t.p.waitForTimeout(300)
    await t.p.evaluate(() => { document.querySelector('header.app-header').style.paddingBottom = '30px' }); await t.p.waitForTimeout(400)
    const b = await measure(t.p)
    is(!(near(b.bar.y, b.hdr.b, 1) && b.slit === false), 'mutant "dock block not run": a header that changes height leaves the strip behind (the follow check goes red)', `${b.bar.y.toFixed(1)} vs ${b.hdr.b.toFixed(1)}`)
    await t.ctx.close()
  })
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
