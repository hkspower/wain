// The LIVE PAGE CHECK card of the SEO screen (2026-11-19, owner: "make seo data fetching"): the ADMIN SEO LIVE CHECK block of public/sporta-admin-brands.js,
// in a real browser, against a fake shop that answers like the real one (robots.txt, a sitemap index with two sitemaps, pages with and without their SEO tags).
//
//   npm run test:admin-seo-check
//
// Asserted:
//   - the card sits under the SEO Editor's header (and under the Site icon card when that is there), only on that screen, once; it makes NO request until the
//     button is pressed and none to /api/admin.php at all (read-only, keyless);
//   - a run reads robots.txt, sitemap.xml, both child sitemaps and every listed page once, with GET, four at a time at most, WITHOUT the admin cookie;
//   - a healthy shop is all "fine"; every problem a page can have is found and named (status, redirect, title, description, canonical off / http, noindex in the
//     tag and in the X-Robots-Tag header, language versions, social tags, invalid JSON-LD, page language, shared titles and descriptions); the files too
//     (robots blocking everything, no sitemap line, /backends not kept out, a sitemap that is missing, broken, empty, with a child that fails, a date in the
//     future, an address twice); an unreadable sitemap falls back to the main pages;
//   - the list shows problems first, can be cut to pages with problems, each row opens to the values that were read; the report copies as text;
//   - Stop (and leaving the screen) cancels the requests in flight and shows nothing from them;
//   - Arabic is right to left; light and dark are readable (4.5:1); the phone layout has no sideways scroll and every control is 44 px;
//   - MUTATIONS: with the cookie sent, without the canonical rule, without the Stop rule, without the shared-title rule, the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FULL = readFileSync(process.env.SEO_CHECK_SRC || join(ROOT, 'public', 'sporta-admin-brands.js'), 'utf8')
// The block alone is what the page gets (the other blocks of the file belong to the compiled admin and would add their own requests to the count).
const at = FULL.indexOf('/* ===== ADMIN SEO LIVE CHECK - begin'), to = FULL.indexOf('/* ===== ADMIN SEO LIVE CHECK - end')
if (at < 0 || to < at) { console.log('FAIL the ADMIN SEO LIVE CHECK block is not in public/sporta-admin-brands.js'); process.exit(1) }
const SRC = FULL.slice(at, FULL.indexOf('*/', to) + 2)
let pass = 0, fail = 0
const is = (c, n, d = '') => { if (c) { pass++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fail++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const ORIGIN = 'https://www.sporta.com.kw'

// ---- the fake shop
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`
// a page; `o` overrides any part. loc = the address as the sitemap lists it
function page(loc, o = {}) {
  const u = new URL(loc), en = u.searchParams.get('lang') === 'en', base = ORIGIN + u.pathname
  const title = o.title === undefined ? `Sporta | ${u.pathname}${en ? ' EN' : ''}` : o.title
  const desc = o.desc === undefined ? `Premium sportswear from Sporta, delivered across Kuwait. Page ${u.pathname} in ${en ? 'English' : 'Arabic'}.` : o.desc
  const canon = o.canon === undefined ? ORIGIN + u.pathname + u.search : o.canon
  const alts = o.alts === false ? '' : `<link rel="alternate" hreflang="ar" href="${base}"><link rel="alternate" hreflang="en" href="${base}?lang=en"><link rel="alternate" hreflang="x-default" href="${base}">`
  const og = o.og === false ? '' : `<meta property="og:title" content="${title || 'x'}"><meta property="og:description" content="${desc || 'x'}"><meta property="og:image" content="${ORIGIN}/og.png"><meta property="og:locale" content="${en ? 'en_US' : 'ar_AR'}">`
  const robots = o.robots ? `<meta name="robots" content="${o.robots}">` : ''
  const jsonld = o.ld === undefined ? ld({ '@context': 'https://schema.org', '@type': 'WebPage', name: title || 'x' }) : o.ld
  return `<!doctype html><html lang="${o.lang || (en ? 'en' : 'ar')}"><head><meta charset="utf-8">${title === null ? '' : `<title>${title}</title>`}${desc === null ? '' : `<meta name="description" content="${desc}">`}${canon === null ? '' : `<link rel="canonical" href="${canon}">`}${alts}${og}${robots}${jsonld}</head><body><div id="root"></div></body></html>`
}
const urlset = (locs, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${ORIGIN}${l}</loc>${extra}</url>`).join('')}</urlset>`
const index = (kids) => `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${kids.map((k) => `<sitemap><loc>${ORIGIN}${k}</loc></sitemap>`).join('')}</sitemapindex>`
const ROBOTS_OK = 'User-agent: *\nDisallow: /backends\nDisallow: /api/\n\nSitemap: https://www.sporta.com.kw/sitemap.xml\n'
// the healthy shop: 4 pages in two sitemaps
function healthy() {
  const A = ['/', '/?lang=en'], B = ['/shop', '/shop?lang=en']
  const site = {
    '/robots.txt': { type: 'text/plain', body: ROBOTS_OK },
    '/sitemap.xml': { type: 'application/xml', body: index(['/sitemap-pages.xml', '/sitemap-products.xml']) },
    '/sitemap-pages.xml': { type: 'application/xml', body: urlset(A) },
    '/sitemap-products.xml': { type: 'application/xml', body: urlset(B) }
  }
  for (const l of [...A, ...B]) site[l] = { type: 'text/html', body: page(ORIGIN + l) }
  return site
}
const SHELL = ({ rtl = false, dark = false, screen = 'seo', icon = false } = {}) => `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}" ${dark ? 'class="dark" data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui,sans-serif;background:${dark ? '#0f1419' : '#f4f1ec'};color:${dark ? '#eef2f5' : '#18212a'}}main{padding:1rem;max-width:64rem;margin:0 auto}</style></head><body><main>
${screen === 'seo' ? `<section class="admin-page seo-editor"><div class="admin-page-header"><h1>SEO Editor</h1></div>${icon ? '<section data-sporta-sic style="border:1px solid #ccc;padding:1rem;margin-bottom:1rem">Site icon card</section>' : ''}<div class="seo-body"><p>pages and products</p></div></section>` : '<section class="admin-page"><div class="admin-page-header"><h1>Overview</h1></div></section>'}
</main></body></html>`

async function open(W, { w = 1280, h = 900, rtl = false, dark = false, js = SRC, screen = 'seo', icon = false, cookie = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] })
  if (cookie) await ctx.addCookies([{ name: 'sporta_admin', value: 'SECRET-ADMIN-COOKIE', url: ORIGIN }])
  let inflight = 0
  W.maxParallel = 0
  await ctx.route(ORIGIN + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), key = u.pathname + u.search
    if (u.pathname.startsWith('/backends')) return route.fulfill({ status: 200, contentType: 'text/html', body: SHELL({ rtl, dark, screen, icon }) })
    W.calls.push({ key, method: req.method(), cookie: req.headers().cookie || '', accept: req.headers().accept || '' })
    if (u.pathname === '/api/admin.php') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    const r = W.site[key]
    inflight++; W.maxParallel = Math.max(W.maxParallel, inflight)
    try {
      if (r && r.delay) { W.pending = (W.pending || 0) + 1; await sleep(r.delay) }
      if (!r) return await route.fulfill({ status: 404, contentType: 'text/html', body: 'nf' })
      if (r.redirect) return await route.fulfill({ status: 301, headers: { Location: r.redirect }, body: '' })
      return await route.fulfill({ status: r.status || 200, contentType: r.type || 'text/html', headers: r.headers || {}, body: r.body })
    } catch (e) { /* the page was closed or the request aborted by the card */ } finally { inflight-- }
  })
  const pg = await ctx.newPage(), errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await pg.goto(ORIGIN + '/backends/seo')
  await pg.addScriptTag({ content: js })
  await pg.waitForSelector('[data-sporta-slc]', { timeout: 4000 }).catch(() => {})
  await sleep(250)
  pg.__ctx = ctx; pg.__errs = errs
  return pg
}
// A REAL http server for the one thing request interception cannot fake: a 301 that fetch follows (r.redirected, r.url).
async function openReal(W, { js = SRC } = {}) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), key = u.pathname + u.search
    if (u.pathname.startsWith('/backends')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(SHELL({})) }
    W.calls.push({ key, method: req.method, cookie: req.headers.cookie || '', accept: req.headers.accept || '' })
    const r = W.site[key]
    if (!r) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('nf') }
    if (r.redirect) { res.writeHead(301, { Location: r.redirect }); return res.end() }
    res.writeHead(r.status || 200, { 'Content-Type': r.type || 'text/html', ...(r.headers || {}) }); res.end(r.body)
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pg = await ctx.newPage(), errs = []
  pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  await pg.goto(`http://127.0.0.1:${server.address().port}/backends/seo`)
  await pg.addScriptTag({ content: js })
  await pg.waitForSelector('[data-sporta-slc]', { timeout: 4000 }).catch(() => {})
  pg.__ctx = { close: async () => { await ctx.close(); await new Promise((ok) => server.close(ok)) } }; pg.__errs = errs
  return pg
}
const showAll = (pg) => pg.evaluate(() => { const b = document.querySelector('[data-sporta-slc] .slc-only input'); if (b && b.checked) b.click() }).then(() => sleep(250))
const world = (site = healthy()) => ({ calls: [], site })
const close = (pg) => pg.__ctx.close()
const state = (pg) => pg.evaluate(() => {
  const c = document.querySelector('[data-sporta-slc]'); if (!c) return null
  const vis = (n) => !!n && n.getClientRects().length > 0
  const rows = (ul) => [...c.querySelectorAll(ul + ' > li')].map((li) => ({ path: li.querySelector('.slc-path')?.textContent || '', w: li.querySelector('details')?.getAttribute('data-w'), chips: [...li.querySelectorAll('.slc-chip')].map((x) => x.textContent), text: li.textContent.replace(/\s+/g, ' ') }))
  const tiles = [...c.querySelectorAll('.slc-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim())
  return { text: c.innerText.replace(/\s+/g, ' '), status: c.querySelector('.slc-status')?.textContent || '', run: c.querySelector('.slc-actions .slc-btn--primary')?.textContent, runDisabled: c.querySelector('.slc-actions .slc-btn--primary')?.disabled,
    stopShown: vis([...c.querySelectorAll('.slc-btn')].find((b) => /^(Stop|إيقاف)$/.test(b.textContent))), tiles, files: rows('.slc-list:nth-of-type(1)'), onlyShown: vis(c.querySelector('.slc-only')), onlyChecked: c.querySelector('.slc-only input')?.checked,
    dir: c.getAttribute('dir'), count: document.querySelectorAll('[data-sporta-slc]').length, afterHeader: c.previousElementSibling?.classList.contains('admin-page-header'), afterIcon: !!c.previousElementSibling?.hasAttribute('data-sporta-sic'),
    pagesList: [...c.querySelectorAll('.slc-list')].map((ul, i) => ({ i, rows: [...ul.querySelectorAll(':scope > li')].map((li) => ({ path: li.querySelector('.slc-path')?.textContent || '', w: li.querySelector('details')?.getAttribute('data-w'), text: li.textContent.replace(/\s+/g, ' ') })) })) }
})
const lists = async (pg) => { const s = await state(pg); return { files: s.pagesList[0]?.rows || [], pages: s.pagesList[1]?.rows || [], s } }
const press = (pg, re) => pg.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('[data-sporta-slc] .slc-btn')].find((x) => r.test(x.textContent) && x.getClientRects().length && !x.disabled); if (b) b.click(); return !!b }, re.source)
const finished = (pg, ms = 20000) => pg.waitForFunction(() => /Checked \d+ pages|Stopped|فُحصت|تم الإيقاف|could not finish/.test(document.querySelector('[data-sporta-slc] .slc-status')?.textContent || ''), null, { timeout: ms }).then(() => true, () => false)
const open0 = (pg, re) => pg.evaluate((src) => { const r = new RegExp(src); const d = [...document.querySelectorAll('[data-sporta-slc] details')].find((x) => r.test(x.querySelector('summary')?.textContent || '')); if (d) d.open = true; return d ? d.innerText.replace(/\s+/g, ' ') : null }, re.source)
const issuesOf = (rows, path) => (rows.find((r) => r.path === path) || {}).text || ''

// ================================================================================================ 1. where it is, what it asks
head('the card on the SEO screen')
{
  const W = world(), pg = await open(W, { icon: true })
  const s = await state(pg)
  is(s && s.count === 1 && s.afterIcon === true, 'one card, right under the Site icon card', JSON.stringify(s && [s.count, s.afterIcon]))
  is(/Live page check/.test(s.text) && /Press “Check live pages”/.test(s.status) && s.run === 'Check live pages', 'it says what it does and waits for the button', s.status)
  await sleep(1400)
  is(W.calls.length === 0, 'it made NO request by itself, not even after a while (no polling)', W.calls.map((c) => c.key).join(' '))
  is(pg.__errs.length === 0, 'no page errors', pg.__errs.join(' | '))
  await close(pg)
}
{
  const pg = await open(world(), { icon: false })
  const s = await state(pg)
  is(s && s.afterHeader === true && s.count === 1, 'without the Site icon card it sits right under the header')
  await close(pg)
}
{
  // the whole shipped file, with the real Site icon block next to it: the two cards stack (icon first, then this one) and nothing fights over the order
  const pg = await open(world(), { icon: false, js: FULL })
  await sleep(1500)
  const o = await pg.evaluate(() => { const c = document.querySelector('[data-sporta-slc]'), i = document.querySelector('[data-sporta-sic]'); return { both: !!c && !!i, order: !!c && !!i && c.previousElementSibling === i && i.previousElementSibling?.classList.contains('admin-page-header'), count: document.querySelectorAll('[data-sporta-slc]').length } })
  is(o.both && o.order && o.count === 1, 'with the whole add-on file: header, Site icon card, then this card, once', JSON.stringify(o))
  await close(pg)
}
{
  const pg = await open(world(), { screen: 'overview' })
  is((await state(pg)) === null, 'on another screen there is no card')
  await close(pg)
}
{
  const W = world(), pg = await open(W)
  await pg.evaluate(() => document.querySelector('.seo-editor').remove()); await sleep(900)
  is((await state(pg)) === null, 'when the SEO screen goes, the card goes')
  await close(pg)
}

// ================================================================================================ 2. a healthy shop
head('a healthy shop')
{
  const W = world(), pg = await open(W)
  await press(pg, /Check live pages/)
  is(await finished(pg), 'the run finishes')
  const { files, pages, s } = await lists(pg)
  const keys = W.calls.map((c) => c.key)
  is(['/robots.txt', '/sitemap.xml', '/sitemap-pages.xml', '/sitemap-products.xml', '/', '/?lang=en', '/shop', '/shop?lang=en'].every((k) => keys.filter((x) => x === k).length === 1) && keys.length === 8, 'it read robots.txt, the sitemap index, both sitemaps and the 4 pages, each once', keys.join(' '))
  is(W.calls.every((c) => c.method === 'GET'), 'every request was a GET')
  is(W.calls.every((c) => !/SECRET-ADMIN-COOKIE|sporta_admin/.test(c.cookie)), 'no request carried the admin cookie (the page is read as a crawler reads it)', W.calls.map((c) => c.cookie).filter(Boolean).join(' | '))
  is(W.calls.filter((c) => /^\/api\/admin/.test(c.key)).length === 0, 'it never touched /api/admin.php (no server route, no key)')
  is(W.maxParallel <= 4, `at most four requests at a time (${W.maxParallel})`)
  is(/Checked 4 pages and 4 files/.test(s.status), 'the summary counts 4 pages and 4 files (robots, index, two sitemaps)', s.status)
  is(s.tiles.join(' ') === '0 Errors 0 Warnings 4 Fine', 'the tiles say 0 errors, 0 warnings, 4 fine', s.tiles.join(' | '))
  is(files.length === 4 && files.every((r) => r.w === 'ok'), 'the four files are all fine', files.map((f) => f.path + ':' + f.w).join(' '))
  is(pages.length === 4 && pages.every((r) => r.w === 'ok'), 'the four pages are all fine', pages.map((f) => f.path + ':' + f.w).join(' '))
  is(!s.onlyShown, 'with nothing wrong there is no "only pages with problems" switch')
  const d = await open0(pg, /^\/shop\?lang=en/)
  is(/Sporta \| \/shop EN/.test(d) && /Canonical https:\/\/www\.sporta\.com\.kw\/shop\?lang=en/.test(d) && /ar ✓ {1,2}en ✓ {1,2}x-default ✓/.test(d) && /image ✓/.test(d) && /WebPage/.test(d), 'a row opens to the title, canonical, language versions, social tags and structured data it read', d.slice(0, 260))
  is(/\(\d+ characters\)/.test(d), 'the title and description show their length')
  await close(pg)
}

// ================================================================================================ 3. every problem a page can have
head('problems on pages')
{
  const site = healthy()
  const add = (path, o, extra = {}) => { site[path] = { type: 'text/html', body: page(ORIGIN + path, o), ...extra } }
  const bad = ['/p-notitle', '/p-longtitle', '/p-shorttitle', '/p-nodesc', '/p-shortdesc', '/p-canon-off', '/p-canon-http', '/p-nocanon', '/p-noindex', '/p-xrobots', '/p-noalts', '/p-nosocial', '/p-badld', '/p-nold', '/p-404', '/p-lang?lang=en', '/dup-a', '/dup-b']
  add('/p-notitle', { title: null })
  add('/p-longtitle', { title: 'Sporta — premium sportswear, training kits, hoodies, shorts and shoes delivered in Kuwait in 24 hours' })
  add('/p-shorttitle', { title: 'Sporta' })
  add('/p-nodesc', { desc: null })
  add('/p-shortdesc', { desc: 'Sportswear' })
  add('/p-canon-off', { canon: ORIGIN + '/somewhere-else' })
  add('/p-canon-http', { canon: 'http://www.sporta.com.kw/p-canon-http' })
  add('/p-nocanon', { canon: null })
  add('/p-noindex', { robots: 'noindex, follow' })
  add('/p-xrobots', {}, { headers: { 'X-Robots-Tag': 'noindex' } })
  add('/p-noalts', { alts: false })
  add('/p-nosocial', { og: false })
  add('/p-badld', { ld: '<script type="application/ld+json">{ not json </script>' })
  add('/p-nold', { ld: '' })
  add('/p-lang?lang=en', { lang: 'ar' })
  add('/dup-a', { title: 'The same title on two pages', desc: 'Sporta description A for the duplicate check, long enough to pass.' })
  add('/dup-b', { title: 'The same title on two pages', desc: 'Sporta description B for the duplicate check, long enough to pass.' })
  site['/sitemap-pages.xml'] = { type: 'application/xml', body: urlset(['/', '/?lang=en', ...bad]) }
  const W = world(site), pg = await open(W)
  await press(pg, /Check live pages/)
  is(await finished(pg), 'the run finishes')
  const { pages, s } = await lists(pg)
  const q = (p) => issuesOf(pages, p)
  is(/There is no title/.test(q('/p-notitle')) && pages.find((r) => r.path === '/p-notitle').w === 'error', 'no title: an error that says so')
  is(/title is \d+ characters; search results cut it off/.test(q('/p-longtitle')), 'a title over 70 characters is a warning with its length')
  is(/title is only 6 characters/.test(q('/p-shorttitle')), 'a title under 10 characters is a warning')
  is(/There is no description/.test(q('/p-nodesc')), 'no description: an error')
  is(/description is only 10 characters/.test(q('/p-shortdesc')), 'a description under 40 characters is a warning')
  is(/canonical address is https:\/\/www\.sporta\.com\.kw\/somewhere-else, not this page/.test(q('/p-canon-off')), 'a canonical that points elsewhere is an error naming it')
  is(/canonical address is not https/.test(q('/p-canon-http')) && !/not this page/.test(q('/p-canon-http')), 'an http canonical is an error (and is not also called "elsewhere")')
  is(/There is no canonical address/.test(q('/p-nocanon')), 'no canonical: an error')
  is(/not to index it \(noindex, follow\)/.test(q('/p-noindex')), 'a robots meta noindex is an error that quotes it')
  is(/not to index it \(noindex\)/.test(q('/p-xrobots')), 'an X-Robots-Tag: noindex header is found too')
  is(/Language versions missing: ar, en, x-default/.test(q('/p-noalts')), 'missing language versions are listed')
  is(/Social preview tags missing: og:title, og:description, og:image/.test(q('/p-nosocial')), 'missing social tags are listed')
  is(/1 structured-data block\(s\) are not valid JSON/.test(q('/p-badld')), 'invalid JSON-LD is an error')
  is(/answered 404 instead of 200/.test(q('/p-404')) && pages.find((r) => r.path === '/p-404').w === 'error', 'a page that answers 404 is an error')
  is(/says its language is “ar”, but this is the English address/.test(q('/p-lang?lang=en')), 'a page whose language attribute disagrees with its address is a warning')
  is(/Another 1 page\(s\) in this language have the same title/.test(q('/dup-a')) && /Another 1 page\(s\) in this language have the same title/.test(q('/dup-b')) && !/same title/.test(q('/')), 'two pages of one language with the same title: both are told, the others are not')
  is(/same description/.test(q('/dup-a')) === false, 'different descriptions are not flagged as shared')
  const order = pages.map((r) => r.w)
  const lastErr = order.lastIndexOf('error'), firstWarn = order.indexOf('warn'), firstOk = order.indexOf('ok')
  is(lastErr < firstWarn && (firstWarn < firstOk || firstOk === -1), 'the list is worst first: errors, then warnings, then fine', order.join(','))
  is(s.onlyShown && s.onlyChecked && pages.every((r) => r.w !== 'ok'), 'after a run with problems the list shows only pages with problems', pages.length + ' rows')
  await pg.evaluate(() => document.querySelector('[data-sporta-slc] .slc-only input').click()); await sleep(250)
  const all = await lists(pg)
  is(all.pages.length > pages.length && all.pages.some((r) => r.w === 'ok'), 'the switch shows every page again', pages.length + ' -> ' + all.pages.length)
  const nold = all.pages.find((r) => r.path === '/p-nold')
  is(nold && /No structured data/.test(nold.text) && nold.w === 'ok', 'no JSON-LD is a note, not a problem (the row stays "fine")', nold && nold.text)
  is(/Errors/.test(all.s.tiles.join(' ')) && Number(all.s.tiles[0].split(' ')[0]) >= 9, 'the error tile counts the pages with an error', all.s.tiles.join(' | '))
  const txt = await pg.evaluate(async () => { document.querySelector('[data-sporta-slc]').querySelectorAll('.slc-btn').forEach((b) => { if (/Copy report/.test(b.textContent)) b.click() }); await new Promise((r) => setTimeout(r, 400)); return navigator.clipboard.readText() })
  is(/\/p-notitle \| ar \| 200 \| error:There is no title/.test(txt) && /\/p-404 \| ar \| 404/.test(txt), 'Copy report puts the findings on the clipboard as text', txt.split('\n').slice(0, 3).join(' / '))
  await close(pg)
}

// ================================================================================================ 4. the files
head('problems in robots.txt and the sitemaps')
{
  const cases = [
    ['robots blocks everything', (s) => { s['/robots.txt'].body = 'User-agent: *\nDisallow: /\nSitemap: https://www.sporta.com.kw/sitemap.xml' }, /blocks the whole site/],
    ['robots without a sitemap line', (s) => { s['/robots.txt'].body = 'User-agent: *\nDisallow: /backends' }, /does not name the sitemap/],
    ['robots that does not hide /backends', (s) => { s['/robots.txt'].body = 'User-agent: *\nDisallow: /api/\nSitemap: https://www.sporta.com.kw/sitemap.xml' }, /does not keep \/backends out of search/],
    ['no robots.txt', (s) => { delete s['/robots.txt'] }, /There is no robots\.txt/],
    ['a sitemap that is not XML', (s) => { s['/sitemap.xml'].body = 'this is not xml <<<' }, /not valid XML/],
    ['a child sitemap that fails', (s) => { delete s['/sitemap-products.xml'] }, /sitemap sitemap-products\.xml answered 404/],
    ['an empty sitemap', (s) => { s['/sitemap.xml'].body = urlset([]) }, /lists no addresses/],
    ['a date in the future', (s) => { s['/sitemap.xml'] = { type: 'application/xml', body: urlset(['/', '/?lang=en'], '<lastmod>2099-01-01</lastmod>') } }, /address\(es\) have a last-changed date in the future/],
    ['an address twice', (s) => { s['/sitemap.xml'] = { type: 'application/xml', body: urlset(['/', '/', '/?lang=en']) } }, /1 address\(es\) are listed twice/]
  ]
  for (const [name, mutate, re] of cases) {
    const site = healthy(); mutate(site)
    const W = world(site), pg = await open(W)
    await press(pg, /Check live pages/); await finished(pg)
    const { files } = await lists(pg)
    is(files.some((f) => re.test(f.text) && f.w !== 'ok'), `${name}: found and named`, files.map((f) => f.text.slice(0, 90)).join(' || '))
    await close(pg)
  }
  const site = healthy(); delete site['/sitemap.xml']
  const W = world(site), pg = await open(W)
  await press(pg, /Check live pages/); await finished(pg); await showAll(pg)
  const { pages, files } = await lists(pg)
  is(files.some((f) => /There is no sitemap\.xml/.test(f.text)) && files.some((f) => /No readable sitemap: the main pages were checked instead/.test(f.text)), 'no sitemap at all: that is an error, and the main pages are checked instead')
  is(pages.some((r) => r.path === '/shop?lang=en') && pages.some((r) => r.path === '/support'), 'the fallback checks the main pages in both languages', pages.map((r) => r.path).join(' '))
  await close(pg)
}

head('a sitemap address that redirects (a real server)')
{
  const site = healthy(); site['/p-redirect'] = { redirect: '/p-final' }; site['/p-final'] = { type: 'text/html', body: page(ORIGIN + '/p-redirect') }
  site['/sitemap-pages.xml'].body = urlset(['/', '/?lang=en', '/p-redirect'])
  const W = world(site), pg = await openReal(W)
  await press(pg, /Check live pages/); is(await finished(pg), 'the run finishes'); await showAll(pg)
  const { pages } = await lists(pg)
  is(/redirects to \/p-final/.test(issuesOf(pages, '/p-redirect')) && pages.find((r) => r.path === '/p-redirect').w === 'warn', 'a sitemap address that redirects is a warning naming the final address', issuesOf(pages, '/p-redirect'))
  is(W.calls.filter((c) => c.key === '/p-final').length === 1, 'the redirect was followed once')
  await close(pg)
}

// ================================================================================================ 5. Stop and leaving
head('Stop and leaving the screen')
{
  const site = healthy()
  site['/shop'] = { type: 'text/html', body: page(ORIGIN + '/shop'), delay: 6000 }
  site['/shop?lang=en'] = { type: 'text/html', body: page(ORIGIN + '/shop?lang=en'), delay: 6000 }
  const W = world(site), pg = await open(W)
  await press(pg, /Check live pages/); await sleep(1200)
  const mid = await state(pg)
  is(/Checking… \d of 4 pages/.test(mid.status) && mid.runDisabled === true && mid.stopShown === true, 'while it runs: a progress line, the main button is off, Stop is shown', mid.status)
  await press(pg, /Stop/)
  is(await finished(pg, 5000), 'Stop ends the run at once')
  const { pages, s } = await lists(pg)
  is(/Stopped\. \d of 4 pages were checked/.test(s.status), 'it says it stopped and how far it got', s.status)
  is(!pages.some((r) => /shop/.test(r.path)), 'the two pages that were still in flight add nothing (no false "unreachable")', pages.map((r) => r.path).join(' '))
  const n = W.calls.length; await sleep(1500)
  is(W.calls.length === n, 'and it asks for nothing more afterwards')
  await close(pg)
}
{
  const site = healthy(); site['/shop'] = { type: 'text/html', body: page(ORIGIN + '/shop'), delay: 6000 }
  const W = world(site), pg = await open(W)
  await press(pg, /Check live pages/); await sleep(900)
  await pg.evaluate(() => document.querySelector('.seo-editor').remove()); await sleep(1200)
  const n = W.calls.length; await sleep(1500)
  is(W.calls.length === n && (await state(pg)) === null, 'leaving the SEO screen cancels the run: no request after it, no card')
  await close(pg)
}

// ================================================================================================ 6. look
head('Arabic, light and dark, phone')
{
  const W = world(), pg = await open(W, { rtl: true })
  await press(pg, /افحص الصفحات المباشرة/)
  is(await finished(pg), 'Arabic: the run finishes')
  const s = await state(pg)
  is(s.dir === 'rtl' && /فحص الصفحات المباشر/.test(s.text) && /فُحصت 4 صفحة/.test(s.status) && /سليمة/.test(s.text), 'Arabic: right to left, in Arabic', s.status)
  await close(pg)
}
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
for (const dark of [false, true]) {
  const site = healthy(); site['/p-notitle'] = { type: 'text/html', body: page(ORIGIN + '/p-notitle', { title: null }) }; site['/sitemap-pages.xml'].body = urlset(['/', '/?lang=en', '/p-notitle'])
  const W = world(site), pg = await open(W, { dark })
  await press(pg, /Check live pages/); await finished(pg)
  await open0(pg, /p-notitle/)
  const pairs = await pg.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number)
    const bgOf = (n) => { for (let x = n; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return c.slice(0, 3) } return [255, 255, 255] }
    const out = []
    for (const [name, sel] of [['lead', '.slc-copy .slc-muted'], ['tile error number', '.slc-tile[data-sev="error"] b'], ['tile label', '.slc-tile span'], ['error chip', '.slc-chip[data-sev="error"]'], ['fine chip', '.slc-chip[data-sev="ok"]'], ['issue label', '.slc-iss li[data-sev="error"] b'], ['fact label', '.slc-facts dt'], ['primary button', '.slc-btn--primary']]) {
      const n = document.querySelector('[data-sporta-slc] ' + sel); if (!n) continue
      out.push([name, rgb(getComputedStyle(n).color).slice(0, 3), bgOf(n)])
    }
    return out
  })
  const low = pairs.filter(([, f, b]) => ratio(f, b) < 4.5).map(([n, f, b]) => `${n} ${ratio(f, b).toFixed(2)}`)
  is(pairs.length >= 7 && low.length === 0, `${dark ? 'dark' : 'light'}: every text reads at 4.5:1 or better (${pairs.length} pairs)`, low.join(', '))
  await close(pg)
}
{
  const W = world(), pg = await open(W, { w: 390, h: 800 })
  await press(pg, /Check live pages/); await finished(pg)
  await open0(pg, /\/shop\?lang=en/)
  const m = await pg.evaluate(() => ({ sx: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll('[data-sporta-slc] .slc-btn, [data-sporta-slc] summary, [data-sporta-slc] .slc-open')].filter((b) => b.getClientRects().length && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.slice(0, 20)) }))
  is(m.sx <= 0, 'phone: no sideways scroll', String(m.sx))
  is(m.small.length === 0, 'phone: every button and row is at least 44 px high', m.small.join(', '))
  await close(pg)
}

// ================================================================================================ 7. mutations: each rule matters
head('mutations')
{
  const mutate = (from, to) => { if (!SRC.includes(from)) throw new Error('mutation anchor missing: ' + from); return SRC.replace(from, to) }
  {
    const W = world(), pg = await open(W, { js: mutate("credentials: 'omit'", "credentials: 'include'") })
    await press(pg, /Check live pages/); await finished(pg)
    is(W.calls.some((c) => /SECRET-ADMIN-COOKIE/.test(c.cookie)), 'MUTANT cookies on: the admin cookie IS sent (so the no-cookie check can fail)')
    await close(pg)
  }
  {
    const site = healthy(); site['/shop'] = { type: 'text/html', body: page(ORIGIN + '/shop', { canon: ORIGIN + '/other' }) }
    const W = world(site), pg = await open(W, { js: mutate("up('error', 'canonOff', { url: f.canon })", "void 0") })
    await press(pg, /Check live pages/); await finished(pg)
    const { pages } = await lists(pg)
    is(!/canonical address is/.test(issuesOf(pages, '/shop')), 'MUTANT canonical rule cut: the wrong canonical goes unseen (so the canonical check can fail)')
    await close(pg)
  }
  {
    const site = healthy(); site['/shop'] = { type: 'text/html', body: page(ORIGIN + '/shop'), delay: 3000 }
    const W = world(site), pg = await open(W, { js: mutate('if (id !== S.run || sig.aborted) return', 'if (id !== S.run) return') })
    await press(pg, /Check live pages/); await sleep(600); await press(pg, /Stop/); await finished(pg, 6000); await sleep(500)
    const { pages } = await lists(pg)
    is(pages.some((r) => r.path === '/shop' && r.w === 'error'), 'MUTANT Stop rule cut: the cancelled page shows up as "unreachable" (so the Stop check can fail)')
    await close(pg)
  }
  {
    const site = healthy(); site['/shop'] = { type: 'text/html', body: page(ORIGIN + '/shop', { title: 'Same title here' }) }; site['/shop?lang=en'] = { type: 'text/html', body: page(ORIGIN + '/shop?lang=en') }
    site['/'] = { type: 'text/html', body: page(ORIGIN + '/', { title: 'Same title here' }) }
    const W = world(site), pg = await open(W, { js: mutate("sev: 'warn', code: 'dupTitle'", "sev: 'info', code: 'dupTitle'") })
    await press(pg, /Check live pages/); await finished(pg)
    const { pages } = await lists(pg)
    is(pages.filter((r) => /same title/.test(r.text)).length > 0 && pages.every((r) => r.w === 'ok'), 'MUTANT shared-title rule weakened: the pages stay "fine" (so the shared-title check can fail)')
    await close(pg)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
