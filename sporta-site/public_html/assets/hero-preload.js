/**
 * Start the first hero slide's image earlier.
 *
 * The page paints a placeholder frame at once (index.html's boot shell) and the real slide only
 * starts downloading after React has mounted, asked for the slide list and drawn the <img> — so the
 * soft placeholder stays up for the whole of that chain. This asks for the slide list as soon as the
 * page is parsed (api-dedupe.js shares that one answer with the app's own request, so the server
 * is not asked twice) and preloads the first slide's picture, so by the time the app draws its
 * <img> the file is already on its way. Preloaded with the SAME URL the app uses, so the browser
 * reuses it instead of fetching a second copy. Home page only; nothing is drawn or changed here.
 */
(function () {
  'use strict'
  if (location.pathname !== '/') return
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  function hrefOf(img) {
    if (!img || /^data:/i.test(img)) return ''
    return /^https?:\/\//i.test(img) ? img : api + '/' + String(img).replace(/^\.?\//, '')
  }
  function preload(href) {
    if (!href) return
    var l = document.createElement('link')
    l.rel = 'preload'; l.as = 'image'; l.href = href
    l.setAttribute('fetchpriority', 'high')
    document.head.appendChild(l)
  }

  fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (j) {
      var s = j && j.slides && j.slides[0]
      if (!s) return
      /* s.image, which is ALREADY the right picture for this screen: since 2026-09-29 ?r=slides
         hands a phone the phone picture in `image` (only in the Full size since 2026-10-01, where
         the phone's hero is tall enough to hold it), and the carousel draws exactly what `image`
         names. image_mobile is never asked for separately; preloading it as well would be a
         wasted download on exactly the connections that can least afford one. */
      preload(hrefOf(s.image))
    })
    .catch(function () {})
})()
