// A stand-in for what the compiled admin's React does to the captured shell (scripts/fixtures/sizes-admin/orders.html), just enough
// to test an add-on that lives beside it. It follows the compiled AdminApp code (read from the captured chunk, ne() in AdminApp-*.js):
//
//   - the tab list is fixed; a click on a nav button calls U(id): a click on the tab already shown returns at once, otherwise
//     the previous scroll is saved, ?tab=<id> is pushed (Overview deletes it), the state moves, the menu closes;
//   - each tab is <section class="admin-page" hidden={tab !== id}> inside <main>, mounted the first time it is visited and kept;
//   - React writes a DOM property only when the value it computed CHANGED (className, aria-current, hidden, the header's text
//     node): that is what this shim does too, so a node the add-on touched is not "repaired" behind its back, exactly as in React;
//   - popstate re-reads ?tab= (an unknown value is Overview);
//   - the phone's menu (.m-menu-layer > nav.m-menu-panel > .m-menu-grid > .m-menu-item buttons) exists only while open;
//   - fx.rerenderNav() replaces the sidebar's buttons wholesale (a re-mount of that list), fx.signOut() / fx.signIn() replace the
//     whole shell (the login screen in between).
// The captured markup has only two sections (Overview hidden, Orders shown); the others get a bare heading when first visited.
export const SHIM_JS = String.raw`
(function () {
  var TABS = ['Overview', 'Orders', 'Returns', 'CRM', 'Support', 'Profiles', 'Catalogue', 'Brands', 'Slides', 'Topbar', 'Promotions', 'Discounts', 'Inventory', 'Payments', 'Checkout', 'Theme', 'SEO', 'Activity', 'Settings']
  var ID = {}
  TABS.forEach(function (t) { ID[t] = t === 'Catalogue' ? 'catalog' : t === 'Inventory' ? 'stock' : t === 'Promotions' ? 'promos' : t.toLowerCase() })
  var LABEL = {}
  Object.keys(ID).forEach(function (k) { LABEL[ID[k]] = k })
  var BASE = 'admin-nav-item rounded-lg px-3 py-2 text-start text-sm font-semibold'
  var ON = ' bg-indigo-50 text-indigo-600', OFF = ' text-slate-600 hover:bg-slate-50'
  var pristine = null, cur = 'Orders', menuOpen = false, sections = {}, strongText = null, root = null, shell = null
  var scrolls = {}

  function tabFromUrl() { var t = new URLSearchParams(location.search).get('tab'); return LABEL[t] || 'Overview' }
  function labelOf(btn) {
    if (btn.getAttribute('aria-label')) return btn.getAttribute('aria-label')
    var spans = btn.querySelectorAll('span'), out = ''
    for (var i = 0; i < spans.length; i++) { var t = (spans[i].textContent || '').trim(); if (t) out = t }
    return out || (btn.textContent || '').trim()
  }
  function paintButton(btn, on) {
    // a property is written only when React's computed value changed
    if (btn.__on === on) return
    btn.__on = on
    if (btn.classList.contains('admin-nav-item')) btn.className = BASE + (on ? ON : OFF)
    if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current')
  }
  function paintAll() {
    shell.querySelectorAll('.admin-sidebar .admin-nav-item, .m-tabbar__item[aria-label], .m-menu-item').forEach(function (b) {
      if (b.hasAttribute('data-sporta-ab-nav')) return           // not React's
      paintButton(b, (b.getAttribute('aria-label') || labelOf(b)) === cur || (b.classList.contains('m-tabbar__item') && b.querySelector('.m-tabbar__icon') && b.getAttribute('aria-label') === cur))
    })
    var main = shell.querySelector('main.admin-content')
    if (!sections[cur]) {
      var s = document.createElement('section'); s.className = 'admin-page'; s.hidden = true
      s.innerHTML = '<div class="admin-page-layout space-y-5"><header class="admin-page-header"><div><h1 class="text-2xl font-bold text-slate-800">' + cur + '</h1></div></header></div>'
      main.appendChild(s); sections[cur] = s
    }
    Object.keys(sections).forEach(function (k) { var want = k !== cur; if (sections[k].hidden !== want) sections[k].hidden = want })
    if (strongText && strongText.data !== cur) strongText.data = cur
    var more = shell.querySelector('.m-tabbar__item[aria-haspopup]')
    if (more) more.setAttribute('aria-expanded', menuOpen ? 'true' : 'false')
    var hm = shell.querySelector('.m-header__menu')
    if (hm) hm.setAttribute('aria-expanded', menuOpen ? 'true' : 'false')
  }
  function go(label) {
    if (label === cur) { closeMenu(); return }
    scrolls[cur] = window.scrollY
    var u = new URL(location.href)
    if (label === 'Overview') u.searchParams.delete('tab'); else u.searchParams.set('tab', ID[label])
    history.pushState({ adminTab: ID[label] }, '', u)
    cur = label
    window.fx.navs.push(label)
    closeMenu(true)
    paintAll()
  }
  function closeMenu(skipPaint) {
    if (!menuOpen) return
    menuOpen = false
    var layer = shell.querySelector('.m-menu-layer'); if (layer) layer.remove()
    if (!skipPaint) paintAll()
  }
  function openMenu() {
    if (menuOpen) { closeMenu(); return }
    menuOpen = true
    var layer = document.createElement('div'); layer.className = 'm-menu-layer'; layer.setAttribute('role', 'presentation')
    var items = TABS.map(function (t) { return '<button type="button" class="m-menu-item"><span class="m-menu-item__icon"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/></svg></span><span>' + t + '</span></button>' }).join('')
    layer.innerHTML = '<nav id="mobile-admin-menu" class="m-menu-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-admin-menu-title"><div class="m-menu-panel__head"><p id="mobile-admin-menu-title" class="text-sm font-extrabold text-slate-900">Sporta Backends</p><button type="button" class="m-menu-close" aria-label="Close menu">×</button></div><div class="m-menu-grid">' + items + '</div><button type="button" class="m-menu-signout">Sign out</button></nav>'
    layer.addEventListener('click', function () { closeMenu() })
    layer.querySelector('nav').addEventListener('click', function (e) { e.stopPropagation() })
    layer.querySelector('.m-menu-close').addEventListener('click', function () { closeMenu() })
    layer.querySelector('.m-menu-signout').addEventListener('click', function () { window.fx.signOut() })
    layer.querySelectorAll('.m-menu-item').forEach(function (b) { b.addEventListener('click', function () { go(labelOf(b)) }) })
    var main = shell.querySelector('main.admin-content')
    main.parentNode.insertBefore(layer, main)
    paintAll()
  }
  function wire() {
    shell.querySelectorAll('.admin-sidebar .admin-nav-item').forEach(function (b) {
      if (b.__wired) return; b.__wired = true
      b.addEventListener('click', function () { go(labelOf(b)) })
    })
    shell.querySelectorAll('.m-tabbar__item').forEach(function (b) {
      if (b.__wired) return; b.__wired = true
      b.addEventListener('click', function () { if (b.hasAttribute('aria-haspopup')) openMenu(); else go(b.getAttribute('aria-label')) })
    })
    var hm = shell.querySelector('.m-header__menu')
    if (hm && !hm.__wired) { hm.__wired = true; hm.addEventListener('click', openMenu) }
    var so = shell.querySelector('.admin-sidebar__footer button')
    if (so && !so.__wired) { so.__wired = true; so.addEventListener('click', function () { window.fx.signOut() }) }
  }
  function mount() {
    root = document.getElementById('root')
    shell = root.querySelector('.admin-shell')
    sections = {}
    var secs = shell.querySelectorAll('main.admin-content > section.admin-page')
    // the capture holds Overview (hidden) then Orders
    if (secs[0]) sections.Overview = secs[0]
    if (secs[1]) sections.Orders = secs[1]
    var strong = shell.querySelector('.m-header__title strong')
    strongText = strong ? strong.firstChild : null
    shell.querySelectorAll('.admin-sidebar .admin-nav-item, .m-tabbar__item[aria-label]').forEach(function (b) { b.__on = (b.getAttribute('aria-current') === 'page') })
    wire()
  }
  window.addEventListener('popstate', function () {
    if (!shell || !shell.isConnected) return
    var t = tabFromUrl()
    if (t !== cur) { cur = t; window.fx.navs.push('pop:' + t); paintAll() }
  })
  window.fx = {
    navs: [],
    state: function () { return { cur: cur, menuOpen: menuOpen } },
    go: go,
    strongTextNode: function () { return strongText },
    // React replaces its own buttons with new nodes (in place); with all=true the whole <nav> is rebuilt, add-on nodes included
    rerenderNav: function (all) {
      var nav = shell.querySelector('nav.admin-sidebar__nav')
      Array.prototype.slice.call(nav.querySelectorAll('.admin-nav-item')).forEach(function (b) {
        if (b.hasAttribute('data-sporta-ab-nav')) { if (all) b.remove(); return }
        var c = b.cloneNode(true); c.__wired = false; c.__on = null; b.replaceWith(c)
      })
      wire(); paintAll()
    },
    signOut: function () {
      pristine = pristine || null
      root.innerHTML = '<div class="admin-login"><h1>Sign in</h1><p>Sporta Operations</p></div>'
      shell = null; menuOpen = false
    },
    signIn: function () {
      root.innerHTML = window.__PRISTINE
      cur = 'Orders'; menuOpen = false
      mount(); paintAll()
    }
  }
  window.__PRISTINE = document.getElementById('root').innerHTML
  mount()
})()
`

// What the admin's own stylesheets add for the phone menu (not in the capture; stand-in only, enough to be clickable).
export const SHIM_CSS = `
.m-menu-layer{position:fixed;inset:0;z-index:60;background:rgba(15,23,42,.45)}
.m-menu-panel{position:absolute;inset:auto 0 0 0;max-height:85vh;overflow:auto;background:#fff;color:#18212a;padding:12px 16px 20px;border-radius:16px 16px 0 0}
.m-menu-panel__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.m-menu-close{min-height:44px;min-width:44px;font-size:24px;background:none;border:0}
.m-menu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.m-menu-item{display:flex;flex-direction:column;align-items:center;gap:4px;min-height:64px;padding:8px 4px;border:1px solid #d9dfe5;border-radius:12px;background:#fff;color:#18212a;font-size:12px;font-weight:600;text-align:center}
.m-menu-item[aria-current="page"]{border-color:#9a452c;color:#9a452c}
.m-menu-signout{margin-top:12px;min-height:44px;width:100%;border:1px solid #d9dfe5;border-radius:12px;background:#fff}
.admin-login{padding:48px 16px;text-align:center}
`
