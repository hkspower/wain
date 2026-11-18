// Shared fixture for the CATALOGUE-1118 suites (catalogue-pdf-test, catalogue-page-test, admin-catalogue-pdf-test):
//   makeData()            a small, hermetic shop in the shape api.php?r=products / r=stock / r=brands answer (sale, sold out, brands, long
//                         Arabic and English names, one-size and numeric sizes, an unknown category, a product with no stock rows)
//   genImages(page)       one JPEG, one PNG and one WebP (base64) drawn in the browser, so the suites need no image encoder
//   serveShop(opts)       a tiny same-origin server: "/" (a blank page that loads /sporta-catalogue.js), /sporta-catalogue.js (the real file or a
//                         mutated copy), /api/api.php (the data above, faults on request), /fonts and the logos from public/, product photos from
//                         `photos(slug, ext)`; it records every request so a suite can assert what the engine read and that it wrote nothing
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PUB = join(ROOT, 'public')
export const ENGINE_FILE = join(PUB, 'sporta-catalogue.js')
export const engineSource = () => readFileSync(ENGINE_FILE, 'utf8')

const P = (slug, en, ar, cat, price, o = {}) => ({
  slug, name_en: en, name_ar: ar, desc_en: en + '.', desc_ar: ar + '.', price, featured: false, featured_sort: 0, category: cat, image: null, no_exchange: false,
  brand_slug: null, images: null, brand_name_en: null, brand_name_ar: null, brand_has_logo: 0, brand_logo_v: 'e3b0c44298fc', list_price: price, on_sale: false, ...o,
})
export function makeData() {
  const products = []
  // men: 11 products -> two pages of nine and two; the first two are featured so the order is testable
  products.push(P('men-zeta-top', 'Zeta Top', 'توب زيتا', 'men', 9, { featured: true, featured_sort: 2 }))
  products.push(P('men-alpha-top', 'Alpha Top', 'توب ألفا', 'men', 12, { featured: true, featured_sort: 1 }))
  products.push(P('men-sale-shorts', 'Sale Shorts', 'شورت التخفيض', 'men', 8, { on_sale: true, list_price: 10 }))
  products.push(P('men-fake-sale', 'Fake Sale Tee', 'تيشيرت', 'men', 10, { on_sale: true, list_price: 10 }))
  products.push(P('men-brand-vest', 'Vanquish Stringer Vest — Long Name That Wraps Over Two Lines In The Card', 'فانكويش ستراينجر فست — اسم طويل جداً يلتف على سطرين في البطاقة', 'men', 8, { brand_slug: 'ahed', brand_name_en: 'AHED', brand_name_ar: 'أحد', brand_has_logo: 1 }))
  products.push(P('men-own-brand', 'Own Brand Tee', 'تيشيرت العلامة', 'men', 7, { brand_slug: 'sporta', brand_name_en: 'Sporta', brand_name_ar: 'سبورتا' }))
  products.push(P('men-sold-out', 'Sold Out Hoodie', 'هودي نفد', 'men', 15))
  products.push(P('men-no-stock-rows', 'Unknown Stock Cap', 'قبعة', 'men', 5))
  products.push(P('men-sizes-mixed', 'Mixed Sizes Pants', 'بنطال', 'men', 11))
  products.push(P('men-uploaded', 'Uploaded Photo Tee', 'تيشيرت مرفوع', 'men', 6, { images: ['uploaded-photo-tee.png', '/images/products/uploaded-photo-tee-2.jpg'], image: 'uploaded-photo-tee.png' }))
  products.push(P('men-last', 'Last Men Item', 'آخر منتج رجالي', 'men', 4))
  products.push(P('women-leggings', 'Cloudsoft Leggings — Grey', 'ليقنز كلاودسوفت — رمادي', 'women', 14, { featured: true, featured_sort: 1 }))
  products.push(P('women-top', 'Sculpt Top — Navy', 'توب سكلبت — كحلي', 'women', 9.5))
  products.push(P('women-jacket', 'Define Jacket', 'جاكيت ديفاين', 'women', 22, { on_sale: true, list_price: 30 }))
  products.push(P('women-bra', 'Support Bra', 'حمالة دعم', 'women', 7.25))
  products.push(P('outer-hoodie', 'Cagliari Hoodie', 'هودي كالياري', 'outerwear', 18))
  products.push(P('acc-cap', 'Denver Cap', 'كاب دنفر', 'accessories', 6))
  products.push(P('acc-backpack', 'Backpack', 'حقيبة ظهر', 'accessories', 4))
  products.push(P('kids-tee', 'Kids Tee', 'تيشيرت أطفال', 'kids', 3))
  const stock = []
  const rows = (slug, sizes, none = []) => sizes.forEach((s) => stock.push({ slug, size: s, sku: 'SKU-' + slug.toUpperCase() + '-' + s, stock: none.includes(s) ? 0 : 7, in_stock: !none.includes(s) }))
  products.forEach((p) => {
    if (p.slug === 'men-no-stock-rows') return
    if (p.slug === 'men-sold-out') return rows(p.slug, ['S', 'M', 'L'], ['S', 'M', 'L'])
    if (p.slug === 'men-sizes-mixed') return rows(p.slug, ['XL', '3XL', 'S', '2XL', 'M', '42', '40'], ['M'])
    if (p.category === 'accessories') return rows(p.slug, ['ONE'])
    if (p.slug === 'women-top') return rows(p.slug, ['XS', 'S', 'M', 'L'], ['XS'])
    rows(p.slug, ['S', 'M', 'L', 'XL'])
  })
  const brands = [
    { slug: 'sporta', name_en: 'Sporta', name_ar: 'سبورتا', has_logo: 0, logo_v: 'e3b0c44298fc' },
    { slug: 'ahed', name_en: 'AHED', name_ar: 'أحد', has_logo: 1, logo_v: 'ba88f63bdd30' },
  ]
  return { products, stock, brands }
}

export async function genImages(page) {
  return page.evaluate(() => {
    const draw = (type, hue) => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 1000; const g = c.getContext('2d')
      const gr = g.createLinearGradient(0, 0, 800, 1000); gr.addColorStop(0, `hsl(${hue},60%,45%)`); gr.addColorStop(1, `hsl(${hue + 40},60%,25%)`)
      g.fillStyle = gr; g.fillRect(0, 0, 800, 1000); g.fillStyle = '#fff'; g.fillRect(300, 400, 200, 200)
      return c.toDataURL(type, 0.9).split(',')[1]
    }
    return { jpg: draw('image/jpeg', 20), png: draw('image/png', 200), webp: draw('image/webp', 120) }
  })
}

const TYPES = { js: 'text/javascript; charset=utf-8', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml', css: 'text/css' }
/** opts: { data, engine, images, photos(slug, ext) -> 'jpg'|'png'|'webp'|null, fault: { products?: status, stock?: status, brands?: status }, html } */
export function serveShop(opts = {}) {
  const st = { reqs: [], posts: [], data: opts.data || makeData(), fault: opts.fault || {}, photos: opts.photos || (() => null), images: opts.images, engine: opts.engine ?? engineSource() }
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'), path = decodeURIComponent(u.pathname)
    st.reqs.push(q.method + ' ' + path + u.search)
    if (q.method !== 'GET') { st.posts.push(q.method + ' ' + path); r.writeHead(405); return r.end('no') }
    const send = (code, type, body) => { r.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); r.end(body) }
    if (path === '/') return send(200, 'text/html; charset=utf-8', opts.html || '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><script src="/sporta-catalogue.js"></script></body></html>')
    if (path === '/sporta-catalogue.js') return send(200, TYPES.js, st.engine)
    if (path === '/api/api.php') {
      const route = u.searchParams.get('r')
      if (st.fault[route]) return send(st.fault[route], 'application/json', '{"error":"x"}')
      const body = route === 'products' ? st.data.products : route === 'stock' ? st.data.stock : route === 'brands' ? st.data.brands : null
      return body == null ? send(404, 'application/json', '{"error":"not_found"}') : send(200, 'application/json', JSON.stringify(body))
    }
    const ph = /^\/images\/products\/([A-Za-z0-9._-]+)\.(jpg|jpeg|png|webp)$/.exec(path)
    if (ph) {
      const want = st.photos(ph[1], ph[2] === 'jpeg' ? 'jpg' : ph[2])
      if (!want || !st.images) return send(404, 'text/plain', 'nf')
      const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[want]
      return send(200, mime, Buffer.from(st.images[want], 'base64'))
    }
    if (path === '/images/products/responsive/variants.txt') return send(404, 'text/plain', 'nf')
    const f = join(PUB, path)
    if (!path.includes('..') && /\.\w+$/.test(path) && existsSync(f)) return send(200, TYPES[path.split('.').pop()] || 'application/octet-stream', readFileSync(f))
    send(404, 'text/plain', 'nf')
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ st, base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((d) => server.close(d)) })))
}
