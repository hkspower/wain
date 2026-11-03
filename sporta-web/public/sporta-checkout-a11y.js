/* Marks the checkout's required delivery fields aria-required="true".
 *
 * The form validates in JavaScript and the fields carry no `required`
 * attribute, so a screen reader announced every one of them as optional.
 * The fields are identified by their autocomplete token, which is stable
 * across languages and re-renders. React re-creates the form on step
 * changes, so this re-applies through a MutationObserver; it only writes
 * when the attribute is missing, so it cannot loop. Checkout only.
 *
 * Also makes the order-summary bag list keyboard-reachable when it scrolls.
 * From 1024px sporta-checkout-a11y.css caps that list's height so the only
 * "Continue" button stays on screen (cash-07); its rows are plain text, so a
 * scroller with nothing focusable inside is skipped by the Tab key in
 * browsers that do not focus scrollers themselves (Safari, Chrome before
 * 130), and a keyboard-only shopper could never read lines 4-6. tabindex="0"
 * on the list fixes that, and only while it really overflows: when the bag
 * fits (or below 1024px, where nothing clips it) the attribute is removed
 * again, so no empty tab stop is left behind. Only an attribute this script
 * added is ever removed (data-sporta-scroll marks it).
 */
(function () {
  'use strict'
  var TOKENS = ['name', 'tel', 'tel-national', 'address-level1', 'address-level2',
    'address-line1', 'address-line2', 'address-line3']
  var SEL = TOKENS.map(function (t) {
    return 'input[autocomplete="' + t + '"], select[autocomplete="' + t + '"]'
  }).join(',')

  var LIST = '.purchase-checkout-summary > ul'

  function scrollers() {
    var lists = document.querySelectorAll(LIST)
    for (var i = 0; i < lists.length; i++) {
      var ul = lists[i]
      var scrolls = ul.scrollHeight > ul.clientHeight + 1
      var mine = ul.getAttribute('data-sporta-scroll') === '1'
      if (scrolls && !ul.hasAttribute('tabindex')) {
        ul.setAttribute('tabindex', '0')
        ul.setAttribute('data-sporta-scroll', '1')
      } else if (!scrolls && mine) {
        ul.removeAttribute('tabindex')
        ul.removeAttribute('data-sporta-scroll')
      }
    }
  }

  function apply() {
    if (location.pathname.indexOf('/checkout') !== 0) return
    scrollers()
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
  window.addEventListener('resize', schedule)
  // Web fonts change how lines wrap, hence whether the list overflows.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule)
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
})()
