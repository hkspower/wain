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
 *
 * LIVE TRACKING (2026-10-04): on /track the box polls ?r=status every ten seconds while the page is
 * visible and the order is still moving, and redraws only when the answer changed. Each step carries
 * its own time (packed_at, shipped_at). A carrier and number become a link to the carrier's page; the
 * shop's own driver becomes a map (Leaflet, self-hosted in /assets/leaflet, loaded only when there is
 * a position to show; tiles from tile.openstreetmap.org, allowed in the CSP's img-src). A shopper can
 * ask for the distance to themselves: their position stays in their browser and is never sent.
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
    courier: ['Carrier', 'شركة التوصيل'], trackWith: ['Track with', 'تتبّع مع'], ref: ['Tracking number', 'رقم التتبع'],
    mapTitle: ['Your delivery, live', 'توصيلك مباشرةً'], mapNote: ['The driver\'s position updates every few seconds while the order is on its way.', 'يتحدّث موقع السائق كل بضع ثوانٍ ما دام الطلب في الطريق.'],
    updated: ['Updated', 'آخر تحديث'], agoS: ['s ago', ' ث مضت'], agoM: ['min ago', ' د مضت'],
    distBtn: ['How far from me?', 'كم يبعد عني؟'], dist: ['About %s km away', 'يبعد حوالي %s كم'], distNear: ['Less than 1 km away', 'يبعد أقل من كيلومتر'],
    distNo: ['Your browser did not share your location.', 'لم يشارك متصفحك موقعك.'],
    live: ['Live', 'مباشر'],
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
        else if (k === 'packed' && o.packed_at && i <= s.at) sub = when(o.packed_at)
        else if (k === 'shipped' && o.shipped_at && i <= s.at) sub = when(o.shipped_at)
        else if (k === 'delivered' && s.at === 4) sub = when(o.fulfilled_at)
        else if (i === s.at) sub = t('now')
        if (sub) tx.appendChild(el('small', '', sub))
      }
      li.appendChild(tx)
      ol.appendChild(li)
    })
    box.appendChild(ol)
    if (!compact) {
      if (o.courier_url || (o.courier && o.courier !== 'own')) box.appendChild(courierRow(o))
      if (o.location) box.appendChild(mapBox(o))
    }
    return box
  }
  function courierRow(o) {
    var row = el('p', 'op-courier')
    var name = o.courier_name ? (ar() ? o.courier_name.ar : o.courier_name.en) : ''
    if (o.courier_url) {
      row.appendChild(el('span', '', t('trackWith') + ' '))
      var a = el('a', 'op-courier-link', name); a.href = o.courier_url; a.target = '_blank'; a.rel = 'noopener'
      row.appendChild(a)
      if (o.courier_ref) { row.appendChild(el('span', '', ' · ' + t('ref') + ' ')); var r = el('b', '', o.courier_ref); r.dir = 'ltr'; row.appendChild(r) }
    } else {
      row.appendChild(el('span', '', t('courier') + ': ' + name))
      if (o.courier_ref) { row.appendChild(el('span', '', ' · ')); var r2 = el('b', '', o.courier_ref); r2.dir = 'ltr'; row.appendChild(r2) }
    }
    return row
  }
  /* ---- the driver on a map ---- */
  var leaflet = null
  function loadLeaflet() {
    if (leaflet) return leaflet
    leaflet = new Promise(function (res, rej) {
      if (window.L) return res(window.L)
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/leaflet/leaflet.css'; document.head.appendChild(css)
      var js = document.createElement('script'); js.src = '/assets/leaflet/leaflet.js'; js.onload = function () { res(window.L) }; js.onerror = rej; document.head.appendChild(js)
    })
    return leaflet
  }
  var map = null, marker = null, ring = null, mine = null
  function ago(sec) { return sec < 60 ? sec + (ar() ? t('agoS') : t('agoS')) : Math.round(sec / 60) + (ar() ? t('agoM') : ' ' + t('agoM')) }
  function mapBox(o) {
    var box = el('div', 'op-map-box')
    var head = el('div', 'op-map-head')
    head.appendChild(el('b', '', t('mapTitle')))
    var live = el('span', 'op-live', t('live')); head.appendChild(live)
    box.appendChild(head)
    var m = el('div', 'op-map'); m.setAttribute('data-op-map', ''); m.setAttribute('role', 'img'); m.setAttribute('aria-label', t('mapTitle')); box.appendChild(m)
    var foot = el('div', 'op-map-foot')
    foot.appendChild(el('small', 'op-map-upd', t('updated') + ' ' + ago(o.location.age_sec)))
    var btn = el('button', 'op-dist', t('distBtn')); btn.type = 'button'
    var out = el('small', 'op-dist-out', '')
    btn.addEventListener('click', function () {
      if (!navigator.geolocation) { out.textContent = t('distNo'); return }
      navigator.geolocation.getCurrentPosition(function (p) {
        mine = { lat: p.coords.latitude, lng: p.coords.longitude }
        showDistance(out, o.location)
      }, function () { out.textContent = t('distNo') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
    })
    foot.appendChild(btn); foot.appendChild(out)
    box.appendChild(foot)
    box.appendChild(el('p', 'op-map-note', t('mapNote')))
    // The map itself is drawn once the box is in the page (Leaflet needs a laid-out element).
    setTimeout(function () { drawMap(m, o.location) }, 0)
    return box
  }
  function km(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  function showDistance(out, loc) {
    if (!mine) return
    var d = km(mine, loc)
    out.textContent = d < 1 ? t('distNear') : t('dist').replace('%s', (ar() ? d.toLocaleString('ar-KW', { maximumFractionDigits: 1 }) : d.toFixed(1)))
  }
  function drawMap(elm, loc) {
    loadLeaflet().then(function (L) {
      if (!elm.isConnected) return
      L.Icon.Default.imagePath = '/assets/leaflet/images/'
      if (!map || map.getContainer() !== elm) {
        map = L.map(elm, { zoomControl: false, attributionControl: true })
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map)
        marker = L.marker([loc.lat, loc.lng]).addTo(map)
        ring = L.circle([loc.lat, loc.lng], { radius: Math.max(20, loc.accuracy_m || 0), color: '#e0561c', weight: 1, fillOpacity: .08 }).addTo(map)
        map.setView([loc.lat, loc.lng], 15)
      } else {
        marker.setLatLng([loc.lat, loc.lng]); ring.setLatLng([loc.lat, loc.lng]); ring.setRadius(Math.max(20, loc.accuracy_m || 0))
        map.panTo([loc.lat, loc.lng])
      }
    }).catch(function () {})
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
    lastId = id; lastJson = ''
    refresh(id, holder)
  }
  /* ---- the live part: ask again every ten seconds while the order is moving and the tab is visible ---- */
  var lastJson = '', timer = null
  function moving(o) { var f = o.fulfilment_status || 'unfulfilled'; return f !== 'delivered' && f !== 'cancelled' && o.payment_status !== 'failed' }
  function refresh(id, holder) {
    if (busy) return
    busy = true
    fetch('/api/api.php?r=status&id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (o) {
        busy = false
        if (!o || lastId !== id) return
        var json = JSON.stringify(o)
        var box = holder.querySelector('[data-order-progress]')
        if (json !== lastJson || !box) {
          // The map survives a redraw: the same Leaflet instance is moved into the new box.
          var hadMap = box && box.querySelector('[data-op-map]')
          if (box) box.remove()
          var fresh = render(o, false)
          holder.appendChild(fresh)
          if (hadMap && o.location) { var slot = fresh.querySelector('[data-op-map]'); if (slot && map) { slot.replaceWith(hadMap); drawMap(hadMap, o.location) } }
          lastJson = json
        } else {
          var upd = holder.querySelector('.op-map-upd')
          if (upd && o.location) upd.textContent = t('updated') + ' ' + ago(o.location.age_sec)
        }
        if (timer) clearTimeout(timer)
        if (moving(o)) timer = setTimeout(function () { if (!document.hidden) refresh(id, holder); else timer = null }, 10000)
      })
      .catch(function () { busy = false })
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && lastId && !timer) { var h = document.querySelector('main section > div.mt-8'); if (h) refresh(lastId, h) }
  })

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
    + '.op-courier{margin:12px 0 0;font-size:13.5px;line-height:1.6;color:var(--sp-text,#dbdfe4)}.op-courier-link{color:var(--brand,#e0561c);font-weight:700;text-decoration:underline}.op-courier b{font-weight:700}'
    + '.op-map-box{margin-top:14px;border-radius:14px;overflow:hidden;border:1px solid var(--sp-line,rgba(255,255,255,.1))}'
    + '.op-map-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;font-size:14px;font-weight:700;background:var(--sp-tile,rgba(255,255,255,.05))}'
    + '.op-live{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#d33;border-radius:999px;padding:3px 8px}'
    + '.op-map{height:260px;background:#e5e7eb}'
    + '.op-map-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;font-size:12.5px;color:var(--sp-silver,#9aa1a9)}'
    + '.op-dist{appearance:none;border:1px solid var(--brand,#e0561c);background:none;color:var(--brand,#e0561c);border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;min-height:32px}'
    + '.op-dist-out{font-weight:700;color:var(--sp-text,#dbdfe4)}'
    + '.op-map-note{margin:0;padding:0 12px 10px;font-size:12px;line-height:1.5;color:var(--sp-silver,#9aa1a9)}'
  if (!document.getElementById('op-css')) { var st = document.createElement('style'); st.id = 'op-css'; st.textContent = CSS; document.head.appendChild(st) }

  var q = null
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; onTrack() }, 150) }).observe(document.documentElement, { childList: true, subtree: true })
  onTrack()
})()
