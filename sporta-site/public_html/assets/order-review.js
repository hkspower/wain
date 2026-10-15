/**
 * Review your order — a sheet shown before EVERY order is placed (2026-10-15, "make preview order
 * before submit order"). The owner chose a pop-up sheet, for card, T-Pay and cash orders alike.
 *
 * WHERE IT STEPS IN. The checkout is the bundle's React form, with no source here. Its submit
 * handler validates the fields first and only then calls ?r=order. So this waits for THAT request:
 * by the time it is sent, every field has passed the shop's own checks, and the sheet never opens
 * over a form that still has mistakes in it. The request is held while the sheet is open:
 *   - "Confirm and pay" sends it unchanged, so the order is exactly the one the form built;
 *   - "Edit" (or Escape, or the backdrop) answers the form with a refusal named review_cancelled,
 *     which the form treats like any refusal — it stops being busy and the shopper is back on the
 *     page with everything they typed. The form's generic error line for that one case is hidden.
 *
 * WHAT IT SHOWS comes from the request itself (items, name, phone, address, payment method,
 * discount code) and the totals from ?r=discount — the server's own quote, computed by the same
 * code that will charge, so the total on the sheet is the total charged. If that quote cannot be
 * had (an item just sold out, say), the sheet is skipped and the order goes straight on, so the
 * form shows the server's own reason rather than a sheet with a wrong number.
 */
(function () {
  'use strict'
  if (!/^\/checkout\/?$/.test(location.pathname)) return

  var MARK = 'data-order-review'
  var CANCELLED = 'data-order-review-cancelled'
  var ar = function () { return (document.documentElement.getAttribute('lang') || 'ar').indexOf('ar') === 0 }
  var T = {
    title: ['Review your order', 'راجع طلبك'],
    items: ['Items', 'المنتجات'],
    to: ['Deliver to', 'التوصيل إلى'],
    pay: ['Payment', 'طريقة الدفع'],
    subtotal: ['Items', 'المنتجات'], discount: ['Discount', 'الخصم'], delivery: ['Delivery', 'التوصيل'], total: ['Total', 'الإجمالي'],
    free: ['Free', 'مجاني'],
    edit: ['Edit', 'تعديل'], confirm: ['Confirm and pay', 'تأكيد والدفع'], confirmCod: ['Confirm order', 'تأكيد الطلب'],
    close: ['Close', 'إغلاق'], qty: ['Qty', 'الكمية'],
    knet: ['KNET', 'كي نت'], tpay: ['T-Pay (CBK)', 'تي-باي (CBK)'], cod: ['Cash on delivery', 'الدفع عند الاستلام'],
    floor: ['Floor', 'الطابق'], flat: ['Flat', 'الشقة'], block: ['Block', 'قطعة'], street: ['Street', 'شارع'], building: ['Building', 'مبنى'],
    note: ['Note', 'ملاحظة'],
  }
  function t(k) { return T[k] ? T[k][ar() ? 1 : 0] : k }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function money(v) {
    var n = Number(v) || 0
    try { return new Intl.NumberFormat(ar() ? 'ar-KW' : 'en-KW', { style: 'currency', currency: 'KWD', minimumFractionDigits: 3 }).format(n) }
    catch (e) { return 'KWD ' + n.toFixed(3) }
  }
  function digits(v) { return ar() ? String(v).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d] }) : String(v) }
  // The form sends 965XXXXXXXX (or the 8 digits); shown the way a Kuwaiti number is written.
  function phone(v) {
    var d = String(v || '').replace(/\D/g, '')
    if (d.length === 11 && d.indexOf('965') === 0) d = d.slice(3)
    return d.length === 8 ? '+965 ' + d.slice(0, 4) + ' ' + d.slice(4) : String(v || '')
  }
  function cart() { try { var c = JSON.parse(localStorage.getItem('sporta_cart') || '[]'); return Array.isArray(c) ? c : [] } catch (e) { return [] } }
  function optionText(id, value) {
    var s = document.getElementById(id)
    if (!s || !s.options) return value
    for (var i = 0; i < s.options.length; i++) if (s.options[i].value === value) return s.options[i].textContent.trim()
    return value
  }

  var CSS = '[' + MARK + ']{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,17,20,.55)}'
    + '@media (min-width:640px){[' + MARK + ']{align-items:center;padding:24px}}'
    + '.orv{width:100%;max-width:520px;max-height:92vh;overflow:auto;background:#fff;color:#171a1e;border-radius:20px 20px 0 0;padding:20px 20px 16px;box-shadow:0 -10px 40px rgba(0,0,0,.25);font:inherit}'
    + '@media (min-width:640px){.orv{border-radius:20px}}'
    + '.orv-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}'
    + '.orv-h h2{margin:0;font-size:20px;font-weight:800;color:#171a1e}'
    + '.orv-x{min-width:44px;min-height:44px;border:0;background:none;font-size:22px;line-height:1;color:#475569;cursor:pointer;border-radius:12px}'
    + '.orv-sec{border-top:1px solid #e5e7eb;padding:12px 0}'
    + '.orv-lab{font-size:12px;font-weight:700;color:#64748b;margin:0 0 6px;text-transform:none}'
    + '.orv-item{display:flex;gap:12px;align-items:center;padding:6px 0}'
    + '.orv-img{width:52px;height:52px;flex:0 0 52px;border-radius:10px;background:#f1f5f9 center/cover no-repeat}'
    + '.orv-name{font-weight:700;font-size:14px;line-height:1.35}'
    + '.orv-meta{font-size:13px;color:#475569}'
    + '.orv-line{margin-inline-start:auto;font-weight:700;font-size:14px;white-space:nowrap}'
    + '.orv-p{margin:0;font-size:14px;line-height:1.5}'
    + '.orv-row{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:2px 0}'
    + '.orv-tot{font-size:17px;font-weight:800;padding-top:6px}'
    + '.orv-acts{display:flex;gap:10px;padding-top:14px;position:sticky;bottom:-16px;background:#fff;padding-bottom:16px;margin-bottom:-16px}'
    + '.orv-edit{flex:0 0 auto;min-height:48px;padding:0 22px;border-radius:9999px;border:1.5px solid #171a1e;background:#fff;color:#171a1e;font:inherit;font-weight:700;cursor:pointer}'
    + '.orv-acts .btn{flex:1 1 auto;min-height:48px}'
    + '.orv button:focus-visible{outline:2px solid #171a1e;outline-offset:2px}'
    + 'html[' + CANCELLED + '] main form p[role=alert]{display:none!important}'

  var open = null
  function close(answer) {
    if (!open) return
    var o = open; open = null
    document.removeEventListener('keydown', o.onKey, true)
    o.box.remove()
    document.documentElement.style.overflow = o.overflow
    if (o.back && o.back.focus) try { o.back.focus() } catch (e) {}
    o.done(answer)
  }

  function show(body, quote) {
    return new Promise(function (resolve) {
      if (!document.getElementById('orv-css')) { var s = el('style'); s.id = 'orv-css'; s.textContent = CSS; document.head.appendChild(s) }
      var box = el('div'); box.setAttribute(MARK, '')
      var d = el('div', 'orv'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'orv-title')
      d.setAttribute('dir', ar() ? 'rtl' : 'ltr')
      var h = el('div', 'orv-h'); var h2 = el('h2', null, t('title')); h2.id = 'orv-title'
      var x = el('button', 'orv-x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('close'))
      h.appendChild(h2); h.appendChild(x); d.appendChild(h)

      // Items
      var lines = cart()
      var sec = el('div', 'orv-sec'); sec.appendChild(el('p', 'orv-lab', t('items')))
      ;(body.items || []).forEach(function (it) {
        var c = lines.filter(function (l) { return l.slug === it.slug && (l.size || null) === (it.size || null) && (l.fit || null) === (it.fit || null) })[0]
          || lines.filter(function (l) { return l.slug === it.slug })[0] || {}
        var row = el('div', 'orv-item')
        var img = el('div', 'orv-img'); if (c.image) img.style.backgroundImage = 'url("' + String(c.image).replace(/"/g, '%22') + '")'
        var mid = el('div'); mid.appendChild(el('div', 'orv-name', (c.name && (typeof c.name === 'object' ? (ar() ? c.name.ar : c.name.en) : c.name)) || it.slug))
        var meta = [it.size, it.fit && it.fit !== 'normal' ? it.fit : null].filter(Boolean).join(' · ')
        mid.appendChild(el('div', 'orv-meta', (meta ? meta + ' · ' : '') + t('qty') + ' ' + digits(it.qty || 1)))
        row.appendChild(img); row.appendChild(mid)
        if (c.price != null) row.appendChild(el('div', 'orv-line', money(Number(c.price) * (it.qty || 1))))
        sec.appendChild(row)
      })
      d.appendChild(sec)

      // Deliver to
      var cu = body.customer || {}
      var to = el('div', 'orv-sec'); to.appendChild(el('p', 'orv-lab', t('to')))
      var ph = el('bdi', null, phone(cu.phone)); ph.setAttribute('dir', 'ltr')
      var who = el('p', 'orv-p', (cu.name || '') + (cu.phone ? ' · ' : '')); if (cu.phone) who.appendChild(ph); to.appendChild(who)
      var addr = [cu.governorate ? optionText('f-governorate', cu.governorate) : '', cu.area,
        cu.block ? t('block') + ' ' + cu.block : '', cu.street ? t('street') + ' ' + cu.street : '',
        cu.building ? t('building') + ' ' + cu.building : '', cu.floor ? t('floor') + ' ' + cu.floor : '', cu.flat ? t('flat') + ' ' + cu.flat : '']
        .filter(function (v) { return v && String(v).trim() }).join(ar() ? '، ' : ', ')
      to.appendChild(el('p', 'orv-p', addr))
      if (cu.note) to.appendChild(el('p', 'orv-p orv-meta', t('note') + ': ' + cu.note))
      if (cu.email) to.appendChild(el('p', 'orv-p orv-meta', cu.email))
      d.appendChild(to)

      // Payment
      var pm = String(body.payment_method || 'knet')
      var pay = el('div', 'orv-sec'); pay.appendChild(el('p', 'orv-lab', t('pay'))); pay.appendChild(el('p', 'orv-p', t(pm)))
      d.appendChild(pay)

      // Totals — the server's own quote
      var tot = el('div', 'orv-sec')
      function row2(k, v, cls) { var r = el('div', 'orv-row' + (cls ? ' ' + cls : '')); r.appendChild(el('span', null, t(k))); r.appendChild(el('span', null, v)); tot.appendChild(r) }
      row2('subtotal', money(quote.subtotal))
      if (Number(quote.discount) > 0) row2('discount', '− ' + money(quote.discount))
      row2('delivery', Number(quote.delivery) > 0 ? money(quote.delivery) : t('free'))
      row2('total', money(quote.total), 'orv-tot')
      d.appendChild(tot)

      var acts = el('div', 'orv-acts')
      var edit = el('button', 'orv-edit', t('edit')); edit.type = 'button'
      var go = el('button', 'btn btn-primary', pm === 'cod' ? t('confirmCod') : t('confirm')); go.type = 'button'; go.setAttribute('data-orv-confirm', '')
      acts.appendChild(edit); acts.appendChild(go); d.appendChild(acts)
      box.appendChild(d)

      var o = { box: box, done: resolve, back: document.activeElement, overflow: document.documentElement.style.overflow }
      o.onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false) }
        if (e.key === 'Tab') {
          var f = [].slice.call(d.querySelectorAll('button:not([disabled])'))
          if (!f.length) return
          var first = f[0], last = f[f.length - 1]
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
      open = o
      x.addEventListener('click', function () { close(false) })
      edit.addEventListener('click', function () { close(false) })
      box.addEventListener('click', function (e) { if (e.target === box) close(false) })
      go.addEventListener('click', function () { go.disabled = true; edit.disabled = true; close(true) })
      document.addEventListener('keydown', o.onKey, true)
      document.documentElement.style.overflow = 'hidden'
      document.body.appendChild(box)
      go.focus()
    })
  }

  function cancelled() {
    document.documentElement.setAttribute(CANCELLED, '')
    return new Response(JSON.stringify({ error: 'review_cancelled' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  }
  // The next thing the shopper does lifts the hidden-alert rule, so a real refusal on the next try shows.
  ;['input', 'change', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!document.documentElement.hasAttribute(CANCELLED)) return
      if (e.target && e.target.closest && e.target.closest('[' + MARK + ']')) return
      document.documentElement.removeAttribute(CANCELLED)
    }, true)
  })

  // THE PAY BUTTON'S SPOKEN NAME FOLLOWS ITS TEXT (2026-10-15). The bundle labels it "Pay with KNET"
  // whatever is chosen, so with cash picked a screen reader announced KNET while the button read
  // "Place order — pay on delivery". An aria-label that disagrees with the visible text is dropped,
  // and the text becomes the name, as it is for every sighted shopper.
  function fixPayLabels() {
    var bs = document.querySelectorAll('main form button[type=submit][aria-label]')
    for (var i = 0; i < bs.length; i++) {
      var txt = bs[i].textContent.trim()
      if (txt && bs[i].getAttribute('aria-label') !== txt) bs[i].removeAttribute('aria-label')
    }
  }
  var lq = false
  new MutationObserver(function () { if (lq) return; lq = true; requestAnimationFrame(function () { lq = false; fixPayLabels() }) })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] })

  var base = window.fetch
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var method = (init && init.method) || (input && input.method) || 'GET'
    if (!/[?&]r=order(&|$)/.test(url) || String(method).toUpperCase() !== 'POST' || !init || typeof init.body !== 'string') {
      return base.apply(this, arguments)
    }
    var body
    try { body = JSON.parse(init.body) } catch (e) { return base.apply(this, arguments) }
    var self = this, args = arguments
    var quoteUrl = url.replace(/([?&]r=)order\b/, '$1discount')
    return base.call(window, quoteUrl, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: body.items || [], code: body.discount_code || '' }) })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
      .then(function (quote) {
        // No quote, no sheet: the order goes on and the form shows the server's own reason.
        if (!quote || typeof quote.total !== 'number') return base.apply(self, args)
        return show(body, quote).then(function (ok) { return ok ? base.apply(self, args) : cancelled() })
      })
  }
})()
