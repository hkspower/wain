// Regenerates scripts/fixtures/sizes-screen/ - the fixtures behind `npm run test:sizes-screen` - from a CAPTURE of the
// live storefront build (index.html, assets/, api/*.json saved from https://www.sporta.com.kw). Not needed to RUN the
// suite (the fixtures are committed); needed only to refresh them when the live build changes:
//
//   SIZES_LIVE_DIR=/path/to/capture node scripts/make-sizes-fixtures.mjs
//
// What it does, so the suite measures the LIVE markup under the LIVE rules and not a reconstruction:
//   1. serves the capture on a random local port (static files from the capture, then public/ for the fonts and the
//      add-on scripts; /api/api.php?r=<name> from api/<name>.json; every image that is not on disk is a 1x1 PNG),
//   2. opens the real compiled app in headless Chromium (390px wide; the rendered DOM is the same at every width, which
//      the generator asserts for the home page) for the pages the suite measures, in Arabic and English:
//        home (/), about (/about), terms (/terms), cart (/cart, two lines in the bag), checkout (/checkout, same bag),
//        drawer (/ with the bag drawer open),
//   3. saves each page's <html> attributes and #root markup (after the add-on scripts have run, so the features band,
//      the footer call button and the clock are in it) as <page>-<lang>.html,
//   4. dumps from the page's CSSOM every rule of the live compiled stylesheet (index-*.css) that matches an element of any
//      of those pages (pseudo-elements and pseudo-states stripped before matching, so ::before rules and :focus-visible
//      rules come along), in source order, with its @media / @supports / @layer wrappers, plus the @font-face rules and the
//      @layer order statement. That is live.css; head.css is the inline <style> of index.html and features.css the <style>
//      the add-on script injects (sporta-features-css).
// The Tailwind utilities are in live.css because they are in the live build; nothing is recompiled.
//
// The cart for /cart, /checkout and the drawer is two lines written to localStorage('sporta_cart') (the key the app
// reads); nothing is submitted, no order, no sign-in, no POST. The pages never leave the local server.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.SIZES_LIVE_DIR
if (!LIVE || !existsSync(join(LIVE, 'index.html'))) { console.error('Set SIZES_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/).'); process.exit(2) }
const OUT = join(ROOT, 'scripts/fixtures/sizes-screen')
const PUB = join(ROOT, 'public')
mkdirSync(OUT, { recursive: true })

const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const server = await new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    if (u.pathname === '/api/api.php') {
      const k = u.searchParams.get('r'), f = join(LIVE, 'api', k + '.json')
      if (k === 'slide_image') { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
      if (existsSync(f)) { r.writeHead(200, { 'content-type': MIME.json }); return r.end(readFileSync(f)) }
      r.writeHead(404, { 'content-type': MIME.json }); return r.end('{"error":"not_found"}')
    }
    for (const root of [PUB, LIVE]) { const f = root + decodeURIComponent(u.pathname); if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) } }
    if (/\.(jpe?g|png|webp)$/.test(u.pathname)) { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
    if (/\.\w+$/.test(u.pathname)) { r.writeHead(404); return r.end('nf') }
    r.writeHead(200, { 'content-type': MIME.html }); r.end(readFileSync(join(LIVE, 'index.html')))
  }).listen(0, '127.0.0.1', () => res(s))
})
const BASE = 'http://127.0.0.1:' + server.address().port

const CART = [
  { key: 'vanquish-t-shirt-navy-blue__M__-', slug: 'vanquish-t-shirt-navy-blue', size: 'M', fit: null, name: { en: 'Vanquish T-Shirt Navy Blue', ar: 'تيشيرت فانكويش كحلي' }, price: 8, image: null, qty: 1 },
  { key: 'cloudsoft-leggings-grey__L__-', slug: 'cloudsoft-leggings-grey', size: 'L', fit: null, name: { en: 'Cloudsoft Leggings Grey', ar: 'ليقنز كلاودسوفت رمادي' }, price: 10, image: null, qty: 2 },
]
const PAGES = [['home', '/'], ['about', '/about'], ['terms', '/terms'], ['cart', '/cart'], ['checkout', '/checkout'], ['drawer', '/']]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const open = async (lang, path, w = 390) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await ctx.addInitScript((c) => { try { localStorage.setItem('sporta_cart', c) } catch {} }, JSON.stringify(CART))
  const pg = await ctx.newPage()
  await pg.goto(BASE + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' })
  await pg.waitForTimeout(900)
  return pg
}

// the rendered DOM must not depend on the width (the suite re-uses one capture for 320-1280px); the clock's animation
// phase and hand angles are the only things allowed to differ, so they are blanked before comparing.
const rootHtml = (pg) => pg.evaluate(() => { const c = document.querySelector('#root').cloneNode(true); for (const e of c.querySelectorAll('.clock')) e.removeAttribute('style'); return c.innerHTML.replace(/\s+/g, ' ').replace(/rotate\([\d. -]+\)/g, 'rotate()') })
{
  const a = await open('ar', '/', 390), b = await open('ar', '/', 1280)
  const [x, y] = [await rootHtml(a), await rootHtml(b)]
  if (x !== y) { let i = 0; while (x[i] === y[i]) i++; console.error('NOTE: the home DOM differs between 390 and 1280 at', i, JSON.stringify(x.slice(i - 40, i + 60)), '|', JSON.stringify(y.slice(i - 40, i + 60))) }
  else console.log('ok   the home DOM is identical at 390 and 1280')
  await a.context().close(); await b.context().close()
}

// ---- per-page capture ---------------------------------------------------------------------------------------
const matchedFns = () => {
  // returns the index paths of the rules of the live bundle that match something on THIS page
  const sheet = [...document.styleSheets].find((s) => /\/assets\/index-[\w-]+\.css/.test(s.href || ''))
  const STRIP = /::?(?:before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/g
  const hit = (sel) => {
    for (let part of sel.split(/,(?![^(]*\))/)) {
      part = part.replace(STRIP, '').trim()
      if (!part || /[>+~]$/.test(part)) part += '*'
      try { if (document.querySelector(part)) return true } catch {}
    }
    return false
  }
  const out = []
  const walk = (rules, path) => [...rules].forEach((r, i) => {
    const p = path.concat(i)
    if (r.selectorText !== undefined) { if (hit(r.selectorText)) out.push(p.join('/')) }
    else if (r.cssRules) walk(r.cssRules, p)
  })
  walk(sheet.cssRules, [])
  return out
}
const serializeFn = (keep) => {
  const sheet = [...document.styleSheets].find((s) => /\/assets\/index-[\w-]+\.css/.test(s.href || ''))
  const set = new Set(keep)
  const any = (path) => keep.some((k) => k === path || k.startsWith(path + '/'))
  const txt = (rules, path) => {
    let s = ''
    ;[...rules].forEach((r, i) => {
      const p = path.concat(i).join('/')
      if (r.selectorText !== undefined) { if (set.has(p)) s += r.cssText + '\n' }
      else if (r instanceof CSSFontFaceRule || r instanceof CSSPropertyRule) s += r.cssText + '\n'
      else if (r instanceof CSSLayerStatementRule) s += r.cssText + '\n'
      else if (r instanceof CSSKeyframesRule) { /* animations do not change sizes */ }
      else if (r.cssRules && any(p)) {
        const head = r instanceof CSSMediaRule ? '@media ' + r.media.mediaText : r instanceof CSSSupportsRule ? '@supports ' + r.conditionText : r instanceof CSSLayerBlockRule ? '@layer ' + r.name : r instanceof CSSContainerRule ? '@container ' + r.conditionText : null
        if (head) s += head + ' {\n' + txt(r.cssRules, path.concat(i)) + '}\n'
      }
    })
    return s
  }
  return txt(sheet.cssRules, [])
}

const union = new Set()
let first = null
for (const lang of ['ar', 'en']) for (const [name, path] of PAGES) {
  const pg = await open(lang === 'ar' ? 'ar' : 'en', path)
  if (name === 'drawer') { await pg.click('.navbar-cart'); await pg.waitForTimeout(700) }
  // The bag drawer is not inside #root: React portals it to <body>, so its fixture is the <aside> itself (the page behind
  // it, and the backdrop, do not change a size inside it); every other fixture is the #root element with its wrapper.
  const cap = await pg.evaluate((drawer) => {
    const c = (drawer ? document.querySelector('aside.campaign-cart-drawer') : document.querySelector('#root')).cloneNode(true)
    for (const e of c.querySelectorAll('script')) e.remove()
    return { attrs: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value])), body: Object.fromEntries([...document.body.attributes].map((a) => [a.name, a.value])), root: c.outerHTML, features: document.getElementById('sporta-features-css')?.textContent || '' }
  }, name === 'drawer')
  writeFileSync(join(OUT, `${name}-${lang}.html`), `<!-- html: ${JSON.stringify(cap.attrs)} -->\n<!-- body: ${JSON.stringify(cap.body)} -->\n${cap.root}\n`)
  for (const p of await pg.evaluate(matchedFns)) union.add(p)
  if (!first) first = { pg, features: cap.features }; else await pg.context().close()
  console.log('captured', name, lang, cap.root.length, 'bytes of markup')
}
const keep = [...union]
const css = await first.pg.evaluate(serializeFn, keep)
const hash = (readdirSync(join(LIVE, 'assets')).find((f) => /^index-[\w-]+\.css$/.test(f)) || '?')
writeFileSync(join(OUT, 'live.css'), `/* The rules of the live compiled stylesheet (${hash}, captured from https://www.sporta.com.kw) that match an element of the pages in this folder, dumped from the page's CSSOM by scripts/make-sizes-fixtures.mjs, in source order with their @media / @layer wrappers. Do not edit by hand. */\n${css}`)
const indexHtml = readFileSync(join(LIVE, 'index.html'), 'utf8')
const inline = [...indexHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim()).join('\n')
writeFileSync(join(OUT, 'head.css'), `/* The inline <style> of the live index.html (it loads before the bundle). Do not edit by hand. */\n${inline}\n`)
writeFileSync(join(OUT, 'features.css'), `/* The <style id="sporta-features-css"> that sporta-features.js injects into <head> after load (it comes after every add-on stylesheet). Do not edit by hand. */\n${first.features}\n`)
console.log('live.css', css.length, 'bytes,', keep.length, 'rules; head.css and features.css written')
await browser.close(); server.close()
