// CATALOGUE-1118: the engine behind the Catalogue page and the admin download (public/sporta-catalogue.js), in a real browser.
//
//   npm run test:catalogue-pdf    (rig-free: a tiny same-origin server answers /api/api.php, the fonts, the logo and the product photos;
//                                  poppler's pdfinfo / pdftoppm are the independent readers of the PDF)
//
// Asserted:
//   - THE DATA is the shop's PUBLIC data and nothing else: three GETs (products, stock, brands); the effective price, list price and percent
//     off, sale only when the list price is higher; the shop's own brand is not shown as a maker; sizes in size order (XS S M L XL 2XL 3XL,
//     numbers after), "sold out" only when stock rows exist and none is in stock, unknown stock is not "sold out"; the print order (men,
//     women, hoodies, accessories, then any other category; featured first); NO quantity, SKU or cost reaches the model; photo candidates
//     are same-origin /images paths only; a failing stock or brands read does not stop the catalogue, a failing products read does.
//   - THE PDF (Arabic and English): a well-formed PDF 1.4 (xref offsets point at their objects), poppler reads it, A4 (595.28 x 841.89 pt),
//     the page count is the cover plus nine products a page per category, the title and language are set, one link per product to its page on
//     www.sporta.com.kw (English links carry ?lang=en) and one to the site on every page, and poppler renders every page.
//   - THE PICTURE, sampled at the pixels of the cards (the page is drawn at 1240 x 1754, poppler renders it at 150 dpi so the numbers line up):
//     dark cover with the orange stripe, light content pages with the dark band, a JPEG, a PNG and a WebP photo each drawn in the card, the
//     "photo coming soon" plate for a product with none, the orange percent badge on the product on sale (and not on the one that is not) on the
//     start side of the photo (left in English, right in Arabic), the dark "sold out" band, the grid filling right to left in Arabic.
//   - BEHAVIOUR: progress runs 1..n, a cancel stops the build, an empty shop is refused, missing photos still give a file, 120 products give a
//     long file, the file name carries the date and language, download() hands the browser a file with that name, the fonts are the shop's own.
//   - MUTATIONS: with the links, the right-to-left grid, the sale badge, the sold-out band, the JPEG filter, the size order or the own-brand rule
//     cut out of the engine, the matching check above goes red.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeData, genImages, serveShop, engineSource } from './lib/catalogue-fx.mjs'
import { png } from './lib/png.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const have = (c) => spawnSync(c, ['-v'], { encoding: 'utf8' }).error == null
if (!have('pdfinfo') || !have('pdftoppm')) { console.log('SKIP poppler (pdfinfo, pdftoppm) is not installed'); process.exit(0) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-cat-'))
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()
// which format each product's photo is served in (the engine tries jpg, png, webp, jpeg in that order); two products have none
const FORMATS = { 'men-last': null, 'acc-backpack': null, 'uploaded-photo-tee': 'png', 'men-alpha-top': 'jpg', 'women-top': 'png', 'women-jacket': 'webp', 'men-sale-shorts': 'jpg' }
const FMT = (slug) => (slug in FORMATS ? FORMATS[slug] : 'jpg')
const photos = (slug, ext) => (FMT(slug) === ext ? ext : null)

async function open(o = {}) {
  const shop = await serveShop({ images: IMAGES, photos, ...o })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage(), errs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()) })
  await page.goto(shop.base + '/'); await page.waitForFunction(() => !!window.SportaCatalogue)
  return { shop, ctx, page, errs, close: async () => { await ctx.close(); await shop.close() } }
}
async function buildPdf(page, lang, extra = '') {
  const r = await page.evaluate(async ([l, ex]) => {
    const calls = []
    const res = await window.SportaCatalogue.buildPdf({ lang: l, onProgress: (p) => calls.push(p.i + '/' + p.n), ...(ex ? eval('(' + ex + ')') : {}) })
    const u = new Uint8Array(await res.blob.arrayBuffer()); let s = ''
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768))
    return { b64: btoa(s), name: res.name, pages: res.pages, bytes: res.bytes, count: res.count, type: res.blob.type, calls }
  }, [lang, extra])
  return { ...r, buf: Buffer.from(r.b64, 'base64') }
}
const info = (file) => { const o = spawnSync('pdfinfo', [file], { encoding: 'utf8' }); const m = {}; String(o.stdout).split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim() }); m.status = o.status; return m }
const urlsOf = (file) => String(spawnSync('pdfinfo', ['-url', file], { encoding: 'utf8' }).stdout).split('\n').map((l) => /^\s*(\d+)\s+Annotation\s+(\S+)/.exec(l)).filter(Boolean).map((m) => ({ page: +m[1], url: m[2] }))
function render(file, first, last) {
  const pre = join(tmp, 'r' + Math.random().toString(36).slice(2, 7))
  const o = spawnSync('pdftoppm', ['-r', '150', '-png', '-f', String(first), '-l', String(last), file, pre], { encoding: 'utf8' })
  const files = readdirSync(tmp).filter((f) => f.startsWith(pre.split('/').pop()) && f.endsWith('.png')).sort()
  return { status: o.status, pages: files.map((f) => png(readFileSync(join(tmp, f)))) }
}
// annotations of my own writer, with the page each belongs to (the writer emits a page's object and then its annotations)
function annots(buf) {
  const s = buf.toString('latin1'), out = []; let pg = 0
  for (const m of s.matchAll(/\/Type \/Page \/Parent|\/Rect \[([\d. ]+)\] \/Border \[0 0 0\] \/F 4 \/A << \/S \/URI \/URI \(([^)]*)\) >>/g)) {
    if (!m[1]) { pg++; continue }
    const [x1, y1, x2, y2] = m[1].split(' ').map(Number); const k = 1240 / 595.28
    out.push({ page: pg, url: m[2], x: x1 * k, y: (841.89 - y2) * k, w: (x2 - x1) * k, h: (y2 - y1) * k })
  }
  return out
}
function xrefOk(buf) {
  const s = buf.toString('latin1'), sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s); if (!sx) return false
  const tab = s.slice(+sx[1]); const m = /^xref\n0 (\d+)\n/.exec(tab); if (!m) return false
  const n = +m[1], rows = tab.slice(m[0].length).split('\n').slice(0, n)
  for (let i = 1; i < n; i++) { const off = +rows[i].slice(0, 10); if (s.slice(off, off + String(i).length + 6) !== i + ' 0 obj') return false }
  return /^0000000000 65535 f $/.test(rows[0]) && rows.every((r) => r.length === 19)
}
const near = (c, r, g, b, d = 40) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) <= d
const PLATE = [239, 234, 224], ORANGE = [255, 123, 23]

// ---------------------------------------------------------------------------------------------------- one full analysis
async function analyse(engine, label, full = true) {
  const R = {}
  const s = await open({ engine })
  try {
    const data = s.shop.st.data
    const model = await s.page.evaluate(() => window.SportaCatalogue.load().then((r) => JSON.parse(JSON.stringify(r.products))))
    R.model = model
    R.firstReads = s.shop.st.reqs.filter((q) => q.startsWith('GET /api/api.php'))
    const bySlug = Object.fromEntries(model.map((p) => [p.slug, p]))
    R.sizesOrder = eq(bySlug['men-sizes-mixed'].sizesIn, ['S', 'XL', '2XL', '3XL', '40', '42'])
    R.ownBrand = bySlug['men-own-brand'].brandName === null && bySlug['men-own-brand'].brand === '' && bySlug['men-brand-vest'].brandName && bySlug['men-brand-vest'].brandName.en === 'AHED' && bySlug['men-brand-vest'].brand === 'ahed'
    const out = {}
    for (const lang of ['ar', 'en']) {
      const t0 = Date.now(), b = await buildPdf(s.page, lang)
      const file = join(tmp, `${label}-${lang}.pdf`); writeFileSync(file, b.buf)
      const I = info(file), A = annots(b.buf), U = urlsOf(file)
      const rd = render(file, 1, b.pages)
      out[lang] = { b, file, I, A, U, rd, ms: Date.now() - t0 }
      R['render-' + lang] = rd.status === 0 && rd.pages.length === b.pages && rd.pages.every((p) => Math.abs(p.w - 1240) <= 1 && p.h === 1754) && rd.pages[0].at(600, 700).r < 40   // and the pictures decode (a wrong filter renders white)
      R['links-' + lang] = U.filter((a) => /\/product\//.test(a.url)).length === model.length && model.every((p) => U.some((a) => a.url === 'https://www.sporta.com.kw/product/' + p.slug + (lang === 'en' ? '?lang=en' : '')))
      const sale = A.find((a) => a.url.includes('/men-sale-shorts')), fake = A.find((a) => a.url.includes('/men-fake-sale')), sold = A.find((a) => a.url.includes('/men-sold-out'))
      const pageOf = (a) => rd.pages[a.page - 1]
      const sample = (a, dx, dy) => pageOf(a).at(Math.round(a.x + dx), Math.round(a.y + dy))
      const badgeX = lang === 'ar' ? sale.w - 24 - 45 : 24 + 45   // inside the badge, in its top padding, clear of the lettering
      R['badge-' + lang] = near(sample(sale, badgeX, 24 + 5), ...ORANGE, 45) && !near(sample(fake, badgeX, 24 + 5), ...ORANGE, 60)
      R['sold-' + lang] = (() => { const c = sample(sold, 40, 12 + 127), n = sample(sale, 40, 12 + 127); return c.r < 110 && c.g < 110 && c.b < 120 && n.r > 110 })()
      const ph = (slug, dx = -70) => { const a = A.find((x) => x.url.includes('/' + slug)); return sample(a, a.w / 2 + dx, 12 + 100) }
      R['photos-' + lang] = ['men-alpha-top', 'women-top', 'women-jacket', 'men-uploaded'].every((sl) => !near(ph(sl), ...PLATE, 60))
      const plate = (slug) => { const a = A.find((x) => x.url.includes('/' + slug)); return sample(a, a.w / 2 - 70, 12 + 40) }
      R['noPhoto-' + lang] = near(plate('men-last'), ...PLATE, 14) && near(plate('acc-backpack'), ...PLATE, 14)
      R['dbg-' + lang] = { plate: [plate('men-last'), plate('acc-backpack')], badge: [sample(sale, badgeX, 24 + 5), sample(fake, badgeX, 24 + 5)], sale: [sale.x, sale.y, sale.w, sale.h] }
      // the grid: the first two featured men are alpha (sort 1) then zeta (sort 2) on the same row
      const first = A.find((a) => a.url.includes('/men-alpha-top')), second = A.find((a) => a.url.includes('/men-zeta-top'))
      R['rtl-' + lang] = lang === 'ar' ? first.x > second.x && first.y === second.y : first.x < second.x && first.y === second.y
    }
    R.out = out
    if (full) R.s = s
    return R
  } finally { if (!full) await s.close() }
}

head('the engine as shipped')
const base = await analyse(engineSource(), 'base')
const S = base.s, M = base.model, st = S.shop.st
head('the data')
is(base.firstReads[0] === 'GET /api/api.php?r=catalogue' && base.firstReads.length === 4 && ['products', 'stock', 'brands'].every((k) => base.firstReads.some((r) => r.includes('r=' + k))), 'the catalogue route is asked first; it answers 404 (an older API), so the three routes of the first catalogue are read (GET only)', base.firstReads.join(' '))
is(M.length === 19, 'every product the shop returns is in the catalogue (19)', String(M.length))
const order = M.map((p) => p.category + ':' + p.slug)
is(eq(M.filter((p) => p.category === 'men').map((p) => p.slug).slice(0, 4), ['men-alpha-top', 'men-zeta-top', 'men-fake-sale', 'men-last']), 'men come first, featured products first by their order, then by name')
is(eq([...new Set(M.map((p) => p.category))], ['men', 'women', 'outerwear', 'accessories', 'kids']), 'category order: men, women, hoodies and jackets, accessories, then any other category last', order.join(' '))
const by = Object.fromEntries(M.map((p) => [p.slug, p]))
is(by['men-sale-shorts'].sale === true && by['men-sale-shorts'].pct === 20 && by['men-sale-shorts'].price === 8 && by['men-sale-shorts'].list === 10, 'sale: price 8 against 10 is 20% off')
is(by['men-fake-sale'].sale === false && by['men-fake-sale'].pct === 0, 'on_sale with a list price that is not higher is not a sale')
is(by['women-jacket'].pct === 27, 'percent is rounded (22 against 30 is 27%)')
is(by['men-own-brand'].brandName === null && by['men-own-brand'].brand === '', 'the shop’s own brand is not shown as a product’s maker')
is(by['men-brand-vest'].brandName && by['men-brand-vest'].brandName.en === 'AHED' && by['men-brand-vest'].brandName.ar === 'أحد' && by['men-brand-vest'].brand === 'ahed', 'a real brand is carried in both languages')
is(eq(by['men-sizes-mixed'].sizesIn, ['S', 'XL', '2XL', '3XL', '40', '42']) && eq(by['men-sizes-mixed'].sizes.map((x) => x.size + (x.in_stock ? '' : '!')), ['S', 'M!', 'XL', '2XL', '3XL', '40', '42']), 'sizes: size order, numbers after; the contract keeps every size with its in_stock flag, sizesIn lists the available ones', JSON.stringify(by['men-sizes-mixed'].sizes))
is(eq(by['women-top'].sizesIn, ['S', 'M', 'L']) && by['women-top'].sizes.length === 4, 'a size with no stock is not in sizesIn (and is flagged in sizes)')
is(by['men-sold-out'].soldOut === true && by['men-sold-out'].in_stock === false && by['men-sold-out'].sizesIn.length === 0, 'sold out: stock rows exist and none is in stock')
is(by['men-no-stock-rows'].soldOut === false && by['men-no-stock-rows'].known === false && by['men-no-stock-rows'].sizes.length === 0 && by['men-no-stock-rows'].sizesIn.length === 0, 'no stock rows: unknown, not "sold out", no sizes drawn')
is(eq(by['acc-cap'].sizesIn, ['ONE']), 'one size is kept as ONE (drawn as "One size")')
const json = JSON.stringify(M)
is(!/SKU-|"sku"|"stock"|cost|quantity/i.test(json), 'no SKU, quantity or cost reaches the model (a size is only available or not)')
const CONTRACT = ['slug', 'name_ar', 'name_en', 'category', 'brand', 'price', 'list_price', 'pct_off', 'on_sale', 'featured', 'pinned', 'in_stock', 'sizes', 'image', 'image_small', 'images']
is(M.every((p) => CONTRACT.every((k) => k in p)) && by['men-sale-shorts'].list_price === 10 && by['men-sale-shorts'].pct_off === 20 && by['men-sale-shorts'].on_sale === true && by['men-fake-sale'].on_sale === false && typeof by['men-last'].image === 'string' && Array.isArray(by['men-last'].images), 'every product carries the contract fields (slug ... images), derived for the legacy routes')
is(by['men-uploaded'].photos[0] === '/images/products/uploaded-photo-tee.png' && by['men-uploaded'].photos[1] === '/images/products/uploaded-photo-tee-2.jpg', 'uploaded photos come first, bare names are put under /images/products/')
is(eq(by['men-last'].photos, ['/images/products/men-last.jpg', '/images/products/men-last.png', '/images/products/men-last.webp', '/images/products/men-last.jpeg']), 'otherwise <slug>.jpg, .png, .webp, .jpeg')
const photoSafety = await (async () => {
  const t = await open({ data: (() => { const d = makeData(); const x = d.products.find((q) => q.slug === 'men-zeta-top'); x.images = ['http://evil.test/a.jpg', '../../etc/passwd', '/images/../x.jpg', '//evil.test/a.png', 'ok-name.jpg']; x.image = 'javascript:alert(1)'; return d })() })
  const m = await t.page.evaluate(() => window.SportaCatalogue.load().then((r) => r.products.find((q) => q.slug === 'men-zeta-top').photos)); await t.close(); return m
})()
is(photoSafety.every((u) => /^\/images\/[A-Za-z0-9._\/-]+$/.test(u) && !u.includes('..')) && photoSafety.includes('/images/products/ok-name.jpg'), 'photo candidates are same-origin /images paths only (another host, .., javascript: are dropped)', JSON.stringify(photoSafety))
for (const [name, fault, ok] of [['stock', { stock: 500 }, true], ['brands', { brands: 500 }, true], ['products', { products: 500 }, false]]) {
  const stockLess = name === 'stock'
  const t = await open({ fault })
  const r = await t.page.evaluate(() => window.SportaCatalogue.load().then((x) => ({ ok: true, n: x.products.length, sold: x.products.some((p) => p.soldOut), sizes: x.products.some((p) => p.sizes.length) }), (e) => ({ ok: false, msg: String(e && e.message) })))
  is(ok ? r.ok && r.n === 19 && (stockLess ? !r.sold && !r.sizes : r.sold && r.sizes) : !r.ok, ok ? `a failing ${name} read does not stop the catalogue (${stockLess ? 'no sizes, nothing marked sold out' : 'sizes and sold-out still shown'})` : 'a failing products read is an error (no empty catalogue is presented as the shop)', JSON.stringify(r))
  await t.close()
}

for (const lang of ['ar', 'en']) {
  const o = base.out[lang], b = o.b, A = o.A
  head(`the PDF, ${lang === 'ar' ? 'Arabic' : 'English'}`)
  is(b.buf.subarray(0, 9).toString('latin1') === '%PDF-1.4\n' && b.buf.toString('latin1').endsWith('%%EOF\n') && b.type === 'application/pdf', 'a PDF 1.4 file of type application/pdf')
  is(xrefOk(b.buf), 'the cross-reference table is exact: every offset points at its object, every row is 20 bytes')
  is(o.I.status === 0 && o.I.Pages === String(b.pages), `poppler reads it: ${b.pages} pages`, JSON.stringify(o.I.Pages))
  // cover + men 11 (2 pages) + women 3 + hoodies 1 + accessories 2 + kids 1 = 1 + 2 + 1 + 1 + 1 + 1 = 7
  is(b.pages === 7 && b.count === 19, 'cover + nine a page per category (men 2, women 1, hoodies 1, accessories 1, other 1) = 7 pages for 19 products', `${b.pages}/${b.count}`)
  is(/A4/.test(o.I['Page size'] || '') || /595\.28 x 841\.89/.test(o.I['Page size'] || ''), 'every page is A4 (595.28 x 841.89 pt)', o.I['Page size'])
  is(o.I.Title === (lang === 'ar' ? 'كتالوج المنتجات – Sporta' : 'Product catalogue – Sporta') && o.I.Author === 'Sporta', 'title and author are set', o.I.Title)
  is(new RegExp('/Lang \\(' + lang + '\\)').test(b.buf.toString('latin1')) && (lang !== 'ar' || /\/Direction \/R2L/.test(b.buf.toString('latin1'))), 'the language is set (and right-to-left reading for Arabic)')
  is(new RegExp('^Sporta-Catalogue-' + lang.toUpperCase() + '-\\d{4}-\\d{2}-\\d{2}\\.pdf$').test(b.name), 'the file is named for the language and the date', b.name)
  is(base['render-' + lang], 'poppler renders every page at 150 dpi (1240 x 1754)')
  is(base['links-' + lang], `${M.length} product links, one per product, to www.sporta.com.kw/product/<slug>${lang === 'en' ? '?lang=en' : ''}`)
  is(o.U.length === A.length && new Set(o.U.map((u) => u.page)).size === b.pages, 'poppler lists the same links, on every page', `${o.U.length}/${A.length}`)
  const siteLinks = A.filter((a) => !/\/product\//.test(a.url))
  is(siteLinks.length === b.pages && siteLinks.every((a) => a.url === 'https://www.sporta.com.kw/' + (lang === 'en' ? '?lang=en' : '')), 'a link to the shop on every page')
  is(A.every((a) => a.w > 100 && a.h > 20 && a.x >= 0 && a.x + a.w <= 1241 && a.y >= 0 && a.y + a.h <= 1755), 'every link rectangle lies inside its page')
  const cover = o.rd.pages[0], c2 = o.rd.pages[1]
  is(cover.at(600, 700).r < 40 && near(cover.at(600, 6), ...ORANGE, 30), 'the cover is dark with the orange stripe')
  is(c2.at(600, 40).r < 40 && near(c2.at(40, 700), 246, 243, 236, 12) && near(c2.at(600, 137), ...ORANGE, 30), 'a content page has the dark band, the orange rule and the warm page')
  is(base['photos-' + lang], 'a JPEG, a PNG and a WebP photo are drawn into their cards, and an uploaded photo from the API list')
  is(base['noPhoto-' + lang], 'a product with no photo shows the plain plate ("photo coming soon")', JSON.stringify(base['dbg-' + lang].plate))
  is(base['badge-' + lang], `the orange percent badge is on the product on sale, on the ${lang === 'ar' ? 'right' : 'left'} of its photo, and not on the one that is not`, JSON.stringify(base['dbg-' + lang].badge))
  is(base['sold-' + lang], 'the dark "sold out" band lies across the photo of the sold-out product only')
  is(base['rtl-' + lang], lang === 'ar' ? 'the grid fills right to left in Arabic (the first product is at the right)' : 'the grid fills left to right in English')
  is(b.calls.length === b.pages && b.calls[0] === '1/' + b.pages && b.calls[b.calls.length - 1] === b.pages + '/' + b.pages, 'progress runs 1 to n', b.calls.join(' '))
  is(b.bytes > 100000 && b.bytes < 8 * 1048576 && o.ms < 20000, 'the file is a sensible size and takes seconds', `${b.bytes} bytes, ${o.ms} ms`)
}
is(base.sizesOrder, 'size order (checked on the model)')
is(base.ownBrand, 'the own-brand rule (checked on the model)')

head('behaviour')
{
  const r = await S.page.evaluate(async () => {
    const out = {}
    out.cancel = await window.SportaCatalogue.buildPdf({ lang: 'en', signal: { aborted: true } }).then(() => 'built', (e) => (e && e.cancelled ? 'cancelled' : 'error ' + e.message))
    const ctl = { aborted: false }
    out.midCancel = await window.SportaCatalogue.buildPdf({ lang: 'en', signal: ctl, onProgress: (p) => { if (p.i === 3) ctl.aborted = true } }).then(() => 'built', (e) => (e && e.cancelled ? 'cancelled' : 'error ' + e.message))
    out.empty = await window.SportaCatalogue.buildPdf({ lang: 'en', products: [] }).then(() => 'built', (e) => String(e.message))
    out.font = document.fonts.check('700 20px "Sporta Catalogue Head"') && document.fonts.check('400 20px "Sporta Catalogue Body"')
    out.link = [window.SportaCatalogue.pdfLink('ar'), window.SportaCatalogue.pdfLink('en'), window.SportaCatalogue.pdfLink('xx')]
    return out
  })
  is(r.cancel === 'cancelled' && r.midCancel === 'cancelled', 'a cancel before the start and one in the middle both stop the build', JSON.stringify(r))
  is(r.empty === 'empty', 'an empty shop is refused (no cover-only file)')
  is(r.font, 'the shop’s own fonts (Alexandria, IBM Plex Arabic from /fonts) are loaded for the drawing')
  is(eq(r.link, ['https://www.sporta.com.kw/catalogue?pdf=ar', 'https://www.sporta.com.kw/catalogue?pdf=en', 'https://www.sporta.com.kw/catalogue?pdf=en']), 'the live link is /catalogue?pdf=ar or en (anything else is English)')
  const dl = S.page.waitForEvent('download')
  await S.page.evaluate(async () => { const res = await window.SportaCatalogue.buildPdf({ lang: 'ar' }); window.__name = res.name; window.SportaCatalogue.download(res) })
  const d = await dl, name = await S.page.evaluate(() => window.__name)
  is(d.suggestedFilename() === name && /^Sporta-Catalogue-AR-/.test(name), 'download() hands the browser a file with the same name', d.suggestedFilename())
  const f2 = join(tmp, 'dl.pdf'); await d.saveAs(f2); is(info(f2).Pages === '7', 'the downloaded file is the PDF')
  const files = S.shop.st.reqs.filter((q) => q.startsWith('GET /images/products/') && !q.includes('variants'))
  is(S.shop.st.posts.length === 0 && S.shop.st.reqs.every((q) => q.startsWith('GET /')), 'nothing but GET requests, all to the shop itself')
  is(S.errs.length === 0, 'no page errors', S.errs.join(' | '))
  is(files.length > 0 && files.length < 19 * 4 * 3, 'photos are fetched on demand (not more than the candidates)', String(files.length))
}
{
  const t = await open({ photos: () => null })
  const b = await buildPdf(t.page, 'en'); const f = join(tmp, 'nophotos.pdf'); writeFileSync(f, b.buf)
  is(info(f).Pages === '7' && render(f, 1, 7).status === 0, 'with every photo missing the file is still made, all plates "photo coming soon"')
  await t.close()
}
{
  const d = makeData(); const more = []
  for (let i = 0; i < 100; i++) more.push({ ...d.products[i % 11], slug: 'bulk-' + i, name_en: 'Bulk ' + i })
  d.products.push(...more)
  const t = await open({ data: d, photos: () => null })
  const t0 = Date.now(), b = await buildPdf(t.page, 'ar'); const f = join(tmp, 'bulk.pdf'); writeFileSync(f, b.buf)
  is(info(f).Pages === String(b.pages) && b.pages === 7 + 11 && xrefOk(b.buf), '119 products give a long, well-formed file (7 + 11 pages)', `${b.pages} pages, ${Date.now() - t0} ms`)
  await t.close()
}

head('mutations: the engine with one rule cut must fail its check')
const src = engineSource()
const cut = (label, re, to, key) => ({ label, key, text: src.replace(re, to) })
const MUTANTS = [
  cut('no link annotations', '/Annots [', '/AnnotX [', 'links-en'),
  cut('grid not mirrored in Arabic', 'if (ar) col = lo.cols - 1 - col', 'if (false) col = lo.cols - 1 - col', 'rtl-ar'),
  cut('no sale badge', 'if (o.prices && p.sale && p.pct > 0) {\n      g.direction', 'if (false) {\n      g.direction', 'badge-en'),
  cut('no sold-out band', 'if (p.soldOut) {\n      g.fillStyle', 'if (false) {\n      g.fillStyle', 'sold-en'),
  cut('JPEG filter changed', '/Filter /DCTDecode', '/Filter /FlateDecode', 'render-en'),
  cut('size order dropped', 'return sizeRank(a.size) - sizeRank(b.size)', 'return 0', 'sizesOrder'),
  cut('own brand shown', 'b && !ownBrand && (b.name_en', 'b && (b.name_en', 'ownBrand'),
  cut('photo never drawn', 'if (bm) { g.save()', 'if (false) { g.save()', 'photos-en'),
]
for (const m of MUTANTS) {
  const changed = m.text !== src
  if (!changed) { is(false, `mutation "${m.label}": the cut text was found in the engine`); continue }
  let R; try { R = await analyse(m.text, 'mut', false) } catch (e) { R = { [m.key]: false, crashed: String(e.message).slice(0, 60) } }
  is(R[m.key] === false, `mutation "${m.label}": check ${m.key} goes red`, R.crashed || '')
}

await S.close(); await browser.close(); rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
