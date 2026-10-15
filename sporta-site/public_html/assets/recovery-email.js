/**
 * "Recovery email" — a card on the panel's Security screen (2026-10-15, "add recovery email").
 *
 * A second address that also receives the password-reset code, for the day the sign-in mailbox is
 * lost. Server: admin.php recovery_state / recovery_set / recovery_resend / recovery_verify /
 * recovery_remove. Setting or removing it asks for the password (and the second-factor code where
 * one is set up); a new address gets reset codes only after the 8-digit code mailed to it is typed
 * back here. The sign-in address is emailed whenever it changes.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var MARK = 'data-sporta-recovery', API = '/api/admin.php?r='
  var card = null, S = { st: null, note: '', bad: false, busy: false, edit: false, vals: {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    var ctl = window.AbortController ? new AbortController() : null
    var t = ctl ? setTimeout(function () { ctl.abort() }, 30000) : 0
    return fetch(API + route, { method: body !== undefined ? 'POST' : 'GET', credentials: 'include', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' }, body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) { clearTimeout(t); return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, j: j } }) })
      .catch(function () { clearTimeout(t); return { ok: false, j: { error: 'network' } } })
  }
  var WHY = {
    bad_password: 'That password is not right.', code_required: 'Type the code from your authenticator or email.', bad_second_factor: 'That sign-in code is not right.',
    invalid_email: 'That is not an email address.', same_as_sign_in_email: 'Use a different address from the one you sign in with.',
    bad_code: 'That code is not right.', code_expired: 'That code has expired or was used up. Send a new one.', nothing_to_confirm: 'There is nothing waiting to be confirmed.',
    recovery_not_ready: 'The database is not updated for this yet (scripts/publish/migrate-recovery.php).', too_many_attempts: 'Too many tries. Wait a few minutes.',
    network: 'The connection dropped. Try again.', not_signed_in: 'Your session has ended. Sign in again.',
  }
  function why(e) { return WHY[e] || (e ? 'Could not save (' + e + ').' : 'Could not save.') }
  function say(t, bad) { S.note = t || ''; S.bad = !!bad; render() }
  function input(type, label, attrs) {
    var l = el('label', 'sprec-lab'); l.appendChild(el('span', null, label))
    var i = el('input', 'sprec-in'); i.type = type
    for (var k in attrs || {}) i.setAttribute(k, attrs[k])
    l.appendChild(i); return [l, i]
  }
  function load(after) {
    call('recovery_state').then(function (r) { S.st = r.ok ? r.j : { ready: false }; render(); if (after) after() })
  }
  function run(route, body, ok) {
    S.busy = true; render()
    call(route, body).then(function (r) {
      S.busy = false
      if (!r.ok) { say(why(r.j && r.j.error), true); return }
      S.st = r.j; S.edit = false; S.vals = {}; say(ok, false)
    })
  }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h2', 'spsec-h', 'Recovery email'))
    card.appendChild(el('p', 'spsec-sub', 'A second address that also gets your password-reset code, in case you lose the mailbox you sign in with.'))
    var st = S.st
    if (!st) { card.appendChild(el('p', 'spsec-sub', 'Loading…')); return }
    if (st.ready === false) { card.appendChild(el('p', 'spsec-warn', WHY.recovery_not_ready)); return }

    var now = el('p', 'sprec-now')
    now.setAttribute('data-sprec-state', st.verified ? 'verified' : st.pending ? 'pending' : 'none')
    now.textContent = st.verified ? 'Recovery email: ' + st.email + ' — confirmed.' : st.pending ? 'Waiting for confirmation: ' + st.email : 'No recovery email yet.'
    card.appendChild(now)

    if (st.pending) {
      var f1 = el('form', 'sprec-form')
      var c = input('text', 'Code sent to ' + st.email, { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8', 'data-sprec-code': '' })
      f1.appendChild(c[0])
      var go = el('button', 'spsec-btn', S.busy ? 'Checking…' : 'Confirm'); go.type = 'submit'; go.disabled = S.busy
      var again = el('button', 'spsec-btn2', 'Send a new code'); again.type = 'button'; again.disabled = S.busy
      again.addEventListener('click', function () { run('recovery_resend', {}, 'A new code is on its way to ' + st.email + '.') })
      var row = el('div', 'sprec-row'); row.appendChild(go); row.appendChild(again); f1.appendChild(row)
      f1.addEventListener('submit', function (e) { e.preventDefault(); run('recovery_verify', { code: c[1].value }, 'Confirmed. Reset codes will also go to ' + st.email + '.') })
      card.appendChild(f1)
    }

    if (!S.edit) {
      var row2 = el('div', 'sprec-row')
      var ch = el('button', 'spsec-btn2', st.email ? 'Change' : 'Add a recovery email'); ch.type = 'button'; ch.setAttribute('data-sprec-edit', '')
      ch.addEventListener('click', function () { S.edit = 'set'; S.note = ''; render() })
      row2.appendChild(ch)
      if (st.email) {
        var rm = el('button', 'spsec-btn2', 'Remove'); rm.type = 'button'; rm.setAttribute('data-sprec-remove', '')
        rm.addEventListener('click', function () { S.edit = 'remove'; S.note = ''; render() })
        row2.appendChild(rm)
      }
      card.appendChild(row2)
    } else {
      var f2 = el('form', 'sprec-form'); f2.setAttribute('data-sprec-form', S.edit)
      var em = S.edit === 'set' ? input('email', 'Recovery email', { autocomplete: 'email', maxlength: '190', 'data-sprec-email': '' }) : null
      if (em) { em[1].value = S.vals.email || ''; f2.appendChild(em[0]) }
      var pw = input('password', 'Your password', { autocomplete: 'current-password', 'data-sprec-password': '' }); f2.appendChild(pw[0])
      var tf = input('text', 'Sign-in code (only if you use an authenticator or email code)', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8', 'data-sprec-2fa': '' }); f2.appendChild(tf[0])
      var row3 = el('div', 'sprec-row')
      var ok = el('button', 'spsec-btn', S.busy ? 'Saving…' : S.edit === 'set' ? 'Send confirmation code' : 'Remove recovery email'); ok.type = 'submit'; ok.disabled = S.busy
      var cancel = el('button', 'spsec-btn2', 'Cancel'); cancel.type = 'button'
      cancel.addEventListener('click', function () { S.edit = false; S.note = ''; render() })
      row3.appendChild(ok); row3.appendChild(cancel); f2.appendChild(row3)
      f2.addEventListener('submit', function (e) {
        e.preventDefault()
        // Kept across a refusal so a wrong password does not also wipe the address typed.
        S.vals = { email: em ? em[1].value : '' }
        if (S.edit === 'set') run('recovery_set', { email: em[1].value, password: pw[1].value, code: tf[1].value }, 'Code sent to ' + em[1].value.trim() + '. Type it above to confirm.')
        else run('recovery_remove', { password: pw[1].value, code: tf[1].value }, 'Recovery email removed.')
      })
      card.appendChild(f2)
      ;(em ? em[1] : pw[1]).focus()
    }
    if (S.note) { var n = el('p', S.bad ? 'sprec-bad' : 'sprec-ok', S.note); n.setAttribute('role', S.bad ? 'alert' : 'status'); card.appendChild(n) }
  }

  var CSS = '[' + MARK + ']{margin-top:24px}'
    + '.sprec-now{font-weight:600;margin:10px 0}'
    + '.sprec-form{display:grid;gap:12px;max-width:420px;margin:12px 0}'
    + '.sprec-lab span{display:block;font-size:13px;font-weight:600;margin-bottom:6px}'
    + '.sprec-in{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid #cbd5e1;font:inherit;font-size:16px;background:#fff;color:#0f172a}'
    + '.sprec-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px}'
    + '.sprec-ok{color:#15803d;font-weight:600;margin:10px 0 0}.sprec-bad{color:#b91c1c;font-weight:600;margin:10px 0 0}'
  function style() { if (document.getElementById('sprec-css')) return; var s = el('style'); s.id = 'sprec-css'; s.textContent = CSS; document.head.appendChild(s) }

  function securityHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) { var t = hs[i].textContent.trim(); if (t === 'Two-factor sign-in' || t === 'Your details' || t === 'Security') return hs[i] }
    return null
  }
  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var h = securityHeading(), existing = document.querySelector('[' + MARK + ']')
      if (!h) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); card = null; S = { st: null, note: '', bad: false, busy: false, edit: false, vals: {} }; return }
      if (existing) { card = existing; return }
      style()
      card = el('section', 'spsec'); card.setAttribute(MARK, '1')
      var host = document.querySelector('.admin-content')
      var after = document.querySelector('[data-sporta-security-plus]')
      if (!after) { after = h; while (after && after.parentNode !== host) after = after.parentNode }
      if (after && after.parentNode === host) host.insertBefore(card, after.nextSibling); else host.appendChild(card)
      render(); load()
    } finally { placing = false }
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 200) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
