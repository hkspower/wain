/**
 * Every admin write, on the WEBSITE's /backends Settings screen.
 *
 * WHAT THIS IS. The read side of a shutdown hook admin.php registers right
 * after the admin gate: every save route — set_stock, product_save,
 * settings_save, all ~50 of them — lands one row in admin_audit_log whether
 * or not this file has ever heard of that route by name, because the hook
 * reads back what actually happened (an echoed body, a 2xx status) rather
 * than being told about it by each route. See store_admin_audit_log()'s own
 * comment in api/store.php.
 *
 * WHY AN OVERLAY. Same reasoning rules.js already gives at length: the
 * website's /backends is a prebuilt bundle with no source in this
 * repository, and CLAUDE.md records four separate features that began
 * app-only before this. Add a card, touch nothing that exists.
 *
 * THE SUMMARY IS ALREADY SAFE TO SHOW. admin.php redacts password/code/
 * secret-shaped fields at any depth and truncates every value over 120
 * bytes before this ever asks for it — this file renders whatever comes
 * back with textContent and adds no redaction list of its own. A second
 * list of sensitive field names here would be a second place that list
 * could go stale, the same trap the rules list avoids by reading `allowed`
 * from the server rather than keeping its own copy.
 */
;(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var state = { rows: null, loading: false, error: null }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function load() {
    if (state.loading) return
    state.loading = true
    state.error = null
    render()
    fetch(API + 'audit_log', {
      headers: { 'X-Sporta-Admin': '1' },
      credentials: 'include',
    })
      .then(function (r) { return r.json() })
      .then(function (data) {
        state.rows = (data && data.rows) || []
        state.loading = false
        render()
      })
      .catch(function () {
        state.error = 'Could not load.'
        state.loading = false
        render()
      })
  }

  function summaryLine(summary) {
    if (!summary || typeof summary !== 'object') return ''
    var parts = []
    for (var k in summary) {
      if (!Object.prototype.hasOwnProperty.call(summary, k)) continue
      var v = summary[k]
      parts.push(k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)))
    }
    return parts.join('  ·  ')
  }

  function render() {
    if (!card) return
    card.innerHTML = ''
    card.appendChild(el('h3', 'sal-h', 'Activity'))
    card.appendChild(el('p', 'sal-sub', 'Every save in this panel, newest first.'))

    if (state.error) {
      card.appendChild(el('p', 'sal-note', state.error))
      return
    }
    if (state.loading && !state.rows) {
      card.appendChild(el('p', 'sal-note', 'Loading…'))
      return
    }
    if (!state.rows || !state.rows.length) {
      card.appendChild(el('p', 'sal-note', 'Nothing logged yet.'))
      return
    }

    var list = el('div', 'sal-list')
    state.rows.forEach(function (row) {
      var item = el('div', 'sal-row')
      var top = el('div', 'sal-row-top')
      top.appendChild(el('span', 'sal-route', row.route))
      top.appendChild(el('span', 'sal-time', row.created_at))
      item.appendChild(top)
      item.appendChild(el('p', 'sal-email', row.admin_email))
      var line = summaryLine(row.summary)
      if (line) item.appendChild(el('p', 'sal-summary', line))
      list.appendChild(item)
    })
    card.appendChild(list)
  }

  var CSS = ''
    + '.sal{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.sal-h{margin:0 0 4px;font-size:16px}'
    + '.sal-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.sal-list{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto}'
    + '.sal-row{border:1px solid var(--border,#2a2d31);border-radius:8px;padding:10px 12px}'
    + '.sal-row-top{display:flex;justify-content:space-between;gap:10px;font-weight:600;font-size:13px}'
    + '.sal-time{opacity:.6;font-weight:400;white-space:nowrap}'
    + '.sal-email{margin:2px 0 0;font-size:12px;opacity:.7}'
    + '.sal-summary{margin:4px 0 0;font-size:12px;opacity:.75;word-break:break-word}'
    + '.sal-note{margin:0;font-size:13px;opacity:.7}'

  function style() {
    if (document.getElementById('sal-css')) return
    var s = document.createElement('style')
    s.id = 'sal-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /** The Settings screen, and only it — same heading match rules.js uses. */
  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    var head = settingsHeading()

    if (!head) {
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'sal')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.rows = null
    load()
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
