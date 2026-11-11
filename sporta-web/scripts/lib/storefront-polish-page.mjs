// Page opener shared by storefront-polish-test.mjs (and handy for screenshots): every storefront fixture the repo holds,
// under the LIVE compiled rules and the repo's add-on stylesheets, with public/sporta-shadows.css replaceable so a test
// can run the same page with a section ON and OFF (the file without it).
//   scr  scripts/fixtures/sizes-screen   home, about, terms, cart, checkout, drawer
//   prd  scripts/fixtures/sizes-product  the product page (scenarios full, one, two, three ...)
//   cap  scripts/fixtures/grid|register|account  /shop cards, home tiles, home essentials, contact, account (signed out / in)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as SCR from './sizes-screen-page.mjs'
import * as PRD from './sizes-product-page.mjs'

export const ROOT = SCR.ROOT
export const CSS_FILE = join(ROOT, 'public/sporta-shadows.css')

const capture = (dir, base, cssFile) => (lang, css) => {
  const rd = (f) => readFileSync(join(ROOT, 'scripts/fixtures', dir, f), 'utf8')
  const meta = JSON.parse(rd(`${base}-${lang}.json`))
  // live.css is the CSSOM dump in load order, one "/* ---- <file> ---- */" block per sheet; the live shadows block is swapped for ours
  const live = rd(cssFile).split(/(?=\/\* ---- )/).map((b) => /^\/\* ---- \/sporta-shadows\.css/.test(b) ? '/* ---- repo sporta-shadows.css ---- */\n' + css + '\n' : b).join('')
  const tag = (s) => (s.match(/^<(\w+)/) || [])[1]
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${live}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px"></div>${rd(`${base}-${lang}.html`)}${[...meta.chain].reverse().map((c) => `</${tag(c)}>`).join('')}</body></html>`
}
export const CAP = {
  shop: capture('grid', 'shop-out', 'shop-live.css'),
  tiles: capture('grid', 'tiles-home-out', 'tiles-live.css'),
  essentials: capture('grid', 'essentials-home-out', 'essentials-live.css'),
  contact: capture('register', 'contact-out', 'live.css'),
  'account-out': capture('account', 'account-out', 'live.css'),
  'account-in': capture('account', 'account-in', 'live.css'),
}
export const SCREENS = ['home', 'about', 'terms', 'cart', 'checkout', 'drawer']
export const PRODUCTS = ['full', 'one', 'two', 'three']

export async function rig(browser) {
  const scrRef = { current: null }, prdRef = { current: null }
  const scr = await SCR.serve(scrRef), prd = await PRD.serve(prdRef)
  const SA = SCR.addonFiles(), PA = PRD.addonFiles()
  const withCss = (files, css) => ({ ...files, 'sporta-shadows.css': css })
  // pg = { kind: 'scr'|'prd'|'cap', n: name }; css = the full sporta-shadows.css to use
  async function open(pg, lang, w, css, h = 900) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    if (pg.kind === 'scr') { scrRef.current = withCss(SA, css); await p.goto(`${scr.base}/__fx/${pg.n}-${lang}`) }
    else if (pg.kind === 'prd') { prdRef.current = withCss(PA, css); await p.goto(`${prd.base}/__fx/${pg.n}-${lang}-${w}`) }
    else {
      const html = CAP[pg.n](lang, css)
      await p.route('http://fx.test/**', (r) => new URL(r.request().url()).pathname === '/' ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.fulfill({ status: 404, body: '' }))
      await p.goto('http://fx.test/')
    }
    await p.evaluate(() => document.fonts.ready)
    await p.waitForTimeout(50)
    return { p, ctx }
  }
  const close = () => { scr.server.close(); prd.server.close() }
  return { open, close }
}
export const ALL_PAGES = [
  ...SCREENS.map((n) => ({ id: `screen/${n}`, kind: 'scr', n })),
  ...PRODUCTS.map((n) => ({ id: `product/${n}`, kind: 'prd', n })),
  ...Object.keys(CAP).map((n) => ({ id: n, kind: 'cap', n })),
]
