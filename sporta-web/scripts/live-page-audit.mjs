// READ-ONLY audit of LIVE storefront pages that are forms: the checkout, the account page (sign in / register),
// the cart. Layout, tap targets, text sizes, contrast, and what every form field tells the browser about itself
// (type, autocomplete, inputmode, label, font size: under 16px iOS zooms the page on focus).
//
// Nothing is submitted: no order, no registration, no sign-in, no POST by this script. To see the checkout form
// it puts one piece in the bag the way a shopper does (a click on a product page; the bag is browser storage,
// nothing reaches the server) and then only LOOKS at /checkout.
//
// SIGNED-IN PAGES (the customer profile). Only with the owner's explicit yes (given 2026-11-10 for ONE test
// account, "Sporta QA Test"): with ACCOUNT_EMAIL and ACCOUNT_PASSWORD set, each browser context signs in through
// the shop's own customer route before the pages are read, and with ACCOUNT_REGISTER=1 the account is created
// first if it does not exist (one row in customer_accounts; the route sends no email). No order is placed and
// the profile form is never submitted. SKIP_BAG=1 leaves the bag empty (no automatic price quote is triggered).
//
// Run on the VPS in the Playwright image, like live-product-audit.mjs. PATHS overrides the page list
// (comma separated), SLUG the product used to fill the bag. Output is compact: the job log keeps 300 entries.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const SLUG = process.env.SLUG || 'cloudsoft-jacket-army-green'
const PATHS = (process.env.PATHS || '/checkout,/account,/cart').split(',').map((s) => s.trim()).filter(Boolean)

const inPage = () => {
  const vw = window.innerWidth
  const main = document.querySelector('main') || document.body
  const sq = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const vis = (e) => { const c = getComputedStyle(e); const q = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.05 && q.width > 0 && q.height > 0 }
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + [...e.classList].slice(0, 3).join('.') : '')
  const rgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c } return { r: 255, g: 255, b: 255, a: 1 } }
  const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], taps: [], small: [], contrast: [], fields: [], buttons: [], outline: [], heads: [] }
  for (const e of main.querySelectorAll('*')) {
    if (!vis(e)) continue
    const q = e.getBoundingClientRect()
    if ((q.right > vw + 1 || q.left < -1) && out.wide.length < 6) out.wide.push(name(e) + ' ' + Math.round(q.left) + '..' + Math.round(q.right))
  }
  for (const e of main.querySelectorAll('a[href],button,[role=button],summary,label:has(input[type=radio]),label:has(input[type=checkbox])')) {
    if (!vis(e)) continue
    const q = e.getBoundingClientRect()
    if ((q.width < 44 || q.height < 44) && out.taps.length < 16) out.taps.push(name(e) + ' "' + sq(e.textContent || e.getAttribute('aria-label') || '').slice(0, 20) + '" ' + Math.round(q.width) + 'x' + Math.round(q.height))
  }
  for (const e of main.querySelectorAll('input,select,textarea')) {
    if (e.type === 'hidden') continue
    const q = e.getBoundingClientRect(); const c = getComputedStyle(e)
    const lab = e.labels && e.labels.length ? sq(e.labels[0].textContent).slice(0, 26) : (e.getAttribute('aria-label') ? 'aria:' + e.getAttribute('aria-label').slice(0, 22) : (e.getAttribute('aria-labelledby') ? 'labelledby' : 'NO-LABEL'))
    out.fields.push({ t: e.tagName.toLowerCase() + '[' + (e.type || '') + ']', name: e.name || e.id || '', ac: e.getAttribute('autocomplete') || '-', im: e.getAttribute('inputmode') || '-', req: e.required ? 1 : 0, ph: (e.placeholder || '').slice(0, 18), label: lab, fs: parseFloat(c.fontSize), box: Math.round(q.width) + 'x' + Math.round(q.height), vis: vis(e) ? 1 : 0, y: Math.round(q.top + scrollY), dir: c.direction, maxlen: e.maxLength > 0 ? e.maxLength : 0 })
  }
  for (const e of main.querySelectorAll('button,a.btn,[type=submit]')) {
    if (!vis(e) || out.buttons.length >= 24) continue
    const q = e.getBoundingClientRect()
    out.buttons.push(sq(e.textContent || e.getAttribute('aria-label') || '').slice(0, 26) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' y' + Math.round(q.top + scrollY) + (e.disabled ? ' DISABLED' : '') + (e.type === 'submit' ? ' submit' : ''))
  }
  const seen = new Set()
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = sq(n.nodeValue); const e = n.parentElement
    if (!t || !e || !vis(e)) continue
    const c = getComputedStyle(e); const fs = parseFloat(c.fontSize)
    if (fs < 12 && fs > 0 && out.small.length < 8) out.small.push(fs + 'px "' + t.slice(0, 22) + '" ' + name(e))
    const fg = rgb(c.color); if (!fg || fs === 0) continue
    const bg = bgOf(e); const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const big = fs >= 24 || (fs >= 18.66 && Number(c.fontWeight) >= 700)
    const key = name(e) + c.color
    if (ratio < (big ? 3 : 4.5) && !seen.has(key) && out.contrast.length < 10 && !e.closest('[class*=absolute]')) { seen.add(key); out.contrast.push(ratio.toFixed(2) + ' ' + fs + 'px "' + t.slice(0, 20) + '" ' + name(e) + ' ' + c.color) }
  }
  const kids = (root, depth) => { for (const e of root.children) { if (!vis(e)) continue; const q = e.getBoundingClientRect(); if (q.height < 8) continue; if (out.outline.length < 70) out.outline.push('  '.repeat(depth) + name(e) + ' y' + Math.round(q.top + scrollY) + ' h' + Math.round(q.height) + ' w' + Math.round(q.width)); if (depth < 3) kids(e, depth + 1) } }
  kids(main, 0)
  out.heads = [...main.querySelectorAll('h1,h2,h3,legend')].filter(vis).map((e) => e.tagName + ':' + sq(e.textContent).slice(0, 34)).slice(0, 24)
  out.forms = main.querySelectorAll('form').length
  out.docH = document.documentElement.scrollHeight
  out.fixed = [...document.querySelectorAll('body *')].filter((e) => vis(e) && ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().height > 30).map((e) => name(e) + ' ' + getComputedStyle(e).position + ' y' + Math.round(e.getBoundingClientRect().top) + ' h' + Math.round(e.getBoundingClientRect().height)).slice(0, 8)
  out.text = sq(main.innerText).replace(/(\b(19|20)\d\d\s+){8,}/g, '<years> ').slice(0, 2200)
  return out
}

const b = await chromium.launch()
for (const lang of ['ar', 'en']) {
  for (const w of [390, 1280]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } })
    const page = await ctx.newPage()
    const posts = []
    page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url().replace(B, '').slice(0, 60)) })
    const q = lang === 'en' ? '?lang=en' : ''
    if (process.env.ACCOUNT_EMAIL && process.env.ACCOUNT_PASSWORD) {
      await page.goto(B + '/account' + q, { waitUntil: 'networkidle' })
      const call = (route, body) => page.evaluate(async ([r, bdy]) => { const res = await fetch('/api/customer.php?r=' + r, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1' }, body: JSON.stringify(bdy) }); let j = null; try { j = await res.json() } catch (e) { /* not json */ } return res.status + ' ' + (j && j.error ? j.error : (j && j.email ? 'ok' : '')) }, [route, body])
      let how = ''
      if (process.env.ACCOUNT_REGISTER === '1' && lang === 'ar' && w === 390) how = 'register ' + await call('register', { name: 'Sporta QA Test', email: process.env.ACCOUNT_EMAIL, password: process.env.ACCOUNT_PASSWORD })
      if (!/^register 201/.test(how)) how += ' | login ' + await call('login', { email: process.env.ACCOUNT_EMAIL, password: process.env.ACCOUNT_PASSWORD })
      const me = await page.evaluate(async () => { const r = await fetch('/api/customer.php?r=me', { credentials: 'same-origin' }); const j = await r.json().catch(() => null); return r.status + ' ' + (j ? Object.keys(j).join(',') : 'null') })
      console.log('SIGNIN ' + lang + ' ' + w + ' ' + how + ' | me ' + me)
    }
    // one piece in the bag, the way a shopper puts it there (browser storage only)
    let bag = 'not tried'
    if (process.env.SKIP_BAG === '1') bag = 'skipped'
    else try {
      await page.goto(B + '/product/' + SLUG + q, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      const chip = page.locator('#product-size-options [role="group"] > button:not([disabled]):not([data-sporta-nosize])').first()
      if (await chip.count()) await chip.click()
      const add = page.locator('.product-purchase-row > .btn-primary:visible, .action-bar .btn:visible').first()
      await add.click({ timeout: 4000 })
      await page.waitForTimeout(700)
      bag = await page.evaluate(() => Object.keys(localStorage).filter((k) => /cart|bag/i.test(k)).map((k) => k + '=' + String(localStorage.getItem(k)).length + 'b').join(',') || 'no cart key')
    } catch (e) { bag = 'failed: ' + String(e).slice(0, 80) }
    console.log('BAG ' + lang + ' ' + w + ' ' + bag)
    for (const path of PATHS) {
      const resp = await page.goto(B + path + q, { waitUntil: 'networkidle' }).catch(() => null)
      await page.waitForTimeout(1200)
      const r = await page.evaluate(inPage).catch((e) => ({ error: String(e).slice(0, 200) }))
      const tag = path + ' ' + lang + ' ' + w
      console.log('PAGE ' + tag + ' status ' + (resp ? resp.status() : '?') + ' url ' + page.url().replace(B, '') + ' overflowX ' + r.overflowX + ' forms ' + r.forms + ' docH ' + r.docH)
      if (r.error) { console.log('ERR ' + tag + ' ' + r.error); continue }
      if (r.wide.length) console.log('WIDE ' + tag + ' ' + r.wide.join(' | '))
      if (r.taps.length) console.log('TAPS ' + tag + ' ' + r.taps.join(' | '))
      if (r.small.length) console.log('SMALL ' + tag + ' ' + r.small.join(' | '))
      if (r.contrast.length) console.log('CONTRAST ' + tag + ' ' + r.contrast.join(' | '))
      console.log('FIELDS ' + tag + ' ' + JSON.stringify(r.fields))
      console.log('BUTTONS ' + tag + ' ' + r.buttons.join(' | '))
      console.log('HEADS ' + tag + ' ' + r.heads.join(' | '))
      if (r.fixed.length) console.log('FIXED ' + tag + ' ' + r.fixed.join(' | '))
      if (lang === 'ar' || w === 390) console.log('OUTLINE ' + tag + ' ' + r.outline.join(' ; '))
      if (w === 390) console.log('TEXT ' + tag + ' ' + r.text)
    }
    if (posts.length) console.log('NON-GET ' + lang + ' ' + w + ' ' + [...new Set(posts)].join(' | '))
    await ctx.close()
  }
}
await b.close()
console.log('AUDIT_DONE')
