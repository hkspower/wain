/* Sporta — "مميزات سبورتا" features band on the home page.
 *
 * Why an add-on and not a React change: the live storefront is a compiled
 * bundle whose source is not in the repo (see VPS-SCAN-2026-10-31.md). This
 * script waits for the home hero slider (the <section> holding
 * .campaign-photo-hero) and inserts its own section directly after it. A
 * MutationObserver puts it back if React re-renders the page, and it is
 * removed again when the visitor navigates away from "/". External file on
 * purpose: the CSP forbids inline script (style-src allows inline styles).
 *
 * Design: the Sporta design system, campaign (dark) theme —
 *   surface #111113, raised #1e1f23, ink #f2f2f0, muted #9b9ca1,
 *   brand fill #ff7b17 with BLACK text (never white on orange),
 *   orange text #ff8f3d, hairline #3a3b40, radius 8px.
 * Only real service promises (README of the design system + live settings):
 * 24-hour delivery for 1 KWD, free 14-day returns, 100% authentic, WhatsApp
 * support on 22091914.
 */
(function () {
  'use strict'
  try {
  var ID = 'sporta-features'

  var T = {
    ar: {
      title: 'مميزات سبورتا',
      sub: 'ليش الكويت تتسوق ملابسها الرياضية من عندنا',
      shop: 'تسوّق الآن',
      wa: 'واتساب 22091914',
      items: [
        ['truck', 'توصيل خلال 24 ساعة', 'بـ 1 د.ك فقط — لجميع مناطق الكويت'],
        ['return', 'إرجاع واستبدال مجاني', 'خلال 14 يوم داخل الكويت'],
        ['shield', 'منتجات أصلية 100%', 'من الماركات مباشرة — بدون تقليد'],
        ['chat', 'دعم مباشر على واتساب', 'نرد عليك على 22091914']
      ]
    },
    en: {
      title: 'Sporta features',
      sub: 'Why Kuwait shops its sportswear with us',
      shop: 'Shop now',
      wa: 'WhatsApp 22091914',
      items: [
        ['truck', '24-hour delivery', 'Only 1 KWD — to every area of Kuwait'],
        ['return', 'Free returns & exchange', 'Within 14 days inside Kuwait'],
        ['shield', '100% authentic', 'Straight from the brands — no copies'],
        ['chat', 'WhatsApp support', 'Real people on 22091914']
      ]
    }
  }

  var ICON = {
    truck: [['path', { d: "M3 7h11v9H3z" }], ['path', { d: "M14 10h4l3 3v3h-7" }], ['circle', { cx: "7", cy: "17.5", r: "1.8" }], ['circle', { cx: "17", cy: "17.5", r: "1.8" }]],
    'return': [['path', { d: "M4 12a8 8 0 1 0 2.3-5.6" }], ['path', { d: "M4 4v4h4" }]],
    shield: [['path', { d: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" }], ['path', { d: "M8.5 12l2.5 2.5 4.5-5" }]],
    chat: [['path', { d: "M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z" }], ['path', { d: "M8.5 11h7M8.5 14h4.5" }]]
  }
  var WA_MARK = [['path', { fill: "#25D366", d: "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z" }]]

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function isHome() { return location.pathname === '/' || location.pathname === '/index.html' }

  function css() {
    if (document.getElementById(ID + '-css')) return
    var s = document.createElement('style')
    s.id = ID + '-css'
    s.textContent =
      '.sf{background:#111113;color:#f2f2f0;padding:56px 16px}' +
      '.sf *{box-sizing:border-box}' +
      '.sf__in{max-width:1248px;margin:0 auto;display:flex;flex-direction:column;gap:32px}' +
      '.sf__head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:24px}' +
      '.sf__titles{display:flex;flex-direction:column;gap:12px;align-items:flex-start}' +
      '.sf__eyebrow{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.2em;color:#ff7b17}' +
      '.sf__rule{display:block;width:80px;height:2px;background:#ff7b17}' +
      '.sf__title{margin:0;font-weight:800;font-size:clamp(32px,4.2vw,56px);line-height:1.15;color:#f2f2f0}' +
      '.sf__sub{margin:0;font-size:16px;line-height:26px;color:#9b9ca1}' +
      '.sf__cta{display:flex;flex-wrap:wrap;gap:12px}' +
      '.sf__btn{min-height:48px;padding:12px 24px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:10px;font-size:16px;font-weight:700;text-decoration:none;transition:background-color .15s,border-color .15s}' +
      '.sf__btn--shop{background:#ff7b17;color:#000}.sf__btn--shop:hover{background:#ff9545;color:#000}' +
      '.sf__btn--wa{border:1px solid #3a3b40;color:#f2f2f0;font-weight:600}.sf__btn--wa:hover{border-color:#9b9ca1;color:#fff}' +
      '.sf__btn:focus-visible{outline:2px solid #ff7b17;outline-offset:2px}' +
      '.sf__grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}' +
      '.sf__card{background:#1e1f23;border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:12px;min-height:180px}' +
      '.sf__icon{width:52px;height:52px;border-radius:8px;background:#ff7b17;display:inline-flex;align-items:center;justify-content:center;flex:none}' +
      '.sf__card h3{margin:0;font-size:20px;line-height:28px;font-weight:700;color:#f2f2f0}' +
      '.sf__card p{margin:0;font-size:15px;line-height:24px;color:#9b9ca1}' +
      '@media (max-width:1023px){.sf__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '@media (max-width:639px){.sf{padding:40px 16px}.sf__head{flex-direction:column;align-items:stretch}.sf__titles{align-items:center;text-align:center}' +
      '.sf__cta{flex-direction:column}.sf__btn{width:100%}.sf__grid{gap:12px}.sf__card{padding:18px 14px;min-height:0}' +
      '.sf__icon{width:44px;height:44px}.sf__card h3{font-size:17px;line-height:25px}.sf__card p{font-size:13px;line-height:21px}}' +
      '@media (prefers-reduced-motion:reduce){.sf__btn{transition:none}}'
    document.head.appendChild(s)
  }

  // The section is built with the DOM API. The icons and the WhatsApp mark are data (the parts of each icon, as
  // [element, attributes]), so nothing here turns a string into markup: a text is set as text.
  var SVG_NS = 'http://www.w3.org/2000/svg'
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = String(text)
    return n
  }
  function svgIcon(parts, size, stroke) {
    var s = document.createElementNS(SVG_NS, 'svg')
    s.setAttribute('width', String(size))
    s.setAttribute('height', String(size))
    s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('fill', 'none')
    if (stroke) {
      s.setAttribute('stroke', '#000')
      s.setAttribute('stroke-width', '2')
      s.setAttribute('stroke-linecap', 'round')
      s.setAttribute('stroke-linejoin', 'round')
    }
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('focusable', 'false')
    for (var i = 0; i < parts.length; i++) {
      var p = document.createElementNS(SVG_NS, parts[i][0])
      for (var k in parts[i][1]) if (Object.prototype.hasOwnProperty.call(parts[i][1], k)) p.setAttribute(k, parts[i][1][k])
      s.appendChild(p)
    }
    return s
  }

  function build() {
    var L = lang(), t = T[L], ar = L === 'ar'
    var sec = el('section', 'sf')
    sec.id = ID
    sec.setAttribute('dir', ar ? 'rtl' : 'ltr')
    sec.setAttribute('lang', L)
    sec.setAttribute('data-lang', L)
    sec.setAttribute('aria-labelledby', ID + '-title')

    var eyebrow = el('span', 'sf__eyebrow', 'WHY SPORTA')
    eyebrow.setAttribute('dir', 'ltr')
    var h2 = el('h2', 'sf__title', t.title)
    h2.id = ID + '-title'
    var titles = el('div', 'sf__titles')
    titles.appendChild(eyebrow)
    titles.appendChild(rule())
    titles.appendChild(h2)
    titles.appendChild(rule())
    titles.appendChild(el('p', 'sf__sub', t.sub))

    var shop = el('a', 'sf__btn sf__btn--shop')
    shop.setAttribute('href', '/shop' + (ar ? '' : '?lang=en'))
    shop.appendChild(document.createTextNode(t.shop))
    shop.appendChild(svgIcon([['path', { d: ar ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6' }]], 18, true))
    var wa = el('a', 'sf__btn sf__btn--wa')
    wa.setAttribute('href', 'https://wa.me/96522091914')
    wa.setAttribute('target', '_blank')
    wa.setAttribute('rel', 'noopener')
    wa.appendChild(svgIcon(WA_MARK, 20, false))
    wa.appendChild(document.createTextNode(t.wa))
    var cta = el('div', 'sf__cta')
    cta.appendChild(shop)
    cta.appendChild(wa)
    var head = el('div', 'sf__head')
    head.appendChild(titles)
    head.appendChild(cta)

    var grid = el('ul', 'sf__grid')
    t.items.forEach(function (it) {
      var li = el('li', 'sf__card')
      var icon = el('span', 'sf__icon')
      icon.appendChild(svgIcon(ICON[it[0]] || [], 26, true))
      li.appendChild(icon)
      li.appendChild(el('h3', null, it[1]))
      li.appendChild(el('p', null, it[2]))
      grid.appendChild(li)
    })

    var inner = el('div', 'sf__in')
    inner.appendChild(head)
    inner.appendChild(grid)
    sec.appendChild(inner)
    return sec
  }

  function rule() {
    var r = el('span', 'sf__rule')
    r.setAttribute('aria-hidden', 'true')
    return r
  }

  /** The home slider: the <section> that holds the campaign photo hero. */
  function heroSection() {
    var slide = document.querySelector('.campaign-photo-hero')
    return slide ? slide.closest('section') : null
  }

  function mount() {
    var existing = document.getElementById(ID)
    if (!isHome()) { if (existing) existing.remove(); return }
    var hero = heroSection()
    if (!hero || !hero.parentNode) return
    if (existing && existing.getAttribute('data-lang') === lang() && existing.previousElementSibling === hero) return
    if (existing) existing.remove()
    css()
    hero.parentNode.insertBefore(build(), hero.nextSibling)
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; mount() })
  }
  function start() {
    mount()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    window.addEventListener('popstate', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
  } catch (e) {}
})()

/* Product page: show only the sizes the product actually has (2026-11-02).
 *
 * The compiled product page renders its WHOLE ladder — S M L XL 2XL 3XL 4XL
 * 5XL ONE — for every product and greys out what is not in stock. So a
 * backpack (one variant, "ONE") showed nine dead clothing sizes, and shorts
 * stocked S–5XL also offered "ONE". The variants are already public
 * (/api/api.php?r=stock: slug, size, in_stock); this hides every size button
 * the product has NO variant for. A size that exists but is sold out stays,
 * greyed, exactly as before. If the stock list cannot be read, or names no
 * variant for this product, nothing is hidden — the page behaves as it did.
 * "ONE" is relabelled "One size" / "مقاس واحد" through a CSS ::after on the
 * button, so React's own text node is never touched. Leading ";" because this
 * file is two IIFEs back to back.
 */
;(function () {
  'use strict'
  try {
  var SIZE = /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|ONE)$/
  var stock = null, loading = false, stamp = 0

  function slug() {
    var m = /^\/product\/([^/?#]+)/.exec(location.pathname)
    return m ? decodeURIComponent(m[1]) : ''
  }
  function load() {
    if (loading || (stock && Date.now() - stamp < 60000)) return
    loading = true
    // A stalled request must not hold `loading` for ever (AbortSignal.timeout: Safari 16+,
    // skipped where the browser lacks it).
    var opts = { credentials: 'same-origin' }
    try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(20000) } catch (e) {}
    fetch('/api/api.php?r=stock', opts)
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        var rows = Array.isArray(j) ? j : (j && j.stock) || []
        var map = {}
        rows.forEach(function (r) {
          if (!r || !r.slug || !r.size) return
          ;(map[r.slug] = map[r.slug] || {})[String(r.size).toUpperCase()] = true
        })
        stock = map; stamp = Date.now()
      })
      // A failed or unreadable answer (network error, timeout, HTML or broken JSON with a 200)
      // counts as LOADED-BUT-UNKNOWN, exactly like a non-OK status: stock stays empty, the sizes
      // stay as the app draws them, and load() may ask again only after the 60 s window. Before
      // (2026-11-03, measured on the live product page with the API failing): stock stayed null,
      // apply() called load() again on the next animation frame, about 60 requests a second.
      .catch(function () { stock = {}; stamp = Date.now() })
      .then(function () { loading = false; schedule() })
  }
  function css() {
    if (document.getElementById('sporta-size-css')) return
    var s = document.createElement('style')
    s.id = 'sporta-size-css'
    s.textContent =
      '.catalog-product-options button[data-sporta-one] > span{font-size:0}' +
      '.catalog-product-options button[data-sporta-one] > span::after{content:"One size";font-size:.875rem}' +
      ':root[dir="rtl"] .catalog-product-options button[data-sporta-one] > span::after{content:"مقاس واحد"}' +
      '.catalog-product-options button[data-sporta-one]{padding-inline:16px;min-width:auto}'
    document.head.appendChild(s)
  }
  function apply() {
    var s = slug()
    if (!s) return
    if (!stock) { load(); return }
    var have = stock[s]
    if (!have) return
    var btns = document.querySelectorAll('.catalog-product-options button')
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i]
      var t = (b.textContent || '').trim().toUpperCase()
      if (!SIZE.test(t)) continue
      var hide = !have[t]
      if (hide && b.style.display !== 'none') { b.style.display = 'none'; b.setAttribute('data-sporta-nosize', '') }
      if (!hide && b.hasAttribute('data-sporta-nosize')) { b.style.display = ''; b.removeAttribute('data-sporta-nosize') }
      if (t === 'ONE' && !hide) { css(); b.setAttribute('data-sporta-one', '') }
    }
  }
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; apply() })
  }
  function start() {
    apply()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    window.addEventListener('popstate', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
  } catch (e) {}
})()

/* Brands on the storefront (2026-11-02): a brand header on /shop?brand=<slug>,
 * a link from the product page's maker mark to that page, and a fit guard for
 * the home strip's text-only tiles. One block because all three read the same
 * public list, fetched once per page load: /api/api.php?r=brands (slug,
 * name_en, name_ar, has_logo, logo_v, products = how many LISTED products
 * carry the brand). It is no-store and tiny — the logo bytes are never in it.
 *
 * 1. /shop?brand=<slug> already filters the grid, but said nothing about WHICH
 *    brand, had no way back, and for a brand with nothing tagged showed only
 *    "No matching products". One banner goes in just before .catalog-filters
 *    (else after .catalog-heading-copy): the logo on a white box (the logos
 *    are black on transparent) or the name as a wordmark, the name, the count,
 *    and a link to /shop ("All brands": it drops the brand, where the
 *    compiled "All" chip next to it drops the category). document.title follows while the banner is up and
 *    the compiled title comes back when the URL loses ?brand. An unknown or
 *    hidden slug gets nothing — the public list only carries shown brands.
 * 2. /product/<slug>: the maker in .campaign-brand-plate becomes a link to its
 *    brand page — an empty <a> laid OVER the mark, so React's own nodes are
 *    never moved (moving a node React owns is how a later re-render throws).
 *    Not added while the brand has no listed products: a link to an empty
 *    page is worse than no link.
 * 3. sporta-images.css sets the strip's text tiles in capitals in English; a
 *    long name ("EYESPORTWEAR") would then be wider than its 132px tile, so
 *    any tile that overflows gets a smaller font-size, measured, never guessed.
 *
 * DOM is built with createElement/textContent only: brand names come from the
 * database and are never parsed as HTML. Every step is wrapped so a failure
 * here can never take the shop page down with it.
 */
;(function () {
  'use strict'
  try {
  var BANNER = 'sporta-brand-banner'
  var PLATE = 'data-sporta-plate-link'
  var FIT = 'data-sporta-fit'
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
  var T = {
    en: { eyebrow: 'Brand', all: 'All brands', browse: 'Browse the full collection', site: 'Sporta', shop: 'Shop ' },
    ar: { eyebrow: 'الماركة', all: 'كل الماركات', browse: 'تصفّح كل المنتجات', site: 'سبورتا', shop: 'تسوّق ' }
  }
  var rows = null          // the public brand list once loaded ([] if it could not be read)
  var pending = null       // the one request per page load
  var titleSet = null      // the title this script last wrote
  var titleWas = null      // the compiled app's title it replaced

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ar' }
  function digits(n, L) { var s = String(n); return L === 'ar' ? s.replace(/[0-9]/g, function (d) { return AR_DIGITS.charAt(+d) }) : s }

  /* "{n} products" in the visitor's language. Arabic has five cases, and the
   * noun's form follows the last two digits, so the cases restart every
   * hundred: 103 takes the plural like 3, 111 the accusative singular like 11.
   * A round hundred and 101/102 take the genitive singular — "١٠٠ منتج",
   * "١٠١ منتج" — because "منتج واحد" / "منتجان" only stand for 1 and 2 alone. */
  function countLabel(n, L) {
    n = Math.max(0, Math.floor(Number(n) || 0))
    if (L === 'ar') {
      if (n === 0) return 'لا توجد منتجات'
      if (n === 1) return 'منتج واحد'
      if (n === 2) return 'منتجان'
      var h = n % 100
      if (h >= 3 && h <= 10) return digits(n, L) + ' منتجات'
      if (h >= 11) return digits(n, L) + ' منتجًا'
      return digits(n, L) + ' منتج'
    }
    if (n === 0) return 'No products'
    return n + (n === 1 ? ' product' : ' products')
  }
  // Read by scripts/addons-brands-test.mjs (and handy in the console).
  try { (window.SportaAddons = window.SportaAddons || {}).brandCount = countLabel } catch (e) {}

  function load() {
    if (pending) return pending
    pending = fetch('/api/api.php?r=brands', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : [] })
      .then(function (j) { rows = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []) })
      .catch(function () { rows = [] })
      .then(function () { schedule() })
    return pending
  }
  function low(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase() }
  function bySlug(s) {
    s = low(s)
    for (var i = 0; s && i < rows.length; i++) if (rows[i] && low(rows[i].slug) === s) return rows[i]
    return null
  }
  function byName(s) {
    s = low(s)
    for (var i = 0; s && i < rows.length; i++) {
      var b = rows[i]
      if (b && (low(b.name_en) === s || low(b.name_ar) === s)) return b
    }
    return null
  }
  /** null when the server did not say (an older api.php): then nothing is claimed. */
  function productCount(b) {
    var n = b ? b.products : null
    if (n === undefined || n === null || n === '') return null
    n = Number(n)
    return isFinite(n) ? Math.max(0, Math.floor(n)) : null
  }
  function hasLogo(b) { return b.has_logo === true || b.has_logo === 1 || b.has_logo === '1' }
  function nameOf(b, L) { return String((L === 'ar' ? b.name_ar : b.name_en) || b.name_en || b.name_ar || b.slug) }
  function langQuery() {
    try { var v = new URLSearchParams(location.search).get('lang'); return v === 'en' || v === 'ar' ? v : '' } catch (e) { return '' }
  }
  function shopHref(slug) {
    var q = []
    if (slug) q.push('brand=' + encodeURIComponent(slug))
    var l = langQuery()
    if (l) q.push('lang=' + l)
    return '/shop' + (q.length ? '?' + q.join('&') : '')
  }
  function el(tag, css, text) {
    var n = document.createElement(tag)
    if (css) n.style.cssText = css
    if (text != null) n.textContent = text
    return n
  }

  // ------------------------------------------------------------ 1. the banner
  function wordmark(b) {
    var text = String(b.name_en || b.name_ar || b.slug)
    var latin = /^[\x20-\x7e]+$/.test(text)
    var w = el('span', 'display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'font-size:' + (text.length > 9 ? 13 : 16) + 'px;line-height:1.2;font-weight:800;color:#171a1e' +
      (latin ? ';text-transform:uppercase;letter-spacing:.06em' : ''), text)
    w.setAttribute('dir', 'auto')
    return w
  }
  function buildBanner(b, L, key) {
    var t = T[L], n = productCount(b), ar = L === 'ar'
    var sec = el('section', 'box-sizing:border-box;width:100%;flex:1 1 100%;grid-column:1/-1;display:flex;flex-wrap:wrap;' +
      'align-items:center;gap:12px 16px;margin:16px 0;padding:16px;border-radius:16px;background:#171a1e;color:#fff')
    sec.id = BANNER
    sec.setAttribute('data-key', key)
    sec.setAttribute('dir', ar ? 'rtl' : 'ltr')
    sec.setAttribute('lang', L)
    sec.setAttribute('aria-labelledby', BANNER + '-title')

    // The mark. A logo box has a fixed size, so the image arriving moves
    // nothing; a wordmark box is sized once, at build time, by its text.
    var logo = hasLogo(b)
    var mark = el('div', 'flex:none;box-sizing:border-box;height:56px;border-radius:12px;background:#fff;display:flex;' +
      'align-items:center;justify-content:center;overflow:hidden;' +
      (logo ? 'width:112px;padding:6px' : 'min-width:112px;max-width:220px;padding:6px 14px'))
    mark.setAttribute('aria-hidden', 'true')
    if (logo) {
      var img = el('img', 'display:block;width:100%;height:100%;object-fit:contain')
      img.alt = ''
      img.width = 100
      img.height = 44
      img.decoding = 'async'
      img.addEventListener('error', function () {
        if (img.parentNode !== mark) return
        mark.removeChild(img)
        mark.style.width = ''
        mark.style.minWidth = '112px'
        mark.style.padding = '6px 14px'
        mark.appendChild(wordmark(b))
      })
      img.src = '/api/api.php?r=brand_logo&slug=' + encodeURIComponent(b.slug) + '&v=' + encodeURIComponent(b.logo_v || '')
      mark.appendChild(img)
    } else {
      mark.appendChild(wordmark(b))
    }
    sec.appendChild(mark)

    var copy = el('div', 'flex:1 1 160px;min-width:0')
    copy.appendChild(el('p', 'margin:0 0 2px;font-size:12px;line-height:16px;font-weight:700;color:#ff7b17' +
      (ar ? '' : ';text-transform:uppercase;letter-spacing:.12em'), t.eyebrow))
    var h = el('h2', 'margin:0;font-size:22px;line-height:1.3;font-weight:800;color:#fff;overflow-wrap:anywhere')
    h.id = BANNER + '-title'
    var hn = document.createElement('bdi')
    hn.textContent = nameOf(b, L)
    h.appendChild(hn)
    copy.appendChild(h)
    if (n !== null) {
      var p = el('p', 'margin:4px 0 0;font-size:14px;line-height:20px;color:#e2dbce')
      p.setAttribute('data-sporta-brand-count', '')
      if (n === 0) {
        // About THIS PAGE, not the stock: a brand with nothing tagged yet may
        // well be on sale in the shop ("Gymshark phone strap"), and "no Sporta
        // pieces" on Sporta's own shop would be false. The tag is what is missing.
        var bn = document.createElement('bdi')
        bn.textContent = nameOf(b, L)
        p.appendChild(document.createTextNode(ar ? 'لم نُضف قطع ' : 'We haven’t added '))
        p.appendChild(bn)
        p.appendChild(document.createTextNode(ar ? ' إلى هذه الصفحة بعد.' : ' pieces to this page yet.'))
      } else {
        p.textContent = countLabel(n, L)
      }
      copy.appendChild(p)
    }
    sec.appendChild(copy)

    var a = el('a', 'flex:none;margin-inline-start:auto;box-sizing:border-box;display:inline-flex;align-items:center;' +
      'justify-content:center;min-height:44px;padding:10px 20px;border-radius:999px;background:#ff7b17;color:#171a1e;' +
      'font-size:14px;line-height:20px;font-weight:800;text-decoration:none;white-space:nowrap',
      n === 0 ? t.browse : t.all)
    a.href = shopHref('')
    a.setAttribute('data-sporta-brand-clear', '')
    sec.appendChild(a)
    return sec
  }

  /* ---- BRAND-CLS-1112: hold the banner's place while the brand list loads (2026-11-12) ----------------------------
   * live-site-scan.mjs measured the highest layout shift on the site on /shop?brand=vanquish: CLS 0.078 (ar 390),
   * 0.085 (en 390), 0.033 (ar 1280); every other shop page 0-0.002. scripts/live-brand-cls-probe.mjs named the moving
   * element: div.catalog-empty (the compiled page's "no matching products" box, shown while its products load) at
   * y 210 -> 384 on a phone (250 -> 368 at 1280): the banner going in ABOVE it one frame after the page was painted.
   * A timeline of the live page (same probe) showed the brand list had answered long before (+2583 ms) the shop
   * rendered (+2935 ms); the banner still came at +2960, because the module's observer only schedules a
   * requestAnimationFrame, and the compiled app's commit had already been painted by then. Two parts, both here:
   *  1. SYNC: a MutationObserver of its own calls mountBanner() in the SAME microtask as the compiled app's commit
   *     (microtasks run before the browser paints), only on /shop?brand= and only while no banner and no reserve is
   *     on the page. mountBanner()'s own insert wakes it once; it finds the banner there and stops.
   *  2. RESERVE: if the list has NOT answered when the page renders, the banner's place is taken by a reserve built
   *     by buildBanner() itself (same box, padding, lines and button, so the same height) with a logo-sized mark and
   *     its content hidden. The real banner replaces it in one frame: nothing below moves. An unknown slug removes
   *     it (one shift, only for a link to a brand that does not exist). No request is made for it: no logo, no
   *     fetch. The shown slugs of the last list are remembered (localStorage "sporta_brand_slugs", a per-browser
   *     convenience; empty or blocked storage = reserve always), so after the first visit a slug that is not a
   *     shown brand gets no reserve and nothing moves there either.
   * Pages without ?brand= never see either (the observer returns on the path test). npm run test:brand-cls. */
  var RESERVE = BANNER + '-reserve'
  var SLUGS_KEY = 'sporta_brand_slugs'
  var slugsKept = false
  function keepSlugs() {
    if (slugsKept || !rows) return
    slugsKept = true
    if (!rows.length) return                               // the list could not be read: keep the last good one
    try {
      var s = []
      for (var i = 0; i < rows.length && s.length < 200; i++) if (rows[i] && rows[i].slug) s.push(low(rows[i].slug))
      localStorage.setItem(SLUGS_KEY, JSON.stringify(s))
    } catch (e) {}
  }
  function knownElsewhere(slug) {
    // true = reserve. Only a remembered list that lacks this slug says no.
    try {
      var s = JSON.parse(localStorage.getItem(SLUGS_KEY) || 'null')
      return !Array.isArray(s) || s.indexOf(low(slug)) >= 0
    } catch (e) { return true }
  }
  function dropReserve() {
    var r = document.getElementById(RESERVE)
    if (r && r.parentNode) r.parentNode.removeChild(r)
  }
  function reserveBanner(slug) {
    var filters = document.querySelector('.catalog-filters')
    var head = filters ? null : document.querySelector('.catalog-heading-copy')
    if (!filters && !head) return
    var r = document.getElementById(RESERVE)
    if (!r) {
      if (!knownElsewhere(slug)) return
      var L = lang()
      r = buildBanner({ slug: slug, name_en: slug, name_ar: slug, products: 10, has_logo: false }, L, '')
      r.id = RESERVE
      r.removeAttribute('aria-labelledby')
      r.removeAttribute('data-key')
      r.setAttribute('aria-hidden', 'true')
      // The mark as a logo box (fixed 112 x 56): a wordmark box is sized by the text, and the slug is not the name.
      var mark = r.firstElementChild
      while (mark.firstChild) mark.removeChild(mark.firstChild)
      mark.style.minWidth = ''
      mark.style.maxWidth = ''
      mark.style.width = '112px'
      mark.style.padding = '6px'
      var t = r.querySelector('h2')
      if (t) t.removeAttribute('id')
      var a = r.querySelector('a')
      if (a) { a.removeAttribute('href'); a.removeAttribute('data-sporta-brand-clear'); a.setAttribute('tabindex', '-1') }
      // The dark box shows (it reads as the banner loading); the words, the mark and the button do not.
      for (var c = r.firstElementChild; c; c = c.nextElementSibling) c.style.visibility = 'hidden'
    }
    if (filters) {
      if (r.nextElementSibling !== filters) filters.parentNode.insertBefore(r, filters)
    } else if (r.previousElementSibling !== head) {
      head.parentNode.insertBefore(r, head.nextSibling)
    }
  }
  function syncWatch() {
    if (window.__sportaBrandSync || !window.MutationObserver || !document.body) return
    window.__sportaBrandSync = true
    new MutationObserver(function () {
      try {
        if (!wantedSlug()) return
        if (document.getElementById(BANNER) || document.getElementById(RESERVE)) return
        if (rows && !bySlug(wantedSlug())) return          // settled: no such brand, nothing to put in
        if (!document.querySelector('.catalog-filters') && !document.querySelector('.catalog-heading-copy')) return
        mountBanner()
      } catch (e) {}
    }).observe(document.body, { childList: true, subtree: true })
  }
  try {
    if (document.body) syncWatch()
    else document.addEventListener('DOMContentLoaded', syncWatch, { once: true })
  } catch (e) {}
  /* ---- end BRAND-CLS-1112 (hooks: four lines marked BRAND-CLS-1112 in dropBanner and mountBanner) ---- */

  function onShop() { return /^\/shop\/?$/.test(location.pathname) }
  function wantedSlug() {
    if (!onShop()) return ''
    try { return (new URLSearchParams(location.search).get('brand') || '').trim() } catch (e) { return '' }
  }
  function setTitle(want) {
    if (document.title === want) { if (titleSet === null) titleSet = want; return }
    if (document.title !== titleSet) titleWas = document.title   // the compiled app's own, or a newer one
    titleSet = want
    document.title = want
  }
  function restoreTitle() {
    // Only if the title is still ours: a page the visitor moved on to may
    // already have written its own, and that one stays.
    if (titleSet !== null && document.title === titleSet && titleWas !== null) document.title = titleWas
    titleSet = null
    titleWas = null
  }
  function dropBanner() {
    var cur = document.getElementById(BANNER)
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur)
    dropReserve()                                          // BRAND-CLS-1112
    restoreTitle()
  }
  function mountBanner() {
    var slug = wantedSlug()
    if (!slug) { dropBanner(); return }
    if (!rows) { load(); reserveBanner(slug); return }    // BRAND-CLS-1112: reserveBanner
    keepSlugs()                                            // BRAND-CLS-1112
    var b = bySlug(slug)
    if (!b) { dropBanner(); return }
    var filters = document.querySelector('.catalog-filters')
    var head = filters ? null : document.querySelector('.catalog-heading-copy')
    if (!filters && !head) return                          // the page has not rendered yet
    var L = lang()
    var key = [b.slug, L, productCount(b), hasLogo(b) ? b.logo_v : '-', nameOf(b, 'en'), nameOf(b, 'ar'), langQuery()].join('|')
    var cur = document.getElementById(BANNER)
    if (cur && cur.getAttribute('data-key') !== key) { cur.parentNode.removeChild(cur); cur = null }
    if (!cur) cur = buildBanner(b, L, key)
    if (filters) {
      if (cur.nextElementSibling !== filters) filters.parentNode.insertBefore(cur, filters)
    } else if (cur.previousElementSibling !== head) {
      head.parentNode.insertBefore(cur, head.nextSibling)
    }
    dropReserve()                                          // BRAND-CLS-1112: same frame as the banner going in
    setTitle(nameOf(b, L) + ' — ' + T[L].site)
  }

  // ------------------------------------------------- 2. the product plate link
  function plateBrand(m) {
    var img = m.querySelector('img')
    if (img) {
      var src = img.getAttribute('src') || ''
      var s = /[?&]slug=([^&#]*)/.exec(src)
      if (s && /[?&]r=brand_logo(&|#|$)/.test(src)) {
        var bs = null
        try { bs = bySlug(decodeURIComponent(s[1].replace(/\+/g, ' '))) } catch (e) {}
        if (bs) return bs
      }
      var ba = byName(img.getAttribute('alt'))
      if (ba) return ba
    }
    return byName(m.textContent)
  }
  function mountPlates() {
    if (location.pathname.indexOf('/product/') !== 0) return
    var makers = document.querySelectorAll('.campaign-brand-plate__maker')
    if (!makers.length) return
    if (!rows) { load(); return }
    var L = lang()
    for (var i = 0; i < makers.length; i++) {
      var m = makers[i], a = null
      for (var c = m.firstElementChild; c; c = c.nextElementSibling) if (c.hasAttribute(PLATE)) a = c
      var b = plateBrand(m)
      if (!b || productCount(b) === 0) { if (a) m.removeChild(a); continue }
      var href = shopHref(b.slug), label = T[L].shop + nameOf(b, L)
      if (!a) {
        // Laid over the mark (and 8px past it, for a 44px-tall target) — it
        // takes no room, so the plate's flex row is exactly what it was.
        a = el('a', 'position:absolute;top:-8px;bottom:-8px;left:-4px;right:-4px;z-index:1;border-radius:8px')
        a.setAttribute(PLATE, '')
        if (getComputedStyle(m).position === 'static') m.style.position = 'relative'
        m.appendChild(a)
      }
      if (a.getAttribute('href') !== href) a.setAttribute('href', href)
      if (a.getAttribute('aria-label') !== label) { a.setAttribute('aria-label', label); a.title = label }
    }
  }

  // ------------------------------- 2b. the maker's mark on the product photo
  /* BRANDMARK-1118 (owner: "make brand logo at product page"). The maker of a product was only named in the plate under
   * the price (a phone shows it after the photo, the title, the description and the price, partly behind the buy bar). Now
   * the brand's logo is also on the photo itself, a white chip at the top corner on the START side (the right in Arabic)
   * that opens the brand's page, the way the plate's own link does. The brand is the one the plate already shows, read the
   * same way as above (the logo's slug in the plate, else its name, against the public list), so a product with no brand
   * tag gets nothing, and so does a name the list does not know: no claim is made that the data does not make.
   *  - A brand with a logo shows the logo (r=brand_logo, the same URL and cache key as the banner); one without shows its
   *    name as a wordmark; the shop's own label (slug "sporta") is NOT a product brand and gets no mark (owner, 2026-11-18). A logo that fails
   *    to load becomes the wordmark.
   *  - It is position:absolute inside the gallery's own relative box (the parent of .catalog-gallery-stage), so it takes no
   *    room and moves nothing, at any size, before or after the brand list arrives. It is a sibling of the stage, not a
   *    child, so the stage's own tap (the zoom viewer) and swipe never see it. The compiled app's nodes are not moved:
   *    one node is appended, and it is rebuilt when the brand, the language or the logo changes (key) and removed when the
   *    product has none or the page is not a product.
   *  - 44px tall, so the whole chip is a touch target. createElement/textContent only. */
  var MARK = 'data-sporta-brandmark'
  function dropMarks() {
    var old = document.querySelectorAll('[' + MARK + ']')
    for (var i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i])
  }
  function markWord(b, L) {
    var text = nameOf(b, L), latin = /^[\x20-\x7e]+$/.test(text)
    var w = el('span', 'display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'font-size:' + (text.length > 11 ? 12 : 14) + 'px;line-height:1.2;font-weight:800;color:#171a1e' +
      (latin ? ';text-transform:uppercase;letter-spacing:.06em' : ''), text)
    w.setAttribute('dir', 'auto')
    return w
  }
  function buildMark(b, L, key, linked) {
    var name = nameOf(b, L)
    var css = 'position:absolute;top:12px;inset-inline-start:12px;z-index:3;box-sizing:border-box;display:flex;align-items:center;' +
      'justify-content:center;height:44px;min-width:44px;max-width:calc(100% - 24px);padding:6px 10px;border-radius:12px;' +
      'background:rgba(255,255,255,.94);color:#171a1e;text-decoration:none;' +
      'box-shadow:0 1px 2px rgba(23,26,30,.14),0 4px 14px rgba(23,26,30,.12)'
    var box = el(linked ? 'a' : 'span', css)
    box.setAttribute(MARK, '')
    box.setAttribute('data-key', key)
    box.setAttribute('dir', L === 'ar' ? 'rtl' : 'ltr')
    box.setAttribute('lang', L)
    if (linked) {
      box.href = shopHref(b.slug)
      box.setAttribute('aria-label', T[L].shop + name)
      box.title = T[L].shop + name
    }
    // (2026-11-18, owner: "dont use sporta as product brand": the shop is not the maker of what it sells, so its own logo is no longer
    // a brand mark here: a brand with no upload shows its name, and a product tagged "sporta" gets no mark at all, see mountMark)
    var src = hasLogo(b)
      ? '/api/api.php?r=brand_logo&slug=' + encodeURIComponent(b.slug) + '&v=' + encodeURIComponent(b.logo_v || '')
      : ''
    if (src) {
      var img = el('img', 'display:block;width:96px;height:30px;object-fit:contain')
      img.alt = linked ? '' : name
      img.width = 96
      img.height = 30
      img.decoding = 'async'
      img.addEventListener('error', function () {
        if (img.parentNode !== box) return
        box.removeChild(img)
        box.appendChild(markWord(b, L))
        if (!linked) box.setAttribute('aria-label', name)
      })
      img.src = src
      box.appendChild(img)
    } else {
      box.appendChild(markWord(b, L))
    }
    return box
  }
  function mountMark() {
    if (location.pathname.indexOf('/product/') !== 0) { dropMarks(); return }
    var maker = document.querySelector('.campaign-brand-plate__maker')
    var stage = document.querySelector('.catalog-gallery-stage')
    var holder = stage ? stage.parentElement : null
    if (!maker || !holder) { dropMarks(); return }
    if (!rows) { load(); return }
    var b = plateBrand(maker)
    if (!b || low(b.slug) === 'sporta') { dropMarks(); return }    // no brand tag, or the shop's own label: no claim of a maker
    var L = lang(), linked = productCount(b) !== 0
    var key = [b.slug, L, hasLogo(b) ? b.logo_v : '-', nameOf(b, 'en'), nameOf(b, 'ar'), linked ? langQuery() : 'x'].join('|')
    var cur = holder.querySelector(':scope > [' + MARK + ']')
    if (cur && cur.getAttribute('data-key') !== key) { cur.parentNode.removeChild(cur); cur = null }
    if (cur) return
    dropMarks()                                    // one only, whichever product the page showed before
    holder.appendChild(buildMark(b, L, key, linked))
  }

  // ---------------------------------------------- 3. home strip: fit the text
  function fitStrip() {
    var spans = document.querySelectorAll('.brand-bar__item > span')
    var en = lang() === 'en'
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i]
      if (!en) { if (s.hasAttribute(FIT)) { s.style.fontSize = ''; s.removeAttribute(FIT) } continue }
      var item = s.parentNode
      var key = s.textContent + '|' + item.clientWidth
      if (s.getAttribute(FIT) === key) continue
      s.style.fontSize = ''
      var cs = getComputedStyle(item)
      var room = item.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 4
      var r = document.createRange()
      r.selectNodeContents(s)
      var w = r.getBoundingClientRect().width
      if (room > 0 && w > room) {
        var fs = parseFloat(getComputedStyle(s).fontSize) || 15
        s.style.fontSize = Math.max(10, Math.floor(fs * room / w * 2) / 2) + 'px'
      }
      s.setAttribute(FIT, key)
    }
  }

  // ------------------------------------- 4. /about: the brand names are live
  /* The About page (a compiled React page, no source here) names the brands in
   * three sentences — the lead under the title, the "Brands worth training in"
   * card, and the answer to "Which brands do you carry?" — plus the same FAQ
   * answer in its FAQPage JSON-LD. All static text, so the admin's Brands screen
   * did not control any of it. This swaps ONLY the brand-name run in each, from
   * the list already fetched above (the public r=brands: shown brands, in the
   * order the API sends them), and keeps every other character the live build
   * has. Rules that keep it safe:
   *   - text nodes only: the one text node of the <p> gets a new nodeValue. No
   *     element is added, moved or removed, so React's tree is never touched, and
   *     a re-render that rewrites the node (language toggle, route change) is
   *     simply answered by writing the run again.
   *   - a sentence is recognised by its fixed words either side of the run
   *     (prefix and suffix below, copied from the live build) and by its heading
   *     for the card and the FAQ. Reworded copy → no match → left alone.
   *   - nothing to say (API down, empty list) → nothing written: the static
   *     names stay, which are the owner's last known list.
   *   - the join follows the language: English "A, B and C", Arabic "أ، ب وج" in
   *     all three sentences (the live card joined with a bare "و" between all, which
   *     cannot be read once an API name has several words: "جيم شارك و..."). SPORTA
   *     is the shop's OWN label wherever the API lists it: the row is taken out of
   *     the run and named last as "our own SPORTA label", as the live sentences do,
   *     so it is never presented as one of "the world's leading brands" (the live
   *     list sends it FIRST). The other names keep the API order.
   *   - Latin names inside Arabic text (and Arabic names inside English) are
   *     wrapped in FSI…PDI so punctuation next to them cannot flip. The JSON-LD
   *     gets the plain names.
   *   - the writes happen with the observers disconnected (quiet()), so this
   *     module never wakes itself; it only runs again when React changes the DOM.
   * Runs on /about only, and only once the page has rendered; it does not ask
   * for the list before then. */
  var ABOUT_ATTR = 'data-sporta-brands'
  var FSI = '⁨', PDI = '⁩'
  var ABOUT = {
    lead: {
      ar: { pre: 'موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا — ', suf: '.', own: 'علامتنا الخاصة سبورتا' },
      en: { pre: 'The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands — ', suf: '.', own: 'our own SPORTA label' }
    },
    card: {
      head: { ar: 'ماركات تستحق التمرين بها', en: 'Brands worth training in' },
      ar: { pre: '', suf: '.', own: 'ماركتنا الخاصة سبورتا' },
      en: { pre: '', suf: '.', own: 'our own SPORTA label' }
    },
    faq: {
      head: { ar: 'ما الماركات المتوفرة لديكم؟', en: 'Which brands do you carry?' },
      ar: { pre: '', suf: ' — ملابس رياضية وهوديز وإكسسوارات جيم.', own: 'ماركتنا الخاصة سبورتا' },
      en: { pre: '', suf: ' — activewear, hoodies and gym accessories.', own: 'our own SPORTA label' }
    }
  }

  function onAbout() { return /^\/about\/?$/.test(location.pathname) }
  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }

  /** The shown brands, in API order, named in language L; [] when there is nothing to say. */
  function aboutNames(L) {
    var out = []
    for (var i = 0; rows && i < rows.length; i++) {
      var b = rows[i]
      if (!b || typeof b !== 'object') continue
      var n = squash(L === 'ar' ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar))
      if (n) out.push({ n: n, slug: low(b.slug) })
    }
    return out
  }
  function isolate(n, L) {
    return (L === 'ar' ? /[A-Za-z]/ : /[؀-ۿ]/).test(n) ? FSI + n + PDI : n
  }
  /** The run of names for one sentence template. `plain` = no bidi marks (JSON-LD). */
  function aboutRun(list, L, tpl, plain) {
    if (!list.length) return ''
    var parts = [], own = false
    for (var i = 0; i < list.length; i++) {
      if (!own && list[i].slug === 'sporta') own = true        // the shop's own label: named last, wherever the API puts it
      else parts.push(plain ? list[i].n : isolate(list[i].n, L))
    }
    if (own) parts.push(tpl.own)
    if (parts.length === 1) return parts[0]
    var last = parts[parts.length - 1], head = parts.slice(0, -1)
    if (L === 'ar') return head.join('، ') + ' و' + last
    return head.join(', ') + ' and ' + last
  }
  /** The middle of `text` between the template's fixed words, or null if it is not that sentence. */
  function aboutMid(text, tpl) {
    if (text.length <= tpl.pre.length + tpl.suf.length) return null
    if (text.indexOf(tpl.pre) !== 0) return null
    if (text.lastIndexOf(tpl.suf) !== text.length - tpl.suf.length) return null
    var mid = text.slice(tpl.pre.length, text.length - tpl.suf.length)
    return mid.length <= 600 ? mid : null
  }
  function onlyText(el) {
    return el && el.childNodes.length === 1 && el.firstChild.nodeType === 3 ? el.firstChild : null
  }
  /** Which language's wording an element carries ('' = neither). */
  function aboutLang(text, tpls, head, headText) {
    var ls = ['ar', 'en']
    for (var i = 0; i < ls.length; i++) {
      if (head && squash(headText) !== head[ls[i]]) continue
      if (aboutMid(text, tpls[ls[i]]) !== null) return ls[i]
    }
    return ''
  }

  function aboutTargets() {
    var page = document.querySelector('main .editorial-page') || document.querySelector('.editorial-page')
    var found = []
    if (!page) return found
    var lead = page.querySelector('p.page-lead')
    if (lead) found.push({ kind: 'lead', el: lead, head: null })
    var cards = page.querySelectorAll('.why-card')
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('h3'), p = cards[i].querySelector('p')
      if (h && p) found.push({ kind: 'card', el: p, head: h.textContent })
    }
    var qs = page.querySelectorAll('.faq-list > details')
    for (var j = 0; j < qs.length; j++) {
      var s = qs[j].querySelector('summary'), a = qs[j].querySelector('p')
      if (s && a) found.push({ kind: 'faq', el: a, head: s.textContent })
    }
    return found
  }

  function mountAbout() {
    if (!onAbout()) return
    var targets = aboutTargets()
    if (!targets.length) return                              // the page has not rendered yet
    if (!rows) { load(); return }
    if (!rows.length) return                                 // API down or empty: the static names stay
    var writes = []
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], tpls = ABOUT[t.kind], tn = onlyText(t.el)
      if (!tn) continue
      var text = tn.nodeValue
      var L = aboutLang(text, tpls, t.head === null ? null : tpls.head, t.head)
      if (!L) continue
      var list = aboutNames(L)
      var run = aboutRun(list, L, tpls[L], false)
      if (!run) continue
      var want = tpls[L].pre + run + tpls[L].suf
      var sig = L + ':' + list.map(function (x) { return x.slug }).join(',')
      if (text !== want) writes.push([tn, want, t.el, sig])
      else if (t.el.getAttribute(ABOUT_ATTR) !== sig) writes.push([null, null, t.el, sig])
    }
    // The FAQPage JSON-LD the route writes into <head>: same answer, plain names.
    var ld = document.querySelectorAll('script[type="application/ld+json"]')
    for (var k = 0; k < ld.length; k++) {
      var raw = ld[k].textContent || ''
      if (raw.indexOf('FAQPage') < 0) continue
      var doc = null
      try { doc = JSON.parse(raw) } catch (e) { continue }
      var changed = false
      ;(function walk(o) {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { for (var m = 0; m < o.length; m++) walk(o[m]); return }
        var ans = o.acceptedAnswer
        if (o['@type'] === 'Question' && ans && typeof ans.text === 'string') {
          var ls = ['ar', 'en']
          for (var n = 0; n < ls.length; n++) {
            var tp = ABOUT.faq[ls[n]]
            if (squash(o.name) !== ABOUT.faq.head[ls[n]] || aboutMid(ans.text, tp) === null) continue
            var rn = aboutRun(aboutNames(ls[n]), ls[n], tp, true)
            if (rn && ans.text !== tp.pre + rn + tp.suf) { ans.text = tp.pre + rn + tp.suf; changed = true }
          }
        }
        for (var key in o) if (Object.prototype.hasOwnProperty.call(o, key)) walk(o[key])
      })(doc)
      if (changed) writes.push([ld[k], JSON.stringify(doc), ld[k], 'jsonld'])
    }
    if (!writes.length) return
    // A shorter sentence must not pull the page up under the reader (scan 2026-11-11: the Arabic lead went from two
    // lines to one at 1280px and the whole page below it jumped 32px, layout shift 0.22). The block that held the old
    // text keeps its height as a floor; the first height seen is the one kept, so a later rewrite cannot ratchet it.
    var before = []
    for (var hb = 0; hb < writes.length; hb++) before.push(writes[hb][3] === 'jsonld' || !writes[hb][0] ? 0 : writes[hb][2].getBoundingClientRect().height)
    quiet(function () {
      for (var w = 0; w < writes.length; w++) {
        var x = writes[w]
        if (x[3] === 'jsonld') x[0].textContent = x[1]
        else if (x[0]) x[0].nodeValue = x[1]
        x[2].setAttribute(ABOUT_ATTR, x[3] === 'jsonld' ? 'ld' : x[3])
      }
      for (var hw = 0; hw < writes.length; hw++) {
        var el = writes[hw][2]
        if (!before[hw] || el.style.minHeight) continue
        if (el.getBoundingClientRect().height < before[hw] - 0.5) el.style.minHeight = before[hw] + 'px'
      }
    })
  }

  function run() {
    try { mountBanner() } catch (e) {}
    try { mountPlates() } catch (e) {}
    try { mountMark() } catch (e) {}                       // BRANDMARK-1118
    try { fitStrip() } catch (e) {}
    try { mountAbout() } catch (e) {}
  }
  var queued = false
  var watched = []         // [observer, target, options] — quiet() pauses them around our own writes
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; run() })
  }
  function watch(target, opts) {
    try {
      if (!target) return
      var mo = new MutationObserver(schedule)
      mo.observe(target, opts)
      watched.push([mo, target, opts])
    } catch (e) {}
  }
  /** Run fn with every observer disconnected, then watch again: a write of ours is never seen as a change. */
  function quiet(fn) {
    var i
    for (i = 0; i < watched.length; i++) watched[i][0].disconnect()
    try { fn() } finally {
      for (i = 0; i < watched.length; i++) { try { watched[i][0].observe(watched[i][1], watched[i][2]) } catch (e) {} }
    }
  }
  function start() {
    run()
    // React re-renders (and SPA navigation, which re-renders) → body; the
    // language toggle → <html lang>; the compiled app writing its own title
    // over ours → <head>. Each only schedules: one run per frame at most.
    // React also updates IN PLACE: product → product can change nothing but
    // the maker logo's src (or alt) and text nodes, which childList alone does
    // not see — so those are watched too. Nothing run() writes is one of them
    // (it sets href/aria-label/title/style and adds nodes), so this cannot loop.
    watch(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'alt'] })
    watch(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    watch(document.head, { childList: true, subtree: true, characterData: true })
    window.addEventListener('popstate', schedule)
    window.addEventListener('resize', schedule)
    try {
      // A web font arriving changes every width the fit guard measured.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
        var s = document.querySelectorAll('[' + FIT + ']')
        for (var i = 0; i < s.length; i++) s[i].removeAttribute(FIT)
        schedule()
      })
    } catch (e) {}
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
  } catch (e) {}
})()

/* Small copies of the product photographs (2026-11-03, page weight).
 *
 * The compiled storefront gives an <img srcset> to exactly the ~33 photographs
 * it was built with (a hard-coded file list in its own bundle) and to nothing
 * else. Every photograph the admin uploads - which is lossless on purpose, so
 * it arrives at 3000-4000 px and up to 10 MiB - is sent FULL SIZE to a 300px
 * shop card, and every photograph, built-in or uploaded, is sent full size to
 * the 72px bag-drawer thumbnail, the 80px cart line, the 48px checkout row and
 * the 64px gallery thumbnail.
 *
 * scripts/make-image-variants.mjs, run on the server, makes small WebP copies
 * BESIDE the originals (/images/products/responsive/<stem>-320.webp, -640.webp;
 * the originals are never touched) and writes /images/products/responsive/
 * variants.txt, one line per photograph that has copies:
 *     # sporta-variants v1
 *     <stem> 320,640
 * This block reads that list and, for an <img> that shows one of those
 * photographs at thumbnail size or as a shop card, puts a srcset of the copies
 * on it (with a matching sizes). `src` is never changed, so the original stays
 * the fallback for anything that cannot use srcset.
 *
 * WHEN IT ACTS. React sets an <img>'s `src` last and the browser asks for the
 * file at that instant, long before the element is in the page; an observer is
 * too late (measured with a throttled server: the bag drawer's and the cart
 * line's originals were downloaded in full and the copies after them). So the
 * work is done in an early hook on Element.prototype.setAttribute that only
 * does anything for `src` on an <img>: the srcset goes on first, in the same
 * call, and the first and only request is the copy. A MutationObserver and an
 * animation-frame pass catch what the hook cannot (the list arriving after the
 * app drew, `src` set another way) - but only for loading="lazy" images, which
 * have not been asked for yet; an eager one that is already on its way is left
 * to finish, because switching it would add a download instead of saving one.
 * The list is remembered in localStorage, so every visit after the first knows
 * it when the app first draws. Honest limit: on a cold first load the app can
 * draw before this script has even arrived (deferred scripts run in order, but
 * the app's first render is its own task); the eager thumbnails of that first
 * render are then fetched as before, and every later screen is hooked.
 *
 * WHY IT CANNOT SHOW A BROKEN OR WRONG PICTURE
 *  - No list (404, not our header line, network error, nothing remembered) = this
 *    block changes nothing on the page: it is exactly what it was. A copy that the
 *    list does not name is never requested, so a missing copy costs no 404 (the
 *    site answers a missing file with its error page).
 *  - ...and asking for the list is not free either, which the first version of
 *    this block overlooked (review, 2026-11-04): until somebody runs the maker, the
 *    list's URL answers 404 with the whole error shell (19 kB, 6.3 kB Brotli on the
 *    live shell; 27 kB / 10 kB gzip for the shell this repo builds), and a 404 is
 *    not cached, so EVERY full page load of EVERY visitor paid that for nothing.
 *    A miss is therefore remembered (MISS below): for MISS_MS the block neither asks
 *    for the list, hooks setAttribute nor watches the page. The price is that a list
 *    made by a later maker run reaches a browser that recorded a miss up to MISS_MS
 *    late; a browser with nothing recorded (a first visit) asks at once.
 *  - If a named copy still fails, an `error` listener on window in the CAPTURE
 *    phase (it runs before the image's own handler) removes our srcset, so the
 *    browser loads the original from `src`, remembers the photograph as bad for
 *    this page, and stops the event. Stopping it matters: the compiled onError
 *    swaps in the "photo unavailable" placeholder, which would replace a perfectly
 *    good original. A failure of the ORIGINAL is not ours (our srcset is gone by
 *    then) and reaches the compiled handler exactly as before.
 *  - React can change an <img>'s src in place (a cart line reused for another
 *    piece). The hook and the scan compare the src and srcset with what was
 *    written; if either differs, ours is removed first, so the old piece's copy
 *    can never stay up under a new piece. An <img> that already has a srcset
 *    (the build's own) is never touched.
 *  - Not the product gallery's main photograph (it is zoomed to 2.5x and has a
 *    full-screen view: it keeps the original) and not anything on /backends.
 *  - Every step is in try/catch and the hook always ends in the real
 *    setAttribute call with the caller's own arguments: a failure here can never
 *    reach the shop.
 */
;(function () {
  'use strict'
  try {
    if (!window.MutationObserver || !window.WeakMap || !window.fetch || !document.querySelectorAll) return
    if (location.pathname.indexOf('/backends') === 0) return
    var DIR = '/images/products/'
    var LIST = DIR + 'responsive/variants.txt'
    var LIST_HEAD = '# sporta-variants v1'
    var SRC = /^\/images\/products\/([A-Za-z0-9][A-Za-z0-9._-]*)\.(?:jpe?g|png|webp)$/i
    var CARD_SIZES = '(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw'   // the build's own value for its cards
    var widths = null            // { stem: [320, 640] } once the list has been read; stays null if it cannot be
    var mine = new WeakMap()     // <img> -> { src, srcset } exactly as this block left it
    var bad = Object.create(null) // stems whose copy failed to load on this page
    var queued = false

    function parse(text) {
      var lines = String(text).split(/\r?\n/)
      if (lines[0].replace(/\s+$/, '') !== LIST_HEAD) return null
      var map = Object.create(null)
      for (var i = 1; i < lines.length; i++) {
        var m = /^([A-Za-z0-9][A-Za-z0-9._-]*) (\d{2,4}(?:,\d{2,4})*)$/.exec(lines[i])
        if (!m) continue
        map[m[1]] = m[2].split(',').map(Number).sort(function (a, b) { return a - b })
      }
      return map
    }

    function kind(img) {
      if (img.classList.contains('catalog-gallery-photo')) return ''
      if (img.classList.contains('catalog-card-photo')) return 'card'
      var w = parseInt(img.getAttribute('width'), 10)
      return w > 0 && w <= 128 ? 'thumb' : ''
    }

    function drop(img) {
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      mine.delete(img)
    }

    /** { sizes, srcset } for this <img> showing `src`, or null: not a photograph the list names, not a kind we handle, or it has its own srcset. */
    function wanted(img, src) {
      if (!widths || img.hasAttribute('srcset') || location.pathname.indexOf('/backends') === 0) return null   // the admin works on the originals
      var m = SRC.exec(src)
      if (!m || bad[m[1]]) return null
      var ws = widths[m[1]]
      var k = ws && kind(img)
      if (!k) return null
      return {
        sizes: k === 'card' ? CARD_SIZES : parseInt(img.getAttribute('width'), 10) + 'px',
        srcset: ws.map(function (w) { return DIR + 'responsive/' + m[1] + '-' + w + '.webp ' + w + 'w' }).join(', ')
      }
    }
    function put(img, src, w) {
      img.setAttribute('sizes', w.sizes)
      img.setAttribute('srcset', w.srcset)
      mine.set(img, { src: src, srcset: img.getAttribute('srcset') })
    }
    function one(img) {
      var src = img.getAttribute('src') || ''
      var rec = mine.get(img)
      if (rec) {
        if (rec.src === src && img.getAttribute('srcset') === rec.srcset) return   // still ours, still right
        if (img.getAttribute('srcset') === rec.srcset) drop(img)                    // the src moved on under our srcset
        else mine.delete(img)                                                       // someone else owns srcset now
      }
      // This is the LATE path (the hook below is the early one). An <img> that is not loading="lazy" was asked for the moment the
      // app set its src, and one that has loaded is already here: a copy now would only be a second download on top of the
      // original, so both are left alone. A lazy one that has not been asked for yet is exactly what this path is for.
      if (img.getAttribute('loading') !== 'lazy' || (img.complete && img.naturalWidth > 0)) return
      var w = wanted(img, src)
      if (w) put(img, src, w)
    }

    /** Take our srcset off every <img> that still has it (the list is gone: the originals are the truth again). */
    function unwind() {
      var all = document.images
      for (var i = 0; i < all.length; i++) { try { if (mine.has(all[i])) drop(all[i]) } catch (e) {} }
    }
    function run() {
      var all = document.images
      for (var i = 0; i < all.length; i++) { try { one(all[i]) } catch (e) {} }
    }
    function schedule() {
      if (queued) return
      queued = true
      requestAnimationFrame(function () { queued = false; run() })
    }
    // An <img> the app has just made or re-pointed is looked at in the SAME microtask checkpoint as the change, not a frame
    // later: a lazy one (a shop card, a gallery thumbnail, a checkout row) has usually not been requested yet, so it never
    // asks for the original. `one` leaves eager and already-loaded images alone (see there). The animation-frame pass above
    // is the backstop.
    function visit(node) {
      if (!node || node.nodeType !== 1) return
      if (node.tagName === 'IMG') { one(node); return }
      if (!node.firstElementChild) return
      var l = node.getElementsByTagName('img')
      for (var i = 0; i < l.length; i++) one(l[i])
    }
    function changed(records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var r = records[i]
          if (r.type === 'attributes') visit(r.target)
          else for (var j = 0; j < r.addedNodes.length; j++) visit(r.addedNodes[j])
        }
      } catch (e) {}
      schedule()
    }

    // Capture phase: this runs BEFORE the <img>'s own error handler (and React's), which is the point.
    window.addEventListener('error', function (ev) {
      try {
        var t = ev && ev.target
        if (!t || t.tagName !== 'IMG') return
        var rec = mine.get(t)
        if (!rec) return
        // The srcset on this <img> is no longer ours (the app put its own on after us): the failure is one of ITS candidates, so it is
        // the app's to handle - its onError must run, and its srcset must stay.
        if (t.getAttribute('srcset') !== rec.srcset) { mine.delete(t); return }
        var m = SRC.exec(rec.src)
        if (m) bad[m[1]] = true
        drop(t)                      // the browser now loads `src`, the original
        ev.stopImmediatePropagation() // the compiled onError would swap in the placeholder over a good original
      } catch (e) {}
    }, true)

    // The list is remembered between visits, so the NEXT page load already knows it when the app first builds its <img>s
    // (a fetch() answer comes after the app's first render, which is one long task, and by then the browser has asked for the
    // originals). A remembered list can only be out of date by NOT naming a newer photograph: the maker never deletes a copy,
    // and a copy that has gone anyway falls back to the original (the error listener above).
    var KEEP = 'sporta.variants.v1'
    function remembered() {
      try { var t = localStorage.getItem(KEEP); return t ? parse(t) : null } catch (e) { return null }
    }
    function remember(text) {
      try { localStorage.setItem(KEEP, text) } catch (e) {}
    }
    function forget() {
      try { localStorage.removeItem(KEEP) } catch (e) {}
    }
    // "The server has no list": when that was last found out. A timestamp in the future (a clock that was set back) counts as
    // old, so a wrong clock can silence the block for at most MISS_MS, never for ever.
    var MISS = 'sporta.variants.v1.miss'
    var TRANSIENT = {}   // what the first .then below hands the second when the answer was a server hiccup, not an answer
    var MISS_MS = 6 * 60 * 60 * 1000
    function recentMiss() {
      try {
        var t = Number(localStorage.getItem(MISS)), now = Date.now()
        return t > 0 && now >= t && now - t < MISS_MS
      } catch (e) { return false }
    }
    function noteMiss() {
      try { localStorage.setItem(MISS, String(Date.now())) } catch (e) {}
    }
    function clearMiss() {
      try { localStorage.removeItem(MISS) } catch (e) {}
    }
    // THE EARLY HOOK. React builds an <img> detached and sets its `src` LAST (after class, width, loading...), and the browser
    // asks for that file the moment `src` is set - long before the element is in the page, so an observer sees it too late: the
    // original is already on the wire (measured: the bag drawer's and the cart line's 3 MB originals were fetched in full and the
    // copy fetched after them). So when the app sets `src` on an <img>, and the list names that photograph, the srcset goes on
    // first, in the same call, and the first request is already the small copy. Everything else about setAttribute is untouched:
    // same arguments, same `this`, same return value, and any failure here falls through to the real call.
    function hook() {
      var native = Element.prototype.setAttribute
      if (native.sportaSrcset) return
      var wrapped = function (name, value) {
        if (name === 'src' && widths && this.tagName === 'IMG') {
          try {
            var v = String(value)
            var rec = mine.get(this)
            if (rec && rec.src !== v) {
              // Being pointed at another photograph: ours was for the old one. But only OUR srcset goes: if the app has put its own on
              // since (React sets srcSet before src when its props list them in that order), it is the app's and it stays - and since
              // the <img> then has a srcset, `wanted` below leaves it alone too (review, 2026-11-04; the earlier version dropped it
              // unconditionally and put ours over it).
              if (this.getAttribute('srcset') === rec.srcset) drop(this)
              else mine.delete(this)
            }
            var w = wanted(this, v)
            if (w) put(this, v, w)
          } catch (e) {}
        }
        return native.apply(this, arguments)
      }
      wrapped.sportaSrcset = true
      Element.prototype.setAttribute = wrapped
    }
    function start() {
      try {
        widths = remembered()
        // Nothing remembered and the server said "no list" a short while ago: do not ask again, and do not hook or watch anything
        // for a list that is not there (see the second bullet of the header comment).
        if (!widths && recentMiss()) return
        hook()
        if (widths) run()
        fetch(LIST, { credentials: 'omit' }).then(function (r) {
          // A server hiccup (a restart during a deploy: 502/503/504, or 429) says nothing about whether the list exists: it is
          // treated like a network error, so it neither drops a good remembered list nor starts the MISS_MS silence.
          if (r.status >= 500 || r.status === 429) return TRANSIENT
          var ct = r.headers.get('content-type') || ''
          return r.ok && /^text\//i.test(ct) ? r.text() : null
        }).then(function (text) {
          if (text === TRANSIENT) return
          var fresh = text && text.length <= 400000 ? parse(text) : null
          if (!fresh) { widths = null; forget(); noteMiss(); unwind(); return }   // the server says there is no list (404, wrong body): stop using any remembered one
          widths = fresh
          remember(text)
          clearMiss()
          schedule()
        }).catch(function () {})   // offline / network error: the remembered list, if any, stays in use
        new MutationObserver(changed).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
      } catch (e) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
})()

/* Add to bag: labels, the "added" answer and the way to the bag (lane U3, 2026-11-04).
 *
 * The compiled storefront adds to the bag in silence: the button keeps its label and colour, and the only sign is a small
 * count badge in the header. This block adds the answer, with the bundle's own nodes left exactly as they are. It sets
 * attributes (data-sporta-state / -label / -short, aria-label on the Add and Buy now buttons, data-sporta-bump on the header
 * bag button) that the "UX: ADD TO BAG" section of sporta-product-fix.css turns into looks, and it appends two nodes of its
 * own to <body> (a hidden live region and a notice with a View bag button). It never moves, re-parents or removes a React
 * node, never sets a value, never reads or writes anything the order sends, and the bag in localStorage is only READ.
 *
 *  - Product page, no size chosen yet: the Add button reads "Choose size" (it is not disabled: tapping it still scrolls to the
 *    size card and shows the bundle's own message, which the CSS now makes impossible to miss).
 *  - After an add (Add on the product page, or the quick-add on a card where the product has no sizes): the bag is read
 *    before the tap and again after the app has stored it (a handful of timeouts over 1.4 s, no animation-frame loop); if it
 *    grew, the button says "Added to bag" with a check for 1.6 s, the header bag pulses, a polite live region says what was
 *    added and how many pieces are in the bag, and a notice offers View bag (it presses the header's own bag button).
 *    If the bag did not grow (no size, nothing stored) none of it happens.
 *  - Every unit of the size is already in the bag (the app then disables the button and its label used to say "Sold out"):
 *    the buttons say "In your bag" instead. A product that is really sold out keeps the app's "Sold out".
 *  - A second tap on the same Add button within 0.5 s is swallowed before the app sees it (a double tap added two pieces); the
 *    quantity stepper is how to add two. The bag format and every price are the app's.
 * Arabic and English both; the language is read from <html lang>. Without this block the page is the bundle's plus the CSS rules
 * that do not need it. Everything is inside try/catch: a failure here leaves the page as the bundle drew it.
 */
;(function () {
  'use strict'
  try {
    if (window.__sportaAddToBag) return
    window.__sportaAddToBag = 1
    var KEY = 'sporta_cart'
    var TEXT = {
      en: {
        pick: 'Choose size', addedShort: 'Added', added: 'Added to bag', inbag: 'In your bag', view: 'View bag',
        one: 'One size', size: ', size '
      },
      ar: {
        pick: 'اختر المقاس', addedShort: 'أُضيف', added: 'أُضيف إلى الحقيبة', inbag: 'في حقيبتك', view: 'عرض الحقيبة',
        one: 'مقاس واحد', size: '، المقاس '
      }
    }
    var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
    var live = null, toast = null, toastText = null, toastBtn = null, toastTimer = 0
    var lastEl = null, lastAt = 0, reported = 0, queued = false

    function lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en' }
    function tx() { return TEXT[lang()] }
    function digits(n) { return lang() === 'ar' ? String(n).replace(/\d/g, function (d) { return AR_DIGITS[+d] }) : String(n) }
    // "3 items" / Arabic's five counting cases (1, 2 dual, 3-10 plural, 11+ singular).
    function pieces(n) {
      if (lang() !== 'ar') return n + (n === 1 ? ' item' : ' items')
      if (n === 1) return 'قطعة واحدة'
      if (n === 2) return 'قطعتان'
      return digits(n) + (n >= 3 && n <= 10 ? ' قطع' : ' قطعة')
    }
    function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
    function slug() {
      var m = /^\/product\/([^/?#]+)/.exec(location.pathname)
      try { return m ? decodeURIComponent(m[1]) : '' } catch (e) { return m ? m[1] : '' }
    }
    function bag() {
      try {
        var a = JSON.parse(localStorage.getItem(KEY) || '[]')
        return Array.isArray(a) ? a.filter(function (l) { return l && typeof l === 'object' }) : []
      } catch (e) { return [] }
    }
    function total(a) { return a.reduce(function (n, l) { return n + (Number(l.qty) || 0) }, 0) }
    function nameOf(l) {
      var n = l && l.name
      if (n && typeof n === 'object') return String(n[lang()] || n.en || n.ar || '')
      return n ? String(n) : ''
    }

    // ---- labels on the product page --------------------------------------------------------------------------------------
    function put(btn, state, long, short) {
      if (!btn) return
      var cur = btn.getAttribute('data-sporta-state') || ''
      if (!state) {
        if (cur) {
          btn.removeAttribute('data-sporta-state'); btn.removeAttribute('data-sporta-label')
          btn.removeAttribute('data-sporta-short'); btn.removeAttribute('aria-label')
        }
        return
      }
      if (cur !== state || btn.getAttribute('data-sporta-label') !== long || btn.getAttribute('data-sporta-short') !== short) {
        btn.setAttribute('data-sporta-state', state)
        btn.setAttribute('data-sporta-label', long)
        btn.setAttribute('data-sporta-short', short)
        btn.setAttribute('aria-label', long)
      }
    }
    var addedUntil = 0, addedSlug = ''
    function sync() {
      var row = document.querySelector('.catalog-product-page .product-purchase-row')
      if (!row) return
      var add = row.querySelector('.btn-primary')
      if (!add) return
      var inline = row.querySelector('.product-buy-now-inline')
      var barBtn = document.querySelector('.catalog-product-page .action-bar > .btn')
      var t = tx(), state = ''
      // while the "added" answer shows, the Add button keeps it (sync() runs again when it ends); the other two buttons follow the truth at once
      // (only on the product it was added on: React reuses the button when the shopper goes to another product)
      var showing = Date.now() < addedUntil && slug() === addedSlug
      var ladder = document.getElementById('product-size-options')
      var chips = ladder ? ladder.querySelectorAll('[role="group"] > button') : []
      var pressed = null, free = 0, shown = 0, i
      for (i = 0; i < chips.length; i++) {
        if (chips[i].hasAttribute('data-sporta-nosize')) continue
        shown++
        if (chips[i].getAttribute('aria-pressed') === 'true') pressed = chips[i]
        if (!chips[i].disabled) free++
      }
      if (!add.disabled) {
        if (ladder && shown && !pressed) state = 'pick'
      } else {
        var s = slug(), held = false
        bag().forEach(function (l) { if (l.slug === s && Number(l.qty) > 0) held = true })
        if (held && ((pressed && pressed.disabled) || (shown && !free))) state = 'inbag'
      }
      if (showing) { /* the Add button is showing "added" */ }
      else if (state === 'pick') put(add, 'pick', t.pick, t.pick)
      else if (state === 'inbag') put(add, 'inbag', t.inbag, t.inbag)
      else put(add, '')
      // the two Buy now buttons repeat "Sold out" when the real reason is the bag: say the same thing there
      put(inline, state === 'inbag' ? 'inbag' : '', t.inbag, t.inbag)
      put(barBtn, state === 'inbag' ? 'inbag' : '', t.inbag, t.inbag)
      viewBag(barBtn, state === 'inbag')
      viewBag(inline, state === 'inbag')
    }
    // BAG-LINK-1118 (owner: "fix add to cart button"): when every piece the shop has is already in the bag, the app disables Buy now and the page is left
    // with a pill that says "In your bag" and does nothing. The disabled button is hidden (never removed: the app owns it) and a "View bag" link of
    // the same box stands in its place: it opens the bag drawer exactly as the header's bag icon does (the link's own address, /cart, is the fallback).
    function viewBag(btn, on) {
      if (!btn || !btn.parentNode) return
      var next = btn.nextElementSibling, have = next && next.hasAttribute('data-sporta-viewbag') ? next : null
      if (!on) { if (have) have.remove(); btn.removeAttribute('data-sporta-hidden'); return }
      if (!have) {
        have = document.createElement('a')
        have.setAttribute('data-sporta-viewbag', '')
        have.className = String(btn.className).replace(/\bdisabled:[^\s]+/g, '')
        have.href = '/cart'
        have.addEventListener('click', function (e) {
          var bagBtn = document.querySelector('.app-header .navbar-cart')
          if (bagBtn) { e.preventDefault(); bagBtn.click() }
        })
        btn.parentNode.insertBefore(have, btn.nextSibling)
      }
      if (have.textContent !== tx().view) have.textContent = tx().view
      if (!btn.hasAttribute('data-sporta-hidden')) btn.setAttribute('data-sporta-hidden', '')
    }
    function schedule() {
      if (queued) return
      queued = true
      requestAnimationFrame(function () { queued = false; try { sync() } catch (e) {} })
    }

    // ---- the answer to an add --------------------------------------------------------------------------------------------
    function ensureLive() {
      if (live && live.isConnected) return live
      live = document.createElement('div')
      live.className = 'sporta-u3-live'
      live.setAttribute('role', 'status')
      live.setAttribute('aria-live', 'polite')
      live.setAttribute('aria-atomic', 'true')
      document.body.appendChild(live)
      return live
    }
    function say(text) {
      var el = ensureLive()
      el.textContent = ''
      setTimeout(function () { el.textContent = text }, 40)
    }
    function hideToast() {
      clearTimeout(toastTimer)
      if (toast) toast.removeAttribute('data-open')
    }
    function armToast() {
      clearTimeout(toastTimer)
      toastTimer = setTimeout(hideToast, 4500)
    }
    function openBag() {
      var c = document.querySelector('.app-header .navbar-cart')
      hideToast()
      if (c) c.click()
      else location.assign('/cart')
    }
    function showToast(name, count) {
      var t = tx()
      if (!toast || !toast.isConnected) {
        toast = document.createElement('div')
        toast.className = 'sporta-u3-toast'
        var mark = document.createElement('span'); mark.className = 'sporta-u3-toast__mark'; mark.setAttribute('aria-hidden', 'true')
        toastText = document.createElement('span'); toastText.className = 'sporta-u3-toast__text'
        toastBtn = document.createElement('button'); toastBtn.type = 'button'; toastBtn.className = 'sporta-u3-toast__btn'
        toastBtn.addEventListener('click', openBag)
        toast.appendChild(mark); toast.appendChild(toastText); toast.appendChild(toastBtn)
        toast.addEventListener('mouseenter', function () { clearTimeout(toastTimer) })
        toast.addEventListener('mouseleave', function () { if (toast.hasAttribute('data-open')) armToast() })
        toast.addEventListener('focusin', function () { clearTimeout(toastTimer) })
        toast.addEventListener('focusout', function () { if (toast.hasAttribute('data-open')) armToast() })
        document.body.appendChild(toast)
      }
      toastText.textContent = ''
      var head = document.createElement('span'); head.textContent = t.added
      toastText.appendChild(head)
      toastText.appendChild(document.createTextNode(' '))   // a space between the two lines for readers that flatten blocks
      if (name) { var sm = document.createElement('small'); sm.textContent = name; sm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; toastText.appendChild(sm) }
      toastBtn.textContent = t.view + ' (' + digits(count) + ')'
      // under the header, or (BACK 1120: a product page has no header) under the Back row, whose end is the same edge in Arabic
      var hd = document.querySelector('.app-header'), bb = document.querySelector('.sporta-back-bar:not([hidden])')
      if (hd || bb) toast.style.setProperty('--sporta-u3-top', Math.round(Math.max(0, hd ? hd.getBoundingClientRect().bottom : 0, bb ? bb.getBoundingClientRect().bottom : 0) + 12) + 'px')
      // phone: the notice sits 12px above the buy bar, whatever height the bar has (it wraps to two lines at large text sizes)
      var bar = document.querySelector('.action-bar'), bh = bar ? bar.getBoundingClientRect().height : 0
      if (bh > 0) toast.style.setProperty('--sporta-u3-bar', Math.round(bh + 12) + 'px')
      else toast.style.removeProperty('--sporta-u3-bar')
      toast.setAttribute('data-open', '')
      armToast()
    }
    function added(btn, before, after) {
      var t = tx(), item = null, i, was
      for (i = 0; i < after.length && !item; i++) {
        was = null
        before.forEach(function (b) { if (b.key === after[i].key) was = b })
        if (!was || (Number(after[i].qty) || 0) > (Number(was.qty) || 0)) item = after[i]
      }
      var count = total(after), name = nameOf(item), size = item && item.size ? (String(item.size).toUpperCase() === 'ONE' ? t.one : String(item.size)) : ''
      if (btn.matches('.product-purchase-row > .btn-primary')) {
        addedUntil = Date.now() + 1600; addedSlug = slug()
        put(btn, 'added', t.added, t.addedShort)
        setTimeout(function () { addedUntil = 0; try { sync() } catch (e) {} }, 1650)
      }
      var cart = document.querySelector('.app-header .navbar-cart')
      if (cart) {
        cart.setAttribute('data-sporta-bump', '')
        setTimeout(function () { cart.removeAttribute('data-sporta-bump') }, 700)
      }
      say(t.added + (name ? ': ' + name : '') + (size ? t.size + size : '') + '. ' + (lang() === 'ar' ? 'في حقيبتك ' + pieces(count) + '.' : pieces(count) + ' in your bag.'))
      showToast(name, count)
      try { if (navigator.vibrate && !reduced()) navigator.vibrate(10) } catch (e) {}
    }
    function watch(btn) {
      var before = bag(), n0 = total(before), delays = [50, 120, 250, 450, 800, 1400], i = 0
      // the bag shrank since the last announcement (an item was removed in the drawer): count from where it is now,
      // or the next add would never be announced
      if (n0 < reported) reported = n0
      function check() {
        var after = bag(), n = total(after)
        // `reported` stops two overlapping watches (two quick taps on two cards) from announcing the same piece twice
        if (n > Math.max(n0, reported)) { reported = n; try { added(btn, before, after) } catch (e) {} return }
        if (++i < delays.length) setTimeout(check, delays[i])
      }
      setTimeout(check, delays[0])
    }

    function start() {
      ensureLive()
      document.addEventListener('click', function (e) {
        try {
          var b = e.target && e.target.closest ? e.target.closest('.product-purchase-row > .btn-primary, .catalog-card-add') : null
          if (!b || b.disabled) return
          var now = Date.now()
          // double-tap guard: the second tap of the same button inside 0.5 s never reaches the app
          if (b === lastEl && now - lastAt < 500) { e.stopImmediatePropagation(); e.preventDefault(); return }
          lastEl = b; lastAt = now
          watch(b)
        } catch (err) {}
      }, true)
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideToast() })
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled'] })
      window.addEventListener('popstate', schedule)
      // the language toggle changes <html lang>: the words on the buttons follow it (React's text changes are not DOM insertions)
      new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      schedule()
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
})()

/* ===== SITE CONTENT - begin ==============================================
 * The owner's wording (owner request 2026-11-10: "make backends full dynamic").
 *
 * The storefront is a compiled build with no source, so its fixed text cannot be
 * edited where it is written. Instead the admin (/backends, "Site content", the
 * block of the same name in sporta-admin-brands.js) stores a list of rules in
 * ONE settings row, and this block applies them in the browser:
 *
 *   GET /api/api.php?r=content ->
 *     { v, overrides: [ { page, lang, match, text } ],
 *       contact: { phone, whatsapp, email, address_en, address_ar,
 *                  instagram, tiktok, snapchat, x } }
 *
 *   page   '*' (every page) or one storefront path ('/about'); '/product/*' is
 *          every product page. A rule for the page itself beats a '*' rule.
 *   lang   'ar' | 'en', compared with what the page is showing (<html lang>,
 *          else <html dir>, else Arabic, which is the shop's default).
 *   match  the text the build shows, exactly, after the squash below.
 *   text   what to show instead.
 *
 * HOW A TEXT IS CHANGED. Text nodes only, and only their nodeValue: no element
 * is added, moved, removed or re-classed, nothing is ever parsed as markup, so a
 * rule that says "<b>" shows the three characters. A node is matched by its WHOLE
 * text after the squash (runs of space/tab/newline become one space, the ends
 * trimmed); the white space the node had at its ends is kept. React never notices:
 * it compares its own tree, not the page, and when it does rewrite a node (a
 * language switch, a new page) that write is seen and answered.
 *
 * WHAT IS NEVER TOUCHED.
 *   - /backends, /cart, /checkout, /payment/..., /invoice/...: nothing is applied
 *     there, and whatever was applied to a header or footer that survives the
 *     navigation is put back on arrival;
 *   - text inside input, textarea, select, option, script, style, noscript,
 *     template or anything contenteditable;
 *   - any text with a PRICE in it (digits next to KWD, KD, K.D. or د.ك), a text
 *     that is only a number or only the currency mark, and the pieces of a price
 *     split over two or three elements. The server decides every number a
 *     shopper sees; the API also refuses to store a rule that matches or writes
 *     a price.
 *
 * CONTACT DETAILS. When a value is set: tel: links get the phone, mailto: links
 * the address (their ?subject= stays), wa.me / api.whatsapp.com links the
 * WhatsApp number (their ?text= stays), and PROFILE links on instagram.com,
 * tiktok.com, snapchat.com, x.com / twitter.com the new profile (a share or
 * intent link is not a profile and is left alone). The old value is replaced
 * inside the link's own text when it is written there ("+965 2209 1914",
 * "Call us 22091914", the address, "@handle"). <address> and
 * [itemprop=streetAddress], when they hold one plain text, get the address in
 * the page's language. Every href is rebuilt here from a value that passes its
 * own pattern, whatever the cache or the answer says: a link is never pointed at
 * an arbitrary string.
 *
 * REQUESTS. ONE per page load, never repeated, never retried. The answer is kept
 * in localStorage ("sporta_content_v1") and the kept copy is applied at once on
 * the next load, before the fresh answer arrives, so a returning visitor does not
 * see the old words flash. A server that does not know the route yet (404) is
 * remembered for six hours and not asked again in that time. No rules and no
 * contact values -> the page is not watched at all.
 *
 * NO LOOPS. One MutationObserver. Changes are handled where they happened (the
 * added nodes, the rewritten text node), in the same task, so the swap is in the
 * first paint of that render. The observer's own queue is emptied after every
 * write of ours (takeRecords), so this block never sees itself.
 *
 * The admin's "Load texts" opens a storefront page in an iframe with
 * ?sporta_content=off: with that in the address at load, this block does nothing,
 * so the admin reads the build's ORIGINAL words. It only changes what that one
 * visitor sees.
 */
;(function () {
  'use strict'
  try {
  if (window.__sportaContent) return
  var api = { version: 1, applied: 0, requests: 0 }
  try { Object.defineProperty(window, '__sportaContent', { value: api, enumerable: false, configurable: false }) } catch (e) { return }
  if (!window.MutationObserver || !window.WeakMap || !window.fetch || !document.createTreeWalker) return
  try { if (/[?&]sporta_content=off(&|$)/.test(location.search)) { api.off = true; return } } catch (e) { return }

  var URL_ = '/api/api.php?r=content'
  var KEY = 'sporta_content_v1'
  var ABSENT_MS = 6 * 60 * 60 * 1000
  var BLOCKED = /^\/(backends|cart|checkout|payment|invoice)(\/|$)/i
  var SKIP = 'script,style,noscript,template,textarea,select,option,input,[contenteditable]:not([contenteditable="false"])'
  var CUR = '(?:KWD|K\\.?\\s?D\\.?|\\u062F\\.?\\s?\\u0643\\.?)'
  var DIG = '[0-9\\u0660-\\u0669]'
  var LET = 'A-Za-z\\u0600-\\u06FF'
  var PRICE = new RegExp('(?:' + DIG + '[0-9\\u0660-\\u0669.,\\u066B\\u066C]*\\s*' + CUR + '(?![' + LET + ']))|(?:(?:^|[^' + LET + '])' + CUR + '\\s*' + DIG + ')', 'i')
  var NUMBER_ONLY = /^[0-9\u0660-\u0669\s.,:+\-\/%]+$/
  var CUR_ONLY = new RegExp('^' + CUR + '$', 'i')
  var PAGES = { '*': 1, '/': 1, '/shop': 1, '/product/*': 1, '/about': 1, '/contact': 1, '/support': 1, '/account': 1, '/wishlist': 1, '/track': 1, '/returns': 1, '/exchange': 1, '/terms': 1, '/privacy': 1, '/review': 1 }
  var SOCIAL = {
    instagram: { host: /^(www\.)?instagram\.com$/i, path: /^\/@?([A-Za-z0-9._]{1,30})\/?$/, ok: /^https:\/\/www\.instagram\.com\/([A-Za-z0-9._]{1,30})$/, not: /^(p|reel|reels|explore|share|accounts|stories|tv|direct)$/i },
    tiktok: { host: /^(www\.)?tiktok\.com$/i, path: /^\/@([A-Za-z0-9._]{2,24})\/?$/, ok: /^https:\/\/www\.tiktok\.com\/@([A-Za-z0-9._]{2,24})$/, not: /^$/ },
    snapchat: { host: /^(www\.)?snapchat\.com$/i, path: /^\/add\/([A-Za-z0-9._\-]{3,15})\/?$/, ok: /^https:\/\/www\.snapchat\.com\/add\/([A-Za-z0-9._\-]{3,15})$/, not: /^$/ },
    x: { host: /^(www\.)?(x|twitter)\.com$/i, path: /^\/@?([A-Za-z0-9_]{1,15})\/?$/, ok: /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})$/, not: /^(intent|share|home|search|i|hashtag|explore|settings|compose)$/i }
  }

  var content = null            // the sanitised document in force (null: nothing known yet)
  var dict = null               // match -> text for the page and language on screen
  var contact = null            // the contact values that passed their patterns, or null when none is set
  var seenPath = null, seenLang = null
  var texts = new WeakMap()     // text node -> { orig, written }
  var links = new WeakMap()     // <a> -> { orig, written }
  var fights = new WeakMap()    // text node -> { orig, n, t }: how often our text was overwritten with the same original
  var wrote = false             // something of ours may be on the page
  var mo = null, watching = false, asked = false, queued = false

  // ------------------------------------------------------------------ helpers
  /** The squash the server applies to `match`: ASCII white space only, so both sides agree on every character. */
  function squash(s) {
    return String(s == null ? '' : s).replace(/[ \t\n\r\f\v]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^ +| +$/g, '')
  }
  function path() {
    var p = '/'
    try { p = location.pathname || '/' } catch (e) {}
    p = p.replace(/\/+$/, '') || '/'
    return p.toLowerCase()
  }
  function pageKey(p) { return /^\/product\/[^/]+$/.test(p) ? '/product/*' : p }
  function lang() {
    var h = document.documentElement
    var l = String(h.getAttribute('lang') || '').slice(0, 2).toLowerCase()
    if (l === 'en' || l === 'ar') return l
    return h.getAttribute('dir') === 'ltr' ? 'en' : 'ar'
  }
  function digits(s) {
    return String(s == null ? '' : s).replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660) }).replace(/[^0-9]/g, '')
  }
  function str(v, max) { return typeof v === 'string' && v.length <= max ? v : '' }
  function hasPrice(s) { return PRICE.test(s) }

  // ----------------------------------------------------- the document, checked
  /** Whatever came from the network or from storage, reduced to what this block is prepared to use. */
  function sanitise(j) {
    if (!j || typeof j !== 'object') return null
    var out = { v: typeof j.v === 'number' && isFinite(j.v) ? j.v : 0, overrides: [], contact: {} }
    var list = Array.isArray(j.overrides) ? j.overrides : []
    for (var i = 0; i < list.length && out.overrides.length < 300; i++) {
      var o = list[i]
      if (!o || typeof o !== 'object') continue
      if (typeof o.page !== 'string' || PAGES[o.page] !== 1) continue
      if (o.lang !== 'ar' && o.lang !== 'en') continue
      var m = squash(str(o.match, 400)), t = squash(str(o.text, 2000))
      if (!m || !t || hasPrice(m) || hasPrice(t) || NUMBER_ONLY.test(m) || CUR_ONLY.test(m)) continue
      out.overrides.push({ page: o.page, lang: o.lang, match: m, text: t })
    }
    var c = j.contact && typeof j.contact === 'object' ? j.contact : {}
    var phone = str(c.phone, 20), wa = str(c.whatsapp, 20), email = str(c.email, 120)
    out.contact.phone = /^\+?[0-9]{6,15}$/.test(phone) ? phone : ''
    out.contact.whatsapp = /^[0-9]{8,15}$/.test(wa) ? wa : ''
    out.contact.email = /^[A-Za-z0-9.!$*+\/=^_{|}~\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$/.test(email) ? email : ''
    out.contact.address_en = squash(str(c.address_en, 200))
    out.contact.address_ar = squash(str(c.address_ar, 200))
    for (var k in SOCIAL) out.contact[k] = SOCIAL[k].ok.test(str(c[k], 120)) ? c[k] : ''
    var r = j.returns && typeof j.returns === 'object' ? j.returns : {}
    var pts = function (a) {
      var o = []
      for (var n = 0; Array.isArray(a) && n < a.length && o.length < 8; n++) { var t = squash(str(a[n], 300)); if (t) o.push(t) }
      return o
    }
    // The favicon the owner picked in the SEO screen (site-icon.php): the version and the three URLs, only in the exact shape the server writes them.
    // Anything else (an off-site address, a wrong size, a made-up version) is dropped and the page keeps the icons it came with.
    var ic = j.site_icon && typeof j.site_icon === 'object' ? j.site_icon : null
    out.site_icon = null
    if (ic && typeof ic.v === 'string' && /^[0-9a-f]{12}$/.test(ic.v) && ic.urls && typeof ic.urls === 'object') {
      var okUrl = function (size) { return ic.urls[size] === '/api/api.php?r=site_icon&s=' + size + '&v=' + ic.v }
      if (okUrl('32') && okUrl('180') && okUrl('192')) out.site_icon = { v: ic.v, urls: { 32: ic.urls['32'], 180: ic.urls['180'], 192: ic.urls['192'] } }
    }
    out.returns = {
      window_days: typeof r.window_days === 'number' && r.window_days >= 1 && r.window_days <= 60 && r.window_days % 1 === 0 ? r.window_days : 14,
      allow_return: r.allow_return !== false, allow_exchange: r.allow_exchange !== false,
      intro_en: squash(str(r.intro_en, 400)), intro_ar: squash(str(r.intro_ar, 400)),
      points_en: pts(r.points_en), points_ar: pts(r.points_ar)
    }
    return out
  }
  function isEmpty(d) {
    if (!d) return true
    if (d.overrides.length) return false
    for (var k in d.contact) if (d.contact[k]) return false
    var r = d.returns
    if (r && (r.window_days !== 14 || r.intro_en || r.intro_ar || r.points_en.length || r.points_ar.length)) return false
    return true
  }
  /** Point the page's icon links at the owner's favicon (pages the SEO renderer did not serve, such as the cart and the account pages, still carry the shell's own).
   *  When the owner has put the shop's icon back (a kept copy that still names a favicon, and a fresh answer that does not), the links go back to what they were. */
  function applyIcon() {
    try {
      if (!document.head) return
      var ic = content && content.site_icon
      if (!ic) {
        var kept = document.head.querySelectorAll('link[data-sporta-icon-orig]')
        for (var k = 0; k < kept.length; k++) {
          var orig = kept[k].getAttribute('data-sporta-icon-orig')
          if (orig === '') kept[k].parentNode.removeChild(kept[k])   // a link this block made: there was no icon before it
          else { kept[k].setAttribute('href', orig); kept[k].removeAttribute('data-sporta-icon-orig') }
        }
        return
      }
      var want = [['link[rel="icon"][sizes="32x32"]', '32', 'icon', '32x32', 'image/png'], ['link[rel="icon"][sizes="192x192"]', '192', 'icon', '192x192', 'image/png'],
        ['link[rel="apple-touch-icon"]', '180', 'apple-touch-icon', '180x180', '']]
      for (var i = 0; i < want.length; i++) {
        var w = want[i], url = ic.urls[w[1]], el = document.head.querySelector(w[0])
        if (!el) {
          el = document.createElement('link'); el.setAttribute('rel', w[2]); el.setAttribute('sizes', w[3]); if (w[4]) el.setAttribute('type', w[4])
          el.setAttribute('data-sporta-icon-orig', '')
          document.head.appendChild(el)
        }
        if (el.getAttribute('href') !== url) {
          if (!el.hasAttribute('data-sporta-icon-orig')) el.setAttribute('data-sporta-icon-orig', el.getAttribute('href') || '')
          el.setAttribute('href', url)
        }
      }
    } catch (e) { /* the page keeps the icons it came with */ }
  }
  function readCache() {
    try {
      var j = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (j && typeof j === 'object' && typeof j.absent === 'number') return { absent: j.absent }
      return sanitise(j)
    } catch (e) { return null }
  }
  function writeCache(v) { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch (e) { /* this visit only */ } }

  /** Work out what applies to the page and language on screen. */
  function resolve() {
    var p = path(), l = lang()
    seenPath = p; seenLang = l
    dict = null; contact = null
    if (!content || BLOCKED.test(p)) return
    var key = pageKey(p), d = {}, n = 0, pass, i, o
    // '*' first, then the page's own rules over them
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < content.overrides.length; i++) {
        o = content.overrides[i]
        if (o.lang !== l || o.page !== (pass ? key : '*')) continue
        d[' ' + o.match] = o.text; n++
      }
    }
    if (n) dict = d
    for (var k in content.contact) if (content.contact[k]) { contact = content.contact; break }
  }

  // -------------------------------------------------------------- text nodes
  function skipped(node) {
    var el = node.parentNode
    if (!el || el.nodeType !== 1) return true
    return !!(el.closest && el.closest(SKIP))
  }
  /** A price, a bare number, the currency mark, or a piece of a price split over neighbouring elements. */
  function pricey(node, s) {
    if (hasPrice(s)) return true
    if (NUMBER_ONLY.test(s) || CUR_ONLY.test(s)) return true
    var el = node.parentNode
    for (var up = 0; el && el.nodeType === 1 && up < 2; up++, el = el.parentNode) {
      var t = el.textContent || ''
      if (t.length > 80) break
      if (hasPrice(squash(t))) return true
    }
    return false
  }
  /** The footer's call button belongs to sporta-footer-call.js, which builds its label (the owner's words + the number) in one step from the
   *  same saved rule; a rule is never applied to its text from here, or the two scripts would answer each other. The number in it still follows
   *  contact.phone (the contact layer below). */
  function addonOwned(node) {
    var el = node.parentNode
    return !!(el && el.closest && el.closest('#sporta-footer-call'))
  }
  function origOf(node) {
    var rec = texts.get(node)
    if (rec && node.nodeValue === rec.written) return rec.orig
    if (rec) texts.delete(node)
    return node.nodeValue
  }
  function put(node, orig, value) {
    if (value == null) {            // nothing applies: the build's own words
      if (node.nodeValue !== orig) node.nodeValue = orig
      texts.delete(node)
      return
    }
    var lead = /^[ \t\n\r\f\v]*/.exec(orig)[0], tail = /[ \t\n\r\f\v]*$/.exec(orig)[0]
    var next = lead + value + (lead.length === orig.length ? '' : tail)
    if (next === orig) { texts.delete(node); return }
    if (node.nodeValue !== next) {
      // ANOTHER WRITER. If something keeps putting the same original back right after our write (another add-on that owns the
      // sentence, e.g. the live brand names on /about), it wins after three rounds: two scripts correcting each other forever is
      // a flicker the visitor sees. A re-render or a visit to the page later starts the count again.
      var f = fights.get(node), now = Date.now()
      if (f && f.orig === orig && now - f.t < 2000) {
        if (f.n >= 3) { f.t = now; texts.delete(node); return }
        f.n++; f.t = now
      } else fights.set(node, { orig: orig, n: 1, t: now })
      node.nodeValue = next; api.applied++
    }
    texts.set(node, { orig: orig, written: next })
    wrote = true
  }
  /** One text node: `forced` is the contact layer's answer for it (a string), or undefined. */
  function doText(node, forced) {
    var had = texts.has(node)
    if (!had && !dict && forced === undefined) return
    var orig = origOf(node)
    if (skipped(node)) { if (had) put(node, orig, null); return }
    if (forced !== undefined) { put(node, orig, forced); return }
    var want = null
    if (dict) {
      var s = squash(orig)
      if (s && s.length <= 400 && typeof dict[' ' + s] === 'string' && !pricey(node, s) && !addonOwned(node)) want = dict[' ' + s]
    }
    if (want == null && !had) return
    put(node, orig, want)
  }

  // ------------------------------------------------------------------ contact
  function showPhone(d, withPlus) {
    var m = /^965([0-9]{4})([0-9]{4})$/.exec(d)
    if (m) return '+965 ' + m[1] + ' ' + m[2]
    return (withPlus ? '+' : '') + d
  }
  /** Replace the old number wherever it is written in a link's text; null when it is not there. */
  function swapNumber(text, oldD, newD, plus) {
    if (!oldD || !newD) return null
    var hit = false
    var out = text.replace(/\+?[0-9\u0660-\u0669](?:[0-9\u0660-\u0669 \-]{4,}[0-9\u0660-\u0669])/g, function (run) {
      var d = digits(run)
      if (d === oldD) { hit = true; return showPhone(newD, plus) }
      // written the local way ("Call us 22091914"): stays local when the new number is a Kuwaiti one too
      if (oldD.length === 11 && oldD.indexOf('965') === 0 && d === oldD.slice(3)) { hit = true; return newD.length === 11 && newD.indexOf('965') === 0 ? newD.slice(3) : showPhone(newD, plus) }
      return run
    })
    return hit ? out : null
  }
  function handleOf(kind, url) {
    try {
      var u = new URL(url)
      var m = SOCIAL[kind].path.exec(u.pathname)
      return m && !SOCIAL[kind].not.test(m[1]) ? m[1] : ''
    } catch (e) { return '' }
  }
  /** What a link should point at and say, from its ORIGINAL href: { href, swap(text) } or null to leave it alone. */
  function planLink(orig) {
    if (!contact || !orig) return null
    var m, u, k
    if (/^tel:/i.test(orig)) {
      if (!contact.phone) return null
      var oldTel = digits(orig), newTel = digits(contact.phone)
      var plus = contact.phone.charAt(0) === '+'
      return { href: 'tel:' + contact.phone, swap: function (t) { return swapNumber(t, oldTel, newTel, plus) } }
    }
    if (/^mailto:/i.test(orig)) {
      if (!contact.email) return null
      m = /^mailto:([^?]*)(\?.*)?$/i.exec(orig)
      var oldMail = m ? m[1] : ''
      try { oldMail = decodeURIComponent(oldMail) } catch (e) {}
      return {
        href: 'mailto:' + contact.email + (m && m[2] ? m[2] : ''),
        swap: function (t) { var s = squash(t); return oldMail && s.toLowerCase() === oldMail.toLowerCase() ? contact.email : null }
      }
    }
    if (!/^https?:\/\//i.test(orig)) return null
    try { u = new URL(orig) } catch (e) { return null }
    var host = u.hostname.toLowerCase()
    if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'web.whatsapp.com') {
      if (!contact.whatsapp) return null
      var oldWa = ''
      if (host === 'wa.me') { m = /^\/\+?([0-9]{8,15})\/?$/.exec(u.pathname); if (!m) return null; oldWa = m[1]; u.pathname = '/' + contact.whatsapp }
      else { oldWa = digits(u.searchParams.get('phone') || ''); if (!/^[0-9]{8,15}$/.test(oldWa)) return null; u.searchParams.set('phone', contact.whatsapp) }
      u.protocol = 'https:'
      return { href: u.href, swap: function (t) { return swapNumber(t, oldWa, contact.whatsapp, true) } }
    }
    for (k in SOCIAL) {
      if (!SOCIAL[k].host.test(host)) continue
      if (!contact[k] || u.search || u.hash) return null
      var oldH = handleOf(k, orig)
      if (!oldH) return null
      var newH = SOCIAL[k].ok.exec(contact[k])[1]
      return {
        href: contact[k],
        swap: (function (a, b) {
          return function (t) { var s = squash(t); return s === a ? b : s === '@' + a ? '@' + b : null }
        })(oldH, newH)
      }
    }
    return null
  }
  function doLink(a, forced) {
    if (!a || a.nodeType !== 1 || !a.getAttribute) return
    var rec = links.get(a), cur = a.getAttribute('href')
    if (cur == null) { if (rec) links.delete(a); return }
    var orig = rec && cur === rec.written ? rec.orig : cur
    if (rec && cur !== rec.written) { links.delete(a); rec = null }
    var plan = a.closest && a.closest(SKIP) ? null : planLink(orig)
    if (!plan && !rec) return
    var want = plan ? plan.href : orig
    if (cur !== want) { a.setAttribute('href', want); if (plan) api.applied++ }
    if (plan && want !== orig) { links.set(a, { orig: orig, written: want }); wrote = true } else links.delete(a)
    // the link's own words
    var w = document.createTreeWalker(a, 4, null), n
    while ((n = w.nextNode())) {
      var t = plan ? plan.swap(origOf(n)) : null
      if (t != null) forced.set(n, t)     // any other text of the link is left to the rules (or goes back to the original)
    }
  }
  function doAddress(el, forced) {
    if (!contact || !el || el.nodeType !== 1) return
    var value = seenLang === 'en' ? contact.address_en : contact.address_ar
    if (!value || (el.closest && el.closest(SKIP)) || el.querySelector('a,button,input,select,textarea')) return
    var w = document.createTreeWalker(el, 4, null), n, only = null, count = 0
    while ((n = w.nextNode())) { if (squash(origOf(n))) { only = n; count++ } }
    if (count === 1) forced.set(only, value)
  }

  // ------------------------------------------------- /returns and /exchange
  /* Returns & exchange (owner request 2026-11-10: "make return and exchange fully dynamic on the frontend").
   * The answer above also carries `returns` (settings.returns_policy): { window_days, allow_return, allow_exchange,
   * intro_en, intro_ar, points_en[], points_ar[] }. The three rules are ENFORCED BY THE SERVER (returns.php); this part
   * only changes what the page SAYS, on /returns and /exchange (one compiled page, wrapper .returns-system):
   *   - points set for the language on screen: the page's own fixed points under .returns-system__policy are hidden (marked
   *     data-sporta-rp-hidden and given an inline display:none !important, put back exactly on restore; NOT a rule in
   *     sporta-returns-touch.css, whose suite allows only scoped selectors of the build's own classes and no !important,
   *     and so that this file never depends on a stylesheet's version) and OUR list is added beside them, built with the tag and class names of the
   *     originals so it looks the same. React's nodes are never removed, moved or re-texted; ours is one node we own, put
   *     back if React rebuilds the section, rebuilt when the language or the points change, removed when the points are
   *     cleared (and the originals shown again). The heading and .returns-system__policy-links (the terms link and the
   *     WhatsApp link) are never hidden.
   *   - intro set: the first plain paragraph of .returns-system__intro gets it (its text node, like any rule above).
   *   - no custom points and a window that is not 14 days: only the number in the page's own first point changes
   *     ("within 14 days" / "خلال ١٤ يومًا"), with the noun Arabic needs for that number (يوم واحد، يومين، ٣ أيام، ١١ يومًا).
   * The fixed points are found as the <li>/<p> under the policy section that hold text and no link (else its text-only
   * child blocks). A section built some other way is left exactly as it is. */
  var RP_HIDE = 'data-sporta-rp-hidden', RP_OURS = 'data-sporta-rp'
  var AR0 = 0x0660
  var rpNode = null, rpSig = '', rpShown = new WeakMap(), rpTouched = false
  function onReturns() { var p = seenPath; return p === '/returns' || p === '/exchange' }
  function rpActive() {
    if (!content || !content.returns || !onReturns()) return null
    var r = content.returns, en = seenLang === 'en'
    var want = { points: en ? r.points_en : r.points_ar, intro: en ? r.intro_en : r.intro_ar, days: r.window_days }
    return want.points.length || want.intro || want.days !== 14 ? want : null
  }
  function arDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(AR0 + Number(d)) }) }
  /** "14 days" / "١٤ يومًا" for another number, or null when the sentence does not say it that way. */
  function swapDays(text, n) {
    var hit = false, out
    out = text.replace(/\b14(\s+)days\b/, function (m, sp) { hit = true; return n + sp + (n === 1 ? 'day' : 'days') })
    if (hit) return out
    // Arabic: the counted noun changes with the number (1, 2, 3-10, 11 and over)
    var AR14 = arDigits(14), re = new RegExp('(' + AR14 + '|14)(\\s+)\\u064A\\u0648\\u0645[\\u064B-\\u0652]?\\u0627?[\\u064B-\\u0652]?')
    out = text.replace(re, function (m, num, sp) {
      hit = true
      var d = num === '14' ? String(n) : arDigits(n)
      if (n === 1) return '\u064A\u0648\u0645' + sp + '\u0648\u0627\u062D\u062F'
      if (n === 2) return '\u064A\u0648\u0645\u064A\u0646'
      if (n <= 10) return d + sp + '\u0623\u064A\u0627\u0645'
      return d + sp + '\u064A\u0648\u0645\u064B\u0627'
    })
    return hit ? out : null
  }
  function rpOwn(e) { return !!(e.closest && e.closest('[' + RP_OURS + ']')) }
  function rpBlocks(box) {
    var kids = [], i, e
    for (i = 0; i < box.children.length; i++) {
      e = box.children[i]
      if (/^H[1-6]$/.test(e.tagName) || rpOwn(e) || e.matches('.returns-system__policy-links') || e.querySelector('a[href],button,input,select,textarea')) continue
      if (!squash(e.textContent)) continue
      kids.push(e)
    }
    if (kids.length === 1 && kids[0].children.length > 1) return rpBlocks(kids[0])
    return kids
  }
  /** The page's own fixed points, in order. */
  function rpOriginals(box) {
    var out = [], list = box.querySelectorAll('li,p'), i, e
    for (i = 0; i < list.length; i++) {
      e = list[i]
      if (rpOwn(e) || e.closest('.returns-system__policy-links') || e.querySelector('a[href],button,input,select,textarea,li,p')) continue
      if (squash(e.textContent)) out.push(e)
    }
    return out.length ? out : rpBlocks(box)
  }
  function rpHide(e) {
    if (e.hasAttribute(RP_HIDE)) return
    rpShown.set(e, [e.style.getPropertyValue('display'), e.style.getPropertyPriority('display')])
    e.setAttribute(RP_HIDE, '')
    e.style.setProperty('display', 'none', 'important')
    rpTouched = true
  }
  function rpShowAll() {
    var list = document.querySelectorAll('[' + RP_HIDE + ']'), i, e, was
    for (i = 0; i < list.length; i++) {
      e = list[i]; was = rpShown.get(e)
      e.removeAttribute(RP_HIDE)
      if (was && was[0]) e.style.setProperty('display', was[0], was[1]); else e.style.removeProperty('display')
      if (!e.getAttribute('style')) e.removeAttribute('style')
    }
    if (rpNode && rpNode.parentNode) rpNode.parentNode.removeChild(rpNode)   // our own node, never React's
    rpNode = null; rpSig = ''
  }
  /** The list: hide the originals, keep ONE node of ours right after them. */
  function rpPoints(want) {
    var box = document.querySelector('.returns-system__policy')
    if (!box || !want || !want.points.length) { if (rpTouched) { rpShowAll(); rpTouched = false } return }
    var orig = rpOriginals(box)
    if (!orig.length) { if (rpTouched) { rpShowAll(); rpTouched = false } return }
    var first = orig[0], parent = first.parentNode, i
    var together = parent !== box && !parent.querySelector('a[href],button,input,select,textarea') && !/^H[1-6]$/.test(parent.tagName)
    for (i = 0; i < orig.length && together; i++) if (orig[i].parentNode !== parent) together = false
    var anchor = together ? parent : orig[orig.length - 1]
    var sig = seenLang + '\n' + want.points.join('\n')
    if (rpNode && rpNode.isConnected && rpSig === sig && anchor.nextSibling === rpNode) {
      // still in place: only make sure a re-rendered original is hidden again
      if (together) rpHide(parent); else for (i = 0; i < orig.length; i++) rpHide(orig[i])
      return
    }
    if (rpNode && rpNode.parentNode) rpNode.parentNode.removeChild(rpNode)
    var holder = document.createElement(together ? parent.tagName : 'div')
    if (together) { if (parent.className) holder.className = parent.className }
    else holder.style.display = 'contents'            // the points stay direct items of the section's own layout
    holder.setAttribute(RP_OURS, 'points')
    holder.setAttribute('lang', seenLang); holder.setAttribute('dir', seenLang === 'en' ? 'ltr' : 'rtl')
    for (i = 0; i < want.points.length; i++) {
      var item = document.createElement(first.tagName)
      if (first.className) item.className = first.className
      item.textContent = want.points[i]
      holder.appendChild(item)
    }
    if (together) rpHide(parent); else for (i = 0; i < orig.length; i++) rpHide(orig[i])
    anchor.parentNode.insertBefore(holder, anchor.nextSibling)
    rpNode = holder; rpSig = sig; rpTouched = true; api.applied++
  }
  /** The two text swaps (intro, the number of days), handed to the text pass as `forced` so it keeps and restores them. */
  function rpTexts(want, forced) {
    if (!want) return
    var i, w, n, list
    if (want.intro) {
      var box = document.querySelector('.returns-system__intro')
      list = box ? box.querySelectorAll('p') : []
      for (i = 0; i < list.length; i++) {
        var p = list[i]
        if (rpOwn(p) || p.childNodes.length !== 1 || p.firstChild.nodeType !== 3 || !squash(origOf(p.firstChild))) continue
        forced.set(p.firstChild, want.intro)
        break
      }
    }
    if (want.days !== 14 && !want.points.length) {
      var pol = document.querySelector('.returns-system__policy')
      var orig = pol ? rpOriginals(pol) : []
      if (orig.length) {
        w = document.createTreeWalker(orig[0], 4, null)
        while ((n = w.nextNode())) {
          var o = origOf(n), s = swapDays(o, want.days)
          if (s != null) { forced.set(n, squash(s)); break }
        }
      }
    }
  }

  // ------------------------------------------------------------------- passes
  var ADDR = 'address,[itemprop="streetAddress"]'
  /** Everything under `root` (an element), or the one text node. */
  function process(root) {
    if (!root) return
    var forced = new Map(), i, list
    var rp = rpActive()
    if (rp) rpTexts(rp, forced)
    if (root.nodeType === 3) {
      var host = root.parentNode
      if (!host || host.nodeType !== 1) return
      var a = host.closest('a[href]'), ad = host.closest(ADDR)
      if (a) doLink(a, forced)
      if (ad) doAddress(ad, forced)
      doText(root, forced.get(root))
      forced.forEach(function (v, n) { if (n !== root) doText(n, v) })
      return
    }
    if (root.nodeType !== 1) return
    if (contact || wrote) {
      var up = root.closest('a[href]'), upAd = root.closest(ADDR)
      if (up) doLink(up, forced)
      list = root.querySelectorAll('a[href]')
      for (i = 0; i < list.length; i++) doLink(list[i], forced)
      if (upAd) doAddress(upAd, forced)
      list = root.querySelectorAll(ADDR)
      for (i = 0; i < list.length; i++) doAddress(list[i], forced)
    }
    if (!dict && !wrote && !forced.size) return
    var w = document.createTreeWalker(root, 4, null), n
    while ((n = w.nextNode())) doText(n, forced.get(n))
  }
  function drain() { if (mo) { try { mo.takeRecords() } catch (e) {} } }
  function full() {
    queued = false
    resolve()
    var rp = rpActive()
    if (document.body && (dict || contact || wrote || rp)) {
      try { process(document.body) } catch (e) { /* never break the shop */ }
      if (!dict && !contact && !rp) wrote = false       // everything has been put back
    }
    if (rp || rpTouched) { try { rpPoints(rp) } catch (e) { /* never break the shop */ } }
    drain()
    watch()
  }
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { try { full() } catch (e) { queued = false } })
  }
  function onMutations(muts) {
    try {
      if (path() !== seenPath || lang() !== seenLang) { full(); return }
      var rp = rpActive()
      if (!dict && !contact && !rp) return
      if (muts.length > 150) { full(); return }
      var seen = [], done = [], i, j, m, n
      for (i = 0; i < muts.length; i++) {
        m = muts[i]
        if (m.type === 'childList') { for (j = 0; j < m.addedNodes.length; j++) seen.push(m.addedNodes[j]) }
        else seen.push(m.target)
      }
      for (i = 0; i < seen.length; i++) {
        n = seen[i]
        if (!n || !n.isConnected || !document.body.contains(n)) continue
        // a node inside a subtree already handled in this batch is not walked twice (only subtrees that WERE handled count)
        var inside = false
        for (j = 0; j < done.length && !inside; j++) if (done[j] === n || (done[j].nodeType === 1 && done[j].contains(n))) inside = true
        if (!inside) { process(n); done.push(n) }
      }
      if (rp) rpPoints(rp)
      drain()
    } catch (e) { /* never break the shop */ }
  }
  /** Watch only while there is something to do; the route and the language are always followed. */
  function watch() {
    if (!mo) mo = new MutationObserver(onMutations)
    if (!watching && content && !isEmpty(content) && document.body) {
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] })
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] })
      watching = true
    } else if (watching && (!content || isEmpty(content)) && !wrote && !rpTouched) {
      mo.disconnect(); watching = false
    }
  }

  // ------------------------------------------------------------------ loading
  function ask() {
    if (asked) return
    asked = true
    api.requests++
    fetch(URL_, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status === 404 || r.status === 405 || r.status === 501) { writeCache({ absent: Date.now() }); return null }
      if (!r.ok) return null
      return r.json().then(function (j) {
        var fresh = sanitise(j)
        if (!fresh) return
        var before = JSON.stringify(content)
        writeCache(fresh)
        if (JSON.stringify(fresh) === before) return
        content = fresh
        applyIcon()
        full()
        // sporta-footer-call.js builds its label from the kept copy: it reads it again now that the fresh answer is kept
        try { window.dispatchEvent(new Event('sporta:content')) } catch (e) { /* no event, the label is the build's own until the next load */ }
      })
    }).catch(function () { /* offline, or not JSON: the kept copy stands */ })
  }
  function start() {
    var cached = readCache()
    var absent = cached && typeof cached.absent === 'number' ? cached.absent : 0
    if (cached && !absent) content = cached
    applyIcon()   // from the kept copy, before anything is asked: also on the pages this block otherwise leaves alone
    if (content && !isEmpty(content)) full()
    // the route can change without a load (a blocked page first, then the shop)
    window.addEventListener('popstate', schedule)
    var go = function () {
      if (BLOCKED.test(path())) return false
      if (absent && Date.now() - absent < ABSENT_MS && Date.now() >= absent) return true
      ask()
      return true
    }
    if (!go()) {
      // Loaded on a page this block leaves alone: nothing is asked for until the visitor is somewhere else.
      var wait = new MutationObserver(function () {
        if (BLOCKED.test(path())) return
        wait.disconnect()
        go()
      })
      if (document.body) wait.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('popstate', function () { if (!asked && !BLOCKED.test(path())) { wait.disconnect(); go() } })
    }
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
  } catch (e) {}
})()
/* ===== SITE CONTENT - end ================================================ */

/* ===== PHOTO BACKDROP (2026-11-12, owner: "improve images layout") ========
 * The product photographs carry their own studio backdrop (live scan 2026-11-10: a grey-beige about 195/192/184) and the
 * frames they sit in are white: a shop card is 4:5 and the product page stage is square, and every photo is shown whole
 * (object-fit: contain, never cropped). Wherever the photo's shape is not the frame's, the frame shows white bands beside
 * or above and below the backdrop (on the product page: two side bands plus the stage's padding ring), so one picture
 * reads as a beige box pasted on white.
 * This block reads the photo's own edge pixels once it has loaded and, when the edges the bands touch are plain
 * backdrop, paints that backdrop behind the photo: each band continues its own edge as a gradient along it (so a
 * vignetted backdrop runs on without a seam) and the edges' median colour fills a padding ring. The picture itself is
 * never touched: no crop, no scale, no new request (it reads the decoded copy the page already has, into a 40px
 * canvas), and the file is not re-encoded (product photos stay lossless). It only writes one custom property
 * (--sporta-photo-bg, a background value) and data-sporta-bg="1" on the <img>; sporta-images.css (IMAGES-1112) paints it.
 * The <img>'s own background is what shows in the bands (object-fit leaves it visible), so every slide of a gallery
 * and every card carries its own photo's backdrop. Work is done in idle time after the photo's load event. An edge that is not plain (a garment cut by the
 * frame, a lifestyle photo) leaves the photo exactly as it was. The "no photo" plate is never sampled.
 * Same-origin files only (a canvas cannot read another origin: the try/catch leaves such a photo alone); nothing on
 * /backends. One result per file is remembered for the page, so the same photo in a card, the related row and the
 * gallery is read once. Leading ";" because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    var cv = document.createElement('canvas')
    if (!cv.getContext) return
    var cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) return
    var SEL = 'img.catalog-card-photo, .catalog-gallery img'
    var PLATE = /product-photo-unavailable/
    var TOL = 22      // largest step (per channel, 0-255) an edge pixel may stand from the edge's median and still be "backdrop"
    var memo = {}     // file -> edge reading, or false
    var work = [], busy = false
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 30) }

    var clear = function (img) {
      if (!img.hasAttribute('data-sporta-bg')) return
      img.removeAttribute('data-sporta-bg')
      img.style.removeProperty('--sporta-photo-bg')
    }
    var rgb = function (p) { return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')' }
    var med = function (px) {
      var o = [0, 0, 0]
      for (var c = 0; c < 3; c++) { var v = px.map(function (p) { return p[c] }).sort(function (a, b) { return a - b }); o[c] = v[v.length >> 1] }
      return o
    }
    var plain = function (px) {
      var m = med(px)
      for (var i = 0; i < px.length; i++) for (var c = 0; c < 3; c++) if (Math.abs(px[i][c] - m[c]) > TOL) return false
      return true
    }
    // one edge as a gradient of six stops along it (each stop the average of its stretch of the edge)
    var ramp = function (dir, e) {
      var out = [], n = e.length
      for (var s = 0; s < 6; s++) {
        var i0 = Math.floor(s * n / 6), i1 = Math.max(i0 + 1, Math.floor((s + 1) * n / 6)), acc = [0, 0, 0], k = 0
        for (var i = i0; i < i1 && i < n; i++, k++) for (var c = 0; c < 3; c++) acc[c] += e[i][c]
        out.push(rgb(acc.map(function (v) { return Math.round(v / k) })) + ' ' + Math.round((s + 0.5) * 100 / 6) + '%')
      }
      return 'linear-gradient(' + dir + ', ' + out.join(', ') + ')'
    }
    // the size of the small copy the edges are read from (40px on the long side)
    var dims = function (img) {
      var nw = img.naturalWidth, nh = img.naturalHeight
      if (!nw || !nh) return null
      return [nw >= nh ? 40 : Math.max(8, Math.round(40 * nw / nh)), nh >= nw ? 40 : Math.max(8, Math.round(40 * nh / nw))]
    }
    // read the four edges of the small copy (src: the <img> itself, or an ImageBitmap already made at W x H)
    var read = function (src, W, H) {
      cv.width = W; cv.height = H
      cx.clearRect(0, 0, W, H)
      cx.drawImage(src, 0, 0, W, H)
      var d = cx.getImageData(0, 0, W, H).data
      var at = function (x, y) { var i = (y * W + x) * 4; return d[i + 3] < 250 ? null : [d[i], d[i + 1], d[i + 2]] }
      var L = [], R = [], T = [], B = [], x, y
      for (y = 0; y < H; y++) { L.push(at(0, y)); R.push(at(W - 1, y)) }
      for (x = 0; x < W; x++) { T.push(at(x, 0)); B.push(at(x, H - 1)) }
      var all = L.concat(R, T, B)
      if (all.some(function (p) { return !p })) return false   // a transparent edge: the frame's own white shows through, as designed
      return {
        side: plain(L) && plain(R), ends: plain(T) && plain(B), ring: plain(all),
        bg: rgb(med(all)), L: ramp('to bottom', L), R: ramp('to bottom', R), T: ramp('to right', T), B: ramp('to right', B),
      }
    }
    // the background value: each band continues its own edge (left / right, or top / bottom); the colour fills a padding ring
    var paint = function (r, need) {
      var lay = need === 'side'
        ? [r.L + ' left top / 50% 100% no-repeat content-box border-box', r.R + ' right top / 50% 100% no-repeat content-box border-box']
        : need === 'ends' ? [r.T + ' left top / 100% 50% no-repeat content-box border-box', r.B + ' left bottom / 100% 50% no-repeat content-box border-box'] : []
      return lay.concat(r.bg).join(', ')
    }
    var apply = function (img) {
      var src = img.currentSrc || img.src || ''
      if (!src || PLATE.test(src) || !img.isConnected) return clear(img)
      if (!(src in memo)) {
        var wh = dims(img)
        if (!wh) return clear(img)
        // A lossless upload is 3000-4000px: scaling it down on the main thread is a long task on a phone, so the small copy is
        // made by createImageBitmap (off the main thread where the browser can); the photo is read again when it is ready.
        if (window.createImageBitmap) {
          memo[src] = 'wait'
          try {
            window.createImageBitmap(img, { resizeWidth: wh[0], resizeHeight: wh[1], resizeQuality: 'medium' }).then(function (bm) {
              try { memo[src] = read(bm, wh[0], wh[1]) } catch (e) { memo[src] = false }
              try { bm.close() } catch (e) {}
              scan()
            }, function () { memo[src] = false })
          } catch (e) { memo[src] = false }
          return
        }
        try { memo[src] = read(img, wh[0], wh[1]) } catch (e) { memo[src] = false }
      }
      var r = memo[src]
      if (r === 'wait') return
      if (!r) return clear(img)
      var cs = getComputedStyle(img)
      if (cs.objectFit !== 'contain') return clear(img)
      var pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0
      var bw = img.clientWidth - pl - pr, bh = img.clientHeight - pt - pb
      if (!(bw > 0 && bh > 0)) return
      var ra = img.naturalWidth / img.naturalHeight, rb = bw / bh
      // which bands this frame shows: beside (photo narrower than the box), above and below (wider), none; padding adds a ring
      var need = ra < rb - 0.005 ? 'side' : ra > rb + 0.005 ? 'ends' : 'none'
      var ring = pl + pr + pt + pb > 0.5
      if ((need !== 'none' && !r[need]) || (ring && !r.ring) || (need === 'none' && !ring)) return clear(img)
      var v = paint(r, need)
      if (img.style.getPropertyValue('--sporta-photo-bg') !== v) img.style.setProperty('--sporta-photo-bg', v)
      if (img.getAttribute('data-sporta-bg') !== '1') img.setAttribute('data-sporta-bg', '1')
    }
    var drain = function () {
      busy = false
      var batch = work.splice(0, work.length)
      for (var i = 0; i < batch.length; i++) { try { apply(batch[i]) } catch (e) {} }
    }
    var queue = function (img) {
      if (work.indexOf(img) < 0) work.push(img)
      if (!busy) { busy = true; idle(drain, { timeout: 400 }) }
    }
    var matches = function (t) { return t && t.tagName === 'IMG' && t.matches && t.matches(SEL) }
    // load does not bubble, but it passes the document in the capture phase: every photo, also one whose src React changed in place
    document.addEventListener('load', function (e) { try { if (matches(e.target)) queue(e.target) } catch (x) {} }, true)
    document.addEventListener('error', function (e) { try { if (matches(e.target)) clear(e.target) } catch (x) {} }, true)
    var scan = function () {
      try {
        var list = document.querySelectorAll(SEL)
        for (var i = 0; i < list.length; i++) if (list[i].complete && list[i].naturalWidth) queue(list[i])
      } catch (e) {}
    }
    // a frame that changes shape (rotation, a wider window) can change which bands show
    var rs = 0
    window.addEventListener('resize', function () { clearTimeout(rs); rs = setTimeout(scan, 250) })
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true })
    else scan()
  } catch (e) {}
})()
/* ===== PHOTO BACKDROP - end ============================================== */

/* ===== BRAND STRIP DOCK (2026-11-19, owner: "fix it", after HOME-BRANDS-SCAN-2026-11-19.md item HB-02) ===============
 * From 1024px the compiled build docks the home page's brand strip under the header with `top: 9.75rem`, which is 1.1rem more
 * than the header (8.6rem, 145px at 1280px), so a 19px slit between the two showed the page scrolling through it. And the header
 * is not a fixed height: the announcement bar the owner writes can be cleared or wrap. This block reads the header's real height
 * and writes it as --sporta-dock-top on the strip; BRANDS-1119 in sporta-images.css uses it as `top` from 1024px (8.6rem until
 * this has run). It follows the header (ResizeObserver), the window (resize), late fonts and a page change that mounts the
 * strip. One custom property on the build's element, no markup, no request, nothing on /backends. Leading ";" because this
 * file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0 || window.__sportaBrandDock) return
    window.__sportaBrandDock = 1
    var raf = 0, watched = null, ro = null
    var apply = function () {
      raf = 0
      var bar = document.querySelector('.campaign-brand-bar--sticky')
      var hdr = document.querySelector('header.app-header') || document.querySelector('.app-header')
      if (!bar || !hdr) return
      var v = hdr.getBoundingClientRect().height.toFixed(2) + 'px'
      if (bar.style.getPropertyValue('--sporta-dock-top') !== v) bar.style.setProperty('--sporta-dock-top', v)
      if (window.ResizeObserver && watched !== hdr) {
        if (ro) ro.disconnect()
        ro = new ResizeObserver(later); try { ro.observe(hdr, { box: 'border-box' }) } catch (e) { ro.observe(hdr) } watched = hdr   // border-box: padding counts too
      }
    }
    var later = function () { if (!raf) raf = requestAnimationFrame(apply) }
    window.addEventListener('resize', later)
    window.addEventListener('load', later)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later, function () {})
    if (window.MutationObserver) new MutationObserver(later).observe(document.body, { childList: true, subtree: true })
    later()
  } catch (e) {}
})()
/* ===== BRAND STRIP DOCK - end ================================================= */

/* ===== IMAGE VIEWER (2026-11-12, owner: "improve images view") ============
 * The compiled product gallery already does most of it, and this block leaves all of that alone: the stage swipes on a
 * touch screen (in the right direction for Arabic), has a 2.5x hover lens with a mouse, arrows from 1024px, dots below
 * it, thumbnails with arrow keys, and a tap / click / Enter opens a full-screen lightbox (a portal in <body>,
 * .catalog-product-lightbox) that traps focus, closes on Escape, the X or the backdrop, locks the page scroll, gives focus
 * back, and loads the full-size original only then (the page and the cards keep their small copies).
 * What the lightbox lacked, added here around the live one (React keeps rendering it; nothing of its is replaced):
 *   - zoom: pinch, double-tap (or double-click), the wheel, + / - / 0 keys and a 44px zoom button; a zoomed photo pans
 *     with a finger or the mouse and never leaves the screen; a new photo starts unzoomed.
 *   - between photos: swipe (the stage's own direction rule: in Arabic a swipe to the right is the next photo), and 44px
 *     previous / next buttons on the reading-direction sides. The build's arrow keys were not mirrored in the lightbox
 *     (ArrowRight was "next" in Arabic too); in RTL they are, as on the stage and the thumbnails.
 *   - close: swipe down (the backdrop fades with the finger). A drag that ends on the backdrop no longer closes it.
 *   - screen readers: the dialog is described (how to zoom, move and close, ar / en), the "Image n of N" line is a
 *     polite live region, the stage says it opens a dialog.
 *   - no shift behind it: the build hides the page scrollbar while open, which moved the page sideways by the scrollbar's
 *     width; the gutter is kept (scrollbar-gutter, VIEWER-1112 in sporta-shadows.css). Touches on the viewer never scroll
 *     the page (touch-action: none, overscroll contained).
 *   - a spinner while the full-size original downloads.
 *   - PRO-1119 (owner, 2026-11-19: "make zoom full image view pro"; styles: VIEWER PRO 1119 in sporta-shadows.css):
 *       . a FILMSTRIP of the product's photos along the bottom (several photos only): the page's own thumbnails cloned
 *         (the same small copies the page already holds, so no new file), the current one ringed in the logo orange; a
 *         tap jumps there through the page's own thumbnail button (React keeps the index); it fades away while zoomed. The
 *         photo is given room above it (symmetric, so the zoom maths still centres on the box) and the counter moves up
 *         beside the buttons.
 *       . the photo shows at once: while the full-size original downloads the small copy the page already shows (read
 *         from the stage, only when it has loaded, so no new request) is drawn behind the spinner and the original
 *         replaces it.
 *       . a fling: a pan released with speed glides on and stops at the edge (a finger or the mouse on the photo catches
 *         it); not with reduced motion.
 *       . keys: while zoomed the arrow keys move the photo (Shift: further) so a keyboard user can reach every part of
 *         it; Home / End go to the first / last photo; a trackpad pinch (ctrl + wheel) zooms in fine steps.
 *       . the viewer opens with a short fade (no fade with reduced motion).
 *   - the "no photo" plate: the stage showing it no longer opens a viewer (nor the hover lens) and is marked
 *     aria-disabled, the zoom badge is hidden; a photo that fails inside the viewer (the build swaps in the plate) cannot
 *     be zoomed.
 * Only attributes are written on the build's elements (data-sporta-*, aria-*, inline transform on the lightbox photo);
 * the added controls are appended last inside the lightbox, so React's own children keep their places. Moving between
 * photos goes through the build's own keyboard handler (a synthetic arrow key on document), closing through its X, so
 * the gallery, the counter and the photo stay React's. No src written, no request of its own (the one use of a URL is the
 * placeholder above, a copy the page has already loaded), nothing on /backends. Leading ";"
 * because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.MutationObserver || window.__sportaImageViewer) return
    window.__sportaImageViewer = 1
    var BOX = '.catalog-product-lightbox', STAGE = '.catalog-gallery-stage'
    var PLATE = /product-photo-unavailable/
    var MAX = 4, DBL = 2.5, STEP = 1.5   // STEP: one press of + / - (the zoom bar and the keys)
    var ARROWS = { ArrowRight: [-1, 0], ArrowLeft: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }   // a zoomed photo moves opposite the view
    var TXT = {
      en: { prev: 'Previous photo', next: 'Next photo', zin: 'Zoom in', zout: 'Zoom out', reset: 'Reset zoom', group: 'Zoom', photos: 'Photos',
        hint: 'Full-screen photo. To zoom, pinch, double-tap or press + and -; drag a zoomed photo to move it. Swipe sideways or use the arrow keys for the other photos; while the photo is zoomed the arrow keys move it, and Home and End go to the first and last photo. Swipe down or press Escape to close.' },
      ar: { prev: 'الصورة السابقة', next: 'الصورة التالية', zin: 'تكبير', zout: 'تصغير', reset: 'إعادة الضبط', group: 'التكبير', photos: 'الصور',
        hint: 'صورة بملء الشاشة. للتكبير باعد بين إصبعين أو انقر مرتين أو اضغط + أو -، واسحب الصورة المكبّرة لتحريكها. للصور الأخرى اسحب جانبًا أو استخدم مفاتيح الأسهم؛ وعندما تكون الصورة مكبّرة تحرّكها مفاتيح الأسهم، ويذهب Home وEnd إلى أول صورة وآخر صورة. للإغلاق اسحب إلى الأسفل أو اضغط Escape.' }
    }
    var html = document.documentElement
    var txt = function () { return TXT[/^ar/i.test(html.getAttribute('lang') || '') ? 'ar' : 'en'] }
    var rtl = function () { return (html.getAttribute('dir') || '').toLowerCase() === 'rtl' }
    var calm = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v }
    var now = function () { return Date.now() }

    // ---- the gallery on the page --------------------------------------------------------------------------------
    var lastGap = 0   // the page scrollbar's width, read as the viewer is asked for (before the build hides it)
    var shownImg = function (stage) {
      var imgs = stage.querySelectorAll('.catalog-gallery-track > img')
      if (imgs.length < 2) return imgs[0] || null
      var r = stage.getBoundingClientRect(), cx = r.left + r.width / 2, best = imgs[0], d = Infinity
      for (var i = 0; i < imgs.length; i++) {
        var b = imgs[i].getBoundingClientRect(), dd = Math.abs(b.left + b.width / 2 - cx)
        if (dd < d) { d = dd; best = imgs[i] }
      }
      return best
    }
    var isPlate = function (img) { return !img || PLATE.test(img.getAttribute('src') || '') || PLATE.test(img.currentSrc || '') }
    var mark = function (stage) {
      if (isPlate(shownImg(stage))) {
        if (!stage.hasAttribute('data-sporta-noview')) { stage.setAttribute('data-sporta-noview', '1'); stage.setAttribute('aria-disabled', 'true') }
        if (stage.hasAttribute('aria-haspopup')) stage.removeAttribute('aria-haspopup')
      } else {
        if (stage.hasAttribute('data-sporta-noview')) { stage.removeAttribute('data-sporta-noview'); stage.removeAttribute('aria-disabled') }
        if (stage.getAttribute('aria-haspopup') !== 'dialog') stage.setAttribute('aria-haspopup', 'dialog')
      }
    }
    // capture phase on window: runs before the build's handlers (React listens on its root and on <body>)
    var guard = function (e) {
      var st = e.target && e.target.closest ? e.target.closest(STAGE) : null
      if (!st) return
      if (e.type !== 'mousemove') lastGap = Math.max(0, window.innerWidth - html.clientWidth)
      mark(st)
      if (!st.hasAttribute('data-sporta-noview')) return
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
      e.stopPropagation()
      if (e.type !== 'mousemove') e.preventDefault()
    }
    window.addEventListener('click', guard, true)
    window.addEventListener('keydown', guard, true)
    window.addEventListener('mousemove', guard, true)

    // ---- the lightbox ---------------------------------------------------------------------------------------------
    var V = null        // the open viewer: { box, img, s, x, y, ... }
    var P = {}, np = 0  // active pointers
    var g = null        // the gesture in progress
    var tap = null      // the last tap (double-tap)
    var quietUntil = 0  // a click right after a drag is not a click on the backdrop

    var key = function (k) {
      var ev = new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true })
      ev.__sportaViewer = 1
      document.dispatchEvent(ev)
    }
    var go = function (d) { if (V && V.total > 1) key(d > 0 ? 'ArrowRight' : 'ArrowLeft') }   // the build: ArrowRight = next
    var closeBox = function () {
      if (!V) return
      var x = V.box.querySelector(':scope > button:not(.sporta-viewer-btn)')
      quietUntil = 0
      if (x) x.click()
    }
    var plateIn = function () { return !V || isPlate(V.img) }
    var apply = function (anim) {
      if (!V) return
      var st = V.img.style
      st.transition = anim && !calm() ? 'transform 220ms cubic-bezier(.22,.61,.36,1)' : 'none'
      st.transform = V.s === 1 && !V.x && !V.y ? '' : 'translate3d(' + V.x.toFixed(1) + 'px,' + V.y.toFixed(1) + 'px,0) scale(' + V.s.toFixed(3) + ')'
      var z = V.s > 1.01
      if (z !== V.zoomed) {
        V.zoomed = z
        if (z) V.box.setAttribute('data-sporta-zoomed', '1'); else V.box.removeAttribute('data-sporta-zoomed')
        if (V.zbtn) { V.zbtn.setAttribute('aria-pressed', z ? 'true' : 'false'); V.zbtn.setAttribute('aria-label', z ? txt().zout : txt().zin) }
      }
      level()
    }
    // THE ZOOM BAR'S READOUT AND LIMITS, written from the photo's own scale, so a pinch, the wheel and the keys keep it
    // true as well as the bar's buttons. At the limits the matching button is marked aria-disabled (the press does
    // nothing); the level button resets to 100% and is off while the photo is whole.
    var level = function () {
      if (!V || !V.lvl) return
      var pct = Math.round(V.s * 100) + '%'
      if (V.lvl.textContent !== pct) V.lvl.textContent = pct
      var whole = V.s <= 1.001, top = V.s >= MAX - 0.001
      V.zin.setAttribute('aria-disabled', top ? 'true' : 'false')
      V.zout.setAttribute('aria-disabled', whole ? 'true' : 'false')
      V.lvl.setAttribute('aria-disabled', whole ? 'true' : 'false')
    }
    var bound = function () {
      var w = V.img.offsetWidth * V.s, h = V.img.offsetHeight * V.s
      var mx = Math.max(0, (w - V.box.clientWidth) / 2), my = Math.max(0, (h - V.box.clientHeight) / 2)
      V.x = clamp(V.x, -mx, mx); V.y = clamp(V.y, -my, my)
    }
    // zoom to scale ns keeping the screen point (px, py) still; the photo is centred in the box
    var zoomAt = function (ns, px, py, anim) {
      if (!V || plateIn()) return
      stopFling()
      var r = V.box.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
      if (px == null) { px = cx; py = cy }
      ns = clamp(ns, 1, MAX)
      var lx = (px - cx - V.x) / V.s, ly = (py - cy - V.y) / V.s
      V.x = px - cx - ns * lx; V.y = py - cy - ns * ly; V.s = ns
      if (ns === 1) { V.x = 0; V.y = 0 }
      bound(); apply(anim)
    }
    var reset = function (anim) { if (!V) return; stopFling(); V.s = 1; V.x = 0; V.y = 0; V.box.style.removeProperty('background-color'); apply(anim) }
    var loading = function () {
      if (!V) return
      if (V.img.complete && V.img.naturalWidth) V.box.removeAttribute('data-sporta-loading'); else if (!V.img.complete) V.box.setAttribute('data-sporta-loading', '1'); else V.box.removeAttribute('data-sporta-loading')
      if (plateIn()) { V.box.setAttribute('data-sporta-plate', '1'); reset(false) } else V.box.removeAttribute('data-sporta-plate')
      placeholder()
    }
    var mk = function (cls, label) {
      var b = document.createElement('button')
      b.type = 'button'; b.className = 'sporta-viewer-btn ' + cls; b.setAttribute('aria-label', label)
      b.addEventListener('click', function (e) { e.stopPropagation() })   // never reaches the backdrop's "close"
      return b
    }
    var counter = function () {
      var p = V && V.box.querySelector(':scope > p:not(.sporta-viewer-hint)')
      if (p && p.getAttribute('aria-live') !== 'polite') { p.setAttribute('aria-live', 'polite'); p.setAttribute('aria-atomic', 'true') }
    }

    // ---- PRO-1119: the filmstrip, the placeholder, the fling ------------------------------------------------------------
    // The page's own thumbnail buttons (the build's gallery state is React's): aria-current marks the photo on show, and a
    // click on one is the build's own "go to photo n", which the lightbox follows (it shows the same index).
    var pageThumbs = function () { return document.querySelectorAll('.catalog-gallery-thumbs > button') }
    var curIndex = function () {
      var t = pageThumbs()
      for (var i = 0; i < t.length; i++) if (t[i].getAttribute('aria-current') === 'true') return i
      return 0
    }
    var jump = function (n) {
      var t = pageThumbs()
      if (!V || !t[n] || n === curIndex()) return
      reset(false); t[n].click()
    }
    var refreshStrip = function () {
      if (!V || !V.thumbs) return
      var at = curIndex()
      for (var i = 0; i < V.thumbs.length; i++) {
        var on = i === at ? 'true' : 'false'
        if (V.thumbs[i].getAttribute('aria-current') !== on) V.thumbs[i].setAttribute('aria-current', on)
      }
      // keep the current thumbnail in view of a strip that scrolls (many photos); the strip is its own scroller and the
      // page behind is locked, so nothing else moves
      var c = V.thumbs[at]
      if (c && V.strip && V.strip.scrollWidth > V.strip.clientWidth + 1 && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch (e) {} }
    }
    var buildStrip = function () {
      var th = pageThumbs()
      if (!V || V.total < 2 || th.length !== V.total) return
      var strip = document.createElement('div')
      strip.className = 'sporta-viewer-strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', txt().photos)
      strip.addEventListener('click', function (e) { e.stopPropagation() })   // a press between two thumbnails is not the backdrop
      V.thumbs = []
      for (var i = 0; i < th.length; i++) {
        var b = document.createElement('button')
        b.type = 'button'; b.className = 'sporta-viewer-thumb'
        b.setAttribute('aria-label', th[i].getAttribute('aria-label') || '')
        var im = th[i].querySelector('img')
        if (im) {
          // a clone, so the same small copy the page holds (no src is written here); it must load now, not when scrolled to
          var c = im.cloneNode(false)
          c.removeAttribute('class'); c.removeAttribute('style'); c.setAttribute('alt', ''); c.setAttribute('loading', 'eager'); c.setAttribute('draggable', 'false')
          b.appendChild(c)
        }
        b.addEventListener('click', (function (n) { return function (e) { e.stopPropagation(); jump(n) } })(i))
        strip.appendChild(b); V.thumbs.push(b)
      }
      V.box.appendChild(strip)
      V.strip = strip
      V.box.setAttribute('data-sporta-strip', '1')
      refreshStrip()
    }
    // While the original downloads, the small copy the page already shows stands in for it: the same contain-fit, so the
    // original replaces it in place. Only a copy that has finished loading is used (a URL never loaded would be a request).
    var placeholder = function () {
      if (!V) return
      if (!V.box.hasAttribute('data-sporta-loading') || plateIn()) {
        if (V.ph) { V.box.style.removeProperty('--sporta-viewer-ph'); V.ph = '' }
        return
      }
      var tr = document.querySelectorAll('.catalog-gallery-track > img'), im = tr[curIndex()] || tr[0]
      var u = im && im.complete && im.naturalWidth && !isPlate(im) ? (im.currentSrc || im.getAttribute('src') || '') : ''
      try { if (u && new URL(u, location.href).origin !== location.origin) u = '' } catch (e) { u = '' }
      u = u.replace(/["'()\\\s]/g, function (ch) { return '%' + ch.charCodeAt(0).toString(16).toUpperCase() })
      var v = u ? 'url("' + u + '")' : ''
      if (v !== V.ph) { if (v) V.box.style.setProperty('--sporta-viewer-ph', v); else V.box.style.removeProperty('--sporta-viewer-ph'); V.ph = v }
    }
    // FLING: a pan released with speed glides on, slows with a 325 ms time constant and stops at the edge. A new touch, a
    // wheel turn, a key or a new photo ends it. Not with reduced motion (the photo stops where the finger lifted).
    var fling = 0
    var stopFling = function () { if (fling) { cancelAnimationFrame(fling); fling = 0 } }
    var startFling = function (vx, vy) {
      stopFling()
      var last = now()
      var step = function () {
        if (!V) { fling = 0; return }
        var t = now(), dt = Math.min(50, Math.max(1, t - last)); last = t
        var px = V.x, py = V.y
        V.x += vx * dt; V.y += vy * dt; bound()
        if (V.x === px) vx = 0
        if (V.y === py) vy = 0
        var k = Math.exp(-dt / 325); vx *= k; vy *= k
        apply(false)
        if (Math.hypot(vx, vy) < 0.02) { fling = 0; return }
        fling = requestAnimationFrame(step)
      }
      fling = requestAnimationFrame(step)
    }

    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
    var two = function () { var k = Object.keys(P); return [P[k[0]], P[k[1]]] }
    var down = function (e) {
      if (!V || !V.box.contains(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
      if (e.target.closest('button, .sporta-viewer-strip, .sporta-viewer-zoombar')) return
      stopFling()   // a touch on a gliding photo catches it
      P[e.pointerId] = { x: e.clientX, y: e.clientY }; np = Object.keys(P).length
      if (np === 2 && !plateIn()) {
        var ab = two(), mid = { x: (ab[0].x + ab[1].x) / 2, y: (ab[0].y + ab[1].y) / 2 }
        g = { mode: 'pinch', d0: dist(ab[0], ab[1]) || 1, s0: V.s, x0: V.x, y0: V.y, m0: mid, moved: true }
      } else if (np === 1) {
        g = { mode: '', id: e.pointerId, sx: e.clientX, sy: e.clientY, t0: now(), x0: V.x, y0: V.y, moved: false, onImg: e.target === V.img, type: e.pointerType }
      }
    }
    var move = function (e) {
      if (!V || !P[e.pointerId] || !g) return
      P[e.pointerId] = { x: e.clientX, y: e.clientY }
      if (g.mode === 'pinch') {
        if (Object.keys(P).length < 2) return
        var ab = two(), mid = { x: (ab[0].x + ab[1].x) / 2, y: (ab[0].y + ab[1].y) / 2 }
        var r = V.box.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
        var ns = clamp(g.s0 * dist(ab[0], ab[1]) / g.d0, 1, MAX)
        var lx = (g.m0.x - cx - g.x0) / g.s0, ly = (g.m0.y - cy - g.y0) / g.s0
        V.s = ns; V.x = mid.x - cx - ns * lx; V.y = mid.y - cy - ns * ly
        if (ns === 1) { V.x = 0; V.y = 0 }
        bound(); apply(false)
        return
      }
      if (e.pointerId !== g.id) return
      var dx = e.clientX - g.sx, dy = e.clientY - g.sy
      if (!g.moved && Math.hypot(dx, dy) < 8) return
      g.moved = true
      if (V.s > 1.01) {
        g.mode = 'pan'
        var ox = V.x, oy = V.y, tm = now()
        V.x = g.x0 + dx; V.y = g.y0 + dy; bound(); apply(false)
        // the release speed (px per ms), smoothed over the last few moves; read by up() for the fling
        if (g.lt) { var dtm = Math.max(1, tm - g.lt); g.vx = g.vx == null ? (V.x - ox) / dtm : 0.6 * ((V.x - ox) / dtm) + 0.4 * g.vx; g.vy = g.vy == null ? (V.y - oy) / dtm : 0.6 * ((V.y - oy) / dtm) + 0.4 * g.vy }
        g.lt = tm
        return
      }
      if (g.type === 'mouse') return   // a mouse moves between photos with the buttons and the keys
      if (!g.mode) g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : dy > 0 ? 'down' : 'none'
      if (g.mode === 'swipe') { V.x = V.total > 1 ? dx : dx * 0.3; V.y = 0; apply(false) }
      else if (g.mode === 'down') {
        V.y = Math.max(0, dy); V.x = 0; apply(false)
        V.box.style.backgroundColor = 'rgba(0,0,0,' + (0.92 * (1 - Math.min(0.85, V.y / 400))).toFixed(3) + ')'
      }
    }
    var up = function (e) {
      if (!P[e.pointerId]) return
      delete P[e.pointerId]
      var left = Object.keys(P)
      if (!V || !g) { if (!left.length) g = null; return }
      if (g.mode === 'pinch') {
        if (left.length === 1) { var q = P[left[0]]; g = { mode: 'pan', id: +left[0], sx: q.x, sy: q.y, t0: now(), x0: V.x, y0: V.y, moved: true, type: 'touch' } }
        else if (!left.length) { if (V.s < 1.05) reset(true); g = null; quietUntil = now() + 400 }
        return
      }
      if (e.pointerId !== g.id) return
      var dx = e.clientX - g.sx, dy = e.clientY - g.sy, dt = Math.max(1, now() - g.t0)
      var w = V.box.clientWidth
      if (g.moved) quietUntil = now() + 400
      if (g.mode === 'swipe') {
        if (V.total > 1 && (Math.abs(dx) > Math.max(56, w * 0.18) || (Math.abs(dx) > 24 && Math.abs(dx) / dt > 0.45))) {
          var d = dx < 0 ? 1 : -1
          if (rtl()) d = -d
          reset(false); go(d)
        } else reset(true)
      } else if (g.mode === 'down') {
        if (dy > 110 || (dy > 40 && dy / dt > 0.5)) closeBox(); else reset(true)
      } else if (g.mode === 'pan') {
        if (V.s < 1.05) reset(true)
        // a release with speed (and not after a pause: the last move was a moment ago) glides on
        else if (!calm() && g.lt && now() - g.lt < 90 && Math.hypot(g.vx || 0, g.vy || 0) > 0.12) startFling(g.vx || 0, g.vy || 0)
      } else if (!g.moved && g.onImg && e.target === V.img) {
        var t = now()
        if (tap && t - tap.t < 320 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) {
          tap = null
          if (V.s > 1.01) reset(true); else zoomAt(DBL, e.clientX, e.clientY, true)
        } else tap = { t: t, x: e.clientX, y: e.clientY }
      }
      g = null
    }
    var wheel = function (e) {
      if (!V || !V.box.contains(e.target) || plateIn()) return
      if (e.target !== V.img && V.s === 1) return
      e.preventDefault()
      // a line- or page-mode wheel reports lines, not pixels; a trackpad pinch arrives as ctrl + wheel in small steps
      var d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1)
      zoomAt(V.s * Math.exp(-clamp(d, -120, 120) * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX, e.clientY, false)
    }
    var keys = function (e) {
      if (!V || e.__sportaViewer || !V.box.isConnected) return
      var k = e.key
      var pan = V.s > 1.01 && !plateIn() ? ARROWS[k] : null
      if (pan) {
        // zoomed, the arrows move the photo (Shift: three times as far), the way a finger would; the other photos are
        // reached with Home / End, the buttons and the strip, or after 0 (reset)
        e.stopPropagation(); e.preventDefault()
        stopFling()
        var stp = e.shiftKey ? 240 : 80
        V.x += pan[0] * stp; V.y += pan[1] * stp; bound(); apply(true)
      } else if ((k === 'Home' || k === 'End') && V.thumbs) {
        e.stopPropagation(); e.preventDefault()
        jump(k === 'Home' ? 0 : V.total - 1)
      } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && rtl()) {
        // the build's lightbox reads ArrowRight as "next" in both languages; in Arabic the next photo is to the left
        e.stopPropagation(); e.preventDefault()
        go(k === 'ArrowLeft' ? 1 : -1)
      } else if (k === '+' || k === '=') { e.preventDefault(); zoomAt(V.s * STEP, null, null, true) }
      else if (k === '-' || k === '_') { e.preventDefault(); zoomAt(V.s / STEP, null, null, true) }
      else if (k === '0') { e.preventDefault(); reset(true) }
    }
    var quiet = function (e) {
      if (V && now() < quietUntil && V.box.contains(e.target)) { e.stopPropagation(); e.preventDefault(); quietUntil = 0 }
    }

    var open = function (box) {
      var img = box.querySelector(':scope > img')
      if (!img) return
      var tt = txt()
      V = { box: box, img: img, s: 1, x: 0, y: 0, zoomed: false, total: document.querySelectorAll('.catalog-gallery-track > img').length || 1 }
      box.setAttribute('data-sporta-viewer', '1')
      var hint = document.createElement('p')
      hint.className = 'sporta-viewer-hint'; hint.id = 'sporta-viewer-hint'; hint.textContent = tt.hint
      box.appendChild(hint)
      box.setAttribute('aria-describedby', hint.id)
      if (V.total > 1) {
        var pv = mk('sporta-viewer-prev', tt.prev), nx = mk('sporta-viewer-next', tt.next)
        pv.addEventListener('click', function () { reset(false); go(-1) })
        nx.addEventListener('click', function () { reset(false); go(1) })
        box.appendChild(pv); box.appendChild(nx)
      }
      V.zbtn = mk('sporta-viewer-zoom', tt.zin)
      V.zbtn.setAttribute('aria-pressed', 'false')
      V.zbtn.addEventListener('click', function () { if (!V) return; if (V.s > 1.01) reset(true); else zoomAt(DBL, null, null, true) })
      box.appendChild(V.zbtn)
      // THE ZOOM BAR: − , the level, + at the foot of the photo. The top button is a toggle and the wheel and the keys are
      // not in sight, so a mouse user had no visible way to see or step the zoom. Hidden on the plate (CSS, viewer-6).
      var bar = document.createElement('div')
      bar.className = 'sporta-viewer-zoombar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', tt.group)
      bar.addEventListener('click', function (e) { e.stopPropagation() })   // a press on the bar is not a press on the backdrop
      V.zout = mk('sporta-viewer-zout', tt.zout)
      V.lvl = mk('sporta-viewer-level', tt.reset)
      V.zin = mk('sporta-viewer-zin', tt.zin)
      V.zout.addEventListener('click', function () { if (V && V.s > 1.01) zoomAt(V.s / STEP, null, null, true) })
      V.zin.addEventListener('click', function () { if (V && V.s < MAX - 0.001) zoomAt(V.s * STEP, null, null, true) })
      V.lvl.addEventListener('click', function () { if (V && V.s > 1.01) reset(true) })
      bar.appendChild(V.zout); bar.appendChild(V.lvl); bar.appendChild(V.zin)
      box.appendChild(bar)
      V.bar = bar
      buildStrip()
      level()
      html.setAttribute('data-sporta-viewer-lock', lastGap > 0 ? 'gutter' : '1')
      V.mo = new MutationObserver(function () { if (!V) return; reset(false); loading(); counter(); refreshStrip() })
      V.mo.observe(img, { attributes: true, attributeFilter: ['src'] })
      img.addEventListener('load', loading); img.addEventListener('error', loading)
      box.addEventListener('wheel', wheel, { passive: false })
      loading(); counter()
    }
    var closed = function () {
      if (!V) return
      V.mo.disconnect()
      stopFling()
      V = null; P = {}; g = null; tap = null
      html.removeAttribute('data-sporta-viewer-lock')
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', function (e) { if (P[e.pointerId]) { delete P[e.pointerId]; if (V && !Object.keys(P).length) { if (V.s < 1.05) reset(true); V.box.style.removeProperty('background-color') } g = null } }, true)
    window.addEventListener('keydown', keys, true)
    window.addEventListener('click', quiet, true)

    // ---- watch the page ------------------------------------------------------------------------------------------
    var raf = 0
    var scan = function () {
      raf = 0
      var st = document.querySelectorAll(STAGE)
      for (var i = 0; i < st.length; i++) mark(st[i])
      counter()
    }
    var later = function () { if (!raf) raf = requestAnimationFrame(scan) }
    var check = function () {
      var b = document.querySelector(BOX)
      if (V && (!b || b !== V.box)) closed()
      if (b && !V) open(b)
    }
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (!(V && V.box.contains(t))) { later(); break } }
      check()
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] })
    document.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IMG') later() }, true)
    document.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') later() }, true)
    document.addEventListener('transitionend', function (e) { if (e.target && e.target.classList && e.target.classList.contains('catalog-gallery-track')) later() }, true)
    later(); check()
  } catch (e) {}
})()
/* ===== IMAGE VIEWER - end ================================================= */

/* ===== NAMES-1119: a line never starts with a dash (2026-11-19, owner: "make product name style improve") ============
 * A product's colour is written after a dash in its name ("Cloudsoft Leggings — Army Green"), and a name that wraps broke
 * BEFORE the dash, so the second line began with "— Army Green" (cards, the product title, the bag page and the drawer).
 * This joins each dash that has a space on both sides to the word before it with a no-break space, so the break falls after
 * the dash, as in print ("Cloudsoft Leggings —" / "Army Green"). It writes only the text of a name that holds such a dash,
 * once (a second pass finds nothing to change), and again after React rewrites the text (a new product list, a language
 * switch): the observer watches text changes, and its own write wakes it for one pass that finds nothing. Reading the name
 * is unaffected (a no-break space reads as a space; the tooltip block below normalises whitespace). Not on /backends.
 * Styles for the bag surfaces: NAMES-1119 in sporta-shadows.css. Leading ";" because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0 || window.__sportaNameGlue) return
    window.__sportaNameGlue = 1
    var SEL = '.storefront-root .catalog-card-name, .storefront-root .catalog-product-title, .storefront-root .cart-line h3, ' +
      '.campaign-cart-drawer .cart-drawer__line .min-w-0 > p:first-child'
    var DASH = / ([—–-]) /g, HAS = / [—–-] /
    var timer = 0
    var run = function () {
      timer = 0
      var list = document.querySelectorAll(SEL)
      for (var i = 0; i < list.length; i++) {
        for (var n = list[i].firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && HAS.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(DASH, ' $1 ')
        }
      }
    }
    var later = function () { if (!timer) timer = requestAnimationFrame(run) }
    var start = function () {
      run()
      if (window.MutationObserver) new MutationObserver(later).observe(document.body, { childList: true, subtree: true, characterData: true })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  } catch (e) {}
})()
/* ===== NAMES-1119 - end ===================================================== */

/* Product names: the full name as a tooltip (2026-11-11, owner: "improve product names").
 * A card name is clamped to two lines by sporta-shadows.css (NAMES-1111); the whole name stays in the markup and is
 * copied into `title` here, on cards and on the product page heading, so a long name can be read in full by hover or
 * long-press. The accessible name is untouched (the link already reads the whole text). Only `title` is written, never
 * a child node, so React is not disturbed and the observer (child list only) does not wake itself. Leading ";" because
 * this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
  var SEL = '.storefront-root .catalog-card-name, .storefront-root .catalog-product-title'
  var timer = 0
  function run() {
    timer = 0
    var list = document.querySelectorAll(SEL)
    for (var i = 0; i < list.length; i++) {
      var s = (list[i].textContent || '').replace(/\s+/g, ' ').trim()
      if (s && list[i].getAttribute('title') !== s) list[i].setAttribute('title', s)
    }
  }
  function schedule() { if (!timer) timer = setTimeout(run, 150) }
  function start() {
    run()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
  } catch (e) {}
})()

/* ===== SHIPPING - begin ===================================================
 * Delivery by governorate on the compiled checkout (2026-11-12, owner: "add shipping setup at backends").
 *
 * The SERVER decides the delivery fee (store_shipping_quote in store.php: the governorate's own fee or the base fee, and
 * free delivery once the goods after discount reach the owner's threshold) and charges exactly what it quoted. The live
 * checkout is a compiled build that asks for its quote (POST /api/api.php?r=discount) with the cart and the code only, so
 * the server can only quote the BASE fee; an order to a governorate with its own fee is then answered quote_changed and
 * the page asks again. This block closes that gap and does no price math of its own:
 *
 *   1. it adds `governorate` to the page's own quote request, when it knows one: the governorate the page last sent with
 *      an order, else the one picked in the checkout's #f-governorate, else the saved address (localStorage
 *      "sporta.delivery", read only). Nothing else in the request is touched, the order request is never changed, and an
 *      unknown value is never sent (only the six governorates of the server's list).
 *   2. on /checkout it reads GET /api/api.php?r=shipping once and, under the governorate field, shows that governorate's
 *      delivery time (the owner's text, as text) or, when the owner switched it off, that the shop does not deliver
 *      there now; the switched-off governorates are marked disabled in the list (the page's own options are never
 *      re-texted or removed). An order there is refused by the server (governorate_unavailable) whatever this shows.
 *
 * With no Shipping setup saved the quote answers as before (the governorate is ignored) and nothing is shown. If the
 * server is older than this block, ?r=shipping is a 404 and only part 1 runs, which that server ignores. Leading ";"
 * because this file is several IIFEs back to back.
 */
;(function () {
  'use strict'
  try {
  if (window.__sportaShippingStore || !window.fetch || !window.MutationObserver) return
  try { Object.defineProperty(window, '__sportaShippingStore', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }

  var GOVS = ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra']
  var NOTE = 'data-sporta-ship-note'
  var known = ''          // the governorate the page last used (order body or the field)
  var info = null, asked = false, timer = 0

  function valid(g) { return typeof g === 'string' && GOVS.indexOf(g) >= 0 }
  function saved() {
    try { var d = JSON.parse(localStorage.getItem('sporta.delivery') || '{}'); return d && valid(d.governorate) ? d.governorate : '' } catch (e) { return '' }
  }
  function field() { return document.getElementById('f-governorate') }
  function current() {
    var f = field()
    if (f && valid(f.value)) return f.value
    return known || saved()
  }
  function isRoute(url, route) {
    try {
      var u = new URL(String(url), location.href)
      return u.origin === location.origin && /\/api\.php$/.test(u.pathname) && u.searchParams.get('r') === route
    } catch (e) { return false }
  }

  // ---- 1. the quote request carries the governorate --------------------------------------------------------------
  var nativeFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || ''
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
      if (method === 'POST' && init && typeof init.body === 'string') {
        if (isRoute(url, 'order')) {
          var ob = JSON.parse(init.body)
          if (ob && ob.customer && valid(ob.customer.governorate)) known = ob.customer.governorate   // read only
        } else if (isRoute(url, 'discount')) {
          var g = current()
          var qb = JSON.parse(init.body)
          if (g && qb && typeof qb === 'object' && !Array.isArray(qb) && !('governorate' in qb)) {
            qb.governorate = g
            init = Object.assign({}, init, { body: JSON.stringify(qb) })
          }
        }
      }
    } catch (e) { /* the page's own request goes out unchanged */ }
    return nativeFetch.call(this, input, init)
  }

  // ---- 2. the note under the governorate field ---------------------------------------------------------------------
  function lang() { return (document.documentElement.getAttribute('lang') || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function load() {
    if (asked) return
    asked = true
    nativeFetch.call(window, '/api/api.php?r=shipping', { credentials: 'same-origin' }).then(function (r) {
      return r.ok ? r.json() : null
    }).then(function (j) {
      if (j && j.zones && typeof j.zones === 'object') { info = j; draw() }
    }).catch(function () { /* nothing is shown */ })
  }
  function draw() {
    timer = 0
    var f = field()
    if (!f) return
    if (!info) { load(); return }
    var i, opts = f.options || []
    for (i = 0; i < opts.length; i++) {
      var z = info.zones[opts[i].value]
      var off = !!(z && z.enabled === false)
      if (off && !opts[i].disabled) opts[i].disabled = true
      if (!off && opts[i].disabled && opts[i].getAttribute('data-sporta-ship-off')) opts[i].disabled = false
      if (off) opts[i].setAttribute('data-sporta-ship-off', '1'); else opts[i].removeAttribute('data-sporta-ship-off')
    }
    var zone = valid(f.value) ? info.zones[f.value] : null, ar = lang() === 'ar', text = '', bad = false
    if (zone && zone.enabled === false) { text = ar ? 'لا نوصل إلى هذه المحافظة حاليًا. اختر محافظة أخرى.' : 'We do not deliver to this governorate at the moment. Choose another one.'; bad = true }
    else if (zone) text = String((ar ? zone.time_ar : zone.time_en) || '').slice(0, 120)
    var host = f.parentNode, note = host ? host.querySelector('[' + NOTE + ']') : null
    if (!text) { if (note) note.parentNode.removeChild(note); return }
    if (!note) {
      note = document.createElement('p')
      note.setAttribute(NOTE, '')
      note.setAttribute('dir', 'auto')
      note.style.cssText = 'margin:.375rem 0 0;font-size:.875rem;line-height:1.4'
      host.appendChild(note)
    }
    if (note.textContent !== text) note.textContent = text
    note.setAttribute('role', bad ? 'alert' : 'note')
    note.style.fontWeight = bad ? '700' : ''
  }
  function schedule() { if (!timer) timer = setTimeout(function () { try { draw() } catch (e) { /* never break the checkout */ } }, 120) }
  function start() {
    document.addEventListener('change', function (e) {
      var t = e.target
      if (t && t.id === 'f-governorate' && valid(t.value)) known = t.value
      schedule()
    }, true)
    new MutationObserver(function () { if (location.pathname.indexOf('/checkout') === 0) schedule() }).observe(document.body, { childList: true, subtree: true })
    schedule()
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
  } catch (e) {}
})()
/* ===== SHIPPING - end ===================================================== */
/* ===== PAYMENT RECEIPT (2026-11-12, KNET K-063 D1/D5 and the owner's UAT receipt spec) ============
 * On /payment/result (the live page is the compiled build's PaymentResult chunk; KNET's callback sends the shopper there with
 * ?status=&trackid=&lang=&k=, or on KNET's error leg ?status=error&order=&lang=), the bank's answer is shown as a RECEIPT: result, amount, date and time of the payment, Payment ID,
 * Transaction ID, Track ID, reference number, auth code and the order number, in Arabic and English, right to left in Arabic.
 * KNET's UAT reviewers check that the result page shows the transaction clearly; the compiled page shows none of it.
 *
 * WHERE EVERY VALUE COMES FROM. The server: GET /api/api.php?r=status&id=<order>&k=<key>. The order row the callback wrote is
 * the only source (payment-records.php payrec_receipt); `k` is the order's RECEIPT key, which callback.php adds to the
 * redirect on the bank's authenticated leg only, for the payment the order records, and which opens the bank fields of
 * ?r=status and nothing else (not the invoice: no name, no address). Nothing shown is
 * read from the address bar: not the status word, not the Payment ID or reference the redirect also carries. The only things
 * read from the address are the order number and the key (to ask), and, when the server has no answer from the bank yet, the
 * reason CODE of KNET's error leg (bank_error / missing_data / decrypt_failed), which picks one of the fixed sentences below.
 *
 * WHAT IT FIXES on the live page (KNET-K063-CHECK.md, order-page findings 1): the compiled page says "Payment received - being
 * confirmed ... Do not pay again" for an order the server does not know, for a KNET order still pending (the shopper left the
 * bank page, or the bank's answer has not arrived) and when the status check fails, so a shopper who paid nothing was told not
 * to pay again. Here: unknown order -> "We could not find this order"; pending -> "Waiting for the bank's answer" (checked again
 * by itself a few times, a Check again button and a Try again link); the check failing -> "Could not check the payment right
 * now". "Do not pay again" stays only where it is true: a payment the bank captured that the shop is still checking (review).
 *
 * HOW. The compiled page renders one container (.purchase-result). This block adds ONE box of its own inside it and marks the
 * container (data-sporta-rcpt); a rule keyed on that mark hides React's own children while the box is shown. Nothing React
 * owns is removed, moved or re-texted, so React keeps re-rendering it as before; the box is put back if React replaces the
 * container. The box goes in the moment the container appears (it says "Checking your payment" first, the compiled page's own
 * words), so there is one change on screen, not two, and its minimum height is the receipt's, so the footer below does not
 * move when the answer lands. A cash order steps aside (the compiled "Order confirmed" page is right for it). Without an order
 * number the block does nothing at all.
 *
 * textContent only (every value is a bank or order reference from the server, shown in a left-to-right span); the key is
 * taken out of the address bar and kept in this tab's sessionStorage only (see unlist);
 * one MutationObserver (debounced to a frame) and short timeouts only while a check is running; links are fixed paths. Colours:
 * the shop's orange (#FF7B17) with near-black text on buttons, charcoal text on the page, rose for a failure, amber for a wait.
 * Proven by scripts/payment-receipt-test.mjs on a fixture of the compiled page (scripts/fixtures/payment-result.mjs) and against
 * the real status route of the test rig. */
;(function () {
  'use strict'
  try {
  if (window.__sportaReceipt) return
  try { Object.defineProperty(window, '__sportaReceipt', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  if (!window.MutationObserver || !window.fetch || !document.querySelector) return

  var BOX = 'sprc'
  var MARK = 'data-sporta-rcpt'
  var TRACK_RE = /^[A-Za-z0-9]{1,30}$/
  var KEY_RE = /^[0-9]{9,11}\.[a-f0-9]{32}$/
  var WAIT = [3000, 3000, 5000, 8000, 13000]   // pending: checked again by itself, five times, then on request only
  var T = {
    ar: {
      checking: ['جارٍ التحقق من الدفع', 'نتحقق من حالة الطلب مع البنك. يرجى الانتظار.'],
      success: ['تم الدفع بنجاح', 'تم تأكيد طلبك. احتفظ بهذه التفاصيل.'],
      unsuccessful: ['لم يتم الدفع', ''],
      pending: ['بانتظار رد البنك', 'إذا أكملت الدفع فستتحدّث هذه الصفحة خلال لحظات. وإذا غادرت صفحة البنك يمكنك المحاولة مرة أخرى.'],
      unknown: ['لم نعثر على هذا الطلب', 'تحقق من رقم الطلب، أو تواصل معنا على واتساب.'],
      failed_check: ['تعذّر التحقق من الدفع الآن', 'قد يكون رد البنك في الطريق. أعد المحاولة بعد دقيقة، وإذا خُصم المبلغ تواصل معنا.'],
      review: ['تم استلام الدفع — قيد التأكيد', 'لم نتمكن من تأكيد طلبك تلقائيًا. لا تدفع مرة أخرى — فريقنا يراجع العملية وسيتواصل معك عبر واتساب قريبًا.'],
      refunded: ['تم رد المبلغ', 'أعاد المتجر المبلغ إلى بطاقتك، وقد يستغرق ظهوره بضعة أيام حسب البنك.'],
      voided: ['أُلغيت عملية الدفع', 'ألغى المتجر العملية، ولن يُخصم المبلغ من بطاقتك.'],
      why: {
        declined: 'رفض البنك عملية الدفع، ولم يُخصم أي مبلغ.',
        cancelled: 'أُلغيت عملية الدفع قبل إتمامها.',
        bank_error: 'تعذّر على البنك إتمام العملية.',
        risk: 'رفض البنك العملية لأسباب أمنية.',
        timeout: 'انتهت مهلة الاتصال بالبنك.',
        other: 'لم تكتمل عملية الدفع.'
      },
      again: 'يمكنك المحاولة مرة أخرى.',
      details: 'تفاصيل الدفع',
      invoiceNote: 'تفاصيل البنك الكاملة في الفاتورة.',
      L: {
        order: 'رقم الطلب', amount: 'المبلغ المدفوع', amountDue: 'المبلغ', payment_id: 'رقم الدفع (Payment ID)',
        transaction_id: 'رقم العملية (Transaction ID)', track_id: 'رقم التتبع (Track ID)', reference: 'الرقم المرجعي',
        auth: 'رمز التفويض', when: 'تاريخ ووقت الدفع', result: 'النتيجة', refunded: 'المبلغ المسترد'
      },
      kuwait: 'بتوقيت الكويت',
      kwd: 'د.ك',
      results: { CAPTURED: 'مقبولة', 'NOT CAPTURED': 'مرفوضة', CANCELED: 'ملغاة', CANCELLED: 'ملغاة', 'DENIED BY RISK': 'مرفوضة', 'HOST TIMEOUT': 'انتهت المهلة' },
      retry: 'حاول مجددًا', check: 'تحقق مرة أخرى', track: 'تتبّع الطلب', invoice: 'عرض الفاتورة', home: 'العودة للرئيسية'
    },
    en: {
      checking: ['Checking your payment', 'We are confirming the order with the bank. Please wait.'],
      success: ['Payment successful', 'Your order is confirmed. Keep these details for your records.'],
      unsuccessful: ['Payment unsuccessful', ''],
      pending: ["Waiting for the bank's answer", 'If you completed the payment, this page updates in a moment. If you left the bank page, you can try again.'],
      unknown: ['We could not find this order', 'Check the order number, or contact us on WhatsApp.'],
      failed_check: ['Could not check the payment right now', "The bank's answer may still be on its way. Check again in a minute. If you were charged, contact us."],
      review: ['Payment received — being confirmed', 'We could not confirm your order automatically. Do not pay again — our team is checking it and will contact you on WhatsApp shortly.'],
      refunded: ['This payment was refunded', 'The shop returned the payment to your card. Your bank may take a few days to show it.'],
      voided: ['This payment was cancelled', 'The shop cancelled the transaction. You will not be charged.'],
      why: {
        declined: 'The bank declined the payment. You have not been charged.',
        cancelled: 'The payment was cancelled before it was completed.',
        bank_error: 'The bank could not process the payment.',
        risk: 'The bank refused the payment for security reasons.',
        timeout: 'The connection to the bank timed out.',
        other: 'The payment was not completed.'
      },
      again: 'You can try again.',
      details: 'Payment details',
      invoiceNote: 'The full bank details are on your invoice.',
      L: {
        order: 'Order reference', amount: 'Amount paid', amountDue: 'Amount', payment_id: 'Payment ID',
        transaction_id: 'Transaction ID', track_id: 'Track ID', reference: 'Reference number',
        auth: 'Auth code', when: 'Payment date & time', result: 'Result', refunded: 'Refunded'
      },
      kuwait: 'Kuwait time',
      kwd: 'KWD',
      results: { CAPTURED: 'Approved', 'NOT CAPTURED': 'Declined', CANCELED: 'Cancelled', CANCELLED: 'Cancelled', 'DENIED BY RISK': 'Declined', 'HOST TIMEOUT': 'Timed out' },
      retry: 'Try again', check: 'Check again', track: 'Track order', invoice: 'View invoice', home: 'Back to home'
    }
  }
  var WHY_OF = { 'NOT CAPTURED': 'declined', CANCELED: 'cancelled', CANCELLED: 'cancelled', 'DENIED BY RISK': 'risk', 'HOST TIMEOUT': 'timeout' }
  var URL_REASON = { bank_error: 'bank_error', missing_data: 'other', decrypt_failed: 'other' }

  var S = { track: '', key: '', reason: '', state: 'checking', data: null, seq: 0, waits: 0, timer: 0, lang: '', drawn: '' }
  var queued = false

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function onPage() { return /^\/payment\/result\/?$/.test(location.pathname) }
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function ltr(text) { var s = el('span', BOX + '__v', text); s.setAttribute('dir', 'ltr'); return s }
  function link(href, cls, text) { var a = el('a', cls, text); a.setAttribute('href', href); return a }
  function clean(v, max) {
    var s = v == null ? '' : String(v)
    return /^[A-Za-z0-9 ._:\-]{1,80}$/.test(s) ? s.slice(0, max || 60) : ''
  }
  function money(v, t) {
    var s = String(v == null ? '' : v)
    if (!/^\d{1,7}(\.\d{1,3})?$/.test(s)) { var n = Number(v); if (!isFinite(n) || n < 0) return ''; s = n.toFixed(3) }
    var p = s.split('.')
    return p[0] + '.' + ((p[1] || '') + '000').slice(0, 3) + ' ' + t.kwd
  }

  function css() {
    if (document.getElementById(BOX + '-css')) return
    var s = document.createElement('style')
    s.id = BOX + '-css'
    s.textContent =
      '.purchase-result[' + MARK + '] > :not(.' + BOX + '){display:none!important}' +
      '.' + BOX + '{--sprc-ink:#171A1E;--sprc-muted:#4b5563;--sprc-line:#e5e7eb;--sprc-soft:#f8f6f2;--sprc-brand:#FF7B17;--sprc-brand-hover:#c25400;' +
        '--sprc-ok:#B34D00;--sprc-bad:#b34d00;--sprc-wait:#92400e;' +
        'box-sizing:border-box;width:100%;max-width:34rem;margin:0 auto;min-height:34rem;display:flex;flex-direction:column;align-items:center;' +
        'gap:12px;text-align:center;color:var(--sprc-ink)}' +
      '.' + BOX + ' *{box-sizing:border-box}' +
      '.' + BOX + '__icon{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:28px;line-height:1;font-weight:800;' +
        'color:var(--sprc-ok);background:#fdeee6}' +
      '.' + BOX + '[data-tone="bad"] .' + BOX + '__icon{color:var(--sprc-bad);background:#ffe7d4}' +
      '.' + BOX + '[data-tone="wait"] .' + BOX + '__icon{color:var(--sprc-wait);background:#fdf3dc}' +
      '.' + BOX + '__title{margin:4px 0 0;font-size:1.5rem;line-height:1.3;font-weight:800;color:var(--sprc-ink)}' +
      '.' + BOX + '__msg{margin:0;font-size:1rem;line-height:1.6;color:var(--sprc-muted);max-width:30rem}' +
      '.' + BOX + '__card{width:100%;margin-top:8px;border:1px solid var(--sprc-line);border-radius:12px;background:var(--sprc-soft);padding:14px 16px;text-align:start}' +
      '.' + BOX + '__card h2{margin:0 0 8px;font-size:.95rem;font-weight:800;color:var(--sprc-ink)}' +
      '.' + BOX + '__rows{margin:0;display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);gap:8px 16px}' +
      '.' + BOX + '__rows dt{margin:0;font-size:.875rem;color:var(--sprc-muted)}' +
      '.' + BOX + '__rows dd{margin:0;font-size:.9375rem;font-weight:700;color:var(--sprc-ink);text-align:end;overflow-wrap:anywhere}' +
      '.' + BOX + '__v{unicode-bidi:isolate;font-variant-numeric:tabular-nums}' +
      '.' + BOX + '__note{margin:8px 0 0;font-size:.8125rem;color:var(--sprc-muted)}' +
      '.' + BOX + '__acts{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:12px;width:100%}' +
      '.' + BOX + '__btn{min-height:44px;padding:10px 18px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;' +
        'font:inherit;font-size:.9375rem;font-weight:700;text-decoration:none;cursor:pointer;border:1px solid var(--sprc-line);background:#fff;color:var(--sprc-ink)}' +
      '.' + BOX + '__btn--main{background:var(--sprc-brand);border-color:var(--sprc-brand);color:#171A1E}' +
      '.' + BOX + '__btn--main:hover{background:var(--sprc-brand-hover);border-color:var(--sprc-brand-hover)}' +
      '.' + BOX + '__btn:focus-visible{outline:2px solid var(--sprc-brand);outline-offset:2px}' +
      '.' + BOX + '__btn[disabled]{opacity:.6;cursor:default}' +
      '@media (max-width:480px){.' + BOX + '{min-height:44rem}.' + BOX + '__title{font-size:1.25rem}.' + BOX + '__msg{font-size:.9375rem}' +
        '.' + BOX + '__card{padding:12px}.' + BOX + '__rows{gap:6px 10px}.' + BOX + '__rows dt{font-size:.8125rem}.' + BOX + '__rows dd{font-size:.875rem}}' +
      ':is(html.dark,html[data-theme="dark"]) .' + BOX + '{--sprc-ink:#f2f2f0;--sprc-muted:#b6b7bb;--sprc-line:#3a3b40;--sprc-soft:#1e1f23;--sprc-ok:#ff7b17}' +
      ':is(html.dark,html[data-theme="dark"]) .' + BOX + '__btn{background:#1e1f23;color:#f2f2f0}' +
      ':is(html.dark,html[data-theme="dark"]) .' + BOX + '__btn--main{background:var(--sprc-brand);color:#171A1E}'
    document.head.appendChild(s)
  }

  function readUrl() {
    var q
    try { q = new URLSearchParams(location.search) } catch (e) { return }
    var err = q.get('status') === 'error'
    // KNET's error leg names the order as `order` (callback.php): the compiled page reads `trackid` and would say "Do not
    // pay again" for a pending order, so the order number reaches only this block there.
    var t = q.get('trackid') || (err ? q.get('order') : '') || ''
    var k = q.get('k') || ''
    var r = q.get('reason') || ''
    var track = TRACK_RE.test(t) ? t : ''
    if (KEY_RE.test(k)) stash(track, k)
    if (track !== S.track) {
      S.track = track; S.key = KEY_RE.test(k) ? k : stashed(track); S.state = 'checking'; S.data = null; S.waits = 0; S.drawn = ''
      S.reason = err && URL_REASON[r] ? URL_REASON[r] : ''
      if (S.timer) { clearTimeout(S.timer); S.timer = 0 }
      if (track) ask()
    }
    if (q.has('k')) unlist(q)
  }

  // THE KEY LEAVES THE ADDRESS BAR (review 2, defect 2). It opens this payment's bank fields for 7 days, and an address is
  // shared, screenshotted and kept in a shared computer's history. It is read once, kept in this tab's sessionStorage (so a
  // reload of the page still shows the receipt; per tab, gone when the tab closes; a blocked storage only costs the receipt
  // after a reload), and removed from the address with history.replaceState, keeping the router's own history.state.
  var STASH = 'sporta.rcpt'
  function stash(track, k) { try { if (track) sessionStorage.setItem(STASH, JSON.stringify({ t: track, k: k })) } catch (e) {} }
  function stashed(track) {
    try {
      var v = JSON.parse(sessionStorage.getItem(STASH) || 'null')
      return v && v.t === track && KEY_RE.test(String(v.k)) ? String(v.k) : ''
    } catch (e) { return '' }
  }
  function unlist(q) {
    try {
      q.delete('k')
      var rest = q.toString()
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash)
    } catch (e) {}
  }

  function ask() {
    var mine = ++S.seq
    var ctl = window.AbortController ? new AbortController() : null
    var guard = setTimeout(function () { if (ctl) ctl.abort(); settle(mine, 'failed_check', null) }, 12000)
    var url = '/api/api.php?r=status&id=' + encodeURIComponent(S.track) + (S.key ? '&k=' + encodeURIComponent(S.key) : '')
    fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error('http')
      return r.json()
    }).then(function (d) {
      clearTimeout(guard)
      settle(mine, decide(d), d)
    }).catch(function () {
      clearTimeout(guard)
      settle(mine, 'failed_check', null)
    })
  }

  /** The server decides: payment_status and payment_method of the order row. */
  function decide(d) {
    if (d === null) return 'unknown'
    if (!d || typeof d !== 'object' || typeof d.payment_status !== 'string') return 'failed_check'
    if (d.payment_method === 'cod') return 'cod'
    var s = d.payment_status
    if (s === 'paid') return 'success'
    if (s === 'failed') return 'unsuccessful'
    if (s === 'review') return 'review'
    if (s === 'refunded' || s === 'voided') return s
    if (s === 'pending') return S.reason ? 'unsuccessful' : 'pending'
    return 'failed_check'
  }

  function settle(mine, state, data) {
    if (mine !== S.seq) return
    S.seq++   // a late answer to this question is ignored
    S.state = state; S.data = data; S.drawn = ''
    if (state === 'pending' && S.waits < WAIT.length) {
      S.timer = setTimeout(function () { S.timer = 0; S.waits++; if (onPage() && S.track) ask() }, WAIT[S.waits])
    }
    schedule()
  }

  function receiptRows(t, d) {
    var r = d && d.receipt && typeof d.receipt === 'object' ? d.receipt : null
    var rows = []
    var add = function (label, value, raw) { if (value) rows.push([label, raw ? value : ltr(value)]) }
    add(t.L.order, clean(S.track))
    if (r) {
      var word = clean(r.result, 30).toUpperCase()
      if (word && t.results[word]) add(t.L.result, t.results[word], true)
      add(S.state === 'success' || S.state === 'refunded' || S.state === 'voided' ? t.L.amount : t.L.amountDue, money(r.amount, t))
      if (r.refunded_amount) add(t.L.refunded, money(r.refunded_amount, t))
      add(t.L.payment_id, clean(r.payment_id))
      add(t.L.transaction_id, clean(r.transaction_id))
      add(t.L.track_id, clean(r.gateway_track_id))
      add(t.L.reference, clean(r.reference))
      add(t.L.auth, clean(r.auth_code))
      var when = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(r.paid_at_kuwait || '')) ? r.paid_at_kuwait : ''
      if (when) {
        var w = el('span'); w.appendChild(ltr(when)); w.appendChild(document.createTextNode(' (' + t.kuwait + ')'))
        rows.push([t.L.when, w])
      }
    } else if (d && typeof d.amount === 'number' && (S.state === 'success' || S.state === 'pending' || S.state === 'unsuccessful')) {
      add(S.state === 'success' ? t.L.amount : t.L.amountDue, money(d.amount, t))
    }
    return { rows: rows, full: !!r }
  }

  function draw(box) {
    var t = T[lang()]
    var key = S.state + '|' + lang() + '|' + (S.data && S.data.receipt ? 1 : 0)
    if (S.drawn === key && box.firstChild) return
    S.drawn = key
    while (box.firstChild) box.removeChild(box.firstChild)
    var st = S.state
    var words = t[st] || t.checking
    box.setAttribute('data-state', st)
    box.setAttribute('data-tone', st === 'success' ? 'ok' : (st === 'pending' || st === 'checking' || st === 'review' || st === 'failed_check' ? 'wait' : 'bad'))
    var icon = el('div', BOX + '__icon', st === 'success' ? '✓' : (st === 'checking' || st === 'pending' ? '…' : (st === 'review' || st === 'failed_check' ? '!' : '✕')))
    icon.setAttribute('aria-hidden', 'true')
    box.appendChild(icon)
    var live = el('div'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite')
    live.appendChild(el('h1', BOX + '__title', words[0]))
    var msg = words[1]
    if (st === 'unsuccessful') {
      var res = S.data && S.data.receipt ? clean(S.data.receipt.result, 30).toUpperCase() : ''
      msg = (t.why[WHY_OF[res] || S.reason || 'other'] || t.why.other) + ' ' + t.again
    }
    if (msg) live.appendChild(el('p', BOX + '__msg', msg))
    box.appendChild(live)

    if (st !== 'checking' && st !== 'unknown' && st !== 'failed_check') {
      var rec = receiptRows(t, S.data)
      if (rec.rows.length) {
        var card = el('section', BOX + '__card')
        card.setAttribute('aria-label', t.details)
        card.appendChild(el('h2', null, t.details))
        var dl = el('dl', BOX + '__rows')
        rec.rows.forEach(function (row) { dl.appendChild(el('dt', null, row[0])); var dd = el('dd'); if (typeof row[1] === 'string') dd.textContent = row[1]; else dd.appendChild(row[1]); dl.appendChild(dd) })
        card.appendChild(dl)
        if (!rec.full && st === 'success') card.appendChild(el('p', BOX + '__note', t.invoiceNote))
        box.appendChild(card)
      }
    }

    var acts = el('div', BOX + '__acts')
    var tr = encodeURIComponent(S.track)
    if (st === 'success') {
      acts.appendChild(link('/invoice/' + tr, BOX + '__btn ' + BOX + '__btn--main', t.invoice))
      acts.appendChild(link('/track?trackid=' + tr, BOX + '__btn', t.track))
    } else if (st === 'pending' || st === 'failed_check') {
      var again = el('button', BOX + '__btn ' + BOX + '__btn--main', t.check)
      again.type = 'button'
      again.addEventListener('click', function () {
        again.disabled = true
        if (S.timer) { clearTimeout(S.timer); S.timer = 0 }
        S.waits = WAIT.length   // a press is the shopper's own check: no more automatic ones after it
        ask()
      })
      acts.appendChild(again)
      if (st === 'pending') acts.appendChild(link('/cart', BOX + '__btn', t.retry))
    } else if (st === 'unsuccessful' || st === 'unknown') {
      acts.appendChild(link('/cart', BOX + '__btn ' + BOX + '__btn--main', t.retry))
    } else if (st === 'review' || st === 'refunded' || st === 'voided') {
      acts.appendChild(link('/track?trackid=' + tr, BOX + '__btn ' + BOX + '__btn--main', t.track))
    }
    if (st !== 'checking') acts.appendChild(link('/', BOX + '__btn', t.home))
    box.appendChild(acts)
  }

  function check() {
    var mine = document.querySelector('.' + BOX)
    if (!onPage()) {
      if (S.timer) { clearTimeout(S.timer); S.timer = 0 }
      S.track = ''
      if (mine) mine.parentNode.removeChild(mine)
      return
    }
    readUrl()
    var host = document.querySelector('.purchase-result')
    if (!S.track || !host || S.state === 'cod') {
      if (mine) mine.parentNode.removeChild(mine)
      if (host && host.hasAttribute(MARK)) host.removeAttribute(MARK)
      return
    }
    css()
    if (mine && mine.parentNode !== host) { mine.parentNode.removeChild(mine); mine = null }
    if (!mine) {
      mine = el('div', BOX)
      S.drawn = ''
      host.insertBefore(mine, host.firstChild)
    }
    if (!host.hasAttribute(MARK)) host.setAttribute(MARK, '')
    draw(mine)
  }
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { check() } catch (e) {} })
  }
  function start() {
    try { check() } catch (e) {}
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    window.addEventListener('popstate', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
  } catch (e) {}
})()
/* ===== PAYMENT RECEIPT - end ============================================== */
/* ===== MOBILE-1112B (2026-11-12, owner: "fix") ==============================
 * The Sporta AI panel no longer moves the page when it opens. Proven by scripts/mobile-1112b-test.mjs on the captured live
 * client. The compiled panel (AssistantPanel chunk) keeps its newest message in view with an empty marker at the end of its
 * message list and calls marker.scrollIntoView({block: 'end'}) on open and on every new message; the panel is position:
 * fixed, and the browser scrolled the PAGE as well as the list: a shopper 500px down /shop was carried back to the top
 * (a smooth scroll of the whole page, every time the panel opened or answered). For an element inside that panel only,
 * scrollIntoView now scrolls the panel's own scroller and nothing else, and its focus() call on the message box (on open)
 * passes preventScroll. Every other element on the page keeps the browser's own methods. The panel is recognised by its
 * own markup (a non-modal dialog whose form holds the 500-character message box), not by a class name. */
;(function () {
  'use strict'
  try {
  var P = Element.prototype, H = HTMLElement.prototype
  if (!P.scrollIntoView || P.scrollIntoView.__sportaAi) return
  var nativeScroll = P.scrollIntoView, nativeFocus = H.focus
  function panel(el) {
    var d = el && el.closest ? el.closest('[role="dialog"][aria-modal="false"]') : null
    return d && d.querySelector(':scope > form > input[maxlength="500"]') ? d : null
  }
  function scroller(el, d) {
    for (var n = el.parentElement; n && n !== d; n = n.parentElement) {
      var o = getComputedStyle(n).overflowY
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
    }
    return null
  }
  function scrollIntoView(arg) {
    var d
    try { d = panel(this) } catch (e) { d = null }
    if (!d) return nativeScroll.apply(this, arguments)
    try {
      var box = scroller(this, d)
      if (!box) return
      var r = this.getBoundingClientRect(), b = box.getBoundingClientRect()
      var block = arg === false ? 'end' : arg && typeof arg === 'object' ? arg.block || 'start' : 'start'
      var delta = block === 'end' ? r.bottom - b.bottom : block === 'center' ? (r.top + r.bottom - b.top - b.bottom) / 2 : block === 'nearest' ? (r.top < b.top ? r.top - b.top : r.bottom > b.bottom ? r.bottom - b.bottom : 0) : r.top - b.top
      box.scrollTop += delta
    } catch (e) {}
  }
  function focus(opts) {
    var d
    try { d = panel(this) } catch (e) { d = null }
    if (d && !(opts && typeof opts === 'object' && 'preventScroll' in opts)) return nativeFocus.call(this, { preventScroll: true })
    return nativeFocus.apply(this, arguments)
  }
  scrollIntoView.__sportaAi = 1
  try { P.scrollIntoView = scrollIntoView; H.focus = focus } catch (e) {}
  } catch (e) {}
})()
/* ===== MOBILE-1112B - end =================================================== */
/* ===== MOBILE-1112 (2026-11-12, owner: "improve mobile version") ============
 * Two behaviours for phones; the layout half is the MOBILE-1112 section of sporta-shadows.css. Proven by
 * scripts/mobile-1112-test.mjs (npm run test:mobile-1112).
 * [mob-js-1] Keyboard hints the compiled forms left out. Only an attribute that is ABSENT is written, never one the app
 *   set, and never on the checkout (its own lane). /support "Order number": autocapitalize=characters but no
 *   autocorrect=off / spellcheck=false, so a phone keyboard could "correct" SP1A2B3C into a word (the /returns and /track
 *   order fields already carry both); /support e-mail: no autocapitalize=none, so iOS capitalised the first letter;
 *   the name fields on /account and /support: no autocapitalize=words. Attributes only: React keeps its nodes, and the
 *   observer (child list only) is not woken by its own writes.
 * [mob-js-2] Installed app only (Add to Home Screen): the compiled pull-to-refresh listens on window and reloads after a
 *   downward drag from the top of the page wherever the drag began, so pulling down on a form page threw away what had been
 *   typed, and dragging inside the bag drawer or a dialog reloaded the app. On the form pages, and for a drag that starts
 *   in a dialog, the bag drawer or a field, the touchmove is stopped at the DOCUMENT in the bubble phase: every handler on
 *   the page (React listens at its root, below the document) has already seen it, the browser still scrolls (nothing is
 *   cancelled), and only listeners on window, the pull-to-refresh among them, miss it. A browser tab is untouched. */
;(function () {
  'use strict'
  try {
  var HINTS = [
    ['.support-page__field input[autocapitalize="characters"]', [['autocorrect', 'off'], ['spellcheck', 'false'], ['autocomplete', 'off']]],
    ['.storefront-root input[type="email"], .storefront-root input[autocomplete="email"]', [['autocapitalize', 'none'], ['autocorrect', 'off'], ['spellcheck', 'false']]],
    ['.storefront-root input[autocomplete="name"]', [['autocapitalize', 'words']]],
  ]
  var timer = 0
  function hint() {
    timer = 0
    for (var i = 0; i < HINTS.length; i++) {
      var list = document.querySelectorAll(HINTS[i][0])
      for (var j = 0; j < list.length; j++) {
        var el = list[j]
        if (el.closest('.purchase-flow, .purchase-quick, .purchase-checkout-layout')) continue
        for (var k = 0; k < HINTS[i][1].length; k++) if (!el.hasAttribute(HINTS[i][1][k][0])) el.setAttribute(HINTS[i][1][k][0], HINTS[i][1][k][1])
      }
    }
  }
  function schedule() { if (!timer) timer = setTimeout(hint, 120) }

  var FORMS = /^\/(checkout|account|support|returns|exchange|track|contact)(\/|$)/
  var KEEP = '[role="dialog"], .campaign-cart-drawer, input, textarea, select, [contenteditable="true"]'
  function standalone() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true } catch (e) { return false }
  }
  try {
    document.addEventListener('touchmove', function (e) {
      if (!standalone()) return
      var t = e.target
      if (FORMS.test(location.pathname) || (t && t.closest && t.closest(KEEP))) e.stopPropagation()
    }, { passive: true })
  } catch (e) {}

  function start() {
    hint()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
  } catch (e) {}
})()
/* ===== MOBILE-1112 - end ==================================================== */

/* ===== GALLERY-1114 - several photographs: the swipe index, the counter and the grid's tap ================
 * The build's gallery keeps its photograph index in React state and moves a transform track to it. On a phone the new
 * layout moves the track by a native swipe instead (sporta-images.css, GALLERY-1114), so this script does three things:
 *   1. after a swipe settles, it selects the thumbnail of the photograph now showing (the build's own selection, so
 *      the full-screen view and the thumbnails agree with the swipe);
 *   2. it writes the "n / total" counter in the stage's corner (phone only, by CSS);
 *   3. on a desktop grid, a tap on a photograph opens the full-screen view on THAT photograph: the build's thumbnail for
 *      it is selected first, then the stage (the build's own opener) is clicked. The original click stops at the stage.
 * Only products with two photographs or more. Not on /backends. The build's elements are only read and clicked. */
;(function () {
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.MutationObserver || window.__sportaGallery) return
    window.__sportaGallery = 1
    var MULTI = '.catalog-gallery:has(.catalog-gallery-photo ~ .catalog-gallery-photo)'
    var wide = function () { try { return matchMedia('(min-width: 768px)').matches } catch (e) { return false } }
    var rtl = function () { return (document.documentElement.getAttribute('dir') || '').toLowerCase() === 'rtl' }
    var galleries = function () { return document.querySelectorAll(MULTI) }
    var trackOf = function (g) { return g.querySelector('.catalog-gallery-track') }
    var thumbsOf = function (g) { return g.querySelectorAll('.catalog-gallery-thumbs > button') }
    var photosOf = function (g) { return trackOf(g) ? trackOf(g).querySelectorAll(':scope > img') : [] }
    // The build marks the selected thumbnail with aria-current="true"; that is its index.
    var currentOf = function (g) {
      var t = thumbsOf(g)
      for (var i = 0; i < t.length; i++) if (t[i].getAttribute('aria-current') === 'true') return i
      return 0
    }

    // 2. the counter
    var paint = function (g) {
      var stage = g.querySelector('.catalog-gallery-stage'); if (!stage) return
      var c = stage.querySelector(':scope > .sporta-gallery-count')
      if (!c) { c = document.createElement('span'); c.className = 'sporta-gallery-count'; c.setAttribute('aria-hidden', 'true'); stage.appendChild(c) }
      var text = (currentOf(g) + 1) + ' / ' + photosOf(g).length
      if (c.textContent !== text) c.textContent = text
    }
    var paintAll = function () { galleries().forEach(paint) }
    var queued = 0
    var schedule = function () { if (!queued) queued = requestAnimationFrame(function () { queued = 0; paintAll() }) }

    // 1. the swipe settles on a photograph: select its thumbnail
    document.addEventListener('scroll', function (e) {
      var track = e.target
      if (!track || !track.classList || !track.classList.contains('catalog-gallery-track')) return
      var g = track.closest(MULTI); if (!g || wide()) return
      var w = track.clientWidth || 1
      var n = Math.min(photosOf(g).length - 1, Math.round(Math.abs(track.scrollLeft) / w))
      paint(g)
      clearTimeout(track.__sportaSettle)
      track.__sportaSettle = setTimeout(function () {
        if (n !== currentOf(g) && thumbsOf(g)[n]) thumbsOf(g)[n].click()
      }, 140)
    }, true)

    // a thumbnail tapped on a phone moves the swipe to its photograph
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.catalog-gallery-thumbs > button') : null
      if (!t) return
      var g = t.closest(MULTI); if (!g || wide()) return
      var track = trackOf(g); if (!track) return
      var n = Array.prototype.indexOf.call(thumbsOf(g), t)
      if (n < 0) return
      track.scrollTo({ left: (rtl() ? -1 : 1) * n * (track.clientWidth || 1), behavior: 'smooth' })
    }, true)

    // 3. a desktop grid tap opens the full-screen view on the photograph tapped
    document.addEventListener('click', function (e) {
      var p = e.target && e.target.closest ? e.target.closest('.catalog-gallery-photo') : null
      if (!p) return
      var g = p.closest(MULTI); if (!g || !wide()) return
      var stage = g.querySelector('.catalog-gallery-stage'); if (!stage || !stage.contains(p)) return
      var n = Array.prototype.indexOf.call(photosOf(g), p)
      if (n < 0) return
      e.stopPropagation(); e.preventDefault()
      if (thumbsOf(g)[n]) thumbsOf(g)[n].click()          // the build's own index, now on this photograph
      setTimeout(function () { stage.click() }, 0)         // the build's own opener, which reads that index
    }, true)

    // the counter follows the build's re-renders (a new product, the thumbnail selection, the stage being redrawn)
    var start = function () {
      paintAll()
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
})()
/* ===== GALLERY-1114 - end ==================================================================================== */

/* ===== JSONLD-1117 - the structured data the live page declares makes no claim the shop cannot keep ================ */
/* The live storefront is a compiled build. Its JSON-LD (the store block in index.html, and the route scripts the app
 * writes into <head>) says three things the repo no longer says: InStock for a product whose stock is not known (the
 * shop list, and a product page without figures), a hard-coded priceRange, and a hard-coded paymentAccepted list
 * (Visa and Mastercard are not taken directly; cash on delivery is). This takes them out of the JSON on the page:
 * an InStock availability is dropped (an OutOfStock is kept, because the shop only writes it when it knows), and the
 * two store facts that move with the catalogue and the payment settings are dropped. It edits the script text only:
 * nothing is shown, no request is made, and a script with no such claim is left as it is. */
;(function () {
  try {
    if (window.__sportaLdFix) return
    window.__sportaLdFix = true
    function fix(node) {
      var raw = node.textContent || ''
      if (raw.indexOf('@type') < 0) return
      var doc = null
      try { doc = JSON.parse(raw) } catch (e) { return }
      var changed = false
      ;(function walk(o) {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i]); return }
        // BRAND-1118 (owner: "dont use sporta as product brand"): the build writes brand "SPORTA" for every product whose English name holds no known
        // maker. The shop is the seller, not the maker: the product's real brand (the one its page shows) replaces it, or the claim is dropped.
        if (o['@type'] === 'Product' && o.brand) {
          var bn = typeof o.brand === 'string' ? o.brand : o.brand && o.brand.name
          if (/^sporta$/i.test(String(bn || '').trim())) {
            var pm = document.querySelector('.campaign-brand-plate__maker'), pi = pm && pm.querySelector('img')
            var real = String((pi && pi.getAttribute('alt')) || (pm && pm.textContent) || '').replace(/\s+/g, ' ').trim()
            if (real && !/^(sporta|sporta sports wear|\u0633\u0628\u0648\u0631\u062a\u0627)$/i.test(real)) { if (typeof o.brand === 'object') o.brand.name = real; else o.brand = { '@type': 'Brand', name: real } }
            else delete o.brand
            changed = true
          }
        }
        if (o['@type'] === 'Offer' && o.availability === 'https://schema.org/InStock') { delete o.availability; changed = true }
        if (o['@type'] === 'OnlineStore') {
          if ('priceRange' in o) { delete o.priceRange; changed = true }
          if ('paymentAccepted' in o) { delete o.paymentAccepted; changed = true }
        }
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k])
      })(doc)
      if (changed) node.textContent = JSON.stringify(doc)
    }
    var scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (var s = 0; s < scripts.length; s++) fix(scripts[s])
    // The route writes its own script into <head> after the page is up: fix it as it arrives.
    if (document.head && window.MutationObserver) {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes
          for (var j = 0; j < added.length; j++) {
            var n = added[j]
            if (n.nodeType === 1 && n.tagName === 'SCRIPT' && n.type === 'application/ld+json') fix(n)
          }
        }
      }).observe(document.head, { childList: true })
    }
  } catch (e) { /* the page keeps its own data */ }
})()
/* ===== JSONLD-1117 - end ===== */

/* ===== META-1117 - the description and the heading a search engine reads on the pages that need them ================ */
/* The live storefront is a compiled build, and three of its pages say the wrong thing to a searcher (the 2026-11-17
 * mobile scan): a product whose own text is a few words gets only that text as its description (18-25 characters,
 * where a result wants about 70 or more, so it names the product and what the shop sells); /track carries its
 * one-line instruction as its description (32 characters); and a category page (/shop?category=) keeps the shop's
 * heading, so Men, Women, Hoodies & Jackets and Accessories all have the same H1. This writes the description (and
 * its Open Graph and Twitter copies) on a product or /track page whose description is under 70 characters, and the
 * heading and the title of a category page, in the page's own language. Nothing else changes: no request, no layout,
 * no other route, and a page whose description is already long is left alone. The copy below is the same text as
 * src/i18n/translations.js (seo.productFallback, seo.track and the category names); test:meta-1117 checks that it is.
 * Only the category names come from the shop's own list (CATEGORIES in src/lib/products.js). */
;(function () {
  try {
    if (window.__sportaMetaFix) return
    window.__sportaMetaFix = true
    var MIN = 70
    var COPY = {
      en: {
        fallback: 'Sporta sportswear in Kuwait. Same-day delivery, KNET and cash on delivery.',
        track: 'Track a Sporta order with your order number. Payment and delivery status in real time.',
        suffix: ' — Sporta',
        cats: { women: 'Women', men: 'Men', outerwear: 'Hoodies & Jackets', accessories: 'Accessories' }
      },
      ar: {
        fallback: 'من سبورتا الكويت، توصيل في نفس اليوم، كي نت ودفع عند الاستلام.',
        track: 'تتبّع طلبك من سبورتا برقم الطلب. حالة الدفع والتوصيل لحظة بلحظة.',
        suffix: ' — سبورتا',
        cats: { women: 'نساء', men: 'رجال', outerwear: 'هوديز وجواكيت', accessories: 'إكسسوارات' }
      }
    }
    function metaOf(sel) { return document.head ? document.head.querySelector(sel) : null }
    function isShort(el) { return !el || (el.getAttribute('content') || '').trim().length < MIN }
    function setDescription(text) {
      var sels = ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']
      for (var i = 0; i < sels.length; i++) {
        var el = metaOf(sels[i])
        if (el && el.getAttribute('content') !== text) el.setAttribute('content', text)
      }
    }
    function fix() {
      var path = location.pathname.replace(/\/+$/, '') || '/'
      var lang = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'ar'
      var C = COPY[lang]
      var robots = metaOf('meta[name="robots"]')
      if (robots && /noindex/.test(robots.getAttribute('content') || '')) return
      var h1 = document.querySelector('h1')
      if (/^\/product\/[^/]+$/.test(path)) {
        var name = h1 ? (h1.textContent || '').trim() : ''
        if (name && isShort(metaOf('meta[name="description"]'))) setDescription(name + ' — ' + C.fallback)
        return
      }
      if (path === '/track') {
        if (isShort(metaOf('meta[name="description"]'))) setDescription(C.track)
        return
      }
      if (path === '/shop') {
        var key = new URLSearchParams(location.search).get('category')
        var label = key && Object.prototype.hasOwnProperty.call(C.cats, key) ? C.cats[key] : null
        if (!label) return
        if (h1 && (h1.textContent || '').trim() !== label) h1.textContent = label
        if (document.title !== label + C.suffix) document.title = label + C.suffix
      }
    }
    var queued = false
    function later() {
      if (queued) return
      queued = true
      var run = function () { queued = false; try { fix() } catch (e) {} }
      if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16)
    }
    fix()
    if (window.MutationObserver) {
      var mo = new MutationObserver(later)
      mo.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['content'] })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    }
    document.addEventListener('DOMContentLoaded', later)
  } catch (e) { /* the page keeps its own text */ }
})()
/* ===== META-1117 - end ===== */

/* ===== TEXT STYLE (2026-11-18, owner: "make text style editor with fonts selecter") ==================================
 * The owner's text size and heading weight per language (/backends -> Settings -> Text styles, settings.text_style),
 * applied to the storefront. The public ?r=text_style answers { size_en, size_ar, heading_weight_en, heading_weight_ar }
 * (four small numbers; the fonts are the theme's, which the compiled app already applies). This puts the CURRENT language's
 * two values on <html> as data-sporta-size (90-120, never 100) and data-sporta-hw (600-900, never 0): sporta-brand-theme.css
 * (TEXTSTYLE-1118) turns them into the root font size and the heading weight. A value equal to the design sets nothing, so a
 * shop that never used the editor is exactly what it was.
 *  - boot.js applies the copy this block saved on the last visit (localStorage sporta_text_style) BEFORE the first paint, so a
 *    returning visitor's page is not resized once it is up. This block then reads the server's answer, keeps it for the next
 *    visit and applies it now if it differs (once, when the owner has changed something, or on a first visit).
 *  - the language toggle changes <html lang> in place: the attributes follow it (one observer on that attribute only).
 *  - the answer is checked against the same short lists the server enforces; anything else is ignored. No request on /backends.
 *    A failed request changes nothing. Plain attributes only: no markup, no style sheet written. */
;(function () {
  try {
    if (window.__sportaTextStyle) return
    window.__sportaTextStyle = true
    if (/^\/backends(?:\/|$)/.test(location.pathname)) return
    var KEY = 'sporta_text_style'
    var SIZES = [90, 95, 100, 105, 110, 115, 120], WEIGHTS = [0, 600, 700, 800, 900]
    var doc = document.documentElement
    function clean(j) {
      if (!j || typeof j !== 'object') return null
      var out = {}, ok = true
      ;['en', 'ar'].forEach(function (L) {
        var s = j['size_' + L], w = j['heading_weight_' + L]
        if (SIZES.indexOf(s) < 0 || WEIGHTS.indexOf(w) < 0) ok = false
        out['size_' + L] = s; out['heading_weight_' + L] = w
      })
      return ok ? out : null
    }
    function lang() { return (doc.lang || 'ar').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ar' }
    function put(name, v, off) {
      if (v && v !== off) { if (doc.getAttribute(name) !== String(v)) doc.setAttribute(name, String(v)) }
      else if (doc.hasAttribute(name)) doc.removeAttribute(name)
    }
    var current = null
    try { current = clean(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch (e) { current = null }
    function apply() {
      var L = lang()
      put('data-sporta-size', current ? current['size_' + L] : 100, 100)
      put('data-sporta-hw', current ? current['heading_weight_' + L] : 0, 0)
    }
    function start() {
      apply()
      try {
        new MutationObserver(apply).observe(doc, { attributes: true, attributeFilter: ['lang'] })
      } catch (e) { /* the language toggle then shows the new language's style on the next page load */ }
      fetch('/api/api.php?r=text_style', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (j) {
          var next = clean(j)
          if (!next || JSON.stringify(next) === JSON.stringify(current)) return
          current = next
          try { localStorage.setItem(KEY, JSON.stringify(next)) } catch (e) { /* private window: applied now, not kept */ }
          apply()
        })
        .catch(function () { /* the design as it is, or the last copy */ })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  } catch (e) { /* the page keeps its own style */ }
})()
/* ===== TEXT STYLE - end ===== */

/* ===== PRICES-1118 (2026-11-18, owner: "make total prices and original prices and make sale price by percent") ==================
 * What the compiled storefront does not show, drawn from what it does show, with no new request except one:
 *   - a "% off" badge beside the struck-through original price on a product card (.price-card) and on the product page
 *     (.catalog-product-price). The percent is worked out from the two amounts on screen, so it can never disagree with them;
 *   - "You save KWD x (y%)" under the product page's price;
 *   - the bag (page and drawer): a "Line total" under the unit price of a line with two or more pieces; when the product is on
 *     sale NOW and the line was added at that price, the original unit price struck through and the % off; and on the bag page
 *     an "Original total" and "You save" row above the Subtotal. The original prices come from the public products list
 *     (api.php?r=products: price, list_price, on_sale), read once, and only when a bag line is on screen. A line whose stored price is
 *     not the product's price today (it was added before the price changed) gets no original: the shop does not claim a saving it
 *     cannot prove.
 * The compiled app's own numbers are never changed: the Subtotal, the unit price and the order the shop sends are the app's. Nothing
 * here is stored or sent; every added node carries a data-sporta-* mark and is made with textContent. Numbers keep the page's own
 * digits (Arabic-Indic in Arabic) and its currency wording: the amount's text is copied from the price on screen with only its
 * number replaced. The proof is scripts/prices-1118-test.mjs.
 */
;(function () {
  'use strict'
  try {
    if (window.__sportaPrices) return
    Object.defineProperty(window, '__sportaPrices', { value: { version: 1 }, enumerable: false, configurable: false })
    var doc = document.documentElement
    var NUM = /[0-9٠-٩]+(?:[,٬][0-9٠-٩]{3})*(?:[.٫][0-9٠-٩]+)?/
    var T = {
      en: { off: '{p}% off', offShort: '−{p}%', save: 'You save {a} ({p}%)', line: 'Line total', was: 'Was', orig: 'Original total', saved: 'You save' },
      ar: { off: 'خصم {p}٪', offShort: '−{p}٪', save: 'توفّر {a} ({p}٪)', line: 'إجمالي السطر', was: 'كان', orig: 'إجمالي الأسعار الأصلية', saved: 'توفيرك' }
    }
    function lang() { return (doc.lang || 'ar').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ar' }
    function tr(k, v) { var s = T[lang()][k]; if (v) for (var x in v) s = s.split('{' + x + '}').join(v[x]); return s }
    function toLatin(s) { return String(s).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660) }).replace(/[,٬]/g, '').replace(/٫/g, '.') }
    /** The first amount in a text: { n, token } or null. */
    function amountIn(text) {
      var m = NUM.exec(String(text == null ? '' : text).replace(/ /g, ' '))
      if (!m) return null
      var n = Number(toLatin(m[0]))
      return isFinite(n) ? { n: n, token: m[0] } : null
    }
    /** `template` with its first amount replaced by `value` (3 decimals), in the template's own digits and decimal mark. */
    function withAmount(template, value) {
      var a = amountIn(template)
      if (!a) return String(value.toFixed(3))
      var arabic = /[٠-٩]/.test(a.token), mark = a.token.indexOf('٫') >= 0 ? '٫' : '.'
      var s = value.toFixed(3).replace('.', mark)
      if (arabic) s = s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x660 + Number(d)) })
      return String(template).replace(a.token, s)
    }
    function digits(n, like) {
      var s = String(n)
      return /[٠-٩]/.test(like) ? s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x660 + Number(d)) }) : s
    }
    function pctOf(list, now) { return list > 0 && now > 0 && now < list ? Math.round((list - now) / list * 100) : 0 }
    function ownText(el) {
      var t = ''
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue
      return t
    }
    function mk(tag, mark, text) { var e = document.createElement(tag); e.setAttribute(mark, ''); e.textContent = text; return e }
    function setText(e, text) { if (e.textContent !== text) e.textContent = text }

    // ---------------------------------------------------------------------------------------- cards and the product page
    function priceTags() {
      var els = document.querySelectorAll('.storefront-root .price-card, .storefront-root .catalog-product-price')
      for (var i = 0; i < els.length; i++) {
        var el = els[i], s = null
        for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.tagName === 'S') { s = c; break }
        var page = el.classList.contains('catalog-product-price')
        // On a product CARD the tag lives on the photo (bottom-start corner, PRODUCT CARDS 1119 in sporta-shadows.css), so the price row
        // keeps its two amounts on one line and every price in a grid row starts at the same height; on the product page it stays
        // beside the price. `frame` is the card's photo box (a React-owned element that already holds the heart and the "+"; the tag is
        // one more absolutely placed child, like the brand mark on the product page). No card box found: the old place.
        var frame = null
        if (!page) { var cardEl = el.closest('.product-grid-card'); frame = cardEl && cardEl.querySelector(':scope > .catalog-card-image') }
        var badge = (frame || el).querySelector(':scope > [data-sporta-off]')
        var stale = frame && el.querySelector(':scope > [data-sporta-off]')
        if (stale) stale.remove()
        var save = page ? el.parentNode && el.parentNode.querySelector(':scope > [data-sporta-save]') : null
        var now = s ? amountIn(ownText(el)) : null, list = s ? amountIn(s.textContent) : null
        var pct = now && list ? pctOf(list.n, now.n) : 0
        if (!pct) { if (badge) badge.remove(); if (save) save.remove(); continue }
        var text = tr(page ? 'off' : 'offShort', { p: digits(pct, now.token) })
        if (!badge) { badge = mk('span', 'data-sporta-off', text); (frame || el).appendChild(badge) } else setText(badge, text)
        if (page) {
          var line = tr('save', { a: withAmount(ownText(el).trim(), list.n - now.n), p: digits(pct, now.token) })
          if (!save) { save = mk('p', 'data-sporta-save', line); el.parentNode.insertBefore(save, el.nextSibling) } else setText(save, line)
        }
      }
    }

    // ----------------------------------------------------------------------------------------------- the bag
    var LIST = null, listState = 'idle'   // idle | loading | done | failed
    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase() }
    function loadList() {
      if (listState !== 'idle') return
      listState = 'loading'
      fetch('/api/api.php?r=products', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (rows) {
          LIST = {}
          ;(Array.isArray(rows) ? rows : []).forEach(function (p) {
            var rec = { price: Number(p.price), list: Number(p.list_price), onSale: p.on_sale === true }
            ;[p.name_en, p.name_ar].forEach(function (n) { if (n) LIST[norm(n)] = rec })
          })
          listState = 'done'; soon()
        })
        .catch(function () { listState = 'failed' })
    }
    // `totals` is set only for the bag PAGE's lines: they alone feed the page summary. The closed drawer keeps its own copies of the same lines in
    // the DOM, and counting them too doubled "Original total" and "You save" on the page (found by the cart scan, 2026-11-19).
    var LINES = [
      { row: '.cart-line', name: 'h3', qty: '.purchase-quantity > span', totals: '.cart-line__controls' },
      { row: '.cart-drawer__line', name: 'p.font-bold', qty: '.purchase-quantity > span', totals: null }
    ]
    function unitPara(row) {
      var ps = row.querySelectorAll('p')
      for (var i = 0; i < ps.length; i++) if (amountIn(ownText(ps[i])) && /KWD|د\.ك|دينار/.test(ps[i].textContent)) return ps[i]
      return null
    }
    function bag() {
      var any = false, origTotal = 0, nowTotal = 0, saved = 0, tmpl = null
      LINES.forEach(function (def) {
        var rows = document.querySelectorAll(def.row)
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          if (!row.isConnected) continue
          any = true
          var nameEl = row.querySelector(def.name), qEl = row.querySelector(def.qty), unitP = unitPara(row)
          var qty = qEl ? amountIn(qEl.textContent) : null, unit = unitP ? amountIn(ownText(unitP).split('\u00b7')[0]) : null
          var controls = def.totals ? row.querySelector(def.totals) : null
          var tag = row.querySelector('[data-sporta-line]'), was = row.querySelector('[data-sporta-was]')
          if (!nameEl || !qty || !unit || !unitP || qty.n < 1) { if (tag) tag.remove(); if (was) was.remove(); continue }
          var template = ownText(unitP).split('\u00b7')[0].trim()
          var q = Math.round(qty.n), u = unit.n
          // two or more pieces on the bag PAGE: the line total, in the row of the quantity box and the remove button (a row that
          // already exists, so nothing moves). The drawer is too narrow for a third item: it keeps the app's own subtotal.
          // ...unless the app already draws that line total in the row (the compiled bag page does: the figure beside the stepper). A second copy of
          // the same figure pushed the remove button to a row of its own (cart scan, 2026-11-19), so the tag is only for a build that does not draw one.
          var drawn = false
          if (controls) for (var ci = 0; ci < controls.children.length; ci++) {
            var cc = controls.children[ci]
            if (cc.hasAttribute('data-sporta-line')) continue
            var ca = amountIn(cc.textContent)
            if (ca && Math.abs(ca.n - u * q) < 0.0005 && /KWD|د\.ك|دينار/.test(cc.textContent)) { drawn = true; break }
          }
          if (controls && q >= 2 && !drawn) {
            var lt = withAmount(template, u * q), full = tr('line') + ': ' + lt
            if (!tag) {
              tag = mk('span', 'data-sporta-line', lt); tag.setAttribute('aria-label', full); tag.setAttribute('title', full)
              controls.insertBefore(tag, controls.lastElementChild)
            } else { setText(tag, lt); tag.setAttribute('aria-label', full); tag.setAttribute('title', full) }
          } else if (tag) tag.remove()
          // the original, when the product is on sale now and the line holds today's price: inline in the unit-price line
          var rec = LIST && LIST[norm(nameEl.textContent)]
          var proved = rec && rec.onSale && rec.list > rec.price && Math.abs(rec.price - u) < 0.0005
          if (proved) {
            var pct = pctOf(rec.list, rec.price)
            var wasText = ' \u00b7 ' + tr('was') + ' ' + withAmount(template, rec.list) + ' (' + tr('offShort', { p: digits(pct, unit.token) }) + ')'
            if (!was) { was = mk('span', 'data-sporta-was', wasText); unitP.appendChild(was) } else setText(was, wasText)
            if (def.totals) { origTotal += rec.list * q; saved += (rec.list - rec.price) * q }
            tmpl = tmpl || template
          } else { if (was) was.remove(); if (def.totals) origTotal += u * q }
          if (def.totals) nowTotal += u * q
          if (!tmpl) tmpl = template
        }
      })
      if (any) loadList()
      // the bag page's summary: the original total and the saving, above the Subtotal row the app draws
      var sum = document.querySelector('.purchase-cart__summary .purchase-total'), rows2 = document.querySelector('.purchase-cart__summary [data-sporta-sumrows]')
      if (!sum || !any || saved <= 0.0005 || !tmpl) { if (rows2) rows2.remove(); return }
      var o = tr('orig') + '|' + withAmount(tmpl, origTotal), s = tr('saved') + '|−' + withAmount(tmpl, saved)
      if (!rows2) {
        rows2 = document.createElement('div'); rows2.setAttribute('data-sporta-sumrows', '')
        ;[0, 1].forEach(function () { var r = document.createElement('p'); r.appendChild(document.createElement('span')); r.appendChild(document.createElement('span')); rows2.appendChild(r) })
        sum.parentNode.insertBefore(rows2, sum)
      }
      ;[o, s].forEach(function (pair, i) {
        var parts = pair.split('|'), spans = rows2.children[i].children
        setText(spans[0], parts[0]); setText(spans[1], parts[1])
      })
    }

    var queued = false
    function run() { queued = false; try { priceTags(); bag() } catch (e) { /* the page keeps its own prices */ } }
    function soon() { if (queued) return; queued = true; requestAnimationFrame(run) }
    function start() {
      run()
      try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true }) } catch (e) { /* prices then appear on the next page load */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  } catch (e) { /* the storefront keeps its own prices */ }
})()
/* ===== PRICES-1118 - end ===== */

/* ===== LIVE STOCK-1118 (2026-11-18, owner: "use ajax to sizes and colors selecter") =========================================
 * The product page reads the shop's stock ONCE, when it opens, so a size another shopper bought a minute ago stays tappable until checkout
 * refuses it. This block asks the shop again, in the background (one GET of api.php?r=stock, no-store, the same public list the app reads):
 * when a size is tapped, when the tab comes back to the front, and before Add. A size the shop now says has none is marked sold out on
 * the page (struck through, aria-disabled, a polite note) and an Add of it is stopped before it reaches the bag; a size that has come back
 * is released. The app's own buttons are never replaced or re-rendered: only data-sporta-* marks, an aria-disabled and one note are added.
 * A failed request changes nothing: the page is exactly what the app drew. Colours need no request: each colour is its own piece and
 * the app opens it inside the page (no reload); this block does not touch the colour buttons.
 */
;(function () {
  'use strict'
  try {
    if (window.__sportaLiveStock) return
    Object.defineProperty(window, '__sportaLiveStock', { value: { version: 1 }, enumerable: false, configurable: false })
    var TEXT = {
      en: { gone: 'This size has just sold out. Please choose another size.' },
      ar: { gone: 'نفد هذا المقاس للتو. اختر مقاسًا آخر من فضلك.' }
    }
    var lastAt = 0, inflight = null, stock = null
    function lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en' }
    function slug() { var m = /^\/product\/([^/?#]+)/.exec(location.pathname); try { return m ? decodeURIComponent(m[1]) : '' } catch (e) { return m ? m[1] : '' } }
    function ladder() { return document.getElementById('product-size-options') }
    function chips() { var l = ladder(); return l ? Array.prototype.slice.call(l.querySelectorAll('[role="group"] > button')).filter(function (c) { return !c.hasAttribute('data-sporta-nosize') }) : [] }
    function sizeOf(c) { return String(c.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase() }
    function fetchStock() {
      if (inflight) return inflight
      inflight = fetch('/api/api.php?r=stock', { cache: 'no-store', credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (rows) {
          inflight = null
          if (!Array.isArray(rows)) return null
          var s = slug(), map = {}
          rows.forEach(function (r) { if (r && r.slug === s) map[String(r.size).toUpperCase()] = Number(r.stock) || 0 })
          stock = map; lastAt = Date.now(); apply(); return map
        }, function () { inflight = null; return null })
      return inflight
    }
    function note(show) {
      var l = ladder(); if (!l) return
      var n = l.querySelector(':scope > [data-sporta-gone-note]')
      if (!show) { if (n) n.remove(); return }
      if (!n) { n = document.createElement('p'); n.setAttribute('data-sporta-gone-note', ''); n.setAttribute('role', 'status'); l.appendChild(n) }
      if (n.textContent !== TEXT[lang()].gone) n.textContent = TEXT[lang()].gone
    }
    function apply() {
      if (!stock) return
      var anyGoneSelected = false
      chips().forEach(function (c) {
        var key = sizeOf(c), known = Object.prototype.hasOwnProperty.call(stock, key)
        var gone = known && stock[key] < 1 && !c.disabled
        if (gone) { if (!c.hasAttribute('data-sporta-gone')) { c.setAttribute('data-sporta-gone', ''); c.setAttribute('aria-disabled', 'true') } }
        else if (c.hasAttribute('data-sporta-gone')) { c.removeAttribute('data-sporta-gone'); c.removeAttribute('aria-disabled') }
        if (gone && c.getAttribute('aria-pressed') === 'true') anyGoneSelected = true
      })
      note(anyGoneSelected)
    }
    function selectedGone() {
      var c = chips().filter(function (x) { return x.getAttribute('aria-pressed') === 'true' })[0]
      return !!c && c.hasAttribute('data-sporta-gone')
    }
    // a tap on a size: ask again (the answer marks the sizes within a moment)
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('#product-size-options [role="group"] > button') : null
      if (t) { if (t.hasAttribute('data-sporta-gone')) { e.preventDefault(); e.stopImmediatePropagation(); note(true); return } fetchStock() }
    }, true)
    // Add: stopped when the size in hand is known to be gone (the answer is at most a few seconds old, from the tap that chose it)
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.product-purchase-row .btn-primary, .action-bar > .btn-primary') : null
      if (!b) return
      if (selectedGone() && Date.now() - lastAt < 15000) { e.preventDefault(); e.stopImmediatePropagation(); note(true) } else fetchStock()
    }, true)
    document.addEventListener('visibilitychange', function () { if (!document.hidden && ladder()) fetchStock() })
  } catch (e) { /* the page keeps the stock it was drawn with */ }
})()
/* ===== LIVE STOCK-1118 - end ===== */

/* ===== PRODUCT BRAND-1118 (2026-11-18, owner: "make brand layout at product dont use sporta as product brand") =====================
 * The compiled product page called the shop the product's brand in three places: the line above the title ("SPORTA / MADE FOR YOUR NEXT MOVE"), the
 * logo at the start of the brand plate, and "Authentic - sold by Sporta" as the plate's only content when the product has no maker. The shop sells
 * these goods; it does not make them. Now:
 *   - the line above the title names the product's own brand (the one the plate shows, from the admin's Brands tag) and is not drawn when the
 *     product has none (the build's own line is hidden, never edited: a node of our own stands in front of it);
 *   - the shop's logo no longer opens the plate (CSS, sporta-product-fix.css), so the maker leads it; a product tagged with the shop's own label "sporta" is treated as
 *     having no brand at all; the brand mark on the photo (BRANDMARK-1118) and the structured data (JSONLD-1117) follow the same rule;
 * It reads the plate the app drew (the maker's logo alt text or name), so it needs no request and decides in the frame the page appears in.
 * Nodes: one <p data-sporta-brandline> over the build's eyebrow (whose box is kept, see the CSS), and two data attributes. createElement/textContent only. */
;(function () {
  'use strict'
  try {
    if (window.__sportaProductBrand) return
    Object.defineProperty(window, '__sportaProductBrand', { value: { version: 1 }, enumerable: false, configurable: false })
    var OWN = /^(sporta|sporta sports wear|\u0633\u0628\u0648\u0631\u062a\u0627)$/i
    function makerName(m) {
      if (!m) return ''
      var img = m.querySelector('img')
      return String((img && img.getAttribute('alt')) || m.textContent || '').replace(/\s+/g, ' ').trim()
    }
    function run() {
      var page = document.querySelector('.catalog-product-page')
      var old = document.querySelectorAll('[data-sporta-brandline]')
      if (!page) { for (var d = 0; d < old.length; d++) old[d].remove(); return }
      var plate = page.querySelector('.campaign-brand-plate')
      var maker = plate ? plate.querySelector(':scope > .campaign-brand-plate__maker') : null
      var name = makerName(maker), own = !!name && OWN.test(name), real = !!name && !own
      if (maker) { if (own) maker.setAttribute('data-sporta-ownbrand', ''); else maker.removeAttribute('data-sporta-ownbrand') }
      var eb = page.querySelector('.catalog-product-summary > .catalog-eyebrow')
      if (!eb) return
      var mine = eb.parentNode.querySelector(':scope > [data-sporta-brandline]')
      if (!eb.hasAttribute('data-sporta-eyebrow')) eb.setAttribute('data-sporta-eyebrow', '')
      if (!real) { if (mine) mine.remove(); return }
      if (!mine) {
        mine = document.createElement('p'); mine.className = eb.className; mine.setAttribute('data-sporta-brandline', '')
        eb.parentNode.insertBefore(mine, eb)
      }
      if (mine.textContent !== name) mine.textContent = name
      mine.setAttribute('dir', 'auto')
    }
    var queued = false
    function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { run() } catch (e) {} }) }
    function start() {
      run()
      try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['alt', 'src'] }) } catch (e) { /* the page keeps its own line */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  } catch (e) { /* the page keeps its own brand area */ }
})()
/* ===== PRODUCT BRAND-1118 - end ===== */

/* ===== FABRIC-1119 (2026-11-19, owner: "make fabric selector with percent option") =====================
 * The product page says what the garment is made of, under the title: "Fabric: Cotton 80%, Elastane 20%", or "Fabric: Cotton, Nylon"
 * when the admin gave no percentages. The composition is the product's `fabric` list in /api/api.php?r=products (the rules are in
 * dropin/php-store/fabric.php). One request per product page, no data of its own, and nothing is drawn when the product states no fabric.
 * It re-checks after the page changes (the observer), adds nothing twice, and never edits the app's own nodes: one <p data-sporta-fabric>
 * after the title. createElement/textContent only. */
;(function () {
  'use strict'
  try {
    if (window.__sportaFabric) return
    Object.defineProperty(window, '__sportaFabric', { value: { version: 1 }, enumerable: false, configurable: false })
    var LABEL = { en: 'Fabric', ar: 'الخامة' }
    var NAME = {
      cotton: ['Cotton', 'قطن'], polyester: ['Polyester', 'بوليستر'],
      elastane: ['Elastane', 'إيلاستين'], nylon: ['Nylon', 'نايلون'],
      viscose: ['Viscose', 'فسكوز'], modal: ['Modal', 'مودال'],
      wool: ['Wool', 'صوف'], linen: ['Linen', 'كتان'], bamboo: ['Bamboo', 'خيزران']
    }
    var products = null
    function slugOf() { var m = /^\/product\/([^/]+)\/?$/.exec(location.pathname); return m ? decodeURIComponent(m[1]) : '' }
    function langNow() { return document.documentElement.getAttribute('lang') === 'ar' ? 'ar' : 'en' }
    function nameOf(material, lang) { var n = NAME[material]; return n ? (lang === 'ar' ? n[1] : n[0]) : '' }
    function line(list, lang) {
      var parts = []
      list.forEach(function (e) {
        var n = nameOf(e && e.material, lang)
        if (!n) return
        parts.push(e.percent == null ? n : n + ' ' + e.percent + '%')
      })
      return parts.length ? LABEL[lang] + ': ' + parts.join(', ') : ''
    }
    function load() {
      if (!products) {
        products = fetch('/api/api.php?r=products', { credentials: 'same-origin' })
          .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
          .then(function (j) { return Array.isArray(j) ? j : [] })
          .catch(function () { products = null; return [] })
      }
      return products
    }
    function run() {
      var page = document.querySelector('.catalog-product-page')
      var slug = page ? slugOf() : ''
      var old = document.querySelectorAll('[data-sporta-fabric]')
      if (!slug) { for (var i = 0; i < old.length; i++) old[i].remove(); return }
      var title = page.querySelector('.catalog-product-summary h1') || page.querySelector('h1')
      if (!title) return
      // a line already drawn for this product, in this language, stays as it is
      var have = title.parentNode.querySelector(':scope > [data-sporta-fabric]')
      if (have && have.getAttribute('data-sporta-fabric') === slug && have.getAttribute('lang') === langNow()) return
      for (var j = 0; j < old.length; j++) if (old[j] !== have) old[j].remove()
      load().then(function (list) {
        // the page may have moved on while the list was read: draw only for the product on screen now
        if (slugOf() !== slug) return
        var mine = null
        for (var k = 0; k < list.length; k++) if (list[k] && list[k].slug === slug) { mine = list[k]; break }
        var text = mine && Array.isArray(mine.fabric) && mine.fabric.length ? line(mine.fabric, langNow()) : ''
        var node = document.querySelector('[data-sporta-fabric="' + slug + '"]')
        if (!text) { if (node) node.remove(); return }
        if (!node) {
          node = document.createElement('p')
          node.setAttribute('data-sporta-fabric', slug)
          node.style.margin = '.25rem 0 .5rem'
          node.style.fontSize = '.95rem'
          node.style.color = '#4b5563'
          var t2 = page.querySelector('.catalog-product-summary h1') || title
          t2.parentNode.insertBefore(node, t2.nextSibling)
        }
        node.setAttribute('lang', langNow())
        node.setAttribute('dir', langNow() === 'ar' ? 'rtl' : 'ltr')
        if (node.textContent !== text) node.textContent = text
      })
    }
    var queued = false
    function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { run() } catch (e) { /* the page keeps working without the line */ } }) }
    function start() {
      run()
      // the document root: the language sits on <html>, and a route change adds nodes under it
      try { new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang', 'dir'] }) } catch (e) { /* the page keeps working without it */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  } catch (e) { /* the product page keeps working without the fabric line */ }
})()
/* ===== FABRIC-1119 - end ===== */

/* ===== TOPBAR ACCOUNT (2026-11-19, owner: "remove sporta ai icons from topbar put account profile icons") ==================
 * The top bar's Sporta AI button is not shown any more (sporta-shadows.css TOPBAR ACCOUNT 1120, [tacc-1]: one rule, the button and
 * the assistant stay in the page) and an account icon takes its place, beside the clock. This block makes that icon: a real link to
 * /account (so a middle click or "open in a new tab" works, and a screen reader says "Account" / "حسابي"), drawn as the person of the
 * shop's icon set (brand/iconset/user.svg). A plain click is handed to the router by pressing the menu's own Account link, so the
 * page changes without reloading the shop and the router keeps its place in the history (a link made here would reload everything);
 * with no menu link to press, the browser simply follows the address. A modified click is left to the browser.
 * The link lives inside the compiled header's tool cluster (React renders the AI button and the clock there and never touches a node
 * it did not make); it is made once the header exists, put back if the cluster is replaced, kept to one, labelled in the page's
 * language and marked aria-current on /account. DOM calls only (no innerHTML), textContent never carries data, no request. */
;(function () {
  'use strict'
  try {
    if (window.__sportaTopbarAccount || /^\/backends(?:\/|$)/.test(location.pathname)) return
    window.__sportaTopbarAccount = 1
    var NS = 'http://www.w3.org/2000/svg'
    var TEXT = { ar: '\u062d\u0633\u0627\u0628\u064a', en: 'Account' }
    var queued = false

    function english() { return String(document.documentElement.lang).slice(0, 2).toLowerCase() === 'en' }
    function onAccount() { return /^\/account\/?$/.test(location.pathname) }
    function shape(tag, attrs) {
      var n = document.createElementNS(NS, tag)
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k])
      return n
    }
    function make() {
      var a = document.createElement('a')
      a.className = 'navbar-account'
      a.setAttribute('href', '/account')
      a.setAttribute('data-sporta-account', '')
      var icon = shape('svg', { 'class': 'navbar-account__icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })
      icon.appendChild(shape('circle', { cx: '12', cy: '8.25', r: '4' }))
      icon.appendChild(shape('path', { d: 'M4.5 20.25a7.5 7.5 0 0 1 15 0' }))
      a.appendChild(icon)
      a.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        var tab = document.querySelector('.app-header .navbar-secondary a[href="/account"]')
        if (tab && tab !== a) { e.preventDefault(); tab.click() }
      })
      return a
    }
    function sync() {
      var tools = document.querySelector('.storefront-root .app-header .navbar-tools')
      if (!tools) return
      var all = document.querySelectorAll('.app-header a.navbar-account'), link = null, i
      for (i = 0; i < all.length; i++) {
        if (!link && all[i].parentNode === tools) link = all[i]
        else all[i].parentNode.removeChild(all[i])
      }
      if (!link) {
        link = make()
        // the cluster is a row-reverse flex box: right after the AI button in the markup is its place on screen
        var ai = tools.querySelector(':scope > .navbar-ai')
        if (ai) tools.insertBefore(link, ai.nextSibling)
        else tools.insertBefore(link, tools.firstChild)
      }
      var text = english() ? TEXT.en : TEXT.ar
      if (link.getAttribute('aria-label') !== text) link.setAttribute('aria-label', text)
      if (onAccount()) { if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page') }
      else if (link.hasAttribute('aria-current')) link.removeAttribute('aria-current')
    }
    function schedule() {
      if (queued) return
      queued = true
      requestAnimationFrame(function () { queued = false; try { sync() } catch (e) {} })
    }
    function start() {
      try { sync() } catch (e) {}
      if (!window.MutationObserver) return
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
      new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      window.addEventListener('popstate', schedule)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  } catch (e) {}
})()
/* ===== TOPBAR ACCOUNT - end ===== */

/* ===== CATALOGUE-1118 - begin ===================================================================================
 * The "Catalogue" page of the main menu (owner request 2026-11-18). Two small jobs, both on every storefront page except /backends:
 *
 *  1. THE MENU TAB. A sixth link, "Catalogue" / "الكتالوج", is put into the header's tab row after Shop, with the tab row's own
 *     classes (so it looks and behaves like the five the compiled app draws) and marked current on /catalogue. It is inserted from a
 *     MutationObserver callback, in the same task as the render that made the row, and not a frame later, so the row does not move
 *     after the first paint (MENU-PAGES-SCAN L-02). On a phone the row is tightened a little (gap and padding only) so six tabs
 *     fit 360-390 px; below that it scrolls inside itself as it already does at larger text sizes.
 *  2. THE PAGE. /catalogue is a route the compiled app does not have: .htaccess answers it with the app shell and the app draws its
 *     "Page not found" section. On that path this block hides that section (a marker on <main> and one CSS rule, nothing of the app's
 *     is removed or edited, so React keeps its own tree intact), adds one <div id="sporta-catalogue"> to <main>, loads
 *     /sporta-catalogue.js on demand (only here: no other page downloads it) and lets it draw the page. It also gives the document
 *     the title, description, robots (index), canonical and language alternates the app's not-found page does not (the owner chose a
 *     public, indexable page). Leaving the path (a tab, the logo, back) removes the div, the marker, the alternates and the data.
 * No request is made by this block itself; the engine reads the shop's public product routes. Everything is wrapped in try/catch:
 * if anything here fails the shop is exactly what it was.
 * ============================================================================================================================ */
;(function () {
  'use strict'
  try {
    if (window.__sportaCatalogueHook) return
    window.__sportaCatalogueHook = true
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.MutationObserver) return
    var PATH = /^\/catalogue\/?$/
    var ORIGIN = 'https://www.sporta.com.kw'
    var TXT = {
      en: {
        tab: 'Catalogue', title: 'Product catalogue \u2014 Sporta',
        desc: 'Every current Sporta product with today\u2019s price and the sizes in stock, and a PDF catalogue made from the live shop each time you download it.'
      },
      ar: {
        tab: '\u0627\u0644\u0643\u062a\u0627\u0644\u0648\u062c', title: '\u0643\u062a\u0627\u0644\u0648\u062c \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u2014 \u0633\u0628\u0648\u0631\u062a\u0627',
        desc: '\u062c\u0645\u064a\u0639 \u0645\u0646\u062a\u062c\u0627\u062a \u0633\u0628\u0648\u0631\u062a\u0627 \u0627\u0644\u062d\u0627\u0644\u064a\u0629 \u0628\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u064a\u0648\u0645 \u0648\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0627\u0644\u0645\u062a\u0648\u0641\u0631\u0629\u060c \u0645\u0639 \u0643\u062a\u0627\u0644\u0648\u062c PDF \u064a\u064f\u0646\u0634\u0623 \u0645\u0646 \u0627\u0644\u0645\u062a\u062c\u0631 \u0645\u0628\u0627\u0634\u0631\u0629\u064b \u0639\u0646\u062f \u0643\u0644 \u062a\u062d\u0645\u064a\u0644.'
      }
    }
    var TAB_CLASS = 'navbar-link flex min-h-11 items-center px-2 transition hover:text-brand-bright '
    var page = null, loading = false, failedAt = 0, tries = 0

    function lang() { return document.documentElement.getAttribute('lang') === 'ar' ? 'ar' : 'en' }
    function isPage() { return PATH.test(location.pathname) }
    function addStyle(id, css) {
      if (document.getElementById(id)) return
      var s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
    }

    // ---- 1. the tab -------------------------------------------------------------------------------------------------
    function tab() {
      var ul = document.querySelector('.navbar-secondary ul')
      if (!ul) return
      var l = lang(), on = isPage(), key = l + '|' + on, li = ul.querySelector('[data-sporta-cat-tab]')
      if (li && li.getAttribute('data-k') === key) return
      if (!li) {
        li = document.createElement('li'); li.setAttribute('data-sporta-cat-tab', '1')
        var a = document.createElement('a'); a.href = '/catalogue'; li.appendChild(a)
        var shop = ul.querySelector('a[href="/shop"]'), after = shop && shop.closest('li')
        if (after && after.parentNode === ul) ul.insertBefore(li, after.nextSibling); else ul.appendChild(li)
        ul.setAttribute('data-sporta-cat-nav', '1')
        // sporta-bag-touch.css [menu-3] lays the phone row out as FIVE equal columns (a sixth tab would wrap to a second row); six columns, a slightly
        // smaller label and a little less padding keep it on one line at 360-390 px, and the row scrolls inside itself below that as it already does
        addStyle('sporta-cat-nav-css', '@media (max-width:639px){.app-header div.navbar-secondary>ul[data-sporta-cat-nav]{grid-template-columns:repeat(6,minmax(min-content,1fr));padding-inline:.5rem}'
          + '.app-header .navbar-secondary ul[data-sporta-cat-nav] .navbar-link{padding-inline:.25rem;font-size:.8125rem}}'
          + '@media (max-width:359px){.app-header .navbar-secondary ul[data-sporta-cat-nav] .navbar-link{font-size:.75rem}}')
      }
      var link = li.firstChild
      link.textContent = TXT[l].tab
      link.className = TAB_CLASS + (on ? 'text-brand-bright' : 'text-white/80')
      if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current')
      li.setAttribute('data-k', key)
    }

    // ---- 2. the page ------------------------------------------------------------------------------------------------
    function setAttr(sel, attr, val) {
      var m = document.head.querySelector(sel)
      if (m && m.getAttribute(attr) !== val) m.setAttribute(attr, val)
    }
    function ensureLink(rel, hreflang, href) {
      var sel = 'link[rel="' + rel + '"]' + (hreflang ? '[hreflang="' + hreflang + '"]' : ''), k = document.head.querySelector(sel)
      if (!k) { k = document.createElement('link'); k.setAttribute('rel', rel); if (hreflang) k.setAttribute('hreflang', hreflang); k.setAttribute('data-sporta-cat-head', '1'); document.head.appendChild(k) }
      if (k.getAttribute('href') !== href) k.setAttribute('href', href)
    }
    // C1 (2026-11-19 review): seo-page.php writes the OWNER's words into the head of /catalogue (settings.catalogue: title and intro; the SEO screen's own
    // per-page override outranks them) and the compiled app's "Page not found" tags land on top of them once it mounts. This block used to put its own fixed
    // text over both, so the owner's wording was gone from the rendered DOM. It now says what the server says, in the server's order: the SEO override for
    // /catalogue (read from the #sporta-seo-data payload the server put in the page), then the owner's title and intro (what the engine read from
    // ?r=catalogue), then the built-in text. Idempotent, so the head observer below can run it as often as the app writes.
    var seoPages
    function seoOverride(l) {
      if (seoPages === undefined) {
        seoPages = null
        try { var n = document.getElementById('sporta-seo-data'), j = n ? JSON.parse(n.textContent) : null; if (j && j.pages && typeof j.pages === 'object') seoPages = j.pages['/catalogue'] || null } catch (e) { seoPages = null }
      }
      var o = seoPages || {}, t = typeof o['title_' + l] === 'string' ? o['title_' + l].trim().slice(0, 120) : '', d = typeof o['description_' + l] === 'string' ? o['description_' + l].trim().slice(0, 320) : ''
      return { title: t, desc: d }
    }
    function head() {
      var l = lang(), t = TXT[l], bare = ORIGIN + '/catalogue'
      var ov = seoOverride(l), own = window.SportaCatalogue && typeof window.SportaCatalogue.headText === 'function' ? window.SportaCatalogue.headText(l) : null
      var words = { title: ov.title || (own && own.title) || t.title, desc: ov.desc || (own && own.description) || t.desc }
      if (document.title !== words.title) document.title = words.title
      setAttr('meta[name="description"]', 'content', words.desc)
      // /catalogue?pdf=ar|en is the "build and download the PDF" link, not a page to index: it is kept out of the index (the canonical below
      // is still the bare page, so a copy of it that is already known folds into /catalogue).
      setAttr('meta[name="robots"]', 'content', /(^|[?&])pdf=/.test(location.search) ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1')
      setAttr('meta[property="og:title"]', 'content', words.title)
      setAttr('meta[property="og:description"]', 'content', words.desc)
      setAttr('meta[name="twitter:title"]', 'content', words.title)
      setAttr('meta[name="twitter:description"]', 'content', words.desc)
      setAttr('meta[property="og:url"]', 'content', l === 'en' ? bare + '?lang=en' : bare)
      ensureLink('canonical', '', l === 'en' ? bare + '?lang=en' : bare)
      ensureLink('alternate', 'en', bare + '?lang=en')
      ensureLink('alternate', 'ar', bare)
      ensureLink('alternate', 'x-default', bare)
    }
    function mount() {
      var main = document.getElementById('main')
      if (!main) return
      addStyle('sporta-cat-hide-css', 'main[data-sporta-cat]>:not(#sporta-catalogue){display:none!important}#sporta-catalogue{min-height:70vh}')
      main.setAttribute('data-sporta-cat', '1')
      var host = document.getElementById('sporta-catalogue')
      if (!host) { host = document.createElement('div'); host.id = 'sporta-catalogue'; main.appendChild(host) }
      if (host.getAttribute('data-ready')) return
      if (window.SportaCatalogue) { host.setAttribute('data-ready', '1'); page = window.SportaCatalogue.mountPage(host); return }
      if (loading) return
      // A failed load (offline, a blocked request) is not retried on every DOM change - this function runs on each one, and a failing
      // request would pile one dead <script> per mutation into <head> (independent review 2026-11-18). One retry every 10 s, three tries in
      // all, then a plain "reload the page" sentence; leaving the page and coming back starts over.
      if (failedAt && (tries >= 3 || Date.now() - failedAt < 10000)) return
      loading = true
      var s = document.createElement('script'); s.src = '/sporta-catalogue.js'; s.async = true
      s.onload = function () {
        loading = false; failedAt = 0; tries = 0
        var f = document.querySelector('[data-sporta-cat-fail]'); if (f) f.remove()
        sync()
      }
      s.onerror = function () {
        loading = false; failedAt = Date.now(); tries += 1
        try { s.remove() } catch (e) { /* gone anyway */ }
        failNote(host, tries < 3)
        if (tries < 3) setTimeout(function () { try { sync() } catch (e) { /* ignore */ } }, 10100)
      }
      document.head.appendChild(s)
    }
    function failNote(host, willRetry) {
      if (!host || !host.parentNode) return
      var p = host.querySelector('[data-sporta-cat-fail]')
      if (!p) { p = document.createElement('p'); p.setAttribute('data-sporta-cat-fail', '1'); p.setAttribute('role', 'status'); p.style.cssText = 'text-align:center;padding:3rem 1rem;margin:0'; host.appendChild(p) }
      var ar = lang() === 'ar', msg = ar
        ? (willRetry ? 'تعذّر تحميل الكتالوج. جارٍ إعادة المحاولة…' : 'تعذّر تحميل الكتالوج. أعد تحميل الصفحة.')
        : (willRetry ? 'The catalogue could not be loaded. Trying again…' : 'The catalogue could not be loaded. Please reload the page.')
      if (p.textContent !== msg) p.textContent = msg
    }
    function unmount() {
      failedAt = 0; tries = 0
      var main = document.getElementById('main'); if (main) main.removeAttribute('data-sporta-cat')
      if (page) { try { page.destroy() } catch (e) { /* gone anyway */ } page = null }
      var host = document.getElementById('sporta-catalogue'); if (host) host.remove()
      Array.prototype.forEach.call(document.head.querySelectorAll('[data-sporta-cat-head]'), function (n) { n.remove() })
    }
    // UX-1 (2026-11-19 review): from the first sync on /catalogue the app's "Page not found" section is hidden and <main> keeps the page's height, so
    // the footer is where it will stay (it used to jump when the page mounted: CLS 0.09 on its own).
    function early() {
      var on = isPage(), de = document.documentElement
      if (on) {
        addStyle('sporta-cat-early-css', 'html[data-sporta-cat-path] #main{min-height:100vh}html[data-sporta-cat-path] #main>:not(#sporta-catalogue){display:none!important}')
        if (!de.hasAttribute('data-sporta-cat-path')) de.setAttribute('data-sporta-cat-path', '1')
      } else if (de.hasAttribute('data-sporta-cat-path')) de.removeAttribute('data-sporta-cat-path')
    }
    function sync() {
      try {
        early()
        tab()
        if (isPage()) { mount(); head() }
        else if (page || document.getElementById('sporta-catalogue') || document.head.querySelector('[data-sporta-cat-head]')) unmount()
      } catch (e) { /* the shop keeps working without this block */ }
    }
    new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true })
    new MutationObserver(function () { try { if (isPage()) head() } catch (e) { /* ignore */ } }).observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true })
    window.addEventListener('popstate', sync)
    sync()
  } catch (e) { /* the menu keeps its five tabs */ }
})()
/* ===== CATALOGUE-1118 - end ===== */

/* ===== MAGIC ZOOM-1119 (2026-11-19, owner: "make magic zoom") =====================================================================
 * The product photo's hover zoom was the build's own: it scaled the photo that is already on the page (a 640px copy where the shop has
 * made small copies) 2.5 times with a 700 ms ease, which is a soft picture, and it jumped to the pointer. This block replaces it, for a
 * mouse only ((hover: hover) and (pointer: fine); a finger keeps the swipe, the tap and the full-screen viewer above), with a magnifier:
 *   - a layer inside the photo stage (data-sporta-lens, pointer-events none, aria-hidden) that shows the photo's ORIGINAL file (the
 *     <img>'s own src; the viewer above loads the same file, so it is cached for the full-screen view) at 2.5x, around the point under the
 *     pointer. Until the original has arrived (it starts to download after 140 ms of rest, never on a drive-by) the layer shows the copy
 *     the page already has, so the first frame is instant and then sharpens in place;
 *   - the layer glides to the pointer (an exponential ease, about 80 ms) instead of jumping, fades in and out over 160 ms, and holds the
 *     point under the pointer exactly: the picture's pixel there is the same pixel the page shows, only larger;
 *   - the build's own scale is switched off while the lens is drawn (data-sporta-mz on the stage, CSS in sporta-product-fix.css), so the
 *     two never stack; if the lens cannot be drawn the build's zoom stays as it was;
 *   - prefers-reduced-motion: no glide and no fade;
 *   - not on the "no photo" plate, not while the viewer is open, not on a touch device, nothing on /backends. It follows a change of
 *     photo (arrow keys, thumbnails) and a scroll, and goes when the pointer leaves the stage or the window.
 * Only attributes and a layer inside the stage are written; no layout moves (the layer is absolute), no request but the original photo.
 * Leading ";" because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.requestAnimationFrame || window.__sportaMagicZoom) return
    Object.defineProperty(window, '__sportaMagicZoom', { value: 1, enumerable: false, configurable: false })
    var STAGE = '.catalog-gallery-stage', LENS = 'data-sporta-lens', ON = 'data-sporta-mz', PLATE = /product-photo-unavailable/
    var Z = 2.5, GLIDE_MS = 80, DWELL_MS = 140, FADE_MS = 200
    var S = null   // the lens in use: { stage, img, lens, src, tx, ty, px, py, last, raf, hi, timer, shown }
    var fine = function () { try { return matchMedia('(hover: hover) and (pointer: fine)').matches } catch (e) { return false } }
    var calm = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v }
    var shownImg = function (stage) {
      var imgs = stage.querySelectorAll('.catalog-gallery-track > img')
      if (imgs.length < 2) return imgs[0] || null
      var r = stage.getBoundingClientRect(), cx = r.left + r.width / 2, best = imgs[0], d = Infinity
      for (var i = 0; i < imgs.length; i++) {
        var b = imgs[i].getBoundingClientRect(), dd = Math.abs(b.left + b.width / 2 - cx)
        if (dd < d) { d = dd; best = imgs[i] }
      }
      return best
    }
    var usable = function (stage, img) {
      return !!img && !stage.hasAttribute('data-sporta-noview') && !PLATE.test(img.getAttribute('src') || '') && !PLATE.test(img.currentSrc || '') && img.naturalWidth > 0
    }
    var cssUrl = function (u) { return 'url(' + JSON.stringify(String(u)) + ')' }
    function end(now) {
      if (!S) return
      var s = S; S = null
      if (s.raf) cancelAnimationFrame(s.raf)
      clearTimeout(s.timer)
      s.stage.removeAttribute(ON)
      // the layer fades out (CSS) and is removed once it has; with reduced motion there is no fade
      var gone = function () { if (s.lens.parentNode) s.lens.parentNode.removeChild(s.lens) }
      if (now || calm()) gone(); else setTimeout(gone, FADE_MS)
    }
    function begin(stage, e) {
      var img = shownImg(stage)
      if (!usable(stage, img)) return
      var lens = document.createElement('div')
      lens.setAttribute(LENS, ''); lens.setAttribute('aria-hidden', 'true')
      var bg = getComputedStyle(stage).backgroundColor
      lens.style.backgroundColor = /rgba\(.*,\s*0\)$|transparent/.test(bg) ? '#fff' : bg
      var low = img.currentSrc || img.getAttribute('src'), src = img.getAttribute('src') || low
      lens.style.backgroundImage = cssUrl(low)
      stage.appendChild(lens)
      var r = stage.getBoundingClientRect()
      S = { stage: stage, img: img, lens: lens, src: src, tx: e.clientX, ty: e.clientY, px: e.clientX - r.left, py: e.clientY - r.top, last: 0, raf: 0, hi: low === src, timer: 0, shown: false, first: true }
      if (!S.hi) {
        var me = S
        me.timer = setTimeout(function () {
          if (S !== me) return
          var big = new Image()
          big.onload = function () { if (S === me && me.img === img) { me.lens.style.backgroundImage = cssUrl(me.src); me.hi = true } }
          big.src = me.src
        }, DWELL_MS)
      }
      kick()
    }
    function kick() { if (S && !S.raf) S.raf = requestAnimationFrame(frame) }
    function frame(t) {
      if (!S) return
      var s = S; s.raf = 0
      try {
        if (!s.stage.isConnected || document.querySelector('.catalog-product-lightbox')) { end(true); return }
        var cur = shownImg(s.stage)
        if (cur !== s.img) { var st = s.stage, ev = { clientX: s.tx, clientY: s.ty }; end(true); begin(st, ev); return }
        if (!usable(s.stage, s.img)) { end(true); return }
        var r = s.stage.getBoundingClientRect(), ir = s.img.getBoundingClientRect()
        var nw = s.img.naturalWidth, nh = s.img.naturalHeight, sc = Math.min(ir.width / nw, ir.height / nh)
        var dw = nw * sc, dh = nh * sc
        var left = ir.left - r.left + (ir.width - dw) / 2, top = ir.top - r.top + (ir.height - dh) / 2
        var gx = s.tx - r.left, gy = s.ty - r.top
        var k = calm() || !s.last ? 1 : 1 - Math.exp(-Math.min(34, Math.max(1, t - s.last)) / GLIDE_MS)   // a frame is at most 34 ms: after a rest the first step is a normal one
        if (s.first) k = 1
        s.px += (gx - s.px) * k; s.py += (gy - s.py) * k
        var u = clamp((s.px - left) / dw, 0, 1), v = clamp((s.py - top) / dh, 0, 1)
        s.lens.style.backgroundSize = (dw * Z) + 'px ' + (dh * Z) + 'px'
        s.lens.style.backgroundPosition = (s.px - u * dw * Z) + 'px ' + (s.py - v * dh * Z) + 'px'
        s.last = t
        if (!s.shown) { s.shown = true; s.first = false; s.stage.setAttribute(ON, '') }
        if (Math.abs(gx - s.px) > 0.3 || Math.abs(gy - s.py) > 0.3) kick()
      } catch (e) { end(true) }
    }
    document.addEventListener('mousemove', function (e) {
      try {
        if (!fine()) { if (S) end(true); return }
        var st = e.target && e.target.closest ? e.target.closest(STAGE) : null
        if (!st) { if (S) end(); return }
        if (!S || S.stage !== st) { if (S) end(true); begin(st, e) }
        if (!S) return
        S.tx = e.clientX; S.ty = e.clientY; kick()
      } catch (er) { /* the build's own zoom stays */ }
    }, { passive: true })
    document.addEventListener('mouseout', function (e) { if (S && !e.relatedTarget) end() }, { passive: true })
    window.addEventListener('scroll', function () { if (S) kick() }, { passive: true })
    window.addEventListener('resize', function () { if (S) kick() }, { passive: true })
    document.addEventListener('keydown', function () { if (S) kick() }, { passive: true })
  } catch (e) { /* the build's own hover zoom stays */ }
})()
/* ===== MAGIC ZOOM-1119 - end ===== */

/* ===== HERO FEEL-1119 (2026-11-19, owner: "improve slider change feel") ========================================================
 * What the CSS of HERO FEEL 1119 (sporta-home-trim.css) cannot do for the home slider (a <section aria-roledescription="carousel"> whose
 * first child with aria-live is the sliding track; the build moves it by writing style.transform = translateX(n%)):
 *  - FINGER: the build only looks at where a touch ENDED (48px and mostly sideways: next or previous), so the slider did not move under
 *    the finger and then jumped. Now the track follows the finger one to one, with resistance (0.35) when pulled past the first slide
 *    backwards or the last forwards, and on release it either carries on to the slide the build chooses (the same 48px rule, so the two
 *    always agree) from where the finger left it, or eases back. The build still decides the slide and writes the final transform.
 *  - JUMPS: a change of two or more slides at once (the last slide to the first, a dot of a far slide) made the track slide across every slide
 *    in between at six times the speed. The slide is now a dissolve: the track jumps (its transition is switched off for that one change,
 *    before it has begun) and fades in over 480 ms from the dark ground. A change of one slide keeps the build's slide.
 *  - ARRIVAL: the slide that has just become current is marked (data-sporta-arrive, 1.5 s) so its photo can settle in CSS.
 * No reduced motion (it does nothing then), nothing on /backends, only attributes and the track's own inline style are written, the
 * track's inline transition is cleared again after every use. Leading ";" because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.MutationObserver || window.__sportaHeroFeel) return
    Object.defineProperty(window, '__sportaHeroFeel', { value: 1, enumerable: false, configurable: false })
    var SEC = 'section[aria-roledescription="carousel"]', MOVE = /^translateX\((-?[\d.]+)%\)$/
    var RESIST = 0.35, NAV_PX = 48, FADE_MS = 480
    var calm = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null
    var last = typeof WeakMap === 'function' ? new WeakMap() : null
    function trackOf(sec) { var c = sec.children; for (var i = 0; i < c.length; i++) if (c[i].hasAttribute && c[i].hasAttribute('aria-live')) return c[i]; return null }
    function pct(track) { var m = MOVE.exec(track.style.transform || ''); return m ? parseFloat(m[1]) : null }
    function index(track) { for (var i = 0; i < track.children.length; i++) if (track.children[i].getAttribute('aria-hidden') === 'false') return i; return 0 }

    // the slide that has just become current is marked for 1.5 s: its photo settles (HERO FEEL 1119 [hf-3]); never at page load
    function arrive(track) {
      var s = track.children[index(track)]
      if (!s) return
      var old = track.querySelectorAll('[data-sporta-arrive]'); for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-sporta-arrive')
      s.setAttribute('data-sporta-arrive', '')
      setTimeout(function () { s.removeAttribute('data-sporta-arrive') }, 1500)
    }

    // ---- jumps of two or more slides: a dissolve ------------------------------------------------------------------
    function jumped(track) {
      var now = pct(track), was = last.get(track)
      if (now === null) return
      last.set(track, now)
      if (was === undefined || was === null || calm() || document.hidden) return
      if (now !== was) arrive(track)
      if (Math.abs(now - was) / 100 < 1.5) return
      track.style.transition = 'none'
      var done = function () { track.style.transition = '' }
      try {
        var a = track.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'cubic-bezier(.3,.6,.3,1)' })
        a.onfinish = done; a.oncancel = done
      } catch (e) { done() }
    }

    // ---- the finger ----------------------------------------------------------------------------------------------
    function finger(sec, track) {
      var g = null
      sec.addEventListener('touchstart', function (e) {
        try {
          if (calm() || e.touches.length !== 1 || g) { return }
          var base = pct(track)
          if (base === null) return
          g = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: base, on: false, v: '', i: index(track), n: track.children.length }
        } catch (er) { g = null }
      }, { passive: true })
      sec.addEventListener('touchmove', function (e) {
        try {
          if (!g || e.touches.length !== 1) return
          var dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y
          if (!g.on) {
            if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) { if (Math.abs(dy) > 12) g = null; return }
            g.on = true; track.style.transition = 'none'
          }
          var rtl = (document.documentElement.getAttribute('dir') || '').toLowerCase() === 'rtl'
          var toPrev = rtl ? dx < 0 : dx > 0, toNext = !toPrev
          if ((g.i === 0 && toPrev) || (g.i === g.n - 1 && toNext)) dx *= RESIST
          g.v = 'translateX(calc(' + g.base + '% + ' + dx.toFixed(1) + 'px))'
          track.style.transform = g.v
          if (e.cancelable) e.preventDefault()
        } catch (er) { release(false) }
      }, { passive: false })
      function release(navigates) {
        var s = g; g = null
        if (!s || !s.on) return
        track.style.transition = ''
        var back = 'translateX(' + s.base + '%)'
        if (!navigates) {
          // the build will not move on: ease back from where the finger left the track
          track.style.transition = 'transform .35s cubic-bezier(.2,.7,.2,1)'
          track.style.transform = back
          setTimeout(function () { if (track.style.transform === back) track.style.transition = '' }, 400)
          return
        }
        // the build moves on and writes its own transform; if it does not (a photo that cannot load), put the track back
        setTimeout(function () { if (track.style.transform === s.v) track.style.transform = back }, 900)
      }
      sec.addEventListener('touchend', function (e) {
        try {
          if (!g) return
          var t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y
          release(g.on && !(Math.abs(dx) < NAV_PX || Math.abs(dx) < Math.abs(dy)))
        } catch (er) { g = null }
      }, { passive: true })
      sec.addEventListener('touchcancel', function () { try { release(false) } catch (er) { g = null } }, { passive: true })
    }

    function attach() {
      var secs = document.querySelectorAll(SEC)
      for (var i = 0; i < secs.length; i++) {
        var sec = secs[i], track = trackOf(sec)
        if (!track || (seen && seen.has(track))) continue
        if (seen) seen.add(track)
        if (last) last.set(track, pct(track))
        finger(sec, track)
        new MutationObserver(function (list) { for (var j = 0; j < list.length; j++) { try { jumped(list[j].target) } catch (e) { /* the build's own slide */ } } })
          .observe(track, { attributes: true, attributeFilter: ['style'] })
      }
    }
    var queued = false
    function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { attach() } catch (e) { /* the build's own slider */ } }) }
    new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true })
    attach()
  } catch (e) { /* the build's own slider stays */ }
})()
/* ===== HERO FEEL-1119 - end ===== */
