// The Social center (block "ADMIN SOCIAL CENTER", public/sporta-admin-brands.js): accounts, post studio, share image, link builder
// and checks on the admin's Settings screen, in a real browser.
//
//   npm run test:admin-social   (rig-free: no database, no server. The page is the CAPTURED live admin's Settings screen
//                                (scripts/fixtures/sizes-admin/settings.html) under the live rules and the 14 add-on sheets; the admin
//                                API and the public files are a fake answered by route interception, shaped like admin.php content /
//                                content_save / products_all / brands and the shop's pages; content_save VALIDATES WITH THE REAL
//                                store_content_contact() of dropin/php-store/store.php, cut out of the source and run by php; the
//                                REAL add-on file and the REAL sporta-features.js run on it)
//
// What is asserted:
//   - the block: markers, no markup injection, no storage, no third-party host, ONE write route (content_save);
//   - the server's rules are the add-on's: every input of a matrix goes through the real PHP validator and through the add-on's
//     (same accept / reject, same stored value), the host and path tables are the PHP ones;
//   - the entry: one "Social center" button in the header of Settings (and of the Site content panel), gone with the screen, not on
//     other screens, 44 px, the block does not start off /backends; opening reads content only, writes nothing;
//   - accounts: prefilled handles, set / missing / changed / not valid, the footer preview and Open links, phone and e-mail read only;
//     Save sends v, the overrides byte for byte and every contact key as read except the changed ones; an invalid value, or nothing
//     changed, sends nothing; a double click saves once; 401, 429, 400 and a dead network are worded and the form can be saved again;
//     a stale version (409) reloads and keeps what was typed; no route -> "not available"; a storefront that does not apply the
//     accounts is warned about;
//   - post studio: deterministic captions in both languages, edited text kept, UTM links on the canonical host (Arabic bare path,
//     English ?lang=en), a link per platform with its own utm_source, each platform's limit counted (X 280 with a link as 23,
//     Snapchat 80, Instagram and TikTok 2200), the WhatsApp link, copy buttons, NO price unless ticked, then three decimals;
//   - share image: 1080 x 1080 and 1080 x 1920 PNG downloads, brand colours, same-origin pictures only, nothing uploaded;
//   - link builder: UTM formation, normalisation and refusals;
//   - checks: each passing in a good world and failing in a world built to fail it;
//   - 390 / 768 / 1280 px, English and Arabic (RTL), light and dark: no sideways scroll, 44 px targets at 390, contrast;
//   - MUTATION CHECK: with the block cut out of the file the same screen has no button and no panel.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'
import { png, pngHeader, encodePng } from './lib/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const FEATURES_JS = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const STORE_PHP = readFileSync(join(ROOT, 'dropin/php-store/store.php'), 'utf8')
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN SOCIAL CENTER - begin')
const END_MARK = '/* ===== ADMIN SOCIAL CENTER - end'
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN SOCIAL CENTER block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const BLOCK = BRANDS_JS.slice(BEGIN, BRANDS_JS.indexOf('\n', END))
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')       // the block without its comments
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))
const SHOTS = process.env.SOCIAL_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (x) => JSON.parse(JSON.stringify(x))
const len = (s) => Array.from(String(s)).length
const ORIGIN = 'https://www.sporta.com.kw'

// ------------------------------------------------------------------------------------------------ the real PHP validator
const fnText = (name) => { const m = STORE_PHP.match(new RegExp('^function ' + name + '\\(.*?^\\}\\n', 'ms')); if (!m) throw new Error('store.php has no ' + name); return m[0] }
const ORACLE = join(mkdtempSync(join(tmpdir(), 'social-oracle-')), 'oracle.php')
writeFileSync(ORACLE, `<?php
function store_fail(string $t, int $c = 400): void { throw new RuntimeException($t); }
${['store_ascii_digits', 'store_input_string', 'store_content_squash', 'store_content_social', 'store_content_contact'].map(fnText).join('\n')}
$in = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($in as $case) {
    try { $out[] = ['ok' => store_content_contact($case)]; }
    catch (RuntimeException $e) { $out[] = ['error' => $e->getMessage()]; }
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`)
const php = (cases) => {
  const r = spawnSync('php', [ORACLE], { input: JSON.stringify(cases), encoding: 'utf8' })
  if (r.status !== 0) throw new Error('php oracle failed: ' + r.stderr)
  return JSON.parse(r.stdout)
}
const serverContact = (c) => php([c])[0]

// ------------------------------------------------------------------------------------------------ test data
const rgba = (w, h, f) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y), i = (y * w + x) * 4; b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; b[i + 3] = 255 } return b }
const PHOTO = encodePng(600, 800, rgba(600, 800, (x, y) => [40 + (x % 200), 90, 160 - (y % 100)]))
const LOGO = readFileSync(join(ROOT, 'public/logo.png')), LOGO_WHITE = readFileSync(join(ROOT, 'public/logo-white.png'))
const OG = encodePng(1200, 630, rgba(1200, 630, () => [224, 86, 28]))
const OVERRIDES = [
  { page: '/', lang: 'ar', match: 'ملابس رياضية', text: 'ملابس رياضية فاخرة' },
  { page: '/shop', lang: 'en', match: 'Shop', text: 'Shop sportswear' },
  { page: '*', lang: 'en', match: 'Contact us', text: 'Talk to us' },
]
const DOC0 = () => ({
  v: 7, overrides: clone(OVERRIDES),
  contact: { phone: '+96522091914', whatsapp: '96522091914', email: 'cs@sporta.com.kw', address_en: 'Block 1, Kuwait City', address_ar: 'مدينة الكويت، قطعة ١', instagram: 'https://www.instagram.com/sporta.kw', tiktok: '', snapchat: '', x: 'https://x.com/sporta_kw' },
  pages: ['*', '/'], limits: { overrides: 300, match: 400, text: 2000, bytes: 60000 },
  returns: { window_days: 14, allow_return: true, allow_exchange: true, intro_en: '', intro_ar: '', points_en: [], points_ar: [] },
})
const P = (o) => ({ id: 0, slug: '', name_en: '', name_ar: '', desc_en: '', desc_ar: '', price: '12.500', sale_price: null, sale_starts_at: null, sale_ends_at: null, category: 'men', brand_slug: 'vanquish', image: '', images: '', active: '1', ...o })
const LONG = 'Vanquish Ultra Lightweight Breathable Moisture Wicking Seamless Compression Training Long Sleeve Top Edition ' + 'Plus'.repeat(5)
const PRODUCTS = [
  P({ id: 1, slug: 'vanquish-pro-tee', name_en: 'Vanquish Pro Training Tee', name_ar: 'تيشيرت فانكويش للتمارين', price: '12.500', image: '/images/products/vanquish-pro-tee.png', images: '/images/products/vanquish-pro-tee-2.png' }),
  P({ id: 2, slug: 'gymshark-vital-leggings', name_en: 'Vital Seamless Leggings', name_ar: 'ليقنز فيتال', category: 'women', brand_slug: 'gymshark', price: '18.000', sale_price: '15.000', sale_ends_at: '2099-01-01 00:00:00', image: '/images/products/g.png' }),
  P({ id: 3, slug: 'nba-lakers-hoodie', name_en: 'Lakers Hoodie', name_ar: 'هودي ليكرز', category: 'outerwear', brand_slug: 'nba', price: '9.5', image: '/images/products/n.png' }),
  P({ id: 4, slug: 'sale-expired', name_en: 'Old Sale Tank', name_ar: 'تانك', price: '10.000', sale_price: '5.000', sale_ends_at: '2020-01-01 00:00:00', image: '/images/products/n.png' }),
  P({ id: 5, slug: 'no-photo-bottle', name_en: 'Shaker Bottle', name_ar: 'شيكر', category: 'accessories', brand_slug: '', price: '4.000', image: '', images: '' }),
  P({ id: 6, slug: 'hidden-cap', name_en: 'Hidden Cap', name_ar: 'قبعة', active: '0' }),
  P({ id: 7, slug: 'long-name', name_en: LONG, name_ar: 'قميص تدريب طويل الأكمام خفيف الوزن قابل للتنفس بقصة ضاغطة وخامة تمتص العرق للتمارين اليومية والجري في الأجواء الحارة', price: '20.000', image: '/images/products/n.png' }),
  P({ id: 8, slug: 'foreign-photo', name_en: 'Foreign Photo Tee', name_ar: 'تيشيرت', image: 'https://evil.example/x.jpg', images: '/images/products/n.png,//evil.example/y.png' }),
]
const BRANDS = [{ id: 1, slug: 'vanquish', name_en: 'Vanquish', name_ar: 'فانكويش' }, { id: 2, slug: 'gymshark', name_en: 'Gymshark', name_ar: 'جيمشارك' }, { id: 3, slug: 'nba', name_en: 'NBA', name_ar: 'إن بي إيه' }]
const ROBOTS_OK = 'User-agent: *\nAllow: /\nDisallow: /backends\nDisallow: /api/\nAllow: /api/api.php\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /backends\n\nSitemap: https://www.sporta.com.kw/sitemap.xml\n'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const metaHtml = (o) => `<link rel="canonical" href="${esc(o.canonical)}">` + (o.title === null ? '' : `<meta property="og:title" content="${esc(o.title)}">`) + `<meta property="og:description" content="Premium sportswear in Kuwait">` +
  (o.image === null ? '' : `<meta property="og:image" content="${esc(o.image)}">`) + `<meta property="og:url" content="${esc(o.canonical)}">` + (o.card === null ? '' : `<meta name="twitter:card" content="summary_large_image">`)

function makeWorld() {
  return {
    doc: DOC0(), products: clone(PRODUCTS), brands: clone(BRANDS), calls: [], requests: [], next: null, drop: false, delay: 0, routes404: new Set(),
    robots: ROBOTS_OK, features: FEATURES_JS, ogImage: '/og-image.png', homeTitle: 'Sporta | Premium sportswear in Kuwait', homeCard: 'summary_large_image', ogStatus: 200, ogBig: false,
    homeScript: true, canonical: ORIGIN + '/', publicContact: null, footer: ['<a href="https://www.instagram.com/old.handle">Instagram</a>', '<a href="https://www.tiktok.com/@old.handle">TikTok</a>', '<a href="https://x.com/old_handle">X</a>', '<a href="https://wa.me/96500000000">WhatsApp</a>'],
  }
}
const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
const homeHtml = (W) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sporta</title>${metaHtml({ canonical: W.canonical, title: W.homeTitle, image: W.ogImage === null ? null : ORIGIN + W.ogImage, card: W.homeCard })}${W.homeScript ? '<script src="/sporta-features.js" defer></script>' : ''}</head><body><main><h1>Sporta</h1></main><footer>${W.footer.join(' ')}</footer></body></html>`

function handler(W, shellHtml) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    W.requests.push({ method: req.method(), url: req.url(), origin: u.origin, path: p + u.search })
    if (p === '/backends' || p.startsWith('/backends/')) return route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      const rec = { method, route: r, headers: req.headers(), body: method === 'POST' ? (() => { try { return JSON.parse(req.postData() || 'null') } catch { return '__unparsable__' } })() : null, raw: method === 'POST' ? req.postData() : null }
      W.calls.push(rec)
      if (W.routes404.has(r)) return json(route, 404, { error: 'not_found' })
      if (r === 'content' && method === 'GET') return json(route, 200, W.doc)
      if (r === 'products_all') return json(route, 200, W.products)
      if (r === 'brands') return json(route, 200, W.brands)
      if (r === 'content_save' && method === 'POST') {
        if (W.drop) return route.abort('failed')
        if (W.delay) await sleep(W.delay)
        if (W.next) { const n = W.next; W.next = null; return json(route, n.status, n.body, n.headers || {}) }
        if (rec.headers['x-sporta-admin'] !== '1' || !/^application\/json/.test(rec.headers['content-type'] || '')) return json(route, 403, { error: 'bad_request' })
        const b = rec.body
        if (!b || typeof b.v !== 'number') return json(route, 400, { error: 'invalid_content_version' })
        const res = serverContact(b.contact || {})
        if (res.error) return json(route, 400, { error: res.error })
        if (b.v !== W.doc.v) return json(route, 409, { error: 'content_changed' })
        W.doc = { ...W.doc, v: W.doc.v + 1, overrides: b.overrides, contact: res.ok }
        return json(route, 200, { v: W.doc.v, overrides: W.doc.overrides, contact: W.doc.contact })       // the real answer carries no `returns`
      }
      return json(route, 404, { error: 'not_found' })
    }
    if (p === '/api/api.php' && u.searchParams.get('r') === 'content') return json(route, 200, W.publicContact || { v: W.doc.v, overrides: W.doc.overrides, contact: W.doc.contact, returns: W.doc.returns })
    if (p === '/sporta-features.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: W.features })
    if (p === '/robots.txt') return route.fulfill({ status: W.robots === null ? 404 : 200, contentType: 'text/plain', body: W.robots ?? 'nf' })
    if (p === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: homeHtml(W) })
    if (p === '/logo.png') return route.fulfill({ status: 200, contentType: 'image/png', body: LOGO })
    if (p === '/logo-white.png') return route.fulfill({ status: 200, contentType: 'image/png', body: LOGO_WHITE })
    if (p === '/og-image.png' || p === '/og-other.png') return route.fulfill({ status: W.ogStatus, contentType: W.ogStatus === 200 ? 'image/png' : 'text/plain', body: W.ogStatus === 200 ? (W.ogBig ? Buffer.concat([OG, Buffer.alloc(700 * 1024)]) : OG) : 'nf' })
    if (/^\/images\/products\/.*\.png$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO })
    const m = p.match(/^\/product\/([\w-]+)$/)
    if (m) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><title>${esc(m[1])}</title>${metaHtml({ canonical: ORIGIN + p, title: 'Product', image: ORIGIN + '/og-image.png', card: 'summary_large_image' })}</head><body></body></html>` })
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const shell = (opt, name = 'settings') => fixturePage(name, FILES, opt)
const pageErrors = [], consoleErrors = []
const SEL = { btn: '[data-sporta-social-btn]', panel: 'section.ssoc' }
async function open(W, { w = 1280, h = 900, rtl = false, dark = false, origin = ORIGIN, js = BRANDS_JS, name = 'settings', wait = true, clip = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, acceptDownloads: true })
  if (clip) await ctx.addInitScript(() => { window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve() } }, configurable: true }) } catch (e) { /* kept */ } })
  await ctx.route(origin + '/**', handler(W, shell({ rtl, dark }, name)))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)) })
  await pg.goto(origin + '/backends/settings')
  await pg.addScriptTag({ content: js })
  if (wait) await pg.waitForSelector(SEL.btn, { timeout: 4000 }).catch(() => {})
  pg.__ctx = ctx; pg.__W = W
  return pg
}
const close = (pg) => pg.__ctx.close()
const saved = (W) => W.calls.filter((c) => c.route === 'content_save')
const posts = (W) => W.calls.filter((c) => c.method === 'POST')
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, name + '.png') }) }
async function openPanel(pg, tab = 'accounts') {
  if (!(await pg.locator(SEL.panel + ':not([hidden])').count())) { pg.__base = pg.__W.calls.length; await pg.click(SEL.btn) }
  await pg.waitForSelector(SEL.panel + ':not([hidden])')
  if (tab !== 'accounts') await pg.click(`.ssoc-tab[data-tab="${tab}"]`)
  if (tab === 'accounts') await pg.waitForFunction(() => document.querySelector('.ssoc-chip') && document.querySelector('.ssoc-chip').textContent !== '…', null, { timeout: 4000 }).catch(() => {})
  if (tab === 'studio' || tab === 'image') await pg.waitForFunction(() => document.querySelectorAll('select[name="ssoc_product"] option').length > 0, null, { timeout: 4000 }).catch(() => {})
  await pg.waitForTimeout(150)
}
const tabBtn = (pg, tab) => pg.click(`.ssoc-tab[data-tab="${tab}"]`)
const saveBtn = (pg) => pg.locator('.ssoc').getByRole('button', { name: /^(Save accounts|Saving…)$/ })
const val = (pg, name) => pg.inputValue(`.ssoc [name="${name}"]`)
const status = (pg) => pg.evaluate(() => document.querySelector('.ssoc-status').textContent)
const pick = (pg, id) => pg.selectOption('.ssoc select[name="ssoc_product"]', String(id))
const master = (pg) => pg.inputValue('.ssoc textarea[name="ssoc_caption"]')
const setLang = (pg, l) => pg.click(`.ssoc-prodbar-fake, .ssoc .ssoc-segbtn:has-text("${l === 'ar' ? 'العربية' : 'English'}")`)
const variants = (pg) => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('textarea[name^="ssoc_var_"]')].map((t) => [t.name.slice(9), { text: t.value, n: Number(t.closest('.ssoc-var').querySelector('.ssoc-count').getAttribute('data-n')), limit: Number(t.closest('.ssoc-var').querySelector('.ssoc-count').getAttribute('data-limit')), cls: t.closest('.ssoc-var').querySelector('.ssoc-count').className }])))
const clickBtn = (pg, name) => pg.locator('.ssoc').getByRole('button', { name, exact: true }).first().click()

// ================================================================================================ 1. the block itself
head('the block')
{
  is(!/\binnerHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\beval\(|new Function\(/.test(CODE), 'no markup injection, no eval')
  is(!/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(CODE), 'no browser storage and no cookie is touched')
  is(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|<script|createElement\('script'\)|\.src = ['"]http/.test(CODE), 'no beacon, socket, script element or remote source')
  const hosts = [...new Set([...CODE.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))].sort()
  const allowed = ['www.sporta.com.kw', 'www.instagram.com', 'www.tiktok.com', 'www.snapchat.com', 'x.com', 'instagram.com', 'wa.me', 'www.facebook.com', 'www.youtube.com', 'www.threads.net', 't.me', 'facebook.com', 'youtube.com']
  is(hosts.every((h) => allowed.includes(h)), 'every address in the block is the shop, a platform’s own profile host or wa.me (strings, never fetched)', hosts.join(','))
  const writes = [...CODE.matchAll(/request\('([a-z_]+)',/g)].map((m) => m[1])
  is(same([...new Set(writes)], ['content_save']), 'the only admin write route named in the block is content_save', writes.join(','))
  const gets = [...CODE.matchAll(/request\('([a-z_]+)'\)/g)].map((m) => m[1])
  is(same([...new Set(gets)].sort(), ['brands', 'content', 'products_all']), 'the admin reads are content, products_all and brands', gets.join(','))
  const fetches = [...CODE.matchAll(/getSite\('([^']+)'/g)].map((m) => m[1])
  is(fetches.every((f) => f.startsWith('/')), 'every public read is a path of this site', fetches.join(','))
  is(/function getSite\(path\) \{\s*if \(!sameOriginPath\(path\)\)/.test(CODE), 'getSite refuses anything that is not a same-origin path')
  is(!/password|secret|api[_-]?key|bearer|authorization/i.test(CODE), 'no secret, key or credential appears in the block')
  const cssSrc = CODE.slice(CODE.indexOf('var CSS = ['), CODE.indexOf("].join('\\n')", CODE.indexOf('var CSS = [')))
  const css = new Function('OPEN', 'PAGE', cssSrc.replace('var CSS = ', 'return ') + '].join("\\n")')('data-sporta-social-state', 'data-sporta-social')
  const sels = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((x) => x && !x.startsWith('@')).flatMap((x) => x.split(/,(?![^(]*\))/).map((y) => y.trim()))
  const rogue = sels.filter((x) => !/^(\.ssoc(?![A-Za-z-])|\.ssoc-|:is\(html\.dark,html\[data-theme="dark"\]\) \.ssoc|body\[data-sporta-social-state="open"\] main\.admin-content>section\.admin-page:not\(\[data-sporta-social\]\)$)/.test(x))
  is(sels.length > 100 && rogue.length === 0, `all ${sels.length} rules are scoped to .ssoc / .ssoc-open or the body switch (the Payments screen’s light-only rule cannot be touched)`, rogue.slice(0, 3).join(' | '))
  is(!/payment-settings|admin-content:has/.test(css), 'no rule names the Payments screen')
  is((BRANDS_JS.match(/ADMIN SOCIAL CENTER - begin/g) || []).length === 1, 'the block appears once')
  is(BLOCK.includes("if (location.pathname.indexOf('/backends') !== 0) return") && BLOCK.includes('if (window.__sportaSocial) return'), 'it starts on /backends only and is idempotent')
  is((CODE.match(/setInterval\(/g) || []).length === 1 && /500\)/.test(CODE.slice(CODE.indexOf('setInterval('))), 'one half-second check adds or removes the entry button, as the other blocks do; nothing else runs on a timer loop')
}

// ================================================================================================ 2. the server's rules are the add-on's
head('validation parity with the real store_content_contact()')
{
  const W = makeWorld(), pg = await open(W)
  const NETS = ['instagram', 'tiktok', 'snapchat', 'x']
  const RAW = ['', ' ', 'sporta.kw', '@sporta.kw', 'Sporta_KW', 'a', 'ab', 'abc', 'abcd', 'a'.repeat(15), 'a'.repeat(16), 'a'.repeat(24), 'a'.repeat(25), 'a'.repeat(30), 'a'.repeat(31), 'sporta kw', 'سبورتا', 'sp-rta', 'sp.rta', 'sp@rta', '@@sporta',
    'https://www.instagram.com/sporta.kw', 'https://instagram.com/sporta.kw/', 'https://www.instagram.com/@sporta.kw', 'http://www.instagram.com/sporta.kw', 'https://evil.example/sporta.kw', 'https://www.instagram.com.evil.example/sporta',
    'https://www.instagram.com/sporta.kw?utm=1', 'https://www.instagram.com/sporta.kw?', 'https://www.instagram.com/sporta.kw#top', 'https://user@www.instagram.com/sporta.kw', 'https://www.instagram.com:443/sporta.kw', 'https://WWW.INSTAGRAM.COM/Sporta',
    'https://www.instagram.com/a/b', 'https://www.instagram.com/', 'https://www.instagram.com', 'https://www.tiktok.com/@sporta.kw', 'https://tiktok.com/@sporta.kw/', 'https://www.tiktok.com/sporta.kw', 'https://www.tiktok.com/@a',
    'https://www.snapchat.com/add/sporta', 'https://snapchat.com/add/sporta/', 'https://www.snapchat.com/sporta', 'https://www.snapchat.com/add/ab', 'https://www.snapchat.com/add/sporta-kw',
    'https://x.com/sporta', 'https://x.com/@sporta', 'https://twitter.com/sporta', 'https://www.twitter.com/sporta_kw', 'https://x.com/sporta/status/1', 'https://x.com/a_very_long_handle_name', 'javascript:alert(1)', 'https://x.com/ spaced', 'https://x.com/sp\\orta', '  sporta.kw  ', 'tab\there', 'line\nbreak', 'https://x.com/%41', 'ftp://x.com/a', '//x.com/a']
  const WA = ['', '96522091914', '+96522091914', '٩٦٥٢٢٠٩١٩١٤', '۹۶۵۲۲۰۹۱۹۱۴', '965 2209 1914', '(965) 2209-1914', '+965.2209.1914', '12345', '1234567', '12345678', '+123456789012345', '1234567890123456', '++96522091914', 'abc', 'wa.me/96522091914', '+ 965 22091914', '965-2209-19-14', '9652209191a']
  const cases = []
  for (const n of NETS) for (const r of RAW) cases.push({ net: n, raw: r })
  for (const r of WA) cases.push({ net: 'whatsapp', raw: r })
  const real = php(cases.map((c) => ({ [c.net]: c.raw })))
  const mine = await pg.evaluate((cs) => cs.map((c) => { const S = window.__sportaSocial, n = c.net === 'whatsapp' ? S.normWhatsapp(c.raw) : S.normSocial(c.net, c.raw); return n.ok ? { ok: n.value } : { error: n.error } }), cases)
  const diffs = []
  cases.forEach((c, i) => {
    const r = real[i], m = mine[i]
    const rv = r.ok ? r.ok[c.net] : null
    if (r.error ? !m.error : (m.error || m.ok !== rv)) diffs.push(`${c.net} ${JSON.stringify(c.raw).slice(0, 50)}: php ${JSON.stringify(r).slice(0, 60)} / addon ${JSON.stringify(m).slice(0, 60)}`)
  })
  is(diffs.length === 0, `${cases.length} inputs: the add-on accepts and stores exactly what the real PHP validator does`, diffs.slice(0, 4).join(' || '))
  is(real.filter((r) => r.ok).length > 60 && real.filter((r) => r.error).length > 60, 'the matrix has both many accepted and many refused inputs', `${real.filter((r) => r.ok).length} ok / ${real.filter((r) => r.error).length} refused`)
  const rules = STORE_PHP.slice(STORE_PHP.indexOf("$rules = [\n        'instagram'"), STORE_PHP.indexOf("[$hosts, $pathRe, $handleRe, $format]"))
  const hostsPhp = [...rules.matchAll(/\[('[^\]]+')\], '(~[^']+~D)',\s*'(\/[^']+\/D)', '([^']+)'/g)].map((m) => ({ hosts: m[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1)), path: m[2].slice(1, -2), handle: m[3].slice(1, -2), fmt: m[4].replace('%s', '') }))
  const N = await pg.evaluate(() => window.__sportaSocial.NETS.map((n) => ({ hosts: n.hosts, path: n.path.source.replace(/\\\//g, '/'), handle: n.handle.source.replace(/\\\//g, '/'), fmt: n.fmt })))
  is(hostsPhp.length === 4 && same(hostsPhp, N), 'the host list, path pattern, handle pattern and address format of the four networks are the PHP table’s', JSON.stringify(hostsPhp[0]) + ' vs ' + JSON.stringify(N[0]))
  is(/\^\\\+\?\[0-9\]\{8,15\}\$/.test(fnText('store_content_contact')) || fnText('store_content_contact').includes('{8,15}'), 'the WhatsApp rule is still 8 to 15 digits in the PHP')
  await close(pg)
}

// ================================================================================================ 3. the entry
head('the entry button')
{
  const W = makeWorld(), pg = await open(W)
  is((await pg.locator(SEL.btn).count()) === 1, 'one "Social center" button on the Settings screen')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-social-btn]'); return !!b.closest('.admin-page-header') && b.textContent.trim() === 'Social center' && b.closest('.admin-page').querySelector('h1').textContent.trim() === 'Settings' }), 'it sits in the header of Settings and reads "Social center"')
  is((await pg.evaluate(() => document.querySelector('[data-sporta-social-btn]').getBoundingClientRect().height)) >= 43.5, 'it is 44 px tall')
  is(await pg.evaluate(() => !document.querySelector('[data-sporta-seo-btn],[data-sporta-promo-new],[data-sporta-newprod-btn]')), 'it does not collide with the SEO health / New promotion / New product buttons (none is on this screen)')
  const base = W.calls.length
  await pg.waitForTimeout(600)
  is(W.calls.length === base && !W.calls.some((c) => c.route === 'products_all' || c.method === 'POST'), 'nothing is read by this block before the button is pressed (the other blocks’ own probes are not ours)')
  await pg.evaluate(() => { for (const h of document.querySelectorAll('main.admin-content .admin-page h1')) if (h.textContent === 'Settings') h.textContent = 'Something else' })
  await pg.waitForTimeout(800)
  is((await pg.locator(SEL.btn).count()) === 0, 'the button goes when the screen goes')
  await pg.evaluate(() => { for (const h of document.querySelectorAll('main.admin-content .admin-page h1')) if (h.textContent === 'Something else') h.textContent = 'Settings' })
  await pg.waitForTimeout(800)
  is((await pg.locator(SEL.btn).count()) === 1, 'and comes back with the screen, once')
  // the Site content panel (a block of its own): a visible panel gets the button below its header
  await pg.evaluate(() => {
    const main = document.querySelector('main.admin-content'), s = document.createElement('section')
    s.className = 'admin-page'; s.setAttribute('data-sporta-content', ''); s.innerHTML = '<form class="admin-page-layout"><header><h1>Site content</h1></header></form>'
    main.querySelectorAll('.admin-page').forEach((x) => { x.dataset.was = x.hidden ? '1' : '0'; x.hidden = true }); main.appendChild(s)
  })
  await pg.waitForTimeout(800)
  is(await pg.evaluate(() => { const b = document.querySelectorAll('[data-sporta-social-btn]'); return b.length === 1 && !!b[0].closest('section[data-sporta-content] form > header') }), 'on the Site content panel the one button is in that panel’s header')
  await close(pg)
  const ov = await open(makeWorld(), { name: 'overview', wait: false }); await ov.waitForTimeout(900)
  is((await ov.locator(SEL.btn).count()) === 0, 'the Overview screen has no button')
  await close(ov)
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
  await ctx.route(ORIGIN + '/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><main class="admin-content"></main></body></html>' }))
  const shop = await ctx.newPage(); await shop.goto(ORIGIN + '/shop'); await shop.addScriptTag({ content: BRANDS_JS }); await shop.waitForTimeout(800)
  is(await shop.evaluate(() => typeof window.__sportaSocial === 'undefined' && !document.querySelector('style[data-sporta-social-style]')), 'off /backends the block does not start (no flag, no style, no timer)')
  await ctx.close()
}

// ================================================================================================ 4. opening, accounts
head('accounts: open, read-only')
const W0 = makeWorld(), pg0 = await open(W0)
await openPanel(pg0)
{
  const mine = W0.calls.slice(pg0.__base).map((c) => c.route + ':' + c.method).join()
  is(mine === 'content:GET', 'pressing the button reads content (GET) and nothing else on the admin', mine)
  is(posts(W0).length === 0, 'and writes nothing')
  is(W0.calls.slice(pg0.__base).every((c) => c.headers['x-sporta-admin'] === '1'), 'every admin read carries X-Sporta-Admin: 1')
  is(await pg0.evaluate(() => document.body.getAttribute('data-sporta-social-state') === 'open' && getComputedStyle(document.querySelector('main.admin-content > section.admin-page:not([data-sporta-social])')).display === 'none'), 'the screen behind is hidden while the panel is open')
  is(await pg0.evaluate(() => { const s = document.querySelector('section.ssoc'); return s.parentElement.matches('main.admin-content') && document.activeElement === document.getElementById('ssoc-title') }), 'the panel is a section of <main> and takes focus on its heading')
  is(same(await pg0.evaluate(() => [...document.querySelectorAll('.ssoc-tab')].map((t) => t.textContent)), ['Accounts', 'Post studio', 'Share image', 'Link builder', 'Checks', 'Not built yet']), 'six tabs')
  is(await pg0.evaluate(() => document.querySelector('.ssoc-tab[aria-selected="true"]').dataset.tab) === 'accounts', 'Accounts is the first and is selected')
  is((await val(pg0, 'ssoc_instagram')) === 'sporta.kw' && (await val(pg0, 'ssoc_x')) === 'sporta_kw' && (await val(pg0, 'ssoc_whatsapp')) === '96522091914' && (await val(pg0, 'ssoc_tiktok')) === '', 'the saved addresses show as handles')
  const c = await pg0.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ssoc [data-net]')].map((x) => [x.dataset.net, x.querySelector('.ssoc-chip').textContent])))
  is(same(c, { instagram: 'Set', tiktok: 'Missing', snapchat: 'Missing', x: 'Set', whatsapp: 'Set' }), 'per-platform status: set / missing', JSON.stringify(c))
  const open = await pg0.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ssoc [data-net]')].map((x) => [x.dataset.net, (() => { const a = x.querySelector('a.ssoc-btn'); return a.getAttribute('href') + '|' + a.target + '|' + a.rel + '|' + a.getAttribute('aria-disabled') })()])))
  is(open.instagram === 'https://www.instagram.com/sporta.kw|_blank|noopener noreferrer|null' && open.x === 'https://x.com/sporta_kw|_blank|noopener noreferrer|null' && open.whatsapp.startsWith('https://wa.me/96522091914|'), '"Open" links point at the stored profile, in a new tab, without opener', JSON.stringify(open))
  is(open.tiktok.startsWith('null|') && open.tiktok.endsWith('|true'), 'a missing account has a disabled Open link', open.tiktok)
  const foot = await pg0.evaluate(() => [...document.querySelectorAll('.ssoc-foot li')].map((l) => l.textContent))
  is(same(foot, ['IG@sporta.kw', 'X@sporta_kw', 'WA+965 2209 1914']), 'the footer preview shows what the storefront will: handles and the spaced number', foot.join(' | '))
  is(await pg0.evaluate(() => { const t = document.querySelector('.ssoc').textContent; return t.includes('+96522091914') && t.includes('cs@sporta.com.kw') && !document.querySelector('.ssoc input[value="+96522091914"]') }), 'phone and e-mail are shown, read only (no input holds them)')
  const apply = await pg0.evaluate(() => document.querySelector('.ssoc-banner').dataset.state + '|' + document.querySelector('.ssoc-banner').textContent)
  is(apply.startsWith('ok|'), 'the storefront script is found and the public answer carries the accounts: no warning', apply)
  is((await saveBtn(pg0).isDisabled()) === false, 'Save is available')
  await shot(pg0, '01-accounts-1280-light')
}

head('accounts: editing, validation, preview')
{
  await pg0.fill('.ssoc [name="ssoc_instagram"]', 'new.handle')
  const cs = () => pg0.evaluate(() => document.querySelector('.ssoc-card input[name="ssoc_instagram"]').closest('.ssoc-card').querySelector('.ssoc-chip').textContent)
  is((await cs()) === 'Changed, not saved', 'a changed account reads "Changed, not saved"')
  is(await pg0.evaluate(() => document.querySelector('.ssoc-card input[name="ssoc_instagram"]').closest('.ssoc-card').querySelector('.ssoc-preview-text').textContent) === 'Footer shows: @new.handle → https://www.instagram.com/new.handle', 'the preview shows the footer text and the address that will be stored')
  await pg0.fill('.ssoc [name="ssoc_tiktok"]', 'https://www.tiktok.com/@sporta.kw/')
  is(await pg0.evaluate(() => [...document.querySelectorAll('.ssoc-foot li')].map((l) => l.textContent).join('|')).then((t) => t.includes('TT@sporta.kw')), 'a pasted address is accepted and shown as its handle')
  await pg0.fill('.ssoc [name="ssoc_snapchat"]', 'ab')
  is((await pg0.evaluate(() => document.querySelector('input[name="ssoc_snapchat"]').closest('.ssoc-card').querySelector('.ssoc-chip').textContent)) === 'Not valid', 'a value the server would refuse reads "Not valid"')
  is((await pg0.evaluate(() => document.querySelector('input[name="ssoc_snapchat"]').closest('.ssoc-card').querySelector('.ssoc-err').textContent)).startsWith('Snapchat: type the username'), 'with the same advice the Site content editor gives')
  is(await pg0.evaluate(() => document.querySelector('input[name="ssoc_snapchat"]').getAttribute('aria-invalid')) === 'true', 'and aria-invalid')
  const before = W0.calls.length
  await saveBtn(pg0).click(); await pg0.waitForTimeout(250)
  is(W0.calls.length === before && /Fix the field marked below\. Nothing was sent\./.test(await status(pg0)), 'Save with an invalid field sends nothing', await status(pg0))
  await pg0.fill('.ssoc [name="ssoc_snapchat"]', '')
  await pg0.fill('.ssoc [name="ssoc_whatsapp"]', '٩٦٥ ٥٠٠٠ ١٢٣٤')
  is((await pg0.evaluate(() => document.querySelector('input[name="ssoc_whatsapp"]').closest('.ssoc-card').querySelector('.ssoc-preview-text').textContent)).includes('+965 5000 1234 → https://wa.me/96550001234'), 'Arabic digits and spaces in the WhatsApp number are accepted as the server does')
  await pg0.fill('.ssoc [name="ssoc_whatsapp"]', '12345')
  is((await pg0.evaluate(() => document.querySelector('input[name="ssoc_whatsapp"]').closest('.ssoc-card').querySelector('.ssoc-chip').textContent)) === 'Not valid', 'a short WhatsApp number is refused')
  await shot(pg0, '02-accounts-invalid')
  await clickBtn(pg0, 'Discard changes')
  is((await val(pg0, 'ssoc_instagram')) === 'sporta.kw' && (await val(pg0, 'ssoc_tiktok')) === '' && (await val(pg0, 'ssoc_whatsapp')) === '96522091914', 'Discard changes puts back what the server has')
  await saveBtn(pg0).click(); await pg0.waitForTimeout(250)
  is(posts(W0).length === 0 && /Nothing changed/.test(await status(pg0)), 'Save with nothing changed sends nothing', await status(pg0))
}
await close(pg0)

// ================================================================================================ 5. the save
head('accounts: the save merges only the social keys')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg)
  W.delay = 350
  const read = clone(W.doc)
  await pg.fill('.ssoc [name="ssoc_instagram"]', '@Sporta.Official')
  await pg.fill('.ssoc [name="ssoc_snapchat"]', 'https://www.snapchat.com/add/sporta-kw')
  await pg.fill('.ssoc [name="ssoc_whatsapp"]', '+965 5000 1234')
  await saveBtn(pg).dblclick()
  await pg.waitForFunction(() => /Saved\./.test(document.querySelector('.ssoc-status').textContent), null, { timeout: 5000 })
  is(saved(W).length === 1, 'a double click saves once', String(saved(W).length))
  const req = saved(W)[0]
  is(req.headers['x-sporta-admin'] === '1' && /^application\/json/.test(req.headers['content-type']), 'POST content_save with X-Sporta-Admin and application/json')
  is(same(Object.keys(req.body), ['v', 'overrides', 'contact']), 'the body has exactly v, overrides and contact', Object.keys(req.body).join())
  is(req.body.v === read.v, 'it carries the version that was read')
  is(JSON.stringify(req.body.overrides) === JSON.stringify(read.overrides) && req.raw.includes(JSON.stringify(read.overrides)), 'the text rules are byte-identical to what the server returned')
  const keep = ['phone', 'email', 'address_en', 'address_ar', 'tiktok', 'x']
  is(keep.every((k) => req.body.contact[k] === read.contact[k]) && req.raw.includes(JSON.stringify(read.contact.address_ar)), 'phone, e-mail, both addresses and the unchanged accounts are sent exactly as read', keep.map((k) => k + '=' + req.body.contact[k]).join(' '))
  is(same(Object.keys(req.body.contact), Object.keys(read.contact)), 'the contact keys are the same, in the same order')
  is(req.body.contact.instagram === 'https://www.instagram.com/Sporta.Official' && req.body.contact.snapchat === 'https://www.snapchat.com/add/sporta-kw' && req.body.contact.whatsapp === '96550001234', 'the three changed accounts are sent in the form the server stores', JSON.stringify([req.body.contact.instagram, req.body.contact.snapchat, req.body.contact.whatsapp]))
  is(W.doc.v === 8 && W.doc.contact.instagram === 'https://www.instagram.com/Sporta.Official' && W.doc.contact.phone === read.contact.phone && JSON.stringify(W.doc.overrides) === JSON.stringify(read.overrides), 'the server now holds the new accounts and every other field unchanged')
  is((await val(pg, 'ssoc_instagram')) === 'Sporta.Official' && (await val(pg, 'ssoc_whatsapp')) === '96550001234', 'the form shows the saved values')
  is(same(await pg.evaluate(() => [...document.querySelectorAll('.ssoc [data-net]')].map((x) => x.querySelector('.ssoc-chip').textContent)), ['Set', 'Missing', 'Set', 'Set', 'Set']), 'every changed account reads Set again')
  await pg.waitForFunction(() => document.querySelector('.ssoc-banner').dataset.state !== 'info', null, { timeout: 4000 }).catch(() => {})
  // a second save after a save uses the NEW version and still keeps returns
  await pg.fill('.ssoc [name="ssoc_x"]', 'sporta_kw2')
  W.delay = 0
  await saveBtn(pg).click(); await pg.waitForFunction(() => /Saved\./.test(document.querySelector('.ssoc-status').textContent) && document.querySelector('input[name="ssoc_x"]').value === 'sporta_kw2')
  is(saved(W).length === 2 && saved(W)[1].body.v === 8, 'the next save carries the new version (8)')
  await tabBtn(pg, 'studio'); await pg.waitForSelector('textarea[name="ssoc_caption"]')
  await close(pg)
}
head('accounts: failures and a stale version')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg)
  const tryOne = async (setup, expectText, label) => {
    await pg.fill('.ssoc [name="ssoc_tiktok"]', 'try' + Math.random().toString(36).slice(2, 7))
    setup(); await saveBtn(pg).click()
    await pg.waitForFunction(() => !/^Saving/.test(document.querySelector('.ssoc-status').textContent), null, { timeout: 4000 })
    const st = await status(pg)
    is(expectText.test(st), label, st)
    is(!(await saveBtn(pg).isDisabled()) && (await saveBtn(pg).textContent()) === 'Save accounts', '... and Save is available again')
  }
  await tryOne(() => { W.next = { status: 401, body: { error: 'not_signed_in' } } }, /sign-in has ended/, '401 is worded: sign in again')
  await tryOne(() => { W.next = { status: 429, body: { error: 'rate_limited' }, headers: { 'Retry-After': '30' } } }, /Wait 30 seconds/, '429 says how long to wait (Retry-After)')
  await tryOne(() => { W.next = { status: 400, body: { error: 'invalid_contact_tiktok' } } }, /TikTok: type the username/, '400 invalid_contact_tiktok is worded as the editor words it')
  is(await pg.evaluate(() => document.querySelector('input[name="ssoc_tiktok"]').closest('.ssoc-card').querySelector('.ssoc-err').textContent.length > 0), 'and the field carries the server’s refusal')
  await tryOne(() => { W.drop = true }, /Could not reach the server/, 'a dead network is worded'); W.drop = false
  await tryOne(() => { W.next = { status: 500, body: { error: 'server_error' } } }, /could not do that \(server_error\)/, 'any other refusal names its code')
  // stale version
  W.doc.v = 9; W.doc.contact.address_en = 'Changed in another window'
  await pg.fill('.ssoc [name="ssoc_tiktok"]', 'typed.before.conflict')
  const n0 = saved(W).length
  await saveBtn(pg).click()
  await pg.waitForFunction(() => /changed in another window/.test(document.querySelector('.ssoc-status').textContent), null, { timeout: 4000 })
  await pg.waitForTimeout(300)
  is(saved(W).length === n0 + 1 && W.calls.filter((c) => c.route === 'content' && c.method === 'GET').length >= 2, 'a stale version (409) is refused by the server, and the document is reloaded')
  is((await val(pg, 'ssoc_tiktok')) === 'typed.before.conflict', 'what was typed is kept')
  await saveBtn(pg).click(); await pg.waitForFunction(() => /^Saved\./.test(document.querySelector('.ssoc-status').textContent), null, { timeout: 4000 })
  const last = saved(W)[saved(W).length - 1]
  is(last.body.v === 9 && last.body.contact.address_en === 'Changed in another window' && W.doc.contact.tiktok === 'https://www.tiktok.com/@typed.before.conflict' && W.doc.contact.address_en === 'Changed in another window', 'the second Save carries the new version and keeps the other window’s change')
  await close(pg)
  // no route
  const W2 = makeWorld(); W2.routes404.add('content')
  const p2 = await open(W2); await openPanel(p2)
  is(/not available until the next update/.test(await p2.evaluate(() => document.querySelector('.ssoc-banner').textContent)) && (await saveBtn(p2).isDisabled()) && (await p2.locator('input[name="ssoc_instagram"]').isDisabled()), 'when the shop server has no content route the panel says so and offers no Save')
  await close(p2)
  // a storefront that does not apply the accounts
  const W3 = makeWorld(); W3.features = '/* an old build */'; W3.publicContact = { v: 7, overrides: [], contact: { instagram: '' } }
  const p3 = await open(W3); await openPanel(p3)
  await p3.waitForFunction(() => document.querySelector('.ssoc-banner').dataset.state === 'warn', null, { timeout: 4000 }).catch(() => {})
  const ban = await p3.evaluate(() => document.querySelector('.ssoc-banner').textContent)
  is(/may not be applying/.test(ban) && /sporta-features\.js/.test(ban) && /Instagram is saved here but the public answer carries nothing/.test(ban), 'a storefront that lacks the script, or whose public answer lacks the accounts, is warned about', ban.slice(0, 200))
  await shot(p3, '03-accounts-warning')
  await close(p3)
}

// ================================================================================================ 6. post studio
head('post studio: captions')
const Ws = makeWorld(), pgS = await open(Ws, { w: 1280 })
await openPanel(pgS, 'studio')
const PRICE_RE = /KWD|د\.ك|\d+[.,]\d{2,3}\b/
{
  is(Ws.calls.some((c) => c.route === 'products_all') && Ws.calls.some((c) => c.route === 'brands') && posts(Ws).length === 0, 'the Post studio reads products_all and brands and writes nothing')
  const opts = await pgS.evaluate(() => [...document.querySelectorAll('select[name="ssoc_product"] option')].map((o) => o.textContent))
  is(opts.length === 7 && !opts.some((t) => /Hidden Cap/.test(t)), 'the products are the 7 active ones (the hidden one is not offered)', opts.length + '')
  await pick(pgS, 1)
  const ar0 = await master(pgS)
  is(/تيشيرت فانكويش للتمارين/.test(ar0) && /#فانكويش/.test(ar0) && /#الكويت/.test(ar0) && /#سبورتا/.test(ar0) && /#Kuwait/.test(ar0) && /#ملابس_رجالية/.test(ar0), 'Arabic is the first language: the name, brand, category and #الكويت #سبورتا #Kuwait hashtags', ar0)
  is(/توصيل خلال ٢٤ ساعة/.test(ar0) && /إرجاع خلال ١٤ يومًا/.test(ar0) && /الدفع عند الاستلام/.test(ar0) && /اطلب الآن: https:\/\/www\.sporta\.com\.kw\/product\/vanquish-pro-tee\?utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals/.test(ar0), 'with delivery in 24 hours, 14-day returns (Arabic plural), cash on delivery and the call to action', ar0)
  await pgS.click('.ssoc .ssoc-segbtn:has-text("English")')
  const en0 = await master(pgS)
  is(/Vanquish Pro Training Tee/.test(en0) && /Delivery within 24 hours/.test(en0) && /14-day returns/.test(en0) && /Cash on delivery/.test(en0) && /#Vanquish #MensWear #MensActivewear #Kuwait #Sporta/.test(en0), 'English: the same facts, and the brand / category / #Kuwait #Sporta hashtags', en0)
  is(/Shop now: https:\/\/www\.sporta\.com\.kw\/product\/vanquish-pro-tee\?lang=en&utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals/.test(en0), 'the English link is on the canonical host with ?lang=en, then the utm parameters', en0)
  is(!/lang=/.test(ar0) && ar0.includes('https://www.sporta.com.kw/product/vanquish-pro-tee?utm_'), 'the Arabic link is the bare path (no ?lang=)')
  is(!PRICE_RE.test(ar0) && !PRICE_RE.test(en0) && !/1 KWD|دينار/.test(en0 + ar0), 'NO price in either caption by default (not even the delivery fee)')
  const v = await variants(pgS)
  is(!Object.values(v).some((x) => PRICE_RE.test(x.text)), 'nor in any platform version')
  // determinism
  await close(pgS)
  const W2 = makeWorld(), p2 = await open(W2); await openPanel(p2, 'studio'); await pick(p2, 1)
  const ar1 = await master(p2); await p2.click('.ssoc .ssoc-segbtn:has-text("English")'); const en1 = await master(p2)
  is(ar1 === ar0 && en1 === en0, 'determinism: a fresh page builds byte-identical captions for the same product')
  const fn = await p2.evaluate(() => { const S = window.__sportaSocial, p = { id: 1, slug: 'vanquish-pro-tee', name_en: 'Vanquish Pro Training Tee', name_ar: 'تيشيرت', category: 'men', brand_slug: 'vanquish', price: '12.500' }; const o = { facts: { delivery: true, returns: true, cod: true }, style: -1, link: 'https://www.sporta.com.kw/x' }; return [S.caption(p, {}, 'en', o), S.caption(p, {}, 'en', o), S.caption(p, {}, 'ar', o), S.caption(p, {}, 'ar', o), S.caption({ ...p, slug: 'other-slug-b' }, {}, 'en', o)] })
  is(fn[0] === fn[1] && fn[2] === fn[3], 'the template function is pure: same input, same text')
  is(new Set(await p2.evaluate(() => { const S = window.__sportaSocial, out = []; for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) out.push(S.caption({ id: 1, slug: s, name_en: 'Tee', name_ar: 'تيشيرت', category: 'men', brand_slug: '', price: '1' }, {}, 'en', { style: -1, link: '' }).split('\n')[0]); return out })).size > 1, 'the opening line varies with the product (Auto), not at random')
  await p2.selectOption('.ssoc select >> nth=1', '0'); const hook0 = (await master(p2)).split('\n')[0]
  await p2.selectOption('.ssoc select >> nth=1', '2'); const hook2 = (await master(p2)).split('\n')[0]
  is(/^New in at Sporta: /.test(hook0) && /^Train in /.test(hook2), 'the opening-line choice (New in / Training / Gym ready) changes only the first line', hook0 + ' | ' + hook2)
  await close(p2)
}
const Wp = makeWorld(), pP = await open(Wp); await openPanel(pP, 'studio')
head('post studio: price, returns window, edits')
{
  await pick(pP, 1); await pP.click('.ssoc .ssoc-segbtn:has-text("English")')
  await pP.locator('.ssoc label.ssoc-check:has-text("Include the price")').first().click()
  const en = await master(pP)
  is(/Price: KWD 12\.500\n/.test(en), 'ticking "Include the price" adds the product price with three decimals', en.split('\n').slice(0, 3).join(' / '))
  await pP.click('.ssoc .ssoc-segbtn:has-text("العربية")')
  const ar = await master(pP)
  is(/السعر: 12\.500 د\.ك/.test(ar), 'and the Arabic caption says it in Arabic with the same figure', ar.split('\n').slice(0, 3).join(' / '))
  await pick(pP, 3)
  is(/السعر: 9\.500 د\.ك/.test(await master(pP)), 'a price stored as 9.5 is written 9.500')
  await pick(pP, 2)
  is(/السعر: 15\.000/.test(await master(pP)), 'a price on sale shows the sale price while the sale is on')
  await pick(pP, 4)
  is(/السعر: 10\.000/.test(await master(pP)), 'an ended sale is ignored: the regular price')
  await pP.locator('.ssoc label.ssoc-check:has-text("Include the price")').first().click()
  is(!PRICE_RE.test(await master(pP)), 'unticking removes the price again')
  const pv = await pP.evaluate(() => { const S = window.__sportaSocial; return [S.priceOf({ price: '3' }).text, S.priceOf({ price: '3.14159' }).text, S.priceOf({ price: '0' }), S.priceOf({ price: 'abc' }), S.priceOf({ price: '12.5', sale_price: '20' }).text] })
  is(same(pv, ['3.000', '3.142', null, null, '12.500']), 'priceOf: three decimals, nothing for 0 or junk, a sale price above the price is ignored', JSON.stringify(pv))
  // edits are kept
  await pick(pP, 1)
  await pP.fill('.ssoc textarea[name="ssoc_caption"]', 'My own words. https://www.sporta.com.kw/product/vanquish-pro-tee #Sporta')
  await pP.locator('.ssoc label.ssoc-check:has-text("Cash on delivery")').first().click()
  is((await master(pP)).startsWith('My own words.') && /kept/.test(await status(pP)), 'an edited caption is kept when an option changes, and the owner is told', await status(pP))
  await clickBtn(pP, 'Rebuild caption')
  is(!(await master(pP)).startsWith('My own words.') && /^New in|^[^\n]*\n/.test(await master(pP)), 'Rebuild caption starts again from the template')
  await pP.locator('.ssoc label.ssoc-check:has-text("Cash on delivery")').first().click()
  // the returns window comes from the shop's returns settings
  await close(pP)
  const W = makeWorld(); W.doc.returns.window_days = 30
  const p = await open(W); await openPanel(p, 'studio'); await pick(p, 1)
  is(/إرجاع خلال ٣٠ يومًا/.test(await master(p)), 'the return window is the shop’s own setting (30 days, Arabic plural)', (await master(p)).split('\n').slice(2, 6).join(' / '))
  await p.click('.ssoc .ssoc-segbtn:has-text("English")'); is(/30-day returns/.test(await master(p)), 'and in English')
  await close(p)
  const W2 = makeWorld(); W2.doc.returns.allow_return = false
  const p2 = await open(W2); await openPanel(p2, 'studio'); await pick(p2, 1)
  is(!/إرجاع/.test(await master(p2)), 'with returns switched off in the shop settings the caption does not promise them')
  const arDays = await p2.evaluate(() => { const S = window.__sportaSocial; return [1, 2, 3, 10, 11, 14, 21].map((n) => S.caption({ id: 1, slug: 's', name_en: 'T', name_ar: 'ت', category: '', brand_slug: '' }, {}, 'ar', { facts: { returns: true }, returnDays: n, link: '' }).split('\n').filter((l) => /إرجاع/.test(l))[0]) })
  is(same(arDays, ['• إرجاع خلال يوم واحد', '• إرجاع خلال يومين', '• إرجاع خلال ٣ أيام', '• إرجاع خلال ١٠ أيام', '• إرجاع خلال ١١ يومًا', '• إرجاع خلال ١٤ يومًا', '• إرجاع خلال ٢١ يومًا']), 'Arabic counting for the window: 1, 2, 3-10 plural, 11+ singular', arDays.join(' | '))
  await close(p2)
}

head('post studio: platforms, limits, links, WhatsApp, copy')
const W7 = makeWorld(), p7 = await open(W7); await openPanel(p7, 'studio')
{
  await pick(p7, 1)
  let v = await variants(p7)
  is(v.instagram.limit === 2200 && v.tiktok.limit === 2200 && v.snapchat.limit === 80 && v.x.limit === 280, 'the limits: Instagram 2200, TikTok 2200, Snapchat 80, X 280')
  is(Object.values(v).every((x) => x.n <= x.limit && /ssoc-count--ok/.test(x.cls)), 'a normal product fits every platform and each counter reads ok', JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.n]))))
  is(/الرابط في البايو/.test(v.instagram.text) && !/https?:\/\//.test(v.instagram.text) && /الرابط في البايو/.test(v.tiktok.text), 'Instagram and TikTok say "link in bio" instead of an unclickable link')
  const bio = await p7.evaluate(() => Object.fromEntries([...document.querySelectorAll('input[name^="ssoc_link_"]')].map((i) => [i.name.slice(10), i.value])))
  is(bio.instagram === ORIGIN + '/product/vanquish-pro-tee?utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals' && bio.tiktok.includes('utm_source=tiktok') && bio.snapchat.includes('utm_source=snapchat'), 'each platform has its own link with its own utm_source on the canonical host', JSON.stringify(bio))
  is(/\?utm_source=x&utm_medium=social&utm_campaign=new_arrivals/.test(v.x.text) && v.x.text.includes(ORIGIN + '/product/vanquish-pro-tee'), 'the X version carries a link with utm_source=x')
  is(v.snapchat.text.split('\n').length === 1 && !/https?:/.test(v.snapchat.text), 'Snapchat is only the hook', v.snapchat.text)
  await p7.click('.ssoc .ssoc-segbtn:has-text("English")')
  v = await variants(p7)
  const bioEn = await p7.evaluate(() => document.querySelector('input[name="ssoc_link_instagram"]').value)
  is(bioEn === ORIGIN + '/product/vanquish-pro-tee?lang=en&utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals' && /link in bio/i.test(v.instagram.text), 'English: ?lang=en first, then the utm parameters; "link in bio"', bioEn)
  // WhatsApp
  const wa = await p7.inputValue('.ssoc input[name="ssoc_wa_link"]')
  const waText = decodeURIComponent(wa.replace('https://wa.me/?text=', ''))
  is(wa.startsWith('https://wa.me/?text=') && waText.includes('utm_source=whatsapp') && !waText.includes('utm_source=instagram') && waText.includes('Vanquish Pro Training Tee'), 'the WhatsApp share link is wa.me/?text= with the caption and a whatsapp-sourced link')
  is(await p7.evaluate(() => { const a = [...document.querySelectorAll('.ssoc a.ssoc-btn')].find((x) => /WhatsApp/.test(x.textContent)); return a.target === '_blank' && a.rel === 'noopener noreferrer' && a.href.startsWith('https://wa.me/?text=') }), 'its Open link opens in a new tab without opener')
  // copy
  await p7.locator('.ssoc').getByRole('button', { name: 'Copy caption' }).click()
  await p7.locator('.ssoc').getByRole('button', { name: 'Copy for X (Twitter)' }).click()
  await p7.locator('.ssoc').getByRole('button', { name: 'Copy for Instagram' }).click()
  const copied = await p7.evaluate(() => window.__copied)
  const taX = (await variants(p7)).x.text, taIg = (await variants(p7)).instagram.text
  is(copied.length === 3 && copied[0] === (await master(p7)) && copied[1] === taX && copied[2] === taIg, 'the copy buttons copy exactly the text on screen', copied.map((c) => c.length).join(','))
  is(/Copied/.test(await status(p7)), 'and say so')
  // limits: the long-name product
  await pick(p7, 7)
  for (const lang of ['English', 'العربية']) {
    await p7.click(`.ssoc .ssoc-segbtn:has-text("${lang}")`)
    v = await variants(p7)
    is(v.x.n <= 280 && v.snapchat.n <= 80 && v.instagram.n <= 2200 && v.tiktok.n <= 2200, `${lang}: a 130-character product name still fits X (${v.x.n}/280), Snapchat (${v.snapchat.n}/80), Instagram, TikTok`)
    is(v.x.text.includes('https://www.sporta.com.kw/product/long-name') && /utm_source=x/.test(v.x.text), `${lang}: the X version keeps its link when it is trimmed`)
  }
  // an over-long caption is flagged, never cut
  await p7.fill('.ssoc textarea[name="ssoc_caption"]', 'ا'.repeat(2300) + ' https://www.sporta.com.kw/product/long-name')
  v = await variants(p7)
  is(v.instagram.n > 2200 && /ssoc-count--error/.test(v.instagram.cls) && v.x.n <= 280, 'a 2300-character master turns Instagram’s counter to the error colour, while the X version is trimmed to fit', JSON.stringify([v.instagram.n, v.x.n]))
  const pure = await p7.evaluate(() => {
    const S = window.__sportaSocial, tags = Array.from({ length: 40 }, (_, i) => '#tag' + i).join(' ')
    const m = 'Hook line for the product\n\nPrice: KWD 12.500\n\n• Delivery within 24 hours\n• 14-day returns\n• Cash on delivery\n\nShop now: https://www.sporta.com.kw/product/a?utm_source=instagram\n\n' + tags
    const x = S.variant('x', m, 'en', 'https://www.sporta.com.kw/product/a?utm_source=x'), sc = S.variant('snapchat', 'w '.repeat(100), 'en', ''), ig = S.variant('instagram', m, 'en', '')
    return { x, xn: S.weighted(x, 'x'), sc, scn: Array.from(sc).length, ig, tagsInX: (x.match(/#tag/g) || []).length, w: S.weighted('a https://www.sporta.com.kw/product/a?utm_source=x&utm_medium=social b', 'x') }
  })
  is(pure.xn <= 280 && pure.tagsInX <= 3 && pure.scn <= 80 && pure.w === 2 + 23 + 2 && !pure.ig.includes('https://'), 'variant(): X holds at most 3 hashtags and 280 weighted characters, a link weighs 23; Snapchat 80; Instagram drops the link', JSON.stringify([pure.xn, pure.tagsInX, pure.scn, pure.w]))
  is(posts(W7).length === 0, 'nothing in the studio wrote anything')
  await shot(p7, '04-studio-1280-light')
  await close(p7)
}

// ================================================================================================ 7. share image
head('share image: canvas export')
const Wi = makeWorld(), pI = await open(Wi, { w: 1280 })
await openPanel(pI, 'image')
let cardN = 0
const download = async (pg) => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 6000 }), pg.locator('.ssoc').getByRole('button', { name: 'Download PNG' }).click()]); const path = await d.path(), buf = readFileSync(path); if (SHOTS) writeFileSync(join(SHOTS, 'card-' + (++cardN) + '-' + d.suggestedFilename()), buf); return { name: d.suggestedFilename(), buf } }
const waitDrawn = (pg, size) => pg.waitForFunction((s) => document.querySelector('canvas.ssoc-canvas').dataset.size === s, size, { timeout: 4000 })
{
  await pick(pI, 1); await waitDrawn(pI, '1080x1080')
  const reqs0 = Wi.requests.map((r) => r.path)
  is(reqs0.includes('/logo.png') && reqs0.includes('/images/products/vanquish-pro-tee.png'), 'the light card loads the dark-text logo and the product photo from this site')
  const sq = await download(pI)
  const hd = pngHeader(sq.buf)
  is(sq.buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && hd.w === 1080 && hd.h === 1080, 'the post is a real PNG of exactly 1080 x 1080', JSON.stringify(hd))
  is(/^sporta-vanquish-pro-tee-ar-1080x1080\.png$/.test(sq.name), 'named after the product, language and size', sq.name)
  const img = png(sq.buf)
  const at = (x, y) => { const p = img.at(x, y); return [p.r, p.g, p.b] }
  is(same(at(6, 500), [0xE2, 0xDB, 0xCE]) && same(at(540, 6), [0xE0, 0x56, 0x1C]), 'the light card is the brand beige (#E2DBCE) with an orange (#E0561C) top bar', JSON.stringify([at(6, 500), at(540, 6)]))
  const dataA = await pI.evaluate(() => document.querySelector('canvas.ssoc-canvas').toDataURL('image/png').length)
  await pI.locator('.ssoc .ssoc-pane:not([hidden]) label.ssoc-check:has-text("Include the price")').click(); await pI.waitForTimeout(400)
  const dataB = await pI.evaluate(() => document.querySelector('canvas.ssoc-canvas').toDataURL('image/png').length)
  is(dataB !== dataA, 'ticking "Include the price" changes the picture (a price pill is drawn)')
  const withPrice = png((await download(pI)).buf)
  const pill = []; for (let y = 780; y < 1010; y += 4) pill.push(Object.values(withPrice.at(1000, y)).slice(0, 3).join())
  is(pill.some((c) => c === '224,86,28'), 'the price pill (right-aligned in the Arabic card) is brand orange', pill.slice(0, 3).join(' '))
  await pI.locator('.ssoc .ssoc-pane:not([hidden]) label.ssoc-check:has-text("Include the price")').click()
  await pI.click('.ssoc .ssoc-segbtn:has-text("Story")'); await waitDrawn(pI, '1080x1920')
  const st = await download(pI), sh = pngHeader(st.buf)
  is(sh.w === 1080 && sh.h === 1920 && /1080x1920\.png$/.test(st.name), 'the story is a PNG of exactly 1080 x 1920', JSON.stringify(sh) + st.name)
  is(await pI.evaluate(() => { const c = document.querySelector('canvas.ssoc-canvas'); return c.width === 1080 && c.height === 1920 && c.getBoundingClientRect().width < 400 }), 'and its preview is shown smaller than the post')
  await pI.selectOption('.ssoc select[name="ssoc_img_theme"]', 'dark'); await pI.waitForTimeout(500)
  is(Wi.requests.some((r) => r.path === '/logo-white.png'), 'the charcoal card uses the white-text logo')
  const dk = png((await download(pI)).buf)
  is(same(Object.values(dk.at(6, 900)).slice(0, 3), [0x17, 0x1A, 0x1E]), 'the charcoal card is #171A1E', JSON.stringify(dk.at(6, 900)))
  await pI.selectOption('.ssoc select[name="ssoc_img_theme"]', 'orange'); await pI.waitForTimeout(500)
  const or = png((await download(pI)).buf)
  is(same(Object.values(or.at(6, 900)).slice(0, 3), [0xE0, 0x56, 0x1C]), 'the orange card is #E0561C')
  await pI.click('.ssoc .ssoc-segbtn:has-text("Post")'); await waitDrawn(pI, '1080x1080')
  await pI.click('.ssoc .ssoc-segbtn:has-text("English")'); await pI.waitForTimeout(300)
  is(/-en-1080x1080\.png$/.test((await download(pI)).name), 'English gives an English card (name carries -en-)')
  await shot(pI, '05-image-1280-light')
  // same-origin only
  await pick(pI, 8); await pI.waitForTimeout(500)
  const sel = await pI.evaluate(() => [...document.querySelector('.ssoc select[name="ssoc_img_photo"]').options].map((o) => o.textContent))
  is(same(sel, ['Photo 1', 'No photo']), 'a product whose photo is on another host, or a protocol-relative address, offers only its own-site photo', sel.join())
  is(Wi.requests.every((r) => r.origin === ORIGIN), 'EVERY request this page made, the whole run, went to the shop’s own origin (no evil.example)', [...new Set(Wi.requests.map((r) => r.origin))].join())
  await pick(pI, 5); await pI.waitForTimeout(500)
  is(/no photo on this site/.test(await pI.evaluate(() => document.querySelector('.ssoc-canvas-wrap p').textContent)), 'a product with no photo gets a plate and the owner is told')
  const nop = png((await download(pI)).buf)
  is(nop.w === 1080 && nop.h === 1080, 'and still exports a 1080 x 1080 PNG')
  is(posts(Wi).length === 0 && !Wi.requests.some((r) => r.method !== 'GET' && !/admin\.php/.test(r.path)), 'nothing is uploaded: no POST at all')
  await close(pI)
}

// ================================================================================================ 8. link builder
head('link builder')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg, 'links')
  const out = async () => pg.evaluate(() => ({ ar: document.querySelector('input[name="ssoc_lb_out_ar"]').value, en: document.querySelector('input[name="ssoc_lb_out_en"]').value, err: document.querySelector('.ssoc-err:not([hidden])')?.textContent || '' }))
  let o = await out()
  is(o.ar === ORIGIN + '/?utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals' && o.en === ORIGIN + '/?lang=en&utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals', 'home: Arabic is the bare path, English is ?lang=en, then utm_source / medium / campaign', JSON.stringify(o))
  await pg.fill('.ssoc input[name="ssoc_lb_path"]', '/product/vanquish-pro-tee'); o = await out()
  is(o.ar.startsWith(ORIGIN + '/product/vanquish-pro-tee?utm_source=') && o.en.startsWith(ORIGIN + '/product/vanquish-pro-tee?lang=en&utm_source='), 'a product path')
  await pg.fill('.ssoc input[name="ssoc_lb_path"]', '/shop?sale=1'); o = await out()
  is(o.ar === ORIGIN + '/shop?sale=1&utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals' && o.en === ORIGIN + '/shop?sale=1&lang=en&utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals', 'Sporta Outlet: an existing query is kept, lang and utm follow it', JSON.stringify(o))
  await pg.fill('.ssoc input[name="ssoc_lb_path"]', ORIGIN + '/about?lang=en&utm_source=old'); o = await out()
  is(o.ar === ORIGIN + '/about?utm_source=instagram&utm_medium=social&utm_campaign=new_arrivals' && o.en.includes('/about?lang=en&utm_source=instagram'), 'a pasted canonical address works, and an old lang / utm is replaced, not doubled', JSON.stringify(o))
  for (const bad of ['https://evil.example/shop', '//evil.example/x', 'javascript:alert(1)', '/a b', '/../etc', 'shop', '/x#frag', '/x"y', 'http://www.sporta.com.kw/']) {
    await pg.fill('.ssoc input[name="ssoc_lb_path"]', bad); o = await out()
    is(o.ar === '' && o.en === '' && /not a page of the shop/.test(o.err), `refused: ${bad}`)
  }
  await pg.fill('.ssoc input[name="ssoc_lb_path"]', '/shop')
  await pg.evaluate(() => { const s = [...document.querySelectorAll('.ssoc select')].filter((x) => [...x.options].some((o) => o.value === '__custom__')); s[2].value = '__custom__'; s[2].dispatchEvent(new Event('change', { bubbles: true })) })
  await pg.fill('.ssoc input[name="ssoc_lb_campaign_custom"]', ' White Friday 2026! ')
  o = await out()
  is(o.ar === ORIGIN + '/shop?utm_source=instagram&utm_medium=social&utm_campaign=white_friday_2026', 'a custom campaign is lower-cased, spaces become _, anything but letters, digits, - and _ is dropped', o.ar)
  await pg.fill('.ssoc input[name="ssoc_lb_campaign_custom"]', '!!!'); o = await out()
  is(o.ar === '' && /utm_campaign is empty/.test(o.err), 'a custom value with nothing usable in it is refused')
  await pg.fill('.ssoc input[name="ssoc_lb_campaign_custom"]', 'eid'); await pg.fill('.ssoc input[name="ssoc_lb_content"]', 'Story 1'); o = await out()
  is(o.ar.endsWith('utm_campaign=eid&utm_content=story_1'), 'the optional utm_content is added last', o.ar)
  await pg.locator('.ssoc').getByRole('button', { name: 'Copy', exact: true }).first().click()
  is((await pg.evaluate(() => window.__copied[0])) === o.ar, 'Copy copies the Arabic link')
  const fn = await pg.evaluate(() => { const S = window.__sportaSocial; return [S.utmValue('New Arrivals'), S.utmValue('-x'), S.utmValue('A'.repeat(60)).length, S.cleanPath('/'), S.cleanPath(''), S.cleanPath('/a?b=c'), S.buildLink('/', 'ar', {}), S.buildLink('/x', 'en', {})] })
  is(same(fn, ['new_arrivals', 'x', 40, '/', '/', '/a?b=c', ORIGIN + '/', ORIGIN + '/x?lang=en']), 'the helpers behave', JSON.stringify(fn))
  is(UTM_LISTS_OK(await pg.evaluate(() => window.__sportaSocial.UTM)), 'the source / medium / campaign lists are the documented ones')
  await shot(pg, '06-links-1280-light')
  await close(pg)
}
function UTM_LISTS_OK(u) { return u.source.includes('instagram') && u.source.includes('whatsapp') && u.medium.includes('social') && u.campaign.includes('new_arrivals') && [...u.source, ...u.medium, ...u.campaign].every((x) => /^[a-z0-9_]+$/.test(x)) }

// ================================================================================================ 9. checks
head('checks')
const runChecks = async (W, opt = {}) => {
  const pg = await open(W, opt); await openPanel(pg, 'checks')
  await pg.locator('.ssoc').getByRole('button', { name: 'Run the checks' }).click()
  await pg.waitForFunction(() => document.querySelectorAll('.ssoc-item').length > 0, null, { timeout: 20000 })
  const items = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ssoc-item')].map((l) => [l.dataset.id, { state: l.dataset.state, text: l.textContent }])))
  return { pg, items, W }
}
{
  const g = await runChecks(makeWorld())
  const st = (k) => g.items[k] && g.items[k].state
  is(['tags-home', 'tags-home-en', 'tags-product'].every((k) => st(k) === 'pass'), 'good world: the home page (ar, en) and a product page carry og:title, og:description, og:image and twitter:card', JSON.stringify(Object.fromEntries(Object.entries(g.items).map(([k, v]) => [k, v.state]))))
  is(Object.keys(g.items).filter((k) => /^image-/.test(k)).length >= 1 && Object.entries(g.items).filter(([k]) => /^image-/.test(k)).every(([, v]) => v.state === 'pass'), 'the share picture answers (image/png) and is on this site')
  is(st('robots') === 'pass' && st('canonical') === 'pass' && st('script') === 'pass' && st('public') === 'pass', 'robots.txt lets the social crawlers in, the canonical host, the storefront script and the public answer pass')
  is(st('footer') === 'pass' && /Instagram: matches/.test(g.items.footer.text) && /X \(Twitter\): matches/.test(g.items.footer.text) && /WhatsApp: matches/.test(g.items.footer.text), 'the footer links (read by the real sporta-features.js in a sandboxed frame) match the settings', g.items.footer && g.items.footer.text)
  is(Object.values(g.items).every((x) => x.state === 'pass'), 'so every check passes', JSON.stringify(Object.fromEntries(Object.entries(g.items).filter(([, v]) => v.state !== 'pass').map(([k, v]) => [k, v.state]))))
  is(g.W.requests.every((r) => r.origin === ORIGIN && (r.method === 'GET' || /admin\.php/.test(r.path))) && g.W.calls.every((c) => c.method === 'GET'), 'the checks made only GETs, all to the shop’s own origin')
  is(await g.pg.evaluate(() => !document.querySelector('iframe')), 'and removed the sandboxed frame they used')
  await shot(g.pg, '07-checks-pass')
  await close(g.pg)
}
{
  const bad = [
    ['og:image missing on the home page', (W) => { W.ogImage = null }, 'tags-home', /Missing: og:image/],
    ['twitter:card missing', (W) => { W.homeCard = null }, 'tags-home', /twitter:card/],
    ['og:title missing', (W) => { W.homeTitle = null }, 'tags-home-en', /og:title/],
    ['share picture 404', (W) => { W.ogStatus = 404 }, /^image-/, /HTTP 404/],
    ['share picture over 600 kB', (W) => { W.ogBig = true }, /^image-/, /kB/, 'warn'],
    ['robots blocks the Facebook crawler', (W) => { W.robots = 'User-agent: facebookexternalhit\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }, 'robots', /Facebook and Instagram/],
    ['robots blocks everyone', (W) => { W.robots = 'User-agent: *\nDisallow: /\n' }, 'robots', /Twitterbot|X \(Twitter\)|Facebook/],
    ['robots blocks the pictures for Twitterbot', (W) => { W.robots = 'User-agent: Twitterbot\nDisallow: /images/\nDisallow: /og-image.png\n\nUser-agent: *\nAllow: /\n' }, 'robots', /X \(Twitter\)/],
    ['robots.txt missing', (W) => { W.robots = null }, 'robots', /HTTP 404/],
    ['storefront script missing', (W) => { W.features = '/* old */' }, 'script', /did not load or has no link rewriting/],
    ['home does not link the script', (W) => { W.homeScript = false }, 'script', /does not link it/, 'warn'],
    ['footer shows another handle', (W) => { W.features = '/* planLink instagram.com */' }, 'footer', /footer links to https:\/\/www\.instagram\.com\/old\.handle, saved is https:\/\/www\.instagram\.com\/sporta\.kw/],
    ['footer lacks a saved platform', (W) => { W.doc.contact.snapchat = 'https://www.snapchat.com/add/sporta'; W.features = FEATURES_JS }, 'footer', /Snapchat: saved, but the footer has no Snapchat link/],
    ['canonical on another host', (W) => { W.canonical = 'https://sporta.com.kw/' }, 'canonical', /sporta\.com\.kw/, 'warn'],
  ]
  for (const [label, setup, id, re, state = 'fail'] of bad) {
    const W = makeWorld(); setup(W)
    const g = await runChecks(W)
    const key = id instanceof RegExp ? Object.keys(g.items).find((k) => id.test(k)) : id
    const it = g.items[key]
    is(!!it && it.state === state && re.test(it.text), `world built to fail: ${label} -> ${key} ${state} with plain advice`, it ? it.state + ' ' + it.text.slice(0, 160) : 'no item ' + key)
    if (label === 'robots blocks the Facebook crawler') { is(/Remove the Disallow/.test(it.text), 'the advice says what to remove'); await shot(g.pg, '08-checks-fail') }
    await close(g.pg)
  }
  const og = makeWorld(); og.canonical = ORIGIN + '/'
  const ogw = await runChecks(Object.assign(og, { ogImage: null }))
  is(ogw.items['tags-home'].state === 'fail', 'sanity: the failing world fails'); await close(ogw.pg)
  const r = await (async () => { const W = makeWorld(), pg = await open(W); const x = await pg.evaluate(() => { const S = window.__sportaSocial, t = 'User-agent: *\nAllow: /\nDisallow: /backends\nDisallow: /*.pdf$\nAllow: /api/api.php\nDisallow: /api/\n\nUser-agent: Twitterbot\nDisallow: /private/\n'; return [S.robotsAllows(t, 'facebookexternalhit', '/product/a'), S.robotsAllows(t, 'facebookexternalhit', '/backends/x'), S.robotsAllows(t, 'x', '/a.pdf'), S.robotsAllows(t, 'x', '/a.pdf?x=1'), S.robotsAllows(t, 'x', '/api/api.php'), S.robotsAllows(t, 'x', '/api/admin.php'), S.robotsAllows(t, 'Twitterbot/1.0', '/backends/x'), S.robotsAllows(t, 'Twitterbot', '/private/a')].map((v) => v.allowed) }); await close(pg); return x })()
  is(same(r, [true, false, false, true, true, false, true, false]), 'robotsAllows: longest match wins, Allow wins a tie, $ and * work, a named group replaces the wildcard group', JSON.stringify(r))
}

// ================================================================================================ 10. not built yet
head('not built yet')
{
  const pg = await open(makeWorld()); await openPanel(pg, 'needs')
  const t = await pg.evaluate(() => document.querySelector('.ssoc-pane:not([hidden])').textContent)
  is(/Facebook, YouTube, Telegram, Threads/.test(t) && /STORE_CONTENT_CONTACT_KEYS/.test(t) && /Content calendar and scheduling/.test(t) && /settings\.social_calendar/.test(t) && /social_calendar_save/.test(t), 'platforms outside the server whitelist and the calendar are listed with the smallest additive design')
  is(await pg.evaluate(() => !document.querySelector('.ssoc input[name*="facebook" i],.ssoc input[name*="youtube" i],.ssoc input[name*="telegram" i],.ssoc input[name*="threads" i],.ssoc input[name*="calendar" i]')), 'and nothing is faked: no field for them')
  is(await pg.evaluate(() => !document.querySelector('.ssoc input[type="date"], .ssoc [name*="schedule"]')), 'no scheduler exists in the browser (no shared data in localStorage)')
  await shot(pg, '09-needs-1280-light')
  await close(pg)
}

// ================================================================================================ 11. layout
head('layout: widths, languages, themes')
const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
async function measure(pg) {
  return pg.evaluate(() => {
    const doc = document.documentElement, panel = document.querySelector('section.ssoc')
    const bad = []
    for (const e of panel.querySelectorAll('button,a.ssoc-btn,input:not([type=checkbox]),select,textarea,summary,label.ssoc-check')) {
      const r = e.getBoundingClientRect()
      if (r.width && r.height && r.height < 43.5 && !e.closest('[hidden]')) bad.push((e.name || e.textContent || e.tagName).toString().slice(0, 20) + ':' + Math.round(r.height))
    }
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number)
    const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.99)) return c.slice(0, 3) } return [255, 255, 255] }
    const sample = {}
    for (const [k, sel] of [['title', '.ssoc-title'], ['lead', '.ssoc-lead'], ['btn', '.ssoc-btn--primary'], ['tab', '.ssoc-tab[aria-selected="true"]'], ['tab2', '.ssoc-tab[aria-selected="false"]'], ['chipOk', '.ssoc-chip--ok'], ['chipWarn', '.ssoc-chip--warn'], ['chipErr', '.ssoc-chip--error'], ['muted', '.ssoc-muted'], ['count', '.ssoc-count']]) {
      const e = panel.querySelector(sel); if (!e || !e.getBoundingClientRect().width) continue
      sample[k] = [rgb(getComputedStyle(e).color).slice(0, 3), bgOf(e)]
    }
    return { sw: doc.scrollWidth, iw: window.innerWidth, psw: panel.scrollWidth, pcw: panel.clientWidth, bad, dir: getComputedStyle(panel).direction, sample, ta: getComputedStyle(panel.querySelector('.ssoc-title')).textAlign }
  })
}
for (const w of [390, 768, 1280]) for (const rtl of [false, true]) for (const dark of [false, true]) {
  const W = makeWorld(), pg = await open(W, { w, h: 900, rtl, dark })
  const tag = `${w}px ${rtl ? 'ar' : 'en'} ${dark ? 'dark' : 'light'}`
  const bads = [], sw = []
  for (const tab of ['accounts', 'studio', 'image', 'links', 'checks', 'needs']) {
    await openPanel(pg, tab); await pg.waitForTimeout(tab === 'image' ? 500 : 100)
    if (tab === 'studio') { await pick(pg, 1) }
    const m = await measure(pg)
    if (m.sw > m.iw + 1 || m.psw > m.pcw + 1) sw.push(`${tab}:${m.sw}/${m.iw},${m.psw}/${m.pcw}`)
    if (w <= 390 && m.bad.length) bads.push(`${tab}:${m.bad.join(',')}`)
    if (tab === 'accounts') {
      const low = Object.entries(m.sample).filter(([, [f, b]]) => contrast(f, b) < 4.5).map(([k, [f, b]]) => `${k} ${contrast(f, b).toFixed(2)}`)
      is(low.length === 0, `${tag}: text contrast is 4.5:1 or better`, low.join(', '))
      is(m.dir === (rtl ? 'rtl' : 'ltr'), `${tag}: the panel is ${rtl ? 'right to left' : 'left to right'}`, m.dir)
    }
    if (tab === 'studio') { await shot(pg, `10-studio-${w}-${rtl ? 'ar' : 'en'}-${dark ? 'dark' : 'light'}`) }
    if (tab === 'accounts') { await shot(pg, `11-accounts-${w}-${rtl ? 'ar' : 'en'}-${dark ? 'dark' : 'light'}`) }
    if (tab === 'image') { await shot(pg, `12-image-${w}-${rtl ? 'ar' : 'en'}-${dark ? 'dark' : 'light'}`) }
  }
  is(sw.length === 0, `${tag}: no sideways scroll on any of the six tabs`, sw.join(' | '))
  if (w <= 390) is(bads.length === 0, `${tag}: every button, field and select is 44 px tall`, bads.join(' | '))
  await close(pg)
}
{
  // the Payments screen keeps its own light-only rule: opening/closing the Social center changes nothing there
  const W = makeWorld(), pg = await open(W, { dark: true, name: 'payments', wait: false }); await pg.waitForTimeout(800)
  is((await pg.locator(SEL.btn).count()) === 0 && (await pg.locator('style[data-sporta-social-style]').count()) === 0, 'on the Payments screen (dark switch on) the block adds no button and no style at all')
  await close(pg)
  const W2 = makeWorld(), p2 = await open(W2, { dark: true })
  await openPanel(p2); await p2.locator('.ssoc').getByRole('button', { name: '← Back' }).click(); await p2.waitForTimeout(200)
  is(await p2.evaluate(() => !document.body.hasAttribute('data-sporta-social-state') && document.querySelector('section.ssoc').hidden && getComputedStyle(document.querySelector('main.admin-content > section.admin-page:not([data-sporta-social]):not([hidden])')).display !== 'none'), '"← Back" closes the panel and shows the screen again')
  is(await p2.evaluate(() => document.activeElement === document.querySelector('[data-sporta-social-btn]')), 'and focus returns to the entry button')
  await p2.click(SEL.btn); await p2.waitForSelector(SEL.panel + ':not([hidden])')
  await p2.click('.admin-sidebar .admin-nav-item >> nth=0'); await p2.waitForTimeout(200)
  is(await p2.evaluate(() => !document.body.hasAttribute('data-sporta-social-state') && document.querySelector('section.ssoc').hidden), 'any click on the menu closes the panel before the admin handles it')
  await close(p2)
}

// ================================================================================================ 12. mutation
head('mutation check')
{
  const W = makeWorld(), pg = await open(W, { js: WITHOUT, wait: false }); await pg.waitForTimeout(1000)
  is((await pg.locator(SEL.btn).count()) === 0 && (await pg.locator(SEL.panel).count()) === 0 && (await pg.evaluate(() => typeof window.__sportaSocial)) === 'undefined', 'with the block cut out of the file there is no button, no panel and no API: the suite above fails without it')
  is((await pg.evaluate(() => typeof window.__sportaSeoHealth)) !== 'undefined', 'the rest of the add-on file still runs without it')
  await close(pg)
}

is(pageErrors.length === 0, 'no page errors in the whole run', pageErrors.slice(0, 3).join(' ; '))
is(consoleErrors.length === 0, 'no console errors in the whole run', consoleErrors.slice(0, 3).join(' ; '))
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
