/**
 * A "Payments" screen in the panel: which ways to pay are switched on, whether
 * each one can actually take money right now, and the cash-on-delivery limits.
 * The KNET/CBK credentials card (payment.js) lives on this screen too.
 *
 * WHY AN OVERLAY. The panel is a prebuilt bundle with no source here; its
 * screens are a fixed list. This adds one button to the sidebar and the phone
 * tab bar and draws its own screen inside `.admin-content`, hiding what the
 * bundle drew while it is open and giving it back the moment any other button
 * is pressed. Nothing the bundle owns is changed or removed.
 *
 * NO NEW SERVER RULES for the switches: `payment_methods`, `cod_open_max` and
 * (new) `cod_max_fils` are rules in the same row the Shop rules card edits, saved
 * through the same route, which sends only the fields that changed.
 *
 * WHAT IT WILL NOT DO: charge anything. The connection test logs in to the CBK
 * gateway with the saved credentials and reaches the KNET gateway host — nothing more.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-spps'
  var open = false
  var screen = null
  var saved = []           // aria-current values to give back when the screen closes

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9, ٫ to "." and ٬ dropped —
     what an Arabic phone's number pad types. These boxes were type=number,
     which DROPS a digit it does not know: "٤" saved as "Check the numbers." and
     "٥٫٥" as an empty box, which the old save read as 0 — NO LIMIT. */
  function west(s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9\u066B\u066C]/g, function (c) {
      var n = c.charCodeAt(0)
      if (n === 0x066B) return '.'
      if (n === 0x066C) return ''
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }
  /* KWD to fils, or null when it is not an amount. An EMPTY box is null, not 0:
     0 means "no limit", and that must be typed, never inferred from a blank.
     The comma rule is money.ts's and rules.js's: with a dot present a comma
     groups thousands ("1,234.500"); alone it is the decimal point ("1,5"). */
  function fils(v) {
    var raw = west(v).trim()
    if (raw === '') return null
    raw = raw.indexOf('.') >= 0 ? raw.replace(/,/g, '') : raw.replace(',', '.')
    if (!/^\d+(\.\d{1,3})?$/.test(raw)) return null
    return Math.round(parseFloat(raw) * 1000)
  }
  function call(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
  }

  var CSS = ''
    + '.admin-content.spps-on>:not([' + MARK + ']):not([data-sporta-panel="payment"]):not([data-sporta-panel="rules"]){display:none!important}'
    + '.spps-sec{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.spps-h{margin:0 0 4px;font-size:16px;font-weight:700}'
    + '.spps-sub{margin:0 0 12px;font-size:13px;opacity:.75;line-height:1.5}'
    + '.spps-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(128,128,128,.2)}'
    + '.spps-row:last-child{border-bottom:0}'
    + '.spps-name{font-weight:600;flex:1}'
    + '.spps-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}'
    + '.spps-ok{background:rgba(22,163,74,.18);color:#16a34a}.spps-warn{background:rgba(220,38,38,.18);color:#dc2626}'
    + '.spps-off{background:rgba(128,128,128,.2);color:inherit;opacity:.75}.spps-unk{background:rgba(217,119,6,.18);color:#d97706}'
    + '.spps-btn{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spps-btn[disabled]{opacity:.5;cursor:default}'
    + '.spps-in{padding:8px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;font:inherit;width:9em}'
    + '.spps-note{font-size:13px;line-height:1.5;margin:8px 0 0}'
    + '.spps-detail{font-size:12px;opacity:.8;margin:2px 0 0}'
    + '.spps-sw{width:44px;height:26px;accent-color:#4f46e5}'

  function style() {
    if (document.getElementById('spps-css')) return
    var s = document.createElement('style'); s.id = 'spps-css'; s.textContent = CSS; document.head.appendChild(s)
  }

  var NAMES = { knet: 'KNET', tpay: 'T-Pay (card)', cod: 'Cash on delivery' }
  var boxes = {}, badges = {}, details = {}
  var codOpen, codMax, note, testBtn, saveBtn, rulesNow = null

  function badge(m) {
    if (!m.enabled) return ['Off', 'spps-off']
    if (!m.configured) return ['On — NOT set up', 'spps-warn']
    if (m.working === false) return ['On — cannot connect', 'spps-warn']
    if (m.working === null) return ['On — not tested', 'spps-unk']
    return ['On — working', 'spps-ok']
  }

  function paint(status) {
    Object.keys(NAMES).forEach(function (k) {
      var m = status.methods[k]
      var b = badge(m)
      badges[k].textContent = b[0]; badges[k].className = 'spps-badge ' + b[1]
      var d = []
      if (k === 'knet' && status.knet && status.knet.mode) d.push('mode: ' + status.knet.mode + ' · ' + (status.knet.env || ''))
      if (k !== 'cod' && status.cbk && k === 'tpay') d.push('CBK environment: ' + status.cbk.env)
      var g = k === 'knet' && status.knet && status.knet.mode === 'legacy' ? status.knet : (k === 'tpay' || (k === 'knet') ? status.cbk : null)
      if (g && g.reach) d.push(g.reach.reachable ? 'gateway ' + g.reach.host + ' reachable' : 'gateway ' + g.reach.host + ' NOT reachable' + (g.reach.error ? ' (' + g.reach.error + ')' : ''))
      if (k !== 'knet' || (status.knet && status.knet.mode === 'official')) {
        if (status.cbk && status.cbk.login) d.push('login: ' + status.cbk.login.message)
      }
      details[k].textContent = d.join(' · ')
    })
  }

  function refresh(live) {
    return call('payment_check' + (live ? '&live=1' : '')).then(function (r) {
      if (r.ok && r.j && r.j.methods) paint(r.j)
      return r
    })
  }

  function say(t, good) { note.textContent = t || ''; note.style.color = t ? (good ? '#16a34a' : '#dc2626') : '' }

  var WHY = {
    rule_empty_list: 'At least one way to pay must stay on.',
    rule_out_of_range: 'That number is outside the allowed range.',
    rule_not_a_number: 'Enter a whole number.',
  }
  function why(e) { e = String(e || ''); return WHY[e.split(':')[0]] || e }

  function build() {
    var s = el('section'); s.setAttribute(MARK, '1')
    s.appendChild(el('h1', 'spps-title', 'Payments'))
    s.firstChild.style.cssText = 'font-size:22px;font-weight:800;margin:0 0 4px'

    var sec = el('div', 'spps-sec')
    sec.appendChild(el('h2', 'spps-h', 'Ways to pay'))
    sec.appendChild(el('p', 'spps-sub', 'Switch a method off and it disappears from checkout and the server refuses it. '
      + 'T-Pay also needs tpayEnabled in config.js before checkout offers it.'))
    Object.keys(NAMES).forEach(function (k) {
      var row = el('label', 'spps-row')
      var cb = el('input', 'spps-sw'); cb.type = 'checkbox'
      var col = el('span', 'spps-name'); col.appendChild(document.createTextNode(NAMES[k]))
      var d = el('div', 'spps-detail'); col.appendChild(d)
      var b = el('span', 'spps-badge spps-off', '…')
      row.appendChild(cb); row.appendChild(col); row.appendChild(b)
      sec.appendChild(row)
      boxes[k] = cb; badges[k] = b; details[k] = d
    })
    var foot = el('div'); foot.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:center'
    saveBtn = el('button', 'spps-btn', 'Save'); saveBtn.type = 'button'
    testBtn = el('button', 'spps-btn', 'Test connections'); testBtn.type = 'button'
    testBtn.style.background = 'transparent'; testBtn.style.color = 'inherit'; testBtn.style.border = '1px solid rgba(128,128,128,.6)'
    note = el('p', 'spps-note'); note.style.margin = '0'
    foot.appendChild(saveBtn); foot.appendChild(testBtn); foot.appendChild(note)
    sec.appendChild(foot)
    s.appendChild(sec)

    var cod = el('div', 'spps-sec')
    cod.appendChild(el('h2', 'spps-h', 'Cash on delivery limits'))
    cod.appendChild(el('p', 'spps-sub', 'A customer over a limit is told at the last step, not before — the checkout does not show these numbers.'))
    var r1 = el('label', 'spps-row'); r1.appendChild(el('span', 'spps-name', 'Unpaid cash orders one customer may have open'))
    codOpen = el('input', 'spps-in'); codOpen.type = 'text'; codOpen.inputMode = 'numeric'; codOpen.pattern = '[0-9]*'; codOpen.maxLength = 2; codOpen.dir = 'ltr'; r1.appendChild(codOpen)
    var r2 = el('label', 'spps-row'); r2.appendChild(el('span', 'spps-name', 'Largest cash order (KWD, 0 = no limit)'))
    codMax = el('input', 'spps-in'); codMax.type = 'text'; codMax.inputMode = 'decimal'; codMax.dir = 'ltr'; r2.appendChild(codMax)
    cod.appendChild(r1); cod.appendChild(r2)
    s.appendChild(cod)

    testBtn.addEventListener('click', function () {
      testBtn.disabled = true; say('Contacting the gateways…', true)
      refresh(true).then(function (r) {
        testBtn.disabled = false
        say(r.ok ? 'Checked just now.' : (r.status === 429 ? 'Too many tests — wait a few minutes.' : 'Could not run the test.'), r.ok)
      })
    })
    saveBtn.addEventListener('click', function () {
      var methods = Object.keys(NAMES).filter(function (k) { return boxes[k].checked })
      var openMax = west(codOpen.value).trim(), maxFils = fils(codMax.value)
      if (!/^\d+$/.test(openMax) || maxFils === null) { say('Check the numbers.', false); return }
      var body = { payment_methods: methods, cod_open_max: openMax, cod_max_fils: String(maxFils) }
      saveBtn.disabled = true; say('Saving…', true)
      call('settings_save', { name: 'rules', value: body }).then(function (r) {
        saveBtn.disabled = false
        if (!r.ok || (r.j && r.j.error)) { say(why(r.j && r.j.error), false); return }
        say('Saved.', true); load()
      })
    })
    return s
  }

  function load() {
    call('rules').then(function (r) {
      if (!r.ok || !r.j || !r.j.rules) return
      rulesNow = r.j.rules
      Object.keys(NAMES).forEach(function (k) { boxes[k].checked = rulesNow.payment_methods.indexOf(k) !== -1 })
      codOpen.value = String(rulesNow.cod_open_max)
      codMax.value = String((rulesNow.cod_max_fils || 0) / 1000)
    })
    refresh(false)
  }

  /* -------------------------------------------------------------- nav + open */
  function navButtons() { return document.querySelectorAll('.admin-sidebar nav button, .admin-sidebar button, .m-tabbar__item') }

  function setCurrent(mine) {
    var all = document.querySelectorAll('.admin-sidebar button, .m-tabbar__item')
    if (mine) {
      saved = []
      all.forEach(function (b) {
        if (b.hasAttribute('data-spps-nav')) return
        saved.push([b, b.getAttribute('aria-current'), b.className])
        if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', 'false')
        else b.className = b.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
      })
    } else {
      saved.forEach(function (x) { if (x[0].isConnected) { if (x[1] === null) x[0].removeAttribute('aria-current'); else x[0].setAttribute('aria-current', x[1]); x[0].className = x[2] } })
      saved = []
    }
    document.querySelectorAll('[data-spps-nav]').forEach(function (b) {
      if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', mine ? 'true' : 'false')
      else {
        b.classList.toggle('bg-indigo-50', mine); b.classList.toggle('text-indigo-600', mine)
        b.classList.toggle('text-slate-600', !mine)
      }
    })
  }

  function openScreen() {
    var host = document.querySelector('.admin-content')
    if (!host) return
    style()
    if (!screen) { screen = build() }
    if (!screen.parentNode) host.insertBefore(screen, host.firstChild)
    host.classList.add('spps-on')
    open = true
    setCurrent(true)
    load()
    try { window.scrollTo({ top: 0, behavior: 'instant' }) } catch (e) { window.scrollTo(0, 0) }
  }
  function closeScreen() {
    if (!open) return
    open = false
    var host = document.querySelector('.admin-content')
    if (host) host.classList.remove('spps-on')
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    setCurrent(false)
  }

  function addNav() {
    if (!document.querySelector('.admin-content')) { open = false; return }
    var side = document.querySelector('.admin-sidebar')
    if (side && !side.querySelector('[data-spps-nav]')) {
      var ref = null
      side.querySelectorAll('button').forEach(function (b) { if (/^\s*Settings\s*$/.test(b.textContent)) ref = b })
      if (ref) {
        var b = ref.cloneNode(true)
        b.setAttribute('data-spps-nav', '1')
        b.className = ref.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
        var span = b.querySelector('span span, span'); var txt = null
        b.querySelectorAll('*').forEach(function (n) { n.childNodes.forEach(function (c) { if (c.nodeType === 3 && /Settings/.test(c.textContent)) txt = c }) })
        if (txt) txt.textContent = 'Payments'
        ref.parentNode.insertBefore(b, ref.nextSibling)
      }
    }
    var bar = document.querySelector('.m-tabbar')
    if (bar && !bar.querySelector('[data-spps-nav]')) {
      var tref = null
      bar.querySelectorAll('.m-tabbar__item').forEach(function (b) { if (/Settings/.test(b.textContent)) tref = b })
      if (tref) {
        var t = tref.cloneNode(true)
        t.setAttribute('data-spps-nav', '1'); t.setAttribute('aria-current', 'false')
        t.childNodes.forEach(function (c) { if (c.nodeType === 3) c.textContent = 'Payments' })
        tref.parentNode.insertBefore(t, tref.nextSibling)
      }
    }
  }

  /* Capture-phase, before React sees the click: my button opens the screen and
     stops there; any OTHER navigation button closes it and carries on. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('button')
    if (!btn) return
    if (btn.hasAttribute('data-spps-nav')) { e.preventDefault(); e.stopPropagation(); openScreen(); return }
    if (open && (btn.closest('.admin-sidebar') || btn.classList.contains('m-tabbar__item'))) closeScreen()
  }, true)

  var t = null
  new MutationObserver(function () {
    clearTimeout(t)
    t = setTimeout(function () {
      if (!/^\/backends(\/|$)/.test(location.pathname)) return
      addNav()
      if (open && screen && !screen.isConnected) { var h = document.querySelector('.admin-content'); if (h) h.insertBefore(screen, h.firstChild) }
    }, 150)
  }).observe(document.body, { childList: true, subtree: true })
})()
