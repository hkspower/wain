/* Sporta — the storefront says what /backends says.
 *
 * Asked for on 2026-09-28 as "make backend full dynamic". The backend already
 * was: ten shop rules live in the `rules` settings row and both panels edit
 * them. The gap was the other direction — the storefront bundle has no source
 * here and states two of those rules as fixed copy, and never reads the list
 * of governorates the checkout offers. So the owner could change a rule and
 * the shop would go on saying, and offering, the old one. This fixes three:
 *
 *   RETURNS WINDOW  "14-day returns", "within 14 days", "خلال ١٤ يومًا" — some
 *                   two dozen strings across the home page, product page,
 *                   returns, terms and about pages — follow rules.return_days.
 *   DELIVERY FEE    "1 KWD" / "١ د.ك" follows rules.delivery_fee_fils, and says
 *                   "free" when the fee is zero rather than "0 KWD".
 *   GOVERNORATES    the checkout's governorate list offers only the ones the
 *                   shop delivers to. Before this, dropping one in /backends
 *                   left it on the list, and the customer filled in the whole
 *                   form before api.php refused it with invalid_governorate.
 *
 * AT THE DEFAULTS IT DOES NOTHING. With return_days 14, a 1.000 KWD fee and
 * all six governorates — the shipped values — every branch below returns
 * before touching the page, so this cannot change a shop whose owner has not
 * changed a rule. It reads the same ?r=slides the page already fetches.
 *
 * TEXT, NOT LOGIC. The server enforces every rule on its own (api.php); this
 * only makes the words and the list agree with it. If the fetch fails the page
 * is left exactly as the bundle drew it.
 *
 * THE CHECKOUT <select> BELONGS TO REACT, which shapes what is safe:
 *   - options are HIDDEN AND DISABLED, never removed. React reconciles those
 *     <option> nodes by key; deleting one it owns throws on its next update.
 *     `hidden` and `disabled` are attributes React does not manage, so they
 *     survive every re-render.
 *   - picking an AREA auto-fills the governorate (the bundle does that in its
 *     own change handler), which can land on a governorate that is switched
 *     off. When that happens the value is put back to "choose" through the
 *     select's own change event — the only way to move React's state rather
 *     than just the DOM — and a line under the field says why.
 *
 * NOT ON /backends. The panel has its own copy ("revenue · last 14 days")
 * that is not the returns window.
 */
;(function () {
  'use strict'

  var DEFAULT_DAYS = 14
  var DEFAULT_FEE = 1000
  var ALL_GOVS = 6

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var rules = null

  function arDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d] })
  }

  /* Arabic counts agree with the number: 1 and 2 have their own forms, 3-10
     take the plural, 11 and up the singular accusative. "خلال ٣ يومًا" is
     simply wrong Arabic, and it is what a plain digit swap would print. */
  function arDays(n) {
    if (n === 1) return 'يوم واحد'
    if (n === 2) return 'يومين'
    if (n >= 3 && n <= 10) return arDigits(n) + ' أيام'
    return arDigits(n) + ' يومًا'
  }

  function kwd(fils) {
    var v = fils / 1000
    return v % 1 === 0 ? String(v) : v.toFixed(3)
  }

  function textRules() {
    var out = []
    var n = rules.return_days
    if (typeof n === 'number' && n > 0 && n !== DEFAULT_DAYS) {
      out.push([/\b14-day\b/g, n + '-day'])
      out.push([/\b14 days\b/g, n === 1 ? '1 day' : n + ' days'])
      out.push([/\b14 day\b/g, n + ' day'])
      out.push([/١٤\s*(?:يومًا|يوماً|يوم)/g, arDays(n)])
    }
    var f = rules.delivery_fee_fils
    if (typeof f === 'number' && f >= 0 && f !== DEFAULT_FEE) {
      if (f === 0) {
        out.push([/delivery costs 1 KWD/g, 'delivery is free'])
        out.push([/ for 1 KWD/g, ', free of charge'])
        out.push([/\b1 KWD\b/g, 'free'])
        out.push([/رسوم التوصيل ١ د\.ك/g, 'التوصيل مجاني'])
        out.push([/مقابل ١ د\.ك/g, 'مجانًا'])
        out.push([/١ د\.ك/g, 'مجاني'])
      } else {
        out.push([/\b1 KWD\b/g, kwd(f) + ' KWD'])
        out.push([/١ د\.ك/g, arDigits(kwd(f)) + ' د.ك'])
      }
    }
    return out
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1 }

  function rewrite(root, subs) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        var p = t.parentNode
        if (!p || SKIP[p.nodeName] || p.isContentEditable) return NodeFilter.FILTER_REJECT
        return /14|١٤|1 KWD|١ د/.test(t.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    var t
    while ((t = w.nextNode())) {
      var v = t.nodeValue
      for (var i = 0; i < subs.length; i++) v = v.replace(subs[i][0], subs[i][1])
      // Only write when something changed — every write is a characterData
      // mutation, and the observer below would otherwise feed on its own tail.
      if (v !== t.nodeValue) t.nodeValue = v
    }
  }

  /* ---------------------------------------------------------------- checkout */

  var NOTE = 'data-sporta-gov-note'
  var nativeSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set

  function govNote(select, text) {
    var note = document.querySelector('[' + NOTE + ']')
    if (!text) { if (note) note.remove(); return }
    if (!note) {
      note = document.createElement('p')
      note.setAttribute(NOTE, '')
      note.setAttribute('role', 'status')
      note.style.cssText = 'margin:6px 2px 0;font-size:13px;line-height:1.5;color:#ffb59a'
      select.insertAdjacentElement('afterend', note)
    }
    note.textContent = text
  }

  function checkout() {
    var govs = rules.governorates
    if (!Array.isArray(govs) || !govs.length || govs.length >= ALL_GOVS) return
    var select = document.getElementById('f-governorate')
    if (!select) return
    var allowed = {}
    for (var i = 0; i < govs.length; i++) allowed[govs[i]] = true

    for (var j = 0; j < select.options.length; j++) {
      var o = select.options[j]
      if (!o.value) continue
      var off = !allowed[o.value]
      if (o.hidden !== off) o.hidden = off
      if (o.disabled !== off) o.disabled = off
    }

    var v = select.value
    if (v && !allowed[v]) {
      var label = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : v
      nativeSelectValue.call(select, '')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      var ar = document.documentElement.lang === 'ar'
      govNote(select, ar
        ? 'لا نوصّل إلى ' + label + ' حاليًا — اختر محافظة أخرى.'
        : 'We don’t deliver to ' + label + ' at the moment — please choose another governorate.')
    } else if (v) {
      govNote(select, '')
    }
  }

  /* --------------------------------------------------------------------- run */

  var subs = []
  var queued = false

  function apply() {
    queued = false
    if (!rules || location.pathname.indexOf('/backends') === 0) return
    if (subs.length) rewrite(document.body, subs)
    checkout()
  }

  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(apply)
  }

  fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (data) {
      // THE SLIDES SCREEN'S SIZE (2026-09-29, css/38-hero-size.css): the boot
      // script used the cached value; correct it here on a first visit or a
      // size just changed in /backends, and cache it for the next paint.
      var size = data && data.hero && data.hero.size
      if (size === 'short' || size === 'tall' || size === 'full') {
        var root = document.documentElement
        if (root.dataset.heroSize !== size) {
          root.dataset.heroSize = size
          root.style.setProperty('--hero-h', size === 'short' ? '8svh' : size === 'full' ? 'calc(100svh - 77px)' : '10svh')
          root.style.setProperty('--hero-h-md', size === 'short' ? '13svh' : size === 'full' ? 'calc(100svh - 98px)' : '18svh')
        }
        try { localStorage.setItem('sporta_hero_size', size) } catch (e) {}
      }
      if (!data || !data.rules) return
      rules = data.rules
      subs = textRules()
      var govs = rules.governorates
      var govsLimited = Array.isArray(govs) && govs.length > 0 && govs.length < ALL_GOVS
      // At the shipped defaults there is nothing to do, and nothing is watched.
      if (!subs.length && !govsLimited) return
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
      document.addEventListener('change', schedule, true)
      schedule()
    })
    .catch(function () { /* leave the page exactly as the bundle drew it */ })
})()
