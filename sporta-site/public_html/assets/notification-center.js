/**
 * Notification centre for /backends: a bell with an unread count, and a list
 * of what needs attention — new orders, payments (received / failed / needing
 * review), return requests, failed or unfamiliar sign-ins, and one standing
 * line for sold-out and low stock.
 *
 * The list is read from admin.php?r=notifications, which builds it from the
 * tables the shop already keeps. Opening the bell marks everything read for
 * THIS admin (notifications_read). Tapping a line opens the screen it is
 * about, by pressing that screen's own nav link — no navigation of our own.
 * A fixed bell outside the bundle's markup, drawn only while a panel screen is
 * showing, so the sign-in page never carries it. All text via textContent.
 */
(function () {
  'use strict'
  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-notif'
  var H = { 'X-Sporta-Admin': '1' }
  var state = { open: false, data: null }
  var root = null, badge = null, panel = null

  function signedIn() { return !!document.querySelector('.admin-content') }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function ago(at) {
    var t = Date.parse(String(at).replace(' ', 'T'))
    if (isNaN(t)) return ''
    var m = Math.max(0, Math.round((Date.now() - t) / 60000))
    if (m < 1) return 'just now'
    if (m < 60) return m + ' min ago'
    if (m < 1440) return Math.round(m / 60) + ' h ago'
    return Math.round(m / 1440) + ' d ago'
  }

  var ICON = { order: '🛒', payment: '💳', return: '↩', security: '🔒' }

  function goto(screen) {
    var links = document.querySelectorAll('.admin-sidebar a, .admin-sidebar button, .m-tabbar a, .m-tabbar button')
    for (var i = 0; i < links.length; i++) {
      if (links[i].textContent.trim() === screen) { links[i].click(); return true }
    }
    return false
  }

  function close() { state.open = false; if (panel) panel.hidden = true; if (root) root.firstChild.setAttribute('aria-expanded', 'false') }

  function render() {
    var d = state.data
    if (!root) return
    var n = d ? d.unread : 0
    badge.textContent = n > 99 ? '99+' : String(n)
    badge.hidden = n === 0
    root.firstChild.setAttribute('aria-label', n ? 'Notifications, ' + n + ' unread' : 'Notifications')
    panel.textContent = ''
    var head = el('div', 'spnc-head', 'Notifications')
    panel.appendChild(head)
    if (!d) { panel.appendChild(el('div', 'spnc-empty', 'Loading…')); return }
    var st = d.stock || {}
    if (st.out || st.low) {
      var row = el('button', 'spnc-row spnc-stock')
      row.type = 'button'
      row.appendChild(el('span', 'spnc-ico', '📦'))
      var tx = el('span', 'spnc-tx')
      tx.appendChild(el('b', '', 'Stock needs attention'))
      tx.appendChild(el('small', '', (st.out ? st.out + ' sold out' : '') + (st.out && st.low ? ' · ' : '') + (st.low ? st.low + ' low' : '')))
      row.appendChild(tx)
      row.addEventListener('click', function () { close(); goto('Inventory') })
      panel.appendChild(row)
    }
    if (!d.items.length && !(st.out || st.low)) panel.appendChild(el('div', 'spnc-empty', 'Nothing in the last 7 days.'))
    d.items.forEach(function (it) {
      var r = el('button', 'spnc-row' + (it.unread ? ' spnc-unread' : ''))
      r.type = 'button'
      r.appendChild(el('span', 'spnc-ico', ICON[it.kind] || '•'))
      var t = el('span', 'spnc-tx')
      t.appendChild(el('b', '', it.title))
      t.appendChild(el('small', '', (it.detail ? it.detail + ' · ' : '') + ago(it.at)))
      r.appendChild(t)
      r.addEventListener('click', function () { close(); goto(it.screen) })
      panel.appendChild(r)
    })
  }

  function load() {
    return fetch(API + 'notifications', { headers: H, credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { if (j && j.items) { state.data = j; render() } })
      .catch(function () {})
  }

  function toggle() {
    state.open = !state.open
    panel.hidden = !state.open
    root.firstChild.setAttribute('aria-expanded', state.open ? 'true' : 'false')
    if (!state.open) return
    load().then(function () {
      if (state.data && state.data.unread) {
        fetch(API + 'notifications_read', { method: 'POST', headers: H, credentials: 'include' }).then(function () {
          // Keep the unread highlight on screen while the list is open; clear the badge now.
          badge.hidden = true
        }).catch(function () {})
      }
    })
  }

  var CSS = '[' + MARK + ']{position:fixed;top:10px;right:16px;z-index:45;font:14px/1.4 system-ui,sans-serif}'
    + '@media (max-width:767px){[' + MARK + ']{top:8px;right:104px}}'
    + '.spnc-btn{position:relative;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(20,22,25,.92);color:#dbdfe4;font-size:20px;cursor:pointer}'
    // ON A PHONE'S LIGHT HEADER, NO DARK TILE (2026-10-08). The plate was drawn for the dark panel
    // and kept its fill when the panel went light on 2026-10-07, so on a phone the bell was a 44px
    // near-black block — the largest, heaviest thing in the 56px white header, beside a 32px logo
    // and a transparent "Sign out". The 44x44 tap box stays; only its paint goes, so what shows is
    // the bell and its badge. Phones only: on a computer the bell is FIXED over scrolling content
    // (the header there is static), and without its plate it sat on a card's border mid-text.
    + "@media (max-width:767px){html[data-theme='light'] .spnc-btn{background:transparent;border-color:transparent}}"
    + '.spnc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#cf4a0b;color:#fff;font:700 12px/20px system-ui;text-align:center}'
    + '.spnc-panel{position:absolute;top:52px;right:0;width:min(360px,calc(100vw - 24px));max-height:70vh;overflow:auto;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#14161a;color:#dbdfe4;box-shadow:0 12px 40px rgba(0,0,0,.5);direction:ltr;text-align:left}'
    + '@media (max-width:767px){.spnc-panel{right:-96px}}'
    + '.spnc-head{padding:12px 14px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.1)}'
    + '.spnc-empty{padding:20px 14px;color:#9aa1a9}'
    + '.spnc-row{display:flex;gap:10px;align-items:flex-start;width:100%;min-height:44px;padding:10px 14px;border:0;border-bottom:1px solid rgba(255,255,255,.06);background:transparent;color:inherit;text-align:left;cursor:pointer}'
    + '.spnc-row:hover,.spnc-row:focus-visible{background:rgba(255,255,255,.06)}'
    + '.spnc-unread{background:rgba(207,74,11,.12)}'
    + '.spnc-ico{width:22px;text-align:center}.spnc-tx{display:flex;flex-direction:column;min-width:0}'
    + '.spnc-tx small{color:#9aa1a9;overflow:hidden;text-overflow:ellipsis}'

  function mount() {
    if (!signedIn()) { if (root) { root.remove(); root = null } return }
    if (root) return
    if (!document.getElementById('spnc-css')) { var s = document.createElement('style'); s.id = 'spnc-css'; s.textContent = CSS; document.head.appendChild(s) }
    root = el('div'); root.setAttribute(MARK, '')
    var b = el('button', 'spnc-btn', '🔔'); b.type = 'button'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false')
    badge = el('span', 'spnc-badge', '0'); badge.hidden = true; b.appendChild(badge)
    panel = el('div', 'spnc-panel'); panel.hidden = true; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Notifications')
    root.appendChild(b); root.appendChild(panel); document.body.appendChild(root)
    b.addEventListener('click', toggle)
    render(); load()
  }

  document.addEventListener('click', function (e) { if (state.open && root && !root.contains(e.target)) close() })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) { close(); root.firstChild.focus() } })
  var t = null
  new MutationObserver(function () { if (!t) t = setTimeout(function () { t = null; mount() }, 200) }).observe(document.body, { childList: true, subtree: true })
  setInterval(function () { if (root && !document.hidden && !state.open) load() }, 60000)
  mount()
})()
