/* Sporta — download hero slides only when the slider gets near them (2026-10-02, "check performance").
 *
 * The hero is a horizontal strip: every slide is in the page at once, translated sideways. The bundle
 * already marks slides 2+ loading="lazy", but Chrome's lazy distance is far wider than one slide, so
 * every slide picture downloaded on every visit — 140–180 kB each, seven on the live shop, on a phone.
 *
 * This keeps the CURRENT slide and gives every other slide picture `display:none`, which a lazy image
 * never fetches. It decides from the bundle's OWN marker of the current slide (aria-hidden="false" on
 * the slide wrapper), and runs in a MutationObserver, whose callback runs before the browser lays the
 * page out, so the hidden pictures are hidden before Chrome decides to fetch them.
 *
 * THE NEIGHBOURS ONLY WHEN THEY CAN BE REACHED, AND ONLY AFTER `load` — 2026-10-14. The neighbour on
 * each side (the strip wraps, so slide 1's other neighbour is the last one) used to be made eager on
 * every visit: +192 kB on a desktop and +114 kB on a phone, downloading alongside the first slide. On
 * the live shop a desktop visitor cannot move the slider at all (autoplay off, arrows and dots
 * display:none since 2026-09-28), so they were bytes nobody could ever see. A neighbour is now
 * fetched only when the slider can actually move, decided from the page as it is rather than from a
 * setting, because the owner may bring the controls or autoplay back:
 *
 *   - a control is drawn: one of the carousel's buttons has a box (arrows, dots, pause);
 *   - it is rotating by itself: the bundle sets aria-live="off" on the strip exactly while its
 *     autoplay timer runs (autoplay on, not paused, not hovered, no reduced motion);
 *   - a finger can swipe it: the device reports touch points (the bundle swipes on touch events);
 *   - or it already moved: the current slide changed once, so it evidently can.
 *
 * and never before the window's `load` event, so they cannot compete with the first slide. Once one
 * of those is true the neighbours load while the current one is on screen — one slide of
 * look-ahead, so nothing appears blank. The slide on screen is never deferred. Without this script
 * nothing changes; with one slide there is nothing to defer.
 */
;(function () {
  'use strict'
  var ATTR = 'data-hero-defer'
  var css = document.createElement('style')
  css.textContent = 'img[' + ATTR + ']{display:none!important}'
  document.head.appendChild(css)

  var loaded = document.readyState === 'complete'
  var moved = false, lastCurrent = null, canMove = false
  var touch = false
  try { touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window } catch (e) {}
  // Whether a control is drawn needs a layout read, so it is asked only when the slides change (the
  // controls are re-rendered with them) or the window is resized — never on every mutation.
  var controls = null, controlsFor = -1

  function drawn(section) {
    var b = section.querySelectorAll('button')
    for (var i = 0; i < b.length; i++) if (b[i].getClientRects().length) return true
    return false
  }
  function reachable(section, n) {
    if (canMove || moved || touch) return (canMove = true)
    if (!section) return false
    var strip = section.querySelector('[aria-live]')
    if (strip && strip.getAttribute('aria-live') === 'off') return (canMove = true)
    if (controls === null || controlsFor !== n) { controls = drawn(section); controlsFor = n }
    return controls ? (canMove = true) : false
  }

  function apply() {
    var imgs = document.querySelectorAll('img[src*="r=slide_image"]')
    var n = imgs.length
    if (n < 2) { for (var z = 0; z < n; z++) imgs[z].removeAttribute(ATTR); return }
    var current = -1
    for (var i = 0; i < n; i++) {
      var w = imgs[i].parentElement && imgs[i].parentElement.parentElement   // the slide wrapper
      if (w && w.getAttribute('aria-hidden') === 'false') current = i
    }
    if (current < 0) current = 0
    var id = imgs[current].getAttribute('src')
    if (lastCurrent !== null && id !== lastCurrent) moved = true
    lastCurrent = id
    // Only asked once the page has loaded: before that the answer is "not yet" whatever it is.
    var ahead = loaded && reachable(imgs[0].closest('section'), n)
    for (var k = 0; k < n; k++) {
      var d = Math.abs(k - current); d = Math.min(d, n - d)
      if (d === 0 || (d === 1 && ahead)) {
        if (imgs[k].hasAttribute(ATTR)) imgs[k].removeAttribute(ATTR)
        // A neighbour may sit further along the strip than Chrome's lazy distance (the wrap-around one
        // always does), so it is asked for NOW; otherwise pressing back would show it blank.
        if (d === 1 && imgs[k].loading !== 'eager') imgs[k].loading = 'eager'
      } else if (!imgs[k].hasAttribute(ATTR)) imgs[k].setAttribute(ATTR, '')
    }
  }
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-live', 'src'] })
  if (!loaded) addEventListener('load', function () { loaded = true; apply() })
  addEventListener('resize', function () { if (!canMove) { controls = null; apply() } })
  apply()
})()
