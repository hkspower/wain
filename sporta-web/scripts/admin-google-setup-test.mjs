// GOOGLE SETUP CENTER (owner, 2026-11-18: "make google index and google business profile setup center at backends"; the owner chose the
// guided, read-only version): the dialog opened from the Settings header, in a real browser.
//
//   npm run test:admin-google-setup   (rig-free: the shop's public files and API are answered by route interception; the REAL add-on
//                                      file, real Tailwind and the real public/sporta-admin-knet.css are on the page)
//
// Asserted:
//   - one "Google setup" button in the Settings header (English and Arabic names), none on other screens;
//   - READ ONLY: no POST, no request to another host, nothing sent while the dialog is open, Google links are plain new-tab links with
//     rel="noopener noreferrer" and exact https addresses;
//   - Google index checks on a good shop: all pass; on a broken shop each fault is named at the right level: robots.txt missing or without
//     the Sitemap line / without /backends closed / blocking the assets; a sitemap on another host or holding /backends, with no alternates,
//     or with a product count that disagrees with the shop; a page with no title, a canonical that is not itself, noindex in the page and in
//     X-Robots-Tag, no share image, broken JSON-LD; the verification-tag note;
//   - Business Profile checks: phone, e-mail, address, social links from Site content; the home page's structured data; a phone or e-mail that
//     differs from Site content is a "fix"; a logo under 720 px is flagged; the profile sheet carries the real values and a description inside
//     750 characters in both languages; copy buttons put the exact text on the clipboard;
//   - the review link: a bad Place ID is refused, a good one builds the exact writereview address and is kept in this browser only;
//   - Arabic RTL, no sideways scroll at 390 px, 44 px targets, Escape closes, one style element, no page errors. MUTATIONS at the end.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE, SCREEN, screenHtml, PAGE_CSS, FIXTURE_JS } from './fixtures/admin-products.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const KNET_CSS = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const SETTINGS = '<section class="admin-page"><div class="admin-page-layout"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Settings</h1></header><div class="p-4">Settings body</div></div></section>'
const SETTINGS_AR = SETTINGS.replace('>Settings<', '>الإعدادات<')
const SCREENS = { settings: SETTINGS, settingsAr: SETTINGS_AR, catalogue: SCREEN }
const classes = [...new Set([...Object.values(SCREENS).concat(screenHtml()).join('').matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(`@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'google-fixture.css') })).css
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
const pageHtml = ({ ar, screen }) => `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sporta admin</title><style>${TW}</style><style>${LIVE}</style><style>${PAGE_CSS}</style><style>${KNET_CSS}</style></head><body><div id="root">${screenHtml(SCREENS[screen] || SCREEN)}</div><script src="/fixture.js"></script><script src="/sporta-admin-brands.js"></script></body></html>`

// ------------------------------------------------------------------------------------------------ the fake shop
const H = 'https://www.sporta.com.kw'
const GOOD_ROBOTS = `User-agent: *\nDisallow: /backends\nDisallow: /api/\nAllow: /\n\nSitemap: ${H}/sitemap.xml\n`
const sitemap = (extra = '', alt = true, host = H) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`
  + [`${host}/`, `${host}/shop`, `${host}/product/sculpt-top-grey`, `${host}/product/flash-shorts-red`].map((u) => `<url><loc>${u}</loc>${alt ? `<xhtml:link rel="alternate" hreflang="ar" href="${u}"/><xhtml:link rel="alternate" hreflang="en" href="${u}?lang=en"/>` : ''}</url>`).join('') + extra + '</urlset>'
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`
const ORG = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Sporta Sports Wear', url: H + '/', logo: H + '/logo.png', telephone: '+965 9988 7766', email: 'cs@sporta.example', sameAs: ['https://instagram.com/sporta'] }
const page = ({ title = 'Sporta — Sportswear in Kuwait | سبورتا', desc = 'Training and gym sportswear for men and women, delivered across Kuwait. Pay on delivery.', canon = H + '/', alts = true, robots = '', og = H + '/og.jpg', lds = [ORG], extraHead = '' } = {}) =>
  `<!doctype html><html lang="ar"><head><meta charset="utf-8">${title ? `<title>${title}</title>` : ''}${desc ? `<meta name="description" content="${desc}">` : ''}${canon ? `<link rel="canonical" href="${canon}">` : ''}`
  + (alts ? `<link rel="alternate" hreflang="ar" href="${H}/"><link rel="alternate" hreflang="en" href="${H}/?lang=en"><link rel="alternate" hreflang="x-default" href="${H}/">` : '')
  + `${robots ? `<meta name="robots" content="${robots}">` : ''}${og ? `<meta property="og:image" content="${og}">` : ''}${lds.map((x) => (typeof x === 'string' ? `<script type="application/ld+json">${x}</script>` : ld(x))).join('')}${extraHead}</head><body></body></html>`
const PRODUCT = { '@context': 'https://schema.org', '@type': 'Product', name: 'Sculpt Top', offers: { '@type': 'Offer', price: '8.000', priceCurrency: 'KWD' } }
const SVG = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ff7b17"/></svg>`
function makeShop(o = {}) {
  const st = { calls: [], offHost: [], posts: [], o }
  const O = { robots: GOOD_ROBOTS, sitemap: sitemap(), home: page(), homeEn: page({ canon: H + '/?lang=en' }), product: page({ canon: H + '/product/sculpt-top-grey', lds: [PRODUCT], title: 'Sculpt Top — Grey | Sporta' }), homeHeaders: {},
    contact: { phone: '+965 9988 7766', email: 'cs@sporta.example', address_en: 'Kuwait City, Block 3', address_ar: 'مدينة الكويت، قطعة ٣', instagram: 'https://instagram.com/sporta' }, products: [{ slug: 'sculpt-top-grey' }, { slug: 'flash-shorts-red' }], logo: SVG(800, 800), ...o }
  async function handle(route) {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== ORIGIN) { st.offHost.push(req.url()); return route.abort() }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') st.posts.push(req.method() + ' ' + u.pathname)
    st.calls.push(u.pathname + u.search)
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => route.fulfill({ status, body, headers: { 'content-type': type, ...headers } })
    if (u.pathname === '/robots.txt') return O.robots == null ? send(404, 'no') : send(200, O.robots, 'text/plain')
    if (u.pathname === '/sitemap.xml') return O.sitemap == null ? send(404, 'no') : send(200, O.sitemap, 'application/xml')
    if (u.pathname === '/api/api.php') { const r = u.searchParams.get('r'); return send(200, JSON.stringify(r === 'content' ? { v: 1, overrides: {}, contact: O.contact } : r === 'products' ? O.products : []), 'application/json') }
    if (u.pathname === '/logo.png') return send(200, O.logo, 'image/svg+xml')
    if (u.pathname === '/fixture.js') return send(200, FIXTURE_JS + `;window.fx.screens=${JSON.stringify(SCREENS)}`, 'text/javascript')
    if (u.pathname === '/sporta-admin-brands.js') return send(200, O.js || BRANDS_JS, 'text/javascript')
    if (u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' })
    if (req.resourceType() === 'fetch') {
      if (u.pathname === '/') return u.searchParams.get('lang') === 'en' ? send(200, O.homeEn) : send(200, O.home, 'text/html', O.homeHeaders)
      if (/^\/product\//.test(u.pathname)) return send(200, O.product)
      return send(404, 'no')
    }
    return send(200, pageHtml({ ar: u.searchParams.get('ar') === '1' || O.ar, screen: u.searchParams.get('screen') || O.screen || 'settings' }), 'text/html; charset=utf-8', { 'content-security-policy': CSP })
  }
  return { st, handle }
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function open(o = {}, { w = 1280, h = 900 } = {}) {
  const shop = makeShop(o)
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {})
  const pg = await ctx.newPage(), errors = []
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await pg.route('**/*', shop.handle)
  await pg.goto(`${ORIGIN}/backends`); await pg.waitForTimeout(700)
  return { ctx, pg, errors, shop }
}
const R = '[data-sgg-root]'
async function run(o = {}, view) {
  const t = await open(o, view)
  await t.pg.click('[data-sporta-ggl-open]'); await t.pg.waitForSelector(R)
  await t.pg.click('[data-sgg="run"]')
  await t.pg.waitForFunction(() => !!document.querySelector('[data-sgg-root] .sgg-check, [data-sgg-root] .sgg-sum'), null, { timeout: 15000 })
  return t
}
const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-sgg-root] .sgg-check')].map((c) => ({ s: c.querySelector('.sgg-chip').textContent, t: c.querySelector('strong').textContent, d: (c.querySelector('.sgg-detail') || {}).textContent || '', f: (c.querySelector('.sgg-fix') || {}).textContent || '' })))
const has = (rs, title, state) => rs.some((r) => r.t.includes(title) && (!state || r.s === state))
const tab = (pg, k) => pg.click(`[data-sgg-tab="${k}"]`)

// =============================================================================================== 1. the entry
head('the button and the dialog')
{
  const { pg, errors } = await open()
  is(await pg.locator('[data-sporta-ggl-open]').count() === 1 && /Google setup/.test(await pg.textContent('[data-sporta-ggl-open]')), 'one "Google setup" button in the Settings header')
  await pg.goto(`${ORIGIN}/backends?screen=catalogue`); await pg.waitForTimeout(700)
  is(await pg.locator('[data-sporta-ggl-open]').count() === 0, 'none on the Catalogue screen')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await open({ ar: true, screen: 'settingsAr' })
  is(await pg.locator('[data-sporta-ggl-open]').count() === 1 && /إعداد جوجل/.test(await pg.textContent('[data-sporta-ggl-open]')), 'the Arabic Settings screen gets the Arabic button')
  await pg.click('[data-sporta-ggl-open]'); await pg.waitForSelector(R)
  is(await pg.getAttribute(R, 'dir') === 'rtl' && /فهرسة جوجل/.test(await pg.textContent(R)), 'the dialog is right to left, in Arabic')
}

// =============================================================================================== 2. a good shop
head('Google index: a good shop')
{
  const { pg, errors, shop } = await run()
  const rs = await rows(pg)
  is(rs.length >= 20 && rs.every((r) => r.s === 'ok' || r.s === 'note'), 'every check passes (or is a note): ' + rs.length + ' checks', JSON.stringify(rs.filter((r) => r.s !== 'ok' && r.s !== 'note')))
  is(/0 to fix · 0 to check · \d+ ok/.test(await pg.textContent('.sgg-sum')), 'the summary line counts 0 to fix and 0 to check')
  is(has(rs, 'Search Console verification tag', 'note'), 'no verification tag is a NOTE (a Domain property needs none)')
  is(shop.st.posts.length === 0 && shop.st.offHost.length === 0, 'nothing sent, no request to another host', JSON.stringify([shop.st.posts, shop.st.offHost]))
  const reads = shop.st.calls.filter((c) => !/fixture|brands\.js|favicon/.test(c))
  is(['/robots.txt', '/sitemap.xml', '/logo.png'].every((p) => reads.includes(p)) && reads.some((c) => /^\/product\/sculpt-top-grey/.test(c)) && reads.some((c) => c === '/?lang=en'), 'it read robots, the sitemap, both home pages, a product page and the logo', reads.join(' '))
  is(errors.length === 0, 'no page errors', errors.join(' | '))
  // the values and the links
  const vals = await pg.evaluate(() => [...document.querySelectorAll('[data-sgg-root] .sgg-kv')].map((k) => k.querySelector('.sgg-k').textContent + '=' + k.querySelector('.sgg-v').textContent))
  is(vals.includes('Sitemap address=https://www.sporta.com.kw/sitemap.xml') && vals.includes('Search Console property (Domain)=sporta.com.kw'), 'the sitemap address and the Domain property are listed to copy', vals.join(' | '))
  const links = await pg.evaluate(() => [...document.querySelectorAll('[data-sgg-root] a.sgg-link')].map((a) => ({ h: a.getAttribute('href'), t: a.target, r: a.rel })))
  is(links.length >= 6 && links.every((l) => /^https:\/\/[a-z.]+\//.test(l.h) && l.t === '_blank' && /noopener/.test(l.r) && /noreferrer/.test(l.r)), 'every Google link is https, opens a new tab with rel="noopener noreferrer"', JSON.stringify(links.find((l) => !/^https:/.test(l.h))))
  is(links.some((l) => l.h === 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(H + '/product/sculpt-top-grey')), 'the Rich Results link carries the real product address')
  is(links.some((l) => l.h === 'https://www.google.com/search?q=site%3Awww.sporta.com.kw'), 'the site: link is exact')
  // copy
  await pg.evaluate(() => navigator.clipboard.writeText('x'))
  await pg.locator('[data-sgg-root] .sgg-kv:has-text("Sitemap address") button').click()
  await pg.waitForTimeout(200)
  is(await pg.evaluate(() => navigator.clipboard.readText()) === H + '/sitemap.xml', 'Copy puts the exact sitemap address on the clipboard')
  is((await pg.locator('[data-sgg-root] ol.sgg-steps li').count()) === 6, 'six steps, in order')
}

// =============================================================================================== 3. a broken shop
head('Google index: faults are named')
{
  const { pg } = await run({
    robots: 'User-agent: *\nDisallow: /assets/\nDisallow: /shop\n',
    sitemap: sitemap('<url><loc>http://www.sporta.com.kw/old</loc></url><url><loc>https://www.sporta.com.kw/backends</loc></url><url><loc>https://sporta.example/x</loc></url>', false),
    products: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }, { slug: 'e' }],
    home: page({ title: '', desc: 'short', canon: 'https://example.com/', alts: false, og: '', robots: 'noindex, follow', lds: ['{broken'] }),
    homeHeaders: { 'x-robots-tag': 'noindex' },
  })
  const rs = await rows(pg)
  is(has(rs, 'robots.txt names the sitemap', 'fix'), 'robots.txt without the Sitemap line: fix')
  is(has(rs, 'The admin is closed to crawlers', 'check'), '/backends not disallowed: check')
  is(rs.some((r) => /Nothing Google needs is blocked/.test(r.t) && r.s === 'fix' && /\/assets\//.test(r.d) && /\/shop/.test(r.d)), 'blocked /assets/ and /shop: fix, and they are named', JSON.stringify(rs.find((r) => /blocked/.test(r.t))))
  is(rs.some((r) => /every sitemap address/i.test(r.t) && r.s === 'fix' && /example/.test(r.d)), 'addresses on another host or http: fix, named')
  is(has(rs, 'No private path', 'fix') && /backends/.test((rs.find((r) => /No private path/.test(r.t)) || {}).d), '/backends in the sitemap: fix')
  is(has(rs, 'Arabic and English alternates', 'check'), 'no alternates in the sitemap: check')
  is(rs.some((r) => /Every product is in the sitemap/.test(r.t) && r.s === 'check' && /5 products.*2 product/.test(r.d)), 'product count against the sitemap: check, with both numbers', JSON.stringify(rs.find((r) => /Every product/.test(r.t))))
  is(rs.some((r) => /Home \(ar\): title/.test(r.t) && r.s === 'fix'), 'a page with no title: fix')
  is(rs.some((r) => /Home \(ar\): description/.test(r.t) && r.s === 'check' && /5 characters/.test(r.d)), 'a 5 character description: check')
  is(rs.some((r) => /Home \(ar\): canonical/.test(r.t) && r.s === 'fix' && /example\.com/.test(r.d)), 'a canonical on another host: fix')
  is(rs.some((r) => /Home \(ar\): open to indexing/.test(r.t) && r.s === 'fix' && /noindex/.test(r.d)), 'noindex in the page and in X-Robots-Tag: fix')
  is(rs.some((r) => /Home \(ar\): share image/.test(r.t) && r.s === 'check'), 'no share image: check')
  is(rs.some((r) => /Home \(ar\): structured data/.test(r.t) && r.s === 'fix' && /do not parse/.test(r.d)), 'broken JSON-LD: fix')
  is(rs.some((r) => /Home \(ar\): language alternates/.test(r.t) && r.s === 'check'), 'no hreflang in the page: check')
}
{
  const { pg } = await run({ robots: null, sitemap: null })
  const rs = await rows(pg)
  is(has(rs, 'robots.txt is served', 'fix') && has(rs, 'The sitemap is served', 'fix'), 'robots.txt and sitemap.xml missing (404): both fix')
}
{
  const { pg } = await run({ home: page({ extraHead: '<meta name="google-site-verification" content="abc123">' }) })
  is(has(await rows(pg), 'Search Console verification tag', 'ok'), 'a verification tag on the home page: ok')
}

// =============================================================================================== 4. Business Profile
head('Business Profile')
{
  const { pg, errors } = await run()
  await tab(pg, 'profile')
  const rs = await rows(pg)
  is(rs.length >= 8 && rs.every((r) => r.s === 'ok'), 'a complete shop: every profile check passes (' + rs.length + ')', JSON.stringify(rs.filter((r) => r.s !== 'ok')))
  const sheet = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-sgg-root] .sgg-kv')].map((k) => [k.querySelector('.sgg-k').childNodes[0].textContent, k.querySelector('.sgg-v').textContent])))
  is(sheet['Business name (English)'] === 'Sporta Sports Wear' && sheet['Business name (Arabic)'] === 'سبورتا' && sheet['Phone'] === '+965 9988 7766' && sheet['E-mail'] === 'cs@sporta.example' && sheet['Address (English)'] === 'Kuwait City, Block 3', 'the sheet carries the real name, phone, e-mail and address', JSON.stringify(sheet))
  is(sheet['Website'] === H + '/' && sheet['Products link'] === H + '/shop', 'website and products links')
  is(sheet['Description (English)'].length > 100 && sheet['Description (English)'].length <= 750 && sheet['Description (Arabic)'].length <= 750, 'both descriptions are inside Google’s 750 characters')
  is(/Not stored in the shop/.test(sheet['Opening hours']), 'opening hours say they are not stored in the shop')
  await pg.evaluate(() => navigator.clipboard.writeText('x'))
  await pg.locator('[data-sgg-root] .sgg-kv:has-text("Phone") button').first().click(); await pg.waitForTimeout(200)
  is(await pg.evaluate(() => navigator.clipboard.readText()) === '+965 9988 7766', 'Copy puts the exact phone on the clipboard')
  // the review link
  const inp = pg.locator('[data-sgg="place"]')
  await inp.fill('hello there')
  is(/starts with ChIJ/.test(await pg.textContent('[data-sgg="review"]')), 'a bad Place ID is refused with the reason')
  await inp.fill('ChIJN1t_tDeuEmsRUsoyG83frY4')
  const href = await pg.locator('[data-sgg="review"] a').getAttribute('href')
  is(href === 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4', 'a good Place ID builds the exact review address', href)
  is(await pg.evaluate(() => localStorage.getItem('sporta_ggl_place')) === 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'the Place ID is kept in this browser only')
  await pg.keyboard.press('Escape'); await pg.click('[data-sporta-ggl-open]'); await tab(pg, 'profile')
  is(await pg.locator('[data-sgg="place"]').inputValue() === 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'it is still there when the dialog is opened again')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg } = await run({ contact: { phone: '', email: '', address_en: '', address_ar: '' }, home: page({ lds: [] }), logo: SVG(300, 300) })
  await tab(pg, 'profile')
  const rs = await rows(pg)
  is(has(rs, 'Phone is set', 'fix') && has(rs, 'E-mail is set', 'fix') && has(rs, 'Address is set', 'check') && has(rs, 'Social links', 'check'), 'no phone / e-mail: fix; no address / social links: check')
  is(has(rs, 'The home page declares the business', 'check'), 'no Organization data on the home page: check')
  is(rs.some((r) => /Logo is large enough/.test(r.t) && r.s === 'fix' && /300.300/.test(r.d)), 'a 300 px logo: fix, with the size')
  const empty = await pg.evaluate(() => [...document.querySelectorAll('[data-sgg-root] .sgg-kv')].filter((k) => /Phone|E-mail/.test(k.querySelector('.sgg-k').textContent)).map((k) => k.querySelector('.sgg-v').textContent))
  is(empty.every((v) => /not set in Site content/.test(v)), 'an empty value says it is not set in Site content', empty.join())
}
{
  const { pg } = await run({ home: page({ lds: [{ ...ORG, telephone: '+965 1111 2222', email: 'other@sporta.example' }] }) })
  await tab(pg, 'profile')
  const rs = await rows(pg)
  is(rs.some((r) => /Phone matches/.test(r.t) && r.s === 'fix' && /1111 2222/.test(r.d) && /9988 7766/.test(r.d)), 'a phone that differs between structured data and Site content: fix, both numbers shown')
  is(rs.some((r) => /E-mail matches/.test(r.t) && r.s === 'fix'), 'an e-mail that differs: fix')
}

// =============================================================================================== 5. Arabic, phone, keyboard
head('Arabic, a phone, the keyboard')
{
  const { pg, errors } = await run({ ar: true, screen: 'settingsAr', robots: 'User-agent: *\nDisallow: /assets/\n' })
  const rs = await rows(pg)
  is(rs.some((r) => r.s === 'أصلح') && rs.some((r) => /robots\.txt يذكر خريطة الموقع/.test(r.t)), 'Arabic labels and findings')
  await pg.keyboard.press('Escape')
  is(await pg.locator(R).count() === 0 && await pg.locator('#sgg-style').count() === 1, 'Escape closes; one style element')
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}
{
  const { pg, errors } = await run({}, { w: 390, h: 800 })
  await tab(pg, 'profile')
  const sw = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, dlg: document.querySelector('.sgg-dlg').scrollWidth, dlgw: document.querySelector('.sgg-dlg').clientWidth }))
  is(sw.doc <= sw.win + 1 && sw.dlg <= sw.dlgw + 1, 'no sideways scroll at 390 px', JSON.stringify(sw))
  const small = await pg.evaluate(() => [...document.querySelectorAll('.sgg-dlg button, .sgg-dlg a.sgg-link')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim()))
  is(small.length === 0, 'every button and link is at least 44 px tall', small.join())
  is(errors.length === 0, 'no page errors', errors.join(' | '))
}

// =============================================================================================== 6. mutations
head('mutations (each must turn the suite red)')
async function mutant(name, edit, probe) {
  const js = edit(BRANDS_JS)
  if (js === BRANDS_JS) { is(false, `${name}: the edit did not apply`); return }
  is(await probe(js), `${name}: caught`)
}
await mutant('the Sitemap line is not checked', (s) => s.replace("out.push(item('index', 'robots_sitemap', sm ? 'pass' : 'fail'", "out.push(item('index', 'robots_sitemap', 'pass'"), async (js) => {
  const { pg } = await run({ js, robots: 'User-agent: *\nDisallow: /backends\n' }); return !has(await rows(pg), 'robots.txt names the sitemap', 'fix')
})
await mutant('noindex is not seen in X-Robots-Tag', (s) => s.replace("+ ' ' + clean(res.xrobots)", ''), async (js) => {
  const { pg } = await run({ js, homeHeaders: { 'x-robots-tag': 'noindex' } }); return !(await rows(pg)).some((r) => /open to indexing/.test(r.t) && r.s === 'fix')
})
await mutant('a canonical that is not the page itself passes', (s) => s.replace("(!expectCanon || f.canon === expectCanon) && ", ''), async (js) => {
  const { pg } = await run({ js, home: page({ canon: H + '/other' }) }); return !(await rows(pg)).some((r) => /Home \(ar\): canonical/.test(r.t) && r.s === 'fix')
})
await mutant('the Google links lose rel noopener', (s) => s.replace("a.target = '_blank'; a.rel = 'noopener noreferrer'; return a", "a.target = '_blank'; a.rel = ''; return a"), async (js) => {
  const { pg } = await run({ js }); return !(await pg.evaluate(() => [...document.querySelectorAll('[data-sgg-root] a.sgg-link')].every((a) => /noopener/.test(a.rel))))
})
await mutant('the phone is not compared', (s) => s.replace("if (tel && clean(ct.phone)) out.push", "if (false) out.push"), async (js) => {
  const { pg } = await run({ js, home: page({ lds: [{ ...ORG, telephone: '+965 1111 2222' }] }) }); await tab(pg, 'profile'); return !(await rows(pg)).some((r) => /Phone matches/.test(r.t))
})
await mutant('the Place ID is not validated', (s) => s.replace("function placeValid(v) { return /^ChIJ[A-Za-z0-9_-]{10,80}$/.test(v) }", "function placeValid(v) { return true }"), async (js) => {
  const { pg } = await run({ js }); await tab(pg, 'profile'); await pg.locator('[data-sgg="place"]').fill('hello'); return await pg.locator('[data-sgg="review"] a').count() > 0
})

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
