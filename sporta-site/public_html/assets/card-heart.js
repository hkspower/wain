/* Sporta — the wishlist heart on product cards the bundle does not draw itself:
 * the home page's Best sellers (home-products.js) and the four category pages
 * (category.php). Both draw the /shop card since 2026-10-01 ("one card
 * everywhere", the owner's choice), heart included, and this is what makes that
 * heart work.
 *
 * ONE WISHLIST, NOT TWO. The bundle's WishlistProvider keeps
 * `localStorage.sporta_wishlist` — a JSON array of product slugs — and listens
 * for `storage` events on that key (read from index-*.js, not assumed). So a
 * press here writes the array and then dispatches the event a second tab would
 * have produced: the bundle re-reads it at once, and /wishlist and every /shop
 * heart agree with this one. On the category pages there is no bundle at all;
 * the array is simply there for the next page that has one.
 *
 * Each heart is a `button[data-sporta-heart="<slug>"]` inside the card's photo
 * link, exactly where the bundle puts its own, so the /shop card's CSS
 * (44-product-grid-spec.css) places and paints it. The two class lists below
 * are the bundle's own two states, copied from a rendered /shop card.
 */
;(function () {
  'use strict'

  var KEY = 'sporta_wishlist'
  var BASE = 'absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full ' +
    'bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 '
  var ON = 'text-brand opacity-100'
  var OFF = 'text-slate-600 lg:opacity-0 lg:group-hover:opacity-100'

  function list() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch (e) { return [] }
  }

  function paint(btn, saved) {
    var on = saved.indexOf(btn.getAttribute('data-sporta-heart')) !== -1
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.className = BASE + (on ? ON : OFF)
    var svg = btn.querySelector('svg')
    if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none')
  }

  function paintAll() {
    var saved = list()
    var hearts = document.querySelectorAll('button[data-sporta-heart]')
    for (var i = 0; i < hearts.length; i++) paint(hearts[i], saved)
  }

  function toggle(slug) {
    var before = localStorage.getItem(KEY)
    var saved = list()
    var at = saved.indexOf(slug)
    if (at === -1) saved.push(slug); else saved.splice(at, 1)
    var after = JSON.stringify(saved)
    try { localStorage.setItem(KEY, after) } catch (e) { return }
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, oldValue: before, newValue: after, storageArea: localStorage }))
    } catch (e) { /* an old browser: the list is stored, and the next page load reads it */ }
  }

  /* Capture phase: the heart sits inside the card's link, and the link must not
     navigate when the heart is what was pressed. */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-sporta-heart]') : null
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    toggle(btn.getAttribute('data-sporta-heart'))
    paintAll()
  }, true)

  /* A heart pressed on /shop, or in another tab, repaints these. */
  window.addEventListener('storage', function (e) { if (e.key === KEY) paintAll() })

  /* Cards arrive after this file runs (the home grid is built from a fetch), so
     paint new hearts as they appear — throttled to a frame, never a debounce,
     because the hero's carousel mutates the page continuously. */
  var queued = false
  function later() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      var fresh = document.querySelectorAll('button[data-sporta-heart]:not([data-heart-painted])')
      if (!fresh.length) return
      var saved = list()
      for (var i = 0; i < fresh.length; i++) { fresh[i].setAttribute('data-heart-painted', ''); paint(fresh[i], saved) }
    })
  }
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true })
  later()
})()
