/* Touch response, 2026-10-07 ("improve touch button response"). Pairs with css/84-touch.css.
 *
 * Marks the control under a finger the INSTANT it lands (pointerdown), so css/84-touch.css can show it
 * pressed in that frame — before the tap's own work (often 80-300 ms on a mid-range phone) has run.
 * Browsers' own :active is later and less reliable on a touch: Chrome holds it back until it knows the
 * touch is not a scroll, and iPhone Safari applies it only when the page listens for touches (the
 * empty passive listener below is that, kept so 82-pressed.css shows there too).
 *
 * The mark goes when the finger lifts, when the browser takes the touch for a scroll (pointercancel),
 * or when the finger slides off. Passive throughout: nothing here can delay scrolling or a tap.
 */
(function () {
  'use strict'
  document.addEventListener('touchstart', function () {}, { passive: true })
  var SEL = 'a[href], button, [role="button"], summary, label, select'
  var cur = null, sx = 0, sy = 0
  function clear() { if (cur) { cur.removeAttribute('data-pressing'); cur = null } }
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    clear()
    var el = e.target && e.target.closest && e.target.closest(SEL)
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return
    cur = el; sx = e.clientX; sy = e.clientY
    el.setAttribute('data-pressing', '')
  }, { passive: true, capture: true })
  document.addEventListener('pointermove', function (e) {
    if (cur && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) clear()
  }, { passive: true, capture: true })
  ;['pointerup', 'pointercancel'].forEach(function (t) {
    // A short hold after the lift, so a quick tap is still SEEN pressed (a tap can be over in 40 ms).
    document.addEventListener(t, function () { var el = cur; cur = null; if (el) setTimeout(function () { el.removeAttribute('data-pressing') }, t === 'pointerup' ? 90 : 0) }, { passive: true, capture: true })
  })
  window.addEventListener('scroll', clear, { passive: true })
})()
