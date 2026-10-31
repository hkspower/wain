/* Sporta — birthday picker (Day / Month / Year) for the sign-up form and the
 * My account page, plus the birthday-gift line.
 *
 * Why an add-on and not a React change: the live storefront is a compiled
 * bundle and its source is not on the server or in the repo. This script finds
 * the account forms by their stable ids (#customer-name only exists on sign-up,
 * #customer-profile-name only on the signed-in dashboard), adds its own fields,
 * and talks to /api/birthday.php. A MutationObserver re-adds the fields if React
 * re-renders them away. External file: the CSP forbids inline script.
 *
 * Sign-up: the chosen date is kept in sessionStorage and saved right after the
 * account exists (the dashboard appearing is the signal), because the compiled
 * register call cannot carry an extra field.
 */
(function () {
  'use strict'
  var API = '/api/birthday.php'
  var PENDING = 'sporta_bday_pending'
  var MIN_YEAR = 1920

  var T = {
    ar: {
      label: 'تاريخ الميلاد (اختياري)', day: 'اليوم', month: 'الشهر', year: 'السنة',
      hint: 'نرسل لك كود خصم هدية في عيد ميلادك.',
      hintGift: 'نرسل لك كود خصم {p}% هدية في عيد ميلادك.',
      partial: 'اختر اليوم والشهر والسنة، أو اترك الثلاثة فارغة.',
      future: 'تاريخ الميلاد لا يمكن أن يكون في المستقبل.',
      title: 'عيد ميلادك', save: 'حفظ', saving: 'جارٍ الحفظ…', saved: 'تم الحفظ.',
      cleared: 'تمت إزالة تاريخ الميلاد.', remove: 'إزالة', failed: 'تعذّر الحفظ. حاول مرة أخرى.',
      months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    },
    en: {
      label: 'Date of birth (optional)', day: 'Day', month: 'Month', year: 'Year',
      hint: 'We send you a gift discount code on your birthday.',
      hintGift: 'We send you a {p}% gift discount code on your birthday.',
      partial: 'Pick the day, month and year — or leave all three empty.',
      future: 'Your date of birth cannot be in the future.',
      title: 'Your birthday', save: 'Save', saving: 'Saving…', saved: 'Saved.',
      cleared: 'Date of birth removed.', remove: 'Remove', failed: 'Could not save. Please try again.',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    }
  }
  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function t(k) { return T[lang()][k] }
  function store(get, key, value) {
    try {
      if (get) return sessionStorage.getItem(key)
      if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value)
    } catch (e) { return null }
  }
  var gift = null   // {percent, days} once the server has answered
  var known         // the saved date once loaded ('' = none); undefined = not yet asked
  var draft = ''    // sign-up choice carried across a re-render or a language switch

  function css() {
    if (document.getElementById('sporta-bday-css')) return
    var s = document.createElement('style')
    s.id = 'sporta-bday-css'
    s.textContent =
      '.sporta-bday{border:0;padding:0;margin:0;min-width:0}' +
      '.sporta-bday legend{font-weight:600;font-size:.9rem;margin-bottom:.4rem;padding:0}' +
      '.sporta-bday__row{display:grid;grid-template-columns:1fr 1.5fr 1.2fr;gap:.5rem}' +
      '.sporta-bday select{width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:10px;padding:.55rem .6rem;background:#fff;color:#171a1e;font:inherit}' +
      '.sporta-bday select:focus-visible{outline:2px solid #e0561c;outline-offset:1px}' +
      '.sporta-bday__hint{font-size:.82rem;color:#475569;margin:.4rem 0 0}' +
      '.sporta-bday__err{font-size:.82rem;color:#b91c1c;margin:.4rem 0 0}' +
      '.sporta-bday-panel .sporta-bday__actions{display:flex;gap:.6rem;align-items:center;margin-top:.8rem;flex-wrap:wrap}' +
      '.sporta-bday__status{font-size:.85rem;color:#475569}'
    document.head.appendChild(s)
  }

  function option(value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; return o }
  function daysIn(y, m) { return new Date(y || 2000, m, 0).getDate() }   // leap-safe default: 2000

  /** Builds the fieldset; returns {el, get(), set(v), validate()} */
  function picker(idPrefix) {
    var fs = document.createElement('fieldset')
    fs.className = 'customer-account__field sporta-bday'
    fs.setAttribute('data-lang', lang())
    var lg = document.createElement('legend'); lg.textContent = t('label'); fs.appendChild(lg)
    var row = document.createElement('div'); row.className = 'sporta-bday__row'; fs.appendChild(row)
    var d = document.createElement('select'), m = document.createElement('select'), y = document.createElement('select')
    d.id = idPrefix + '-day'; m.id = idPrefix + '-month'; y.id = idPrefix + '-year'
    d.setAttribute('aria-label', t('day')); m.setAttribute('aria-label', t('month')); y.setAttribute('aria-label', t('year'))
    d.appendChild(option('', t('day'))); m.appendChild(option('', t('month'))); y.appendChild(option('', t('year')))
    t('months').forEach(function (name, i) { m.appendChild(option(String(i + 1), name)) })
    for (var yr = new Date().getFullYear(); yr >= MIN_YEAR; yr--) y.appendChild(option(String(yr), String(yr)))
    function fillDays() {
      var keep = d.value, n = daysIn(+y.value, +m.value || 1)
      while (d.options.length > 1) d.remove(1)
      for (var i = 1; i <= (m.value ? n : 31); i++) d.appendChild(option(String(i), String(i)))
      if (keep && +keep <= d.options.length - 1) d.value = keep
    }
    fillDays()
    m.addEventListener('change', fillDays); y.addEventListener('change', fillDays)
    row.appendChild(d); row.appendChild(m); row.appendChild(y)
    var hint = document.createElement('p'); hint.className = 'sporta-bday__hint'; fs.appendChild(hint)
    var err = document.createElement('p'); err.className = 'sporta-bday__err'; err.setAttribute('role', 'alert'); err.hidden = true; fs.appendChild(err)
    function showHint() { hint.textContent = gift ? t('hintGift').replace('{p}', gift.percent) : t('hint') }
    showHint()
    function pad(n) { return (n < 10 ? '0' : '') + n }
    var api = {
      el: fs,
      refreshHint: showHint,
      /** '' = all empty, 'YYYY-MM-DD' = complete, null = partial/invalid */
      get: function () {
        if (!d.value && !m.value && !y.value) return ''
        if (!d.value || !m.value || !y.value) return null
        return y.value + '-' + pad(+m.value) + '-' + pad(+d.value)
      },
      set: function (v) {
        var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
        y.value = p ? String(+p[1]) : ''; m.value = p ? String(+p[2]) : ''; fillDays(); d.value = p ? String(+p[3]) : ''
      },
      validate: function () {
        var v = api.get(), msg = ''
        if (v === null) msg = t('partial')
        else if (v && v > new Date().toISOString().slice(0, 10)) msg = t('future')
        err.textContent = msg; err.hidden = !msg
        d.setAttribute('aria-invalid', msg ? 'true' : 'false')
        return msg ? false : true
      }
    }
    return api
  }

  function request(method, route, body) {
    var opt = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } }
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.headers['X-Sporta-Customer'] = '1'; opt.body = JSON.stringify(body) }
    return fetch(API + '?r=' + route, opt).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { return { ok: r.ok, status: r.status, data: j } })
    })
  }

  // ---- sign-up form -------------------------------------------------------
  function mountSignup() {
    var nameInput = document.getElementById('customer-name')
    if (!nameInput) return
    var form = nameInput.closest('form')
    if (!form) return
    var old = form.querySelector('.sporta-bday')
    if (old && old.getAttribute('data-lang') === lang()) return
    if (old) old.remove()   // language switched: rebuild in the new language
    css()
    var p = picker('customer-birthday')
    var anchor = nameInput.closest('.customer-account__field') || nameInput.parentNode
    anchor.parentNode.insertBefore(p.el, anchor.nextSibling)
    p.set(draft || store(true, PENDING) || '')
    p.el.addEventListener('change', function () { var v = p.get(); if (v !== null) draft = v })
    // Runs at the form, before React's root-level onSubmit sees the event.
    form.addEventListener('submit', function (ev) {
      if (!p.validate()) { ev.preventDefault(); ev.stopPropagation(); return }
      var v = p.get()
      store(false, PENDING, v ? v : null)
    })
  }

  // ---- My account ---------------------------------------------------------
  var loading = false
  function mountAccount() {
    var profileName = document.getElementById('customer-profile-name')
    if (!profileName) return
    var panel = profileName.closest('.account-dashboard__panel')
    if (!panel || !panel.parentNode) return
    var old = panel.parentNode.querySelector('.sporta-bday-panel')
    if (old && old.getAttribute('data-lang') === lang()) return
    if (old) old.remove()
    css()
    var box = document.createElement('section')
    box.className = 'account-dashboard__panel sporta-bday-panel'
    box.setAttribute('aria-labelledby', 'account-birthday-title')
    box.setAttribute('data-lang', lang())
    var h = document.createElement('h2'); h.id = 'account-birthday-title'; h.textContent = t('title'); box.appendChild(h)
    var p = picker('customer-profile-birthday'); box.appendChild(p.el)
    var actions = document.createElement('div'); actions.className = 'sporta-bday__actions'
    var save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = t('save')
    var status = document.createElement('span'); status.className = 'sporta-bday__status'; status.setAttribute('role', 'status')
    actions.appendChild(save); actions.appendChild(status); box.appendChild(actions)
    panel.parentNode.insertBefore(box, panel.nextSibling)

    function send(value, done) {
      return request('POST', 'set', { birthday: value }).then(function (r) {
        if (r.data && r.data.gift !== undefined) { gift = r.data.gift; p.refreshHint() }
        done(r)
      }, function () { done({ ok: false }) })
    }
    save.addEventListener('click', function () {
      if (!p.validate()) return
      var v = p.get()
      save.disabled = true; status.textContent = t('saving')
      send(v, function (r) {
        save.disabled = false
        if (r.ok) known = v
        status.textContent = r.ok ? (v ? t('saved') : t('cleared')) : t('failed')
      })
    })

    if (known !== undefined) { p.set(known); return }
    if (loading) return
    loading = true
    var pending = store(true, PENDING)
    var first = pending
      ? new Promise(function (res) { send(pending, function (r) { if (r.ok) store(false, PENDING, null); res() }) })
      : Promise.resolve()
    first.then(function () { return request('GET', 'get') }).then(function (r) {
      loading = false
      if (!r.ok) return
      gift = r.data.gift || null; known = r.data.birthday || ''
      // If React rebuilt the panel while we waited, the next scan fills it from `known`.
      schedule()
      p.refreshHint(); p.set(known)
    }, function () { loading = false })
  }

  function scan() { mountSignup(); mountAccount() }
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; scan() })
  }
  function start() {
    scan()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
