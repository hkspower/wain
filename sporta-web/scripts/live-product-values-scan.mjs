// READ-ONLY scan of every product VALUE the live shop shows the public: names, slugs, prices (list and charged), sale
// maths, categories, brands, photos (files, sizes, small copies), sizes and stock, SKUs, flags. Fetch only (GET and HEAD
// of public URLs, no browser, no sign-in, no form, no POST), so it runs on the VPS in node:24-alpine like the other live
// probes (the sandbox cannot reach the live site). Prints a Markdown report, then SCAN_DONE.
//
//   node scripts/live-product-values-scan.mjs                 (BASE defaults to https://www.sporta.com.kw)
//
// What it can NOT see, because the public API does not carry it: cost, supplier, sale dates, products switched off,
// products hidden for having no name or no price. Those need the signed-in admin (products_all, variants).
const BASE = (process.env.BASE || 'https://www.sporta.com.kw').replace(/\/+$/, '')
const PHOTO_EXT = ['jpg', 'jpeg', 'webp', 'png']
const CANON_SIZES = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', 'ONE SIZE', 'OS'])
const AR = /[؀-ۿ]/g, LAT = /[A-Za-z]/g
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
const money3 = (n) => (Math.round(Number(n) * 1000) / 1000).toFixed(3)
const fils = (n) => Math.round(Number(n) * 1000)

async function getJson(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status)
  const j = await r.json()
  return Array.isArray(j) ? j : (j.products || j.data || j)
}
async function head(path) {
  try {
    const r = await fetch(BASE + path, { method: 'HEAD', signal: AbortSignal.timeout(15000), redirect: 'manual' })
    return { ok: r.status === 200, status: r.status, type: r.headers.get('content-type') || '', bytes: Number(r.headers.get('content-length') || 0) }
  } catch (e) { return { ok: false, status: 0, type: '', bytes: 0, error: String(e && e.message || e) } }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

const products = await getJson('/api/api.php?r=products')
const stock = await getJson('/api/api.php?r=stock')
const brands = await getJson('/api/api.php?r=brands')
if (!Array.isArray(products) || !products.length) { console.log('PRODUCTS: none returned'); console.log('SCAN_DONE bad=1'); process.exit(0) }

// ---- groupings -----------------------------------------------------------------------------------------------------
const bySlug = new Map(); for (const p of products) { const k = String(p.slug); bySlug.set(k, (bySlug.get(k) || 0) + 1) }
const catCount = new Map(); for (const p of products) { const c = String(p.category == null ? '' : p.category); catCount.set(c, (catCount.get(c) || 0) + 1) }
const catLower = new Map(); for (const c of catCount.keys()) { const k = c.toLowerCase().trim(); catLower.set(k, [...(catLower.get(k) || []), c]) }
const catPrices = new Map(); for (const p of products) { const c = String(p.category || ''); const l = Number(p.list_price != null ? p.list_price : p.price); if (l > 0) catPrices.set(c, [...(catPrices.get(c) || []), l]) }
const nameCount = new Map(); for (const p of products) { const k = norm(p.name_en).toLowerCase(); if (k) nameCount.set(k, [...(nameCount.get(k) || []), p.slug]) }
const nameArCount = new Map(); for (const p of products) { const k = norm(p.name_ar); if (k) nameArCount.set(k, [...(nameArCount.get(k) || []), p.slug]) }
const varsBySlug = new Map(); for (const v of Array.isArray(stock) ? stock : []) varsBySlug.set(v.slug, [...(varsBySlug.get(v.slug) || []), v])
const skuCount = new Map(); for (const v of Array.isArray(stock) ? stock : []) { const k = norm(v.sku); if (k) skuCount.set(k, [...(skuCount.get(k) || []), v.slug + ' ' + v.size]) }
const sortCount = new Map(); for (const p of products) if (p.featured) sortCount.set(String(p.featured_sort), [...(sortCount.get(String(p.featured_sort)) || []), p.slug])
const brandBySlug = new Map((Array.isArray(brands) ? brands : []).map((b) => [b.slug, b]))
const exchangeByCat = new Map(); for (const p of products) { const c = String(p.category || ''); const s = exchangeByCat.get(c) || { yes: 0, no: 0 }; if (p.no_exchange) s.no++; else s.yes++; exchangeByCat.set(c, s) }

// ---- photo probes (HEAD only) --------------------------------------------------------------------------------------
const photo = new Map()
await pool(products, 6, async (p) => {
  const slug = String(p.slug)
  let main = null
  for (const ext of PHOTO_EXT) { const h = await head('/images/products/' + slug + '.' + ext); if (h.ok && /^image\//.test(h.type)) { main = { ext, ...h }; break } }
  const views = []
  for (let n = 1; n <= 4; n++) { let hit = null; for (const ext of PHOTO_EXT) { const h = await head('/images/products/' + slug + '-view-' + n + '.' + ext); if (h.ok && /^image\//.test(h.type)) { hit = { n, ext, bytes: h.bytes }; break } } if (hit) views.push(hit); else break }
  const small = await head('/images/products/responsive/' + slug + '-320.webp')
  const fields = []
  for (const f of [p.image, ...String(p.images || '').split(',')]) { const x = norm(f); if (x && x.startsWith('/')) { const h = await head(x); fields.push({ path: x, ok: h.ok && /^image\//.test(h.type) }) } }
  photo.set(slug, { main, views, small: small.ok, fields })
})

// ---- per-product checks --------------------------------------------------------------------------------------------
const rows = [], totals = { list: 0, now: 0, onSale: 0 }
const sev = { err: 0, warn: 0, info: 0 }
const add = (f, level, code, text) => { f.push({ level, code, text }); sev[level]++ }
for (const p of products) {
  const f = [], slug = String(p.slug)
  const en = norm(p.name_en), ar = norm(p.name_ar)
  // slug and names
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) add(f, 'err', 'SLUG-FORMAT', 'slug is not lowercase letters, digits and single hyphens')
  if (slug.length > 60) add(f, 'warn', 'SLUG-LONG', slug.length + ' characters')
  if (bySlug.get(slug) > 1) add(f, 'err', 'SLUG-DUP', 'listed ' + bySlug.get(slug) + ' times')
  if (!en) add(f, 'err', 'NAME-EN-EMPTY', 'no English name'); else {
    if ((en.match(AR) || []).length) add(f, 'warn', 'NAME-EN-HAS-ARABIC', 'Arabic letters in the English name')
    if (p.name_en !== String(p.name_en).trim() || / {2}/.test(String(p.name_en))) add(f, 'warn', 'NAME-EN-SPACING', 'edge or double spaces')
    const letters = en.replace(/[^A-Za-z]/g, ''); if (letters.length > 5 && letters === letters.toUpperCase()) add(f, 'info', 'NAME-EN-ALLCAPS', en)
    if (/^[a-z]/.test(en)) add(f, 'info', 'NAME-EN-LOWER-START', en)
    if (en.length > 80) add(f, 'warn', 'NAME-EN-LONG', en.length + ' characters')
    if (en.length < 4) add(f, 'warn', 'NAME-EN-SHORT', en)
    if (/[<>]|&nbsp;|&amp;|\*\*|##/.test(en)) add(f, 'err', 'NAME-EN-MARKUP', en)
    if (/[.,;:\-]$/.test(en)) add(f, 'info', 'NAME-EN-TRAIL-PUNCT', en)
    if ((nameCount.get(en.toLowerCase()) || []).length > 1) add(f, 'warn', 'NAME-EN-DUP', 'same English name as ' + nameCount.get(en.toLowerCase()).filter((s) => s !== slug).join(', '))
  }
  if (!ar) add(f, 'err', 'NAME-AR-EMPTY', 'no Arabic name'); else {
    if (!(ar.match(AR) || []).length) add(f, 'warn', 'NAME-AR-NO-ARABIC', 'no Arabic letters in the Arabic name: ' + ar)
    if (p.name_ar !== String(p.name_ar).trim() || / {2}/.test(String(p.name_ar))) add(f, 'warn', 'NAME-AR-SPACING', 'edge or double spaces')
    if (/[0-9]/.test(ar) && /[٠-٩]/.test(ar)) add(f, 'warn', 'NAME-AR-MIXED-DIGITS', ar)
    if (/[<>]|&nbsp;|&amp;|\*\*|##/.test(ar)) add(f, 'err', 'NAME-AR-MARKUP', ar)
    if (ar.length > 80) add(f, 'warn', 'NAME-AR-LONG', ar.length + ' characters')
    if ((nameArCount.get(ar) || []).length > 1) add(f, 'warn', 'NAME-AR-DUP', 'same Arabic name as ' + nameArCount.get(ar).filter((s) => s !== slug).join(', '))
    const latin = (ar.match(LAT) || []).length, arab = (ar.match(AR) || []).length
    if (latin > arab) add(f, 'info', 'NAME-AR-MOSTLY-LATIN', ar)
  }
  // money
  const charged = Number(p.price), list = p.list_price == null ? NaN : Number(p.list_price)
  if (!Number.isFinite(charged)) add(f, 'err', 'PRICE-NOT-NUMBER', String(p.price))
  else {
    if (!(charged > 0)) add(f, 'err', 'PRICE-ZERO', money3(charged))
    if (Math.abs(charged * 1000 - Math.round(charged * 1000)) > 1e-6) add(f, 'err', 'PRICE-DECIMALS', 'more than 3 decimals: ' + charged)
    if (charged > 0 && charged < 2) add(f, 'warn', 'PRICE-VERY-LOW', money3(charged))
    if (charged > 150) add(f, 'warn', 'PRICE-VERY-HIGH', money3(charged))
    if (fils(charged) % 50 !== 0) add(f, 'info', 'PRICE-ODD-STEP', money3(charged) + ' is not a multiple of 0.050')
  }
  if (!Number.isFinite(list)) add(f, 'warn', 'LIST-MISSING', 'list_price missing')
  else {
    totals.list += list; totals.now += charged
    if (p.on_sale) {
      totals.onSale++
      if (!(list > charged)) add(f, 'err', 'SALE-NOT-LOWER', 'on_sale but list ' + money3(list) + ' <= charged ' + money3(charged))
      else {
        const off = (list - charged) / list * 100
        if (off > 60) add(f, 'warn', 'SALE-DEEP', off.toFixed(1) + '% off (' + money3(list) + ' -> ' + money3(charged) + ')')
        if (off < 5) add(f, 'warn', 'SALE-SHALLOW', off.toFixed(1) + '% off: a badge would read 0-4%')
        if (Math.abs(off - Math.round(off)) > 0.45 && Math.abs(off - Math.round(off)) < 0.55) add(f, 'info', 'SALE-PERCENT-HALF', off.toFixed(2) + '% rounds either way in a badge')
      }
    } else if (Math.abs(list - charged) > 0.0005) add(f, 'err', 'LIST-NE-CHARGED', 'not on sale but list ' + money3(list) + ' != charged ' + money3(charged))
  }
  const peers = catPrices.get(String(p.category || '')) || []
  if (peers.length >= 4 && Number.isFinite(list)) { const m = median(peers); if (list > m * 3 || list < m / 3) add(f, 'warn', 'PRICE-OUTLIER', money3(list) + ' vs category median ' + money3(m)) }
  // category, brand, flags
  const cat = String(p.category == null ? '' : p.category)
  if (!cat) add(f, 'warn', 'CATEGORY-EMPTY', 'no category: not found by any category filter or discount rule')
  else {
    if ((catLower.get(cat.toLowerCase().trim()) || []).length > 1) add(f, 'err', 'CATEGORY-SPELLING', 'spellings: ' + catLower.get(cat.toLowerCase().trim()).join(' | '))
    if (cat !== cat.trim()) add(f, 'warn', 'CATEGORY-SPACING', JSON.stringify(cat))
    if (catCount.get(cat) === 1) add(f, 'info', 'CATEGORY-ALONE', 'the only product in "' + cat + '"')
  }
  if (!p.brand_slug) add(f, 'info', 'BRAND-NONE', 'no brand tag (no brand chip on the product page)')
  else if (!brandBySlug.has(p.brand_slug)) add(f, 'warn', 'BRAND-NOT-LISTED', p.brand_slug + ' is not in the public brands list')
  else if (!p.brand_has_logo && !brandBySlug.get(p.brand_slug).has_logo) add(f, 'info', 'BRAND-NO-LOGO', p.brand_slug + ' has no logo (name wordmark)')
  const ex = exchangeByCat.get(cat); if (ex && ex.yes && ex.no) add(f, 'warn', 'NO-EXCHANGE-MIXED', 'category "' + cat + '": ' + ex.no + ' no-exchange, ' + ex.yes + ' exchangeable' + (p.no_exchange ? ' (this one: no exchange)' : ' (this one: exchangeable)'))
  if (p.featured && (sortCount.get(String(p.featured_sort)) || []).length > 1) add(f, 'info', 'FEATURED-SORT-TIE', 'featured_sort ' + p.featured_sort + ' shared with ' + sortCount.get(String(p.featured_sort)).filter((s) => s !== slug).join(', '))
  if (!norm(p.desc_en)) add(f, 'warn', 'DESC-EN-EMPTY', 'no English description'); if (!norm(p.desc_ar)) add(f, 'warn', 'DESC-AR-EMPTY', 'no Arabic description')
  // photos
  const ph = photo.get(slug)
  if (!ph.main && !ph.fields.some((x) => x.ok)) add(f, 'warn', 'PHOTO-NONE', 'no /images/products/' + slug + '.(jpg|jpeg|webp|png) and no image field: the grey "no photo" plate')
  if (ph.main) {
    if (ph.main.bytes > 400000) add(f, 'warn', 'PHOTO-HEAVY', Math.round(ph.main.bytes / 1024) + ' kB (' + ph.main.ext + ')')
    if (ph.main.bytes && ph.main.bytes < 6000) add(f, 'warn', 'PHOTO-TINY', ph.main.bytes + ' bytes')
    if (!ph.small) add(f, 'info', 'PHOTO-NO-SMALL-COPY', 'no responsive/' + slug + '-320.webp: the grid card loads the full photo')
  }
  for (const x of ph.fields) if (!x.ok) add(f, 'err', 'PHOTO-FIELD-BROKEN', x.path + ' does not answer 200 as an image')
  // sizes and stock
  const vs = varsBySlug.get(slug) || []
  if (!vs.length) add(f, 'warn', 'NO-VARIANTS', 'no size rows: the shop cannot offer a size')
  else {
    const sizes = vs.map((v) => String(v.size)); const seen = new Set()
    for (const s of sizes) { if (seen.has(s)) add(f, 'err', 'SIZE-DUP', s); seen.add(s) }
    if (vs.every((v) => !(v.stock > 0))) add(f, 'info', 'ALL-SOLD-OUT', vs.length + ' sizes, all 0')
    for (const v of vs) {
      if (!Number.isInteger(v.stock) || v.stock < 0) add(f, 'err', 'STOCK-INVALID', v.size + ': ' + v.stock)
      else if (v.stock > 200) add(f, 'info', 'STOCK-HIGH', v.size + ': ' + v.stock)
      if (!norm(v.sku)) add(f, 'warn', 'SKU-EMPTY', 'size ' + v.size)
      else if ((skuCount.get(norm(v.sku)) || []).length > 1) add(f, 'err', 'SKU-DUP', v.sku + ' also on ' + skuCount.get(norm(v.sku)).filter((x) => x !== slug + ' ' + v.size).join(', '))
      const up = String(v.size).toUpperCase().trim()
      if (!CANON_SIZES.has(up) && !/^\d{1,3}(\.5)?$/.test(up) && !/^\d{1,2}\s?-\s?\d{1,2}\s?(Y|YRS?|YEARS?)?$/.test(up)) add(f, 'warn', 'SIZE-ODD', JSON.stringify(v.size))
    }
    const letters = sizes.some((s) => /^[A-Za-z]/.test(s)), nums = sizes.some((s) => /^\d/.test(s))
    if (letters && nums) add(f, 'warn', 'SIZES-MIXED', 'letters and numbers on one product: ' + sizes.join(', '))
  }
  rows.push({ p, f, vs, ph })
}

// ---- report --------------------------------------------------------------------------------------------------------
const orphan = [...varsBySlug.keys()].filter((s) => !bySlug.has(s))
const L = []
L.push('# Live product values scan: ' + BASE, '')
L.push('Products listed: **' + products.length + '**; size rows: **' + (Array.isArray(stock) ? stock.length : 0) + '**; public brands: **' + (Array.isArray(brands) ? brands.length : 0) + '**. Read-only (GET/HEAD of public URLs).', '')
L.push('Findings: **' + sev.err + ' error**, **' + sev.warn + ' warning**, **' + sev.info + ' note**.', '')
L.push('## Totals', '', '| | KWD |', '|---|---:|', '| Sum of original (list) prices | ' + money3(totals.list) + ' |', '| Sum of prices charged now | ' + money3(totals.now) + ' |', '| Difference (sales) | ' + money3(totals.list - totals.now) + ' |', '| Products on sale | ' + totals.onSale + ' of ' + products.length + ' |', '')
L.push('## By category', '', '| category | products | on sale | min list | median list | max list | sum list |', '|---|---:|---:|---:|---:|---:|---:|')
for (const [c, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
  const ps = products.filter((p) => String(p.category == null ? '' : p.category) === c), pr = ps.map((p) => Number(p.list_price != null ? p.list_price : p.price)).filter((x) => x > 0)
  L.push('| ' + (c || '(none)') + ' | ' + n + ' | ' + ps.filter((p) => p.on_sale).length + ' | ' + money3(Math.min(...pr)) + ' | ' + money3(median(pr)) + ' | ' + money3(Math.max(...pr)) + ' | ' + money3(pr.reduce((a, b) => a + b, 0)) + ' |')
}
L.push('')
const codes = new Map(); for (const r of rows) for (const x of r.f) codes.set(x.level + ' ' + x.code, (codes.get(x.level + ' ' + x.code) || 0) + 1)
L.push('## Findings by kind', '', '| level | code | products |', '|---|---|---:|')
for (const [k, n] of [...codes.entries()].sort((a, b) => ({ err: 0, warn: 1, info: 2 }[a[0].split(' ')[0]] - { err: 0, warn: 1, info: 2 }[b[0].split(' ')[0]]) || b[1] - a[1])) L.push('| ' + k.split(' ')[0] + ' | ' + k.split(' ')[1] + ' | ' + n + ' |')
L.push('')
if (orphan.length) L.push('Size rows with no listed product: ' + orphan.join(', '), '')
L.push('## Every product (one line each: slug | names | category | list -> charged | photo | sizes:stock | findings; notes are codes only)', '')
for (const { p, f, vs, ph } of rows) {
  const list = Number(p.list_price), ch = Number(p.price), off = p.on_sale && list > ch ? ' (' + ((list - ch) / list * 100).toFixed(0) + '% off)' : ''
  const photoTxt = ph.main ? Math.round(ph.main.bytes / 1024) + 'kB' + (ph.views.length ? '+' + ph.views.length + 'views' : '') + (ph.small ? '' : ' no-320') : (ph.fields.some((x) => x.ok) ? 'field' : 'NO-PHOTO')
  const probs = f.filter((x) => x.level !== 'info').map((x) => x.level.toUpperCase() + ' ' + x.code + ': ' + x.text)
  const notes = f.filter((x) => x.level === 'info').map((x) => x.code)
  L.push('- `' + p.slug + '` | ' + norm(p.name_en) + ' / ' + norm(p.name_ar) + ' | ' + (p.category || '-') + ' | ' + money3(list) + ' -> ' + money3(ch) + off + ' | ' + photoTxt + ' | ' + (vs.map((v) => v.size + ':' + v.stock).join(' ') || 'no sizes') + (probs.length ? ' | ' + probs.join(' ; ') : '') + (notes.length ? ' | notes: ' + notes.join(' ') : ''))
}
console.log(L.join('\n'))
console.log('SCAN_DONE err=' + sev.err + ' warn=' + sev.warn + ' info=' + sev.info)
