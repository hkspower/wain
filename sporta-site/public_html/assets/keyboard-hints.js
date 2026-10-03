/**
 * Phone keyboards: tell iOS and Android what each field is — and make the
 * digits an Arabic number pad types reach the form as digits.
 *
 * ATTRIBUTES. The bundle already sets inputMode/autoComplete on most checkout
 * fields, but not the rest: an email box capitalised its first letter and
 * underlined the address as a typo, a name started in lower case, a search box
 * showed a "return" key, and a few number-only boxes in /backends opened the
 * full letter keyboard. This only ADDS an attribute that is missing — it never
 * overrides one the page set, and never changes an input's type.
 *   email      -> email keyboard, no capital, no autocorrect
 *   phone      -> number pad
 *   password / username / codes -> no capital, no autocorrect, no spellcheck
 *   name, address -> capitalise each word
 *   search     -> "Search" key
 *   one-time code -> number pad
 *   type=number -> number pad; with a decimal point when its step has one
 *   /backends order drawer, Customer: Phone -> phone pad; Block/Floor/Flat -> number pad
 *   storefront phone pad with no autocomplete -> autocomplete=tel (the shopper's own number)
 *
 * DIGITS. An Arabic phone's number pad types ٠١٢٣٤٥٦٧٨٩ (or the Persian
 * ۰۱۲۳۴۵۶۷۸۹), and ٫ for the decimal point. Most of the bundle strips anything
 * that is not an ASCII digit, so those keys did NOTHING — or worse: ٩٫٥٠٠
 * typed as a price lost the ٫ and stored 9500. In a box that wants a number
 * (type number/tel, or inputmode numeric/decimal/tel) this turns them into
 * 0-9 and "." as they are typed. Nothing else is touched: a name, a street or
 * a search box keeps exactly what was typed. A Western "," is NOT converted
 * while typing — "1,234.500" and "1,5" mean different things, and only the
 * whole string can say which, so that stays with the parsers that see it whole.
 *
 * How, and why it is three listeners on WINDOW in the CAPTURE phase: they run
 * before React's root listener and before any overlay's own element listener,
 * so every one of them sees ASCII.
 *   beforeinput -> a typed/pasted Arabic digit is cancelled and re-inserted as
 *     ASCII with execCommand('insertText'), which is a real edit: the caret and
 *     undo are kept and React's onChange fires exactly as for a keystroke. It is
 *     the ONLY way into type=number, which drops the digit before any input
 *     event exists.
 *   input -> the backstop (autofill, a non-cancelable edit): the value is
 *     rewritten with the prototype setter, so React's own handler for this
 *     same event sees the change.
 *   compositionend -> an IME composition is never rewritten mid-way (that
 *     doubled a digit: ٤٥ became 445). While a composition holds a mapped
 *     digit its input events are held back, and one input is sent at the end.
 *     TEXT INPUTS ONLY: in a type=number box Chromium discards composed
 *     non-ASCII digits before compositionend, so there is nothing to convert.
 *     Number pads do not compose, so typed and pasted digits are unaffected.
 */
(function () {
  'use strict'
  function put(e, k, v) { if (!e.hasAttribute(k)) e.setAttribute(k, v) }
  function plain(e) { put(e, 'autocapitalize', 'none'); put(e, 'autocorrect', 'off'); put(e, 'spellcheck', 'false') }
  function onPanel() { return /^\/backends(\/|$)/.test(location.pathname) }

  function hint(e) {
    if (e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio' || e.type === 'file' || e.type === 'range' || e.type === 'color') return
    var ac = (e.getAttribute('autocomplete') || '').toLowerCase()
    var id = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase()
    if (e.tagName === 'TEXTAREA') return
    if (e.type === 'email' || ac === 'email') { put(e, 'inputmode', 'email'); plain(e); return }
    if (e.type === 'tel' || /^tel/.test(ac)) { put(e, 'inputmode', 'tel'); plain(e); return }
    if (e.type === 'password' || ac === 'username' || /password/.test(ac)) { plain(e); return }
    if (ac === 'one-time-code') { put(e, 'inputmode', 'numeric'); plain(e); return }
    if (e.type === 'search' || e.getAttribute('role') === 'searchbox' || e.closest('[role=search]')) { put(e, 'enterkeyhint', 'search'); put(e, 'autocapitalize', 'none'); return }
    // type=number: the type is the page's and stays; only the keyboard is said.
    // A fractional step (0.001, 0.5) or "any" takes a decimal point; anything
    // else is a whole number, and the plain number pad is the right one.
    if (e.type === 'number') { put(e, 'inputmode', /\.|any/i.test(e.getAttribute('step') || '') ? 'decimal' : 'numeric'); return }
    if (e.type !== 'text' && e.type !== '') return
    if (e.getAttribute('inputmode') === 'numeric' || e.getAttribute('inputmode') === 'decimal') return   // block, floor, flat: digits, no capitals to manage
    if (ac === 'name' || /^(given|family|additional)-name$/.test(ac) || /address|street|city|area|block|name$/.test(ac)) { put(e, 'autocapitalize', 'words'); return }
    if (/(^|[^a-z])(code|otp|pin)([^a-z]|$)/.test(id)) plain(e)
  }

  /* THE ORDER DRAWER'S CUSTOMER FIELDS (/backends only). The bundle draws them
     as bare <input>s with no type, name or inputmode, inside
     <section><h3>Customer</h3> … <label><span>Phone</span><input></label>.
     They are matched on that exact English text because the panel bundle is
     English-only whatever the shop's language is. Street and House / Building
     take letters ("12A") and are deliberately not in the list. No autocomplete
     on the phone: it is the CUSTOMER's number, and the owner's browser must not
     offer the owner's own. If the bundle is rebuilt with other labels this
     simply stops matching, and test:numeric-keyboard says so by name. */
  var DRAWER = { Phone: 'tel', Block: 'numeric', Floor: 'numeric', Flat: 'numeric' }
  function drawer() {
    document.querySelectorAll('section').forEach(function (s) {
      var h = s.querySelector(':scope > h3')
      if (!h || h.textContent.trim() !== 'Customer') return
      s.querySelectorAll('label').forEach(function (l) {
        var sp = l.querySelector(':scope > span'), inp = l.querySelector(':scope > input')
        if (!sp || !inp) return
        var key = sp.textContent.trim()
        if (Object.prototype.hasOwnProperty.call(DRAWER, key)) put(inp, 'inputmode', DRAWER[key])
      })
    })
  }

  function run() {
    var panel = onPanel()
    if (panel) drawer()
    document.querySelectorAll('input, select').forEach(hint)
    // The shopper's own phone (today: the /returns WhatsApp form's pickup
    // number). Not on /backends, where a phone box holds somebody else's.
    if (!panel) document.querySelectorAll('input[inputmode=tel]:not([autocomplete])').forEach(function (e) { e.setAttribute('autocomplete', 'tel') })
  }
  var t = null
  // One pending pass at a time, NOT a debounce: the hero carousel mutates the page
  // continuously, and a debounce is reset by every change and never fires.
  new MutationObserver(function () { if (!t) t = setTimeout(function () { t = null; run() }, 150) }).observe(document.documentElement, { childList: true, subtree: true })
  run()
  // AND AT FOCUS. A field React focuses as it mounts (autoFocus: the 'Put on sale' price) is
  // focused before the pass above reaches it, so the phone could open the letters keyboard and
  // keep it. Saying the keyboard in the focusin capture closes that ~150ms gap.
  window.addEventListener('focusin', function (e) {
    var el = e.target
    if (!el || el.tagName !== 'INPUT') return
    if (onPanel()) drawer()
    hint(el)
  }, true)

  /* ------------------------------------------------------------- digits -- */
  if (window.__sportaDigits) return
  window.__sportaDigits = true

  // ٠-٩ (U+0660-0669), ۰-۹ (U+06F0-06F9), ٫ the Arabic decimal point, ٬ the
  // Arabic thousands separator. The same table as the app's lib/money.ts,
  // with the Persian digits an Urdu/Persian keyboard types added.
  var ANY = /[٠-٩۰-۹٫٬]/
  function west(s) {
    return String(s).replace(/[٠-٩۰-۹٫٬]/g, function (c) {
      var n = c.charCodeAt(0)
      if (n === 0x066B) return '.'
      if (n === 0x066C) return ''
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }
  function scoped(el) {
    if (!el || el.tagName !== 'INPUT') return false
    var ty = el.type, im = (el.getAttribute('inputmode') || '').toLowerCase()
    return ty === 'number' || ty === 'tel' || im === 'numeric' || im === 'decimal' || im === 'tel'
  }
  var SET = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })) }

  // Rewrite the value in place, caret kept. The PROTOTYPE setter on purpose:
  // it goes round React's value tracker, so React's own listener for this same
  // event sees the new value and fires onChange with it.
  function fix(el) {
    var v = el.value
    if (!ANY.test(v)) return false
    var a = null, b = null
    try { a = el.selectionStart; b = el.selectionEnd } catch (x) { /* type=number has no selection */ }
    SET.call(el, west(v))
    if (a != null && b != null) {
      try { el.setSelectionRange(west(v.slice(0, a)).length, west(v.slice(0, b)).length) } catch (x) { /* not selectable */ }
    }
    return true
  }

  var INSERTS = { insertText: 1, insertReplacementText: 1, insertFromPaste: 1, insertFromDrop: 1 }
  window.addEventListener('beforeinput', function (e) {
    var el = e.target
    if (!e.cancelable || e.isComposing || !INSERTS[e.inputType] || !scoped(el)) return
    var d = e.data
    if (d == null && e.dataTransfer) { try { d = e.dataTransfer.getData('text/plain') } catch (x) { d = null } }
    if (!d || !ANY.test(d)) return
    var w = west(d)
    e.preventDefault()
    if (w === '') return   // a lone thousands separator: nothing to insert
    var ok = false
    try { ok = document.activeElement === el && document.execCommand('insertText', false, w) } catch (x) { ok = false }
    if (ok) return
    if (el.type === 'number') SET.call(el, el.value + w)
    else {
      try { el.setRangeText(w, el.selectionStart, el.selectionEnd, 'end') } catch (x) { SET.call(el, el.value + w) }
    }
    fire(el)
  }, true)

  window.addEventListener('input', function (e) {
    var el = e.target
    if (!scoped(el)) return
    if (e.isComposing) {
      // Hold it back from React and every overlay until the IME is done —
      // but only once the composition actually holds a digit to convert, so
      // an ordinary composition behaves exactly as it always did.
      if (el.__spHeld || ANY.test(el.value)) { el.__spHeld = true; e.stopImmediatePropagation() }
      return
    }
    fix(el)
  }, true)

  window.addEventListener('compositionend', function (e) {
    var el = e.target
    if (!scoped(el)) return
    var changed = fix(el)
    if (changed || el.__spHeld) { el.__spHeld = false; fire(el) }
  }, true)
})()
