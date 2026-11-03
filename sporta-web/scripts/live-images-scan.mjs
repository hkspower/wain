// READ-ONLY scan of every image on the LIVE storefront (home, shop, brand filter, two product pages, bag drawer,
// checkout summary, footer): displayed box vs natural size, object-fit / crop, loading attributes, alt text,
// width/height reservation, CLS and LCP over a 4 s load, broken or placeholder images, brand-logo ink size and contrast,
// sticky gallery column, network image weight. Measures the DOM only. It adds one item to a throwaway browser bag
// (client side) to reach the drawer and /checkout and NEVER presses the order button, submits a form or signs in.
//
//   VW=390 VH=844 DPR=2 LNG=ar PAGES=home,shop SLUGA=<slug> BRAND=<slug> node scripts/live-images-scan.mjs
//
// Run on the VPS in the Playwright image (npm i playwright@1.49.0 with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), like
// live-cart-drawer-scan.mjs. PAGES is any of: api, home, shop, brand, prodA, prodB, cart (adds checkout when listed).
// Check behind public/sporta-images.css, sporta-grid.css and sporta-cat-tiles.css (the live storefront is a compiled
// build, so images can only be adjusted from outside with CSS).
import { chromium } from 'playwright'
// ---- in-page image scan (runs in the browser; no template literals, no dollar signs) ----
const SCAN = () => {
  const vw = innerWidth, vh = innerHeight, dpr = devicePixelRatio
  const ss = (u) => (u.indexOf('data:') === 0 ? 'data:' + u.slice(5, 22) + '..len' + u.length : u.replace(location.origin, '').slice(0, 90))
  const cls = (e) => String(e.getAttribute && e.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0] || ''
  const ctx = (e) => {
    const parts = []
    let p = e.parentElement
    for (let i = 0; i < 4 && p && p !== document.body; i++, p = p.parentElement) {
      const c = cls(p)
      parts.push(p.tagName.toLowerCase() + (c ? '.' + c.slice(0, 26) : ''))
    }
    return parts.join('<')
  }
  const rect = (e) => e.getBoundingClientRect()
  const out = { imgs: [], bgs: [], pics: [], misc: [] }
  for (const im of document.images) {
    const b = rect(im), cs = getComputedStyle(im)
    const nw = im.naturalWidth, nh = im.naturalHeight
    const vis = b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    const fit = cs.objectFit, pos = cs.objectPosition
    out.imgs.push({
      full: im.getAttribute('srcset') ? (im.currentSrc || '') : '', bwf: b.width, bhf: b.height,
      src: ss(im.currentSrc || im.src || ''),
      ctx: ctx(im), vis,
      bw: Math.round(b.width), bh: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top + scrollY),
      nw, nh, cx: im.complete,
      fit, pos: pos.replace(/ /g, '/'),
      ld: im.getAttribute('loading') || '', fp: im.getAttribute('fetchpriority') || '', dec: im.getAttribute('decoding') || '',
      alt: im.getAttribute('alt') === null ? 'MISSING' : im.getAttribute('alt'),
      wa: im.getAttribute('width') || '', ha: im.getAttribute('height') || '',
      ss: im.getAttribute('srcset') ? 1 : 0, ar: cs.aspectRatio, role: im.getAttribute('role') || '', ah: im.getAttribute('aria-hidden') || '',
      inView: (b.top + scrollY) < vh && (b.bottom + scrollY) > 0 && b.left < vw && b.right > 0,
      ovfX: b.width > vw + 1,
    })
  }
  for (const pc of document.querySelectorAll('picture')) {
    const im = pc.querySelector('img')
    out.pics.push({ ctx: ctx(pc), src: [...pc.querySelectorAll('source')].map((s) => (s.getAttribute('media') || '-') + '=' + (s.getAttribute('type') || '') + ':' + String(s.getAttribute('srcset') || '').slice(0, 50)).join(' ; '), img: im ? (im.currentSrc || '').replace(location.origin, '').slice(-50) : '' })
  }
  const all = document.querySelectorAll('*')
  for (let i = 0; i < all.length && i < 6000; i++) {
    const e = all[i]
    const cs = getComputedStyle(e)
    const bi = cs.backgroundImage
    if (bi && bi !== 'none' && bi.indexOf('url(') >= 0) {
      const b = rect(e)
      const m = bi.match(/url\(["']?([^"')]+)["']?\)/)
      out.bgs.push({ el: e.tagName.toLowerCase() + '.' + cls(e).slice(0, 28), ctx: ctx(e), url: m ? m[1].replace(location.origin, '').slice(0, 80) : bi.slice(0, 40), bw: Math.round(b.width), bh: Math.round(b.height), y: Math.round(b.top + scrollY), size: cs.backgroundSize, pos: cs.backgroundPosition, rep: cs.backgroundRepeat })
    }
    // svg <image> and <use>
    if (e.tagName === 'image' && e.ownerSVGElement) out.misc.push('svgimage ' + (e.getAttribute('href') || '').slice(0, 60))
  }
  out.docW = document.documentElement.scrollWidth; out.vw = vw; out.vh = vh; out.dpr = dpr
  out.docH = document.documentElement.scrollHeight
  return out
}

const BGSIZE = async (urls) => {
  const res = {}
  await Promise.all(urls.map((u) => new Promise((ok) => {
    const im = new Image()
    const to = setTimeout(() => ok(), 6000)
    im.onload = () => { res[u] = [im.naturalWidth, im.naturalHeight]; clearTimeout(to); ok() }
    im.onerror = () => { res[u] = [0, 0]; clearTimeout(to); ok() }
    im.src = u
  })))
  return res
}

const f = (n) => (n == null ? '' : String(n))
// compact reporting of a scan: grouped lines + anomaly lines
const report = (tag, S, bgNat, net) => {
  const L = []
  const kbOf = {}
  for (const n of net || []) kbOf[n.u] = Math.round(n.len / 1024)
  let nPh = 0
  for (const m of S.imgs) if (m.vis && /product-photo-unavailable/.test(m.src)) nPh++
  L.push(tag + ' PLACEHOLDERS visible ' + nPh + ' of ' + S.imgs.filter((m) => m.vis && m.bw > 100).length + ' big imgs')
  const groups = new Map()
  for (const m of S.imgs) {
    if (!m.vis && m.nw === 0 && !m.src) continue
    const key = [m.ctx.slice(0, 60), m.bw + 'x' + m.bh, m.fit, m.vis ? 'v' : 'h'].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  for (const [k, g] of groups) {
    const nws = g.map((x) => x.nw), ov = g.map((x) => x.over), ar = g.map((x) => x.natAr), ef = g.map((x) => x.eff)
    const lds = [...new Set(g.map((x) => x.ld || '-'))].join(',')
    const fps = [...new Set(g.map((x) => x.fp || '-'))].join(',')
    const decs = [...new Set(g.map((x) => x.dec || '-'))].join(',')
    const alts = g.filter((x) => x.alt === '' || x.alt === 'MISSING').length
    const ws = [...new Set(g.map((x) => (x.wa || '-') + 'x' + (x.ha || '-')))].join(',')
    const crops = g.map((x) => x.cropPct + '/' + x.bandPct)
    L.push(tag + ' G ' + g.length + 'x ' + k + ' nat ' + Math.min(...nws) + '-' + Math.max(...nws) + ' natAr ' + Math.min(...ar) + '-' + Math.max(...ar) + ' over ' + Math.min(...ov) + '-' + Math.max(...ov) + ' eff ' + Math.min(...ef) + '-' + Math.max(...ef) + ' ld ' + lds + ' fp ' + fps + ' dec ' + decs + ' altEmpty ' + alts + ' wh ' + ws + ' crop/band ' + [...new Set(crops)].slice(0, 4).join(',') + ' pos ' + [...new Set(g.map((x) => x.pos))].slice(0, 2).join(',') + ' ex ' + (g[0].src.indexOf('data:') === 0 ? g[0].src : g[0].src.slice(-48)))
  }
  const agg = new Map()
  for (const m of S.imgs) {
    const fl = []
    if (m.vis && (m.nw === 0 || !m.cx)) fl.push('BROKEN')
    if (m.vis && m.nw && m.eff > 1.05 && m.bw > 40) fl.push('UPSCALED')
    const kb = kbOf[m.src] == null ? -1 : kbOf[m.src]
    if (m.vis && m.over > 2 && (kb >= 30 || m.over >= 6)) fl.push('OVERSIZE')
    if (m.vis && m.ovfX) fl.push('OVERFLOWX')
    if (/placeholder|unavailable|default|no-image|noimage/i.test(m.src)) fl.push('PLACEHOLDER')
    if (m.vis && m.alt === 'MISSING') fl.push('ALT-MISSING')
    if (m.vis && m.inView && m.ld === 'lazy') fl.push('LAZY-INVIEW')
    if (!fl.length) continue
    const key = fl.join(',') + '|' + m.ctx.slice(0, 34) + '|' + m.bw + 'x' + m.bh
    if (!agg.has(key)) agg.set(key, { fl, n: 0, m, kb, effs: [], ys: [] })
    const g = agg.get(key); g.n++; g.effs.push(m.eff); g.ys.push(m.y)
  }
  for (const [, g] of agg) {
    const m = g.m
    L.push(tag + ' A ' + g.n + 'x ' + g.fl.join(',') + ' ' + m.ctx.slice(0, 40) + ' box ' + m.bw + 'x' + m.bh + ' y' + Math.min(...g.ys) + '-' + Math.max(...g.ys) + ' nat ' + m.nw + 'x' + m.nh + ' eff ' + Math.min(...g.effs) + '-' + Math.max(...g.effs) + ' ' + g.kb + 'KB fit ' + m.fit + ' alt "' + String(m.alt).slice(0, 24) + '" ld ' + m.ld + ' ex ' + (m.src.indexOf('data:') === 0 ? m.src : m.src.slice(-58)))
  }
  for (const b of S.bgs) {
    const n = bgNat && bgNat[b.url] ? bgNat[b.url] : [0, 0]
    L.push(tag + ' BG ' + b.el + ' ' + b.ctx.slice(0, 40) + ' box ' + b.bw + 'x' + b.bh + ' @y' + b.y + ' nat ' + n[0] + 'x' + n[1] + ' size ' + b.size + ' pos ' + b.pos.replace(/ /g, '/') + ' rep ' + b.rep + ' ' + b.url.slice(-50))
  }
  for (const p of S.pics) L.push(tag + ' PIC ' + p.ctx.slice(0, 40) + ' [' + p.src.slice(0, 160) + '] img ' + p.img)
  for (const x of S.misc) L.push(tag + ' MISC ' + x)
  L.push(tag + ' DOC scrollW ' + S.docW + ' vw ' + S.vw + ' docH ' + S.docH + ' dpr ' + S.dpr + (S.docW > S.vw ? ' HSCROLL' : ''))
  return L
}

const REAL = async (urls) => {
  const res = {}
  await Promise.all(urls.map((u) => new Promise((ok) => {
    const im = new Image()
    const to = setTimeout(() => ok(), 8000)
    im.onload = () => { res[u] = [im.naturalWidth, im.naturalHeight]; clearTimeout(to); ok() }
    im.onerror = () => { clearTimeout(to); ok() }
    im.src = u
  })))
  return res
}

const derive = (m, dpr) => {
  const bw = m.bwf, bh = m.bhf
  const boxAr = bh ? bw / bh : 0, natAr = m.nh ? m.nw / m.nh : 0
  m.boxAr = +boxAr.toFixed(3); m.natAr = +natAr.toFixed(3)
  m.cropPct = 0; m.bandPct = 0; m.eff = 0; m.over = 0
  if (m.nw && m.nh && bw && bh) {
    const k = Math.min(natAr / boxAr, boxAr / natAr)
    if (m.fit === 'cover') m.cropPct = Math.round((1 - k) * 100)
    else if (m.fit === 'contain' || m.fit === 'scale-down') m.bandPct = Math.round((1 - k) * 100)
    else if (m.fit === 'fill') m.cropPct = -Math.round(Math.abs(1 - natAr / boxAr) * 100)
    const sc = (m.fit === 'cover' || m.fit === 'fill') ? Math.max(bw / m.nw, bh / m.nh) : Math.min(bw / m.nw, bh / m.nh)
    m.eff = +(sc * dpr).toFixed(2)
    m.over = m.eff ? +(1 / m.eff).toFixed(2) : 0
  }
}

const scanPage = async (page, tag, net) => {
  const S = await page.evaluate(SCAN)
  // naturalWidth of an <img srcset sizes> is DENSITY-CORRECTED (it equals the sizes slot, not the file): load the real file
  const fulls = [...new Set(S.imgs.filter((m) => m.full).map((m) => m.full))]
  const real = fulls.length ? await page.evaluate(REAL, fulls) : {}
  for (const m of S.imgs) {
    if (m.full && real[m.full]) { m.nw = real[m.full][0]; m.nh = real[m.full][1] }
    derive(m, S.dpr)
  }
  const urls = [...new Set(S.bgs.map((b) => b.url).filter((u) => u.indexOf('data:') !== 0))]
  const bgNat = urls.length ? await page.evaluate(BGSIZE, urls) : {}
  return { S, lines: report(tag, S, bgNat, net) }
}

const E = process.env
const setInject = (c) => { CSS_INJECT = c }
const BASE = E.BASE || 'https://www.sporta.com.kw'
const VW = Number(E.VW || 1280), VH = Number(E.VH || 800), DPR = Number(E.DPR || 1), LANG = E.LNG || 'ar'
const PAGES = String(E.PAGES || 'home').split(',')
const SLUG_A = E.SLUGA || '', SLUG_B = E.SLUGB || '', BRAND = E.BRAND || ''
const q = (u) => (LANG === 'en' ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'lang=en' : u)
let CSS_INJECT = ''
const OUT = []
const P = (s) => { console.log(s) }

const INIT = () => {
  window.__cls = 0; window.__sh = []; window.__lcp = null
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue
        window.__cls += e.value
        window.__sh.push([Math.round(e.startTime), +e.value.toFixed(4), (e.sources || []).map((s) => (s.node ? s.node.nodeName + '.' + String(s.node.className || '').split(' ')[0].slice(0, 24) : '?')).join(',').slice(0, 80)])
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((l) => {
      const es = l.getEntries(); const e = es[es.length - 1]
      window.__lcp = { t: Math.round(e.startTime), url: String(e.url || '').slice(-60), el: e.element ? e.element.tagName + '.' + String(e.element.className || '').split(' ')[0].slice(0, 30) : '', size: e.size }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (e) {}
}

const LOGO_STATS = () => {
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgOf = (e) => { let p = e; while (p) { const c = getComputedStyle(p).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const a = m[1].split(',').map(Number); if (a.length < 4 || a[3] > 0.5) return a } p = p.parentElement } return [255, 255, 255] }
  const rows = []
  const sel = '.brand-bar__item img, footer img, [class*=payment] img, [class*=pay] img'
  for (const im of document.querySelectorAll(sel)) {
    const b = im.getBoundingClientRect()
    if (!im.naturalWidth || !b.width) { rows.push({ src: (im.currentSrc || '').slice(-40), bw: Math.round(b.width), bh: Math.round(b.height), nw: im.naturalWidth, err: 'noimg' }); continue }
    try {
      const w = 96, h = Math.max(8, Math.round(96 * im.naturalHeight / im.naturalWidth))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h)
      const d = x.getImageData(0, 0, w, h).data
      let minX = w, minY = h, maxX = -1, maxY = -1, n = 0, sl = 0
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const i = (yy * w + xx) * 4; if (d[i + 3] > 24) { n++; sl += lum(d[i], d[i + 1], d[i + 2]); if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy } }
      const ml = n ? sl / n : 0
      const bg = bgOf(im); const bl = lum(bg[0], bg[1], bg[2])
      const cr = (Math.max(ml, bl) + 0.05) / (Math.min(ml, bl) + 0.05)
      rows.push({ src: (im.currentSrc || '').replace(location.origin, '').slice(-42), alt: im.getAttribute('alt'), bw: Math.round(b.width), bh: Math.round(b.height), nw: im.naturalWidth, nh: im.naturalHeight, inkW: n ? Math.round((maxX - minX + 1) / w * 100) : 0, inkH: n ? Math.round((maxY - minY + 1) / h * 100) : 0, opaque: Math.round(n / (w * h) * 100), meanL: +ml.toFixed(2), bg: bg.join(','), contrast: +cr.toFixed(1), ctx: (im.closest('.brand-bar__item') ? 'brandbar' : im.closest('footer') ? 'footer' : 'other') })
    } catch (e) { rows.push({ src: (im.currentSrc || '').slice(-40), err: String(e.message).slice(0, 40) }) }
  }
  return rows
}

const FOOTER = () => {
  const f = document.querySelector('footer'); if (!f) return ['NO FOOTER']
  const out = []
  const fb = f.getBoundingClientRect()
  out.push('footer y' + Math.round(fb.top + scrollY) + ' h' + Math.round(fb.height) + ' w' + Math.round(fb.width))
  for (const e of f.querySelectorAll('img,svg,picture')) {
    const b = e.getBoundingClientRect(); if (!b.width) continue
    const al = e.getAttribute('alt'), ar = e.getAttribute('aria-label'), tt = e.querySelector && e.querySelector('title')
    out.push(e.tagName.toLowerCase() + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' @' + Math.round(b.left) + ',' + Math.round(b.top + scrollY) + (e.tagName === 'IMG' ? ' nat ' + e.naturalWidth + 'x' + e.naturalHeight + ' fit ' + getComputedStyle(e).objectFit + ' src ' + (e.currentSrc || '').replace(location.origin, '').slice(-40) : ' vb ' + e.getAttribute('viewBox')) + ' alt ' + JSON.stringify(al) + ' aria ' + JSON.stringify(ar) + ' title ' + JSON.stringify(tt ? tt.textContent.slice(0, 20) : null) + ' hit ' + (e.closest('a,button') ? Math.round(e.closest('a,button').getBoundingClientRect().width) + 'x' + Math.round(e.closest('a,button').getBoundingClientRect().height) : '-') + ' par ' + (e.parentElement ? e.parentElement.tagName.toLowerCase() + '.' + String(e.parentElement.className.baseVal !== undefined ? e.parentElement.className.baseVal : e.parentElement.className).split(' ')[0].slice(0, 24) : ''))
  }
  return out
}

const EDGE = () => {
  const out = []
  const bgOf = (e) => { let p = e; while (p) { const c = getComputedStyle(p).backgroundColor; const mm = c.match(/rgba?\(([^)]+)\)/); if (mm) { const a = mm[1].split(',').map(Number); if (a.length < 4 || a[3] > 0.5) return { rgb: a.slice(0, 3), el: p.tagName.toLowerCase() + '.' + String(p.className).split(' ')[0].slice(0, 28) } } p = p.parentElement } return { rgb: [255, 255, 255], el: 'default' } }
  const imgs = [...document.querySelectorAll('.catalog-gallery-photo, .catalog-card-photo')].slice(0, 6)
  for (const im of imgs) {
    if (!im.naturalWidth) continue
    try {
      const w = 40, h = Math.max(8, Math.round(40 * im.naturalHeight / im.naturalWidth))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h)
      const px = (xx, yy) => Array.from(x.getImageData(xx, yy, 1, 1).data)
      const cs = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)]
      const bg = bgOf(im)
      const opaque = cs.filter((p) => p[3] > 200)
      const diff = opaque.length ? Math.max(...opaque.map((p) => Math.max(Math.abs(p[0] - bg.rgb[0]), Math.abs(p[1] - bg.rgb[1]), Math.abs(p[2] - bg.rgb[2])))) : -1
      out.push((im.getAttribute('src') || '').slice(-44) + ' corners ' + JSON.stringify(cs.map((p) => p.slice(0, 4).join('/'))) + ' bg ' + bg.rgb.join(',') + ' via ' + bg.el + ' maxdiff ' + diff)
    } catch (e) { out.push('edge err ' + String(e.message).slice(0, 40)) }
  }
  return out
}

const netAttach = (page, net) => {
  page.on('response', async (r) => {
    try {
      const rq = r.request()
      if (rq.resourceType() !== 'image') return
      const h = r.headers()
      let len = Number(h['content-length'] || 0)
      if (!len && r.status() < 300) { try { len = (await r.body()).length } catch (e) {} }
      net.push({ u: r.url().replace('https://www.sporta.com.kw', '').slice(0, 90), s: r.status(), ct: (h['content-type'] || '').replace('image/', ''), len, cc: (h['cache-control'] || '').slice(0, 40) })
    } catch (e) {}
  })
  page.on('requestfailed', (rq) => { if (rq.resourceType() === 'image') net.push({ u: rq.url().replace('https://www.sporta.com.kw', '').slice(0, 90), s: 0, ct: 'FAILED', len: 0, cc: String(rq.failure() && rq.failure().errorText) }) })
}

const netReport = (tag, net) => {
  const bad = net.filter((n) => n.s >= 400 || n.s === 0)
  const tot = net.reduce((a, n) => a + n.len, 0)
  const types = {}
  for (const n of net) types[n.ct] = (types[n.ct] || 0) + 1
  P(tag + ' NET imgs ' + net.length + ' totalKB ' + Math.round(tot / 1024) + ' types ' + JSON.stringify(types) + ' bad ' + bad.length)
  for (const n of bad.slice(0, 6)) P(tag + ' NETBAD ' + n.s + ' ' + n.u + ' ' + n.cc)
  const big = net.filter((n) => n.len > 120000).sort((a, b) => b.len - a.len).slice(0, 6)
  for (const n of big) P(tag + ' NETBIG ' + Math.round(n.len / 1024) + 'KB ' + n.ct + ' ' + n.u + ' cc[' + n.cc + ']')
  const ccs = [...new Set(net.filter((n) => n.s < 400).map((n) => n.cc))].slice(0, 4)
  P(tag + ' NETCC ' + JSON.stringify(ccs))
}

const scrollAll = async (page) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  const step = Math.max(300, Math.round(VH * 0.7))
  let y = 0, n = 0
  while (y < h && n < 40) { y += step; n++; await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(260) }
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
}

const visit = async (ctx, tag, url, opts) => {
  opts = opts || {}
  const page = await ctx.newPage()
  const net = []
  netAttach(page, net)
  let st = 0
  try {
    const r = await page.goto(BASE + url, { waitUntil: 'load', timeout: 90000 })
    st = r ? r.status() : 0
  } catch (e) { P(tag + ' GOTO_FAIL ' + String(e.message).slice(0, 120)); await page.close(); return null }
  await page.waitForTimeout(4000)
  const m = await page.evaluate(() => ({ cls: +window.__cls.toFixed(4), sh: window.__sh.slice(0, 6), lcp: window.__lcp, title: document.title.slice(0, 50), lang: document.documentElement.lang, dir: document.documentElement.dir }))
  P(tag + ' LOAD ' + url + ' status ' + st + ' lang ' + m.lang + '/' + m.dir + ' CLS4s ' + m.cls + ' LCP ' + JSON.stringify(m.lcp) + ' title ' + JSON.stringify(m.title))
  for (const s of m.sh) P(tag + ' SHIFT ' + JSON.stringify(s))
  if (CSS_INJECT && !E.EARLY) { await page.addStyleTag({ content: CSS_INJECT }); await page.waitForTimeout(400); P(tag + ' INJECTED css ' + CSS_INJECT.length + ' bytes') }
  if (opts.beforeScroll) await opts.beforeScroll(page)
  await scrollAll(page)
  const m2 = await page.evaluate(() => +window.__cls.toFixed(4))
  P(tag + ' CLS_after_scroll ' + m2)
  return { page, net }
}


const TAG0 = LANG + VW
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: E.CHROME || undefined })
try {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, locale: LANG === 'en' ? 'en-US' : 'ar-KW', bypassCSP: !!E.INJECT })
  await ctx.addInitScript(INIT)
  if (E.INJECT) { let css = ''; for (const u of E.INJECT.split(',')) { try { css += await (await fetch(u)).text() + '\n' } catch (e) { P('INJECT_FAIL ' + u) } } setInject(css); if (E.EARLY) { await ctx.addInitScript((c) => { const s = document.createElement('style'); s.textContent = c; (document.head || document.documentElement).appendChild(s) }, css); P('EARLY_CSS ' + css.length + ' bytes') } }

  if (PAGES.includes('api')) {
    const j = await (await fetch(BASE + '/api/api.php?r=products')).json()
    const list = Array.isArray(j) ? j : (j.products || [])
    const p0 = list[0] || {}
    P('API p0 ' + JSON.stringify(p0).slice(0, 700))
    const withImg = list.filter((p) => p.image || (p.images && p.images.length))
    P('API withImage ' + withImg.length + ' of ' + list.length)
    const multi = list.filter((p) => p.images && p.images.length > 1)
    P('API multi ' + multi.length + ' ' + multi.slice(0, 5).map((p) => p.slug + ':' + p.images.length).join(','))
    const imgTypes = {}
    for (const p of list) { const k = typeof p.image + '/' + (Array.isArray(p.images) ? 'arr' + p.images.length : typeof p.images); imgTypes[k] = (imgTypes[k] || 0) + 1 }
    P('API imgTypes ' + JSON.stringify(imgTypes))
    const ex = withImg.slice(0, 3).map((p) => p.slug + ' image=' + String(p.image).slice(0, 80) + ' images=' + JSON.stringify(p.images).slice(0, 160))
    for (const e of ex) P('API ex ' + e)
  }



  if (PAGES.includes('css')) {
    const h = await (await fetch(BASE + '/?lang=ar')).text()
    const m = h.match(/href="([^"]*assets\/index-[^"]*\.css)"/)
    const css = await (await fetch(BASE + (m ? m[1] : '/assets/index.css'))).text()
    P('CSS bytes ' + css.length + ' from ' + (m ? m[1] : '?'))
    const toks = String(E.TOKENS || 'catalog-gallery,catalog-product-visual,home-category-grid,campaign-category,category-tile,campaign-photo-hero,catalog-card-photo,catalog-card-image,brand-bar__item,cart-drawer__line,catalog-page').split(',')
    const rules = css.split('}')
    let n = 0
    for (const rule of rules) {
      if (toks.some((t) => rule.indexOf(t) >= 0) && n < 70) { n++; P('RULE ' + rule.replace(/\s+/g, ' ').trim().slice(0, 330)) }
    }
  }

  if (PAGES.includes('files')) {
    const j = await (await fetch(BASE + '/api/api.php?r=products')).json()
    const list = Array.isArray(j) ? j : (j.products || [])
    const dimsOf = (b) => {
      try {
        if (b[0] === 0x52 && b[8] === 0x57) {
          const t = String.fromCharCode(b[12], b[13], b[14], b[15])
          if (t === 'VP8 ') return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff]
          if (t === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))]
          if (t === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1] }
        }
        if (b[0] === 0xff && b[1] === 0xd8) { let i = 2; while (i < b.length - 9) { if (b[i] !== 0xff) { i++; continue } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]]; i += 2 + ((b[i + 2] << 8) | b[i + 3]) } }
        if (b[0] === 0x89 && b[1] === 0x50) return [(b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]]
      } catch (e) {}
      return null
    }
    const get = async (u) => { try { const r = await fetch(BASE + u); if (!r.ok) return [r.status, 0, null]; const buf = new Uint8Array(await r.arrayBuffer()); return [r.status, buf.length, dimsOf(buf)] } catch (e) { return [0, 0, null] } }
    let miss = 0
    for (const p of list) {
      const s = p.slug
      const jp = await get('/images/products/' + s + '.jpg')
      const w3 = await get('/images/products/responsive/' + s + '-320.webp')
      const w6 = await get('/images/products/responsive/' + s + '-640.webp')
      const deep = list.indexOf(p) < 2
      const w9 = deep ? await get('/images/products/responsive/' + s + '-960.webp') : [-1, 0, null]
      const w12 = deep ? await get('/images/products/responsive/' + s + '-1280.webp') : [-1, 0, null]
      const wp = deep ? await get('/images/products/' + s + '.webp') : [-1, 0, null]
      const d = (x) => (x[0] === 200 ? x[1] + 'B' + (x[2] ? ' ' + x[2][0] + 'x' + x[2][1] : '') : String(x[0]))
      const has = jp[0] === 200 || w6[0] === 200 || w3[0] === 200
      if (!has) miss++
      P('FILE ' + s + ' | jpg ' + d(jp) + ' | webp ' + d(wp) + ' | 320 ' + d(w3) + ' | 640 ' + d(w6) + ' | 960 ' + d(w9) + ' | 1280 ' + d(w12) + (has ? '' : ' | NO-PHOTO') + ' | cat ' + p.category + ' | brand ' + (p.brand_slug || '-'))
    }
    P('FILES_MISSING ' + miss + ' of ' + list.length)
  }

  if (PAGES.includes('home')) {
    const tag = 'HOME ' + TAG0
    const v = await visit(ctx, tag, q('/'))
    if (v) {
      const { page, net } = v
      const r = await scanPage(page, tag, net)
      for (const l of r.lines) P(l)
      netReport(tag, net)
      const rt = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /hero|slide_image|api\.php\?r=slides/.test(e.name)).map((e) => e.name.replace(location.origin, '').slice(0, 60) + ' start ' + Math.round(e.startTime) + ' end ' + Math.round(e.responseEnd) + ' bytes ' + e.encodedBodySize))
      for (const x of rt) P(tag + ' HERORT ' + x)
      const logos = await page.evaluate(LOGO_STATS)
      for (const l of logos) P(tag + ' LOGO ' + JSON.stringify(l))
      for (const l of await page.evaluate(FOOTER)) P(tag + ' FOOT ' + l)
      const bb = await page.evaluate(() => {
        const o = []
        const cs = (e, k) => getComputedStyle(e)[k]
        const bar = document.querySelector('.brand-bar'); if (bar) o.push('bar bg ' + cs(bar, 'backgroundColor') + ' bgimg ' + cs(bar, 'backgroundImage').slice(0, 40) + ' color ' + cs(bar, 'color'))
        for (const it of document.querySelectorAll('.brand-bar__item')) {
          const im = it.querySelector('img'); const sp = it.querySelector('span')
          o.push('item ' + (it.getAttribute('aria-label') || '-') + ' | title ' + (it.getAttribute('title') || '-') + ' | text ' + JSON.stringify((it.textContent || '').trim().slice(0, 24)) + ' | bg ' + cs(it, 'backgroundColor') + ' border ' + cs(it, 'borderTopWidth') + ' ' + cs(it, 'borderTopColor') + ' op ' + cs(it, 'opacity') + ' filter ' + cs(it, 'filter').slice(0, 30) + (im ? ' | img filter ' + cs(im, 'filter').slice(0, 40) + ' op ' + cs(im, 'opacity') + ' blend ' + cs(im, 'mixBlendMode') : ' | span color ' + (sp ? cs(sp, 'color') + ' fs ' + cs(sp, 'fontSize') : '-')) + ' | href ' + (it.getAttribute('href') || '-') + ' | rect ' + Math.round(it.getBoundingClientRect().width) + 'x' + Math.round(it.getBoundingClientRect().height))
        }
        return o
      })
      for (const x of bb) P(tag + ' BRANDBAR ' + x)
      const tl = await page.evaluate(() => [...document.querySelectorAll('.campaign-category')].map((t) => { const cs = getComputedStyle(t); const kids = [...t.children].map((k) => k.tagName.toLowerCase() + '.' + String(k.className).split(' ')[0].slice(0, 22) + ' ' + Math.round(k.getBoundingClientRect().width) + 'x' + Math.round(k.getBoundingClientRect().height) + (k.scrollHeight > k.clientHeight + 1 ? '(scrollH ' + k.scrollHeight + ')' : '')); const b = t.getBoundingClientRect(); return t.className.split(' ').slice(0, 3).join('.') + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' minH ' + cs.minHeight + ' h ' + cs.height + ' ar ' + cs.aspectRatio + ' pad ' + cs.padding + ' | ' + kids.join(' ; ') + ' | tileScrollH ' + t.scrollHeight + ' clientH ' + t.clientHeight }))
      for (const x of tl) P(tag + ' TILE ' + x)
      const pay = await page.evaluate(() => { const e = document.querySelector('.footer-payment'); if (!e) return 'NO .footer-payment'; const p = e.parentElement; return 'payment html ' + p.outerHTML.replace(/\s+/g, ' ').replace(/<path[^>]*>/g, '<path/>').slice(0, 900) })
      P(tag + ' ' + pay)
      // hero / tiles / brand-bar boxes
      const boxes = await page.evaluate(() => {
        const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.left) + ',' + Math.round(b.top + scrollY) }
        const o = []
        const sel = ['[class*=hero]', '.campaign-category', '.home-category-grid', '.brand-bar', '.brand-bar__track', '.brand-bar__item', '.product-grid', '.campaign-home > section', '.campaign-home > div']
        for (const s of sel) { const es = document.querySelectorAll(s); if (!es.length) continue; o.push(s + ' n=' + es.length + ' ' + [...es].slice(0, 8).map((e) => R(e) + (e.className && typeof e.className === 'string' ? '{' + e.className.split(' ').slice(0, 2).join('.').slice(0, 30) + '}' : '')).join(' ; ')) }
        return o
      })
      for (const b of boxes) P(tag + ' BOX ' + b.slice(0, 600))
      await page.close()
    }
  }

  if (PAGES.includes('shop')) {
    const tag = 'SHOP ' + TAG0
    const v = await visit(ctx, tag, q('/shop'))
    if (v) {
      const { page, net } = v
      const r = await scanPage(page, tag, net)
      for (const l of r.lines) P(l)
      netReport(tag, net)
      const cardGeo = await page.evaluate(() => {
        const a = document.querySelector('.product-grid-card'); if (!a) return 'NO CARD'
        const R = (e) => { if (!e) return '-'; const b = e.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.left) + ',' + Math.round(b.top + scrollY) }
        const wrap = a.querySelector('.catalog-card-image'); const link = wrap && wrap.querySelector('a'); const im = wrap && wrap.querySelector('img')
        const pad = (e) => { if (!e) return '-'; const c = getComputedStyle(e); return 'pad ' + c.padding + ' mar ' + c.margin + ' bord ' + c.borderTopWidth + ' tf ' + c.transform.slice(0, 40) + ' bg ' + c.backgroundColor }
        return 'article ' + R(a) + ' ' + pad(a) + ' || wrap ' + R(wrap) + ' ' + pad(wrap) + ' || link ' + R(link) + ' || img ' + R(im) + ' ' + pad(im) + ' || html2 ' + a.outerHTML.replace(/\s+/g, ' ').replace(/<svg.*?<\/svg>/g, '<svg/>').slice(700, 1500)
      })
      P(tag + ' CARDGEO ' + cardGeo)
      const cards = await page.evaluate(() => {
        const g = document.querySelector('.product-grid'); if (!g) return ['NO .product-grid']
        const ch = [...g.children]
        const o = ['cards ' + ch.length]
        const hs = ch.map((c) => Math.round(c.getBoundingClientRect().height)); const ws = ch.map((c) => Math.round(c.getBoundingClientRect().width))
        o.push('card w ' + [...new Set(ws)].join(',') + ' h ' + [...new Set(hs)].join(','))
        const c0 = ch[0]; if (c0) o.push('card0 html ' + c0.outerHTML.replace(/\s+/g, ' ').slice(0, 700))
        return o
      })
      for (const c of cards) P(tag + ' CARD ' + c)
      await page.close()
    }
  }

  if (PAGES.includes('brand')) {
    const tag = 'BRAND ' + TAG0
    {
      const tp = await ctx.newPage()
      const t0 = Date.now()
      tp.goto(BASE + q('/shop?brand=' + BRAND), { waitUntil: 'commit' }).catch(() => {})
      const tl = []
      while (Date.now() - t0 < 2600) {
        await tp.waitForTimeout(140)
        try { tl.push(await tp.evaluate(() => [Math.round(performance.now()), !!document.getElementById('sporta-brand-banner'), document.querySelectorAll('.product-grid-card').length, !!document.querySelector('.catalog-empty'), document.querySelectorAll('.image-loading-skeleton').length, Math.round(document.documentElement.scrollHeight)].join(','))) } catch (e) { tl.push('nav') }
      }
      P(tag + ' TIMELINE [t,banner,cards,emptyState,skeletons,docH] ' + tl.join(' | '))
      await tp.close()
    }
    const v = await visit(ctx, tag, q('/shop?brand=' + BRAND))
    if (v) {
      const { page, net } = v
      const r = await scanPage(page, tag, net)
      for (const l of r.lines) P(l)
      netReport(tag, net)
      const ban = await page.evaluate(() => { const b = document.getElementById('sporta-brand-banner'); return b ? b.getBoundingClientRect().width + 'x' + b.getBoundingClientRect().height + ' ' + b.outerHTML.replace(/\s+/g, ' ').slice(0, 500) : 'NO BANNER' })
      P(tag + ' BANNER ' + ban)
      P(tag + ' APPLIED catalog-page minHeight ' + (await page.evaluate(() => { const e = document.querySelector('.catalog-page'); return e ? getComputedStyle(e).minHeight + ' h ' + Math.round(e.getBoundingClientRect().height) : 'none' })))
      await page.close()
    }
  }

  for (const key of ['prodA', 'prodB']) {
    if (!PAGES.includes(key)) continue
    const slug = key === 'prodA' ? SLUG_A : SLUG_B
    const tag = key.toUpperCase() + ' ' + TAG0
    const v = await visit(ctx, tag, q('/product/' + slug))
    if (!v) continue
    const { page, net } = v
    const r = await scanPage(page, tag, net)
    for (const l of r.lines) P(l)
    netReport(tag, net)
    const g = await page.evaluate(() => {
      const o = []
      const R = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.left) + ',' + Math.round(b.top + scrollY) }
      for (const e of document.querySelectorAll('main *')) {
        const cs = getComputedStyle(e)
        if (cs.position === 'sticky') o.push('STICKY ' + e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 3).join('.').slice(0, 50) + ' ' + R(e) + ' top ' + cs.top + ' vh ' + innerHeight + ' fits ' + (e.getBoundingClientRect().height <= innerHeight - parseFloat(cs.top || '0')))
      }
      const imgs = [...document.querySelectorAll('main img')].filter((i) => i.getBoundingClientRect().width > 0)
      o.push('main imgs ' + imgs.length)
      const btns = [...document.querySelectorAll('main button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22) + (b.disabled ? '(dis)' : '')).slice(0, 40)
      o.push('BUTTONS ' + JSON.stringify(btns))
      return o
    })
    for (const x of g) P(tag + ' PG ' + x)
    // gallery interaction: thumbnails + main image
    const gal = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('main img')].filter((i) => i.getBoundingClientRect().width > 0)
      imgs.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)
      const main = imgs[0]; if (!main) return 'NO MAIN IMG'
      const b = main.getBoundingClientRect()
      const thumbs = imgs.filter((i) => i !== main && i.getBoundingClientRect().width <= 160 && i.getBoundingClientRect().width > 20)
      return 'main ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' nat ' + main.naturalWidth + 'x' + main.naturalHeight + ' fit ' + getComputedStyle(main).objectFit + ' parent ' + main.parentElement.tagName + '.' + String(main.parentElement.className).split(' ').slice(0, 3).join('.').slice(0, 60) + ' thumbs ' + thumbs.length + ' ' + thumbs.slice(0, 8).map((t) => Math.round(t.getBoundingClientRect().width) + 'x' + Math.round(t.getBoundingClientRect().height) + 'n' + t.naturalWidth + 'x' + t.naturalHeight + ' ' + getComputedStyle(t).objectFit).join(' ; ')
    })
    P(tag + ' GAL ' + gal)
    const il = await page.evaluate(() => [...document.querySelectorAll('main img')].filter((i) => i.getBoundingClientRect().width > 0).slice(0, 12).map((i) => { const b = i.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.left) + ',' + Math.round(b.top + scrollY) + ' nat ' + i.naturalWidth + 'x' + i.naturalHeight + ' alt ' + JSON.stringify(String(i.getAttribute('alt') || '').slice(0, 40)) + ' ld ' + (i.getAttribute('loading') || '-') + ' fp ' + (i.getAttribute('fetchpriority') || '-') + ' fit ' + getComputedStyle(i).objectFit + ' src ' + (i.currentSrc || '').replace(location.origin, '').slice(-70) + ' srcset ' + String(i.getAttribute('srcset') || '').replace(/\s+/g, ' ').slice(0, 330) + ' sizes ' + String(i.getAttribute('sizes') || '').slice(0, 60) }))
    for (const x of il) P(tag + ' MIMG ' + x)
    const hd = await page.evaluate(() => { const h = document.querySelector('header'); const cs = h ? getComputedStyle(h) : null; const vis = document.querySelector('.catalog-product-visual'); const vc = vis ? getComputedStyle(vis) : null; const st = document.querySelector('.catalog-gallery-stage'); const sc = st ? getComputedStyle(st) : null; return 'HDR pos ' + (cs ? cs.position + ' top ' + cs.top : '-') + ' h ' + (h ? Math.round(h.getBoundingClientRect().height) : '-') + ' | visual pos ' + (vc ? vc.position + ' top ' + vc.top + ' h ' + Math.round(vis.getBoundingClientRect().height) + ' maxh ' + vc.maxHeight + ' align ' + vc.alignSelf : '-') + ' | stage ' + (sc ? Math.round(st.getBoundingClientRect().width) + 'x' + Math.round(st.getBoundingClientRect().height) + ' ar ' + sc.aspectRatio + ' bg ' + sc.backgroundColor + ' maxh ' + sc.maxHeight + ' ovf ' + sc.overflow : '-') + ' | docEl scrollH ' + document.documentElement.scrollHeight + ' vh ' + innerHeight })
    P(tag + ' ' + hd)
    for (const x of await page.evaluate(EDGE)) P(tag + ' EDGE ' + x)
    // sticky fit after scrolling the purchase column into view
    await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(500)
    const sf = await page.evaluate(() => { const v = document.querySelector('.catalog-product-visual'); if (!v) return 'no visual'; const b = v.getBoundingClientRect(); return 'scrolled400 visual top ' + Math.round(b.top) + ' bottom ' + Math.round(b.bottom) + ' vh ' + innerHeight + (b.bottom > innerHeight ? ' CLIPPED ' + Math.round(b.bottom - innerHeight) + 'px' : ' fits') })
    P(tag + ' STICKYFIT ' + sf)
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300)
    const zm = await page.evaluate(async () => {
      const im = document.querySelector('.catalog-gallery-photo'); if (!im) return 'no gallery img'
      const before = document.querySelectorAll('[role=dialog],[class*=lightbox],[class*=zoom]').length
      const cur = getComputedStyle(im).cursor
      im.click()
      await new Promise((ok) => setTimeout(ok, 700))
      const after = document.querySelectorAll('[role=dialog],[class*=lightbox],[class*=zoom]').length
      const fixedImgs = [...document.querySelectorAll('img')].filter((i) => getComputedStyle(i).position === 'fixed' || (i.closest('[role=dialog]') !== null)).length
      return 'cursor ' + cur + ' overlays before ' + before + ' after ' + after + ' fixedImgs ' + fixedImgs + ' track children ' + (document.querySelector('.catalog-gallery-track') ? document.querySelector('.catalog-gallery-track').children.length : '-') + ' thumbsStrip ' + document.querySelectorAll('.catalog-gallery-thumbs, [class*=thumb]').length + ' dots ' + document.querySelectorAll('[class*=gallery-dot],[class*=dots]').length
    })
    P(tag + ' ZOOM ' + zm)
    await page.close()
  }

  if (PAGES.includes('cart')) {
    const tag = 'CART ' + TAG0
    const v = await visit(ctx, tag, q('/product/' + SLUG_A))
    if (v) {
      const { page, net } = v
      // choose first enabled size, then add to bag (client-side only; no order button is ever pressed)
      const act = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('main button')]
        const SZ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'ONE SIZE', 'FREE SIZE']
        const size = bs.find((b) => !b.disabled && SZ.includes((b.textContent || '').trim().toUpperCase()))
        if (size) size.click()
        return size ? 'size ' + size.textContent.trim() : 'no size button'
      })
      P(tag + ' ACT ' + act)
      await page.waitForTimeout(500)
      const add = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('main button')].filter((x) => !x.disabled)
        const txt = (x) => (x.textContent || '').replace(/\s+/g, ' ').trim()
        const ok = (x) => !/wish|favou?rite|save|buy now|\u0627\u0634\u062a\u0631|\u0627\u0644\u0645\u0641\u0636\u0644\u0629|size|\u0645\u0642\u0627\u0633/i.test(txt(x)) && (/^(add|\u0623\u0636\u0641|\u0627\u0636\u0641)( to (bag|cart))?\s*(\+)?\s*/i.test(txt(x)) && txt(x).length < 22)
        const b = bs.find(ok)
        if (b) { b.click(); return 'clicked ' + txt(b) }
        return 'no add button; buttons ' + JSON.stringify(bs.map((x) => txt(x).slice(0, 20)).slice(0, 25))
      })
      P(tag + ' ADD ' + add)
      await page.waitForTimeout(1500)
      let dr = await page.evaluate(() => !!document.querySelector('.campaign-cart-drawer'))
      if (!dr) {
        await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /cart|bag|حقيب|سلة/i.test(x.getAttribute('aria-label') || '')); if (b) b.click() })
        await page.waitForTimeout(1500)
        dr = await page.evaluate(() => !!document.querySelector('.campaign-cart-drawer'))
      }
      P(tag + ' DRAWER ' + dr)
      if (dr) {
        const d = await page.evaluate(() => {
          const d = document.querySelector('.campaign-cart-drawer'); const b = d.getBoundingClientRect()
          const o = ['drawer ' + Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.left) + ',' + Math.round(b.top)]
          for (const im of d.querySelectorAll('img')) { const r = im.getBoundingClientRect(); const cs = getComputedStyle(im); o.push('img ' + Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ' nat ' + im.naturalWidth + 'x' + im.naturalHeight + ' fit ' + cs.objectFit + ' pos ' + cs.objectPosition + ' alt ' + JSON.stringify(im.getAttribute('alt')) + ' ld ' + im.getAttribute('loading') + ' src ' + (im.currentSrc || '').replace(location.origin, '').slice(-60) + ' parent ' + im.parentElement.tagName + '.' + String(im.parentElement.className).split(' ')[0].slice(0, 30) + ' ' + Math.round(im.parentElement.getBoundingClientRect().width) + 'x' + Math.round(im.parentElement.getBoundingClientRect().height)) }
          const lines = d.querySelectorAll('li, [class*=line], [class*=item]'); o.push('items ' + lines.length)
          const chk = [...d.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter(Boolean)
          o.push('links ' + JSON.stringify(chk))
          o.push('html ' + d.innerHTML.replace(/\s+/g, ' ').replace(/<svg.*?<\/svg>/g, '<svg/>').slice(0, 900))
          return o
        })
        for (const x of d) P(tag + ' D ' + x)
        const go = await page.evaluate(() => { const a = [...document.querySelectorAll('.campaign-cart-drawer a')].find((x) => /checkout/.test(x.getAttribute('href') || '')); if (a) { a.click(); return 'clicked ' + a.getAttribute('href') } return 'no checkout link' })
        P(tag + ' GOCHK ' + go)
        await page.waitForTimeout(3000)
      }
      P(tag + ' URL ' + page.url().replace(BASE, ''))
      if (PAGES.includes('checkout')) {
        if (page.url().indexOf('/checkout') < 0) { await page.goto(BASE + q('/checkout'), { waitUntil: 'load' }); await page.waitForTimeout(3000) }
        const t2 = 'CHECKOUT ' + TAG0
        await scrollAll(page)
        const r = await scanPage(page, t2, net)
        for (const l of r.lines) P(l)
        const sm = await page.evaluate(() => {
          const o = []
          for (const im of document.querySelectorAll('main img, aside img, form img')) { const r = im.getBoundingClientRect(); if (!r.width) continue; o.push('img ' + Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top + scrollY) + ' nat ' + im.naturalWidth + 'x' + im.naturalHeight + ' fit ' + getComputedStyle(im).objectFit + ' alt ' + JSON.stringify(im.getAttribute('alt')) + ' src ' + (im.currentSrc || '').replace(location.origin, '').slice(-50)) }
          o.push('scrollW ' + document.documentElement.scrollWidth + ' vw ' + innerWidth)
          return o
        })
        for (const x of sm) P(t2 + ' S ' + x)
        for (const l of await page.evaluate(FOOTER)) P(t2 + ' FOOT ' + l)
      }
      await page.close()
    }
  }
} catch (e) {
  P('PROBE_FAIL ' + String(e.stack || e.message).slice(0, 400))
} finally {
  await browser.close()
  P('PROBE_END ' + LANG + VW)
}
