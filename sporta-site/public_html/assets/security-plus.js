/**
 * "Sign-in security" — a card on the panel's Security screen (2026-10-04, "make full backend login
 * improve and full secure backend"). Three parts, each talking to api/security.php through admin.php:
 *
 *   Passkeys          add this device (Face ID / Touch ID / Windows Hello / a security key) with
 *                     navigator.credentials.create from passkey_options_register, saved by
 *                     passkey_register; the list with "Remove". The login page's passkey button is
 *                     assets/login-polish.js.
 *   Where you are     every signed-in browser (admin_sessions): device, address, last seen, this one
 *   signed in         marked; "Sign out" per row; "Sign out everywhere else".
 *   Policies          "Every account must use a second factor" (greyed with the reason when the shop
 *                     has no mailer) and the sign-in IP allowlist (your current address shown; a list
 *                     that leaves it out is refused by the server and said so here).
 *
 * The server validates everything again; a refusal is shown by name and changes nothing.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var MARK = 'data-sporta-security-plus', API = '/api/admin.php?r='
  var card = null, S = { st: null, note: '', bad: false, busy: false, ipText: null }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    return fetch(API + route, { method: body !== undefined ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' }, credentials: 'include', body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
  }
  var WHY = { passkeys_not_ready: 'The security tables are not on this shop yet (run the migration).', sessions_not_ready: 'The security tables are not on this shop yet (run the migration).',
    passkey_duplicate: 'This device already has a passkey for this account.', passkey_no_user_verification: 'That authenticator did not verify you (no PIN or biometric). Use one that does.',
    passkey_unsupported_key: 'That authenticator uses a key type this shop cannot verify.', passkey_bad_origin: 'The passkey was made for another address.', passkey_challenge_expired: 'Took too long — try again.',
    require_2fa_needs_mail: 'Requiring a second factor needs the shop\'s email set up (mail_from in config.php), or an account without an authenticator could never sign in.',
    ip_allow_locks_you_out: 'That list does not include the address you are using now — it would lock you out, so it was not saved.', not_signed_in: 'Your session has ended. Sign in again.' }
  function why(e) { e = String(e || ''); if (/^ip_allow_bad_rule_(\d+)$/.test(e)) return 'Line ' + e.match(/\d+$/)[0] + ' is not an IP address or a CIDR range (like 94.129.0.0/16).'; return WHY[e] || e }
  function say(t, bad) { S.note = t || ''; S.bad = !!bad; render() }
  function b64u(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer }
  function agentName(ua) { ua = ua || ''; var os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'; var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'browser'; return os + ' · ' + br }

  function addPasskey() {
    if (!window.PublicKeyCredential) { say('This browser has no passkey support.', true); return }
    S.busy = true; render()
    call('passkey_options_register', {}).then(function (r) {
      if (!r.ok) { S.busy = false; say(why(r.j && r.j.error), true); return }
      var o = r.j
      var pub = { rp: o.rp, user: { id: unb64u(o.user.id), name: o.user.name, displayName: o.user.displayName }, challenge: unb64u(o.challenge), pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation,
        excludeCredentials: (o.excludeCredentials || []).map(function (c) { return { type: c.type, id: unb64u(c.id) } }), authenticatorSelection: o.authenticatorSelection }
      return navigator.credentials.create({ publicKey: pub }).then(function (cred) {
        var label = agentName(navigator.userAgent)
        var body = { label: label, id: cred.id, rawId: b64u(cred.rawId), response: { clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject),
          transports: cred.response.getTransports ? cred.response.getTransports() : [] } }
        return call('passkey_register', body)
      }).then(function (r2) {
        S.busy = false
        if (!r2) return
        if (!r2.ok) { say(why(r2.j && r2.j.error), true); return }
        load(function () { say('Passkey added. You can now sign in with it from the login page.', false) })
      })
    }).catch(function (e) { S.busy = false; say(e && e.name === 'NotAllowedError' ? 'Cancelled.' : 'Could not create a passkey: ' + (e && e.message || e), true) })
  }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h2', 'spsec-h', 'Sign-in security'))
    var st = S.st
    if (!st) { card.appendChild(el('p', 'spsec-sub', 'Loading…')); return }
    if (st.ready === false) card.appendChild(el('p', 'spsec-warn', 'The security tables are not on this shop yet (scripts/publish/migrate-security.php). Sign-in works as before; passkeys and the session list wait for the migration.'))
    // ---- passkeys
    var pk = el('section', 'spsec-sec'); pk.setAttribute('data-spsec-passkeys', '1')
    pk.appendChild(el('h3', 'spsec-h3', 'Passkeys'))
    pk.appendChild(el('p', 'spsec-sub', 'Sign in with Face ID, Touch ID, Windows Hello or a security key instead of a password. A passkey cannot be phished or guessed, and it counts as your second factor.'))
    if (!st.passkeys.length) pk.appendChild(el('p', 'spsec-note', 'No passkeys yet.'))
    st.passkeys.forEach(function (k) {
      var row = el('div', 'spsec-row'); row.setAttribute('data-passkey', String(k.id))
      row.appendChild(el('span', 'spsec-main', (k.label || 'Passkey') + ' · added ' + String(k.created_at).slice(0, 10) + (k.last_used_at ? ' · last used ' + String(k.last_used_at).slice(0, 16) : ' · never used')))
      var rm = el('button', 'spsec-btn2', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove passkey ' + (k.label || k.id))
      rm.addEventListener('click', function () { if (!confirm('Remove this passkey? That device will need the password again.')) return; call('passkey_remove', { id: k.id }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } load() }) })
      row.appendChild(rm); pk.appendChild(row)
    })
    var add = el('button', 'spsec-btn', S.busy ? 'Waiting for the device…' : 'Add a passkey for this device'); add.type = 'button'; add.disabled = S.busy || st.ready === false || !window.PublicKeyCredential; add.setAttribute('data-spsec-add', '1')
    add.addEventListener('click', addPasskey); pk.appendChild(add)
    if (!window.PublicKeyCredential) pk.appendChild(el('p', 'spsec-note', 'This browser has no passkey support.'))
    card.appendChild(pk)
    // ---- sessions
    var ss = el('section', 'spsec-sec'); ss.setAttribute('data-spsec-sessions', '1')
    ss.appendChild(el('h3', 'spsec-h3', 'Where you are signed in'))
    if (!st.sessions.length) ss.appendChild(el('p', 'spsec-note', st.ready === false ? '' : 'Only this browser.'))
    st.sessions.forEach(function (s) {
      var row = el('div', 'spsec-row' + (s.current ? ' spsec-me' : '')); row.setAttribute('data-session', String(s.id))
      row.appendChild(el('span', 'spsec-main', agentName(s.agent) + (s.current ? ' — this browser' : '') + ' · ' + (s.ip || '?') + ' · ' + s.method + ' · last seen ' + String(s.last_seen).slice(0, 16)))
      if (!s.current) { var out = el('button', 'spsec-btn2', 'Sign out'); out.type = 'button'; out.setAttribute('aria-label', 'Sign out session ' + s.id); out.addEventListener('click', function () { call('session_revoke', { id: s.id }).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } load() }) }); row.appendChild(out) }
      ss.appendChild(row)
    })
    var others = st.sessions.filter(function (s) { return !s.current }).length
    var all = el('button', 'spsec-btn2', 'Sign out everywhere else' + (others ? ' (' + others + ')' : '')); all.type = 'button'; all.disabled = !others; all.setAttribute('data-spsec-revoke-all', '1')
    all.addEventListener('click', function () { call('sessions_revoke_others', {}).then(function (r) { if (!r.ok) { say(why(r.j && r.j.error), true); return } load(function () { say('Signed out ' + r.j.revoked + ' other browser' + (r.j.revoked === 1 ? '' : 's') + '.', false) }) }) })
    ss.appendChild(all); card.appendChild(ss)
    // ---- policies
    var po = el('section', 'spsec-sec'); po.setAttribute('data-spsec-policy', '1')
    po.appendChild(el('h3', 'spsec-h3', 'Policies'))
    var lab = el('label', 'spsec-chk'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!st.policy.require_2fa; cb.disabled = !st.mail_ready && !st.policy.require_2fa; cb.setAttribute('data-spsec-require2fa', '1')
    lab.appendChild(cb); lab.appendChild(el('span', null, 'Every account must use a second factor' + (st.mail_ready ? ' (accounts without an authenticator get an email code)' : ' — needs the shop\'s email set up first'))); po.appendChild(lab)
    po.appendChild(el('p', 'spsec-note', 'Sign-in IP allowlist — one address or range per line (your address now: ' + st.ip + '). Empty = everyone. Only signing in is checked; browsers already signed in are not cut off.'))
    var ta = el('textarea', 'spsec-ta'); ta.rows = 3; ta.value = S.ipText != null ? S.ipText : st.policy.ip_allow.join('\n'); ta.setAttribute('aria-label', 'Sign-in IP allowlist'); ta.placeholder = st.ip + '\n94.129.0.0/16'
    ta.addEventListener('input', function () { S.ipText = ta.value }); po.appendChild(ta)
    var row = el('div', 'spsec-actions')
    var save = el('button', 'spsec-btn', 'Save policies'); save.type = 'button'; save.setAttribute('data-spsec-save', '1')
    save.addEventListener('click', function () {
      save.disabled = true
      call('settings_save', { name: 'security', value: { require_2fa: cb.checked, ip_allow: ta.value.split(/\r?\n/).map(function (x) { return x.trim() }).filter(Boolean) } }).then(function (r) {
        save.disabled = false
        if (!r.ok) { say(why(r.j && r.j.error), true); return }
        S.ipText = null; load(function () { say('Policies saved.', false) })
      })
    })
    row.appendChild(save); po.appendChild(row); card.appendChild(po)
    if (S.note) card.appendChild(el('p', S.bad ? 'spsec-warn' : 'spsec-ok', S.note))
  }
  function load(after) { call('security_state').then(function (r) { S.st = r.ok ? r.j : { ready: false, passkeys: [], sessions: [], policy: { require_2fa: false, ip_allow: [] }, ip: '', mail_ready: false }; render(); if (after) after() }) }

  var CSS = ''
    + '.spsec{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.spsec-h{margin:0 0 6px;font-size:16px;font-weight:700}.spsec-h3{margin:0 0 4px;font-size:14px;font-weight:700}.spsec-sec{padding:12px 0;border-top:1px solid rgba(128,128,128,.2)}.spsec-sec:first-of-type{border-top:0}'
    + '.spsec-sub{margin:0 0 10px;font-size:13px;opacity:.8;line-height:1.5}.spsec-note{margin:8px 0;font-size:13px;opacity:.8;line-height:1.5}'
    + '.spsec-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;font-size:13px}.spsec-main{flex:1 1 240px}.spsec-me{font-weight:600}'
    + '.spsec-btn{min-height:44px;padding:8px 14px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700;margin-top:6px}'
    + '.spsec-btn2{min-height:40px;padding:6px 12px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.spsec-btn[disabled],.spsec-btn2[disabled]{opacity:.5;cursor:default}'
    + '.spsec-chk{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14px}.spsec-chk input{width:20px;height:20px}'
    + '.spsec-ta{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:13px ui-monospace,monospace}'
    + '.spsec-actions{display:flex;gap:8px;margin-top:8px}.spsec-ok{margin:10px 0 0;font-size:13px;color:#16a34a}.spsec-warn{margin:10px 0 0;font-size:13px;color:#dc2626}'
  function style() { if (document.getElementById('spsec-css')) return; var s = el('style'); s.id = 'spsec-css'; s.textContent = CSS; document.head.appendChild(s) }

  // The Security screen: the same headings login-log.js and passcode-login.js look for.
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
      if (!h) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); card = null; S = { st: null, note: '', bad: false, busy: false, ipText: null }; return }
      if (existing) { card = existing; return }
      style()
      card = el('section', 'spsec'); card.setAttribute(MARK, '1')
      var host = document.querySelector('.admin-content')
      var top = h; while (top && top.parentNode !== host) top = top.parentNode
      if (top && top.parentNode === host) host.insertBefore(card, top.nextSibling); else host.appendChild(card)
      render(); load()
    } finally { placing = false }
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 200) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
