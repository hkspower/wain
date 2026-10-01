/**
 * Checkout fields: live hints, the optional ones tucked away, easier flow.
 * Only on /checkout, and only ADDS to what the bundle draws — it never changes a
 * request, a rule or a stored value except one thing it says so about: a phone
 * number pasted with +965, spaces or Arabic digits is tidied to the 8 digits.
 *
 *  1. LIVE HINTS. Each required field says what is wrong, in plain words, once
 *     the shopper has left it (not while they are still typing the first time),
 *     and shows a tick when it is right. The rules are the SERVER'S (api.php →
 *     store_phone / store_text: name 2-80, area 2-60, block 1-12, street 1-40,
 *     building 1-24, phone [569]xxxxxxx, email required), so a hint never says
 *     "fine" to something the order route then refuses. When the bundle's own
 *     error for the field is on screen (#e-<field>) this stays silent.
 *  2. FEWER FIELDS UP FRONT. Floor, flat and the delivery note are optional;
 *     they sit behind one "Add floor, flat or a note" button, open at once if
 *     the form already holds a value for them (a saved address) or if an error
 *     points at one. They stay in the page, so the bundle still sends them.
 *  3. FLOW. Choosing a governorate moves to Area, choosing an area moves to Block.
 *     The Remember box is the bundle's and untouched: nothing is kept without
 *     the shopper's tick, as the privacy page says.
 */
(function () {
  'use strict'
  // Checked on EVERY pass, not once at load: the shop is a single-page app, and "Buy now" or the
  // bag reaches /checkout without a page load, so a test made when this file first ran would
  // never see the checkout at all.
  function onCheckout() { return /^\/checkout(\/|$)/.test(location.pathname) }

  var ar = function () { return document.documentElement.lang === 'ar' }
  var MSG = {
    name: ['Enter your full name (at least 2 letters)', 'اكتب اسمك الكامل (حرفان على الأقل)'],
    phone: ['Kuwaiti mobile: 8 digits starting with 5, 6 or 9', 'رقم موبايل كويتي: ٨ أرقام يبدأ بـ ٥ أو ٦ أو ٩'],
    email: ['Enter a valid email, like name@example.com', 'اكتب بريدًا صحيحًا مثل name@example.com'],
    area: ['Choose or type your area', 'اختر منطقتك أو اكتبها'],
    block: ['Enter your block', 'اكتب رقم القطعة'],
    street: ['Enter your street', 'اكتب اسم الشارع'],
    building: ['Enter the house or building number', 'اكتب رقم المنزل أو المبنى'],
  }
  var MORE = ['Add floor, flat or a delivery note', 'أضف الدور أو الشقة أو ملاحظة للتوصيل']

  function ascii(s) {
    return String(s).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660) })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0) })
  }
  /* The server's store_phone(): digits only, an optional 00965 / 965 prefix, then [569] + 7 digits. */
  function phoneDigits(v) {
    var d = ascii(v).replace(/\D/g, '')
    if (d.indexOf('00965') === 0) d = d.slice(5)
    else if (d.length > 8 && d.indexOf('965') === 0) d = d.slice(3)
    return d
  }
  var RULES = {
    name: function (v) { var n = v.trim().length; return n >= 2 && n <= 80 },
    phone: function (v) { return /^[569]\d{7}$/.test(phoneDigits(v)) },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) && v.length <= 120 },
    area: function (v) { var n = v.trim().length; return n >= 2 && n <= 60 },
    block: function (v) { var n = v.trim().length; return n >= 1 && n <= 12 },
    street: function (v) { var n = v.trim().length; return n >= 1 && n <= 40 },
    building: function (v) { var n = v.trim().length; return n >= 1 && n <= 24 },
  }
  window.__sportaCheckoutRules = { phoneDigits: phoneDigits, rules: RULES }   // for the parity test

  var touched = {}

  function box(field) {
    var l = document.querySelector('label[for="f-' + field + '"]')
    return l ? l.parentElement : null
  }

  function paint(field) {
    var input = document.getElementById('f-' + field), c = box(field)
    if (!input || !c) return
    var msg = c.querySelector(':scope > [data-cf-msg]')
    if (!msg) { msg = document.createElement('p'); msg.setAttribute('data-cf-msg', ''); msg.setAttribute('role', 'status'); c.appendChild(msg) }
    var has = input.value.length > 0
    var ok = RULES[field](input.value)
    var bundleErr = document.getElementById('e-' + field)
    var state = ''
    if (ok && has) state = 'ok'
    else if (touched[field] && !bundleErr) state = 'bad'
    if (state) c.setAttribute('data-cf', state); else c.removeAttribute('data-cf')
    msg.className = 'cf-msg' + (state ? ' cf-' + state : '')
    msg.textContent = state === 'ok' ? '✓' : state === 'bad' ? MSG[field][ar() ? 1 : 0] : ''
    msg.hidden = !state
  }

  function setValue(input, v) {
    var set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
    set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  document.addEventListener('input', function (e) {
    if (!onCheckout()) return
    var id = e.target && e.target.id
    if (!id || id.indexOf('f-') !== 0) return
    var f = id.slice(2)
    if (RULES[f]) paint(f)
  }, true)
  document.addEventListener('focusout', function (e) {
    if (!onCheckout()) return
    var id = e.target && e.target.id
    if (!id || id.indexOf('f-') !== 0) return
    var f = id.slice(2)
    if (!RULES[f]) return
    if (f === 'phone') {
      var d = phoneDigits(e.target.value)
      if (d && d !== e.target.value && /^[569]\d{7}$/.test(d)) setValue(e.target, d)
    }
    touched[f] = true
    paint(f)
  }, true)

  /* ---- flow: governorate -> area -> block ---- */
  document.addEventListener('change', function (e) {
    if (onCheckout() && e.target && e.target.id === 'f-governorate' && e.target.value) {
      setTimeout(function () { var a = document.getElementById('f-area'); if (a && !a.value) a.focus() }, 60)
    }
  }, true)
  document.addEventListener('mousedown', function (e) {
    if (!onCheckout()) return
    var opt = e.target && e.target.closest && e.target.closest('[role="option"]')
    if (opt && document.getElementById('f-area') && opt.closest('div.relative')) {
      setTimeout(function () { var b = document.getElementById('f-block'); if (b && !b.value) b.focus() }, 120)
    }
  }, true)

  /* ---- optional fields behind one button ---- */
  function optionalParts() {
    var floor = document.getElementById('f-floor'), note = document.getElementById('f-note')
    if (!floor || !note) return null
    return { grid: floor.closest('div.grid'), note: note.parentElement }
  }
  var opened = false
  function setOpen(open, parts) {
    opened = open
    parts.grid.classList.toggle('cf-collapsed', !open)
    parts.note.classList.toggle('cf-collapsed', !open)
    var b = document.querySelector('[data-cf-more]')
    if (b) b.hidden = open
  }
  function tuck() {
    var parts = optionalParts()
    if (!parts || !parts.grid) return
    var btn = document.querySelector('[data-cf-more]')
    if (!btn) {
      btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('data-cf-more', ''); btn.className = 'cf-more'
      btn.addEventListener('click', function () { var p = optionalParts(); if (p) { setOpen(true, p); var f = document.getElementById('f-floor'); if (f) f.focus() } })
      parts.grid.parentNode.insertBefore(btn, parts.grid)
      parts.grid.setAttribute('data-cf-tucked', '')
      var filled = ['f-floor', 'f-flat', 'f-note'].some(function (id) { var e = document.getElementById(id); return e && e.value })
      opened = filled
    }
    btn.textContent = '+ ' + MORE[ar() ? 1 : 0]
    var needs = opened || ['e-floor', 'e-flat', 'e-note'].some(function (id) { return document.getElementById(id) })
      || ['f-floor', 'f-flat', 'f-note'].some(function (id) { var e = document.getElementById(id); return e && e.value })
    setOpen(needs, parts)
  }

  var t = null
  function again() {
    if (t) return
    t = setTimeout(function () {
      t = null
      if (!onCheckout()) return
      tuck()
      Object.keys(RULES).forEach(function (f) { if (touched[f] || (document.getElementById('f-' + f) || {}).value) paint(f) })
    }, 150)
  }
  new MutationObserver(again).observe(document.body, { childList: true, subtree: true })
  again()
})()
