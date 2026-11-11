// READ-ONLY: is each direction icon mirrored in Arabic, and what sits above the features cards. Reads the DOM only.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const out = (s) => process.stdout.write(s + '\n')
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
for (const [path, w] of [['/', 390], ['/', 1280], ['/product/cagliari-calcio-backpack', 390], ['/shop', 390]]) for (const lang of ['ar', 'en']) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage()
  await p.goto(B + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle', timeout: 40000 }).catch(() => null)
  await p.waitForTimeout(1500)
  const r = await p.evaluate(() => {
    const res = []
    const flip = (s) => { const t = []; for (let x = s, i = 0; x && i < 4; x = x.parentElement, i++) { const c = getComputedStyle(x); if (c.transform !== 'none') t.push(i + 'tf' + c.transform.slice(0, 24)); if (c.scale && c.scale !== 'none') t.push(i + 'sc' + c.scale); if (c.rotate && c.rotate !== 'none') t.push(i + 'rot' + c.rotate) } return t.join(',') || 'none' }
    const seen = new Set()
    for (const s of document.querySelectorAll('main svg, header svg')) {
      const pth = s.querySelector('path,polyline,line'); const d = pth ? (pth.getAttribute('d') || pth.getAttribute('points') || '') : ''
      if (!/^M5 12h14|^M7 17 17 7|^m9 18|^m15 18|^M9 18|^M15 18|^m12 19|^M19 12|^m9 6|^m15 6/.test(d)) continue
      const host = s.closest('a,button') || s.parentElement
      const key = (host.className && host.className.baseVal === undefined ? String(host.className).split(' ')[0] : host.tagName) + ' ' + d.slice(0, 16) + ' ' + flip(s)
      if (seen.has(key)) continue; seen.add(key)
      const q = s.getBoundingClientRect(); if (!q.width) continue
      res.push('ICON ' + key + ' @x' + Math.round(q.left))
    }
    const c = document.querySelector('.sporta-features__content, .home-features__content')
    if (c) { const box = c.closest('.sporta-features, .home-features').getBoundingClientRect(); for (const k of c.querySelectorAll(':scope > *, :scope > * > *')) { const q = k.getBoundingClientRect(), cs = getComputedStyle(k); res.push('FEAT ' + k.tagName.toLowerCase() + '.' + String(k.className).split(' ').slice(0, 2).join('.') + ' "' + (k.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '" L' + Math.round(q.left - box.left) + ' R' + Math.round(box.right - q.right) + ' T' + Math.round(q.top - box.top) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' pos:' + cs.position + ' ta:' + cs.textAlign) } }
    return res
  })
  for (const l of r) out(lang + ' ' + w + ' ' + path + ' | ' + l)
  await ctx.close()
}
await b.close()
out('ARROWS_DONE')
