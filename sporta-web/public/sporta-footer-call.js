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
 * Number: 22091914 (the same one the WhatsApp links and the AI assistant use). When the owner
 * saves another phone number in /backends, sporta-features.js (SITE CONTENT) rewrites the href and
 * the digits in this label, like for any tel: link.
 *
 * THE LABEL'S WORDS are the owner's too (/backends -> Site content -> Footer). They are ONE ordinary
 * site-content rule: page '*', the page's language, match = the build's whole label ("اتصل بنا 22091914" /
 * "Call us 22091914"), text = the words to show instead, WITHOUT the number. This script reads that rule
 * from the copy sporta-features.js keeps (localStorage "sporta_content_v1", validated again here: a short
 * plain text, no price) and writes "<words> <number>" into the button in one step, as text only. It
 * hears 'sporta:content' (sent when a fresh answer is kept) and builds the label again. Nothing here
 * reads the network. With ?sporta_content=off in the address (the admin reading the page's own words)
 * the rule is not used.
 */
(function () {
  'use strict'
  var ID = 'sporta-footer-call'
  var TEL = 'tel:+96522091914'
  var NUMBER = '22091914'
  var LABEL = { ar: 'اتصل بنا ' + NUMBER, en: 'Call us ' + NUMBER }
  var KEY = 'sporta_content_v1'
  var PRICE = /(?:[0-9٠-٩][0-9٠-٩.,٫٬]*\s*(?:KWD|K\.?\s?D\.?|د\.?\s?ك\.?)(?![A-Za-z؀-ۿ]))|(?:(?:^|[^A-Za-z؀-ۿ])(?:KWD|K\.?\s?D\.?|د\.?\s?ك\.?)\s*[0-9٠-٩])/i

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function squash(s) { return String(s == null ? '' : s).replace(/[ \t\n\r\f\v]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^ +| +$/g, '') }

  /** The owner's words for this button in this language, or '' (then the build's own "Call us"). */
  function words(l) {
    try {
      if (/[?&]sporta_content=off(&|$)/.test(location.search)) return ''
      var j = JSON.parse(localStorage.getItem(KEY) || 'null')
      var list = j && Array.isArray(j.overrides) ? j.overrides : []
      for (var i = 0; i < list.length && i < 300; i++) {
        var o = list[i]
        if (!o || typeof o !== 'object' || o.page !== '*' || o.lang !== l || typeof o.match !== 'string' || typeof o.text !== 'string') continue
        if (squash(o.match) !== LABEL[l]) continue
        var t = squash(o.text)
        if (t && t.length <= 60 && !PRICE.test(t)) return t
      }
    } catch (e) { /* no kept copy, or storage blocked: the build's words */ }
    return ''
  }
  function labelFor(l) { var w = words(l); return w ? w + ' ' + NUMBER : LABEL[l] }

  function mount() {
    var footer = document.querySelector('footer')
    if (!footer) return
    var wa = footer.querySelector('a[href^="https://wa.me/"]')
    if (!wa || !wa.parentNode) return
    var l = lang(), want = labelFor(l)
    var existing = document.getElementById(ID)
    if (existing && existing.getAttribute('data-lang') === l && existing.getAttribute('data-label') === want && existing.previousElementSibling === wa) return
    if (existing) existing.remove()
    var a = wa.cloneNode(true)
    a.id = ID
    a.setAttribute('href', TEL)
    a.removeAttribute('target')
    a.removeAttribute('rel')
    a.setAttribute('data-lang', l)
    a.setAttribute('data-label', want)
    a.removeAttribute('aria-label')            // its name is its text, which follows contact.phone (an attribute would keep the old number)
    var svgs = a.querySelectorAll('svg, img')
    for (var i = 0; i < svgs.length; i++) svgs[i].remove()
    a.textContent = want
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
    window.addEventListener('sporta:content', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()

/* Sporta — Support link in the footer (add-on for the compiled live bundle; owner, 2026-11-11: the /support page, with its
 * help form, was linked from nowhere: measured on the live site, no header, nav or footer link reached it).
 * The footer's navigation list reads Contact, Shipping, Returns, Track, Account. This clones the Track entry (so the new
 * one inherits the list item, the anchor classes, the 24px tap height and the language), points the clone at /support and
 * puts it right after Track. A MutationObserver puts it back when React re-renders the footer or the language changes.
 * Same-origin path, text set with textContent, nothing else touched; a click is an ordinary page load, which /support
 * answers like any other deep link. A third self-contained block in this file: it shares nothing with the two around it. */
;(function () {
  'use strict'
  var ID = 'sporta-footer-support'
  var LABEL = { ar: 'الدعم', en: 'Support' }
  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function mount() {
    var footer = document.querySelector('footer')
    if (!footer) return
    var track = footer.querySelector('a[href="/track"]')
    var li = track && track.closest('li')
    if (!li || !li.parentNode) return
    var have = document.getElementById(ID)
    var native = footer.querySelector('a[href="/support"]:not(#' + ID + ')')
    if (native) { if (have) have.closest('li').remove(); return }          // the app links it itself one day: do nothing
    if (have && have.getAttribute('data-lang') === lang() && have.closest('li') === li.nextElementSibling) return
    if (have && have.closest('li')) have.closest('li').remove()
    var item = li.cloneNode(true)
    var a = item.querySelector('a')
    if (!a) return
    a.id = ID
    a.setAttribute('href', '/support')
    a.setAttribute('data-lang', lang())
    a.removeAttribute('data-discover')
    a.textContent = LABEL[lang()]
    li.parentNode.insertBefore(item, li.nextSibling)
  }
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { mount() } catch (e) { /* a footer we do not recognise: leave it as it is */ } })
  }
  function start() {
    try { mount() } catch (e) { /* see above */ }
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
 * Five things CSS cannot do, on the bag page (/cart) and in the bag drawer; everything else of this lane is CSS
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
 *   4. On a line of ONE the stepper's minus is not a decrease: the bundle turns a quantity of 0 into a removal, so the
 *      minus deletes the line, at once, with no warning and no undo, from a control that says "Decrease quantity".
 *      At one the minus is marked aria-disabled (the CSS draws it disabled), a tap or key on it is not passed on to the
 *      app, and the status message says why and where Remove is. The quantity is read from the stepper's own number at the
 *      moment of the tap, so a second quick tap cannot slip through; if the number cannot be read, the tap goes through
 *      as built. Removal itself is untouched: it has its own button.
 *   5. In the DRAWER the bundle moves focus to the Close button after every change of the bag (its focus effect re-runs
 *      each time the header re-renders): a keyboard user presses Enter on "+" and the second Enter closes the drawer.
 *      One frame after the bundle's own effect, focus goes back to the button the shopper was on (the minus beside it
 *      when a "+" has just reached its limit and is disabled), and only when focus is still on Close or on <body>.
 * What it never does: write to storage, call the shop's API, dispatch an event, set a field's value, move, re-parent
 * or remove a node of the app, or change a price, a quantity or the order. It adds the attributes above (and
 * tabindex="-1" to the heading it focuses), one hidden status node under <body>, and it calls focus() after a removal.
 * A MutationObserver (child nodes and text, never attributes, so its own attribute writes cannot wake it) re-applies
 * the attributes when the app re-renders; the work is queued to one animation frame and is idempotent. Every entry point is wrapped, so a
 * failure here cannot reach the app. Evaluating the file twice is the same as once. */
;(function () {
  'use strict'
  if (window.__sportaBagA11y) return
  window.__sportaBagA11y = true

  var LINES = '.purchase-cart .cart-line, .campaign-cart-drawer .cart-drawer__line'
  var ID = 'sporta-bag-n'
  var STATUS_ID = 'sporta-bag-status'
  var MSG = { ar: function (n) { return 'تمت إزالة «' + n + '» من الحقيبة' }, en: function (n) { return 'Removed from your bag: ' + n } }
  var MIN = { ar: 'أقل كمية هي ١. استخدم زر الإزالة لحذف المنتج من الحقيبة', en: 'The smallest quantity is 1. Use Remove to take this item out of your bag.' }
  var counter = 0

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function setAttr(el, name, value) { if (el && el.getAttribute(name) !== value) el.setAttribute(name, value) }
  // the number the stepper shows (NaN when it cannot be read: then nothing here acts on it)
  function qtyOf(step) { var s = step.querySelector('span'); var n = s ? parseInt(s.textContent, 10) : NaN; return isFinite(n) ? n : NaN }

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
      var step = line.querySelector('.purchase-quantity'), minus = step && step.querySelector('button')
      if (minus) { if (qtyOf(step) <= 1) setAttr(minus, 'aria-disabled', 'true'); else if (minus.getAttribute('aria-disabled') === 'true') minus.removeAttribute('aria-disabled') }
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
  // the bundle's own focus effect runs in the frame after a click: this runs one frame after that
  function later(fn) { requestAnimationFrame(function () { requestAnimationFrame(function () { try { fn() } catch (err) { /* never reaches the app */ } }) }) }
  function afterStep(btn) {
    var drawer = btn.closest('.campaign-cart-drawer')
    if (!drawer || !document.contains(btn)) return
    var active = document.activeElement
    if (active && active !== document.body && active !== drawer.querySelector('button')) return // the shopper put focus there
    var target = btn.disabled ? btn.parentNode.querySelector('button:not(:disabled)') : btn
    if (target) target.focus({ preventScroll: true })
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
      var step = btn.closest('.purchase-quantity')
      if (step && step.querySelector('button') === btn && qtyOf(step) <= 1) { // the minus on a line of one: not a removal
        e.preventDefault(); e.stopImmediatePropagation(); status(MIN[lang()]); return
      }
      var all = line.querySelectorAll('button')
      if (all[all.length - 1] !== btn) { // the stepper's buttons are not removals
        if (line.closest('.campaign-cart-drawer')) later(function () { afterStep(btn) })
        return
      }
      var nameEl = line.querySelector('h3, p.font-bold')
      var name = nameEl ? nameEl.textContent.trim() : ''
      var drawer = !!line.closest('.campaign-cart-drawer')
      // the bundle removes the line when its own handler runs, after this capturing listener, and moves focus (drawer) in
      // the frame after: act one frame after that
      later(function () { afterRemoval(line, drawer, name) })
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
    // childList for re-rendered nodes, characterData for the quantity's number (React updates its text node in place);
    // never attributes, so the attribute writes above cannot wake the observer
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
