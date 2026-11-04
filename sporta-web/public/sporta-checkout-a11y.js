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

/* ==== UX: U1 CHECKOUT (lane U1 of "improve UX/UI: checkout, cart, add to cart", 2026-11-04) ====
 * The behaviour half of the "UX: U1" section of sporta-checkout-a11y.css (read that comment first). Five small jobs,
 * none of which touches what is submitted: the script never writes a field value, a price or a request; it adds two
 * disclosure links and sets a few attributes the stylesheet reads.
 *   1. "Have a discount code?" folds the discount-code box (all widths) and "Add a delivery note or your location
 *      (optional)" folds the note + the location control (phones). A link is a real <button> with aria-expanded; it is
 *      placed BEFORE the node it folds (nothing is moved, nothing is removed) and the CSS hides that node only while the
 *      link says aria-expanded="false". The box opens by itself when it holds something: a code typed, an applied code,
 *      a code error, a saved note or location line, or focus inside. It never closes again by itself.
 *   2. data-sporta-count on the pay bar's "Total" label (the summary's "3 items"), so the bar reads "Total . 3 items".
 *   3. data-sporta-total on the quick checkout's pay button (the total), so the sticky button reads "Pay with KNET /
 *      KWD 28.000".
 *   4. The phone field: on blur, a number that is not a Kuwait mobile (8 digits starting 5, 6 or 9, the page's own rule)
 *      marks the field (data-sporta-warn + aria-invalid, both undone the moment it is valid or empty). Typing never
 *      raises it.
 *   5. A form-level alert that appears off screen (a declined card, out of stock, the one-order-a-minute message, "the
 *      checkout is unavailable") is scrolled into view. When the alert comes with a field marked invalid, the shopper
 *      belongs in that field: focus goes there if the page has not already put it there (it does after "Continue", it does
 *      not when the server rejects a field from the review step, because the form it was in is gone). Nothing else moves.
 * Rules (the same as the rest of this file): checkout only; never moves, re-parents or removes a node the page owns (it
 * removes only its own links); idempotent, so its own insertions cannot loop the observer; no timer, no per-frame work
 * (the observer is a plain callback on DOM changes); if it ever throws it disconnects and the page keeps working
 * (anything it hid stays reachable through its link). Text exists in Arabic and English (document.documentElement.lang). */
;(function () {
  'use strict'
  if (window.__sportaCheckoutUx) return
  window.__sportaCheckoutUx = true

  var FOLD = 'sporta-fold'
  var WORDS = {
    en: { note: 'Add a delivery note or your location (optional)', coupon: 'Have a discount code?' },
    ar: { note: 'أضف ملاحظة للتوصيل أو موقعك (اختياري)', coupon: 'عندك كود خصم؟' }
  }
  var opened = { note: false, coupon: false }
  var obs = null
  var lastAlert = ''

  function word(kind) {
    var ar = /^ar/i.test(document.documentElement.getAttribute('lang') || '')
    return WORDS[ar ? 'ar' : 'en'][kind]
  }
  function onCheckout() { return location.pathname.indexOf('/checkout') === 0 }
  function setAttr(el, name, value) {
    if (value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value) }
    else if (el.hasAttribute(name)) el.removeAttribute(name)
  }

  /* ---- 1. disclosure links ---- */
  function sweep(kind, keep) {
    var all = document.querySelectorAll('.' + FOLD + '--' + kind)
    for (var i = 0; i < all.length; i++) {
      if (all[i] !== keep && all[i].parentNode) all[i].parentNode.removeChild(all[i])
    }
  }
  function fold(kind, anchor, wantOpen) {
    var parent = anchor.parentNode
    if (!parent) return
    var btn = anchor.previousElementSibling
    if (!(btn && btn.classList && btn.classList.contains(FOLD + '--' + kind))) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.className = FOLD + ' ' + FOLD + '--' + kind
      btn.setAttribute('aria-expanded', wantOpen || opened[kind] ? 'true' : 'false')
      btn.addEventListener('click', function () {
        opened[kind] = true
        btn.setAttribute('aria-expanded', 'true')
        var field = kind === 'note' ? document.getElementById('f-note') : document.querySelector('.purchase-flow input.font-mono')
        if (field && field.focus) field.focus()
      })
      parent.insertBefore(btn, anchor)
    }
    sweep(kind, btn)
    var label = word(kind)
    if (btn.textContent !== label) btn.textContent = label
    if ((wantOpen || opened[kind]) && btn.getAttribute('aria-expanded') !== 'true') btn.setAttribute('aria-expanded', 'true')
  }
  function couponBox() {
    var boxes = document.querySelectorAll('.purchase-checkout-summary div.mt-4, .purchase-quick__bag div.mt-4')
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].querySelector('input.font-mono, code.font-mono')) return boxes[i]
    }
    return null
  }
  function foldCoupon() {
    var box = couponBox()
    if (!box) { sweep('coupon', null); return }
    var input = box.querySelector('input.font-mono')
    if (!input) opened.coupon = true // a code is applied: the box shows it
    var want = !input || !!input.value || box.contains(document.activeElement) || !!box.querySelector('[role="alert"]')
    fold('coupon', box, want)
  }
  function foldNote() {
    var ta = document.getElementById('f-note')
    var wrap = ta && ta.closest ? ta.closest('.purchase-field') : null
    if (!wrap || !wrap.parentNode) { sweep('note', null); return }
    var loc = document.getElementById('sporta-loc')
    var want = !!ta.value || wrap.contains(document.activeElement) || !!(loc && loc.contains(document.activeElement))
    fold('note', wrap, want)
  }

  /* ---- 2 + 3. text the stylesheet prints ---- */
  function labels() {
    var count = document.querySelector('.purchase-checkout-summary > h2 > span')
    var label = document.querySelector('.purchase-paybar .min-w-0 > p:first-child')
    if (label) setAttr(label, 'data-sporta-count', count ? count.textContent.trim() : '')
    var pay = document.querySelector('.purchase-quick__submit')
    if (pay) {
      var total = document.querySelector('.purchase-quick__bag .purchase-total > span:last-child')
      var text = total ? total.textContent.trim() : ''
      setAttr(pay, 'data-sporta-total', /\d/.test(text) ? text : '')
    }
  }

  /* ---- 4. phone field ---- */
  function phone(input, typing) {
    var wrap = input.closest ? input.closest('.purchase-field') : null
    if (!wrap) return
    var digits = String(input.value || '').replace(/\D/g, '')
    var valid = digits.length === 8 && '569'.indexOf(digits.charAt(0)) >= 0 // the page's own rule, written without a dollar sign (the installer runs through compose)
    var warned = wrap.hasAttribute('data-sporta-warn')
    function clear() {
      wrap.removeAttribute('data-sporta-warn')
      if (input.getAttribute('data-sporta-ai') === '1') {
        input.removeAttribute('data-sporta-ai')
        input.setAttribute('aria-invalid', 'false')
      }
    }
    if (typing) { if (warned && (valid || !digits)) clear(); return }
    if (digits && !valid) {
      if (!warned) {
        wrap.setAttribute('data-sporta-warn', '1')
        if (input.getAttribute('aria-invalid') !== 'true') {
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('data-sporta-ai', '1')
        }
      }
    } else if (warned) clear()
  }

  /* ---- 5. alerts that appear off screen ---- */
  function reveal() {
    var scope = document.querySelector('.purchase-flow')
    var alerts = scope ? scope.querySelectorAll('[role="alert"]') : []
    var el = null
    for (var i = 0; i < alerts.length && !el; i++) {
      var a = alerts[i]
      if (/^e-/.test(a.id) || (a.closest && a.closest('.purchase-field')) || !a.textContent.trim()) continue
      el = a
    }
    var sig = el ? el.textContent.trim() : ''
    if (sig === lastAlert) return
    lastAlert = sig
    if (!el) return
    var bad = scope.querySelector('[aria-invalid="true"]')
    if (bad) {
      // A field is marked: that is where the shopper goes. The page focuses it itself after a click on "Continue", but not when
      // the server rejects a field from the review step (the old form is gone and focus falls to the page): do it here.
      var now = document.activeElement
      if ((!now || now === document.body || !scope.contains(now)) && bad.focus) bad.focus()
      return
    }
    var r = el.getBoundingClientRect()
    if (r.top >= 0 && r.bottom <= window.innerHeight) return
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })
  }

  function run() {
    if (!onCheckout()) return
    try {
      foldNote()
      foldCoupon()
      labels()
      reveal()
    } catch (e) {
      if (obs) obs.disconnect() // the order form must never break because of this file
    }
  }

  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.id === 'f-phone') { try { phone(e.target, false) } catch (x) { /* ignore */ } }
  }, true)
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'f-phone') { try { phone(e.target, true) } catch (x) { /* ignore */ } }
  }, true)

  run()
  obs = new MutationObserver(run)
  obs.observe(document.body, { childList: true, subtree: true })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
})()
