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
