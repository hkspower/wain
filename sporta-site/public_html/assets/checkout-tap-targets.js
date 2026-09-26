/**
 * Bigger touch targets on /checkout, on a phone — asked for as "improve
 * quick checkout", alongside a broader admin-panel pass done the same way.
 *
 * MEASURED FIRST, the way this project always does: at 390x844 with
 * `hasTouch: true, isMobile: true` (a real phone's shape, not a mouse-driven
 * headless default), the quick-checkout path itself — the "Buy now" flow
 * this shop already has, saved-address to payment in two taps — is already
 * about as short as a checkout gets. What is not already right is five
 * controls on the page underneath it, well under the 44px Apple/WCAG 2.5.5
 * floor: "Change" (30x33, the saved-address edit link), "Edit bag" (87x17),
 * the quantity +/- steppers (39x23 each) and "Remove" (15x15, the smallest
 * control on the page for the one action that empties the bag).
 *
 * THE PAYMENT-METHOD RADIOS ARE NOT ON THIS LIST, and that is a real
 * measurement rather than an oversight: the bare `<input type=radio>` is
 * 20x20, but the `<label>` a tap actually lands on — `.tap-row` — is already
 * 316x64. Measuring the raw input instead of the label it that this project
 * has already been caught by more than once.
 *
 * NAMED BY ARIA-LABEL WHERE ONE EXISTS ("Decrease quantity", "Remove", …,
 * and their Arabic strings), which is stable across a rebuild the way a
 * compiled class name is not. "Change" and "Edit bag" have no distinguishing
 * attribute, so they are matched by their exact, trimmed text — both
 * languages — the same structural-matching approach every overlay in this
 * directory already uses for a button the bundle gives no better hook.
 *
 * `pointer: coarse` ONLY, same as admin-mobile.js and the storefront's own
 * carousel-target fix: a mouse is already precise, so nothing changes for
 * one. `inline-flex` + centring keeps a 17px-tall text link's label centred
 * in its new, taller box instead of floating at the top of it.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-checkout-grow'
  var GROW_TEXT = ['Change', 'تغيير', 'Edit bag', 'تعديل الحقيبة']

  var CSS = ''
    + '@media (pointer: coarse) {'
    + '  [aria-label="Decrease quantity"], [aria-label="إنقاص الكمية"],'
    + '  [aria-label="Increase quantity"], [aria-label="زيادة الكمية"],'
    + '  [aria-label="Remove"], [aria-label="إزالة"] {'
    + '    min-width: 44px; min-height: 44px;'
    + '    display: inline-flex; align-items: center; justify-content: center;'
    + '  }'
    + '  [' + MARK + '] { min-height: 44px; display: inline-flex; align-items: center; }'
    + '}'

  function onCheckout() { return location.pathname === '/checkout' }

  // CHECKED ON EVERY MUTATION, NOT ONCE AT LOAD. This is a client-rendered
  // SPA: a shopper reaches /checkout by a route CHANGE, not a fresh page
  // load, from the product page's own "Buy now" — the shortest path to this
  // screen there is. A `defer`red script runs once, on whatever page the
  // browser actually fetched, so gating the whole file on `onCheckout()` at
  // that single moment means it never re-arms for the shopper who arrived
  // exactly the way this fix is for. Measured: without this, `mark()` never
  // fires and nothing grows, on the "Buy now" path specifically — the same
  // shape of gap this project's own sign-in overlays had for the same
  // reason (checking sign-in state once at load rather than on the panel's
  // own no-reload transitions).
  function mark() {
    if (!onCheckout()) return
    document.querySelectorAll('button, a').forEach(function (el) {
      if (el.hasAttribute(MARK)) return
      if (GROW_TEXT.indexOf(el.textContent.trim()) !== -1) el.setAttribute(MARK, '1')
    })
  }

  function start() {
    // The CSS is inert off /checkout — every selector in it either names an
    // aria-label this page's own controls use or the MARK attribute mark()
    // only ever sets there — so injecting it unconditionally, once, costs
    // nothing and needs no route check of its own.
    if (!document.getElementById('sct-css')) {
      var s = document.createElement('style')
      s.id = 'sct-css'
      s.textContent = CSS
      document.head.appendChild(s)
    }

    mark()
    // THE STEP CHANGES UNDER THE SAME URL TOO. /checkout carries Bag,
    // Delivery and Payment as one client-side route, so "Change"/"Edit bag"
    // are re-rendered — sometimes replaced outright — every time the
    // shopper moves between them or edits a quantity. A one-shot mark()
    // would miss every render after the first, on top of missing the
    // arrival itself.
    new MutationObserver(mark).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
