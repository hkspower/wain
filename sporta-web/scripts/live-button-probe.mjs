// READ-ONLY probe: every visible button and link on the public storefront pages at phone width (390px) that is under 44px
// in either direction. Loads pages, reads the DOM. Clicks nothing, types nothing, sends nothing.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const PAGES = ['/', '/shop', '/shop?category=men', '/about', '/returns', '/support', '/track', '/contact', '/cart', '/checkout', '/account', '/wishlist']
const b = await chromium.launch()
const seen = new Map()
for (const lang of ['ar', 'en']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  for (const path of PAGES) {
    const p = await ctx.newPage()
    await p.goto(B + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => null)
    await p.waitForTimeout(800)
    const r = await p.evaluate(() => [...document.querySelectorAll('button, a[href], input[type=submit]')].filter((e) => {
      const q = e.getBoundingClientRect(); const c = getComputedStyle(e)
      return q.width > 0 && q.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'
    }).map((e) => {
      const q = e.getBoundingClientRect()
      const name = (e.textContent || e.getAttribute('aria-label') || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 30)
      return { name, w: Math.round(q.width), h: Math.round(q.height), tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 40) }
    }).filter((x) => x.w < 44 || x.h < 44))
    for (const x of r) {
      const k = x.tag + '|' + x.name + '|' + x.w + 'x' + x.h
      if (!seen.has(k)) seen.set(k, { ...x, pages: [] })
      seen.get(k).pages.push(lang + ' ' + path)
    }
    await p.close()
  }
  await ctx.close()
}
for (const [k, x] of seen) console.log('SMALL ' + x.w + 'x' + x.h + ' ' + x.tag + ' "' + x.name + '" ' + x.pages.length + ' pages e.g. ' + x.pages.slice(0, 3).join(', ') + ' cls=' + x.cls)
console.log('PROBE_DONE distinct=' + seen.size)
await b.close()
