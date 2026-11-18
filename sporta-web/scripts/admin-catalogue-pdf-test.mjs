// CATALOGUE-1118, the /backends side: the "Catalogue PDF" button of the Catalogue screen and its dialog (block ADMIN CATALOGUE PDF in
// public/sporta-admin-brands.js), in a real browser with the real add-on file, real Tailwind and the real engine (public/sporta-catalogue.js).
//
//   npm run test:admin-catalogue-pdf   (rig-free: the shop's public routes are answered by route interception; poppler reads the files)
//
// Asserted:
//   - one "Catalogue PDF" button in the Catalogue screen's header (English and Arabic names), none on other screens;
//   - the dialog (role=dialog, aria-modal, labelled; Escape closes and returns focus; Tab stays inside) reads the LIVE public catalogue (three
//     GETs: products, stock, brands) and says how many products there are, how many are on sale and how many are sold out; "Read again" reads again;
//     a failing read is said, with a retry that recovers;
//   - Download builds the PDF in the browser in the chosen language (the language of the admin by default), shows which page is being prepared
//     while the controls are off, then names the file and its size and offers "Download again" (the same file, nothing built twice); poppler reads the
//     file: the pages, the title, a link for every product;
//   - the addresses to share: the public Catalogue page (a safe new-tab link) and the live PDF links in Arabic and English, each copied exactly;
//   - READ ONLY: no POST, no request to another host, nothing written; the engine is loaded on demand (once) and only when the dialog opens;
//   - Arabic is right to left, no sideways scroll at 390 px, every control 44 px or more, one style element, no page errors;
//   - MUTATIONS: without the download call, with a wrong engine address, with the file language ignored or with the copy cut, the matching check fails.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIVE, SCREEN, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'
import { ROOT, PUB, makeData, engineSource } from './lib/catalogue-fx.mjs'

if (spawnSync('pdfinfo', ['-v']).error) { console.log('SKIP poppler is not installed'); process.exit(0) }
const BRANDS_JS = readFileSync(join(PUB, 'sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(PUB, 'sporta-admin-knet.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const SETTINGS = '<section class="admin-page"><div class="admin-page-layout"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Settings</h1></header><div class="p-4">Settings body</div></div></section>'
const SCREENS = { settings: SETTINGS, catalogue: SCREEN }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'catalogue-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

function makeShop(o = {}) {
  const st = { calls: [], posts: [], offHost: [], data: makeData(), fault: {}, ...o }
  async function handle(route) {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== ORIGIN) { st.offHost.push(req.url()); return route.abort() }
    if (req.method() !== 'GET') st.posts.push(req.method() + ' ' + u.pathname)
    st.calls.push(u.pathname + u.search)
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => route.fulfill({ status, body, headers: { 'content-type': type, ...headers } })
    if (u.pathname === '/api/api.php') {
      const r = u.searchParams.get('r')
      if (st.fault[r]) return send(st.fault[r], '{"error":"x"}', 'application/json')
      return send(200, JSON.stringify(r === 'products' ? st.data.products : r === 'stock' ? st.data.stock : r === 'brands' ? st.data.brands : []), 'application/json')
    }
    if (u.pathname === '/fixture.js') return send(200, FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}`, 'text/javascript')
    if (u.pathname === '/sporta-admin-brands.js') return send(200, st.js || BRANDS_JS, 'text/javascript')
    if (u.pathname === '/sporta-catalogue.js') return send(200, engineSource(), 'text/javascript')
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    const f = join(PUB, decodeURIComponent(u.pathname))
    if (/^\/(fonts|logo-white\.png)/.test(u.pathname) && !f.includes('..') && existsSync(f)) return send(200, readFileSync(f), u.pathname.endsWith('.png') ? 'image/png' : 'font/woff2')
    if (u.pathname.startsWith('/images/')) return send(404, 'no', 'text/plain')
    return send(200, pageHtml({ ar: u.searchParams.get('ar') === '1', screen: u.searchParams.get('screen') || 'catalogue' }), 'text/html; charset=utf-8', { 'content-security-policy': CSP })
  }
  return { st, handle }
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-admincat-'))
async function open(o = {}, { w = 1280, h = 900, ar = false, screen = 'catalogue' } = {}) {
  const shop = makeShop(o)
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', acceptDownloads: true })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {})
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/*', shop.handle)
  await pg.goto(`${ORIGIN}/backends?screen=${screen}${ar ? '&ar=1' : ''}`); await pg.waitForTimeout(800)
  return { ctx, pg, errors, shop }
}
const R = '[data-scp-root]'
const info = (file) => { const o = spawnSync('pdfinfo', [file], { encoding: 'utf8' }); const m = {}; String(o.stdout).split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim() }); return m }
const urlsOf = (file) => String(spawnSync('pdfinfo', ['-url', file], { encoding: 'utf8' }).stdout).split('\n').map((l) => /^\s*(\d+)\s+Annotation\s+(\S+)/.exec(l)).filter(Boolean).map((m) => m[2])
const ready = (pg) => pg.waitForFunction(() => document.querySelector('[data-scp="download"]') && !document.querySelector('[data-scp="download"]').disabled, null, { timeout: 15000 })

// ------------------------------------------------------------------------------------------------------ 1. the entry
head('the button and the dialog')
{
  const { pg, errors, shop } = await open()
  is(await pg.locator('[data-sporta-cpdf-open]').count() === 1 && /Catalogue PDF/.test(await pg.textContent('[data-sporta-cpdf-open]')), 'one "Catalogue PDF" button in the Catalogue screen header')
  is(!shop.st.calls.some((c) => c.includes('sporta-catalogue')), 'the engine is NOT downloaded until the dialog opens')
  await pg.goto(`${ORIGIN}/backends?screen=settings`); await pg.waitForTimeout(700)
  is(await pg.locator('[data-sporta-cpdf-open]').count() === 0, 'none on the Settings screen')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await open({}, { ar: true })
  is(await pg.locator('[data-sporta-cpdf-open]').count() === 1 && /كتالوج PDF/.test(await pg.textContent('[data-sporta-cpdf-open]')), 'the Arabic admin gets the Arabic button')
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R); await ready(pg)
  is(await pg.getAttribute(R, 'dir') === 'rtl' && /ملف PDF/.test(await pg.textContent(R)) && await pg.locator('[data-scp="lang-ar"]').isChecked(), 'the dialog is right to left, in Arabic, with Arabic chosen for the file')
}

// -------------------------------------------------------------------------------------------------- 2. read, download
head('the live catalogue and the download')
{
  const { pg, errors, shop } = await open()
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R); await ready(pg)
  const dlg = pg.locator(`${R} [role="dialog"]`)
  is(await dlg.getAttribute('aria-modal') === 'true' && await dlg.getAttribute('aria-labelledby') === 'scp-title' && await pg.locator('#scp-title').count() === 1, 'a modal dialog, labelled by its title')
  is(shop.st.calls.filter((c) => c.includes('sporta-catalogue')).length === 1, 'the engine is loaded once, when the dialog opens')
  const reads = shop.st.calls.filter((c) => c.startsWith('/api/api.php'))
  is(reads.length === 3 && ['products', 'stock', 'brands'].every((k) => reads.some((c) => c.includes('r=' + k))), 'the catalogue is read with three GETs: products, stock, brands', reads.join(' '))
  const sum = await pg.textContent(`${R} .scp-sum`)
  is(/Products: 19 · On sale: 2 · Sold out: 1/.test(sum), 'the summary counts the live shop (19 products, 2 on sale, 1 sold out)', sum)
  is(await pg.locator('[data-scp="lang-en"]').isChecked() && !(await pg.locator('[data-scp="lang-ar"]').isChecked()), 'the file language starts as the admin’s own (English)')
  await pg.click('[data-scp="refresh"]'); await ready(pg)
  is(shop.st.calls.filter((c) => c.startsWith('/api/api.php')).length === 6, '"Read again" reads the shop again')
  // English file
  const dl = pg.waitForEvent('download'); await pg.click('[data-scp="download"]')
  const busy = await pg.evaluate(() => ({ s: document.querySelector('[data-scp="status"]').textContent, dis: document.querySelector('[data-scp="download"]').disabled, rad: document.querySelector('[data-scp="lang-ar"]').disabled, rf: document.querySelector('[data-scp="refresh"]').disabled }))
  const d = await dl; const f = join(tmp, 'en.pdf'); await d.saveAs(f)
  is(/Preparing (page \d+ of 7|the PDF)/.test(busy.s) && busy.dis && busy.rad && busy.rf, 'while it works: the page being prepared is named and the controls are off', JSON.stringify(busy))
  is(/^Sporta-Catalogue-EN-\d{4}-\d{2}-\d{2}\.pdf$/.test(d.suggestedFilename()), 'the file is named for the language and the date', d.suggestedFilename())
  const I = info(f), U = urlsOf(f)
  is(I.Pages === '7' && I.Title === 'Product catalogue – Sporta', 'poppler reads it: 7 pages, the English title', JSON.stringify([I.Pages, I.Title]))
  is(U.filter((u) => /\/product\//.test(u)).length === 19 && U.filter((u) => u.endsWith('?lang=en')).length >= 19, 'a link for each of the 19 products (English links)')
  await pg.waitForFunction(() => /Ready: Sporta-Catalogue-EN/.test(document.querySelector('[data-scp="status"]').textContent))
  is(await pg.evaluate(() => !document.querySelector('[data-scp="download"]').disabled && !!document.querySelector('[data-scp="again"]') && /\d+(\.\d)? (kB|MB)/.test(document.querySelector('[data-scp="status"]').textContent)), 'afterwards: file name and size, controls back, "Download again"')
  const reads2 = shop.st.calls.filter((c) => c.startsWith('/api/api.php')).length
  const dl2 = pg.waitForEvent('download'); await pg.click('[data-scp="again"]'); const d2 = await dl2
  is(d2.suggestedFilename() === d.suggestedFilename() && shop.st.calls.filter((c) => c.startsWith('/api/api.php')).length === reads2, '"Download again" gives the same file and builds nothing')
  // Arabic file
  await pg.click('[data-scp="lang-ar"]')
  const dl3 = pg.waitForEvent('download'); await pg.click('[data-scp="download"]'); const d3 = await dl3; const f3 = join(tmp, 'ar.pdf'); await d3.saveAs(f3)
  is(/^Sporta-Catalogue-AR-/.test(d3.suggestedFilename()) && info(f3).Title === 'كتالوج المنتجات – Sporta' && urlsOf(f3).filter((u) => /\/product\//.test(u)).every((u) => !u.includes('lang=en')), 'the Arabic file: Arabic name, Arabic title, links without ?lang=en', d3.suggestedFilename())
  // addresses
  await ready(pg)
  const link = pg.locator(`${R} a.scp-link`)
  is(await link.count() === 1 && await link.getAttribute('href') === 'https://www.sporta.com.kw/catalogue' && await link.getAttribute('target') === '_blank' && /noopener/.test(await link.getAttribute('rel')), 'the public Catalogue page is a plain new-tab link, rel noopener noreferrer')
  const want = { page: 'https://www.sporta.com.kw/catalogue', pdfAr: 'https://www.sporta.com.kw/catalogue?pdf=ar', pdfEn: 'https://www.sporta.com.kw/catalogue?pdf=en' }
  for (const [k, v] of Object.entries(want)) {
    await pg.click(`[data-scp="copy-${k}"]`); await pg.waitForFunction((t) => document.querySelector(`[data-scp="copy-${k}"]`).textContent === 'Copied', null, { timeout: 4000 }).catch(() => {})
    is(await pg.evaluate(() => navigator.clipboard.readText()) === v, `copy puts exactly ${v} on the clipboard`)
  }
  is(shop.st.posts.length === 0 && shop.st.offHost.length === 0, 'READ ONLY: nothing but GET requests, none to another host', JSON.stringify([shop.st.posts, shop.st.offHost]))
  is(await pg.locator('#scp-style').count() === 1 && (await pg.locator('style[id^="scp"]').count()) === 1, 'one style element')
  // keyboard
  await pg.focus(`${R} .scp-x`); await pg.keyboard.press('Shift+Tab')
  const inside = await pg.evaluate(() => !!document.activeElement.closest('[data-scp-root]'))
  is(inside, 'Shift+Tab from the first control stays inside the dialog')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 0 && await pg.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sporta-cpdf-open')), 'Escape closes it and focus returns to the button')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

head('a failing read, a phone, Arabic')
{
  const { pg, shop } = await open({ fault: { products: 500 } })
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(`${R} .scp-btn`)
  await pg.waitForFunction(() => /could not be read/.test(document.querySelector('[data-scp-root]').innerText))
  is(await pg.locator('[data-scp="download"]').count() === 0, 'a failing read is said, and no download is offered')
  shop.st.fault = {}; await pg.click(`${R} .scp-btn`); await ready(pg)
  is(/Products: 19/.test(await pg.textContent(`${R} .scp-sum`)), '"Try again" recovers once the shop answers')
}
{
  const { pg } = await open({}, { w: 390, h: 844, ar: true })
  await pg.click('[data-sporta-cpdf-open]'); await pg.waitForSelector(R); await ready(pg)
  const m = await pg.evaluate(() => ({ sw: document.querySelector('[data-scp-root] .scp-dlg').scrollWidth - document.querySelector('[data-scp-root] .scp-dlg').clientWidth, pageSw: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: [...document.querySelectorAll('[data-scp-root] button, [data-scp-root] input[type=radio], [data-scp-root] .scp-radio')].map((e) => Math.round(e.getBoundingClientRect().height)) }))
  is(m.sw <= 0 && m.pageSw <= 0, 'no sideways scroll at 390 px (Arabic)', JSON.stringify(m))
  is(m.h.length >= 8 && m.h.every((x) => x >= 44 || x === 20), 'every control is at least 44 px tall (the radio box sits in a 44 px label)', m.h.join(','))
}

head('mutations')
const MUT = [
  ['without the download call', BRANDS_JS.replace("S.build = { state: 'done', name: res.name, bytes: res.bytes, res: res }; E.download(res)", "S.build = { state: 'done', name: res.name, bytes: res.bytes, res: res }"), async (pg) => { const w = pg.waitForEvent('download', { timeout: 6000 }).then(() => true, () => false); await pg.click('[data-scp="download"]'); return await w }],
  ['with a wrong engine address', BRANDS_JS.replace("s.src = '/sporta-catalogue.js'; s.async = true\n      s.onload = function () { if (window.SportaCatalogue) ok(", "s.src = '/sporta-catalogue-x.js'; s.async = true\n      s.onload = function () { if (window.SportaCatalogue) ok("), async (pg) => /Products: 19/.test(await pg.textContent(`${R} .scp-sum`).catch(() => ''))],
  ['with the file language ignored', BRANDS_JS.replace('lang: S.fileLang, signal: ctl', "lang: 'en', signal: ctl"), async (pg) => { await pg.click('[data-scp="lang-ar"]'); const w = pg.waitForEvent('download'); await pg.click('[data-scp="download"]'); return /AR-/.test((await w).suggestedFilename()) }],
  ['with the copy cut', BRANDS_JS.replace("navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(false) }); return", "done(false); return"), async (pg) => { await pg.click('[data-scp="copy-pdfAr"]'); await pg.waitForTimeout(300); return (await pg.evaluate(() => navigator.clipboard.readText())) === 'https://www.sporta.com.kw/catalogue?pdf=ar' }],
]
for (const [label, text, check] of MUT) {
  if (text === BRANDS_JS) { is(false, `mutation "${label}": the cut text was found`); continue }
  const t = await open({ js: text })
  await t.pg.click('[data-sporta-cpdf-open]'); await t.pg.waitForSelector(R)
  if (!/wrong engine/.test(label)) await ready(t.pg)
  else await t.pg.waitForFunction(() => /could not be read|Products/.test(document.querySelector('[data-scp-root]').innerText))
  let ok; try { ok = await check(t.pg) } catch (e) { ok = false }
  is(ok === false, `mutation "${label}": its check goes red`)
  await t.ctx.close()
}

await browser.close(); rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
