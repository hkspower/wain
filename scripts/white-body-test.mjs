/**
 * The page body is white; the header, the footer and the dark islands stay dark. 2026-10-01.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/white-body-test.mjs
 *
 * Asked for as "make main website body background is white color"; the owner chose "page body
 * only, header and footer stay dark". 65-white-body.css does it by redefining the --sp theme
 * variables inside `main`, so nothing else is rewritten — which means the way it breaks is a
 * variable that something does not read, and that shows as dark ink on a dark patch or white
 * ink on white. test:site-contrast measures every readable pair; this asserts the DESIGN:
 *   - the <body> is white, and `main` text is dark ink, on six pages, both languages, phone and
 *     desktop;
 *   - the header and the footer are still dark with light text;
 *   - the hero is still a dark photograph, and the page title is dark ink on the body;
 *   - the product page's sticky buy bar and the home page's promo panel stay dark with light
 *     text (the "dark islands" — they carry white text and a white logo);
 * Mutation: delete the rule that makes `main` light (body white, text dark) and it fails by name.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const lum = (css) => {
  const n = String(css).match(/-?\d*\.?\d+/g).map(Number)
  const [r, g, b] = n.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const dark = (c) => lum(c) < 0.06
const light = (c) => lum(c) > 0.6

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium' })
const PAGES = ['/', '/shop', '/product/cheetahs-rugby-t-shirt', '/cart', '/about', '/returns']

for (const [name, ctxOpts] of [['phone', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext(ctxOpts)
    const page = await ctx.newPage()
    for (const path of PAGES) {
      await page.goto(`${BASE}${path}${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      const m = await page.evaluate(() => {
        const cs = (e) => (e ? getComputedStyle(e) : null)
        const header = document.querySelector('header.app-header')
        const footer = document.querySelector('footer')
        const main = document.querySelector('main')
        const h1 = [...document.querySelectorAll('main h1')].find((h) => !h.classList.contains('display-title') && h.getBoundingClientRect().width > 0)
        return {
          body: cs(document.body).backgroundColor,
          main: cs(main)?.color,
          header: cs(header)?.backgroundColor,
          headerText: cs(header)?.color,
          footer: cs(footer)?.backgroundColor,
          h1: h1 ? cs(h1).color : null,
        }
      })
      const tag = `${name} ${lang} ${path}`
      check(m.body === 'rgb(255, 255, 255)', `${tag}: the body is white`, m.body)
      check(dark(m.main) && !light(m.main), `${tag}: text in the body is dark ink`, m.main)
      check(dark(m.header) && light(m.headerText), `${tag}: the header is still dark with light text`, `${m.header} / ${m.headerText}`)
      check(!m.footer || dark(m.footer), `${tag}: the footer is still dark`, m.footer)
      if (path !== '/' && path !== '/shop' && m.h1) check(dark(m.h1), `${tag}: the page title is dark ink`, m.h1)
    }

    // the dark islands and the hero
    await page.goto(`${BASE}/product/cheetahs-rugby-t-shirt${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const prod = await page.evaluate(() => {
      const bar = document.querySelector('.action-bar')
      const strip = document.querySelector("main div:has(> picture > img[src*='logo-white'])")
      const vis = (e) => e && e.getBoundingClientRect().width > 0
      return {
        bar: vis(bar) ? [getComputedStyle(bar).backgroundColor, getComputedStyle(bar.querySelector('span, p, div') || bar).color] : null,
        strip: strip ? getComputedStyle(strip).backgroundColor : null,
      }
    })
    if (name === 'phone') check(prod.bar && dark(prod.bar[0]) && !dark(prod.bar[1]), `${name} ${lang}: the sticky buy bar is dark with light text`, JSON.stringify(prod.bar))
    check(!prod.strip || dark(prod.strip), `${name} ${lang}: the logo strip under the product is dark (its logo is white)`, prod.strip)

    await page.goto(`${BASE}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const home = await page.evaluate(() => {
      const hero = document.querySelector('main section.group')
      const panel = document.querySelector('main .bg-ink-silver')
      const t = panel && panel.querySelector('p, h3, span')
      return { hero: hero ? getComputedStyle(hero).backgroundColor : null, panel: panel ? getComputedStyle(panel).backgroundColor : null, panelText: t ? getComputedStyle(t).color : null }
    })
    check(home.hero && dark(home.hero), `${name} ${lang}: the hero is still a dark photograph`, home.hero)
    check(home.panel && dark(home.panel) && !dark(home.panelText), `${name} ${lang}: the promo panel is dark with light text`, `${home.panel} / ${home.panelText}`)
    await ctx.close()
  }
}

// there is no light mode to check: the boot script pins sporta_theme to dark (one mode, 2026-09-20)

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nall ok — a white body between a dark header and a dark footer, with the dark islands kept')
process.exit(fails ? 1 : 0)
