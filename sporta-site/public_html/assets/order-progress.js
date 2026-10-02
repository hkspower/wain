/**
 * Order progress — where the parcel is, as five steps: Order placed → Confirmed → Packed → On the way →
 * Delivered. Drawn on /track under the bundle's own result card, and offered to the account sheet
 * (customer-account.js) as window.SportaOrderProgress.
 *
 * WHY: the track page asked ?r=status and showed "Paid" and an amount, so an order already out with the
 * driver looked exactly like one nobody had touched. ?r=status now also returns fulfilment_status and
 * the order's own timestamps (no personal data — see api.php), and this turns them into steps.
 *
 * THE STEP RULES, from the order's own columns and nothing guessed:
 *   placed     always done (created_at)
 *   confirmed  paid online (paid_at), or cash on delivery that has not failed — COD is confirmed when it
 *              is placed, its payment is the driver's to take
 *   packed / shipped / delivered   fulfilment_status, in that order; delivered carries fulfilled_at
 *   cancelled, or an online payment that failed, is said in words instead of a half-filled bar.
 * Text is set with textContent only.
 */
(function () {
  'use strict'
  var T = {
    title: ['Order progress', 'حالة الطلب'],
    placed: ['Order placed', 'تم استلام الطلب'], confirmed: ['Confirmed', 'تم التأكيد'],
    packed: ['Packed', 'تم التغليف'], shipped: ['On the way', 'في الطريق'], delivered: ['Delivered', 'تم التسليم'],
    cod: ['Pay the driver on delivery', 'الدفع للسائق عند الاستلام'], paid: ['Paid', 'مدفوع'],
    awaiting: ['Waiting for payment', 'بانتظار الدفع'], review: ['Payment being checked', 'الدفع قيد المراجعة'],
    cancelled: ['This order was cancelled.', 'تم إلغاء هذا الطلب.'],
    failed: ['The payment did not go through, so this order was not confirmed. You can order again — nothing was charged.', 'لم تتم عملية الدفع، لذلك لم يتم تأكيد الطلب. يمكنك الطلب من جديد — لم يُخصم أي مبلغ.'],
    now: ['Now', 'الآن'],
  }
  var STEPS = ['placed', 'confirmed', 'packed', 'shipped', 'delivered']
  function ar() { return document.documentElement.lang === 'ar' }
  function t(k) { return (T[k] || [k, k])[ar() ? 1 : 0] }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  function when(s) {
    if (!s) return ''
    var d = new Date(String(s).replace(' ', 'T'))
    if (isNaN(d)) return ''
    return d.toLocaleString(ar() ? 'ar-KW' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  /* where the order is: an index into STEPS, or a word when it is not on the line at all */
  function state(o) {
    var f = o.fulfilment_status || 'unfulfilled', pay = o.payment_status, cod = o.payment_method === 'cod'
    if (f === 'cancelled') return { stop: 'cancelled' }
    if (!cod && pay === 'failed') return { stop: 'failed' }
    var confirmed = pay === 'paid' || (cod && pay !== 'failed')
    var at = f === 'delivered' ? 4 : f === 'shipped' ? 3 : f === 'packed' ? 2 : confirmed ? 1 : 0
    return { at: at, confirmed: confirmed, cod: cod, pay: pay }
  }

  /* compact = the five dots only, for the account sheet's order rows */
  function render(o, compact) {
    var s = state(o)
    var box = el('div', 'op' + (compact ? ' op--compact' : ''))
    box.setAttribute('data-order-progress', '')
    if (!compact) box.appendChild(el('h3', 'op-title', t('title')))
    if (s.stop) { box.appendChild(el('p', 'op-stop', t(s.stop))); box.setAttribute('data-op-state', s.stop); return box }
    box.setAttribute('data-op-state', STEPS[s.at])
    var ol = el('ol', 'op-steps'); ol.setAttribute('aria-label', t('title'))
    STEPS.forEach(function (k, i) {
      var li = el('li', 'op-step' + (i < s.at ? ' op-done' : i === s.at ? ' op-now' : ''))
      if (i === s.at) li.setAttribute('aria-current', 'step')
      li.appendChild(el('span', 'op-dot', i < s.at || (i === s.at && k === 'delivered') ? '✓' : ''))
      var tx = el('span', 'op-tx')
      tx.appendChild(el('b', '', t(k)))
      if (!compact) {
        var sub = ''
        if (k === 'placed') sub = when(o.created_at)
        else if (k === 'confirmed') sub = s.cod ? t('cod') : s.pay === 'paid' ? (t('paid') + (o.paid_at ? ' · ' + when(o.paid_at) : '')) : s.pay === 'review' ? t('review') : t('awaiting')
        else if (k === 'delivered' && s.at === 4) sub = when(o.fulfilled_at)
        else if (i === s.at) sub = t('now')
        if (sub) tx.appendChild(el('small', '', sub))
      }
      li.appendChild(tx)
      ol.appendChild(li)
    })
    box.appendChild(ol)
    return box
  }
  window.SportaOrderProgress = { render: render, state: state }

  /* ---- /track: draw it under the bundle's result card ---- */
  var lastId = '', busy = false
  function onTrack() {
    if (!/^\/track\/?$/.test(location.pathname)) return
    var input = document.querySelector('main form input')
    var holder = document.querySelector('main section > div.mt-8')
    if (!input || !holder) return
    var id = (input.value || '').trim()
    var card = holder.firstElementChild
    var shown = holder.querySelector('[data-order-progress]')
    var found = card && !card.matches('p, .skeleton') && card.textContent.indexOf(id) !== -1 && id
    if (!found) { if (shown) shown.remove(); lastId = ''; return }
    if (shown && lastId === id) return
    if (busy) return
    busy = true
    fetch('/api/api.php?r=status&id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (o) {
        busy = false
        if (!o) return
        var old = holder.querySelector('[data-order-progress]'); if (old) old.remove()
        holder.appendChild(render(o, false))
        lastId = id
      })
      .catch(function () { busy = false })
  }

  var CSS = '.op{margin-top:14px;padding:16px 18px;border-radius:16px;background:var(--sp-tile,rgba(255,255,255,.05));border:1px solid var(--sp-line,rgba(255,255,255,.1));color:var(--sp-text,#dbdfe4)}'
    + '.op-title{margin:0 0 12px;font-family:Alexandria,"IBM Plex Sans Arabic",system-ui,sans-serif!important;font-size:15px!important;font-weight:700!important;letter-spacing:0!important;line-height:1.3;color:var(--sp-text,#fff)}'
    + '.op-steps{list-style:none;margin:0;padding:0;display:grid;gap:0}'
    + '.op-step{position:relative;display:flex;gap:12px;align-items:flex-start;padding:0 0 16px}'
    + '.op-step:last-child{padding-bottom:0}'
    + '.op-step:not(:last-child)::before{content:"";position:absolute;inset-inline-start:11px;top:24px;bottom:0;width:2px;background:var(--sp-line,rgba(255,255,255,.14))}'
    + '.op-done:not(:last-child)::before{background:var(--brand,#e0561c)}'
    + '.op-dot{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font:700 13px/1 system-ui;color:#fff;border:2px solid rgba(255,255,255,.25);background:#14161a}'
    + '.op-done .op-dot{background:var(--brand,#e0561c);border-color:var(--brand,#e0561c)}'
    + '.op-now .op-dot{border-color:var(--brand,#e0561c);box-shadow:0 0 0 4px rgba(224,86,28,.25)}'
    + '.op-tx{display:flex;flex-direction:column;gap:2px;padding-top:2px}'
    + '.op-tx b{font-size:14.5px;font-weight:700;color:var(--sp-silver,#9aa1a9)}.op-done .op-tx b,.op-now .op-tx b{color:var(--sp-text,#fff)}'
    + '.op-tx small{font-size:12.5px;color:var(--sp-silver,#9aa1a9)}'
    + '.op-stop{margin:0;font-size:14.5px;line-height:1.6;color:var(--sp-bad,#ffb4a8)}'
    + '.op--compact{margin-top:6px;padding:0;background:none;border:0}'
    + '.op--compact .op-steps{display:flex;gap:0;align-items:center}'
    + '.op--compact .op-step{flex:1;padding:0;flex-direction:column;align-items:center;gap:4px}'
    + '.op--compact .op-step:not(:last-child)::before{inset-inline-start:calc(50% + 9px);inset-inline-end:calc(-50% + 9px);width:auto;top:8px;bottom:auto;height:2px}'
    + '.op--compact .op-dot{width:16px;height:16px;font-size:9px;border-width:2px}'
    + '.op--compact .op-tx b{font-size:10.5px;font-weight:600;text-align:center}'
    + '.op--compact .op-stop{font-size:12.5px}'
  if (!document.getElementById('op-css')) { var st = document.createElement('style'); st.id = 'op-css'; st.textContent = CSS; document.head.appendChild(st) }

  var q = null
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; onTrack() }, 150) }).observe(document.documentElement, { childList: true, subtree: true })
  onTrack()
})()
