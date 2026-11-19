/* Sporta first-paint setup. This is an external script so the production CSP
 * can block inline JavaScript completely. Keep this file dependency-free: it
 * runs before the application bundle is available. */
;(function () {
  'use strict'
  try {

  // The private backend is an installable app on this same origin. Select its
  // manifest before the React bundle loads so its home-screen icon is correct.
  if (/^\/backends(?:\/|$)/.test(window.location.pathname)) {
    // The app shell's manifest link has no id (index.html: <link rel="manifest" href="/site.webmanifest">), so the id alone
    // never matched and the admin kept the storefront's name and icon when installed. Either way is found now.
    var manifest = document.getElementById('sporta-webmanifest') || document.querySelector('link[rel="manifest"]')
    if (manifest) manifest.href = '/backends.webmanifest'
    var appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appTitle) appTitle.content = 'Sporta Admin'
    var robots = document.querySelector('meta[name="robots"]')
    if (robots) robots.content = 'noindex, nofollow, noarchive'
    var canonical = document.querySelector('link[rel="canonical"]')
    if (canonical) canonical.remove()
  }

  // Storage can be denied (private windows, blocked site data), and a denied
  // read throws. Each read gets its own guard so one denied key cannot skip the
  // rest of the setup below.
  function stored(key) {
    try { return localStorage.getItem(key) } catch (_) { return null }
  }

  // Set language, theme and hero geometry before the first paint. All values
  // come from controlled local settings or a narrowly parsed query parameter.
  try {
    var root = document.documentElement
    // Precedence: an explicit saved choice, then ?lang=, then Arabic. The query
    // is parsed before any storage access, so a denied store cannot skip it.
    var queryLang = null
    var match = /[?&]lang=([A-Za-z-]{2,10})/.exec(location.search)
    if (match) {
      var tag = match[1].toLowerCase().split('-')[0]
      if (tag === 'ar' || tag === 'en') queryLang = tag
    }
    var saved = stored('lang')
    var lang = saved === 'ar' || saved === 'en' ? saved : queryLang || 'ar'
    var ar = lang === 'ar'
    window.__SPORTA_LANG = ar ? 'ar' : 'en'
    root.lang = window.__SPORTA_LANG
    root.dir = ar ? 'rtl' : 'ltr'

    var theme = stored('sporta_theme')
    var osDark = matchMedia('(prefers-color-scheme: dark)').matches
    var backend = /^\/backends(?:\/|$)/.test(location.pathname)
    var explicitTheme = stored('sporta_theme_explicit') === '1'
    if (theme !== 'dark' && theme !== 'light') theme = backend && osDark ? 'dark' : 'light'
    else if (!backend && theme === 'dark' && osDark && !explicitTheme) theme = 'light'
    root.dataset.theme = theme
    root.style.colorScheme = theme

    // The owner's text size and heading weight for this language (settings.text_style), from the copy sporta-features.js
    // saved on the last visit, put on <html> before the first paint so the page is not resized once it is up. Only values
    // that differ from the design are set (sporta-brand-theme.css, TEXTSTYLE-1118). The admin is not styled by it.
    if (!backend) {
      // its own guard: a stored value that is not JSON must not stop the rest of this setup
      try {
        var textStyle = JSON.parse(stored('sporta_text_style') || 'null')
        if (textStyle && typeof textStyle === 'object') {
          var tsSize = textStyle['size_' + lang], tsWeight = textStyle['heading_weight_' + lang]
          if ([90, 95, 105, 110, 115, 120].indexOf(tsSize) >= 0) root.setAttribute('data-sporta-size', String(tsSize))
          if ([600, 700, 800, 900].indexOf(tsWeight) >= 0) root.setAttribute('data-sporta-hw', String(tsWeight))
        }
      } catch (_) { /* no saved style: the design as it is */ }
    }

    var heroSizes = { short: ['400px', '460px'], tall: ['540px', '640px'], full: ['85svh', '90svh'] }
    // An own-property check: a stored key such as "constructor" must not match
    // an inherited Object member and leave --hero-h undefined.
    var heroKey = stored('sporta_hero_size')
    var hero = Object.prototype.hasOwnProperty.call(heroSizes, heroKey) ? heroSizes[heroKey] : heroSizes.tall
    root.style.setProperty('--hero-h', hero[0])
    root.style.setProperty('--hero-h-md', hero[1])

    if (location.pathname === '/' || location.pathname === '/index.html') {
      var device = matchMedia('(min-width: 600px)').matches ? 'desktop' : 'mobile'
      var image = document.createElement('link')
      image.rel = 'preload'
      image.as = 'image'
      image.type = 'image/webp'
      image.href = '/hero/' + device + '/strength' + (ar ? '-rtl' : '') + '.webp'
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
    if (String(target.tagName || '').toUpperCase() !== 'SCRIPT' || !target.src) return
    failed = String(target.src)
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
    var mount = document.getElementById('root')
    if (mount) mount.appendChild(message)
  }, 10000)
  } catch (e) {}
})()

/* Adobe Fonts kits are linked with media="print" data-async-css so they never
 * block the first paint (the subsetted local faces are the default anyway).
 * Switch each one on once it has loaded. This lives here, not in an onload
 * attribute, because the CSP forbids inline handlers; with JS off the site
 * simply keeps the local fonts. */
;(function () {
  'use strict'
  try {
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
  } catch (e) {}
})()

/* ===== PRODUCT BACK 1120 (2026-11-19, owner: "make product page without topbar and main menu, just add back button") =====
 * On a product page (/product/<slug>) the shop's header is not shown: no announcement bar, no logo row (clock, AI, language,
 * bag) and no menu tabs. ONE control stands at the top of the page instead: Back. Three jobs cannot wait for the app, so
 * they live in this early script (it runs in <head>, before anything is painted):
 *   1. <html data-sporta-route="product"> is set at once. sporta-product-fix.css (BACK 1120) hides the header and the
 *      first-paint shell (.boot-bar, .boot-head, .boot-hero) on that route, so no header shows up and then goes away.
 *   2. The Back control is built as the FIRST child of <body>, outside the React tree (the app never renders it away), in
 *      the flow above the page, so nothing moves when it appears. On every other route it carries the hidden attribute.
 *   3. The marker and the control follow client-side navigation: the router changes the address with history.pushState /
 *      replaceState, and the browser fires popstate for Back / Forward. All three are watched, so a click from the shop to a
 *      product hides the header in the same tick and going back to the shop brings it back.
 * What Back does. From inside the site it is history.back(): the page the shopper left, at the scroll position they left it
 * (react-router keeps its place in history.state.idx; a count of in-site pushes is the fallback). With nothing to go back to
 * (a search result, a message, a QR code) the link goes to the shop, with ?lang=en when the page is English, because a
 * language that came only from the address would otherwise be lost. A modified click (new tab, new window) just follows
 * the href. No innerHTML, no eval: the control is built from DOM calls. Leading ";" because this file is several IIFEs
 * back to back. */
;(function () {
  'use strict'
  try {
    if (window.__sportaProductBack || /^\/backends(?:\/|$)/.test(location.pathname)) return
    window.__sportaProductBack = 1
    var root = document.documentElement
    var PRODUCT = /^\/product\/[^/]+\/?$/
    var TEXT = { ar: 'رجوع', en: 'Back' }
    var bar = null, link = null, label = null
    var pushes = 0   // in-site pushState calls since this page was loaded: the fallback when the router leaves no index in history.state

    function onProduct() { return PRODUCT.test(location.pathname) }
    function english() { return String(root.lang).slice(0, 2).toLowerCase() === 'en' }
    // Is there a page of this site to go back to? react-router (the build's router) stores the position in the stack it
    // keeps in history.state.idx: 0 is the first entry it saw, so 0 means the shopper arrived here from outside.
    function inSite() {
      var st = history.state
      if (st && typeof st.idx === 'number') return st.idx > 0
      return pushes > 0
    }
    function build() {
      if (bar || !document.body) return
      bar = document.createElement('div')
      bar.className = 'sporta-back-bar'
      bar.hidden = true
      var inner = document.createElement('div')
      inner.className = 'sporta-back-bar__in'
      link = document.createElement('a')
      link.className = 'sporta-back'
      link.setAttribute('data-sporta-back', '')
      var icon = document.createElement('span')
      icon.className = 'sporta-back__icon'
      icon.setAttribute('aria-hidden', 'true')
      label = document.createElement('span')
      label.className = 'sporta-back__label'
      link.appendChild(icon)
      link.appendChild(label)
      link.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        if (inSite()) { e.preventDefault(); history.back() }
      })
      inner.appendChild(link)
      bar.appendChild(inner)
      document.body.insertBefore(bar, document.body.firstChild)
    }
    function sync() {
      var on = onProduct()
      if (on) { if (root.getAttribute('data-sporta-route') !== 'product') root.setAttribute('data-sporta-route', 'product') }
      else if (root.hasAttribute('data-sporta-route')) root.removeAttribute('data-sporta-route')
      if (on) build()
      if (!bar) return
      bar.hidden = !on
      if (!on) return
      var en = english(), text = en ? TEXT.en : TEXT.ar, href = en ? '/shop?lang=en' : '/shop'
      if (label.textContent !== text) label.textContent = text
      if (link.getAttribute('href') !== href) link.setAttribute('href', href)
    }

    ;['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name]
      if (typeof original !== 'function') return
      history[name] = function () {
        var result = original.apply(this, arguments)
        if (name === 'pushState') pushes++
        try { sync() } catch (e) {}
        return result
      }
    })
    window.addEventListener('popstate', function () { try { sync() } catch (e) {} })
    // the language is on <html lang>: the label and the shop link follow it
    if (window.MutationObserver) new MutationObserver(function () { try { sync() } catch (e) {} }).observe(root, { attributes: true, attributeFilter: ['lang'] })

    sync()   // the marker, at once: before the first paint
    if (!document.body) {
      // <body> does not exist yet (this script is in <head>): build the control the moment the parser creates it, still
      // before anything has been painted, and again at DOMContentLoaded in case the observer is not available
      if (window.MutationObserver) {
        var wait = new MutationObserver(function () { if (document.body) { wait.disconnect(); try { sync() } catch (e) {} } })
        wait.observe(root, { childList: true })
      }
      document.addEventListener('DOMContentLoaded', function () { try { sync() } catch (e) {} }, { once: true })
    }
  } catch (e) {}
})()
/* ===== PRODUCT BACK 1120 - end ============================================= */
