// READ-ONLY probe of the LIVE storefront's HOME-PAGE BRANDS strip ("Brands we trust" + "Explore brands"). Loads the home page and reads
// the DOM, the public brands API and the logo files the strip itself requests. GET only (every other method is aborted); nothing
// is clicked, typed or sent.
//
//   node live-home-brands-probe.mjs                  (fetched from raw.githubusercontent.com at a pushed commit and run on the VPS in the
//                                                     Playwright image, see CLAUDE.md "Probing the live site")
//   BASE=http://127.0.0.1:PORT node ...              the same measurements against a local copy of the storefront
//   WIDTHS=320,360,390,768,1024,1280,1536  LANGS=ar,en  DARK=390,1280   (defaults)  DUMP=1 prints the strip's markup once
//
// Per language x width (light), and per DARK width: the strip's box, heading, call to action, every tile (box, text, lines, clipping,
// logo: natural size, drawn size, upscaling, fit, filter), tile heights equal or not, sideways scroll, alignment with the page gutter,
// text contrast, tap-target sizes, layout shifts that touched the strip, and the brands API against what the strip shows (the bundle
// starts from a hard-coded list). Then, once, the real logo files the API names: size, bytes, transparency, corners, ink brightness.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const WIDTHS = (process.env.WIDTHS || '320,360,390,768,1024,1280,1536').split(',').map(Number)
const DARK = (process.env.DARK || '390,1280').split(',').map(Number)
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const out = (s) => console.log(String(s).slice(0, 700))

const browser = await chromium.launch()

// ---- the in-page measurement -------------------------------------------------------------------------------------------------
const MEASURE = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: +r.left.toFixed(1), y: +(r.top + scrollY).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
  const lum = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v = +v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const alpha = (c) => { const m = String(c).match(/[\d.]+/g); return m && m.length > 3 ? +m[3] : 1 }
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return null; const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return +((hi + 0.05) / (lo + 0.05)).toFixed(2) }
  const bgOf = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (alpha(c) >= 0.9) return c } return 'rgb(255, 255, 255)' }
  const sel = ['.campaign-brand-bar', '.brand-bar', '[class*="brand-bar"]']
  let bar = null
  for (const s of sel) { bar = document.querySelector(s); if (bar) break }
  if (!bar) return { found: false, hdr: document.querySelector('header') ? R(document.querySelector('header')).h : null }
  const cs = getComputedStyle(bar)
  const heading = bar.querySelector('h2, h3') || bar.querySelector('[class*="heading"]')
  const track = bar.querySelector('.brand-bar__track') || bar.querySelector('[class*="track"]')
  const items = [...bar.querySelectorAll('.brand-bar__item')]
  const cta = [...bar.querySelectorAll('a')].find((a) => !a.classList.contains('brand-bar__item') && !a.closest('.brand-bar__track'))
  const main = document.querySelector('main') || document.body
  const dir = document.documentElement.dir
  // the content edge of the other sections' titles on the same page: the strip's own content should start where they do
  const gutter = (() => { const h = [...main.querySelectorAll('h2')].find((e) => !bar.contains(e) && e.getBoundingClientRect().width > 0); if (!h) return null; const r = h.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +(innerWidth - r.right).toFixed(1), t: h.textContent.trim().slice(0, 24) } })()
  const tile = (a) => {
    const r = R(a), s = getComputedStyle(a), sp = a.querySelector('span'), img = a.querySelector('img')
    let lines = null, clipped = false
    if (sp) {
      const rg = document.createRange(); rg.selectNodeContents(sp)
      const rects = [...rg.getClientRects()].filter((q) => q.width > 0)
      const tops = new Set(rects.map((q) => Math.round(q.top / 4)))
      lines = tops.size
      const ar = a.getBoundingClientRect()
      clipped = rects.some((q) => q.left < ar.left - 1 || q.right > ar.right + 1 || q.top < ar.top - 1 || q.bottom > ar.bottom + 1) || sp.scrollWidth > sp.clientWidth + 1
    }
    const im = img ? (() => { const q = img.getBoundingClientRect(), is = getComputedStyle(img); return { src: (img.getAttribute('src') || '').slice(-60), nat: img.naturalWidth + 'x' + img.naturalHeight, w: +q.width.toFixed(1), h: +q.height.toFixed(1), up: img.naturalWidth ? +(q.width / img.naturalWidth).toFixed(2) : null, fit: is.objectFit, filter: is.filter === 'none' ? 'none' : is.filter.slice(0, 40), ok: img.complete && img.naturalWidth > 0, loading: img.getAttribute('loading'), alt: img.getAttribute('alt') } })() : null
    return { box: r, text: (a.textContent || '').trim().slice(0, 40), lines, clipped, fs: sp ? parseFloat(getComputedStyle(sp).fontSize) : null, color: sp ? getComputedStyle(sp).color : null, bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderTopLeftRadius, contrast: sp ? ratio(getComputedStyle(sp).color, bgOf(a)) : null, label: a.getAttribute('aria-label'), href: a.getAttribute('href'), img: im, lang: a.getAttribute('lang') || (sp && sp.getAttribute('lang')) }
  }
  const tiles = items.map(tile)
  const hs = tiles.map((t) => t.box.h)
  const ys = [...new Set(tiles.map((t) => Math.round(t.box.y / 6)))]
  return {
    found: true, dir, vw: innerWidth, over: document.documentElement.scrollWidth - innerWidth, hdr: document.querySelector('header') ? R(document.querySelector('header')).h : null,
    bar: { box: R(bar), cls: bar.className.slice(0, 80), pos: cs.position, top: cs.top, pad: cs.paddingTop + '/' + cs.paddingRight + '/' + cs.paddingBottom + '/' + cs.paddingLeft, bg: cs.backgroundColor, display: cs.display },
    heading: heading ? { box: R(heading), text: heading.textContent.trim().slice(0, 50), fs: parseFloat(getComputedStyle(heading).fontSize), align: getComputedStyle(heading).textAlign, color: getComputedStyle(heading).color, contrast: ratio(getComputedStyle(heading).color, bgOf(heading)) } : null,
    cta: cta ? { box: R(cta), text: cta.textContent.trim().slice(0, 30), href: cta.getAttribute('href'), contrast: ratio(getComputedStyle(cta).color, bgOf(cta)), align: getComputedStyle(cta).textAlign } : null,
    track: track ? { box: R(track), display: getComputedStyle(track).display, cols: getComputedStyle(track).gridTemplateColumns.split(' ').length, gap: getComputedStyle(track).gap, sw: track.scrollWidth, cw: track.clientWidth, ox: getComputedStyle(track).overflowX } : null,
    n: tiles.length, rows: ys.length, hMin: Math.min(...hs), hMax: Math.max(...hs), wMin: Math.min(...tiles.map((t) => t.box.w)), wMax: Math.max(...tiles.map((t) => t.box.w)),
    gutter, barL: +bar.getBoundingClientRect().left.toFixed(1), barR: +(innerWidth - bar.getBoundingClientRect().right).toFixed(1),
    tiles,
    names: tiles.map((t) => t.text),
  }
}

const HOOK = () => {
  window.__ls = []
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue
        const inBar = (e.sources || []).some((s) => s.node && s.node.nodeType === 1 && (s.node.closest ? s.node.closest('[class*="brand-bar"]') : null))
        window.__ls.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), inBar })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch (e) { /* older engine */ }
}

// ---- the public brands API ---------------------------------------------------------------------------------------------------------
let api = []
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  try { const r = await p.request.get(B + '/api/api.php?r=brands'); const j = await r.json(); api = Array.isArray(j) ? j : (j.brands || []) } catch (e) { out('brands API: ' + e.message) }
  await ctx.close()
}
out('BRANDS API ' + api.length + ': ' + api.map((b) => `${b.slug}(${b.name_en}${b.has_logo ? '+logo' : ''}${b.product_count != null ? ',' + b.product_count + 'p' : ''})`).join(' '))

// ---- per page -----------------------------------------------------------------------------------------------------------------
const seen = {}
const run = async (lang, w, dark) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: w < 500 ? 2 : 1 })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  await p.addInitScript(HOOK)
  if (dark) await p.addInitScript(() => { try { localStorage.setItem('sporta_theme', 'dark') } catch (e) {} })
  const reqs = []
  p.on('response', (r) => { const u = r.url(); if (/brand_logo|r=brands/.test(u)) reqs.push(u.replace(B, '').slice(0, 90) + ' ' + r.status() + ' ' + (r.headers()['content-length'] || '?') + 'B') })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 80)))
  await p.goto(B + '/' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
  await p.waitForTimeout(2200)
  await p.evaluate(() => { const e = document.querySelector('[class*="brand-bar"]'); if (e) e.scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(600)
  const m = await p.evaluate(MEASURE)
  const ls = await p.evaluate(() => window.__ls)
  if (process.env.DUMP && !seen.dump && m.found) { seen.dump = 1; out('MARKUP ' + (await p.evaluate(() => (document.querySelector('[class*="brand-bar"]') || {}).outerHTML || '')).replace(/\s+/g, ' ').slice(0, 2600)) }
  await ctx.close()
  return { m, ls, reqs, errs }
}

const tag = (lang, w, dark) => `${lang} ${w}px${dark ? ' dark' : ''}`
const report = (lang, w, dark, r) => {
  const { m, ls, errs } = r
  const t = tag(lang, w, dark)
  if (!m.found) { out(`[${t}] NO BRAND BAR FOUND (header ${m.hdr})`); return }
  const cls = ls.reduce((a, e) => a + e.v, 0), clsBar = ls.filter((e) => e.inBar).reduce((a, e) => a + e.v, 0)
  out(`[${t}] bar y${m.bar.box.y} ${m.bar.box.w}x${m.bar.box.h} ${m.bar.cls.split(' ').slice(0, 2).join('.')} pos ${m.bar.pos}${m.bar.pos !== 'static' ? ' top ' + m.bar.top : ''} pad ${m.bar.pad} | tiles ${m.n} in ${m.rows} row(s) h ${m.hMin}-${m.hMax} w ${m.wMin}-${m.wMax} | track ${m.track ? m.track.display + ' cols ' + m.track.cols + ' gap ' + m.track.gap + (m.track.sw > m.track.cw + 1 ? ' SCROLLS ' + m.track.sw + '>' + m.track.cw : '') : 'none'} | over ${m.over} | CLS ${cls.toFixed(4)} (bar ${clsBar.toFixed(4)})${errs.length ? ' ERR ' + errs.join(';') : ''}`)
  out(`   heading ${m.heading ? `"${m.heading.text}" ${m.heading.fs}px ${m.heading.align} x${m.heading.box.x}..${+(m.heading.box.x + m.heading.box.w).toFixed(1)} ${m.heading.contrast}:1` : 'none'} | cta ${m.cta ? `"${m.cta.text}" ${m.cta.box.w}x${m.cta.box.h} x${m.cta.box.x} ${m.cta.contrast}:1` : 'none'} | track x${m.track ? m.track.box.x + '..' + +(m.track.box.x + m.track.box.w).toFixed(1) : '?'} | another section's title "${m.gutter ? m.gutter.t : '?'}" edge ${m.gutter ? m.gutter.l + '/' + m.gutter.r : '?'} | bar ${m.barL}/${m.barR}`)
  const detail = !!dark || [320, 390, 1280].includes(w)
  for (const x of m.tiles) {
    if (!detail && !x.clipped && !(x.lines > 1) && x.box.h === m.hMax && !(x.img && !x.img.ok)) continue
    const i = x.img
    out(`   - "${x.text}" ${x.box.w}x${x.box.h} @${x.box.x},${x.box.y} lines ${x.lines}${x.clipped ? ' CLIPPED' : ''} ${x.fs}px ${x.contrast}:1 ${x.bg} border ${x.border} r ${x.radius} ${i ? `| logo ${i.nat} drawn ${i.w}x${i.h} x${i.up} ${i.fit} filter ${i.filter} ${i.ok ? 'ok' : 'BROKEN'} ${i.loading || ''}` : '| no logo'} | href ${x.href}`)
  }
}

for (const lang of LANGS) for (const w of WIDTHS) {
  const r = await run(lang, w, false)
  report(lang, w, false, r)
  if (w === WIDTHS[0] && lang === LANGS[0]) { out('   requests: ' + r.reqs.join(' ; ')); seen.names = r.m.names }
  if (r.m.found && lang === 'en' && w === 1280) seen.en1280 = r.m.names
}
for (const lang of LANGS) for (const w of DARK) report(lang, w, true, await run(lang, w, true))

// ---- the strip against the API ------------------------------------------------------------------------------------------------------
{
  const apiNames = api.map((b) => (b.name_en || '').toLowerCase())
  const stripNames = (seen.en1280 || seen.names || []).map((n) => n.toLowerCase())
  out('STRIP vs API: strip shows ' + JSON.stringify(seen.en1280 || seen.names) + '; API names ' + JSON.stringify(api.map((b) => b.name_en)))
  out('   in the strip, not in the API: ' + JSON.stringify(stripNames.filter((n) => !apiNames.some((a) => a === n || a.includes(n) || n.includes(a)))) + ' | in the API, not in the strip: ' + JSON.stringify(apiNames.filter((a) => !stripNames.some((n) => a === n || a.includes(n) || n.includes(a)))))
}

// ---- the real logo files ------------------------------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  await p.goto(B + '/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null)
  for (const b of api.filter((x) => x.has_logo)) {
    const url = '/api/api.php?r=brand_logo&slug=' + encodeURIComponent(b.slug) + (b.logo_v ? '&v=' + b.logo_v : '')
    const d = await p.evaluate(async (u) => {
      try {
        const r = await fetch(u); const blob = await r.blob(); const bm = await createImageBitmap(blob)
        const W = Math.min(bm.width, 120), H = Math.max(1, Math.round(bm.height * W / bm.width))
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const x = c.getContext('2d'); x.drawImage(bm, 0, 0, W, H)
        const px = x.getImageData(0, 0, W, H).data
        let transp = 0, ink = 0, lr = 0, lg = 0, lb = 0
        for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 40) transp++; else if (px[i + 3] > 200) { ink++; lr += px[i]; lg += px[i + 1]; lb += px[i + 2] } }
        const corner = [0, (W - 1)].flatMap((cx) => [0, (H - 1)].map((cy) => px[(cy * W + cx) * 4 + 3]))
        const n = W * H
        return { status: r.status, type: blob.type, bytes: blob.size, w: bm.width, h: bm.height, transparent: +(transp / n * 100).toFixed(1), opaque: +(ink / n * 100).toFixed(1), corners: corner.join('/'), ink: ink ? [Math.round(lr / ink), Math.round(lg / ink), Math.round(lb / ink)].join(',') : null, cache: r.headers.get('cache-control') }
      } catch (e) { return { error: String(e.message || e).slice(0, 80) } }
    }, url)
    out(`LOGO ${b.slug} (${b.name_en}): ${JSON.stringify(d)}`)
  }
  await ctx.close()
}
await browser.close()
out('DONE')
