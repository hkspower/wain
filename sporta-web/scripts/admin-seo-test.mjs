// The SEO health panel (block "ADMIN SEO HEALTH", public/sporta-admin-brands.js): an audit, an inline editor, a snippet
// preview, a template "Suggest" and a site checklist on the admin's SEO Editor screen, in a real browser.
//
//   npm run test:admin-seo      (rig-free: no database, no PHP, no server. The page is the CAPTURED live admin's SEO Editor
//                                (scripts/fixtures/admin-css-full/seo.html) under the live rules and the 14 add-on sheets;
//                                the admin API and the public files are a fake answered by route interception, shaped like
//                                admin.php seo_settings / seo_save / products_all and the sitemap, robots.txt and pages of
//                                the shop; the REAL add-on file runs on it)
//
// What is asserted:
//   - the two copies of the defaults agree: the table in the add-on == sporta_seo_defaults() in dropin/php-store/seo-page.php
//     (every page, four strings), the generic product sentences, the limits 120 / 320 and the image path rule of seo-config.php;
//   - the entry: one "SEO health" button in the header of the SEO Editor only, gone when the screen goes; the block does not
//     start off /backends; opening reads seo_settings, products_all and brands (GET) and the public files, writes nothing;
//   - the audit: the bands (title 30-60, description 70-160, limits 120 / 320, every boundary), each flag on the product built
//     to trigger it (short, long, over, duplicate title / description, the generic sentence, no Arabic name, Arabic text with
//     no Arabic letters, no photo, default share image, hidden product, hidden but in the sitemap, active but not in it),
//     pages too, hidden products' text problems demoted to information, tile counts equal to the rows, filters (status,
//     flag, kind, search), the order (errors first);
//   - the editor: counters and their colour bands as you type, the Google result in Arabic (right to left) and English cut
//     where Google cuts (60 / 160), the share card, "Use defaults", "Fill with a suggestion" (fills the form, saves nothing);
//   - the ONE write: POST seo_save with exactly {scope, path | product_id, title_en, title_ar, description_en, description_ar,
//     image} (product_id a number), X-Sporta-Admin and application/json, nothing else ever POSTed; a bad image path, an
//     over-long text and an unchanged form send nothing; a double click saves once; 401, 429 (Retry-After), 400
//     invalid_seo_title / invalid_seo_image and a dead network are each worded, and the form can be saved again afterwards;
//   - Suggest: the templates are deterministic, inside 30-60 / 70-160 (and under 120 / 320), carry the name and the brand, hold
//     no price and no markup; the review lists old and new and saves NOTHING; Apply asks first; "Yes, save" does one seo_save per
//     ticked product (a double click does not double it), keeps the fields it did not draft, drops the ones saved from the list;
//     a 401 stops the run; an unticked product is never written;
//   - the site checklist: sitemap (files, counts, host, nothing private, hidden / missing products), robots.txt (/backends closed,
//     the sitemap named, not a blanket Disallow), home canonical + hreflang, a product page's title against the audit, the host
//     warning off the canonical origin, each failing in a world built to fail it;
//   - 390 / 768 / 1280 px, English LTR and Arabic RTL, light and dark: no sideways scroll, 44 px targets at 390, text at 4.5:1 or
//     better; the Payments screen's light-only rule is not touched (this block adds no rule outside .ssh / .ssh-open);
//   - MUTATION CHECK: with the block cut out of the file the same screen has no button and no panel.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, addons, knetServed } from './lib/admin-css-full-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = BRANDS_JS.indexOf('/* ===== ADMIN SEO HEALTH - begin')
const END_MARK = '/* ===== ADMIN SEO HEALTH - end'
const END = BRANDS_JS.indexOf(END_MARK)
if (BEGIN < 0 || END < BEGIN) { console.log('FAIL the ADMIN SEO HEALTH block markers are not in public/sporta-admin-brands.js'); process.exit(1) }
const WITHOUT = BRANDS_JS.slice(0, BEGIN) + BRANDS_JS.slice(BRANDS_JS.indexOf('\n', END))
const SHOTS = process.env.SEO_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clone = (x) => JSON.parse(JSON.stringify(x))
const len = (s) => Array.from(String(s)).length

// ------------------------------------------------------------------------------------------------ test data
// exactly n characters of plain words, different for each seed, ending on a letter
const WORDS = ['alpha', 'bravo', 'cargo', 'delta', 'ember', 'forge', 'grain', 'haven', 'ivory', 'jolly', 'karma', 'lunar', 'maple', 'noble']
const fill = (n, seed = 0) => { let s = ''; for (let i = 0; s.length < n + 12; i++) s += WORDS[(i + seed) % WORDS.length] + ' '; s = s.slice(0, n); return s.replace(/ $/, 'x') }
const AR_WORDS = ['ملابس', 'رياضية', 'للتمارين', 'اليومية', 'بجودة', 'عالية', 'وخامات', 'مريحة', 'تناسب', 'الجميع', 'في', 'الكويت', 'وتدوم', 'طويلا']
const fillAr = (n, seed = 0) => { let s = ''; for (let i = 0; len(s) < n + 8; i++) s += AR_WORDS[(i * 3 + seed) % AR_WORDS.length] + ' '; return Array.from(s).slice(0, n).join('').replace(/ $/, 'ا') }

const PAGE_PATHS = ['/', '/shop', '/about', '/contact', '/support', '/track', '/returns', '/terms', '/privacy']
const EMPTY = { title_en: '', title_ar: '', description_en: '', description_ar: '', image: '' }
// id, slug and what each is built to show. `ov` = the owner's saved texts, `in_map` = listed in the sitemap.
const P = (o) => ({ id: 0, slug: '', name_en: '', name_ar: '', desc_en: '', desc_ar: '', price: '12.500', sale_price: null, category: 'tops', brand_slug: 'vanquish', image: '', images: '', active: 1, ov: { ...EMPTY }, in_map: true, ...o })
const PRODUCTS = [
  P({ id: 1, slug: 'ok-tee', name_en: 'Vanquish Pro Training Tee', name_ar: 'تيشيرت فانكويش للتمارين', desc_en: fill(100, 1), desc_ar: fillAr(95, 1), image: '/images/products/ok-tee.jpg' }),
  P({ id: 2, slug: 'not-in-map', name_en: 'Vanquish Compression Shorts', name_ar: 'شورت ضغط فانكويش للرجال', desc_en: fill(110, 2), desc_ar: fillAr(100, 2), image: '/images/products/not-in-map.jpg', in_map: false }),
  P({ id: 3, slug: 'hidden-in-map', name_en: 'Cap', name_ar: 'قبعة', desc_en: 'Cap.', desc_ar: 'قبعة.', active: 0, category: 'caps' }),
  P({ id: 4, slug: 'bad-arabic', name_en: 'Vanquish Seamless Gym Leggings', name_ar: 'ليقنز فانكويش للجيم بدون خياطة', desc_en: fill(120, 3), desc_ar: fillAr(110, 4), image: '/images/products/bad-arabic.jpg', ov: { ...EMPTY, title_ar: 'Seamless leggings in Latin letters only' } }),
  P({ id: 5, slug: 'no-ar-name', name_en: 'Vanquish Heavyweight Gym Hoodie', name_ar: '', desc_en: fill(100, 4), desc_ar: fillAr(90, 5), image: '/images/products/no-ar-name.jpg' }),
  P({ id: 6, slug: 'no-desc', name_en: 'Vanquish Ribbed Training Vest', name_ar: 'سترة تمارين فانكويش مضلعة', desc_en: '', desc_ar: '', image: '/images/products/no-desc.jpg', category: 'men' }),
  P({ id: 7, slug: 'dup-a', name_en: 'Vanquish Training Jacket Black', name_ar: 'جاكيت فانكويش للتمارين أسود', desc_en: fill(100, 5), desc_ar: fillAr(100, 7), image: '/images/products/dup-a.jpg', category: 'outerwear',
    ov: { title_en: 'Vanquish Training Jacket for Kuwait gyms', title_ar: 'جاكيت فانكويش للتمارين في صالات الكويت', description_en: fill(104, 6), description_ar: fillAr(98, 7), image: '' } }),
  P({ id: 8, slug: 'dup-b', name_en: 'Vanquish Training Jacket Navy', name_ar: 'جاكيت فانكويش للتمارين كحلي', desc_en: fill(100, 7), desc_ar: fillAr(100, 8), image: '/images/products/dup-b.jpg', category: 'outerwear',
    ov: { title_en: 'Vanquish Training Jacket for Kuwait gyms', title_ar: 'جاكيت فانكويش كحلي لصالات الكويت الرياضية', description_en: fill(104, 6), description_ar: fillAr(97, 8), image: '' } }),
  P({ id: 9, slug: 'long-text', name_en: 'Vanquish Warm Up Pants', name_ar: 'بنطلون إحماء فانكويش', desc_en: fill(100, 8), desc_ar: fillAr(100, 9), image: '/images/products/long-text.jpg',
    ov: { title_en: fill(90, 9), title_ar: '', description_en: fill(200, 10), description_ar: '', image: '' } }),
  P({ id: 10, slug: 'short-title', name_en: 'Cap Pro', name_ar: 'قبعة برو', desc_en: 'Cap.', desc_ar: 'قبعة.', category: 'caps', brand_slug: 'vanquish', image: '/images/products/short-title.jpg' }),
  P({ id: 11, slug: 'no-photo', name_en: 'Vanquish Everyday Sports Bra', name_ar: 'صدرية رياضية فانكويش يومية', desc_en: fill(100, 11), desc_ar: fillAr(95, 11), image: '', images: '', category: 'women' }),
  P({ id: 12, slug: 'over-limit', name_en: fill(130, 12), name_ar: 'منتج باسم عربي عادي', desc_en: fill(100, 13), desc_ar: fillAr(100, 12), image: '/images/products/over-limit.jpg' }),
  P({ id: 13, slug: 'extra-photo', name_en: 'Vanquish Soft Touch Hoodie Grey', name_ar: 'هودي فانكويش ناعم رمادي', desc_en: fill(100, 14), desc_ar: fillAr(100, 13), image: '', images: '/images/products/extra-photo-2.webp,/images/products/extra-photo-3.webp' }),
]
const BRANDS = [{ id: 1, slug: 'vanquish', name_en: 'Vanquish', name_ar: 'فانكويش', logo: null, active: 1, sort: 0, products: 12, products_active: 11 }]
const PAGE_OV = { '/': { ...EMPTY, title_en: 'Sporta | Premium sportswear in Kuwait, same-day', description_en: fill(130, 3), image: '/og-image.png' } }

// ------------------------------------------------------------------------------------------------ the fake shop
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const IMG_RE = /^\/(?!\/)[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif)$/i
function makeWorld() {
  const W = {
    products: clone(PRODUCTS), pages: clone(PAGE_OV), calls: [], delay: 0, next: null, drop: false, robots: null, home: null, sitemapExtra: '', sitemapStatus: 200, productPage: null,
    routes404: new Set(), listFail: null,
  }
  return W
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
function seoDoc(W) {
  const pages = {}
  for (const p of PAGE_PATHS) pages[p] = { ...EMPTY, ...(W.pages[p] || {}) }
  return { pages, products: [...W.products].sort((a, b) => b.id - a.id).map((p) => ({ id: p.id, slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, active: !!p.active, ...p.ov })) }
}
const productsAll = (W) => [...W.products].sort((a, b) => b.id - a.id).map((p) => ({ id: String(p.id), slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, desc_en: p.desc_en, desc_ar: p.desc_ar, price: p.price, sale_price: p.sale_price,
  sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: p.category, brand_slug: p.brand_slug, image: p.image || null, images: p.images || null, active: String(p.active) }))
const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
// what admin.php does with seo_save: store_seo_validate_record + store_seo_save_page / _product
function validate(b) {
  const out = {}
  for (const [k, lim] of [['title_en', 120], ['title_ar', 120], ['description_en', 320], ['description_ar', 320]]) {
    const v = b[k] ?? ''
    const kind = k.startsWith('title_') ? 'title' : 'description'
    if (typeof v !== 'string' || v.length > 4096) return { error: 'invalid_seo_' + kind }
    const c = v.replace(/[\x00-\x1F\x7F]/g, '').trim()
    if (len(c) > lim) return { error: 'invalid_seo_' + kind }
    out[k] = c
  }
  const img = typeof (b.image ?? '') === 'string' ? String(b.image ?? '').trim() : null
  if (img === null || (img !== '' && (img.length > 500 || img.includes('..') || !IMG_RE.test(img)))) return { error: 'invalid_seo_image' }
  out.image = img
  return { rec: out }
}
const sitemapProducts = (W) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  W.products.filter((p) => p.in_map).map((p) => `  <url>\n    <loc>https://www.sporta.com.kw/product/${p.slug}</loc>\n    <xhtml:link rel="alternate" hreflang="ar" href="https://www.sporta.com.kw/product/${p.slug}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="https://www.sporta.com.kw/product/${p.slug}?lang=en"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.sporta.com.kw/product/${p.slug}"/>\n  </url>`).join('\n') + '\n' + W.sitemapExtra + '</urlset>'
const sitemapPages = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  PAGE_PATHS.flatMap((p) => [p, p + '?lang=en']).map((p) => `  <url>\n    <loc>https://www.sporta.com.kw${p}</loc>\n    <xhtml:link rel="alternate" hreflang="ar" href="https://www.sporta.com.kw${p.split('?')[0]}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="https://www.sporta.com.kw${p.split('?')[0]}?lang=en"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.sporta.com.kw${p.split('?')[0]}"/>\n  </url>`).join('\n') + '\n</urlset>'
const ROBOTS_OK = 'User-agent: *\nAllow: /\nDisallow: /backends\nDisallow: /knet/\nDisallow: /pay/\nDisallow: /api/\nAllow: /api/api.php\n\nSitemap: https://www.sporta.com.kw/sitemap.xml\n'
const homeHtml = (W) => W.home ?? `<!doctype html><html lang="ar" dir="rtl"><head><title>سبورتا | ملابس رياضية وملابس جيم في الكويت</title><meta name="description" content="ملابس رياضية فاخرة في الكويت."><link rel="canonical" href="https://www.sporta.com.kw/"><link rel="alternate" hreflang="ar" href="https://www.sporta.com.kw/"><link rel="alternate" hreflang="en" href="https://www.sporta.com.kw/?lang=en"><link rel="alternate" hreflang="x-default" href="https://www.sporta.com.kw/"></head><body></body></html>`
// the title api/seo-page.php would put on a product page in Arabic: the owner's, else "<name> - Sporta" (worked out here by hand, not by the add-on)
const liveTitleAr = (p) => p.ov.title_ar || ((p.name_ar || 'منتج') + ' — سبورتا')

function handler(W, shellHtml) {
  return async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (p === '/backends' || p.startsWith('/backends/')) return route.fulfill({ status: 200, contentType: 'text/html', body: shellHtml })
    if (p === '/api/admin.php') {
      const r = u.searchParams.get('r') || '', method = req.method()
      const rec = { method, route: r, headers: req.headers(), body: method === 'POST' ? (() => { try { return JSON.parse(req.postData() || 'null') } catch { return '__unparsable__' } })() : null }
      W.calls.push(rec)
      if (W.drop && r === 'seo_save') return route.abort('failed')
      if (W.routes404.has(r)) return json(route, 404, { error: 'not_found' })
      if (r === 'seo_settings') return W.listFail ? json(route, W.listFail, { error: 'x' }) : json(route, 200, seoDoc(W))
      if (r === 'products_all') return json(route, 200, productsAll(W))
      if (r === 'brands') return json(route, 200, BRANDS)
      if (r === 'seo_save' && method === 'POST') {
        if (W.delay) await sleep(W.delay)
        if (W.next) { const n = W.next; W.next = null; return json(route, n.status, n.body, n.headers || {}) }
        if (rec.headers['x-sporta-admin'] !== '1' || !/^application\/json/.test(rec.headers['content-type'] || '')) return json(route, 403, { error: 'bad_request' })
        const b = rec.body, v = validate(b)
        if (v.error) return json(route, 400, { error: v.error })
        if (b.scope === 'page') {
          if (!PAGE_PATHS.includes(b.path)) return json(route, 400, { error: 'invalid_seo_path' })
          W.pages[b.path] = v.rec
          return json(route, 200, { path: b.path, ...v.rec })
        }
        if (b.scope === 'product') {
          const pr = W.products.find((x) => x.id === Number(b.product_id))
          if (!pr) return json(route, 404, { error: 'product_not_found' })
          pr.ov = v.rec
          return json(route, 200, { id: pr.id, product_id: pr.id, slug: pr.slug, ...v.rec })
        }
        return json(route, 400, { error: 'invalid_seo_scope' })
      }
      return json(route, 404, { error: 'not_found' })      // every other admin route: the other add-ons see "not on this server"
    }
    if (p === '/sitemap.xml') return W.sitemapStatus !== 200 ? route.fulfill({ status: W.sitemapStatus, body: 'x' }) : route.fulfill({ status: 200, contentType: 'application/xml', body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.sporta.com.kw/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://www.sporta.com.kw/sitemap-products.xml</loc></sitemap></sitemapindex>` })
    if (p === '/sitemap-pages.xml') return route.fulfill({ status: 200, contentType: 'application/xml', body: sitemapPages() })
    if (p === '/sitemap-products.xml') return route.fulfill({ status: 200, contentType: 'application/xml', body: sitemapProducts(W) })
    if (p === '/robots.txt') return route.fulfill({ status: 200, contentType: 'text/plain', body: W.robots ?? ROBOTS_OK })
    if (p === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: homeHtml(W) })
    const m = p.match(/^\/product\/([\w-]+)$/)
    if (m) {
      const pr = W.products.find((x) => x.slug === m[1])
      const t = W.productPage ?? (pr ? liveTitleAr(pr) : 'x')
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><title>${esc(t)}</title></head><body></body></html>` })
    }
    if (/\.(png|jpe?g|webp|avif)$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' })
  }
}

// ------------------------------------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const FILES = addons(knetServed())
const shell = (opt) => fixturePage('seo', FILES, opt)
const pageErrors = []
async function open(W, { w = 1280, h = 900, rtl = false, dark = false, origin = 'https://www.sporta.com.kw', js = BRANDS_JS, wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: false })
  await ctx.route(origin + '/**', handler(W, shell({ rtl, dark })))
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  await pg.goto(origin + '/backends/seo')
  await pg.addScriptTag({ content: js })
  if (wait) await pg.waitForSelector('[data-sporta-seo-btn]', { timeout: 4000 }).catch(() => {})
  pg.__ctx = ctx
  return pg
}
async function openPanel(pg) {
  await pg.click('[data-sporta-seo-btn]')
  await pg.waitForSelector('.ssh tbody tr.ssh-row', { timeout: 5000 })
  await pg.waitForFunction(() => !document.querySelector('.ssh-checklist') ? false : true, null, { timeout: 5000 }).catch(() => {})
  await pg.waitForTimeout(150)
}
const close = (pg) => pg.__ctx.close()
const rowFlags = (pg, key) => pg.evaluate((k) => [...document.querySelectorAll(`.ssh tr.ssh-row[data-key="${k}"] .ssh-flag`)].map((x) => x.getAttribute('data-code') + '|' + x.className.replace('ssh-flag ssh-flag--', '')), key)
const rowSev = (pg, key) => pg.evaluate((k) => document.querySelector(`.ssh tr.ssh-row[data-key="${k}"]`)?.getAttribute('data-sev'), key)
const posts = (W) => W.calls.filter((c) => c.method === 'POST')
const gets = (W) => W.calls.filter((c) => c.method === 'GET')
const has = (list, code) => list.some((x) => x.startsWith(code + '|'))
const shot = async (pg, name, full = false) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, name + '.png'), fullPage: full }) }

// ================================================================================================ 1. the two copies
head('the add-on agrees with the server files')
{
  const php = readFileSync(join(ROOT, 'dropin/php-store/seo-page.php'), 'utf8'), cfg = readFileSync(join(ROOT, 'dropin/php-store/seo-config.php'), 'utf8')
  const body = php.slice(php.indexOf('$pages = ['), php.indexOf('    ];\n    return $pages[$path]'))
  const entries = {}
  for (const chunk of body.split(/\n {8}(?='\/)/).slice(1)) {
    const path = chunk.match(/^'(\/[a-z]*)'/)[1]
    entries[path] = [...chunk.slice(chunk.indexOf('=>')).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
  }
  const W = makeWorld(), pg = await open(W)
  const H = await pg.evaluate(() => { const h = window.__sportaSeoHealth; return h && { pages: h.PAGES, generic: h.GENERIC_DESC, lim: h.LIM, img: h.IMG_RE.source, flags: h.IMG_RE.flags } })
  is(!!H, 'the block exposes its tables for this check')
  is(same(Object.keys(entries), PAGE_PATHS) && same(H.pages.map((x) => x.path), PAGE_PATHS), 'the add-on lists exactly the nine pages store_seo_page_paths() allows, in order')
  is(same(Object.keys(entries), (cfg.match(/STORE_SEO_PAGE_PATHS = \[([^\]]*)\]/)[1].match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1))), 'and those are the paths of seo-config.php STORE_SEO_PAGE_PATHS')
  for (const x of H.pages) is(same(x.d, entries[x.path]), `defaults of ${x.path} (title ar/en, description ar/en) are the four strings of sporta_seo_defaults()`, x.d.map((s) => s.slice(0, 20)).join(' | '))
  is(php.includes(`'${H.generic.ar}'`) && php.includes(`'${H.generic.en}'`), 'the two generic product descriptions are the sentences seo-page.php falls back to')
  is(H.lim.title === 120 && H.lim.desc === 320 && /'title_en' => 120, 'title_ar' => 120,\s*'description_en' => 320, 'description_ar' => 320/.test(cfg), 'the limits are 120 and 320, as in store_seo_validate_record()')
  const phpRe = cfg.match(/preg_match\('~(.*?)~iD'/)[1]
  is(H.img.replace(/\\\//g, '/') === phpRe.replace(/\\\//g, '/') && H.flags.includes('i'), 'the image path rule is the PHP one', `${H.img} vs ${phpRe}`)
  is(php.includes("' — سبورتا'") || php.includes('" — سبورتا"') || /\$isArabic \? ' — سبورتا' : ' — Sporta'/.test(php), 'the " — Sporta" suffix rule is in seo-page.php')
  await close(pg)
}

// ================================================================================================ 2. the entry
head('the entry button')
{
  const W = makeWorld(), pg = await open(W)
  is((await pg.locator('[data-sporta-seo-btn]').count()) === 1, 'one "SEO health" button on the SEO Editor')
  is(await pg.evaluate(() => { const b = document.querySelector('[data-sporta-seo-btn]'); return !!b.closest('.seo-editor .admin-page-header') && b.textContent.trim() === 'SEO health' }), 'it sits in the header of the SEO Editor and reads "SEO health"')
  is((await pg.evaluate(() => document.querySelector('[data-sporta-seo-btn]').getBoundingClientRect().height)) >= 43.5, 'it is 44 px tall')
  is(gets(W).filter((c) => ['seo_settings', 'products_all', 'brands'].includes(c.route)).length === 0, 'nothing is read before the button is pressed')
  await pg.evaluate(() => { document.querySelector('.seo-editor').className = 'something-else' })
  await pg.waitForTimeout(800)
  is((await pg.locator('[data-sporta-seo-btn]').count()) === 0, 'the button goes when the screen goes')
  await pg.evaluate(() => { document.querySelector('.something-else').className = 'seo-editor admin-page-layout' })
  await pg.waitForTimeout(800)
  is((await pg.locator('[data-sporta-seo-btn]').count()) === 1, 'and comes back with the screen, once')
  await close(pg)
  // not /backends
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
  await ctx.route('https://www.sporta.com.kw/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><main class="admin-content"></main></body></html>' }))
  const shop = await ctx.newPage(); await shop.goto('https://www.sporta.com.kw/shop'); await shop.addScriptTag({ content: BRANDS_JS }); await shop.waitForTimeout(700)
  is(await shop.evaluate(() => typeof window.__sportaSeoHealth === 'undefined' && !document.querySelector('style[data-sporta-seo-style]')), 'off /backends the block does not start (no flag, no style, no timer)')
  await ctx.close()
}

// ================================================================================================ 3. open, read-only, back
head('opening the panel')
const W0 = makeWorld(), pg0 = await open(W0)
await openPanel(pg0)
{
  const routes = gets(W0).map((c) => c.route)
  is(['seo_settings', 'products_all', 'brands'].every((r) => routes.includes(r)), 'opening reads seo_settings, products_all and brands', routes.join(','))
  is(posts(W0).length === 0, 'and writes nothing')
  is(gets(W0).filter((c) => ['seo_settings', 'products_all', 'brands'].includes(c.route)).every((c) => c.headers['x-sporta-admin'] === '1'), 'each admin read carries X-Sporta-Admin: 1')
  is(await pg0.evaluate(() => document.body.getAttribute('data-sporta-seo-state') === 'open' && getComputedStyle(document.querySelector('.seo-editor').closest('section')).display === 'none'), 'the editor section is hidden while the panel is open')
  is(await pg0.evaluate(() => { const s = document.querySelector('section.ssh'); return !!s && s.parentElement.matches('main.admin-content') && !s.hidden && document.activeElement === document.getElementById('ssh-title') }), 'the panel is a section of <main> and takes focus on its heading')
  const tiles = await pg0.evaluate(() => [...document.querySelectorAll('.ssh-tile')].map((t) => t.querySelector('.ssh-tile-big').textContent))
  const rows = await pg0.locator('.ssh tr.ssh-row').count()
  is(rows === 9 + PRODUCTS.length && Number(tiles[0]) === 9 + PRODUCTS.length, `every page (9) and every product (${PRODUCTS.length}) is audited, tile and rows agree`, `${tiles.join('/')} rows=${rows}`)
  is(Number(tiles[1]) + Number(tiles[2]) + Number(tiles[3]) === Number(tiles[0]), 'errors + warnings + fine = audited')
  const bySev = await pg0.evaluate(() => ['error', 'warn', 'ok'].map((s) => document.querySelectorAll(`.ssh tr.ssh-row[data-sev="${s}"]`).length))
  is(same(bySev.map(String), [tiles[1], tiles[2], tiles[3]]), 'each tile equals the number of rows of that severity', bySev.join('/'))
  const order = await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-sev')))
  const rank = { error: 0, warn: 1, ok: 2 }
  is(order.every((s, i) => i === 0 || rank[order[i - 1]] <= rank[s]), 'rows are ordered errors first, then warnings, then fine')
  await shot(pg0, '01-panel-1280-light', false)
}

// ================================================================================================ 4. bands and the audit
head('audit: bands')
{
  const cases = await pg0.evaluate(() => {
    const h = window.__sportaSeoHealth
    return { t: [0, 1, 29, 30, 60, 61, 120, 121].map((n) => h.bandOf('title', n)), d: [0, 69, 70, 160, 161, 320, 321].map((n) => h.bandOf('desc', n)) }
  })
  is(same(cases.t, ['missing', 'short', 'short', 'good', 'good', 'long', 'long', 'over']), 'title bands: 0 empty, 1-29 short, 30-60 good, 61-120 long, 121+ over the limit', cases.t.join(','))
  is(same(cases.d, ['missing', 'short', 'good', 'good', 'long', 'long', 'over']), 'description bands: 0 empty, 69 short, 70-160 good, 161-320 long, 321+ over', cases.d.join(','))
  const chipsOf = (key, lang) => pg0.evaluate(([k, l]) => [...document.querySelectorAll(`.ssh tr.ssh-row[data-key="${k}"] .ssh-text[lang="${l}"] .ssh-chip`)].map((c) => c.getAttribute('data-band')), [key, lang])
  is(same(await chipsOf('x:1', 'en'), ['good', 'good']) && same(await chipsOf('x:1', 'ar'), ['good', 'good']), 'the well-written product reads good / good in both languages')
  is(same(await chipsOf('x:10', 'en'), ['short', 'short']), 'a product with a short name and a 4-character description reads short / short')
  is(same(await chipsOf('x:9', 'en'), ['long', 'long']), 'a 90-character override title and a 200-character description read long / long')
  is(same(await chipsOf('p:/track', 'en'), ['short', 'short']) && same(await chipsOf('p:/track', 'ar'), ['short', 'short']), 'a page whose default text is short (/track) says so in both languages')
  is(same(await chipsOf('p:/', 'en'), ['good', 'good']), 'the homepage (owner text, 44 and 130 characters) reads good / good')
  const t = len('Shop — Sporta')
  is((await chipsOf('p:/shop', 'en'))[0] === 'short' && t < 30, 'a page default gets " — Sporta" added, so /shop is 13 characters: short')
}
head('audit: flags')
{
  const f = {}
  for (const k of ['x:1', 'x:2', 'x:3', 'x:4', 'x:5', 'x:6', 'x:7', 'x:8', 'x:9', 'x:10', 'x:11', 'x:12', 'x:13', 'p:/', 'p:/track']) f[k] = await rowFlags(pg0, k)
  is(same(f['x:1'], ['null|ok']) && (await rowSev(pg0, 'x:1')) === 'ok', 'the well-written, photographed, listed product has no flag but the ok mark and is "fine"', f['x:1'].join(','))
  is(has(f['x:2'], 'missing_from_sitemap') && (await rowSev(pg0, 'x:2')) === 'warn', 'an active product the sitemap does not list: warning', f['x:2'].join(','))
  is(has(f['x:3'], 'hidden_in_sitemap') && f['x:3'].find((x) => x.startsWith('hidden_in_sitemap')).endsWith('error') && (await rowSev(pg0, 'x:3')) === 'error', 'a hidden product still in the sitemap: error', f['x:3'].join(','))
  is(has(f['x:3'], 'hidden') && !f['x:3'].some((x) => /^(title_short|desc_short|no_photo|share_default)\|(error|warn)/.test(x)), 'its text problems are demoted to information (nobody can reach the page)', f['x:3'].join(','))
  is(has(f['x:4'], 'not_arabic') && f['x:4'].find((x) => x.startsWith('not_arabic')).endsWith('error'), 'Arabic title typed in Latin letters: error', f['x:4'].join(','))
  is(has(f['x:5'], 'no_name') && f['x:5'].find((x) => x.startsWith('no_name')).endsWith('error') && (await rowSev(pg0, 'x:5')) === 'error', 'a product with no Arabic name: error (its title would be the generic "منتج")', f['x:5'].join(','))
  is(f['x:6'].filter((x) => x.startsWith('default_desc')).length === 2, 'no description in either language: "generic description" for Arabic and English', f['x:6'].join(','))
  is(!has(f['x:6'], 'dup_desc'), 'the shared generic sentence is not also called a duplicate (one flag, one remedy)')
  is(has(f['x:7'], 'dup_title') && has(f['x:8'], 'dup_title') && has(f['x:7'], 'dup_desc') && has(f['x:8'], 'dup_desc'), 'two products with the same English title and description: both flagged, both ways', f['x:7'].join(','))
  is(f['x:7'].filter((x) => x.startsWith('dup_title')).length === 1, 'the Arabic titles of those two differ, so only English is flagged')
  is(has(f['x:9'], 'title_long') && has(f['x:9'], 'desc_long'), 'long title and long description: warnings', f['x:9'].join(','))
  is(has(f['x:10'], 'title_short') && has(f['x:10'], 'desc_short'), 'short title and short description: warnings', f['x:10'].join(','))
  is(has(f['x:11'], 'no_photo') && has(f['x:11'], 'share_default'), 'a product with no photo: no photo, and the default share image', f['x:11'].join(','))
  is(has(f['x:12'], 'title_over') && f['x:12'].find((x) => x.startsWith('title_over')).endsWith('error'), 'a default title over 120 characters (a 130-character name): error', f['x:12'].join(','))
  is(has(f['x:13'], 'share_default') && !has(f['x:13'], 'no_photo'), 'a product with extra photos but no main photo: the share image is the default, the photo is not missing', f['x:13'].join(','))
  is(has(f['p:/'], 'share_default') === false || f['p:/'].find((x) => x.startsWith('share_default'))?.endsWith('info'), 'a page on the default share image is information, not a warning')
  const pageIssues = await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row[data-key^="p:"]')].map((r) => r.getAttribute('data-key') + ':' + r.getAttribute('data-sev')))
  is(pageIssues.length === 9, 'all nine pages are rows')
}
head('audit: filters')
{
  await pg0.click('.ssh-tile--error'); await pg0.waitForTimeout(100)
  const errRows = await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-sev')))
  is(errRows.length > 0 && errRows.every((s) => s === 'error'), 'the Errors tile shows only error rows', errRows.length + '')
  is(await pg0.evaluate(() => document.querySelector('.ssh-tile--error').getAttribute('aria-pressed') === 'true'), 'and is pressed (aria-pressed)')
  await pg0.click('.ssh-tile--error'); await pg0.waitForTimeout(100)
  is((await pg0.locator('.ssh tr.ssh-row').count()) === 9 + PRODUCTS.length, 'pressing it again clears the filter')
  await pg0.selectOption('.ssh-filters select >> nth=0', 'hidden'); await pg0.waitForTimeout(100)
  is(same(await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-key'))), ['x:3']), 'Show: Hidden products lists only the hidden one')
  await pg0.selectOption('.ssh-filters select >> nth=0', 'pages'); await pg0.waitForTimeout(100)
  is((await pg0.locator('.ssh tr.ssh-row').count()) === 9, 'Show: Pages lists the nine pages')
  await pg0.selectOption('.ssh-filters select >> nth=0', 'all')
  await pg0.selectOption('.ssh-filters select >> nth=1', 'dup_title'); await pg0.waitForTimeout(100)
  is(same((await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-key')))).sort(), ['x:7', 'x:8']), 'Flag: Same title as another lists exactly the two duplicates')
  const opt = await pg0.evaluate(() => [...document.querySelectorAll('.ssh-filters select')[1].options].map((o) => o.textContent))
  is(opt.some((t) => /^Same title as another \(2\)$/.test(t)), 'the flag list carries a count for each flag', opt.slice(0, 5).join(' | '))
  await pg0.click('.ssh-filters .ssh-btn--quiet'); await pg0.waitForTimeout(100)
  await pg0.fill('.ssh-filters input[type=search]', 'compression'); await pg0.waitForTimeout(350)
  is(same(await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-key'))), ['x:2']), 'Search finds a product by a word of its name')
  await pg0.fill('.ssh-filters input[type=search]', 'قبعة برو'); await pg0.waitForTimeout(350)
  is(same(await pg0.evaluate(() => [...document.querySelectorAll('.ssh tr.ssh-row')].map((r) => r.getAttribute('data-key'))), ['x:10']), 'and by its Arabic name')
  await pg0.fill('.ssh-filters input[type=search]', 'zzzz'); await pg0.waitForTimeout(350)
  is(await pg0.evaluate(() => !document.querySelector('.ssh-empty').hidden), 'a search with no match says so')
  await pg0.click('.ssh-filters .ssh-btn--quiet'); await pg0.waitForTimeout(100)
  is((await pg0.locator('.ssh tr.ssh-row').count()) === 9 + PRODUCTS.length, 'Clear filters brings every row back')
}

// ================================================================================================ 5. checklist
head('site checks (all passing world)')
{
  const st = await pg0.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ssh-check')].map((c) => [c.getAttribute('data-check'), c.getAttribute('data-status')])))
  is(st.host === 'pass' && st.robots === 'pass' && st['hreflang-sitemap'] === 'pass' && st.home === 'pass' && st['product-page'] === 'pass', 'canonical host, robots, sitemap languages, home tags and a product page: pass', JSON.stringify(st))
  is(st.sitemap === 'warn', 'the sitemap is "check": it lists a hidden product and misses an active one', JSON.stringify(st))
  const txt = await pg0.evaluate(() => document.querySelector('[data-check="sitemap"]').textContent)
  is(/30 addresses in 2 files: 9 page paths, 12 products/.test(txt) && /1 hidden product is still listed/.test(txt) && /1 active product is not listed yet/.test(txt), 'its text counts the addresses, pages and products and names both problems', txt.slice(0, 220))
  is(await pg0.evaluate(() => /Site checks · 1 to look at/.test(document.querySelector('.ssh-det > summary').textContent)), 'the heading summarises the checks')
  const only = [...new Set(gets(W0).map((c) => c.route))]
  is(posts(W0).length === 0, 'the checks never write', only.join(','))
}
const checkWorld = async (name, tweak, expect, opt = {}) => {
  const W = makeWorld(); tweak(W)
  const pg = await open(W, opt)
  await openPanel(pg)
  await pg.waitForSelector('.ssh-check', { timeout: 4000 }).catch(() => {})
  const st = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ssh-check')].map((c) => [c.getAttribute('data-check'), [c.getAttribute('data-status'), c.textContent]])))
  for (const [id, [status, rx]] of Object.entries(expect)) is(st[id] && st[id][0] === status && (!rx || rx.test(st[id][1])), `${name}: ${id} is "${status}"`, st[id] ? st[id][0] + ' ' + st[id][1].slice(0, 160) : 'missing')
  is(posts(W).length === 0, `${name}: nothing written`)
  await close(pg)
}
head('site checks (failing worlds)')
await checkWorld('robots without /backends', (W) => { W.robots = 'User-agent: *\nAllow: /\nSitemap: https://www.sporta.com.kw/sitemap.xml\n' }, { robots: ['fail', /does not close \/backends/] })
await checkWorld('robots closing the whole site', (W) => { W.robots = 'User-agent: *\nDisallow: /\n' }, { robots: ['fail', /whole site/] })
await checkWorld('robots without a Sitemap line', (W) => { W.robots = 'User-agent: *\nAllow: /\nDisallow: /backends\n' }, { robots: ['warn', /no Sitemap/] })
await checkWorld('robots naming another sitemap', (W) => { W.robots = 'User-agent: *\nDisallow: /backends\nSitemap: https://sporta.com.kw/sitemap.xml\n' }, { robots: ['warn', /sporta\.com\.kw\/sitemap\.xml/] })
await checkWorld('a private page in the sitemap', (W) => { W.sitemapExtra = '<url><loc>https://www.sporta.com.kw/cart</loc></url>\n' }, { sitemap: ['fail', /private address: https:\/\/www\.sporta\.com\.kw\/cart/] })
await checkWorld('a foreign host in the sitemap', (W) => { W.sitemapExtra = '<url><loc>http://sporta.com.kw/shop</loc></url>\n' }, { sitemap: ['fail', /does? not start with https:\/\/www\.sporta\.com\.kw/] })
await checkWorld('no sitemap', (W) => { W.sitemapStatus = 404 }, { sitemap: ['fail', /Could not read \/sitemap\.xml \(HTTP 404\)/] })
await checkWorld('home with the wrong canonical and no en alternate', (W) => { W.home = '<html><head><title>x</title><link rel="canonical" href="https://sporta.com.kw/"><link rel="alternate" hreflang="ar" href="https://www.sporta.com.kw/"></head></html>' }, { home: ['fail', /canonical is https:\/\/sporta\.com\.kw\/.*hreflang en is missing/] })
await checkWorld('a product page that does not carry the audit title', (W) => { W.productPage = 'Something else entirely' }, { 'product-page': ['warn', /Something else entirely/] })
await checkWorld('the admin open on another address', () => {}, { host: ['warn', /sporta\.test/] }, { origin: 'https://sporta.test' })

// ================================================================================================ 6. the editor
head('editor: counters, preview, defaults')
{
  await pg0.evaluate(() => { document.querySelector('.ssh-filters .ssh-btn--quiet').click() })
  await pg0.fill('.ssh-filters input[type=search]', 'cap pro'); await pg0.waitForTimeout(350)
  await pg0.click('.ssh tr.ssh-row[data-key="x:10"] .ssh-btn')
  await pg0.waitForSelector('.ssh-editor')
  const E = (sel) => pg0.locator('.ssh-editor ' + sel)
  is((await pg0.locator('.ssh-editor').count()) === 1 && (await pg0.locator('.ssh tr.ssh-row[data-key="x:10"] .ssh-btn').textContent()) === 'Close', 'Edit opens one editor under the row, and the button becomes Close')
  is(await pg0.evaluate(() => document.activeElement && document.activeElement.matches('.ssh-editor input')), 'focus goes to the first field')
  is(await pg0.evaluate(() => ['title_ar', 'description_ar'].every((n) => document.querySelector(`.ssh-editor [name=${n}]`).dir === 'rtl') && ['title_en', 'description_en', 'image'].every((n) => document.querySelector(`.ssh-editor [name=${n}]`).dir === 'ltr')), 'Arabic fields are right to left, English and the path left to right')
  is((await E('[name=title_en]').getAttribute('placeholder')) === 'Cap Pro — Sporta', 'an empty field shows the default as its placeholder')
  const ctr = (n) => pg0.evaluate((k) => { const c = document.querySelector(`.ssh-editor .ssh-counter[data-for="${k}"]`); return [c.textContent, c.getAttribute('data-band'), c.className] }, n)
  is((await ctr('title_en'))[0] === '\u2013 default is used', 'empty: the counter says the default is used')
  await E('[name=title_en]').fill('Cap Pro training cap in black')
  let c = await ctr('title_en'); is(c[1] === 'short' && /^\u25B2 29 \u00B7 short, aim for 30-60$/.test(c[0]) && c[2].includes('ssh-counter--warn'), '29 characters: short, amber, with the target', c.join(' | '))
  await E('[name=title_en]').fill('Cap Pro training cap in black!')
  c = await ctr('title_en'); is(c[1] === 'good' && /^\u2713 30 \u00B7 good$/.test(c[0]) && c[2].includes('ssh-counter--ok'), '30 characters: good, green', c.join(' | '))
  await E('[name=title_en]').fill(fill(61, 2)); c = await ctr('title_en'); is(c[1] === 'long' && /may be cut at about 60/.test(c[0]), '61 characters: long, may be cut', c.join(' | '))
  await E('[name=title_en]').fill(fill(121, 2)); c = await ctr('title_en'); is(c[1] === 'over' && c[2].includes('ssh-counter--error') && /over the limit of 120/.test(c[0]), '121 characters: over the limit, red', c.join(' | '))
  is(await E('.ssh-btn--primary').isDisabled(), 'and Save is disabled while a text is over the limit')
  is(/longer than 120/.test(await E('.ssh-msg').textContent()), 'with the reason beside it')
  await E('[name=description_en]').fill(fill(160, 3)); await E('[name=title_en]').fill('')
  c = await ctr('description_en'); is(c[1] === 'good' && /^\u2713 160 \u00B7 good$/.test(c[0]), 'a description of 160 characters is still good'); await E('[name=description_en]').fill(fill(161, 3))
  c = await ctr('description_en'); is(c[1] === 'long', '161 is long')
  await E('[name=description_en]').fill(fill(321, 3)); c = await ctr('description_en'); is(c[1] === 'over' && /limit of 320/.test(c[0]), '321 is over the limit of 320')
  // preview
  await E('[name=title_en]').fill(fill(75, 5)); await E('[name=description_en]').fill(fill(200, 6))
  await E('[name=title_ar]').fill('عنوان عربي للاختبار في الكويت'); await E('[name=description_ar]').fill('وصف عربي قصير.')
  const pv = await pg0.evaluate(() => {
    const g = (l) => document.querySelector(`.ssh-g[data-lang="${l}"]`)
    return { enT: g('en').querySelector('.ssh-g-title').textContent, enD: g('en').querySelector('.ssh-g-desc').textContent, enCut: [g('en').querySelector('.ssh-g-title').getAttribute('data-cut'), g('en').querySelector('.ssh-g-desc').getAttribute('data-cut')],
      arT: g('ar').querySelector('.ssh-g-title').textContent, arDir: g('ar').dir, enDir: g('en').dir, arUrl: g('ar').querySelector('.ssh-g-url').textContent, enUrl: g('en').querySelector('.ssh-g-url').textContent }
  })
  is(len(pv.enT) === 60 && pv.enT.endsWith('\u2026') && pv.enCut[0] === '1', 'the English Google title is cut at 60 characters with an ellipsis (75 typed)', `${len(pv.enT)} ${pv.enT}`)
  is(len(pv.enD) === 160 && pv.enD.endsWith('\u2026') && pv.enCut[1] === '1', 'and the description at 160 (200 typed)', `${len(pv.enD)}`)
  is(pv.arT === 'عنوان عربي للاختبار في الكويت' && pv.arDir === 'rtl' && pv.enDir === 'ltr', 'the Arabic result shows the Arabic title, right to left; the English one left to right')
  is(/www\.sporta\.com\.kw › product › short-title$/.test(pv.arUrl) && /\(\?lang=en\)$/.test(pv.enUrl), 'the address line is the product address (and says ?lang=en for English)', pv.arUrl + ' / ' + pv.enUrl)
  is(await pg0.evaluate(() => { const c = document.querySelector('.ssh-card'); return c.getAttribute('lang') === 'ar' && c.dir === 'rtl' && /عنوان عربي/.test(c.querySelector('.ssh-card-title').textContent) && /\/images\/products\/short-title\.jpg$/.test(c.querySelector('img').src) }), 'the share card (Arabic first) shows the title and the product photo')
  await pg0.click('.ssh-segbtn[data-card="en"]')
  is(await pg0.evaluate(() => { const c = document.querySelector('.ssh-card'); return c.getAttribute('lang') === 'en' && c.dir === 'ltr' && c.querySelector('.ssh-card-title').textContent.length <= 70 }), 'the EN toggle switches the card to English, title kept to 70 characters')
  await E('[name=image]').fill('/images/products/custom-share.webp')
  is(await pg0.evaluate(() => /\/images\/products\/custom-share\.webp$/.test(document.querySelector('.ssh-card img').src)), 'a valid path becomes the card image as you type')
  await shot(pg0, '02-editor-1280-light', true)
  await E('.ssh-btn:has-text("Use defaults")').click()
  is(await pg0.evaluate(() => ['title_en', 'title_ar', 'description_en', 'description_ar', 'image'].every((n) => document.querySelector(`.ssh-editor [name=${n}]`).value === '')), '"Use defaults" empties the form (and saves nothing yet)')
  is(posts(W0).length === 0, 'nothing has been written by all that typing')
  await E('.ssh-btn:has-text("Fill with a suggestion")').click()
  const filled = await pg0.evaluate(() => Object.fromEntries(['title_en', 'title_ar', 'description_en', 'description_ar'].map((n) => [n, document.querySelector(`.ssh-editor [name=${n}]`).value])))
  is(Object.values(filled).every((v) => v.length > 0) && posts(W0).length === 0, '"Fill with a suggestion" fills the four texts into the form and still saves nothing', JSON.stringify(filled).slice(0, 120))
}

// ================================================================================================ 7. saving
head('saving: the request')
{
  const E = (sel) => pg0.locator('.ssh-editor ' + sel)
  await E('[name=title_en]').fill('  Cap Pro training cap in black — Sporta  ')
  await E('[name=title_ar]').fill('قبعة برو للتمارين بلون أسود — سبورتا')
  await E('[name=description_en]').fill(fill(100, 4)); await E('[name=description_ar]').fill(fillAr(90))
  await E('[name=image]').fill('/images/products/short-title-share.webp')
  await E('.ssh-btn--primary').click()
  await pg0.waitForFunction(() => !document.querySelector('.ssh-editor'), null, { timeout: 4000 })
  const sent = posts(W0)
  is(sent.length === 1 && sent[0].route === 'seo_save', 'exactly one request is written: seo_save', sent.map((x) => x.route).join(','))
  const b = sent[0].body
  is(same(Object.keys(b).sort(), ['description_ar', 'description_en', 'image', 'product_id', 'scope', 'title_ar', 'title_en']), 'its body has exactly the seven keys the server reads', Object.keys(b).join(','))
  is(b.scope === 'product' && b.product_id === 10 && typeof b.product_id === 'number', 'scope "product" and product_id is the number 10')
  is(b.title_en === 'Cap Pro training cap in black — Sporta' && b.title_ar === 'قبعة برو للتمارين بلون أسود — سبورتا' && b.description_en === fill(100, 4) && b.description_ar === fillAr(90) && b.image === '/images/products/short-title-share.webp', 'the texts are trimmed and sent as typed')
  is(sent[0].headers['x-sporta-admin'] === '1' && /^application\/json/.test(sent[0].headers['content-type']), 'with X-Sporta-Admin: 1 and Content-Type: application/json')
  is(W0.products.find((p) => p.id === 10).ov.title_en === 'Cap Pro training cap in black — Sporta', 'the (fake) server stored it')
  is(await pg0.evaluate(() => { const r = document.querySelector('.ssh tr.ssh-row[data-key="x:10"]'); return r && /Cap Pro training cap in black/.test(r.textContent) && r.querySelector('.ssh-src') !== null }), 'the row shows the new text, marked "custom", and the editor closed')
  is(/Saved: Cap Pro/.test(await pg0.locator('.ssh-status').textContent()), 'the status line says what was saved')
  const k = await rowFlags(pg0, 'x:10'); is(!has(k, 'title_short') && !has(k, 'desc_short') && !has(k, 'share_default'), 'and the row\'s flags were worked out again from it', k.join(','))
  // a page
  await pg0.fill('.ssh-filters input[type=search]', '/about'); await pg0.waitForTimeout(350)
  await pg0.click('.ssh tr.ssh-row[data-key="p:/about"] .ssh-btn'); await pg0.waitForSelector('.ssh-editor')
  await E('[name=title_en]').fill('About Sporta, the sportswear store in Kuwait')
  await E('.ssh-btn--primary').click(); await pg0.waitForFunction(() => !document.querySelector('.ssh-editor'))
  const pgPost = posts(W0)[1].body
  is(same(Object.keys(pgPost).sort(), ['description_ar', 'description_en', 'image', 'path', 'scope', 'title_ar', 'title_en']) && pgPost.scope === 'page' && pgPost.path === '/about' && pgPost.title_en === 'About Sporta, the sportswear store in Kuwait' && pgPost.title_ar === '' && pgPost.image === '', 'a page is saved as {scope: "page", path: "/about"} with the other fields empty')
  is(posts(W0).every((x) => x.route === 'seo_save'), 'only seo_save is ever POSTed; no other write route was called')
  const routesAll = new Set(W0.calls.map((x) => x.route)); const OTHERS = ['abandoned_orders', 'content', 'assistant_settings']        // the probes of the other add-on blocks in the same file
  is([...routesAll].filter((r) => !OTHERS.includes(r)).every((r) => ['seo_settings', 'products_all', 'brands', 'seo_save'].includes(r)), 'and no admin route outside the four named ones was called by this block', [...routesAll].join(','))
  await pg0.fill('.ssh-filters input[type=search]', ''); await pg0.waitForTimeout(350)
}
head('saving: nothing sent for what the server would refuse')
{
  const before = posts(W0).length
  await pg0.fill('.ssh-filters input[type=search]', 'compression'); await pg0.waitForTimeout(350)
  await pg0.click('.ssh tr.ssh-row[data-key="x:2"] .ssh-btn'); await pg0.waitForSelector('.ssh-editor')
  const E = (sel) => pg0.locator('.ssh-editor ' + sel), saveBtn = E('.ssh-btn--primary')
  is(await saveBtn.isDisabled(), 'with nothing changed, Save is disabled')
  for (const bad of ['https://evil.test/x.png', '//evil.test/x.png', '/a/../b.png', '/x.svg', '/images/a b.png', 'images/x.png', '/x.png?v=1', 'data:image/png;base64,AAAA']) {
    await E('[name=image]').fill(bad)
    is((await saveBtn.isDisabled()) && /path on this site/.test(await E('.ssh-msg').textContent()), `image "${bad.slice(0, 30)}" is refused before any request`)
  }
  for (const good of ['/images/ok-1_2.webp', '/a.PNG', '/images/products/x.avif']) { await E('[name=image]').fill(good); is(!(await saveBtn.isDisabled()), `image "${good}" is accepted`) }
  await E('[name=image]').fill('')
  await E('[name=title_ar]').fill(fillAr(130))
  is((await saveBtn.isDisabled()) && /longer than 120/.test(await E('.ssh-msg').textContent()), 'an Arabic title of 130 characters is refused before any request')
  await E('[name=title_ar]').fill('')
  await E('[name=description_en]').fill(fill(321, 1))
  is((await saveBtn.isDisabled()) && /longer than 320/.test(await E('.ssh-msg').textContent()), 'a description of 321 characters too')
  is(posts(W0).length === before, 'none of that sent a request')
  await E('[name=description_en]').fill('')
}
head('saving: double click, failures, retry')
{
  const E = (sel) => pg0.locator('.ssh-editor ' + sel), saveBtn = E('.ssh-btn--primary')
  const n0 = posts(W0).length
  await E('[name=title_en]').fill('Vanquish Compression Shorts for gym and running')
  W0.delay = 400
  await saveBtn.dblclick()
  await pg0.waitForFunction(() => !document.querySelector('.ssh-editor'), null, { timeout: 4000 })
  W0.delay = 0
  is(posts(W0).length === n0 + 1, 'a double click on Save sends ONE request', String(posts(W0).length - n0))
  // failures
  const fails = [
    [{ status: 401, body: { error: 'unauthorized' } }, /sign-in has ended/, '401'],
    [{ status: 429, body: { error: 'too_many' }, headers: { 'Retry-After': '7' } }, /Wait 7 seconds/, '429 with Retry-After'],
    [{ status: 400, body: { error: 'invalid_seo_title' } }, /120 characters/, '400 invalid_seo_title'],
    [{ status: 400, body: { error: 'invalid_seo_description' } }, /320 characters/, '400 invalid_seo_description'],
    [{ status: 400, body: { error: 'invalid_seo_image' } }, /path on this site/, '400 invalid_seo_image'],
    [{ status: 404, body: { error: 'product_not_found' } }, /no longer exists/, '404 product_not_found'],
    [{ status: 500, body: { error: 'boom' } }, /\(boom\)/, '500'],
  ]
  await pg0.fill('.ssh-filters input[type=search]', 'compression'); await pg0.waitForTimeout(350)
  for (const [inj, rx, name] of fails) {
    await pg0.click('.ssh tr.ssh-row[data-key="x:2"] .ssh-btn'); await pg0.waitForSelector('.ssh-editor')
    await E('[name=title_en]').fill('Vanquish Compression Shorts ' + name)
    W0.next = inj
    await saveBtn.click()
    await pg0.waitForFunction(() => /\S/.test(document.querySelector('.ssh-editor .ssh-msg')?.textContent || ''), null, { timeout: 3000 }).catch(() => {})
    const msg = await E('.ssh-msg').textContent()
    is(rx.test(msg) && (await pg0.evaluate(() => document.querySelector('.ssh-editor .ssh-msg').getAttribute('data-bad'))) === '1', `${name}: the form says so (${msg.slice(0, 70)})`)
    is(!(await saveBtn.isDisabled()) && (await saveBtn.textContent()) === 'Save SEO' && (await pg0.locator('.ssh-editor').count()) === 1, `${name}: the editor stays open with the text, and Save can be pressed again`)
    await pg0.click('.ssh tr.ssh-row[data-key="x:2"] .ssh-btn')
  }
  await pg0.click('.ssh tr.ssh-row[data-key="x:2"] .ssh-btn'); await pg0.waitForSelector('.ssh-editor')
  await E('[name=title_en]').fill('Vanquish Compression Shorts retried')
  W0.drop = true; await saveBtn.click(); await pg0.waitForFunction(() => /\S/.test(document.querySelector('.ssh-editor .ssh-msg')?.textContent || ''), null, { timeout: 3000 })
  is(/Could not reach the server/.test(await E('.ssh-msg').textContent()), 'a dead network: "Could not reach the server"')
  W0.drop = false; await saveBtn.click(); await pg0.waitForFunction(() => !document.querySelector('.ssh-editor'), null, { timeout: 3000 })
  is(W0.products.find((p) => p.id === 2).ov.title_en === 'Vanquish Compression Shorts retried', 'after the failures the same form saves when the server answers')
  is(pageErrors.length === 0, 'no page errors so far', pageErrors.join(' ; '))
}
await close(pg0)

// ================================================================================================ 8. suggest
head('suggest: the templates')
{
  const W = makeWorld(), pg = await open(W)
  const S = (p) => pg.evaluate((x) => window.__sportaSeoHealth.suggest(x), p)
  const inputs = [
    { name_en: 'Cap', name_ar: 'قبعة', desc_en: 'Cap.', desc_ar: 'قبعة.', category: 'caps', brand_en: 'Vanquish', brand_ar: 'فانكويش' },
    { name_en: 'Vanquish Pro Training Tee', name_ar: 'تيشيرت فانكويش للتمارين', desc_en: '', desc_ar: '', category: 'tops', brand_en: 'Vanquish', brand_ar: 'فانكويش' },
    { name_en: 'Gymshark Legacy Seamless Long Sleeve Crop Top in Black Marl', name_ar: 'توب جيمشارك لونغ سليف قصير بلون أسود مموج للتمارين', desc_en: 'Soft stretch fabric that moves with you. Great for lifting and running.', desc_ar: 'قماش مرن ناعم يتحرك معك. مناسب للرفع والجري.', category: 'women', brand_en: 'Gymshark', brand_ar: 'جيمشارك' },
    { name_en: fill(150, 3), name_ar: fillAr(150), desc_en: fill(400, 3), desc_ar: fillAr(400), category: 'unknown-cat', brand_en: '', brand_ar: '' },
    { name_en: 'Tee', name_ar: '', desc_en: '', desc_ar: '', category: '', brand_en: '', brand_ar: '' },
  ]
  const out = []
  for (const i of inputs) { const a = await S(i), b = await S(i); is(same(a, b), 'the same product gives the same draft twice (deterministic)'); out.push(a) }
  is(out[0].title_en === 'Cap by Vanquish — caps | Sporta' && out[0].title_ar === 'قبعة من فانكويش — كابات | سبورتا', 'the short product: "Cap by Vanquish — caps | Sporta" and its Arabic twin', out[0].title_en + ' / ' + out[0].title_ar)
  is(out[0].description_en === 'Shop Cap by Vanquish at Sporta Kuwait. Caps with delivery within 24 hours across Kuwait. Sizes and payment options at checkout.', 'its description: a lead, the category and delivery, the checkout line (the 4-character "Cap." is not used)', out[0].description_en)
  is(out[1].title_en === 'Vanquish Pro Training Tee — sportswear in Kuwait | Sporta', 'a brand already in the name is not repeated ("by Vanquish" is left out)', out[1].title_en)
  is(out[2].description_en.includes('Soft stretch fabric that moves with you.') && !out[2].description_en.includes('Great for lifting'), 'a product\'s own description is used for its first sentence only', out[2].description_en)
  for (const [i, o] of out.entries()) {
    for (const [k, v] of Object.entries(o)) {
      if (!v) continue
      const isT = k.startsWith('title'), n = len(v)
      const okBand = isT ? n <= 120 : n <= 320
      is(okBand, `sample ${i + 1} ${k}: ${n} characters, inside the server limit`)
      is(!/[<>]/.test(v) && !/\d+\s*(KWD|KD|د\.ك)/i.test(v) && !/\d+\.\d{3}/.test(v), `sample ${i + 1} ${k}: no markup and no price`)
    }
    if (o.title_en) is(len(o.title_en) <= 60 && (len(o.title_en) >= 30 || i === 4), `sample ${i + 1} English title is inside 30-60 (${len(o.title_en)})`, o.title_en)
    if (o.title_ar) is(len(o.title_ar) <= 60 && len(o.title_ar) >= 30, `sample ${i + 1} Arabic title is inside 30-60 (${len(o.title_ar)})`, o.title_ar)
    if (o.description_en) is(len(o.description_en) >= 70 && len(o.description_en) <= 160, `sample ${i + 1} English description is inside 70-160 (${len(o.description_en)})`)
    if (o.description_ar) is(len(o.description_ar) >= 70 && len(o.description_ar) <= 160, `sample ${i + 1} Arabic description is inside 70-160 (${len(o.description_ar)})`)
  }
  is(out[4].title_ar === '' && out[4].description_ar === '' && out[4].title_en !== '', 'a product with no Arabic name gets no Arabic draft (a template cannot invent a name)')
  is(/ \| Sporta$/.test(out[3].title_en) && !/(?:\bin|\bof|\band|\bwith)\s\|/.test(out[3].title_en), 'a very long name is cut at a word, never ends on a dangling "in" or "of"', out[3].title_en)
  is(IMG_RE.test('/images/products/x.jpg'), 'sanity: the test\'s copy of the image rule')
  await close(pg)
}
head('suggest: review, confirm, apply')
{
  const W = makeWorld(), pg = await open(W)
  await openPanel(pg)
  const before = clone(W.products.map((p) => p.ov))
  await pg.click('.ssh-tools .ssh-btn--primary')
  await pg.waitForSelector('.ssh-sugg-item')
  const items = await pg.evaluate(() => [...document.querySelectorAll('.ssh-sugg-item')].map((i) => ({ key: i.getAttribute('data-key'), fields: [...i.querySelectorAll('.ssh-diff')].map((d) => d.getAttribute('data-field')), checked: i.querySelector('input').checked })))
  const keys = items.map((i) => i.key)
  is(keys.includes('x:10') && keys.includes('x:6') && keys.includes('x:9') && keys.includes('x:7') && keys.includes('x:8') && keys.includes('x:12') && keys.includes('x:13'), 'the review lists the weak active products (short, no description, long, duplicate, over, extra photo)', keys.join(','))
  is(!keys.includes('x:1') && !keys.includes('x:3'), 'neither is the well-written product (x:1) nor the hidden one (x:3)')
  is(items.every((i) => i.checked), 'every listed product starts ticked')
  is(posts(W).length === 0, 'opening the review saved nothing')
  const it10 = items.find((i) => i.key === 'x:10')
  is(it10.fields.includes('title_en') && it10.fields.includes('description_en') && it10.fields.includes('title_ar') && it10.fields.includes('description_ar'), 'a product weak in all four texts gets four drafts', it10.fields.join(','))
  const it7 = items.find((i) => i.key === 'x:7')
  is(it7.fields.includes('title_en') && it7.fields.includes('description_en') && !it7.fields.includes('title_ar') && !it7.fields.includes('description_ar'), 'a duplicate pair is redrafted in English only (its Arabic texts are fine)', it7.fields.join(','))
  const it13 = items.find((i) => i.key === 'x:13')
  is(it13.fields.includes('image'), 'a product with extra photos and no main photo is offered the first extra photo as its share image', it13.fields.join(','))
  is(await pg.evaluate(() => { const d = document.querySelector('.ssh-sugg-item[data-key="x:10"] .ssh-diff[data-field="title_en"]'); return /now/.test(d.querySelector('.ssh-old .ssh-difflab').textContent) && /Suggested \(\d+ characters\)/.test(d.querySelector('.ssh-new .ssh-difflab').textContent) && document.querySelector('.ssh-sugg-item[data-key="x:10"] .ssh-diff[data-field="title_ar"] .ssh-old').dir === 'rtl' }), 'each draft is shown old and new, with the new length, Arabic right to left')
  await shot(pg, '03-suggest-1280-light', true)
  // untick one
  await pg.evaluate(() => { document.querySelector('.ssh-sugg-item[data-key="x:12"] input').click() })
  const nChecked = await pg.evaluate(() => [...document.querySelectorAll('.ssh-sugg-item input')].filter((c) => c.checked).length)
  const apply = pg.locator('[data-sporta-seo-apply]')
  is((await apply.textContent()) === `Apply selected (${nChecked})` && nChecked === items.length - 1, 'Apply selected counts the ticked ones', await apply.textContent())
  await apply.click()
  is((await pg.locator('[data-sporta-seo-confirm]').count()) === 1 && /Yes, save \d+ products/.test(await pg.locator('[data-sporta-seo-confirm]').textContent()) && /changes the search text of \d+ products on the live shop/.test(await pg.locator('.ssh-confirm').textContent()), 'Apply asks first: "Yes, save N products", saying what it does')
  is(posts(W).length === 0, 'still nothing saved')
  await pg.click('.ssh-sugg .ssh-acts .ssh-btn:has-text("Not yet")')
  is((await pg.locator('[data-sporta-seo-apply]').count()) === 1 && posts(W).length === 0, '"Not yet" goes back, nothing saved')
  // a 401 stops the run
  await pg.click('[data-sporta-seo-apply]'); W.next = { status: 401, body: { error: 'unauthorized' } }
  await pg.click('[data-sporta-seo-confirm]')
  await pg.waitForFunction(() => /Stopped/.test(document.querySelector('.ssh-status').textContent), null, { timeout: 4000 })
  is(posts(W).length === 1 && /sign-in has ended/.test(await pg.locator('.ssh-status').textContent()), 'a 401 stops the run after the first request and says why', String(posts(W).length))
  is((await pg.locator('.ssh-sugg-item').count()) === items.length, 'and every product is still on the list (none was saved)')
  // the real run, double-clicking Yes
  await pg.click('[data-sporta-seo-apply]'); W.delay = 120
  await pg.locator('[data-sporta-seo-confirm]').dblclick()
  await pg.waitForFunction(() => /Saved \d+ products/.test(document.querySelector('.ssh-status').textContent), null, { timeout: 15000 })
  W.delay = 0
  const sent = posts(W).slice(1)
  is(sent.length === nChecked, `one seo_save per ticked product (${nChecked}), a double click on Yes does not double it`, String(sent.length))
  is(!sent.some((s) => s.body.product_id === 12), 'the unticked product was never written')
  is(sent.every((s) => s.route === 'seo_save' && s.body.scope === 'product' && typeof s.body.product_id === 'number' && same(Object.keys(s.body).sort(), ['description_ar', 'description_en', 'image', 'product_id', 'scope', 'title_ar', 'title_en'])), 'each is a seo_save with the full record')
  const b7 = sent.find((s) => s.body.product_id === 7).body, orig7 = PRODUCTS.find((p) => p.id === 7).ov
  is(b7.title_ar === orig7.title_ar && b7.description_ar === orig7.description_ar, 'the fields that were not drafted keep the owner\'s saved text', b7.title_ar)
  is(b7.title_en !== orig7.title_en && b7.description_en !== orig7.description_en && len(b7.title_en) >= 30 && len(b7.title_en) <= 60 && len(b7.description_en) >= 70 && len(b7.description_en) <= 160, 'and the drafted ones replaced the duplicates, inside the bands', `${b7.title_en} (${len(b7.title_en)})`)
  const b13 = sent.find((s) => s.body.product_id === 13).body
  is(b13.image === '/images/products/extra-photo-2.webp', 'the share image suggestion is the first extra photo', b13.image)
  is(W.products.find((p) => p.id === 12).ov.title_en === '' , 'product 12 is untouched on the server')
  is((await pg.locator('.ssh-sugg-item').count()) === 1 && (await pg.locator('.ssh-sugg-item').getAttribute('data-key')) === 'x:12', 'the saved products left the list; the unticked one remains')
  const after = await rowFlags(pg, 'x:10')
  is(!has(after, 'title_short') && !has(after, 'desc_short') && !has(after, 'default_desc'), 'and their flags were recomputed from what was saved', after.join(','))
  is(!has(await rowFlags(pg, 'x:7'), 'dup_title') && !has(await rowFlags(pg, 'x:8'), 'dup_title'), 'the duplicate pair is no longer a duplicate')
  is(pageErrors.length === 0, 'no page errors', pageErrors.join(' ; '))
  void before
  await close(pg)
}

// ================================================================================================ 9. refusals on open
head('the panel when the server is behind')
{
  const W = makeWorld(); W.routes404.add('seo_settings')
  const pg = await open(W); await pg.click('[data-sporta-seo-btn]'); await pg.waitForSelector('.ssh-box:not([hidden])', { timeout: 4000 })
  is(/not have the SEO routes|does not have/.test(await pg.locator('.ssh-box').textContent()) || /SEO routes/.test(await pg.locator('.ssh-box').textContent()), 'a server without seo_settings: a plain note, not a broken screen', await pg.locator('.ssh-box').textContent())
  is(await pg.evaluate(() => document.querySelector('.ssh tbody').children.length === 0), 'and no table')
  await close(pg)
  const W2 = makeWorld(); W2.routes404.add('products_all'); W2.routes404.add('brands')
  const p2 = await open(W2); await openPanel(p2)
  is(/descriptions of products are not audited/.test(await p2.locator('.ssh-status').textContent()), 'without products_all the panel still audits titles and says descriptions are not audited')
  is(await p2.evaluate(() => !document.querySelector('.ssh tr.ssh-row[data-key^="x:"] [data-code="default_desc"]') && !document.querySelector('.ssh tr.ssh-row[data-key^="x:"] [data-code="desc_short"]')), 'and invents no description flags')
  await close(p2)
  const W3 = makeWorld(); W3.listFail = 401
  const p3 = await open(W3); await p3.click('[data-sporta-seo-btn]'); await p3.waitForSelector('.ssh-box:not([hidden])')
  is(/sign-in has ended/.test(await p3.locator('.ssh-box').textContent()), 'a 401 on opening says the sign-in has ended')
  await close(p3)
}

// ================================================================================================ 10. back, menu
head('leaving the panel')
{
  const W = makeWorld(), pg = await open(W); await openPanel(pg)
  await pg.click('.ssh-tools .ssh-btn:has-text("Back")')
  is(await pg.evaluate(() => !document.body.hasAttribute('data-sporta-seo-state') && getComputedStyle(document.querySelector('.seo-editor').closest('section')).display !== 'none' && document.querySelector('section.ssh').hidden), 'Back shows the SEO Editor again and hides the panel')
  is(await pg.evaluate(() => document.activeElement === document.querySelector('[data-sporta-seo-btn]')), 'with focus back on the SEO health button')
  await pg.click('[data-sporta-seo-btn]'); await pg.waitForSelector('.ssh tbody tr.ssh-row')
  await pg.evaluate(() => { const b = document.querySelector('.admin-sidebar .admin-nav-item'); b.addEventListener('click', (e) => e.preventDefault(), { once: true }); b.click() })
  is(await pg.evaluate(() => !document.body.hasAttribute('data-sporta-seo-state')), 'a click on the menu closes the panel before the screen changes')
  await pg.click('[data-sporta-seo-btn]'); await pg.waitForSelector('.ssh tbody tr.ssh-row')
  const n = gets(W).filter((c) => c.route === 'seo_settings').length
  await pg.click('.ssh-tools .ssh-btn:has-text("Refresh")'); await pg.waitForTimeout(600)
  is(gets(W).filter((c) => c.route === 'seo_settings').length === n + 1, 'Refresh reads the lists again')
  is(await pg.evaluate(() => document.querySelectorAll('style[data-sporta-seo-style]').length === 1 && document.querySelectorAll('section.ssh').length === 1), 'one style element and one panel, however often it is opened')
  await close(pg)
}

// ================================================================================================ 11. layout
head('layout: sizes, RTL, dark, contrast')
const lum = `(function(){})`
const measure = (pg) => pg.evaluate(() => {
  const de = document.documentElement, panel = document.querySelector('section.ssh')
  const small = []
  for (const e of panel.querySelectorAll('button, select, input:not([type=checkbox]), textarea, summary')) {
    const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    if (r.height < 43.5) small.push((e.className || e.tagName) + ':' + Math.round(r.height))
  }
  const over = []
  for (const e of panel.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width && r.right > de.clientWidth + 1) over.push(e.className || e.tagName) }
  return { scroll: de.scrollWidth - de.clientWidth, panel: panel.scrollWidth - panel.clientWidth, small: small.slice(0, 6), over: over.slice(0, 4) }
})
const contrast = (pg) => pg.evaluate(() => {
  function parse(c) { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null || isNaN(p[3]) ? 1 : p[3] } }
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  function bg(e) { let a = e; const stack = []; while (a) { const c = parse(getComputedStyle(a).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } a = a.parentElement } let base = stack.length && stack[stack.length - 1].a >= 1 ? stack.pop() : { r: 255, g: 255, b: 255, a: 1 }; while (stack.length) { const t = stack.pop(); base = { r: t.r * t.a + base.r * (1 - t.a), g: t.g * t.a + base.g * (1 - t.a), b: t.b * t.a + base.b * (1 - t.a), a: 1 } } return base }
  const bad = []
  for (const e of document.querySelectorAll('section.ssh *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden') continue
    const f = parse(cs.color), b = bg(e); if (!f) continue
    const fa = { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a) }
    const l1 = L(fa), l2 = L(b), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    if (ratio < 4.5) bad.push(`${e.className || e.tagName} ${ratio.toFixed(2)} "${e.textContent.trim().slice(0, 24)}"`)
  }
  return bad.slice(0, 6)
})
for (const [w, rtl, dark] of [[1280, false, false], [768, false, false], [390, false, false], [390, true, false], [1280, true, false], [1280, false, true], [390, false, true], [768, true, true]]) {
  const W = makeWorld(), pg = await open(W, { w, rtl, dark }), tag = `${w}px ${rtl ? 'Arabic RTL' : 'English'} ${dark ? 'dark' : 'light'}`
  await openPanel(pg)
  let m = await measure(pg)
  is(m.scroll <= 0 && m.panel <= 0 && m.over.length === 0, `${tag}: no sideways scroll (panel)`, JSON.stringify(m))
  if (w === 390) is(m.small.length === 0, `${tag}: every button, select, field and summary is 44 px tall`, m.small.join(', '))
  await pg.click('.ssh tr.ssh-row[data-key="x:9"] .ssh-btn'); await pg.waitForSelector('.ssh-editor')
  m = await measure(pg)
  is(m.scroll <= 0 && m.panel <= 0 && m.over.length === 0, `${tag}: no sideways scroll (editor open)`, JSON.stringify(m))
  if (w === 390) is(m.small.length === 0, `${tag}: editor targets are 44 px`, m.small.join(', '))
  const bad = await contrast(pg)
  is(bad.length === 0, `${tag}: text 4.5:1 or better`, bad.join(' ; '))
  if (rtl) is(await pg.evaluate(() => document.querySelector('.ssh-g[data-lang="ar"]').dir === 'rtl' && getComputedStyle(document.querySelector('.ssh-editor [name=title_ar]')).direction === 'rtl' && document.querySelector('section.ssh').closest('[dir="rtl"]') !== null), `${tag}: the page is RTL and the Arabic text runs right to left`)
  await shot(pg, `04-${w}-${rtl ? 'rtl' : 'ltr'}-${dark ? 'dark' : 'light'}-editor`, w < 800)
  await pg.click('.ssh-editor .ssh-btn--quiet'); await pg.waitForTimeout(100)
  if (w === 390 || (w === 1280 && dark)) { await shot(pg, `05-${w}-${rtl ? 'rtl' : 'ltr'}-${dark ? 'dark' : 'light'}-list`, false) }
  await close(pg)
}
void lum

// ================================================================================================ 12. mutation, errors
head('mutation check and errors')
{
  const W = makeWorld(), pg = await open(W, { js: WITHOUT, wait: false })
  await pg.waitForTimeout(1200)
  is((await pg.locator('[data-sporta-seo-btn]').count()) === 0 && (await pg.locator('section.ssh').count()) === 0 && (await pg.evaluate(() => typeof window.__sportaSeoHealth)) === 'undefined', 'with the block cut out of the file there is no button, no panel and no hook')
  is(WITHOUT.length < BRANDS_JS.length && !WITHOUT.includes('data-sporta-seo-btn'), 'the cut file really lacks the block')
  await close(pg)
  is(pageErrors.length === 0, 'no page errors in the whole run', pageErrors.join(' ; '))
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
