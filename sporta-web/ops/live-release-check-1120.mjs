// READ-ONLY release checker for the 2026-11-20 storefront add-on release (TOPBAR ACCOUNT 1120, PRODUCT BACK 1120, PRODUCT UX 1120, ACCOUNT 1120,
// ORDER PAGES 1120 and the ADMIN FABRIC button fix). Run ON the VPS in the Playwright image (npm i playwright@1.49.0 in a fresh folder, then this
// file with CHECK_PUB pointing at the public/ folder of the deployed commit's tarball). GET only: every other method is aborted, nothing signs in,
// no form is submitted, no order is made (the password box is typed into and never submitted).
//
//   1  the eight shipped files served by https://www.sporta.com.kw are byte-for-byte the files of this commit (sha256, no encoding);
//      the admin file is the loader (small, names the full file) and the full file;
//   2  on a phone and a desktop, in Arabic and English, on home, shop, about, contact, the bag and /account: ONE account link in the top bar
//      (/account, named, 44 px), the Sporta AI button is in the page but not drawn, no page error, no sideways scroll;
//   3  a plain click on the account link opens /account without a reload (a marker survives) and marks it current;
//   4  a product page opened directly: no header, the Back control (44 px, the word of the language), the WhatsApp / Share row, and Back
//      from a direct visit goes to the shop;
//   5  /account (signed out): typing in the new-password box draws the length meter; ?verified=1 draws its notice;
//   6  /checkout with one line in the bag: the order summary's Edit bag link and its two reassurance lines (informational: the quick layout has its own).
// Prints "ok" / "FAIL" / "info" lines and ends with RELEASE_CHECK_DONE bad=<n>.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const B = process.env.CHECK_BASE || 'https://www.sporta.com.kw'   // CHECK_BASE: a local copy of the captured storefront, to test this checker itself
const PUB = process.env.CHECK_PUB || join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const FILES = ['birthday.js', 'boot.js', 'sporta-checkout-a11y.css', 'sporta-checkout-a11y.js', 'sporta-features.js', 'sporta-product-fix.css', 'sporta-shadows.css']
let bad = 0, okN = 0, secOk = 0, secName = ''
const QUIET = process.env.CHECK_QUIET === '1'   // the Hostinger API keeps 300 log lines: on the VPS only failures and one count per section are printed
const say = (s) => console.log(s)
const is = (ok, msg, d = '') => { if (ok) { okN++; secOk++; if (!QUIET) say('ok   ' + msg) } else { bad++; say('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const section = (name) => { if (QUIET && secName) say(`ok   [${secName}] ${secOk} checks passed`); secName = name; secOk = 0 }
const info = (msg) => say('info ' + msg)
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const get = async (path) => { const r = await fetch(`${B}${path}${path.includes('?') ? '&' : '?'}v=${Date.now()}`, { headers: { 'accept-encoding': 'identity' } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers } }

// ---- 1 the files
section('files and markers')
for (const f of FILES) {
  const mine = sha(readFileSync(join(PUB, f)))
  const r = await get('/' + f)
  is(r.status === 200 && sha(r.buf) === mine, `${f}: live bytes equal this commit's file`, `status ${r.status} live ${sha(r.buf).slice(0, 12)} repo ${mine.slice(0, 12)}`)
  is(/no-cache/.test(r.headers.get('cache-control') || ''), `${f}: served with no-cache (a visitor revalidates)`, r.headers.get('cache-control') || '(none)')
}
{
  const src = readFileSync(join(PUB, 'sporta-admin-brands.js'))
  const full = await get('/sporta-admin-brands.full.js')
  is(full.status === 200 && sha(full.buf) === sha(src), 'sporta-admin-brands.full.js: live bytes equal the admin source of this commit (the Fabric button fix)', `status ${full.status} live ${sha(full.buf).slice(0, 12)} repo ${sha(src).slice(0, 12)}`)
  const loader = await get('/sporta-admin-brands.js')
  is(loader.status === 200 && loader.buf.length < 4000 && /sporta-admin-brands\.full\.js/.test(loader.buf.toString('utf8')), 'sporta-admin-brands.js is still the small loader that names the full file', `${loader.buf.length} bytes`)
  is(/inline-?style|height\s*=\s*'2\.5rem'/.test(full.buf.toString('utf8')) || full.buf.toString('utf8').includes("b.style.height = '2.5rem'"), 'the full file carries the Fabric button box (height 2.5rem)')
}
{
  const f = (await get('/sporta-features.js')).buf.toString('utf8'), s = (await get('/sporta-shadows.css')).buf.toString('utf8'), b = (await get('/boot.js')).buf.toString('utf8')
  is(f.includes('TOPBAR ACCOUNT') && f.includes('PRODUCT ACTIONS 1120') && f.includes('CASH ORDER 1120') && f.includes('ACCOUNT 1120'), 'features.js carries its four new blocks')
  is(s.includes('TOPBAR ACCOUNT 1120') && s.includes('ORDER PAGES 1120') && s.includes('ACCOUNT 1120'), 'shadows.css carries its new sections')
  is(b.includes('PRODUCT BACK 1120'), 'boot.js carries PRODUCT BACK 1120')
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const products = await (await fetch(`${B}/api/api.php?r=products`)).json().catch(() => [])
const stock = await (await fetch(`${B}/api/api.php?r=stock`)).json().catch(() => [])
const inStock = new Set((Array.isArray(stock) ? stock : []).filter((r) => (r.stock ?? r.qty ?? 0) > 0).map((r) => r.slug))
const prod = (Array.isArray(products) ? products : []).find((p) => inStock.has(p.slug)) || (Array.isArray(products) ? products[0] : null) || { slug: 'flash-shorts-green', price: 5 }
const slug = prod.slug
say(`product used: ${slug} (${Array.isArray(products) ? products.length : '?'} products in the API)`)

async function open(path, { lang = 'en', w = 390, h = 900, cart = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript(([l, c]) => { try { localStorage.setItem('lang', l); if (c) localStorage.setItem('sporta_cart', JSON.stringify(c)) } catch (e) {} }, [lang, cart])
  await ctx.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))   // GET only
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 160)))
  const res = await page.goto(B + path, { waitUntil: 'load', timeout: 45000 })
  return { ctx, page, errs, status: res ? res.status() : 0 }
}

// ---- 2 the top bar
section('top bar, six pages x two languages x two widths')
const WORD = { en: /^Account$/, ar: /^حسابي$/ }
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) for (const path of ['/', '/shop', '/about', '/contact', '/cart', '/account']) {
  const tag = `${path} ${lang} ${w}px`
  const o = await open(path, { lang, w })
  try {
    await o.page.waitForSelector('.app-header .navbar-main', { timeout: 20000 })
    await o.page.waitForSelector('a.navbar-account', { timeout: 8000, state: 'attached' }).catch(() => {})
    await o.page.waitForTimeout(1200)
    const m = await o.page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
      const acc = [...document.querySelectorAll('a.navbar-account')].filter(vis), all = document.querySelectorAll('a.navbar-account').length
      const a = acc[0], r = a && a.getBoundingClientRect()
      const ai = [...document.querySelectorAll('.app-header .navbar-ai')]
      return {
        shown: acc.length, all, href: a && a.getAttribute('href'), label: a && a.getAttribute('aria-label'), w: r && r.width, h: r && r.height,
        current: a && a.getAttribute('aria-current'), inTools: !!(a && a.closest('.navbar-tools')),
        aiInPage: ai.length, aiShown: ai.some(vis), side: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    is(o.status === 200, `${tag}: 200`, String(o.status))
    is(m.shown === 1 && m.all === 1 && m.href === '/account' && m.inTools, `${tag}: ONE account link in the tool cluster, to /account`, JSON.stringify(m))
    is(m.label && WORD[lang].test(m.label), `${tag}: it is named in the page's language`, String(m.label))
    is(m.w >= 43 && m.h >= 43, `${tag}: 44 px to the finger`, `${m.w}x${m.h}`)
    is(!m.aiShown, `${tag}: the Sporta AI button is not drawn${m.aiInPage ? ' (it is still in the page)' : ''}`)
    is(path === '/account' ? m.current === 'page' : m.current === null, `${tag}: aria-current ${path === '/account' ? 'is page' : 'is absent'}`, String(m.current))
    is(m.side <= 1, `${tag}: no sideways scroll`, String(m.side))
    is(o.errs.length === 0, `${tag}: no page error`, o.errs.join(' | '))
  } catch (e) { is(false, `${tag}: loaded`, String(e.message || e).split('\n')[0]) }
  await o.ctx.close()
}

// ---- 3 a click on it opens /account without a reload
section('account link click')
{
  const o = await open('/shop', { lang: 'en', w: 390 })
  try {
    await o.page.waitForSelector('a.navbar-account', { timeout: 20000 })
    await o.page.waitForTimeout(1200)
    await o.page.evaluate(() => { window.__sentinel = 'still-here' })
    await o.page.click('a.navbar-account')
    await o.page.waitForURL((u) => u.pathname === '/account', { timeout: 15000 })
    await o.page.waitForTimeout(800)
    const s = await o.page.evaluate(() => ({ sentinel: window.__sentinel || null, path: location.pathname, current: (document.querySelector('a.navbar-account') || {}).getAttribute && document.querySelector('a.navbar-account').getAttribute('aria-current') }))
    is(s.path === '/account' && s.sentinel === 'still-here' && s.current === 'page', 'a click on the account link opens /account without a reload and marks it current', JSON.stringify(s))
  } catch (e) { is(false, 'the account link click', String(e.message || e).split('\n')[0]) }
  await o.ctx.close()
}

// ---- 4 the product page
section('product page, two languages x two widths')
for (const lang of ['en', 'ar']) for (const w of [390, 1280]) {
  const tag = `/product/${slug} ${lang} ${w}px`
  const o = await open(`/product/${slug}`, { lang, w })
  try {
    await o.page.waitForSelector('.sporta-back-bar .sporta-back', { timeout: 20000 })
    await o.page.waitForSelector('.catalog-product-title', { timeout: 20000 })
    await o.page.waitForTimeout(1800)
    const m = await o.page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
      const hdr = document.querySelector('header.app-header'), back = document.querySelector('.sporta-back-bar .sporta-back')
      const box = document.querySelector('[data-sporta-pactions]'), share = document.querySelector('[data-sporta-pact="share"]'), ask = document.querySelector('[data-sporta-pact="ask"]')
      const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), shown: vis(e) } }
      const title = document.querySelector('.catalog-product-title')
      return {
        route: document.documentElement.getAttribute('data-sporta-route'), header: hdr ? vis(hdr) : null, back: rect(back), backText: back && back.textContent.trim(),
        box: rect(box), share: rect(share), ask: rect(ask), askHref: ask && ask.getAttribute('href'), joiner: /⁠/.test(title ? title.textContent : ''), hyphen: /\p{L}-\p{L}/u.test(title ? title.textContent.replace(/⁠/g, '') : ''),
        side: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    is(m.route === 'product' && m.header === false, `${tag}: no header is drawn (the page is marked as a product page)`, JSON.stringify([m.route, m.header]))
    is(m.back && m.back.shown && m.back.h >= 43 && (lang === 'en' ? /Back/i : /رجوع/).test(m.backText), `${tag}: the Back control: 44 px, named in the page's language`, JSON.stringify([m.back, m.backText]))
    is(m.box && m.box.shown && m.share && m.share.shown && m.share.h >= 43, `${tag}: the Share control is there, 44 px`, JSON.stringify([m.box, m.share]))
    if (m.ask) is(m.ask.shown && m.ask.h >= 43 && /^https:\/\/wa\.me\/\d+/.test(m.askHref || ''), `${tag}: the WhatsApp ask action is 44 px and opens wa.me with the shop's number`, JSON.stringify([m.ask, m.askHref]))
    else info(`${tag}: no WhatsApp ask action (the footer has no WhatsApp link; Share takes the row)`)
    if (m.hyphen) is(m.joiner, `${tag}: a hyphenated title keeps its hyphen with the word (word joiner present)`)
    is(m.side <= 1, `${tag}: no sideways scroll`, String(m.side))
    is(o.errs.length === 0, `${tag}: no page error`, o.errs.join(' | '))
    if (lang === 'en' && w === 390) {
      await o.page.click('.sporta-back-bar .sporta-back')
      await o.page.waitForURL((u) => u.pathname === '/shop', { timeout: 15000 })
      is(true, `${tag}: Back from a direct visit goes to the shop`)
    }
  } catch (e) { is(false, `${tag}: loaded`, String(e.message || e).split('\n')[0]) }
  await o.ctx.close()
}

// ---- 5 /account, signed out
section('account page')
{
  const o = await open('/account', { lang: 'en', w: 390 })
  try {
    await o.page.waitForSelector('#customer-password', { timeout: 20000 })
    await o.page.fill('#customer-password', 'abcde')
    await o.page.waitForSelector('.spv-pw__txt', { timeout: 8000 })
    const t1 = await o.page.locator('.spv-pw__txt').first().textContent()
    is(/5/.test(t1 || '') && /12/.test(t1 || ''), 'typing in the new-password box draws the length meter ("5 of 12")', String(t1))
    await o.page.fill('#customer-password', 'abcdefghijkl')
    await o.page.waitForTimeout(500)
    const t2 = await o.page.locator('.spv-pw__txt').first().textContent()
    is(/long enough/i.test(t2 || ''), 'twelve characters read "Long enough"', String(t2))
    is(o.errs.length === 0, '/account: no page error', o.errs.join(' | '))
  } catch (e) { is(false, '/account: the password meter', String(e.message || e).split('\n')[0]) }
  await o.ctx.close()
  const v = await open('/account?verified=1', { lang: 'en', w: 390 })
  try {
    await v.page.waitForSelector('main', { timeout: 20000 })
    await v.page.waitForTimeout(1800)
    const txt = await v.page.evaluate(() => document.body.innerText)
    is(/email address is verified/i.test(txt), '/account?verified=1 draws the verified notice')
  } catch (e) { is(false, '/account?verified=1', String(e.message || e).split('\n')[0]) }
  await v.ctx.close()
}

// ---- 6 the checkout summary (informational: the quick layout keeps its own Edit bag)
section('checkout summary')
for (const w of [390, 1280]) {
  const price = Number(prod.sale_price || prod.price || 5) || 5
  const cart = [{ key: `${slug}__M__-`, slug, size: 'M', fit: null, name: { en: slug, ar: slug }, price, image: '/product-photo-unavailable.svg', qty: 1 }]
  const o = await open('/checkout', { lang: 'en', w, cart })
  try {
    await o.page.waitForSelector('main', { timeout: 20000 })
    await o.page.waitForTimeout(2500)
    const m = await o.page.evaluate(() => {
      const a = document.querySelector('a.sporta-editbag'), li = document.querySelectorAll('.sporta-trust li')
      const r = a && a.getBoundingClientRect()
      return { edit: !!a, href: a && a.getAttribute('href'), h: r && Math.round(r.height), lines: li.length, side: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    if (m.edit) is(m.href === '/cart' && m.h >= 43 && m.lines === 2, `/checkout ${w}px: the summary has the Edit bag link (44 px, to /cart) and two reassurance lines`, JSON.stringify(m))
    else info(`/checkout ${w}px: no Edit bag link drawn (${JSON.stringify(m)}): the quick layout keeps its own, or the summary is not open`)
    is(m.side <= 1, `/checkout ${w}px: no sideways scroll`, String(m.side))
    is(o.errs.length === 0, `/checkout ${w}px: no page error`, o.errs.join(' | '))
  } catch (e) { is(false, `/checkout ${w}px`, String(e.message || e).split('\n')[0]) }
  await o.ctx.close()
}

await browser.close()
section('')
say(`RELEASE_CHECK_DONE bad=${bad} ok=${okN}`)
process.exitCode = bad ? 1 : 0
