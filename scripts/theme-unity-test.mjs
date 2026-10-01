/**
 * The shop looks like ONE shop: the design decisions of 2026-10-01, held in place.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/theme-unity-test.mjs
 *
 * A full theme scan that day measured the same things drawn several ways, and the
 * owner chose, out of options rendered side by side:
 *
 *   ONE CARD      the /shop card on every grid. The home Best sellers and the four
 *                 category pages had their own (+ on the photo, no heart, a plain box
 *                 for a missing photo, "8.000 KWD" against the shop's "KWD 8.000").
 *   CATEGORY      the shop's header and footer on the category pages, and a banner
 *                 no taller than about 45% of the screen (it was 1,040px at 1280x900,
 *                 so the first screen showed no products).
 *   TITLES        one page-title style: Alexandria 700, 26px phone / 30px desktop,
 *                 dark ink on the white body, an orange bar under it. There were six desktop sizes in two
 *                 faces.
 *   CLEAN-UPS     one outline button (the 404's was orange, the rest silver), and the
 *                 browser's own bar the colour of the header (it was near-black).
 *
 * WHAT IT MEASURES IS WHAT A VISITOR GETS: boxes, computed colours and stored state in a
 * real browser, each grid compared with /shop's own card rather than with numbers
 * typed here — so a later change to the /shop card is followed, not fought.
 *
 * It refuses to pass on nothing: every comparison first asserts it found the thing it
 * compares, because two missing cards agree perfectly.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : extra && process.env.VERBOSE ? `   ${extra}` : ''}`)
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (vw, vh = 900) => {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 500, hasTouch: vw < 500, serviceWorkers: 'block' })
  return { ctx, page: await ctx.newPage() }
}
const go = async (page, path, settle = 1200) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } scrollTo(0, 0) })
  await page.waitForTimeout(settle)
}

/* The card's parts, relative to the card: what a shopper sees, not what the markup says. */
const cardGeometry = (page, gridSel) => page.evaluate((gridSel) => {
  const grid = document.querySelector(gridSel)
  if (!grid) return null
  const cards = [...grid.querySelectorAll(':scope > article')]
  const withPlus = cards.find((a) => [...a.querySelectorAll('button:not([aria-pressed])')].some((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden'))
  const card = withPlus || cards[0]
  if (!card) return { cards: 0 }
  const r = card.getBoundingClientRect()
  const rel = (el) => { if (!el) return null; const x = el.getBoundingClientRect(); return { right: Math.round(r.right - x.right), top: Math.round(x.top - r.top), bottom: Math.round(r.bottom - x.bottom), w: Math.round(x.width) } }
  const plus = [...card.querySelectorAll('button:not([aria-pressed])')].find((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden')
  const cs = getComputedStyle(card)
  const photo = card.querySelector(':scope > a')
  const ph = photo.getBoundingClientRect()
  const noPhoto = cards.map((a) => a.querySelector(':scope > a > img')).find((i) => i && /^data:image\/svg/.test(i.getAttribute('src') || ''))
  return {
    cards: cards.length,
    bg: cs.backgroundColor, radius: cs.borderTopLeftRadius,
    photoRatio: +(ph.width / ph.height).toFixed(3),
    heart: rel(card.querySelector('button[aria-pressed]')),
    plus: rel(plus),
    nameSize: getComputedStyle(card.querySelector('h3')).fontSize,
    price: (card.querySelector('.price-card')?.firstChild?.textContent || '').trim(),
    placeholder: noPhoto ? getComputedStyle(noPhoto).content : 'no card without a photo',
  }
}, gridSel)

const PRICE = { en: /^KWD \d+\.\d{3}$/, ar: /^‏\d+\.\d{3} د\.ك\.‏$/ }

// ── 1. one card ───────────────────────────────────────────────────────────────
console.log('--- one card on every grid')
for (const [vw, lang] of [[390, 'ar'], [1280, 'en']]) {
  const { ctx, page } = await open(vw)
  const q = lang === 'en' ? '?lang=en' : ''
  await go(page, '/shop' + q)
  const ref = await cardGeometry(page, 'main div.grid[class~="grid-cols-2"]')
  check(ref && ref.cards > 0 && ref.heart && ref.plus, `${vw} ${lang}: /shop has a card with a heart and a + to compare against`, JSON.stringify(ref))
  for (const [name, path, sel] of [
    ['home Best sellers', '/' + q, '.sporta-home-products__grid'],
    ['category page', '/men' + q, 'main div.grid[class~="grid-cols-2"]'],
    ['related row', '/product/vanquish-tank-navy' + q, 'main div.grid[class~="grid-cols-2"]'],
  ]) {
    await go(page, path)
    const g = await cardGeometry(page, sel)
    check(g && g.cards > 0, `${vw} ${lang} ${name}: found its cards`, JSON.stringify(g))
    if (!g || !g.cards) continue
    check(g.bg === ref.bg && g.radius === ref.radius, `${vw} ${lang} ${name}: the /shop card's ground and corners`, `${g.bg} ${g.radius} vs ${ref.bg} ${ref.radius}`)
    check(Math.abs(g.photoRatio - ref.photoRatio) < 0.02, `${vw} ${lang} ${name}: the same photo shape`, `${g.photoRatio} vs ${ref.photoRatio}`)
    const near = (a, b) => a && b && Math.abs(a.right - b.right) <= 2 && Math.abs(a.top - b.top) <= 2
    check(near(g.heart, ref.heart), `${vw} ${lang} ${name}: the heart where /shop has it`, JSON.stringify([g.heart, ref.heart]))
    check(g.plus && Math.abs(g.plus.right - ref.plus.right) <= 2 && Math.abs(g.plus.bottom - ref.plus.bottom) <= 2,
      `${vw} ${lang} ${name}: the + beside the price, where /shop has it`, JSON.stringify([g.plus, ref.plus]))
    check(g.nameSize === ref.nameSize, `${vw} ${lang} ${name}: the same name size`, `${g.nameSize} vs ${ref.nameSize}`)
    check(PRICE[lang].test(g.price), `${vw} ${lang} ${name}: the shop's price format`, JSON.stringify(g.price))
    if (g.placeholder !== 'no card without a photo') check(/no-photo\.svg/.test(g.placeholder), `${vw} ${lang} ${name}: a missing photo shows the Sporta placeholder`, g.placeholder)
  }
  await ctx.close()
}

// the heart on the cards the bundle does not draw writes the bundle's own wishlist
{
  const { ctx, page } = await open(390)
  for (const [name, path, sel] of [['home', '/', '.sporta-home-products__grid'], ['category', '/men', 'main div.grid[class~="grid-cols-2"]']]) {
    await page.evaluate(() => localStorage.removeItem('sporta_wishlist')).catch(() => {})
    await go(page, path, 900)
    const heart = page.locator(`${sel} button[data-sporta-heart]`).first()
    check(await heart.count() === 1, `${name}: has a wishlist heart`)
    const slug = await heart.getAttribute('data-sporta-heart')
    await heart.click()
    await page.waitForTimeout(200)
    const state = await page.evaluate(() => ({ saved: localStorage.getItem('sporta_wishlist'), url: location.pathname }))
    check(state.url === (path === '/' ? '/' : path) && JSON.parse(state.saved || '[]').includes(slug),
      `${name}: pressing the heart saves the product to the shop's wishlist, without leaving the page`, JSON.stringify(state))
    check(await heart.getAttribute('aria-pressed') === 'true', `${name}: and the heart says so`)
  }
  await ctx.close()
}

// ── 2. the category pages wear the shop's header and footer ───────────────────
console.log('\n--- the category pages and the shop')
for (const [vw, vh, lang] of [[390, 844, 'ar'], [1280, 900, 'en'], [1920, 1080, 'en']]) {
  const { ctx, page } = await open(vw, vh)
  const q = lang === 'en' ? '?lang=en' : ''
  const shell = () => page.evaluate(() => {
    const h = document.querySelector('header.app-header'), f = document.querySelector('footer.app-footer')
    if (!h || !f) return null
    const box = (e) => (({ x, y, width, height }) => [x, y, width, height].map(Math.round).join(','))(e.getBoundingClientRect())
    return {
      height: Math.round(h.getBoundingClientRect().height), bg: getComputedStyle(h).backgroundColor,
      controls: [...h.querySelectorAll('a, button')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden')
        .map((e) => (e.getAttribute('aria-label') || '') + '@' + box(e)),
      footer: f.innerText.replace(/\s+/g, ' ').trim(),
      firstCardTop: Math.round(document.querySelector('main div.grid > article')?.getBoundingClientRect().top ?? 1e6),
      themeColor: document.querySelector('meta[name=theme-color]')?.content,
    }
  })
  await go(page, '/shop' + q, 1500)
  const shop = await shell()
  await go(page, '/men' + q, 1500)
  const men = await shell()
  check(shop && men, `${vw} ${lang}: both pages have the shop's header and footer`)
  if (!shop || !men) { await ctx.close(); continue }
  check(men.height === shop.height && men.bg === shop.bg, `${vw} ${lang}: the same header bar`, `${men.height} ${men.bg} vs ${shop.height} ${shop.bg}`)
  check(men.controls.join('|') === shop.controls.join('|'), `${vw} ${lang}: the same header controls in the same places`, `\n      men  ${men.controls.join(' | ')}\n      shop ${shop.controls.join(' | ')}`)
  check(men.footer.length > 100 && men.footer === shop.footer, `${vw} ${lang}: the same footer, word for word`, `\n      men  ${men.footer.slice(0, 160)}\n      shop ${shop.footer.slice(0, 160)}`)
  if (vw > 640) check(men.firstCardTop < vh, `${vw}x${vh}: products on the first screen (first card at ${men.firstCardTop}px)`)
  check(shop.themeColor && shop.themeColor.toLowerCase() === '#2d3034' && men.themeColor === shop.themeColor,
    `${vw} ${lang}: the browser bar is the header's colour on both`, `${shop.themeColor} / ${men.themeColor}`)
  await ctx.close()
}

// ── 3. one page-title style ───────────────────────────────────────────────────
console.log('\n--- one page-title style')
for (const [vw, size] of [[390, '26px'], [1280, '30px']]) {
  const { ctx, page } = await open(vw)
  await go(page, '/product/vanquish-tank-navy', 600)
  await page.locator('button').filter({ hasText: /^L$/ }).first().click()
  await page.locator('button').filter({ hasText: /^أضف$/ }).first().click()
  await page.waitForTimeout(800)
  const seen = []
  for (const path of ['/product/vanquish-tank-navy', '/checkout', '/cart', '/no-such-page', '/wishlist', '/track', '/about', '/returns', '/men']) {
    await go(page, path, 700)
    const t = await page.evaluate(() => {
      const h = [...document.querySelectorAll('main h1')].find((x) => x.getBoundingClientRect().width > 0 && !/text-lg/.test(x.className))
      if (!h) return null
      const cs = getComputedStyle(h), a = getComputedStyle(h, '::after')
      return { face: cs.fontFamily.split(',')[0].replace(/["']/g, ''), size: cs.fontSize, weight: cs.fontWeight, color: cs.color,
        bar: a.content !== 'none' ? `${Math.round(parseFloat(a.width))}x${Math.round(parseFloat(a.height))} ${a.backgroundColor}` : 'none' }
    })
    check(t, `${vw} ${path}: has a page title`)
    if (!t) continue
    seen.push(path)
    const ink = 'rgb(23, 26, 30)'   // dark ink: the body is white since 2026-10-01 (65-white-body.css), as the category banner always was
    check(t.face === 'Alexandria' && t.weight === '700' && t.size === size && t.color === ink && t.bar === '56x4 rgb(224, 86, 28)',
      `${vw} ${path}: Alexandria 700 ${size}, the orange bar`, JSON.stringify(t))
  }
  check(seen.length === 9, `${vw}: all nine titles were measured (${seen.length})`)
  await ctx.close()
}

// ── 4. one outline button ─────────────────────────────────────────────────────
console.log('\n--- one outline button')
{
  const { ctx, page } = await open(1280)
  const looks = new Map()
  for (const path of ['/shop?lang=en', '/product/vanquish-tank-navy?lang=en', '/no-such-page?lang=en']) {
    await go(page, path, 800)
    for (const s of await page.evaluate(() => [...document.querySelectorAll('main .btn.btn-ghost')].filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => { const cs = getComputedStyle(b); return `${cs.color} / ${cs.borderTopColor} / ${cs.borderTopLeftRadius}` }))) looks.set(s, (looks.get(s) || 0) + 1)
  }
  check(looks.size >= 1, `found the outline buttons (${[...looks.values()].reduce((a, b) => a + b, 0)})`)
  check(looks.size === 1, 'every outline button looks the same', [...looks.keys()].join(' | '))
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — one card, one header and footer, one title style, one outline button')
process.exit(fails ? 1 : 0)
