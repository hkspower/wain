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
  var state = { me: undefined, view: 'in', busy: false, orders: null, note: '' }
  var btn = null, overlay = null, lastFocus = null

  var L = {
    open: ['My account', 'حسابي'],
    signin: ['Sign in', 'تسجيل الدخول'], create: ['Create account', 'إنشاء حساب'],
    email: ['Email', 'البريد الإلكتروني'], password: ['Password', 'كلمة المرور'],
    name: ['Name (optional)', 'الاسم (اختياري)'], phone: ['Mobile (optional)', 'رقم الموبايل (اختياري)'],
    pwHint: ['At least 12 characters', '١٢ حرفًا على الأقل'], show: ['Show', 'إظهار'], hide: ['Hide', 'إخفاء'],
    close: ['Close', 'إغلاق'], signout: ['Sign out', 'تسجيل الخروج'],
    hello: ['Hello', 'أهلاً'], orders: ['Your orders', 'طلباتك'], loading: ['Loading…', 'جارٍ التحميل…'],
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
    var bag = document.querySelector('header.app-header nav button[aria-label]')
    var cluster = null
    var all = document.querySelectorAll('header.app-header nav button')
    for (var i = 0; i < all.length; i++) { if (/^(Bag|الحقيبة)/.test(all[i].getAttribute('aria-label') || '')) { bag = all[i]; break } }
    if (!bag) return
    cluster = bag.parentElement
    var existing = document.querySelector('[data-cua-btn]')
    if (existing && existing.parentElement === cluster) { refreshButton(); return }
    if (existing) existing.remove()
    btn = document.createElement('button')
    btn.type = 'button'; btn.className = bag.className; btn.setAttribute('data-cua-btn', '')
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
    if (state.me === undefined) loadMe().then(render)
    else if (state.me) loadOrders()
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
    if (state.me === undefined) sheet.appendChild(el('p', 'cua-muted', t('loading')))
    else if (state.me) accountView(sheet)
    else formView(sheet)
    overlay.appendChild(sheet)
    var f = sheet.querySelector('input') || x
    f.focus()
  }

  function formView(sheet) {
    var tabs = el('div', 'cua-tabs'); tabs.setAttribute('role', 'tablist')
    ;[['in', 'signin'], ['up', 'create']].forEach(function (p) {
      var b = el('button', 'cua-tab' + (state.view === p[0] ? ' on' : ''), t(p[1])); b.type = 'button'
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', state.view === p[0] ? 'true' : 'false')
      b.addEventListener('click', function () { state.view = p[0]; render() })
      tabs.appendChild(b)
    })
    sheet.appendChild(tabs)
    var up = state.view === 'up'
    var form = el('form', 'cua-form'); form.noValidate = true
    var em = field('cua-email', t('email'), 'email', 'email', { inputmode: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: 'required', dir: 'ltr' })
    var pw = field('cua-pw', t('password'), 'password', up ? 'new-password' : 'current-password', { required: 'required', dir: 'ltr', minlength: up ? '12' : '1' })
    var tog = el('button', 'cua-eye', t('show')); tog.type = 'button'
    tog.addEventListener('click', function () { var s = pw.input.type === 'password'; pw.input.type = s ? 'text' : 'password'; tog.textContent = t(s ? 'hide' : 'show') })
    pw.wrap.appendChild(tog)
    form.appendChild(em.wrap); form.appendChild(pw.wrap)
    var nm, ph
    if (up) {
      pw.wrap.appendChild(el('small', 'cua-muted', t('pwHint')))
      nm = field('cua-name', t('name'), 'text', 'name', { autocapitalize: 'words', maxlength: '120' })
      ph = field('cua-phone', t('phone'), 'tel', 'tel-national', { inputmode: 'numeric', dir: 'ltr', maxlength: '17' })
      form.appendChild(nm.wrap); form.appendChild(ph.wrap)
    }
    var msg = el('p', 'cua-err'); msg.setAttribute('role', 'alert'); msg.hidden = true
    var go = el('button', 'cua-go', t(up ? 'create' : 'signin')); go.type = 'submit'
    form.appendChild(msg); form.appendChild(go)
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (state.busy) return
      var body = { email: em.input.value.trim(), password: pw.input.value }
      if (up) { body.name = nm.input.value.trim(); body.phone = ph.input.value.trim() }
      state.busy = true; go.disabled = true; msg.hidden = true
      call(up ? 'customer_register' : 'customer_login', body).then(function (r) {
        state.busy = false
        if (r.ok && r.j.customer) { state.me = r.j.customer; refreshButton(); loadOrders(); render() }
        else { go.disabled = false; msg.textContent = errText(r); msg.hidden = false }
      }).catch(function () { state.busy = false; go.disabled = false; msg.textContent = t('err_generic'); msg.hidden = false })
    })
    sheet.appendChild(form)
  }

  function money(n) { return Number(n).toFixed(3) + (ar() ? ' د.ك' : ' KWD') }
  function when(s) { try { return new Date(String(s).replace(' ', 'T')).toLocaleDateString(ar() ? 'ar-KW' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } catch (e) { return String(s).slice(0, 10) } }

  function accountView(sheet) {
    var me = state.me
    sheet.appendChild(el('h2', 'cua-h', t('hello') + (me.name ? ', ' + me.name : '')))
    var d = el('div', 'cua-details')
    d.appendChild(el('span', '', me.email))
    if (me.phone) d.appendChild(el('span', '', '+' + me.phone))
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
      row.appendChild(top); row.appendChild(sub); row.appendChild(tr)
      box.appendChild(row)
    })
    sheet.appendChild(box)
    var out = el('button', 'cua-out', t('signout')); out.type = 'button'
    out.addEventListener('click', function () {
      out.disabled = true
      call('customer_logout', {}).then(function () { state.me = null; state.orders = null; state.view = 'in'; refreshButton(); render() })
    })
    sheet.appendChild(out)
  }

  /* ---- styling ---- */
  var CSS = '[data-cua-btn][data-signed="1"]{position:relative}'
    + '[data-cua-btn][data-signed="1"]::after{content:"";position:absolute;top:8px;inset-inline-end:8px;width:8px;height:8px;border-radius:50%;background:#6fd08c;box-shadow:0 0 0 2px #2b3138}'
    + '.cua-overlay{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;font:15px/1.5 inherit}'
    + '@media (min-width:640px){.cua-overlay{align-items:center}}'
    + '.cua-sheet{position:relative;width:100%;max-width:440px;max-height:92vh;overflow:auto;padding:22px 20px 26px;background:#14161a;color:#dbdfe4;border:1px solid rgba(255,255,255,.12);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.5)}'
    + '@media (min-width:640px){.cua-sheet{border-radius:20px}}'
    + '.cua-x{position:absolute;top:8px;inset-inline-end:10px;width:44px;height:44px;border:0;background:none;color:#9aa1a9;font-size:28px;cursor:pointer}'
    + '.cua-tabs{display:flex;gap:6px;margin:4px 44px 18px 0;padding:4px;background:rgba(255,255,255,.06);border-radius:12px}'
    + '[dir=rtl] .cua-tabs{margin:4px 0 18px 44px}'
    + '.cua-tab{flex:1;min-height:44px;border:0;border-radius:9px;background:none;color:#b7bdc4;font-weight:700;font-size:15px;cursor:pointer}'
    + '.cua-tab.on{background:var(--brand,#e0561c);color:#fff}'
    + '.cua-form{display:flex;flex-direction:column;gap:14px}'
    + '.cua-f{position:relative;display:flex;flex-direction:column;gap:6px}'
    + '.cua-f label{font-weight:700;font-size:13.5px}'
    + '.cua-f input{min-height:52px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#dbdfe4;color:#14161a;font-size:16px}'
    + '.cua-f input[type=password],.cua-f input[type=text][name=cua-pw]{padding-right:64px}'
    + '.cua-f input:focus{outline:none;border-color:var(--brand,#e0561c);box-shadow:0 0 0 3px rgba(224,86,28,.3)}'
    + '.cua-eye{position:absolute;top:30px;right:6px;min-height:44px;padding:0 10px;border:0;background:none;color:#4b4f55;font-weight:700;cursor:pointer}'
    + '.cua-muted{color:#9aa1a9;font-size:13px;margin:0}'
    + '.cua-err{margin:0;color:#ff8a80;font-size:14px}.cua-err[hidden]{display:none}'
    + '.cua-go,.cua-out{min-height:52px;border:0;border-radius:12px;font-weight:800;font-size:16px;cursor:pointer}'
    + '.cua-go{background:var(--brand,#e0561c);color:#fff}.cua-go:disabled{opacity:.6}'
    + '.cua-out{width:100%;margin-top:18px;background:rgba(255,255,255,.08);color:#dbdfe4}'
    + '.cua-h{margin:6px 40px 4px 0;font-size:22px;font-weight:800}[dir=rtl] .cua-h{margin:6px 0 4px 40px}'
    + '.cua-details{display:flex;flex-direction:column;color:#9aa1a9;font-size:14px;margin-bottom:6px}'
    + '.cua-h3{margin:18px 0 8px;font-size:15px;font-weight:800}'
    + '.cua-orders{display:flex;flex-direction:column;gap:10px}'
    + '.cua-order{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.05);display:grid;gap:4px}'
    + '.cua-otop,.cua-osub{display:flex;justify-content:space-between;gap:10px;align-items:center}'
    + '.cua-osub{color:#9aa1a9;font-size:13px}'
    + '.cua-pill{padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08)}'
    + '.cua-track{justify-self:start;min-height:44px;display:inline-flex;align-items:center;color:var(--brand,#e0561c);font-weight:700}'
  function style() {
    if (document.getElementById('cua-css')) return
    var s = document.createElement('style'); s.id = 'cua-css'; s.textContent = CSS; document.head.appendChild(s)
  }
  style()

  var q = null
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; mountButton() }, 200) }).observe(document.body, { childList: true, subtree: true })
  mountButton()
  loadMe()
})()
