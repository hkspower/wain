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

/* ==== RACES: the bag between tabs, the discount-code key, the checkout after the bank (lane K3 of "fix race condition", 2026-11-04) ====
 * Three guards for the compiled storefront, whose source is not in this repo, so they can only live in an add-on. They are
 * in THIS file because it is the one add-on that every page loads deferred, so it costs no first paint (boot.js blocks it,
 * and is kept small), and the live index.html lists it before the app's own script, so it is in place before the app starts.
 * Each guard is its own block and is wrapped, so none can stop the page or the others. The repo's own app does the first job itself
 * (the cart module under the app's lib folder) and says so with window.__sportaCartOwn, which makes the first block stand down. Proven by
 * scripts/race-client-test.mjs against the captured live storefront.
 *
 * 1. THE BAG IS SHARED BY EVERY TAB. The compiled bag keeps its lines in React state and, after every change, writes the
 *    WHOLE array to localStorage "sporta_cart"; nothing reads it back and no tab listens for another's write. Add a
 *    jacket in tab A, add leggings in tab B (which still holds the bag as it was when it loaded), and B writes
 *    [leggings] over A's [jacket]; remove a line in A and B puts it back. This wraps Storage.prototype.setItem for that
 *    one key: it remembers the bag the app last READ or WROTE, and when the stored bag is no longer that one, it writes
 *    the stored bag with THIS tab's change applied (lines added, removed, quantity changed relative to what the app
 *    saw) instead of the app's whole array. With nothing changed elsewhere the write is the app's own string, byte for
 *    byte. The page itself does not learn of the other tab's lines (it cannot be told), so a tab that is hidden when
 *    the bag changes elsewhere reloads itself, on the pages where that cannot cost anything (see safeToReload). Every
 *    other key, and every other storage object, passes through with the caller's own arguments and `this`. The limit:
 *    localStorage has no compare-and-swap and a browser tells its other processes of a write a moment later, so two
 *    tabs acting inside that moment (milliseconds; not something a person does) can still overwrite each other.
 * 2. THE ENTER KEY IN THE DISCOUNT-CODE BOX. The Apply button beside the box is disabled while a request is out, but the
 *    box also asks on Enter and that path never looked at the button: three presses (or a held key) were three requests,
 *    each wrong code counts against the server's failed-code throttle, and the answers raced (the last to arrive decided
 *    whether the code showed as applied or as an error). While the button is disabled, Enter in that box does nothing;
 *    capture phase on the document, so the app's own handler never sees the key.
 * 3. THE CHECKOUT AFTER THE BANK. Placing a card order sets window.location to the bank and leaves the form busy
 *    ("Redirecting to payment..." on a disabled button) on purpose: the page is meant to be gone. Press Back at the bank
 *    and the browser restores the page from its back/forward cache exactly as it was left: busy, with nothing that
 *    will ever clear it, so the shopper is stuck with a dead button. On such a restore, a form still marked busy a
 *    moment later is reloaded: the details are in "sporta.delivery" (Remember is on by default) and the order attempt
 *    id is in sessionStorage, so the second try is the same order (the server answers a repeated track id with the
 *    order it already has) and goes to the bank again. A restored page that is NOT busy is left alone, typed fields
 *    and all.
 * No dollar signs on purpose (the installer runs through docker compose, which interpolates them). */
;(function () {
  'use strict'
  try {
    var KEY = 'sporta_cart'
    var SP = window.Storage && window.Storage.prototype
    if (!SP || typeof SP.setItem !== 'function' || typeof SP.getItem !== 'function' || SP.setItem.__sportaCart) return
    var rawGet = SP.getItem, rawSet = SP.setItem
    var seen = null    // the bag as the app last read or wrote it (an array); null while the stored value cannot be read as a bag
    var stale = false  // another tab changed the bag after this one last looked

    function parse(text) {
      try { var v = JSON.parse(text); return Array.isArray(v) ? v : null } catch (e) { return null }
    }
    function same(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b) }
    function local(st) { try { return st === window.localStorage } catch (e) { return false } }
    function standDown() { return !!window.__sportaCartOwn }
    function byKey(list) {
      var m = {}
      for (var i = 0; i < list.length; i++) if (list[i] && typeof list[i].key === 'string') m[list[i].key] = list[i]
      return m
    }
    function qty(line) { var n = Number(line && line.qty); return isFinite(n) ? n : 0 }
    function clone(line) { var c = {}; for (var k in line) if (Object.prototype.hasOwnProperty.call(line, k)) c[k] = line[k]; return c }
    // The bag that results from applying this tab's change (base -> mine) to the bag that is stored now (theirs).
    function merge(base, mine, theirs) {
      var B = byKey(base), M = byKey(mine), out = [], used = {}, i, k
      for (i = 0; i < theirs.length; i++) {
        var t = theirs[i]
        k = t && t.key
        if (typeof k !== 'string') { out.push(t); continue }
        used[k] = 1
        var b = B[k], m = M[k]
        if (b && !m) continue            // this tab removed the line
        if (!m) { out.push(t); continue } // a line only the other tab has: keep it
        var line = clone(t)
        if (!b) line.qty = qty(t) + qty(m) // both tabs added the same line: the quantities add up
        else {
          var delta = qty(m) - qty(b)
          if (delta) line.qty = Math.min(99, Math.max(1, qty(t) + delta))
          // a refreshed price, name or picture is this tab's news
          if (m.price !== b.price || m.image !== b.image || JSON.stringify(m.name) !== JSON.stringify(b.name)) { line.price = m.price; line.image = m.image; line.name = m.name }
        }
        out.push(line)
      }
      for (i = 0; i < mine.length; i++) {
        k = mine[i] && mine[i].key
        if (typeof k !== 'string' || used[k]) continue
        // Not in the stored bag any more. If this tab never touched the line it is the OTHER tab that removed it: leave it
        // out. If this tab added it, or changed it after the other tab removed it, this tab's latest wish stands.
        var was = B[k]
        if (!was || qty(mine[i]) !== qty(was) || mine[i].price !== was.price) out.push(mine[i])
      }
      return out
    }

    var set = function (k, v) {
      if (arguments.length > 1 && String(k) === KEY && !standDown() && local(this)) {
        try {
          var mine = parse(v)
          if (mine) {
            var theirs = seen ? parse(rawGet.call(this, KEY)) : null
            var out = v
            if (seen && theirs && !same(theirs, seen)) out = JSON.stringify(merge(seen, mine, theirs))
            seen = mine
            stale = false
            return rawSet.call(this, k, out)
          }
        } catch (e) { /* store the app's own value rather than lose the save */ }
      }
      return rawSet.apply(this, arguments)
    }
    var get = function (k) {
      var r = rawGet.apply(this, arguments)
      if (seen === null && String(k) === KEY && !standDown() && local(this)) { try { seen = (typeof r === 'string' && parse(r)) || [] } catch (e) { /* ignore */ } }
      return r
    }
    set.__sportaCart = true; get.__sportaCart = true
    SP.setItem = set; SP.getItem = get
    // In place before the app starts (the usual case) or a moment after: either way the bag in storage right now is the bag
    // the app has (it has not changed anything yet, or has written what it has).
    try { var first = rawGet.call(window.localStorage, KEY); seen = first === null ? [] : parse(first) } catch (e) { /* storage blocked: the first read sets it */ }

    // Pages where a reload while nobody is looking loses nothing: no checkout, no payment page, no account, and never a
    // page with something typed in it.
    function safeToReload() {
      var path = location.pathname
      if (!(path === '/' || ['/shop', '/cart', '/wishlist', '/about'].some(function (p) { return path === p || path.indexOf(p + '/') === 0 }) || path.indexOf('/product/') === 0)) return false
      var f = document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea')
      for (var i = 0; i < f.length; i++) if (f[i].value) return false
      return true
    }
    function maybeReload() {
      if (stale && document.hidden && !standDown() && safeToReload()) { stale = false; location.reload() }
    }
    window.addEventListener('storage', function (e) {
      if (standDown() || (e.key !== KEY && e.key !== null)) return
      stale = true
      maybeReload()
    })
    document.addEventListener('visibilitychange', maybeReload)
  } catch (e) { /* the shop must open without this */ }
})()

;(function () {
  'use strict'
  try {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return
      var box = e.target
      if (!box || box.tagName !== 'INPUT' || !box.classList || !box.classList.contains('font-mono') || !box.parentElement) return
      var path = location.pathname
      if (!(path === '/checkout' || path.indexOf('/checkout/') === 0)) return
      var apply = box.parentElement.querySelector('button')
      if (apply && apply.disabled) { e.preventDefault(); e.stopPropagation() }
    }, true)
  } catch (e) { /* the shop must open without this */ }
})()
;(function () {
  'use strict'
  try {
    window.addEventListener('pageshow', function (e) {
      var path = location.pathname
      if (!e.persisted || !(path === '/checkout' || path.indexOf('/checkout/') === 0)) return
      // Give the app a moment to clear the busy state itself (a build that listens for this event does), then reload only
      // if the form is still stuck.
      setTimeout(function () {
        try { if (document.querySelector('form[aria-busy="true"]')) location.reload() } catch (err) { /* ignore */ }
      }, 300)
    })
  } catch (e) { /* the shop must open without this */ }
})()
