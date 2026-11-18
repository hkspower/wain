// READ-ONLY probe of the LIVE product page's Add to bag, as a shopper uses it (owner, 2026-11-18: "fix add to cart button").
// It loads product pages, reads the buttons, taps Add with no size, taps a size, taps Add, taps Add again (stock-1 products), and reads
// what the page and the browser's own bag (localStorage "sporta_cart") say. It never opens the checkout, never presses Buy now, never
// submits a form and sends no POST (the bag is client-side only). Run on the VPS in mcr.microsoft.com/playwright:v1.49.0-noble with
// `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.49.0` first (CLAUDE.md, "Probing the live site").
// Env: BASE, SLUGS (comma list), LANGS (ar,en), VIEWS (390x800,1280x900).
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const SLUGS = (process.env.SLUGS || 'sculpt-top-grey,sgomma-t-shirt-navy,cagliari-calcio-backpack').split(',')
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const VIEWS = (process.env.VIEWS || '390x800,1280x900').split(',').map((v) => v.split('x').map(Number))
const out = (s) => process.stdout.write(s + '\n')
const browser = await chromium.launch()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// one short line per step: the Add button (label text, aria-label, state, disabled, colours), the bar's Buy now, the size chips that are on,
// the alert, the notice, the bag count and the bag as the browser keeps it
const brief = (s) => [
  'ADD[' + (s.add ? [s.add.txt, s.add.aria || '-', s.add.st || '-', s.add.dis ? 'DISABLED' : 'on', s.add.bg.replace(/rgb\(|\)| /g, ''), s.add.fg.replace(/rgb\(|\)| /g, '')].join('|') : 'none') + ']',
  'BUY[' + (s.buy ? [s.buy.txt, s.buy.dis ? 'DISABLED' : 'on', s.buy.bg.replace(/rgb\(|\)| /g, ''), s.buy.fg.replace(/rgb\(|\)| /g, '')].join('|') : 'none') + ']',
  'chips[' + s.chips + ']', s.alert ? 'ALERT[' + s.alert + ']' : '', s.toast && s.toast.open ? 'TOAST[' + s.toast.txt.slice(0, 40) + ']' : '', 'cart[' + (s.cart || '') + '] bag[' + s.bagLines + ']', s.scrollX ? 'SIDEWAYS-SCROLL' : '',
].filter(Boolean).join(' ')
const snap = (pg) => pg.evaluate(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) }
  const add = document.querySelector('.product-purchase-row .btn-primary'), buy = document.querySelector('.action-bar > .btn')
  const chips = [...document.querySelectorAll('#product-size-options [role="group"] > button')]
  const bag = (() => { try { return JSON.parse(localStorage.getItem('sporta_cart') || '[]') } catch (e) { return 'unreadable' } })()
  const cart = document.querySelector('.app-header .navbar-cart')
  const alertEl = document.querySelector('#product-size-options > p[role="alert"]')
  const toast = document.querySelector('.sporta-u3-toast')
  const live = document.querySelector('.sporta-u3-live')
  const t = (e) => (e ? (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null)
  const cs = (e) => (e ? getComputedStyle(e) : null)
  return {
    add: add ? { txt: t(add), aria: add.getAttribute('aria-label'), dis: add.disabled, ad: add.getAttribute('aria-disabled'), st: add.getAttribute('data-sporta-state'), box: R(add), bg: cs(add).backgroundColor, fg: cs(add).color, op: cs(add).opacity } : null,
    buy: buy ? { txt: t(buy), dis: buy.disabled, box: R(buy), bg: cs(buy).backgroundColor, fg: cs(buy).color } : null,
    chips: chips.map((c) => (c.textContent || '').trim() + (c.disabled ? '(off)' : '') + (c.getAttribute('aria-pressed') === 'true' ? '(on)' : '')).join(' '),
    qty: t(document.querySelector('.product-purchase-row .purchase-quantity > span')),
    alert: t(alertEl), toast: toast ? { open: toast.hasAttribute('data-open'), txt: t(toast) } : null, live: t(live),
    cart: t(cart), bagLines: Array.isArray(bag) ? bag.map((l) => l.slug + ':' + l.size + 'x' + l.qty).join(' ') : bag,
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1, y: Math.round(scrollY),
  }
})
for (const [w, h] of VIEWS) for (const lang of LANGS) for (const slug of SLUGS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, locale: lang === 'ar' ? 'ar-KW' : 'en-GB', serviceWorkers: 'block' })
  const pg = await ctx.newPage()
  const errs = [], posts = [], bad = []
  pg.on('pageerror', (e) => errs.push(e.message.slice(0, 120)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console ' + m.text().slice(0, 100)) })
  pg.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url().slice(0, 80)) })
  pg.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(B, '').slice(0, 70)) })
  const tag = `${w}x${h} ${lang} ${slug}`
  try {
    await pg.goto(`${B}/product/${slug}?lang=${lang}`, { waitUntil: 'load', timeout: 60000 })
    await pg.waitForSelector('.product-purchase-row', { timeout: 30000 })
    await pg.evaluate(() => document.fonts.ready)
    await pg.waitForFunction(() => document.querySelectorAll('#product-size-options [role="group"] > button').length > 0 || !document.getElementById('product-size-options'), null, { timeout: 20000 }).catch(() => {})
    await sleep(1200)
    const s0 = await snap(pg)
    out(`[${tag}] START ${brief(s0)}`)
    const add = pg.locator('.product-purchase-row .btn-primary').first()
    // 1. Add with no size chosen
    if (s0.add && !s0.add.dis) {
      const t0 = Date.now(); await add.click({ timeout: 8000 }).catch((e) => out(`[${tag}] CLICK1 failed: ${String(e.message).split('\n')[0]}`)); await sleep(900)
      out(`[${tag}] ADD-NO-SIZE ${brief(await snap(pg))}`)
    } else out(`[${tag}] ADD-NO-SIZE skipped: Add is ${s0.add ? 'disabled' : 'missing'}`)
    // 2. choose the first size that is on offer, then Add
    const chip = pg.locator('#product-size-options [role="group"] > button:not([disabled])').first()
    if (await chip.count()) {
      await chip.click().catch(() => {}); await sleep(500)
      const s1 = await snap(pg); out(`[${tag}] SIZE-CHOSEN ${brief(s1)}`)
      const t1 = Date.now(); await add.click({ timeout: 8000 }).catch((e) => out(`[${tag}] CLICK2 failed: ${String(e.message).split('\n')[0]}`)); await sleep(1100)
      out(`[${tag}] ADD ${brief(await snap(pg))}`)
      // 3. Add again: stock-1 products must refuse; others add a second piece
      await sleep(3200)
      await add.click({ timeout: 8000 }).catch(() => {}); await sleep(1100)
      out(`[${tag}] ADD-AGAIN ${brief(await snap(pg))}`)
      // 4. the quantity stepper past the stock
      const plus = pg.locator('.product-purchase-row .purchase-quantity > button').last()
      for (let i = 0; i < 12; i++) await plus.click({ timeout: 2000 }).catch(() => {})
      await sleep(400); { const q = await snap(pg); out(`[${tag}] QTY-PLUS-x12 qty[${q.qty}] alert[${q.alert || ''}] ${q.add ? 'ADD[' + q.add.txt + '|' + (q.add.dis ? 'DISABLED' : 'on') + ']' : ''}`) }
    } else out(`[${tag}] no size chip is on offer (sold out, or a product with no sizes)`)
  } catch (e) { out(`[${tag}] PROBE ERROR ${String(e.message).split('\n')[0]}`) }
  out(`[${tag}] ERRORS ${JSON.stringify(errs)} NON-GET ${JSON.stringify(posts)} HTTP>=400 ${JSON.stringify(bad.slice(0, 6))}`)
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
