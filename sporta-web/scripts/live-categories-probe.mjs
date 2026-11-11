// READ-ONLY probe: how the LIVE storefront lets a shopper choose a category (home tiles, /shop filter, URL params).
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
const browser = await chromium.launch()
for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const q = (u) => B + u + (lang === 'en' ? (u.includes('?') ? '&' : '?') + 'lang=en' : '')
  await p.goto(q('/'), { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200)
  const tiles = await p.evaluate(() => [...document.querySelectorAll('a[href*="category"],a[href*="/shop"]')].map((a) => ({ h: a.getAttribute('href'), t: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), cls: (a.className || '').toString().slice(0, 40) })).slice(0, 30))
  out('== ' + lang + ' HOME links to shop/category: ' + JSON.stringify(tiles))
  await p.goto(q('/shop'), { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500)
  const filt = await p.evaluate(() => {
    const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim()
    const btns = [...document.querySelectorAll('main button, main [role=tab], main [role=radio], main select, main a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < 900 }).slice(0, 40).map((e) => e.tagName + (e.getAttribute('aria-pressed') ? '[pressed=' + e.getAttribute('aria-pressed') + ']' : '') + (e.getAttribute('aria-selected') ? '[sel=' + e.getAttribute('aria-selected') + ']' : '') + ' "' + t(e).slice(0, 30) + '" ' + (e.getAttribute('href') || ''))
    const cards = document.querySelectorAll('.product-grid-card, article').length
    return { btns, cards, url: location.href, sel: [...document.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.value + '=' + o.textContent.trim()).join('|')) }
  })
  out('SHOP ' + JSON.stringify(filt))
  for (const c of ['men', 'women', 'outerwear', 'accessories', 'outlet', 'sporta-outlet']) {
    await p.goto(q('/shop?category=' + c), { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(900)
    const n = await p.evaluate(() => ({ cards: document.querySelectorAll('.product-grid-card').length, h: (document.querySelector('h1,h2') || {}).textContent, url: location.pathname + location.search }))
    out('CAT ' + c + ' -> ' + JSON.stringify(n))
  }
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
