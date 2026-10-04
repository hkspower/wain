/**
 * Live tracking on the website's Orders screen — 2026-10-04 ("create live tracking order").
 *
 * A card under the orders (the crm.js pattern: found by the "Orders" heading, placed last in that
 * section, removed when the screen changes) listing every order that is packed or on its way, with:
 *   - the carrier and its tracking number (admin.php?r=courier; /track links to the carrier's page)
 *   - the driver link for the shop's own delivery (admin.php?r=driver_link), to copy or send on
 *     WhatsApp; the driver opens it on their phone and presses "Start sharing"
 *   - the driver's last position, when there is one (admin.php?r=location), with a map link
 * Writes go through the two admin routes only; the bundle's own status buttons stay the way to mark an
 * order packed / shipped / delivered. Text is set with textContent; nothing is innerHTML.
 */
(function () {
  'use strict'
  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-tracking'
  var ar = function () { return document.documentElement.lang === 'ar' }
  var T = function (en, a) { return ar() ? a : en }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  function api(route, body) {
    return fetch(API + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Accept: 'application/json' },
      credentials: 'include', cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j } }) })
  }
  var couriers = null, card = null, busy = false

  function ordersHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Orders') return hs[i]
    return null
  }
  function row(o) {
    var li = el('li', 'otp-row'); li.setAttribute('data-order-id', String(o.id))
    var head = el('div', 'otp-head')
    var id = el('b', '', o.track_id); id.dir = 'ltr'; head.appendChild(id)
    head.appendChild(el('span', 'otp-status', o.fulfilment_status === 'packed' ? T('Packed', 'مغلّف') : T('On the way', 'في الطريق')))
    head.appendChild(el('span', 'otp-who', (o.customer_name || '') + (o.customer_area ? ' · ' + o.customer_area : '')))
    li.appendChild(head)

    var form = el('div', 'otp-form')
    var sel = el('select', 'otp-courier'); sel.setAttribute('aria-label', T('Carrier', 'شركة التوصيل'))
    sel.appendChild(new Option(T('— carrier —', '— شركة التوصيل —'), ''))
    ;(couriers || []).forEach(function (c) { sel.appendChild(new Option(ar() ? c.name_ar : c.name_en, c.key)) })
    sel.value = o.courier || ''
    var ref = el('input', 'otp-ref'); ref.type = 'text'; ref.placeholder = T('Tracking number', 'رقم التتبع'); ref.value = o.courier_ref || ''
    ref.setAttribute('aria-label', T('Tracking number', 'رقم التتبع')); ref.maxLength = 80; ref.dir = 'ltr'; ref.autocomplete = 'off'
    var save = el('button', 'otp-btn', T('Save', 'حفظ')); save.type = 'button'
    var msg = el('span', 'otp-msg', '')
    save.addEventListener('click', function () {
      save.disabled = true; msg.textContent = ''
      api('courier', { order_id: o.id, courier: sel.value, courier_ref: ref.value.trim() }).then(function (r) {
        save.disabled = false
        if (!r.ok) { msg.textContent = r.json && r.json.error === 'invalid_courier_ref' ? T('Letters, digits and dashes only (3–80).', 'حروف وأرقام وشرطات فقط (3–80).') : T('Not saved.', 'لم يُحفظ.'); msg.setAttribute('data-bad', '1'); return }
        msg.removeAttribute('data-bad'); msg.textContent = T('Saved.', 'تم الحفظ.'); o.courier = r.json.courier; o.courier_ref = r.json.courier_ref
        drv.hidden = sel.value !== 'own'
      })
    })
    form.appendChild(sel); form.appendChild(ref); form.appendChild(save); form.appendChild(msg)
    li.appendChild(form)

    // The driver link: only shown for the shop's own delivery, which is the only case a map applies.
    var drv = el('div', 'otp-driver'); drv.hidden = (o.courier || '') !== 'own'
    var linkBtn = el('button', 'otp-btn otp-link', T('Driver link', 'رابط السائق')); linkBtn.type = 'button'
    var linkOut = el('span', 'otp-linkout', '')
    linkBtn.addEventListener('click', function () {
      api('driver_link&order_id=' + o.id).then(function (r) {
        if (!r.ok) { linkOut.textContent = r.json && r.json.error === 'no_cron_key' ? T('cron_key is not set in config.php', 'cron_key غير مضبوط في config.php') : T('Could not make the link.', 'تعذّر إنشاء الرابط.'); return }
        while (linkOut.firstChild) linkOut.removeChild(linkOut.firstChild)
        var inp = el('input', 'otp-url'); inp.readOnly = true; inp.value = r.json.url; inp.dir = 'ltr'; inp.setAttribute('aria-label', T('Driver link', 'رابط السائق'))
        var copy = el('button', 'otp-btn', T('Copy', 'نسخ')); copy.type = 'button'
        copy.addEventListener('click', function () { inp.select(); try { navigator.clipboard.writeText(inp.value) } catch (e) { document.execCommand('copy') } copy.textContent = T('Copied', 'تم النسخ') })
        var wa = el('a', 'otp-btn otp-wa', T('Send on WhatsApp', 'أرسل على واتساب'))
        wa.href = 'https://wa.me/?text=' + encodeURIComponent(T('Sporta delivery — order ', 'توصيل سبورتا — الطلب ') + o.track_id + '\n' + r.json.url); wa.target = '_blank'; wa.rel = 'noopener'
        linkOut.appendChild(inp); linkOut.appendChild(copy); linkOut.appendChild(wa)
      })
    })
    drv.appendChild(linkBtn); drv.appendChild(linkOut)
    var loc = el('div', 'otp-loc', ''); drv.appendChild(loc)
    api('location&order_id=' + o.id).then(function (r) {
      if (!r.ok || !r.json) { loc.textContent = T('No position yet.', 'لا يوجد موقع بعد.'); return }
      var l = r.json, age = l.age_sec < 60 ? l.age_sec + T('s ago', ' ث مضت') : Math.round(l.age_sec / 60) + T(' min ago', ' د مضت')
      loc.appendChild(el('span', '', T('Driver position: ', 'موقع السائق: ') + age + ' · '))
      var a = el('a', '', T('open map', 'افتح الخريطة')); a.href = 'https://www.openstreetmap.org/?mlat=' + l.lat + '&mlon=' + l.lng + '#map=16/' + l.lat + '/' + l.lng; a.target = '_blank'; a.rel = 'noopener'
      loc.appendChild(a)
    })
    li.appendChild(drv)
    return li
  }
  function fill() {
    if (!card || busy) return
    busy = true
    var p = couriers ? Promise.resolve() : api('couriers').then(function (r) { couriers = r.ok ? r.json : [] })
    p.then(function () { return Promise.all([api('orders&fulfilment=packed&limit=100'), api('orders&fulfilment=shipped&limit=100')]) })
      .then(function (rs) {
        busy = false
        var list = card.querySelector('.otp-list'); while (list.firstChild) list.removeChild(list.firstChild)
        var rows = [].concat(rs[0].ok ? rs[0].json : [], rs[1].ok ? rs[1].json : [])
        card.querySelector('.otp-count').textContent = rows.length ? String(rows.length) : T('none', 'لا شيء')
        if (!rows.length) list.appendChild(el('li', 'otp-empty', T('No order is packed or on its way. Mark one above and it appears here.', 'لا يوجد طلب مغلّف أو في الطريق. علّم طلبًا أعلاه ليظهر هنا.')))
        rows.forEach(function (o) { list.appendChild(row(o)) })
      }).catch(function () { busy = false })
  }
  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var head = ordersHeading()
      var existing = document.querySelector('[' + MARK + ']')
      if (!head) { if (existing) existing.remove(); card = null; return }
      if (existing) { card = existing; return }
      style()
      card = el('section', 'otp'); card.setAttribute(MARK, '1')
      var h = el('h2', 'otp-title', T('Live tracking', 'التتبع المباشر')); card.appendChild(h)
      var sub = el('p', 'otp-sub'); sub.appendChild(el('span', '', T('Orders packed or on their way: ', 'الطلبات المغلّفة أو في الطريق: '))); sub.appendChild(el('b', 'otp-count', '…'))
      var re = el('button', 'otp-btn otp-refresh', T('Refresh', 'تحديث')); re.type = 'button'; re.addEventListener('click', fill); sub.appendChild(re)
      card.appendChild(sub)
      card.appendChild(el('p', 'otp-help', T('Pick the carrier and type its tracking number — the customer\'s /track page links to it. For your own driver choose "Sporta delivery" and send them the driver link; the customer then sees the van on a map.',
        'اختر شركة التوصيل واكتب رقم التتبع — تظهر الرابط في صفحة التتبع للعميل. لسائقك اختر «توصيل سبورتا» وأرسل له رابط السائق؛ يرى العميل حينها السيارة على الخريطة.')))
      card.appendChild(el('ul', 'otp-list'))
      var host = head.parentNode, header = host && host.parentNode, section = header && header.parentNode
      if (section) section.appendChild(card); else if (header) header.insertBefore(card, host.nextSibling)
      fill()
    } finally { placing = false }
  }
  function style() {
    if (document.getElementById('otp-css')) return
    var s = document.createElement('style'); s.id = 'otp-css'
    s.textContent = '.otp{margin:24px 0 0;padding:18px;border-radius:16px;background:var(--sp-tile,#14161a);border:1px solid var(--sp-line,rgba(255,255,255,.1));color:var(--sp-text,#dbdfe4)}'
      + '.otp-title{margin:0 0 6px;font-size:18px;font-weight:700}.otp-sub{margin:0 0 8px;display:flex;align-items:center;gap:10px;font-size:14px}.otp-help{margin:0 0 14px;font-size:13px;line-height:1.6;color:var(--sp-silver,#9aa1a9)}'
      + '.otp-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}.otp-row{padding:12px;border-radius:12px;border:1px solid var(--sp-line,rgba(255,255,255,.1))}.otp-empty{font-size:13.5px;color:var(--sp-silver,#9aa1a9)}'
      + '.otp-head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:14px}.otp-status{font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--brand,#e0561c);color:#fff}.otp-who{color:var(--sp-silver,#9aa1a9)}'
      + '.otp-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.otp-courier,.otp-ref,.otp-url{min-height:40px;padding:6px 10px;border-radius:10px;border:1px solid var(--sp-field-edge,#5a5f66);background:var(--sp-black,#0d0e10);color:var(--sp-text,#fff);font:inherit;font-size:14px}.otp-ref{flex:1;min-width:160px}.otp-url{flex:1;min-width:220px;font-size:12.5px}'
      + '.otp-btn{appearance:none;min-height:40px;padding:0 14px;border-radius:999px;border:0;background:var(--brand,#e0561c);color:#fff;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}.otp-btn:disabled{opacity:.6}.otp-refresh{background:none;border:1px solid var(--sp-line,rgba(255,255,255,.2));color:var(--sp-text,#dbdfe4);min-height:32px}'
      + '.otp-msg{font-size:13px;color:#9be7b0}.otp-msg[data-bad]{color:#ffb4a0}.otp-driver{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.otp-linkout{display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1}.otp-loc{width:100%;font-size:13px;color:var(--sp-silver,#9aa1a9)}.otp-loc a{color:var(--brand,#e0561c);font-weight:700}'
    document.head.appendChild(s)
  }
  var q = null
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; place() }, 200) }).observe(document.documentElement, { childList: true, subtree: true })
  place()
})()
