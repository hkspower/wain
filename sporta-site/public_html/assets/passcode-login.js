/**
 * Passcode unlock on /backends — a quick door for a browser the owner trusted.
 *
 * WHY AN OVERLAY: the website's panel is a prebuilt bundle with no source here,
 * so its login screen cannot be edited. This adds a keypad above the password
 * form (only on a browser that was enrolled) and a card on the Security screen
 * to enrol or remove devices. Nothing in the bundle is touched.
 *
 * IT CANNOT GRANT ACCESS. The server decides: it needs the device cookie (set
 * only at enrolment, HttpOnly) AND the 6-digit passcode, locks the device after
 * five wrong tries, and answers every failure alike. The password form stays
 * one tap away and is never removed.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-pass'
  var ar = function () { return document.documentElement.lang === 'ar' }
  var T = function (en, arText) { return ar() ? arText : en }

  function onPanel() { return /^\/backends(\/|$)/.test(location.pathname) }

  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9. An Arabic phone's number pad
     types those, and the strip below keeps only ASCII digits — so six taps left
     the box empty and the keypad never submitted. Here as well as in
     keyboard-hints.js so that this card never depends on that one loading. */
  function west(s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (c) {
      var n = c.charCodeAt(0)
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }

  function api(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
  }

  function findForm() {
    var pw = document.querySelector('input[type="password"]')
    if (!pw) return null
    return pw.closest('form') || pw.parentElement
  }

  /* --------------------------------------------------- the login keypad */
  var status = null          // {trusted, locked} once known
  var usePassword = false    // the owner chose the password form

  function mountKeypad() {
    if (document.querySelector('.admin-content')) return   // signed in: no keypad
    var form = findForm()
    if (!form || !status || !status.trusted) return
    var existing = document.querySelector('[' + MARK + '-pad]')
    if (existing) { form.style.display = usePassword ? '' : 'none'; existing.style.display = usePassword ? 'none' : ''; return }

    var pad = document.createElement('div')
    pad.setAttribute(MARK + '-pad', '1')
    pad.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;margin:0 auto 12px;max-width:320px;text-align:center'
    var title = document.createElement('div')
    title.style.cssText = 'font-weight:700;font-size:16px'
    title.textContent = T('Enter your passcode', 'أدخل الرمز السري')
    var input = document.createElement('input')
    input.type = 'password'
    input.inputMode = 'numeric'
    input.pattern = '[0-9]*'
    input.maxLength = 6
    input.autocomplete = 'off'
    input.setAttribute('aria-label', T('6-digit passcode', 'الرمز السري من 6 أرقام'))
    input.style.cssText = 'width:12em;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.25);'
      + 'background:transparent;color:inherit;font-size:24px;letter-spacing:.5em;text-align:center;box-sizing:border-box'
    var msg = document.createElement('div')
    msg.setAttribute('role', 'status')
    msg.style.cssText = 'font-size:13px;min-height:1.3em'
    var swap = document.createElement('button')
    swap.type = 'button'
    swap.textContent = T('Use password instead', 'استخدم كلمة المرور')
    swap.style.cssText = 'background:none;border:0;color:inherit;text-decoration:underline;opacity:.75;cursor:pointer;font-size:13px;padding:8px'
    pad.appendChild(title); pad.appendChild(input); pad.appendChild(msg); pad.appendChild(swap)
    form.parentNode.insertBefore(pad, form)
    form.style.display = 'none'

    var busy = false
    function locked(text) {
      input.disabled = true
      msg.style.color = '#ff6b6b'
      msg.textContent = text || T('Passcode locked. Sign in with your password.', 'تم قفل الرمز. سجّل الدخول بكلمة المرور.')
    }
    if (status.locked) locked()

    function submit() {
      if (busy || input.value.length !== 6) return
      busy = true; msg.style.color = ''; msg.textContent = '…'
      api('passcode_unlock', { passcode: input.value }).then(function (r) {
        if (r.ok) { location.reload(); return }
        busy = false; input.value = ''
        if (r.status === 423) return locked()
        if (r.status === 429) { msg.style.color = '#ff6b6b'; msg.textContent = T('Too many tries. Wait a few minutes.', 'محاولات كثيرة. انتظر قليلًا.'); return }
        msg.style.color = '#ff6b6b'
        msg.textContent = T('That passcode is not right.', 'الرمز غير صحيح.')
        input.focus()
      }).catch(function () {
        busy = false
        msg.style.color = '#ff6b6b'
        msg.textContent = T('Could not reach the shop. Use your password.', 'تعذّر الاتصال. استخدم كلمة المرور.')
      })
    }
    input.addEventListener('input', function () {
      input.value = west(input.value).replace(/[^0-9]/g, '').slice(0, 6)
      if (input.value.length === 6) submit()
    })
    swap.addEventListener('click', function () {
      usePassword = true
      pad.style.display = 'none'
      form.style.display = ''
    })
    setTimeout(function () { if (!input.disabled) input.focus() }, 50)
  }

  /* ------------------------------------------------ the Security card */
  function securityScreen() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      var t = hs[i].textContent.trim()
      if (t === 'Two-factor sign-in' || t === 'Your details') return hs[i]
    }
    return null
  }

  function deviceName() {
    var ua = navigator.userAgent || ''
    var os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device'
    var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'browser'
    return os + ' · ' + br
  }

  function fmt(d) { return d ? String(d).slice(0, 16).replace('T', ' ') : '—' }

  function mountCard() {
    var anchor = securityScreen()
    var existing = document.querySelector('[' + MARK + '-card]')
    if (!anchor) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      return
    }
    if (existing) return

    var card = document.createElement('section')
    card.setAttribute(MARK + '-card', '1')
    card.style.cssText = 'margin:24px auto;max-width:640px;padding:18px 20px;border:1px solid rgba(255,255,255,.14);border-radius:14px;font-family:inherit'
    var h = document.createElement('h2')
    h.style.cssText = 'margin:0 0 6px;font-size:16px'
    h.textContent = 'Passcode unlock'
    var p = document.createElement('p')
    p.style.cssText = 'margin:0 0 14px;font-size:13px;opacity:.75;line-height:1.5'
    p.textContent = 'Trust this browser and unlock the panel with a 6-digit passcode when your session times out. '
      + 'Other browsers still need your password. Five wrong tries lock the passcode; changing your password removes every trusted device.'
    card.appendChild(h); card.appendChild(p)
    var list = document.createElement('div')
    list.style.cssText = 'margin-bottom:14px;font-size:13px'
    var row = document.createElement('div')
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center'
    function pin(ph) {
      var i = document.createElement('input')
      i.type = 'password'; i.inputMode = 'numeric'; i.maxLength = 6; i.autocomplete = 'off'
      i.placeholder = ph
      i.style.cssText = 'width:9em;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font-size:14px;letter-spacing:.3em;text-align:center'
      i.addEventListener('input', function () { i.value = west(i.value).replace(/[^0-9]/g, '').slice(0, 6) })
      return i
    }
    var p1 = pin('6 digits'), p2 = pin('repeat')
    var btn = document.createElement('button')
    btn.type = 'button'; btn.textContent = 'Trust this device'
    btn.style.cssText = 'padding:9px 18px;border-radius:999px;border:0;cursor:pointer;font-weight:600'
    var note = document.createElement('span')
    note.style.cssText = 'font-size:13px;flex-basis:100%'
    row.appendChild(p1); row.appendChild(p2); row.appendChild(btn); row.appendChild(note)
    card.appendChild(list); card.appendChild(row)
    var host = anchor.parentNode
    if (host && host.parentNode) host.parentNode.insertBefore(card, host)
    else document.body.appendChild(card)

    function say(text, ok) { note.style.color = ok ? '#4ade80' : '#ff6b6b'; note.textContent = text }

    function refresh() {
      api('passcode_devices').then(function (r) {
        if (!r.ok) return
        if (r.j.ready === false) { list.textContent = 'Passcode unlock is not set up on this server yet.'; btn.disabled = true; return }
        list.innerHTML = ''
        if (!r.j.devices.length) { list.textContent = 'No trusted devices yet.'; return }
        r.j.devices.forEach(function (d) {
          var line = document.createElement('div')
          line.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)'
          var t = document.createElement('span')
          t.textContent = (d.label || 'Device') + (d.current ? ' (this browser)' : '') + (d.locked ? ' — locked' : '')
            + ' · last used ' + fmt(d.last_used_at)
          var rm = document.createElement('button')
          rm.type = 'button'; rm.textContent = 'Remove'
          rm.style.cssText = 'background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;opacity:.8'
          rm.addEventListener('click', function () {
            api('passcode_remove', { id: d.id }).then(refresh)
          })
          line.appendChild(t); line.appendChild(rm); list.appendChild(line)
        })
      })
    }
    refresh()

    btn.addEventListener('click', function () {
      note.textContent = ''
      if (!/^[0-9]{6}$/.test(p1.value)) return say('Use exactly 6 digits.')
      if (p1.value !== p2.value) return say('The two entries do not match.')
      api('passcode_enroll', { passcode: p1.value, label: deviceName() }).then(function (r) {
        if (!r.ok) return say(r.j && r.j.error === 'bad_passcode' ? 'Too easy to guess — avoid 123456, 111111 and similar.' : 'Could not save.')
        p1.value = ''; p2.value = ''
        say('This browser is trusted now.', true)
        refresh()
      })
    })
  }

  /* ------------------------------------------------------------- driver */
  var placing = false, timer = null, signedIn = false
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(function () {
      if (placing) return
      placing = true
      try { if (signedIn) mountCard(); else mountKeypad() } finally { placing = false }
    }, 120)
  }

  function start() {
    if (!onPanel()) return
    api('me').then(function (m) {
      signedIn = !!(m.ok && m.j)
      if (signedIn) return
      api('passcode_status').then(function (s) {
        if (s.ok) status = s.j
        // a password sign-in without a reload: the form disappears
        var w = new MutationObserver(function () {
          if (findForm()) return
          w.disconnect(); document.querySelectorAll('[' + MARK + '-pad]').forEach(function (n) { n.remove() })
          start()
        })
        w.observe(document.body, { childList: true, subtree: true })
      })
    }).catch(function () {}).then(function () {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
      schedule()
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
