// Regenerates scripts/fixtures/sizes-admin/ - the fixtures behind `npm run test:sizes-admin` - from a CAPTURE of the live
// build (index.html, assets/, api/*.json saved from https://www.sporta.com.kw). Not needed to RUN the suite (the fixtures are
// committed); needed only to refresh them when the live build changes:
//
//   SIZES_ADMIN_LIVE_DIR=/path/to/capture node scripts/make-sizes-admin-fixtures.mjs
//
// What it does, so the suite measures the markup of the REAL compiled admin under the REAL compiled rules and not a rebuild:
//   1. serves the capture on a random local port (static files from the capture, then public/ for the fonts and the add-on
//      scripts; /api/api.php?r=<name> from api/<name>.json; /api/admin.php?r=<name> from the mock in lib/sizes-admin-mock.mjs,
//      every non-GET answered {"ok":true}, so nothing can be written anywhere). The admin's own stylesheets (AdminApp-*.css and
//      the per-screen sheets) are NOT in the capture: the committed stand-in fixtures/sizes-admin/shell.css is served for them
//      (its header says what it is built from),
//   2. opens /backends in headless Chromium (the signed-in admin: the mock answers `me`), walks the sidebar to each screen, and
//      for a few screens clicks the first "Add ..." button to capture the editor modal too,
//   3. saves each state's <body> markup (scripts removed, the Save bar the add-on script adds only while a Save is out of reach
//      removed) and the <html> attributes as <screen>.html; the admin renders the same DOM at every width (the generator
//      compares 390 and 1280 for every screen and says so),
//   4. dumps from the page's CSSOM every rule of the live index-*.css that matches an element of any captured state (light AND
//      dark, so the build's html.dark rules come along), in source order with their @media / @supports / @layer wrappers, plus
//      @font-face and the @layer order statement: live.css. head.css is the inline <style> of index.html; features.css the
//      <style> elements the add-on scripts inject.
// The data is made up (names, SPTEST ids, example.com addresses) and cut to a handful of rows per table, so the fixtures stay small.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMock } from './lib/sizes-admin-mock.mjs'
import { STATES } from './lib/sizes-admin-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.SIZES_ADMIN_LIVE_DIR
if (!LIVE || !existsSync(join(LIVE, 'index.html'))) { console.error('Set SIZES_ADMIN_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/).'); process.exit(2) }
const OUT = join(ROOT, 'scripts/fixtures/sizes-admin')
const PUB = join(ROOT, 'public')
mkdirSync(OUT, { recursive: true })
const SHELL = readFileSync(join(OUT, 'shell.css'), 'utf8')

const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const pub = (n) => { try { return JSON.parse(readFileSync(join(LIVE, 'api', n + '.json'), 'utf8')) } catch { return [] } }
// a few rows per table: the fixtures stay small and every state (paid / unpaid / failed, low / out of stock) is still in them
const MOCK = buildMock({ pub, BASE: 'http://127.0.0.1', limit: { orders: 7, products: 9, variants: 8 } })
const server = await new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    if (u.pathname.endsWith('/api/admin.php')) { r.writeHead(200, { 'content-type': MIME.json }); return r.end(q.method !== 'GET' ? '{"ok":true}' : JSON.stringify(MOCK[u.searchParams.get('r') || ''] ?? [])) }
    if (u.pathname === '/api/api.php') {
      const k = u.searchParams.get('r'), f = join(LIVE, 'api', k + '.json')
      if (existsSync(f)) { r.writeHead(200, { 'content-type': MIME.json }); return r.end(readFileSync(f)) }
      r.writeHead(200, { 'content-type': MIME.json }); return r.end('[]')
    }
    if (/^\/assets\/.*\.css$/.test(u.pathname) && !existsSync(join(LIVE, u.pathname))) { r.writeHead(200, { 'content-type': MIME.css }); return r.end(SHELL) }
    for (const root of [PUB, LIVE]) { const f = root + decodeURIComponent(u.pathname); if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) } }
    if (/\.(jpe?g|png|webp)$/.test(u.pathname)) { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
    if (/\.\w+$/.test(u.pathname)) { r.writeHead(404); return r.end('nf') }
    r.writeHead(200, { 'content-type': MIME.html }); r.end(readFileSync(join(LIVE, 'index.html')))
  }).listen(0, '127.0.0.1', () => res(s))
})
const BASE = 'http://127.0.0.1:' + server.address().port

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const open = async (w) => {
  const mob = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: mob, hasTouch: mob, locale: 'en-US', serviceWorkers: 'block' })
  await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const pg = await ctx.newPage()
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  pg.setDefaultTimeout(5000)
  await pg.goto(BASE + '/backends?lang=en', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  return pg
}
const go = async (pg, label, w) => {
  const re = new RegExp(`^\\s*${label}\\s*$`)
  let b = pg.locator('button:visible, a:visible').filter({ hasText: re }).first()
  if (!(await b.count())) { const m = pg.locator('button:visible').filter({ hasText: /Open menu|☰/ }).first(); if (await m.count()) { await m.click().catch(() => {}); await pg.waitForTimeout(400) } b = pg.locator('button:visible, a:visible').filter({ hasText: re }).first() }
  if (!(await b.count())) throw new Error('no nav entry ' + label + ' at ' + w)
  await b.click(); await pg.waitForTimeout(900)
  if (w < 768) { const close = pg.locator('button:visible').filter({ hasText: /Close menu|✕/ }).first(); if (await close.count()) await close.click().catch(() => {}); await pg.waitForTimeout(250) }
}
const snapshot = (pg) => pg.evaluate(() => {
  const clone = document.body.cloneNode(true)
  for (const e of clone.querySelectorAll('script, noscript, [data-sporta-savebar]')) e.remove()
  // while a Save is out of reach the add-on script adds padding-bottom to the scroll container (and puts it back afterwards);
  // that inline value is the bar's, not the build's, and it differs with the viewport: it is not part of the fixture
  for (const e of clone.querySelectorAll('[style*="padding-bottom"]')) {
    e.style.removeProperty('padding-bottom')
    if (!e.getAttribute('style')) e.removeAttribute('style')
  }
  return { attrs: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value])), body: Object.fromEntries([...document.body.attributes].map((a) => [a.name, a.value])), markup: clone.innerHTML.replace(/\s+/g, ' ') }
})
const reach = async (pg, [name, label, add], w) => {
  await go(pg, label, w)
  if (add) {
    const b = pg.locator('.admin-content button:visible').filter({ hasText: add }).first()
    if (!(await b.count())) throw new Error('no ' + add + ' button on ' + label)
    await b.click(); await pg.waitForTimeout(700)
  }
}

const union = new Set()
let last = null
for (const st of STATES) {
  const [name] = st
  // a fresh page per state: the admin keeps every screen it has shown mounted (hidden), so one page would pile them up
  const wide = await open(1280), phone = await open(390)
  await reach(wide, st, 1280); await reach(phone, st, 390)
  const a = await snapshot(wide), b = await snapshot(phone)
  const norm = (m) => m.replace(/rotate\([\d. -]+\)/g, 'rotate()')
  if (norm(a.markup) !== norm(b.markup)) { let i = 0; while (a.markup[i] === b.markup[i]) i++; console.error(`NOTE: ${name}: the DOM differs between 390 and 1280 at`, i, JSON.stringify(a.markup.slice(Math.max(0, i - 50), i + 70)), '|', JSON.stringify(b.markup.slice(Math.max(0, i - 50), i + 70))) } else console.log(`ok   ${name}: the DOM is identical at 390 and 1280`)
  writeFileSync(join(OUT, `${name}.html`), `<!-- html: ${JSON.stringify(a.attrs)} -->\n<!-- body: ${JSON.stringify(a.body)} -->\n${a.markup}\n`)
  // the rules that match this state, light and dark
  for (const theme of ['light', 'dark']) {
    await wide.evaluate((t) => { document.documentElement.dataset.theme = t; document.documentElement.classList.toggle('dark', t === 'dark') }, theme)
    for (const p of await wide.evaluate(matchedFns)) union.add(p)
  }
  console.log('captured', name, a.markup.length, 'bytes of markup')
  if (last) await last.context().close()
  last = wide
  await phone.context().close()
}
const wide = last

// ---- the rules of the live bundle that match something on a captured page -----------------------------------------------
function matchedFns() {
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
function serializeFn(keep) {
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
const css = await wide.evaluate(serializeFn, [...union])
const hash = (readdirSync(join(LIVE, 'assets')).find((f) => /^index-[\w-]+\.css$/.test(f)) || '?')
writeFileSync(join(OUT, 'live.css'), `/* The rules of the live compiled stylesheet (${hash}, captured from https://www.sporta.com.kw) that match an element of the admin states in this folder, light and dark, dumped from the page's CSSOM by scripts/make-sizes-admin-fixtures.mjs, in source order with their @media / @layer wrappers. Do not edit by hand. */\n${css}`)
const indexHtml = readFileSync(join(LIVE, 'index.html'), 'utf8')
const inline = [...indexHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim()).join('\n')
writeFileSync(join(OUT, 'head.css'), `/* The inline <style> of the live index.html (it loads before the bundle). Do not edit by hand. */\n${inline}\n`)
const features = await wide.evaluate((inl) => [...document.head.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.trim() && t.trim() !== inl.trim()).join('\n'), inline)
writeFileSync(join(OUT, 'features.css'), `/* The <style> elements the add-on scripts (sporta-admin-brands.js, sporta-features.js ...) inject into <head> after load. Do not edit by hand. */\n${features}\n`)
console.log('live.css', css.length, 'bytes,', union.size, 'rules; head.css and features.css written')
await browser.close(); server.close()
