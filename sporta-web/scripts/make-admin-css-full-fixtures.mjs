// Regenerates scripts/fixtures/admin-css-full/ - the EXTRA admin states behind scripts/admin-css-full-test.mjs that the
// sizes-admin fixtures do not hold: the Orders sheet (an order opened) and the Returns, CRM, Support, Profiles, Theme and SEO
// screens. Same method as scripts/make-sizes-admin-fixtures.mjs (read its header): the REAL compiled admin from a capture of
// the live build, signed in on the mock API of lib/sizes-admin-mock.mjs (every non-GET answered {"ok":true}), the body markup
// of each state saved as <state>.html, and every rule of the live index-*.css that matches an element of any of these states
// (light and dark) dumped from the CSSOM as live.css. Not needed to RUN the suite (the fixtures are committed).
//
//   ADMIN_CSS_LIVE_DIR=/path/to/capture node scripts/make-admin-css-full-fixtures.mjs     (a folder with index.html, assets/, api/)
//
// What these fixtures are NOT: the per-screen stylesheets of the live admin (AdminApp-*.css and the CRM / Support / Returns /
// Profiles / Theme / SEO chunk sheets) are not in the capture, so sizes-admin/shell.css stands in for them and the LAYOUT of
// these six screens is not the live layout. The suite therefore uses them only for what the missing sheets cannot change:
// which elements exist and which classes they carry (so a selector is proven to match real markup), and the colours that the
// add-on itself forces with !important. The Orders sheet is built from Tailwind utilities only, which ARE the live rules.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMock } from './lib/sizes-admin-mock.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.ADMIN_CSS_LIVE_DIR
if (!LIVE || !existsSync(join(LIVE, 'index.html'))) { console.error('Set ADMIN_CSS_LIVE_DIR to a capture of the live build (a folder with index.html, assets/ and api/).'); process.exit(2) }
const OUT = join(ROOT, 'scripts/fixtures/admin-css-full'), PUB = join(ROOT, 'public')
mkdirSync(OUT, { recursive: true })
const SHELL = readFileSync(join(ROOT, 'scripts/fixtures/sizes-admin/shell.css'), 'utf8')
// [file name, sidebar label, optional click after the screen is up]
export const STATES = [
  ['orders-sheet', 'Orders', async (pg) => { await pg.locator('.admin-content button:visible').filter({ hasText: /SPTEST1000/ }).first().click(); await pg.waitForSelector('[role="dialog"]') }],
  ['returns', 'Returns'], ['crm', 'CRM'], ['support', 'Support'], ['profiles', 'Profiles'], ['theme', 'Theme'], ['seo', 'SEO'],
]
const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const pub = (n) => { try { return JSON.parse(readFileSync(join(LIVE, 'api', n + '.json'), 'utf8')) } catch { return [] } }
const MOCK = buildMock({ pub, BASE: 'http://127.0.0.1', limit: { orders: 7, products: 9, variants: 8 } })
const server = await new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    if (u.pathname.endsWith('/api/admin.php')) { r.writeHead(200, { 'content-type': MIME.json }); return r.end(q.method !== 'GET' ? '{"ok":true}' : JSON.stringify(MOCK[u.searchParams.get('r') || ''] ?? [])) }
    if (u.pathname === '/api/api.php') { const f = join(LIVE, 'api', u.searchParams.get('r') + '.json'); r.writeHead(200, { 'content-type': MIME.json }); return r.end(existsSync(f) ? readFileSync(f) : '[]') }
    if (/^\/assets\/.*\.css$/.test(u.pathname) && !existsSync(join(LIVE, u.pathname))) { r.writeHead(200, { 'content-type': MIME.css }); return r.end(SHELL) }
    for (const root of [PUB, LIVE]) { const f = root + decodeURIComponent(u.pathname); if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) } }
    if (/\.(jpe?g|png|webp)$/.test(u.pathname)) { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
    if (/\.\w+$/.test(u.pathname)) { r.writeHead(404); return r.end('nf') }
    r.writeHead(200, { 'content-type': MIME.html }); r.end(readFileSync(join(LIVE, 'index.html')))
  }).listen(0, '127.0.0.1', () => res(s))
})
const BASE = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
function matchedFns() {
  const sheet = [...document.styleSheets].find((s) => /\/assets\/index-[\w-]+\.css/.test(s.href || ''))
  const STRIP = /::?(?:before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/g
  const hit = (sel) => { for (let part of sel.split(/,(?![^(]*\))/)) { part = part.replace(STRIP, '').trim(); if (!part || /[>+~]$/.test(part)) part += '*'; try { if (document.querySelector(part)) return true } catch {} } return false }
  const out = []
  const walk = (rules, path) => [...rules].forEach((r, i) => { const p = path.concat(i); if (r.selectorText !== undefined) { if (hit(r.selectorText)) out.push(p.join('/')) } else if (r.cssRules) walk(r.cssRules, p) })
  walk(sheet.cssRules, [])
  return out
}
function serializeFn(keep) {
  const sheet = [...document.styleSheets].find((s) => /\/assets\/index-[\w-]+\.css/.test(s.href || ''))
  const set = new Set(keep), any = (path) => keep.some((k) => k === path || k.startsWith(path + '/'))
  const txt = (rules, path) => {
    let s = ''
    ;[...rules].forEach((r, i) => {
      const p = path.concat(i).join('/')
      if (r.selectorText !== undefined) { if (set.has(p)) s += r.cssText + '\n' }
      else if (r instanceof CSSFontFaceRule || r instanceof CSSPropertyRule || r instanceof CSSLayerStatementRule) s += r.cssText + '\n'
      else if (r instanceof CSSKeyframesRule) { /* animations change nothing measured */ }
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
let last = null
for (const [name, label, after] of STATES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', serviceWorkers: 'block' })
  await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const pg = await ctx.newPage()
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  pg.setDefaultTimeout(8000)
  await pg.goto(BASE + '/backends?lang=en', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  await pg.locator('button:visible, a:visible').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click()
  await pg.waitForTimeout(1200)
  if (after) { await after(pg); await pg.waitForTimeout(700) }
  const snap = await pg.evaluate(() => {
    const clone = document.body.cloneNode(true)
    for (const e of clone.querySelectorAll('script, noscript, [data-sporta-savebar]')) e.remove()
    for (const e of clone.querySelectorAll('[style*="padding-bottom"]')) { e.style.removeProperty('padding-bottom'); if (!e.getAttribute('style')) e.removeAttribute('style') }
    return { attrs: Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value])), body: Object.fromEntries([...document.body.attributes].map((a) => [a.name, a.value])), markup: clone.innerHTML.replace(/\s+/g, ' ') }
  })
  writeFileSync(join(OUT, `${name}.html`), `<!-- html: ${JSON.stringify(snap.attrs)} -->\n<!-- body: ${JSON.stringify(snap.body)} -->\n${snap.markup}\n`)
  for (const theme of ['light', 'dark']) {
    await pg.evaluate((t) => { document.documentElement.dataset.theme = t; document.documentElement.classList.toggle('dark', t === 'dark') }, theme)
    for (const p of await pg.evaluate(matchedFns)) union.add(p)
  }
  console.log('captured', name, snap.markup.length, 'bytes of markup; h1:', await pg.evaluate(() => (document.querySelector('.admin-content h1') || {}).textContent || '(none)'))
  if (last) await last.context().close()
  last = pg
}
const css = await last.evaluate(serializeFn, [...union])
const hash = readdirSync(join(LIVE, 'assets')).find((f) => /^index-[\w-]+\.css$/.test(f)) || '?'
writeFileSync(join(OUT, 'live.css'), `/* The rules of the live compiled stylesheet (${hash}) that match an element of the admin states in this folder, light and dark, dumped from the page's CSSOM by scripts/make-admin-css-full-fixtures.mjs, in source order with their @media / @layer wrappers. Do not edit by hand. */\n${css}`)
console.log('live.css', css.length, 'bytes,', union.size, 'rules')
await browser.close(); server.close()
