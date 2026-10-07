/* Invoice preview on the order-confirmation page — 2026-10-07.
   /payment/result?trackid=… is where a shopper lands after ordering (and when the bank
   sends them back). This draws the whole invoice there, from ?r=invoice, with a
   Download PDF button to api/invoice-download.php. The order number in the URL is the
   key, as it is for /track and /invoice/<n>; ?r=invoice sends no phone number.
   Never edits React's nodes: one section is added before the page's button row and put
   back if React removes it. Built with createElement only (test:xss-guard). */
(function () {
  if (location.pathname.indexOf('/payment/result') !== 0) return
  var KEY = 'data-sporta-invoice-preview'
  var S = {
    title: ['Invoice', 'الفاتورة'],
    order: ['Order', 'رقم الطلب'],
    date: ['Date', 'التاريخ'],
    to: ['Delivery to', 'التوصيل إلى'],
    item: ['Item', 'المنتج'],
    size: ['Size', 'المقاس'],
    qty: ['Qty', 'الكمية'],
    total: ['Total', 'الإجمالي'],
    subtotal: ['Subtotal', 'المجموع الفرعي'],
    discount: ['Discount', 'الخصم'],
    delivery: ['Delivery', 'التوصيل'],
    free: ['Free', 'مجاني'],
    paid: ['Paid', 'مدفوع'],
    unpaid: ['Unpaid', 'غير مدفوع'],
    cod: ['Cash on delivery', 'الدفع عند الاستلام'],
    download: ['Download PDF', 'تحميل الفاتورة PDF'],
    loading: ['Loading your invoice…', 'جارٍ تحميل فاتورتك…']
  }
  var CUR = ['KWD', 'د.ك']
  function ar() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'ar' }
  function t(k) { return S[k][ar() ? 1 : 0] }
  function money(v) { return Number(v || 0).toFixed(3) + ' ' + CUR[ar() ? 1 : 0] }
  function h(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  var trackId = new URLSearchParams(location.search).get('trackid') || ''
  if (!trackId) return
  var data = null, busy = false, failed = false

  function fetchInvoice() {
    if (busy || data || failed) return
    busy = true
    fetch('/api/api.php?r=invoice&id=' + encodeURIComponent(trackId), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { if (j && j.track_id) data = j; else failed = true; busy = false; place() })
      .catch(function () { busy = false; failed = true; place() })
  }

  function row(label, value, cls) {
    var r = h('div', 'ivp-row' + (cls ? ' ' + cls : ''))
    r.appendChild(h('span', null, label)); r.appendChild(h('span', 'ivp-num', value))
    return r
  }

  function build() {
    var d = data, a = ar()
    var s = h('section', 'ivp')
    s.setAttribute(KEY, trackId + '|' + (a ? 'ar' : 'en'))
    s.setAttribute('dir', a ? 'rtl' : 'ltr')
    var head = h('div', 'ivp-head')
    head.appendChild(h('strong', 'ivp-title', 'Sporta · ' + t('title')))
    var paid = !!d.paid_at || d.payment_status === 'paid'
    var chip = h('span', 'ivp-chip ' + (paid ? 'ivp-paid' : 'ivp-unpaid'),
      paid ? t('paid') : (d.payment_method === 'cod' ? t('cod') : t('unpaid')))
    head.appendChild(chip)
    s.appendChild(head)
    var meta = h('div', 'ivp-meta')
    meta.appendChild(row(t('order'), d.track_id))
    if (d.placed_at) {
      var when = new Date(String(d.placed_at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(d.placed_at) ? '' : 'Z'))
      if (!isNaN(when)) {
        try { meta.appendChild(row(t('date'), new Intl.DateTimeFormat(a ? 'ar-KW-u-nu-latn' : 'en-KW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(when))) } catch (e) {}
      }
    }
    s.appendChild(meta)
    var ad = d.address || {}
    var parts = [ad.governorate, ad.area, ad.block && ((a ? 'قطعة ' : 'Block ') + ad.block), ad.street && ((a ? 'شارع ' : 'Street ') + ad.street),
      ad.building && ((a ? 'مبنى ' : 'Bldg ') + ad.building), ad.floor && ((a ? 'دور ' : 'Floor ') + ad.floor), ad.flat && ((a ? 'شقة ' : 'Flat ') + ad.flat)]
      .filter(Boolean)
    if (d.customer_name || parts.length) {
      var to = h('div', 'ivp-to')
      to.appendChild(h('div', 'ivp-label', t('to')))
      if (d.customer_name) to.appendChild(h('div', 'ivp-name', d.customer_name))
      if (parts.length) to.appendChild(h('div', null, parts.join('، ')))
      s.appendChild(to)
    }
    var table = h('div', 'ivp-items')
    var th = h('div', 'ivp-it ivp-th')
    ;[t('item'), t('size'), t('qty'), t('total')].forEach(function (x) { th.appendChild(h('span', null, x)) })
    table.appendChild(th)
    ;(d.items || []).forEach(function (it) {
      var r = h('div', 'ivp-it')
      var nm = (a ? it.name_ar : it.name_en) || it.name_en || it.name_ar || ''
      r.appendChild(h('span', 'ivp-nm', nm))
      r.appendChild(h('span', null, it.size || '—'))
      r.appendChild(h('span', 'ivp-num', String(it.qty)))
      r.appendChild(h('span', 'ivp-num', money(it.line_total)))
      table.appendChild(r)
    })
    s.appendChild(table)
    var sum = h('div', 'ivp-sum')
    var sub = d.subtotal || (d.items || []).reduce(function (n, i) { return n + i.line_total }, 0)
    sum.appendChild(row(t('subtotal'), money(sub)))
    if (d.discount_amount > 0) sum.appendChild(row(t('discount') + (d.discount_label ? ' (' + d.discount_label + ')' : ''), '−' + money(d.discount_amount)))
    sum.appendChild(row(t('delivery'), d.delivery_fee > 0 ? money(d.delivery_fee) : t('free')))
    sum.appendChild(row(t('total'), money(d.amount), 'ivp-grand'))
    s.appendChild(sum)
    var dl = h('a', 'ivp-dl', t('download'))
    dl.href = '/api/invoice-download.php?id=' + encodeURIComponent(trackId)
    dl.setAttribute('download', '')
    dl.setAttribute('rel', 'noopener')
    s.appendChild(dl)
    return s
  }

  function place() {
    var host = document.querySelector('main div.mx-auto.max-w-md') || (document.querySelector('h1') || {}).parentNode
    if (!host) return
    var key = trackId + '|' + (ar() ? 'ar' : 'en')
    var cur = document.querySelector('[' + KEY + ']')
    if (failed) { if (cur) cur.remove(); return }
    if (!data) {
      if (!cur) { var sk = h('section', 'ivp ivp-wait', t('loading')); sk.setAttribute(KEY, 'wait'); sk.setAttribute('aria-busy', 'true'); insert(host, sk) }
      return fetchInvoice()
    }
    if (cur && cur.getAttribute(KEY) === key && cur.parentNode === host) return
    if (cur) cur.remove()
    insert(host, build())
  }
  function insert(host, node) {
    var rowBtns = host.querySelector(':scope > div.mt-6')
    if (rowBtns) host.insertBefore(node, rowBtns); else host.appendChild(node)
  }

  var t0 = 0
  function tick() { if (t0) return; t0 = setTimeout(function () { t0 = 0; place() }, 60) }
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] })
  place()
})()
