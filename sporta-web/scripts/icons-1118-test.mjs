// ICONS-1118 of public/sporta-shadows.css (owner, 2026-11-18: "scan all icons"; scan: ICONS-SCAN-2026-11-18.md): the icons that sit
// beside a text label and took the bundle's .text-brand (the product page's reassurance rows, the footer's Cash on delivery chip)
// are the logo orange exactly, not the dark text step. On the captured markup (scripts/fixtures), ar + en; the same file with the
// section cut out is the "before". The dark theme keeps its own colour.
//   npm run test:icons-1118        (ADDON_FILE=<path> runs another file; the section removed must FAIL)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FX = join(ROOT, 'scripts/fixtures/')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const BASE = ADDON.replace(/\/\* ==== ICONS-1118[\s\S]*?\/\* ==== end ICONS-1118 \*\/\n?/, '')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const SEL = { product: '.catalog-product-reassurance li > svg.sporta-icon', footer: '.footer-payment > svg.sporta-icon', brand: 'svg.sporta-icon.text-brand' }
const get = async (dir, file, lang, css, dark = false) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p = await ctx.newPage()
  const live = readFileSync(FX + dir + '/live.css', 'utf8') + readFileSync(FX + dir + '/head.css', 'utf8')
  await p.setContent(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"${dark ? ' data-theme="dark"' : ' data-theme="light"'}><head><style>${live}${css}</style></head><body>${readFileSync(FX + `${dir}/${file}-${lang}.html`, 'utf8')}</body></html>`)
  const r = await p.evaluate((S) => Object.fromEntries(Object.entries(S).map(([k, s]) => [k, [...document.querySelectorAll(s)].map((e) => getComputedStyle(e).color)])), SEL)
  await ctx.close(); return r
}
for (const lang of ['ar', 'en']) {
  const f1 = await get('sizes-screen', 'about', lang, ADDON), f0 = await get('sizes-screen', 'about', lang, BASE)
  is(f1.footer.length >= 1 && f1.footer.every((c) => c === 'rgb(255, 123, 23)'), `${lang}: the footer's Cash on delivery icon is the logo orange`, JSON.stringify(f1.footer))
  is(f0.footer.some((c) => c !== 'rgb(255, 123, 23)'), `${lang}: ...and was not without the section`, JSON.stringify(f0.footer))
}
// the product page's reassurance rows, on the real compiled client (the capture is not in the repo: SPORTA_LIVE_CAPTURE)
if (!liveDir()) console.log('skip the product page (no live capture: set SPORTA_LIVE_CAPTURE)')
else for (const lang of ['ar', 'en']) for (const dark of [false, true]) {
  const read = async (css) => {
    const srv = await serveLive({ css: css ? { 'sporta-shadows.css': css } : {} })
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p = await ctx.newPage()
    if (dark) await p.addInitScript(() => { try { localStorage.setItem('sporta_theme', 'dark') } catch (e) {} })
    await p.goto(`${srv.base}/product/flash-shorts-green?lang=${lang}`, { waitUntil: 'load' }); await p.waitForSelector('.catalog-product-reassurance svg', { timeout: 60000 }); await p.waitForTimeout(800)
    const r = await p.evaluate(() => [...document.querySelectorAll('.catalog-product-reassurance li > svg')].map((e) => getComputedStyle(e).color))
    await ctx.close(); await srv.close(); return r
  }
  const on = await read(null), off = await read(BASE)
  if (!dark) {
    is(on.length >= 3 && on.every((c) => c === 'rgb(255, 123, 23)'), `${lang}: the product page's ${on.length} reassurance icons are the logo orange`, JSON.stringify(on))
    is(off.some((c) => c !== 'rgb(255, 123, 23)'), `${lang}: ...and were the dark step without the section`, JSON.stringify(off))
  } else is(JSON.stringify(on) === JSON.stringify(off), `${lang}: the dark theme is untouched by the section`, `${JSON.stringify(off)} -> ${JSON.stringify(on)}`)
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
