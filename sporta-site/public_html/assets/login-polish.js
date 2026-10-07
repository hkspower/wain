/**
 * The panel's login page, improved from outside the bundle (2026-10-04, "make full backend login
 * improve"). The form is React's and cannot be edited; this adds beside it:
 *
 *   Sign in with a passkey   a button under the password form (only where the browser supports
 *                            WebAuthn): passkey_options_login → navigator.credentials.get →
 *                            passkey_login, then a reload into the panel. With conditional
 *                            mediation the browser also offers saved passkeys in the email box.
 *   Show / hide password     a small toggle inside the password field.
 *   Caps Lock warning        a line under the password field while Caps Lock is on.
 *   Autofocus                the email box, when it is empty and nothing else is focused.
 *   Clearer refusals         the bundle's own error text stays; a line under it explains `locked`
 *                            (15 minutes) and `ip_not_allowed` in plain words, read from the
 *                            response the form received (the fetch is observed, not replaced).
 *
 * Nothing here holds a credential: the passkey assertion goes straight to the server, the password is
 * only ever toggled between type=password and type=text in the field the owner is typing into.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var API = '/api/admin.php?r=', MARK = 'data-sporta-login-polish'
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function b64u(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer }
  function post(route, body) {
    return fetch(API + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' }, credentials: 'include', body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
  }
  var T = function (en, ar) { return document.documentElement.lang === 'ar' ? ar : en }
  var WHY = {
    locked: ['Too many wrong tries — this account is locked for 15 minutes.', 'محاولات كثيرة خاطئة — الحساب مقفل ١٥ دقيقة.'],
    ip_not_allowed: ['Signing in is not allowed from this network. Use a listed address, or ask the shop owner.', 'تسجيل الدخول غير مسموح من هذه الشبكة.'],
    passkey_refused: ['That passkey was not accepted.', 'لم يُقبل مفتاح المرور.'],
    passkeys_not_ready: ['Passkeys are not set up on this shop yet.', 'مفاتيح المرور غير مفعّلة بعد.'],
    bad_credentials: null, no_admin_account: null,
  }

  // The passcode keypad's box is type=password too (passcode-login.js), so pick the one OUTSIDE the pad.
  function pwField(root) { return [].slice.call((root || document).querySelectorAll('input[type="password"], input[data-splp-pw]')).filter(function (i) { return !i.closest('[data-sporta-pass-pad]') })[0] || null }
  function form() { var pw = pwField(); if (!pw || document.querySelector('.admin-content')) return null; return pw.closest('form') || pw.parentElement }

  var CSS = ''
    + '[data-splp-col]{flex-direction:column;gap:0}[data-splp-col]>*:not(form){width:100%;max-width:24rem;box-sizing:border-box}'
    + '.splp-wrap{position:relative}.splp-eye{position:absolute;inset-inline-end:6px;top:50%;transform:translateY(-50%);min-width:44px;min-height:44px;border:0;background:transparent;color:#334155;font:inherit;font-size:13px;font-weight:600;cursor:pointer}'
    + '.splp-caps{margin:6px 0 0;font-size:12.5px;color:#b45309}.splp-why{margin:8px 0 0;font-size:13px;color:#b91c1c}'
    + '.splp-pk{display:block;width:100%;margin-top:12px;min-height:44px;padding:10px 14px;border-radius:8px;border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;font:inherit;font-weight:700;cursor:pointer}'
    + '.splp-pk[disabled]{opacity:.6;cursor:default}.splp-or{text-align:center;font-size:12px;opacity:.6;margin:10px 0 0}'
  function style() { if (document.getElementById('splp-css')) return; var s = el('style'); s.id = 'splp-css'; s.textContent = CSS; document.head.appendChild(s) }

  var tried = false
  function passkeySignIn(btn, note) {
    btn.disabled = true; note.textContent = T('Waiting for your device…', 'بانتظار جهازك…')
    post('passkey_options_login').then(function (r) {
      if (!r.ok) { btn.disabled = false; note.textContent = (WHY[r.j && r.j.error] || [r.j && r.j.error || 'Error'])[0]; return }
      var o = r.j
      return navigator.credentials.get({ publicKey: { challenge: unb64u(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: [] } }).then(function (cred) {
        return post('passkey_login', { id: cred.id, rawId: b64u(cred.rawId), response: { clientDataJSON: b64u(cred.response.clientDataJSON), authenticatorData: b64u(cred.response.authenticatorData), signature: b64u(cred.response.signature), userHandle: cred.response.userHandle ? b64u(cred.response.userHandle) : null } })
      }).then(function (r2) {
        if (!r2.ok) { btn.disabled = false; note.textContent = (WHY[r2.j && r2.j.error] || [r2.j && r2.j.error || 'Refused'])[0]; return }
        if (r2.j && r2.j.need_code) { note.textContent = T('Passkey accepted — enter your code with the password form.', 'تم قبول المفتاح — أدخل الرمز.'); btn.disabled = false; return }
        note.textContent = T('Signed in.', 'تم تسجيل الدخول.')
        try { sessionStorage.setItem('spux-screen', 'Overview') } catch (e) {}
        location.reload()
      })
    }).catch(function (e) { btn.disabled = false; note.textContent = e && e.name === 'NotAllowedError' ? T('Cancelled.', 'أُلغي.') : T('Could not use a passkey here.', 'تعذّر استخدام مفتاح المرور.') })
  }

  function dress() {
    var f = form()
    var existing = document.querySelector('[' + MARK + ']')
    if (!f) { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); return }
    var pw = pwField(f)
    if (pw && !pw.hasAttribute('data-splp-pw')) {
      style()
      pw.setAttribute('data-splp-pw', '1')
      var wrap = pw.parentElement
      if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative'
      var eye = el('button', 'splp-eye', T('Show', 'إظهار')); eye.type = 'button'; eye.setAttribute('aria-label', T('Show password', 'إظهار كلمة المرور')); eye.setAttribute('aria-pressed', 'false'); eye.setAttribute('data-splp-eye', '1')
      eye.addEventListener('click', function () { var show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; eye.textContent = show ? T('Hide', 'إخفاء') : T('Show', 'إظهار'); eye.setAttribute('aria-pressed', show ? 'true' : 'false'); pw.focus() })
      if (wrap) wrap.appendChild(eye)
      /* The bundle puts the password box straight inside the form, so the form is the
         positioning parent: sit the toggle on the box's own vertical centre and inside
         the form's padding, instead of at the middle of the whole card. */
      if (wrap === f) {
        var place = function () { var cs = getComputedStyle(f); eye.style.top = (pw.offsetTop + pw.offsetHeight / 2) + 'px'; eye.style[(document.documentElement.dir === 'rtl') ? 'left' : 'right'] = (parseFloat(cs.paddingRight) + 6) + 'px'; eye.style[(document.documentElement.dir === 'rtl') ? 'right' : 'left'] = 'auto' }
        place(); window.addEventListener('resize', place); pw.addEventListener('focus', place)
      }
      pw.style.paddingInlineEnd = '56px'
      var caps = el('p', 'splp-caps', T('Caps Lock is on', 'مفتاح الأحرف الكبيرة مفعّل')); caps.hidden = true; caps.setAttribute('data-splp-caps', '1')
      ;(wrap || f).insertAdjacentElement('afterend', caps)
      var onKey = function (e) { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock') }
      pw.addEventListener('keydown', onKey); pw.addEventListener('keyup', onKey); pw.addEventListener('blur', function () { caps.hidden = true })
    }
    var email = f.querySelector('input[type="email"], input[autocomplete="username"]')
    if (email && !email.value && document.activeElement === document.body && !email.hasAttribute('data-splp-focused')) { email.setAttribute('data-splp-focused', '1'); try { email.focus({ preventScroll: true }) } catch (e) {} }
    if (email && window.PublicKeyCredential && !email.hasAttribute('data-splp-webauthn')) { email.setAttribute('data-splp-webauthn', '1'); if (!/webauthn/.test(email.getAttribute('autocomplete') || '')) email.setAttribute('autocomplete', (email.getAttribute('autocomplete') || 'username') + ' webauthn') }
    if (f.parentElement && f.parentElement.getAttribute('data-splp-col') == null) f.parentElement.setAttribute('data-splp-col', '1')
    if (!existing && window.PublicKeyCredential) {
      var box = el('div'); box.setAttribute(MARK, '1')
      box.appendChild(el('p', 'splp-or', T('or', 'أو')))
      var btn = el('button', 'splp-pk', T('Sign in with a passkey', 'تسجيل الدخول بمفتاح مرور')); btn.type = 'button'; btn.setAttribute('data-splp-passkey', '1')
      var note = el('p', 'splp-why'); note.setAttribute('data-splp-note', '1')
      btn.addEventListener('click', function () { passkeySignIn(btn, note) })
      box.appendChild(btn); box.appendChild(note)
      f.insertAdjacentElement('afterend', box)
      style()
    }
  }
  // Explain a refusal the form shows only as a code: observe the login response (fetch is wrapped, never replaced in effect).
  var of = window.fetch
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var p = of.apply(this, arguments)
    if (/admin\.php\?r=(login|login_code|passcode_unlock)(&|$)/.test(url)) {
      p.then(function (r) { if (r.ok) return; r.clone().json().then(function (j) { var w = j && WHY[j.error]; var f = form(); if (!w || !f) return; var old = f.querySelector('[data-splp-why]'); if (old) old.remove(); var n = el('p', 'splp-why', w[document.documentElement.lang === 'ar' ? 1 : 0]); n.setAttribute('data-splp-why', '1'); f.appendChild(n) }).catch(function () {}) }).catch(function () {})
    }
    return p
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(dress, 120) }).observe(document.documentElement, { childList: true, subtree: true })
  dress()
})()
