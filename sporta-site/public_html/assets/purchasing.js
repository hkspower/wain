/**
 * Purchasing — reorder suggestions, purchase orders and suppliers, on the panel's Inventory screen
 * (2026-10-04, "improve inventory" → purchasing & suppliers). A card under the Inventory tools.
 *
 *   Reorder suggestions   admin.php?r=reorder_suggestions: for every size that is short — units sold in
 *                         the last 30 days, per day, days of cover, a suggested quantity (sales rate ×
 *                         (supplier lead time + 14 days) − stock − already on order). Tick rows → "Add to
 *                         order" builds a purchase order.
 *   Purchase orders       open orders with Receive / Cancel; received and cancelled history. RECEIVING
 *                         is the one moment stock moves (admin.php po_receive, logged as 'purchase').
 *   Suppliers             name, contact, lead days; which SKUs they supply is set from the order lines.
 *
 * The server validates everything again and refuses by name. Until the purchasing tables exist the card
 * says so and offers nothing (the migration creates them).
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var MARK = 'data-sporta-purchasing', API = '/api/admin.php?r='
  var card = null
  var S = { ready: null, sugg: null, pos: null, suppliers: null, picked: {}, draft: null, note: '', bad: false, busy: false, tab: 'suggest', days: 30 }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    return fetch(API + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
  }
  var WHY = { purchasing_not_ready: 'The purchasing tables are not on this shop yet (run the migration).', po_empty: 'Add at least one line.', unknown_supplier: 'That supplier no longer exists.',
    po_not_open: 'That order is not open any more.', po_not_found: 'That order no longer exists.', supplier_name_required: 'The supplier needs a name.', invalid_lead_days: 'Lead days: 0 to 365.',
    supplier_has_open_orders: 'That supplier has open orders. Receive or cancel them first.', not_signed_in: 'Your session has ended. Sign in again.' }
  function why(e) { e = String(e || ''); if (/^po_line_(\d+)_(no_sku|duplicate|qty|cost)$/.test(e)) { var m = e.match(/^po_line_(\d+)_(.*)$/); return 'Line ' + m[1] + ': ' + ({ no_sku: 'no item code', duplicate: 'repeated item code', qty: 'quantity must be 1 or more', cost: 'cost must be 0 or more' })[m[2]] } if (/^unknown_sku:/.test(e)) return 'Unknown item code ' + e.slice(12); return WHY[e] || e }
  function say(t, bad) { S.note = t; S.bad = !!bad; render() }

  function load() {
    S.busy = true; render()
    Promise.all([call('reorder_suggestions&days=' + S.days), call('po_list'), call('suppliers')]).then(function (rs) {
      S.busy = false
      if (rs[0].status === 503 || rs[1].status === 503) { S.ready = false; render(); return }
      S.ready = true
      S.sugg = rs[0].ok ? rs[0].j : { rows: [] }
      S.pos = rs[1].ok ? rs[1].j : []
      S.suppliers = rs[2].ok ? rs[2].j : []
      render()
    })
  }

  /* --------------------------------------------------------------- views */
  function tabs() {
    var row = el('div', 'spur-tabs')
    ;[['suggest', 'What to reorder'], ['orders', 'Purchase orders'], ['suppliers', 'Suppliers']].forEach(function (t) {
      var b = el('button', 'spur-tab' + (S.tab === t[0] ? ' spur-tab-on' : ''), t[1]); b.type = 'button'; b.setAttribute('aria-pressed', S.tab === t[0] ? 'true' : 'false')
      b.addEventListener('click', function () { S.tab = t[0]; S.note = ''; render() })
      row.appendChild(b)
    })
    return row
  }
  function suggestView() {
    var box = el('div'); box.setAttribute('data-spur-suggest', '1')
    var rows = (S.sugg && S.sugg.rows) || []
    var head = el('div', 'spur-row')
    head.appendChild(el('span', 'spur-hint', rows.length ? rows.length + ' size' + (rows.length === 1 ? '' : 's') + ' short of cover, from the last ' + S.sugg.days + ' days of orders. Tick what to order.' : 'Nothing is short of cover: every size that sells has stock for its supplier\'s lead time plus two weeks.'))
    var sel = el('select', 'spur-in spur-narrow'); sel.setAttribute('aria-label', 'Sales window')
    ;[[14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days']].forEach(function (o) { var op = el('option', '', o[1]); op.value = String(o[0]); if (o[0] === S.days) op.selected = true; sel.appendChild(op) })
    sel.addEventListener('change', function () { S.days = parseInt(sel.value, 10); load() })
    head.appendChild(sel); box.appendChild(head)
    if (rows.length) {
      var t = el('table', 'spur-table'); var th = el('tr')
      ;['', 'Product', 'Size', 'Stock', 'On order', 'Sold', '/day', 'Cover', 'Order', 'Supplier'].forEach(function (h) { th.appendChild(el('th', '', h)) }); t.appendChild(th)
      rows.forEach(function (r) {
        var tr = el('tr'); tr.setAttribute('data-sku', r.sku)
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.picked[r.sku]; cb.setAttribute('aria-label', 'Order ' + r.name_en + ' ' + r.size)
        cb.addEventListener('change', function () { if (cb.checked) S.picked[r.sku] = r.suggest; else delete S.picked[r.sku]; render() })
        var td0 = el('td'); td0.appendChild(cb); tr.appendChild(td0)
        tr.appendChild(el('td', '', r.name_en)); tr.appendChild(el('td', '', r.size)); tr.appendChild(el('td', r.stock === 0 ? 'spur-out' : '', String(r.stock)))
        tr.appendChild(el('td', '', String(r.on_order))); tr.appendChild(el('td', '', String(r.sold))); tr.appendChild(el('td', '', String(r.per_day)))
        tr.appendChild(el('td', r.days_cover !== null && r.days_cover < 7 ? 'spur-out' : '', r.days_cover === null ? '—' : r.days_cover + ' d'))
        var q = el('input', 'spur-in spur-qty'); q.type = 'text'; q.inputMode = 'numeric'; q.value = String(S.picked[r.sku] != null ? S.picked[r.sku] : r.suggest); q.setAttribute('aria-label', 'Quantity to order, ' + r.name_en + ' ' + r.size)
        q.addEventListener('input', function () { if (S.picked[r.sku] != null) S.picked[r.sku] = q.value })
        var tdq = el('td'); tdq.appendChild(q); tr.appendChild(tdq)
        tr.appendChild(el('td', '', r.supplier || '—'))
        t.appendChild(tr)
      })
      box.appendChild(t)
      var n = Object.keys(S.picked).length
      var row = el('div', 'spur-row')
      var all = el('button', 'spur-btn', 'Tick all'); all.type = 'button'; all.addEventListener('click', function () { rows.forEach(function (r) { S.picked[r.sku] = r.suggest }); render() })
      var add = el('button', 'spur-go', 'Add ' + n + ' line' + (n === 1 ? '' : 's') + ' to an order'); add.type = 'button'; add.disabled = !n
      add.addEventListener('click', function () {
        var bySup = {}
        rows.forEach(function (r) { if (S.picked[r.sku] != null) { var k = r.supplier_id || 0; (bySup[k] = bySup[k] || []).push({ sku: r.sku, qty: parseInt(String(S.picked[r.sku]).replace(/[^0-9]/g, ''), 10) || r.suggest, cost_aed: r.cost_aed, name: r.name_en + ' ' + r.size }) } })
        var keys = Object.keys(bySup)
        S.draft = { supplier_id: keys.length === 1 ? parseInt(keys[0], 10) || 0 : 0, note: '', expected_on: '', items: [].concat.apply([], keys.map(function (k) { return bySup[k] })) }
        S.tab = 'orders'; S.note = keys.length > 1 ? 'The ticked sizes come from ' + keys.length + ' suppliers; this draft lists them together — split it if they ship separately.' : ''; render()
      })
      row.appendChild(all); row.appendChild(add); box.appendChild(row)
    }
    return box
  }
  function draftView() {
    var d = S.draft, box = el('div', 'spur-box'); box.setAttribute('data-spur-draft', '1')
    box.appendChild(el('div', 'spur-label', d.id ? 'Edit purchase order PO-' + d.id : 'New purchase order'))
    var row = el('div', 'spur-row')
    var sup = el('select', 'spur-in spur-narrow'); sup.setAttribute('aria-label', 'Supplier')
    var none = el('option', '', 'No supplier'); none.value = '0'; sup.appendChild(none)
    ;(S.suppliers || []).forEach(function (s) { var o = el('option', '', s.name + ' (' + s.lead_days + ' d)'); o.value = String(s.id); if (s.id === d.supplier_id) o.selected = true; sup.appendChild(o) })
    sup.addEventListener('change', function () { d.supplier_id = parseInt(sup.value, 10) })
    var exp = el('input', 'spur-in spur-narrow'); exp.type = 'date'; exp.value = d.expected_on || ''; exp.setAttribute('aria-label', 'Expected on'); exp.addEventListener('input', function () { d.expected_on = exp.value })
    var note = el('input', 'spur-in'); note.type = 'text'; note.placeholder = 'Note (optional)'; note.value = d.note || ''; note.maxLength = 300; note.addEventListener('input', function () { d.note = note.value })
    row.appendChild(sup); row.appendChild(exp); row.appendChild(note); box.appendChild(row)
    var t = el('table', 'spur-table'); var th = el('tr'); ['Item', 'Code', 'Qty', 'Cost (AED)', ''].forEach(function (h) { th.appendChild(el('th', '', h)) }); t.appendChild(th)
    d.items.forEach(function (it, i) {
      var tr = el('tr'); tr.appendChild(el('td', '', it.name || it.sku)); tr.appendChild(el('td', 'spur-mono', it.sku))
      var q = el('input', 'spur-in spur-qty'); q.type = 'text'; q.inputMode = 'numeric'; q.value = String(it.qty); q.setAttribute('aria-label', 'Quantity, ' + it.sku); q.addEventListener('input', function () { it.qty = q.value })
      var c = el('input', 'spur-in spur-qty'); c.type = 'text'; c.inputMode = 'decimal'; c.value = it.cost_aed == null ? '' : String(it.cost_aed); c.setAttribute('aria-label', 'Cost, ' + it.sku); c.addEventListener('input', function () { it.cost_aed = c.value })
      var tq = el('td'); tq.appendChild(q); tr.appendChild(tq); var tc = el('td'); tc.appendChild(c); tr.appendChild(tc)
      var rm = el('button', 'spur-btn spur-sm', '✕'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + it.sku); rm.addEventListener('click', function () { d.items.splice(i, 1); render() })
      var tr5 = el('td'); tr5.appendChild(rm); tr.appendChild(tr5); t.appendChild(tr)
    })
    box.appendChild(t)
    var addRow = el('div', 'spur-row')
    var skuIn = el('input', 'spur-in spur-narrow'); skuIn.type = 'text'; skuIn.placeholder = 'Add an item code…'; skuIn.setAttribute('aria-label', 'Add an item code')
    var addB = el('button', 'spur-btn', 'Add line'); addB.type = 'button'
    addB.addEventListener('click', function () { var v = skuIn.value.trim(); if (!v) return; var rec = window.sportaInventory && window.sportaInventory.bySku(v); d.items.push({ sku: v, qty: 1, cost_aed: null, name: rec ? (rec.name_en || rec.slug) + ' ' + rec.size : v }); render() })
    addRow.appendChild(skuIn); addRow.appendChild(addB); box.appendChild(addRow)
    var foot = el('div', 'spur-row')
    var save = el('button', 'spur-go', S.busy ? 'Saving…' : (d.id ? 'Save changes' : 'Create order')); save.type = 'button'; save.disabled = S.busy
    save.addEventListener('click', function () {
      S.busy = true; render()
      var items = d.items.map(function (it) { return { sku: it.sku, qty: parseInt(String(it.qty).replace(/[^0-9]/g, ''), 10) || 0, cost_aed: it.cost_aed === '' || it.cost_aed == null ? null : Number(String(it.cost_aed).replace(/[^0-9.]/g, '')) } })
      call('po_save', { id: d.id || 0, supplier_id: d.supplier_id || 0, note: d.note, expected_on: d.expected_on || null, items: items }).then(function (r) {
        S.busy = false
        if (!r.ok) { say(why(r.j && r.j.error), true); return }
        S.draft = null; S.picked = {}; S.note = 'Purchase order PO-' + r.j.id + ' saved with ' + r.j.lines + ' line' + (r.j.lines === 1 ? '' : 's') + '.'; load()
      })
    })
    var cancel = el('button', 'spur-btn', 'Discard'); cancel.type = 'button'; cancel.addEventListener('click', function () { S.draft = null; render() })
    foot.appendChild(save); foot.appendChild(cancel); box.appendChild(foot)
    return box
  }
  function ordersView() {
    var box = el('div'); box.setAttribute('data-spur-orders', '1')
    if (S.draft) box.appendChild(draftView())
    else { var nb = el('button', 'spur-btn', '+ New purchase order'); nb.type = 'button'; nb.addEventListener('click', function () { S.draft = { supplier_id: 0, note: '', expected_on: '', items: [] }; render() }); box.appendChild(nb) }
    var pos = S.pos || []
    if (!pos.length) { box.appendChild(el('p', 'spur-hint', 'No purchase orders yet.')); return box }
    pos.forEach(function (po) {
      var d = el('details', 'spur-po'); d.setAttribute('data-po', String(po.id)); if (po.status === 'open') d.open = true
      var sm = el('summary'); sm.textContent = 'PO-' + po.id + ' · ' + (po.supplier || 'no supplier') + ' · ' + po.lines_n + ' line' + (po.lines_n === 1 ? '' : 's') + ', ' + po.units + ' units · ' + po.status + (po.expected_on ? ' · expected ' + po.expected_on : '') + (po.received_at ? ' · received ' + String(po.received_at).slice(0, 10) : '')
      d.appendChild(sm)
      var ul = el('div', 'spur-lines')
      po.items.forEach(function (it) { ul.appendChild(el('div', 'spur-line', (it.name_en || it.slug || it.sku) + ' ' + (it.size || '') + ' · ' + it.sku + ' × ' + it.qty + (it.cost_aed != null ? ' · ' + it.cost_aed + ' AED' : ''))) })
      if (po.note) ul.appendChild(el('div', 'spur-hint', po.note))
      d.appendChild(ul)
      if (po.status === 'open') {
        var row = el('div', 'spur-row')
        var rc = el('button', 'spur-go', 'Receive — add ' + po.units + ' units to stock'); rc.type = 'button'; rc.setAttribute('data-receive', String(po.id))
        rc.addEventListener('click', function () { if (!confirm('Receive PO-' + po.id + '? Stock goes up by ' + po.units + ' units.')) return; rc.disabled = true; call('po_receive', { id: po.id }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } S.note = 'PO-' + po.id + ' received: ' + r.j.units + ' units added to stock. The Inventory list reloads on the next open.'; load() }) })
        var ed = el('button', 'spur-btn', 'Edit'); ed.type = 'button'; ed.addEventListener('click', function () { S.draft = { id: po.id, supplier_id: po.supplier_id || 0, note: po.note || '', expected_on: po.expected_on || '', items: po.items.map(function (i) { return { sku: i.sku, qty: i.qty, cost_aed: i.cost_aed, name: (i.name_en || i.slug || i.sku) + ' ' + (i.size || '') } }) }; render() })
        var cn = el('button', 'spur-btn', 'Cancel order'); cn.type = 'button'; cn.addEventListener('click', function () { if (!confirm('Cancel PO-' + po.id + '? No stock moves.')) return; call('po_cancel', { id: po.id }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } load() }) })
        row.appendChild(rc); row.appendChild(ed); row.appendChild(cn); d.appendChild(row)
      }
      box.appendChild(d)
    })
    return box
  }
  function suppliersView() {
    var box = el('div'); box.setAttribute('data-spur-suppliers', '1')
    var t = el('table', 'spur-table'); var th = el('tr'); ['Name', 'Contact', 'Lead days', 'Sizes', ''].forEach(function (h) { th.appendChild(el('th', '', h)) }); t.appendChild(th)
    var list = (S.suppliers || []).concat([{ id: 0, name: '', contact: '', lead_days: 14, skus: 0, _new: true }])
    list.forEach(function (s) {
      var tr = el('tr'); if (s.id) tr.setAttribute('data-supplier', String(s.id))
      var nm = el('input', 'spur-in'); nm.type = 'text'; nm.value = s.name; nm.placeholder = s._new ? 'New supplier…' : ''; nm.maxLength = 80; nm.setAttribute('aria-label', 'Supplier name')
      var ct = el('input', 'spur-in'); ct.type = 'text'; ct.value = s.contact || ''; ct.placeholder = 'phone / email'; ct.maxLength = 160; ct.setAttribute('aria-label', 'Supplier contact')
      var ld = el('input', 'spur-in spur-qty'); ld.type = 'text'; ld.inputMode = 'numeric'; ld.value = String(s.lead_days); ld.setAttribute('aria-label', 'Lead days')
      ;[nm, ct, ld].forEach(function (i, k) { var td = el('td'); td.appendChild(i); tr.appendChild(td) })
      tr.appendChild(el('td', '', s._new ? '' : String(s.skus)))
      var tdb = el('td'); var sv = el('button', 'spur-btn spur-sm', s._new ? 'Add' : 'Save'); sv.type = 'button'
      sv.addEventListener('click', function () { call('supplier_save', { id: s.id, name: nm.value, contact: ct.value, lead_days: parseInt(ld.value.replace(/[^0-9]/g, ''), 10) }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } S.note = 'Supplier saved.'; load() }) })
      tdb.appendChild(sv)
      if (!s._new) { var dl = el('button', 'spur-btn spur-sm', '✕'); dl.type = 'button'; dl.setAttribute('aria-label', 'Delete ' + s.name); dl.addEventListener('click', function () { if (!confirm('Delete ' + s.name + '?')) return; call('supplier_delete', { id: s.id }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } load() }) }); tdb.appendChild(dl) }
      tr.appendChild(tdb); t.appendChild(tr)
    })
    box.appendChild(t)
    box.appendChild(el('p', 'spur-hint', 'Lead days feed the reorder suggestions: a size is "short" when its stock covers less than lead time + 14 days of sales. Which sizes a supplier provides is set from its orders.'))
    return box
  }
  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'spur-h', 'Purchasing'))
    if (S.ready === null) { card.appendChild(el('p', 'spur-hint', 'Loading…')); return }
    if (S.ready === false) { card.appendChild(el('p', 'spur-warn', 'The purchasing tables are not on this shop yet. Run scripts/publish/migrate-purchasing.php; until then stock editing works as before.')); return }
    card.appendChild(tabs())
    card.appendChild(S.tab === 'suggest' ? suggestView() : S.tab === 'orders' ? ordersView() : suppliersView())
    if (S.note) card.appendChild(el('p', S.bad ? 'spur-warn' : 'spur-note', S.note))
  }

  var CSS = ''
    + '.spur{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.25rem);margin:1rem 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.spur-h{margin:0 0 10px;font-size:16px}.spur-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}'
    + '.spur-tab{min-height:40px;padding:6px 12px;border-radius:999px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;cursor:pointer}.spur-tab-on{background:var(--brand,#e0561c);border-color:transparent;color:#fff;font-weight:700}'
    + '.spur-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.spur-hint{font-size:12.5px;opacity:.75;flex:1 1 240px;line-height:1.5}'
    + '.spur-in{padding:8px 10px;min-height:44px;box-sizing:border-box;border-radius:8px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;flex:1 1 180px;min-width:0}'
    + '.spur-narrow{flex:0 1 200px}.spur-qty{flex:0 0 84px;width:84px;text-align:end}'
    + '.spur-btn,.spur-go{padding:10px 14px;min-height:44px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit}'
    + '.spur-go{border:0;background:var(--brand,#e0561c);color:#fff}.spur-go[disabled],.spur-btn[disabled]{opacity:.5;cursor:default}.spur-sm{min-height:40px;padding:6px 10px}'
    + '.spur-table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}.spur-table th{text-align:start;font-size:12px;opacity:.7;padding:4px 6px}.spur-table td{padding:4px 6px;border-top:1px solid rgba(128,128,128,.15);vertical-align:middle}'
    + '.spur-table input[type=checkbox]{width:20px;height:20px}.spur-out{color:#ff9a90;font-weight:700}.spur-mono{font-family:ui-monospace,monospace;font-size:12px}'
    + '.spur-box{margin:10px 0;padding:12px;border:1px solid var(--border,#2a2d31);border-radius:10px}.spur-label{font-size:13px;font-weight:600;margin-bottom:6px}'
    + '.spur-po{border-top:1px solid rgba(128,128,128,.2);padding:8px 0}.spur-po summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:13px;font-weight:600}'
    + '.spur-lines{font-size:12.5px;line-height:1.6;padding:4px 0 4px 12px}.spur-line{padding:1px 0}'
    + '.spur-note{margin:12px 0 0;font-size:13px;opacity:.85}.spur-warn{margin:12px 0 0;font-size:13px;padding:10px 12px;border-radius:8px;background:#2a1f14;border:1px solid #5c4326;color:#ffd7a8}'
    + '@media(max-width:640px){.spur-table{display:block;overflow-x:auto}}'
  function style() { if (document.getElementById('spur-css')) return; var s = el('style'); s.id = 'spur-css'; s.textContent = CSS; document.head.appendChild(s) }
  function heading() { var h = document.querySelector('.admin-content h1'); return h && h.textContent.trim() === 'Inventory' ? h : null }
  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var h = heading(), existing = document.querySelector('[' + MARK + ']')
      if (!h) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); card = null; S = { ready: null, sugg: null, pos: null, suppliers: null, picked: {}, draft: null, note: '', bad: false, busy: false, tab: 'suggest', days: 30 }; return }
      if (existing) { card = existing; return }
      style()
      card = el('div', 'spur'); card.setAttribute(MARK, '1')
      var tools = document.querySelector('[data-sporta-inventory]')
      if (tools) tools.insertAdjacentElement('afterend', card); else h.insertAdjacentElement('afterend', card)
      render(); load()
    } finally { placing = false }
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 200) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
