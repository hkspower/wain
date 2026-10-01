/* Sporta — the product banner on the home page, above "Shop by category".
 *
 * Asked for on 2026-10-01; out of three rendered options the owner chose ONE
 * PRODUCT BANNER: a product's photograph on one side, a headline and a Shop
 * button on the other. It is edited in /backends (assets/home-banner-editor.js)
 * and read from api.php?r=home_banner, which answers {"banner": null} whenever
 * there is nothing to draw — switched off, the table not created yet, a product
 * taken off sale. Then this draws nothing, and removes anything it drew.
 *
 * Built with DOM calls and text nodes only (test:xss-guard): every word is the
 * owner's, and the link is a path the server has already refused to let leave
 * the shop.
 *
 * WHERE: between the hero and the "Shop by category" section, found by its tiles
 * (the same anchor home-products.js uses). The bundle re-renders the home page
 * on navigation, so the banner is put back after any render that removed it, and
 * rebuilt if the language changed underneath it.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-home-banner'
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var NO_PHOTO = '/assets/no-photo.svg'

  function lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en' }
  function isHome() { return location.pathname === '/' }
  function catSection() {
    var tile = document.querySelector('.cat-tile')
    return tile ? tile.closest('section') : null
  }
  function remove() {
    var old = document.querySelector('[' + MARK + ']')
    if (old && old.parentNode) old.parentNode.removeChild(old)
  }

  /* The shop's own price format (the bundle's formatter): "KWD 8.000" / "‏8.000 د.ك.‏". */
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

  /* The server hands out paths relative to the API ("api.php?r=…"). A full URL,
     a site path, and the panel preview's data: picture are used as they are. */
  function src(image) {
    if (!image) return NO_PHOTO
    var s = String(image)
    return /^(https?:|data:image\/)/i.test(s) || s.charAt(0) === '/' ? s : api + '/' + s.replace(/^\.\//, '')
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function build(b, l) {
    var ar = l === 'ar'
    var section = el('section', 'sporta-home-banner')
    section.setAttribute(MARK, l)

    var link = el('a', 'sporta-home-banner__link')
    link.href = String(b.href || '/shop')

    var media = el('span', 'sporta-home-banner__media')
    var img = document.createElement('img')
    img.alt = ''                      // the headline beside it is the link's words
    img.decoding = 'async'
    img.src = src(b.image)
    if (!b.image) media.className += ' sporta-home-banner__media--none'
    media.appendChild(img)
    link.appendChild(media)

    var body = el('span', 'sporta-home-banner__body')
    var kicker = (b.kicker && b.kicker[l]) || ''
    if (kicker) body.appendChild(el('span', 'sporta-home-banner__kicker', kicker))
    body.appendChild(el('span', 'sporta-home-banner__title', (b.title && b.title[l]) || ''))
    if (b.price != null) {
      var price = el('span', 'sporta-home-banner__price')
      price.appendChild(el('b', null, money(b.price, ar)))
      if (b.on_sale && b.list_price != null) price.appendChild(el('s', null, money(b.list_price, ar)))
      body.appendChild(price)
    }
    body.appendChild(el('span', 'sporta-home-banner__cta', (b.button && b.button[l]) || (ar ? 'تسوّق الآن' : 'Shop now')))
    link.appendChild(body)

    section.appendChild(link)
    return section
  }

  var banner              // undefined: not asked yet; null: nothing to draw
  var asked = false
  function load(cb) {
    if (banner !== undefined) { cb(banner); return }
    if (asked) return
    asked = true
    fetch(api + '/api.php?r=home_banner', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) { banner = (d && d.banner) || null; cb(banner) })
      .catch(function () { banner = null; cb(null) })
  }

  function place() {
    if (!isHome()) { remove(); return }
    if (!catSection()) return
    load(function (b) {
      if (!isHome()) return
      var cats = catSection()
      if (!b) { remove(); return }
      if (!cats || !cats.parentNode) return
      var l = lang()
      var current = document.querySelector('[' + MARK + ']')
      if (current && current.getAttribute(MARK) === l && current.nextElementSibling === cats) return
      if (current) remove()
      cats.parentNode.insertBefore(build(b, l), cats)
    })
  }

  /* The /backends editor previews the banner with THIS drawing rather than a
     copy of it, so what the owner sees before saving is what the shop draws.
     Unmarked: place() removes anything carrying MARK off the home page, and the
     panel is off the home page. */
  window.sportaHomeBanner = {
    preview: function (b, l) { var s = build(b, l); s.removeAttribute(MARK); return s },
  }

  /* Throttled to a frame, never debounced: the hero's carousel mutates the page
     continuously, and a debounce would never fire. */
  var queued = false
  new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; place() })
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] })   // lang is on <html>
  place()
})()
