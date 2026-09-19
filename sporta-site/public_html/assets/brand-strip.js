/* Sporta — a row of brand logos on the home page, directly under the hero.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-16: "under heros make brands logos with images". The
 * shop already shows a brand's logo on its product page and, since
 * brand-badge.js, on every card in the grid — both read from the SAME data
 * the server already sends. This is the third place, and the first one on
 * the home page: a strip introducing the brands the shop carries, right
 * below the hero carousel and above the "Summer Offers" promo band.
 *
 * NOTHING NEW IS ASKED OF THE SERVER. ?r=brands already returns, for every
 * ACTIVE brand, whether it has a logo (`has_logo`) and a content hash
 * (`logo_v`) that makes ?r=brand_logo cacheable for a year — the same pair
 * brand-badge.js reads off ?r=products. This file makes one request the
 * brands dropdown (if the bundle has one) may already be making.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * The hero is `<section aria-roledescription="carousel">` — that attribute
 * NAME is a fixed ARIA vocabulary term and, measured in both languages, its
 * VALUE stays the literal string "carousel" in Arabic too ("أبرز العروض" is
 * the aria-LABEL, not the roledescription). So it is a stable selector
 * across both languages, unlike an aria-label that is translated. The strip
 * is inserted as a new <section>, a sibling right after it — never inside
 * it, and never touching anything the carousel already renders.
 *
 * ----------------------------------------------------------- WHAT IT SKIPS
 *
 * A brand with no logo. `has_logo` is the server's own answer, already
 * accounting for a logo dropped into images/<slug>/ as well as one stored in
 * the database — brand-badge.js already established that this is the field
 * to trust rather than re-deriving it. If NO active brand has a logo, this
 * inserts NOTHING: a heading over an empty row would be worse than no
 * section at all. As of 2026-09-05 the live shop has 0 of 8 brand logos, so
 * this renders nothing there today, which is correct and is also why it
 * cannot be verified by looking at the live site as it stands.
 *
 * A brand whose logo request 404s after the row is built: the one tile is
 * removed rather than left as an empty box, same handling as brand-badge.js.
 *
 * ------------------------------------------------------------------- MARKUP
 *
 * The heading reuses the EXACT classes "Shop by category" already uses two
 * sections down (`text-2xl font-extrabold text-slate-900 md:mb-7 md:text-3xl`)
 * — a font size and colour this page has already settled on, not a new
 * design decision. The row itself is plain: flex, wrap, centered, each logo
 * at a fixed height with object-contain — the same treatment brand-badge.js
 * already gives a logo, just larger because this is the home page rather
 * than a card. No colour filter, no hover treatment: nothing here was asked
 * for beyond showing the images, and "do not redesign without approval"
 * applies to invented flourishes as much as to unrequested changes.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * contact.js, tile-art.js and nav-menu.js. If the hero section cannot be
 * found (a different page, a bundle change), nothing is inserted — this can
 * only ever ADD a section, never touch an existing one.
 *
 * ------------------------------------------------------------- A THROTTLE,
 * ------------------------------------------------------------- NOT A DEBOUNCE
 *
 * nav-menu.js's own pattern — clearTimeout+setTimeout on every mutation —
 * was tried here first and never ran a second time. Measured: the hero
 * carousel mutates continuously (the auto-advance), faster than the 80ms the
 * debounce waited for a quiet gap, so the timer was cleared and reset on
 * every tick and place() past the very first call never fired again. A
 * debounce assumes mutations eventually stop; this page's hero never does.
 * The fix is brand-badge.js's own pattern instead: a queued flag plus
 * requestAnimationFrame, which runs at MOST once per frame regardless of how
 * many mutations land in it, rather than waiting for silence that may not
 * come.
 */
;(function () {
  'use strict'

  var LABEL = { ar: 'تسوق حسب الماركة', en: 'Shop by brand' }
  var MARK = 'data-sporta-brand-strip'

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  function isHome() {
    return location.pathname === '/'
  }

  function findHero() {
    var main = document.querySelector('main')
    if (!main) return null
    return main.querySelector('section[aria-roledescription]')
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var brands = null   /* null = not fetched yet; [] = fetched, none usable */
  var fetching = false

  function loadBrands(cb) {
    if (brands !== null) { cb(brands); return }
    if (fetching) return
    fetching = true
    fetch(api + '/api.php?r=brands', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (rows) {
        brands = (rows || []).filter(function (b) { return b && b.slug && Number(b.has_logo) })
        cb(brands)
      })
      .catch(function () { brands = []; cb(brands) })
  }

  function build(list) {
    var ar = lang() === 'ar'
    var section = document.createElement('section')
    section.setAttribute(MARK, '1')
    section.className = 'mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10'

    var row = document.createElement('div')
    row.className = 'flex flex-wrap items-center justify-center gap-4 rounded-lg border-2 border-white bg-white p-6 md:gap-6 md:p-8'

    for (var i = 0; i < list.length; i++) {
      var b = list[i]
      var img = document.createElement('img')
      img.className = 'h-12 w-auto max-w-40 object-contain md:h-16'
      img.setAttribute('loading', 'lazy')
      img.setAttribute('decoding', 'async')
      img.setAttribute('alt', (ar ? b.name_ar : b.name_en) || b.slug)
      img.src = api + '/api.php?r=brand_logo&slug=' + encodeURIComponent(b.slug) +
                (b.logo_v ? '&v=' + encodeURIComponent(b.logo_v) : '')
      ;(function (el) {
        el.onerror = function () { if (el.parentNode) el.parentNode.removeChild(el) }
      })(img)
      row.appendChild(img)
    }

    section.appendChild(row)
    return section
  }

  function place() {
    if (!isHome()) {
      var stray = document.querySelector('[' + MARK + ']')
      if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
      return
    }

    var hero = findHero()
    if (!hero || !hero.parentNode) return

    loadBrands(function (list) {
      if (!isHome()) return               /* navigated away while fetching */
      var hero2 = findHero()
      if (!hero2 || !hero2.parentNode) return

      if (!list.length) {
        var stray = document.querySelector('[' + MARK + ']')
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
        return
      }

      var current = document.querySelector('[' + MARK + ']')
      if (current) {
        /* Already placed — nothing language-dependent. */
        return
      }

      var section = build(list)
      hero2.parentNode.insertBefore(section, hero2.nextSibling)
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
