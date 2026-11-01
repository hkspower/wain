/* Marks the checkout's required delivery fields aria-required="true".
 *
 * The form validates in JavaScript and the fields carry no `required`
 * attribute, so a screen reader announced every one of them as optional.
 * The fields are identified by their autocomplete token, which is stable
 * across languages and re-renders. React re-creates the form on step
 * changes, so this re-applies through a MutationObserver; it only writes
 * when the attribute is missing, so it cannot loop. Checkout only.
 */
(function () {
  'use strict'
  var TOKENS = ['name', 'tel', 'tel-national', 'address-level1', 'address-level2',
    'address-line1', 'address-line2', 'address-line3']
  var SEL = TOKENS.map(function (t) {
    return 'input[autocomplete="' + t + '"], select[autocomplete="' + t + '"]'
  }).join(',')

  function apply() {
    if (location.pathname.indexOf('/checkout') !== 0) return
    var els = document.querySelectorAll(SEL)
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('aria-required') !== 'true') {
        els[i].setAttribute('aria-required', 'true')
      }
    }
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; apply() })
  }

  apply()
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
})()
