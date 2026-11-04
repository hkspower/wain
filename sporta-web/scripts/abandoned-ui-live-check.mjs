// The Abandoned orders panel against the REAL compiled admin: the live build's own React, from a capture of the live site, with every
// admin route mocked (so nothing can be read or written anywhere). Not part of `npm run` because it needs the capture (a folder with
// index.html and assets/ saved from https://www.sporta.com.kw); without it the suite scripts/abandoned-ui-test.mjs is the proof, on
// the captured MARKUP with a stand-in for React (scripts/lib/abandoned-ui-shim.mjs). This script is what says whether that stand-in
// read React correctly.
//
//   SIZES_ADMIN_LIVE_DIR=/path/to/capture node scripts/abandoned-ui-live-check.mjs
//
// The capture lacks the admin's own stylesheets (AdminApp-*.css); the committed stand-in scripts/fixtures/sizes-admin/shell.css is
// served for them, as scripts/make-sizes-admin-fixtures.mjs does, so layout here is approximate and only behaviour is judged:
// the entry appears once after Orders, opens the panel, React's current tab goes inactive, every click on React's own nav closes the
// panel before React acts and React then shows the right screen, Back / Forward, the phone's menu, a sign-out, and with the route
// absent nothing is added. Read-only: no order is created, nothing is submitted; the API is a mock.
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMock } from './lib/sizes-admin-mock.mjs'
import { createMock, makeOrders, SESSION_COOKIE } from './lib/abandoned-ui-mock.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.SIZES_ADMIN_LIVE_DIR
if (!LIVE || !existsSync(join(LIVE, 'index.html'))) { console.log('SKIP abandoned-ui-live-check: set SIZES_ADMIN_LIVE_DIR to a capture of the live build (index.html + assets/). Nothing was tested.'); process.exit(0) }
const PUB = join(ROOT, 'public')
const SHELL = readFileSync(join(ROOT, 'scripts/fixtures/sizes-admin/shell.css'), 'utf8')
const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const pub = (n) => { try { return JSON.parse(readFileSync(join(LIVE, 'api', n + '.json'), 'utf8')) } catch { return [] } }

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function serve(state) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      const u = new URL(q.url, 'http://x')
      if (u.pathname.endsWith('/api/admin.php')) {
        const route = u.searchParams.get('r') || ''
        if (route.startsWith('abandoned_')) {
          let body = ''
          q.on('data', (c) => { body += c })
          q.on('end', () => {
            const out = state.abandoned.handle({ method: q.method, query: u.searchParams, headers: q.headers, cookie: SESSION_COOKIE + '=1', body })
            r.writeHead(out.status, { 'content-type': MIME.json, 'cache-control': 'no-store', ...(out.headers || {}) }); r.end(JSON.stringify(out.body))
          })
          return
        }
        r.writeHead(200, { 'content-type': MIME.json }); return r.end(q.method !== 'GET' ? '{"ok":true}' : JSON.stringify(state.admin[route] ?? []))
      }
      if (u.pathname === '/api/api.php') {
        const f = join(LIVE, 'api', u.searchParams.get('r') + '.json')
        r.writeHead(200, { 'content-type': MIME.json }); return r.end(existsSync(f) ? readFileSync(f) : '[]')
      }
      if (/^\/assets\/.*\.css$/.test(u.pathname) && !existsSync(join(LIVE, u.pathname))) { r.writeHead(200, { 'content-type': MIME.css }); return r.end(SHELL) }
      for (const root of [PUB, LIVE]) { const f = root + decodeURIComponent(u.pathname); if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) } }
      if (/\.(jpe?g|png|webp)$/.test(u.pathname)) { r.writeHead(200, { 'content-type': 'image/png' }); return r.end(PNG) }
      if (/\.\w+$/.test(u.pathname)) { r.writeHead(404); return r.end('nf') }
      r.writeHead(200, { 'content-type': MIME.html }); r.end(readFileSync(join(LIVE, 'index.html')))
    }).listen(0, '127.0.0.1', () => res(s))
  })
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] })
async function run({ w, routePresent }) {
  const state = { admin: buildMock({ pub, BASE: 'http://127.0.0.1', limit: { orders: 7, products: 9, variants: 8 } }), abandoned: createMock({ orders: makeOrders(), routePresent }) }
  const server = await serve(state)
  const base = 'http://127.0.0.1:' + server.address().port
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 768, hasTouch: w < 768, locale: 'en-US', serviceWorkers: 'block' })
  await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push(e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  pg.setDefaultTimeout(30000)
  await pg.goto(base + '/backends?lang=en', { waitUntil: 'networkidle' })
  await sleep(1200)
  return { pg, ctx, server, state, errors, base }
}
const close = async (o) => { await o.ctx.close(); await new Promise((r) => o.server.close(r)) }
// the current tab as the person sees it: only the nav that is on screen (the phone's tab bar is display:none on a desktop, and the reverse)
const cur = (pg) => pg.evaluate(() => [...document.querySelectorAll('.admin-sidebar [aria-current="page"], .m-tabbar [aria-current="page"], .m-menu-grid [aria-current="page"]')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => (e.getAttribute('aria-label') || e.textContent).trim()))
const shown = (pg) => pg.evaluate(() => [...document.querySelectorAll('main.admin-content > section.admin-page')].filter((s) => !s.hidden && getComputedStyle(s).display !== 'none').map((s) => s.hasAttribute('data-sporta-abandoned') ? 'ABANDONED' : (s.querySelector('h1') || {}).textContent || '?'))
const panelOpen = (pg) => pg.evaluate(() => { const p = document.querySelector('[data-sporta-abandoned]'); return !!p && !p.hidden && getComputedStyle(p).display !== 'none' })

// ---- desktop
{
  const o = await run({ w: 1280, routePresent: true })
  const { pg } = o
  await pg.waitForSelector('.admin-sidebar [data-sporta-ab-nav]', { state: 'attached' })
  is((await pg.locator('.admin-sidebar [data-sporta-ab-nav]').count()) === 1, 'REAL React: one "Abandoned orders" entry in the sidebar')
  is(await pg.evaluate(() => { const k = [...document.querySelector('nav.admin-sidebar__nav').children], i = k.findIndex((b) => b.hasAttribute('data-sporta-ab-nav')); return k[i - 1].textContent.trim() === 'Orders' }), 'right after Orders')
  await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Orders\s*$/ }).click(); await sleep(500)
  await pg.locator('.admin-sidebar [data-sporta-ab-nav]').click()
  await pg.waitForSelector('[data-sporta-abandoned] tbody tr[data-id]')
  is((await panelOpen(pg)) && (await shown(pg)).join() === 'ABANDONED', 'a click opens the panel and it is the only section on screen (React\'s Orders is hidden)', (await shown(pg)).join())
  is((await cur(pg)).join() === 'Abandoned orders', 'only our entry is current', (await cur(pg)).join())
  for (const label of ['Catalogue', 'Orders', 'Orders']) {
    await pg.locator('.admin-sidebar [data-sporta-ab-nav]').click(); await pg.waitForSelector('[data-sporta-abandoned] tbody tr[data-id]'); await sleep(200)
    await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click(); await sleep(600)
    const sh = await shown(pg), c = await cur(pg)
    is(!(await panelOpen(pg)) && sh.length === 1 && sh[0] !== 'ABANDONED' && c.join() === label, `click ${label} while open: the panel closes, React shows ONE screen (${sh.join()}), ${label} is the one current tab`, JSON.stringify([sh, c]))
    is(new URL(pg.url()).searchParams.get('tab') !== 'abandoned' && !(await pg.evaluate(() => document.body.hasAttribute('data-sporta-ab'))), `the address no longer says abandoned and <body> is clean after ${label}`, pg.url())
  }
  await pg.locator('.admin-sidebar [data-sporta-ab-nav]').click(); await pg.waitForSelector('[data-sporta-abandoned] tbody tr[data-id]')
  await pg.goBack(); await sleep(600)
  is(!(await panelOpen(pg)) && (await shown(pg)).length === 1, 'Back closes the panel; React shows its screen')
  await pg.goForward(); await sleep(600)
  is(await panelOpen(pg), 'Forward opens it again')
  await pg.locator('.admin-sidebar .admin-nav-item').filter({ hasText: /^\s*Catalogue\s*$/ }).click(); await sleep(700)
  is((await shown(pg)).length === 1 && (await cur(pg)).join() === 'Catalogue', 'and a later navigation through React still works')
  is(o.errors.length === 0, 'no script error or console error', o.errors.join(' | '))
  await close(o)
}
// ---- phone
{
  const o = await run({ w: 390, routePresent: true })
  const { pg } = o
  await pg.locator('.m-header__menu').click(); await pg.waitForSelector('.m-menu-grid [data-sporta-ab-nav]', { state: 'attached' })
  is(await pg.evaluate(() => { const k = [...document.querySelector('.m-menu-grid').children], i = k.findIndex((b) => b.hasAttribute('data-sporta-ab-nav')); return i > 0 && k[i - 1].textContent.trim() === 'Orders' }), 'REAL React, phone: a tile right after Orders in the More menu')
  await pg.locator('.m-menu-grid [data-sporta-ab-nav]').click()
  await pg.waitForSelector('[data-sporta-abandoned] tbody tr[data-id]')
  is((await panelOpen(pg)) && (await pg.locator('.m-menu-layer').count()) === 0, 'the tile closes React\'s menu and opens the panel')
  is(await pg.evaluate(() => [...document.querySelectorAll('.m-header__title > strong')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join()) === 'Abandoned orders', 'the header says Abandoned orders')
  await pg.locator('.m-header__menu').click(); await pg.waitForSelector('.m-menu-grid')
  await pg.locator('.m-menu-item').filter({ hasText: /^\s*Payments\s*$/ }).click(); await sleep(700)
  is(!(await panelOpen(pg)) && (await shown(pg)).length === 1 && (await pg.evaluate(() => [...document.querySelectorAll('.m-header__title > strong')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join())) === 'Payments', 'a tile of React\'s menu closes the panel and React shows Payments with its own header')
  await pg.locator('.m-tabbar__item[aria-label="Orders"]').click(); await sleep(600)
  is((await shown(pg)).length === 1 && (await cur(pg)).join() === 'Orders', 'the tab bar still navigates')
  is(o.errors.length === 0, 'no script error or console error', o.errors.join(' | '))
  await close(o)
}
// ---- the route is absent
{
  const o = await run({ w: 1280, routePresent: false })
  await sleep(800)
  is(await o.pg.evaluate(() => document.querySelectorAll('[data-sporta-ab-nav], [data-sporta-abandoned], style[data-sporta-ab-style]').length) === 0, 'REAL React, route absent (404): nothing is added to the page')
  is(o.state.abandoned.calls.length === 1, 'one request was made (the probe)', String(o.state.abandoned.calls.length))
  is(o.errors.length === 0, 'no script error', o.errors.join(' | '))
  await close(o)
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
