// Regenerates scripts/fixtures/sizes-product/ - the fixtures behind `npm run test:sizes-product` - from a CAPTURE of the live
// storefront build (index.html, assets/, api/*.json saved from https://www.sporta.com.kw). Not needed to RUN the suite (the
// fixtures are committed); needed only to refresh them when the live build changes:
//
//   SIZES_LIVE_DIR=/path/to/capture node scripts/make-sizes-product-fixtures.mjs
//
// What it does, so the suite measures the LIVE size ladder under the LIVE rules and not a reconstruction:
//   1. serves the capture on a random local port: the capture's own files first (so the add-on files are the LIVE ones, not the
//      repo's, and the page is what a visitor gets today), then public/ for the fonts; /api/api.php?r=<name> comes from
//      api/<name>.json; an image that is not on disk is a 1x1 PNG. Chromium is pointed at nothing else (every other host gets an
//      empty answer), and nothing is submitted: no order, no sign-in, no POST,
//   2. opens the real compiled product page (/product/<slug>) in headless Chromium, in Arabic and English, for the SCENARIOS
//      below. The stock list (what /api/api.php?r=stock answers) is replaced per scenario, so one real product can be shown with
//      every size in stock, with sizes sold out in the middle of the ladder, with one piece left, and so on. The size buttons
//      the add-on script hides (sizes the product has no variant for) are hidden in the capture exactly as they are live,
//   3. saves each page's <html> attributes (light, and the dark ones) and the product <section> (which holds the fixed buy bar
//      and its spacer) as <scenario>-<lang>.html,
//   4. dumps from the page's CSSOM every rule of the live compiled stylesheet (index-*.css) that matches the html/body, the
//      wrappers or any element of the section, in source order with its @media / @supports / @layer wrappers, with the page in
//      its light AND its dark state (the compiled dark theme is html[data-theme=dark] / html.dark): live.css. head.css is the
//      inline <style> of index.html and features.css the <style> elements the add-on script injects (sporta-features-css and
//      sporta-size-css, which carries the "One size" label),
//   5. measures the sticky header (it is not in the fixtures, a spacer of its real height stands in for it) at the five
//      widths the suite uses: meta.json.
// The Tailwind utilities are in live.css because they are in the live build; nothing is recompiled.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.SIZES_LIVE_DIR
if (!LIVE || !existsSync(join(LIVE, 'index.html'))) { console.error('Set SIZES_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/).'); process.exit(2) }
const OUT = join(ROOT, 'scripts/fixtures/sizes-product')
const PUB = join(ROOT, 'public')
mkdirSync(OUT, { recursive: true })

// Real products from the captured catalogue. 'stock' replaces the answer of /api/api.php?r=stock for that product's variants
// (size -> units); 'pick' clicks that size; 'add' clicks Add to bag with no size chosen (the "please choose a size" alert).
const SCENARIOS = [
  { id: 'full',      slug: 'sgomma-t-shirt-navy',          note: 'S-5XL, everything in stock, a Fit card under the sizes' },
  { id: 'full-pick', slug: 'sgomma-t-shirt-navy',          pick: 'M', note: 'the same, M selected' },
  { id: 'full-sold', slug: 'sgomma-t-shirt-navy',          stock: { S: 0, L: 0, '3XL': 0, XL: 2 }, pick: 'XL', note: 'S, L and 3XL sold out (struck, in the middle of the ladder), XL selected with 2 left' },
  { id: 'full-add',  slug: 'sgomma-t-shirt-navy',          add: true, note: 'Add to bag pressed with no size: the "please choose a size" alert' },
  { id: 'three',     slug: 'define-jacket-steel-grey',     note: 'L, M, XL (the sizes the product has), one piece of each: "last one"' },
  { id: 'two',       slug: 'cloudsoft-jacket-coffee-brown', note: 'L and M, the hint line about struck sizes, colour swatches' },
  { id: 'one',       slug: 'cagliari-calcio-backpack',     note: 'one size, sold out: relabelled "One size" by the add-on script' },
]
const WIDTHS = [320, 360, 390, 768, 1280]

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
    for (const root of [LIVE, PUB]) { const f = root + decodeURIComponent(u.pathname); if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) } }
    if (/\.(jpe?g|png|webp)$/.test(u.pathname)) { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
    if (/\.\w+$/.test(u.pathname)) { r.writeHead(404); return r.end('nf') }
    r.writeHead(200, { 'content-type': MIME.html }); r.end(readFileSync(join(LIVE, 'index.html')))
  }).listen(0, '127.0.0.1', () => res(s))
})
const BASE = 'http://127.0.0.1:' + server.address().port
const STOCK = JSON.parse(readFileSync(join(LIVE, 'api/stock.json'), 'utf8'))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const open = async (sc, lang, { w = 390, dark = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  if (sc.stock) {
    await ctx.route((u) => u.pathname === '/api/api.php' && u.searchParams.get('r') === 'stock', (r) => {
      const rows = STOCK.map((x) => x.slug === sc.slug && x.size in sc.stock ? { ...x, stock: sc.stock[x.size], in_stock: sc.stock[x.size] > 0 } : x)
      r.fulfill({ status: 200, contentType: MIME.json, body: JSON.stringify(rows) })
    })
  }
  if (dark) await ctx.addInitScript(() => { try { localStorage.setItem('sporta_theme', 'dark') } catch {} })
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}/product/${sc.slug}${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
  await pg.waitForSelector('#product-size-options')
  await pg.waitForTimeout(900)   // the add-on script hides the sizes the product lacks after the stock answer arrives
  if (sc.pick) { await pg.locator('#product-size-options [role="group"] button:not([disabled])', { hasText: new RegExp(`^${sc.pick}$`) }).click(); await pg.waitForTimeout(400) }
  if (sc.add) { await pg.locator('.product-purchase-row .btn-primary').click(); await pg.waitForTimeout(900) }
  return pg
}

// ---- CSSOM dump, scoped to the product section --------------------------------------------------------------------
// (functions passed to page.evaluate are serialised, so each one carries its own copy of the two lines that find the scope)
const matchedFns = () => {
  const sheet = [...document.styleSheets].find((s) => /\/assets\/index-[\w-]+\.css/.test(s.href || ''))
  const sec = document.querySelector('section.catalog-product-page')
  const anc = []; for (let e = sec; e; e = e.parentElement) anc.push(e)
  // pseudo-elements AND the interaction states (:hover, :focus-visible ...) are stripped before matching, so a rule that only applies while
  // a chip is hovered or focused (the bundle's hover utilities and its 2px focus ring) is part of the dump: the suite hovers and Tabs
  const STRIP = /::?(?:before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|hover|focus-visible|focus-within|focus|active|-webkit-[\w-]+|-moz-[\w-]+)/g
  const hit = (sel) => {
    for (let part of sel.split(/,(?![^(]*\))/)) {
      part = part.replace(STRIP, '').trim()
      if (!part || /[>+~]$/.test(part)) part += '*'
      try { if (anc.some((e) => e.matches(part)) || sec.querySelector(part)) return true } catch {}
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
const capture = () => {
  const sec = document.querySelector('section.catalog-product-page')
  const c = sec.cloneNode(true)
  for (const e of c.querySelectorAll('script')) e.remove()
  return {
    attrs: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value])),
    body: Object.fromEntries([...document.body.attributes].map((a) => [a.name, a.value])),
    section: c.outerHTML,
    features: [...document.querySelectorAll('style#sporta-features-css, style#sporta-size-css')].map((s) => `/* ${s.id} */\n${s.textContent}`).join('\n'),
  }
}

const union = new Set()
let featuresCss = ''
const darkAttrs = {}
for (const lang of ['ar', 'en']) {
  for (const sc of SCENARIOS) {
    const pg = await open(sc, lang)
    const cap = await pg.evaluate(capture)
    const hidden = await pg.evaluate(() => [...document.querySelectorAll('#product-size-options [role="group"] button')].filter((b) => b.style.display === 'none').length)
    const shown = await pg.evaluate(() => [...document.querySelectorAll('#product-size-options [role="group"] button')].filter((b) => b.style.display !== 'none').map((b) => b.textContent.trim() + (b.disabled ? '(x)' : b.getAttribute('aria-pressed') === 'true' ? '(on)' : '')).join(' '))
    // dark theme: same page, the stored theme choice set before the page loads (what boot.js reads); only its html attributes and
    // the rules it matches are kept, the markup of the ladder does not depend on the theme
    const dk = await open(sc, lang, { dark: true })
    const dcap = await dk.evaluate(capture)
    for (const p of await dk.evaluate(matchedFns)) union.add(p)
    darkAttrs[`${sc.id}-${lang}`] = dcap.attrs
    await dk.context().close()
    writeFileSync(join(OUT, `${sc.id}-${lang}.html`), `<!-- html: ${JSON.stringify(cap.attrs)} -->\n<!-- html-dark: ${JSON.stringify(dcap.attrs)} -->\n<!-- body: ${JSON.stringify(cap.body)} -->\n${cap.section}\n`)
    for (const p of await pg.evaluate(matchedFns)) union.add(p)
    if (!featuresCss || cap.features.length > featuresCss.length) featuresCss = cap.features
    console.log(`captured ${sc.id.padEnd(9)} ${lang}  ${String(cap.section.length).padStart(6)} bytes  [${shown}]  (${hidden} sizes hidden)  - ${sc.note}`)
    await pg.context().close()
  }
}
// the dump comes from one more light page so the union is taken against the same stylesheet object
const first = await open(SCENARIOS[0], 'ar')
const keep = [...union]
const css = await first.evaluate(serializeFn, keep)
const hash = (readdirSync(join(LIVE, 'assets')).find((f) => /^index-[\w-]+\.css$/.test(f)) || '?')
writeFileSync(join(OUT, 'live.css'), `/* The rules of the live compiled stylesheet (${hash}, captured from https://www.sporta.com.kw) that match the html/body, the wrappers or an element of the product section in the pages of this folder (light and dark states), dumped from the page's CSSOM by scripts/make-sizes-product-fixtures.mjs, in source order with their @media / @layer wrappers. Do not edit by hand. */\n${css}`)
const indexHtml = readFileSync(join(LIVE, 'index.html'), 'utf8')
const inline = [...indexHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim()).join('\n')
writeFileSync(join(OUT, 'head.css'), `/* The inline <style> of the live index.html (it loads before the bundle). Do not edit by hand. */\n${inline}\n`)
writeFileSync(join(OUT, 'features.css'), `/* The <style> elements sporta-features.js injects into <head> after load (they come after every add-on stylesheet): the features band and, for a one-size product, the "One size" label. Do not edit by hand. */\n${featuresCss}\n`)

// the sticky header is not part of the fixtures; its measured height stands in for it (a spacer) at each width
const meta = { header: {} }
for (const lang of ['ar', 'en']) for (const w of WIDTHS) {
  const pg = await open(SCENARIOS[0], lang, { w })
  meta.header[`${lang}|${w}`] = await pg.evaluate(() => { const h = document.querySelector('.app-header'); const r = h.getBoundingClientRect(); return { h: Math.round(r.height * 100) / 100, pos: getComputedStyle(h).position } })
  await pg.context().close()
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1) + '\n')
console.log('live.css', css.length, 'bytes,', keep.length, 'rules; head.css, features.css and meta.json written')
console.log('header heights', JSON.stringify(meta.header))
await first.context().close()
await browser.close(); server.close()
