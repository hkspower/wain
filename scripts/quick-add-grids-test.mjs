/**
 * An Add-to-cart button on EVERY product grid — the home page's Best sellers and the category
 * pages (/men, /women, ...), which had none ("add add to cart button", 2026-10-01).
 *
 *   bash scripts/sandbox.sh
 *   node scripts/quick-add-grids-test.mjs
 *
 * Asserts, per grid and in both languages: the button exists, is a 44px target with an accessible
 * name that says "Add to cart" and names the garment; pressing it opens a size chooser INSTEAD of
 * following the card's link; choosing a size writes the right row into the cart (the bundle's own
 * localStorage shape: slug, size, qty 1) and the bag the shopper can see goes to 1; and pressing
 * the same button again for the same size makes it 2, not a second row. A garment with nothing in
 * stock must get no button (a button that opens to an empty chooser is worse than none).
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })

const grids = [
  ['home Best sellers', '/', '.sporta-home-products__card', '.sporta-home-products__frame'],
  // the category pages draw the /shop card since 2026-10-01: the photo link is the host
  ['category /men', '/men', 'main div.grid > article', 'main div.grid > article > a[class*="aspect-"]'],
  ['category /women', '/women', 'main div.grid > article', 'main div.grid > article > a[class*="aspect-"]'],
]
for (const lang of ['en', 'ar']) for (const [name, path, cardSel, frameSel] of grids) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}${path}?lang=${lang}`); await p.waitForTimeout(3500)
  const L = `${lang} ${name}:`
  const cards = p.locator(cardSel)
  const total = await cards.count()
  check(total > 0, `${L} the grid has cards`, String(total))
  const buttons = p.locator(`${frameSel} > button.qas-btn`)
  const n = await buttons.count()
  check(n > 0, `${L} cards carry an add button`, `${n} of ${total}`)
  if (!n) { await ctx.close(); continue }
  const first = buttons.first()
  const box = await first.boundingBox()
  check(box && box.width >= 44 && box.height >= 44, `${L} it is a 44px target`, JSON.stringify(box && [Math.round(box.width), Math.round(box.height)]))
  const label = (await first.getAttribute('aria-label')) ?? ''
  check(lang === 'en' ? /^Add to cart — .+/.test(label) : /^أضف إلى السلة — .+/.test(label), `${L} its name says Add to cart and names the garment`, label)

  const url0 = p.url()
  await first.scrollIntoViewIfNeeded()
  await first.click(); await p.waitForTimeout(500)
  check(p.url() === url0, `${L} pressing it does not follow the card's link`, p.url())
  const pills = p.locator('.qas-panel .qas-pill')
  check(await pills.count() > 0, `${L} it opens a size chooser`, `${await pills.count()} sizes`)
  const slug = decodeURIComponent((await first.evaluate((b) => b.closest('a').getAttribute('href'))).match(/\/product\/([^/?#]+)/)[1])
  const size = (await pills.first().textContent()).trim()
  await p.evaluate(() => { window.__qasNoReload = 1 })
  await Promise.all([p.waitForNavigation({ timeout: 2500 }).catch(() => {}), pills.first().click()])
  await p.waitForTimeout(800)
  check(await p.evaluate(() => window.__qasNoReload === 1), `${L} adding does NOT reload the page (the bundle's own add is used)`)
  const cart = await p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  const row = cart.find((r) => r.slug === slug && r.size === size)
  check(cart.length === 1 && row?.qty === 1 && row?.key === `${slug}__${size}__normal`, `${L} the cart holds that size once`, JSON.stringify(cart.map((r) => [r.key, r.qty])))
  check(row && typeof row.price === 'number' && row.price > 0 && row.name?.en && row.name?.ar, `${L} with its price and both-language name`, JSON.stringify(row && [row.price, row.name]))

  // the bag the shopper can see
  const bag = await p.evaluate(() => {
    const b = document.querySelector('[data-cart-badge]')
    if (b) return (b.textContent || '').trim()
    const a = document.querySelector('header [aria-label*="Bag"], header [aria-label*="الحقيبة"], header [aria-label*="Cart"]')
    return a ? (a.getAttribute('aria-label') + ' ' + a.textContent).trim() : ''
  })
  check(/1/.test(bag) || /1\s*(item|منتج)/i.test(bag), `${L} the visible bag shows 1`, bag)

  if (path !== '/') {
    const shown = await p.evaluate(() => { const b = document.querySelector('[data-cart-badge]'); return b ? b.textContent.trim() : '' })
    check(shown === '1', `${L} the category page's bag badge shows the count straight away (it was filled only at load)`, shown)
  }

  // again, same size: 2, not a second row
  const again = p.locator(`${frameSel} > button.qas-btn`).first()
  await again.scrollIntoViewIfNeeded(); await again.click(); await p.waitForTimeout(400)
  const pill2 = p.locator('.qas-panel .qas-pill', { hasText: new RegExp(`^${size}$`) }).first()
  await Promise.all([p.waitForNavigation({ timeout: 2500 }).catch(() => {}), pill2.click()])
  await p.waitForTimeout(800)
  const cart2 = await p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  if (path !== '/') check(await p.evaluate(() => (document.querySelector('[data-cart-badge]') || {}).textContent) === '2', `${L} and 2 after the second add`)
  check(cart2.length === 1 && cart2[0].qty === 2, `${L} the same size again makes it 2, not a second row`, JSON.stringify(cart2.map((r) => [r.key, r.qty])))
  await ctx.close()
}


// THE FALLBACK. If the bundle's cart cannot be reached (a different build, a React that keeps its
// tree elsewhere) the old reload path must still add the item truthfully. Simulated by stripping
// React's fiber keys from the elements the lookup starts from.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/?lang=en`); await p.waitForTimeout(3500)
  await p.evaluate(() => {
    window.__qasNoReload = 1
    for (const el of [document.querySelector('header'), document.querySelector('main'), document.getElementById('root'), document.body.firstElementChild])
      if (el) for (const k of Object.keys(el)) if (k.indexOf('__reactFiber$') === 0) delete el[k]
  })
  const b = p.locator('.sporta-home-products__frame > button.qas-btn').first()
  await b.scrollIntoViewIfNeeded(); await b.click(); await p.waitForTimeout(400)
  await Promise.all([p.waitForNavigation({ timeout: 6000 }).catch(() => {}), p.locator('.qas-panel .qas-pill').first().click()])
  await p.waitForTimeout(2500)
  check(await p.evaluate(() => window.__qasNoReload !== 1), 'fallback: with the bundle unreachable the page reloads, as before')
  const c = await p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))
  check(c.length === 1 && c[0].qty === 1, 'fallback: and the item is in the bag', JSON.stringify(c.map((r) => [r.key, r.qty])))
  await ctx.close()
}

// a garment with nothing in stock gets no button: every card's button must have sizes behind it
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/men?lang=en`); await p.waitForTimeout(3500)
  const stock = await (await fetch(`${BASE}/api/api.php?r=stock`)).json()
  const inStock = new Set(stock.filter((r) => r.in_stock).map((r) => r.slug))
  const withBtn = await p.evaluate(() => [...document.querySelectorAll('main div.grid > article > a[class*="aspect-"]')].map((a) => [a.getAttribute('href').match(/\/product\/([^/?#]+)/)[1], !!a.querySelector('button.qas-btn')]))
  const wrong = withBtn.filter(([slug, has]) => has !== inStock.has(decodeURIComponent(slug)))
  check(withBtn.length > 0 && wrong.length === 0, 'a button exactly where something is in stock — none on a sold-out garment', JSON.stringify(wrong.slice(0, 3)))
  await ctx.close()
}
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — every grid can add to the cart')
process.exit(fails ? 1 : 0)
