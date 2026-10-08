/**
 * A "Setup" screen in the website panel (2026-10-04, "improve all backend setup"): one page that says
 * what is configured, what is missing and where each thing is set. Same overlay as seo-screen.js /
 * payments-screen.js — a button in the sidebar and the phone tab bar, a screen drawn inside
 * `.admin-content` while open, the bundle's screen given back on any other nav click.
 *
 * The facts come from admin.php?r=setup_status (gated), which reports a STATE per item — ready,
 * partial, placeholder, missing — and never a value: no key, token or password reaches this page.
 * "placeholder" is its own state on purpose: pay/config.php shipped `YOUR_CLIENT_ID` aimed at the live
 * gateway for weeks, and a check that asks only "is it set?" calls that ready.
 *
 * Each row names WHERE the thing is set. Panel screens get a button that opens them; the keys that
 * live in api/config.php on the server say so, because no screen can write that file (and should not:
 * it holds the database password).
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var ADMIN = '/api/admin.php?r='
  var MARK = 'data-spsetup'
  var open = false, screen = null, saved = []

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route) {
    return fetch(ADMIN + route, { headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' })
      .then(function (r) { return r.json().catch(function () { return null }) })
      .catch(function () { return { error: 'network' } })
  }

  /* label, one-line hint, and where the owner goes (a sidebar screen name, or 'config' / 'cron' / 'file') */
  var ITEMS = {
    cbk: ['Card payments (CBK / KNET / T-Pay)', 'The bank credentials. Without them a shopper who chooses a card is refused at the last step.', 'Payments'],
    knet_tranportal: ['KNET Tranportal ID', 'The merchant id KNET gave the shop.', 'Payments'],
    payment_methods: ['Payment methods switched on', 'At least one way to pay.', 'Payments'],
    whatsapp: ['WhatsApp order updates', 'Token and phone-number id from Meta; templates for confirmed, packed, shipped, delivered, review.', 'config'],
    mail: ['Email sender', 'The address customer mail is sent from, and the warehouse address for packing lists.', 'config'],
    push: ['Web push notifications', 'VAPID key pair. Lets the panel notify your phone about new orders.', 'config'],
    assistant_n8n: ['Sporta AI assistant (n8n)', 'Webhook URL and secret for the chat assistant.', 'config'],
    voice: ['Assistant voice', 'Text-to-speech key and voice id. Optional.', 'config'],
    ai_research: ['Product "Look it up"', 'AI key for the product research card. Optional.', 'config'],
    cron_key: ['Cron key', 'Shared secret for the scheduled jobs (stock release, invoices, mail, tracking links).', 'config'],
    google_signin: ['Google sign-in for the panel', 'Optional second door. Client id from Google Cloud.', 'Security'],
    apple_signin: ['Apple sign-in for the panel', 'Optional. Services id from Apple.', 'Security'],
    two_factor: ['Second factor on your account', 'Authenticator app or email code on this admin account.', 'Security'],
    wallet: ['Apple Wallet loyalty card', 'Pass Type certificate linked. Cards are issued the day it is.', 'Settings'],
    product_photos: ['Product photographs', 'Every active product with at least one photo.', 'Catalogue'],
    brand_logos: ['Brand logos', 'A logo for every brand.', 'Brands'],
    product_brands: ['Products assigned a brand', 'Every active product with a brand.', 'Catalogue'],
    product_descriptions: ['Product descriptions', 'English and Arabic text on every active product.', 'Catalogue'],
    hero_slides: ['Home page slides', 'At least one active slide.', 'Slides'],
    instagram: ['Instagram link', 'The handle shown in the footer and the shopping feed.', 'Settings'],
    google_verification: ['Google Search Console', 'The verification tag, so the sitemap can be submitted.', 'SEO'],
    contact: ['Contact phone', 'The number shown on the contact page and the returns form.', 'Settings'],
    daily_backup: ['Daily backup', 'A scheduled job writing ~/backups/sporta-<date>.json.gz every day (api/cron-backup.php).', 'cron'],
  }
  var GROUPS = [['payments', 'Payments'], ['config', 'Server configuration (api/config.php)'], ['security', 'Sign-in and security'],
    ['settings', 'Settings'], ['catalogue', 'Catalogue'], ['brands', 'Brands'], ['slides', 'Home page'], ['seo', 'Search'], ['cron', 'Scheduled jobs']]
  var STATE = { ready: ['Ready', '#16a34a'], partial: ['Partly', '#d97706'], placeholder: ['Placeholder', '#dc2626'], missing: ['Missing', '#64748b'] }

  var CSS = ''
    + '.admin-content.spsetup-on>:not([' + MARK + ']){display:none!important}'
    + '.spsetup-h1{margin:0 0 6px;font-size:22px;font-weight:800}.spsetup-sub{margin:0 0 14px;font-size:13px;opacity:.8;line-height:1.5}'
    + '.spsetup-sum{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}'
    + '.spsetup-pill{font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;color:#fff}'
    + '.spsetup-sec{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1rem 1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.spsetup-h{margin:0 0 6px;font-size:16px;font-weight:700}'
    + '.spsetup-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid rgba(128,128,128,.2)}'
    + '.spsetup-row:first-of-type{border-top:0}'
    + '.spsetup-dot{flex:0 0 auto;min-width:88px;text-align:center;font-size:12px;font-weight:700;padding:4px 8px;border-radius:999px;color:#fff;margin-top:2px}'
    + '.spsetup-body{flex:1 1 auto;min-width:0}.spsetup-l{font-size:14px;font-weight:600}.spsetup-c{font-size:12px;opacity:.75;line-height:1.5}'
    + '.spsetup-go{flex:0 0 auto;min-height:44px;padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.spsetup-where{flex:0 0 auto;font-size:12px;opacity:.7;align-self:center;max-width:160px;text-align:end}'
    + '.spsetup-note{margin:8px 0 0;font-size:13px}'
    // On a phone the pill sits beside the text and the button goes under the text, indented by the
    // pill's 88px plus the 12px gap — which is what the 100px below was always for. It did not
    // happen: `flex:1 1 auto` made the text's flex basis its whole one-line width, so any hint wider
    // than ~238px dropped the text onto a line of its own and left the pill alone on the first
    // (19 of 23 rows, 166-208px each). A 170px basis lets the text sit beside the pill and wrap
    // there (2026-10-08): average row 172 -> 139px, the checklist ~750px shorter on a Pixel 7.
    // The "api/config.php on the server" note is no longer squeezed to 160px under the text.
    + '@media(max-width:640px){.spsetup-row{flex-wrap:wrap}.spsetup-body{flex:1 1 170px}'
    + '.spsetup-go,.spsetup-where{margin-inline-start:100px}.spsetup-where{max-width:none;text-align:start}}'
  function style() { if (document.getElementById('spsetup-css')) return; var s = el('style'); s.id = 'spsetup-css'; s.textContent = CSS; document.head.appendChild(s) }

  function openSidebar(name) {
    var target = null
    document.querySelectorAll('.admin-sidebar button, .m-tabbar__item').forEach(function (b) { if (!target && new RegExp('^\\s*' + name + '\\s*$').test(b.textContent)) target = b })
    if (target) target.click()
  }

  function detail(it) {
    var d = []
    if (it.key === 'cbk' && it.env) d.push(it.env === 'test' ? 'test gateway' : 'live gateway')
    if (it.key === 'knet_tranportal' && it.source) d.push('from ' + (it.source === 'panel' ? 'the panel' : 'knet/config.php'))
    if (it.key === 'whatsapp' && it.templates) d.push('templates ' + it.templates)
    if (it.key === 'mail' && it.warehouse) d.push('warehouse address ' + it.warehouse)
    if (typeof it.with === 'number' && typeof it.of === 'number') d.push(it.with + ' of ' + it.of)
    if (it.key === 'hero_slides' || it.key === 'payment_methods') d.push(String(it.count || 0))
    if (it.key === 'wallet' && it.expires) d.push((it.expired ? 'EXPIRED ' : 'expires ') + String(it.expires).slice(0, 10))
    if (it.key === 'daily_backup') d.push(it.count ? it.count + ' kept, newest ' + it.newest : 'none yet')
    return d.join(' · ')
  }

  function build(data) {
    var root = el('div'); root.setAttribute(MARK, '1')
    root.appendChild(el('h1', 'spsetup-h1', 'Setup checklist'))
    root.appendChild(el('p', 'spsetup-sub', 'What the shop has and what it still needs, and where each one is set. States only — no key or password is shown here.'))
    if (!data || data.error) { root.appendChild(el('p', 'spsetup-note', data && data.error === 'not_signed_in' ? 'Sign in again.' : 'Could not read the setup state.')); return root }
    var sum = el('div', 'spsetup-sum'); root.appendChild(sum)
    Object.keys(STATE).forEach(function (k) {
      var n = (data.summary && data.summary[k]) || 0; if (!n) return
      var p = el('span', 'spsetup-pill', n + ' ' + STATE[k][0].toLowerCase()); p.style.background = STATE[k][1]; sum.appendChild(p)
    })
    GROUPS.forEach(function (g) {
      var rows = (data.items || []).filter(function (i) { return i.where === g[0] })
      if (!rows.length) return
      var sec = el('section', 'spsetup-sec'); sec.setAttribute('data-spsetup-group', g[0]); root.appendChild(sec)
      // h3, NOT h2 (2026-10-08). About twenty overlays find the screen they belong to by an h1/h2
      // whose text is exactly "Payments", "Settings", "Catalogue" or "Brands" — and these group
      // headings use the same words, so every one of them mounted a SECOND live copy of its editor
      // inside this checklist: 20 foreign cards, a 19,600px Setup screen on a phone, 68 requests on
      // opening it, and — worse — the real Settings screen left without its cards for the rest of
      // the visit, because they stayed attached to the removed Setup copy. No overlay mounts under
      // an h3. Styled by its class only, so it looks the same; the Jump-to bar reads h2 AND h3.
      sec.appendChild(el('h3', 'spsetup-h', g[1]))
      rows.forEach(function (it) {
        var meta = ITEMS[it.key] || [it.key, '', null]
        var row = el('div', 'spsetup-row'); row.setAttribute('data-spsetup-item', it.key); row.setAttribute('data-state', it.state)
        var dot = el('span', 'spsetup-dot', (STATE[it.state] || STATE.missing)[0]); dot.style.background = (STATE[it.state] || STATE.missing)[1]; row.appendChild(dot)
        var body = el('div', 'spsetup-body'); body.appendChild(el('div', 'spsetup-l', meta[0]))
        var hint = meta[1]; var d = detail(it); body.appendChild(el('div', 'spsetup-c', d ? hint + ' — ' + d : hint)); row.appendChild(body)
        if (meta[2] === 'config') row.appendChild(el('span', 'spsetup-where', 'api/config.php on the server'))
        else if (meta[2] === 'cron') row.appendChild(el('span', 'spsetup-where', 'hPanel → Cron Jobs'))
        else if (meta[2]) { var b = el('button', 'spsetup-go', 'Open ' + meta[2]); b.type = 'button'; b.addEventListener('click', function () { openSidebar(meta[2]) }); row.appendChild(b) }
        sec.appendChild(row)
      })
    })
    return root
  }

  /* -------------------------------------------------- nav + open (seo-screen.js's pattern) */
  function setCurrent(mine) {
    var all = document.querySelectorAll('.admin-sidebar button, .m-tabbar__item')
    if (mine) {
      saved = []
      all.forEach(function (b) {
        if (b.hasAttribute('data-spsetup-nav')) return
        saved.push([b, b.getAttribute('aria-current'), b.className])
        if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', 'false')
        else b.className = b.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
      })
    } else {
      saved.forEach(function (x) { if (x[0].isConnected) { if (x[1] === null) x[0].removeAttribute('aria-current'); else x[0].setAttribute('aria-current', x[1]); x[0].className = x[2] } })
      saved = []
    }
    document.querySelectorAll('[data-spsetup-nav]').forEach(function (b) {
      if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', mine ? 'true' : 'false')
      else { b.classList.toggle('bg-indigo-50', mine); b.classList.toggle('text-indigo-600', mine); b.classList.toggle('text-slate-600', !mine) }
    })
  }
  function openScreen() {
    var host = document.querySelector('.admin-content'); if (!host) return
    style()
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    screen = el('div'); screen.setAttribute(MARK, '1'); screen.appendChild(el('p', 'spsetup-note', 'Checking…'))
    host.insertBefore(screen, host.firstChild)
    host.classList.add('spsetup-on'); open = true
    setCurrent(true)
    try { window.scrollTo({ top: 0, behavior: 'instant' }) } catch (e) { window.scrollTo(0, 0) }
    call('setup_status').then(function (data) {
      if (!open || !screen) return
      var fresh = build(data); screen.replaceWith(fresh); screen = fresh
    })
  }
  function closeScreen() {
    if (!open) return
    open = false
    var host = document.querySelector('.admin-content'); if (host) host.classList.remove('spsetup-on')
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    setCurrent(false)
  }
  function addNav() {
    if (!document.querySelector('.admin-content')) { open = false; return }
    var side = document.querySelector('.admin-sidebar')
    if (side && !side.querySelector('[data-spsetup-nav]')) {
      var ref = null
      side.querySelectorAll('button').forEach(function (b) { if (/^\s*Settings\s*$/.test(b.textContent)) ref = b })
      if (ref) {
        var b = ref.cloneNode(true); b.setAttribute('data-spsetup-nav', '1')
        b.removeAttribute('data-spps-nav'); b.removeAttribute('data-spseo-nav')
        b.className = ref.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
        b.querySelectorAll('*').forEach(function (n) { n.childNodes.forEach(function (c) { if (c.nodeType === 3 && /Settings/.test(c.textContent)) c.textContent = 'Setup' }) })
        var after = side.querySelector('[data-spseo-nav]') || side.querySelector('[data-spps-nav]') || ref
        after.parentNode.insertBefore(b, after.nextSibling)
      }
    }
    var bar = document.querySelector('.m-tabbar')
    if (bar && !bar.querySelector('[data-spsetup-nav]')) {
      var tref = null
      bar.querySelectorAll('.m-tabbar__item').forEach(function (b) { if (/Settings/.test(b.textContent) && !b.hasAttribute('data-spps-nav') && !b.hasAttribute('data-spseo-nav')) tref = b })
      if (tref) {
        var t = tref.cloneNode(true); t.setAttribute('data-spsetup-nav', '1'); t.setAttribute('aria-current', 'false')
        t.childNodes.forEach(function (c) { if (c.nodeType === 3) c.textContent = 'Setup' })
        var tafter = bar.querySelector('[data-spseo-nav]') || bar.querySelector('[data-spps-nav]') || tref
        tafter.parentNode.insertBefore(t, tafter.nextSibling)
      }
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button')
    if (!b) return
    if (b.hasAttribute('data-spsetup-nav')) { e.preventDefault(); e.stopPropagation(); openScreen(); return }
    if (open && (b.closest('.admin-sidebar') || b.classList.contains('m-tabbar__item'))) closeScreen()
  }, true)
  var t = null
  new MutationObserver(function () {
    clearTimeout(t)
    t = setTimeout(function () {
      addNav()
      if (open && screen && !screen.isConnected) { var h = document.querySelector('.admin-content'); if (h) h.insertBefore(screen, h.firstChild) }
    }, 150)
  }).observe(document.body, { childList: true, subtree: true })
})()
