// Proves the layout actually reacts to safe-area insets.
//
// A headless browser reports env(safe-area-inset-*) as 0, so a test that only
// loads the page proves nothing — the CSS could be missing entirely and still
// "pass". The insets are routed through --sa-* custom properties precisely so
// this test can set them to the values a real iPhone reports (59px top for the
// Dynamic Island, 34px for the home-indicator bar) and then assert that the
// things which touch a screen edge moved out of the way.
import { chromium } from 'playwright'
// The catalogue is not fixed — importing the real OpenCart export replaced every
// placeholder slug. Naming one here made this test fail with "Cannot read
// properties of null" on a product page that had 404'd, which reads like a
// layout bug rather than a stale fixture. So the fixture comes from the
// catalogue itself.
import { readFileSync as _rf } from 'node:fs'
const _cat = (() => {
  const box = { window: {} }
  new Function('window', _rf(new URL('../../sporta-html5/assets/products.js', import.meta.url), 'utf8'))(box.window)
  return box.window.SPORTA_PRODUCTS
})()
const SAMPLE = _cat[0]
const CART_ITEM = { slug: SAMPLE.slug, qty: 1, price: SAMPLE.price, name: SAMPLE.name, image: '' }

const TOP = 59
const BOTTOM = 34
const INSETS = `:root{--sa-top:${TOP}px;--sa-bottom:${BOTTOM}px;--sa-left:0px;--sa-right:0px}`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})

const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

async function page(route, { insets = true, cart = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  })
  if (cart) {
    // The item is passed IN: addInitScript runs inside the browser, where the
    // Node-side CART_ITEM does not exist.
    await ctx.addInitScript((item) => localStorage.setItem('sporta_cart', JSON.stringify([item])), CART_ITEM)
  }
  const p = await ctx.newPage()
  await p.goto('http://www.sporta.com.kw' + route, { waitUntil: 'networkidle' })
  if (insets) await p.addStyleTag({ content: INSETS })
  await p.waitForTimeout(200)
  return { ctx, p }
}

// ---- header clears the Dynamic Island ----
{
  const a = await page('/', { insets: false })
  const before = await a.p.evaluate(() => document.querySelector('.app-header p').getBoundingClientRect().top)
  await a.ctx.close()
  const b = await page('/')
  const after = await b.p.evaluate(() => document.querySelector('.app-header p').getBoundingClientRect().top)
  ok('header content clears the status bar', Math.round(after - before) === TOP, `announcement bar top ${before} -> ${after}`)
  await b.ctx.close()
}

// ---- product buy bar clears the home indicator ----
{
  const { ctx, p } = await page(`/product/${SAMPLE.slug}`)
  const r = await p.evaluate(() => {
    const bar = document.querySelector('.action-bar')
    const btn = bar.querySelector('button')
    return { barBottom: bar.getBoundingClientRect().bottom, btnBottom: Math.round(btn.getBoundingClientRect().bottom), vh: innerHeight }
  })
  ok('buy bar button sits above the home indicator', r.vh - r.btnBottom >= BOTTOM, `${r.vh - r.btnBottom}px gap (need ${BOTTOM})`)
  await ctx.close()
}

// ---- checkout pay bar ----
{
  const { ctx, p } = await page('/checkout')
  const r = await p.evaluate(() => {
    const bar = document.querySelector('.action-bar')
    const btn = bar.querySelector('button[type=submit]')
    return { btnBottom: Math.round(btn.getBoundingClientRect().bottom), vh: innerHeight }
  })
  ok('checkout pay bar clears the home indicator', r.vh - r.btnBottom >= BOTTOM, `${r.vh - r.btnBottom}px gap`)
  await ctx.close()
}

// ---- the bars must not cover the end of the page ----
{
  const { ctx, p } = await page('/checkout')
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await p.waitForTimeout(400)
  const covered = await p.evaluate(() => {
    const bar = document.querySelector('.action-bar').getBoundingClientRect()
    const label = [...document.querySelectorAll('label')].pop()
    const r = label.getBoundingClientRect()
    return r.bottom > bar.top && r.top < bar.bottom
  })
  ok('sticky bar does not cover the last form field', !covered)
  await ctx.close()
}

// ---- open cart drawer respects both insets ----
{
  const { ctx, p } = await page('/shop')
  await p.locator('button[aria-label]').first().click()
  await p.waitForTimeout(600)
  const r = await p.evaluate(() => {
    const h = document.querySelector('.cart-drawer header')
    const title = h.querySelector('h2').getBoundingClientRect()
    return { titleTop: Math.round(title.top), overscroll: getComputedStyle(document.querySelector('.cart-drawer')).overscrollBehavior }
  })
  ok('drawer title clears the status bar', r.titleTop >= TOP, `title top ${r.titleTop}`)
  ok('drawer scroll does not chain to the page', r.overscroll.includes('contain'), r.overscroll)
  await ctx.close()
}

// ---- footer clears the home indicator ----
{
  const { ctx, p } = await page('/')
  const r = await p.evaluate(() => {
    const f = document.querySelector('.app-footer')
    // The copyright line is the genuinely last thing in the footer; a
    // ':last-of-type' query matched a nested paragraph far higher up and made
    // the assertion pass for the wrong reason.
    const ps = f.querySelectorAll('p')
    const last = ps[ps.length - 1].getBoundingClientRect()
    return Math.round(f.getBoundingClientRect().bottom - last.bottom)
  })
  ok('footer text clears the home indicator', r >= BOTTOM, `${r}px below last line`)
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
