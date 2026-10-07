/**
 * test:cart-motion — the add-to-bag motion (assets/cart-motion.js).
 *
 *   - a size box on a /shop card: the photo flies to the bag (a ghost is drawn and travels toward
 *     the bag), the bag and its count animate, the pressed box gets its tick, and a toast names the
 *     item in the page's language with a View bag link — and the bag really gained one
 *   - the product page: the flight and the tick happen, but NO second toast (the page has its own)
 *   - lowering a quantity / removing does nothing
 *   - reduced motion: no flight and no bounce, but the tick and the toast still appear
 *   - the ghost and the toast clean themselves up; nothing scrolls sideways
 *
 * Run `bash scripts/sandbox.sh` first. MUTATE=1 blocks the script and must fail.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function open(path, { lang = 'en', reduced = false, phone = true } = {}) {
  const ctx = await browser.newContext({ ...(phone ? devices['Pixel 7'] : { viewport: { width: 1280, height: 900 } }), reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l); localStorage.removeItem('sporta_cart') } catch (e) {} }, lang)
  if (process.env.MUTATE === '1') await ctx.route('**/assets/cart-motion.js', (r) => r.abort())
  const p = await ctx.newPage()
  // Record what the motion draws, as it happens: a ghost lives ~0.6 s and would be missed by polling.
  await p.addInitScript(() => {
    window.__cm = { ghosts: 0, ghostMoved: false, bagAnims: 0 }
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('cm-ghost')) {
      window.__cm.ghosts++
      const r0 = n.getBoundingClientRect()
      setTimeout(() => { const a = n.getAnimations()[0]; if (a) { a.currentTime = 600 } const r1 = n.getBoundingClientRect(); if (Math.abs(r1.top - r0.top) + Math.abs(r1.left - r0.left) > 20) window.__cm.ghostMoved = true }, 50)
    } }).observe(document, { childList: true, subtree: true })   // `document`: documentElement is still null this early
    const orig = Element.prototype.animate
    Element.prototype.animate = function () { if (this.closest && this.closest('header.app-header')) window.__cm.bagAnims++; return orig.apply(this, arguments) }
  })
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  return { ctx, p }
}
const cartQty = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]').reduce((n, e) => n + e.qty, 0))

try {
  for (const lang of ['en', 'ar']) {
    const { ctx, p } = await open('/shop', { lang })
    const box = p.locator('.cardopt-size:not([disabled])').first()
    await box.scrollIntoViewIfNeeded()
    await box.click()
    await p.waitForTimeout(250)
    check(await box.evaluate((b) => b.hasAttribute('data-cm-added')), `[${lang}] /shop: the pressed size box shows its tick`)
    await p.waitForTimeout(900)
    const cm = await p.evaluate(() => window.__cm)
    check(cm.ghosts === 1 && cm.ghostMoved, `[${lang}] /shop: the photo flies toward the bag`, JSON.stringify(cm))
    check(cm.bagAnims >= 1, `[${lang}] /shop: the bag animates when it lands`, String(cm.bagAnims))
    check(await p.locator('.cm-ghost').count() === 0, `[${lang}] /shop: the flying photo is removed after landing`)
    check(await cartQty(p) === 1, `[${lang}] /shop: the bag really holds the item`)
    const toast = p.locator('.cm-toast')
    const tt = await toast.innerText().catch(() => '')
    check(await toast.count() === 1 && (lang === 'ar' ? /أُضيف إلى حقيبتك/.test(tt) && /عرض الحقيبة/.test(tt) : /Added to your bag/.test(tt) && /View bag/.test(tt)),
      `[${lang}] /shop: a toast says so, with View bag`, tt.replace(/\n/g, ' | '))
    check(await toast.getAttribute('role') === 'status', `[${lang}] /shop: the toast is announced politely to screen readers`)
    const go = await p.locator('.cm-toast .added-toast__go').boundingBox()
    check(go && go.height >= 44, `[${lang}] /shop: View bag is a 44px target`, go ? String(Math.round(go.height)) : '')
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `[${lang}] /shop: no sideways scroll`)
    await p.waitForTimeout(3800)
    check(await p.locator('.cm-toast').count() === 0, `[${lang}] /shop: the toast goes away on its own`)
    check(!(await box.evaluate((b) => b.hasAttribute('data-cm-added'))), `[${lang}] /shop: and so does the tick`)
    await ctx.close()
  }

  // lowering a quantity does nothing
  {
    const { ctx, p } = await open('/shop')
    await p.evaluate(() => {
      localStorage.setItem('sporta_cart', JSON.stringify([{ key: 'x__M__-', slug: 'x', size: 'M', fit: null, name: 'X', price: 1, qty: 3 }]))
    })
    await p.waitForTimeout(200)
    await p.evaluate(() => { document.querySelectorAll('.cm-toast').forEach((t) => t.remove()); window.__cm.ghosts = 0; localStorage.setItem('sporta_cart', JSON.stringify([{ key: 'x__M__-', slug: 'x', size: 'M', fit: null, name: 'X', price: 1, qty: 1 }])) })
    await p.waitForTimeout(500)
    check(await p.locator('.cm-toast').count() === 0 && (await p.evaluate(() => window.__cm.ghosts)) === 0, 'lowering a quantity draws no motion and no toast')
    await p.evaluate(() => localStorage.setItem('sporta_cart', '[]'))
    await p.waitForTimeout(300)
    check(await p.locator('.cm-toast').count() === 0, 'emptying the bag draws nothing')
    await ctx.close()
  }

  // the product page: flight yes, second toast no
  {
    const probe = await open('/shop')
    const href = await probe.p.locator('[data-cardopt-grid] a[href^="/product/"]').first().getAttribute('href')
    await probe.ctx.close()
    const { ctx, p } = await open(href, { phone: false })
    const size = p.locator('main button[aria-pressed]:not([disabled])').filter({ hasText: /^(S|M|L|XL|2XL|ONE|One size)$/ }).first()
    if (await size.count()) await size.click()
    const add = p.getByRole('button', { name: /^Add/ }).first()
    await add.click()
    await p.waitForTimeout(1200)
    const cm = await p.evaluate(() => window.__cm)
    check(cm.ghosts === 1 && cm.ghostMoved, 'product page: the photo flies to the bag', JSON.stringify(cm))
    check(await p.locator('.added-toast').count() === 1 && await p.locator('.cm-toast').count() === 0, 'product page: only the page\'s own toast, not a second one')
    await ctx.close()
  }

  // reduced motion
  {
    const { ctx, p } = await open('/shop', { reduced: true })
    const box = p.locator('.cardopt-size:not([disabled])').first()
    await box.scrollIntoViewIfNeeded(); await box.click()
    await p.waitForTimeout(400)
    const cm = await p.evaluate(() => window.__cm)
    check(cm.ghosts === 0 && cm.bagAnims === 0, 'reduced motion: nothing flies and the bag does not bounce', JSON.stringify(cm))
    check(await p.locator('.cm-toast').count() === 1 && await box.evaluate((b) => b.hasAttribute('data-cm-added')), 'reduced motion: the tick and the toast still say it was added')
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — the photo flies to the bag, the bag pops, the button ticks, and a toast confirms')
process.exit(fails ? 1 : 0)
