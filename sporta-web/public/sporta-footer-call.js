/* Sporta — tap-to-call link in the footer (add-on for the compiled live bundle).
 *
 * The footer's only way to reach the shop is a WhatsApp link: no phone number
 * and no tel: link, so a phone user who wants to call has to copy the number
 * from somewhere else. This clones the footer's own WhatsApp link (so it inherits
 * the exact styling, spacing and tap size), points the clone at tel:, swaps the
 * label, and drops the WhatsApp icon. A MutationObserver puts it back when React
 * re-renders the footer or the language changes. External file on purpose: the
 * CSP allows scripts from 'self' only.
 *
 * Number: 22091914 (the same one the WhatsApp links and the AI assistant use).
 */
(function () {
  'use strict'
  var ID = 'sporta-footer-call'
  var TEL = 'tel:+96522091914'
  var LABEL = { ar: 'اتصل بنا 22091914', en: 'Call us 22091914' }

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }

  function mount() {
    var footer = document.querySelector('footer')
    if (!footer) return
    var wa = footer.querySelector('a[href^="https://wa.me/"]')
    if (!wa || !wa.parentNode) return
    var existing = document.getElementById(ID)
    if (existing && existing.getAttribute('data-lang') === lang() && existing.previousElementSibling === wa) return
    if (existing) existing.remove()
    var a = wa.cloneNode(true)
    a.id = ID
    a.setAttribute('href', TEL)
    a.removeAttribute('target')
    a.removeAttribute('rel')
    a.setAttribute('data-lang', lang())
    a.setAttribute('aria-label', LABEL[lang()])
    var svgs = a.querySelectorAll('svg, img')
    for (var i = 0; i < svgs.length; i++) svgs[i].remove()
    a.textContent = LABEL[lang()]
    wa.parentNode.insertBefore(a, wa.nextSibling)
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; mount() })
  }
  function start() {
    mount()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()

/* Sporta — bag accessibility (add-on for the compiled live bundle; lane U2 of "improve ux/ui of the checkout, the cart
 * and add to cart", 2026-11-04). A second, self-contained block in this file: it shares nothing with the footer
 * call above, so either can fail without the other.
 *
 * Three things CSS cannot do, on the bag page (/cart) and in the bag drawer; everything else of this lane is CSS
 * (public/sporta-bag-touch.css, public/sporta-cart-drawer.css).
 *   1. Every line has three buttons and they carry the same words on every line ("Decrease quantity", "Increase
 *      quantity", "Remove"), so a screen reader user cannot tell which product a button is for. Each button is
 *      pointed (aria-describedby) at the name of its own line. The bundle's aria-label is NOT touched, so a language
 *      switch cannot fight this script; the name element only gains an id.
 *   2. The quantity and the subtotal become polite live regions, so a change made with "+" or "-" is spoken. (Setting
 *      aria-live on a node that already exists announces later changes, not its first value.)
 *   3. Removing a line deletes the very button the keyboard was on, and focus falls to the top of the document. After
 *      a removal, focus goes to the bag's heading (preventScroll, so the page does not jump), where a keyboard user
 *      carries on with Tab; the heading is the same place whether the bag now has lines or is empty. Not the next
 *      line's remove button: a held Enter key would then delete line after line. A hidden polite message says what
 *      was removed, in the page's language.
 * What it never does: write to storage, call the shop's API, dispatch an event, set a field's value, move, re-parent
 * or remove a node of the app, or change a price, a quantity or the order. It adds the attributes above (and
 * tabindex="-1" to the heading it focuses), one hidden status node under <body>, and it calls focus() after a removal.
 * A MutationObserver (childList only, so its own attribute writes cannot wake it) re-applies the attributes when the
 * app re-renders; the work is queued to one animation frame and is idempotent. Every entry point is wrapped, so a
 * failure here cannot reach the app. Evaluating the file twice is the same as once. */
;(function () {
  'use strict'
  if (window.__sportaBagA11y) return
  window.__sportaBagA11y = true

  var LINES = '.purchase-cart .cart-line, .campaign-cart-drawer .cart-drawer__line'
  var ID = 'sporta-bag-n'
  var STATUS_ID = 'sporta-bag-status'
  var MSG = { ar: function (n) { return 'تمت إزالة «' + n + '» من الحقيبة' }, en: function (n) { return 'Removed from your bag: ' + n } }
  var counter = 0

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function setAttr(el, name, value) { if (el && el.getAttribute(name) !== value) el.setAttribute(name, value) }

  // 1 and 2: describe each line's buttons by its name, make the quantity and the subtotal live regions
  function label() {
    var lines = document.querySelectorAll(LINES)
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      var name = line.querySelector('h3, p.font-bold')
      if (!name) continue
      if (!name.id || name.id.indexOf(ID) !== 0) name.id = ID + (++counter)
      var buttons = line.querySelectorAll('button')
      for (var b = 0; b < buttons.length; b++) setAttr(buttons[b], 'aria-describedby', name.id)
      var qty = line.querySelector('.purchase-quantity > span')
      if (qty) { setAttr(qty, 'aria-live', 'polite'); setAttr(qty, 'aria-atomic', 'true') }
    }
    var totals = document.querySelectorAll('.purchase-cart__summary .purchase-total > span:last-child, .campaign-cart-drawer > footer > div:first-child > span:last-child')
    for (var t = 0; t < totals.length; t++) { setAttr(totals[t], 'aria-live', 'polite'); setAttr(totals[t], 'aria-atomic', 'true') }
  }

  // 3: where focus goes, and what is said, after a line is removed
  function status(text) {
    var el = document.getElementById(STATUS_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = STATUS_ID
      el.setAttribute('role', 'status')
      el.setAttribute('aria-live', 'polite')
      el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0'
      document.body.appendChild(el)
    }
    el.textContent = ''
    setTimeout(function () { el.textContent = text }, 60)
  }
  function afterRemoval(line, drawer, name) {
    if (document.contains(line)) return // nothing was removed: leave focus where it is
    var heading = drawer
      ? document.querySelector('.campaign-cart-drawer > header h2')
      : document.querySelector('.purchase-heading h1, .purchase-empty h1')
    if (heading) { setAttr(heading, 'tabindex', '-1'); heading.focus({ preventScroll: true }) }
    status(MSG[lang()](name))
  }
  function onClick(e) {
    try {
      var btn = e.target && e.target.closest ? e.target.closest('button') : null
      var line = btn && btn.closest(LINES)
      if (!line) return
      var all = line.querySelectorAll('button')
      if (all[all.length - 1] !== btn) return // the stepper's buttons are not removals
      var nameEl = line.querySelector('h3, p.font-bold')
      var name = nameEl ? nameEl.textContent.trim() : ''
      var drawer = !!line.closest('.campaign-cart-drawer')
      // the bundle removes the line when its own handler runs, after this capturing listener: look one frame later
      requestAnimationFrame(function () { try { afterRemoval(line, drawer, name) } catch (err) { /* never reaches the app */ } })
    } catch (err) { /* never reaches the app */ }
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { label() } catch (err) { /* never reaches the app */ } })
  }
  function start() {
    try { label() } catch (err) { /* never reaches the app */ }
    document.addEventListener('click', onClick, true)
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
