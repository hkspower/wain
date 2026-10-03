/**
 * Sporta — Inventory tools, on the website panel's Inventory screen.
 *
 * "improve inventory" — the owner, 2026-09-30, all four of: FIND AND EDIT FASTER,
 * LOW-STOCK WARNINGS, STOCK HISTORY, IMPORT / EXPORT A SPREADSHEET.
 *
 * THE SCREEN ITSELF IS THE BUNDLE'S — a table (a card list on a phone) of every
 * size with an input per stock count — and this touches it only lightly: it adds
 * a CLASS to a row (out of stock, low) and hides rows that a search or filter
 * excludes. It never rewrites a row, so the bundle's own inputs, saves and
 * Remove buttons keep working. Everything else is one card above the list.
 *
 * WHAT WRITES: one route, `inventory_apply` — a list of {sku, stock}. Saving all
 * the sizes of one product and applying a spreadsheet are the same call, and both
 * are ALL OR NOTHING with every problem named. A spreadsheet is always shown as a
 * PREVIEW first (`dry`), and nothing is written until the owner presses Apply.
 * After a write the panel is reloaded onto this screen (panel-ux.js reopens the
 * screen named in sessionStorage), because the bundle's table holds the old
 * numbers and would otherwise let the owner overwrite the new ones.
 *
 * THE LOW-STOCK LINE only colours and counts. It hides nothing and refuses
 * nothing — `stock = 0` is what the shop acts on, and it already does.
 *
 * The export omits the wholesale cost on purpose: a stock sheet gets emailed.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-inventory'
  var API = '/api/admin.php?r='
  var KEY = 'spux-screen'                    // panel-ux.js: the screen to reopen after a reload
  var card = null
  var S = { rows: null, meta: null, q: '', filter: 'all', slug: '', edit: {}, note: '', bad: false,
            preview: null, log: null, busy: false }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9. The server's stock check is
     ASCII-only, so "١٢" typed on an Arabic number pad refused the WHOLE batch as
     invalid_stock, and the low-stock line (then type=number) dropped it to an
     empty box and saved null. Converted where each value is read, so nothing
     here depends on keyboard-hints.js having loaded. */
  function west(s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (c) {
      var n = c.charCodeAt(0)
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }
  function call(route, method, body) {
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, j: j } })
    })
  }
  function reloadHere() {
    try { sessionStorage.setItem(KEY, 'Inventory') } catch (e) {}
    location.reload()
  }
  var STATUS = {
    unknown_sku: 'no such item code', invalid_stock: 'not a whole number 0 or more', duplicate_sku: 'item code repeated',
    no_sku: 'no item code', same: 'no change', ok: 'will change'
  }

  /* ---------------------------------------------------------------- data -- */
  function stats() {
    var low = S.meta ? S.meta.low : 5, out = 0, lowN = 0, hidden = {}
    var hid = S.meta ? S.meta.hidden : []
    ;(S.rows || []).forEach(function (r) {
      if (r.stock === 0) out++
      else if (r.stock <= low) lowN++
      if (hid.indexOf(r.slug) !== -1) hidden[r.slug] = 1
    })
    return { out: out, low: lowN, hidden: Object.keys(hidden).length, total: (S.rows || []).length, line: low }
  }
  function bySku() {
    var m = {}
    ;(S.rows || []).forEach(function (r) { m[r.sku] = r })
    return m
  }

  /* ---------------------------------------------------- the bundle's rows -- */
  function screenRows(host) {
    var out = []
    var t = host.querySelector('table.admin-table')
    if (t) [].slice.call(t.querySelectorAll('tbody > tr')).forEach(function (tr) {
      var code = tr.querySelector('td.font-mono, td[class*="font-mono"]')
      out.push({ node: tr, sku: code ? code.textContent.trim() : '', name: (tr.children[0] || {}).textContent || '' })
    })
    var l = host.querySelector('.m-list')
    if (l) [].slice.call(l.querySelectorAll(':scope > .m-row')).forEach(function (c) {
      var code = c.querySelector('.font-mono')
      var title = c.querySelector('.m-row__title')
      out.push({ node: c, sku: code ? code.textContent.trim() : '', name: title ? title.textContent : '' })
    })
    return out
  }
  function liveStock(node) {
    var i = node.querySelector('input[inputmode="numeric"]')
    var v = i ? parseInt(i.value, 10) : NaN
    return isNaN(v) ? null : v
  }
  function annotate() {
    var host = document.querySelector('.admin-content')
    if (!host || !S.rows) return
    var low = S.meta ? S.meta.low : 5, hid = S.meta ? S.meta.hidden : []
    var known = bySku(), q = S.q.trim().toLowerCase(), any = false
    screenRows(host).forEach(function (r) {
      var rec = known[r.sku]
      var st = liveStock(r.node)
      if (st == null && rec) st = rec.stock
      r.node.classList.toggle('spinv-out', st === 0)
      r.node.classList.toggle('spinv-low', st != null && st > 0 && st <= low)
      var show = true
      // every word must appear, in any order: "tekno shorts black" finds
      // "Tekno Shorts — Black" (the dash is not a word the owner will type)
      if (q) { var hay = (r.name + ' ' + r.sku).toLowerCase(); q.split(/\s+/).forEach(function (w) { if (w && hay.indexOf(w) === -1) show = false }) }
      if (S.filter === 'out' && st !== 0) show = false
      if (S.filter === 'low' && !(st != null && st > 0 && st <= low)) show = false
      if (S.filter === 'attention' && !(st != null && st <= low)) show = false
      if (S.filter === 'hidden' && !(rec && hid.indexOf(rec.slug) !== -1)) show = false
      r.node.classList.toggle('spinv-hide', !show)
      if (!show) any = true
    })
    host.classList.toggle('spinv-filtering', !!q || S.filter !== 'all')
    void any
  }

  /* --------------------------------------------------------------- views -- */
  function chip(text, cls) { return el('span', 'spinv-chip ' + (cls || ''), text) }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'spinv-h', 'Inventory tools'))
    if (!S.rows || !S.meta) { card.appendChild(el('p', 'spinv-note', 'Loading…')); return }
    var st = stats()

    var sum = el('div', 'spinv-row')
    sum.appendChild(chip(st.out + ' sold out', st.out ? 'spinv-c-out' : ''))
    sum.appendChild(chip(st.low + ' low (≤ ' + st.line + ')', st.low ? 'spinv-c-low' : ''))
    sum.appendChild(chip(st.hidden + ' hidden product' + (st.hidden === 1 ? '' : 's')))
    sum.appendChild(chip(st.total + ' sizes in all'))
    card.appendChild(sum)

    // find
    var f = el('div', 'spinv-row spinv-field')
    var q = el('input', 'spinv-input'); q.type = 'search'; q.placeholder = 'Search product or item code'; q.value = S.q
    q.setAttribute('aria-label', 'Search inventory')
    q.addEventListener('input', function () { S.q = q.value; annotate() })
    var sel = el('select', 'spinv-input spinv-narrow'); sel.setAttribute('aria-label', 'Filter')
    ;[['all', 'Show all'], ['attention', 'Sold out or low'], ['out', 'Sold out'], ['low', 'Low stock'], ['hidden', 'Hidden products']].forEach(function (o) {
      var op = el('option', '', o[1]); op.value = o[0]; if (o[0] === S.filter) op.selected = true; sel.appendChild(op)
    })
    sel.addEventListener('change', function () { S.filter = sel.value; annotate() })
    f.appendChild(q); f.appendChild(sel)
    card.appendChild(f)

    // threshold
    var t = el('div', 'spinv-row spinv-field')
    t.appendChild(el('span', 'spinv-label', 'Low-stock line'))
    var n = el('input', 'spinv-input spinv-num'); n.type = 'text'; n.inputMode = 'numeric'; n.pattern = '[0-9]*'; n.maxLength = 3; n.size = 3; n.value = String(st.line)
    n.setAttribute('aria-label', 'Low-stock line')
    var ns = el('button', 'spinv-btn', 'Save line'); ns.type = 'button'
    ns.addEventListener('click', function () {
      var lv = west(n.value).trim()
      call('inventory_low_save', 'POST', { low: /^\d+$/.test(lv) ? parseInt(lv, 10) : null }).then(function (r) {
        if (r.ok) { S.meta.low = r.j.low; S.note = 'Low-stock line is ' + r.j.low + '.'; S.bad = false } else { S.note = 'That is not a number from 0 to 999.'; S.bad = true }
        render(); annotate()
      })
    })
    t.appendChild(n); t.appendChild(ns)
    t.appendChild(el('span', 'spinv-hint', 'Sizes at or under this many are tinted. Nothing is hidden or refused because of it.'))
    card.appendChild(t)

    // whole-product edit
    var e = el('div', 'spinv-field')
    e.appendChild(el('div', 'spinv-label', 'Edit every size of one product'))
    var ps = el('select', 'spinv-input'); ps.setAttribute('aria-label', 'Product to edit')
    var none = el('option', '', 'Choose a product…'); none.value = ''; ps.appendChild(none)
    var seen = {}
    S.rows.forEach(function (r) { if (!seen[r.slug]) { seen[r.slug] = 1; var o = el('option', '', r.name_en || r.slug); o.value = r.slug; if (r.slug === S.slug) o.selected = true; ps.appendChild(o) } })
    ps.addEventListener('change', function () { S.slug = ps.value; S.edit = {}; S.note = ''; S.log = null; render() })
    e.appendChild(ps)
    if (S.slug) {
      var grid = el('div', 'spinv-grid')
      S.rows.filter(function (r) { return r.slug === S.slug }).forEach(function (r) {
        var cell = el('label', 'spinv-cell'); cell.appendChild(el('span', '', r.size))
        var inp = el('input', 'spinv-input spinv-num'); inp.type = 'text'; inp.inputMode = 'numeric'; inp.pattern = '[0-9]*'
        inp.value = S.edit[r.sku] != null ? S.edit[r.sku] : String(r.stock); inp.setAttribute('data-sku', r.sku)
        inp.setAttribute('aria-label', 'Stock, size ' + r.size)
        inp.addEventListener('input', function () { S.edit[r.sku] = inp.value })
        cell.appendChild(inp); grid.appendChild(cell)
      })
      e.appendChild(grid)
      var sv = el('button', 'spinv-go', S.busy ? 'Saving…' : 'Save all sizes'); sv.type = 'button'; sv.disabled = S.busy
      sv.addEventListener('click', saveProduct)
      var hb = el('button', 'spinv-btn', 'History of this product'); hb.type = 'button'
      hb.addEventListener('click', function () { loadLog(S.slug) })
      var br = el('div', 'spinv-row'); br.appendChild(sv); br.appendChild(hb); e.appendChild(br)
    }
    card.appendChild(e)

    // spreadsheet + history
    var x = el('div', 'spinv-row spinv-field')
    var ex = el('button', 'spinv-btn', 'Export CSV'); ex.type = 'button'; ex.addEventListener('click', exportCsv)
    var im = el('button', 'spinv-btn', 'Import CSV…'); im.type = 'button'
    var file = el('input'); file.type = 'file'; file.accept = '.csv,text/csv'; file.hidden = true
    im.addEventListener('click', function () { file.click() })
    file.addEventListener('change', function () { if (file.files[0]) readCsv(file.files[0]); file.value = '' })
    var hi = el('button', 'spinv-btn', 'Recent changes'); hi.type = 'button'; hi.addEventListener('click', function () { loadLog('') })
    x.appendChild(ex); x.appendChild(im); x.appendChild(hi); x.appendChild(file)
    card.appendChild(x)

    if (S.preview) card.appendChild(previewView())
    if (S.log) card.appendChild(logView())
    if (S.note) card.appendChild(el('p', S.bad ? 'spinv-warn' : 'spinv-note', S.note))
  }

  function previewView() {
    var p = S.preview, box = el('div', 'spinv-box')
    box.appendChild(el('div', 'spinv-label', 'Preview — nothing is written yet'))
    box.appendChild(el('p', 'spinv-note', p.changed + ' will change, ' + (p.rows.length - p.changed - p.errors) + ' already match, ' + p.errors + ' problem' + (p.errors === 1 ? '' : 's') + '.'))
    var list = el('div', 'spinv-list')
    p.rows.filter(function (r) { return r.status !== 'same' }).slice(0, 40).forEach(function (r) {
      var line = r.status === 'ok'
        ? (r.slug + ' ' + r.size + ': ' + r.before + ' → ' + r.after)
        : (r.sku + ': ' + (STATUS[r.status] || r.status))
      list.appendChild(el('div', r.status === 'ok' ? 'spinv-li' : 'spinv-li spinv-bad', line))
    })
    box.appendChild(list)
    var row = el('div', 'spinv-row')
    var go = el('button', 'spinv-go', 'Apply ' + p.changed + ' change' + (p.changed === 1 ? '' : 's'))
    go.type = 'button'; go.disabled = p.errors > 0 || p.changed === 0 || S.busy
    go.addEventListener('click', function () { applyList(p.changes, 'import') })
    var no = el('button', 'spinv-btn', 'Cancel'); no.type = 'button'
    no.addEventListener('click', function () { S.preview = null; render() })
    row.appendChild(go); row.appendChild(no); box.appendChild(row)
    if (p.errors > 0) box.appendChild(el('p', 'spinv-warn', 'Fix the problems in the file and import it again — a spreadsheet is applied whole or not at all.'))
    return box
  }

  function logView() {
    var box = el('div', 'spinv-box')
    box.appendChild(el('div', 'spinv-label', S.log.slug ? 'History of this product' : 'Recent changes'))
    if (S.log.ready === false) { box.appendChild(el('p', 'spinv-warn', 'The history table has not been created on this shop yet.')); return box }
    if (!S.log.rows.length) { box.appendChild(el('p', 'spinv-note', 'Nothing recorded yet — changes made from now on appear here.')); return box }
    var list = el('div', 'spinv-list')
    S.log.rows.forEach(function (r) {
      var who = r.reason === 'order' ? 'an order' : r.reason === 'release' ? 'stock returned (' + (r.ref || 'order') + ')' : (r.actor || r.reason)
      var d = (r.delta > 0 ? '+' : '') + r.delta
      list.appendChild(el('div', 'spinv-li', String(r.at).slice(0, 16) + ' · ' + (r.name_en || r.slug) + ' ' + r.size + ' · ' + d + (r.stock_after != null ? ' → ' + r.stock_after : '') + ' · ' + r.reason + ' · ' + who))
    })
    box.appendChild(list)
    return box
  }

  /* ------------------------------------------------------------- actions -- */
  function saveProduct() {
    var changes = []
    S.rows.filter(function (r) { return r.slug === S.slug }).forEach(function (r) {
      var v = S.edit[r.sku] != null ? west(S.edit[r.sku]).trim() : null
      if (v != null && v !== String(r.stock)) changes.push({ sku: r.sku, stock: v })
    })
    if (!changes.length) { S.note = 'Nothing changed.'; S.bad = false; render(); return }
    applyList(changes, 'bulk')
  }
  function applyList(changes, reason) {
    S.busy = true; S.note = ''; render()
    call('inventory_apply', 'POST', { changes: changes, reason: reason }).then(function (r) {
      S.busy = false
      if (!r.ok) {
        var bad = (r.j && r.j.rows || []).filter(function (x) { return x.status !== 'ok' && x.status !== 'same' })
        S.bad = true
        S.note = 'Refused — nothing was changed. ' + (bad.length ? bad.slice(0, 4).map(function (x) { return x.sku + ': ' + (STATUS[x.status] || x.status) }).join('; ') : '')
        render(); return
      }
      S.note = 'Saved ' + r.j.changed + ' change' + (r.j.changed === 1 ? '' : 's') + '. Reloading the list…'
      S.bad = false; render()
      setTimeout(reloadHere, 700)
    })
  }
  function loadLog(slug) {
    call('inventory_log' + (slug ? '&slug=' + encodeURIComponent(slug) : '')).then(function (r) {
      S.log = r.ok ? { ready: r.j.ready, rows: r.j.rows, slug: slug } : { ready: false, rows: [], slug: slug }
      render()
    })
  }

  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
  function exportCsv() {
    var lines = ['sku,product,size,stock']
    S.rows.forEach(function (r) { lines.push([r.sku, r.name_en || r.slug, r.size, r.stock].map(csvCell).join(',')) })
    var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'sporta-stock-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click()
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false
    text = text.replace(/^﻿/, '')
    for (var i = 0; i < text.length; i++) {
      var c = text[i]
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
      else if (c === '"') q = true
      else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = '' }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
      else cell += c
    }
    row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row)
    return rows
  }
  function readCsv(file) {
    var rd = new FileReader()
    rd.onload = function () {
      var rows = parseCsv(String(rd.result)), head = (rows.shift() || []).map(function (h) { return h.trim().toLowerCase() })
      var si = head.indexOf('sku'), ti = head.indexOf('stock')
      if (si === -1 || ti === -1) { S.note = 'The file needs a header row with "sku" and "stock" columns (Export CSV makes one).'; S.bad = true; S.preview = null; render(); return }
      var changes = rows.map(function (r) { return { sku: (r[si] || '').trim(), stock: west(r[ti] || '').trim() } })
      if (!changes.length) { S.note = 'The file has no rows.'; S.bad = true; render(); return }
      call('inventory_apply', 'POST', { changes: changes, reason: 'import', dry: true }).then(function (res) {
        if (!res.ok || !res.j) { S.note = 'Could not read the file: ' + ((res.j && res.j.error) || 'error'); S.bad = true; S.preview = null; render(); return }
        S.preview = { rows: res.j.rows, errors: res.j.errors, changed: res.j.changed, changes: changes }
        S.note = ''; S.bad = false; render()
      })
    }
    rd.readAsText(file)
  }

  /* ------------------------------------------------------ mount and watch -- */
  var CSS = ''
    + '.spinv{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.25rem);margin:1rem 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.spinv-h{margin:0 0 10px;font-size:16px}'
    + '.spinv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
    + '.spinv-field{margin-top:14px}'
    + '.spinv-label{font-size:13px;font-weight:600;margin-bottom:6px}'
    + '.spinv-hint{font-size:12px;opacity:.7;flex:1 1 220px}'
    + '.spinv-chip{padding:6px 12px;border-radius:999px;border:1px solid var(--border,#2a2d31);font-size:13px}'
    + '.spinv-c-out{border-color:#b3261e;background:rgba(179,38,30,.18)}'
    + '.spinv-c-low{border-color:#c98a1b;background:rgba(201,138,27,.18)}'
    + '.spinv-input{padding:8px 10px;min-height:44px;box-sizing:border-box;border-radius:8px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;flex:1 1 220px}'
    + '.spinv-narrow{flex:0 1 200px}.spinv-num{flex:0 0 84px;min-width:0;text-align:end}'
    + '.spinv-btn,.spinv-go{padding:10px 16px;min-height:44px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit}'
    + '.spinv-go{border:0;background:var(--brand,#e0561c);color:#fff}.spinv-go[disabled],.spinv-btn[disabled]{opacity:.5;cursor:default}'
    + '.spinv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin:10px 0}'
    + '.spinv-cell{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}.spinv-cell .spinv-input{flex:1 1 auto}'
    + '.spinv-box{margin-top:14px;padding:12px;border:1px solid var(--border,#2a2d31);border-radius:10px}'
    + '.spinv-list{max-height:260px;overflow:auto;margin:8px 0;font-size:12px;line-height:1.6}'
    + '.spinv-li{padding:2px 0;border-bottom:1px solid rgba(128,128,128,.15)}.spinv-bad{color:#ff9a90}'
    + '.spinv-note{margin:12px 0 0;font-size:13px;opacity:.85}'
    + '.spinv-warn{margin:12px 0 0;font-size:13px;padding:10px 12px;border-radius:8px;background:#2a1f14;border:1px solid #5c4326;color:#ffd7a8}'
    /* rows of the bundle's own list */
    + 'tr.spinv-out>td,.m-row.spinv-out{background:rgba(179,38,30,.14)}'
    + 'tr.spinv-low>td,.m-row.spinv-low{background:rgba(201,138,27,.14)}'
    + '.spinv-hide{display:none!important}'
    + '.spinv-filtering .spux-hide:not(.spinv-hide){display:revert!important}'

  function style() {
    if (document.getElementById('spinv-css')) return
    var s = el('style'); s.id = 'spinv-css'; s.textContent = CSS; document.head.appendChild(s)
  }
  function heading() {
    var h = document.querySelector('.admin-content h1')
    return h && h.textContent.trim() === 'Inventory' ? h : null
  }
  function load() {
    Promise.all([call('variants'), call('inventory_meta')]).then(function (rs) {
      S.rows = rs[0].ok && Array.isArray(rs[0].j) ? rs[0].j : []
      S.meta = rs[1].ok && rs[1].j ? rs[1].j : { low: 5, hidden: [], log_ready: false }
      render(); annotate()
    })
  }
  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var h = heading(), existing = document.querySelector('[' + MARK + ']')
      if (!h) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
        card = null
        S = { rows: null, meta: null, q: '', filter: 'all', slug: '', edit: {}, note: '', bad: false, preview: null, log: null, busy: false }
        return
      }
      if (existing) { card = existing; annotate(); return }
      style()
      card = el('div', 'spinv'); card.setAttribute(MARK, '1')
      h.insertAdjacentElement('afterend', card)
      render(); load()
    } finally { placing = false }
  }
  var timer = null
  function schedule() { clearTimeout(timer); timer = setTimeout(place, 150) }
  function start() {
    place()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    document.addEventListener('input', function (e) { if (e.target && e.target.matches && e.target.matches('input[inputmode="numeric"]') && !e.target.closest('[' + MARK + ']')) annotate() }, true)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
