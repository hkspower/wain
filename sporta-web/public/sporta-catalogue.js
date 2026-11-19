/* ===== sporta-catalogue.js - CATALOGUE-1118 =================================================================================
 * The live product catalogue: a "Catalogue" page in the shop's main menu and a PDF that is made from the live shop every time
 * someone presses Download (owner request 2026-11-18: "make dynamic catalogue for all current products ... pdf file with
 * downloadable link at backends ... and make page called catalogue at main menu with link updated live"; the owner chose: the page
 * and the PDF are PUBLIC, and the PDF is built IN THE BROWSER).
 *
 * WHO LOADS THIS FILE. It is not linked by the live index.html (a file not in that list is never loaded by the page itself). Two
 * callers add it on demand, as sporta-admin-brands.js does with its .full.js: the CATALOGUE-1118 block of sporta-features.js, only
 * when the address is /catalogue, and the ADMIN CATALOGUE PDF block of sporta-admin-brands.js, only when the dialog opens. Every
 * other page never downloads it (CSP is script-src 'self': a script a same-origin script adds is allowed).
 *
 * DATA. Only the shop's own PUBLIC routes, read with GET at the moment they are needed: api.php?r=products (what shoppers see:
 * the effective price, the list price, brand, category), r=stock (a size counts as available when in_stock; the quantity and the SKU
 * are never read into the page or the PDF) and r=brands. Nothing is written anywhere; the only storage is none. Product photos are
 * the files the shop already serves under /images/products/ (the first of images/image from the API, else <slug>.jpg|png|webp|jpeg,
 * the same names the compiled storefront uses; the 640px WebP copy when the variants.txt list in the responsive folder names one).
 *
 * THE PDF. Pages are drawn on a canvas with the shop's own fonts (Alexandria for titles, IBM Plex Arabic for text, from /fonts/),
 * so Arabic is shaped by the browser exactly as on the site, in either language, and any photo format the browser can decode is
 * accepted. Each page is encoded as a JPEG and written into a PDF 1.4 file by the writer below (no library): one page = one A4 image
 * plus one clickable link per product (a /URI action to its page on www.sporta.com.kw) and one on the site address. Text is part of
 * the picture, so it cannot be selected (the trade-off the owner accepted by choosing the browser method); the file is about 2-4 MB.
 * Photos are fetched, drawn and released one page at a time (nine per page), so a phone never holds all of them at once.
 *
 * DOM RULES. createElement + textContent only, no innerHTML, no eval, no console. Every network read is a same-origin GET.
 *
 * API (window.SportaCatalogue):
 *   load()                         -> Promise<{ products, at }>   the live catalogue, grouped order, sizes and photos resolved
 *   buildPdf({ products, lang, onProgress, signal }) -> Promise<{ blob, name, pages, bytes, count }>
 *   download(result)               save the blob as a file (a[download]; opens it in a tab where the browser cannot save)
 *   mountPage(host)                draw the /catalogue page into host; returns { destroy }
 *   pdfLink(lang)                  the shareable address that builds and downloads the PDF: /catalogue?pdf=ar|en
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
  var PER_PAGE = 9

  // ----------------------------------------------------------------------------------------------------------- strings
  var STR = {
    en: {
      eyebrow: 'SPORTA / THE CATALOGUE', h1: 'Sporta product catalogue',
      lead: 'Every current Sporta product with today\u2019s price and the sizes in stock. Download it as a PDF: it is made from the live shop each time, so it is always up to date.',
      products: 'Products: {n}', updated: 'Updated {t}', now: 'just now', ago: '{m} min ago',
      dl: 'Download PDF (English)', dlOther: 'Download PDF (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)', copy: 'Copy live PDF link', copied: 'Link copied', copyFail: 'Copy failed: select the address and copy it.',
      linkHint: 'Anyone who opens this link gets a PDF made from the live shop.',
      starting: 'Preparing the PDF\u2026', photos: 'Preparing page {i} of {n}\u2026', done: 'Your PDF is ready: {name} ({size}).', again: 'Download again', failed: 'The PDF could not be made. Try again.',
      all: 'All', search: 'Search the catalogue', none: 'No product matches.', loading: 'Reading the live catalogue\u2026', loadFailed: 'The catalogue could not be loaded.', retry: 'Try again',
      soldOut: 'Sold out', sizes: 'Sizes', oneSize: 'One size', off: '{n}% off', noPhoto: 'Photo coming soon', filter: 'Categories',
      coverTitle: 'Product catalogue', coverUpdated: 'Updated {d}', contents: 'Contents', page: 'Page', note: 'Prices in Kuwaiti dinar (KWD). Prices and sizes are always live on www.sporta.com.kw.',
      count: '{n} products'
    },
    ar: {
      eyebrow: 'سبورتا / الكتالوج', h1: 'كتالوج منتجات سبورتا',
      lead: 'جميع منتجات سبورتا الحالية بأسعار اليوم والمقاسات المتوفرة. حمّله بصيغة PDF: يُنشأ من المتجر مباشرةً في كل مرة، فهو محدَّث دائماً.',
      products: 'عدد المنتجات: {n}', updated: 'آخر تحديث: {t}', now: 'الآن', ago: 'منذ {m} د',
      dl: 'تحميل PDF (العربية)', dlOther: 'تحميل PDF (English)', copy: 'نسخ رابط PDF المباشر', copied: 'تم نسخ الرابط', copyFail: 'تعذّر النسخ: حدّد العنوان وانسخه.',
      linkHint: 'من يفتح هذا الرابط يحصل على ملف PDF مُنشأ من المتجر مباشرةً.',
      starting: 'جارٍ تجهيز ملف PDF\u2026', photos: 'جارٍ تجهيز الصفحة {i} من {n}\u2026', done: 'ملف PDF جاهز: {name} ({size}).', again: 'تحميل مرة أخرى', failed: 'تعذّر إنشاء ملف PDF. حاول مرة أخرى.',
      all: 'الكل', search: 'ابحث في الكتالوج', none: 'لا يوجد منتج مطابق.', loading: 'جارٍ قراءة الكتالوج المباشر\u2026', loadFailed: 'تعذّر تحميل الكتالوج.', retry: 'إعادة المحاولة',
      soldOut: 'نفدت الكمية', sizes: 'المقاسات', oneSize: 'مقاس واحد', off: 'خصم {n}%', noPhoto: 'الصورة قريباً', filter: 'الأقسام',
      coverTitle: 'كتالوج المنتجات', coverUpdated: 'آخر تحديث: {d}', contents: 'المحتويات', page: 'صفحة', note: 'الأسعار بالدينار الكويتي. الأسعار والمقاسات المحدّثة دائماً على www.sporta.com.kw.',
      count: '{n} منتج'
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
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^ | $/g, '') }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0 }
  function price(n, lang) { var s = num(n).toFixed(3); return lang === 'ar' ? s + '\u00a0\u062f.\u0643.' : 'KWD\u00a0' + s }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function getJson(route) {
    return fetch(API + route, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status)
      return r.json()
    })
  }
  function dateText(d, lang) {
    try { return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuwait' }).format(d) } catch (e) { return d.toISOString().slice(0, 10) }
  }
  function stamp(d) { return d.toISOString().slice(0, 10) }
  function sizeText(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' kB' }
  var SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']
  function sizeRank(s) {
    var u = String(s).toUpperCase().replace(/^XXL$/, '2XL').replace(/^XXXL$/, '3XL'), i = SIZE_ORDER.indexOf(u)
    if (i >= 0) return i
    var n = parseFloat(u)
    return isFinite(n) ? 100 + n : 1000
  }

  // -------------------------------------------------------------------------------------------------------- the data
  /** products + stock + brands -> the catalogue, in print order. A product with no stock rows has unknown sizes (none shown, not "sold out"). */
  function normalise(rows, stock, brands) {
    if (!Array.isArray(rows)) throw new Error('products')
    var bySlug = {}, brandBy = {}
    if (Array.isArray(stock)) stock.forEach(function (s) {
      if (!s || !s.slug) return
      var o = bySlug[s.slug] || (bySlug[s.slug] = { any: false, sizes: [] })
      o.any = true
      if (s.in_stock && o.sizes.indexOf(String(s.size)) < 0) o.sizes.push(String(s.size))
    })
    if (Array.isArray(brands)) brands.forEach(function (b) { if (b && b.slug) brandBy[b.slug] = b })
    var out = rows.map(function (p, i) {
      if (!p || !p.slug) return null
      var slug = String(p.slug), st = bySlug[slug], b = p.brand_slug ? (brandBy[p.brand_slug] || { slug: p.brand_slug, name_en: p.brand_name_en, name_ar: p.brand_name_ar }) : null
      var own = b && /^(sporta|sporta sports wear)$/i.test(String(b.slug || b.name_en || '')), pr = num(p.price), list = num(p.list_price) || pr
      var sizes = st ? st.sizes.slice().sort(function (a, c) { return sizeRank(a) - sizeRank(c) }) : []
      return {
        i: i, slug: slug, category: String(p.category || ''), featured: !!p.featured, sort: num(p.featured_sort),
        name: { en: clean(p.name_en) || slug, ar: clean(p.name_ar) || clean(p.name_en) || slug },
        brand: b && !own && (b.name_en || b.name_ar) ? { en: clean(b.name_en || b.name_ar), ar: clean(b.name_ar || b.name_en) } : null,
        price: pr, list: list, sale: !!p.on_sale && list > pr && pr > 0, pct: list > pr && list > 0 ? Math.round((1 - pr / list) * 100) : 0,
        sizes: sizes, known: !!st, soldOut: !!st && sizes.length === 0, photos: photoUrls(p, slug)
      }
    }).filter(Boolean)
    out.sort(function (a, b) {
      var ca = ORDER.indexOf(a.category), cb = ORDER.indexOf(b.category)
      if (ca < 0) ca = 99; if (cb < 0) cb = 99
      if (ca !== cb) return ca - cb
      if (ca === 99 && a.category !== b.category) return a.category < b.category ? -1 : 1
      if (a.featured !== b.featured) return a.featured ? -1 : 1
      if (a.featured && a.sort !== b.sort) return a.sort - b.sort
      return a.name.en < b.name.en ? -1 : a.name.en > b.name.en ? 1 : a.i - b.i
    })
    return out
  }
  function photoUrls(p, slug) {
    var out = []
    function add(u) {
      u = String(u == null ? '' : u)
      if (!u) return
      if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(u)) u = IMG + u
      if (!/^\/images\/[A-Za-z0-9._\/-]+$/.test(u) || u.indexOf('..') >= 0) return
      if (out.indexOf(u) < 0) out.push(u)
    }
    if (Array.isArray(p.images)) p.images.forEach(add)
    add(p.image)
    if (/^[a-z0-9-]+$/.test(slug)) ['jpg', 'png', 'webp', 'jpeg'].forEach(function (x) { add(slug + '.' + x) })
    return out
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
  function photoChain(p, vars) {
    var a = []
    if (vars && vars[p.slug]) a.push(IMG + 'responsive/' + p.slug + '-640.webp')
    return a.concat(p.photos)
  }
  function load() {
    return Promise.all([getJson('products'), getJson('stock').catch(function () { return null }), getJson('brands').catch(function () { return null })]).then(function (a) {
      return { products: normalise(a[0], a[1], a[2]), at: new Date() }
    })
  }
  function groupsOf(products) {
    var by = {}, out = []
    products.forEach(function (p) { var g = by[p.category]; if (!g) { g = by[p.category] = { key: p.category, name: CATS[p.category] || { en: p.category ? p.category.charAt(0).toUpperCase() + p.category.slice(1) : 'Other', ar: p.category || 'أخرى' }, items: [] }; out.push(g) } g.items.push(p) })
    return out
  }
  function productUrl(p, lang) { return ORIGIN + '/product/' + p.slug + (lang === 'en' ? '?lang=en' : '') }
  function pdfLink(lang) { return ORIGIN + '/catalogue?pdf=' + L(lang) }
  function fileName(lang, d) { return 'Sporta-' + (lang === 'ar' ? 'Catalogue-AR-' : 'Catalogue-EN-') + stamp(d) + '.pdf' }

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
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r)
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath()
  }
  function lines(g, text, maxW, maxLines) {
    var words = clean(text).split(' '), out = [], cur = ''
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
      out[maxLines - 1] = last.replace(/[ ,.\-]+$/, '') + '\u2026'
    }
    return out.map(function (s) { var t = s; while (t.length > 1 && g.measureText(t).width > maxW && t.slice(-1) !== '\u2026') t = t.slice(0, -1); return t })
  }
  function text(g, s, x, y, font, color, align, maxW) {
    g.font = font; g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic'
    if (maxW) g.fillText(s, x, y, maxW); else g.fillText(s, x, y)
  }
  function contain(g, bm, x, y, w, h, pad) {
    var bw = bm.width, bh = bm.height, s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), dw = bw * s, dh = bh * s
    g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
  function drawCard(g, p, bm, x, y, w, h, lang, links) {
    var ar = lang === 'ar', cx = x + w / 2
    g.fillStyle = C.white; rr(g, x, y, w, h, 20); g.fill(); g.lineWidth = 2; g.strokeStyle = C.line; rr(g, x + 1, y + 1, w - 2, h - 2, 20); g.stroke()
    var px = x + 12, py = y + 12, pw = w - 24, ph = 255
    g.fillStyle = C.plate; rr(g, px, py, pw, ph, 14); g.fill()
    if (bm) { g.save(); rr(g, px, py, pw, ph, 14); g.clip(); contain(g, bm, px, py, pw, ph, 10); g.restore() }
    else { g.direction = ar ? 'rtl' : 'ltr'; text(g, T(lang, 'noPhoto'), cx, py + ph / 2 + 8, fontOf('body', 24), C.mute, 'center', pw - 30) }
    if (p.soldOut) {
      g.fillStyle = 'rgba(255,255,255,.55)'; rr(g, px, py, pw, ph, 14); g.fill()
      g.fillStyle = 'rgba(23,26,30,.88)'; g.fillRect(px, py + ph / 2 - 24, pw, 48)
      g.direction = ar ? 'rtl' : 'ltr'; text(g, T(lang, 'soldOut'), cx, py + ph / 2 + 9, fontOf('bold', 25), C.white, 'center')
    }
    if (p.sale && p.pct > 0) {
      g.direction = 'ltr'; g.font = fontOf('bold', 23)
      var bt = '-' + p.pct + '%', bw = g.measureText(bt).width + 28, bx = ar ? px + pw - 12 - bw : px + 12
      g.fillStyle = C.brand; rr(g, bx, py + 12, bw, 40, 20); g.fill(); text(g, bt, bx + bw / 2, py + 40, fontOf('bold', 23), C.ink, 'center')
    }
    g.direction = ar ? 'rtl' : 'ltr'
    var ty = py + ph + 12, maxW = w - 36
    if (p.brand) { g.font = fontOf('semi', 20); var bn = lines(g, (ar ? p.brand.ar : p.brand.en), maxW, 1)[0]; text(g, ar ? bn : bn.toUpperCase(), cx, ty + 20, fontOf('semi', 20), C.mute, 'center'); ty += 28 }
    g.font = fontOf('semi', 27)
    var nm = lines(g, ar ? p.name.ar : p.name.en, maxW, 2)
    nm.forEach(function (ln, i) { text(g, ln, cx, ty + 26 + i * 33, fontOf('semi', 27), C.ink, 'center') })
    ty += 26 + (nm.length - 1) * 33 + 14
    // price line: the effective price, then (on sale) the struck list price, centred as one run
    var now = price(p.price, lang), was = p.sale ? price(p.list, lang) : ''
    g.font = fontOf('bold', 32); var nw = g.measureText(now).width, ww = 0
    if (was) { g.font = fontOf('body', 24); ww = g.measureText(was).width + 14 }
    var total = nw + ww, start = cx - total / 2
    var first = ar ? cx + total / 2 : start
    g.direction = ar ? 'rtl' : 'ltr'
    text(g, now, first, ty + 28, fontOf('bold', 32), C.ink, ar ? 'right' : 'left')
    if (was) {
      var wx = ar ? first - nw - 14 : first + nw + 14
      text(g, was, wx, ty + 26, fontOf('body', 24), C.mute, ar ? 'right' : 'left')
      g.strokeStyle = C.mute; g.lineWidth = 2; g.beginPath()
      if (ar) { g.moveTo(wx - (ww - 14), ty + 17); g.lineTo(wx, ty + 17) } else { g.moveTo(wx, ty + 17); g.lineTo(wx + (ww - 14), ty + 17) }
      g.stroke()
    }
    ty += 42
    var sz = p.soldOut ? '' : p.sizes.map(function (s) { return /^(one|os)$/i.test(s) ? T(lang, 'oneSize') : s }).join('\u2009\u00b7\u2009')
    if (sz) { g.font = fontOf('body', 20); var sl = lines(g, sz, maxW, 1)[0]; text(g, sl, cx, ty + 20, fontOf('body', 20), C.mute, 'center') }
    links.push({ x: x, y: y, w: w, h: h, url: productUrl(p, lang) })
  }
  function chrome(g, lang, title, n, total, d, links, logo) {
    var ar = lang === 'ar', lw = 0
    g.fillStyle = C.page; g.fillRect(0, 0, PW, PH)
    g.fillStyle = C.ink; g.fillRect(0, 0, PW, 132); g.fillStyle = C.brand; g.fillRect(0, 132, PW, 10)
    // the logo sits on the end side of the band, the title on the start side
    if (logo) { lw = 64 * logo.width / logo.height; g.drawImage(logo, ar ? MG : PW - MG - lw, 34, lw, 64) }
    g.direction = ar ? 'rtl' : 'ltr'
    text(g, title, ar ? PW - MG : MG, 86, fontOf('head', 46), C.white, ar ? 'right' : 'left', PW - MG * 2 - lw - 40)
    g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(MG, PH - 96); g.lineTo(PW - MG, PH - 96); g.stroke()
    text(g, 'www.sporta.com.kw', ar ? PW - MG : MG, PH - 54, fontOf('semi', 24), C.ink, ar ? 'right' : 'left')
    links.push({ x: ar ? PW - MG - 280 : MG, y: PH - 84, w: 280, h: 44, url: ORIGIN + '/' + (ar ? '' : '?lang=en') })
    text(g, T(lang, 'page') + ' ' + n + ' / ' + total, ar ? MG : PW - MG, PH - 54, fontOf('body', 24), C.mute, ar ? 'left' : 'right')
    text(g, T(lang, 'coverUpdated', { d: dateText(d, lang) }), PW / 2, PH - 54, fontOf('body', 22), C.mute, 'center')
  }
  function drawContent(g, lang, pg, bms, n, total, d, logo) {
    var links = [], ar = lang === 'ar'
    var title = (ar ? pg.cat.name.ar : pg.cat.name.en) + (pg.parts > 1 ? '  \u00b7  ' + pg.part + '/' + pg.parts : '')
    chrome(g, lang, title, n, total, d, links, logo)
    var gx = MG, gy = 190, gap = 26, cw = Math.floor((PW - MG * 2 - gap * 2) / 3), ch = 467
    pg.items.forEach(function (p, i) {
      var row = Math.floor(i / 3), col = i % 3; if (ar) col = 2 - col
      drawCard(g, p, bms[i], gx + col * (cw + gap), gy + row * (ch + gap), cw, ch, lang, links)
    })
    return links
  }
  function drawCover(g, lang, groups, pagesOf, count, total, d, logo) {
    var ar = lang === 'ar', links = [], R = ar ? PW - MG : MG, A = ar ? 'right' : 'left'
    g.fillStyle = C.ink; g.fillRect(0, 0, PW, PH); g.fillStyle = C.brand; g.fillRect(0, 0, PW, 18)
    g.direction = ar ? 'rtl' : 'ltr'
    if (logo) { var lw = 460, lh = lw * logo.height / logo.width; g.drawImage(logo, ar ? PW - MG - lw : MG, 130, lw, lh) }
    g.fillStyle = C.brand; g.fillRect(ar ? PW - MG - 120 : MG, 470, 120, 10)
    g.font = fontOf('head', 100); var tl = lines(g, T(lang, 'coverTitle'), PW - MG * 2, 2)
    tl.forEach(function (s, i) { text(g, s, R, 600 + i * 120, fontOf('head', 100), C.white, A) })
    var y = 600 + tl.length * 120 + 20
    text(g, T(lang, 'coverUpdated', { d: dateText(d, lang) }), R, y, fontOf('body', 38), C.sand, A)
    g.font = fontOf('bold', 34)
    var chip = T(lang, 'products', { n: count }), cwid = g.measureText(chip).width + 56, cx = ar ? PW - MG - cwid : MG
    g.fillStyle = C.brand; rr(g, cx, y + 40, cwid, 64, 32); g.fill(); text(g, chip, cx + cwid / 2, y + 84, fontOf('bold', 34), C.ink, 'center')
    var ty = Math.max(y + 190, 1000)
    text(g, T(lang, 'contents'), R, ty, fontOf('semi', 28), C.soft, A)
    g.strokeStyle = '#2d333b'; g.lineWidth = 2
    groups.forEach(function (gr, i) {
      var ry = ty + 40 + i * 76
      g.beginPath(); g.moveTo(MG, ry); g.lineTo(PW - MG, ry); g.stroke()
      text(g, ar ? gr.name.ar : gr.name.en, R, ry + 52, fontOf('semi', 36), C.white, A)
      text(g, T(lang, 'count', { n: gr.items.length }) + '  \u00b7  ' + T(lang, 'page') + ' ' + pagesOf[i], ar ? MG : PW - MG, ry + 50, fontOf('body', 28), C.sand, ar ? 'left' : 'right')
    })
    text(g, 'www.sporta.com.kw', R, PH - 150, fontOf('head', 46), C.brand, A)
    links.push({ x: ar ? PW - MG - 520 : MG, y: PH - 200, w: 520, h: 70, url: ORIGIN + '/' + (ar ? '' : '?lang=en') })
    g.font = fontOf('body', 24); var nl = lines(g, T(lang, 'note'), PW - MG * 2, 2)
    nl.forEach(function (s, i) { text(g, s, R, PH - 96 + i * 32, fontOf('body', 24), C.soft, A) })
    void total
    return links
  }

  // --------------------------------------------------------------------------------------------------- the PDF file
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u }
  function hex16(s) { var o = 'FEFF'; for (var i = 0; i < s.length; i++) o += ('0000' + s.charCodeAt(i).toString(16)).slice(-4).toUpperCase(); return '<' + o + '>' }
  function lit(s) { return '(' + String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') + ')' }
  function f2(n) { return (Math.round(n * 100) / 100).toString() }
  function pdfAssemble(pages, meta) {
    var chunks = [], pos = 0, offs = [], next = 4, k = 1, kids = []
    function push(u) { chunks.push(u); pos += u.length }
    function str(s) { push(ascii(s)) }
    var plan = pages.map(function (p) { var o = { img: next++, cont: next++, page: next++, ann: [] }; p.links.forEach(function () { o.ann.push(next++) }); kids.push(o.page + ' 0 R'); return o })
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
    var PWpt = 595.28, PHpt = 841.89, sc = PWpt / PW
    pages.forEach(function (p, i) {
      var o = plan[i]
      obj(o.img, '/Type /XObject /Subtype /Image /Width ' + PW + ' /Height ' + PH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.jpeg)
      obj(o.cont, '', ascii('q ' + f2(PWpt) + ' 0 0 ' + f2(PHpt) + ' 0 0 cm /Im0 Do Q'))
      obj(o.page, '/Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f2(PWpt) + ' ' + f2(PHpt) + '] /Resources << /XObject << /Im0 ' + o.img + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + o.cont + ' 0 R'
        + (o.ann.length ? ' /Annots [' + o.ann.map(function (a) { return a + ' 0 R' }).join(' ') + ']' : ''))
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
  function toJpeg(canvas) {
    return new Promise(function (ok, no) {
      canvas.toBlob(function (b) { if (!b) return no(new Error('jpeg')); b.arrayBuffer().then(function (ab) { ok(new Uint8Array(ab)) }, no) }, 'image/jpeg', 0.84)
    })
  }
  function tick() { return new Promise(function (ok) { setTimeout(ok, 0) }) }
  function check(sig) { if (sig && sig.aborted) { var e = new Error('cancelled'); e.cancelled = true; throw e } }

  /** Build the PDF from products (default: read them now). Resolves { blob, name, pages, bytes, count }. */
  function buildPdf(o) {
    o = o || {}
    var lang = L(o.lang), prog = o.onProgress || function () {}, sig = o.signal
    var d = new Date()
    var start = o.products ? Promise.resolve(o.products) : load().then(function (r) { return r.products })
    return start.then(function (products) {
      check(sig)
      if (!products.length) throw new Error('empty')
      var groups = groupsOf(products), plan = [], pagesOf = []
      groups.forEach(function (g) {
        pagesOf.push(plan.length + 2)
        var n = Math.ceil(g.items.length / PER_PAGE)
        for (var i = 0; i < n; i++) plan.push({ cat: g, items: g.items.slice(i * PER_PAGE, (i + 1) * PER_PAGE), part: i + 1, parts: n })
      })
      var total = plan.length + 1, out = [], canvas = document.createElement('canvas'); canvas.width = PW; canvas.height = PH
      var g2 = canvas.getContext('2d')
      return Promise.all([ensureFonts(), logoWhite(), variants()]).then(function (a) {
        var logo = a[1], vars = a[2]
        function finishPage(links) { return toJpeg(canvas).then(function (j) { out.push({ jpeg: j, links: links }) }) }
        prog({ i: 1, n: total })
        return tick().then(function () { check(sig); return finishPage(drawCover(g2, lang, groups, pagesOf, products.length, total, d, logo)) }).then(function () {
          var chain = Promise.resolve()
          plan.forEach(function (pg, idx) {
            chain = chain.then(function () {
              check(sig); prog({ i: idx + 2, n: total })
              return Promise.all(pg.items.map(function (p) { return firstPicture(photoChain(p, vars), 640) })).then(function (bms) {
                check(sig)
                var links = drawContent(g2, lang, pg, bms, idx + 2, total, d, logo)
                bms.forEach(release)
                return finishPage(links)
              }).then(tick)
            })
          })
          return chain
        }).then(function () {
          var title = T(lang, 'coverTitle') + ' \u2013 Sporta', blob = pdfAssemble(out, {
            lang: lang, title: title, subject: T(lang, 'coverUpdated', { d: dateText(d, lang) }),
            date: 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'
          })
          return { blob: blob, name: fileName(lang, d), pages: total, bytes: blob.size, count: products.length }
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
  var CSS = [
    '#sporta-catalogue{display:block}',
    '.scat{max-width:80rem;margin:0 auto;padding:3rem 1rem 4rem}',
    '.scat-head{display:grid;gap:.75rem;justify-items:center;text-align:center}',
    '.scat-status{display:flex;flex-wrap:wrap;gap:.25rem 1rem;justify-content:center;margin:.25rem 0 0;font-size:.875rem;font-weight:600}',
    '.scat-dot{display:inline-block;width:.625rem;height:.625rem;margin-inline-end:.4rem;border-radius:50%;background:#ff7b17;vertical-align:baseline}',
    '.scat-actions{display:flex;flex-wrap:wrap;gap:.75rem;justify-content:center;margin-top:1rem}',
    '.scat-actions .btn,.scat-copy{min-height:2.75rem}',
    '.scat-note{margin:.5rem 0 0;font-size:.875rem;min-height:1.3em}',
    '.scat-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between;margin:2rem 0 1rem}',
    '.scat-chips{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.scat-chip{min-height:2.75rem;padding:.4rem 1rem;border:1px solid #171a1e;border-radius:999px;background:#fff;color:#171a1e;font:inherit;font-weight:700;font-size:.875rem;cursor:pointer}',
    '.scat-chip[aria-pressed="true"]{background:#ff7b17;border-color:#ff7b17;color:#171a1e}',
    '.scat-search{min-height:2.75rem;min-width:min(100%,16rem);padding:.4rem .9rem;border:1px solid #171a1e;border-radius:.75rem;background:#fff;color:#171a1e;font:inherit}',
    '.scat-grid{display:grid;gap:1rem;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;padding:0;list-style:none}',
    '@media (min-width:768px){.scat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '@media (min-width:1100px){.scat-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    // The card, the chips and the search box are drawn white in every theme, so their text is named here (inherited, it would be the page's
    // light text on white in the dark theme).
    '.scat-card{position:relative;display:flex;flex-direction:column;overflow:hidden;border:1px solid #e2dbce;border-radius:1rem;background:#fff;color:#171a1e}',
    '.scat-badge{color:#171a1e}.scat-sold{color:#fff}',
    '.scat-link{display:flex;flex-direction:column;flex:1;color:inherit;text-decoration:none}',
    '.scat-link:focus-visible{outline:3px solid #b34d00;outline-offset:2px}',
    '.scat-photo{position:relative;aspect-ratio:4/5;background:#efeae0}',
    '.scat-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    '.scat-badge{position:absolute;top:.5rem;inset-inline-start:.5rem;padding:.2rem .6rem;border-radius:999px;font-size:.8125rem;font-weight:800}',
    '.scat-sold{position:absolute;inset-inline:0;top:50%;transform:translateY(-50%);padding:.4rem .5rem;text-align:center;font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}',
    '.scat-body{display:grid;gap:.25rem;padding:.75rem .75rem 1rem;text-align:center}',
    '.scat-brand{margin:0;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
    '.scat-name{margin:0;font-size:.9375rem;font-weight:700;line-height:1.35;text-align:center}',
    '.scat-price{margin:0;font-weight:800}.scat-was{margin-inline-start:.5rem;font-size:.8125rem;font-weight:500;opacity:.75}',
    '.scat-sizes{margin:0;font-size:.8125rem}',
    '.scat-empty{padding:3rem 0;text-align:center;font-weight:600}'
  ].join('')
  function styleOnce() { if (document.getElementById('sporta-catalogue-css')) return; var s = el('style'); s.id = 'sporta-catalogue-css'; s.textContent = CSS; document.head.appendChild(s) }
  function ago(at, lang) {
    var m = Math.floor((Date.now() - at.getTime()) / 60000)
    return m < 1 ? T(lang, 'now') : T(lang, 'ago', { m: m })
  }
  function setLd(products, lang, on) {
    var old = document.querySelector('script[data-sporta-catalogue-ld]'); if (old) old.remove()
    if (!on || !products.length) return
    var s = el('script'); s.type = 'application/ld+json'; s.setAttribute('data-sporta-catalogue-ld', '1')
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: T(lang, 'h1'), url: ORIGIN + '/catalogue' + (lang === 'en' ? '?lang=en' : ''), inLanguage: lang,
      mainEntity: { '@type': 'ItemList', numberOfItems: products.length, itemListElement: products.map(function (p, i) { return { '@type': 'ListItem', position: i + 1, url: ORIGIN + '/product/' + p.slug, name: lang === 'ar' ? p.name.ar : p.name.en } }) }
    })
    document.head.appendChild(s)
  }

  function mountPage(host) {
    styleOnce()
    var S = { lang: pageLang(), products: [], at: null, filter: 'all', q: '', phase: 'loading', build: null, url: '', busy: false, sig: '', vars: {} }
    var root = el('section', 'scat'); root.setAttribute('data-sporta-catalogue-page', '')
    var head = el('div', 'scat-head')
    var eyebrow = el('p', 'page-eyebrow'), h1 = el('h1', 'page-heading font-black'), lead = el('p', 'page-lead')
    var status = el('p', 'scat-status'); status.setAttribute('role', 'status')
    var actions = el('div', 'scat-actions')
    var btnA = el('button', 'btn btn-primary'), btnB = el('button', 'btn btn-ghost'), btnC = el('button', 'btn btn-ghost scat-copy')
    ;[btnA, btnB, btnC].forEach(function (b) { b.type = 'button' })
    btnA.setAttribute('data-scat', 'dl'); btnB.setAttribute('data-scat', 'dl-other'); btnC.setAttribute('data-scat', 'copy')
    var note = el('p', 'scat-note'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); note.setAttribute('data-scat', 'note')
    var againLink = el('a'); againLink.hidden = true; againLink.setAttribute('data-scat', 'again'); againLink.href = '#'
    actions.appendChild(btnA); actions.appendChild(btnB); actions.appendChild(btnC)
    ;[eyebrow, h1, lead, status, actions, note].forEach(function (n) { head.appendChild(n) }); note.appendChild(document.createTextNode('')); head.appendChild(againLink)
    var bar = el('div', 'scat-bar'), chips = el('div', 'scat-chips'), search = el('input', 'scat-search')
    chips.setAttribute('role', 'group'); search.type = 'search'; search.setAttribute('autocomplete', 'off'); search.setAttribute('data-scat', 'search')
    bar.appendChild(chips); bar.appendChild(search)
    var body = el('div'); body.setAttribute('data-scat', 'body')
    root.appendChild(head); root.appendChild(bar); root.appendChild(body); host.appendChild(root)
    var timer = 0, poll = 0, dead = false, objUrl = '', abort = null

    function lang() { return S.lang }
    function other() { return S.lang === 'ar' ? 'en' : 'ar' }
    function texts() {
      var l = lang()
      eyebrow.textContent = T(l, 'eyebrow'); h1.textContent = T(l, 'h1'); lead.textContent = T(l, 'lead')
      btnA.textContent = T(l, 'dl'); btnB.textContent = T(l, 'dlOther'); btnC.textContent = T(l, 'copy')
      search.placeholder = T(l, 'search'); search.setAttribute('aria-label', T(l, 'search')); chips.setAttribute('aria-label', T(l, 'filter'))
      againLink.textContent = T(l, 'again')
    }
    function statusLine() {
      var l = lang(); status.textContent = ''
      if (S.phase !== 'ready') return
      var a = el('span'); a.appendChild(el('span', 'scat-dot')); a.lastChild.setAttribute('aria-hidden', 'true'); a.appendChild(document.createTextNode(T(l, 'products', { n: S.products.length }))); status.appendChild(a)
      status.appendChild(el('span', '', T(l, 'updated', { t: ago(S.at, l) })))
    }
    function chipsDraw() {
      var l = lang(); chips.textContent = ''
      var cats = groupsOf(S.products), list = [{ key: 'all', label: T(l, 'all') + ' (' + S.products.length + ')' }]
      cats.forEach(function (g) { list.push({ key: g.key, label: (l === 'ar' ? g.name.ar : g.name.en) + ' (' + g.items.length + ')' }) })
      list.forEach(function (c) {
        var b = el('button', 'scat-chip', c.label); b.type = 'button'; b.setAttribute('aria-pressed', S.filter === c.key ? 'true' : 'false'); b.setAttribute('data-scat-cat', c.key)
        b.addEventListener('click', function () { S.filter = c.key; chipsDraw(); gridDraw() }); chips.appendChild(b)
      })
    }
    function visible() {
      var q = clean(S.q).toLowerCase()
      return S.products.filter(function (p) {
        if (S.filter !== 'all' && p.category !== S.filter) return false
        if (!q) return true
        return (p.name.en + ' ' + p.name.ar + ' ' + (p.brand ? p.brand.en + ' ' + p.brand.ar : '') + ' ' + p.slug).toLowerCase().indexOf(q) >= 0
      })
    }
    function photoImg(p, l) {
      var im = el('img'); im.alt = l === 'ar' ? p.name.ar : p.name.en; im.loading = 'lazy'; im.decoding = 'async'; im.width = 600; im.height = 750
      var chain = photoChain(p, S.vars).concat(['/product-photo-unavailable.svg']), i = 0
      im.addEventListener('error', function () { i++; if (i < chain.length) im.src = chain[i] })
      im.src = chain[0]
      return im
    }
    function card(p, l) {
      var li = el('li', 'scat-card'), a = el('a', 'scat-link'); a.href = '/product/' + p.slug + (l === 'en' ? '?lang=en' : '')
      a.setAttribute('data-scat-product', p.slug)
      var ph = el('div', 'scat-photo'); ph.appendChild(photoImg(p, l))
      if (p.sale && p.pct > 0) ph.appendChild(el('span', 'scat-badge bg-brand', T(l, 'off', { n: p.pct })))
      if (p.soldOut) ph.appendChild(el('span', 'scat-sold bg-ink', T(l, 'soldOut')))
      var b = el('div', 'scat-body')
      if (p.brand) b.appendChild(el('p', 'scat-brand', l === 'ar' ? p.brand.ar : p.brand.en))
      b.appendChild(el('h3', 'scat-name', l === 'ar' ? p.name.ar : p.name.en))
      var pr = el('p', 'scat-price'); pr.appendChild(el('span', 'scat-now', price(p.price, l)))
      if (p.sale) { var w = el('s', 'scat-was', price(p.list, l)); pr.appendChild(w) }
      b.appendChild(pr)
      if (!p.soldOut && p.sizes.length) b.appendChild(el('p', 'scat-sizes', T(l, 'sizes') + ': ' + p.sizes.map(function (s) { return /^(one|os)$/i.test(s) ? T(l, 'oneSize') : s }).join(' \u00b7 ')))
      a.appendChild(ph); a.appendChild(b); li.appendChild(a)
      return li
    }
    function gridDraw() {
      var l = lang(); body.textContent = ''
      if (S.phase === 'loading') { body.appendChild(el('p', 'scat-empty', T(l, 'loading'))); return }
      if (S.phase === 'error') {
        var p = el('p', 'scat-empty', T(l, 'loadFailed')), r = el('button', 'btn btn-primary', T(l, 'retry')); r.type = 'button'; r.addEventListener('click', refresh)
        body.appendChild(p); p.appendChild(document.createElement('br')); p.appendChild(r); return
      }
      var v = visible()
      if (!v.length) { body.appendChild(el('p', 'scat-empty', T(l, 'none'))); return }
      var ul = el('ul', 'scat-grid'); ul.setAttribute('data-scat', 'grid')
      v.forEach(function (p2) { ul.appendChild(card(p2, l)) }); body.appendChild(ul)
    }
    function draw() { texts(); statusLine(); chipsDraw(); gridDraw(); noteDraw() }
    function noteDraw() {
      var l = lang(), b = S.build
      againLink.hidden = true; note.firstChild.textContent = ''
      if (!b) return
      if (b.state === 'busy') note.firstChild.textContent = b.n ? T(l, 'photos', { i: b.i, n: b.n }) : T(l, 'starting')
      else if (b.state === 'fail') note.firstChild.textContent = T(l, 'failed')
      else if (b.state === 'done') { note.firstChild.textContent = T(l, 'done', { name: b.name, size: sizeText(b.bytes) }) + ' '; againLink.hidden = false; note.appendChild(againLink) }
      else if (b.state === 'copied') note.firstChild.textContent = T(l, 'copied')
      else if (b.state === 'copyfail') note.firstChild.textContent = T(l, 'copyFail')
    }
    function refresh() {
      if (dead) return Promise.resolve()
      if (S.phase !== 'ready') { S.phase = 'loading'; draw() }
      return Promise.all([load(), variants()]).then(function (r) {
        if (dead) return
        var sig = JSON.stringify(r[0].products.map(function (p) { return [p.slug, p.price, p.list, p.sizes.join(','), p.soldOut, p.photos[0]] }))
        S.vars = r[1]; S.at = r[0].at
        if (sig !== S.sig || S.phase !== 'ready') { S.sig = sig; S.products = r[0].products; S.phase = 'ready'; draw(); setLd(S.products, lang(), true) } else statusLine()
        autoStart()
      }, function () { if (dead) return; if (S.phase !== 'ready') { S.phase = 'error'; draw() } })
    }
    var autoDone = false
    function autoStart() {
      if (autoDone) return; autoDone = true
      var m = /[?&]pdf=(ar|en)\b/.exec(location.search); if (m) startBuild(m[1])
    }
    function startBuild(l) {
      if (S.busy || !S.products.length) return
      S.busy = true; abort = { aborted: false }
      S.build = { state: 'busy', i: 0, n: 0 }; noteDraw(); btnA.disabled = btnB.disabled = true
      buildPdf({ lang: l, signal: abort, onProgress: function (p) { if (S.build) { S.build.i = p.i; S.build.n = p.n; noteDraw() } } }).then(function (res) {
        if (dead) return
        S.build = { state: 'done', name: res.name, bytes: res.bytes, res: res }; objUrl = download(res); noteDraw()
      }, function (e) {
        if (dead) return
        S.build = e && e.cancelled ? null : { state: 'fail' }; noteDraw()
      }).then(function () { S.busy = false; btnA.disabled = btnB.disabled = false })
    }
    btnA.addEventListener('click', function () { startBuild(lang()) })
    btnB.addEventListener('click', function () { startBuild(other()) })
    againLink.addEventListener('click', function (e) { e.preventDefault(); if (S.build && S.build.res) download(S.build.res) })
    btnC.addEventListener('click', function () {
      var u = pdfLink(lang())
      function done(ok) { S.build = { state: ok ? 'copied' : 'copyfail' }; noteDraw() }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(u).then(function () { done(true) }, function () { done(false) }); return } } catch (e) { /* fall through */ }
      done(false)
    })
    search.addEventListener('input', function () { S.q = search.value; gridDraw() })
    // follow the site's language switch
    var lo = new MutationObserver(function () { var l = pageLang(); if (l !== S.lang) { S.lang = l; draw(); setLd(S.products, l, S.phase === 'ready') } })
    lo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    // live: the data is read again every minute while the page is open and when the tab comes back; the "updated" line follows the clock
    poll = setInterval(function () { if (!document.hidden) refresh() }, 60000)
    timer = setInterval(function () { if (S.phase === 'ready') statusLine() }, 30000)
    function vis() { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', vis)
    draw(); refresh(); ensureFonts()
    return {
      destroy: function () {
        dead = true; clearInterval(poll); clearInterval(timer); lo.disconnect(); document.removeEventListener('visibilitychange', vis)
        if (abort) abort.aborted = true
        setLd([], 'en', false); if (root.parentNode) root.parentNode.removeChild(root)
        void objUrl
      }
    }
  }

  window.SportaCatalogue = { version: 1, load: load, buildPdf: buildPdf, download: download, mountPage: mountPage, pdfLink: pdfLink, groups: groupsOf, text: T, price: price, fileName: fileName }
  } catch (e) {}
})()
/* ===== sporta-catalogue.js - end ================================================================================ */
