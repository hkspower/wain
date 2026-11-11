// The Database center panel (block "ADMIN DATABASE CENTER", public/sporta-admin-brands.js) in a real browser.
//
//   npm run test:admin-db-center   (rig-free: the page is the CAPTURED live admin's Settings screen (scripts/fixtures/sizes-admin/settings.html)
//                                   under the live rules and the 14 add-on sheets; the admin API is a fake answered by route interception,
//                                   shaped like admin.php db_center / db_integrity (the shapes dbcenter.php returns, proved by test:db-center);
//                                   the REAL add-on file runs on it)
//
// What is asserted:
//   - the block: markers once, no markup injection, no storage, no third-party host, no write of any kind (no POST, no body), two read
//     routes only, every CSS rule scoped, idempotent, one half-second entry check that sleeps while the tab is hidden;
//   - the entry: one "Database center" button in the header of Settings (beside the Social center's), 44 px, gone with the screen,
//     not on other screens, nothing is read before it is pressed;
//   - overview: seven cards from the answer, "needs attention" built from it, exact counts, server line;
//   - tables: all of them, filter, three sorts, the shop's tables vs other, sizes in B / KB / MB / GB;
//   - schema: migrations ordered worst first, missing names listed, missing and unknown tables;
//   - health: every backup state worded, every indicator judged and worded, "unknown" shown as unknown;
//   - integrity: not run until asked; Run reads once (a double click too); checks worded with counts; skip and unknown; Run again;
//   - failures: 401, 404, 429, 503, a dead network, a malformed answer: each worded, Try again works, an old answer is kept when a refresh fails;
//   - an answer that arrives after the panel was closed changes nothing; open / close / refresh twenty times leave one panel, one style,
//     one button and no growth in the DOM;
//   - hostile data (markup in a table name, a note, a reason) is shown as text and nothing runs;
//   - 390 / 768 / 1280 px, English and Arabic (RTL), light and dark: no sideways scroll, 44 px targets at 390, contrast 4.5:1;
//   - MUTATION CHECK: with the block cut out of the file the same screen has no button and no panel.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN DATABASE CENTER - begin')
const END_MARK = '/* ===== ADMIN DATABASE CENTER - end'
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN DATABASE CENTER block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const BLOCK = BRANDS_JS.slice(BEGIN, BRANDS_JS.indexOf('\n', END))
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))
const SHOTS = process.env.DBC_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (x) => JSON.parse(JSON.stringify(x))
const ORIGIN = 'https://www.sporta.com.kw'

// ------------------------------------------------------------------------------------------------ the fake server
const T = (name, rows, data, idx, repo = true, engine = 'InnoDB') => ({ name, engine, rows_estimate: rows, data_bytes: data, index_bytes: idx, collation: 'utf8mb4_unicode_ci', total_bytes: data + idx, in_repo: repo })
const OVERVIEW = () => ({
  generated_at: '2026-11-11T21:30:00Z',
  server: { version: '11.8.9-MariaDB', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' },
  totals: { tables: 6, rows_estimate: 14625, bytes: 6_100_000_000 + 4_000_000 + 80_000 + 16_384 + 5_000 + 99 },
  tables: [
    T('orders', 1200, 6_000_000_000, 100_000_000), T('order_items', 3400, 3_000_000, 1_000_000), T('products', 46, 80_000, 0), T('settings', 9, 16_384, 0), T('legacy_old', 10000, 5_000, 0, false, 'MyISAM'), T('tiny', 1, 99, 0),
  ],
  counts: { orders: 1200, order_items: 3400, products: 46, product_variants: 210, inventory_movements: 0, customer_accounts: 87, fulfilment_outbox: null },
  schema: {
    repo_tables: 29, missing_tables: ['whatsapp_outbox'], other_tables: 1, other_table_names: ['legacy_old'],
    migrations: [
      { file: 'brands.mysql.sql', status: 'applied', tables: 1, columns: 9, missing_tables: [], missing_columns: [], missing_count: 0 },
      { file: 'whatsapp.mysql.sql', status: 'partial', tables: 1, columns: 14, missing_tables: ['whatsapp_outbox'], missing_columns: ['whatsapp_outbox.kind', 'whatsapp_outbox.lang'], missing_count: 15 },
      { file: 'abandoned.mysql.sql', status: 'missing', tables: 1, columns: 5, missing_tables: ['abandoned_followup'], missing_columns: ['abandoned_followup.note'], missing_count: 6 },
      { file: 'stock.mysql.sql', status: 'applied', tables: 0, columns: 2, missing_tables: [], missing_columns: [], missing_count: 0 },
    ],
    migrations_applied: 2, migrations_total: 4, manifest: true,
  },
  backup: { state: 'stale', age_hours: 51.5, last_success_at: '2026-11-09T18:00:00Z', last_status: 'ok', reason: null, file: 'sporta-db-20261109T180000Z.sql.gz.enc', note: 'The newest verified backup is older than 36 hours. The nightly job may not be running.' },
  health: { error: null, indicators: [
    { key: 'uptime', label: 'Server running for', value: 412.3, unit: 'hours', status: 'ok', note: 'Counters below are totals since the server started.' },
    { key: 'connections', label: 'Connections in use', value: 9, unit: 'of 100', status: 'ok', note: 'Plenty of room.' },
    { key: 'threads_running', label: 'Statements running now', value: 22, unit: '', status: 'warn', note: 'A few is normal; a long queue means something is slow.' },
    { key: 'slow_queries', label: 'Slow statements since start', value: 3, unit: 'over 10 s', status: 'info', note: 'The database counted these itself.' },
    { key: 'lock_waits_now', label: 'Statements waiting on a lock now', value: 0, unit: '', status: 'ok', note: 'Nothing is waiting.' },
    { key: 'longest_statement', label: 'Longest running statement', value: 140, unit: 's', status: 'fail', note: 'Only this account\'s own connections are visible.' },
    { key: 'lock_graph', label: 'Who is blocking whom', value: null, unit: '', status: 'unknown', note: 'Needs the PROCESS privilege, which the shop\'s account deliberately lacks.' },
  ] },
})
const INTEGRITY = () => ({
  generated_at: '2026-11-11T21:35:00Z', overall: 'fail',
  checks: [
    { key: 'items_orphan_order', label: 'Order lines that point at no order', severity: 'fail', status: 'pass', count: 0, detail: 'None found.' },
    { key: 'variants_negative_stock', label: 'Sizes with negative stock', severity: 'fail', status: 'fail', count: 2, detail: 'Stock below zero means more was sold than counted.' },
    { key: 'stock_vs_ledger', label: 'Sizes whose stock differs from the last stock movement', severity: 'warn', status: 'warn', count: 14, detail: 'The count on the shelf and the stock history disagree.' },
    { key: 'active_without_variants', label: 'Shown products with no size rows', severity: 'info', status: 'info', count: 19, detail: 'These products have no stock rows.' },
    { key: 'outbox_orphan', label: 'Warehouse messages for no order', severity: 'fail', status: 'skip', count: null, detail: 'Not checked: this database does not have fulfilment_outbox yet (see Schema).' },
    { key: 'outbox_stuck', label: 'Warehouse messages unsent for over an hour', severity: 'warn', status: 'unknown', count: null, detail: 'The check could not run (db_error_1205).' },
  ],
})
function makeWorld() {
  return { calls: [], requests: [], ov: OVERVIEW(), ig: INTEGRITY(), next: {}, delay: 0, igDelay: 0, drop: false, hold: null }
}
const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
function handler(W, shellHtml) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    W.requests.push({ method: req.method(), origin: u.origin, path: p + u.search })
    if (p === '/backends' || p.startsWith('/backends/')) return route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      W.calls.push({ method, route: r, headers: req.headers(), body: req.postData() })
      if (r === 'db_center' || r === 'db_integrity') {
        const n = W.next[r]
        if (W.hold && r === 'db_center') { const h = W.hold; W.hold = null; await h }
        if (r === 'db_center' && W.delay) await sleep(W.delay)
        if (r === 'db_integrity' && W.igDelay) await sleep(W.igDelay)
        if (W.drop) return route.abort('failed')
        if (n) { W.next[r] = null; if (n.raw !== undefined) return route.fulfill({ status: n.status || 200, contentType: 'text/plain', body: n.raw }); return json(route, n.status, n.body, n.headers || {}) }
        return json(route, 200, r === 'db_center' ? W.ov : W.ig)
      }
      return json(route, 404, { error: 'not_found' })
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const shell = (opt, name = 'settings') => fixturePage(name, FILES, opt)
const pageErrors = [], consoleErrors = []
const SEL = { btn: '[data-sporta-dbc-btn]', panel: 'section.sdb' }
async function open(W, { w = 1280, h = 900, rtl = false, dark = false, js = BRANDS_JS, name = 'settings', wait = true, init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800 })
  if (init) await ctx.addInitScript(init)
  await ctx.route(ORIGIN + '/**', handler(W, shell({ rtl, dark }, name)))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)) })
  await pg.goto(ORIGIN + '/backends/settings')
  await pg.addScriptTag({ content: js })
  if (wait) await pg.waitForSelector(SEL.btn, { timeout: 4000 }).catch(() => {})
  pg.__ctx = ctx; pg.__W = W
  return pg
}
const close = (pg) => pg.__ctx.close()
const mine = (W, from = 0) => W.calls.slice(from).filter((c) => c.route === 'db_center' || c.route === 'db_integrity')
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, name + '.png') }) }
async function openPanel(pg, tab = 'overview') {
  if (!(await pg.locator(SEL.panel + ':not([hidden])').count())) { pg.__base = pg.__W.calls.length; await pg.click(SEL.btn) }
  await pg.waitForSelector(SEL.panel + ':not([hidden])')
  await pg.waitForFunction(() => !document.querySelector('.sdb-head-acts button[aria-busy="true"]') && document.querySelector('.sdb-stat, .sdb-banner'), null, { timeout: 4000 }).catch(() => {})
  if (tab !== 'overview') await pg.click(`.sdb-tab[data-tab="${tab}"]`)
  await pg.waitForTimeout(120)
}
const txt = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel)
const pane = (pg, name) => pg.evaluate((n) => document.querySelector(`.sdb-pane[data-pane="${n}"]`).textContent.replace(/\s+/g, ' ').trim(), name)
const status = (pg) => pg.evaluate(() => document.querySelector('.sdb-status').textContent)
const refreshBtn = (pg) => pg.locator('.sdb-head-acts').getByRole('button', { name: /^(Refresh|Reading…)$/ })

// ================================================================================================ 1. the block itself
head('the block')
{
  is(!/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\beval\(|new Function\(|createContextualFragment|DOMParser/.test(CODE), 'no markup injection, no eval')
  is(!/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(CODE), 'no browser storage and no cookie is touched')
  is(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|<script|createElement\('script'\)|createElement\('iframe'\)|\.src = ['"]http|window\.open/.test(CODE), 'no beacon, socket, script, frame, pop-up or remote source')
  is(!/https?:\/\//.test(CODE), 'no web address at all in the block (it reads two routes of this origin)')
  const fetchCall = CODE.slice(CODE.indexOf('fetch(API'), CODE.indexOf('.then(', CODE.indexOf('fetch(API')))
  is(!/\bPOST\b|'PUT'|'DELETE'|'PATCH'/.test(CODE) && !/\bbody\s*:/.test(fetchCall) && /method: 'GET'/.test(fetchCall), 'no write of any kind: no POST, PUT, DELETE, PATCH and no request body in the fetch call')
  is(/method: 'GET'/.test(CODE) && (CODE.match(/\bfetch\(/g) || []).length === 1, 'one fetch call, a GET')
  const routes = [...CODE.matchAll(/request\('([a-z_]+)'\)/g)].map((m) => m[1])
  is(same([...new Set(routes)].sort(), ['db_center', 'db_integrity']), 'the only routes named are db_center and db_integrity', routes.join())
  is(!/password|secret|api[_-]?key|bearer|authorization|credential/i.test(CODE.replace(/credentials: 'same-origin'/g, '')), 'no secret, key or credential appears in the block (apart from the cookie option credentials: same-origin)')
  is(/'X-Sporta-Admin': '1'/.test(CODE) && /credentials: 'same-origin'/.test(CODE) && /cache: 'no-store'/.test(CODE), 'every request carries X-Sporta-Admin, the session cookie, and is not cached')
  const cssSrc = CODE.slice(CODE.indexOf('var CSS = ['), CODE.indexOf("].join('\\n')", CODE.indexOf('var CSS = [')))
  const css = new Function('OPEN', 'PAGE', cssSrc.replace('var CSS = ', 'return ') + '].join("\\n")')('data-sporta-dbc-state', 'data-sporta-dbc')
  const sels = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith('@')).flatMap((x) => x.split(/,(?![^(]*\))/).map((y) => y.trim()))
  const rogue = sels.filter((x) => !/^(\.sdb(?![A-Za-z-])|\.sdb-|:is\(html\.dark,html\[data-theme="dark"\]\) \.sdb|body\[data-sporta-dbc-state="open"\] main\.admin-content>section\.admin-page:not\(\[data-sporta-dbc\]\)$)/.test(x))
  is(sels.length > 60 && rogue.length === 0, `all ${sels.length} rules are scoped to .sdb / .sdb-open or the body switch (the Payments screen's light-only rule cannot be touched)`, rogue.slice(0, 3).join(' | '))
  is(!/payment-settings|admin-content:has/.test(css), 'no rule names the Payments screen')
  is((BRANDS_JS.match(/ADMIN DATABASE CENTER - begin/g) || []).length === 1, 'the block appears once')
  is(BLOCK.includes("if (location.pathname.indexOf('/backends') !== 0) return") && BLOCK.includes('if (window.__sportaDbCenter) return'), 'it starts on /backends only and is idempotent')
  is((CODE.match(/setInterval\(/g) || []).length === 1 && /if \(document\.hidden\) return/.test(CODE) && /500\)/.test(CODE.slice(CODE.indexOf('setInterval('))), 'one half-second entry check, which sleeps while the tab is hidden; nothing else runs on a timer')
  is((CODE.match(/new MutationObserver/g) || []).length === 0 && (CODE.match(/document\.addEventListener\(/g) || []).length === 2, 'no MutationObserver; one document click listener (and the load one)')
}

// ================================================================================================ 2. the entry
head('the entry button')
{
  const W = makeWorld(), pg = await open(W)
  is((await pg.locator(SEL.btn).count()) === 1, 'one "Database center" button on the Settings screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-dbc-btn]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'Database center' && b.closest('.admin-page').querySelector('h1').textContent.trim() === 'Settings' }), 'it sits in the header of Settings and reads "Database center"')
  is((await pg.evaluate(() => document.querySelector('[data-sporta-dbc-btn]').getBoundingClientRect().height)) >= 43.5, 'it is 44 px tall')
  is(await pg.evaluate(() => document.querySelectorAll('[data-sporta-social-btn]').length === 1 && document.querySelector('[data-sporta-social-btn]').parentElement === document.querySelector('[data-sporta-dbc-btn]').parentElement), 'it sits beside the Social center button, both alive')
  await pg.waitForTimeout(700)
  is(mine(W).length === 0, 'nothing is read before the button is pressed')
  await pg.evaluate(() => { for (const h of document.querySelectorAll('main.admin-content .admin-page h1')) if (h.textContent === 'Settings') h.textContent = 'Something else' })
  await pg.waitForTimeout(800)
  is((await pg.locator(SEL.btn).count()) === 0, 'the button goes when the screen goes')
  await pg.evaluate(() => { for (const h of document.querySelectorAll('main.admin-content .admin-page h1')) if (h.textContent === 'Something else') h.textContent = 'Settings' })
  await pg.waitForTimeout(800)
  is((await pg.locator(SEL.btn).count()) === 1, 'and comes back with the screen, once')
  await close(pg)
  const ov = await open(makeWorld(), { name: 'overview', wait: false }); await ov.waitForTimeout(900)
  is((await ov.locator(SEL.btn).count()) === 0, 'the Overview screen has no button')
  await close(ov)
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
  await ctx.route(ORIGIN + '/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><main class="admin-content"></main></body></html>' }))
  const shop = await ctx.newPage(); await shop.goto(ORIGIN + '/shop'); await shop.addScriptTag({ content: BRANDS_JS }); await shop.waitForTimeout(800)
  is(await shop.evaluate(() => typeof window.__sportaDbCenter === 'undefined' && !document.querySelector('style[data-sporta-dbc-style]')), 'off /backends the block does not start (no flag, no style, no timer)')
  await ctx.close()
}

// ================================================================================================ 3. open and the overview
head('overview')
const W0 = makeWorld(), pg0 = await open(W0)
await openPanel(pg0)
{
  const m = mine(W0, pg0.__base)
  is(same(m.map((c) => c.route + ':' + c.method), ['db_center:GET']), 'pressing the button reads db_center (GET) and nothing else', m.map((c) => c.route + ':' + c.method).join())
  is(W0.calls.every((c) => c.method === 'GET') && W0.requests.every((r) => r.origin === ORIGIN), 'every request of the whole session was a GET to this origin')
  is(m.every((c) => c.headers['x-sporta-admin'] === '1' && !c.body), 'and carried X-Sporta-Admin: 1 and no body')
  is(await pg0.evaluate(() => document.body.getAttribute('data-sporta-dbc-state') === 'open' && getComputedStyle(document.querySelector('main.admin-content > section.admin-page:not([data-sporta-dbc])')).display === 'none'), 'the screen behind the panel is hidden while it is open')
  is(await pg0.evaluate(() => document.querySelector('section.sdb').parentElement.matches('main.admin-content') && document.activeElement === document.getElementById('sdb-title')), 'the panel is a section of <main> and its title has the focus')
  is(same(await txt(pg0, '.sdb-tab'), ['Overview', 'Tables', 'Schema', 'Health', 'Integrity']), 'five tabs')
  is(await pg0.evaluate(() => document.querySelector('.sdb-tab[aria-selected="true"]').dataset.tab) === 'overview', 'Overview is first and selected')
  const stats = await pg0.evaluate(() => [...document.querySelectorAll('.sdb-stat')].map((s) => [s.querySelector('.sdb-stat-label').textContent, s.querySelector('.sdb-stat-value').textContent, (s.querySelector('.sdb-chip') || {}).textContent || '']))
  const byLabel = Object.fromEntries(stats.map(([l, v, c]) => [l, [v, c]]))
  is(stats.length === 7, 'seven cards', String(stats.length))
  is(same(byLabel.Tables, ['6', '']) && same(byLabel['Rows (estimate)'], ['14,625', '']), 'tables and rows (thousands separated, called an estimate)', JSON.stringify(byLabel))
  is(byLabel.Size[0] === '5.68 GB', 'size is human: 5.68 GB', byLabel.Size[0])
  is(same(byLabel.Migrations, ['2 of 4', 'Problem']), 'migrations: 2 of 4, a problem (a migration is missing)', JSON.stringify(byLabel.Migrations))
  is(same(byLabel.Backup, ['52 h', 'Backup is old']), 'backup: 52 h, "Backup is old"', JSON.stringify(byLabel.Backup))
  is(same(byLabel['Server health'], ['4 of 7 fine', 'Problem']), 'server health: 4 of 7 fine, judged by the worst indicator', JSON.stringify(byLabel['Server health']))
  is(same(byLabel.Integrity, ['Not run', 'Not run']), 'integrity: "Not run" until asked', JSON.stringify(byLabel.Integrity))
  const att = await txt(pg0, '.sdb-pane[data-pane="overview"] .sdb-card:first-of-type .sdb-row-text')
  is(att.some((t) => /Migration whatsapp\.mysql\.sql is partial/.test(t)) && att.some((t) => /Migration abandoned\.mysql\.sql is missing/.test(t)) && att.some((t) => /Tables the shop expects and the database lacks: whatsapp_outbox/.test(t)) && att.some((t) => /backup is 52 hours old|verified backup is 52 hours old/.test(t)) && att.some((t) => /Statements running now: 22/.test(t)) && att.some((t) => /Longest running statement: 140 s/.test(t)), 'needs attention lists the migrations, the missing table, the old backup and the two health problems', att.join(' | '))
  is(!att.some((t) => /Plenty of room|Server running/.test(t)), 'and does not list what is fine')
  const counts = await pg0.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sdb-kv')].map((k) => [k.firstChild.textContent, k.lastChild.textContent])))
  is(counts.Orders === '1,200' && counts['Order lines'] === '3,400' && counts['Stock movements'] === '0' && counts['Warehouse messages'] === 'not available', 'exact counts: thousands separated, 0 is 0, null is "not available"', JSON.stringify(counts))
  is(/Server 11\.8\.9-MariaDB · utf8mb4 · read /.test(await pane(pg0, 'overview')), 'the server line shows version and character set')
  await pg0.click('.sdb-row .sdb-btn >> nth=0'); await pg0.waitForTimeout(100)
  is(await pg0.evaluate(() => ['schema', 'health'].includes(document.querySelector('.sdb-tab[aria-selected="true"]').dataset.tab)), 'an "Open" button on an attention row goes to the tab that explains it')
  await pg0.click('.sdb-tab[data-tab="overview"]')
  await shot(pg0, '01-overview-1280-light')
}

// ================================================================================================ 4. tables
head('tables')
{
  await pg0.click('.sdb-tab[data-tab="tables"]')
  const rows = async () => pg0.evaluate(() => [...document.querySelectorAll('.sdb-trow')].map((r) => r.querySelector('.sdb-mono').textContent))
  is(same(await rows(), ['orders', 'order_items', 'products', 'settings', 'legacy_old', 'tiny']), 'all six tables, largest first')
  const first = await pg0.evaluate(() => document.querySelector('.sdb-trow').textContent.replace(/\s+/g, ' '))
  is(/orders/.test(first) && /≈ 1,200 rows/.test(first) && /5\.68 GB/.test(first), 'a row shows name, ≈ rows and size', first)
  is(/data 5\.59 GB · indexes 95 MB/.test(first) && /InnoDB/.test(first), 'data and index sizes and the engine', first)
  const legacy = await pg0.evaluate(() => [...document.querySelectorAll('.sdb-trow')].find((r) => r.textContent.startsWith('legacy_old')).textContent)
  is(/Other/.test(legacy) && /MyISAM/.test(legacy), 'a table that is not the shop\'s says "Other"')
  is(/Shop table/.test(first), 'the shop\'s own says "Shop table"')
  is(/99 B/.test(await pg0.evaluate(() => [...document.querySelectorAll('.sdb-trow')].pop().textContent)) && /16 KB|16\.0 KB/.test(await pg0.evaluate(() => [...document.querySelectorAll('.sdb-trow')].find((r) => r.textContent.startsWith('settings')).textContent)), 'bytes and kilobytes are worded')
  is(await pg0.evaluate(() => { const f = [...document.querySelectorAll('.sdb-share-fill')].map((e) => parseFloat(e.style.width)); return f[0] === 100 && f.every((x) => x >= 1 && x <= 100) }), 'the share bars run from the biggest (100%) down, never below 1%')
  await pg0.fill('input[name="sdb_filter"]', 'ORDERS')
  is(same(await rows(), ['orders']) && /1 of 6 tables/.test(await pg0.evaluate(() => document.querySelector('.sdb-pane[data-pane="tables"] .sdb-muted').textContent)), 'the filter works on part of a name, any case, and says "1 of 6 tables"', (await rows()).join())
  await pg0.fill('input[name="sdb_filter"]', '_')
  is(same((await rows()).sort(), ['legacy_old', 'order_items']), 'a filter of "_" matches the underscores literally')
  await pg0.fill('input[name="sdb_filter"]', 'zzz')
  is((await rows()).length === 0 && /No table matches/.test(await pane(pg0, 'tables')), 'nothing matches: said so')
  await pg0.fill('input[name="sdb_filter"]', '')
  await pg0.click('.sdb-segbtn[data-sort="rows"]')
  is(same(await rows(), ['legacy_old', 'order_items', 'orders', 'products', 'settings', 'tiny']), 'sorted by rows, most first')
  await pg0.click('.sdb-segbtn[data-sort="name"]')
  is(same(await rows(), ['legacy_old', 'order_items', 'orders', 'products', 'settings', 'tiny']), 'sorted by name, A to Z')
  await pg0.click('.sdb-segbtn[data-sort="name"]')
  is((await rows())[0] === 'tiny', 'the same button again reverses it')
  is(await pg0.evaluate(() => document.querySelector('.sdb-segbtn[data-sort="name"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.sdb-segbtn[data-sort="size"]').getAttribute('aria-pressed') === 'false'), 'the sort buttons say which is pressed')
  await shot(pg0, '02-tables-1280-light')
}

// ================================================================================================ 5. schema
head('schema')
{
  await pg0.click('.sdb-tab[data-tab="schema"]')
  const migs = await pg0.evaluate(() => [...document.querySelectorAll('.sdb-mig')].map((m) => [m.querySelector('.sdb-mono').textContent, m.querySelector('.sdb-chip').textContent, m.querySelector('p').textContent]))
  is(same(migs.map((m) => m[0] + ':' + m[1]), ['abandoned.mysql.sql:Missing', 'whatsapp.mysql.sql:Partial', 'brands.mysql.sql:Applied', 'stock.mysql.sql:Applied']), 'migrations: missing first, then partial, then applied (by name)', migs.map((m) => m[0] + ':' + m[1]).join())
  is(/Missing: table abandoned_followup, column abandoned_followup\.note … \(6 in all\)\./.test(migs[0][2]), 'a missing migration names what is missing', migs[0][2])
  is(/table whatsapp_outbox, column whatsapp_outbox\.kind, column whatsapp_outbox\.lang … \(15 in all\)/.test(migs[1][2]), 'a partial one lists names and the total', migs[1][2])
  is(/1 table, 9 columns checked\./.test(migs[2][2]), 'an applied one says how much was checked')
  const t = await pane(pg0, 'schema')
  is(/2 of 4 migration files are fully present/.test(t) && /Types and defaults are not compared here/.test(t), 'the summary and the honest limit')
  is(/Tables the shop expects.*Missing.*whatsapp_outbox/.test(t), 'the missing table is listed under tables the shop expects')
  is(/Other tables \(not from this repo\).*1 table belong to the old build.*legacy_old/.test(t.replace(/\bbelongs\b/, 'belong')) || /Other tables \(not from this repo\).*legacy_old/.test(t), 'the other table is listed')
  is(/Nothing here changes the database/.test(t), 'it says it changes nothing')
  await shot(pg0, '03-schema-1280-light')
}

// ================================================================================================ 6. health and backup
head('health and backup')
{
  await pg0.click('.sdb-tab[data-tab="health"]')
  const ind = await pg0.evaluate(() => [...document.querySelectorAll('.sdb-ind')].map((i) => [i.querySelector('.sdb-ind-label').textContent, i.querySelector('.sdb-chip').textContent, i.querySelector('.sdb-ind-value').textContent]))
  is(ind.length === 7, 'seven indicators', String(ind.length))
  const by = Object.fromEntries(ind.map((i) => [i[0], i.slice(1)]))
  is(same(by['Connections in use'], ['OK', '9 of 100']) && same(by['Statements running now'], ['Watch', '22']) && same(by['Longest running statement'], ['Problem', '140 s']), 'values and judgements are shown', JSON.stringify(by))
  is(same(by['Who is blocking whom'], ['Unknown', '—']), '"unknown" is shown as Unknown with a dash, not as zero', JSON.stringify(by['Who is blocking whom']))
  is(same(by['Slow statements since start'], ['Note', '3 over 10 s']), 'slow statements: a note with the threshold', JSON.stringify(by['Slow statements since start']))
  is(same(by['Server running for'], ['OK', '412 hours']), 'uptime in hours', JSON.stringify(by['Server running for']))
  const bk = await pane(pg0, 'health')
  is(/Backup.*Backup is old.*older than 36 hours.*Newest verified backup.*\(52 h ago\).*File.*sporta-db-20261109T180000Z\.sql\.gz\.enc/.test(bk), 'backup: state, the note, the date and age, the file name', bk.slice(0, 300))
  const states = { ok: ['Backed up', 'less than 36 hours'], failing: ['Last backup failed', 'failed'], never: ['No backup yet', 'No verified'], not_reported: ['Not reported', 'unknown, not fine'] }
  for (const [st, [label, word]] of Object.entries(states)) {
    pg0.__W.ov = OVERVIEW(); Object.assign(pg0.__W.ov.backup, { state: st, age_hours: st === 'ok' ? 2 : null, last_success_at: st === 'ok' ? '2026-11-11T19:00:00Z' : null, file: st === 'ok' ? 'sporta-db-20261111T190000Z.sql.gz.enc' : null, reason: st === 'failing' ? 'dump_failed' : null,
      note: { ok: 'The newest verified backup is less than 36 hours old.', failing: 'The last backup run failed. The newest good copy is the age shown (if any).', never: 'No verified backup has been reported yet.', not_reported: 'The shop cannot see the backup folder. Until then this is unknown, not fine.' }[st] })
    await refreshBtn(pg0).click(); await pg0.waitForFunction(() => !document.querySelector('.sdb-head-acts button[aria-busy="true"]'))
    const t2 = await pane(pg0, 'health')
    is(t2.includes(label) && t2.includes(word) && (st !== 'failing' || /Last failure\s*dump failed/.test(t2)), `backup state "${st}" reads "${label}"`, t2.slice(0, 160))
  }
  pg0.__W.ov = OVERVIEW()
  await refreshBtn(pg0).click(); await pg0.waitForFunction(() => !document.querySelector('.sdb-head-acts button[aria-busy="true"]'))
  await shot(pg0, '04-health-1280-light')
}

// ================================================================================================ 7. integrity
head('integrity')
{
  await pg0.click('.sdb-tab[data-tab="integrity"]')
  const before = mine(pg0.__W).filter((c) => c.route === 'db_integrity').length
  is(before === 0, 'opening the Integrity tab runs nothing')
  is(/Not run|Run the checks/.test(await pane(pg0, 'integrity')) && !(await pg0.locator('.sdb-item').count()), 'it offers "Run the checks" and shows no result yet')
  pg0.__W.igDelay = 400
  await pg0.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run the checks' }).dblclick()
  is(await pg0.evaluate(() => { const b = document.querySelector('.sdb-pane[data-pane="integrity"] .sdb-btn--primary'); return b.textContent === 'Running…' && b.disabled && b.getAttribute('aria-busy') === 'true' }), 'while it runs the button says Running… and is disabled')
  await pg0.waitForSelector('.sdb-item')
  pg0.__W.igDelay = 0
  is(mine(pg0.__W).filter((c) => c.route === 'db_integrity').length === 1, 'a double click reads once')
  const items = await pg0.evaluate(() => [...document.querySelectorAll('.sdb-item')].map((i) => [i.className.replace('sdb-item ', ''), i.querySelector('.sdb-mark').textContent, i.querySelector('.sdb-item-head').textContent, i.querySelector('p').textContent]))
  is(items.length === 6, 'six checks shown (the fake sends six)')
  is(items[0][0] === 'sdb-item--pass' && items[0][1] === '✓' && /OK$/.test(items[0][2]), 'a passing check: tick, OK')
  is(items[1][0] === 'sdb-item--fail' && items[1][1] === '✕' && /Problem: 2$/.test(items[1][2]), 'a failing check: cross, "Problem: 2"', items[1].join(' | '))
  is(items[2][0] === 'sdb-item--warn' && /Watch: 14$/.test(items[2][2]) && items[3][0] === 'sdb-item--skip' && /Note: 19$/.test(items[3][2]), 'a warning and a note carry their counts')
  is(items[4][0] === 'sdb-item--skip' && /Not checked$/.test(items[4][2]) && /fulfilment_outbox yet/.test(items[4][3]), 'a check whose table is missing is "Not checked" with the reason, not a pass')
  is(/Unknown$/.test(items[5][2]) && /db_error_1205/.test(items[5][3]), 'a check that could not run is "Unknown" with the error code only')
  is(/Problems found/.test(await pane(pg0, 'integrity')) && /Last run /.test(await pane(pg0, 'integrity')), 'the heading is the verdict and the run time is shown')
  await pg0.click('.sdb-tab[data-tab="overview"]')
  const integ = await pg0.evaluate(() => { const s = [...document.querySelectorAll('.sdb-stat')].find((x) => x.querySelector('.sdb-stat-label').textContent === 'Integrity'); return s.querySelector('.sdb-stat-value').textContent + '|' + s.querySelector('.sdb-chip').textContent })
  is(integ === 'Needs a look|Problem', 'the Overview card now says "Needs a look"', integ)
  is((await txt(pg0, '.sdb-row-text')).some((t) => /Sizes with negative stock: 2\./.test(t)) && (await txt(pg0, '.sdb-row-text')).some((t) => /Sizes whose stock differs from the last stock movement: 14\./.test(t)), 'and the failing and warning checks join "needs attention"')
  await pg0.click('.sdb-tab[data-tab="integrity"]')
  await pg0.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run again' }).click(); await pg0.waitForTimeout(250)
  is(mine(pg0.__W).filter((c) => c.route === 'db_integrity').length === 2, '"Run again" reads again')
  pg0.__W.next.db_integrity = { status: 503, body: { error: 'db_center_unavailable' } }
  await pg0.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run again' }).click(); await pg0.waitForTimeout(250)
  is(/The database did not answer/.test(await pane(pg0, 'integrity')) && (await pg0.locator('.sdb-item').count()) === 6, 'a failed run says so and keeps the last good result')
  pg0.__W.ig = { generated_at: '2026-11-11T21:40:00Z', overall: 'pass', checks: [{ key: 'a', label: 'All good', severity: 'fail', status: 'pass', count: 0, detail: 'None found.' }] }
  await pg0.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run again' }).click(); await pg0.waitForTimeout(250)
  is(/All clear/.test(await pane(pg0, 'integrity')), 'a clean result says "All clear"')
  await shot(pg0, '05-integrity-1280-light')
}
await close(pg0)

// ================================================================================================ 8. failures
head('failures')
{
  for (const [label, next, re] of [
    ['401', { status: 401, body: { error: 'not_signed_in' } }, /sign-in has ended/],
    ['404', { status: 404, body: { error: 'not_found' } }, /not available until the next update of the shop server/],
    ['429 with Retry-After', { status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': '30' } }, /Wait 30 seconds/],
    ['503', { status: 503, body: { error: 'db_center_unavailable' } }, /database did not answer/],
    ['500', { status: 500, body: { error: 'server_error' } }, /could not do that \(server_error\)/],
    ['400 bad_request', { status: 400, body: { error: 'bad_request' } }, /request was refused/],
    ['an answer that is not JSON', { status: 200, raw: '<html>oops</html>' }, /could not do that \(HTTP 200\)/],
    ['JSON that is not the overview', { status: 200, body: { hello: 1 } }, /could not do that \(HTTP 200\)/],
  ]) {
    const W = makeWorld(); W.next.db_center = next
    const pg = await open(W); await openPanel(pg)
    const t = await pane(pg, 'overview')
    is(re.test(t) && (await pg.locator('.sdb-pane:not([hidden]) .sdb-banner[role="alert"]').count()) === 1, `${label}: worded in an alert`, t.slice(0, 140))
    is(!/<html|oops|\bError:|\bat [A-Za-z]+\.js|\{"/.test(t), `${label}: no raw body or stack is shown`)
    await pg.locator('.sdb-banner').getByRole('button', { name: 'Try again' }).click()
    await pg.waitForSelector('.sdb-stat')
    is((await pg.locator('.sdb-stat').count()) === 7 && mine(W).length === 2, `${label}: "Try again" reads again and recovers`)
    await close(pg)
  }
  const W = makeWorld(); W.drop = true
  const pg = await open(W); await openPanel(pg)
  is(/Could not reach the server/.test(await pane(pg, 'overview')), 'a dead network is worded')
  W.drop = false
  await pg.locator('.sdb-banner').getByRole('button', { name: 'Try again' }).click(); await pg.waitForSelector('.sdb-stat')
  W.next.db_center = { status: 503, body: { error: 'db_center_unavailable' } }
  await refreshBtn(pg).click(); await pg.waitForFunction(() => /Could not refresh/.test(document.querySelector('.sdb-status').textContent))
  is((await pg.locator('.sdb-stat').count()) === 7 && /database did not answer/.test(await status(pg)) && (await pg.evaluate(() => document.querySelector('.sdb-status').getAttribute('data-bad'))) === '1', 'a failed Refresh keeps the last good screen and says "Could not refresh: ..."')
  await refreshBtn(pg).click(); await pg.waitForFunction(() => document.querySelector('.sdb-status').textContent === '')
  is((await status(pg)) === '', 'the next good Refresh clears the message')
  await close(pg)
}

// ================================================================================================ 9. refresh, races, leaks
head('refresh, races and leaks')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg)
  W.delay = 500
  await refreshBtn(pg).dblclick()
  is(await pg.evaluate(() => { const b = document.querySelector('.sdb-head-acts .sdb-btn'); return b.disabled && b.textContent === 'Reading…' && b.getAttribute('aria-busy') === 'true' }), 'while reading, Refresh says Reading… and is disabled')
  await pg.waitForFunction(() => document.querySelector('.sdb-head-acts .sdb-btn').textContent === 'Refresh')
  is(mine(W).length === 2, 'a double click on Refresh reads once (open + one refresh)', String(mine(W).length))
  // an answer that arrives after the panel was closed changes nothing
  let release; W.hold = new Promise((r) => { release = r })
  W.ov = OVERVIEW(); W.ov.totals.tables = 77
  await refreshBtn(pg).click()
  await pg.locator('.sdb-head-acts').getByRole('button', { name: '← Back' }).click()
  release(); await pg.waitForTimeout(500)
  is(await pg.evaluate(() => [...document.querySelectorAll('.sdb-stat')].find((s) => s.querySelector('.sdb-stat-label').textContent === 'Tables').querySelector('.sdb-stat-value').textContent) === '6', 'an answer that arrives after the panel was closed is dropped')
  W.delay = 0; W.ov = OVERVIEW()
  // leaks: open / close / refresh twenty times
  await pg.click(SEL.btn); await pg.waitForSelector('.sdb-stat'); await pg.waitForTimeout(300)
  const size0 = await pg.evaluate(() => document.querySelector('section.sdb').getElementsByTagName('*').length)
  const body0 = await pg.evaluate(() => document.body.getElementsByTagName('*').length)
  for (let i = 0; i < 20; i++) {
    await pg.locator('.sdb-head-acts').getByRole('button', { name: /^Refresh$/ }).click()
    await pg.waitForFunction(() => document.querySelector('.sdb-head-acts .sdb-btn').textContent === 'Refresh')
    if (i % 4 === 0) { await pg.locator('.sdb-head-acts').getByRole('button', { name: '← Back' }).click(); await pg.click(SEL.btn); await pg.waitForSelector('.sdb-stat') }
  }
  await pg.waitForTimeout(300)
  const size1 = await pg.evaluate(() => document.querySelector('section.sdb').getElementsByTagName('*').length)
  const body1 = await pg.evaluate(() => document.body.getElementsByTagName('*').length)
  is(size1 === size0 && body1 === body0, `after 20 refreshes and 5 re-opens the DOM did not grow (${size0} -> ${size1} inside the panel, ${body0} -> ${body1} in the body)`)
  is(await pg.evaluate(() => document.querySelectorAll('section.sdb').length === 1 && document.querySelectorAll('style[data-sporta-dbc-style]').length === 1 && document.querySelectorAll('[data-sporta-dbc-btn]').length === 1), 'one panel, one style, one button')
  const kb = W.calls.filter((c) => c.route === 'db_center').length
  W.calls.length = 0; await pg.locator('.sdb-head-acts').getByRole('button', { name: '← Back' }).click(); await pg.waitForTimeout(1800)
  is(W.calls.length === 0, 'while the panel is closed nothing is polled or read (1.8 s of idle)', String(W.calls.length))
  is(kb >= 21, 'sanity: the loop did read ' + kb + ' times')
  await close(pg)
}
{
  // hidden tab: the entry check sleeps
  const W = makeWorld(), pg = await open(W, { wait: false })
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }) })
  await pg.evaluate(() => { for (const b of document.querySelectorAll('[data-sporta-dbc-btn]')) b.remove() })
  await pg.waitForTimeout(1300)
  is((await pg.locator(SEL.btn).count()) === 0, 'a hidden tab adds nothing (the half-second check sleeps)')
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }) })
  await pg.waitForSelector(SEL.btn, { timeout: 2500 })
  is((await pg.locator(SEL.btn).count()) === 1, 'and the button is back when the tab is shown')
  await close(pg)
}

// ================================================================================================ 10. hostile data
head('hostile data is text')
{
  const W = makeWorld()
  const EVIL = '<img src=x onerror="window.__xss=1">'
  W.ov.tables[0].name = 'a<img src=x onerror="window.__xss=1">b'
  W.ov.schema.migrations[1].file = EVIL + '.sql'
  W.ov.schema.other_table_names = ['<script>window.__xss=2</script>']
  W.ov.backup.note = '<b onclick="window.__xss=3">bold</b>'; W.ov.backup.file = EVIL; W.ov.backup.state = '<i>x</i>'
  W.ov.health.indicators[0].label = EVIL; W.ov.health.indicators[0].status = '"><img src=x onerror=window.__xss=4>'
  W.ov.health.indicators[1].note = 'javascript:alert(1)'
  W.ov.counts.orders = '1e999'; W.ov.totals.bytes = 'NaN'
  W.ig = { generated_at: 'x', overall: '"><script>1</script>', checks: [{ key: 'k', label: EVIL, severity: 'fail', status: '<svg onload=window.__xss=5>', count: '<b>9</b>', detail: EVIL }] }
  const pg = await open(W); await openPanel(pg)
  for (const t of ['tables', 'schema', 'health', 'integrity']) { await pg.click(`.sdb-tab[data-tab="${t}"]`); if (t === 'integrity') await pg.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run the checks' }).click(); await pg.waitForTimeout(200) }
  is(await pg.evaluate(() => typeof window.__xss === 'undefined'), 'no script or handler from the data ran')
  is(await pg.evaluate(() => !document.querySelector('section.sdb img, section.sdb script, section.sdb svg, section.sdb b, section.sdb i, section.sdb [onclick], section.sdb [onerror], section.sdb a')), 'no element from the data was created inside the panel (no img, script, svg, b, i, link, handler)')
  is(await pg.evaluate(() => [...document.querySelectorAll('section.sdb *')].every((e) => [...e.attributes].every((a) => !/^on/i.test(a.name)))), 'no on* attribute anywhere in the panel')
  is((await pg.evaluate(() => document.querySelector('.sdb-trow .sdb-mono').textContent)) === 'a b', 'the table name is still shown, as text with the tag stripped')
  const txtAll = await pg.evaluate(() => document.querySelector('section.sdb').textContent)
  is(!/NaN|Infinity|undefined|\[object/.test(txtAll), 'no "NaN", "Infinity", "undefined" or "[object" anywhere on screen', (txtAll.match(/NaN|Infinity|undefined|\[object/) || [''])[0])
  is(await pg.evaluate(() => !document.querySelector('section.sdb [class*="--<"]') && ![...document.querySelectorAll('section.sdb *')].some((e) => /[<>"]/.test(e.className))), 'a state word from the data cannot reach a class name')
  await close(pg)
}

// ================================================================================================ 11. layout
head('layout: widths, languages, themes')
const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
async function measure(pg) {
  return pg.evaluate(() => {
    const doc = document.documentElement, panel = document.querySelector('section.sdb')
    const bad = []
    for (const e of panel.querySelectorAll('button,input')) {
      const r = e.getBoundingClientRect()
      if (r.width && r.height && r.height < 43.5 && !e.closest('[hidden]')) bad.push((e.name || e.textContent || e.tagName).toString().slice(0, 20) + ':' + Math.round(r.height))
    }
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number)
    const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.99)) return c.slice(0, 3) } return [255, 255, 255] }
    const sample = {}
    for (const [k, sel] of [['title', '.sdb-title'], ['lead', '.sdb-lead'], ['btn', '.sdb-btn--primary'], ['tab', '.sdb-tab[aria-selected="true"]'], ['tab2', '.sdb-tab[aria-selected="false"]'], ['chipOk', '.sdb-chip--ok'], ['chipWarn', '.sdb-chip--warn'], ['chipErr', '.sdb-chip--error'], ['chipInfo', '.sdb-chip--info'], ['muted', '.sdb-muted'], ['label', '.sdb-stat-label'], ['value', '.sdb-stat-value'], ['mono', '.sdb-mono'], ['kvk', '.sdb-kv-k'], ['mark', '.sdb-item--fail .sdb-mark'], ['markw', '.sdb-item--warn .sdb-mark']]) {
      const e = panel.querySelector(sel); if (!e || !e.getBoundingClientRect().width) continue
      sample[k] = [rgb(getComputedStyle(e).color).slice(0, 3), bgOf(e)]
    }
    return { sw: doc.scrollWidth, iw: window.innerWidth, psw: panel.scrollWidth, pcw: panel.clientWidth, bad, dir: getComputedStyle(panel).direction, sample }
  })
}
for (const w of [390, 768, 1280]) for (const rtl of [false, true]) for (const dark of [false, true]) {
  const W = makeWorld(), pg = await open(W, { w, h: 900, rtl, dark })
  const tag = `${w}px ${rtl ? 'ar' : 'en'} ${dark ? 'dark' : 'light'}`
  const bads = [], sw = [], low = []
  await openPanel(pg)
  await pg.click('.sdb-tab[data-tab="integrity"]'); await pg.locator('.sdb-pane[data-pane="integrity"]').getByRole('button', { name: 'Run the checks' }).click(); await pg.waitForSelector('.sdb-item')
  for (const tab of ['overview', 'tables', 'schema', 'health', 'integrity']) {
    await pg.click(`.sdb-tab[data-tab="${tab}"]`); await pg.waitForTimeout(260)   // past the .15 s colour transition
    const m = await measure(pg)
    if (m.sw > m.iw + 1 || m.psw > m.pcw + 1) sw.push(`${tab}:${m.sw}/${m.iw},${m.psw}/${m.pcw}`)
    if (w <= 390 && m.bad.length) bads.push(`${tab}:${m.bad.join(',')}`)
    for (const [k, [f, b]] of Object.entries(m.sample)) if (contrast(f, b) < 4.5) low.push(`${tab}/${k} ${contrast(f, b).toFixed(2)}`)
    if (tab === 'overview') is(m.dir === (rtl ? 'rtl' : 'ltr'), `${tag}: the panel is ${rtl ? 'right to left' : 'left to right'}`, m.dir)
    await shot(pg, `10-${tab}-${w}-${rtl ? 'ar' : 'en'}-${dark ? 'dark' : 'light'}`)
  }
  is(sw.length === 0, `${tag}: no sideways scroll on any of the five tabs`, sw.join(' | '))
  is(low.length === 0, `${tag}: text contrast is 4.5:1 or better`, [...new Set(low)].slice(0, 6).join(', '))
  if (w <= 390) is(bads.length === 0, `${tag}: every button and field is 44 px tall`, bads.join(' | '))
  await close(pg)
}
{
  // arrow keys move between tabs (reversed in RTL), focus follows
  for (const rtl of [false, true]) {
    const pg = await open(makeWorld(), { rtl }); await openPanel(pg)
    await pg.focus('.sdb-tab[data-tab="overview"]'); await pg.keyboard.press('ArrowRight')
    const t = await pg.evaluate(() => document.activeElement.dataset.tab)
    is(t === (rtl ? 'integrity' : 'tables'), `${rtl ? 'RTL' : 'LTR'}: ArrowRight from Overview goes to ${rtl ? 'Integrity (the previous one, wrapping)' : 'Tables'}`, t)
    await close(pg)
  }
  const p2 = await open(makeWorld(), { dark: true }); await openPanel(p2)
  await p2.locator('.sdb-head-acts').getByRole('button', { name: '← Back' }).click(); await p2.waitForTimeout(200)
  is(await p2.evaluate(() => !document.body.hasAttribute('data-sporta-dbc-state') && document.querySelector('section.sdb').hidden && getComputedStyle(document.querySelector('main.admin-content > section.admin-page:not([data-sporta-dbc]):not([hidden])')).display !== 'none' && document.activeElement === document.querySelector('[data-sporta-dbc-btn]')), '"← Back" closes the panel, shows the screen again and returns focus to the button')
  await p2.click(SEL.btn); await p2.waitForSelector(SEL.panel + ':not([hidden])')
  await p2.click('.admin-sidebar .admin-nav-item >> nth=0'); await p2.waitForTimeout(200)
  is(await p2.evaluate(() => !document.body.hasAttribute('data-sporta-dbc-state') && document.querySelector('section.sdb').hidden), 'any click on the menu closes the panel before the admin handles it')
  await close(p2)
  const pay = await open(makeWorld(), { dark: true, name: 'payments', wait: false }); await pay.waitForTimeout(800)
  is((await pay.locator(SEL.btn).count()) === 0 && (await pay.locator('style[data-sporta-dbc-style]').count()) === 0, 'on the Payments screen (dark switch on) the block adds no button and no style at all')
  await close(pay)
}

// ================================================================================================ 12. mutation
head('mutation check')
{
  const pg = await open(makeWorld(), { js: WITHOUT, wait: false }); await pg.waitForTimeout(1000)
  is((await pg.locator(SEL.btn).count()) === 0 && (await pg.locator(SEL.panel).count()) === 0 && (await pg.evaluate(() => typeof window.__sportaDbCenter)) === 'undefined', 'with the block cut out of the file there is no button, no panel and no API: the suite above fails without it')
  is((await pg.evaluate(() => typeof window.__sportaSocial)) !== 'undefined', 'the rest of the add-on file still runs without it')
  await close(pg)
}

is(pageErrors.length === 0, 'no page errors in the whole run', pageErrors.slice(0, 3).join(' ; '))
is(consoleErrors.length === 0, 'no console errors in the whole run', consoleErrors.slice(0, 3).join(' ; '))
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
