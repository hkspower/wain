/**
 * Customer account in the top bar: a person icon beside the bag that opens a sheet — sign in or
 * create an account when nobody is signed in; name, details, the customer's own orders and sign
 * out when somebody is. The server half is api/customer.php (customer_register / customer_login /
 * customer_logout / customer_me / customer_orders), built and tested earlier; this is the screen.
 *
 *  - NOTHING IS ASKED OF A VISITOR WHO DOES NOT OPEN IT. The only request on a page load is
 *    customer_me, which answers "nobody" WITHOUT starting a session, so the storefront is still
 *    cookie-free until someone signs in or registers (then the shopper cookie appears, SameSite=Lax
 *    so the bank's redirect back does not sign them out).
 *  - Orders are the ones placed while signed in, linked by customer_id — the server says so
 *    (`note`), and the sheet repeats it rather than showing an unexplained empty list.
 *  - All text is set with textContent; nothing from the server is parsed as HTML.
 *  - One drawn control, added next to the bundle's own bag button and removed if the header is
 *    redrawn without it; the bundle's markup is not touched.
 */
(function () {
  'use strict'
  var API = '/api/api.php?r='
  var state = { me: undefined, view: 'in', busy: false, orders: null, note: '', fresh: false, methods: null, flash: '', codeEmail: '', pks: null, pkMsg: '' }
  var btn = null, overlay = null, lastFocus = null

  var L = {
    open: ['My account', 'حسابي'],
    signin: ['Sign in', 'تسجيل الدخول'], create: ['Create account', 'إنشاء حساب'],
    email: ['Email', 'البريد الإلكتروني'], password: ['Password', 'كلمة المرور'],
    name: ['Name (optional)', 'الاسم (اختياري)'], phone: ['Mobile (optional)', 'رقم الموبايل (اختياري)'],
    pwHint: ['At least 12 characters', '١٢ حرفًا على الأقل'], show: ['Show', 'إظهار'], hide: ['Hide', 'إخفاء'],
    close: ['Close', 'إغلاق'], signout: ['Sign out', 'تسجيل الخروج'],
    hello: ['Hello', 'أهلاً'], orders: ['Your orders', 'طلباتك'], loading: ['Loading…', 'جارٍ التحميل…'],
    lenOf: ['characters', 'حرفًا'], pwOk: ['Long enough', 'طويلة بما يكفي'],
    consent1: ['By creating an account you accept the ', 'بإنشاء الحساب فإنك توافق على '],
    terms: ['Terms', 'الشروط والأحكام'], and: [' and the ', ' و'], privacy: ['Privacy Policy', 'سياسة الخصوصية'],
    f_email: ['Enter a valid email address, like name@example.com.', 'اكتب بريدًا إلكترونيًا صحيحًا مثل name@example.com.'],
    f_pw_empty: ['Enter your password.', 'اكتب كلمة المرور.'],
    f_phone: ['Kuwaiti mobile: 8 digits starting with 5, 6 or 9 (the +965 is added for you).', 'رقم موبايل كويتي: ٨ أرقام يبدأ بـ ٥ أو ٦ أو ٩ (يُضاف +٩٦٥ تلقائيًا).'],
    none: ['No orders yet.', 'لا توجد طلبات بعد.'],
    note: ['Orders you place while signed in appear here.', 'الطلبات التي تضعها وأنت مسجّل الدخول تظهر هنا.'],
    track: ['Track', 'تتبع'], copied: ['Number copied — paste it on the next page', 'تم نسخ الرقم — الصقه في الصفحة التالية'],
    paid: ['Paid', 'مدفوع'], pending: ['Pending', 'قيد الانتظار'], failed: ['Failed', 'فشل'], review: ['In review', 'قيد المراجعة'],
    unfulfilled: ['Preparing', 'قيد التجهيز'], packed: ['Packed', 'تم التغليف'], shipped: ['Shipped', 'تم الشحن'],
    delivered: ['Delivered', 'تم التسليم'], cancelled: ['Cancelled', 'ملغي'],
    err_invalid_email: ['Enter a valid email address.', 'اكتب بريدًا إلكترونيًا صحيحًا.'],
    err_password_too_short: ['The password needs at least 12 characters.', 'كلمة المرور تحتاج ١٢ حرفًا على الأقل.'],
    err_password_too_long: ['That password is too long.', 'كلمة المرور طويلة جدًا.'],
    err_invalid_name: ['That name is too long.', 'الاسم طويل جدًا.'],
    err_invalid_phone: ['Kuwaiti mobile: 8 digits starting with 5, 6 or 9.', 'رقم موبايل كويتي: ٨ أرقام يبدأ بـ ٥ أو ٦ أو ٩.'],
    err_email_taken: ['That email already has an account — sign in instead.', 'هذا البريد لديه حساب بالفعل — سجّل الدخول.'],
    err_bad_credentials: ['Wrong email or password.', 'البريد أو كلمة المرور غير صحيحة.'],
    err_too_many: ['Too many attempts. Wait a few minutes and try again.', 'محاولات كثيرة. انتظر دقائق ثم حاول مجددًا.'],
    err_generic: ['Something went wrong. Please try again.', 'حدث خطأ. حاول مرة أخرى.'],
    pk: ['Sign in with Face ID / fingerprint', 'الدخول بالوجه أو البصمة'],
    google: ['Continue with Google', 'المتابعة بحساب Google'],
    or: ['or', 'أو'], remember: ['Keep me signed in', 'تذكّرني على هذا الجهاز'],
    codeLink: ['Email me a sign-in code instead', 'أرسل لي رمز دخول على البريد بدلًا من ذلك'],
    codeTitle: ['Sign in with a code', 'الدخول برمز'],
    codeIntro: ['We will email you a 6-digit code. No password needed; a new account is opened if you do not have one.', 'سنرسل رمزًا من ٦ أرقام إلى بريدك. لا حاجة لكلمة مرور، ويُفتح حساب جديد إن لم يكن لديك حساب.'],
    send: ['Send code', 'أرسل الرمز'], code: ['6-digit code', 'الرمز (٦ أرقام)'],
    codeSent: ['If the address is right, a code is on its way. Check your inbox and spam.', 'إذا كان البريد صحيحًا فالرمز في الطريق. راجع البريد الوارد والرسائل غير المرغوب فيها.'],
    verify: ['Sign in', 'دخول'], resend: ['Send a new code', 'أرسل رمزًا جديدًا'], back: ['Back', 'رجوع'],
    err_bad_code: ['That code is not right. Check it and try again.', 'الرمز غير صحيح. تحقق منه وحاول مرة أخرى.'],
    err_code_expired: ['That code has expired. Send a new one.', 'انتهت صلاحية الرمز. أرسل رمزًا جديدًا.'],
    err_code_not_available: ['Sign-in by email code is not available right now.', 'الدخول برمز البريد غير متاح حاليًا.'],
    err_passkey: ['Face ID / fingerprint sign-in did not work. Use another way below.', 'لم ينجح الدخول بالوجه أو البصمة. استخدم طريقة أخرى بالأسفل.'],
    g_failed: ['Google sign-in did not complete. Please try again.', 'لم يكتمل الدخول بحساب Google. حاول مرة أخرى.'],
    g_ok: ['Signed in with Google.', 'تم الدخول بحساب Google.'],
    pkTitle: ['Face ID / fingerprint', 'الوجه أو البصمة'],
    pkAdd: ['Turn on Face ID / fingerprint sign-in', 'فعّل الدخول بالوجه أو البصمة'],
    pkOn: ['Next time, sign in with one tap on this device.', 'في المرة القادمة ادخل بلمسة واحدة على هذا الجهاز.'],
    pkDevice: ['Device added', 'جهاز مضاف'], remove: ['Remove', 'إزالة'],
    pkDone: ['Done — this device can sign you in now.', 'تم — يمكنك الدخول من هذا الجهاز الآن.'],
    pkFail: ['It was not added. Please try again.', 'لم تتم الإضافة. حاول مرة أخرى.'],
  }
  var ar = function () { return document.documentElement.lang === 'ar' }
  var t = function (k) { return (L[k] || [k, k])[ar() ? 1 : 0] }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

  /* ---- the icon: thin, rounded, the same family as the header's others ---- */
  function personSvg() {
    var s = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(s, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22')
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.75')
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true')
    var c = document.createElementNS(s, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '8'); c.setAttribute('r', '4')
    var p = document.createElementNS(s, 'path'); p.setAttribute('d', 'M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7')
    svg.appendChild(c); svg.appendChild(p)
    return svg
  }

  function mountButton() {
    var bag = null, cluster = null, cls = ''
    var all = document.querySelectorAll('header.app-header nav button')
    for (var i = 0; i < all.length; i++) { if (/^(Bag|الحقيبة)/.test(all[i].getAttribute('aria-label') || '')) { bag = all[i]; break } }
    if (!bag) {
      /* The server-drawn category pages (category.php) wear the shop's header since 2026-10-01,
         with the bag as a LINK to /cart rather than the bundle's button: same classes, same place. */
      bag = document.querySelector('header.app-header nav a[href^="/cart"]')
    }
    if (bag) { cluster = bag.parentElement; cls = bag.className }
    if (!bag || !cluster) return
    var existing = document.querySelector('[data-cua-btn]')
    if (existing && existing.parentElement === cluster) { refreshButton(); return }
    if (existing) existing.remove()
    btn = document.createElement('button')
    btn.type = 'button'; btn.className = cls; btn.setAttribute('data-cua-btn', '')
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.appendChild(personSvg())
    btn.addEventListener('click', openSheet)
    cluster.insertBefore(btn, bag)
    refreshButton()
  }

  function refreshButton() {
    if (!btn) btn = document.querySelector('[data-cua-btn]')
    if (!btn) return
    btn.setAttribute('aria-label', t('open'))
    btn.setAttribute('data-signed', state.me ? '1' : '0')
  }

  /* ---- requests ---- */
  function call(route, body) {
    var o = { credentials: 'same-origin', headers: { Accept: 'application/json' } }
    if (body) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body) }
    return fetch(API + route, o).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { return { ok: r.ok, status: r.status, j: j || {} } })
    })
  }
  function errText(res) {
    var k = res.j && res.j.error
    if (res.status === 429 || res.status === 503 || /too_many/.test(k || '')) return t('err_too_many')
    return L['err_' + k] ? t('err_' + k) : t('err_generic')
  }

  function loadMe() {
    return call('customer_me').then(function (r) { state.me = r.ok && r.j.customer ? r.j.customer : null; refreshButton() }).catch(function () {})
  }

  /* ---- the sheet ---- */
  function closeSheet() {
    if (!overlay) return
    overlay.remove(); overlay = null
    document.documentElement.style.overflow = ''
    document.removeEventListener('keydown', onKey, true)
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); return }
    if (e.key !== 'Tab' || !overlay) return
    var f = overlay.querySelectorAll('button:not([disabled]), input, a[href]')
    if (!f.length) return
    var first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function openSheet() {
    if (overlay) return
    lastFocus = document.activeElement
    overlay = el('div', 'cua-overlay')
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeSheet() })
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
    render()
    Promise.all([state.me === undefined ? loadMe() : null, loadMethods()]).then(function () {
      if (state.me) { loadOrders(); if (state.methods.passkey && canPasskey()) loadPasskeys() }
      render()
    })
  }

  function loadOrders() {
    state.orders = null
    call('customer_orders').then(function (r) {
      state.orders = r.ok && r.j.orders ? r.j.orders : []
      state.note = (r.j && r.j.note) || ''
      if (overlay) render()
    })
  }

  function field(id, label, type, ac, extra) {
    var w = el('div', 'cua-f')
    var l = el('label', '', label); l.setAttribute('for', id)
    var i = el('input'); i.id = id; i.type = type; i.name = id; i.setAttribute('autocomplete', ac)
    if (extra) for (var k in extra) i.setAttribute(k, extra[k])
    w.appendChild(l); w.appendChild(i)
    return { wrap: w, input: i }
  }

  function render() {
    if (!overlay) return
    overlay.textContent = ''
    var sheet = el('div', 'cua-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', t('open'))
    sheet.setAttribute('dir', ar() ? 'rtl' : 'ltr')
    var x = el('button', 'cua-x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('close')); x.addEventListener('click', closeSheet)
    sheet.appendChild(x)
    if (state.flash) { var fl = el('p', 'cua-flash', state.flash); fl.setAttribute('role', 'status'); sheet.appendChild(fl) }
    if (state.me === undefined) sheet.appendChild(el('p', 'cua-muted', t('loading')))
    else if (state.me) accountView(sheet)
    else formView(sheet)
    overlay.appendChild(sheet)
    var f = sheet.querySelector('#cua-code') || sheet.querySelector('input:not([type=checkbox])') || x
    f.focus()
  }

  /* ---- checks that run in the browser first, so a typo is caught beside its own box instead
     of after a round trip. The server still checks everything again (api/customer.php). ---- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  function digits(v) {
    return String(v).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 1632 })
      .replace(/[\u06f0-\u06f9]/g, function (d) { return d.charCodeAt(0) - 1776 }).replace(/\D/g, '')
  }
  /* "+965 5551 2345", "00965-55512345" and "٥٥٥١٢٣٤٥" all become 55512345, like store_phone() on the server. */
  function normPhone(v) {
    var d = digits(v)
    if (d.indexOf('00965') === 0) d = d.slice(5)
    else if (d.length > 8 && d.indexOf('965') === 0) d = d.slice(3)
    return d
  }
  function setFieldError(f, text) {
    var note = f.wrap.querySelector('.cua-fe')
    if (!text) {
      if (note) note.remove()
      f.input.removeAttribute('aria-invalid')
      if (f.input.id === 'cua-pw' && state.view === 'up') f.input.setAttribute('aria-describedby', 'cua-pw-hint')
      else f.input.removeAttribute('aria-describedby')
      return
    }
    if (!note) { note = el('small', 'cua-fe'); note.id = f.input.id + '-err'; f.wrap.appendChild(note) }
    note.textContent = text
    f.input.setAttribute('aria-invalid', 'true'); f.input.setAttribute('aria-describedby', note.id)
  }

  /* ---- fast sign-in (2026-10-07): passkeys, an email code, Google. The server checks
     everything (api/customer.php); this only asks the browser and carries the answers. ---- */
  var remember = true
  function canPasskey() { return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext) }
  function b64uToBuf(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='
    var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer
  }
  function bufToB64u(b) {
    var u = new Uint8Array(b), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function loadMethods() {
    if (state.methods) return Promise.resolve()
    return call('customer_signin_methods').then(function (r) { state.methods = r.ok ? r.j : { code: false, passkey: false, google: false } })
      .catch(function () { state.methods = { code: false, passkey: false, google: false } })
  }
  function signedIn(c) { state.me = c; state.flash = ''; refreshButton(); loadOrders(); if (state.methods && state.methods.passkey && canPasskey()) loadPasskeys(); render() }
  function passkeyLogin(msg, go) {
    if (state.busy) return
    state.busy = true; go.disabled = true; msg.hidden = true
    call('customer_passkey_options_login', {}).then(function (r) {
      if (!r.ok) throw r
      var o = r.j
      return navigator.credentials.get({ publicKey: { challenge: b64uToBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: 'required', allowCredentials: [] } })
    }).then(function (cred) {
      var a = cred.response
      return call('customer_passkey_login', { id: bufToB64u(cred.rawId), rawId: bufToB64u(cred.rawId), remember: remember,
        response: { clientDataJSON: bufToB64u(a.clientDataJSON), authenticatorData: bufToB64u(a.authenticatorData), signature: bufToB64u(a.signature) } })
    }).then(function (r) {
      state.busy = false
      if (r.ok && r.j.customer) signedIn(r.j.customer)
      else throw r
    }).catch(function (r) {
      state.busy = false; go.disabled = false
      msg.textContent = r && r.status === 429 ? t('err_too_many') : t('err_passkey'); msg.hidden = false
    })
  }
  function passkeyAdd() {
    if (state.busy) return
    state.busy = true; state.pkMsg = ''; render()
    call('customer_passkey_options_register', {}).then(function (r) {
      if (!r.ok) throw r
      var o = r.j
      o.challenge = b64uToBuf(o.challenge)
      o.user.id = b64uToBuf(o.user.id)
      o.excludeCredentials = (o.excludeCredentials || []).map(function (c) { return { type: c.type, id: b64uToBuf(c.id) } })
      return navigator.credentials.create({ publicKey: o })
    }).then(function (cred) {
      var a = cred.response
      return call('customer_passkey_register', { label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows' : '',
        response: { clientDataJSON: bufToB64u(a.clientDataJSON), attestationObject: bufToB64u(a.attestationObject), transports: a.getTransports ? a.getTransports() : [] } })
    }).then(function (r) {
      state.busy = false
      if (!r.ok) throw r
      state.pkMsg = t('pkDone'); state.pks = null; loadPasskeys()
    }).catch(function () { state.busy = false; state.pkMsg = t('pkFail'); render() })
  }
  function loadPasskeys() {
    call('customer_passkeys').then(function (r) { state.pks = r.ok ? r.j.passkeys || [] : []; render() }).catch(function () {})
  }
  function rememberBox() {
    var w = el('label', 'cua-rem')
    var c = el('input'); c.type = 'checkbox'; c.checked = remember
    c.addEventListener('change', function () { remember = c.checked })
    w.appendChild(c); w.appendChild(el('span', '', t('remember')))
    return w
  }
  function googleHref() {
    var u = new URL(location.href); u.searchParams.delete('signin')
    return '/api/customer-google.php?return=' + encodeURIComponent(u.pathname + u.search) + '&remember=' + (remember ? '1' : '0')
  }

  function fastBlock(sheet) {
    var m = state.methods || {}
    var box = el('div', 'cua-fast'), any = false
    var msg = el('p', 'cua-ferr'); msg.setAttribute('role', 'alert'); msg.hidden = true
    if (m.passkey && canPasskey()) {
      var pk = el('button', 'cua-alt cua-pk', t('pk')); pk.type = 'button'
      pk.addEventListener('click', function () { passkeyLogin(msg, pk) })
      box.appendChild(pk); any = true
    }
    if (m.google) {
      var g = el('a', 'cua-alt cua-g', t('google')); g.href = googleHref()
      g.addEventListener('click', function () { g.href = googleHref() })   // carries the box's current tick
      box.appendChild(g); any = true
    }
    if (!any) return
    box.appendChild(msg)
    sheet.appendChild(box)
    var or = el('div', 'cua-or'); or.appendChild(el('span', '', t('or'))); sheet.appendChild(or)
  }

  function codeView(sheet) {
    var back = el('button', 'cua-back', '‹ ' + t('back')); back.type = 'button'
    back.addEventListener('click', function () { state.view = 'in'; state.codeEmail = ''; render() })
    sheet.appendChild(back)
    sheet.appendChild(el('h2', 'cua-h', t('codeTitle')))
    var sent = state.codeEmail !== ''
    sheet.appendChild(el('p', 'cua-muted', sent ? t('codeSent') : t('codeIntro')))
    var form = el('form', 'cua-form'); form.noValidate = true
    var em = field('cua-email', t('email'), 'email', 'email', { inputmode: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', dir: 'ltr' })
    em.input.value = state.codeEmail
    form.appendChild(em.wrap)
    var cd = null
    if (sent) {
      em.input.readOnly = true
      cd = field('cua-code', t('code'), 'text', 'one-time-code', { inputmode: 'numeric', dir: 'ltr', maxlength: '6', pattern: '[0-9]*' })
      cd.input.addEventListener('input', function () {
        cd.input.value = digits(cd.input.value).slice(0, 6)
        if (cd.input.value.length === 6) form.requestSubmit ? form.requestSubmit() : go.click()
      })
      form.appendChild(cd.wrap)
      form.appendChild(rememberBox())
    }
    var msg = el('p', 'cua-err'); msg.setAttribute('role', 'alert'); msg.hidden = true
    var go = el('button', 'cua-go', t(sent ? 'verify' : 'send')); go.type = 'submit'
    form.appendChild(msg); form.appendChild(go)
    if (sent) {
      var again = el('button', 'cua-link', t('resend')); again.type = 'button'
      again.addEventListener('click', function () { state.codeEmail = ''; render(); var i = document.getElementById('cua-email'); if (i) i.value = em.input.value })
      form.appendChild(again)
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (state.busy) return
      var email = em.input.value.trim()
      if (!EMAIL_RE.test(email)) { setFieldError(em, t('f_email')); em.input.focus(); return }
      if (sent && cd.input.value.length !== 6) { setFieldError(cd, t('err_bad_code')); cd.input.focus(); return }
      state.busy = true; go.disabled = true; msg.hidden = true
      var req = sent ? call('customer_code_verify', { email: email, code: cd.input.value, remember: remember })
                     : call('customer_code_send', { email: email, lang: ar() ? 'ar' : 'en' })
      req.then(function (r) {
        state.busy = false
        if (sent && r.ok && r.j.customer) { signedIn(r.j.customer); return }
        if (!sent && r.ok) { state.codeEmail = email; render(); return }
        go.disabled = false
        var k = r.j && r.j.error
        if (k === 'invalid_email') { setFieldError(em, t('f_email')); em.input.focus() }
        else if (sent && (k === 'bad_code' || k === 'code_expired')) { setFieldError(cd, errText(r)); cd.input.select(); cd.input.focus() }
        else { msg.textContent = errText(r); msg.hidden = false }
      }).catch(function () { state.busy = false; go.disabled = false; msg.textContent = t('err_generic'); msg.hidden = false })
    })
    sheet.appendChild(form)
  }

  function formView(sheet) {
    if (state.view === 'code') { codeView(sheet); return }
    var tabs = el('div', 'cua-tabs'); tabs.setAttribute('role', 'tablist')
    ;[['in', 'signin'], ['up', 'create']].forEach(function (p) {
      var b = el('button', 'cua-tab' + (state.view === p[0] ? ' on' : ''), t(p[1])); b.type = 'button'
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', state.view === p[0] ? 'true' : 'false')
      b.addEventListener('click', function () { state.view = p[0]; render() })
      tabs.appendChild(b)
    })
    sheet.appendChild(tabs)
    var up = state.view === 'up'
    if (!up) fastBlock(sheet)
    var form = el('form', 'cua-form'); form.noValidate = true
    var em = field('cua-email', t('email'), 'email', 'email', { inputmode: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: 'required', dir: 'ltr' })
    var pw = field('cua-pw', t('password'), 'password', up ? 'new-password' : 'current-password', { required: 'required', dir: 'ltr', minlength: up ? '12' : '1' })
    var tog = el('button', 'cua-eye', t('show')); tog.type = 'button'
    tog.addEventListener('click', function () { var s = pw.input.type === 'password'; pw.input.type = s ? 'text' : 'password'; tog.textContent = t(s ? 'hide' : 'show') })
    pw.wrap.appendChild(tog)
    form.appendChild(em.wrap); form.appendChild(pw.wrap)
    var nm, ph
    var meter = null
    if (up) {
      // A LIVE LENGTH METER instead of a hint that only turns into an error after Submit: the one
      // rule the server enforces is twelve characters, so that is the one thing shown.
      meter = el('div', 'cua-meter'); meter.id = 'cua-pw-hint'
      var bar = el('span', 'cua-bar'); var fill = el('i'); bar.appendChild(fill)
      var cnt = el('small', 'cua-muted'); meter.appendChild(bar); meter.appendChild(cnt)
      pw.wrap.appendChild(meter)
      pw.input.setAttribute('aria-describedby', 'cua-pw-hint')
      var upd = function () {
        var n = pw.input.value.length
        fill.style.width = Math.min(100, Math.round(n / 12 * 100)) + '%'
        meter.className = 'cua-meter' + (n >= 12 ? ' ok' : '')
        cnt.textContent = n >= 12 ? '✓ ' + t('pwOk') : n + ' / 12 ' + t('lenOf')
      }
      pw.input.addEventListener('input', upd); upd()
      nm = field('cua-name', t('name'), 'text', 'name', { autocapitalize: 'words', maxlength: '120' })
      ph = field('cua-phone', t('phone'), 'tel', 'tel-national', { inputmode: 'numeric', dir: 'ltr', maxlength: '17' })
      form.appendChild(nm.wrap); form.appendChild(ph.wrap)
    }
    if (up) {
      var q = ar() ? '' : '?lang=en'
      var c = el('p', 'cua-muted cua-consent')
      c.appendChild(document.createTextNode(t('consent1')))
      var a1 = el('a', '', t('terms')); a1.href = '/terms' + q; a1.target = '_blank'; a1.rel = 'noopener'
      c.appendChild(a1); c.appendChild(document.createTextNode(t('and')))
      var a2 = el('a', '', t('privacy')); a2.href = '/privacy' + q; a2.target = '_blank'; a2.rel = 'noopener'
      c.appendChild(a2); c.appendChild(document.createTextNode('.'))
      form.appendChild(c)
    }
    var checkEmail = function () { var ok = EMAIL_RE.test(em.input.value.trim()); setFieldError(em, ok ? '' : t('f_email')); return ok }
    var checkPw = function () {
      var v = pw.input.value
      var bad = up ? (v.length < 12 ? t('err_password_too_short') : '') : (v === '' ? t('f_pw_empty') : '')
      setFieldError(pw, bad); return !bad
    }
    var checkPhone = function () {
      if (!ph) return true
      var raw = ph.input.value.trim()
      if (raw === '') { setFieldError(ph, ''); return true }
      var n = normPhone(raw)
      if (/^[569]\d{7}$/.test(n)) { ph.input.value = n; setFieldError(ph, ''); return true }
      setFieldError(ph, t('f_phone')); return false
    }
    em.input.addEventListener('blur', function () { if (em.input.value.trim()) checkEmail() })
    em.input.addEventListener('input', function () { if (em.input.getAttribute('aria-invalid')) checkEmail() })
    pw.input.addEventListener('input', function () { if (pw.input.getAttribute('aria-invalid')) checkPw() })
    if (ph) {
      ph.input.addEventListener('blur', checkPhone)
      ph.input.addEventListener('input', function () { if (ph.input.getAttribute('aria-invalid')) checkPhone() })
    }
    if (!up) form.appendChild(rememberBox())
    var msg = el('p', 'cua-err'); msg.setAttribute('role', 'alert'); msg.hidden = true
    var go = el('button', 'cua-go', t(up ? 'create' : 'signin')); go.type = 'submit'
    form.appendChild(msg); form.appendChild(go)
    if (!up && state.methods && state.methods.code) {
      var cl = el('button', 'cua-link', t('codeLink')); cl.type = 'button'
      cl.addEventListener('click', function () { state.view = 'code'; state.codeEmail = ''; render(); var i = document.getElementById('cua-email'); if (i && em.input.value) i.value = em.input.value })
      form.appendChild(cl)
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (state.busy) return
      var firstBad = null
      if (!checkEmail()) firstBad = firstBad || em.input
      if (!checkPw()) firstBad = firstBad || pw.input
      if (up && !checkPhone()) firstBad = firstBad || ph.input
      if (firstBad) { msg.hidden = true; firstBad.focus(); return }
      var body = { email: em.input.value.trim(), password: pw.input.value, remember: up ? true : remember }
      if (up) { body.name = nm.input.value.trim(); body.phone = ph.input.value.trim() }
      state.busy = true; go.disabled = true; msg.hidden = true
      call(up ? 'customer_register' : 'customer_login', body).then(function (r) {
        state.busy = false
        if (r.ok && r.j.customer) signedIn(r.j.customer)
        else {
          go.disabled = false
          var k = r.j && r.j.error
          // an error that belongs to one box is shown under that box, and the box takes focus
          if (k === 'email_taken' || k === 'invalid_email') { setFieldError(em, errText(r)); em.input.focus() }
          else if (k === 'invalid_phone' && ph) { setFieldError(ph, t('f_phone')); ph.input.focus() }
          else if (k === 'password_too_short') { setFieldError(pw, errText(r)); pw.input.focus() }
          else { msg.textContent = errText(r); msg.hidden = false }
        }
      }).catch(function () { state.busy = false; go.disabled = false; msg.textContent = t('err_generic'); msg.hidden = false })
    })
    sheet.appendChild(form)
  }

  function money(n) { return Number(n).toFixed(3) + (ar() ? ' د.ك' : ' KWD') }
  function when(s) { try { return new Date(String(s).replace(' ', 'T')).toLocaleDateString(ar() ? 'ar-KW' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return String(s).slice(0, 10) } }

  function accountView(sheet) {
    var me = state.me
    sheet.appendChild(el('h2', 'cua-h', t('hello') + (me.name ? (ar() ? '، ' : ', ') + me.name : '')))   // the Arabic comma on the Arabic sheet
    var d = el('div', 'cua-details')
    d.appendChild(el('span', '', me.email))
    /* The number is a left-to-right island in an Arabic sheet, or the '+' jumps to the far end
       ("96555512345+"); and a Kuwaiti mobile is read in groups: +965 5551 2345. */
    if (me.phone) {
      var digits = String(me.phone).replace(/\D/g, '')
      var shown = /^965\d{8}$/.test(digits) ? '+965 ' + digits.slice(3, 7) + ' ' + digits.slice(7) : '+' + digits
      var ps = el('span', 'cua-phone'), bd = el('bdi', '', shown); bd.dir = 'ltr'   // isolated, so the line still sits on the sheet's own side
      ps.appendChild(bd); d.appendChild(ps)
    }
    sheet.appendChild(d)
    sheet.appendChild(el('h3', 'cua-h3', t('orders')))
    var box = el('div', 'cua-orders')
    if (state.orders === null) box.appendChild(el('p', 'cua-muted', t('loading')))
    else if (!state.orders.length) { box.appendChild(el('p', 'cua-muted', t('none'))); box.appendChild(el('p', 'cua-muted', t('note'))) }
    else state.orders.forEach(function (o) {
      var row = el('div', 'cua-order')
      var top = el('div', 'cua-otop'); top.appendChild(el('b', '', o.track_id)); top.appendChild(el('span', '', money(o.amount)))
      var sub = el('div', 'cua-osub')
      sub.appendChild(el('span', '', when(o.created_at)))
      sub.appendChild(el('span', 'cua-pill', t(o.payment_status) + ' · ' + t(o.fulfilment_status)))
      var tr = el('a', 'cua-track', t('track')); tr.href = '/track'
      tr.addEventListener('click', function () { try { navigator.clipboard.writeText(o.track_id) } catch (e) {} ; tr.title = t('copied') })
      row.appendChild(top); row.appendChild(sub)
      if (window.SportaOrderProgress) row.appendChild(window.SportaOrderProgress.render(o, true))   // the five-step bar (order-progress.js)
      row.appendChild(tr)
      box.appendChild(row)
    })
    sheet.appendChild(box)
    if (state.methods && state.methods.passkey && canPasskey()) {
      sheet.appendChild(el('h3', 'cua-h3', t('pkTitle')))
      var pkb = el('div', 'cua-pks')
      if (state.pks === null) { pkb.appendChild(el('p', 'cua-muted', t('loading'))); }
      else {
        state.pks.forEach(function (k) {
          var row = el('div', 'cua-pkrow')
          row.appendChild(el('span', '', (k.label || t('pkDevice')) + ' · ' + when(k.created_at)))
          var rm = el('button', 'cua-link', t('remove')); rm.type = 'button'
          rm.addEventListener('click', function () { rm.disabled = true; call('customer_passkey_remove', { id: k.id }).then(function (r) { state.pks = r.j && r.j.passkeys || []; render() }) })
          row.appendChild(rm); pkb.appendChild(row)
        })
        if (!state.pks.length) {
          pkb.appendChild(el('p', 'cua-muted', t('pkOn')))
          var add = el('button', 'cua-alt cua-pk', t('pkAdd')); add.type = 'button'; add.disabled = state.busy
          add.addEventListener('click', passkeyAdd); pkb.appendChild(add)
        }
      }
      if (state.pkMsg) pkb.appendChild(el('p', 'cua-muted', state.pkMsg))
      sheet.appendChild(pkb)
    }
    var out = el('button', 'cua-out', t('signout')); out.type = 'button'
    out.addEventListener('click', function () {
      out.disabled = true
      call('customer_logout', {}).then(function () { state.me = null; state.orders = null; state.pks = null; state.pkMsg = ''; state.fresh = false; state.view = 'in'; refreshButton(); render() })
    })
    sheet.appendChild(out)
  }

  /* ---- styling ---- */
  var CSS = 'header.top .icons [data-cua-btn]{display:flex;position:relative;background:none;border:0;padding:0;color:#fff;cursor:pointer;min-width:22px;min-height:22px}'
    + '@media (pointer:coarse){header.top .icons [data-cua-btn]{min-width:44px;min-height:44px;align-items:center;justify-content:center;margin:-11px}}'
    + '[data-cua-btn][data-signed="1"]{position:relative}'
    + '[data-cua-btn][data-signed="1"]::after{content:"";position:absolute;top:8px;inset-inline-end:8px;width:8px;height:8px;border-radius:50%;background:#6fd08c;box-shadow:0 0 0 2px #2b3138}'
    + '.cua-overlay{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;font:15px/1.5 inherit}'
    + '@media (min-width:640px){.cua-overlay{align-items:center}}'
    + '.cua-sheet{position:relative;width:100%;max-width:440px;max-height:92vh;overflow:auto;padding:22px 20px 26px;background:#14161a;color:#dbdfe4;border:1px solid rgba(255,255,255,.12);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.5)}'
    + '@media (min-width:640px){.cua-sheet{border-radius:20px}}'
    + '.cua-x{position:absolute;top:8px;inset-inline-end:10px;width:44px;height:44px;border:0;background:none;color:#9aa1a9;font-size:28px;cursor:pointer}'
    + '.cua-tabs{display:flex;gap:6px;margin:4px 44px 18px 0;padding:4px;background:rgba(255,255,255,.06);border-radius:12px}'
    + '[dir=rtl] .cua-tabs{margin:4px 0 18px 44px}'
    + '.cua-tab{flex:1;min-height:44px;border:0;border-radius:9px;background:none;color:#b7bdc4;font-weight:700;font-size:15px;cursor:pointer}'
    + '.cua-tab.on{background:#cf4a0b;color:#fff}'   /* the shop's deeper orange: white on #e0561c is 3.8:1, on #cf4a0b 4.6:1 */
    + '.cua-form{display:flex;flex-direction:column;gap:14px}'
    + '.cua-f{position:relative;display:flex;flex-direction:column;gap:6px}'
    + '.cua-f label{font-weight:700;font-size:13.5px}'
    + '.cua-f input{min-height:52px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#dbdfe4;color:#14161a;font-size:16px}'
    + '.cua-f input[type=password],.cua-f input[type=text][name=cua-pw]{padding-right:64px}'
    + '.cua-f input:focus{outline:none;border-color:var(--brand,#e0561c);box-shadow:0 0 0 3px rgba(224,86,28,.3)}'
    + '.cua-eye{position:absolute;top:34px;right:6px;min-height:44px;padding:0 10px;border:0;border-radius:10px;background:#dbdfe4;color:#3a3e44;font-weight:700;cursor:pointer}'
    + '.cua-muted{color:#9aa1a9;font-size:13px;margin:0}'
    + '.cua-fe{color:#ff8a80;font-size:13px}'
    + '.cua-f input[aria-invalid=true]{border-color:#ff8a80;box-shadow:0 0 0 3px rgba(255,138,128,.25)}'
    + '.cua-meter{display:flex;align-items:center;gap:10px}'
    + '.cua-bar{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}'
    + '.cua-bar i{display:block;height:100%;width:0;border-radius:3px;background:#cf4a0b;transition:width .15s}'
    + '.cua-meter.ok .cua-bar i{background:#6fd08c}.cua-meter.ok small{color:#6fd08c}'
    + '.cua-consent a{color:#dbdfe4;text-decoration:underline;text-underline-offset:2px}'
    + '.cua-err,.cua-ferr{margin:0;color:#ff8a80;font-size:14px}.cua-err[hidden],.cua-ferr[hidden]{display:none}'
    + '.cua-go,.cua-out{min-height:52px;border:0;border-radius:12px;font-weight:800;font-size:16px;cursor:pointer}'
    + '.cua-go{background:#cf4a0b;color:#fff}.cua-go:disabled{opacity:.6}'
    + '.cua-out{width:100%;margin-top:18px;background:rgba(255,255,255,.08);color:#dbdfe4}'
    + '.cua-h{margin:6px 40px 4px 0;font-size:22px;font-weight:800}[dir=rtl] .cua-h{margin:6px 0 4px 40px}'
    + '.cua-details{display:flex;flex-direction:column;color:#9aa1a9;font-size:14px;margin-bottom:6px}'
    + '.cua-h3{margin:18px 0 8px;font-size:15px;font-weight:800}'
    + '.cua-orders{display:flex;flex-direction:column;gap:10px}'
    + '.cua-order{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.05);display:grid;gap:4px}'
    + '.cua-otop,.cua-osub{display:flex;justify-content:space-between;gap:10px;align-items:center}'
    + '.cua-osub{color:#9aa1a9;font-size:13px}'
    + '.cua-pill{padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08)}'
    + '.cua-fast{display:flex;flex-direction:column;gap:10px}'
    + '.cua-alt{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:52px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.22);background:#fff;color:#171a1e;font-weight:800;font-size:15.5px;text-decoration:none;cursor:pointer;box-sizing:border-box}'
    + '.cua-alt:disabled{opacity:.6}.cua-alt:focus-visible,.cua-link:focus-visible,.cua-back:focus-visible{outline:3px solid #fff;outline-offset:2px}'
    + '.cua-or{display:flex;align-items:center;gap:12px;margin:16px 0;color:#9aa1a9;font-size:13px}.cua-or::before,.cua-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.14)}'
    + '.cua-rem{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14.5px;cursor:pointer}.cua-rem input{width:20px;height:20px;accent-color:#cf4a0b;margin:0}'
    + '.cua-link{align-self:center;min-height:44px;padding:0 8px;border:0;background:none;color:#dbdfe4;font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}'
    + '.cua-back{min-height:44px;padding:0 6px;border:0;background:none;color:#b7bdc4;font-weight:700;font-size:14px;cursor:pointer}'
    + '.cua-flash{margin:4px 44px 10px 0;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.08);font-size:14px}[dir=rtl] .cua-flash{margin:4px 0 10px 44px}'
    + '.cua-pks{display:flex;flex-direction:column;gap:8px}.cua-pkrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:4px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:14px}'
    + '.cua-track{justify-self:start;min-height:44px;display:inline-flex;align-items:center;color:var(--brand,#e0561c);font-weight:700}'
  function style() {
    if (document.getElementById('cua-css')) return
    var s = document.createElement('style'); s.id = 'cua-css'; s.textContent = CSS; document.head.appendChild(s)
  }
  style()

  var q = null
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; mountButton() }, 200) }).observe(document.body, { childList: true, subtree: true })
  mountButton()
  var back = null
  try { back = new URL(location.href).searchParams.get('signin') } catch (e) {}
  if (back === 'google' || back === 'failed') {
    try { var u = new URL(location.href); u.searchParams.delete('signin'); history.replaceState(history.state, '', u.pathname + u.search + u.hash) } catch (e) {}
    state.flash = t(back === 'google' ? 'g_ok' : 'g_failed')
    loadMe().then(function () { mountButton(); openSheet() })
  } else loadMe()
})()
