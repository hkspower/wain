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

/* ==== ONEPAGE: ONE-SCREEN CHECKOUT (owner request "make full one page order page", 2026-11-11) ====
 * The behaviour half of the "ONEPAGE" section of sporta-checkout-a11y.css (read that comment first).
 *
 * What the live guest checkout is: one route, three screens the app swaps in place (React unmounts the old one): Delivery
 * (the form), Payment (the method radios) and Review (the recap and the ONLY button that places the order). The payment radios
 * therefore do not exist while the shopper fills in the address, and nothing an add-on does can make them live there. This file
 * does the one thing that is safe:
 *   1. On the Delivery screen it shows the same method choice (KNET / cash on delivery, the methods the page's own checkout_config
 *      GET allows, nothing else) under the address, so the whole order is on one screen. The choice is the shopper's own and is
 *      only remembered here (this file's variable); it is NOT a form field and nothing reads it but this file.
 *   2. When the shopper presses the page's own "Continue" button, the app moves to its Payment screen. There this file clicks the
 *      app's OWN radio for the same method (a real click, so the app's own handler sets its own state) and then the app's own
 *      "Review order" button, so the shopper lands on Review with the payment already chosen: Delivery + Payment collapse into one
 *      screen, Review stays as the one confirmation. It NEVER touches the Review screen: the button that places the order is
 *      pressed by the shopper only. If the radio or the button is missing, disabled, or the screen is not Payment, it does
 *      nothing and the shopper simply sees the app's own Payment screen. The hop happens once per press of "Continue"; "Change
 *      payment" on the Review screen shows the app's real Payment screen untouched.
 *   3. Bag lines: a thumbnail on the guest summary rows and "x qty" on the returning shopper's bag rows, both read from the
 *      shopper's own bag in localStorage ('sporta_cart', read only) and only when its length equals the number of rows on screen.
 *      No price is read, computed or shown by this file; every figure on the page is the page's own server quote.
 *   4. A field that takes focus while it is on screen but behind the fixed pay bar (or the quick checkout's sticky button) is
 *      scrolled clear of it (window.scrollBy by the overlap, after the page has stopped scrolling: a few animation frames). Nothing else moves; no field is written.
 * Switch: window.SPORTA_CONFIG.onePage = false (config.js) or localStorage sporta_onepage = 'off' turns items 1 and 2 off.
 * Rules (the same as the rest of this file): checkout only; never writes a field the app owns, never sets a price, an amount or a
 * request; removes only nodes it created; idempotent (its own insertions re-run it harmlessly); no timers (two animation frames
 * around the hop); if it ever throws it disconnects and the page keeps working as the live build does. Arabic and English. */
;(function () {
  'use strict'
  if (window.__sportaOnePage) return
  window.__sportaOnePage = true

  var WORDS = {
    en: {
      legend: 'How would you like to pay?',
      knet: 'KNET', knetHint: 'Pay securely with your Kuwait-issued debit card.',
      cod: 'Cash on delivery', codHint: 'Pay the driver when your order arrives.', cash: 'CASH',
      next: 'You will check your order on the next screen before confirming.'
    },
    ar: {
      legend: 'كيف تحب تدفع؟',
      knet: 'كي نت', knetHint: 'ادفع بأمان باستخدام بطاقة السحب الكويتية.',
      cod: 'الدفع عند الاستلام', codHint: 'ادفع للمندوب عند وصول طلبك.', cash: 'نقدًا',
      next: 'راجع طلبك في الشاشة التالية قبل التأكيد النهائي.'
    }
  }
  var SELECTED = 'payment-method--selected border-brand bg-brand/5'
  var IDLE = 'border-slate-200 hover:border-slate-300'
  var methods = null // null = not asked yet, [] = unusable (the page runs as the live build does)
  var asking = false
  var pick = null
  var hop = false
  var obs = null

  function lang() { return /^ar/i.test(document.documentElement.getAttribute('lang') || '') ? 'ar' : 'en' }
  function onCheckout() { return location.pathname.indexOf('/checkout') === 0 }
  function apiBase() {
    var c = window.SPORTA_CONFIG
    return (c && c.phpApiUrl) || '/api'
  }
  // 0 bag, 1 delivery, 2 payment, 3 review: the position of the current step in the page's own indicator.
  function stage() {
    var li = document.querySelector('.purchase-steps li[data-state="current"]')
    return li && li.parentNode ? Array.prototype.indexOf.call(li.parentNode.children, li) : -1
  }
  function layout() { return document.querySelector('form.purchase-checkout-layout') }
  // The owner's switch: SPORTA_CONFIG.onePage = false in config.js (the file kept across deploys), or localStorage sporta_onepage = 'off'
  // on one device. Off means no method choice on the delivery screen and no hop: the live build's three screens, untouched.
  function off() {
    try {
      return (window.SPORTA_CONFIG && window.SPORTA_CONFIG.onePage === false) || localStorage.getItem('sporta_onepage') === 'off'
    } catch (e) { return false }
  }

  /* ---- 1. the method choice on the Delivery screen ---- */
  function ask() {
    if (methods || asking || !window.fetch) return
    asking = true
    fetch(apiBase() + '/api.php?r=checkout_config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        var ok = j && Object.prototype.toString.call(j.methods) === '[object Array]' && j.methods.length &&
          j.methods.every(function (m) { return m === 'knet' || m === 'cod' })
        methods = ok ? j.methods : []
        if (ok && !pick) pick = j.methods.indexOf(j.default_method) >= 0 ? j.default_method : j.methods[0]
        asking = false
        run()
      })
      .catch(function () { methods = []; asking = false })
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function build(w, lg) {
    var fs = el('fieldset', 'sporta-pay purchase-panel rounded-2xl border border-slate-100 bg-white p-4 md:p-5')
    fs.setAttribute('data-lang', lg)
    fs.appendChild(el('legend', 'px-1 text-sm font-bold text-slate-800', w.legend))
    var wrap = el('div', 'purchase-payment mt-2')
    methods.forEach(function (m) {
      var label = el('label', 'payment-method tap-row flex gap-3 rounded-xl border p-3 transition cursor-pointer ' + (m === pick ? SELECTED : IDLE))
      var input = el('input', 'mt-0.5 h-5 w-5 shrink-0 accent-brand')
      input.type = 'radio'
      input.name = 'sporta-paymethod'
      input.value = m
      input.checked = m === pick
      input.setAttribute('aria-describedby', 'sporta-pay-hint-' + m)
      var body = el('span', 'min-w-0 flex-1')
      var row = el('span', 'flex items-center justify-between gap-3')
      row.appendChild(el('span', 'block text-sm font-semibold text-slate-800', w[m]))
      if (m === 'knet') {
        var badge = el('span', 'payment-method__badge payment-method__badge--brand')
        badge.setAttribute('aria-hidden', 'true')
        var img = el('img', 'block max-w-full object-contain payment-method__knet-logo')
        img.alt = ''
        img.setAttribute('aria-hidden', 'true')
        img.width = 400; img.height = 273
        img.draggable = false
        img.src = '/payment/knet-official.png'
        badge.appendChild(img)
        row.appendChild(badge)
      } else {
        var cash = el('span', 'payment-method__badge', w.cash)
        cash.setAttribute('aria-hidden', 'true')
        row.appendChild(cash)
      }
      var hint = el('span', 'mt-0.5 block text-xs leading-snug text-slate-600', w[m + 'Hint'])
      hint.id = 'sporta-pay-hint-' + m
      body.appendChild(row)
      body.appendChild(hint)
      label.appendChild(input)
      label.appendChild(body)
      wrap.appendChild(label)
    })
    fs.appendChild(wrap)
    fs.appendChild(el('p', 'sporta-pay__next mt-3 text-sm text-slate-600', w.next))
    fs.addEventListener('change', function (e) {
      var t = e.target
      if (!t || t.name !== 'sporta-paymethod') return
      pick = t.value
      var labels = fs.querySelectorAll('label.payment-method')
      for (var i = 0; i < labels.length; i++) {
        var on = labels[i].querySelector('input').value === pick
        labels[i].className = 'payment-method tap-row flex gap-3 rounded-xl border p-3 transition cursor-pointer ' + (on ? SELECTED : IDLE)
      }
    })
    return fs
  }
  function sweepPay(keep) {
    var all = document.querySelectorAll('.sporta-pay')
    for (var i = 0; i < all.length; i++) if (all[i] !== keep && all[i].parentNode) all[i].parentNode.removeChild(all[i])
  }
  function payPanel() {
    var form = layout()
    var col = form && form.querySelector(':scope > div.min-w-0')
    if (off() || stage() !== 1 || !col || !document.getElementById('f-name')) { sweepPay(null); return }
    if (!methods) { ask(); return }
    if (!methods.length) { sweepPay(null); return }
    var lg = lang()
    var have = col.querySelector(':scope > .sporta-pay')
    if (have && have.getAttribute('data-lang') === lg) { sweepPay(have); return }
    var fresh = build(WORDS[lg], lg)
    if (have) col.replaceChild(fresh, have); else col.appendChild(fresh)
    sweepPay(fresh)
  }

  /* ---- 2. the hop through the app's own Payment screen ---- */
  function flag(on) {
    var h = document.documentElement
    if (on) h.setAttribute('data-sporta-hop', '1'); else h.removeAttribute('data-sporta-hop')
  }
  function doHop() {
    hop = false
    var form = layout()
    if (!form || stage() !== 2 || !pick) { flag(false); return }
    var radio = form.querySelector('input[type="radio"][name="paymethod"][value="' + pick + '"]')
    var btn = form.querySelector('.purchase-checkout-summary > button[type="submit"], .purchase-paybar button[type="submit"]')
    if (!radio || radio.disabled || !btn || btn.disabled) { flag(false); return }
    if (!radio.checked) radio.click() // the app's own onChange sets the app's own state, flushed before click() returns
    btn.click() // Payment -> Review. Never pressed from Review: stage() was 2 a line ago.
    requestAnimationFrame(function () { requestAnimationFrame(function () { flag(false) }) })
  }
  document.addEventListener('submit', function (e) {
    try {
      if (e.target && e.target.classList && e.target.classList.contains('purchase-checkout-layout') &&
          stage() === 1 && document.querySelector('.sporta-pay')) { hop = true; flag(true) }
    } catch (x) { /* ignore */ }
  }, true)
  function hopCheck() {
    var s = stage()
    if (s === 2 && hop) { requestAnimationFrame(function () { try { doHop() } catch (x) { flag(false) } }); return }
    if (s !== 1 && s !== 2) { hop = false; flag(false) }
  }

  /* ---- 3. bag lines ---- */
  function cart() {
    try {
      var a = JSON.parse(localStorage.getItem('sporta_cart') || '[]')
      return Object.prototype.toString.call(a) === '[object Array]' ? a : []
    } catch (e) { return [] }
  }
  function safeSrc(s) { return typeof s === 'string' && (/^\/(?!\/)/.test(s) || /^https:\/\//.test(s)) ? s : '' }
  function lines() {
    var guest = document.querySelectorAll('.purchase-checkout-summary > ul > li')
    var quick = document.querySelectorAll('.purchase-quick__bag > ul > li')
    if (!guest.length && !quick.length) return
    var items = cart()
    for (var g = 0; g < guest.length; g++) {
      var li = guest[g], it = items.length === guest.length ? items[g] : null
      var have = li.querySelector(':scope > img.sporta-thumb')
      var src = it ? safeSrc(it.image) : ''
      if (!src) { if (have) li.removeChild(have); continue }
      if (!have) {
        have = document.createElement('img')
        have.className = 'sporta-thumb'
        have.alt = ''
        have.width = 48; have.height = 48
        have.decoding = 'async'
        li.insertBefore(have, li.firstChild)
      }
      if (have.getAttribute('src') !== src) have.setAttribute('src', src)
    }
    for (var q = 0; q < quick.length; q++) {
      var p = quick[q].querySelector('p.text-xs')
      var item = items.length === quick.length ? items[q] : null
      var n = item && Number(item.qty) > 0 ? '× ' + Math.floor(Number(item.qty)) : ''
      if (!p) continue
      if (n) { if (p.getAttribute('data-sporta-qty') !== n) p.setAttribute('data-sporta-qty', n) } else if (p.hasAttribute('data-sporta-qty')) p.removeAttribute('data-sporta-qty')
    }
  }

  /* ---- 4. a focused field is never left under the pay bar ----
     The browser scrolls a focused field into view only when it is off screen; a field that is on screen but behind the fixed bar
     (or the quick checkout's sticky button) stays there. Once the page has stopped scrolling (the browser's own scroll to the
     field may still be gliding: two quiet animation frames, at most 45 frames), this scrolls the page by the overlap, nothing
     else. A newer focus cancels the older wait. */
  var guardToken = 0
  function clearOfBar(t) {
    var form = layout() || document.querySelector('form.purchase-quick')
    if (!form || !form.contains(t) || !document.contains(t)) return
    var cover = document.querySelector('.purchase-paybar') || document.querySelector('.purchase-quick__submit')
    if (!cover || cover.contains(t)) return
    var pos = getComputedStyle(cover).position
    if (pos !== 'fixed' && pos !== 'sticky') return
    var c = cover.getBoundingClientRect(), b = t.getBoundingClientRect()
    if (c.height < 1 || b.height < 1 || c.top >= window.innerHeight) return
    if (b.bottom > c.top && b.top < c.bottom) window.scrollBy(0, b.bottom - c.top + 16)
  }
  document.addEventListener('focusin', function (e) {
    try {
      var t = e.target
      if (!onCheckout() || !t || !t.getBoundingClientRect) return
      var token = ++guardToken, last = -1, quiet = 0, frames = 0
      var tick = function () {
        if (token !== guardToken) return
        try {
          var y = window.scrollY
          if (y === last) quiet++; else { quiet = 0; last = y }
          if (quiet >= 2 || ++frames > 45) { clearOfBar(t); return }
          requestAnimationFrame(tick)
        } catch (x) { /* ignore */ }
      }
      requestAnimationFrame(tick)
    } catch (x) { /* ignore */ }
  }, true)

  function run() {
    if (!onCheckout()) return
    try {
      payPanel()
      hopCheck()
      lines()
    } catch (e) {
      if (obs) obs.disconnect() // the order form must never break because of this file
      flag(false)
    }
  }
  run()
  obs = new MutationObserver(run)
  obs.observe(document.body, { childList: true, subtree: true })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
})()

/* ==== SOG-1112 [sog-2]: the hidden step indicator is not a Tab stop (2026-11-12, owner: "fix" item 2 of
 * AUDIT-SHADOW-OVERLAY-GLOSS-2026-11-12.md; proof: npm run test:sog-1112).
 * On the checkout, [op-steps] in sporta-checkout-a11y.css hides the four-step indicator visually (a 1px clip) and keeps it for
 * screen readers ("Step 2 of 4"). Its "Bag" link stayed in the Tab order, so Tab stop 10 landed on a link nobody could see: a
 * 0px focus ring, elementFromPoint at its place returning the heading (ar and en, 390 and 1280px; WCAG 2.4.7). While the
 * indicator is clipped this sets tabindex="-1" on its links and buttons: still announced and still reachable by a screen
 * reader's own navigation, no longer a Tab stop. When it shows again (the /cart page, the one-page layout switched off) the
 * attribute it set is taken away again; a tabindex the app set is never touched. Clipped means: 2px or less wide or tall,
 * or clip-path inset(50%) (measured: the clipped box is 1 x 55px). */
;(function () {
  'use strict'
  if (window.__sportaStepsTab) return
  window.__sportaStepsTab = true
  var MARK = 'data-sporta-notab'
  function sweep() {
    var navs = document.querySelectorAll('nav.purchase-steps')
    for (var i = 0; i < navs.length; i++) {
      var r = navs[i].getBoundingClientRect()
      var cp = getComputedStyle(navs[i]).clipPath
      var hidden = r.width <= 2 || r.height <= 2 || cp === 'inset(50%)'
      var items = navs[i].querySelectorAll('a[href], button')
      for (var j = 0; j < items.length; j++) {
        var el = items[j]
        if (hidden && !el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); el.setAttribute(MARK, '') }
        else if (!hidden && el.hasAttribute(MARK)) { el.removeAttribute('tabindex'); el.removeAttribute(MARK) }
      }
    }
  }
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      try { sweep() } catch (e) { /* the checkout must never break because of this block */ }
    })
  }
  schedule()
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('load', schedule)
  // The clip comes from a stylesheet that can arrive after the last DOM change (measured: the indicator was still a Tab stop
  // 1.5s after load), so the state is also brought up to date right before the browser moves focus for a Tab key.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') { try { sweep() } catch (x) { /* ignore */ } }
  }, true)
})()
/* ==== end SOG-1112 */
