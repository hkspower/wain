// Pages for scripts/shape-1111-test.mjs (the SHAPE-1111 section of public/sporta-shadows.css): the CAPTURED LIVE storefront under the
// LIVE compiled rules, each page openable with the section ON (the repo file) or OFF (the repo file without the section).
//
//   screen/*    scripts/fixtures/sizes-screen   whole rendered pages: home (hero, category tiles, brand bar, product row, features band,
//                                               footer with the payment chips), about (why-cards, FAQ), terms, cart, checkout, bag drawer.
//                                               The capture holds the LIGHT state's rules (the page's dark attributes are set, the few
//                                               dark rules the capture has apply).
//   product/*   scripts/fixtures/sizes-product  the product page (gallery, size chips, quantity, brand plate, related cards, buy bar),
//                                               with both its light and its dark rules
//   shop, tiles, essentials   scripts/fixtures/grid   the /shop catalog section, the home category tiles, the home essentials row
//   contact     scripts/fixtures/register       the Contact page (support cards)
//   account-out, account-in   scripts/fixtures/account   the /account register form and the signed-in profile
//   support, returns, track   scripts/fixtures/shape   the live <main> of /support, /returns and /track (read-only Playwright job on the
//                                               Hostinger VPS, 2026-11-11) in the captured page shell, + the bundle's rules for those
//                                               pages (live-extra.css) + the Returns route stylesheet (returns-route.css)
//   checkout/quick   scripts/fixtures/checkout-a11y.mjs   the returning customer's one-screen checkout (payment options, bag card)
// Nothing is recompiled and no script runs; the add-on files are the repo's, in the order the live index.html links them.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import * as SCR from './sizes-screen-page.mjs'
import * as PRD from './sizes-product-page.mjs'
import { FONT_FACES as FONTS } from '../fixtures/about-page.mjs'
import { page as checkoutPage } from '../fixtures/checkout-a11y.mjs'

export const ROOT = SCR.ROOT
export const FILE = join(ROOT, 'public', 'sporta-shadows.css')
export const MARK = '/* ==== SHAPE-1111'
export const END = '/* ==== end SHAPE-1111 */'
export const ICON_MARK = '/* ==== ICON SET'

// the file without the SHAPE-1111 section (the ICON SET section, which follows it, stays in both states)
export const withoutSection = (css) => {
  const i = css.indexOf(MARK), j = css.indexOf(END)
  if (i < 0 || j < 0) return css
  return css.slice(0, i) + css.slice(j + END.length).replace(/^\n+/, '')
}

const rd = (dir, f) => readFileSync(join(ROOT, 'scripts/fixtures', dir, f), 'utf8')
const tagOf = (s) => (s.match(/^<(\w+)/) || [])[1]

// capture-format pages (a fragment of the live page, its ancestors, and live.css = "/* ---- <sheet> ---- */" blocks in load order):
// the live sporta-shadows block is swapped for the repo's file at the same place, so the cascade order is the live one
const capture = (dir, base, cssFile) => (lang, css) => {
  const meta = JSON.parse(rd(dir, `${base}-${lang}.json`))
  const live = rd(dir, cssFile).split(/(?=\/\* ---- )/).map((b) => (/^\/\* ---- \/sporta-shadows\.css/.test(b) ? '/* ---- repo sporta-shadows.css ---- */\n' + css + '\n' : b)).join('')
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FONTS}</style><style>${live}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px"></div>${rd(dir, `${base}-${lang}.html`)}${[...meta.chain].reverse().map((c) => `</${tagOf(c)}>`).join('')}</body></html>`
}

export const CAP = {
  shop: capture('grid', 'shop-out', 'shop-live.css'),
  tiles: capture('grid', 'tiles-home-out', 'tiles-live.css'),
  essentials: capture('grid', 'essentials-home-out', 'essentials-live.css'),
  contact: capture('register', 'contact-out', 'live.css'),
  'account-out': capture('account', 'account-out', 'live.css'),
  'account-in': capture('account', 'account-in', 'live.css'),
}
// /support, /returns and /track: the live <main> of each (scripts/fixtures/shape/<page>-<lang>.html, read-only Playwright job on the VPS,
// 2026-11-11) in the captured page shell (header, footer, bag: the terms page of scripts/fixtures/sizes-screen), under the sizes-screen
// live rules + live-extra.css (the bundle's rules for those pages) + the add-ons in the live order, then - for /returns only - the route
// stylesheet Returns-DHmag5QD.css, which Vite appends AFTER the add-ons when the route loads (so it wins every tie, like live).
export const SHP = ['support', 'returns', 'track']
const FXS = join(ROOT, 'scripts/fixtures/sizes-screen'), FXH = join(ROOT, 'scripts/fixtures/shape')
const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
const SHELL = { head: readFileSync(join(FXS, 'head.css'), 'utf8'), live: readFileSync(join(FXS, 'live.css'), 'utf8'), features: readFileSync(join(FXS, 'features.css'), 'utf8'), extra: readFileSync(join(FXH, 'live-extra.css'), 'utf8'), route: readFileSync(join(FXH, 'returns-route.css'), 'utf8') }
export const shpPage = (name, lang, addons) => {
  const raw = readFileSync(join(FXS, `terms-${lang}.html`), 'utf8')
  const html = JSON.parse(raw.match(/^<!-- html: (.*) -->$/m)[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  const main = readFileSync(join(FXH, `${name}-${lang}.html`), 'utf8').split('\n').filter((l) => !/^<!-- fragment/.test(l)).join('\n').trim()
  const markup = raw.split('\n').filter((l) => !/^<!-- (html|body): /.test(l)).join('\n').replace(/<main[\s\S]*<\/main>/, () => main)
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${SHELL.head}</style><style id="fx-live">${SHELL.live}\n${SHELL.extra}</style>${SCR.ADDON_ORDER.map((f) => `<style data-addon="${f}">${addons[f]}</style>`).join('')}${name === 'returns' ? `<style id="fx-route">${SHELL.route}</style>` : ''}<style id="fx-features">${SHELL.features}</style></head><body${attrs(body)}>${markup}</body></html>`
}

export const PAGES = [
  ...['home', 'about', 'terms', 'cart', 'checkout', 'drawer'].map((n) => ({ id: `screen/${n}`, kind: 'scr', n })),
  ...['full', 'full-sold', 'one'].map((n) => ({ id: `product/${n}`, kind: 'prd', n })),
  ...Object.keys(CAP).map((n) => ({ id: n, kind: 'cap', n })),
  ...SHP.map((n) => ({ id: n, kind: 'shp', n })),
  // the returning customer's one-screen checkout (payment options with their badges, bag card): the exact markup dumped from the live
  // checkout 2026-11-03 with the live rules (scripts/fixtures/checkout-a11y.mjs), under the repo's add-ons in the live order
  { id: 'checkout/quick', kind: 'chk', n: 'quick' },
]

const withShadows = (files, css) => ({ ...files, 'sporta-shadows.css': css })

// a tiny server for the /support, /returns and /track pages (assets from public/: the real fonts and category photos)
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const serveShp = (ref) => new Promise((res) => {
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__fx\/(\w+)-(ar|en)$/)
    if (m) { r.writeHead(200, { 'content-type': MIME.html }); return r.end(shpPage(m[1], m[2], ref.current)) }
    const f = join(ROOT, 'public') + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG1)
  }).listen(0, '127.0.0.1', () => res({ server: srv, base: 'http://127.0.0.1:' + srv.address().port }))
})

export async function start(browser) {
  const scrRef = { current: null }, prdRef = { current: null }, shpRef = { current: null }
  const scr = await SCR.serve(scrRef), prd = await PRD.serve(prdRef), shp = await serveShp(shpRef)
  const SCR_ADDONS = SCR.addonFiles(), PRD_ADDONS = PRD.addonFiles()
  // opts: theme 'light' | 'dark', dpr, h (viewport height)
  async function open(pg, lang, w, css, opts = {}) {
    const { theme = 'light', dpr = 1, h = 900 } = opts
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: theme === 'dark' ? 'dark' : 'light' })
    // nothing leaves the machine: the captured pages name www.sporta.com.kw absolutely in a few places (links, structured data)
    await ctx.route((u) => !/^(http:\/\/(127\.0\.0\.1|fx\.test)[:/]|http:\/\/fx\.test$|data:|about:|blob:)/.test(u.href), (r) => r.abort())
    const p = await ctx.newPage()
    if (pg.kind === 'scr') { scrRef.current = withShadows(SCR_ADDONS, css); await p.goto(`${scr.base}/__fx/${pg.n}-${lang}`) }
    else if (pg.kind === 'shp') { shpRef.current = withShadows(SCR_ADDONS, css); await p.goto(`${shp.base}/__fx/${pg.n}-${lang}`) }
    else if (pg.kind === 'prd') { prdRef.current = withShadows(PRD_ADDONS, css); await p.goto(`${prd.base}/__fx/${pg.n}-${lang}-${w}${theme === 'dark' ? '-dark' : ''}`) }
    else {
      const html = pg.kind === 'chk' ? checkoutPage(lang, SCR.ADDON_ORDER.map((f) => (f === 'sporta-shadows.css' ? css : SCR_ADDONS[f])).join('\n'), { state: pg.n }) : CAP[pg.n](lang, css)
      await p.route('http://fx.test/**', async (r) => {
        const u = new URL(r.request().url())
        if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
        const f = join(ROOT, 'public', decodeURIComponent(u.pathname))
        if (u.pathname.startsWith('/fonts/') && existsSync(f)) return r.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(f) })
        return r.fulfill({ status: 404, body: '' })
      })
      await p.goto('http://fx.test/')
    }
    // the pages that carry only their light state: switch the way boot.js does (the live rules for the dark state are in each live.css)
    if (theme === 'dark' && pg.kind !== 'prd') await p.evaluate(() => { const r = document.documentElement; r.setAttribute('data-theme', 'dark'); r.classList.add('dark'); r.style.colorScheme = 'dark' })
    await p.evaluate(() => document.fonts.ready)
    await p.waitForTimeout(60)
    return { p, ctx }
  }
  return { open, close: () => { scr.server.close(); prd.server.close(); shp.server.close() } }
}
