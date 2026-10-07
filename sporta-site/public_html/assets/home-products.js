/* Sporta — a product grid on the home page, right under "Shop by category".
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-22: "add new product at main page under category".
 * Measured first: the home page had no product grid at all — hero, the four
 * category tiles, then straight to the footer sections. The Expo APP already
 * has one (`(tabs)/index.tsx`, `featured = products.filter(p => p.featured)
 * .slice(0, 4)`, labelled `t.home.featured`) — this is the app-only-drift
 * pattern CLAUDE.md records at length, in the other direction this time: a
 * screen that exists on the app and never reached the website.
 *
 * ONE MECHANISM, NOT A NEW ONE. `?r=products` already returns `featured` and
 * `featured_sort` for every active product, and `product_save` in admin.php
 * already writes them — the SAME field the app reads. Reusing it rather than
 * inventing a second "what shows on the home page" concept means an owner who
 * marks a product Featured in /backends changes both the app and the site
 * from one place, which is the whole argument this file's own history makes
 * against a second home for one piece of data.
 *
 * NO PRODUCT IS FEATURED YET. Checked live and in the sandbox: 0 of the
 * active catalogue carries `featured`. A heading over an empty grid would be
 * worse than no section — same call brand-strip.js already made for brands
 * with no logo — so until the owner marks some, this shows the first 8
 * products the catalogue already returns (alphabetical by name, the API's own
 * order) rather than rendering nothing. The moment featured rows exist this
 * switches to them automatically, sorted by `featured_sort`, and the
 * fallback never runs again.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * Right after the section that holds ".cat-tile" — found structurally
 * (`closest('section')` off the first tile) rather than by position among
 * main's children, the same reasoning brand-strip.js gives for keying off the
 * hero's `aria-roledescription` rather than "the second section on the page".
 *
 * ----------------------------------------------------------------- MARKUP
 *
 * THE /shop CARD, since 2026-10-01 (see build()). The wishlist heart writes the
 * bundle's own `sporta_wishlist` (card-heart.js) and tells the bundle through a
 * `storage` event, so there is still ONE wishlist; quick-add-size.js adds the + exactly as it does
 * on /shop. Until then this grid was its own third card design, with the + on
 * the photo, no heart, a plain box for a missing photo and "8.000 KWD".
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * brand-strip.js and tile-art.js. If the category-tiles section cannot be
 * found (a different page, a bundle change), nothing is inserted — this can
 * only ever ADD a section, never touch an existing one. Same throttle
 * (queued flag + requestAnimationFrame, not a debounce) as brand-strip.js,
 * for the same reason: the hero's auto-advance mutates continuously and a
 * debounce waiting for quiet never fires past the first call.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-home-products'
  var MAX = 8

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  function isHome() {
    return location.pathname === '/'
  }

  function findCatSection() {
    var tile = document.querySelector('.cat-tile')
    if (!tile) return null
    return tile.closest('section')
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var picked = null   /* null = not fetched yet; [] = fetched, nothing to show */
  var fetching = false

  function pickList(rows) {
    var featured = rows.filter(function (p) { return p && p.featured }).sort(function (a, b) {
      return (Number(a.featured_sort) || 0) - (Number(b.featured_sort) || 0)
    })
    var list = featured.length ? featured : rows.filter(function (p) { return p && p.slug })
    return list.slice(0, MAX)
  }

  function loadProducts(cb) {
    if (picked !== null) { cb(picked); return }
    if (fetching) return
    fetching = true
    fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (rows) {
        picked = pickList(Array.isArray(rows) ? rows : [])
        cb(picked)
      })
      .catch(function () { picked = []; cb(picked) })
  }

  /* THE SHOP'S OWN PRICE FORMAT, the bundle's formatter verbatim (index-*.js):
     en-KW / ar-KW currency, three decimals, Latin digits — "KWD 8.000" and
     "‏8.000 د.ك.‏". This grid used to print "8.000 KWD", so the same product
     carried two prices in two styles on two pages. */
  var fmt = {}
  function money(n, ar) {
    var k = ar ? 'ar' : 'en'
    if (!fmt[k]) {
      try {
        fmt[k] = new Intl.NumberFormat(ar ? 'ar-KW' : 'en-KW', { style: 'currency', currency: 'KWD',
          minimumFractionDigits: 3, maximumFractionDigits: 3, numberingSystem: 'latn' })
      } catch (e) { fmt[k] = { format: function (v) { return (ar ? '' : 'KWD ') + v.toFixed(3) + (ar ? ' د.ك.' : '') } } }
    }
    return fmt[k].format(Number(n) || 0)
  }

  /* The heart is the bundle's own button, drawn here and run by card-heart.js,
     which writes the bundle's own wishlist (see that file). */
  var HEART_BASE = 'absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full ' +
    'bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 '
  /* The bundle's heart icon, built node by node: this file sets no innerHTML but an
     empty clear (test:xss-guard), and a constant is no reason to start. */
  var SVG_NS = 'http://www.w3.org/2000/svg'
  var HEART_PATH = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 ' +
    '5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'
  function heartIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg')
    var attrs = { width: '17', height: '17', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2.47', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }
    for (var k in attrs) svg.setAttribute(k, attrs[k])
    var path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', HEART_PATH)
    svg.appendChild(path)
    return svg
  }
  /* The bundle's own "no photo" image: 41-no-photo.css swaps exactly this kind of
     data: SVG for the Sporta placeholder, so the empty card looks like /shop's. */
  var NO_PHOTO = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22600%22%20' +
    'height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23171A1E%22%2F%3E%3C%2Fsvg%3E'

  /* ONE CARD EVERYWHERE, 2026-10-01 — the owner's choice out of three ("the /shop
   * card"). This builds the bundle's /shop card markup class for class (grid,
   * article, 4:5 photo link, wishlist heart, caption, price line), so every rule
   * that draws the /shop card draws this one too: the + beside the price, the
   * heart, the logo placeholder, the brand line (brand-badge.js), the colour circles
   * and size boxes (card-options.js), the sale chip (card-badges.js) and quick-add
   * (quick-add-size.js). The old
   * sporta-home-products__card/__frame names stay as hooks only. No "Bestseller"
   * pill: in a section titled Best sellers every card would carry it. */
  function build(list) {
    var ar = lang() === 'ar'
    var section = document.createElement('section')
    section.setAttribute(MARK, '1')
    section.className = 'sporta-home-products'

    var h2 = document.createElement('h2')
    h2.className = 'sporta-home-products__heading'
    h2.textContent = ar ? 'الأكثر مبيعاً' : 'Best sellers'
    section.appendChild(h2)

    var grid = document.createElement('div')
    grid.className = 'grid grid-cols-2 gap-x-2 gap-y-10 sm:gap-x-3 md:grid-cols-3 lg:grid-cols-4 sporta-home-products__grid'

    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      var name = (ar ? p.name_ar : p.name_en) || p.slug
      var href = '/product/' + encodeURIComponent(p.slug)

      var art = document.createElement('article')
      art.className = 'group flex flex-col sporta-home-products__card'

      var a = document.createElement('a')
      a.className = 'relative block aspect-[4/5] overflow-hidden bg-slate-100 sporta-home-products__frame'
      a.href = href
      a.setAttribute('aria-label', name)

      var img = document.createElement('img')
      img.alt = name
      img.loading = 'lazy'
      img.decoding = 'async'
      img.width = 600
      img.height = 750
      img.className = 'h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]'
      if (p.image) {
        /* Same rule the app's own photoUrl() uses (src/lib/api.ts): an absolute URL
           passes through, everything else is relative to the API base. */
        img.src = /^https?:\/\//i.test(p.image) ? p.image : api + '/' + String(p.image).replace(/^\.?\//, '')
        /* A product photograph is a 2000px original: ask for the sized copies the shop
           already makes (product-cards.js does the same for /shop). */
        if (img.src.indexOf('product_image') !== -1 && !/[?&]w=\d+/.test(img.src)) {
          var base = img.src
          img.srcset = base + '&w=400&q=2 400w, ' + base + '&w=600&q=2 600w, ' + base + '&w=800&q=2 800w'
          img.sizes = '(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw'
          img.src = base + '&w=400&q=2'
        }
      } else {
        img.src = NO_PHOTO
      }
      a.appendChild(img)

      var heart = document.createElement('button')
      heart.type = 'button'
      heart.setAttribute('aria-label', ar ? 'أضف إلى المفضلة' : 'Save to wishlist')
      heart.setAttribute('data-sporta-heart', p.slug)
      heart.appendChild(heartIcon())
      heart.className = HEART_BASE + 'text-slate-600 lg:opacity-0 lg:group-hover:opacity-100'
      heart.setAttribute('aria-pressed', 'false')   /* card-heart.js paints the saved state */
      a.appendChild(heart)
      art.appendChild(a)

      var body = document.createElement('div')
      body.className = 'flex flex-col gap-1 pt-3'
      var nameLink = document.createElement('a')
      nameLink.className = '-my-1.5 py-1.5 transition group-hover:text-accent'
      nameLink.href = href
      var h3 = document.createElement('h3')
      h3.className = 'line-clamp-1 text-sm font-medium text-slate-900'
      h3.textContent = name
      nameLink.appendChild(h3)
      body.appendChild(nameLink)

      var price = document.createElement('span')
      price.className = 'price-card flex items-baseline gap-2 text-sm font-semibold tabular-nums'
      price.appendChild(document.createTextNode(money(p.price, ar)))
      if (p.on_sale && p.list_price) {
        var s = document.createElement('s')
        s.className = 'text-xs font-normal text-slate-400'
        s.textContent = money(p.list_price, ar)
        price.appendChild(s)
      }
      body.appendChild(price)
      art.appendChild(body)
      grid.appendChild(art)
    }

    section.appendChild(grid)
    return section
  }

  function place() {
    if (!isHome()) {
      var stray = document.querySelector('[' + MARK + ']')
      if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
      return
    }

    var catSection = findCatSection()
    if (!catSection || !catSection.parentNode) return

    /* SKELETON, 2026-10-07: while ?r=products is in flight, four grey cards hold
       the section's place so the page does not jump when the real ones arrive. */
    if (picked === null && !document.querySelector('[' + MARK + ']')) {
      var sk = document.createElement('section')
      sk.setAttribute(MARK, 'skeleton')
      sk.className = 'sporta-home-products sporta-skel'
      sk.setAttribute('aria-busy', 'true')
      var sg = document.createElement('div')
      sg.className = 'grid grid-cols-2 gap-x-2 gap-y-10 sm:gap-x-3 md:grid-cols-3 lg:grid-cols-4 sporta-home-products__grid'
      for (var k = 0; k < 4; k++) {
        var c = document.createElement('div')
        c.className = 'sporta-skel__card'
        ;['sporta-skel__photo', 'sporta-skel__line', 'sporta-skel__line sporta-skel__line--short'].forEach(function (cls) {
          var d = document.createElement('div')
          d.className = 'skeleton ' + cls
          c.appendChild(d)
        })
        sg.appendChild(c)
      }
      sk.appendChild(sg)
      catSection.parentNode.insertBefore(sk, catSection.nextSibling)
    }

    loadProducts(function (list) {
      var skel = document.querySelector('[' + MARK + '="skeleton"]')
      if (skel && skel.parentNode) skel.parentNode.removeChild(skel)
      if (!isHome()) return               /* navigated away while fetching */
      var catSection2 = findCatSection()
      if (!catSection2 || !catSection2.parentNode) return

      if (!list.length) {
        var stray = document.querySelector('[' + MARK + ']')
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
        return
      }

      var current = document.querySelector('[' + MARK + ']')
      if (current) {
        /* Already placed — nothing language-dependent to redo on a mutation. */
        return
      }

      var section = build(list)
      catSection2.parentNode.insertBefore(section, catSection2.nextSibling)
    })
  }

  var queued = false
  var observer = new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      place()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
