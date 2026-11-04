/* Sporta first-paint setup. This is an external script so the production CSP
 * can block inline JavaScript completely. Keep this file dependency-free: it
 * runs before the application bundle is available. */
;(function () {
  'use strict'

  // The private backend is an installable app on this same origin. Select its
  // manifest before the React bundle loads so its home-screen icon is correct.
  if (/^\/backends(?:\/|$)/.test(window.location.pathname)) {
    var manifest = document.getElementById('sporta-webmanifest')
    if (manifest) manifest.href = '/backends.webmanifest'
    var appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appTitle) appTitle.content = 'Sporta Admin'
    var robots = document.querySelector('meta[name="robots"]')
    if (robots) robots.content = 'noindex, nofollow, noarchive'
    var canonical = document.querySelector('link[rel="canonical"]')
    if (canonical) canonical.remove()
  }

  // Set language, theme and hero geometry before the first paint. All values
  // come from controlled local settings or a narrowly parsed query parameter.
  try {
    var root = document.documentElement
    var saved = localStorage.getItem('lang')
    var lang = saved === 'ar' || saved === 'en' ? saved : null
    if (!lang) {
      var match = /[?&]lang=([A-Za-z-]{2,10})/.exec(location.search)
      if (match) {
        var tag = match[1].toLowerCase().split('-')[0]
        if (tag === 'ar' || tag === 'en') lang = tag
      }
    }
    if (!lang) lang = 'ar'
    var ar = lang === 'ar'
    window.__SPORTA_LANG = ar ? 'ar' : 'en'
    root.lang = window.__SPORTA_LANG
    root.dir = ar ? 'rtl' : 'ltr'

    var theme = localStorage.getItem('sporta_theme')
    var osDark = matchMedia('(prefers-color-scheme: dark)').matches
    var backend = /^\/backends(?:\/|$)/.test(location.pathname)
    var explicitTheme = localStorage.getItem('sporta_theme_explicit') === '1'
    if (theme !== 'dark' && theme !== 'light') theme = backend && osDark ? 'dark' : 'light'
    else if (!backend && theme === 'dark' && osDark && !explicitTheme) theme = 'light'
    root.dataset.theme = theme
    root.style.colorScheme = theme

    var heroSizes = { short: ['400px', '460px'], tall: ['540px', '640px'], full: ['85svh', '90svh'] }
    var hero = heroSizes[localStorage.getItem('sporta_hero_size')] || heroSizes.tall
    root.style.setProperty('--hero-h', hero[0])
    root.style.setProperty('--hero-h-md', hero[1])

    if (location.pathname === '/' || location.pathname === '/index.html') {
      var device = matchMedia('(min-width: 600px)').matches ? 'desktop' : 'mobile'
      var image = document.createElement('link')
      image.rel = 'preload'
      image.as = 'image'
      image.type = 'image/webp'
      image.href = '/hero/' + device + '/strength' + (device === 'desktop' && ar ? '-rtl' : '') + '.webp'
      image.setAttribute('fetchpriority', 'high')
      document.head.appendChild(image)
    }

    // Sporta's subsetted local faces remain the fast, layout-stable default;
    // all Adobe styles are imported for explicit use without forcing 6–8
    // additional static-font downloads on every route. Preload only the two
    // local files required by the visitor's active script.
    var subset = ar ? 'arabic' : 'latin'
    ;['alexandria-var-' + subset, 'plex-400-' + subset].forEach(function (font) {
      var preload = document.createElement('link')
      preload.rel = 'preload'
      preload.as = 'font'
      preload.type = 'font/woff2'
      preload.crossOrigin = 'anonymous'
      preload.href = '/fonts/' + font + '.woff2'
      document.head.appendChild(preload)
    })

  } catch (_) {
    // Private browsing can reject localStorage. Defaults in the HTML remain safe.
  }

  // If a partially uploaded release leaves the entry chunk missing, show a
  // plain text recovery message. Never interpolate a failed URL as HTML.
  var failed = ''
  addEventListener('error', function (event) {
    var target = event.target
    if (!target || !(target.src || target.href)) return
    failed = String(target.src || target.href)
    if (String(target.tagName || '').toUpperCase() !== 'SCRIPT' || !target.src) return
    try {
      var asset = new URL(target.src, location.href)
      var key = 'sporta:entry-retry'
      if (asset.origin !== location.origin || !asset.pathname.startsWith('/assets/')) return
      if (sessionStorage.getItem(key) === asset.href) return
      sessionStorage.setItem(key, asset.href)
      location.reload()
    } catch (_) {}
  }, true)

  setTimeout(function () {
    if (window.__SPORTA_MOUNTED || document.visibilityState !== 'visible') return
    var arabic = window.__SPORTA_LANG === 'ar'
    var message = document.createElement('div')
    message.className = 'boot-msg'
    message.dir = arabic ? 'rtl' : 'ltr'
    var lineOne = document.createElement('p')
    var lineTwo = document.createElement('p')
    lineOne.textContent = arabic ? 'لم تكتمل عملية تحميل الصفحة.' : 'This page did not finish loading.'
    lineTwo.textContent = arabic
      ? 'حدّث الصفحة. إذا تكرر ذلك، فقد تكون ملفات الموقع غير مرفوعة بالكامل.'
      : 'Refresh the page. If it keeps happening, the site\'s files are probably not all on the server.'
    message.append(lineOne, lineTwo)
    if (failed) {
      var detail = document.createElement('code')
      detail.textContent = failed
      message.appendChild(detail)
    }
    document.getElementById('root')?.appendChild(message)
  }, 10000)
})()

/* Adobe Fonts kits are linked with media="print" data-async-css so they never
 * block the first paint (the subsetted local faces are the default anyway).
 * Switch each one on once it has loaded. This lives here, not in an onload
 * attribute, because the CSP forbids inline handlers; with JS off the site
 * simply keeps the local fonts. */
;(function () {
  'use strict'
  function enable(link) { link.media = 'all' }
  function wire() {
    var links = document.querySelectorAll('link[data-async-css]')
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      if (link.sheet) enable(link)
      else link.addEventListener('load', enable.bind(null, link), { once: true })
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true })
  else wire()
})()

/* ==== RACES: the bag between tabs, and the checkout after the bank (lane K3 of "fix race condition", 2026-11-04) ====
 * Two guards for the compiled storefront, whose source is not in this repo, so they can only live here. Each is its own
 * block and is wrapped, so neither can stop the page or each other. The repo's own app (src/lib/cart.jsx) does the first
 * job itself and says so with window.__sportaCartOwn, which makes the first block stand down. Proven by
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
 *    other key, and every other storage object, passes through with the caller's own arguments and `this`.
 * 2. THE CHECKOUT AFTER THE BANK. Placing a card order sets window.location to the bank and leaves the form busy
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
    var seen = null    // the bag as the app last read or wrote it (an array), null until it has read the key once
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
