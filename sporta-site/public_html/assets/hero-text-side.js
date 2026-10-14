/* hero-text-side.js — which side of each hero photo is EMPTY, so the headline goes there.
 *
 * 2026-10-14, the owner's choice for the desktop hero: "show each slide's title and a Shop button
 * in the empty side". The five photo slides stand their athlete in different places — CrossFit in
 * the middle, Features on the left, Runner, Activewear and Training on the right — so one fixed
 * side would cover an athlete on some slide whichever side it was.
 *
 * The athlete's position is already in the page: the panel's focal point is drawn by the bundle as
 * the picture's inline `object-position: <x>% <y>%`, and the publishers set x to where the athlete
 * stands (publish-hero-neutral.php). So this reads that x and marks the slide:
 *
 *   x < 45   athlete left of centre    data-sp-side="right"   the text goes on the right
 *   x > 55   athlete right of centre   data-sp-side="left"    the text goes on the left
 *   else     athlete in the middle     data-sp-side="centre"  the text goes left, on a light card
 *
 * The side is PHYSICAL, not reading direction: the picture is the same in Arabic and English, so
 * the empty side is too. css/93-hero-polish.css does the drawing; this only writes the attribute,
 * and only when it changes, so it cannot feed its own observer (which watches `style` and `src`,
 * never the attribute it writes). Home page only.
 */
(function () {
  'use strict'
  if (location.pathname !== '/') return

  function sideOf(img) {
    var m = img && /object-position:\s*(-?[\d.]+)%/.exec(img.getAttribute('style') || '')
    if (!m) return 'centre'
    var x = parseFloat(m[1])
    return x < 45 ? 'right' : x > 55 ? 'left' : 'centre'
  }
  function mark(sec) {
    var slides = sec.querySelectorAll('[aria-roledescription="slide"]')
    for (var i = 0; i < slides.length; i++) {
      var v = sideOf(slides[i].querySelector('img'))
      if (slides[i].getAttribute('data-sp-side') !== v) slides[i].setAttribute('data-sp-side', v)
    }
  }

  var sec = null, inner = null
  function find() {
    var s = document.querySelector('section[aria-roledescription="carousel"]')
    if (s === sec) return
    sec = s
    if (inner) { inner.disconnect(); inner = null }
    if (!s) return
    mark(s)
    inner = new MutationObserver(function () { mark(s) })
    inner.observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src'] })
  }
  new MutationObserver(find).observe(document.getElementById('root') || document.documentElement, { childList: true, subtree: true })
  find()
})()
