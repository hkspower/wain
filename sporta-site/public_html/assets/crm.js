/**
 * Sporta — a customer directory on the website's Orders screen: "make CRM at
 * backends", scoped in three answers before a line was written — website
 * panel, grouped by phone, and per-customer history plus visible blocking.
 *
 * A "CUSTOMER" IS A PHONE NUMBER, not a row in the `customers` table. That
 * table exists (2026-09-19's sign-in feature) and has real signups of zero —
 * a directory built from it would show nothing. Every order this shop has
 * ever taken carries a phone, guest or not, and `orders.customer_phone` is
 * canonicalised by store_phone() at checkout, the same function
 * blocked_customers.phone and customers.phone go through — so grouping by it
 * is both the real data and the thing three tables already agree on.
 *
 * BLOCKING, MADE VISIBLE. block_customer/unblock_customer have existed since
 * this shop's early days, called from a button on the order screen — and
 * nothing anywhere lists who is currently blocked or why. Found while reading
 * admin.php for this feature, not asked for on its own: a block placed by
 * mistake, or one made months ago for a reason nobody remembers, had no
 * screen to be reviewed from except phpMyAdmin. This card shows every one,
 * including a phone that has never ordered — blocking does not require an
 * order to exist.
 *
 * IT WRITES NOTHING NEW. Block and unblock call the SAME two admin routes
 * this shop has always had; this is the first screen that can see their
 * effect. The directory and profile routes are both reads.
 *
 * WHY THE ORDERS SCREEN. There is no "Customers" entry in this panel's own
 * navigation, and the bundle that draws it has no source here — CLAUDE.md
 * records four times that a screen the owner cannot reach in a browser is a
 * screen that does not exist to them. The overlay pattern this shop's panel
 * already uses is a card attached to an EXISTING screen's heading, and Orders
 * is where an admin already thinks about a customer.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-crm'
  var API = '/api/admin.php?r='
  var card = null
  var state = { rows: null, q: '', selected: null, detail: null, busy: false, note: '' }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function call(route, method, body) {
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) {
        return { ok: r.ok, status: r.status, j: j }
      })
    })
  }

  var money = function (kwd) {
    try { return Number(kwd).toLocaleString('en-US', { minimumFractionDigits: 3 }) + ' KWD' }
    catch (e) { return kwd + ' KWD' }
  }
  var when = function (s) {
    if (!s) return '—'
    try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
    catch (e) { return s }
  }

  /* ------------------------------------------------------------------ list */

  function load() {
    state.rows = null; render()
    call('crm_customers' + (state.q ? '&q=' + encodeURIComponent(state.q) : '')).then(function (r) {
      state.rows = (r.ok && Array.isArray(r.j)) ? r.j : []
      render()
    })
  }

  function loadDetail(phone) {
    state.detail = null; render()
    call('crm_customer&phone=' + encodeURIComponent(phone)).then(function (r) {
      state.detail = (r.ok && r.j) ? r.j : { error: (r.j && r.j.error) || r.status }
      render()
    })
  }

  function renderList() {
    var wrap = el('div')
    var searchRow = el('div', 'crm-row')
    var input = el('input', 'crm-input')
    input.type = 'search'
    input.placeholder = 'Search by name, email or phone'
    input.value = state.q
    input.addEventListener('input', function () {
      state.q = input.value
      clearTimeout(input._t)
      input._t = setTimeout(load, 300)
    })
    searchRow.appendChild(input)
    wrap.appendChild(searchRow)

    if (state.rows === null) { wrap.appendChild(el('p', 'crm-note', 'Loading…')); return wrap }
    if (!state.rows.length) { wrap.appendChild(el('p', 'crm-note', 'No customers match that search.')); return wrap }

    var table = el('div', 'crm-table')
    state.rows.forEach(function (c) {
      var row = el('button', 'crm-cust')
      row.type = 'button'
      row.addEventListener('click', function () { state.selected = c.phone; loadDetail(c.phone) })

      var top = el('div', 'crm-cust-top')
      top.appendChild(el('span', 'crm-cust-name', c.name || '(no name on file)'))
      if (c.blocked) top.appendChild(el('span', 'crm-badge crm-badge-blocked', 'Blocked' + (c.blocked_scope === 'all' ? ' (all orders)' : ' (COD)')))
      if (c.has_account) top.appendChild(el('span', 'crm-badge crm-badge-account', 'Has account'))
      row.appendChild(top)

      var sub = el('div', 'crm-cust-sub')
      sub.appendChild(el('span', null, c.phone))
      if (c.email) sub.appendChild(el('span', null, ' · ' + c.email))
      row.appendChild(sub)

      var stats = el('div', 'crm-cust-stats')
      stats.appendChild(el('span', null, c.order_count + (c.order_count === 1 ? ' order' : ' orders')))
      stats.appendChild(el('span', null, money(c.paid_total) + ' paid'))
      stats.appendChild(el('span', null, 'last ' + when(c.last_order_at)))
      row.appendChild(stats)

      table.appendChild(row)
    })
    wrap.appendChild(table)
    return wrap
  }

  /* ---------------------------------------------------------------- detail */

  function doBlock(phone, scope) {
    var reason = window.prompt('Why? Future-you will want to know.', '')
    if (reason === null) return
    if (reason.trim() === '') { state.note = 'A reason is required.'; render(); return }
    state.busy = true; render()
    call('block_customer', 'POST', { phone: phone, scope: scope, reason: reason.trim() }).then(function () {
      state.busy = false
      loadDetail(phone)
      load()
    })
  }
  function doUnblock(phone) {
    state.busy = true; render()
    call('unblock_customer', 'POST', { phone: phone }).then(function () {
      state.busy = false
      loadDetail(phone)
      load()
    })
  }

  function renderDetail() {
    var wrap = el('div', 'crm-detail')
    var back = el('button', 'crm-back', '← All customers')
    back.type = 'button'
    back.addEventListener('click', function () { state.selected = null; state.detail = null; render() })
    wrap.appendChild(back)

    if (!state.detail) { wrap.appendChild(el('p', 'crm-note', 'Loading…')); return wrap }
    if (state.detail.error) {
      wrap.appendChild(el('p', 'crm-note', 'Could not load this customer (' + state.detail.error + ').'))
      return wrap
    }
    var d = state.detail
    wrap.appendChild(el('h4', 'crm-phone', d.phone))

    if (d.account) {
      wrap.appendChild(el('p', 'crm-note',
        'Has an account: ' + d.account.email + (d.account.name ? ' (' + d.account.name + ')' : '') +
        ', joined ' + when(d.account.created_at) + '.'))
    }

    var blockBox = el('div', 'crm-block')
    if (d.blocked) {
      blockBox.appendChild(el('p', 'crm-blocked-line',
        'Blocked (' + (d.blocked.scope === 'all' ? 'all orders' : 'cash on delivery') + ') by ' +
        (d.blocked.blocked_by || 'unknown') + ', ' + when(d.blocked.created_at) + '.'))
      if (d.blocked.reason) blockBox.appendChild(el('p', 'crm-blocked-reason', '“' + d.blocked.reason + '”'))
      var un = el('button', 'crm-go crm-go-quiet', state.busy ? 'Working…' : 'Unblock')
      un.type = 'button'; un.disabled = state.busy
      un.addEventListener('click', function () { doUnblock(d.phone) })
      blockBox.appendChild(un)
    } else {
      var b1 = el('button', 'crm-go crm-go-quiet', 'Block (cash on delivery)')
      b1.type = 'button'; b1.disabled = state.busy
      b1.addEventListener('click', function () { doBlock(d.phone, 'cod') })
      var b2 = el('button', 'crm-go crm-go-danger', 'Block (all orders)')
      b2.type = 'button'; b2.disabled = state.busy
      b2.addEventListener('click', function () { doBlock(d.phone, 'all') })
      blockBox.appendChild(b1)
      blockBox.appendChild(b2)
    }
    wrap.appendChild(blockBox)
    if (state.note) wrap.appendChild(el('p', 'crm-note', state.note))

    wrap.appendChild(el('h5', 'crm-h5', 'Orders (' + d.orders.length + ')'))
    if (!d.orders.length) wrap.appendChild(el('p', 'crm-note', 'No orders on this phone.'))
    d.orders.forEach(function (o) {
      var row = el('div', 'crm-line')
      row.appendChild(el('span', null, o.track_id))
      row.appendChild(el('span', null, money(o.amount)))
      row.appendChild(el('span', null, o.payment_status + ' / ' + o.fulfilment_status))
      row.appendChild(el('span', null, when(o.created_at)))
      wrap.appendChild(row)
    })

    if (d.reviews.length) {
      wrap.appendChild(el('h5', 'crm-h5', 'Reviews (' + d.reviews.length + ')'))
      d.reviews.forEach(function (rv) {
        var row = el('div', 'crm-line')
        row.appendChild(el('span', null, '★'.repeat(rv.rating) + '☆'.repeat(5 - rv.rating)))
        row.appendChild(el('span', null, rv.comment || '(no comment)'))
        row.appendChild(el('span', null, rv.published ? 'published' : 'unpublished'))
        wrap.appendChild(row)
      })
    }

    if (d.returns.length) {
      wrap.appendChild(el('h5', 'crm-h5', 'Returns & exchanges (' + d.returns.length + ')'))
      d.returns.forEach(function (rr) {
        var row = el('div', 'crm-line')
        row.appendChild(el('span', null, rr.ref))
        row.appendChild(el('span', null, rr.kind + ' / ' + rr.status))
        row.appendChild(el('span', null, rr.track_id))
        row.appendChild(el('span', null, when(rr.created_at)))
        wrap.appendChild(row)
      })
    }

    return wrap
  }

  /* ------------------------------------------------------------------ view */

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'crm-h', 'Customers'))
    card.appendChild(el('p', 'crm-sub',
      'Grouped by phone number, from every order this shop has taken. An account from the '
      + 'sign-in on the website is shown when one matches, but the order history is the record.'))
    card.appendChild(state.selected ? renderDetail() : renderList())
  }

  /* --------------------------------------------------------------- styling */

  var CSS = ''
    + '.crm{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);'
    + 'padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.crm-h{margin:0 0 4px;font-size:16px}'
    + '.crm-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.crm-row{display:flex;gap:10px;margin-bottom:14px}'
    + '.crm-input{flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--border,#2a2d31);'
    + 'background:transparent;color:inherit;font:inherit}'
    + '.crm-table{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto}'
    + '.crm-cust{display:flex;flex-direction:column;gap:4px;text-align:start;padding:10px 12px;'
    + 'border-radius:8px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;'
    + 'font:inherit;cursor:pointer;min-height:44px}'
    + '.crm-cust:hover{border-color:var(--sp-ember,#ff7b17)}'
    + '.crm-cust-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700}'
    + '.crm-cust-sub{opacity:.7;font-size:12px}'
    + '.crm-cust-stats{display:flex;gap:12px;font-size:12px;opacity:.85;flex-wrap:wrap}'
    + '.crm-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}'
    + '.crm-badge-blocked{background:#3a1a16;color:#ffb59a}'
    + '.crm-badge-account{background:#173a2a;color:#8fe0b4}'
    + '.crm-back{padding:8px 4px;border:0;background:transparent;color:var(--sp-ember,#ff7b17);'
    + 'font:inherit;cursor:pointer;min-height:44px}'
    + '.crm-phone{margin:8px 0;font-size:18px;direction:ltr;text-align:start}'
    + '.crm-h5{margin:18px 0 8px;font-size:13px;opacity:.8;text-transform:uppercase;letter-spacing:.04em}'
    + '.crm-line{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;padding:6px 0;'
    + 'border-top:1px solid var(--border,#2a2d31)}'
    + '.crm-block{margin:10px 0;padding:12px;border-radius:8px;background:rgba(255,255,255,.02);'
    + 'border:1px solid var(--border,#2a2d31)}'
    + '.crm-blocked-line{margin:0 0 4px;font-weight:700}'
    + '.crm-blocked-reason{margin:0 0 10px;opacity:.85;font-style:italic}'
    + '.crm-go{padding:9px 14px;min-height:44px;border-radius:8px;border:0;cursor:pointer;'
    + 'font:inherit;font-weight:600;margin-inline-end:8px}'
    + '.crm-go[disabled]{opacity:.5;cursor:default}'
    + '.crm-go-quiet{background:var(--border,#2a2d31);color:inherit}'
    + '.crm-go-danger{background:#5c2a1e;color:#ffb59a}'
    + '.crm-note{margin:8px 0;font-size:13px;opacity:.8}'

  function style() {
    if (document.getElementById('crm-css')) return
    var s = el('style')
    s.id = 'crm-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /* --------------------------------------------------------- where it lives */

  function ordersHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Orders') return hs[i]
    }
    return null
  }

  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var head = ordersHeading()
      var existing = document.querySelector('[' + MARK + ']')
      if (!head) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
        card = null
        state = { rows: null, q: '', selected: null, detail: null, busy: false, note: '' }
        return
      }
      if (existing) { card = existing; return }
      style()
      card = el('div', 'crm')
      card.setAttribute(MARK, '1')
      var host = head.parentNode
      if (host && host.parentNode) host.parentNode.insertBefore(card, host.nextSibling)
      else document.body.appendChild(card)
      render()
      load()
    } finally {
      placing = false
    }
  }

  var timer = null
  function schedule() { clearTimeout(timer); timer = setTimeout(place, 150) }

  function start() {
    place()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
