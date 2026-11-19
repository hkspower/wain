/* ===== sporta-catalogue.js - CATALOGUE-1118 / CATALOGUE V2 (2026-11-19) =================================================================
 * The live product catalogue: a "Catalogue" page in the shop's main menu and a PDF that is made from the live shop every time
 * someone presses Download (owner request 2026-11-18: "make dynamic catalogue for all current products ... pdf file with
 * downloadable link at backends ... and make page called catalogue at main menu with link updated live"; the owner chose: the page
 * and the PDF are PUBLIC, and the PDF is built IN THE BROWSER; 2026-11-19: "full improve catalogue, full dynamic" = sporta-web/CATALOGUE-V2.md).
 *
 * WHO LOADS THIS FILE. It is not linked by the live index.html (a file not in that list is never loaded by the page itself). Two
 * callers add it on demand, as sporta-admin-brands.js does with its .full.js: the CATALOGUE-1118 block of sporta-features.js, only
 * when the address is /catalogue, and the ADMIN CATALOGUE PDF block of sporta-admin-brands.js, only when the dialog opens. Every
 * other page never downloads it (CSP is script-src 'self': a script a same-origin script adds is allowed).
 *
 * DATA. ONE public route, api.php?r=catalogue (CATALOGUE-V2.md "Data route"): the products the shop lists, the owner's order and
 * settings, categories and brands with counts, a revision and an ETag. An older API answers 404 there; the engine then reads the
 * three routes the page always used (r=products, r=stock, r=brands) and builds the same shape itself, so the page and the PDF work
 * on both (`source` says which: 'catalogue' | 'legacy'). Sizes are available / not available only: the quantity, the SKU and the
 * cost are never read into the page or the PDF. Nothing is written anywhere; the only storage is none. Product photos are the files
 * the shop already serves under /images/products/ (the server names the one that exists; the legacy route tries <slug>.jpg|png|webp|jpeg
 * and the 640px WebP copy that variants.txt lists).
 *
 * ADDRESS = STATE. Every filter of the page is in the address (viewOf / applyView below are the ONE implementation; the page, the PDF and
 * the admin share them), written with history.replaceState (no history entry per keystroke), so every view is a link:
 *   /catalogue?cat=men&brand=vanquish&q=hoodie&sale=1&stock=1&sort=price_asc&min=5&max=20     (+ lang=en, + pdf=ar|en builds that view's PDF)
 * An invalid value is ignored, never an error.
 *
 * LIVE. While the tab is visible the page asks `?r=catalogue` with If-None-Match every 60 s: 304 changes nothing, 200 updates the grid
 * IN PLACE (cards keyed by slug, only the cards that changed are replaced), backs off (x2, to 8 min) when offline or on errors, and a hidden
 * tab sends nothing. On the legacy route there is no ETag: the three reads are made again and a revision is computed from them.
 *
 * THE PDF. Pages are drawn on a canvas with the shop's own fonts (Alexandria for titles, IBM Plex Arabic for text, from /fonts/),
 * so Arabic is shaped by the browser exactly as on the site, in either language, and any photo format the browser can decode is
 * accepted. Each page is encoded as a JPEG and written into a PDF 1.4 file by the writer below (no library): one page = one A4 image
 * plus one clickable link per product (a /URI action to its page on www.sporta.com.kw) and one on the site address. Options: the
 * products of the view, prices on/off, sold-out on/off, the cover on/off, 6 / 9 / 12 products a page, the owner's title, intro and
 * footer note, a file name that says what the file is. Photos are fetched, drawn and released one page at a time.
 * TEXT LAYER. The pictures carry the look; every string drawn is also recorded per page as { text, x, y, w, h, size, dir } in canvas pixels
 * (y = baseline, x = left edge, dir 'ltr' | 'rtl') and written as INVISIBLE text (render mode 3, a glyphless embedded font, a ToUnicode map)
 * over the picture, so a product's name, brand, price and sizes can be searched and copied from the PDF. The page stays pixel-identical.
 * buildPdf({ textLayer: false }) writes the image-only file (the proof of "pixel-identical" renders both). The result says textLayer: true|false.
 *
 * DOM RULES. createElement + textContent only, no innerHTML, no eval, no console. Every network read is a same-origin GET.
 *
 * API (window.SportaCatalogue), version 2:
 *   load({force})                  -> Promise<{ products, categories, brands, settings, revision, at, source }>
 *   buildPdf({ products, lang, prices, soldOut, view, settings, categories, brands, onProgress, signal })
 *                                  -> Promise<{ blob, name, pages, bytes, count, description, textRuns }>
 *                                  `products` are used as given (the caller applies the view); omitted = load() and applyView(view).
 *   download(result)               save the blob as a file (a[download]; opens it in a tab where the browser cannot save)
 *   pdfLink(lang, view)            https://www.sporta.com.kw/catalogue?pdf=ar|en&<view>   builds and downloads that view's PDF
 *   pageLink(lang, view)           https://www.sporta.com.kw/catalogue[?lang=en][&<view>]
 *   viewOf(search)                 the view object { cat, brand, q, sale, stock, sort, min, max } from a query string
 *   applyView(products, view, lang)  the products that view shows, in its order (pure)
 *   qr(text, ecc)                  { size, rows } | null (null when the text does not fit; ecc 'M' by default, Q / H are tried down to M)
 *   mountPage(host)                draw the /catalogue page into host; returns { destroy }
 * ============================================================================================================================ */
;(function () {
  'use strict'
  try {
  if (window.SportaCatalogue) return

  var ORIGIN = 'https://www.sporta.com.kw'
  var API = '/api/api.php?r='
  var IMG = '/images/products/'
  var ORDER = ['men', 'women', 'outerwear', 'accessories']
  var CATS = {
    men: { en: 'Men', ar: 'رجال' }, women: { en: 'Women', ar: 'نساء' },
    outerwear: { en: 'Hoodies & Jackets', ar: 'هوديز وجواكيت' }, accessories: { en: 'Accessories', ar: 'إكسسوارات' }
  }
  var SORTS = ['featured', 'price_asc', 'price_desc', 'name']
  var SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
  var POLL_MS = 60000, POLL_MAX = 480000
  /**
   * TEST HOOK (documented, scripts/catalogue-e2e-test.mjs): a page may set window.__sportaCataloguePollMs (a number of milliseconds, 500 to 60000)
   * before the engine loads or at any time; the poll then runs that often instead of every 60 s. It can only make the page ask SOONER and never
   * below 500 ms, so it cannot turn the poll into a flood; the back-off after errors still doubles it. Nothing in the shop sets it.
   */
  function pollMs() { try { var v = window.__sportaCataloguePollMs; if (typeof v === 'number' && v >= 500 && v <= POLL_MS) return v } catch (e) { /* the default */ } return POLL_MS }

  // ----------------------------------------------------------------------------------------------------------- strings
  var STR = {
    en: {
      eyebrow: 'SPORTA / THE CATALOGUE', h1: 'Sporta product catalogue',
      lead: 'Every current Sporta product with today\u2019s price and the sizes in stock. Download it as a PDF: it is made from the live shop each time, so it is always up to date.',
      leadNoPrice: 'Every current Sporta product with the sizes in stock. Download it as a PDF: it is made from the live shop each time, so it is always up to date.',
      products: 'Products: {n}', updated: 'Updated {t}', now: 'just now', ago: '{m} min ago',
      dl: 'Download PDF (English)', dlOther: 'Download PDF (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)',
      dlView: 'PDF of this view (English)', dlViewOther: 'PDF of this view (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)', dlAll: 'Download everything (PDF)',
      copy: 'Copy live PDF link', copyPage: 'Copy page link', wa: 'Share on WhatsApp', print: 'Print', copyLink: 'Copy product link',
      copied: 'Link copied', copyFail: 'Copy failed: select the address and copy it.',
      linkHint: 'Anyone who opens this link gets a PDF made from the live shop.',
      starting: 'Preparing the PDF\u2026', photos: 'Preparing page {i} of {n}\u2026', done: 'Your PDF is ready: {name} ({size}).', again: 'Download again', cancel: 'Cancel', failed: 'The PDF could not be made. Try again.',
      noView: 'There is nothing in this view to put in a PDF.',
      all: 'All', search: 'Search the catalogue', none: 'No product matches.', emptyShop: 'The catalogue is empty for the moment.', loading: 'Reading the live catalogue\u2026', loadFailed: 'The catalogue could not be loaded.', retry: 'Try again',
      cats: 'Categories', brands: 'Brands', onSale: 'On sale', inStock: 'In stock only', min: 'Min price', max: 'Max price', sort: 'Sort', clear: 'Clear filters',
      sortFeatured: 'Featured', sortPriceAsc: 'Price: low to high', sortPriceDesc: 'Price: high to low', sortName: 'Name',
      shownOf: 'Showing {n} of {t} products', total: '{t} products', totalOne: '1 product', liveUpdated: 'The catalogue was updated.', offline: 'You are offline. The list shows the last update.',
      soldOut: 'Sold out', sizes: 'Sizes', oneSize: 'One size', sizeOut: 'sold out', was: 'Was', off: '{n}% off', noPhoto: 'Photo coming soon',
      scanLive: 'Scan to open the live catalogue', coverTitle: 'Product catalogue', coverUpdated: 'Updated {d}', contents: 'Contents', page: 'Page', count: '{n} products', countOne: '1 product',
      note: 'Prices in Kuwaiti dinar (KWD). Prices and sizes are always live on www.sporta.com.kw.', noteNoPrice: 'Sizes and availability are always live on www.sporta.com.kw.',
      vAll: 'All products', vSale: 'on sale', vStock: 'in stock', vQ: 'search \u201c{q}\u201d', vMin: 'from KWD {n}', vMax: 'up to KWD {n}', vRange: 'KWD {a} to {b}'
    },
    ar: {
      eyebrow: 'سبورتا / الكتالوج', h1: 'كتالوج منتجات سبورتا',
      lead: 'جميع منتجات سبورتا الحالية بأسعار اليوم والمقاسات المتوفرة. حمّله بصيغة PDF: يُنشأ من المتجر مباشرةً في كل مرة، فهو محدَّث دائماً.',
      leadNoPrice: 'جميع منتجات سبورتا الحالية والمقاسات المتوفرة. حمّله بصيغة PDF: يُنشأ من المتجر مباشرةً في كل مرة، فهو محدَّث دائماً.',
      products: 'عدد المنتجات: {n}', updated: 'آخر تحديث: {t}', now: 'الآن', ago: 'منذ {m} د',
      dl: 'تحميل PDF (العربية)', dlOther: 'تحميل PDF (English)',
      dlView: 'PDF لهذا العرض (العربية)', dlViewOther: 'PDF لهذا العرض (English)', dlAll: 'تحميل الكتالوج كاملاً (PDF)',
      copy: 'نسخ رابط PDF المباشر', copyPage: 'نسخ رابط الصفحة', wa: 'مشاركة عبر واتساب', print: 'طباعة', copyLink: 'نسخ رابط المنتج',
      copied: 'تم نسخ الرابط', copyFail: 'تعذّر النسخ: حدّد العنوان وانسخه.',
      linkHint: 'من يفتح هذا الرابط يحصل على ملف PDF مُنشأ من المتجر مباشرةً.',
      starting: 'جارٍ تجهيز ملف PDF\u2026', photos: 'جارٍ تجهيز الصفحة {i} من {n}\u2026', done: 'ملف PDF جاهز: {name} ({size}).', again: 'تحميل مرة أخرى', cancel: 'إلغاء', failed: 'تعذّر إنشاء ملف PDF. حاول مرة أخرى.',
      noView: 'لا يوجد في هذا العرض ما يُوضع في ملف PDF.',
      all: 'الكل', search: 'ابحث في الكتالوج', none: 'لا يوجد منتج مطابق.', emptyShop: 'الكتالوج فارغ حالياً.', loading: 'جارٍ قراءة الكتالوج المباشر\u2026', loadFailed: 'تعذّر تحميل الكتالوج.', retry: 'إعادة المحاولة',
      cats: 'الأقسام', brands: 'العلامات', onSale: 'تخفيضات', inStock: 'المتوفر فقط', min: 'أقل سعر', max: 'أعلى سعر', sort: 'الترتيب', clear: 'مسح الفلاتر',
      sortFeatured: 'المميّز', sortPriceAsc: 'السعر: من الأقل', sortPriceDesc: 'السعر: من الأعلى', sortName: 'الاسم',
      shownOf: 'عرض {n} من {t} منتج', total: '{t} منتج', liveUpdated: 'تم تحديث الكتالوج.', offline: 'لا يوجد اتصال. القائمة من آخر تحديث.',
      soldOut: 'نفدت الكمية', sizes: 'المقاسات', oneSize: 'مقاس واحد', sizeOut: 'نفد', was: 'كان', off: 'خصم {n}%', noPhoto: 'الصورة قريباً',
      scanLive: 'امسح الرمز لفتح الكتالوج المحدّث', coverTitle: 'كتالوج المنتجات', coverUpdated: 'آخر تحديث: {d}', contents: 'المحتويات', page: 'صفحة', count: '{n} منتج',
      note: 'الأسعار بالدينار الكويتي. الأسعار والمقاسات المحدّثة دائماً على www.sporta.com.kw.', noteNoPrice: 'المقاسات والتوفّر محدّثة دائماً على www.sporta.com.kw.',
      vAll: 'جميع المنتجات', vSale: 'تخفيضات', vStock: 'المتوفر', vQ: 'بحث \u201c{q}\u201d', vMin: 'من {n} د.ك', vMax: 'حتى {n} د.ك', vRange: 'من {a} إلى {b} د.ك'
    }
  }
  function L(lang) { return lang === 'ar' ? 'ar' : 'en' }
  function T(lang, k, v) {
    var s = (STR[L(lang)][k] != null ? STR[L(lang)][k] : STR.en[k]) || ''
    if (v) for (var x in v) if (Object.prototype.hasOwnProperty.call(v, x)) s = s.split('{' + x + '}').join(String(v[x]))
    return s
  }
  function pageLang() { return document.documentElement.getAttribute('lang') === 'ar' ? 'ar' : 'en' }

  // ---------------------------------------------------------------------------------------------------------- helpers
  function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '') }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0 }
  function price(n, lang) { var s = num(n).toFixed(3); return lang === 'ar' ? s + '\u00a0\u062f.\u0643.' : 'KWD\u00a0' + s }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) }
  function dateText(d, lang) {
    try { return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait' }).format(d) } catch (e) { return d.toISOString().slice(0, 10) }
  }
  function stamp(d) {
    try { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kuwait' }).format(d) } catch (e) { return d.toISOString().slice(0, 10) }
  }
  function sizeText(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' kB' }
  var SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']
  function sizeRank(s) {
    var u = String(s).toUpperCase().replace(/^XXL$/, '2XL').replace(/^XXXL$/, '3XL'), i = SIZE_ORDER.indexOf(u)
    if (i >= 0) return i
    var n = parseFloat(u)
    return isFinite(n) ? 100 + n : 1000
  }
  function sizeLabel(s, lang) { return /^(one|os)$/i.test(s) ? T(lang, 'oneSize') : s }
  /** Search folding: case, Latin accents, Arabic diacritics / tatweel / alef, ya and ta-marbuta forms, Arabic-Indic digits. */
  function fold(s) {
    s = String(s == null ? '' : s)
    try { s = s.normalize('NFKD') } catch (e) { /* an old engine keeps the text as it is */ }
    return s.toLowerCase()
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640\u06d6-\u06ed]/g, '')
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627').replace(/\u0649/g, '\u064a').replace(/\u0629/g, '\u0647')
      .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x660) })
      .replace(/[\u06f0-\u06f9]/g, function (c) { return String(c.charCodeAt(0) - 0x6f0) })
      .replace(/\s+/g, ' ').replace(/^ | $/g, '')
  }
  function hash12(s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995, i, c
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 = Math.imul ? Math.imul(h1 ^ c, 16777619) : ((h1 ^ c) * 16777619) | 0; h2 = Math.imul ? Math.imul(h2 ^ c, 2246822519) : ((h2 ^ c) * 31) | 0; h2 ^= h2 >>> 13 }
    return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8).slice(0, 4)
  }

  // ------------------------------------------------------------------------------------------------------ the VIEW (address = state)
  var VIEW_KEYS = ['cat', 'brand', 'q', 'sale', 'stock', 'sort', 'min', 'max']
  function blankView() { return { cat: '', brand: '', q: '', sale: false, stock: false, sort: 'featured', min: null, max: null } }
  function numOf(s) {
    s = String(s == null ? '' : s).replace(/^\s+|\s+$/g, '')
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(s)) return null
    var n = parseFloat(s)
    return n >= 0 && n <= 100000 ? n : null
  }
  function readQuery(search) {
    var out = {}, s = String(search == null ? '' : search).replace(/^[?#]/, '')
    s.split('&').forEach(function (kv) {
      if (!kv) return
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1)
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')) } catch (e) { return }
      if (!own(out, k)) out[k] = v
    })
    return out
  }
  /** The view a query string describes. Anything invalid is left at its default. */
  function viewOf(search) {
    var q = readQuery(search), v = blankView(), c
    c = String(q.cat || '').toLowerCase(); if (SLUG.test(c)) v.cat = c
    c = String(q.brand || '').toLowerCase(); if (SLUG.test(c)) v.brand = c
    v.q = clean(q.q).slice(0, 80)
    v.sale = q.sale === '1' || q.sale === 'true'
    v.stock = q.stock === '1' || q.stock === 'true'
    if (SORTS.indexOf(q.sort) >= 0) v.sort = q.sort
    v.min = numOf(q.min); v.max = numOf(q.max)
    if (v.min != null && v.max != null && v.min > v.max) { var t = v.min; v.min = v.max; v.max = t }
    return v
  }
  function viewPairs(view) {
    var v = view || {}, out = []
    if (v.cat && SLUG.test(v.cat)) out.push(['cat', v.cat])
    if (v.brand && SLUG.test(v.brand)) out.push(['brand', v.brand])
    if (clean(v.q)) out.push(['q', clean(v.q).slice(0, 80)])
    if (v.sale) out.push(['sale', '1'])
    if (v.stock) out.push(['stock', '1'])
    if (v.sort && v.sort !== 'featured' && SORTS.indexOf(v.sort) >= 0) out.push(['sort', v.sort])
    if (v.min != null && isFinite(v.min)) out.push(['min', String(v.min)])
    if (v.max != null && isFinite(v.max)) out.push(['max', String(v.max)])
    return out
  }
  function qs(pairs) { return pairs.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]) }).join('&') }
  /** True when the view changes WHICH products are shown (the order is not a filter). */
  function isFiltered(view) {
    var v = view || {}
    return !!(v.cat || v.brand || clean(v.q) || v.sale || v.stock || v.min != null || v.max != null)
  }
  function isDefaultView(view) { return viewPairs(view).length === 0 }
  function pdfLink(lang, view) { var p = [['pdf', L(lang)]].concat(viewPairs(view)); return ORIGIN + '/catalogue?' + qs(p) }
  function pageLink(lang, view) { var p = (L(lang) === 'en' ? [['lang', 'en']] : []).concat(viewPairs(view)); return ORIGIN + '/catalogue' + (p.length ? '?' + qs(p) : '') }
  function haystack(p) {
    if (p._h) return p._h
    var h = fold([p.name_en, p.name_ar, p.name && p.name.en, p.name && p.name.ar, p.brandName && p.brandName.en, p.brandName && p.brandName.ar,
      p.catName && p.catName.en, p.catName && p.catName.ar, p.slug, p.category].join(' '))
    try { Object.defineProperty(p, '_h', { value: h, enumerable: false }) } catch (e) { /* a frozen product is searched uncached */ }
    return h
  }
  /** The products a view shows, in its order. Pure: the same call serves the page and the PDF. */
  function applyView(products, view, lang) {
    var v = view || {}, l = L(lang), toks = fold(v.q).split(' ').filter(Boolean)
    var out = (products || []).filter(function (p) {
      if (v.cat && p.category !== v.cat) return false
      if (v.brand && p.brand !== v.brand) return false
      if (v.sale && !p.sale) return false
      if (v.stock && p.soldOut) return false
      if (v.min != null && p.price < v.min) return false
      if (v.max != null && p.price > v.max) return false
      if (toks.length) { var h = haystack(p); for (var i = 0; i < toks.length; i++) if (h.indexOf(toks[i]) < 0) return false }
      return true
    })
    var idx = {}; out.forEach(function (p, i) { idx[p.slug] = i })
    var by = null
    if (v.sort === 'price_asc') by = function (a, b) { return a.price - b.price }
    else if (v.sort === 'price_desc') by = function (a, b) { return b.price - a.price }
    else if (v.sort === 'name') by = function (a, b) { var x = a.name[l], y = b.name[l]; try { return x.localeCompare(y, l === 'ar' ? 'ar' : 'en') } catch (e) { return x < y ? -1 : x > y ? 1 : 0 } }
    if (by) out = out.slice().sort(function (a, b) { return by(a, b) || idx[a.slug] - idx[b.slug] })
    return out
  }
  function catName(slug, cats) {
    for (var i = 0; cats && i < cats.length; i++) if (cats[i].slug === slug) return { en: cats[i].name_en || cats[i].slug, ar: cats[i].name_ar || cats[i].name_en || cats[i].slug }
    return CATS[slug] || { en: slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Other', ar: slug || 'أخرى' }
  }
  /** "Men, on sale" - the view in words (cover page, file title). */
  function describeView(view, lang, cats, brands, prices) {
    var v = view || {}, l = L(lang), parts = []
    if (v.cat) parts.push(catName(v.cat, cats)[l])
    if (v.brand) { var b = null; (brands || []).forEach(function (x) { if (x.slug === v.brand) b = x }); parts.push(b ? (l === 'ar' ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar)) : v.brand) }
    if (prices !== false && v.sale) parts.push(T(l, 'vSale'))
    if (v.stock) parts.push(T(l, 'vStock'))
    if (clean(v.q)) parts.push(T(l, 'vQ', { q: clean(v.q) }))
    if (prices !== false) {
      if (v.min != null && v.max != null) parts.push(T(l, 'vRange', { a: v.min, b: v.max }))
      else if (v.min != null) parts.push(T(l, 'vMin', { n: v.min }))
      else if (v.max != null) parts.push(T(l, 'vMax', { n: v.max }))
    }
    return parts.join(' \u00b7 ')
  }
  function tokenSafe(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) }
  function fileName(lang, d, view, prices) {
    var v = view || {}, t = []
    if (tokenSafe(v.cat)) t.push(tokenSafe(v.cat))
    if (tokenSafe(v.brand)) t.push(tokenSafe(v.brand))
    if (prices !== false && v.sale) t.push('sale')
    if (v.stock) t.push('instock')
    if (clean(v.q)) { var a = fold(v.q).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24); t.push('q-' + (a || 'search')) }
    if (prices !== false && v.min != null) t.push('min' + String(v.min).replace('.', '_'))
    if (prices !== false && v.max != null) t.push('max' + String(v.max).replace('.', '_'))
    return 'Sporta-Catalogue-' + (lang === 'ar' ? 'AR' : 'EN') + (t.length ? '-' + t.join('-') : '') + '-' + stamp(d || new Date()) + '.pdf'
  }

  // -------------------------------------------------------------------------------------------------------- the data
  function getJson(route) {
    return fetch(API + route, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status)
      return r.json()
    })
  }
  function etagOf(r, j) {
    var h = r.headers && r.headers.get ? r.headers.get('ETag') : ''
    h = String(h || '').replace(/^W\//, '').replace(/-gzip"?$/, '').replace(/^"|"$/g, '')
    return h || (j && j.revision ? String(j.revision) : '')
  }
  /** One conditional read of the catalogue route: { status: 304 } | { status: 200, json, etag }; rejects with { http } on any other answer. */
  function readCatalogue(etag) {
    var headers = { Accept: 'application/json' }
    if (etag) headers['If-None-Match'] = '"' + etag + '"'
    return fetch(API + 'catalogue', { credentials: 'same-origin', cache: 'no-store', headers: headers }).then(function (r) {
      if (r.status === 304) return { status: 304 }
      if (!r.ok) { var e = new Error('http ' + r.status); e.http = r.status; throw e }
      return r.json().then(function (j) { return { status: 200, json: j, etag: etagOf(r, j) } }, function (er) { er.bad = true; throw er })
    })
  }
  var DEFAULT_SETTINGS = { title_ar: '', title_en: '', intro_ar: '', intro_en: '', note_ar: '', note_en: '', show_prices: true, show_sold_out: true, show_sizes: true, show_brand: true, cover: true, per_page: 9 }
  function sw(v, d) { return v === false || v === 0 || v === '0' || v === 'false' ? false : v === true || v === 1 || v === '1' || v === 'true' ? true : d }
  function settingsOf(raw) {
    var r = raw && typeof raw === 'object' ? raw : {}, s = {}, k
    for (k in DEFAULT_SETTINGS) if (own(DEFAULT_SETTINGS, k)) s[k] = DEFAULT_SETTINGS[k]
    ;['title_ar', 'title_en', 'intro_ar', 'intro_en', 'note_ar', 'note_en'].forEach(function (f) { if (typeof r[f] === 'string') s[f] = clean(r[f]).slice(0, f.indexOf('title') === 0 ? 80 : f.indexOf('intro') === 0 ? 400 : 200) })
    ;['show_prices', 'show_sold_out', 'show_sizes', 'show_brand', 'cover'].forEach(function (f) { s[f] = sw(r[f], true) })
    var pp = parseInt(r.per_page, 10); s.per_page = pp === 6 || pp === 9 || pp === 12 ? pp : 9
    return s
  }
  function photoOk(u) {
    u = String(u == null ? '' : u)
    if (!u) return ''
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(u)) u = IMG + u
    return /^\/images\/[A-Za-z0-9._\/-]+$/.test(u) && u.indexOf('..') < 0 ? u : ''
  }
  /** One product of either source -> the contract's product + the derived fields the page, the PDF and the admin read (name, sale, soldOut ...). */
  function product(p, i, ctx) {
    if (!p || !SLUG.test(String(p.slug || ''))) return null
    var slug = String(p.slug), pr = num(p.price), list = num(p.list_price) || pr
    var on = p.on_sale == null ? list > pr : !!p.on_sale
    var sale = on && list > pr && pr > 0
    var pct = sale ? (typeof p.pct_off === 'number' && p.pct_off > 0 ? Math.round(p.pct_off) : Math.round((1 - pr / list) * 100)) : 0
    var rows = Array.isArray(p.sizes) ? p.sizes : [], seen = {}, sizes = []
    rows.forEach(function (r) {
      var s = r && typeof r === 'object' ? String(r.size == null ? '' : r.size) : String(r == null ? '' : r)
      if (!s) return
      var inn = r && typeof r === 'object' ? !!r.in_stock : true
      if (own(seen, s)) { if (inn) sizes[seen[s]].in_stock = true; return }
      seen[s] = sizes.length; sizes.push({ size: s, in_stock: inn })
    })
    sizes.sort(function (a, b) { return sizeRank(a.size) - sizeRank(b.size) })
    var sizesIn = sizes.filter(function (s) { return s.in_stock }).map(function (s) { return s.size })
    var known = sizes.length > 0
    var soldOut = typeof p.in_stock === 'boolean' ? !p.in_stock : known && sizesIn.length === 0
    var bslug = p.brand != null ? String(p.brand) : p.brand_slug ? String(p.brand_slug) : ''
    var b = bslug ? (ctx.brandBy[bslug] || { slug: bslug, name_en: p.brand_name_en, name_ar: p.brand_name_ar }) : null
    var ownBrand = b && /^(sporta|sporta sports wear)$/i.test(String(b.slug || b.name_en || ''))
    var brandName = b && !ownBrand && (b.name_en || b.name_ar) ? { en: clean(b.name_en || b.name_ar), ar: clean(b.name_ar || b.name_en) } : null
    var cat = String(p.category || '')
    var images = []
    ;(Array.isArray(p.images) ? p.images : []).concat([p.image]).forEach(function (u) { u = photoOk(u); if (u && images.indexOf(u) < 0) images.push(u) })
    var small = photoOk(p.image_small)
    var photos = (small ? [small] : []).concat(images)
    if (ctx.guess) ['jpg', 'png', 'webp', 'jpeg'].forEach(function (x) { var u = photoOk(slug + '.' + x); if (u && photos.indexOf(u) < 0) photos.push(u) })
    var cn = catName(cat, ctx.cats)
    return {
      // the contract's fields
      slug: slug, name_ar: clean(p.name_ar), name_en: clean(p.name_en), category: cat, brand: brandName ? bslug : '', price: pr, list_price: list, pct_off: pct, on_sale: sale,
      featured: !!p.featured, pinned: !!p.pinned, in_stock: !soldOut, sizes: sizes, image: images[0] || '', image_small: small, images: images,
      // what the page, the PDF and the admin dialog read
      i: i, sort: num(p.featured_sort), ci: own(ctx.catIdx, cat) ? ctx.catIdx[cat] : 99,
      name: { en: clean(p.name_en) || clean(p.name_ar) || slug, ar: clean(p.name_ar) || clean(p.name_en) || slug },
      brandName: brandName, catName: cn, list: list, sale: sale, pct: pct, soldOut: soldOut, known: known, sizesIn: sizesIn, photos: photos
    }
  }
  function buildResult(products, cats, brands, settings, revision, source) {
    // a category or brand the lists miss is added from the products, so a chip always exists for what a card says
    var catIdx = {}
    cats.forEach(function (c, i) { catIdx[c.slug] = i })
    products.forEach(function (p) { if (!own(catIdx, p.category)) { var n = catName(p.category, null); catIdx[p.category] = cats.length; cats.push({ slug: p.category, name_ar: n.ar, name_en: n.en, count: 0 }) } })
    cats.forEach(function (c) { c.count = products.filter(function (p) { return p.category === c.slug }).length })
    products.forEach(function (p) { p.ci = catIdx[p.category] })
    brands.forEach(function (b) { b.count = products.filter(function (p) { return p.brand === b.slug }).length })
    brands = brands.filter(function (b) { return b.count > 0 })
    return { products: products, categories: cats.filter(function (c) { return c.count > 0 }), brands: brands, settings: settings, revision: String(revision || ''), at: new Date(), source: source }
  }
  function listOf(a, f) { return (Array.isArray(a) ? a : []).filter(function (x) { return x && SLUG.test(String(x.slug || '')) }).map(f) }
  function fromCatalogue(j, etag) {
    if (!j || !Array.isArray(j.products)) throw new Error('catalogue')
    var cats = listOf(j.categories, function (c) { return { slug: String(c.slug), name_ar: clean(c.name_ar), name_en: clean(c.name_en), count: num(c.count) } })
    var brands = listOf(j.brands, function (b) { return { slug: String(b.slug), name_ar: clean(b.name_ar), name_en: clean(b.name_en), logo: /^\/api\/api\.php\?r=brand_logo&[A-Za-z0-9=&._%-]+$/.test(String(b.logo || '')) ? String(b.logo) : '', count: num(b.count) } })
    var brandBy = {}, catIdx = {}
    brands.forEach(function (b) { brandBy[b.slug] = b })
    cats.forEach(function (c, i) { catIdx[c.slug] = i })
    var ctx = { brandBy: brandBy, catIdx: catIdx, cats: cats, guess: false }
    var products = j.products.map(function (p, i) { return product(p, i, ctx) }).filter(Boolean)
    // the shop's own brand is never a maker chip
    brands = brands.filter(function (b) { return !/^(sporta|sporta sports wear)$/i.test(b.slug) })
    return buildResult(products, cats, brands, settingsOf(j.settings), j.revision || etag || hash12(JSON.stringify(j.products)), 'catalogue')
  }
  var variantsP = null
  /** The small WebP copies the server made, by stem (a 404 is the normal state until the variants job has run). */
  function variants() {
    if (!variantsP) variantsP = fetch(IMG + 'responsive/variants.txt', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : '' }, function () { return '' }).then(function (t) {
      var m = {}
      String(t).split(/\r?\n/).forEach(function (l) { var x = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s+([\d,]+)\s*$/.exec(l); if (x && /\b640\b/.test(x[2])) m[x[1]] = true })
      return m
    })
    return variantsP
  }
  /** products + stock + brands (the three routes of the first catalogue) -> the same shape the catalogue route answers, in print order. */
  function fromLegacy(rows, stock, brandRows, vars) {
    if (!Array.isArray(rows)) throw new Error('products')
    var by = {}, brandBy = {}, brands = []
    if (Array.isArray(stock)) stock.forEach(function (s) {
      if (!s || !s.slug) return
      ;(by[s.slug] || (by[s.slug] = [])).push({ size: String(s.size), in_stock: !!s.in_stock })
    })
    if (Array.isArray(brandRows)) brandRows.forEach(function (b) {
      if (!b || !SLUG.test(String(b.slug || ''))) return
      var o = { slug: String(b.slug), name_ar: clean(b.name_ar), name_en: clean(b.name_en), logo: b.has_logo ? API + 'brand_logo&slug=' + encodeURIComponent(b.slug) + '&v=' + encodeURIComponent(String(b.logo_v || '')) : '', count: 0 }
      brandBy[o.slug] = o
      if (!/^(sporta|sporta sports wear)$/i.test(o.slug)) brands.push(o)
    })
    var mapped = rows.map(function (p) {
      if (!p || !p.slug) return null
      var o = {}, k
      for (k in p) if (own(p, k)) o[k] = p[k]
      o.sizes = by[p.slug] || []
      if (vars && vars[p.slug]) o.image_small = IMG + 'responsive/' + p.slug + '-640.webp'
      delete o.in_stock
      return o
    })
    var cats = [], catIdx = {}
    ORDER.forEach(function (c, i) { catIdx[c] = i; cats.push({ slug: c, name_ar: CATS[c].ar, name_en: CATS[c].en, count: 0 }) })
    var ctx = { brandBy: brandBy, catIdx: catIdx, cats: cats, guess: true }
    var products = mapped.map(function (p, i) { return p ? product(p, i, ctx) : null }).filter(Boolean)
    products.sort(function (a, b) {
      var ca = ORDER.indexOf(a.category), cb = ORDER.indexOf(b.category)
      if (ca < 0) ca = 99; if (cb < 0) cb = 99
      if (ca !== cb) return ca - cb
      if (ca === 99 && a.category !== b.category) return a.category < b.category ? -1 : 1
      if (a.featured !== b.featured) return a.featured ? -1 : 1
      if (a.featured && a.sort !== b.sort) return a.sort - b.sort
      return a.name.en < b.name.en ? -1 : a.name.en > b.name.en ? 1 : a.i - b.i
    })
    var rev = hash12(JSON.stringify(products.map(function (p) { return [p.slug, p.name_en, p.name_ar, p.category, p.brand, p.price, p.list_price, p.sizes, p.image_small, p.images, p.featured] })))
    return buildResult(products, cats, brands, settingsOf(null), rev, 'legacy')
  }
  function loadLegacy() {
    return Promise.all([getJson('products'), getJson('stock').catch(function () { return null }), getJson('brands').catch(function () { return null }), variants()]).then(function (a) {
      return fromLegacy(a[0], a[1], a[2], a[3])
    })
  }
  var inflight = null
  /** The live catalogue: the catalogue route, or (an older API) the three routes it replaces. force = do not share a read already under way. */
  function load(o) {
    if (inflight && !(o && o.force)) return inflight
    // C3 (2026-11-19 review): the three old routes are the answer to an API that has no catalogue route (404) or whose answer is not a catalogue
    // (e.bad). A 429, a 500 or a dropped connection says nothing about the route: falling back then would show products the owner hid, in the wrong
    // order, with the default settings, silently. Those errors reach the caller (the page shows its retry state; the poll backs off).
    var p = readCatalogue('').then(function (r) {
      var x
      try { x = fromCatalogue(r.json, r.etag) } catch (er) { er.bad = true; throw er }
      x.etag = r.etag; return x
    }).then(null, function (e) {
      if (e && (e.http === 404 || e.bad)) {
        // Visible on purpose (review 2026-11-19 minor): the older reads do not apply the owner's settings (hidden or pinned products, the order).
        try { if (window.console && console.warn) console.warn('Sporta catalogue: the catalogue route is not available (' + (e.http || 'bad answer') + '); showing the older product reads, which ignore the owner\'s catalogue settings') } catch (w) { /* no console */ }
        return loadLegacy()
      }
      throw e
    })
    inflight = p
    var done = function () { if (inflight === p) inflight = null }
    p.then(done, done)
    return p
  }
  function groupsOf(products, cats) {
    var by = {}, out = []
    products.forEach(function (p) { var g = by[p.category]; if (!g) { g = by[p.category] = { key: p.category, ci: p.ci == null ? 99 : p.ci, name: catName(p.category, cats), items: [] }; out.push(g) } g.items.push(p) })
    return out
  }
  function productUrl(p, lang) { return ORIGIN + '/product/' + p.slug + (lang === 'en' ? '?lang=en' : '') }

  // ----------------------------------------------------------------------------------------------------------- fonts
  var fontsP = null
  var HEAD = 'Sporta Catalogue Head', BODY = 'Sporta Catalogue Body'
  function ensureFonts() {
    if (fontsP) return fontsP
    var LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF'
    var ARA = 'U+0600-06FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF'
    var specs = [[HEAD, 'alexandria-var-latin', '100 900', LAT], [HEAD, 'alexandria-var-arabic', '100 900', ARA]]
    ;['400', '600', '700'].forEach(function (w) { specs.push([BODY, 'plex-' + w + '-latin', w, LAT]); specs.push([BODY, 'plex-' + w + '-arabic', w, ARA]) })
    if (!window.FontFace || !document.fonts) { fontsP = Promise.resolve(); return fontsP }
    fontsP = Promise.all(specs.map(function (s) {
      var f = new FontFace(s[0], 'url(/fonts/' + s[1] + '.woff2) format("woff2")', { weight: s[2], unicodeRange: s[3], display: 'block' })
      return f.load().then(function (ff) { document.fonts.add(ff) }, function () { /* a missing face falls back to the system sans below */ })
    })).then(function () { return document.fonts.load('700 40px "' + HEAD + '"', 'Aa \u0627\u0628').catch(function () {}) })
    return fontsP
  }
  function fontOf(kind, px) {
    var w = kind === 'head' ? 700 : kind === 'bold' ? 700 : kind === 'semi' ? 600 : 400
    return w + ' ' + px + 'px "' + (kind === 'head' ? HEAD : BODY) + '", "' + HEAD + '", system-ui, sans-serif'
  }

  // --------------------------------------------------------------------------------------------------- the pictures
  var imgCache = {}
  function fetchBlob(url) {
    // Every failure - the request, a status, a type that is not a picture, a body that breaks off half way (r.blob() rejects) - answers null,
    // so the chain moves to the next candidate instead of ending the whole page's build (independent review 2026-11-18).
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return null
      var t = r.headers.get('Content-Type') || ''
      if (t && !/^image\//i.test(t)) return null
      return r.blob()
    }).catch(function () { return null })
  }
  function viaImage(blob, maxW) {
    return new Promise(function (ok) {
      var u = URL.createObjectURL(blob), im = new Image()
      im.onload = function () {
        try {
          var w = Math.min(maxW, im.naturalWidth), h = Math.max(1, Math.round(im.naturalHeight * w / im.naturalWidth))
          var c = document.createElement('canvas'); c.width = w; c.height = h
          c.getContext('2d').drawImage(im, 0, 0, w, h)
          URL.revokeObjectURL(u); ok(c)
        } catch (e) { URL.revokeObjectURL(u); ok(null) }
      }
      im.onerror = function () { URL.revokeObjectURL(u); ok(null) }
      im.src = u
    })
  }
  function toBitmap(blob, maxW) {
    // The shop's CSP has no blob: in img-src, so the <img> route (viaImage) can fail on a page that sends it; createImageBitmap does not need it.
    // The sized call is tried first, then the same call without options (an engine that refuses the options still decodes the picture), and the
    // <img> route is the last resort.
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { resizeWidth: maxW, resizeQuality: 'high' })
        .catch(function () { return createImageBitmap(blob).then(function (bm) { return shrink(bm, maxW) }) })
        .catch(function () { return viaImage(blob, maxW) })
    }
    return viaImage(blob, maxW)
  }
  /** A bitmap wider than maxW is redrawn onto a canvas of maxW (the sized call refused, so the full-size one is cut down here); narrower is kept. */
  function shrink(bm, maxW) {
    if (!bm || bm.width <= maxW) return bm
    var w = maxW, h = Math.max(1, Math.round(bm.height * w / bm.width)), c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d').drawImage(bm, 0, 0, w, h)
    try { bm.close() } catch (e) { /* a bitmap closes once */ }
    return c
  }
  /** The first url of the chain that answers with a picture the browser can decode; null when none does. */
  function firstPicture(urls, maxW) {
    var i = 0
    function next() {
      if (i >= urls.length) return Promise.resolve(null)
      var u = urls[i++]
      return fetchBlob(u).then(function (b) { return b ? toBitmap(b, maxW) : null }).then(function (bm) { return bm || next() })
    }
    return next()
  }
  function logoWhite() {
    if (!imgCache.logo) imgCache.logo = fetchBlob('/logo-white.png').then(function (b) { return b ? toBitmap(b, 600) : null })
    return imgCache.logo
  }
  function release(b) { try { if (b && b.close) b.close() } catch (e) { /* a canvas has no close */ } }

  // ------------------------------------------------------------------------------------------------- page painting
  var PW = 1240, PH = 1754, MG = 64
  var C = { ink: '#171a1e', brand: '#ff7b17', dark: '#b34d00', sand: '#e2dbce', page: '#f6f3ec', white: '#ffffff', mute: '#5b6168', plate: '#efeae0', line: '#ddd5c6', soft: '#b9b2a3' }
  var REC = null   // the text runs of the page being drawn (the text layer seam); null outside a page
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r)
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath()
  }
  function lines(g, text, maxW, maxLines) {
    // UX-6 (2026-11-19 review): a dash that separates the colour from the name ("Backpack \u2014 Navy") stays with the word before it, so a wrapped name
    // never starts a line with a dash (the storefront's NAMES-1119 rule; this drawer had none)
    var words = []
    clean(text).split(' ').forEach(function (w) { if (words.length && /^[\u2014\u2013-]$/.test(w)) words[words.length - 1] += ' ' + w; else words.push(w) })
    var out = [], cur = ''
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i]
      if (g.measureText(t).width <= maxW || !cur) { cur = t; continue }
      out.push(cur); cur = words[i]
    }
    if (cur) out.push(cur)
    if (out.length > maxLines) {
      out = out.slice(0, maxLines)
      var last = out[maxLines - 1]
      while (last.length > 1 && g.measureText(last + '\u2026').width > maxW) last = last.slice(0, -1)
      out[maxLines - 1] = last.replace(/[ ,.\-\u2013\u2014]+$/, '') + '\u2026'
    }
    // a line that is still too wide (one word longer than the card) is cut WITH an ellipsis, like a cut at maxLines (UX-6: it was cut mid-word with none)
    return out.map(function (s) {
      if (g.measureText(s).width <= maxW) return s
      var t = s.replace(/\u2026$/, '')
      while (t.length > 1 && g.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1)
      return t.replace(/[ ,.\-\u2013\u2014]+$/, '') + '\u2026'
    })
  }
  function text(g, s, x, y, font, color, align, maxW) {
    g.font = font; g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic'
    if (maxW) g.fillText(s, x, y, maxW); else g.fillText(s, x, y)
    if (REC && s) {
      var w = g.measureText(s).width, m = /(\d+(?:\.\d+)?)px/.exec(font), size = m ? parseFloat(m[1]) : 0
      if (maxW && w > maxW) w = maxW
      REC.push({ text: String(s), x: align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y: y, w: w, h: size, size: size, dir: g.direction === 'rtl' ? 'rtl' : 'ltr' })
    }
  }
  function contain(g, bm, x, y, w, h, pad) {
    var bw = bm.width, bh = bm.height, s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), dw = bw * s, dh = bh * s
    g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
  /** Grid geometry for 6 / 9 / 12 products a page: 3x2, 3x3, 4x3 cards. */
  var GRID_TOP = 176, GRID_BOTTOM = 1618, GAP = 26
  function layoutOf(per) {
    var cols = per === 12 ? 4 : 3, rows = per / cols
    return { per: per, cols: cols, rows: rows, cw: Math.floor((PW - MG * 2 - GAP * (cols - 1)) / cols), ch: Math.floor((GRID_BOTTOM - GRID_TOP - GAP * (rows - 1)) / rows), k: cols === 4 ? 0.88 : 1 }
  }
  /** o: { prices, sizes, brand } switches, k: font scale of the layout. */
  function drawCard(g, p, bm, x, y, w, h, lang, links, o) {
    var ar = lang === 'ar', cx = x + w / 2, k = o.k || 1
    function F(kind, px) { return fontOf(kind, Math.round(px * k)) }
    g.fillStyle = C.white; rr(g, x, y, w, h, 20); g.fill(); g.lineWidth = 2; g.strokeStyle = C.line; rr(g, x + 1, y + 1, w - 2, h - 2, 20); g.stroke()
    var px = x + 12, py = y + 12, pw = w - 24, ph = h - 208
    g.fillStyle = C.plate; rr(g, px, py, pw, ph, 14); g.fill()
    if (bm) { g.save(); rr(g, px, py, pw, ph, 14); g.clip(); contain(g, bm, px, py, pw, ph, 10); g.restore() }
    // UX-3 (2026-11-19 review): on a sold-out card the dark band covers the middle of the plate, so the placeholder sentence sits above it
    else { g.direction = ar ? 'rtl' : 'ltr'; text(g, T(lang, 'noPhoto'), cx, py + ph / 2 + (p.soldOut ? -40 : 8), F('body', 24), C.mute, 'center', pw - 30) }
    if (p.soldOut) {
      g.fillStyle = 'rgba(255,255,255,.55)'; rr(g, px, py, pw, ph, 14); g.fill()
      g.fillStyle = 'rgba(23,26,30,.88)'; g.fillRect(px, py + ph / 2 - 24, pw, 48)
      g.direction = ar ? 'rtl' : 'ltr'; text(g, T(lang, 'soldOut'), cx, py + ph / 2 + 9, F('bold', 25), C.white, 'center')
    }
    if (o.prices && p.sale && p.pct > 0) {
      g.direction = 'ltr'; g.font = F('bold', 23)
      var bt = '-' + p.pct + '%', bw = g.measureText(bt).width + 28, bx = ar ? px + pw - 12 - bw : px + 12
      g.fillStyle = C.brand; rr(g, bx, py + 12, bw, 40, 20); g.fill(); text(g, bt, bx + bw / 2, py + 40, F('bold', 23), C.ink, 'center')
    }
    g.direction = ar ? 'rtl' : 'ltr'
    var ty = py + ph + 12, maxW = w - 36
    if (o.brand && p.brandName) { g.font = F('semi', 20); var bn = lines(g, (ar ? p.brandName.ar : p.brandName.en), maxW, 1)[0]; text(g, ar ? bn : bn.toUpperCase(), cx, ty + 20, F('semi', 20), C.mute, 'center'); ty += 28 }
    g.font = F('semi', 27)
    var nm = lines(g, ar ? p.name.ar : p.name.en, maxW, 2)
    nm.forEach(function (ln, i) { text(g, ln, cx, ty + 26 + i * 33 * k, F('semi', 27), C.ink, 'center') })
    ty += 26 + (nm.length - 1) * 33 * k + 14
    if (o.prices) {
      // price line: the effective price, then (on sale) the struck list price, centred as one run; a long run is scaled down to the card
      var now = price(p.price, lang), was = p.sale ? price(p.list, lang) : '', s = 1
      g.font = F('bold', 32); var nw0 = g.measureText(now).width, ww0 = 0
      if (was) { g.font = F('body', 24); ww0 = g.measureText(was).width + 14 }
      if (nw0 + ww0 > maxW) s = Math.max(0.6, maxW / (nw0 + ww0))
      var nw = nw0 * s, ww = ww0 * s, total = nw + ww, start = cx - total / 2
      var first = ar ? cx + total / 2 : start
      g.direction = ar ? 'rtl' : 'ltr'
      text(g, now, first, ty + 28, fontOf('bold', Math.round(32 * k * s)), C.ink, ar ? 'right' : 'left')
      if (was) {
        var wx = ar ? first - nw - 14 * s : first + nw + 14 * s
        text(g, was, wx, ty + 26, fontOf('body', Math.round(24 * k * s)), C.mute, ar ? 'right' : 'left')
        g.strokeStyle = C.mute; g.lineWidth = 2; g.beginPath()
        if (ar) { g.moveTo(wx - (ww - 14 * s), ty + 17); g.lineTo(wx, ty + 17) } else { g.moveTo(wx, ty + 17); g.lineTo(wx + (ww - 14 * s), ty + 17) }
        g.stroke()
      }
      ty += 42
    }
    var sz = p.soldOut || !o.sizes ? '' : p.sizesIn.map(function (s2) { return sizeLabel(s2, lang) }).join('\u2009\u00b7\u2009')
    if (sz) { g.font = F('body', 20); var sl = lines(g, sz, maxW, 1)[0]; text(g, sl, cx, ty + 20, F('body', 20), C.mute, 'center') }
    links.push({ x: x, y: y, w: w, h: h, url: productUrl(p, lang) })
  }
  function chrome(g, lang, title, n, total, d, links, logo, note) {
    var ar = lang === 'ar', lw = 0
    g.fillStyle = C.page; g.fillRect(0, 0, PW, PH)
    g.fillStyle = C.ink; g.fillRect(0, 0, PW, 132); g.fillStyle = C.brand; g.fillRect(0, 132, PW, 10)
    // the logo sits on the end side of the band, the title on the start side
    if (logo) { lw = 64 * logo.width / logo.height; g.drawImage(logo, ar ? MG : PW - MG - lw, 34, lw, 64) }
    g.direction = ar ? 'rtl' : 'ltr'
    text(g, title, ar ? PW - MG : MG, 86, fontOf('head', 46), C.white, ar ? 'right' : 'left', PW - MG * 2 - lw - 40)
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(MG, PH - 122); g.lineTo(PW - MG, PH - 122); g.stroke()
    if (note) { g.font = fontOf('body', 22); var nl = lines(g, note, PW - MG * 2, 1)[0]; text(g, nl, PW / 2, PH - 88, fontOf('body', 22), C.mute, 'center') }
    text(g, 'www.sporta.com.kw', ar ? PW - MG : MG, PH - 44, fontOf('semi', 24), C.ink, ar ? 'right' : 'left')
    links.push({ x: ar ? PW - MG - 280 : MG, y: PH - 80, w: 280, h: 44, url: ORIGIN + '/' + (ar ? '' : '?lang=en') })
    text(g, T(lang, 'page') + ' ' + n + ' / ' + total, ar ? MG : PW - MG, PH - 44, fontOf('body', 24), C.mute, ar ? 'left' : 'right')
    text(g, T(lang, 'coverUpdated', { d: dateText(d, lang) }), PW / 2, PH - 44, fontOf('body', 22), C.mute, 'center')
  }
  function drawContent(g, lang, pg, bms, n, total, d, logo, o) {
    var links = [], ar = lang === 'ar', lo = o.layout
    var title = (ar ? pg.cat.name.ar : pg.cat.name.en) + (pg.parts > 1 ? '  \u00b7  ' + pg.part + '/' + pg.parts : '')
    chrome(g, lang, title, n, total, d, links, logo, o.note)
    pg.items.forEach(function (p, i) {
      var row = Math.floor(i / lo.cols), col = i % lo.cols; if (ar) col = lo.cols - 1 - col
      drawCard(g, p, bms[i], MG + col * (lo.cw + GAP), GRID_TOP + row * (lo.ch + GAP), lo.cw, lo.ch, lang, links, o)
    })
    return links
  }
  function drawCover(g, lang, o) {
    var ar = lang === 'ar', links = [], R = ar ? PW - MG : MG, A = ar ? 'right' : 'left', logo = o.logo
    g.fillStyle = C.ink; g.fillRect(0, 0, PW, PH); g.fillStyle = C.brand; g.fillRect(0, 0, PW, 18)
    g.direction = ar ? 'rtl' : 'ltr'
    if (logo) { var lw = 400, lh = lw * logo.height / logo.width; g.drawImage(logo, ar ? PW - MG - lw : MG, 110, lw, lh) }
    g.fillStyle = C.brand; g.fillRect(ar ? PW - MG - 120 : MG, 400, 120, 10)
    g.font = fontOf('head', 88); var tl = lines(g, o.title, PW - MG * 2, 2)
    tl.forEach(function (s, i) { text(g, s, R, 520 + i * 104, fontOf('head', 88), C.white, A) })
    var y = 520 + tl.length * 104 + 10
    if (o.intro) {
      g.font = fontOf('body', 32); var il = lines(g, o.intro, PW - MG * 2, 4)
      il.forEach(function (s, i) { text(g, s, R, y + i * 44, fontOf('body', 32), C.sand, A) })
      y += il.length * 44 + 14
    }
    if (o.desc) { g.font = fontOf('semi', 34); var dl = lines(g, o.desc, PW - MG * 2, 2)[0]; text(g, dl, R, y + 34, fontOf('semi', 34), C.brand, A); y += 62 }
    text(g, T(lang, 'coverUpdated', { d: dateText(o.d, lang) }), R, y + 34, fontOf('body', 32), C.sand, A)
    g.font = fontOf('bold', 32)
    var chip = T(lang, 'products', { n: o.count }), cwid = g.measureText(chip).width + 56, cx = ar ? PW - MG - cwid : MG
    g.fillStyle = C.brand; rr(g, cx, y + 60, cwid, 60, 30); g.fill(); text(g, chip, cx + cwid / 2, y + 102, fontOf('bold', 32), C.ink, 'center')
    var qc = o.qrUrl ? qr(o.qrUrl) : null
    var ty = Math.max(y + 190, 960), room = PH - (qc ? 300 : 230) - (ty + 40), n = o.groups.length
    var rowH = Math.max(46, Math.min(76, Math.floor(room / Math.max(1, n)))), fit = Math.max(1, Math.floor(room / rowH)), shown = o.groups.slice(0, fit)
    text(g, T(lang, 'contents'), R, ty, fontOf('semi', 28), C.soft, A)
    g.strokeStyle = '#2d333b'; g.lineWidth = 2
    shown.forEach(function (gr, i) {
      var ry = ty + 40 + i * rowH, fs = rowH >= 70 ? 36 : rowH >= 56 ? 32 : 28
      g.beginPath(); g.moveTo(MG, ry); g.lineTo(PW - MG, ry); g.stroke()
      text(g, ar ? gr.name.ar : gr.name.en, R, ry + rowH * 0.68, fontOf('semi', fs), C.white, A)
      text(g, (gr.items.length === 1 && lang === 'en' ? T(lang, 'countOne') : T(lang, 'count', { n: gr.items.length })) + '  \u00b7  ' + T(lang, 'page') + ' ' + o.pagesOf[i], ar ? MG : PW - MG, ry + rowH * 0.66, fontOf('body', Math.round(fs * 0.78)), C.sand, ar ? 'left' : 'right')
    })
    text(g, 'www.sporta.com.kw', R, PH - 150, fontOf('head', 46), C.brand, A)
    links.push({ x: ar ? PW - MG - 520 : MG, y: PH - 200, w: 520, h: 70, url: ORIGIN + '/' + (ar ? '' : '?lang=en') })
    var noteW = PW - MG * 2
    if (qc) {
      // the QR of THIS view's page link on a white card in the end-bottom corner (a light ground is what a scanner needs), and a caption under it
      var mod = Math.max(3, Math.floor(180 / (qc.size + 8))), qs = mod * (qc.size + 8), qx = ar ? MG : PW - MG - qs, qy = PH - 150 - qs
      g.fillStyle = C.white; rr(g, qx, qy, qs, qs, 14); g.fill(); g.fillStyle = C.ink
      for (var qr0 = 0; qr0 < qc.size; qr0++) for (var qc0 = 0; qc0 < qc.size; qc0++) if (qc.rows[qr0].charAt(qc0) === '1') g.fillRect(qx + (qc0 + 4) * mod, qy + (qr0 + 4) * mod, mod, mod)
      g.direction = ar ? 'rtl' : 'ltr'
      text(g, T(lang, 'scanLive'), qx + qs / 2, qy + qs + 30, fontOf('body', 22), C.sand, 'center', qs + 40)
      links.push({ x: qx, y: qy, w: qs, h: qs, url: o.qrUrl })
      noteW = PW - MG * 2 - qs - 30
    }
    g.font = fontOf('body', 24); var nl = lines(g, o.note, noteW, 2)
    nl.forEach(function (s, i) { text(g, s, R, PH - 96 + i * 32, fontOf('body', 24), C.soft, A) })
    return links
  }

  // ------------------------------------------------------------------------------------- embedded: QR encoder and PDF text layer
  /* >>> EMBED qr-spike.mjs (verbatim, exports removed; `node scripts/lib/embed-catalogue-spikes.mjs --check`) */
  var qrEncode = null
  try {
    qrEncode = (function () {
      /*
       * qr-spike.mjs - a compact QR Code encoder (ISO/IEC 18004), no dependency, no Node API.
       *
       *   qr(text, { ecc: 'M' }) -> { size, version, ecc, mask, rows } | null
       *
       * rows: array of `size` strings of '0'/'1' ('1' = dark module). The quiet zone is NOT included
       * (draw 4 modules of light around it). null when the text does not fit version 10 at that level.
       * Byte mode only (text is encoded as UTF-8, so ASCII URLs are one byte per character), versions
       * 1-10 (the smallest that fits), levels L M Q H, Reed-Solomon over GF(256) (poly 0x11D), the
       * eight masks with the four-rule penalty choice, format + version information, finder, timing
       * and alignment patterns. Written in ES5 style (var, function, no classes, no TextEncoder), so
       * the same source can be inlined into a browser add-on.
       * Capacity (bytes, byte mode): v10 = L 271, M 213, Q 151, H 119.
       */
      
      // Per version 1..10: raw codewords, alignment centres.
      var RAW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
      var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
      // Block table per level: version -> [ecPerBlock, blocksA, dataA, blocksB, dataB]
      var BLK = {
        L: [0, [7,1,19,0,0], [10,1,34,0,0], [15,1,55,0,0], [20,1,80,0,0], [26,1,108,0,0], [18,2,68,0,0], [20,2,78,0,0], [24,2,97,0,0], [30,2,116,0,0], [18,2,68,2,69]],
        M: [0, [10,1,16,0,0], [16,1,28,0,0], [26,1,44,0,0], [18,2,32,0,0], [24,2,43,0,0], [16,4,27,0,0], [18,4,31,0,0], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44]],
        Q: [0, [13,1,13,0,0], [22,1,22,0,0], [18,2,17,0,0], [26,2,24,0,0], [18,2,15,2,16], [24,4,19,0,0], [18,2,14,4,15], [22,4,18,2,19], [20,4,16,4,17], [24,6,19,2,20]],
        H: [0, [17,1,9,0,0], [28,1,16,0,0], [22,2,13,0,0], [16,4,9,0,0], [22,2,11,2,12], [28,4,15,0,0], [26,4,13,1,14], [26,4,14,2,15], [24,4,12,4,13], [28,6,15,2,16]]
      };
      var FMT = { L: 1, M: 0, Q: 3, H: 2 };
      
      // GF(256) tables.
      var EXP = [], LOG = [];
      (function () {
        var x = 1, i;
        for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
        for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
      })();
      function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
      
      // Remainder of data * x^n divided by the generator (x - a^0)...(x - a^(n-1)).
      function rsEncode(data, n) {
        var gen = [1], i, j;
        for (i = 0; i < n; i++) {
          var next = [];
          for (j = 0; j <= gen.length; j++) next[j] = 0;
          for (j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= gmul(gen[j], EXP[i]); }
          gen = next; // gen[0] is the leading 1
        }
        var rem = [];
        for (i = 0; i < n; i++) rem[i] = 0;
        for (i = 0; i < data.length; i++) {
          var f = data[i] ^ rem[0];
          rem.shift(); rem.push(0);
          if (f) for (j = 0; j < n; j++) rem[j] ^= gmul(gen[j + 1], f);
        }
        return rem;
      }
      
      function utf8(s) {
        var out = [], i, c, d;
        for (i = 0; i < s.length; i++) {
          c = s.charCodeAt(i);
          if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            d = s.charCodeAt(i + 1);
            if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
          }
          if (c < 0x80) out.push(c);
          else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
          else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return out;
      }
      
      function dataCapacity(v, lvl) { var b = BLK[lvl][v]; return b[1] * b[2] + b[3] * b[4]; }
      
      // Interleaved data + error-correction codewords for a version and level.
      function codewords(bytes, v, lvl) {
        var b = BLK[lvl][v], cap = dataCapacity(v, lvl), bits = [], i, j;
        function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >> k) & 1); }
        put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
        for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
        for (i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
        while (bits.length % 8) bits.push(0);
        var data = [];
        for (i = 0; i < bits.length; i += 8) { var w = 0; for (j = 0; j < 8; j++) w = (w << 1) | bits[i + j]; data.push(w); }
        for (i = 0; data.length < cap; i++) data.push(i % 2 ? 0x11 : 0xEC);
        var blocks = [], ecs = [], pos = 0, nb = b[1] + b[3], maxLen = 0;
        for (i = 0; i < nb; i++) {
          var len = i < b[1] ? b[2] : b[4];
          var d = data.slice(pos, pos + len); pos += len;
          blocks.push(d); ecs.push(rsEncode(d, b[0]));
          if (len > maxLen) maxLen = len;
        }
        var out = [];
        for (i = 0; i < maxLen; i++) for (j = 0; j < nb; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
        for (i = 0; i < b[0]; i++) for (j = 0; j < nb; j++) out.push(ecs[j][i]);
        return out;
      }
      
      function formatBits(lvl, mask) {
        var data = (FMT[lvl] << 3) | mask, rem = data, i;
        for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        return ((data << 10) | rem) ^ 0x5412;
      }
      function versionBits(v) {
        var rem = v, i;
        for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
        return (v << 12) | rem;
      }
      
      // Build the matrix. m = module values (0/1), fn = function-pattern flags.
      function build(v, lvl, cw, maskFixed) {
        var size = 17 + 4 * v, m = [], fn = [], x, y, i, j;
        for (y = 0; y < size; y++) { m.push([]); fn.push([]); for (x = 0; x < size; x++) { m[y].push(0); fn[y].push(0); } }
        function set(px, py, dark) { m[py][px] = dark ? 1 : 0; fn[py][px] = 1; }
        function finder(cx, cy) {
          for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
            var px = cx + dx, py = cy + dy;
            if (px < 0 || py < 0 || px >= size || py >= size) continue;
            var d = Math.max(Math.abs(dx), Math.abs(dy));
            set(px, py, d !== 2 && d !== 4);
          }
        }
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        var al = ALIGN[v];
        for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
          if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
          for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
            set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
        // reserve format areas (real bits are drawn per mask below)
        function drawFormat(mask) {
          var bits = formatBits(lvl, mask);
          function bit(k) { return (bits >> k) & 1; }
          for (var k = 0; k <= 5; k++) set(8, k, bit(k));
          set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
          for (k = 9; k < 15; k++) set(14 - k, 8, bit(k));
          for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k));
          for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(k));
          set(8, size - 8, 1);
        }
        drawFormat(0);
        if (v >= 7) {
          var vb = versionBits(v);
          for (i = 0; i < 18; i++) {
            var a = size - 11 + (i % 3), b2 = Math.floor(i / 3), bt = (vb >> i) & 1;
            set(a, b2, bt); set(b2, a, bt);
          }
        }
        // zigzag data placement
        var k2 = 0, up = true;
        for (x = size - 1; x > 0; x -= 2) {
          if (x === 6) x = 5;
          for (var n = 0; n < size; n++) {
            y = up ? size - 1 - n : n;
            for (j = 0; j < 2; j++) {
              var cx = x - j;
              if (!fn[y][cx]) { m[y][cx] = k2 < cw.length * 8 ? (cw[k2 >> 3] >> (7 - (k2 & 7))) & 1 : 0; k2++; }
            }
          }
          up = !up;
        }
        function applyMask(mask) {
          for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
            if (fn[yy][xx]) continue;
            var inv;
            switch (mask) {
              case 0: inv = (xx + yy) % 2 === 0; break;
              case 1: inv = yy % 2 === 0; break;
              case 2: inv = xx % 3 === 0; break;
              case 3: inv = (xx + yy) % 3 === 0; break;
              case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
              case 5: inv = (xx * yy) % 2 + (xx * yy) % 3 === 0; break;
              case 6: inv = ((xx * yy) % 2 + (xx * yy) % 3) % 2 === 0; break;
              default: inv = ((xx + yy) % 2 + (xx * yy) % 3) % 2 === 0;
            }
            if (inv) m[yy][xx] ^= 1;
          }
        }
        var best = -1, bestScore = 1e9, mask;
        for (mask = 0; mask < 8; mask++) {
          if (maskFixed !== undefined && maskFixed !== null && mask !== maskFixed) continue;
          applyMask(mask); drawFormat(mask);
          var s = penalty(m, size);
          if (s < bestScore) { bestScore = s; best = mask; }
          applyMask(mask); // undo
        }
        applyMask(best); drawFormat(best);
        return { m: m, size: size, mask: best };
      }
      
      function penalty(m, size) {
        var p = 0, x, y, i, run, dark = 0;
        function line(get) {
          var res = 0, r = 1, last = get(0), k, hist = [0, 0, 0, 0, 0, 0, 0];
          // N1 runs
          for (k = 1; k < size; k++) {
            var c = get(k);
            if (c === last) { r++; } else { if (r >= 5) res += r - 2; r = 1; last = c; }
          }
          if (r >= 5) res += r - 2;
          // N3 finder-like 1011101 with 4 light on either side (window of 11)
          var s = '';
          for (k = 0; k < size; k++) s += get(k);
          var a = '10111010000', b = '00001011101', at = -1;
          while ((at = s.indexOf(a, at + 1)) >= 0) res += 40;
          at = -1;
          while ((at = s.indexOf(b, at + 1)) >= 0) res += 40;
          return res;
        }
        for (y = 0; y < size; y++) p += line(function (k) { return m[y][k]; });
        for (x = 0; x < size; x++) p += line(function (k) { return m[k][x]; });
        // N2 2x2 blocks
        for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
          var c0 = m[y][x];
          if (c0 === m[y][x + 1] && c0 === m[y + 1][x] && c0 === m[y + 1][x + 1]) p += 3;
        }
        // N4 balance
        for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
        var pct = dark * 100 / (size * size);
        p += Math.floor(Math.abs(pct - 50) / 5) * 10;
        return p;
      }
      
      function qr(text, opts) {
        var lvl = (opts && opts.ecc) || 'M';
        if (!BLK[lvl]) throw new Error('qr: ecc must be L, M, Q or H');
        var bytes = utf8(String(text)), v;
        for (v = 1; v <= 10; v++) {
          var need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
          if (need <= dataCapacity(v, lvl) * 8) break;
        }
        if (v > 10) return null;
        var r = build(v, lvl, codewords(bytes, v, lvl), opts && opts.mask);
        var rows = [], y, x;
        for (y = 0; y < r.size; y++) rows.push(r.m[y].join(''));
        return { size: r.size, version: v, ecc: lvl, mask: r.mask, rows: rows };
      }
      return qr
    })()
  } catch (e) { qrEncode = null }
  /* <<< EMBED qr-spike.mjs */
  /* >>> EMBED pdf-text-layer-spike.mjs (verbatim up to its self-test, exports removed; `node scripts/lib/embed-catalogue-spikes.mjs --check`) */
  var textLayerLib = null
  try {
    textLayerLib = (function () {
      /*
       * D1 SPIKE: an INVISIBLE TEXT LAYER for the hand-written catalogue PDF (public/sporta-catalogue.js, pdfAssemble).
       *
       * The engine writes one JPEG per A4 page plus link annotations, so nothing in the file can be searched or copied.
       * This module is the spike's answer: plain functions (no DOM, no Node API at module level) that a browser engine can
       * copy as they are. ES5 style on purpose (var, function, no classes, no spread) so the engine's classic-script rules hold.
       *
       *   createTextLayer(opts)            -> layer
       *   layer.prepare(pages)             -> registers every character of every page BEFORE the PDF is written
       *   layer.forPage(page, ctx)         -> { resources, content, objects }   (the pdfAssemble.textLayer seam)
       *   glyphlessTrueType()              -> Uint8Array, a valid 2-glyph TrueType font whose glyphs are empty
       *   textOps(items, enc, geo, mode)   -> string, the page's content-stream text operators
       *   fontObjects(codes, first)        -> the six indirect objects of the glyphless Type0 font
       *   toUnicodeCMap(codes)             -> string
       *
       * HOW IT WORKS (the technique OCR tools use, e.g. Tesseract's "glyphless" font):
       *   - Text render mode 3 ("Tr 3") paints nothing, so the page is pixel-identical; viewers still index and select it.
       *   - The font is a Type0 / Identity-H font with a CIDFontType2 descendant. Its embedded TrueType program has only
       *     empty glyphs (a few hundred bytes). Every character the document uses gets a 2-byte CODE (1..N, one per DISTINCT
       *     character in the whole file, not per item), the CIDToGIDMap sends every code to the empty glyph 1, and the
       *     ToUnicode CMap maps each code back to its Unicode text (UTF-16BE, so a character outside the BMP is a surrogate pair).
       *   - Every glyph is 1000 units wide (DW 1000); horizontal scaling (Tz) makes an item's run exactly as wide as the text
       *     the page drew, so the viewer's selection box sits over the drawn words.
       *
       * ORDER (the part with evidence, see the self-test): `mode` is 'logical' | 'visual' | 'words' | 'actualtext'.
       *   logical    - the codes are written in logical (typing) order, left to right in glyph space.
       *   visual     - a right-to-left run is written reversed, as a real PDF producer that shapes text writes it.
       *   words      - one Tj per word, words in logical order, each right-to-left word reversed, boxes laid out right to left.
       *   actualtext - logical codes inside a /Span << /ActualText >> BDC ... EMC marked-content sequence.
       * Which one extractors read back correctly is measured by `node scripts/lib/pdf-text-layer-spike.mjs` (poppler; pdf.js
       * optionally, `PDFJS_DIR=<dir with pdfjs-dist installed>`), and `DEFAULT_MODE` is what that run found.
       */
      
      var DW = 1000
      var FONT_RES = 'SpGl'
      var RTL_RE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/
      // a letter (or its mark) of a right-to-left script: Hebrew, Arabic, Syriac... minus the Arabic-Indic digits and separators (U+0660-0669, 066B-066C, 06F0-06F9)
      var RTL_LETTER = '[\\u0590-\\u05ff\\u0610-\\u065f\\u066e-\\u06ef\\u06fa-\\u08ff\\ufb1d-\\ufdff\\ufe70-\\ufefc]'
      var RTL_LETTERS = new RegExp('^' + RTL_LETTER)
      var TOKEN_RE = new RegExp(RTL_LETTER + '+ ?|(?:(?!' + RTL_LETTER + ')\\S)+ ?| ', 'g')   // a run (letters, or everything else that is not a space) plus the space after it
      var DEFAULT_MODE = 'words'
      
      // ------------------------------------------------------------------------------------------------ small helpers
      function u16(n) { return [(n >> 8) & 255, n & 255] }
      function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] }
      function hex4(n) { return ('0000' + n.toString(16)).slice(-4).toUpperCase() }
      function f2(n) { return (Math.round(n * 100) / 100).toString() }
      function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u }
      /** A JS string (UTF-16 code units, i.e. exactly what a PDF text string wants) as big-endian hex. */
      function utf16hex(s) { var o = ''; for (var i = 0; i < s.length; i++) o += hex4(s.charCodeAt(i)); return o }
      /** The characters of a string as whole code points (a surrogate pair stays one character). ES5: no Array.from. */
      function characters(s) {
        var out = [], i = 0
        s = String(s)
        while (i < s.length) {
          var c = s.charCodeAt(i), n = 1
          if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) n = 2 }
          out.push(s.substr(i, n)); i += n
        }
        return out
      }
      /** Characters that must never reach a content stream as text (controls other than space; zero-width marks stay: they are text). */
      function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '') }
      
      // ------------------------------------------------------------------------------------------------ the glyphless font
      function checksum(bytes) {
        var sum = 0, n = bytes.length + ((4 - (bytes.length % 4)) % 4)
        for (var i = 0; i < n; i += 4) {
          sum = (sum + (((bytes[i] || 0) * 16777216) + ((bytes[i + 1] || 0) << 16) + ((bytes[i + 2] || 0) << 8) + (bytes[i + 3] || 0))) % 4294967296
        }
        return sum
      }
      /**
       * A valid TrueType font with two glyphs (.notdef and glyph 1), both empty: tables head, hhea, maxp, hmtx, loca, glyf (+ post
       * format 3, cmap with no subtables... not needed for Identity-H, so left out). unitsPerEm 1000, every advance 1000.
       * About 230 bytes. Built the same on every call (no clock), so the PDF is reproducible.
       */
      function glyphlessTrueType() {
        var head = [].concat(u32(0x00010000), u32(0x00010000), u32(0), u32(0x5F0F3CF5), u16(0x000B), u16(1000),
          u32(0), u32(0), u32(0), u32(0),            // created, modified (two 64-bit values, zero = 1904-01-01)
          u16(0), u16(0), u16(0), u16(0),            // xMin yMin xMax yMax: no outlines
          u16(0), u16(8), u16(2), u16(0), u16(0))    // macStyle, lowestRecPPEM, fontDirectionHint, indexToLocFormat (short), glyphDataFormat
        var hhea = [].concat(u32(0x00010000), u16(800), u16(65536 - 200), u16(0), u16(DW), u16(0), u16(0), u16(0), u16(1), u16(0), u16(0),
          u16(0), u16(0), u16(0), u16(0), u16(0), u16(1))
        var maxp = [].concat(u32(0x00010000), u16(2), u16(0), u16(0), u16(0), u16(0), u16(1), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0))
        var hmtx = [].concat(u16(DW), u16(0), u16(0), u16(0))             // glyph 0: advance 1000 lsb 0; glyph 1 repeats the advance (lsb 0)
        var loca = [].concat(u16(0), u16(0), u16(0))                      // short format: both glyphs have zero length
        var glyf = [0, 0, 0, 0]                                           // empty (padded) so no reader meets a zero-length table
        var post = [].concat(u32(0x00030000), u32(0), u16(0), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0))
        var tables = [['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', loca], ['maxp', maxp], ['post', post]]
        var n = tables.length, dirLen = 12 + 16 * n, off = dirLen, i, t, dir, body = []
        var pad = function (a) { var b = a.slice(); while (b.length % 4) b.push(0); return b }
        dir = [].concat(u32(0x00010000), u16(n), u16(64), u16(2), u16(n * 16 - 64))   // searchRange = 16 * 2^floor(log2 n) = 64 for n 4..7
        for (i = 0; i < n; i++) {
          t = tables[i]
          var padded = pad(t[1])
          dir = dir.concat([t[0].charCodeAt(0), t[0].charCodeAt(1), t[0].charCodeAt(2), t[0].charCodeAt(3)], u32(checksum(t[1])), u32(off), u32(t[1].length))
          body = body.concat(padded); off += padded.length
        }
        var all = dir.concat(body), bytes = new Uint8Array(all)
        // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font with that field zero); the field is at head offset 8
        var headOff = 0, k
        for (i = 0; i < n; i++) if (tables[i][0] === 'head') { for (k = 0; k < i; k++) headOff += pad(tables[k][1]).length; break }
        var adj = (0xB1B0AFBA - checksum(bytes) + 4294967296) % 4294967296
        var at = dirLen + headOff + 8
        bytes[at] = (adj >>> 24) & 255; bytes[at + 1] = (adj >>> 16) & 255; bytes[at + 2] = (adj >>> 8) & 255; bytes[at + 3] = adj & 255
        return bytes
      }
      
      // ------------------------------------------------------------------------------------------------ the code table
      /**
       * Encoder: one code (1..65535) per DISTINCT character. add(text) registers; code(ch) reads. Order of first use, so the
       * result is deterministic for the same input.
       */
      function createEncoder() {
        var map = {}, list = [null]     // list[code] = character; code 0 is never used
        return {
          add: function (text) {
            var cs = characters(text)
            for (var i = 0; i < cs.length; i++) {
              if (map[cs[i]] === undefined) {
                if (list.length > 65535) throw new Error('text layer: more than 65535 distinct characters')
                map[cs[i]] = list.length; list.push(cs[i])
              }
            }
          },
          code: function (ch) { return map[ch] },
          chars: function () { return list },
          size: function () { return list.length - 1 }
        }
      }
      
      /** The ToUnicode CMap: one bfchar per used code (<= 100 per block, as the CMap spec allows), UTF-16BE targets. */
      function toUnicodeCMap(chars) {
        var s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
          '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
        var i = 1
        while (i < chars.length) {
          var m = Math.min(100, chars.length - i)
          s += m + ' beginbfchar\n'
          for (var j = 0; j < m; j++) s += '<' + hex4(i + j) + '> <' + utf16hex(chars[i + j]) + '>\n'
          s += 'endbfchar\n'; i += m
        }
        return s + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
      }
      
      /**
       * The six indirect objects of the font, numbered first .. first+5. Order: 0 Type0 font, 1 CIDFont, 2 descriptor, 3 FontFile2,
       * 4 ToUnicode, 5 CIDToGIDMap. Each is { num, dict, stream? } (dict without /Length: the writer adds it, as pdfAssemble's obj() does).
       * `chars` is encoder.chars().
       */
      function fontObjects(chars, first) {
        var tag = 'SPGLES+SportaGlyphless', ttf = glyphlessTrueType(), map = new Uint8Array(2 * chars.length), i
        for (i = 0; i < chars.length; i++) { map[2 * i] = 0; map[2 * i + 1] = 1 }       // every code -> the empty glyph 1
        var f = function (n) { return (first + n) + ' 0 R' }
        return [
          { num: first, dict: '/Type /Font /Subtype /Type0 /BaseFont /' + tag + ' /Encoding /Identity-H /DescendantFonts [' + f(1) + '] /ToUnicode ' + f(4) },
          { num: first + 1, dict: '/Type /Font /Subtype /CIDFontType2 /BaseFont /' + tag + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + f(2) + ' /DW ' + DW + ' /CIDToGIDMap ' + f(5) },
          { num: first + 2, dict: '/Type /FontDescriptor /FontName /' + tag + ' /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ' + f(3) },
          { num: first + 3, dict: '/Length1 ' + ttf.length, stream: ttf },
          { num: first + 4, dict: '', stream: ascii(toUnicodeCMap(chars)) },
          { num: first + 5, dict: '', stream: map }
        ]
      }
      
      // ------------------------------------------------------------------------------------------------ the content stream
      /**
       * Operators for the invisible text of ONE page.
       * items: [{ text, x, y, w, h, size, dir }] in canvas pixels (y = BASELINE, y down; x = left edge; dir 'ltr' | 'rtl'), the engine's own list.
       * enc: the document's encoder. geo: { sc (px -> pt), PHpt }. Returns a string (all ASCII: strings are hex).
       * An item with no text, no width or a non-finite number is skipped. The font size is the item's `size` in points; Tz is chosen so
       * the run of N glyphs (each DW wide) is exactly `w` points wide.
       */
      function textOps(items, enc, geo, mode) {
        mode = mode || DEFAULT_MODE
        var out = ['BT', '3 Tr'], i, n = 0
        function codesOf(cs) {
          var codes = '', j
          for (j = 0; j < cs.length; j++) { var c = enc.code(cs[j]); if (c === undefined) throw new Error('text layer: character not registered (call prepare first)'); codes += hex4(c) }
          return codes
        }
        function show(cs, size, w, x, y) {
          var tz = 100 * w / (cs.length * size)                     // glyph advance = DW/1000 * size * Tz/100
          return '/' + FONT_RES + ' ' + f2(size) + ' Tf ' + f2(tz) + ' Tz 1 0 0 1 ' + f2(x) + ' ' + f2(y) + ' Tm <' + codesOf(cs) + '> Tj'
        }
        for (i = 0; i < (items || []).length; i++) {
          var it = items[i], txt = clean(it && it.text)
          if (!txt) continue
          var size = Number(it.size) * geo.sc, w = Number(it.w) * geo.sc, x = Number(it.x) * geo.sc, y = geo.PHpt - Number(it.y) * geo.sc
          var cs = characters(txt)
          if (!(size > 0) || !(w > 0) || !isFinite(x) || !isFinite(y)) continue
          if (mode === 'words' && RTL_RE.test(txt)) {
            // TOKENS: the text is cut into runs of right-to-left LETTERS (with their marks), runs of everything else that is not a space
            // (Latin words, digits of either kind, punctuation) and spaces. One Tj per token (spaces are only gaps), tokens in LOGICAL order
            // in the stream, laid out across the item's box in the item's base direction (right to left for rtl); a run of Arabic letters is
            // written reversed (visual order, the way a shaping producer writes it). Measured: poppler re-reverses exactly those runs and
            // pdf.js does too, so both read the logical text back. Digits and punctuation are never reversed.
            var toks = txt.match(TOKEN_RE) || [], total = cs.length, cum = 0, ti
            for (ti = 0; ti < toks.length; ti++) {
              var core = toks[ti].replace(/ $/, ''), sp = core.length !== toks[ti].length, tc = characters(core), nTok = tc.length + (sp ? 1 : 0), tw = w * nTok / total
              var tx = it.dir === 'rtl' ? x + w - w * cum / total - tw : x + w * cum / total
              cum += nTok
              if (!core) continue
              // the space that follows a token travels WITH it (some readers only insert a word break from a space in the text, not from a gap):
              // visually it is at the token's far end, i.e. first in a reversed right-to-left run and last in an ordinary one
              var rtlRun = RTL_LETTERS.test(core.charAt(0)), run = rtlRun ? tc.slice().reverse() : tc
              if (sp) run = rtlRun ? [' '].concat(run) : run.concat([' '])
              out.push(show(run, size, tw, tx, y))
            }
            n++
            continue
          }
          if (mode === 'visual' && it.dir === 'rtl') cs = cs.slice().reverse()
          var body = show(cs, size, w, x, y)
          if (mode === 'actualtext') out.push('/Span << /ActualText <FEFF' + utf16hex(txt) + '> >> BDC ' + body + ' EMC')
          else out.push(body)
          n++
        }
        out.push('ET')
        return n ? out.join('\n') : ''
      }
      
      // ------------------------------------------------------------------------------------------------ the engine seam
      /**
       * createTextLayer({ mode }) -> layer, matching pdfAssemble.textLayer's contract.
       *   layer.prepare(pages)  must run once before the PDF is assembled (the font needs every character).
       *   layer.forPage(page, ctx)  is the hook: returns null when the page has no text, else
       *       { resources: '/Font << /SpGl N 0 R >>', content: 'BT ... ET', objects: [...] }
       *   `objects` is non-empty only on the FIRST page that has text (the one shared font); each object carries its own `num`
       *   (taken from ctx.alloc()), so the writer must write { num, dict, stream } as it writes its other objects.
       * pages[i].text is the engine's run list.
       */
      function createTextLayer(opts) {
        opts = opts || {}
        var mode = opts.mode || DEFAULT_MODE, enc = createEncoder(), fontRef = null, prepared = false
        return {
          mode: mode,
          encoder: enc,
          prepare: function (pages) {
            for (var i = 0; i < pages.length; i++) { var t = pages[i].text || []; for (var j = 0; j < t.length; j++) enc.add(clean(t[j] && t[j].text)) }
            prepared = true
          },
          forPage: function (page, ctx) {
            if (!prepared) throw new Error('text layer: prepare(pages) first')
            var content = textOps(page.text || [], enc, { sc: ctx.sc, PHpt: ctx.PHpt }, mode)
            if (!content) return null
            var objects = []
            if (!fontRef) {
              var first = ctx.alloc(); for (var k = 1; k < 6; k++) ctx.alloc()          // six consecutive numbers (the writer's counter is sequential)
              objects = fontObjects(enc.chars(), first); fontRef = first
            }
            return { resources: '/Font << /' + FONT_RES + ' ' + fontRef + ' 0 R >>', content: content, objects: objects }
          }
        }
      }
      return { createTextLayer: createTextLayer, textOps: textOps, characters: characters, DEFAULT_MODE: DEFAULT_MODE }
    })()
  } catch (e) { textLayerLib = null }
  /* <<< EMBED pdf-text-layer-spike.mjs */

  /**
   * QR code of a text (a link): { size, rows, version, ecc } with rows of '0' / '1' strings (no quiet zone: draw 4 light modules around it), or
   * null when there is no encoder or the text does not fit (version 10). Level M first (a screen or a print scans it), then L for a long link;
   * a level the caller asks for is tried first.
   */
  function qr(text, ecc) {
    try {
      if (!qrEncode || typeof text !== 'string' || !text) return null
      var levels = ecc && /^[LMQH]$/.test(ecc) ? [ecc, 'M', 'L'] : ['M', 'L']
      for (var i = 0; i < levels.length; i++) { var r = qrEncode(text, { ecc: levels[i] }); if (r) return r }
    } catch (e) { /* no code: the caller shows the link only */ }
    return null
  }

  // --------------------------------------------------------------------------------------------------- the PDF file
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u }
  function hex16(s) { var o = 'FEFF'; for (var i = 0; i < s.length; i++) o += ('0000' + s.charCodeAt(i).toString(16)).slice(-4).toUpperCase(); return '<' + o + '>' }
  function lit(s) { return '(' + String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') + ')' }
  function f2(n) { return (Math.round(n * 100) / 100).toString() }
  /**
   * pages: [{ jpeg, links: [{x,y,w,h,url}], text: [{text,x,y,w,h,size,dir}] }] in canvas pixels (1240 x 1754, y down).
   * TEXT LAYER: `layer` (optional, from textLayerLib.createTextLayer after layer.prepare(pages)) is asked for every page
   * layer.forPage(page, ctx) -> null | { resources: '/Font << ... >>' (the page's font entry), content: 'BT 3 Tr ... ET' (appended to the page's
   * content stream, in page points), objects: [{ num, dict, stream? }] (extra indirect objects numbered by ctx.alloc()) }, with
   * ctx = { sc (px -> pt), PWpt, PHpt, alloc() -> object number }. Render mode 3 paints nothing, so the page stays pixel-identical; the
   * text is only there to be searched and copied. Without a layer (or when it throws) the file is the image-only PDF it always was.
   */
  function pdfAssemble(pages, meta, layer) {
    var chunks = [], pos = 0, offs = [], next = 4, k = 1, kids = []
    function push(u) { chunks.push(u); pos += u.length }
    function str(s) { push(ascii(s)) }
    var plan = pages.map(function (p) { var o = { img: next++, cont: next++, page: next++, ann: [], tl: null }; p.links.forEach(function () { o.ann.push(next++) }); kids.push(o.page + ' 0 R'); return o })
    var PWpt = 595.28, PHpt = 841.89, sc = PWpt / PW
    if (layer) {
      // the layer takes its font's object numbers here (before `last` is known); a failure leaves the page image-only
      // C2 (2026-11-19 review): the numbers a layer took before it threw are given back, or the xref would list objects that were never written
      var tctx = { sc: sc, PWpt: PWpt, PHpt: PHpt, alloc: function () { return next++ } }, nextBefore = next
      try { pages.forEach(function (p, i) { plan[i].tl = layer.forPage(p, tctx) }) } catch (e) { plan.forEach(function (o) { o.tl = null }); next = nextBefore }
      meta.layered = plan.some(function (o) { return !!o.tl })     // what buildPdf reports as textLayer: false when the layer threw
    }
    var last = next - 1
    function obj(n, dict, stream) {
      offs[n] = pos
      if (stream) { str(n + ' 0 obj\n<<' + dict + ' /Length ' + stream.length + '>>\nstream\n'); push(stream); str('\nendstream\nendobj\n') }
      else str(n + ' 0 obj\n<<' + dict + '>>\nendobj\n')
    }
    str('%PDF-1.4\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]))
    obj(1, '/Type /Catalog /Pages 2 0 R /Lang ' + lit(meta.lang) + ' /PageLayout /OneColumn /ViewerPreferences << /DisplayDocTitle true' + (meta.lang === 'ar' ? ' /Direction /R2L' : '') + ' >>')
    obj(2, '/Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + ']')
    obj(3, '/Title ' + hex16(meta.title) + ' /Subject ' + hex16(meta.subject) + ' /Author ' + lit('Sporta') + ' /Creator ' + lit('www.sporta.com.kw') + ' /Producer ' + lit('Sporta catalogue') + ' /CreationDate ' + lit(meta.date))
    pages.forEach(function (p, i) {
      var o = plan[i], tl = o.tl
      obj(o.img, '/Type /XObject /Subtype /Image /Width ' + PW + ' /Height ' + PH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.jpeg)
      obj(o.cont, '', ascii('q ' + f2(PWpt) + ' 0 0 ' + f2(PHpt) + ' 0 0 cm /Im0 Do Q' + (tl ? '\n' + tl.content : '')))
      obj(o.page, '/Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f2(PWpt) + ' ' + f2(PHpt) + '] /Resources << /XObject << /Im0 ' + o.img + ' 0 R >> /ProcSet [/PDF /ImageC' + (tl ? ' /Text' : '') + ']' + (tl ? ' ' + tl.resources : '') + ' >> /Contents ' + o.cont + ' 0 R'
        + (o.ann.length ? ' /Annots [' + o.ann.map(function (a) { return a + ' 0 R' }).join(' ') + ']' : ''))
      if (tl) tl.objects.forEach(function (x) { obj(x.num, x.dict, x.stream) })
      p.links.forEach(function (l, j) {
        var x1 = l.x * sc, x2 = (l.x + l.w) * sc, y2 = PHpt - l.y * sc, y1 = PHpt - (l.y + l.h) * sc
        obj(o.ann[j], '/Type /Annot /Subtype /Link /Rect [' + f2(x1) + ' ' + f2(y1) + ' ' + f2(x2) + ' ' + f2(y2) + '] /Border [0 0 0] /F 4 /A << /S /URI /URI ' + lit(l.url) + ' >>')
      })
    })
    var xref = pos, id = ''
    try { var r = new Uint8Array(16); crypto.getRandomValues(r); for (var q = 0; q < 16; q++) id += ('0' + r[q].toString(16)).slice(-2) } catch (e) { id = '00112233445566778899aabbccddeeff' }
    str('xref\n0 ' + (last + 1) + '\n0000000000 65535 f \n')
    for (k = 1; k <= last; k++) str(('0000000000' + offs[k]).slice(-10) + ' 00000 n \n')
    str('trailer\n<< /Size ' + (last + 1) + ' /Root 1 0 R /Info 3 0 R /ID [<' + id + '> <' + id + '>] >>\nstartxref\n' + xref + '\n%%EOF\n')
    return new Blob(chunks, { type: 'application/pdf' })
  }

  /**
   * What the text layer is fed with: the recorded runs, with the order the viewers read best. A price (digits first, or "KWD") is always laid
   * out left to right even on an Arabic page (D1: a right-to-left laid price reads "ك.د12.500" in poppler), and any run without a
   * right-to-left letter is left to right whatever the canvas direction was. Returns a copy; the recorded list is not changed.
   */
  var RTL_ANY = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/
  function layerRuns(runs) {
    return (runs || []).map(function (r) {
      var dir = r.dir === 'rtl' && RTL_ANY.test(r.text) && !/^(KWD\s|[0-9\u0660-\u0669])/.test(r.text) ? 'rtl' : 'ltr'
      return { text: r.text, x: r.x, y: r.y, w: r.w, h: r.h, size: r.size, dir: dir }
    })
  }
  /** The layer for these pages, or null when the library did not load or has nothing to say. */
  function makeTextLayer(pages) {
    try {
      if (!textLayerLib) return null
      var fed = pages.map(function (p) { return { text: layerRuns(p.text) } }), layer = textLayerLib.createTextLayer()
      layer.prepare(fed)
      return { forPage: function (page, ctx) { return layer.forPage(fed[pages.indexOf(page)], ctx) } }
    } catch (e) { return null }
  }
  function toJpeg(canvas) {
    return new Promise(function (ok, no) {
      canvas.toBlob(function (b) { if (!b) return no(new Error('jpeg')); b.arrayBuffer().then(function (ab) { ok(new Uint8Array(ab)) }, no) }, 'image/jpeg', 0.84)
    })
  }
  function tick() { return new Promise(function (ok) { setTimeout(ok, 0) }) }
  function check(sig) { if (sig && sig.aborted) { var e = new Error('cancelled'); e.cancelled = true; throw e } }

  /**
   * Build the PDF of a view. Resolves { blob, name, pages, bytes, count, description, textRuns } (textRuns: per page, what was drawn as text - the text layer's input).
   * products: used as given (the caller has applied the view); omitted = the live catalogue with `view` applied.
   * The owner's switches win: prices / soldOut can only turn OFF what settings.show_prices / show_sold_out allow.
   */
  function buildPdf(o) {
    o = o || {}
    var lang = L(o.lang), prog = o.onProgress || function () {}, sig = o.signal
    var d = new Date(), view = o.view || blankView()
    var start = o.products ? Promise.resolve({ products: o.products, settings: o.settings, categories: o.categories, brands: o.brands })
      : load().then(function (r) { return { products: applyView(r.products, view, lang), settings: o.settings || r.settings, categories: r.categories, brands: r.brands } })
    return start.then(function (src) {
      check(sig)
      var st = settingsOf(src.settings)
      var opt = { prices: st.show_prices && o.prices !== false, sizes: st.show_sizes, brand: st.show_brand }
      var withSold = st.show_sold_out && o.soldOut !== false
      var products = src.products.filter(function (p) { return withSold || !p.soldOut })
      if (!products.length) throw new Error('empty')
      var groups = groupsOf(products, src.categories).sort(function (a, b) { return a.ci - b.ci })
      var lo = layoutOf(st.per_page), plan = [], pagesOf = [], first = st.cover ? 2 : 1
      groups.forEach(function (g) {
        pagesOf.push(plan.length + first)
        var n = Math.ceil(g.items.length / lo.per)
        for (var i = 0; i < n; i++) plan.push({ cat: g, items: g.items.slice(i * lo.per, (i + 1) * lo.per), part: i + 1, parts: n })
      })
      var total = plan.length + (st.cover ? 1 : 0), out = [], canvas = document.createElement('canvas'); canvas.width = PW; canvas.height = PH
      var g2 = canvas.getContext('2d')
      var desc = describeView(view, lang, src.categories, src.brands, opt.prices)
      var title = clean(st['title_' + lang]) || T(lang, 'coverTitle')
      var note = clean(st['note_' + lang]) || T(lang, opt.prices ? 'note' : 'noteNoPrice')
      var ropt = { prices: opt.prices, sizes: opt.sizes, brand: opt.brand, k: lo.k, layout: lo, note: clean(st['note_' + lang]) }
      return Promise.all([ensureFonts(), logoWhite()]).then(function (a) {
        var logo = a[1]
        function finishPage(links, rec) { REC = null; return toJpeg(canvas).then(function (j) { out.push({ jpeg: j, links: links, text: rec }) }) }
        var chain = Promise.resolve()
        if (st.cover) {
          chain = chain.then(function () { prog({ i: 1, n: total }); return tick() }).then(function () {
            check(sig)
            var rec = REC = []
            return finishPage(drawCover(g2, lang, { title: title, intro: clean(st['intro_' + lang]), desc: desc, d: d, count: products.length, groups: groups, pagesOf: pagesOf, note: note, logo: logo, qrUrl: pageLink(lang, view) }), rec)
          })
        }
        plan.forEach(function (pg, idx) {
          chain = chain.then(function () {
            check(sig); prog({ i: idx + first, n: total })
            return Promise.all(pg.items.map(function (p) { return firstPicture(p.photos, 640) })).then(function (bms) {
              check(sig)
              var rec = REC = []
              var links = drawContent(g2, lang, pg, bms, idx + first, total, d, logo, ropt)
              bms.forEach(release)
              return finishPage(links, rec)
            }).then(tick)
          })
        })
        return chain.then(function () {
          var ttl = /sporta|\u0633\u0628\u0648\u0631\u062a\u0627/i.test(title) ? title : title + ' \u2013 Sporta'
          var tl = o.textLayer === false ? null : makeTextLayer(out), meta
          var blob = pdfAssemble(out, meta = {
            lang: lang, title: ttl, subject: (desc ? desc + ' \u00b7 ' : '') + T(lang, 'coverUpdated', { d: dateText(d, lang) }),
            date: 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'
          }, tl)
          return { blob: blob, name: fileName(lang, d, view, opt.prices), pages: total, bytes: blob.size, count: products.length, description: desc, textLayer: !!tl && meta.layered !== false, textRuns: out.map(function (pg) { return pg.text }) }
        })
      })
    })
  }
  function download(res) {
    var url = URL.createObjectURL(res.blob), a = document.createElement('a')
    if ('download' in a) { a.href = url; a.download = res.name; a.rel = 'noopener'; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove() }
    else window.open(url, '_blank', 'noopener')
    setTimeout(function () { URL.revokeObjectURL(url) }, 120000)
    return url
  }

  // ------------------------------------------------------------------------------------------------- the page itself
  var SVGNS = 'http://www.w3.org/2000/svg'
  var ICONS = {
    download: [['path', 'M12 3v12'], ['path', 'm7 11 5 5 5-5'], ['path', 'M5 20h14']],
    link: [['path', 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'], ['path', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1']],
    page: [['rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }], ['path', 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2']],
    chat: [['path', 'M4 20l1.3-4.2A8 8 0 1 1 8.4 18.7L4 20z'], ['path', 'M9.5 9.5c.4 2.2 2.3 4.1 5 5']],
    print: [['path', 'M7 9V3h10v6'], ['rect', { x: 4, y: 9, width: 16, height: 8, rx: 2 }], ['path', 'M7 14h10v7H7z']],
    x: [['path', 'M6 6l12 12'], ['path', 'M18 6L6 18']],
    check: [['path', 'm5 12.5 4.5 4.5L19 7.5']]
  }
  function icon(name) {
    var s = document.createElementNS(SVGNS, 'svg')
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor')
    s.setAttribute('stroke-width', '1.75'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.setAttribute('class', 'scat-ic')
    ;(ICONS[name] || []).forEach(function (part) {
      var n = document.createElementNS(SVGNS, part[0])
      if (typeof part[1] === 'string') n.setAttribute('d', part[1]); else for (var a in part[1]) if (own(part[1], a)) n.setAttribute(a, String(part[1][a]))
      s.appendChild(n)
    })
    return s
  }
  var CSS = [
    '#sporta-catalogue{display:block}',
    '.scat{max-width:80rem;margin:0 auto;padding:3rem 1rem 4rem;overflow-anchor:auto}',
    '.scat-head{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;justify-items:center;text-align:center}',
    // UX-1 (2026-11-19 review): the status line is empty until the data arrives and then grows a line: its height is reserved from the first paint, and
    // so is the room of the two chip rows (see [data-phase="loading"]), or the buttons and filters below them jumped (CLS 0.145 / 0.207 measured).
    '.scat-status{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem 1rem;justify-content:center;margin:.25rem 0 0;font-size:.875rem;font-weight:600;min-height:1.75rem}',
    '.scat[data-phase="loading"] .scat-chips{min-height:44px}',
    '.scat-dot{display:inline-block;width:.625rem;height:.625rem;margin-inline-end:.4rem;border-radius:50%;background:#ff7b17;vertical-align:baseline}',
    '.scat-actions,.scat-share{display:flex;flex-wrap:wrap;gap:.75rem;justify-content:center;margin-top:.25rem}',
    '.scat .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:44px;border-radius:.75rem;text-decoration:none}',
    '.scat .btn:disabled{opacity:.55;cursor:not-allowed}',
    '.scat-ic{flex:none}',
    '.scat-note{margin:.25rem 0 0;font-size:.875rem;min-height:1.3em;display:flex;flex-wrap:wrap;gap:.25rem .75rem;justify-content:center;align-items:center}',
    '.scat-note a,.scat-note button{min-height:44px;display:inline-flex;align-items:center;color:inherit;font:inherit;font-weight:700;text-decoration:underline;background:none;border:0;padding:0 .5rem;cursor:pointer}',
    '.scat-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.scat-tools{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;margin:2rem 0 1rem}',
    '.scat-cap{margin:.5rem 0 -.25rem;text-align:center;font-size:.8125rem;font-weight:700;opacity:.8}',
    '.scat-chips{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}',
    '.scat-chip{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:44px;min-width:44px;padding:.4rem 1rem;border:1px solid #171a1e;border-radius:.75rem;background:#fff;color:#171a1e;font:inherit;font-weight:700;font-size:.875rem;cursor:pointer}',
    '.scat-chip[aria-pressed="true"]{background:#ff7b17;border-color:#ff7b17;color:#171a1e}',
    '.scat-chip:disabled{opacity:.45;cursor:not-allowed}',
    '.scat-chip img{display:block;height:1.5rem;width:auto;max-width:5.5rem;object-fit:contain}',
    '.scat-fields{display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end;justify-content:center;width:100%}',
    '.scat-field{display:grid;gap:.25rem;font-size:.8125rem;font-weight:700;text-align:center}',
    '.scat-input{min-height:44px;padding:.4rem .9rem;border:1px solid #171a1e;border-radius:.75rem;background:#fff;color:#171a1e;font:inherit;max-width:100%}',
    '.scat-num{width:7rem}',
    '.scat-search{flex:1 1 16rem;min-width:0;max-width:24rem}',
    '.scat-count{margin:.25rem 0 0;text-align:center;font-weight:700;font-size:.875rem;min-height:1.3em}',
    '@media (max-width:639px){.scat-actions .btn,.scat-share .btn{flex:1 1 calc(50% - .75rem);padding-inline:.5rem}.scat-field{flex:1 1 calc(50% - .75rem)}.scat-num,.scat-field select{width:100%}.scat-chip{flex:0 1 auto}}',
    '.scat-foot{margin:2rem 0 0;text-align:center;font-size:.9375rem}',
    '.scat-grid{display:grid;gap:1rem;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;padding:0;list-style:none}',
    '@media (min-width:768px){.scat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '@media (min-width:1100px){.scat-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    // The card, the chips and the boxes are drawn white in every theme, so their text is named here (inherited, it would be the page's
    // light text on white in the dark theme).
    '.scat-card{position:relative;display:flex;flex-direction:column;overflow:hidden;border:1px solid #e2dbce;border-radius:1rem;background:#fff;color:#171a1e}',
    '.scat-badge{color:#171a1e}.scat-sold{color:#fff}',
    '.scat-link{display:flex;flex-direction:column;flex:1;color:inherit;text-decoration:none}',
    '.scat :focus-visible{outline:3px solid #b34d00;outline-offset:2px}',
    'html.dark .scat :focus-visible,html[data-theme="dark"] .scat :focus-visible{outline-color:#ff7b17}',
    'html.dark .scat-card :focus-visible,html[data-theme="dark"] .scat-card :focus-visible,html.dark .scat-chip:focus-visible,html[data-theme="dark"] .scat-chip:focus-visible{outline-color:#ff7b17;box-shadow:0 0 0 2px #171a1e}',
    '.scat-photo{position:relative;aspect-ratio:4/5;background:#efeae0}',
    '.scat-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    '.scat-badge{position:absolute;top:.5rem;inset-inline-start:.5rem;padding:.2rem .6rem;border-radius:.5rem;font-size:.8125rem;font-weight:800}',
    '.scat-sold{position:absolute;inset-inline:0;top:50%;transform:translateY(-50%);padding:.4rem .5rem;text-align:center;font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}',
    '.scat-cp{position:absolute;top:.25rem;inset-inline-end:.25rem;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:.75rem;background:rgba(255,255,255,.92);color:#171a1e;cursor:pointer}',
    '.scat-cp[data-done]{background:#ff7b17}',
    '.scat-body{display:grid;gap:.25rem;padding:.75rem .75rem 1rem;text-align:center}',
    '.scat-brand{margin:0;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
    '.scat-name{margin:0;font-size:.9375rem;font-weight:700;line-height:1.35;text-align:center}',
    // UX-2 (2026-11-19 review): the sale price and the struck list price were one inline line, wider than a 136-171 px phone card (the card clips): the row
    // wraps, so the struck price drops to its own line when the two do not fit, centred, and nothing leaves the card.
    '.scat-price{margin:0;font-weight:800;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;column-gap:.5rem;max-width:100%;min-width:0}.scat-was{font-size:.8125rem;font-weight:500;opacity:.75}',
    '.scat-sizes{margin:0;font-size:.8125rem;display:flex;flex-wrap:wrap;gap:.25rem .5rem;justify-content:center}',
    '.scat-sz-out{opacity:.6}',
    '.scat-empty{padding:3rem 0;text-align:center;font-weight:600;display:grid;gap:1rem;justify-items:center}',
    '.scat-skel{border:1px solid #e2dbce;border-radius:1rem;background:#fff;overflow:hidden}',
    '.scat-skel div{background:#efeae0}.scat-skel .a{aspect-ratio:4/5}.scat-skel .b{height:.875rem;margin:.75rem;border-radius:.5rem}',
    '@keyframes scat-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
    '.scat-skel{animation:scat-pulse 1.4s ease-in-out infinite}',
    '@media (prefers-reduced-motion:reduce){.scat-skel{animation:none}}',
    // Print: only the page's own content (the shop's header, footer and tools are left off), three cards across, a card never split.
    // Scoped by :has so the rules cannot touch any other page.
    '@media print{',
    'html:has(#sporta-catalogue) .app-header,html:has(#sporta-catalogue) footer,html:has(#sporta-catalogue) .navbar-secondary,html:has(#sporta-catalogue) [class*="fixed"],',
    'html:has(#sporta-catalogue) .scat-actions,html:has(#sporta-catalogue) .scat-share,html:has(#sporta-catalogue) .scat-tools,html:has(#sporta-catalogue) .scat-note,html:has(#sporta-catalogue) .scat-cp,html:has(#sporta-catalogue) .scat-sr{display:none!important}',
    'html:has(#sporta-catalogue) .scat{padding:0;max-width:none}',
    'html:has(#sporta-catalogue) .scat-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}',
    'html:has(#sporta-catalogue) .scat-card{break-inside:avoid;page-break-inside:avoid}',
    'html:has(#sporta-catalogue) .scat,html:has(#sporta-catalogue) .scat *{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '}'
  ].join('')
  function styleOnce() { if (document.getElementById('sporta-catalogue-css')) return; var s = el('style'); s.id = 'sporta-catalogue-css'; s.textContent = CSS; document.head.appendChild(s) }
  function ago(at, lang) {
    var m = Math.floor((Date.now() - at.getTime()) / 60000)
    return m < 1 ? T(lang, 'now') : T(lang, 'ago', { m: m })
  }
  function setLd(products, lang, on) {
    var old = document.querySelector('script[data-sporta-catalogue-ld]'); if (old) old.remove()
    if (!on || !products.length) return
    // the server already puts a CollectionPage into the head of /catalogue (seo-page.php): a second one would be a duplicate
    var other = document.querySelectorAll('script[type="application/ld+json"]')
    for (var i = 0; i < other.length; i++) if (!other[i].hasAttribute('data-sporta-catalogue-ld') && /"CollectionPage"/.test(other[i].textContent)) return
    var s = el('script'); s.type = 'application/ld+json'; s.setAttribute('data-sporta-catalogue-ld', '1')
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: T(lang, 'h1'), url: ORIGIN + '/catalogue' + (lang === 'en' ? '?lang=en' : ''), inLanguage: lang,
      mainEntity: { '@type': 'ItemList', numberOfItems: products.length, itemListElement: products.map(function (p, i) { return { '@type': 'ListItem', position: i + 1, url: ORIGIN + '/product/' + p.slug, name: lang === 'ar' ? p.name.ar : p.name.en } }) }
    })
    document.head.appendChild(s)
  }
  function copyText(text, done) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(false) }); return } } catch (e) { /* the old way below */ }
    try {
      var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); done(!!ok)
    } catch (e2) { done(false) }
  }

  /** A one-character hint kept in localStorage (read with one argument, written with two); '' when storage is not available. */
  function memo(k, v) {
    try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); return v } catch (e) { return '' }
  }
  /** The owner's settings of the page now mounted (null before the first answer): what the document head must say (C1, see headText). */
  var HEADSET = null
  /**
   * The title and description the document head should carry on /catalogue: the owner's title (+ " - Sporta", as seo-page.php writes it) and intro,
   * '' for a part the owner left empty (the caller keeps its built-in wording). null until the page has its data.
   */
  function headText(l) {
    var s = HEADSET; if (!s) return null
    var lg = l === 'ar' ? 'ar' : 'en', t = clean(s['title_' + lg]).slice(0, 120), i = clean(s['intro_' + lg]).slice(0, 320)
    return { title: t ? t + (lg === 'ar' ? ' \u2014 \u0633\u0628\u0648\u0631\u062a\u0627' : ' \u2014 Sporta') : '', description: i }
  }
  function mountPage(host) {
    styleOnce()
    var S = { lang: pageLang(), data: null, products: [], cats: [], brands: [], settings: settingsOf(null), view: viewOf(location.search), phase: 'loading', build: null, busy: false, at: null, kind: '' }
    var root = el('section', 'scat'); root.setAttribute('data-sporta-catalogue-page', '')
    var head = el('div', 'scat-head')
    var eyebrow = el('p', 'page-eyebrow'), h1 = el('h1', 'page-heading font-black'), lead = el('p', 'page-lead')
    var status = el('p', 'scat-status')
    var actions = el('div', 'scat-actions'), share = el('div', 'scat-share')
    function mkBtn(cls, key, ic, tag) {
      var b = el(tag || 'button', 'btn ' + cls); if (!tag) b.type = 'button'
      b.setAttribute('data-scat', key); b.appendChild(icon(ic)); b.appendChild(el('span')); return b
    }
    function label(b, t) { if (b.lastChild.textContent !== t) b.lastChild.textContent = t }
    var btnA = mkBtn('btn-primary', 'dl', 'download'), btnB = mkBtn('btn-ghost', 'dl-other', 'download'), btnAll = mkBtn('btn-ghost', 'dl-all', 'download')
    var btnCopy = mkBtn('btn-ghost scat-copy', 'copy', 'link'), btnPage = mkBtn('btn-ghost', 'copy-page', 'page'), btnWa = mkBtn('btn-ghost', 'wa', 'chat', 'a'), btnPrint = mkBtn('btn-ghost', 'print', 'print')
    btnWa.target = '_blank'; btnWa.rel = 'noopener noreferrer'
    btnAll.hidden = true
    ;[btnA, btnB, btnAll].forEach(function (b) { actions.appendChild(b) })
    ;[btnCopy, btnPage, btnWa, btnPrint].forEach(function (b) { share.appendChild(b) })
    var note = el('p', 'scat-note'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); note.setAttribute('data-scat', 'note')
    var noteText = el('span'), againLink = el('a'), cancelBtn = el('button')
    againLink.hidden = true; againLink.setAttribute('data-scat', 'again'); againLink.href = '#'
    cancelBtn.type = 'button'; cancelBtn.hidden = true; cancelBtn.setAttribute('data-scat', 'cancel')
    note.appendChild(noteText); note.appendChild(againLink); note.appendChild(cancelBtn)
    ;[eyebrow, h1, lead, status, actions, share, note].forEach(function (n) { head.appendChild(n) })

    var tools = el('div', 'scat-tools')
    var catBox = el('div', 'scat-chips'), brandBox = el('div', 'scat-chips'), fields = el('div', 'scat-fields')
    catBox.setAttribute('role', 'group'); catBox.setAttribute('data-scat', 'cats'); brandBox.setAttribute('role', 'group'); brandBox.setAttribute('data-scat', 'brands')
    function mkToggle(key) { var b = el('button', 'scat-chip'); b.type = 'button'; b.setAttribute('data-scat', key); b.setAttribute('aria-pressed', 'false'); return b }
    var tSale = mkToggle('sale'), tStock = mkToggle('stock')
    function mkField(key, kind) {
      var w = el('label', 'scat-field'), cap = el('span'), inp = el('input', 'scat-input scat-num')
      inp.type = 'number'; inp.min = '0'; inp.step = 'any'; inp.setAttribute('inputmode', 'decimal'); inp.setAttribute('data-scat', key)
      w.appendChild(cap); w.appendChild(inp); w._cap = cap; void kind; return { box: w, input: inp }
    }
    var fMin = mkField('min'), fMax = mkField('max')
    var sortW = el('label', 'scat-field'), sortCap = el('span'), sortSel = el('select', 'scat-input'); sortSel.setAttribute('data-scat', 'sort'); sortW.appendChild(sortCap); sortW.appendChild(sortSel)
    var search = el('input', 'scat-input scat-search'); search.type = 'search'; search.setAttribute('autocomplete', 'off'); search.setAttribute('data-scat', 'search'); search.setAttribute('maxlength', '80')
    var clearBtn = mkBtn('btn-ghost', 'clear', 'x'); clearBtn.hidden = true
    ;[tSale, tStock, fMin.box, fMax.box, sortW, search, clearBtn].forEach(function (n) { fields.appendChild(n) })
    var count = el('p', 'scat-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); count.setAttribute('data-scat', 'count')
    var capCat = el('p', 'scat-cap'), capBrand = el('p', 'scat-cap'); capCat.setAttribute('aria-hidden', 'true'); capBrand.setAttribute('aria-hidden', 'true')
    tools.appendChild(capCat); tools.appendChild(catBox); tools.appendChild(capBrand); tools.appendChild(brandBox); tools.appendChild(fields); tools.appendChild(count)
    var body = el('div'); body.setAttribute('data-scat', 'body')
    var foot = el('p', 'scat-foot'); foot.setAttribute('data-scat', 'footnote'); foot.hidden = true
    var live = el('p', 'scat-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('data-scat', 'live')
    root.setAttribute('data-phase', 'loading')
    root.appendChild(head); root.appendChild(tools); root.appendChild(body); root.appendChild(foot); root.appendChild(live); host.appendChild(root)

    var pollTimer = 0, statusTimer = 0, dead = false, abort = null, failures = 0, checking = false, bodyKind = '', grid = null, sortSig = '', etag = '', announceTimer = 0

    function lang() { return S.lang }
    function other() { return S.lang === 'ar' ? 'en' : 'ar' }
    function st() { return S.settings }
    function announce(t) { live.textContent = ''; clearTimeout(announceTimer); announceTimer = setTimeout(function () { live.textContent = t }, 60) }

    // ------------------------------------------------------------------ the view: sanitised against the data, written to the address
    function sanitise() {
      var v = S.view, s = st(), ch = false
      function drop(k, to) { if (JSON.stringify(v[k]) !== JSON.stringify(to)) { v[k] = to; ch = true } }
      if (v.cat && !S.cats.some(function (c) { return c.slug === v.cat })) drop('cat', '')
      if (v.brand && (!s.show_brand || !S.brands.some(function (b) { return b.slug === v.brand }))) drop('brand', '')
      if (!s.show_prices) { drop('sale', false); drop('min', null); drop('max', null); if (v.sort === 'price_asc' || v.sort === 'price_desc') drop('sort', 'featured') }
      if (!s.show_sold_out) drop('stock', false)
      return ch
    }
    function writeAddress() {
      try {
        var keep = location.search.replace(/^\?/, '').split('&').filter(function (kv) { return kv && VIEW_KEYS.indexOf(kv.split('=')[0]) < 0 })
        var q = keep.concat(viewPairs(S.view).map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]) })).join('&')
        var url = location.pathname + (q ? '?' + q : '') + location.hash
        if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url)
      } catch (e) { /* an address that cannot be written leaves the page as it is */ }
    }
    function visible() { return applyView(S.products, S.view, lang()) }
    function baseView(drop) { var v = {}; for (var k in S.view) if (own(S.view, k)) v[k] = S.view[k]; for (var d in drop) if (own(drop, d)) v[d] = drop[d]; return v }

    // ------------------------------------------------------------------------------------------------------------------- the texts
    function textsDraw() {
      var l = lang(), s = st()
      eyebrow.textContent = T(l, 'eyebrow')
      var tt = s['title_' + l] || T(l, 'h1'), li = s['intro_' + l] || T(l, s.show_prices ? 'lead' : 'leadNoPrice')
      if (h1.textContent !== tt) h1.textContent = tt
      if (lead.textContent !== li) lead.textContent = li
      var nt = s['note_' + l]; foot.textContent = nt || ''; foot.hidden = !nt
      search.placeholder = T(l, 'search'); search.setAttribute('aria-label', T(l, 'search'))
      catBox.setAttribute('aria-label', T(l, 'cats')); brandBox.setAttribute('aria-label', T(l, 'brands')); capCat.textContent = T(l, 'cats'); capBrand.textContent = T(l, 'brands')
      tSale.textContent = T(l, 'onSale'); tStock.textContent = T(l, 'inStock')
      fMin.box._cap.textContent = T(l, 'min'); fMax.box._cap.textContent = T(l, 'max'); sortCap.textContent = T(l, 'sort')
      againLink.textContent = T(l, 'again'); cancelBtn.textContent = T(l, 'cancel'); label(clearBtn, T(l, 'clear'))
      label(btnCopy, T(l, 'copy')); label(btnPage, T(l, 'copyPage')); label(btnWa, T(l, 'wa')); label(btnPrint, T(l, 'print'))
      var sig = l + '|' + s.show_prices
      if (sig !== sortSig) {
        sortSig = sig; sortSel.textContent = ''
        SORTS.filter(function (k) { return s.show_prices || (k !== 'price_asc' && k !== 'price_desc') }).forEach(function (k) {
          var o = el('option', '', T(l, { featured: 'sortFeatured', price_asc: 'sortPriceAsc', price_desc: 'sortPriceDesc', name: 'sortName' }[k])); o.value = k; sortSel.appendChild(o)
        })
        sortSel.value = S.view.sort
      }
      tSale.hidden = !s.show_prices; fMin.box.hidden = fMax.box.hidden = !s.show_prices; tStock.hidden = !s.show_sold_out
    }
    function controlsFromView() {
      var v = S.view
      if (search.value !== v.q) search.value = v.q
      fMin.input.value = v.min == null ? '' : String(v.min); fMax.input.value = v.max == null ? '' : String(v.max)
      sortSel.value = v.sort
    }
    function statusLine() {
      var l = lang(); status.textContent = ''
      if (S.phase !== 'ready' || !S.at) return
      var a = el('span'); a.appendChild(el('span', 'scat-dot')); a.firstChild.setAttribute('aria-hidden', 'true'); a.appendChild(document.createTextNode(T(l, 'products', { n: S.products.length }))); status.appendChild(a)
      status.appendChild(el('span', '', T(l, 'updated', { t: ago(S.at, l) })))
    }

    // ------------------------------------------------------------------------------------------------------------------ chips (kept in place)
    function syncChips(box, specs, onClick) {
      var have = {}
      Array.prototype.forEach.call(box.children, function (n) { have[n.getAttribute('data-k')] = n })
      var cursor = box.firstChild
      specs.forEach(function (sp) {
        var n = have[sp.key]
        if (!n) { n = el('button', 'scat-chip'); n.type = 'button'; n.setAttribute('data-k', sp.key); n.addEventListener('click', function () { onClick(n.getAttribute('data-k')) }) }
        delete have[sp.key]
        n.setAttribute(sp.attr, sp.key)
        var pressed = sp.pressed ? 'true' : 'false'
        if (n.getAttribute('aria-pressed') !== pressed) n.setAttribute('aria-pressed', pressed)
        if (n.disabled !== !!sp.disabled) n.disabled = !!sp.disabled
        var sig = sp.text + '|' + (sp.logo || '')
        if (n._sig !== sig) {
          n._sig = sig; n.textContent = ''
          if (sp.logo) { var im = el('img'); im.src = sp.logo; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.addEventListener('error', function () { im.remove(); n.insertBefore(el('span', '', sp.name), n.firstChild) }); n.appendChild(im); n.appendChild(el('span', '', '(' + sp.n + ')')) }
          else n.textContent = sp.text
          n.setAttribute('aria-label', sp.text)
        }
        if (cursor === n) cursor = cursor.nextSibling; else box.insertBefore(n, cursor)
      })
      for (var k in have) if (own(have, k)) have[k].remove()
    }
    function chipsDraw() {
      var l = lang(), s = st(), v = S.view
      var byCat = {}, byBrand = {}
      var forCat = applyView(S.products, baseView({ cat: '' }), l), forBrand = applyView(S.products, baseView({ brand: '' }), l)
      forCat.forEach(function (p) { byCat[p.category] = (byCat[p.category] || 0) + 1 })
      forBrand.forEach(function (p) { if (p.brand) byBrand[p.brand] = (byBrand[p.brand] || 0) + 1 })
      var cs = [{ key: 'all', attr: 'data-scat-cat', text: T(l, 'all') + ' (' + forCat.length + ')', pressed: !v.cat }]
      S.cats.forEach(function (c) {
        var n = byCat[c.slug] || 0
        cs.push({ key: c.slug, attr: 'data-scat-cat', text: (l === 'ar' ? c.name_ar || c.name_en : c.name_en || c.name_ar) + ' (' + n + ')', pressed: v.cat === c.slug, disabled: n === 0 && v.cat !== c.slug })
      })
      syncChips(catBox, cs, function (k) { S.view.cat = k === 'all' ? '' : k; viewChanged() })
      var showBrands = s.show_brand && S.brands.length > 0
      // UX-1: while loading, the brand row keeps its room unless the last visit found no brands (a hint kept per browser; the first visit assumes brands)
      var room = S.phase === 'loading' && memo('sporta_cat_brands') !== '0'
      brandBox.hidden = capBrand.hidden = !showBrands && !room
      if (S.phase === 'ready') memo('sporta_cat_brands', showBrands ? '1' : '0')
      var bs = []
      if (showBrands) {
        bs.push({ key: 'all', attr: 'data-scat-brand', text: T(l, 'all') + ' (' + forBrand.length + ')', pressed: !v.brand })
        S.brands.forEach(function (b) {
          var n = byBrand[b.slug] || 0, nm = l === 'ar' ? b.name_ar || b.name_en : b.name_en || b.name_ar
          bs.push({ key: b.slug, attr: 'data-scat-brand', text: nm + ' (' + n + ')', name: nm, n: n, logo: b.logo, pressed: v.brand === b.slug, disabled: n === 0 && v.brand !== b.slug })
        })
      }
      syncChips(brandBox, bs, function (k) { S.view.brand = k === 'all' ? '' : k; viewChanged() })
      tSale.setAttribute('aria-pressed', v.sale ? 'true' : 'false'); tStock.setAttribute('aria-pressed', v.stock ? 'true' : 'false')
    }

    // ------------------------------------------------------------------------------------------------------------------------- cards
    function photoImg(p, l) {
      var im = el('img'); im.alt = l === 'ar' ? p.name.ar : p.name.en; im.loading = 'lazy'; im.decoding = 'async'; im.width = 600; im.height = 750
      var chain = p.photos.concat(['/product-photo-unavailable.svg']), i = 0
      im.addEventListener('error', function () { i++; if (i < chain.length) { im.removeAttribute('srcset'); im.src = chain[i] } })
      if (p.image_small && p.image && p.image_small !== p.image) { im.srcset = p.image_small + ' 640w, ' + p.image + ' 1200w'; im.sizes = '(min-width:1100px) 20vw, (min-width:768px) 30vw, 46vw' }
      im.src = chain[0]
      return im
    }
    function cardSig(p, l) {
      var s = st()
      return JSON.stringify([l, p.name, p.brand, p.brandName, p.price, p.list, p.pct, p.sale, p.soldOut, p.sizes, p.photos, p.image_small, s.show_prices, s.show_sizes, s.show_brand])
    }
    function card(p, l) {
      var s = st(), li = el('li', 'scat-card'), a = el('a', 'scat-link'); a.href = '/product/' + p.slug + (l === 'en' ? '?lang=en' : '')
      a.setAttribute('data-scat-product', p.slug)
      li.setAttribute('data-slug', p.slug)
      var ph = el('div', 'scat-photo'); ph.appendChild(photoImg(p, l))
      if (s.show_prices && p.sale && p.pct > 0) ph.appendChild(el('span', 'scat-badge bg-brand', T(l, 'off', { n: p.pct })))
      if (p.soldOut) ph.appendChild(el('span', 'scat-sold bg-ink', T(l, 'soldOut')))
      var b = el('div', 'scat-body')
      if (s.show_brand && p.brandName) b.appendChild(el('p', 'scat-brand', l === 'ar' ? p.brandName.ar : p.brandName.en))
      b.appendChild(el('h3', 'scat-name', l === 'ar' ? p.name.ar : p.name.en))
      if (s.show_prices) {
        var pr = el('p', 'scat-price'); pr.appendChild(el('span', 'scat-now', price(p.price, l)))
        if (p.sale) { pr.appendChild(el('span', 'scat-sr', ' ' + T(l, 'was') + ' ')); pr.appendChild(el('s', 'scat-was', price(p.list, l))) }
        b.appendChild(pr)
      }
      if (s.show_sizes && !p.soldOut && p.sizes.length) {
        var sz = el('p', 'scat-sizes'); sz.appendChild(el('span', 'scat-sr', T(l, 'sizes') + ': '))
        p.sizes.forEach(function (x) {
          var c = el('span', x.in_stock ? 'scat-sz' : 'scat-sz scat-sz-out')
          if (x.in_stock) c.textContent = sizeLabel(x.size, l)
          else { c.appendChild(el('s', '', sizeLabel(x.size, l))); c.appendChild(el('span', 'scat-sr', ' (' + T(l, 'sizeOut') + ')')) }
          sz.appendChild(c)
        })
        b.appendChild(sz)
      }
      a.appendChild(ph); a.appendChild(b); li.appendChild(a)
      var cp = el('button', 'scat-cp'); cp.type = 'button'; cp.setAttribute('data-scat-copy', p.slug); cp.setAttribute('aria-label', T(l, 'copyLink') + ': ' + (l === 'ar' ? p.name.ar : p.name.en)); cp.appendChild(icon('link'))
      cp.addEventListener('click', function () {
        copyText(productUrl(p, l), function (ok) {
          announce(T(l, ok ? 'copied' : 'copyFail'))
          if (ok) { cp.setAttribute('data-done', ''); cp.textContent = ''; cp.appendChild(icon('check')); setTimeout(function () { try { cp.removeAttribute('data-done'); cp.textContent = ''; cp.appendChild(icon('link')) } catch (e) { /* gone */ } }, 1600) }
        })
      })
      li.appendChild(cp)
      li._sig = cardSig(p, l)
      return li
    }
    function showBody(kind, build) {
      if (bodyKind === kind) return false
      bodyKind = kind; grid = null; body.textContent = ''; body.setAttribute('aria-busy', kind === 'skeleton' ? 'true' : 'false'); build(); return true
    }
    function reconcile(ul, items, l) {
      var have = {}
      Array.prototype.forEach.call(ul.children, function (n) { have[n.getAttribute('data-slug')] = n })
      var active = document.activeElement, refocus = null, cursor = ul.firstChild
      items.forEach(function (p) {
        var sig = cardSig(p, l), n = have[p.slug]
        if (n && n._sig === sig) delete have[p.slug]
        else { var nn = card(p, l); if (n) { if (n.contains(active)) refocus = nn.querySelector(active && active.tagName === 'BUTTON' ? 'button' : 'a'); delete have[p.slug]; if (cursor === n) cursor = n.nextSibling; n.remove() } n = nn }
        if (cursor === n) cursor = cursor.nextSibling; else ul.insertBefore(n, cursor)
      })
      for (var k in have) if (own(have, k)) have[k].remove()
      if (refocus) try { refocus.focus() } catch (e) { /* focus stays where it was */ }
    }
    function gridDraw() {
      var l = lang()
      if (root.getAttribute('data-phase') !== S.phase) root.setAttribute('data-phase', S.phase)
      if (S.phase === 'loading') {
        showBody('skeleton', function () {
          var ul = el('ul', 'scat-grid'); ul.setAttribute('aria-hidden', 'true'); ul.setAttribute('data-scat', 'skeleton')
          for (var i = 0; i < 8; i++) { var li = el('li', 'scat-skel'); li.appendChild(el('div', 'a')); li.appendChild(el('div', 'b')); li.appendChild(el('div', 'b')); ul.appendChild(li) }
          body.appendChild(ul); var m = el('p', 'scat-sr', T(l, 'loading')); body.appendChild(m)
        })
        return
      }
      if (S.phase === 'error') {
        bodyKind = ''; showBody('error', function () {
          var p = el('div', 'scat-empty'), r = el('button', 'btn btn-primary', T(l, 'retry')); r.type = 'button'; r.addEventListener('click', function () { S.phase = 'loading'; refresh(true) })
          p.appendChild(el('p', '', T(l, 'loadFailed'))); p.appendChild(r); body.appendChild(p)
        })
        return
      }
      var items = visible()
      if (!S.products.length) { bodyKind = ''; showBody('empty', function () { body.appendChild(el('p', 'scat-empty', T(l, 'emptyShop'))) }); return }
      if (!items.length) {
        bodyKind = ''; showBody('none', function () {
          var d = el('div', 'scat-empty'); d.appendChild(el('p', '', T(l, 'none')))
          var c = el('button', 'btn btn-ghost', T(l, 'clear')); c.type = 'button'; c.setAttribute('data-scat', 'clear-empty'); c.addEventListener('click', clearAll); d.appendChild(c); body.appendChild(d)
        })
        return
      }
      showBody('grid', function () { grid = el('ul', 'scat-grid'); grid.setAttribute('data-scat', 'grid'); body.appendChild(grid) })
      reconcile(grid, items, l)
    }
    function countDraw() {
      var l = lang()
      if (S.phase !== 'ready') { count.textContent = ''; return }
      var n = visible().length, t = S.products.length
      var txt = isFiltered(S.view) ? T(l, 'shownOf', { n: n, t: t }) : T(l, t === 1 && l === 'en' ? 'totalOne' : 'total', { t: t })
      if (count.textContent !== txt) count.textContent = txt
    }
    function linksDraw() {
      var l = lang(), filtered = isFiltered(S.view), n = S.phase === 'ready' ? visible().length : 0, any = S.products.length > 0
      label(btnA, T(l, filtered ? 'dlView' : 'dl')); label(btnB, T(l, filtered ? 'dlViewOther' : 'dlOther')); label(btnAll, T(l, 'dlAll'))
      btnAll.hidden = !filtered
      btnA.disabled = btnB.disabled = S.busy || !n; btnAll.disabled = S.busy || !any
      btnWa.href = 'https://wa.me/?text=' + encodeURIComponent((st()['title_' + l] || T(l, 'h1')) + ' ' + pageLink(l, S.view))
      clearBtn.hidden = isDefaultView(S.view)
    }
    function noteDraw() {
      var l = lang(), b = S.build
      againLink.hidden = true; cancelBtn.hidden = true; noteText.textContent = ''
      if (!b) return
      if (b.state === 'busy') { noteText.textContent = b.n ? T(l, 'photos', { i: b.i, n: b.n }) : T(l, 'starting'); cancelBtn.hidden = false }
      else if (b.state === 'fail') noteText.textContent = T(l, 'failed')
      else if (b.state === 'done') { noteText.textContent = T(l, 'done', { name: b.name, size: sizeText(b.bytes) }); againLink.hidden = false }
      else if (b.state === 'copied') noteText.textContent = T(l, 'copied')
      else if (b.state === 'copyfail') noteText.textContent = T(l, 'copyFail')
      else if (b.state === 'noview') noteText.textContent = T(l, 'noView')
      else if (b.state === 'offline') noteText.textContent = T(l, 'offline')
    }
    /** Everything that follows a change of the view (not of the data). */
    function viewChanged() { writeAddress(); chipsDraw(); gridDraw(); countDraw(); linksDraw() }
    function clearAll() {
      S.view = blankView(); controlsFromView(); viewChanged()
      var first = catBox.querySelector('button'); if (first) try { first.focus() } catch (e) { /* ignore */ }
    }
    function drawAll() { textsDraw(); controlsFromView(); statusLine(); chipsDraw(); gridDraw(); countDraw(); linksDraw(); noteDraw() }

    // ----------------------------------------------------------------------------------------------------------------- data in, live
    function apply(res, first) {
      var before = S.revision, wasReady = S.phase === 'ready'
      if (!wasReady) first = true            // the first good answer after an error (the poll finds it) is a first one: the controls, the download link
      HEADSET = res.settings
      S.data = res; S.products = res.products; S.cats = res.categories; S.brands = res.brands; S.settings = res.settings; S.revision = res.revision; S.source = res.source; S.at = new Date()
      etag = res.source === 'catalogue' ? (res.etag || res.revision) : ''
      var viewMoved = sanitise()
      S.phase = 'ready'
      textsDraw(); if (viewMoved || first) controlsFromView(); statusLine(); chipsDraw(); gridDraw(); countDraw(); linksDraw()
      if (viewMoved) writeAddress()
      setLd(S.products, lang(), true)
      if (!first && before !== res.revision) announce(T(lang(), 'liveUpdated'))
      if (!wasReady) autoStart()             // C6: a /catalogue?pdf= link whose first read failed starts its download when the page recovers by itself
    }
    function schedule() {
      clearTimeout(pollTimer)
      if (dead) return
      pollTimer = setTimeout(tick, Math.min(pollMs() * Math.pow(2, failures), POLL_MAX))
    }
    function tick() {
      if (dead) return
      if (document.hidden) { schedule(); return }            // a hidden tab sends nothing
      if (navigator.onLine === false) { failures = Math.min(failures + 1, 3); noteOffline(); schedule(); return }
      poll()
    }
    function noteOffline() { if (S.phase === 'ready' && !S.build) { S.build = { state: 'offline' }; noteDraw() } }
    /** One check of the live data. 304 = nothing; 200 = update in place; an error = back off. */
    function poll() {
      if (dead || checking) return Promise.resolve()
      checking = true
      var p = S.source === 'catalogue' && etag
        ? readCatalogue(etag).then(function (r) {
          if (r.status === 304) { S.at = new Date(); statusLine(); return }
          var res = fromCatalogue(r.json, r.etag); res.etag = r.etag
          if (res.revision !== S.revision) apply(res, false); else { S.at = new Date(); statusLine() }
        }, function (e) {
          if (e && e.http === 404) return load({ force: true }).then(function (res) { if (res.revision !== S.revision) apply(res, false); else { S.at = new Date(); statusLine() } })
          throw e
        })
        : load({ force: true }).then(function (res) { if (res.revision !== S.revision) apply(res, false); else { S.at = new Date(); statusLine() } })
      return p.then(function () { failures = 0; if (S.build && S.build.state === 'offline') { S.build = null; noteDraw() } }, function () { failures = Math.min(failures + 1, 3) }).then(function () { checking = false; schedule() })
    }
    function refresh(first) {
      if (dead) return Promise.resolve()
      if (S.phase !== 'ready') { S.phase = 'loading'; gridDraw() }
      return load({ force: true }).then(function (res) {
        if (dead) return
        apply(res, !!first || S.phase !== 'ready'); failures = 0; schedule(); autoStart()
      }, function () { if (dead) return; if (S.phase !== 'ready') { S.phase = 'error'; gridDraw() } failures = Math.min(failures + 1, 3); schedule() })
    }
    var autoDone = false
    function autoStart() {
      if (autoDone) return; autoDone = true
      var m = /[?&]pdf=(ar|en)\b/.exec(location.search); if (m) startBuild(m[1], false)
    }

    // -------------------------------------------------------------------------------------------------------------------- PDF actions
    function startBuild(l, everything) {
      if (S.busy || !S.products.length) return
      var items = everything ? S.products : visible()
      if (!items.length) { S.build = { state: 'noview' }; noteDraw(); return }
      S.busy = true; abort = { aborted: false }
      S.build = { state: 'busy', i: 0, n: 0 }; noteDraw(); linksDraw()
      buildPdf({
        products: items, lang: l, view: everything ? blankView() : S.view, settings: S.settings, categories: S.cats, brands: S.brands, prices: S.settings.show_prices, soldOut: S.settings.show_sold_out,
        signal: abort, onProgress: function (p) { if (S.build) { S.build.i = p.i; S.build.n = p.n; noteDraw() } }
      }).then(function (res) {
        if (dead) return
        S.build = { state: 'done', name: res.name, bytes: res.bytes, res: res }; download(res); noteDraw()
      }, function (e) {
        if (dead) return
        S.build = e && e.cancelled ? null : { state: 'fail' }; noteDraw()
      }).then(function () { S.busy = false; if (!dead) linksDraw() })
    }
    btnA.addEventListener('click', function () { startBuild(lang(), false) })
    btnB.addEventListener('click', function () { startBuild(other(), false) })
    btnAll.addEventListener('click', function () { startBuild(lang(), true) })
    cancelBtn.addEventListener('click', function () { if (abort) abort.aborted = true })
    againLink.addEventListener('click', function (e) { e.preventDefault(); if (S.build && S.build.res) download(S.build.res) })
    function copyTo(text) { copyText(text, function (ok) { S.build = { state: ok ? 'copied' : 'copyfail' }; noteDraw(); announce(T(lang(), ok ? 'copied' : 'copyFail')) }) }
    btnCopy.addEventListener('click', function () { copyTo(pdfLink(lang(), S.view)) })
    btnPage.addEventListener('click', function () { copyTo(pageLink(lang(), S.view)) })
    btnPrint.addEventListener('click', function () { try { window.print() } catch (e) { /* no printing here */ } })
    clearBtn.addEventListener('click', clearAll)

    // ------------------------------------------------------------------------------------------------------------------- filter controls
    search.addEventListener('input', function () { S.view.q = clean(search.value).slice(0, 80); viewChanged() })
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; S.view.q = ''; viewChanged() } })
    tSale.addEventListener('click', function () { S.view.sale = !S.view.sale; viewChanged() })
    tStock.addEventListener('click', function () { S.view.stock = !S.view.stock; viewChanged() })
    fMin.input.addEventListener('input', function () { S.view.min = numOf(fMin.input.value); viewChanged() })
    fMax.input.addEventListener('input', function () { S.view.max = numOf(fMax.input.value); viewChanged() })
    sortSel.addEventListener('change', function () { S.view.sort = SORTS.indexOf(sortSel.value) >= 0 ? sortSel.value : 'featured'; viewChanged() })

    // follow the site's language switch
    var lo = new MutationObserver(function () { var l = pageLang(); if (l !== S.lang) { S.lang = l; sortSig = ''; drawAll(); setLd(S.products, l, S.phase === 'ready') } })
    lo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    statusTimer = setInterval(function () { if (S.phase === 'ready' && !document.hidden) statusLine() }, 30000)
    function vis() { if (!document.hidden && S.phase === 'ready') poll() }
    function online() { failures = 0; if (S.build && S.build.state === 'offline') { S.build = null; noteDraw() } poll() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('online', online)
    drawAll(); refresh(true); ensureFonts()
    return {
      destroy: function () {
        dead = true; clearTimeout(pollTimer); clearInterval(statusTimer); clearTimeout(announceTimer); lo.disconnect()
        document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', online)
        if (abort) abort.aborted = true
        HEADSET = null; setLd([], 'en', false); if (root.parentNode) root.parentNode.removeChild(root)
        var css = document.getElementById('sporta-catalogue-css'); if (css) css.remove()
      }
    }
  }

  window.SportaCatalogue = {
    version: 2, load: load, buildPdf: buildPdf, download: download, mountPage: mountPage, pdfLink: pdfLink, pageLink: pageLink, viewOf: viewOf, applyView: applyView,
    blankView: blankView, isDefaultView: isDefaultView, describeView: describeView, qr: qr, fold: fold, headText: headText,
    groups: groupsOf, text: T, price: price, fileName: fileName
  }
  } catch (e) {}
})()
/* ===== sporta-catalogue.js - end ================================================================================ */
