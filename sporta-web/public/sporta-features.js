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
    truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    'return': '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4.5"/>'
  }
  var WA_MARK = '<path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/>'

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
      '.sf__eyebrow{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.2em;color:#ff8f3d}' +
      '.sf__rule{display:block;width:80px;height:2px;background:#ff7b17}' +
      '.sf__title{margin:0;font-weight:800;font-size:clamp(32px,4.2vw,56px);line-height:1.15;color:#f2f2f0}' +
      '.sf__sub{margin:0;font-size:16px;line-height:26px;color:#9b9ca1}' +
      '.sf__cta{display:flex;flex-wrap:wrap;gap:12px}' +
      '.sf__btn{min-height:48px;padding:12px 24px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:10px;font-size:16px;font-weight:700;text-decoration:none;transition:background-color .15s,border-color .15s}' +
      '.sf__btn--shop{background:#ff7b17;color:#000}.sf__btn--shop:hover{background:#ff9545;color:#000}' +
      '.sf__btn--wa{border:1px solid #3a3b40;color:#f2f2f0;font-weight:600}.sf__btn--wa:hover{border-color:#9b9ca1;color:#fff}' +
      '.sf__btn:focus-visible{outline:2px solid #ff8f3d;outline-offset:2px}' +
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

  function svg(paths, size, stroke) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none"' +
      (stroke ? ' stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : '') +
      ' aria-hidden="true" focusable="false">' + paths + '</svg>'
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }

  function build() {
    var L = lang(), t = T[L], ar = L === 'ar'
    var sec = document.createElement('section')
    sec.id = ID
    sec.className = 'sf'
    sec.setAttribute('dir', ar ? 'rtl' : 'ltr')
    sec.setAttribute('lang', L)
    sec.setAttribute('data-lang', L)
    sec.setAttribute('aria-labelledby', ID + '-title')
    var arrow = ar ? '<path d="M15 6l-6 6 6 6"/>' : '<path d="M9 6l6 6-6 6"/>'
    var cards = t.items.map(function (it) {
      return '<li class="sf__card"><span class="sf__icon">' + svg(ICON[it[0]], 26, true) + '</span>' +
        '<h3>' + esc(it[1]) + '</h3><p>' + esc(it[2]) + '</p></li>'
    }).join('')
    sec.innerHTML =
      '<div class="sf__in">' +
        '<div class="sf__head">' +
          '<div class="sf__titles">' +
            '<span class="sf__eyebrow" dir="ltr">WHY SPORTA</span>' +
            '<span class="sf__rule" aria-hidden="true"></span>' +
            '<h2 class="sf__title" id="' + ID + '-title">' + esc(t.title) + '</h2>' +
            '<span class="sf__rule" aria-hidden="true"></span>' +
            '<p class="sf__sub">' + esc(t.sub) + '</p>' +
          '</div>' +
          '<div class="sf__cta">' +
            '<a class="sf__btn sf__btn--shop" href="/shop' + (ar ? '' : '?lang=en') + '">' + esc(t.shop) + svg(arrow, 18, true) + '</a>' +
            '<a class="sf__btn sf__btn--wa" href="https://wa.me/96522091914" target="_blank" rel="noopener">' + svg(WA_MARK, 20, false) + esc(t.wa) + '</a>' +
          '</div>' +
        '</div>' +
        '<ul class="sf__grid">' + cards + '</ul>' +
      '</div>'
    return sec
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
      'justify-content:center;min-height:44px;padding:10px 20px;border-radius:999px;background:#e0561c;color:#171a1e;' +
      'font-size:14px;line-height:20px;font-weight:800;text-decoration:none;white-space:nowrap',
      n === 0 ? t.browse : t.all)
    a.href = shopHref('')
    a.setAttribute('data-sporta-brand-clear', '')
    sec.appendChild(a)
    return sec
  }

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
    restoreTitle()
  }
  function mountBanner() {
    var slug = wantedSlug()
    if (!slug) { dropBanner(); return }
    if (!rows) { load(); return }
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
    quiet(function () {
      for (var w = 0; w < writes.length; w++) {
        var x = writes[w]
        if (x[3] === 'jsonld') x[0].textContent = x[1]
        else if (x[0]) x[0].nodeValue = x[1]
        x[2].setAttribute(ABOUT_ATTR, x[3] === 'jsonld' ? 'ld' : x[3])
      }
    })
  }

  function run() {
    try { mountBanner() } catch (e) {}
    try { mountPlates() } catch (e) {}
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
    var addedUntil = 0
    function sync() {
      var row = document.querySelector('.catalog-product-page .product-purchase-row')
      if (!row) return
      var add = row.querySelector('.btn-primary')
      if (!add) return
      var inline = row.querySelector('.product-buy-now-inline')
      var barBtn = document.querySelector('.catalog-product-page .action-bar > .btn')
      var t = tx(), state = ''
      // while the "added" answer shows, the Add button keeps it (sync() runs again when it ends); the other two buttons follow the truth at once
      var showing = Date.now() < addedUntil
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
      var hd = document.querySelector('.app-header')
      if (hd) toast.style.setProperty('--sporta-u3-top', Math.round(Math.max(0, hd.getBoundingClientRect().bottom) + 12) + 'px')
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
        addedUntil = Date.now() + 1600
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
