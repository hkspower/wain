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
    return { b64: btoa(s), name: res.name, pages: res.pages, bytes: res.bytes, count: res.count, type: res.blob.type, calls, runs: res.textRuns, description: res.description }
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
  const siteLinks = A.filter((a) => !/\/product\//.test(a.url) && !/\/catalogue(\?|$)/.test(a.url))   // the cover's QR code links to the page of the view
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

head('the view: address, filters, links (pure functions of the engine)')
{
  const r = await S.page.evaluate(async () => {
    const E = window.SportaCatalogue, o = {}, M = (await E.load()).products
    const full = E.viewOf('?cat=men&brand=ahed&q=hello%20world&sale=1&stock=true&sort=price_asc&min=5&max=20.5')
    o.full = full
    o.bad = E.viewOf('?cat=%3Cscript%3E&brand=A%20B&sale=2&stock=maybe&sort=bogus&min=-5&max=abc&q=%00x%01&lang=en&pdf=ar')
    o.swap = E.viewOf('min=30&max=10'); o.dup = E.viewOf('?cat=men&cat=women').cat; o.broken = E.viewOf('?q=%E0%A4%A&cat=men'); o.plus = E.viewOf('?q=a+b').q
    o.empty = E.viewOf(''); o.long = E.viewOf('?q=' + 'x'.repeat(200)).q.length; o.upper = [E.viewOf('?CAT=men').cat, E.viewOf('?cat=MEN').cat]
    o.pdfAr = E.pdfLink('ar'); o.pdfEn = E.pdfLink('en', full); o.pageAr = E.pageLink('ar'); o.pageEn = E.pageLink('en'); o.pageFull = E.pageLink('en', full)
    const arq = Object.assign(E.blankView(), { q: 'قبعة', cat: 'men' }); o.arLink = E.pdfLink('ar', arq); o.arBack = E.viewOf(o.arLink.split('?')[1])
    o.round = [E.viewOf(o.pdfEn.split('?')[1]), E.viewOf(o.pageFull.split('?')[1])]
    o.qr = E.qr('x')
    const slugs = (v, l) => E.applyView(M, v, l).map((p) => p.slug), V = (x) => Object.assign(E.blankView(), x)
    o.all = E.applyView(M, E.blankView()).map((p) => p.slug).join() === M.map((p) => p.slug).join()
    o.sale = slugs(V({ sale: true })); o.stock = slugs(V({ stock: true })).length; o.men = slugs(V({ cat: 'men' })).length; o.ahed = slugs(V({ brand: 'ahed' }))
    o.range = [slugs(V({ min: 5, max: 9 })).length, M.filter((p) => p.price >= 5 && p.price <= 9).length]
    const asc = E.applyView(M, V({ sort: 'price_asc' })), idx = (p) => M.indexOf(p)
    o.asc = asc.every((p, i) => i === 0 || asc[i - 1].price < p.price || (asc[i - 1].price === p.price && idx(asc[i - 1]) < idx(p)))
    const desc = E.applyView(M, V({ sort: 'price_desc' })); o.desc = desc.every((p, i) => i === 0 || desc[i - 1].price >= p.price)
    const nen = E.applyView(M, V({ sort: 'name' }), 'en').map((p) => p.name.en), nar = E.applyView(M, V({ sort: 'name' }), 'ar').map((p) => p.name.ar)
    o.name = nen.every((x, i) => i === 0 || nen[i - 1].localeCompare(x, 'en') <= 0) && nar.every((x, i) => i === 0 || nar[i - 1].localeCompare(x, 'ar') <= 0)
    const q = (t, l) => slugs(V({ q: t }), l).join()
    o.search = { en: [q('denver'), q('DENVER'), q('dénver'), q(' denver  cap '), q('cap zzz')], ar: [q('قبعة'), q('قُبَّعَة'), q('قبعه'), q('كاب دنفر')], brand: [q('ahed'), q('أحد'), q('احد')], cat: [q('accessories'), q('إكسسوارات'), q('اكسسوارات')] }
    o.digits = [E.fold('٣٠'), E.fold('۱۲'), E.fold('Ünïcode')]
    o.mut = (() => { const before = M.map((p) => p.slug).join(); E.applyView(M, V({ sort: 'price_desc', cat: 'men' })); return M.map((p) => p.slug).join() === before })()
    o.desc2 = [E.describeView(V({ cat: 'men', sale: true }), 'en'), E.describeView(V({ cat: 'men', sale: true }), 'ar'), E.describeView(V({ cat: 'men', sale: true }), 'en', null, null, false), E.describeView(V({ min: 5, max: 9, stock: true, q: 'cap' }), 'en')]
    o.names = [E.fileName('ar', new Date('2026-11-19T12:00:00Z'), V({ cat: 'men', brand: 'ahed', q: 'Hello Wörld', stock: true, min: 5, max: 20.5, sale: true })), E.fileName('en', new Date('2026-11-19T21:30:00Z'), V({ q: 'قبعة' })), E.fileName('en', new Date('2026-11-19T12:00:00Z'))]
    return { o }
  })
  const o = r.o
  is(eq(o.full, { cat: 'men', brand: 'ahed', q: 'hello world', sale: true, stock: true, sort: 'price_asc', min: 5, max: 20.5 }), 'viewOf reads every parameter (cat, brand, q, sale, stock, sort, min, max)', JSON.stringify(o.full))
  is(eq(o.bad, { cat: '', brand: '', q: 'x', sale: false, stock: false, sort: 'featured', min: null, max: null }), 'invalid values are ignored one by one: a tag, a slug with a space, sale=2, sort=bogus, a negative or non-numeric price, control characters', JSON.stringify(o.bad))
  is(eq([o.swap.min, o.swap.max, o.dup, o.broken.q, o.broken.cat, o.plus, o.long, o.upper[0], o.upper[1]], [10, 30, 'men', '', 'men', 'a b', 80, '', 'men']) && eq(o.empty, { cat: '', brand: '', q: '', sale: false, stock: false, sort: 'featured', min: null, max: null }), 'min above max is swapped, the first of a repeated key wins, a broken %-escape is skipped, + is a space, q is cut at 80, the key is case sensitive and the slug lower-cased', JSON.stringify([o.swap, o.dup, o.broken, o.plus, o.long, o.upper]))
  is(o.pdfAr === 'https://www.sporta.com.kw/catalogue?pdf=ar' && o.pdfEn === 'https://www.sporta.com.kw/catalogue?pdf=en&cat=men&brand=ahed&q=hello%20world&sale=1&stock=1&sort=price_asc&min=5&max=20.5', 'pdfLink: absolute https, ?pdf=<lang> then the view’s parameters (defaults left out)', o.pdfEn)
  is(o.pageAr === 'https://www.sporta.com.kw/catalogue' && o.pageEn === 'https://www.sporta.com.kw/catalogue?lang=en' && o.pageFull === 'https://www.sporta.com.kw/catalogue?lang=en&cat=men&brand=ahed&q=hello%20world&sale=1&stock=1&sort=price_asc&min=5&max=20.5', 'pageLink: the bare page in Arabic, ?lang=en in English, then the view', o.pageFull)
  is(eq(o.round[0], o.full) && eq(o.round[1], o.full) && o.arBack.q === 'قبعة' && o.arBack.cat === 'men' && /q=%D9%82/.test(o.arLink), 'a link read back gives the same view (also an Arabic search, percent-encoded)', o.arLink)
  is(o.qr && o.qr.size === 21 && o.qr.rows.length === 21 && /^[01]{21}$/.test(o.qr.rows[0]), 'qr() answers a 21 x 21 code for a short text (the encoder is integrated; the full proof is test:qr)')
  is(o.all && eq(o.sale.slice().sort(), ['men-sale-shorts', 'women-jacket']) && o.stock === 18 && o.men === 11 && eq(o.ahed, ['men-brand-vest']) && eq(o.range, [o.range[1], o.range[1]]) && o.range[0] > 0, 'applyView: an empty view shows everything in order; sale, in stock, category, brand and price range each filter', JSON.stringify([o.sale, o.stock, o.men, o.ahed, o.range]))
  is(o.asc && o.desc && o.name, 'applyView: price ascending (stable), price descending, and name in the page language (Arabic collation for ar)')
  is(o.search.en.slice(0, 4).every((x) => x === 'acc-cap') && o.search.en[4] === '' && o.search.ar.every((x) => /men-no-stock-rows|acc-cap/.test(x)) && o.search.ar[0] === 'men-no-stock-rows' && o.search.ar[1] === 'men-no-stock-rows' && o.search.ar[2] === 'men-no-stock-rows' && o.search.ar[3] === 'acc-cap', 'search: case, accent and spaces (denver / DENVER / dénver), two words must both match, Arabic with diacritics (قُبَّعَة) and ta marbuta as ha (قبعه)', JSON.stringify(o.search))
  is(o.search.brand.every((x) => x === 'men-brand-vest') && eq(o.search.cat[0].split(',').sort(), ['acc-backpack', 'acc-cap']) && o.search.cat[1] === o.search.cat[0] && o.search.cat[2] === o.search.cat[0], 'search also finds a brand (English, Arabic, alef-folded) and a category name (English, Arabic with and without the hamza)', JSON.stringify([o.search.brand, o.search.cat]))
  is(eq(o.digits, ['30', '12', 'unicode']) && o.mut, 'Arabic-Indic and Persian digits fold to ASCII, accents drop, and applyView never changes the list it was given', JSON.stringify(o.digits))
  is(eq(o.desc2, ['Men \u00b7 on sale', 'رجال \u00b7 تخفيضات', 'Men', 'in stock \u00b7 search \u201ccap\u201d \u00b7 KWD 5 to 9']), 'describeView says the view in words in both languages (and leaves the sale out when prices are off)', JSON.stringify(o.desc2))
  is(o.names[0] === 'Sporta-Catalogue-AR-men-ahed-sale-instock-q-hello-world-min5-max20_5-2026-11-19.pdf' && o.names[1] === 'Sporta-Catalogue-EN-q-search-2026-11-20.pdf' && o.names[2] === 'Sporta-Catalogue-EN-2026-11-19.pdf', 'the file name says what it is: language, category, brand, sale, in stock, search, price range, and the Kuwait date (21:30 UTC is already the next day there)', JSON.stringify(o.names))
}

head('PDF options (the products of a view, prices, sold out, per page, cover, copy)')
const CHECKS = {
  async pricesOff(b) {
    const hasPrice = (r) => r.runs.flat().some((t) => /KWD|د\.ك|\d\.\d{3}|\d%/.test(t.text))
    return hasPrice(await b('{}')) && !hasPrice(await b('{prices:false}')) && !hasPrice(await b('{prices:false}', 'ar'))
  },
  async ownerWins(b) { const r = await b('{settings:{show_prices:false}, prices:true}'); return !r.runs.flat().some((t) => /KWD|\d\.\d{3}|\d%/.test(t.text)) },
  async soldOutOff(b) { const a = await b('{soldOut:false}'), c = await b('{settings:{show_sold_out:false}, soldOut:true}'), d = await b('{}'); return a.count === 18 && c.count === 18 && d.count === 19 },
  async per12(b) { return (await b('{settings:{per_page:12}}')).pages === 6 },
  async coverOff(b) { const a = await b('{settings:{cover:false}}'); return a.pages === 6 && !a.runs[0].some((t) => t.text === 'Contents') },
  async view(b) {
    const v = await b("{view:{cat:'men',sale:true,sort:'featured',q:'',brand:'',stock:false,min:null,max:null}}"), a = await b("{lang:'ar', view:{cat:'men',sale:true,sort:'featured',q:'',brand:'',stock:false,min:null,max:null}}")
    return v.count === 1 && /^Sporta-Catalogue-EN-men-sale-\d{4}-\d{2}-\d{2}\.pdf$/.test(v.name) && v.runs[0].some((t) => t.text === 'Men · on sale') && v.pages === 2 && a.description === 'رجال · تخفيضات'
  },
  async copy(b) {
    const cp = await b("{settings:{title_en:'Spring Edit',intro_en:'Picked for you',note_en:'Footnote here'}}"), plain = await b('{}')
    return cp.runs[0].some((t) => t.text === 'Spring Edit') && cp.runs[0].some((t) => t.text.includes('Picked for you')) && cp.runs[1].some((t) => t.text === 'Footnote here') && cp.runs[2].some((t) => t.text === 'Footnote here') && !plain.runs[1].some((t) => t.text === 'Footnote here')
  },
}
const optProbe = async (engine, only) => {
  const t = await open({ engine }); const R = {}
  try {
    const b = (ex, lang = 'en') => t.page.evaluate(async ([l, e]) => { const r = await window.SportaCatalogue.buildPdf({ lang: l, ...eval('(' + e + ')') }); return { pages: r.pages, count: r.count, name: r.name, runs: r.textRuns, description: r.description } }, [lang, ex])
    for (const k of Object.keys(CHECKS)) if (!only || only === k) R[k] = await CHECKS[k](b)
  } catch (e) { R.crashed = String(e.message).slice(0, 80) } finally { await t.close() }
  return R
}
const OPT = await optProbe(engineSource())
for (const [k, label] of [['pricesOff', 'prices: false removes every price, discount and percent from every page (the text runs hold none) in both languages, and they are there when it is on'], ['ownerWins', 'the owner’s switch wins: settings.show_prices false stays off even when the caller asks for prices'], ['soldOutOff', 'soldOut: false (or the owner’s show_sold_out off) leaves out the sold-out product (18 of 19)'], ['per12', 'per_page 12: cover + 5 pages for the 19 products (men fit one page)'], ['coverOff', 'cover off: no cover page and no contents (6 pages)'], ['view', 'a view: only its products (1), a file name that says it, "Men · on sale" on the cover (and in Arabic), cover + one page'], ['copy', 'the owner’s title and intro are on the cover, the note is the footer of every content page (and not there when unset)']]) is(OPT[k] === true, label, OPT.crashed || '')
{
  // the same facts in pixels: with prices off the price line of a card is blank, with prices on it is not; the sizes line stays
  const a = await buildPdf(S.page, 'en'), c = await buildPdf(S.page, 'en', '{prices:false}')
  const fa = join(tmp, 'pon.pdf'), fc = join(tmp, 'poff.pdf'); writeFileSync(fa, a.buf); writeFileSync(fc, c.buf)
  const zone = (file, buf, y0, y1) => {
    const pg = render(file, 2, 2).pages[0], card = annots(buf).filter((x) => x.page === 2).find((x) => x.url.includes('/men-alpha-top'))
    let dark = 0; for (let y = Math.round(card.y + y0); y < card.y + y1; y += 1) for (let x = Math.round(card.x + 30); x < card.x + card.w - 30; x += 1) { const p = pg.at(x, y); if (p.r < 140 && p.g < 140 && p.b < 140) dark++ }
    return dark
  }
  const on = zone(fa, a.buf, 322, 352), onSizes = zone(fa, a.buf, 366, 390), offGap = zone(fc, c.buf, 366, 400), offSizes = zone(fc, c.buf, 322, 352)
  is(on > 80 && onSizes > 20 && offGap === 0 && offSizes > 20, 'in pixels: with prices on the price line (' + on + ' dark pixels) and the sizes line below it (' + onSizes + ') are inked; with prices off nothing is left where the sizes were (' + offGap + ') because the sizes line moves up into the price line\u2019s place (' + offSizes + ')')
}
{
  // layout of 6 and 12 a page, read from the link rectangles
  const t = await open({})
  try {
    const geo = async (per) => { const r = await buildPdf(t.page, 'en', `{settings:{per_page:${per}}}`); const A = annots(r.buf).filter((x) => /\/product\//.test(x.url)), by = {}; A.forEach((x) => { (by[x.page] = by[x.page] || []).push(x) }); return { max: Math.max(...Object.values(by).map((v) => v.length)), w: Math.round(A[0].w), h: Math.round(A[0].h), cols: new Set(A.filter((x) => x.page === 2).map((x) => Math.round(x.x))).size, inside: A.every((x) => x.y + x.h <= 1618 + 1 && x.x >= 63 && x.x + x.w <= 1177 + 1), pages: r.pages } }
    const g6 = await geo(6), g9 = await geo(9), g12 = await geo(12)
    is(g6.max === 6 && g6.cols === 3 && g6.h > 650 && g9.max === 9 && g9.cols === 3 && g9.h < 480 && g12.max === 11 && g12.cols === 4 && g12.w < 280 && g6.inside && g9.inside && g12.inside, 'per_page 6 / 9 / 12 are 3x2, 3x3 and 4x3 cards (tall, medium, narrow; men\u2019s 11 fit one 12-page), a page never holds more than its number, all inside the grid area', JSON.stringify([g6, g9, g12]))
  } finally { await t.close() }
}
{
  // products given by the caller are used as they are (the caller applied the view); no more than the page's own call
  const r = await S.page.evaluate(async () => { const M = (await window.SportaCatalogue.load()).products; const x = await window.SportaCatalogue.buildPdf({ lang: 'en', products: M.slice(0, 3) }); return { pages: x.pages, count: x.count } })
  is(r.count === 3 && r.pages === 2, 'products passed in are used as given (3 products: cover + 1 page)', JSON.stringify(r))
  // the text layer seam: what is drawn is recorded per page with its place
  const b = await buildPdf(S.page, 'en'), a = await buildPdf(S.page, 'ar')
  const runs = b.runs[1], A = annots(b.buf).filter((x) => x.page === 2)
  const alpha = runs.find((t) => t.text === 'Alpha Top'), card = A.find((x) => x.url.includes('/men-alpha-top'))
  is(runs.length > 20 && runs.every((t) => typeof t.text === 'string' && [t.x, t.y, t.w, t.h, t.size].every(Number.isFinite) && (t.dir === 'ltr' || t.dir === 'rtl') && t.x >= -1 && t.x + t.w <= 1241 && t.y <= 1754), 'the text layer seam: every drawn string is recorded as { text, x, y, w, h, size, dir } inside the page', String(runs.length))
  is(alpha && card && alpha.x >= card.x && alpha.x + alpha.w <= card.x + card.w && alpha.y > card.y && alpha.y < card.y + card.h && alpha.dir === 'ltr', 'a product name run lies inside its card’s link rectangle (the text layer can be mapped to the links)', JSON.stringify([alpha, card]))
  const arName = a.runs[1].find((t) => t.text === 'توب ألفا')
  is(arName && arName.dir === 'rtl' && a.runs[0].every((t) => t.dir === 'rtl'), 'in the Arabic file every run is right to left, the names in logical (Unicode) order, not reversed', JSON.stringify(arName))
}
{
  // memory discipline: the photos of a page are fetched together, and the next page’s only after (never all at once)
  const t = await open({ photos: (slug, ext) => (ext === 'jpg' ? 'jpg' : null) })
  try {
    const model = await t.page.evaluate(() => window.SportaCatalogue.load().then((r) => r.products.map((p) => p.slug)))
    t.shop.st.reqs.length = 0
    await buildPdf(t.page, 'en')
    const order = t.shop.st.reqs.filter((q) => /^GET \/images\/products\/[^/]+\.jpg$/.test(q)).map((q) => /products\/([^.]+)\.jpg/.exec(q)[1])
    const cats = ['men', 'women', 'outerwear', 'accessories', 'kids'], by = {}
    const info2 = await t.page.evaluate(() => window.SportaCatalogue.load().then((r) => r.products.map((p) => [p.slug, p.category])))
    cats.forEach((c) => info2.filter((x) => x[1] === c).forEach((x, i) => { by[x[0]] = c + Math.floor(i / 9) }))
    const seq = order.map((sl) => by[sl]), seen = []
    seq.forEach((k) => { if (seen[seen.length - 1] !== k) seen.push(k) })
    is(order.length >= 15 && seen.length === new Set(seen).size, 'photos are fetched a page at a time: the requests come page by page, never back to an earlier page', seen.join(' '))
    void model
  } finally { await t.close() }
}

head('mutations of the options')
const OPTMUT = [
  ['prices off ignored', "if (o.prices) {\n      // price line", "if (true) {\n      // price line", 'pricesOff'],
  ['owner switch loses to the caller', 'st.show_prices && o.prices !== false', 'o.prices !== false', 'ownerWins'],
  ['sold-out filter dropped', 'return withSold || !p.soldOut', 'return true', 'soldOutOff'],
  ['per_page ignored', 'layoutOf(st.per_page)', 'layoutOf(9)', 'per12'],
  ['cover switch ignored', 'if (st.cover) {\n          chain', 'if (true) {\n          chain', 'coverOff'],
  ['the view is not applied to the live products', 'products: applyView(r.products, view, lang)', 'products: r.products', 'view'],
  ['the owner’s note is not drawn', "note: clean(st['note_' + lang]) }", "note: '' }", 'copy'],
]
{
  const src0 = engineSource()
  for (const [label, from, to, key] of OPTMUT) {
    if (!src0.includes(from)) { is(false, `mutation "${label}": the cut text was found in the engine`); continue }
    const R = await optProbe(src0.replace(from, to), key)
    is(R[key] === false, `mutation "${label}": check ${key} goes red`, R.crashed || '')
  }
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
