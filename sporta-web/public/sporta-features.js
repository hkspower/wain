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
 *   - the "no photo" plate: the stage showing it no longer opens a viewer (nor the hover lens) and is marked
 *     aria-disabled, the zoom badge is hidden; a photo that fails inside the viewer (the build swaps in the plate) cannot
 *     be zoomed.
 * Only attributes are written on the build's elements (data-sporta-*, aria-*, inline transform on the lightbox photo);
 * the added controls are appended last inside the lightbox, so React's own children keep their places. Moving between
 * photos goes through the build's own keyboard handler (a synthetic arrow key on document), closing through its X, so
 * the gallery, the counter and the photo stay React's. No request, no src written, nothing on /backends. Leading ";"
 * because this file is several IIFEs back to back. */
;(function () {
  'use strict'
  try {
    if (location.pathname.indexOf('/backends') === 0) return
    if (!window.MutationObserver || window.__sportaImageViewer) return
    window.__sportaImageViewer = 1
    var BOX = '.catalog-product-lightbox', STAGE = '.catalog-gallery-stage'
    var PLATE = /product-photo-unavailable/
    var MAX = 4, DBL = 2.5
    var TXT = {
      en: { prev: 'Previous photo', next: 'Next photo', zin: 'Zoom in', zout: 'Zoom out',
        hint: 'Full-screen photo. To zoom, pinch, double-tap or press + and -; drag a zoomed photo to move it. Swipe sideways or use the arrow keys for the other photos. Swipe down or press Escape to close.' },
      ar: { prev: 'الصورة السابقة', next: 'الصورة التالية', zin: 'تكبير', zout: 'تصغير',
        hint: 'صورة بملء الشاشة. للتكبير باعد بين إصبعين أو انقر مرتين أو اضغط + أو -، واسحب الصورة المكبّرة لتحريكها. للصور الأخرى اسحب جانبًا أو استخدم مفاتيح الأسهم. للإغلاق اسحب إلى الأسفل أو اضغط Escape.' }
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
    }
    var bound = function () {
      var w = V.img.offsetWidth * V.s, h = V.img.offsetHeight * V.s
      var mx = Math.max(0, (w - V.box.clientWidth) / 2), my = Math.max(0, (h - V.box.clientHeight) / 2)
      V.x = clamp(V.x, -mx, mx); V.y = clamp(V.y, -my, my)
    }
    // zoom to scale ns keeping the screen point (px, py) still; the photo is centred in the box
    var zoomAt = function (ns, px, py, anim) {
      if (!V || plateIn()) return
      var r = V.box.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
      if (px == null) { px = cx; py = cy }
      ns = clamp(ns, 1, MAX)
      var lx = (px - cx - V.x) / V.s, ly = (py - cy - V.y) / V.s
      V.x = px - cx - ns * lx; V.y = py - cy - ns * ly; V.s = ns
      if (ns === 1) { V.x = 0; V.y = 0 }
      bound(); apply(anim)
    }
    var reset = function (anim) { if (!V) return; V.s = 1; V.x = 0; V.y = 0; V.box.style.removeProperty('background-color'); apply(anim) }
    var loading = function () {
      if (!V) return
      if (V.img.complete && V.img.naturalWidth) V.box.removeAttribute('data-sporta-loading'); else if (!V.img.complete) V.box.setAttribute('data-sporta-loading', '1'); else V.box.removeAttribute('data-sporta-loading')
      if (plateIn()) { V.box.setAttribute('data-sporta-plate', '1'); reset(false) } else V.box.removeAttribute('data-sporta-plate')
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

    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
    var two = function () { var k = Object.keys(P); return [P[k[0]], P[k[1]]] }
    var down = function (e) {
      if (!V || !V.box.contains(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
      if (e.target.closest('button')) return
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
      if (V.s > 1.01) { g.mode = 'pan'; V.x = g.x0 + dx; V.y = g.y0 + dy; bound(); apply(false); return }
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
      zoomAt(V.s * Math.exp(-clamp(e.deltaY, -120, 120) * 0.0025), e.clientX, e.clientY, false)
    }
    var keys = function (e) {
      if (!V || e.__sportaViewer || !V.box.isConnected) return
      var k = e.key
      if ((k === 'ArrowLeft' || k === 'ArrowRight') && rtl()) {
        // the build's lightbox reads ArrowRight as "next" in both languages; in Arabic the next photo is to the left
        e.stopPropagation(); e.preventDefault()
        go(k === 'ArrowLeft' ? 1 : -1)
      } else if (k === '+' || k === '=') { e.preventDefault(); zoomAt(V.s * 1.5, null, null, true) }
      else if (k === '-' || k === '_') { e.preventDefault(); zoomAt(V.s / 1.5, null, null, true) }
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
      html.setAttribute('data-sporta-viewer-lock', lastGap > 0 ? 'gutter' : '1')
      V.mo = new MutationObserver(function () { if (!V) return; reset(false); loading(); counter() })
      V.mo.observe(img, { attributes: true, attributeFilter: ['src'] })
      img.addEventListener('load', loading); img.addEventListener('error', loading)
      box.addEventListener('wheel', wheel, { passive: false })
      loading(); counter()
    }
    var closed = function () {
      if (!V) return
      V.mo.disconnect()
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

/* Product names: the full name as a tooltip (2026-11-11, owner: "improve product names").
 * A card name is clamped to two lines by sporta-shadows.css (NAMES-1111); the whole name stays in the markup and is
 * copied into `title` here, on cards and on the product page heading, so a long name can be read in full by hover or
 * long-press. The accessible name is untouched (the link already reads the whole text). Only `title` is written, never
 * a child node, so React is not disturbed and the observer (child list only) does not wake itself. Leading ";" because
 * this file is several IIFEs back to back. */
;(function () {
  'use strict'
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
})()
/* ===== SHIPPING - end ===================================================== */
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
})()
/* ===== MOBILE-1112 - end ==================================================== */
