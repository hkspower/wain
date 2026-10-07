/* Checkout, 2026-10-07: a summary bar above the form on phones and tablets.
   The page's own order summary sits BELOW the whole form (and carries the payment choice), so a
   shopper typed an address before seeing what they were paying. This adds a collapsed bar at the top
   — the card's own heading, item count and total — that opens to the same items, delivery and total.
   Everything shown is COPIED from the card, never typed here, so it follows the language, the
   discount and the delivery fee on its own. Never moves or edits React's nodes: one wrapper is added
   as the form's first item and removed again if the page leaves /checkout or the card's shape is not
   the one this expects (then it does nothing at all). From 1024px the page is two columns with the
   summary beside the form, and the bar is hidden by css/80-checkout-polish.css.
   Built with createElement/cloneNode only (test:xss-guard). */
(function () {
  var KEY = 'data-sporta-co-summary'
  var open = false
  var lastSig = ''

  function card() { return document.querySelector('form > aside > div') }

  function parts(c) {
    if (!c || c.children.length < 5) return null
    var h2 = c.querySelector(':scope > h2')
    var ul = c.querySelector(':scope > ul')
    var rows = [].slice.call(c.children).filter(function (k) { return k.tagName === 'DIV' && k.querySelector(':scope > span.text-accent') })
    var total = rows[0]
    if (!h2 || !ul || !total) return null
    var delivery = total.previousElementSibling
    var title = (h2.firstChild && h2.firstChild.nodeType === 3 ? h2.firstChild.textContent : '').trim()
    var count = (h2.querySelector('span') || {}).textContent || ''
    var amount = (total.lastElementChild || {}).textContent || ''
    if (!title || !amount) return null
    return { ul: ul, delivery: delivery && delivery.tagName === 'DIV' ? delivery : null, total: total, title: title, count: count.trim(), amount: amount }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function build(p) {
    var w = el('div', 'cos')
    w.setAttribute(KEY, '1')
    var btn = el('button', 'cos-bar')
    btn.type = 'button'
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    var left = el('span', 'cos-left')
    left.appendChild(el('strong', 'cos-title', p.title))
    if (p.count) left.appendChild(el('span', 'cos-count', p.count))
    btn.appendChild(left)
    var right = el('span', 'cos-right')
    right.appendChild(el('span', 'cos-amount', p.amount))
    right.appendChild(el('span', 'cos-chev'))
    btn.appendChild(right)
    var panel = el('div', 'cos-panel')
    panel.hidden = !open
    panel.appendChild(p.ul.cloneNode(true))
    if (p.delivery) panel.appendChild(p.delivery.cloneNode(true))
    panel.appendChild(p.total.cloneNode(true))
    btn.addEventListener('click', function () {
      open = !open
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      panel.hidden = !open
    })
    w.appendChild(btn); w.appendChild(panel)
    return w
  }

  function sync() {
    var cur = document.querySelector('[' + KEY + ']')
    if (location.pathname.replace(/\/$/, '') !== '/checkout') { if (cur) cur.remove(); lastSig = ''; return }
    var form = document.querySelector('main form')
    var p = parts(card())
    if (!form || !p) { if (cur) cur.remove(); lastSig = ''; return }
    var sig = [p.title, p.count, p.amount, p.ul.textContent, p.delivery ? p.delivery.textContent : '', document.documentElement.lang].join('|')
    if (cur && cur.parentNode === form && form.firstElementChild === cur && sig === lastSig) return
    if (cur) cur.remove()
    form.insertBefore(build(p), form.firstChild)
    lastSig = sig
  }

  var t = 0
  function tick() { if (t) return; t = setTimeout(function () { t = 0; sync() }, 80) }
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  sync()
})()
