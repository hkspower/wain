/**
 * Add-to-bag motion, 2026-10-07. The owner chose all four:
 *   1. the product's photo flies in an arc to the bag icon (about 0.6 s);
 *   2. the bag gives a short bounce and its count pops when it lands;
 *   3. the button that was pressed shows a tick for a moment;
 *   4. a small "Added to your bag" toast with a View bag link — on the grids only: the product
 *      page already draws its own toast (the bundle's .added-toast), so a second one is not added.
 *
 * WHAT TRIGGERS IT is the bag itself, not a list of buttons: every way into the bag (the product
 * page's Add, the card size boxes, the + chooser, Complete the look) ends in a write of
 * localStorage.sporta_cart. This watches that write and fires only when the total number of items
 * GOES UP — a quantity lowered in the bag, a removal, or the provider re-saving the same bag on load
 * does nothing. The pressed button is the last one tapped in the 2 seconds before the write.
 *
 * Under prefers-reduced-motion nothing moves: no flight, no bounce; the tick and the toast still
 * appear (they are information, not motion). Built with createElement only (test:xss-guard).
 */
(function () {
  'use strict'
  if (/^\/backends/.test(location.pathname)) return
  var KEY = 'sporta_cart'
  var reduce = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }
  var ar = function () { return document.documentElement.lang === 'ar' }

  function read(raw) { try { var a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] } }
  function total(a) { return a.reduce(function (n, e) { return n + (Number(e && e.qty) || 0) }, 0) }
  var last = read((function () { try { return localStorage.getItem(KEY) } catch (e) { return '' } })())

  /* ---- the pressed control: the last button tapped shortly before the bag changed ---- */
  var pressed = null, pressedAt = 0
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button, a[role=button]')
    if (b) { pressed = b; pressedAt = Date.now() }
  }, true)

  /* ---- watch the bag ---- */
  try {
    var proto = Storage.prototype, orig = proto.setItem
    proto.setItem = function (k, v) {
      var r = orig.apply(this, arguments)
      if (this === window.localStorage && k === KEY) {
        try {
          var next = read(v)
          if (total(next) > total(last)) {
            var item = changed(last, next)
            setTimeout(function () { fire(item) }, 0)   // after React's commit, never inside it
          }
          last = next
        } catch (e) {}
      }
      return r
    }
  } catch (e) {}

  /** The line whose quantity went up. */
  function changed(before, after) {
    var was = {}
    before.forEach(function (e) { if (e && e.key) was[e.key] = Number(e.qty) || 0 })
    for (var i = 0; i < after.length; i++) {
      var e = after[i]
      if (e && (Number(e.qty) || 0) > (was[e.key] || 0)) return e
    }
    return after[after.length - 1] || null
  }

  function bagEl() {
    var all = document.querySelectorAll('header.app-header button, header.app-header a[href^="/cart"]')
    for (var i = 0; i < all.length; i++) {
      var l = all[i].getAttribute('aria-label') || ''
      if (/^(Bag|الحقيبة)/.test(l) || all[i].tagName === 'A') return all[i]
    }
    return null
  }

  /** The photo the item came from: the pressed control's card, else the product page's picture. */
  function sourceImage(btn) {
    var box = btn && btn.closest && btn.closest('[data-cardopt-grid] > *, article, li, .qas-panel')
    var img = box && box.querySelector('img')
    if (!img || !img.getBoundingClientRect().width) img = document.querySelector('main [aria-roledescription] img, main section img')
    if (img && img.getBoundingClientRect().width > 8) return img
    return null
  }

  function fire(item) {
    var btn = Date.now() - pressedAt < 2000 ? pressed : null
    if (btn && btn.isConnected) tick(btn)
    var bag = bagEl()
    var img = sourceImage(btn)
    if (!reduce() && bag && (img || btn)) fly(img, btn, bag)
    else if (bag) setTimeout(function () { pop(bag) }, 0)
    if (!document.querySelector('.added-toast')) toast(item)
  }

  /* ---- 1. the flight ---- */
  function fly(img, btn, bag) {
    var from = (img || btn).getBoundingClientRect(), to = bag.getBoundingClientRect()
    var size = Math.max(36, Math.min(96, Math.min(from.width, from.height) * 0.6))
    var g = document.createElement(img ? 'img' : 'span')
    g.className = 'cm-ghost'
    if (img) { g.src = img.currentSrc || img.src; g.alt = '' }
    g.setAttribute('aria-hidden', 'true')
    g.style.width = g.style.height = size + 'px'
    g.style.left = (from.left + from.width / 2 - size / 2) + 'px'
    g.style.top = (from.top + from.height / 2 - size / 2) + 'px'
    document.body.appendChild(g)
    var dx = to.left + to.width / 2 - (from.left + from.width / 2)
    var dy = to.top + to.height / 2 - (from.top + from.height / 2)
    var lift = Math.min(160, Math.abs(dy) * 0.35 + 60)   // the arc: rises first, then falls in
    var end = 22 / size
    var a = g.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx * 0.45 + 'px,' + (dy * 0.45 - lift) + 'px) scale(' + (0.55 + end / 2) + ')', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + end + ')', opacity: 0.35 },
    ], { duration: 620, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' })
    var done = function () { if (g.parentNode) g.remove(); pop(bag) }
    a.onfinish = done
    setTimeout(done, 1200)   // a tab put in the background never finishes its animation
  }

  /* ---- 2. the bag bounces and its count pops ---- */
  var popping = false
  function pop(bag) {
    if (popping || !bag || !bag.isConnected) return
    popping = true
    setTimeout(function () { popping = false }, 500)
    if (reduce()) return
    bag.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22) rotate(-6deg)' }, { transform: 'scale(.94) rotate(3deg)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' })
    var badge = null, spans = bag.querySelectorAll('span')
    for (var i = 0; i < spans.length; i++) if (/^\s*[\d٠-٩]+\+?\s*$/.test(spans[i].textContent)) { badge = spans[i]; break }
    if (badge) badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.55)' }, { transform: 'scale(1)' }], { duration: 380, delay: 60, easing: 'cubic-bezier(.3,1.6,.6,1)' })
  }

  /* ---- 3. the pressed button shows a tick ---- */
  function tick(btn) {
    // The badge is pinned to the button's corner, which needs a positioned box — but a button that
    // is already absolute (the card's +) must keep its own position, so only a static one is changed.
    try { if (getComputedStyle(btn).position === 'static') btn.setAttribute('data-cm-rel', '') } catch (e) {}
    btn.setAttribute('data-cm-added', '')
    clearTimeout(btn._cmT)
    btn._cmT = setTimeout(function () { btn.removeAttribute('data-cm-added'); btn.removeAttribute('data-cm-rel') }, 1200)
  }

  /* ---- 4. the toast (grids only) ---- */
  var toastEl = null, toastT = 0
  function nameOf(item) {
    var n = item && item.name
    if (n && typeof n === 'object') return String(n[ar() ? 'ar' : 'en'] || n.en || n.ar || '')
    return n ? String(n) : ''
  }
  function toast(item) {
    if (toastEl) toastEl.remove()
    clearTimeout(toastT)
    var wrap = document.createElement('div')
    wrap.className = 'cm-toast'; wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite')
    wrap.dir = ar() ? 'rtl' : 'ltr'
    var t = document.createElement('div'); t.className = 'added-toast'
    var tk = document.createElement('span'); tk.className = 'added-toast__tick'; tk.setAttribute('aria-hidden', 'true'); tk.textContent = '✓'
    var mid = document.createElement('span'); mid.className = 'min-w-0'
    var h = document.createElement('span'); h.className = 'block font-bold'; h.textContent = ar() ? 'أُضيف إلى حقيبتك' : 'Added to your bag'
    mid.appendChild(h)
    var what = nameOf(item) + (item && item.size ? ' · ' + (item.size === 'ONE' ? (ar() ? 'مقاس واحد' : 'One size') : item.size) : '')
    if (what) { var w = document.createElement('span'); w.className = 'added-toast__what'; w.textContent = what; mid.appendChild(w) }
    var go = document.createElement('a'); go.className = 'added-toast__go'; go.href = '/cart' + (ar() ? '' : '?lang=en')
    go.textContent = ar() ? 'عرض الحقيبة' : 'View bag'
    t.appendChild(tk); t.appendChild(mid); t.appendChild(go); wrap.appendChild(t)
    document.body.appendChild(wrap)
    toastEl = wrap
    toastT = setTimeout(function () {
      if (!toastEl) return
      var el = toastEl; toastEl = null
      if (reduce()) { el.remove(); return }
      var a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px)' }], { duration: 200, fill: 'forwards' })
      a.onfinish = function () { el.remove() }
    }, 3200)
  }
})()
