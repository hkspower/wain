/** The side pages are one family, and the pages that are not side pages are untouched. node scripts/side-pages-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const SIDE = ['/about', '/contact', '/returns', '/track', '/terms', '/privacy']
for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  for (const lang of ['en', 'ar']) {
    const h1px = lang === 'ar' ? '26px' : '25px'
    const sizes = new Set()
    for (const path of SIDE) {
      const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
      await p.goto(`${BASE}${path}?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
      const m = await p.evaluate(() => {
        const h1 = document.querySelector('main h1'); const cs = getComputedStyle(h1)
        const bar = getComputedStyle(h1, '::after')
        const ps = [...document.querySelectorAll('main section p')].filter((e) => e.getBoundingClientRect().width > 0 && e.textContent.trim().length > 60)
        const bad = ps.filter((e) => { const c = getComputedStyle(e); return e.getBoundingClientRect().width > parseFloat(c.maxWidth) + 1 }).length
        const sum = document.querySelector('main details > summary')
        const sc = sum && getComputedStyle(sum, '::after')
        return { font: cs.fontFamily.split(',')[0], size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bar: bar.width + 'x' + bar.height,
          scrollX: document.documentElement.scrollWidth - innerWidth, paras: ps.length, badParas: bad,
          faq: sum ? { h: Math.round(sum.getBoundingClientRect().height), chev: sc.content } : null }
      })
      const L = `${name} ${lang} ${path}:`
      check(/Alexandria/.test(m.font) && m.weight === '700' && m.color === 'rgb(255, 255, 255)', `${L} title in Alexandria 700 (the quiet weight), white`, `${m.font} ${m.weight} ${m.color}`)
      check(m.size === h1px && m.bar === '56px x 4px'.replace(' x ', 'x'), `${L} ${h1px} with the 56x4 orange bar`, `${m.size} ${m.bar}`)
      check(m.scrollX <= 0, `${L} no sideways scroll`)
      check(m.badParas === 0, `${L} body copy is held to a readable line (68ch) (${m.paras} paragraphs)`)
      if (m.faq) check(m.faq.h >= 52 && m.faq.chev === '""', `${L} FAQ rows are 52px+ with a chevron`, JSON.stringify(m.faq))
      sizes.add(m.size)
      await p.context().close()
    }
    check(sizes.size === 1, `${name} ${lang}: every side page has the SAME title size`, [...sizes].join())
  }
}
// anchors land just under the header, not 160px below it
{
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  for (const u of ['/terms#delivery', '/about#why']) {
    await p.goto(`${BASE}${u}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
    const top = await p.evaluate(() => { const h = document.querySelector(location.hash); return Math.round((h.querySelector('h2') || h).getBoundingClientRect().top) })
    check(top >= 56 && top <= 110, `${u}: the heading lands just under the header`, `${top}px`)
  }
}
// not a side page: nothing changed there
{
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  // /cart and an empty /checkout share the title since 2026-10-01 (57-utility-pages.css)
  for (const u of ['/shop', '/product/vanquish-tank-navy']) {
    await p.goto(`${BASE}${u}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => { const h = document.querySelector('main h1'); return h ? getComputedStyle(h, '::after').width : 'no-h1' })
    check(r !== '56px', `${u}: its title does not get the side-page bar`, r)
  }
}
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
