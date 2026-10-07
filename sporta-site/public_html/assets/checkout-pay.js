/* Checkout payment methods — 2026-10-07. A small picture per method, a pay button
   that names the chosen one, and a trust line under the list. Never edits React's
   nodes: icons and the trust line are siblings it adds, and the button's new words
   are a data attribute drawn by CSS (css/74-checkout-pay.css). Built with
   createElement only (test:xss-guard). */
(function () {
  var NS = 'http://www.w3.org/2000/svg'
  var ORIG = ['Pay with KNET / CBK', 'ادفع عبر كي نت / CBK']
  var WORDS = {
    knet: ['Pay with KNET', 'ادفع عبر كي نت'],
    tpay: ['Pay with T-Pay', 'ادفع عبر تي باي']
  }
  var TRUST = ['Secure payment — your card details go to the bank, never to Sporta.',
    'دفع آمن — بيانات بطاقتك تذهب إلى البنك مباشرة، ولا تصل إلى سبورتا.']
  function ar() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'ar' }
  function el(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e }
  function svg(w) { return el('svg', { width: w, height: 24, viewBox: '0 0 ' + w + ' 24', 'aria-hidden': 'true', 'class': 'cpay-icon' }) }
  function icon(kind) {
    var s
    if (kind === 'knet') {
      s = svg(44)
      s.appendChild(el('rect', { x: 0.5, y: 0.5, width: 43, height: 23, rx: 4, fill: '#0b4ea2' }))
      var t = el('text', { x: 22, y: 16, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff', 'font-family': 'Arial, sans-serif' })
      t.textContent = 'KNET'; s.appendChild(t)
    } else if (kind === 'tpay') {
      s = svg(24)
      var d = 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 19h2v2h-2zM19 14h2v2h-2z'
      s.appendChild(el('path', { d: d, fill: 'none', stroke: '#171a1e', 'stroke-width': 1.6 }))
    } else if (kind === 'cod') {
      s = svg(32)
      s.appendChild(el('rect', { x: 1, y: 5, width: 30, height: 14, rx: 2, fill: 'none', stroke: '#11703f', 'stroke-width': 1.8 }))
      s.appendChild(el('circle', { cx: 16, cy: 12, r: 3.5, fill: 'none', stroke: '#11703f', 'stroke-width': 1.8 }))
    }
    if (s) s.setAttribute('data-cpay-icon', kind)
    return s
  }
  function lock() {
    var s = el('svg', { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': 'true' })
    s.appendChild(el('rect', { x: 4, y: 10, width: 16, height: 11, rx: 2, fill: 'currentColor' }))
    s.appendChild(el('path', { d: 'M8 10V7a4 4 0 0 1 8 0v3', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }))
    return s
  }
  function apply() {
    var radios = document.querySelectorAll('input[name="paymethod"]')
    if (!radios.length) return
    var a = ar() ? 1 : 0, chosen = null
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i], label = r.closest('label')
      if (r.checked) chosen = r.value
      if (label && !label.querySelector('[data-cpay-icon]')) { var ic = icon(r.value); if (ic) label.appendChild(ic) }
    }
    var box = radios[0].closest('label') && radios[0].closest('label').parentNode
    if (box) {
      var tr = box.nextElementSibling
      if (!tr || !tr.classList.contains('cpay-trust')) {
        tr = document.createElement('p'); tr.className = 'cpay-trust'
        tr.appendChild(lock()); tr.appendChild(document.createElement('span'))
        box.parentNode.insertBefore(tr, box.nextSibling)
      }
      var sp = tr.lastChild
      if (sp.textContent !== TRUST[a]) sp.textContent = TRUST[a]
    }
    var btns = document.querySelectorAll('button')
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j], txt = (b.textContent || '').trim()
      if (ORIG.indexOf(txt) === -1) { if (b.hasAttribute('data-cpay-label')) b.removeAttribute('data-cpay-label'); continue }
      var w = chosen && WORDS[chosen] ? WORDS[chosen][a] : null
      if (!w) { if (b.hasAttribute('data-cpay-label')) b.removeAttribute('data-cpay-label'); continue }
      if (b.getAttribute('data-cpay-label') !== w) b.setAttribute('data-cpay-label', w)
      if (b.getAttribute('aria-label') !== w) b.setAttribute('aria-label', w)
    }
  }
  var queued = false
  function later() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; apply() }) }
  document.addEventListener('change', function (e) { if (e.target && e.target.name === 'paymethod') apply() }, true)
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] })
  apply()
})()
