/**
 * A "Users" screen in the website panel (2026-10-08, "make users page at backend"). The owner chose ONE screen with
 * TWO tabs, and every action below:
 *
 *   Shoppers   the customer accounts of api/customer.php — search, look one up (its orders, passkeys, the phone's
 *              block), block and unblock it, sign it out of every browser, delete it with its orders kept
 *   Team       the accounts that can sign in to this panel — list, add, switch off and on, remove. Everyone on the
 *              team has full access: there are no roles, by the owner's choice, so nothing here offers one.
 *
 * Same overlay as seo-screen.js / setup-screen.js: one button in the sidebar and the phone tab bar, a screen drawn
 * inside `.admin-content` while it is open, the bundle's own screen given back the moment any other nav button is
 * pressed. Nothing the bundle owns is changed. The h1 is exactly the nav label, "Users", because panel-ux.js's
 * pull-to-refresh reopens a screen by matching the two.
 *
 * The data is admin.php's USERS PAGE routes, which check everything again and refuse by name; a refusal leaves what was
 * typed on screen. English only, like the rest of the panel's chrome — never documentElement.lang, which is `ar` on
 * every page. A shopper's Arabic NAME is data and is marked rtl where it is printed.
 *
 * EVERY TEAM WRITE ASKS FOR YOUR OWN PASSWORD, and your code when your account has a second factor: the server's
 * users_reauth(). Adding a colleague hands somebody the whole shop, and switching one off is the quickest way to take
 * it from its owner — an unlocked laptop must not be enough for either. The two secrets travel ONLY under `password`
 * and `code`, the two keys store_admin_audit_redact() blanks before the Activity log records the request. The new
 * colleague's temporary password is in the RESPONSE, which nothing records, and is shown once.
 *
 * TWO OWN SCREENS, ONE CLICK. Payments, SEO and Setup each restore the nav classes they saved when they opened, from a
 * capture listener on `document`, and a listener on the same node cannot stop the next one. So whichever screen runs
 * second wins: opening a screen whose listener runs first had its button lit and then UN-lit by the closing screen's
 * restore, and the closing screen's stale "active" came back. This file avoids it from its own side, in both
 * directions, whatever order the script tags are in:
 *   - it CLOSES from `window`'s capture phase, which runs before every listener on document — so its restore is done
 *     before another screen takes its snapshot;
 *   - it OPENS from document, and if another own screen is still open at that moment (its listener has not run yet),
 *     it waits for the click to finish so that screen's restore lands first and Users snapshots a clean nav.
 * The Dark panel switch sits in the sidebar and changes colours, not screens, so it does not close this one.
 *
 * NOT IN THE EXPO APP. The app's panel has no Users screen and these routes are the website panel's only.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var ADMIN = '/api/admin.php?r='
  var MARK = 'data-spus'
  var NAV = 'data-spus-nav'
  var OTHER_NAVS = ['data-spps-nav', 'data-spseo-nav', 'data-spsetup-nav']
  var ACTIVE = 'bg-indigo-50 text-indigo-600', INACTIVE = 'text-slate-600 hover:bg-slate-50'
  var TAB_KEY = 'spus-tab'
  var open = false, screen = null, saved = [], title = null
  var ui = null              // the current screen's parts and state; rebuilt on every open, null while closed

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function attr(n, k, v) { n.setAttribute(k, v == null ? '' : String(v)); return n }
  /* fetch is looked up at CALL time, never kept from load time: panel-ux.js wraps it for its toasts after this runs. */
  function call(route, body) {
    return fetch(ADMIN + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include', body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return j || { error: 'http_' + r.status } }) })
      .catch(function () { return { error: 'network' } })
  }
  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9: what an Arabic phone's keyboard types into the search box and the
     code box. The server converts too; converting here as well means what is SENT is what is shown in the request. */
  function west(s) {
    return String(s).replace(/[٠-٩۰-۹]/g, function (c) { var n = c.charCodeAt(0); return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660) })
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')) }
  /* Server times, printed as the server wrote them (no timezone guessing): "8 Oct 2026" or "8 Oct 2026, 09:09". */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  function when(s, withTime) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''))
    if (!m) return s ? String(s) : ''
    var d = (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1]
    return withTime && m[4] ? d + ', ' + m[4] + ':' + m[5] : d
  }
  /* customers.phone is store_phone()'s canonical 965XXXXXXXX; printed the way it is read aloud. */
  function phone(p) { p = String(p || ''); var m = /^965(\d{4})(\d{4})$/.exec(p); return m ? '+965 ' + m[1] + ' ' + m[2] : p }
  function words(s) { s = String(s || '').replace(/_/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—' }
  /* The payment METHOD by its name rather than by its token: words('cod') printed "Cod" and words('knet') "Knet". The
     three are STORE_PAY_METHODS; anything else falls back to words(). */
  var METHOD = { cod: 'Cash on delivery', knet: 'KNET', tpay: 'T-Pay' }
  function method(m) { return METHOD[String(m || '').toLowerCase()] || words(m) }
  /* A name is the shopper's own text and may be Arabic; panel-content-scan.mjs (rightly) wants that marked. */
  function named(tag, cls, text) { var n = el(tag, cls, text); n.dir = /[֐-ࣿ]/.test(text || '') ? 'rtl' : 'auto'; return n }
  function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() }

  /* WHY each refusal happened, in the owner's words. An unknown token is shown as itself rather than as a guess. */
  var WHY = {
    not_signed_in: 'Your session has ended. Sign in again.',
    must_change_password: 'Choose a new password for your own account first.',
    too_many_attempts: 'Too many tries. Wait a few minutes and try again.',
    users_not_ready: 'The shop\'s database is not ready for this screen yet: scripts/publish/migrate-users.php has to run on the server first.',
    bad_password: 'That is not your password.',
    bad_code: 'That code is wrong or has expired. Use a new one.',
    bad_email: 'That is not an email address.',
    member_exists: 'That address is already on the team.',
    member_not_found: 'That team member no longer exists. The list has been refreshed.',
    cannot_lock_self: 'You cannot switch off your own account.',
    cannot_remove_self: 'You cannot remove your own account.',
    last_active_admin: 'That would leave nobody who can sign in. Switch another team member on first.',
    shopper_not_found: 'That account no longer exists.',
    email_mismatch: 'The email typed is not this account\'s.',
    not_enrolled: 'Your account does not use emailed codes.',
    too_soon: 'A code was sent less than a minute ago. Check your inbox.',
    network: 'The request did not reach the shop. Check the connection and try again.',
  }
  function why(e) { e = String(e || ''); return WHY[e] || e || 'Something went wrong.' }
  function say(note, t, kind) {
    note.textContent = t || ''
    note.classList.toggle('spus-good', !!t && kind === 'good')
    note.classList.toggle('spus-bad', !!t && kind === 'bad')
  }

  /* Colours: the panel's own tokens with their dark fallbacks, and for the status colours a darker shade on the LIGHT
     panel (panel-light.js) — the bright shades that read on a dark card are 1.2:1 to 2.8:1 on white. Each pair below is
     at least 4.5:1 on its own ground. */
  var CSS = ''
    + '.admin-content.spus-on>:not([' + MARK + ']){display:none!important}'
    + '[' + MARK + ']{color:var(--sp-pc-ink,#eaecee);min-width:0}'
    + '.spus-h1{margin:0 0 6px;font-size:22px;font-weight:800}'
    + '.spus-sub{margin:0 0 12px;font-size:14px;line-height:1.5;color:var(--sp-pc-muted,#a6adb5)}'
    + '.spus-tabs{display:flex;gap:4px;border-bottom:1px solid var(--sp-pc-border,#494e54);margin:4px 0 0}'
    + '.spus-tab{min-height:44px;padding:8px 16px;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;background:transparent;color:var(--sp-pc-muted,#a6adb5);font:inherit;font-size:15px;font-weight:600;cursor:pointer}'
    + '.spus-tab[aria-selected=true]{color:var(--sp-pc-ink,#eaecee);border-bottom-color:#4f46e5;font-weight:800}'
    + '.spus-sec{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent);min-width:0}'
    + '.spus-h2{margin:0 0 4px;font-size:18px;font-weight:800;overflow-wrap:anywhere}.spus-h3{margin:0 0 4px;font-size:16px;font-weight:700}'
    + '.spus-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 10px}'
    + '.spus-in{box-sizing:border-box;width:100%;padding:8px 12px;min-height:44px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit;font-size:15px}'
    + '.spus-search{flex:1 1 220px;width:auto;min-width:0}'
    + '.spus-seg{display:inline-flex;border:1px solid var(--sp-pc-field-border,#565c63);border-radius:8px;overflow:hidden}'
    + '.spus-seg button{min-height:44px;padding:8px 16px;border:0;background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit;font-size:14px;cursor:pointer}'
    + '.spus-seg button+button{border-inline-start:1px solid var(--sp-pc-field-border,#565c63)}'
    + '.spus-seg button[aria-pressed=true]{background:#4f46e5;color:#fff;font-weight:700}'
    + '.spus-total{margin:0 0 6px;font-size:14px;font-weight:600}'
    // `[MARK] .spus-row`, not `.spus-row`: under (pointer: coarse) admin-mobile.js gives `.admin-shell button`
    // display:inline-flex, centred, and (0,1,1) beat (0,1,0) — so on every phone and touch tablet a row's three lines
    // were laid side by side as squeezed columns, the email broken over three lines in 133px (review, 2026-10-14).
    // No headless check had seen it: a full-page screenshot drops the touch emulation for the rest of the page.
    + '[' + MARK + '] .spus-row{display:block;width:100%;box-sizing:border-box;text-align:start;padding:12px 8px;border:0;border-top:1px solid var(--sp-pc-border,#494e54);background:transparent;color:inherit;font:inherit;cursor:pointer;min-height:44px}'
    + '.spus-row:first-child{border-top:0}.spus-row:hover{background:rgba(79,70,229,.07)}'
    + '.spus-row:focus-visible,.spus-tab:focus-visible{outline:2px solid #4f46e5;outline-offset:-2px}'
    + '.spus-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-width:0}'
    + '.spus-email{font-weight:700;font-size:15px;overflow-wrap:anywhere;min-width:0}'
    + '.spus-meta{display:block;margin-top:3px;font-size:13px;line-height:1.5;color:var(--sp-pc-muted,#a6adb5);overflow-wrap:anywhere}'
    + '.spus-badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}'
    // The lock badge carries a date and ran 18px out of its card at 390px; it alone may wrap.
    + '.spus-b-wrap{white-space:normal;border-radius:10px;max-width:100%;box-sizing:border-box}'
    + '.spus-b-bad{background:rgba(220,38,38,.16);color:#fca5a5}.spus-b-ok{background:rgba(22,163,74,.16);color:#86efac}'
    + '.spus-b-warn{background:rgba(217,119,6,.18);color:#fcd34d}.spus-b-info{background:rgba(79,70,229,.2);color:#c7d2fe}'
    + '.spus-good{color:#4ade80}.spus-bad{color:#f87171}'
    + 'html[data-theme=light] .spus-b-bad,html[data-theme=light] .spus-bad{color:#b3261e}'
    + 'html[data-theme=light] .spus-b-ok,html[data-theme=light] .spus-good{color:#11703f}'
    + 'html[data-theme=light] .spus-b-warn{color:#8a5300}html[data-theme=light] .spus-b-info{color:#3730a3}'
    + '.spus-note{margin:8px 0 0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.spus-note:empty{display:none}'
    + '.spus-btn,.spus-btn2,.spus-danger{min-height:44px;padding:9px 16px;border-radius:8px;cursor:pointer;font:inherit;font-size:14px;font-weight:700}'
    + '.spus-btn{border:0;background:#4f46e5;color:#fff}.spus-danger{border:0;background:#b91c1c;color:#fff}'
    + '.spus-btn2{border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font-weight:600}'
    + '.spus-btn[disabled],.spus-btn2[disabled],.spus-danger[disabled]{opacity:.5;cursor:default}'
    + '.spus-back{margin-top:14px}'
    + '.spus-acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}'
    + '.spus-f{display:flex;flex-direction:column;gap:4px;margin:10px 0 0;max-width:420px}'
    + '.spus-l{font-size:14px;font-weight:600}'
    + '.spus-chk{display:flex;align-items:center;gap:10px;min-height:44px;margin-top:6px;font-size:14px;cursor:pointer}.spus-chk input{width:20px;height:20px;flex:none}'
    + '.spus-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;margin:12px 0 0;font-size:14px}'
    + '.spus-dl dt{color:var(--sp-pc-muted,#a6adb5)}.spus-dl dd{margin:0;overflow-wrap:anywhere;min-width:0}'
    + '.spus-item{padding:10px 0;border-top:1px solid var(--sp-pc-border,#494e54);font-size:14px}.spus-item:first-of-type{border-top:0}'
    + '.spus-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700}'
    + '.spus-member{padding:14px 0;border-top:1px solid var(--sp-pc-border,#494e54)}.spus-member:first-of-type{border-top:0;padding-top:4px}'
    + '.spus-auth{margin-top:12px;padding:12px;border-radius:12px;border:1px dashed var(--sp-pc-field-border,#565c63)}'
    + '.spus-temp{margin-top:14px;padding:14px;border-radius:12px;border:2px solid #4f46e5}'
    + '.spus-code{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;font-weight:800;letter-spacing:.06em;padding:6px 10px;border-radius:8px;background:var(--sp-pc-field-bg,#24272a);user-select:all;overflow-wrap:anywhere}'
    + '@media(max-width:640px){.spus-sec{padding:1rem}.spus-seg{width:100%}.spus-seg button{flex:1}.spus-dl{grid-template-columns:minmax(0,1fr);gap:2px}.spus-dl dd{margin-bottom:8px}}'
  function style() { if (document.getElementById('spus-css')) return; var s = el('style'); s.id = 'spus-css'; s.textContent = CSS; document.head.appendChild(s) }

  function badge(text, kind) { return el('span', 'spus-badge spus-b-' + kind, text) }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', function () { fn(b) }); return b }
  function note(role) { var n = el('p', 'spus-note'); n.setAttribute('role', role || 'status'); return n }
  function field(parent, label, input) {
    var w = el('div', 'spus-f'), l = el('label', 'spus-l', label)
    input.id = 'spus-' + Math.random().toString(36).slice(2); l.htmlFor = input.id
    w.appendChild(l); w.appendChild(input); parent.appendChild(w); return input
  }
  function live(u) { return open && ui === u }
  function scrollTop() { try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) } catch (e) { window.scrollTo(0, 0) } }

  /* ================================================================ the frame */
  var TABS = [['shoppers', 'Shoppers'], ['team', 'Team']]
  function savedTab() { try { var t = sessionStorage.getItem(TAB_KEY); return t === 'team' ? 'team' : 'shoppers' } catch (e) { return 'shoppers' } }

  function build() {
    var root = el('div'); root.setAttribute(MARK, '1')
    root.appendChild(el('h1', 'spus-h1', 'Users'))
    root.appendChild(el('p', 'spus-sub', 'Shopper accounts, and the team who can sign in to this panel.'))
    var list = el('div', 'spus-tabs'); attr(list, 'role', 'tablist'); attr(list, 'aria-label', 'Users')
    root.appendChild(list)
    // One sequence number PER STREAM (list, detail, team): an answer that is no longer that stream's latest is dropped,
    // and a Team load must never drop a Shoppers answer that is still on its way.
    var u = { root: root, tabs: {}, panes: {}, loaded: {}, q: '', filter: 'all', lastId: 0, me: null, listDirty: false,
      listSeq: 0, detailSeq: 0, teamSeq: 0 }
    TABS.forEach(function (t, i) {
      var b = btn(t[1], 'spus-tab', function () { showTab(t[0], true) })
      b.id = 'spus-tab-' + t[0]; attr(b, 'role', 'tab'); attr(b, 'data-spus-tab', t[0]); attr(b, 'aria-controls', 'spus-pane-' + t[0])
      // Arrow keys move between the two tabs, as a tab list does everywhere else.
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        var next = TABS[(i + 1) % TABS.length][0]; showTab(next, true); u.tabs[next].focus(); e.preventDefault()
      })
      list.appendChild(b); u.tabs[t[0]] = b
      var pane = el('div', 'spus-pane'); pane.id = 'spus-pane-' + t[0]
      attr(pane, 'role', 'tabpanel'); attr(pane, 'data-spus-pane', t[0]); attr(pane, 'aria-labelledby', b.id)
      root.appendChild(pane); u.panes[t[0]] = pane
    })
    ui = u
    shoppersFrame(u.panes.shoppers)
    teamFrame(u.panes.team)
    return root
  }

  function showTab(name, remember) {
    if (!ui) return
    TABS.forEach(function (t) {
      var on = t[0] === name
      attr(ui.tabs[t[0]], 'aria-selected', on ? 'true' : 'false'); ui.tabs[t[0]].tabIndex = on ? 0 : -1
      ui.panes[t[0]].hidden = !on
    })
    if (remember) { try { sessionStorage.setItem(TAB_KEY, name) } catch (e) {} }
    if (!ui.loaded[name]) { ui.loaded[name] = true; if (name === 'team') loadTeam(); else loadShoppers(true) }
  }

  /* ============================================================== Shoppers */
  function shoppersFrame(pane) {
    var view = el('section', 'spus-sec'); attr(view, 'data-spus-view', 'list'); pane.appendChild(view)
    var tools = el('div', 'spus-tools'); view.appendChild(tools)
    var q = el('input', 'spus-in spus-search'); q.type = 'search'; q.maxLength = 120; q.autocomplete = 'off'; q.spellcheck = false; q.dir = 'auto'
    q.placeholder = 'Search by email, name or phone'; attr(q, 'aria-label', 'Search shopper accounts'); attr(q, 'data-spus-search', '1')
    tools.appendChild(q)
    var seg = el('div', 'spus-seg'); attr(seg, 'role', 'group'); attr(seg, 'aria-label', 'Which accounts')
    var filters = {}
    ;[['all', 'All'], ['blocked', 'Blocked']].forEach(function (f) {
      var b = btn(f[1], null, function () {
        if (ui.filter === f[0]) return
        ui.filter = f[0]; Object.keys(filters).forEach(function (k) { attr(filters[k], 'aria-pressed', k === f[0] ? 'true' : 'false') })
        say(ui.flash, ''); loadShoppers(true)
      })
      attr(b, 'data-spus-filter', f[0]); attr(b, 'aria-pressed', f[0] === 'all' ? 'true' : 'false'); filters[f[0]] = b; seg.appendChild(b)
    })
    tools.appendChild(seg)
    ui.flash = note(); attr(ui.flash, 'data-spus-flash', '1'); view.appendChild(ui.flash)
    ui.total = el('p', 'spus-total'); attr(ui.total, 'data-spus-total', '1'); attr(ui.total, 'aria-live', 'polite'); view.appendChild(ui.total)
    ui.list = el('div'); attr(ui.list, 'data-spus-list', '1'); view.appendChild(ui.list)
    ui.more = btn('Show more', 'spus-btn2', function () { loadShoppers(false) }); attr(ui.more, 'data-spus-more', '1'); ui.more.hidden = true
    var foot = el('div', 'spus-acts'); foot.appendChild(ui.more); view.appendChild(foot)
    ui.moreNote = note('alert'); attr(ui.moreNote, 'data-spus-more-note', '1'); view.appendChild(ui.moreNote)
    ui.listView = view
    ui.detail = el('div'); attr(ui.detail, 'data-spus-detail', ''); ui.detail.hidden = true; pane.appendChild(ui.detail)

    // 300 ms after the last key — a request per keystroke is a request per letter of an email address. A THROTTLED
    // timer would search half-typed words; this one restarts, which is right for typing and only for typing.
    var t = null
    q.addEventListener('input', function () {
      clearTimeout(t)
      t = setTimeout(function () { if (!ui) return; var v = west(q.value).trim(); if (v === ui.q) return; ui.q = v; say(ui.flash, ''); loadShoppers(true) }, 300)
    })
  }

  /* "Show more" asks for the accounts BELOW the last one drawn (`before`), not for "page 2": the list is newest
     first, so one registration between two presses moved every offset and the last row came round again, and one
     deletion made a row vanish (review, 2026-10-14). The server says whether there is more, rather than this file
     working it out from a page count that was true when page 1 was read. */
  function loadShoppers(reset) {
    if (!ui) return
    var u = ui, my = ++u.listSeq
    if (reset) { u.list.textContent = ''; u.total.textContent = 'Loading…'; u.more.hidden = true; u.lastId = 0; say(u.moreNote, '') }
    else u.more.disabled = true
    call('shoppers&q=' + encodeURIComponent(u.q) + '&filter=' + u.filter + (reset ? '' : '&before=' + u.lastId)).then(function (r) {
      if (my !== u.listSeq || !live(u)) return
      u.more.disabled = false
      if (!r || r.error || !r.shoppers) {
        // A first page that failed has nothing to keep. A "Show more" that failed KEEPS every row already drawn and
        // the total, and says why beside the button, which stays for another try: it used to wipe the list and the
        // total and leave "Show more" under the error, and the retry then drew rows 51-100 with 1-50 gone.
        if (reset) { u.total.textContent = ''; u.list.textContent = ''; var n = note('alert'); say(n, why(r && r.error), 'bad'); u.list.appendChild(n) }
        else say(u.moreNote, why(r && r.error), 'bad')
        return
      }
      say(u.moreNote, '')
      u.listDirty = false
      var what = u.filter === 'blocked' ? plural(r.total, 'blocked account') : plural(r.total, 'account')
      u.total.textContent = what + (u.q ? (r.total === 1 ? ' matches "' : ' match "') + u.q + '"' : '')
      if (reset && !r.shoppers.length) u.list.appendChild(el('p', 'spus-sub', u.q || u.filter === 'blocked' ? 'No account matches.' : 'No shopper has an account yet.'))
      r.shoppers.forEach(function (s) { u.list.appendChild(shopperRow(s)) })
      if (r.shoppers.length) u.lastId = r.shoppers[r.shoppers.length - 1].id
      u.more.hidden = !(typeof r.more === 'boolean' ? r.more : r.page < r.pages)
    })
  }

  function shopperRow(s) {
    var b = el('button', 'spus-row'); b.type = 'button'; attr(b, 'data-spus-shopper', s.id)
    var top = el('span', 'spus-line'); top.appendChild(el('span', 'spus-email', s.email))
    if (s.blocked_at) top.appendChild(attr(badge('Blocked', 'bad'), 'data-spus-badge', 'blocked'))
    if (s.verified_at) top.appendChild(attr(badge('Email proved', 'ok'), 'data-spus-badge', 'verified'))
    if (s.passkeys) top.appendChild(attr(badge(plural(s.passkeys, 'passkey'), 'info'), 'data-spus-badge', 'passkeys'))
    b.appendChild(top)
    if (s.name || s.phone) {
      var who = el('span', 'spus-meta')
      if (s.name) who.appendChild(named('span', null, s.name))
      if (s.name && s.phone) who.appendChild(document.createTextNode(' · '))
      if (s.phone) who.appendChild(el('span', null, phone(s.phone)))
      b.appendChild(who)
    }
    b.appendChild(el('span', 'spus-meta', 'Joined ' + when(s.created_at) + ' · '
      + (s.last_signin_at ? 'last sign-in ' + when(s.last_signin_at, true) : 'no sign-in recorded') + ' · ' + plural(s.orders || 0, 'order')))
    b.addEventListener('click', function () { openDetail(s.id) })
    return b
  }

  /* ------------------------------------------------------- one shopper */
  function openDetail(id) {
    ui.listY = window.scrollY; ui.openedId = id
    ui.listView.hidden = true; ui.detail.hidden = false; attr(ui.detail, 'data-spus-detail', id)
    ui.detail.textContent = ''; ui.detail.appendChild(backButton()); ui.detail.appendChild(el('p', 'spus-sub', 'Loading…'))
    scrollTop(); loadDetail(id)
  }
  function backButton() {
    var b = btn('← All shoppers', 'spus-btn2 spus-back', backToList); attr(b, 'data-spus-back', '1'); return b
  }
  function backToList() {
    if (!ui) return
    ++ui.detailSeq
    ui.detail.hidden = true; ui.detail.textContent = ''; ui.listView.hidden = false
    if (ui.listDirty) { loadShoppers(true); scrollTop(); return }
    window.scrollTo({ top: ui.listY || 0, left: 0, behavior: 'instant' })
    var row = ui.list.querySelector('[data-spus-shopper="' + ui.openedId + '"]'); if (row) row.focus({ preventScroll: true })
  }
  function loadDetail(id, msg) {
    var u = ui, my = ++u.detailSeq
    call('shopper&id=' + encodeURIComponent(id)).then(function (r) {
      if (my !== u.detailSeq || !live(u) || u.detail.hidden) return
      renderDetail(r, msg)
    })
  }

  function renderDetail(r, msg) {
    var d = ui.detail; d.textContent = ''
    var back = backButton(); d.appendChild(back)
    if (!r || r.error || !r.shopper) { var n = note('alert'); say(n, why(r && r.error), 'bad'); d.appendChild(n); return }
    var s = r.shopper, orders = r.orders || [], keys = r.passkeys || [], pb = r.phone_block

    var head = el('section', 'spus-sec'); attr(head, 'data-spus-account', s.id); d.appendChild(head)
    if (msg) { var m = note(); attr(m, 'data-spus-detail-note', '1'); say(m, msg, 'good'); m.style.margin = '0 0 10px'; head.appendChild(m) }
    var h = el('h2', 'spus-h2', s.email); head.appendChild(h)
    var line = el('div', 'spus-line')
    line.appendChild(s.blocked_at ? badge('Blocked', 'bad') : badge('Active', 'ok'))
    if (s.verified_at) line.appendChild(badge('Email proved', 'ok'))
    head.appendChild(line)
    var dl = el('dl', 'spus-dl'); head.appendChild(dl)
    var fact = function (k, v, isName) { dl.appendChild(el('dt', null, k)); dl.appendChild(isName ? named('dd', null, v) : el('dd', null, v)) }
    fact('Name', s.name || '—', true)
    fact('Phone', s.phone ? phone(s.phone) : '—')
    fact('Joined', when(s.created_at, true))
    fact('Email proved', s.verified_at ? when(s.verified_at, true) : 'Not yet')
    fact('Last sign-in', s.last_signin_at ? when(s.last_signin_at, true) : 'None recorded')
    if (s.blocked_at) fact('Blocked', when(s.blocked_at, true) + (s.blocked_by ? ' by ' + s.blocked_by : '') + (s.blocked_reason ? ' — ' + s.blocked_reason : ''))
    if (s.signed_out_at) fact('Signed out everywhere', when(s.signed_out_at, true))

    // HOW THEY SIGN IN, in plain words. An account whose address was proved (an emailed code, Google) carries a RANDOM
    // password hash nobody knows — customer_verified_account() — so "has a password" is not the same as "can use one".
    var how = el('section', 'spus-sec'); attr(how, 'data-spus-signin', '1'); d.appendChild(how)
    how.appendChild(el('h3', 'spus-h3', 'Signing in'))
    var hl = el('dl', 'spus-dl'); how.appendChild(hl)
    hl.appendChild(el('dt', null, 'Password')); hl.appendChild(el('dd', null, s.password_usable ? 'Set at registration' : 'Not usable — signs in by emailed code, Google or passkey'))
    hl.appendChild(el('dt', null, 'Passkeys')); hl.appendChild(el('dd', null, String(keys.length)))
    keys.forEach(function (k) {
      var it = el('div', 'spus-item'); attr(it, 'data-spus-passkey', '1')
      it.appendChild(named('span', 'spus-l', k.label || 'Passkey'))
      it.appendChild(el('span', 'spus-meta', 'Added ' + when(k.created_at) + ' · ' + (k.last_used_at ? 'last used ' + when(k.last_used_at, true) : 'never used')))
      how.appendChild(it)
    })

    // ORDERS BY ACCOUNT ONLY (admin.php reads them by customer_id). A phone number is not a link between an account and
    // an order on this shop — registration proves no phone — so an order placed as a guest with the same number is not
    // this account's and is not shown here.
    var os = el('section', 'spus-sec'); attr(os, 'data-spus-orders', orders.length); d.appendChild(os)
    os.appendChild(el('h3', 'spus-h3', 'Orders (' + orders.length + (orders.length === 100 ? ', newest 100' : '') + ')'))
    if (!orders.length) os.appendChild(el('p', 'spus-sub', 'No order was placed while signed in to this account.'))
    orders.forEach(function (o) {
      var it = el('div', 'spus-item'); attr(it, 'data-spus-order', o.track_id)
      var l1 = el('div', 'spus-line'); l1.appendChild(el('span', 'spus-mono', o.track_id)); l1.appendChild(el('span', null, Number(o.amount || 0).toFixed(3) + ' KWD'))
      it.appendChild(l1)
      it.appendChild(el('span', 'spus-meta', words(o.payment_status) + ' (' + method(o.payment_method) + ') · ' + words(o.fulfilment_status) + ' · ' + when(o.created_at, true)))
      os.appendChild(it)
    })

    // THE PHONE'S block is the checkout's list (blocked_customers), keyed by number: it refuses ORDERS, guest or not,
    // where the account block refuses SIGN-INS. Shown apart because they are two different locks.
    if (s.phone) {
      var ps = el('section', 'spus-sec'); attr(ps, 'data-spus-phone', pb ? pb.scope : 'none'); d.appendChild(ps)
      ps.appendChild(el('h3', 'spus-h3', 'Phone number'))
      ps.appendChild(el('p', 'spus-sub', pb
        ? 'Orders from ' + phone(s.phone) + ' are refused (' + (pb.scope === 'cod' ? 'cash on delivery only' : 'every order') + ') since ' + when(pb.created_at) + (pb.reason ? ' — ' + pb.reason : '') + '.'
        : 'Orders from ' + phone(s.phone) + ' are not blocked.'))
    }

    if (s.blocked_at) unblockCard(d, s, pb); else blockCard(d, s)
    signoutCard(d, s, keys.length)
    deleteCard(d, s)
    back.focus({ preventScroll: true })
    // The answer to an action is printed at the TOP of the detail, and the button that asked is at the bottom: on a
    // phone that is three screens away, so the page went on showing the new card with the message out of sight.
    // Measured, not guessed — the note sat above the viewport at both 390 and 1280. Bring it into view when it is not.
    if (m) { var at = m.getBoundingClientRect(); if (at.top < 0 || at.bottom > window.innerHeight) scrollTop() }
  }

  function blockCard(d, s) {
    var u = ui, c = el('section', 'spus-sec'); attr(c, 'data-spus-act', 'block'); d.appendChild(c)
    c.appendChild(el('h3', 'spus-h3', 'Block this account'))
    c.appendChild(el('p', 'spus-sub', 'They can\'t sign in, and any signed-in browser is signed out.'))
    var reason = el('input', 'spus-in'); reason.type = 'text'; reason.maxLength = 200; reason.dir = 'auto'; attr(reason, 'data-spus-reason', '1')
    field(c, 'Reason (only the team sees it)', reason)
    var pt = null
    if (s.phone) {
      var l = el('label', 'spus-chk'); pt = el('input'); pt.type = 'checkbox'; attr(pt, 'data-spus-phone-too', '1')
      l.appendChild(pt); l.appendChild(document.createTextNode('Also refuse orders from its phone number ' + phone(s.phone))); c.appendChild(l)
    }
    var n = note(), acts = el('div', 'spus-acts'); c.appendChild(acts); c.appendChild(n)
    var go = btn('Block account', 'spus-danger', function () {
      go.disabled = true; say(n, 'Blocking…')
      call('shopper_block', { id: s.id, reason: reason.value, phone_too: !!(pt && pt.checked) }).then(function (r) {
        if (!live(u)) return
        go.disabled = false
        if (!r || r.error) { say(n, why(r && r.error), 'bad'); return }
        ui.listDirty = true
        loadDetail(s.id, 'Blocked. A browser signed in to it is signed out on its next page.' + (r.phone_blocked ? ' Orders from its phone number are refused too.' : ''))
      })
    })
    attr(go, 'data-spus-go', 'block'); acts.appendChild(go)
  }

  function unblockCard(d, s, pb) {
    var u = ui, c = el('section', 'spus-sec'); attr(c, 'data-spus-act', 'unblock'); d.appendChild(c)
    c.appendChild(el('h3', 'spus-h3', 'Unblock this account'))
    c.appendChild(el('p', 'spus-sub', 'They can sign in again with their password, an emailed code, Google or a passkey.'))
    var pt = null
    if (pb) {
      var l = el('label', 'spus-chk'); pt = el('input'); pt.type = 'checkbox'; attr(pt, 'data-spus-phone-too', '1')
      l.appendChild(pt); l.appendChild(document.createTextNode('Also lift the phone block')); c.appendChild(l)
    }
    var n = note(), acts = el('div', 'spus-acts'); c.appendChild(acts); c.appendChild(n)
    var go = btn('Unblock account', 'spus-btn', function () {
      go.disabled = true; say(n, 'Unblocking…')
      call('shopper_unblock', { id: s.id, phone_too: !!(pt && pt.checked) }).then(function (r) {
        if (!live(u)) return
        go.disabled = false
        if (!r || r.error) { say(n, why(r && r.error), 'bad'); return }
        ui.listDirty = true
        loadDetail(s.id, 'Unblocked. They can sign in again.' + (r.phone_unblocked ? ' The phone block is lifted too.' : ''))
      })
    })
    attr(go, 'data-spus-go', 'unblock'); acts.appendChild(go)
  }

  function signoutCard(d, s, keys) {
    var u = ui, c = el('section', 'spus-sec'); attr(c, 'data-spus-act', 'signout'); d.appendChild(c)
    c.appendChild(el('h3', 'spus-h3', 'Sign out everywhere'))
    c.appendChild(el('p', 'spus-sub', 'Ends every browser signed in to this account and removes its passkeys. They can sign in again afterwards — to keep them out, block the account.'))
    var n = note(), acts = el('div', 'spus-acts'); c.appendChild(acts); c.appendChild(n)
    var go = btn('Sign out everywhere', 'spus-btn2', function () {
      if (!window.confirm('Sign ' + s.email + ' out of every browser' + (keys ? ' and remove ' + plural(keys, 'passkey') : '') + '?')) return
      go.disabled = true; say(n, 'Signing out…')
      call('shopper_signout', { id: s.id }).then(function (r) {
        if (!live(u)) return
        go.disabled = false
        if (!r || r.error) { say(n, why(r && r.error), 'bad'); return }
        ui.listDirty = true
        loadDetail(s.id, 'Signed out of every browser. ' + plural(r.passkeys_removed || 0, 'passkey') + ' removed.')
      })
    })
    attr(go, 'data-spus-go', 'signout'); acts.appendChild(go)
  }

  /* DELETE needs the address TYPED BACK: the id alone is one wrong row away from deleting the wrong person, and this
     cannot be undone. The button stays off until the box matches; the server compares again (email_mismatch). */
  function deleteCard(d, s) {
    var u = ui, c = el('section', 'spus-sec'); attr(c, 'data-spus-act', 'delete'); d.appendChild(c)
    c.appendChild(el('h3', 'spus-h3', 'Delete account'))
    c.appendChild(el('p', 'spus-sub', 'Removes the account and its passkeys. Their orders are kept and unlinked from the account. The address can register again.'))
    var typed = el('input', 'spus-in'); typed.type = 'text'; typed.inputMode = 'email'; typed.autocomplete = 'off'; typed.spellcheck = false; typed.dir = 'ltr'
    attr(typed, 'data-spus-confirm-email', '1'); typed.placeholder = s.email
    field(c, 'Type the account\'s email to confirm', typed)
    var n = note(), acts = el('div', 'spus-acts'); c.appendChild(acts); c.appendChild(n)
    var go = btn('Delete account', 'spus-danger', function () {
      if (!same(typed.value, s.email)) return
      go.disabled = true; say(n, 'Deleting…')
      call('shopper_delete', { id: s.id, email: typed.value.trim() }).then(function (r) {
        if (!live(u)) return
        if (!r || r.error) { go.disabled = !same(typed.value, s.email); say(n, why(r && r.error), 'bad'); return }
        ui.listDirty = true
        say(ui.flash, 'Deleted ' + s.email + '. ' + (r.orders_unlinked ? plural(r.orders_unlinked, 'order') + ' kept, no longer linked to an account.' : 'It had no orders.'), 'good')
        backToList()
      })
    })
    attr(go, 'data-spus-go', 'delete'); go.disabled = true; acts.appendChild(go)
    typed.addEventListener('input', function () { go.disabled = !same(typed.value, s.email) })
  }

  /* ================================================================== Team */
  function teamFrame(pane) {
    var sec = el('section', 'spus-sec'); attr(sec, 'data-spus-team', '1'); pane.appendChild(sec)
    sec.appendChild(el('h2', 'spus-h2', 'Team'))
    sec.appendChild(el('p', 'spus-sub', 'Everyone here can sign in to this panel, with full access.'))
    ui.teamNote = note(); sec.appendChild(ui.teamNote)
    ui.teamList = el('div'); attr(ui.teamList, 'data-spus-members', '1'); sec.appendChild(ui.teamList)
    ui.teamList.appendChild(el('p', 'spus-sub', 'Loading…'))
    ui.addSec = el('section', 'spus-sec'); attr(ui.addSec, 'data-spus-add', '1'); ui.addSec.hidden = true; pane.appendChild(ui.addSec)
  }

  /* msg: what the last action did, said in the Team note above the list once it has been read again; kind 'bad' for a
     refusal whose row the reload removes (member_not_found), so the reason is not drawn into a form about to vanish. */
  function loadTeam(msg, kind) {
    var u = ui, my = ++u.teamSeq
    call('team').then(function (r) {
      if (my !== u.teamSeq || !live(u)) return
      u.teamList.textContent = ''
      if (!r || r.error || !r.team) { say(u.teamNote, why(r && r.error), 'bad'); return }
      say(u.teamNote, msg || '', kind || 'good')
      if (msg && kind === 'bad') { var at = u.teamNote.getBoundingClientRect(); if (at.top < 0 || at.bottom > window.innerHeight) u.teamNote.scrollIntoView({ block: 'center' }) }
      u.me = r.team.filter(function (m) { return m.you })[0] || null
      r.team.forEach(function (m) { u.teamList.appendChild(memberRow(m)) })
      if (!u.addBuilt) { u.addBuilt = true; addForm(u.addSec) }
      u.addSec.hidden = false
    })
  }

  var FACTOR = { app: 'Authenticator app', email: 'Emailed code' }
  function memberRow(m) {
    var row = el('div', 'spus-member'); attr(row, 'data-spus-member', m.id)
    var top = el('div', 'spus-line'); row.appendChild(top)
    top.appendChild(el('span', 'spus-email', m.email))
    if (m.you) top.appendChild(attr(badge('You', 'info'), 'data-spus-badge', 'you'))
    if (m.disabled_at) top.appendChild(attr(badge('Switched off', 'bad'), 'data-spus-badge', 'off'))
    if (m.locked_until) top.appendChild(attr(badge('Locked (too many attempts, until ' + when(m.locked_until, true) + ')', 'warn spus-b-wrap'), 'data-spus-badge', 'locked'))
    row.appendChild(el('span', 'spus-meta', 'Second factor: ' + (FACTOR[m.two_factor] || 'None') + ' · ' + plural(m.passkeys || 0, 'passkey')
      + ' · ' + plural(m.sessions || 0, 'signed-in browser')))
    row.appendChild(el('span', 'spus-meta', (m.last_login_at ? 'Last sign-in ' + when(m.last_login_at, true) : 'Has not signed in yet')
      + ' · added ' + when(m.created_at) + (m.added_by ? ' by ' + m.added_by : '')))
    // Your own row has no switch-off and no remove: the server refuses both (cannot_lock_self, cannot_remove_self), and
    // a button that can only ever be refused is not a control.
    if (m.you) return row
    var u = ui, acts = el('div', 'spus-acts'); row.appendChild(acts)
    var slot = el('div'); row.appendChild(slot)
    var ask = function (kind) {
      slot.textContent = ''
      var spec = {
        lock: ['Switch off ' + m.email + '? They are signed out of every browser at once and cannot sign in until switched back on. Their passkeys are kept.', 'Switch off', 'spus-danger', 'team_lock'],
        unlock: ['Switch ' + m.email + ' back on? They can sign in again, and any too-many-attempts lock is cleared.', 'Switch on', 'spus-btn', 'team_unlock'],
        remove: ['Remove ' + m.email + ' from the team? Their account, passkeys and signed-in browsers go. What they did stays in the Activity log.', 'Remove from team', 'spus-danger', 'team_remove'],
      }[kind]
      var a = authForm({ explain: spec[0], go: spec[1], cls: spec[2], cancel: function () { slot.textContent = '' },
        confirm: kind === 'remove' ? 'Remove ' + m.email + ' from the team? This cannot be undone.' : null,
        send: function (creds, done) {
        call(spec[3], { id: m.id, password: creds.password, code: creds.code }).then(function (r) {
          if (!live(u)) return
          if (!r || r.error) {
            done(why(r && r.error))
            // The member is gone: the reload drops their row, and with it this form and the message written into it
            // a moment ago — the owner saw the colleague disappear with no reason given (review, 2026-10-14). So the
            // reason is said in the Team note instead, which the reload keeps.
            if (r && r.error === 'member_not_found') loadTeam(why('member_not_found'), 'bad')
            return
          }
          done()
          loadTeam(kind === 'lock' ? 'Switched off ' + m.email + '. ' + plural(r.sessions_ended || 0, 'browser') + ' signed out.'
            : kind === 'unlock' ? 'Switched ' + m.email + ' back on.' : 'Removed ' + m.email + ' from the team.')
        })
      } })
      attr(a, 'data-spus-auth', kind); slot.appendChild(a)
      var pw = a.querySelector('[data-spus-pw]'); if (pw) pw.focus()
    }
    var toggle = m.disabled_at ? btn('Switch on', 'spus-btn2', function () { ask('unlock') }) : btn('Switch off', 'spus-btn2', function () { ask('lock') })
    attr(toggle, 'data-spus-action', m.disabled_at ? 'unlock' : 'lock'); acts.appendChild(toggle)
    var rm = btn('Remove', 'spus-btn2', function () { ask('remove') }); attr(rm, 'data-spus-action', 'remove'); acts.appendChild(rm)
    return row
  }

  /* YOUR password and, when your account has one, your code — users_reauth() on the server. The form is a real <form>
     (Enter sends it) carrying your own address in a hidden username field, so a password manager fills YOUR password
     rather than guessing which account this is. Only the code box appears for an account with a second factor, and
     "Email me a code" only for emailed codes (otp_send mails your own address and nobody else's).
     o = { explain, go (label), cls, confirm (a question asked before sending, or null), send(creds, done), cancel } */
  function authForm(o) {
    var f = el('form', 'spus-auth'); f.noValidate = true
    if (o.explain) f.appendChild(el('p', 'spus-sub', o.explain))
    var me = ui && ui.me
    var user = el('input'); user.type = 'text'; user.autocomplete = 'username'; user.value = me ? me.email : ''; user.hidden = true; user.tabIndex = -1; user.readOnly = true
    attr(user, 'aria-hidden', 'true'); f.appendChild(user)
    var pw = el('input', 'spus-in'); pw.type = 'password'; pw.autocomplete = 'current-password'; attr(pw, 'data-spus-pw', '1')
    field(f, 'Your password', pw)
    var tf = me && me.two_factor, code = null
    if (tf) {
      code = el('input', 'spus-in'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 10; code.dir = 'ltr'
      attr(code, 'data-spus-code', '1')
      field(f, tf === 'app' ? 'Your code from the authenticator app' : 'Your code from the email we send you', code)
    }
    var n = note(), acts = el('div', 'spus-acts')
    if (tf === 'email') {
      var send = btn('Email me a code', 'spus-btn2', function () {
        send.disabled = true; say(n, 'Sending…')
        call('otp_send', {}).then(function (r) {
          send.disabled = false
          if (!r || r.error) { say(n, why(r && r.error), 'bad'); return }
          say(n, r.sent ? 'A code was sent to ' + (r.to || 'your address') + '.' : 'The code could not be sent: the shop\'s mail is not working.', r.sent ? 'good' : 'bad')
          if (code) code.focus()
        })
      })
      attr(send, 'data-spus-sendcode', '1'); acts.appendChild(send)
    }
    var go = el('button', o.cls, o.go); go.type = 'submit'; attr(go, 'data-spus-go', '1'); acts.appendChild(go)
    if (o.cancel) { var cancel = btn('Cancel', 'spus-btn2', o.cancel); attr(cancel, 'data-spus-cancel', '1'); acts.appendChild(cancel) }
    f.appendChild(acts); f.appendChild(n)
    f.addEventListener('submit', function (e) {
      e.preventDefault()
      if (go.disabled) return
      if (!pw.value) { say(n, 'Type your password first.', 'bad'); pw.focus(); return }
      if (o.confirm && !window.confirm(o.confirm)) return
      go.disabled = true; say(n, 'Checking…')
      // done(error?): a refusal stays on screen with everything typed; success empties the secrets.
      o.send({ password: pw.value, code: code ? west(code.value).trim() : '' }, function (err) {
        go.disabled = false
        if (err) { say(n, err, 'bad'); return }
        say(n, '')
        pw.value = ''; if (code) code.value = ''
      })
    })
    f.spusPw = pw
    return f
  }

  function addForm(sec) {
    sec.appendChild(el('h2', 'spus-h2', 'Add a team member'))
    sec.appendChild(el('p', 'spus-sub', 'They get a temporary password, shown here once, and full access to the panel.'))
    var email = el('input', 'spus-in'); email.type = 'email'; email.autocomplete = 'off'; email.spellcheck = false; email.maxLength = 120; email.dir = 'ltr'
    attr(email, 'data-spus-add-email', '1')
    field(sec, 'Their email address', email)
    var u = ui, tempBox = el('div'); sec.appendChild(tempBox)
    var form = authForm({ go: 'Add member', cls: 'spus-btn', send: function (creds, done) {
      var addr = email.value.trim()
      if (!addr) { done('Type their email address first.'); email.focus(); return }
      call('team_add', { email: addr, password: creds.password, code: creds.code }).then(function (r) {
        if (!live(u)) return
        if (!r || r.error || !r.temp_password) { done(why(r && r.error)); return }
        done(); email.value = ''
        showTemp(tempBox, r.member ? r.member.email : addr, r.temp_password)
        loadTeam('Added ' + (r.member ? r.member.email : addr) + '.')
      })
    } })
    attr(form, 'data-spus-auth', 'add')
    sec.insertBefore(form, tempBox)
    // Enter in the address moves on to your password instead of sending a form with no password in it.
    email.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); form.spusPw.focus() } })
  }

  /* THE TEMPORARY PASSWORD, ONCE. It is in this one response and nowhere else — not the audit log, not the list — and
     store_require_admin() makes them replace it at their first sign-in, so nobody but them knows the one they use. */
  function showTemp(box, who, temp) {
    box.textContent = ''
    var t = el('div', 'spus-temp'); attr(t, 'data-spus-temp', '1'); box.appendChild(t)
    t.appendChild(el('p', 'spus-l', 'Temporary password for ' + who))
    var code = el('span', 'spus-code', temp); attr(code, 'data-spus-temp-value', '1'); t.appendChild(code)
    t.appendChild(el('p', 'spus-sub', 'Give this to them privately. They choose their own password the first time they sign in.'))
    var n = note(), acts = el('div', 'spus-acts'); t.appendChild(acts); t.appendChild(n)
    var copy = btn('Copy', 'spus-btn', function () {
      var hand = function () {
        try { var range = document.createRange(); range.selectNodeContents(code); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(range) } catch (e) {}
        say(n, 'Copying is blocked here: it is selected, copy it by hand.', 'bad')
      }
      try { navigator.clipboard.writeText(temp).then(function () { say(n, 'Copied.', 'good') }, hand) } catch (e) { hand() }
    })
    attr(copy, 'data-spus-copy', '1'); acts.appendChild(copy)
    var done = btn('Done', 'spus-btn2', function () { box.textContent = '' }); attr(done, 'data-spus-temp-done', '1'); acts.appendChild(done)
  }

  /* ===================================================== nav + open (seo-screen.js's pattern) */
  function isNav(b) { return b.closest('.admin-sidebar') || b.classList.contains('m-tabbar__item') }
  function setMine(b, on) {
    if (b.classList.contains('m-tabbar__item')) attr(b, 'aria-current', on ? 'true' : 'false')
    // hover:bg-slate-50 goes while lit, as the bundle's own lit button has none: kept, the lit Users button turned grey
    // under the pointer where every other lit button stays indigo.
    else { b.classList.toggle('bg-indigo-50', on); b.classList.toggle('text-indigo-600', on); b.classList.toggle('text-slate-600', !on); b.classList.toggle('hover:bg-slate-50', !on) }
  }
  function setCurrent(mine) {
    if (mine) {
      saved = []
      document.querySelectorAll('.admin-sidebar button, .m-tabbar__item').forEach(function (b) {
        if (b.hasAttribute(NAV)) return
        saved.push([b, b.getAttribute('aria-current'), b.className])
        if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', 'false')
        else b.className = b.className.replace(ACTIVE, INACTIVE)
      })
    } else {
      saved.forEach(function (x) { if (x[0].isConnected) { if (x[1] === null) x[0].removeAttribute('aria-current'); else x[0].setAttribute('aria-current', x[1]); x[0].className = x[2] } })
      saved = []
    }
    document.querySelectorAll('[' + NAV + ']').forEach(function (b) { setMine(b, mine) })
  }
  /* The phone header names the bundle's screen; while this one is open it says "Users". Its text node is React's, so it
     is changed by VALUE (React writes that same node's value on its next change) and given back only if nothing else
     has written it since. */
  function setTitle(mine) {
    if (mine) {
      var t = document.querySelector('.m-header__title')
      if (!t || t.childNodes.length !== 1 || t.firstChild.nodeType !== 3) return
      title = [t.firstChild, t.firstChild.nodeValue]
      t.firstChild.nodeValue = 'Users'
    } else if (title) {
      if (title[0].isConnected && title[0].nodeValue === 'Users') title[0].nodeValue = title[1]
      title = null
    }
  }
  function otherOpen() {
    var h = document.querySelector('.admin-content')
    return !!h && [].some.call(h.classList, function (c) { return /^sp[a-z]+-on$/.test(c) && c !== 'spus-on' })
  }
  function openScreen() {
    var host = document.querySelector('.admin-content'); if (!host) return
    // A second press of Users while a new colleague's TEMPORARY PASSWORD is on screen keeps the screen as it is.
    // Rebuilding it threw that password away, and it is shown once and never again — the only way back was Remove and
    // Add again (review, 2026-10-14). Done, or leaving for another screen, still clears it, as it must.
    if (open && ui && screen && screen.isConnected && screen.querySelector('[data-spus-temp]')) return
    style()
    if (!open) { setCurrent(true); setTitle(true) }      // a second press of Users must not snapshot its own state
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    screen = build()
    host.insertBefore(screen, host.firstChild)
    host.classList.add('spus-on'); open = true
    showTab(savedTab(), false)
    scrollTop()
  }
  function closeScreen() {
    if (!open) return
    open = false; ui = null
    var host = document.querySelector('.admin-content'); if (host) host.classList.remove('spus-on')
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    screen = null
    setCurrent(false); setTitle(false)
  }

  /* The "users" icon (Lucide's, the set the bundle's own icons come from), so the button is not a fourth padlock: the
     clone of Settings that Payments, SEO and Setup all wear. Drawn as SVG nodes, never markup. */
  var ICON = [['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }], ['circle', { cx: '9', cy: '7', r: '4' }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }], ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]]
  function icon(svg) {
    if (!svg) return
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor')
    ICON.forEach(function (p) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', p[0])
      Object.keys(p[1]).forEach(function (k) { n.setAttribute(k, p[1][k]) })
      svg.appendChild(n)
    })
  }
  function ownNav(b) { return b.hasAttribute(NAV) || OTHER_NAVS.some(function (a) { return b.hasAttribute(a) }) }
  function lastOwn(scope, ref) {
    return scope.querySelector('[data-spsetup-nav]') || scope.querySelector('[data-spseo-nav]') || scope.querySelector('[data-spps-nav]') || ref
  }
  /* Written only when something is MISSING: a write here re-arms every MutationObserver on the page, and an
     unconditional one is the loop that froze scrolling in Chrome (CLAUDE.md, 2026-10-02/03). */
  function addNav() {
    if (!document.querySelector('.admin-content')) { if (open) { open = false; saved = []; title = null; ui = null; screen = null } return }
    var side = document.querySelector('.admin-sidebar')
    if (side && !side.querySelector('[' + NAV + ']')) {
      var ref = null
      side.querySelectorAll('button').forEach(function (b) { if (!ownNav(b) && /^\s*Settings\s*$/.test(b.textContent)) ref = b })
      if (ref) {
        var b = ref.cloneNode(true)
        OTHER_NAVS.forEach(function (a) { b.removeAttribute(a) }); b.setAttribute(NAV, '1')
        b.className = ref.className.replace(ACTIVE, INACTIVE)
        b.querySelectorAll('*').forEach(function (n) { n.childNodes.forEach(function (c) { if (c.nodeType === 3 && /Settings/.test(c.textContent)) c.textContent = 'Users' }) })
        icon(b.querySelector('svg'))
        var after = lastOwn(side, ref); after.parentNode.insertBefore(b, after.nextSibling)
        if (open) setMine(b, true)
      }
    }
    var bar = document.querySelector('.m-tabbar')
    if (bar && !bar.querySelector('[' + NAV + ']')) {
      var tref = null
      bar.querySelectorAll('.m-tabbar__item').forEach(function (b) { if (!ownNav(b) && /^\s*Settings\s*$/.test(b.textContent)) tref = b })
      if (tref) {
        var t = tref.cloneNode(true)
        OTHER_NAVS.forEach(function (a) { t.removeAttribute(a) }); t.setAttribute(NAV, '1'); t.setAttribute('aria-current', 'false')
        t.childNodes.forEach(function (c) { if (c.nodeType === 3) c.textContent = 'Users' })
        icon(t.querySelector('svg'))
        var tafter = lastOwn(bar, tref); tafter.parentNode.insertBefore(t, tafter.nextSibling)
        if (open) setMine(t, true)
      }
    }
  }

  // CLOSE on window, capture phase: first of all listeners, so the nav is restored before another own screen takes
  // its snapshot (see the header). Nothing is stopped here: the click goes on to that screen, or to React.
  window.addEventListener('click', function (e) {
    if (!open) return
    var b = e.target && e.target.closest && e.target.closest('button')
    if (!b || b.hasAttribute(NAV) || b.hasAttribute('data-sppl-switch')) return
    if (isNav(b)) closeScreen()
  }, true)
  // OPEN on document, capture phase, and stop there so React never sees a click on a button it did not draw.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button')
    if (!b || !b.hasAttribute(NAV)) return
    e.preventDefault(); e.stopPropagation()
    // Another own screen still open means its own listener has not run yet for this click: open once it has.
    if (otherOpen()) setTimeout(openScreen, 0); else openScreen()
  }, true)

  // A THROTTLE, not a restarting debounce: a timer that restarts on every mutation never fires on a busy screen.
  var t = null
  new MutationObserver(function () {
    if (t) return
    t = setTimeout(function () {
      t = null
      addNav()
      if (open && screen && !screen.isConnected) {
        var h = document.querySelector('.admin-content')
        if (h) { h.insertBefore(screen, h.firstChild); h.classList.add('spus-on') }
      }
    }, 150)
  }).observe(document.body, { childList: true, subtree: true })
  addNav()
})()
