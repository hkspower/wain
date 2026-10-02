/**
 * Product names on ONE line in every grid card, shrunk to fit, 2026-10-02
 * ("make product name at one full line"; the owner chose shrink-to-fit over a cut ellipsis).
 *
 * CSS cannot size text to its own length, so each name is measured and its font-size lowered
 * until it fits the card, down to MIN px. A name that still does not fit at MIN keeps its full
 * text by wrapping (class gnf-wrap) rather than being cut. Without JavaScript the names wrap,
 * as before. Cards come from three places (the bundle's /shop and product pages, home-products.js,
 * category.php), and the bundle re-renders, so a MutationObserver refits new or changed names.
 * It watches only childList/characterData: this script writes style and class attributes, which
 * would otherwise re-trigger it for ever.
 */
(function () {
  'use strict'
  var SEL = 'main div.grid[class~="grid"][class~="grid-cols-2"] > article h3'
  var MAX = 14, MIN = 10, STEP = 0.25
  var timer = null

  // REMEMBERED PER NAME, 2026-10-02. The first version reset and re-measured every name on
  // every page change, stepping the size down with a layout read per step; React re-renders
  // the card titles while the page scrolls, so on a phone /shop it rewrote ~3,700 styles in one
  // scroll and froze frames for up to 160ms. Now a name is measured ONCE at 14px, its size is
  // computed in one step, and the result is re-applied without measuring while the text and
  // the card width stay the same.
  var memo = new WeakMap()

  function apply(h, r) {
    if (!h.classList.contains('gnf')) h.classList.add('gnf')
    if (h.classList.contains('gnf-wrap') !== r.wrap) h.classList.toggle('gnf-wrap', r.wrap)
    var want = r.size ? r.size + 'px' : ''
    if (h.style.getPropertyValue('font-size') !== want) {
      if (want) h.style.setProperty('font-size', want, 'important')   // the card's own 14px is !important
      else h.style.removeProperty('font-size')
    }
  }

  // the text's own width, not the (clipped) box's
  function textWidth(h) {
    var r = document.createRange()
    r.selectNodeContents(h)
    return r.getBoundingClientRect().width
  }

  // BATCHED READS AND WRITES. Measuring one name after writing another forces Chrome to lay out
  // the whole page again, once per name: twelve new cards arriving mid-scroll cost 60-170ms.
  // So: read every width (one layout), reset only the names that need measuring (writes), read
  // their text widths (one more layout), then write every result.
  function all() {
    var list = document.querySelectorAll(SEL)
    var todo = []
    for (var i = 0; i < list.length; i++) {
      var h = list[i], w = h.clientWidth
      if (!w) continue                                   // hidden: measured when it shows
      var m = memo.get(h), text = h.textContent
      if (m && m.text === text && m.w === w) apply(h, m)  // apply() only writes what differs
      else todo.push({ h: h, w: w, text: text })
    }
    if (!todo.length) return
    todo.forEach(function (t) {
      t.h.classList.add('gnf'); t.h.classList.remove('gnf-wrap'); t.h.style.removeProperty('font-size')
    })
    todo.forEach(function (t) {
      var cs = getComputedStyle(t.h)
      t.room = t.w - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
      t.full = textWidth(t.h)
    })
    todo.forEach(function (t) {
      var r = { text: t.text, w: t.w, size: 0, wrap: false }
      if (t.full > t.room) {
        var size = Math.floor(MAX * t.room / t.full / STEP) * STEP   // text width scales with size
        if (size >= MIN) r.size = size
        else r.wrap = true
      }
      memo.set(t.h, r)
      apply(t.h, r)
    })
  }

  // THROTTLED, NOT DEBOUNCED: a debounce restarts on every mutation, and on /shop other overlays
  // keep changing the page, so it never fired and no name was ever fitted (measured).
  function soon() {
    if (timer) return
    timer = setTimeout(function () { timer = null; all() }, 100)
  }

  all()
  // class too: React re-renders a title's className and wipes .gnf. Safe to watch, because apply()
  // writes nothing when the name already carries its result, so our own writes settle at once.
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', soon)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(all)
  window.sportaFitNames = all
})()
