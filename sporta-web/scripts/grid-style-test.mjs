// The GRIDSTYLE sections of public/sporta-grid.css ([gs-1]..[gs-8]) and public/sporta-cat-tiles.css ([gs-t1]..[gs-t3]),
// proven on the LIVE markup under the LIVE rules (owner: "improve grids style", 2026-11-11).
//
//   npm run test:grid-style      (no sandbox needed)
//
// scripts/fixtures/grid holds the captures (read-only, www.sporta.com.kw, 2026-11-11): the /shop catalog section (12 cards, 3 with
// the "no photo" plate, sold-out cards, a badge), the home essentials row (4 cards) and the home category tiles, Arabic and English,
// with shop-live.css / essentials-live.css / tiles-live.css: every rule of the live stylesheets that can apply, in load order, as
// "/* ---- <sheet> ---- */" blocks. The block of each add-on under test is replaced IN PLACE (so the load order is the live one) by
//   off = the repo file up to its GRIDSTYLE marker, on = the whole repo file.
// Every check compares the page with and without that one section; checks that "must not change" compare the same two pages.
//
// ADDON_FILE=<path>        measures another sporta-grid.css as "on"       (the mutation run passes one WITHOUT the section: must FAIL)
// ADDON_TILES_FILE=<path>  measures another sporta-cat-tiles.css as "on" (same)
//
// Fonts differ from live (no Arabic font here) and photographs are stubs, so the numbers are relative geometry, not live pixels.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FX = join(ROOT, 'scripts/fixtures/grid')
const read = (f) => readFileSync(join(FX, f), 'utf8')
const MARK = '/* ==== GRIDSTYLE:'
const GRID_FILE = readFileSync(join(ROOT, 'public/sporta-grid.css'), 'utf8')
const TILE_FILE = readFileSync(join(ROOT, 'public/sporta-cat-tiles.css'), 'utf8')
const GRID_ON = process.env.ADDON_FILE ? readFileSync(process.env.ADDON_FILE, 'utf8') : GRID_FILE
const TILE_ON = process.env.ADDON_TILES_FILE ? readFileSync(process.env.ADDON_TILES_FILE, 'utf8') : TILE_FILE
const GRID_OFF = GRID_FILE.split(MARK)[0], TILE_OFF = TILE_FILE.split(MARK)[0]

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const note = (m) => console.log('note ' + m)
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1)

// ---- pages ------------------------------------------------------------------------------------------------------------
const LIVECSS = { shop: read('shop-live.css'), ess: read('essentials-live.css'), tiles: read('tiles-live.css') }
const FILES = { shop: 'shop-out', ess: 'essentials-home-out', tiles: 'tiles-home-out' }
const swap = (css, grid, tiles) => css.split(/(?=\/\* ---- )/).map((b) => {
  const keep = b.slice(0, b.indexOf('*/') + 2) + '\n'
  if (/^\/\* ---- \/sporta-grid\.css/.test(b)) return keep + grid + '\n'
  if (/^\/\* ---- \/sporta-cat-tiles\.css/.test(b)) return keep + tiles + '\n'
  return b
}).join('')
// the captured page really has the rules the section depends on (an account suite once passed with half its CSS dead)
for (const [what, re] of [
  ['grid sheet block', /\/\* ---- \/sporta-grid\.css/], ['tiles sheet block', /\/\* ---- \/sporta-cat-tiles\.css/],
  ['card info band', /\.product-grid-card \.catalog-card-info \{[^}]*min-height/], ['card name clamp', /\.product-grid-card \.catalog-card-name \{[^}]*line-clamp/],
  ['heart rule', /\.product-grid-card \.catalog-card-save/], ['skeleton shimmer', /\.image-loading-skeleton::after \{[^}]*animation/],
  ['hover photo zoom', /group-hover\\:scale-\\\[1\\\.03\\\]/], ['badge rule', /catalog-card-badge \{/],
]) is(re.test(LIVECSS.shop), `the captured shop CSS has: ${what}`)
for (const [what, re] of [['tile grid', /\.home-category-grid/], ['scrim', /\.cat-scrim/], ['tile hover lift', /campaign-category:hover/], ['features inline sheet', /sporta-features-css/]])
  is(re.test(LIVECSS.tiles), `the captured tiles CSS has: ${what}`)

const fakeHtml = (kind, lang, grid, tiles) => {
  const meta = JSON.parse(read(`${FILES[kind]}-${lang}.json`))
  const tag = (s) => (s.match(/^<(\w+)/) || [])[1]
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${swap(LIVECSS[kind], grid, tiles)}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px"></div>${read(`${FILES[kind]}-${lang}.html`)}${[...meta.chain].reverse().map((c) => `</${tag(c)}>`).join('')}</body></html>`
}
const SVG = (w, h, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// state: 'off' | 'on'. opts: { cards: keep the first n cards, saved: [idx], delay: ms, motion: 'reduce', touch: bool, tileBright: bool }
async function open(kind, lang, w, state, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: opts.h || 900 }, reducedMotion: opts.motion || 'no-preference', forcedColors: opts.forced ? 'active' : 'none', ...(opts.touch ? { hasTouch: true, isMobile: true } : {}) })
  const p = await ctx.newPage()
  const html = fakeHtml(kind, lang, state === 'on' ? GRID_ON : GRID_OFF, state === 'on' ? TILE_ON : TILE_OFF)
  await p.route('http://fx.test/**', async (r) => {
    const u = new URL(r.request().url())
    if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    if (/\.(jpe?g|png|webp|svg|gif|avif)$/.test(u.pathname)) {
      if (opts.delay) await new Promise((ok) => setTimeout(ok, opts.delay))
      // a real product photo: grey-beige studio backdrop (about 195,192,184); the tiles' photo is bright (worst case for the copy)
      const body = /product-photo-unavailable/.test(u.pathname) ? SVG(600, 750, '#f3f5f7') : /\/cats\//.test(u.pathname) ? SVG(800, 600, 'rgb(205,203,196)') : SVG(800, 1000, 'rgb(195,192,184)')
      return r.fulfill({ status: 200, contentType: 'image/svg+xml', body })
    }
    return r.fulfill({ status: 404, body: '' })
  })
  if (opts.cls) await p.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true }) })
  await p.goto('http://fx.test/', { waitUntil: 'load' })
  await p.evaluate(({ cards, saved, soldReal }) => {
    if (soldReal) document.querySelectorAll('.product-grid-card').forEach((c) => { if (c.querySelector('a > span[class*="bg-ink"]')) c.querySelector('img').setAttribute('src', '/images/products/sold-real.jpg') })
    const cs = [...document.querySelectorAll('.product-grid-card')]
    if (cards) cs.slice(cards).forEach((c) => c.remove())
    for (const i of saved || []) { const b = document.querySelectorAll('.product-grid-card')[i]?.querySelector('.catalog-card-save'); if (b) b.setAttribute('aria-pressed', 'true') }
  }, { cards: opts.cards || 0, saved: opts.saved || [], soldReal: !!opts.soldReal })
  await p.waitForTimeout(opts.delay ? opts.delay + 250 : 120)
  return { ctx, p }
}

// ---- colour helpers (run in node) -------------------------------------------------------------------------------------
const rgb = (s) => { const n = (s.match(/-?\d*\.?\d+/g) || []).map(Number); return /color\(srgb/.test(s) ? n.slice(0, 3).map((x) => x * 255) : n.slice(0, 3) }
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const over = (c, bg) => { const n = (c.match(/-?\d*\.?\d+/g) || []).map(Number); const a = n.length > 3 ? n[3] : 1; return rgb(c).map((v, i) => v * a + bg[i] * (1 - a)) }

// pixel helpers: decode a PNG buffer inside a blank page
const dec = await (await browser.newContext()).newPage()
const pixels = (buf, fn, arg) => dec.evaluate(async ({ b64, fn, arg }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data
  const W = c.width
  if (fn === 'ring') { // pixels near `colour`, outside the rect `inner` (document px = image px at scale 1)
    const { colour, inner, outer, tol } = arg; let n = 0
    for (let i = 0; i < d.length; i += 4) { const px = (i / 4) % W, py = Math.floor(i / 4 / W); if (px < outer.l || px >= outer.r || py < outer.t || py >= outer.b) continue; if (px >= inner.l && px < inner.r && py >= inner.t && py < inner.b) continue; if (Math.abs(d[i] - colour[0]) <= tol && Math.abs(d[i + 1] - colour[1]) <= tol && Math.abs(d[i + 2] - colour[2]) <= tol) n++ }
    return n
  }
  if (fn === 'near') { const { colour, rect, tol } = arg; let n = 0; for (let py = Math.max(0, rect.t | 0); py < Math.min(c.height, rect.b); py++) for (let px = Math.max(0, rect.l | 0); px < Math.min(W, rect.r); px++) { const i = (py * W + px) * 4; if (Math.abs(d[i] - colour[0]) <= tol && Math.abs(d[i + 1] - colour[1]) <= tol && Math.abs(d[i + 2] - colour[2]) <= tol) n++ } return n }
  if (fn === 'p95') { // luminance of the brightest 5% of the pixels in the rect (the worst background behind light text)
    const { rect } = arg; const L = []
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    for (let py = Math.max(0, rect.t | 0); py < Math.min(c.height, rect.b); py++) for (let px = Math.max(0, rect.l | 0); px < Math.min(W, rect.r); px++) { const i = (py * W + px) * 4; L.push(0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2])) }
    L.sort((a, b) => a - b); return L.length ? L[Math.min(L.length - 1, Math.floor(L.length * 0.95))] : 0
  }
}, { b64: buf.toString('base64'), fn, arg })

// ---- card metrics -----------------------------------------------------------------------------------------------------
const cardMetrics = (p) => p.evaluate(() => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
  const grid = document.querySelector('.product-grid'), gcs = getComputedStyle(grid)
  const cards = [...grid.querySelectorAll('.product-grid-card')]
  const out = cards.map((c) => {
    const frame = c.querySelector('.catalog-card-image'), info = c.querySelector('.catalog-card-info'), a = info.querySelector(':scope > a'), name = c.querySelector('.catalog-card-name'), price = c.querySelector('.price-card')
    const heart = c.querySelector('.catalog-card-save'), band = frame.querySelector('a > span[class*="bg-ink"]'), badge = frame.querySelector('.catalog-card-badge'), img = frame.querySelector('img')
    const rg = document.createRange(); rg.selectNodeContents(name); const tr = rg.getBoundingClientRect()
    const lh = parseFloat(getComputedStyle(name).lineHeight) || 20
    const fr = R(frame), z = { t: fr.t + fr.h * 0.2, b: fr.t + fr.h * 0.8 }
    const br = band ? R(band) : null
    return {
      card: R(c), info: R(info), frame: fr, link: R(a), name: R(name),
      lines: Math.round(name.scrollHeight / lh), clipped: name.scrollHeight > name.clientHeight + 1,
      photoToName: tr.top + scrollY - fr.b, nameToPrice: price.getBoundingClientRect().top + scrollY - (tr.bottom + scrollY),
      sold: !!band, plate: /product-photo-unavailable/.test(img.getAttribute('src') || ''),
      band: br && { h: br.h, t: br.t, b: br.b, overlap: Math.max(0, Math.min(br.b, z.b) - Math.max(br.t, z.t)), bg: getComputedStyle(band).backgroundColor, fg: getComputedStyle(band).color, z: getComputedStyle(band).zIndex },
      priceColor: getComputedStyle(price).color,
      heart: heart && { op: getComputedStyle(heart).opacity, fill: getComputedStyle(heart.querySelector('svg')).fill, border: getComputedStyle(heart).borderColor, bw: getComputedStyle(heart).borderTopWidth, w: heart.getBoundingClientRect().width, h: heart.getBoundingClientRect().height, bf: getComputedStyle(heart).backdropFilter, saved: heart.getAttribute('aria-pressed') === 'true', r: R(heart) },
      badge: !!badge, hasBadgeRect: badge && R(badge),
    }
  })
  const cols = gcs.gridTemplateColumns.split(' ').length
  return { cols, rows: new Set(out.map((c) => Math.round(c.card.t))).size, gridW: R(grid).w, gap: parseFloat(gcs.columnGap), over: document.documentElement.scrollWidth - innerWidth, cards: out }
})

// ---- run the shop grid at every width, ar and en -----------------------------------------------------------------------
const WIDTHS = [320, 360, 390, 414, 600, 639, 640, 700, 767, 768, 820, 900, 1023, 1024, 1280, 1440, 1920]
const M = {}
for (const lang of ['ar', 'en']) {
  for (const w of WIDTHS) {
    for (const state of ['off', 'on']) {
      const a = await open('shop', lang, w, state, {}); M[`${lang}${w}${state}`] = await cardMetrics(a.p); await a.ctx.close()
      const b = await open('shop', lang, w, state, { cards: 4 }); M[`${lang}${w}${state}4`] = await cardMetrics(b.p); await b.ctx.close()
    }
  }
}
const m = (lang, w, state, four) => M[`${lang}${w}${state}${four ? 4 : ''}`]
const inRange = (n, c, tol) => Math.abs(n - c) <= tol
const cardW = (x) => x.cards[0].card.w
const expectW = (x, cols) => (x.gridW - (cols - 1) * x.gap) / cols

for (const lang of ['ar', 'en']) {
  // ---- [gs-1] ladder ----------------------------------------------------------------------------------------------------
  head(`[gs-1] listings in 3 columns from 640px (${lang})`)
  for (const w of [640, 700, 767]) {
    const off = m(lang, w, 'off'), on = m(lang, w, 'on'), on4 = m(lang, w, 'on', true)
    is(off.cols === 2 && on.cols === 3 && inRange(cardW(on), expectW(on, 3), 1), `${w}px: 12 cards, 2 columns -> 3, card ${f1(cardW(off))} -> ${f1(cardW(on))}px`, `cols ${off.cols} -> ${on.cols}`)
    is(on4.cols === 2, `${w}px: a grid of exactly 4 cards stays 2 x 2`, `cols ${on4.cols}`)
    is(on.over <= 0, `${w}px: no sideways scroll`)
    const tops = {}; for (const c of on.cards) (tops[Math.round(c.card.t)] ||= []).push(c.card.h)
    is(Object.values(tops).every((r) => Math.max(...r) - Math.min(...r) <= 0.5), `${w}px: every row's cards are the same height`)
    is(on.cards.every((c) => c.lines <= 2), `${w}px: every name within 2 lines`, on.cards.map((c) => c.lines).join())
  }
  const j = (a, b) => Math.abs(cardW(m(lang, a, 'on')) - cardW(m(lang, b, 'on')))
  const jo = Math.abs(cardW(m(lang, 767, 'off')) - cardW(m(lang, 768, 'off')))
  is(j(767, 768) <= 6 && jo > 80, `767 -> 768: the card no longer jumps (off ${f1(jo)}px, on ${f1(j(767, 768))}px; the 4px left is the page gutter 16 -> 24)`)
  is(m(lang, 639, 'off').cols === m(lang, 639, 'on').cols && [768, 1024, 1280].every((w) => m(lang, w, 'off').cols === m(lang, w, 'on').cols), `639px and 768px+: 12-card columns identical to before`, [639, 768, 1024, 1280].map((w) => m(lang, w, 'on').cols).join())

  // ---- [gs-2] 4 across --------------------------------------------------------------------------------------------------
  head(`[gs-2] a grid of 4 cards goes 4 across at 768-1023px (${lang})`)
  for (const w of [768, 820, 900, 1023]) {
    const off = m(lang, w, 'off', true), on = m(lang, w, 'on', true)
    is(off.cols === 3 && off.rows === 2 && on.cols === 4 && on.rows === 1 && inRange(cardW(on), expectW(on, 4), 1), `${w}px: 3 + 1 -> one row of 4, card ${f1(cardW(off))} -> ${f1(cardW(on))}px`, `cols ${off.cols} -> ${on.cols}, rows ${off.rows} -> ${on.rows}`)
    is(on.cards.every((c) => !c.clipped && c.lines <= 2), `${w}px: all 4 names within 2 lines`, on.cards.map((c) => c.lines).join())
    is(on.over <= 0 && m(lang, w, 'on').cols === 3, `${w}px: no sideways scroll, a 12-card shop is still 3 columns`)
  }
  const c1023 = cardW(m(lang, 1023, 'on', true)), c1024 = cardW(m(lang, 1024, 'on', true)), o1023 = cardW(m(lang, 1023, 'off', true)), o1024 = cardW(m(lang, 1024, 'off', true))
  is(Math.abs(c1023 - c1024) <= 4 && Math.abs(o1023 - o1024) > 40, `1023 -> 1024: continuous (off ${f1(o1023)} -> ${f1(o1024)}, on ${f1(c1023)} -> ${f1(c1024)})`)
  is([360, 390, 600, 767, 1024, 1280, 1920].every((w) => m(lang, w, 'off', true).cols === m(lang, w, 'on', true).cols), `4 cards: columns identical to before below 768 and from 1024`)

  // ---- [gs-3] name band --------------------------------------------------------------------------------------------------
  head(`[gs-3] the name centred in its band (${lang})`)
  for (const w of [320, 360, 390, 768, 1280]) {
    const off = m(lang, w, 'off'), on = m(lang, w, 'on')
    is(off.cards.every((c, i) => Math.abs(c.card.h - on.cards[i].card.h) <= 0.5 && Math.abs(c.info.h - on.cards[i].info.h) <= 0.5), `${w}px: card and info heights identical on all ${on.cards.length} cards`)
    is(on.cards.every((c, i) => c.link.h >= (w <= 320 ? 80 : 58) - 0.5 && c.link.h >= off.cards[i].link.h - 0.5), `${w}px: the title link keeps its hit area (min ${f1(Math.min(...on.cards.map((c) => c.link.h)))}px)`)
    is(on.cards.filter((c) => c.clipped).length <= off.cards.filter((c) => c.clipped).length && on.over <= 0, `${w}px: no name newly clipped, no overflow`)
    if (w >= 390) {
      const one = on.cards.map((c, i) => [c, off.cards[i]]).filter(([c]) => c.lines === 1)
      if (one.length) is(one.every(([c, o]) => c.nameToPrice < c.photoToName && o.nameToPrice >= o.photoToName), `${w}px: a 1-line name sits nearer its price than the photo (off ${f1(one[0][1].photoToName)}/${f1(one[0][1].nameToPrice)} -> on ${f1(one[0][0].photoToName)}/${f1(one[0][0].nameToPrice)}), ${one.length} cards`)
      else note(`${lang} ${w}px: no 1-line name in the capture`)
    }
  }

  // ---- [gs-5] [gs-6] [gs-7] on the 12 cards ---------------------------------------------------------------------------------
  head(`[gs-7] sold out (${lang})`)
  for (const w of [390, 1280]) {
    // the capture's sold-out cards all show the "no photo" plate, so give them a real (stub) photo for this check
    const a = await open('shop', lang, w, 'off', { soldReal: true }), b = await open('shop', lang, w, 'on', { soldReal: true })
    const off = await cardMetrics(a.p), on = await cardMetrics(b.p); await a.ctx.close(); await b.ctx.close()
    const i = on.cards.findIndex((c) => c.sold && !c.plate)
    is(i >= 0, `${w}px: the capture has a sold-out card with a real photo`)
    if (i < 0) continue
    const co = off.cards[i], cn = on.cards[i]
    is(co.band.overlap > 15 && cn.band.overlap === 0, `${w}px: the band no longer covers the product (overlap with the 20-80% zone ${f1(co.band.overlap)} -> ${f1(cn.band.overlap)}px)`)
    is(Math.abs(co.band.h - cn.band.h) <= 1 && cn.band.b <= cn.frame.b + 0.5 && cn.band.t >= cn.frame.t, `${w}px: the band keeps its height (${f1(co.band.h)} -> ${f1(cn.band.h)}) and sits inside the foot of the photo`)
    const bg = over(cn.band.bg, [255, 255, 255]), fg = rgb(cn.band.fg)
    is(ratio(bg, fg) >= 7 && cn.band.z === co.band.z, `${w}px: band contrast ${f1(ratio(bg, fg))}:1 (>= 7), z-index ${co.band.z} -> ${cn.band.z} unchanged`)
    const stock = on.cards.findIndex((c) => !c.sold)
    is(ratio(rgb(cn.priceColor), [255, 255, 255]) >= 4.5 && cn.priceColor !== co.priceColor && cn.priceColor !== on.cards[stock].priceColor, `${w}px: the sold-out price is neutral and readable (${co.priceColor} -> ${cn.priceColor}, ${f1(ratio(rgb(cn.priceColor), [255, 255, 255]))}:1)`)
    is(on.cards.every((c, k) => c.sold || c.priceColor === off.cards[k].priceColor) && on.cards.every((c, k) => Math.abs(c.card.h - off.cards[k].card.h) <= 0.5), `${w}px: in-stock prices and every card height unchanged`)
  }
}

// ---- the interactive checks (badge, hearts, focus ring, motion) -----------------------------------------------------------
for (const lang of ['ar', 'en']) {
  head(`[gs-5] badge above the photo (${lang})`)
  for (const [w, touch] of [[390, false], [1280, false], [1180, true]]) {
    const res = {}
    for (const state of ['off', 'on']) {
      const { ctx, p } = await open('shop', lang, w, state, { touch, h: touch ? 820 : 900 })
      res[state] = await p.evaluate(() => {
        let badge = document.querySelector('.catalog-card-badge')
        if (!badge) { const f = document.querySelector('.catalog-card-image'); badge = document.createElement('span'); badge.className = 'catalog-card-badge absolute start-2.5 top-2.5 rounded-lg bg-brand px-2 py-1 text-xs font-bold uppercase tracking-wide text-ink'; badge.textContent = 'NEW'; f.appendChild(badge) }
        badge.scrollIntoView({ block: 'center' })
        const b = badge.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2
        const hit = document.elementFromPoint(x, y), heart = badge.closest('.catalog-card-image').querySelector('.catalog-card-save').getBoundingClientRect()
        return { on: hit === badge || badge.contains(hit), tag: hit && hit.tagName, disjoint: b.right <= heart.left + 0.5 || b.left >= heart.right - 0.5, frameW: badge.closest('.catalog-card-image').getBoundingClientRect().width, sz: [b.width, b.height], hover: matchMedia('(hover: none)').matches }
      })
      await ctx.close()
    }
    if (touch && !res.on.hover) note(`${lang} ${w}px: the emulated touch context reports hover:hover; the hover:none checks are skipped`)
    is(!res.off.on && res.on.on, `${w}${touch ? ' touch' : ''}px: the badge is on top at its centre (off: ${res.off.tag}, on: ${res.on.tag})`)
    is(res.on.disjoint && Math.abs(res.on.sz[0] - res.off.sz[0]) < 0.5, `${w}${touch ? ' touch' : ''}px: the badge does not touch the heart (frame ${f1(res.on.frameW)}px) and keeps its size`)
  }

  head(`[gs-6] the saved heart (${lang})`)
  const hearts = {}
  for (const [w, touch] of [[390, false], [1280, false], [1180, true]]) for (const state of ['off', 'on']) {
    const { ctx, p } = await open('shop', lang, w, state, { saved: [1], touch, h: touch ? 820 : 900 })
    const x = await cardMetrics(p); x.hoverNone = await p.evaluate(() => matchMedia('(hover: none)').matches); hearts[`${w}${state}`] = x; await ctx.close()
  }
  const h = (w, s) => hearts[`${w}${s}`].cards
  const lgHide = Number(h(1280, 'off')[0].heart.op) < 1
  if (!lgHide) note(`${lang}: the captured live CSS has no lg:opacity-0 on the heart, so every heart is already visible; the opacity assertions are skipped, the fill and border ones stay`)
  is(h(1280, 'off')[1].heart.saved && h(1280, 'off')[1].heart.fill === 'none' && h(1280, 'on')[1].heart.fill !== 'none', `1280px mouse: a saved heart is filled (fill ${h(1280, 'off')[1].heart.fill} -> ${h(1280, 'on')[1].heart.fill})`)
  is(h(1280, 'off')[1].heart.border !== h(1280, 'on')[1].heart.border, `1280px: a saved heart has the brand border (${h(1280, 'off')[1].heart.border} -> ${h(1280, 'on')[1].heart.border})`)
  is(Number(h(1280, 'on')[1].heart.op) === 1 && h(1280, 'on').filter((c) => !c.heart.saved).every((c, k) => c.heart.op === h(1280, 'off').filter((q) => !q.heart.saved)[k].heart.op), `1280px: the saved heart is fully visible; unsaved hearts keep the hover reveal as before`)
  if (lgHide && hearts['1180on'].hoverNone) is(h(1180, 'off').some((c) => Number(c.heart.op) < 1) && h(1180, 'on').every((c) => Number(c.heart.op) === 1), `1180px touch: every heart visible`)
  is(h(390, 'on').every((c, k) => c.heart.op === h(390, 'off')[k].heart.op), `390px: heart opacity unchanged`)
  is(h(1280, 'on').every((c, k) => c.heart.w >= 44 && c.heart.h >= 44 && c.heart.w >= h(1280, 'off')[k].heart.w - 0.5), `heart boxes stay >= 44px (${f1(h(1280, 'on')[0].heart.w)} x ${f1(h(1280, 'on')[0].heart.h)})`)
  is(h(1280, 'off')[0].heart.bf !== 'none' && h(1280, 'on').every((c) => c.heart.bf === 'none'), `[gs-8] the heart has no backdrop blur (${h(1280, 'off')[0].heart.bf.slice(0, 12)} -> ${h(1280, 'on')[0].heart.bf})`)
}

head('[gs-4] keyboard focus on the photo link')
// the ring colour is whatever the section resolves to on the page (--sporta-ring or the #b8430f fallback)
let RING = [184, 67, 15]
{
  const { ctx, p } = await open('shop', 'en', 1280, 'on')
  await p.keyboard.press('Tab')
  RING = rgb(await p.evaluate(() => { const c = document.querySelector('.product-grid-card'); c.querySelector('.catalog-card-image > a').focus(); return getComputedStyle(c).outlineColor }))
  await ctx.close()
  note(`focus ring colour on the page: rgb(${RING.join(',')})`)
}
for (const [lang, w] of [['ar', 390], ['en', 1280]]) {
  const res = {}
  for (const state of ['off', 'on']) {
    const { ctx, p } = await open('shop', lang, w, state, {})
    const idx = await p.evaluate(() => [...document.querySelectorAll('.product-grid-card')].findIndex((c) => !c.querySelector('a > span[class*="bg-ink"]')))
    const grab = async (sel) => {
      await p.evaluate(({ idx }) => { document.activeElement?.blur?.(); document.querySelectorAll('.product-grid-card')[idx].scrollIntoView({ block: 'center' }) }, { idx })
      await p.keyboard.press('Shift'); await p.keyboard.press('Tab')
      await p.evaluate(({ idx, sel }) => document.querySelectorAll('.product-grid-card')[idx].querySelector(sel).focus(), { idx, sel })
      const r = await p.evaluate(({ idx }) => { const b = document.querySelectorAll('.product-grid-card')[idx].getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }, { idx })
      const buf = await p.screenshot()
      const outside = await pixels(buf, 'ring', { colour: RING, inner: { l: r.l, r: r.r, t: r.t, b: r.b }, outer: { l: r.l - 6, r: r.r + 6, t: r.t - 6, b: r.b + 6 }, tol: 14 })
      const whole = await pixels(buf, 'near', { colour: RING, rect: { l: r.l - 6, r: r.r + 6, t: r.t - 6, b: r.b + 6 }, tol: 14 })
      return { outside, whole, w: r.w, h: r.h }
    }
    res[state] = { photo: await grab('.catalog-card-image > a'), title: await grab('.catalog-card-info > a'), heart: await grab('.catalog-card-save') }
    await ctx.close()
  }
  is(res.off.photo.outside === 0 && res.on.photo.outside >= 1500, `${lang} ${w}px: the photo link's focus ring is drawn around the card (${res.off.photo.outside} -> ${res.on.photo.outside} ring px)`)
  is(Math.abs(res.on.photo.w - res.off.photo.w) < 0.5 && Math.abs(res.on.photo.h - res.off.photo.h) < 0.5, `${lang} ${w}px: the card box is unchanged`)
  for (const k of ['title', 'heart']) is(Math.abs(res.on[k].whole - res.off[k].whole) <= Math.max(0.05 * res.off[k].whole, 5), `${lang} ${w}px: the ${k} ring is unchanged, no double ring (${res.off[k].whole} -> ${res.on[k].whole} px)`)
}

head('[gs-8] idle grid and reduced motion')
for (const [lang, w] of [['ar', 390], ['en', 1280]]) {
  const res = {}
  for (const state of ['off', 'on']) {
    const { ctx, p } = await open('shop', lang, w, state, { cls: true, delay: 600 })
    // what the bundle does when a photo has loaded: hide its skeleton (the "no photo" plate keeps its skeleton)
    await p.evaluate(() => document.querySelectorAll('.image-loading-skeleton').forEach((s) => { const img = s.nextElementSibling; if (img && !/product-photo-unavailable/.test(img.getAttribute('src') || '')) s.classList.add('is-hidden') }))
    await p.waitForTimeout(500)
    const run = await p.evaluate(() => ({ running: document.getAnimations().filter((a) => a.playState === 'running').length, cls: window.__cls, hidden: getComputedStyle(document.querySelector('.image-loading-skeleton.is-hidden')).opacity, total: document.querySelectorAll('.image-loading-skeleton').length, h: document.querySelector('.product-grid-card').getBoundingClientRect().height }))
    await ctx.close()
    const rm = await open('shop', lang, w, state, { motion: 'reduce' })
    const reduced = await rm.p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    await rm.p.hover('.product-grid-card .catalog-card-photo'); await rm.p.waitForTimeout(900)
    const scale = await rm.p.evaluate(() => getComputedStyle(document.querySelector('.product-grid-card .catalog-card-photo')).scale)
    await rm.ctx.close()
    res[state] = { ...run, reduced, scale }
  }
  is(res.off.running >= 9 && res.on.running === 0, `${lang} ${w}px: a loaded grid runs no animation (${res.off.running} -> ${res.on.running}; ${res.on.total} skeletons incl. the "no photo" plates)`)
  is(res.on.hidden === '0' && Math.abs(res.on.h - res.off.h) < 0.5 && res.on.cls < 0.001, `${lang} ${w}px: the skeleton fade-out still works (opacity ${res.on.hidden}), card height unchanged, layout shift ${res.on.cls.toFixed(4)} with photos delayed 600ms`)
  is(res.off.reduced >= 9 && res.on.reduced === 0, `${lang} ${w}px: reduced motion stops every shimmer (${res.off.reduced} -> ${res.on.reduced})`)
  is(res.off.scale === '1.03' && res.on.scale === 'none', `${lang} ${w}px: reduced motion + hover: no photo zoom (${res.off.scale} -> ${res.on.scale})`)
}

// ---- the 4-card home essentials row ---------------------------------------------------------------------------------------
head('[gs-2] the home essentials row (4 cards)')
for (const lang of ['ar', 'en']) for (const w of [768, 900, 1023, 1280, 390]) {
  const a = await open('ess', lang, w, 'off'), b = await open('ess', lang, w, 'on')
  const off = await cardMetrics(a.p), on = await cardMetrics(b.p); await a.ctx.close(); await b.ctx.close()
  if (w >= 768 && w < 1024) is(off.rows === 2 && on.rows === 1 && on.cols === 4 && on.cards.every((c) => c.lines <= 2) && on.over <= 0, `${lang} ${w}px: essentials 3 + 1 -> 4 across, names within 2 lines`, `rows ${off.rows} -> ${on.rows}`)
  else is(off.cols === on.cols && on.over <= 0, `${lang} ${w}px: essentials columns unchanged (${on.cols}), no sideways scroll`)
}

// ---- [gs-t1..t3] tiles --------------------------------------------------------------------------------------------------------
const tileMetrics = (p) => p.evaluate(() => {
  const g = document.querySelector('.home-category-grid'), ts = [...g.querySelectorAll(':scope > .campaign-category')]
  return { over: document.documentElement.scrollWidth - innerWidth, h: ts.map((t) => t.getBoundingClientRect().height), w: ts.map((t) => t.getBoundingClientRect().width), gridH: g.getBoundingClientRect().height,
    inside: ts.every((t) => { const tb = t.getBoundingClientRect(), c = t.querySelector('.campaign-category__content').getBoundingClientRect(); return c.bottom <= tb.bottom + 0.5 && c.top >= tb.top - 0.5 }) }
})
const spread = (a) => Math.max(...a) - Math.min(...a)
head('[gs-t1] equal tile heights')
const TW = [280, 320, 360, 375, 390, 414, 600, 768, 1024, 1280]
const T = {}
for (const lang of ['ar', 'en']) for (const w of TW) for (const state of ['off', 'on']) { const x = await open('tiles', lang, w, state); T[`${lang}${w}${state}`] = await tileMetrics(x.p); await x.ctx.close() }
for (const lang of ['ar', 'en']) {
  for (const w of TW) {
    const off = T[`${lang}${w}off`], on = T[`${lang}${w}on`]
    is(spread(on.h) <= 0.5 && on.over <= 0 && on.inside, `${lang} ${w}px: the 4 tiles are equal (spread ${f1(spread(off.h))} -> ${f1(spread(on.h))}px, grid ${f1(off.gridH)} -> ${f1(on.gridH)}), nothing overflows`)
    if (w >= 390) is(on.h.every((v, i) => Math.abs(v - off.h[i]) <= 0.5), `${lang} ${w}px: heights identical to before (${on.h.map(Math.round).join('/')})`)
  }
  is(spread(T[`${lang}320off`].h) > 3 && spread(T[`${lang}360off`].h) > 3, `${lang}: before, the phone tiles differed by ${f1(spread(T[`${lang}320off`].h))}px at 320 and ${f1(spread(T[`${lang}360off`].h))}px at 360`)
}

head('[gs-t2] English scrim, [gs-t3] motion and forced colours')
const tileText = async (lang, w, state) => {
  const { ctx, p } = await open('tiles', lang, w, state)
  const out = await p.evaluate(() => { const tiles = [...document.querySelectorAll('.home-category-grid > .campaign-category')]; return tiles.map((t) => ({ scrim: getComputedStyle(t.querySelector('.cat-scrim')).backgroundImage })) })
  const res = []
  const n = out.length
  for (let i = 0; i < n; i++) {
    const r = await p.evaluate((i) => {
      const t = document.querySelectorAll('.home-category-grid > .campaign-category')[i]; t.scrollIntoView({ block: 'center' })
      const st = document.createElement('style'); st.id = 'hide'; st.textContent = '.campaign-category__content *{color:transparent!important}.campaign-category__arrow{visibility:hidden!important}'; document.head.appendChild(st)
      const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom } }
      const out = { col: {} }; for (const k of ['brief', 'kicker', 'title']) { const e = t.querySelector('.campaign-category__' + k); out[k] = R(e); if (e) out.col[k] = getComputedStyle(e).color } return out
    }, i)
    // the colours were read before the override; the screenshot has the copy hidden so only the background is measured
    const buf = await p.screenshot()
    await p.evaluate(() => document.getElementById('hide').remove())
    const c = {}
    for (const k of ['brief', 'kicker', 'title']) { if (!r[k]) { c[k] = 99; continue } const L = await pixels(buf, 'p95', { rect: r[k] }); c[k] = (lum(rgb(r.col[k])) + 0.05) / (L + 0.05) }
    res.push({ ...c, scrim: out[i].scrim })
  }
  await ctx.close(); return res
}
for (const [lang, w, tiles] of [['en', 390, [0, 1, 2, 3]], ['en', 768, [0, 1]], ['en', 1280, [0, 1]]]) {
  const off = await tileText(lang, w, 'off'), on = await tileText(lang, w, 'on')
  const brief = tiles.map((i) => `${f1(off[i].brief)} -> ${f1(on[i].brief)}`).join(' / ')
  is(tiles.every((i) => on[i].brief >= 4.5 && on[i].brief >= off[i].brief) && tiles.some((i) => off[i].brief < 4.5), `${lang} ${w}px: the brief reads >= 4.5:1 over a bright photo (p95 ${brief})`)
  is(tiles.every((i) => on[i].kicker >= off[i].kicker - 0.01 && on[i].title >= off[i].title - 0.01), `${lang} ${w}px: kicker and title contrast not lower than before`)
}
{
  const off = await tileText('ar', 390, 'off'), on = await tileText('ar', 390, 'on')
  is(off.every((x, i) => x.scrim === on[i].scrim && x.scrim !== 'none'), 'ar 390px: the Arabic scrim is byte-identical to before')
  const lt = await tileText('en', 390, 'on')
  is(/linear-gradient\(to top/.test(lt[0].scrim), 'en 390px: the English scrim has the bottom gradient', lt[0].scrim.slice(0, 60))
}
for (const lang of ['ar', 'en']) {
  const res = {}
  for (const state of ['off', 'on']) {
    const { ctx, p } = await open('tiles', lang, 1280, state, { motion: 'reduce' })
    await p.hover('.home-category-grid > .campaign-category'); await p.waitForTimeout(900)
    res[state] = await p.evaluate(() => { const t = document.querySelector('.home-category-grid > .campaign-category'); const i = t.querySelector('picture > img'); return { tr: getComputedStyle(t).transform, scale: getComputedStyle(i).scale, itr: getComputedStyle(i).transform } })
    await ctx.close()
    const c2 = await open('tiles', lang, 390, state, { forced: true })
    res[state].forced = await c2.p.evaluate(() => { const t = document.querySelector('.home-category-grid > .campaign-category'), c = t.querySelector('.campaign-category__content'), cs = getComputedStyle(c); return { pad: cs.paddingTop, bg: cs.backgroundColor, fg: getComputedStyle(t.querySelector('.campaign-category__brief')).color, h: t.getBoundingClientRect().height, over: document.documentElement.scrollWidth - innerWidth } })
    await c2.ctx.close()
    const c3 = await open('tiles', lang, 390, state, {})
    res[state].normal = await c3.p.evaluate(() => { const c = document.querySelector('.campaign-category__content'), cs = getComputedStyle(c); return { pad: cs.padding, bg: cs.backgroundColor, h: document.querySelector('.campaign-category').getBoundingClientRect().height } })
    await c3.ctx.close()
  }
  is(res.off.tr !== 'none' && res.on.tr === 'none', `${lang}: reduced motion + hover, the tile does not lift (${res.off.tr} -> ${res.on.tr})`)
  is((res.off.scale !== 'none') && res.on.scale === 'none', `${lang}: reduced motion + hover, the tile photo does not zoom (${res.off.scale} -> ${res.on.scale})`)
  is(parseFloat(res.off.forced.pad) < parseFloat(res.on.forced.pad) && res.on.forced.over <= 0 && ratio(rgb(res.on.forced.bg), rgb(res.on.forced.fg)) >= 7, `${lang}: forced colours, the copy is backed (padding ${res.off.forced.pad} -> ${res.on.forced.pad}, ${f1(ratio(rgb(res.on.forced.bg), rgb(res.on.forced.fg)))}:1, tile ${f1(res.off.forced.h)} -> ${f1(res.on.forced.h)}px)`)
  is(res.off.normal.pad === res.on.normal.pad && res.off.normal.bg === res.on.normal.bg && Math.abs(res.off.normal.h - res.on.normal.h) < 0.5, `${lang}: normal colours, the copy block is unchanged`)
}

// ---- global: the product page's related row (4 cards) -------------------------------------------------------------------------
head('related row on the product page (fixture product-desc)')
{
  const { page, DESC } = await import('./fixtures/product-desc.mjs')
  for (const lang of ['ar', 'en']) for (const w of [390, 768, 1023, 1280]) {
    const run = async (css) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }), p = await ctx.newPage()
      await p.setContent(page(lang, DESC[lang], css)); await p.waitForTimeout(100)
      const r = await p.evaluate(() => { const g = document.querySelector('.product-grid'); if (!g) return null; const cs = [...g.querySelectorAll('.product-grid-card')]; return { n: cs.length, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, over: document.documentElement.scrollWidth - innerWidth } })
      await ctx.close(); return r
    }
    const off = await run(GRID_OFF), on = await run(GRID_ON)
    if (!off) { note(`${lang} ${w}px: the product fixture has no .product-grid`); continue }
    is(on.over <= 0 && (off.n === 4 && w >= 768 && w < 1024 ? on.cols === 4 : on.cols === off.cols), `${lang} ${w}px: related row (${on.n} cards) ${off.cols} -> ${on.cols} columns, no sideways scroll`)
  }
}

// ---- must not change -------------------------------------------------------------------------------------------------------------
head('must not change')
{
  const sec = GRID_ON.split(MARK)[1] || '', tsec = TILE_ON.split(MARK)[1] || ''
  is(!/(^|[^-a-z])(margin|padding|border|inset)-(left|right)\b|(^|[;{\s])(left|right)\s*:|text-align\s*:\s*(left|right)/.test(sec + tsec), 'the added CSS uses logical properties only')
  for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
    const off = m(lang, w, 'off'), on = m(lang, w, 'on')
    is(on.gap === off.gap && on.cards.every((c, i) => Math.abs(c.frame.h / c.frame.w - 1.25) < 0.01 && Math.abs(c.frame.w - off.cards[i].frame.w) < 0.5), `${lang} ${w}px: gaps (${on.gap}px), the 4:5 frame (${f1(on.cards[0].frame.h / on.cards[0].frame.w)}) and frame widths unchanged`)
  }
  for (const w of [390, 1280]) { // the sporta-images FRAMES rule: a real photo fills its frame; the plate keeps its pad
    const q = {}
    for (const state of ['off', 'on']) {
      const { ctx, p } = await open('shop', 'en', w, state)
      q[state] = await p.evaluate(() => [...document.querySelectorAll('.product-grid-card')].map((c) => { const i = c.querySelector('img'), f = c.querySelector('.catalog-card-image').getBoundingClientRect(), b = i.getBoundingClientRect(), cs = getComputedStyle(i); return [b.width.toFixed(1), b.height.toFixed(1), cs.padding, cs.objectFit, (f.width - b.width).toFixed(1)].join('|') }))
      await ctx.close()
    }
    is(q.off.join() === q.on.join(), `${w}px: photo and plate boxes, padding and fit identical off vs on (FRAMES untouched)`)
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
