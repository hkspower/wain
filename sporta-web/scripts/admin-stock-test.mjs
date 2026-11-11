// The STOCK section of addons-src/sporta-admin-knet.css: the controls of the stock cards, the search clear and the entry drawer's
// Close at a finger's size on a phone and a touch tablet, unchanged with a mouse.
//
//   npm run test:admin-stock       (no sandbox; ADDON_FILE=<path> runs another add-on file - the one without the section must FAIL)
//
// THE PAGE: the real compiled rules for these controls (scripts/fixtures/stock-live-rules.css, from the live AdminApp stylesheet) under
// the add-on, on markup built from those rules' own structure (.stock-control > .stock-state + .stock-stepper > button, .stock-input,
// button). No capture of the live cards exists - /backends needs an admin sign-in, which a probe must not do - so the markup is the
// minimal one the live CSS describes, and the test measures sizes and hit areas, not looks.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'addons-src/sporta-admin-knet.css'), 'utf8')
const LIVE = readFileSync(join(ROOT, 'scripts/fixtures/stock-live-rules.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const card = (n) => `<article class="m-row inventory-card"><div class="inventory-card__stock"><span class="stock-state">In stock</span><div class="stock-control"><span class="stock-stepper"><button type="button" aria-label="Less">-</button><input class="stock-input" type="number" value="${n}" aria-label="Quantity"><button type="button" aria-label="More">+</button></span></div></div></article>`
const page = (lang, css) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:16px/1.4 sans-serif;--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b}input,button{font:inherit}${LIVE}${css}</style></head><body><div class="admin-shell"><div class="admin-content"><section style="padding:1rem .75rem"><label class="inventory-search"><input value="x"><button type="button" class="inventory-search-clear" aria-label="Clear">x</button></label>${card(12)}${card(3)}<div class="inventory-drawer"><button type="button" class="inventory-drawer__close" aria-label="Close">x</button></div></section></div></div></body></html>`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const measure = async (lang, w, coarse, css) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: coarse, isMobile: false }); const p = await ctx.newPage()
  if (coarse) await p.emulateMedia({}) // pointer type below is forced through the media rule probe
  await p.setContent(page(lang, css))
  const m = await p.evaluate(() => {
    const r = (e) => { const q = e.getBoundingClientRect(); return { w: q.width, h: q.height, l: q.left, r: q.right, t: q.top, b: q.bottom } }
    const btns = [...document.querySelectorAll('.stock-stepper button')].map(r), inputs = [...document.querySelectorAll('.stock-input')].map(r)
    const clear = document.querySelector('.inventory-search-clear'), cr = r(clear), box = r(document.querySelector('.inventory-search'))
    const hit = (x, y) => document.elementFromPoint(x, y)
    const cx = (cr.l + cr.r) / 2, cy = (cr.t + cr.b) / 2
    return { btns, inputs, clear: cr, box, clearUp: hit(cx, cr.t - 8) === clear, clearDn: hit(cx, cr.b + 8) === clear, close: r(document.querySelector('.inventory-drawer__close')), stepper: r(document.querySelector('.stock-stepper')), card: r(document.querySelector('.inventory-card')), ov: document.documentElement.scrollWidth - innerWidth }
  })
  await ctx.close(); return m
}
// a touch tablet is a coarse pointer; Chromium reports (any-pointer: coarse) when touch is enabled in the context
for (const lang of ['ar', 'en']) {
  for (const [w, coarse, label] of [[390, true, 'phone'], [360, true, 'small phone'], [521, true, 'phone landscape'], [768, true, 'touch tablet'], [1023, true, 'touch tablet, widest']]) {
    const off = await measure(lang, w, coarse, ''), on = await measure(lang, w, coarse, ADDON)
    is(on.btns.every((b) => b.w >= 43.9 && b.h >= 43.9) && on.inputs.every((i) => i.h >= 43.9), `${lang} ${w}px ${label}: both stepper buttons and the quantity box are 44px or more`, `buttons ${on.btns.map((b) => Math.round(b.w) + 'x' + Math.round(b.h)).join(' ')} box h ${on.inputs.map((i) => Math.round(i.h)).join(',')}`)
    is(off.btns.some((b) => b.w < 43.9 || b.h < 43.9), `${lang} ${w}px ${label}: add-on off, they were under 44px (the live defect)`, off.btns.map((b) => Math.round(b.w) + 'x' + Math.round(b.h)).join(' '))
    is(on.clearUp && on.clearDn, `${lang} ${w}px ${label}: the search clear answers a touch 8px above and below it`, `${on.clearUp}/${on.clearDn}`)
    is(Math.abs(on.clear.w - off.clear.w) < 0.5 && Math.abs(on.clear.h - off.clear.h) < 0.5, `${lang} ${w}px ${label}: the clear button looks the same size`, `${off.clear.w}x${off.clear.h} -> ${on.clear.w}x${on.clear.h}`)
    is(on.close.w >= 43.9 && on.close.h >= 43.9, `${lang} ${w}px ${label}: the drawer Close is 44px`, `${on.close.w}x${on.close.h}`)
    is(on.ov <= 0 && on.stepper.r <= w + 0.5 && on.stepper.l >= -0.5, `${lang} ${w}px ${label}: no sideways scroll, the stepper stays inside the window`, `overflow ${on.ov}, stepper ${Math.round(on.stepper.l)}..${Math.round(on.stepper.r)}`)
  }
  // a mouse screen, and a desktop: nothing changes
  for (const [w, label] of [[768, 'mouse tablet'], [1023, 'mouse, widest card layout'], [1280, 'desktop']]) {
    const off = await measure(lang, w, false, ''), on = await measure(lang, w, false, ADDON)
    const same = on.btns.every((b, i) => Math.abs(b.w - off.btns[i].w) < 0.5 && Math.abs(b.h - off.btns[i].h) < 0.5) && Math.abs(on.close.w - off.close.w) < 0.5 && Math.abs(on.card.h - off.card.h) < 0.5 && !on.clearUp
    if (w === 768 || w === 1023 || w === 1280) is(same, `${lang} ${w}px ${label}: nothing changes with a mouse`, `btn ${off.btns[0].w}x${off.btns[0].h} -> ${on.btns[0].w}x${on.btns[0].h}`)
  }
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
