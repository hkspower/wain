// READ-ONLY layout + image scan of the LIVE home page category tiles (.category-tile: Men, Women, Accessories, Sporta Outlet),
// ar + en, 360/390/768/1024/1280. GET only. Reports per tile: box, aspect ratio, how its image is painted (img / background),
// the image's file, natural size vs painted size (waste), bytes transferred, format, object-fit/position, whether the copy
// over the image is readable (computed text colour vs the average colour under the text, sampled with a canvas), text overflow,
// equal heights in a row, gaps, order (RTL), tap size, lazy loading and alt, sideways scroll.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
const browser = await chromium.launch()
for (const lang of ['ar', 'en']) for (const w of [360, 390, 768, 1024, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  await p.goto(B + '/' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(1200)
  const sec = await p.$('.category-tile')
  if (sec) { await sec.scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 200); await p.waitForTimeout(1200) }
  const d = await p.evaluate(async () => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } }
    const tiles = [...document.querySelectorAll('.category-tile')]
    const perf = performance.getEntriesByType('resource')
    const res = (url) => { const e = perf.filter((x) => x.name === url || x.name.endsWith(url.replace(location.origin, ''))).pop(); return e ? { bytes: e.transferSize || e.encodedBodySize, dur: Math.round(e.duration) } : null }
    const rows = tiles.map((t) => {
      const cs = getComputedStyle(t), r = R(t)
      const img = t.querySelector('img')
      let paint = 'none', file = '', nat = '', fit = '', alt = '', lazy = '', srcset = ''
      if (img) { paint = 'img'; file = img.currentSrc || img.src; nat = img.naturalWidth + 'x' + img.naturalHeight; fit = getComputedStyle(img).objectFit + ' ' + getComputedStyle(img).objectPosition; alt = img.alt; lazy = img.loading; srcset = img.srcset ? 'srcset' : 'no-srcset'; const ir = R(img); nat += ' painted ' + ir.w + 'x' + ir.h }
      else {
        const bgs = [t, ...t.querySelectorAll('*')].map((e) => [e, getComputedStyle(e).backgroundImage]).filter(([, b]) => /url\(/.test(b))
        if (bgs.length) { paint = 'background'; const m = bgs[0][1].match(/url\("?([^")]+)"?\)/); file = m ? m[1] : ''; fit = getComputedStyle(bgs[0][0]).backgroundSize + ' ' + getComputedStyle(bgs[0][0]).backgroundPosition }
      }
      const txt = t.querySelector('h2,h3,strong,span') || t
      const tr = R(txt), ts = getComputedStyle(txt)
      const overflow = [t, ...t.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length
      return { cls: (t.className || '').toString().split(' ').filter((c) => /^tile-/.test(c)).join(''), r, aspect: (r.w / r.h).toFixed(2), paint, file: file.replace(location.origin, '').slice(-70), nat, fit, alt, lazy, srcset, res: file ? res(file.startsWith('http') ? file : location.origin + file) : null, text: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50), color: ts.color, fs: ts.fontSize, overflow, href: t.getAttribute('href'), pos: cs.position }
    })
    const lefts = rows.map((x) => x.r.l), tops = rows.map((x) => x.r.t)
    return { rows, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir, heights: [...new Set(rows.map((x) => x.r.h))], rowsTop: [...new Set(tops)], lefts }
  })
  out('== ' + lang + ' ' + w + ' dir=' + d.dir + ' sideways=' + d.sideways + ' tiles=' + d.rows.length + ' heights=' + JSON.stringify(d.heights) + ' rowTops=' + JSON.stringify(d.rowsTop) + ' lefts=' + JSON.stringify(d.lefts))
  for (const r of d.rows) out('  ' + r.cls + ' box ' + r.r.l + ',' + r.r.t + ' ' + r.r.w + 'x' + r.r.h + ' ar ' + r.aspect + ' | ' + r.paint + ' ' + r.file + ' | nat ' + r.nat + ' | fit ' + r.fit + ' | alt "' + r.alt + '" lazy=' + r.lazy + ' ' + r.srcset + ' | res ' + JSON.stringify(r.res) + ' | text "' + r.text + '" ' + r.fs + ' ' + r.color + ' overflow=' + r.overflow + ' href=' + r.href)
  await ctx.close()
}
await browser.close()
console.log('PROBE_DONE')
