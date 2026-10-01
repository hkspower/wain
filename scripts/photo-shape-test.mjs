/** Every product photo on the site is 4:5. node scripts/photo-shape-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ratio = (r) => r.w / r.h
let seen = 0
for (const [name, vp, touch] of [['phone', { width: 390, height: 844 }, true], ['tablet', { width: 768, height: 1000 }, false], ['desktop', { width: 1280, height: 800 }, false]]) {
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage()
    const found = {}
    const grab = async (label, sel) => {
      const rs = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } }).filter((r) => r.w > 30 && r.h > 30), sel)
      if (rs.length) found[label] = rs
    }
    for (const [label, path, sel] of [
      ['shop card', '/shop', 'article > a[class*="aspect-"]'],
      ['home best seller', '/', '.sporta-home-products__frame'],
      ['category card', '/men', 'a.card .frame'],
    ]) { await p.goto(`${BASE}${path}?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800); await grab(label, sel) }
    await p.goto(`${BASE}/product/cheetahs-rugby-t-shirt?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000)
    await grab('product gallery', 'main [class*="aspect-[4/5]"], main .gallery, main img[class*="object-cover"]:not([class*="h-16"])')
    await grab('related card', 'article > a[class*="aspect-"]')
    await grab('gallery thumbnail', 'button[class*="h-16"][class*="w-16"]')
    await p.locator('button').filter({ hasText: lang === 'ar' ? /^أضف$/ : /^Add$/ }).first().click().catch(() => {})
    await p.locator('button').filter({ hasText: /^L$/ }).first().click().catch(() => {})
    await p.locator('button').filter({ hasText: lang === 'ar' ? /^أضف$/ : /^Add$/ }).first().click().catch(() => {})
    await p.waitForTimeout(1500)
    await grab('bag drawer thumbnail', 'li > img[class*="object-cover"]')
    for (const [label, rs] of Object.entries(found)) {
      seen += rs.length
      const bad = rs.filter((r) => Math.abs(ratio(r) - 0.8) > 0.02)
      check(bad.length === 0, `${name} ${lang} ${label}: ${rs.length} photo box(es) all 4:5`, bad.slice(0, 2).map((r) => `${Math.round(r.w)}x${Math.round(r.h)}=${ratio(r).toFixed(2)}`).join(' '))
    }
    check(['shop card', 'home best seller', 'category card', 'bag drawer thumbnail'].every((k) => found[k]), `${name} ${lang}: every kind of photo box was found (a missing one is not a pass)`, Object.keys(found).join(', '))
    await ctx.close()
  }
}
check(seen > 60, 'a real number of photo boxes was measured', String(seen))
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
