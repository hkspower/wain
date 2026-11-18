// CARDS-1118 of public/sporta-shadows.css (owner, 2026-11-18: "scan cards then improve design"; scan: CARDS-SCAN-2026-11-18.md):
//   [cards-1] the quick-add "+" of a product card is the logo orange with no grey rim (its border takes the fill's colour), the
//             "in your bag" state (.bg-brand) keeps its own border;
//   [cards-2] the 01-04 index of the about page's why-cards is a 2rem disc in the logo orange with the near-black figure.
// On the captured live markup of the about page (scripts/fixtures/sizes-screen) with the live stylesheet, ar + en, 390 and 1280 px;
// the quick-add button is the bundle's own rule (copied from the compiled stylesheet) on a stub. The same file with the section cut
// out is the "before" of every comparison, so only this section differs.
//   npm run test:cards-1118        (ADDON_FILE=<path> runs another file; the section removed must FAIL)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FX = join(ROOT, 'scripts/fixtures/sizes-screen/')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const BASE = ADDON.replace(/\/\* ==== CARDS-1118[\s\S]*?\/\* ==== end CARDS-1118 \*\/\n?/, '')
const LIVE = readFileSync(FX + 'live.css', 'utf8'), HEAD = readFileSync(FX + 'head.css', 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const page = (lang, css) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${HEAD}${LIVE}${css}</style></head><body>${readFileSync(FX + `about-${lang}.html`, 'utf8')}</body></html>`
const STUB = `.catalog-card-save,.catalog-card-add{border:1px solid #171a1e1f;border-radius:.625rem}.catalog-card-add{background:#ff7b17;color:#171a1e;border-color:#171a1e1f}.catalog-card-add.bg-brand{background:#b34d00;border-color:#b34d00;color:#fff}`
const stub = (css) => `<!doctype html><html><head><style>${STUB}${css}</style></head><body><div class="storefront-root"><button class="catalog-card-add" id="a" style="width:44px;height:44px">+</button><button class="catalog-card-add bg-brand" id="b" style="width:44px;height:44px">v</button></div></body></html>`
const lumOf = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const nums = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
  const run = async (css) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage()
    await p.setContent(page(lang, css)); await p.waitForTimeout(100)
    const r = await p.evaluate(() => [...document.querySelectorAll('.why-card-index')].map((el) => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(el); const t = rg.getBoundingClientRect(); const card = el.closest('.why-card').getBoundingClientRect(); return { disp: cs.display, w: b.width, h: b.height, rad: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color, dx: Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2), dy: Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2), inside: b.left >= card.left && b.right <= card.right, over: document.documentElement.scrollWidth - innerWidth, text: el.textContent.trim() } }))
    await ctx.close(); return r
  }
  const off = await run(BASE), on = await run(ADDON)
  const tag = `${lang} ${w}px`
  is(on.length === 4 && on.every((x) => x.bg === 'rgb(255, 123, 23)' && x.disp === 'inline-grid' && Math.abs(x.w - x.h) < 0.5 && x.w >= 30 && x.rad !== '0px'), `${tag}: the four indices 01-04 are round discs in the logo orange (${on.map((x) => x.w.toFixed(0)).join('/')}px)`, JSON.stringify(on[0]))
  is(on.every((x) => nums(x.color).join() === '23,26,30' && (lumOf([255, 123, 23]) + 0.05) / (lumOf([23, 26, 30]) + 0.05) >= 6.5), `${tag}: the figures are near-black on the orange (6.73:1)`, on[0] && on[0].color)
  is(on.every((x) => x.dx <= 1.5 && x.dy <= 2 && x.inside), `${tag}: the figure sits on the middle of its disc and the disc stays inside its card`, JSON.stringify(on.map((x) => [x.dx.toFixed(1), x.dy.toFixed(1)])))
  is(off.every((x) => x.bg === 'rgba(0, 0, 0, 0)') && on.every((x) => x.over <= 0), `${tag}: without the section the indices are bare numbers (the state this changes); with it no sideways scroll`, off[0] && off[0].bg)
}
{
  const get = async (css) => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.setContent(stub(css)); const r = await p.evaluate(() => ({ a: getComputedStyle(document.getElementById('a')).borderTopColor, b: getComputedStyle(document.getElementById('b')).borderTopColor })); await ctx.close(); return r }
  const off = await get(BASE), on = await get(ADDON)
  is(off.a !== 'rgb(255, 123, 23)' && on.a === 'rgba(0, 0, 0, 0)', 'the quick-add "+" has no grey rim with the section (it had one without it)', `${off.a} -> ${on.a}`)
  is(on.b === 'rgb(179, 77, 0)' && off.b === on.b, 'the "in your bag" state keeps its own border', `${off.b} -> ${on.b}`)
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
