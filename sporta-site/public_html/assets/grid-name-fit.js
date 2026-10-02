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

  function fit(h) {
    h.classList.add('gnf')
    h.classList.remove('gnf-wrap')
    h.style.removeProperty('font-size')
    var w = h.clientWidth
    if (!w) return                       // hidden: measured again when it shows
    // clientWidth includes padding; the text box is what is left of it
    var cs = getComputedStyle(h)
    var room = w - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
    if (h.scrollWidth - w <= 0 && textWidth(h) <= room) return
    var size = MAX
    while (size > MIN && textWidth(h) > room) {
      size -= STEP
      h.style.setProperty('font-size', size + 'px', 'important')   // the card's own 14px is !important
    }
    if (textWidth(h) > room + 0.5) {
      h.style.removeProperty('font-size')
      h.classList.add('gnf-wrap')
    }
  }

  // the text's own width, not the (clipped) box's
  function textWidth(h) {
    var r = document.createRange()
    r.selectNodeContents(h)
    return r.getBoundingClientRect().width
  }

  function all() {
    var list = document.querySelectorAll(SEL)
    for (var i = 0; i < list.length; i++) fit(list[i])
  }

  // THROTTLED, NOT DEBOUNCED: a debounce restarts on every mutation, and on /shop other overlays
  // keep changing the page, so it never fired and no name was ever fitted (measured).
  function soon() {
    if (timer) return
    timer = setTimeout(function () { timer = null; all() }, 100)
  }

  all()
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true })
  addEventListener('resize', soon)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(all)
  window.sportaFitNames = all
})()
