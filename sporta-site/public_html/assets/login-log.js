/**
 * Sign-in history on the Security screen of /backends: every attempt at the
 * admin door with its address and country, failures marked, unfamiliar
 * addresses flagged. Read-only; the log is written by the server.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-loginlog'

  function securityScreen() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      var t = hs[i].textContent.trim()
      if (t === 'Two-factor sign-in' || t === 'Your details') return hs[i]
    }
    return null
  }

  function flag(cc) {
    if (!/^[A-Z]{2}$/.test(cc || '')) return ''
    return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65) + ' '
  }

  var WORDS = {
    ok: 'Signed in', code_needed: 'Password ok, code asked', bad_credentials: 'Wrong email or password',
    bad_code: 'Wrong code', locked: 'Account locked', code_expired: 'Code expired', passcode_refused: 'Wrong passcode',
    passcode_locked: 'Passcode locked', reset_refused: 'Reset code refused', google_refused: 'Google refused',
  }

  function cell(tr, text, style) {
    var td = document.createElement('td')
    td.textContent = text
    td.style.cssText = 'padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top;' + (style || '')
    tr.appendChild(td)
    return td
  }

  function mount() {
    var anchor = securityScreen()
    var existing = document.querySelector('[' + MARK + ']')
    if (!anchor) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return }
    if (existing) return

    var card = document.createElement('section')
    card.setAttribute(MARK, '1')
    card.style.cssText = 'margin:2rem 0;max-width:none;min-width:0;box-sizing:border-box;padding:18px 20px;border:1px solid rgba(255,255,255,.14);border-radius:14px;font-family:inherit'
    var h = document.createElement('h2'); h.style.cssText = 'margin:0 0 6px;font-size:16px'; h.textContent = 'Sign-in history'
    var sub = document.createElement('p'); sub.style.cssText = 'margin:0 0 12px;overflow-wrap:anywhere;font-size:13px;opacity:.75;line-height:1.5'
    var wrap = document.createElement('div'); wrap.style.cssText = 'overflow:auto;max-height:420px'
    card.appendChild(h); card.appendChild(sub); card.appendChild(wrap)
    var host = (anchor.closest && anchor.closest('section')) || anchor.parentNode
    if (host && host.parentNode) host.parentNode.insertBefore(card, host); else document.body.appendChild(card)

    fetch(API + 'login_log', { headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j || j.ready === false) { sub.textContent = 'The sign-in log is not set up on this server yet.'; return }
        sub.textContent = j.failures_24h + ' failed attempt' + (j.failures_24h === 1 ? '' : 's') + ' in the last 24 hours. '
          + 'The newest 100 attempts are shown; country is looked up from the address.'
        var tbl = document.createElement('table')
        tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;text-align:start'
        var head = document.createElement('tr')
        ;['When', 'Result', 'Account', 'Address', 'Country', 'How'].forEach(function (t) {
          var th = document.createElement('th'); th.textContent = t
          th.style.cssText = 'padding:6px 8px;text-align:start;opacity:.7;font-weight:600'; head.appendChild(th)
        })
        tbl.appendChild(head)
        if (!j.rows.length) sub.textContent += ' Nothing recorded yet.'
        j.rows.forEach(function (r) {
          var bad = r.result !== 'ok' && r.result !== 'code_needed'
          var tr = document.createElement('tr')
          cell(tr, String(r.at).slice(0, 16), 'white-space:nowrap')
          cell(tr, (WORDS[r.result] || r.result) + (r.new_ip == 1 ? ' · new address' : ''), bad ? 'color:#ff6b6b;font-weight:600' : (r.new_ip == 1 ? 'color:#fbbf24' : ''))
          cell(tr, r.email || '—')
          cell(tr, r.ip, 'font-family:ui-monospace,monospace')
          cell(tr, r.country === '--' ? 'Private network' : r.country ? flag(r.country) + (r.country_name || r.country) : '—')
          cell(tr, r.method)
          tbl.appendChild(tr)
        })
        wrap.appendChild(tbl)
      }).catch(function () { sub.textContent = 'Could not load the sign-in history.' })
  }

  var t = null
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(mount, 120) }).observe(document.body, { childList: true, subtree: true })
  mount()
})()
