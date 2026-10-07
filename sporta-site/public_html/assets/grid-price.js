/* Grid prices: reads each card's price into the attributes css/76-grid-price.css draws from (2026-10-07).
   The bundle's price is one text node ("KWD 10.000" / "١٠٫٠٠٠ د.ك") that React owns, so nothing is moved,
   wrapped or removed: this only writes data- attributes, and only when they differ. It also gives a struck
   old price its saving ("-20%"), worked out from the two figures on the card. */
(function () {
  var DIG = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 }
  var NUM = /[0-9٠-٩۰-۹][0-9٠-٩۰-۹.,٫٬]*/
  function value(s) {
    var m = NUM.exec(s || ''); if (!m) return null
    var t = ''
    for (var i = 0; i < m[0].length; i++) { var c = m[0].charAt(i); if (c >= '0' && c <= '9') t += c; else if (DIG[c] !== undefined) t += DIG[c]; else if (c === '٫' || c === '.') t += '.'; }
    var v = parseFloat(t); return isNaN(v) ? null : v
  }
  function set(el, k, v) { if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k) } else if (el.getAttribute(k) !== v) el.setAttribute(k, v) }
  function one(price) {
    var tn = null
    for (var c = price.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) { tn = c; break }
    if (!tn) return
    var text = tn.nodeValue.replace(/[‎‏؜]/g, '').trim()
    var m = NUM.exec(text); if (!m) { set(price, 'data-gp', null); return }
    var before = text.slice(0, m.index).trim(), after = text.slice(m.index + m[0].length).trim()
    var parts = [], pn
    if (before) parts.push(before)
    parts.push(m[0]); pn = parts.length
    if (after) parts.push(after)
    if (parts.length !== 2) { set(price, 'data-gp', null); return }
    set(price, 'data-p1', parts[0]); set(price, 'data-p2', parts[1]); set(price, 'data-pn', String(pn)); set(price, 'data-gp', '')
    var s = price.querySelector(':scope > s, :scope > del')
    if (!s) return
    var now = value(text), was = value(s.textContent), pct = (now !== null && was) ? Math.round((1 - now / was) * 100) : 0
    if (pct >= 1 && pct <= 99) {
      var ar = (document.documentElement.lang || 'ar').slice(0, 2) === 'ar'
      var f = new Intl.NumberFormat(ar ? 'ar-KW' : 'en', { style: 'percent', maximumFractionDigits: 0 }).format(pct / 100)
      set(s, 'data-off', '−' + f)
    } else set(s, 'data-off', null)
  }
  var queued = false
  function run() {
    queued = false
    var els = document.querySelectorAll('main article .price-card')
    for (var i = 0; i < els.length; i++) one(els[i])
  }
  function later() { if (!queued) { queued = true; requestAnimationFrame(run) } }
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  later()
})()
