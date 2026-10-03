/**
 * "Forgot password?" on /backends — reset by an emailed code.
 *
 * WHY AN OVERLAY: the panel is a prebuilt bundle with no source here, so its
 * login screen cannot be edited. This adds a link under the sign-in form and
 * a two-step form (address, then code + new password) beside it. It grants
 * nothing: the server checks the code, and a reset never signs anyone in —
 * the normal sign-in (and any second factor) is still what opens the panel.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-reset'
  var ar = function () { return document.documentElement.lang === 'ar' }
  var T = function (en, a) { return ar() ? a : en }

  function onPanel() { return /^\/backends(\/|$)/.test(location.pathname) }

  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9. admin.php keeps only ASCII
     digits of the code, so a code typed on an Arabic number pad arrived empty,
     was refused as reset_refused, and used up one of the attempts. */
  function west(s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (c) {
      var n = c.charCodeAt(0)
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }

  function api(route, body) {
    return fetch(API + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j || {} } }) })
  }

  function findForm() {
    var pw = document.querySelector('input[type="password"]')
    if (!pw || pw.closest('[' + MARK + ']') || pw.closest('[data-sporta-pass-pad]')) {
      var all = document.querySelectorAll('input[type="password"]')
      pw = null
      for (var i = 0; i < all.length; i++) {
        if (!all[i].closest('[' + MARK + ']') && !all[i].closest('[data-sporta-pass-pad]')) { pw = all[i]; break }
      }
    }
    return pw ? (pw.closest('form') || pw.parentElement) : null
  }

  var INPUT = 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);'
    + 'background:transparent;color:inherit;font-size:15px;box-sizing:border-box'

  function field(type, ph, auto) {
    var i = document.createElement('input')
    i.type = type; i.placeholder = ph; i.autocomplete = auto
    i.style.cssText = INPUT
    return i
  }
  function button(text, primary) {
    var b = document.createElement('button')
    b.type = 'button'; b.textContent = text
    b.style.cssText = primary
      ? 'padding:10px 18px;border-radius:999px;border:0;cursor:pointer;font-weight:700'
      : 'background:none;border:0;color:inherit;text-decoration:underline;opacity:.75;cursor:pointer;font-size:13px;padding:8px'
    return b
  }

  var open = false

  function mount() {
    // SIGNED-OUT SCREEN ONLY. A signed-in panel screen can hold password
    // fields of its own (the payment credentials, the account form), and
    // finding one of those is not finding the login form.
    if (document.querySelector('.admin-content')) {
      var stale = document.querySelector('[' + MARK + ']')
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale)
      return
    }
    var form = findForm()
    if (!form) return
    var existing = document.querySelector('[' + MARK + ']')
    if (existing) return

    var wrap = document.createElement('div')
    wrap.setAttribute(MARK, '1')
    wrap.style.cssText = 'margin:10px auto 0;max-width:340px;text-align:center'
    var link = button(T('Forgot password?', 'نسيت كلمة المرور؟'), false)
    var box = document.createElement('div')
    box.style.cssText = 'display:none;flex-direction:column;gap:10px;text-align:start;margin-top:8px'
    wrap.appendChild(link); wrap.appendChild(box)
    form.parentNode.insertBefore(wrap, form.nextSibling)

    var msg = document.createElement('div')
    msg.setAttribute('role', 'status')
    msg.style.cssText = 'font-size:13px;min-height:1.3em;line-height:1.4'
    function say(t, ok) { msg.style.color = ok ? '#4ade80' : '#ff6b6b'; msg.textContent = t }

    var email = field('email', T('Admin email', 'بريد المسؤول'), 'username')
    var send = button(T('Email me a code', 'أرسل لي رمزًا'), true)
    var code = field('text', T('8-digit code from the email', 'الرمز المكوّن من 8 أرقام'), 'one-time-code')
    code.inputMode = 'numeric'; code.pattern = '[0-9]*'; code.maxLength = 8
    var p1 = field('password', T('New password (12+ characters)', 'كلمة مرور جديدة (12 حرفًا فأكثر)'), 'new-password')
    var p2 = field('password', T('New password again', 'أعد كتابة كلمة المرور'), 'new-password')
    var done = button(T('Set new password', 'تعيين كلمة المرور'), true)
    code.style.display = p1.style.display = p2.style.display = done.style.display = 'none'
    box.appendChild(email); box.appendChild(send); box.appendChild(code)
    box.appendChild(p1); box.appendChild(p2); box.appendChild(done); box.appendChild(msg)

    link.addEventListener('click', function () {
      open = !open
      box.style.display = open ? 'flex' : 'none'
    })

    var busy = false
    send.addEventListener('click', function () {
      if (busy || !email.value.trim()) return
      busy = true; say('…', true)
      api('password_reset_request', { email: email.value.trim() }).then(function (r) {
        busy = false
        if (r.status === 429) return say(T('Too many requests. Wait a few minutes.', 'طلبات كثيرة. انتظر قليلًا.'))
        // The same words whether or not the address has an account.
        say(T('If that address has an admin account, a code is on its way. It lasts 15 minutes.',
          'إن كان لهذا البريد حساب مسؤول فقد أُرسل إليه رمز صالح 15 دقيقة.'), true)
        code.style.display = p1.style.display = p2.style.display = done.style.display = ''
      }).catch(function () { busy = false; say(T('Could not reach the shop.', 'تعذّر الاتصال.')) })
    })

    var WHY = {
      password_too_short: T('The password needs at least 12 characters.', 'كلمة المرور تحتاج 12 حرفًا على الأقل.'),
      password_mismatch: T('The two passwords do not match.', 'كلمتا المرور غير متطابقتين.'),
      password_too_common: T('That password is too easy to guess. Pick another.', 'كلمة المرور سهلة التخمين. اختر غيرها.'),
      reset_refused: T('That code is not right, or it has expired. Ask for a new one.', 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.'),
      too_many_attempts: T('Too many tries. Wait a few minutes.', 'محاولات كثيرة. انتظر قليلًا.'),
    }
    done.addEventListener('click', function () {
      if (busy) return
      busy = true; say('…', true)
      api('password_reset_confirm', { email: email.value.trim(), code: west(code.value).replace(/\D/g, ''), password: p1.value, password2: p2.value }).then(function (r) {
        busy = false
        if (!r.ok) return say(WHY[r.j.error] || T('Could not reset the password.', 'تعذّر إعادة التعيين.'))
        p1.value = ''; p2.value = ''; code.value = ''
        say(T('Password changed. Sign in with the new one.', 'تم تغيير كلمة المرور. سجّل الدخول بالجديدة.'), true)
      }).catch(function () { busy = false; say(T('Could not reach the shop.', 'تعذّر الاتصال.')) })
    })
  }

  function start() {
    if (!onPanel()) return
    var t = null
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(mount, 120) })
      .observe(document.body, { childList: true, subtree: true })
    mount()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
