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
 * No wishlist heart, no quick-add button. Those are the bundle's own
 * stateful controls — product-card interactivity backed by React state and a
 * cart/wishlist schema with no source in this repository — and reimplementing
 * them from outside risks the "two homes disagree" trap this file's own
 * project history is full of. Every card is a plain link to the real product
 * page, where all of that already exists and is tested. Visual language is
 * copied from category.php's own card (`--sp-panel`/`--sp-line`/`--sp-tile`/
 * `--sp-silver`/`--sp-ember`), so a shopper who has already seen one of the
 * category pages sees the same card here rather than a third design.
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

  function money(n) {
    return (Number(n) || 0).toFixed(3)
  }

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
    grid.className = 'sporta-home-products__grid'

    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      var name = (ar ? p.name_ar : p.name_en) || p.slug
      var onSale = !!p.on_sale

      var a = document.createElement('a')
      a.className = 'sporta-home-products__card'
      a.href = '/product/' + encodeURIComponent(p.slug)
      a.setAttribute('aria-label', name)

      var frame = document.createElement('div')
      frame.className = 'sporta-home-products__frame'
      if (p.image) {
        /* Same rule the app's own photoUrl() uses (src/lib/api.ts): an
           absolute URL passes through, everything else is relative to the
           API base — `image` here is always either that shape or null,
           since nothing writes an owner-typed path to `products.image`
           through any panel this shop has. */
        var img = document.createElement('img')
        img.loading = 'lazy'
        img.decoding = 'async'
        img.alt = name
        img.src = /^https?:\/\//i.test(p.image)
          ? p.image
          : api + '/' + String(p.image).replace(/^\.?\//, '')
        frame.appendChild(img)
      }
      a.appendChild(frame)

      var body = document.createElement('div')
      body.className = 'sporta-home-products__body'

      var nameEl = document.createElement('div')
      nameEl.className = 'sporta-home-products__name'
      nameEl.textContent = name
      body.appendChild(nameEl)

      var priceEl = document.createElement('div')
      priceEl.className = 'sporta-home-products__price'
      var b = document.createElement('b')
      b.textContent = money(p.price) + (ar ? ' د.ك' : ' KWD')
      priceEl.appendChild(b)
      if (onSale && p.list_price) {
        var s = document.createElement('s')
        s.textContent = money(p.list_price)
        priceEl.appendChild(s)
      }
      body.appendChild(priceEl)

      a.appendChild(body)
      grid.appendChild(a)
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

    loadProducts(function (list) {
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
