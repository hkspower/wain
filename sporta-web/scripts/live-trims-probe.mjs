// READ-ONLY live check after the scope-A deploy (deploy-20261112T114307Z-f0ba902): the checkout trim (TRIM-1112: floor and
// flat visible, the delivery note + location behind one "More address details (optional)" button) and the /backends admin
// code (loader -> full file once, no page errors). Run ON the VPS in mcr.microsoft.com/playwright:v1.49.0-noble
// (CLAUDE.md "Probing the live site"). It only GETs: every non-GET request is aborted. The bag is filled on the product page
// with the shop's own client-side "Add" (localStorage only, nothing sent); nothing is submitted, no order, no sign-in.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const SLUG = '/product/cagliari-calcio-backpack'
const out = (s) => console.log(s)
let bad = 0
const flag = (c, m) => { if (!c) bad++; out((c ? 'ok   ' : 'FAIL ') + m) }
const browser = await chromium.launch()

for (const [lang, w] of [['ar', 390], ['en', 390], ['ar', 1280]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', hasTouch: w < 768 })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await p.goto(B + SLUG + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
  const chip = await p.$('.catalog-product-page [aria-pressed="false"]:not([disabled])')
  if (chip) { await chip.click().catch(() => {}); await p.waitForTimeout(300) }
  const add = await p.$('.catalog-product-page .product-purchase-row > .btn-primary:not([disabled])')
  if (add) { await add.click().catch(() => {}); await p.waitForTimeout(600) }
  await p.goto(B + '/checkout' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(1500)
  const m = await p.evaluate(() => {
    const shown = (e) => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0
    const btn = [...document.querySelectorAll('button[aria-expanded]')].find((b) => /More address details|تفاصيل إضافية للعنوان/.test(b.textContent))
    const inputs = [...document.querySelectorAll('form input[type=text], form input:not([type]), form input[type=tel], form textarea')]
    const labelOf = (i) => ((i.labels && i.labels[0] && i.labels[0].textContent) || i.getAttribute('aria-label') || i.placeholder || i.name || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return {
      path: location.pathname,
      button: btn ? { text: btn.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), expanded: btn.getAttribute('aria-expanded'), h: Math.round(btn.getBoundingClientRect().height) } : null,
      visible: inputs.filter(shown).map(labelOf),
      hiddenNote: inputs.filter((i) => i.tagName === 'TEXTAREA' && !shown(i)).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  out(`== ${lang} ${w}px ${m.path} button=${JSON.stringify(m.button)} visible=${JSON.stringify(m.visible)} hiddenNote=${m.hiddenNote} overflow=${m.overflow} errors=${JSON.stringify(errs)}`)
  flag(m.path === '/checkout', `${lang} ${w}: the checkout page is shown (bag filled client-side)`)
  flag(!!m.button && m.button.expanded === 'false', `${lang} ${w}: one "More address details (optional)" button, closed`)
  flag(!!m.button && m.button.h >= (w < 768 ? 44 : 40), `${lang} ${w}: the button is a full tap target (${m.button && m.button.h}px)`)
  flag(m.visible.some((l) => /floor|الدور|طابق/i.test(l)) && m.visible.some((l) => /flat|apartment|شقة/i.test(l)), `${lang} ${w}: floor and flat are visible with the link closed`)
  flag(m.hiddenNote >= 1, `${lang} ${w}: the delivery note is folded`)
  if (m.button) {
    await p.click('button[aria-expanded="false"]:is(:has-text("More address details"), :has-text("تفاصيل إضافية"))').catch(() => {})
    await p.waitForTimeout(300)
    const open = await p.evaluate(() => [...document.querySelectorAll('form textarea')].some((t) => getComputedStyle(t).display !== 'none' && t.getClientRects().length > 0))
    flag(open, `${lang} ${w}: opening the link shows the delivery note`)
  }
  flag(m.overflow <= 0 && errs.length === 0, `${lang} ${w}: no sideways scroll, no page errors`)
  await ctx.close()
}

{ // /backends: the loader fetches the new full admin file once; no page errors; the sign-in screen renders
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  const errs = []; const reqs = []
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  p.on('response', (r) => { const u = new URL(r.url()); if (/sporta-admin-(brands|knet)/.test(u.pathname)) reqs.push(u.pathname + ' ' + r.status() + ' ' + (r.headers()['content-length'] || '?')) })
  await p.goto(B + '/backends', { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(2500)
  out('== backends ' + JSON.stringify(reqs) + ' errors=' + JSON.stringify(errs))
  flag(reqs.filter((r) => /full\.js 200/.test(r)).length === 1, 'backends: the full admin code is fetched once (200)')
  flag(reqs.some((r) => /sporta-admin-knet\.css 200/.test(r)), 'backends: the admin stylesheet answers 200')
  flag(errs.length === 0, 'backends: no page errors')
  const full = await ctx.request.get(B + '/sporta-admin-brands.full.js?v=probe')
  const body = await full.text()
  flag(full.status() === 200 && /PAYMENTS TRIM/.test(body), `the live full admin file carries the Payments trim block (${body.length} B)`)
  const css = await (await ctx.request.get(B + '/sporta-admin-knet.css?v=probe')).text()
  flag(/repeat\(4, ?minmax\(0, ?1fr\)\)/.test(css), `the live admin stylesheet carries the compact Payments rules (${css.length} B)`)
  await ctx.close()
}
await browser.close()
out(bad ? `PROBE_FAIL ${bad}` : 'PROBE_OK')
