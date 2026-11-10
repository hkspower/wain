// The FRAMES section of public/sporta-images.css, on the live markup:
//   [frm-1] the announcement bar stays one line while its text changes (the live 8px page jump)
//   [frm-2] a real product photograph fills its card frame; the "no photo" plate keeps its pad
//
//   npm run test:images-frames     (no sandbox; ADDON_FILE=<path> runs another file: a blank one must FAIL)
//
// The top bar markup is the live element verbatim (live-topbar-probe.mjs, 2026-11-10) with the two messages the
// live page showed in turn. The live rule that lets the message wrap on a phone was not captured; the fixture
// stands in for it with white-space: normal on the message, which reproduces the measured 36px -> 28px.
// The cards are the product page fixture (live markup, live rules).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, DESC } from './fixtures/product-desc.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-images.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }

const MSG = {
  ar: ['التوصيل خلال ٢٤ ساعة داخل الكويت · ١ د.ك · طرق الدفع تظهر عند إتمام الشراء', 'التوصيل خلال ٢٤ ساعة داخل الكويت · الدفع عند الاستلام'],
  en: ['Delivery within 24 hours in Kuwait · 1 KWD · Payment options at checkout', 'Delivery within 24 hours in Kuwait · Cash on delivery'],
}
const bar = (lang, css) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font:12px/1.25 sans-serif}
.flex{display:flex}.items-center{align-items:center}.gap-2{gap:8px}.overflow-hidden{overflow:hidden}.px-4{padding-inline:16px}.font-bold{font-weight:700}.min-w-0{min-width:0}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.topbar{margin:0;min-height:28px;padding-block:3px;background:#c76a42;color:#171a1e;justify-content:center;text-align:center}
.topbar__dot{flex:0 0 auto;width:.3rem;height:.3rem;border-radius:999px;background:currentColor}
@media (max-width:639px){.topbar .truncate{white-space:normal}}
@media (min-width:640px){.topbar{height:33.7px}}
${css}</style></head><body><header class="app-header sticky top-0"><p class="topbar topbar--tone-brand topbar--align-center flex h-8 items-center gap-2 overflow-hidden px-4 text-[.7rem] font-bold leading-none sm:text-xs" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" role="status"><span class="topbar__dot" aria-hidden="true"></span><span class="min-w-0 truncate">${MSG[lang][0]}</span></p><nav id="nav" style="height:52px"></nav></header></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
for (const lang of ['ar', 'en']) {
  for (const w of [320, 360, 390, 1280]) {
    const run = async (css) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 } }); const p = await ctx.newPage()
      await p.setContent(bar(lang, css))
      const m = () => p.evaluate(() => { const t = document.querySelector('.topbar'); const s = t.lastElementChild; return { h: t.getBoundingClientRect().height, nav: document.getElementById('nav').getBoundingClientRect().top, sw: s.scrollWidth, cw: s.clientWidth, over: document.documentElement.scrollWidth - innerWidth, r: s.getBoundingClientRect().right, l: s.getBoundingClientRect().left } })
      const a = await m()
      await p.evaluate((t) => { document.querySelector('.topbar').lastElementChild.textContent = t }, MSG[lang][1])
      const b = await m(); await ctx.close(); return { a, b }
    }
    const off = await run(''), on = await run(ADDON)
    // at 320px this machine's fallback font is wider than the live one and the saved message itself is borderline, so the two
    // "fits" checks start at 360px (live: 273px of text in 315px)
    if (w >= 360 && w < 640) is(off.a.h > off.b.h + 4, `${lang} ${w}px, add-on off: the bar is taller with the first message and the page jumps (the live defect)`, `${off.a.h} -> ${off.b.h}`)
    is(Math.abs(on.a.nav - on.b.nav) < 0.5 && Math.abs(on.a.h - on.b.h) < 0.5, `${lang} ${w}px: nothing under the bar moves when the saved message replaces the first one`, `nav ${on.a.nav} -> ${on.b.nav}`)
    if (w >= 360) is(on.b.sw <= on.b.cw + 1, `${lang} ${w}px: the saved message is shown whole (no ellipsis)`, `${on.b.sw} in ${on.b.cw}`)
    is(on.a.over <= 0 && on.a.l >= 0 && on.a.r <= w, `${lang} ${w}px: the long message stays inside the bar, no sideways scroll`, `${on.a.l}..${on.a.r}`)
    if (w >= 640) is(Math.abs(on.a.h - off.a.h) < 0.5, `${lang} ${w}px: the desktop bar is the same height as before`, `${off.a.h} -> ${on.a.h}`)
  }
  // ---- [frm-2]
  for (const w of [390, 1280]) {
    const run = async (css) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage()
      await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"/>' }))
      let n = 0
      const html = page(lang, DESC[lang], css).replace(/(<img[^>]*class=\\?"catalog-card-photo[^>]*src=\\?")[^"\\]*/g, (m, a) => (n++ < 1 ? a + '/product-photo-unavailable.svg' : m))
      await p.setContent(html, { waitUntil: 'load' })
      const r = await p.evaluate(() => [...document.querySelectorAll('img.catalog-card-photo')].map((i) => { const c = getComputedStyle(i); const b = i.getBoundingClientRect(); const f = i.closest('.catalog-card-image').getBoundingClientRect(); return { plate: /unavailable/.test(i.src), pad: parseFloat(c.paddingTop), bg: c.backgroundColor, fit: c.objectFit, w: b.width, h: b.height, fw: f.width, fh: f.height, card: i.closest('article').getBoundingClientRect().height } }))
      await ctx.close(); return r
    }
    const off = await run(''), on = await run(ADDON)
    const ph = on.filter((x) => !x.plate), pl = on.filter((x) => x.plate), phOff = off.filter((x) => !x.plate), plOff = off.filter((x) => x.plate)
    is(phOff.length >= 2 && phOff.every((x) => x.pad >= 5), `${lang} ${w}px, add-on off: every photo is padded inside its frame (the live look)`, phOff.map((x) => x.pad).join())
    is(ph.every((x) => x.pad === 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(x.bg)), `${lang} ${w}px: a real photo has no pad and no grey behind it`, ph.map((x) => x.pad + ' ' + x.bg).join(' | '))
    is(ph.every((x) => x.fit === 'contain'), `${lang} ${w}px: a real photo is still contained (never cropped)`)
    is(pl.length === 1 && pl[0].pad === plOff[0].pad && pl[0].bg === plOff[0].bg, `${lang} ${w}px: the "no photo" plate keeps its pad and its grey`, JSON.stringify(pl[0]))
    is(on.every((x, i) => Math.abs(x.fw - off[i].fw) < 0.5 && Math.abs(x.fh - off[i].fh) < 0.5 && Math.abs(x.card - off[i].card) < 0.5), `${lang} ${w}px: frames and cards are the same size (only the photo inside grew)`)
  }
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
