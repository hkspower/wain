/**
 * Sporta — "This item cannot be exchanged" on the product page, from the SERVER's answer. 2026-10-08.
 *
 * ------------------------------------------------------------------ WHY
 *
 * The bundle already has this line, its words and its place: a fourth <li> in the delivery-and-returns
 * list, amber, after "Free 14-day returns" (ProductDetail-uh71XAH8.js, `W.noExchange && <li …>`). It
 * never appeared, because `W` is the bundle's BUILT-IN catalogue entry merged with only price, list
 * price, sale flag, brand and images from the API — and the built-in entries carry no `noExchange`, so
 * it is undefined for every product the bundle knows. Measured on the sandbox: 0 of the 19 women's
 * pages showed it, while `?r=products` says `no_exchange: true` for all 19 and store_return_lookup()
 * refuses their exchange. A customer first learned the rule when the exchange was refused.
 *
 * ONE POLICY, ONE ANSWER. `no_exchange` on `?r=products` is computed by api.php from the same rule
 * store_return_lookup() and the size adviser use (`category === 'women'`, see CLAUDE.md "One policy,
 * two definitions"). This file asks THAT field and nothing else — never the category, never the words
 * on the page — so if the rule changes on the server, the line follows it without an edit here.
 *
 * ------------------------------------------------------------------ HOW
 *
 *  - Every pass reads the CURRENT path and language. The shop changes product without reloading
 *    ("Complete the look", the colour buttons) and changes language without reloading, so a line
 *    decided once at load would be wrong on the next product (a women's line left on a jacket — the
 *    2026-09-11 fault in reverse) and in the wrong language after the toggle.
 *  - The line is appended INSIDE React's <ul>, as its LAST <li>. Not as a sibling after it: on a phone
 *    product-mobile-layout.js gives each block of that column an explicit flex `order`, and an
 *    unordered sibling gets order 0 and paints ABOVE the product name (measured, 746 vs 766) — the
 *    2026-09-29 `order: 3.5` fault again. React never walks the list's DOM children; its own later
 *    inserts go after ours, and if the bundle ever draws its OWN amber line (a product it does not
 *    know), this file sees it by class and removes its copy, so the line is never there twice.
 *  - The words are the bundle's own trust.noExchange, each in a text node of its own, so site-text.js
 *    swaps them for the owner's wording exactly as it swaps the bundle's. This file never compares the
 *    words on the page, so an owner's rewording cannot make it draw a second line.
 *  - Writes nothing when the line is already right (no idle insertions: test:scroll-jank).
 *  - Fails closed: no answer from the server, a product missing from it, or `no_exchange` not exactly
 *    true means no line — which is the page as it was before this file.
 *
 * The two sentences are assigned one per line on purpose: the Site wording catalogue already lists
 * them as trust.noExchange, and scripts/make-overlay-strings.mjs would harvest an `en:'…', ar:'…'`
 * pair here as a second, duplicate entry for the same text.
 *
 * Storefront only (data-shop in index.html). Not on category pages: they draw no product page.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-noex'
  var TXT = {}
  TXT.en = 'This item cannot be exchanged'
  TXT.ar = 'هذا المنتج غير قابل للاستبدال'

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var bySlug = null        /* slug -> true when the server says it cannot be exchanged; null = not known yet */
  var loading = false
  var failedFor = null     /* the path a failed request was for: retried only on another product */

  function slug() {
    var m = /^\/product\/([^/?#]+)/.exec(location.pathname)
    if (!m) return null
    try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
  }

  function lang() { return document.documentElement && document.documentElement.lang === 'ar' ? 'ar' : 'en' }

  function load(s) {
    if (loading || bySlug || failedFor === s) return
    loading = true
    /* The same URL and init shape as the bundle's and card-options.js's request, so api-dedupe.js
       answers all of them from one network request. */
    fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        loading = false
        var a = j && (Array.isArray(j) ? j : j.products)
        if (!Array.isArray(a)) { failedFor = s; return }
        var map = {}
        for (var i = 0; i < a.length; i++) if (a[i] && a[i].slug) map[a[i].slug] = a[i].no_exchange === true
        bySlug = map
        run()
      })
      .catch(function () { loading = false; failedFor = s })
  }

  function run() {
    var s = slug()
    var mine = document.querySelectorAll('[' + MARK + ']')
    if (!s && !mine.length) return
    if (s && !bySlug) load(s)

    var h1 = s ? document.querySelector('h1.product-title') : null
    var col = h1 && h1.parentElement && h1.parentElement.parentElement
    var ul = col ? col.querySelector(':scope > ul') : null
    var native = false
    if (ul) {
      for (var c = 0; c < ul.children.length; c++) {
        var li0 = ul.children[c]
        if (!li0.hasAttribute(MARK) && /(^|\s)text-amber-700(\s|$)/.test(li0.className)) { native = true; break }
      }
    }
    var want = !!(ul && bySlug && bySlug[s] === true && !native)
    var L = lang()

    for (var i = 0; i < mine.length; i++) {
      var el = mine[i]
      var keep = want && el.parentNode === ul && el.getAttribute('data-slug') === s &&
                 el.getAttribute('data-lang') === L && ul.lastElementChild === el
      if (!keep) { if (el.parentNode) el.parentNode.removeChild(el) }
      else want = false               /* already right: write nothing */
    }
    if (!want) return

    var base = ul.lastElementChild    /* the bundle's "Free 14-day returns" line: same icon as its own amber line */
    var li = document.createElement('li')
    li.setAttribute(MARK, '')
    li.setAttribute('data-slug', s)
    li.setAttribute('data-lang', L)
    li.className = 'flex items-center gap-3 font-semibold text-amber-700'
    var svg = base && base.querySelector('svg')
    if (svg) {
      svg = svg.cloneNode(true)
      svg.setAttribute('class', (svg.getAttribute('class') || '').replace(/(^|\s)text-brand(\s|$)/, '$1text-amber-700$2'))
      li.appendChild(svg)
    }
    li.appendChild(document.createTextNode(' '))
    li.appendChild(document.createTextNode(TXT[L]))   /* its own node, so site-text.js can swap it */
    ul.appendChild(li)                               /* INSIDE the list: see the header */
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; run() })
  }

  /* `document`, not `document.documentElement`: the latter can be null if this ever runs before the
     page is parsed, and observe() then throws and nothing at all is watched (CLAUDE.md, the image
     rig's third wrong instrument). `lang` is watched so the language toggle redraws the line. */
  new MutationObserver(schedule).observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['lang'],
  })
  window.addEventListener('popstate', schedule)
  run()
})()
