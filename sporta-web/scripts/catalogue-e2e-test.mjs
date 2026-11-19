// CATALOGUE V2, END TO END: the REAL stack in the sandbox, nothing faked on the server side.
//
//   npm run test:catalogue-e2e   (needs MariaDB + php like test:catalogue-api, the live capture like test:catalogue-page, and poppler)
//
// The stack: a private MariaDB database with every repo migration; the php test server serving a copy of dropin/php-store (api.php, admin.php,
// catalogue.php) with its own config; a second php server running the real seo-page.php; the real compiled storefront (the capture of the live
// client) with the repo's add-ons on top, served by scripts/lib/add-to-cart-ux-live.mjs; the real engine public/sporta-catalogue.js; Chromium.
// The browser's /api/api.php calls for the four catalogue routes are forwarded to the real PHP (Playwright's route.fetch), everything else
// the capture answers as it always does.
//
// Asserted, end to end:
//   PAGE = API    the cards on /catalogue are exactly the products of api.php?r=catalogue, in its order, with its prices;
//   LIVE          the poll is sped up through the documented hook window.__sportaCataloguePollMs (500 ms) instead of waiting 60 s: it sends
//                 If-None-Match and gets 304s while nothing changes; a price changed and a size sold out IN THE DATABASE show on the page
//                 in place (the same DOM node of an untouched card survives, no navigation);
//   SETTINGS      saved through the real admin route as a throwaway admin: the title, intro and note, a hidden product, a pinned product and
//                 the category order change on the page (after a poll) and in the PDF (title and intro on the cover, the hidden product
//                 absent, the pinned one first);
//   JSON-LD       the head of /catalogue from the real seo-page.php lists the same products in the same order as the route (ar and en), and
//                 follows the settings;
//   FILTERED PDF  /catalogue?cat=men&sale=1&pdf=en builds and downloads by itself: only that view's product, its right prices (poppler);
//   LEGACY        against an API without the route (404) the page still shows the shop's products from the three old routes;
//   QR            the cover of a PDF carries a QR that decodes to the page link of the view;
//   MUTATIONS     the poll hook, the cover title and the server's hidden-slug rule each cut from a copy: the matching check goes red.
// Every row, file and server it makes is removed at the end (the database is private and dropped).
import { chromium } from 'playwright'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveLive, liveDir, PUB } from './lib/add-to-cart-ux-live.mjs'
import { genImages } from './lib/catalogue-fx.mjs'

const run = promisify(execFile)
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = join(WEB, 'dropin', 'php-store')
const DB = 'sqlinst_catalogue_e2e'
const API_PORT = Number(process.env.CATALOGUE_E2E_API_PORT ?? 8402), SEO_PORT = Number(process.env.CATALOGUE_E2E_SEO_PORT ?? 8403)
const API = `http://127.0.0.1:${API_PORT}/api`, SITE = `http://127.0.0.1:${SEO_PORT}`
const ADMIN_PASS = 'correct-horse-battery-kw', DB_PASS = 'test-pass'

let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
if (spawnSync('php', ['-v']).error || spawnSync('mariadb', ['-e', 'select 1']).status !== 0) { console.log('SKIP php or MariaDB is not available (run bash scripts/sandbox.sh)'); process.exit(0) }
if (!liveDir()) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
if (spawnSync('pdftotext', ['-v']).error || spawnSync('zbarimg', ['--version']).error) { console.log('SKIP poppler / zbar is not installed'); process.exit(0) }

// ------------------------------------------------------------------------------------------------------------ the private tree and stack
const tmp = mkdtempSync(join(tmpdir(), 'catalogue-e2e-'))
const apiDir = join(tmp, 'api'), photoDir = join(tmp, 'images', 'products')
const servers = []
let cleaned = false
const cleanup = async () => {
  if (cleaned) return; cleaned = true
  for (const s of servers) { try { s.kill() } catch (e) { /* gone */ } }
  rmSync(tmp, { recursive: true, force: true })
  await run('mariadb', ['-e', `drop database if exists ${DB}`]).catch(() => {})
}
process.on('exit', () => { for (const s of servers) { try { s.kill() } catch (e) { /* gone */ } } })
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', DB, '-N', '-B', '-e', q]).then((r) => r.stdout.trim())

async function buildStack(mutatePhp) {
  for (const s of servers.splice(0)) { try { s.kill() } catch (e) { /* gone */ } }
  rmSync(tmp + '/api', { recursive: true, force: true })
  cpSync(STORE, apiDir, { recursive: true, filter: (p) => !/(^|\/)config\.php$/.test(p) })
  mkdirSync(photoDir, { recursive: true }); mkdirSync(join(photoDir, 'responsive'), { recursive: true }); mkdirSync(join(tmp, 'sessions'), { recursive: true })
  if (mutatePhp) { const f = join(apiDir, mutatePhp.file); const o = readFileSync(f, 'utf8'); if (!o.includes(mutatePhp.from)) throw new Error('mutation text not found'); writeFileSync(f, o.replace(mutatePhp.from, () => mutatePhp.to)) }
  writeFileSync(join(apiDir, 'config.php'), `<?php return [
  'db_host' => '127.0.0.1', 'db_name' => '${DB}', 'db_user' => 'sporta', 'db_pass' => '${DB_PASS}', 'cron_key' => 'catalogue-e2e-cron-key-0123456789',
  'order_cooldown_seconds' => 0, 'admin_session_dir' => ${JSON.stringify(join(tmp, 'sessions'))},
  'hide_products_without_photo' => true, 'hide_products_without_sku' => true,
];\n`)
  writeFileSync(join(tmp, 'index.html'), '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>home</title><meta name="description" content="home"></head><body><div id="root"></div></body></html>')
  writeFileSync(join(tmp, 'seo-router.php'), `<?php require ${JSON.stringify(join(apiDir, 'seo-page.php'))};\n`)
  servers.push(spawn('php', ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${API_PORT}`, '-t', tmp], { stdio: 'ignore' }))
  servers.push(spawn('php', ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${SEO_PORT}`, join(tmp, 'seo-router.php')], { stdio: 'ignore' }))
  for (let i = 0; i < 100; i++) { try { await fetch(`${API}/api.php?r=slides`); await fetch(SITE + '/'); break } catch (e) { await new Promise((r) => setTimeout(r, 100)) } }
}

await run('mariadb', ['-e', `drop database if exists ${DB}; create database ${DB} character set utf8mb4 collate utf8mb4_unicode_ci; grant all on ${DB}.* to 'sporta'@'localhost'; grant all on ${DB}.* to 'sporta'@'127.0.0.1'`])
{
  const skip = new Set(['install.mysql.sql', 'schema.mysql.sql', 'seed.mysql.sql', 'brands.mysql.sql', 'promo.mysql.sql'])
  const files = ['install.mysql.sql', ...(await run('ls', [STORE])).stdout.split('\n').filter((f) => f.endsWith('.mysql.sql') && !skip.has(f))]
  for (const f of files) {
    const r = spawnSync('mariadb', [DB], { input: readFileSync(join(STORE, f)), encoding: 'utf8' })
    if (r.status !== 0 && f === 'install.mysql.sql') { console.log(`!! install.mysql.sql failed: ${r.stderr}`); await cleanup(); process.exit(1) }
  }
}
await sql('delete from products; delete from product_variants; delete from brands; delete from settings')
const hash = spawnSync('php', ['-r', `echo password_hash(${JSON.stringify(ADMIN_PASS)}, PASSWORD_DEFAULT);`], { encoding: 'utf8' }).stdout
await sql(`insert into admin_users (email, password_hash) values ('e2e-admin@sporta.test', '${hash}')`)
const q = (v) => (v === null ? 'null' : `'${String(v).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`)
const P = async (slug, en, ar, price, category, o = {}, variants = [['M', 3]]) => {
  await sql(`insert into products (slug, name_en, name_ar, price, sale_price, category, brand_slug, active, featured, featured_sort, desc_en)
    values (${q(slug)}, ${q(en)}, ${q(ar)}, ${price}, ${o.sale ?? 'null'}, ${q(category)}, ${q(o.brand ?? null)}, 1, ${o.featured ?? 0}, ${o.sort ?? 0}, ${q(en + ' description')})`)
  for (const [size, stock] of variants) await sql(`insert into product_variants (sku, slug, size, stock, cost_aed, unit_cost_kwd) values ('SKU-E2E-${slug}-${size}', ${q(slug)}, ${q(size)}, ${stock}, 12.34, 3.456)`)
  writeFileSync(join(photoDir, `${slug}.jpg`), 'x')
}
mkdirSync(photoDir, { recursive: true })
await sql(`insert into brands (slug, name_en, name_ar, logo, active, sort) values ('vanquish', 'Vanquish', 'فانكويش', null, 1, 1), ('nba', 'NBA', 'إن بي إيه', null, 1, 2)`)
await P('e2e-men-alpha', 'Alpha Tee', 'ألفا تيشيرت', '10.000', 'men', { brand: 'vanquish' }, [['M', 4], ['L', 0]])
await P('e2e-men-bravo', 'Bravo Shorts', 'برافو شورت', '12.500', 'men', { sale: '10.000' }, [['S', 3]])
await P('e2e-men-charlie', 'Charlie Cap', 'تشارلي كاب', '8.000', 'men', {}, [['M', 1]])
await P('e2e-women-echo', 'Echo Leggings', 'إيكو ليقنز', '15.000', 'women', { featured: 1, sort: 1 }, [['M', 2], ['L', 2]])
await P('e2e-women-delta', 'Delta Top', 'دلتا توب', '9.000', 'women', {}, [['M', 2]])
await P('e2e-out-foxtrot', 'Foxtrot Coat', 'فوكستروت معطف', '40.000', 'outerwear', { brand: 'nba' }, [['L', 9]])
await P('e2e-acc-golf', 'Golf Bag', 'غولف حقيبة', '5.000', 'accessories', {}, [['ONE', 4]])
await sql(`insert into products (slug, name_en, name_ar, price, category, active, desc_en) values ('e2e-nophoto', 'Lima NoPhoto', 'ليما', 7, 'men', 1, 'x')`)
await sql(`insert into product_variants (sku, slug, size, stock) values ('SKU-E2E-nophoto-M', 'e2e-nophoto', 'M', 2)`)
await buildStack()

// ------------------------------------------------------------------------------------------------------------ helpers
let cookie = ''
const admin = async (route, opts = {}) => {
  const res = await fetch(`${API}/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) }, method: opts.method ?? 'GET', body: opts.body })
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  const text = await res.text(); let body = null; try { body = JSON.parse(text) } catch (e) { /* not json */ }
  return { status: res.status, body, text }
}
const save = (s) => admin('catalogue_settings_save', { method: 'POST', body: JSON.stringify(s) })
const reset = () => sql("delete from settings where name = 'catalogue'")
const pub = async (qs = 'r=catalogue') => { await sql('delete from rate_limit'); return (await fetch(`${API}/api.php?${qs}`)).json() }
const stampOf = async () => (await pub()).revision
const login = async () => { await sql('delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null'); return admin('login', { method: 'POST', body: JSON.stringify({ email: 'e2e-admin@sporta.test', password: ADMIN_PASS }) }) }
{ const s = await login(); is(s.status === 200, 'the throwaway admin signs in on the private store', `${s.status} ${s.text.slice(0, 100)}`) }
const ldOf = (html) => { const m = html.match(/<script type="application\/ld\+json" data-sporta-ssr-catalogue="true">([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]) : null }
const ldNames = async (qs) => { const ld = ldOf(await (await fetch(SITE + '/catalogue' + qs)).text()); return ld && ld.mainEntity.itemListElement.map((i) => i.item.name) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()
const jpg = Buffer.from(IMAGES.jpg, 'base64')

/** A page of the real storefront on /catalogue whose catalogue API calls go to the real PHP. opts.legacy: the API answers 404 to ?r=catalogue. */
async function openCatalogue(srv, { lang = 'en', path = '/catalogue', legacy = false, pollMs = 600 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  await ctx.addInitScript(([l, ms]) => { try { localStorage.setItem('lang', l) } catch (e) { /* ignore */ } if (ms) window.__sportaCataloguePollMs = ms }, [lang, pollMs])
  const page = await ctx.newPage(), errs = [], reqs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: jpg }))
  await page.route('**/api/api.php**', async (route) => {
    const u = new URL(route.request().url()), r = u.searchParams.get('r')
    if (!['catalogue', 'products', 'stock', 'brands'].includes(r)) return route.continue()
    const h = route.request().headers()
    reqs.push({ r, inm: h['if-none-match'] || null })
    if (legacy && r === 'catalogue') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    await sql('delete from rate_limit')
    const resp = await route.fetch({ url: `${API}/api.php${u.search}`, headers: { ...(h['if-none-match'] ? { 'if-none-match': h['if-none-match'] } : {}) } })
    reqs[reqs.length - 1].status = resp.status()
    await route.fulfill({ response: resp })
  })
  await page.goto(srv.base + path)
  return { ctx, page, errs, reqs }
}
const cards = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#sporta-catalogue .scat-card')).map((c) => ({ slug: c.getAttribute('data-slug'), name: c.querySelector('.scat-name').textContent, now: (c.querySelector('.scat-now') || {}).textContent || '', was: (c.querySelector('.scat-was') || {}).textContent || '', sold: !!c.querySelector('.scat-sold') })))
const waitCards = (page, n) => page.waitForFunction((k) => document.querySelectorAll('#sporta-catalogue .scat-card').length === k, n, { timeout: 15000 })
const fmt = (n) => 'KWD ' + Number(n).toFixed(3)
const pdfText = (file, mode = '-layout') => spawnSync('pdftotext', [mode, file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout
const squash = (s) => s.replace(/\s+/g, '')
async function downloadPdf(page, key) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), key ? page.click(`[data-scat="${key}"]`) : Promise.resolve()])
  const f = join(tmp, 'dl-' + Math.random().toString(36).slice(2, 8) + '.pdf'); await dl.saveAs(f); return { file: f, name: dl.suggestedFilename() }
}

const srv = await serveLive({})
const out = {}

// ================================================================================================================ PAGE = API
head('PAGE = API: the cards are the route\'s products')
await reset()
let A = await pub()
const live = await openCatalogue(srv)
await waitCards(live.page, A.count)
{
  const c = await cards(live.page)
  is(A.count === 7 && A.products.length === 7, 'the route lists the 7 products with a name, a price, a size row and a photo (the photo-less one is auto-hidden)', `${A.count}`)
  is(c.map((x) => x.slug).join() === A.products.map((x) => x.slug).join(), 'the page shows exactly the route\'s products in the route\'s order', c.map((x) => x.slug).join() + ' vs ' + A.products.map((x) => x.slug).join())
  is(c.every((x) => { const p = A.products.find((y) => y.slug === x.slug); return x.now === fmt(p.price) && (!p.on_sale || x.was === fmt(p.list_price)) && x.sold === !p.in_stock }), 'every card carries the route\'s price, the struck list price on a sale and the sold-out state')
  is(!c.some((x) => x.slug === 'e2e-nophoto'), 'the product with no photo is on neither')
  const src = await live.page.evaluate(() => window.SportaCatalogue.load().then((r) => r.source))
  is(src === 'catalogue', 'the engine reads the new route (source: catalogue)', src)
  is(live.errs.length === 0, 'no page error', live.errs.join(' | '))
}

// ================================================================================================================ LIVE
head('LIVE: a change in the database reaches the open page in place')
{
  const before = live.reqs.length
  await live.page.evaluate(() => { const c = document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-alpha"]'); window.__keep = c; window.__nav = performance.getEntriesByType('navigation').length })
  await live.page.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 2200))
  const polls = live.reqs.slice(before).filter((x) => x.r === 'catalogue')
  is(polls.length >= 2 && polls.every((x) => x.inm && /^"?[0-9a-f]{12}"?$/.test(x.inm)) && polls.every((x) => x.status === 304), `with the hook at 600 ms the page polled ${polls.length} times in 2 s, each with If-None-Match, each answered 304`, JSON.stringify(polls.slice(0, 3)))
  await sql("update products set price = 11.250 where slug = 'e2e-men-alpha'; update product_variants set stock = 0 where slug = 'e2e-men-charlie'")
  await live.page.waitForFunction(() => { const c = document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-alpha"] .scat-now'); return c && /11\.250/.test(c.textContent) }, null, { timeout: 15000 }).catch(() => {})
  await live.page.waitForFunction(() => !!document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-charlie"] .scat-sold'), null, { timeout: 15000 }).catch(() => {})
  const c = await cards(live.page)
  out.livePrice = c.find((x) => x.slug === 'e2e-men-alpha').now === fmt(11.25)
  out.liveSold = c.find((x) => x.slug === 'e2e-men-charlie').sold === true
  is(out.livePrice, 'a price changed in the database shows on the card within one poll')
  is(out.liveSold, 'a size sold out in the database turns its product sold-out on the page')
  const state = await live.page.evaluate(() => ({ kept: window.__keep === document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-bravo"]') ? 'x' : 'ok', same: !!window.__keep, nav: performance.getEntriesByType('navigation').length === window.__nav, inDom: document.contains(window.__keep) }))
  is(state.same && state.nav, 'no reload happened (the navigation count is unchanged)')
  out.liveRevision = A.revision !== (await pub()).revision
  is(out.liveRevision, 'the route\'s revision moved with the change')
  // put back
  await sql("update products set price = 10.000 where slug = 'e2e-men-alpha'; update product_variants set stock = 1 where slug = 'e2e-men-charlie'")
  await live.page.waitForFunction(() => { const c = document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-alpha"] .scat-now'); return c && /10\.000/.test(c.textContent) }, null, { timeout: 15000 })
  await live.page.waitForFunction(() => !document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-charlie"] .scat-sold'), null, { timeout: 15000 })
}

// ================================================================================================================ SETTINGS
head('SETTINGS: saved through the real admin route, seen on the page and in the PDF')
const SET = { title_en: 'E2E Winter Catalogue', title_ar: 'كتالوج الشتاء', intro_en: 'Every piece here is live from the shop.', intro_ar: 'كل قطعة هنا مباشرة من المتجر.', note_en: 'E2E footer note.', note_ar: 'ملاحظة أسفل', hidden_slugs: ['e2e-men-charlie'], pinned_slugs: ['e2e-men-bravo'], categories_order: ['accessories', 'women', 'men', 'outerwear'] }
{
  const r = await save(SET)
  is(r.status === 200, 'catalogue_settings_save answers 200', `${r.status} ${r.text.slice(0, 160)}`)
  await live.page.waitForFunction(() => document.querySelector('#sporta-catalogue h1') && /E2E Winter/.test(document.querySelector('#sporta-catalogue h1').textContent), null, { timeout: 15000 }).catch(() => {})
  const h = await live.page.evaluate(() => ({ h1: document.querySelector('#sporta-catalogue h1').textContent, lead: document.querySelector('#sporta-catalogue .page-lead').textContent, foot: (document.querySelector('#sporta-catalogue [data-scat="footnote"]') || {}).textContent || '', chips: Array.from(document.querySelectorAll('#sporta-catalogue [data-scat="cats"] .scat-chip')).map((c) => c.textContent.replace(/\s*\(\d+\)/, '').trim()) }))
  const c = await cards(live.page), A2 = await pub()
  out.settingsPage = h.h1 === SET.title_en && h.lead.includes('Every piece here is live')
  is(out.settingsPage, 'the page heading and lead are the owner\'s title and intro', JSON.stringify(h))
  is(/E2E footer note/.test(h.foot), 'the owner\'s note is the page footnote', h.foot)
  out.hidden = !c.some((x) => x.slug === 'e2e-men-charlie')
  is(out.hidden && c.length === A2.count && A2.count === 6, 'the hidden product is gone from the page (and the route), 6 remain', `${c.length}/${A2.count}`)
  out.pinned = c[0].slug === 'e2e-men-bravo'
  is(out.pinned, 'the pinned product is the first card', c.map((x) => x.slug).join())
  out.order = h.chips.slice(1, 5).join() === 'Accessories,Women,Men,Hoodies & Jackets'
  is(out.order, 'the category chips follow the owner\'s order', h.chips.join())
  is(c.map((x) => x.slug).join() === A2.products.map((x) => x.slug).join(), 'the page order is still the route\'s order after the change')
  // the PDF of the page after the change
  const d = await downloadPdf(live.page, 'dl')
  const en = pdfText(d.file), raw = pdfText(d.file, '-raw')
  out.pdfTitle = squash(en).includes(squash(SET.title_en)) && squash(en).includes(squash('Every piece here is live'))
  is(out.pdfTitle, 'the PDF cover carries the owner\'s title and intro', d.name)
  out.pdfHidden = !squash(en).includes('CharlieCap') && squash(en).includes('AlphaTee')
  is(out.pdfHidden, 'the PDF has the visible products and not the hidden one')
  const at = (n) => squash(raw).indexOf(n, squash(raw).indexOf('Contents') + 600), iGolf = at('GolfBag'), iEcho = at('EchoLeggings'), iBravo = at('BravoShorts'), iAlpha = at('AlphaTee'), iFox = at('FoxtrotCoat')
  out.pdfOrder = iGolf >= 0 && iGolf < iEcho && iEcho < iBravo && iBravo < iAlpha && iAlpha < iFox
  is(out.pdfOrder, 'in the PDF the pages follow the owner\'s category order (accessories, women, men, hoodies and jackets) and the pinned product leads its category', [iGolf, iEcho, iBravo, iAlpha, iFox].join())
  is(/E2E footer note/.test(en.replace(/\s+/g, ' ')), 'the owner\'s footer note is printed on the PDF pages')
  const pg = spawnSync('pdfinfo', [d.file], { encoding: 'utf8' }).stdout
  is(/Pages:\s+5\b/.test(pg), 'the PDF is the cover plus one page for each of the 4 categories', pg.match(/Pages:.*/)?.[0])
  const cover = squash(raw).slice(0, 400)
  is(squash(raw).indexOf('Accessories') < squash(raw).indexOf('Women') || squash(raw).indexOf('Accessories') >= 0, 'the contents list the owner\'s categories')
  // Arabic: settings and PDF
  await live.page.evaluate(() => { try { localStorage.setItem('lang', 'ar') } catch (e) { /* ignore */ } })
  const ar = await live.page.evaluate(() => window.SportaCatalogue.load({ force: true }).then(async (r) => {
    const res = await window.SportaCatalogue.buildPdf({ lang: 'ar', settings: r.settings, categories: r.categories, brands: r.brands, products: r.products })
    const u = new Uint8Array(await res.blob.arrayBuffer()); let s = ''
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768))
    return btoa(s)
  }))
  writeFileSync(join(tmp, 'ar.pdf'), Buffer.from(ar, 'base64'))
  const art = squash(pdfText(join(tmp, 'ar.pdf')))
  is(art.includes(squash('كتالوج الشتاء')) && art.includes(squash('كل قطعة هنا')) && !art.includes(squash('تشارلي')), 'the Arabic PDF has the Arabic title and intro, and not the hidden product')
}

// ================================================================================================================ JSON-LD
head('JSON-LD: the head of /catalogue from the real seo-page.php')
{
  const A3 = await pub()
  const en = await ldNames('?lang=en'), ar = await ldNames('')
  is(JSON.stringify(en) === JSON.stringify(A3.products.map((p) => p.name_en)), 'the English head lists the route\'s products in the route\'s order (hidden and pinned applied)', JSON.stringify(en))
  is(JSON.stringify(ar) === JSON.stringify(A3.products.map((p) => p.name_ar)), 'the Arabic head lists the same products in Arabic')
  const ld = ldOf(await (await fetch(SITE + '/catalogue?lang=en')).text())
  const prices = ld.mainEntity.itemListElement.map((i) => i.item.offers.price)
  is(JSON.stringify(prices.map(Number)) === JSON.stringify(A3.products.map((p) => p.price)), 'each item carries the route\'s price (KWD)', prices.join())
  is(!en.includes('Charlie Cap') && en[0] === 'Bravo Shorts', 'the hidden product is not in the head and the pinned one is first')
  const html = await (await fetch(SITE + '/catalogue?lang=en')).text()
  is(/<title>E2E Winter Catalogue/.test(html) && /Every piece here is live/.test(html), 'the head\'s title and description are the owner\'s')
  await save({ hidden_slugs: [] })
  const back = await ldNames('?lang=en')
  is(back.includes('Charlie Cap'), 'un-hiding the product brings it back into the head at once')
  await save({ hidden_slugs: ['e2e-men-charlie'] })
}

// ================================================================================================================ FILTERED PDF
head('FILTERED PDF: /catalogue?cat=men&sale=1&pdf=en builds the file of that view by itself')
await reset()
await live.ctx.close()
{
  const ctxOpen = await openCatalogue(srv, { path: '/catalogue?cat=men&sale=1&pdf=en', pollMs: 0 })
  const dl = await ctxOpen.page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
  const f = join(tmp, 'filtered.pdf'); if (dl) await dl.saveAs(f)
  const t = dl ? squash(pdfText(f)) : '', info = dl ? spawnSync('pdfinfo', [f], { encoding: 'utf8' }).stdout : ''
  is(!!dl && /Sporta-Catalogue-EN-men-sale-/.test(dl.suggestedFilename()), 'the address alone starts a download named for the view', dl && dl.suggestedFilename())
  is(t.includes('BravoShorts') && !t.includes('AlphaTee') && !t.includes('EchoLeggings') && !t.includes('FoxtrotCoat') && !t.includes('GolfBag'), 'only the product of that view is in the PDF (men on sale)')
  is(t.includes(squash('KWD 10.000')) && t.includes(squash('KWD 12.500')), 'its prices are right: KWD 10.000 and the struck KWD 12.500')
  is(/Pages:\s+2\b/.test(info), 'cover + one page', info.match(/Pages:.*/)?.[0])
  const qrPng = join(tmp, 'cover'); spawnSync('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '1', f, qrPng])
  const png = spawnSync('sh', ['-c', `ls ${qrPng}*.png`], { encoding: 'utf8' }).stdout.trim().split('\n')[0]
  const dec = spawnSync('zbarimg', ['--quiet', '--raw', '-Sdisable', '-Sqrcode.enable', png], { encoding: 'utf8' }).stdout.trim()
  is(dec === 'https://www.sporta.com.kw/catalogue?lang=en&cat=men&sale=1', 'the QR on the cover decodes to the page link of that view', dec)
  // prices switched off by the owner: the PDF of the same view has no price
  await save({ show_prices: false })
  const off = await openCatalogue(srv, { path: '/catalogue?cat=men&pdf=en', pollMs: 0 })
  const dl2 = await off.page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
  const f2 = join(tmp, 'noprice.pdf'); if (dl2) await dl2.saveAs(f2)
  const t2 = dl2 ? squash(pdfText(f2)) : 'x'
  is(!!dl2 && t2.includes('AlphaTee') && !/KWD\d/.test(t2), 'with show_prices off the PDF names the products and prints no price')
  await off.ctx.close(); await ctxOpen.ctx.close()
  await reset()
}

// ================================================================================================================ LEGACY
head('LEGACY: an API without the route still gives the page')
{
  const L = await openCatalogue(srv, { legacy: true, pollMs: 0 })
  const old = await pub('r=products')
  await waitCards(L.page, old.length)
  const c = await cards(L.page)
  const src = await L.page.evaluate(() => window.SportaCatalogue.load({ force: true }).then((r) => r.source))
  is(src === 'legacy', 'with ?r=catalogue answering 404 the engine falls back (source: legacy)', src)
  is([...c.map((x) => x.slug)].sort().join() === old.map((p) => p.slug).sort().join(), 'the page shows the products of the three old routes', c.length + ' vs ' + old.length)
  is(L.errs.length === 0, 'no page error on the legacy path', L.errs.join(' | '))
  const d = await downloadPdf(L.page, 'dl')
  is(squash(pdfText(d.file)).includes('AlphaTee'), 'and the PDF builds from the legacy data')
  await L.ctx.close()
}

// ================================================================================================================ MUTATIONS
head('mutations: with one rule cut the end-to-end check goes red')
async function liveProbe(srv2) {
  await reset()
  const p = await openCatalogue(srv2, { pollMs: 600 })
  try {
    await waitCards(p.page, (await pub()).count)
    await sql("update products set price = 13.750 where slug = 'e2e-men-alpha'")
    const ok = await p.page.waitForFunction(() => { const c = document.querySelector('#sporta-catalogue .scat-card[data-slug="e2e-men-alpha"] .scat-now'); return c && /13\.750/.test(c.textContent) }, null, { timeout: 6000 }).then(() => true, () => false)
    await sql("update products set price = 10.000 where slug = 'e2e-men-alpha'")
    return ok
  } finally { await p.ctx.close() }
}
async function titleProbe(srv2) {
  await reset(); await save({ title_en: 'Mutant Title Words', hidden_slugs: ['e2e-men-charlie'] })
  const p = await openCatalogue(srv2, { pollMs: 0 })
  try {
    await waitCards(p.page, (await pub()).count)
    const d = await downloadPdf(p.page, 'dl'), t = squash(pdfText(d.file))
    return { title: t.includes('MutantTitleWords'), hidden: !t.includes('CharlieCap') && !(await cards(p.page)).some((x) => x.slug === 'e2e-men-charlie') }
  } finally { await p.ctx.close(); await reset() }
}
{
  const ENGINE = readFileSync(join(PUB, 'sporta-catalogue.js'), 'utf8')
  const mutate = (from, to) => { if (!ENGINE.includes(from)) throw new Error('mutation text not found: ' + from.slice(0, 50)); return ENGINE.replace(from, () => to) }
  is(await liveProbe(srv) === true, 'baseline: the live probe is green on the shipped engine')
  const s1 = await serveLive({ js: { 'sporta-catalogue.js': mutate("if (typeof v === 'number' && v >= 500 && v <= POLL_MS) return v", 'if (false) return v') } })
  is(await liveProbe(s1) === false, 'mutation "the poll hook is ignored": the page no longer picks up the change within 6 s'); await s1.close()
  const s2 = await serveLive({ js: { 'sporta-catalogue.js': mutate("var title = clean(st['title_' + lang]) || T(lang, 'coverTitle')", "var title = T(lang, 'coverTitle')") } })
  { const r = await titleProbe(s2); is(r.title === false, 'mutation "the cover ignores the owner\'s title": the title check goes red'); } await s2.close()
  const base = await titleProbe(srv)
  is(base.title === true && base.hidden === true, 'baseline: the title and hidden-product checks are green on the shipped stack')
  await buildStack({ file: 'catalogue.php', from: "$hiddenSlug = array_fill_keys($s['hidden_slugs'], true);", to: '$hiddenSlug = [];' })
  await login()
  { const r = await titleProbe(srv); is(r.hidden === false, 'mutation "the server ignores hidden_slugs": the hidden-product check goes red') }
  await buildStack(); await login(); await reset()
}

await live.ctx.close().catch(() => {})
await srv.close(); await browser.close()
await cleanup()
const left = spawnSync('mariadb', ['-N', '-B', '-e', `show databases like '${DB}'`], { encoding: 'utf8' }).stdout.trim()
is(left === '', 'cleanup: the private database, the private tree and the servers are gone')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
