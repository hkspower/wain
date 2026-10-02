/* Sporta — download hero slides only when the slider gets near them (2026-10-02, "check performance").
 *
 * The hero is a horizontal strip: every slide is in the page at once, translated sideways. The bundle
 * already marks slides 2+ loading="lazy", but Chrome's lazy distance is far wider than one slide, so
 * every slide picture downloaded on every visit — 140–180 kB each, seven on the live shop, on a phone.
 *
 * This keeps the CURRENT slide and its neighbour on each side (the strip wraps, so slide 1's other
 * neighbour is the last one) and gives every other slide picture `display:none`, which a lazy image
 * never fetches. When the slider moves, the slide that becomes a neighbour gets its picture back and it
 * loads while the current one is on screen — one slide of look-ahead, so nothing ever appears blank.
 *
 * It decides from the bundle's OWN marker of the current slide (aria-hidden="false" on the slide
 * wrapper), and runs in a MutationObserver, whose callback runs before the browser lays the page out,
 * so the hidden pictures are hidden before Chrome decides to fetch them. Without this script, or with
 * fewer than four slides, nothing changes.
 */
;(function () {
  'use strict'
  var ATTR = 'data-hero-defer'
  var css = document.createElement('style')
  css.textContent = 'img[' + ATTR + ']{display:none!important}'
  document.head.appendChild(css)

  function apply() {
    var imgs = document.querySelectorAll('img[src*="r=slide_image"]')
    if (imgs.length < 4) { for (var z = 0; z < imgs.length; z++) imgs[z].removeAttribute(ATTR); return }
    var slides = [], current = -1
    for (var i = 0; i < imgs.length; i++) {
      var w = imgs[i].parentElement && imgs[i].parentElement.parentElement   // the slide wrapper
      slides.push(w)
      if (w && w.getAttribute('aria-hidden') === 'false') current = i
    }
    if (current < 0) current = 0
    var n = imgs.length
    for (var k = 0; k < n; k++) {
      var d = Math.abs(k - current); d = Math.min(d, n - d)
      if (d > 1) { if (!imgs[k].hasAttribute(ATTR)) imgs[k].setAttribute(ATTR, '') }
      else {
        if (imgs[k].hasAttribute(ATTR)) imgs[k].removeAttribute(ATTR)
        // A neighbour may sit further along the strip than Chrome's lazy distance (the wrap-around one
        // always does), so it is asked for NOW; otherwise pressing back would show it blank.
        if (d === 1 && imgs[k].loading !== 'eager') imgs[k].loading = 'eager'
      }
    }
  }
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'src'] })
  apply()
})()
