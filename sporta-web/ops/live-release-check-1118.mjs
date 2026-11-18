// READ-ONLY release checker for the 2026-11-18 storefront add-on release (BUYBAR-1118b, COLOURS-1118, CARDS-1118, ICONS-1118,
// CENTER-1118). Run ON the VPS in the Playwright image (npm i playwright@1.49.0, then node ops/live-release-check-1118.mjs from the
// downloaded tree of the deployed commit). GET only: every other method is aborted, nothing signs in, no form is touched.
//
//   1  the ten shipped files served by https://www.sporta.com.kw are byte-for-byte the files of this commit (sha256, no encoding);
//   2  on a phone and a desktop, in Arabic and English, on home, shop, a product, about, contact, the bag and the checkout:
//      no page error, no sideways scroll, the orange tokens are the logo's, no red anywhere in what is drawn (light theme);
//   3  the product page's buy bar (390 px): ONE button (Buy now), no price, near-black with orange text, label centred, 73 px bar,
//      Add back in the row under the stepper; the same on the desktop where the bar is not drawn;
//   4  headings are centred (home, about), the quick-add "+" has no grey rim, the why-card index is an orange disc, the footer's
//      cash chip icon is the logo orange and the product page's reassurance icons stay the dark step;
//   5  /backends (signed out): loads, the sign-in screen is there, no page error, and its failure colours are untouched.
// Prints "ok" / "FAIL" lines and ends with RELEASE_CHECK_DONE bad=<n>.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const B = process.env.CHECK_BASE || 'https://www.sporta.com.kw'   // CHECK_BASE: a local copy of the captured storefront, to test this checker itself
const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const FILES = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-bag-touch.css', 'sporta-checkout-a11y.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-images.css', 'sporta-shadows.css', 'sporta-ui-colours.css', 'sporta-features.js']
let bad = 0
const say = (s) => console.log(s)
const is = (ok, msg, d = '') => { if (!ok) bad++; say((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && d ? '  - ' + d : '')) }

// ---- 1 the files
for (const f of FILES) {
  const mine = createHash('sha256').update(readFileSync(join(PUB, f))).digest('hex')
  const r = await fetch(`${B}/${f}?v=${Date.now()}`, { headers: { 'accept-encoding': 'identity' } })
  const live = createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')
  is(r.status === 200 && live === mine, `${f}: live bytes equal this commit's file`, `status ${r.status} live ${live.slice(0, 12)} repo ${mine.slice(0, 12)}`)
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const products = await (await fetch(`${B}/api/api.php?r=products`)).json().catch(() => [])
const stock = await (await fetch(`${B}/api/api.php?r=stock`)).json().catch(() => [])
const inStock = new Set((Array.isArray(stock) ? stock : []).filter((r) => (r.stock ?? r.qty ?? 0) > 0).map((r) => r.slug))
const slug = (Array.isArray(products) ? products : []).map((p) => p.slug).find((s) => inStock.has(s)) || 'flash-shorts-green'
say(`product used: ${slug}`)

// every colour the page actually draws (text, fill, border) that is a red: hue within 12 degrees of 0, saturated, not near black/white
const REDS = () => {
  const out = new Map()
  const red = (c) => {
    const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/); if (!m) return false
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => +x / 255), a = m[4] === undefined ? 1 : +m[4]
    if (a < 0.4) return false
    const M = Math.max(r, g, b), n = Math.min(r, g, b), d = M - n, l = (M + n) / 2
    if (d < 0.2 || l < 0.15 || l > 0.9) return false
    const h = M === r ? (((g - b) / d) % 6) * 60 : M === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
    const hh = (h + 360) % 360
    return hh >= 338 || hh <= 12
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue
    const cs = getComputedStyle(el)
    for (const [prop, val] of [['color', cs.color], ['background', cs.backgroundColor], ['border', cs.borderTopColor], ['stroke', cs.stroke], ['fill', cs.fill]]) {
      if (prop === 'color' && !el.childNodes.length) continue
      if (prop === 'border' && cs.borderTopWidth === '0px') continue
      if (val && val !== 'none' && red(val)) { const k = `${prop} ${val} ${el.tagName.toLowerCase()}.${(el.className && el.className.toString().split(/\s+/)[0]) || ''}`; out.set(k, (out.get(k) || 0) + 1) }
    }
  }
  return [...out.entries()].slice(0, 6)
}

const pages = [['/', 'home'], ['/shop', 'shop'], [`/product/${slug}`, 'product'], ['/about', 'about'], ['/contact', 'contact'], ['/cart', 'cart'], ['/checkout', 'checkout']]
for (const lang of ['ar', 'en']) for (const [w, h] of [[390, 900], [1280, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('lang', l) } catch (e) {} }, [lang])
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  for (const [path, name] of pages) {
    const errs = []; const onErr = (e) => errs.push(String(e).slice(0, 140)); p.on('pageerror', onErr)
    await p.goto(`${B}${path}?lang=${lang}`, { waitUntil: 'load' }).catch(() => {})
    await p.waitForTimeout(1800)
    const tag = `${name} ${lang} ${w}px`
    const m = await p.evaluate(() => { const root = getComputedStyle(document.documentElement); return { over: document.documentElement.scrollWidth - innerWidth, brand: root.getPropertyValue('--brand').trim(), deep: root.getPropertyValue('--brand-deep').trim(), reds: null } })
    m.reds = await p.evaluate(REDS)
    is(errs.length === 0, `${tag}: no page error`, errs.join(' | '))
    is(m.over <= 0, `${tag}: no sideways scroll`, `${m.over}px`)
    is(m.brand.toLowerCase() === '#ff7b17' && m.deep.toLowerCase() === '#b34d00', `${tag}: tokens are the logo orange and its dark step (${m.brand} / ${m.deep})`)
    is(m.reds.length === 0, `${tag}: no red is drawn`, JSON.stringify(m.reds))
    if (name === 'product') {
      const b = await p.evaluate(() => {
        const bar = document.querySelector('.action-bar'), row = document.querySelector('.product-purchase-row'); const add = row && row.querySelector('.btn-primary'); const buy = bar && bar.querySelector(':scope > .btn'); const price = bar && bar.querySelector(':scope > span')
        const q = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }
        const rg = buy && document.createRange(); if (rg) rg.selectNodeContents(buy)
        const tr = rg && rg.getBoundingClientRect(); const br = buy && buy.getBoundingClientRect()
        const icons = [...document.querySelectorAll('.catalog-product-reassurance li > svg')].map((e) => getComputedStyle(e).color)
        return { barDisp: bar ? getComputedStyle(bar).display : null, bar: q(bar), buy: q(buy), buyBg: buy && getComputedStyle(buy).backgroundColor, buyColor: buy && getComputedStyle(buy).color, buyRad: buy && parseFloat(getComputedStyle(buy).borderTopLeftRadius), priceDisp: price && getComputedStyle(price).display, dx: tr && br ? Math.abs((tr.left + tr.right) / 2 - (br.left + br.right) / 2) : null, addPos: add && getComputedStyle(add).position, add: q(add), row: q(row), step: q(document.querySelector('.catalog-product-quantity')), label: buy && buy.textContent.trim(), icons }
      })
      if (w < 768) {
        is(b.priceDisp === 'none' && !!b.buy && b.buy.h >= 44 && Math.abs(b.buy.l - 16) <= 1.5 && Math.abs(b.buy.r - (w - 16)) <= 1.5, `${tag}: the bar is ONE full-width Buy now ("${b.label}"), no price`, JSON.stringify({ p: b.priceDisp, buy: b.buy }))
        is(b.buyBg === 'rgb(23, 26, 30)' && b.buyColor === 'rgb(255, 123, 23)' && b.buyRad >= b.buy.h / 2 - 1 && b.dx <= 2, `${tag}: near-black pill, logo-orange label, centred (${b.buyColor}, off ${b.dx && b.dx.toFixed(1)}px)`, JSON.stringify([b.buyBg, b.buyColor, b.buyRad, b.dx]))
        is(Math.abs(b.bar.h - 73) <= 1.5, `${tag}: the bar is as tall as before (${b.bar.h.toFixed(1)}px)`)
        is(b.addPos !== 'fixed' && b.add && b.step && b.add.w >= b.row.w - 1 && b.add.t >= b.step.b - 1, `${tag}: Add is back in the row, full width under the stepper`, JSON.stringify([b.addPos, b.add, b.step]))
      } else is(b.barDisp === 'none', `${tag}: the bar is not drawn on a desktop`, b.barDisp)
      is(b.icons.length >= 3 && b.icons.every((c) => c === 'rgb(179, 77, 0)'), `${tag}: the reassurance icons stay the dark orange step (3:1 on their panel)`, JSON.stringify(b.icons))
    }
    if (name === 'home' || name === 'about') {
      const c = await p.evaluate(() => [...document.querySelectorAll('main h1, main h2')].filter((e) => !e.matches('.sr-only') && e.getBoundingClientRect().width > 0 && !e.closest('.cart-line, summary, [role="dialog"]')).map((e) => getComputedStyle(e).textAlign))
      is(c.length >= 3 && c.every((a) => a === 'center'), `${tag}: ${c.length} headings are centred`, JSON.stringify(c))
    }
    if (name === 'about') {
      const d = await p.evaluate(() => [...document.querySelectorAll('.why-card-index')].map((e) => { const r = e.getBoundingClientRect(); return { bg: getComputedStyle(e).backgroundColor, w: Math.round(r.width), h: Math.round(r.height) } }))
      is(d.length === 4 && d.every((x) => x.bg === 'rgb(255, 123, 23)' && Math.abs(x.w - x.h) <= 1), `${tag}: the why-card index is an orange disc`, JSON.stringify(d))
    }
    if (name === 'shop') {
      const e = await p.evaluate(() => [...document.querySelectorAll('.catalog-card-add:not(.bg-brand)')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => getComputedStyle(b).borderTopColor))
      is(e.length === 0 || e.every((c) => c === 'rgba(0, 0, 0, 0)'), `${tag}: the quick-add "+" has no grey rim (${e.length} drawn)`, JSON.stringify([...new Set(e)]))
    }
    if (name === 'about') {
      const f = await p.evaluate(() => [...document.querySelectorAll('.footer-payment > svg')].map((e) => getComputedStyle(e).color))
      is(f.length >= 1 && f.every((c) => c === 'rgb(255, 123, 23)'), `${tag}: the footer's cash icon is the logo orange`, JSON.stringify(f))
    }
    p.off('pageerror', onErr)
  }
  await ctx.close()
}

// ---- 5 /backends signed out
for (const [w, h] of [[390, 900], [1280, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-KW' }); const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  await p.goto(`${B}/backends`, { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(2500)
  const m = await p.evaluate(() => ({ inputs: document.querySelectorAll('input').length, over: document.documentElement.scrollWidth - innerWidth, rose: getComputedStyle(document.documentElement).getPropertyValue('--color-rose-600').trim(), text: document.body.innerText.slice(0, 80).replace(/\s+/g, ' ') }))
  is(errs.length === 0 && m.inputs >= 1 && m.over <= 0, `backends ${w}px: the sign-in screen loads (${m.inputs} fields), no page error, no sideways scroll`, JSON.stringify([errs, m]))
  // the compiled stylesheet declares rose-600 as #e70044 and again, for browsers that know lab(), as lab(49.19% 81.58 36.03): both are the bundle's red
  is(/^#e70044$/i.test(m.rose) || /^lab\(49\.\d+% 81\./.test(m.rose), `backends ${w}px: the failure colour is still the bundle's red on the sign-in screen (${m.rose})`)
  await ctx.close()
}
await browser.close()
say(`RELEASE_CHECK_DONE bad=${bad}`)
process.exitCode = bad ? 1 : 0
