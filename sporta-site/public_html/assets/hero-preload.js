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
 *
 * SINCE 2026-10-14 the boot script usually gets there first: seo.php writes the first slide's
 * picture URLs onto <html>, and the boot script preloads the right one before anything else on the
 * page. When it has, this adds no second <link> for the same file.
 *
 * AND IT KEEPS THE DRAWN SLIDES FROM DOWNLOADING while the photo slides load (2026-10-14). When
 * <html data-hero-slides> says the shop has photo slides, css/92-hero-first-frame.css hides the
 * bundle's built-in drawn slides — but the first one's two pictures are loading="eager", and an
 * eager <img> is fetched whether or not it is displayed (measured: 82 kB on a desktop, 29 kB on a
 * phone, for a picture nobody sees). So, while that attribute is set, a hero picture the bundle
 * creates under /hero/ is given loading="lazy" just before its src: a lazy picture with no box is
 * never fetched. React sets every other attribute of an <img> BEFORE src (react-dom's
 * setInitialProperties), and never touches `loading` again for these, so the order is safe. Only
 * <img>, only a /hero/ src, only while the attribute is there; if the slide list then comes back
 * empty, the attribute is removed below, the drawn slides show, and a visible lazy picture loads
 * as it always did.
 */
(function () {
  'use strict'
  if (location.pathname !== '/') return
  var root = document.documentElement
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  if (root.hasAttribute('data-hero-slides') && window.HTMLImageElement) {
    try {
      var native = Element.prototype.setAttribute
      var DRAWN = /^\/hero\/(mobile|desktop)\//
      HTMLImageElement.prototype.setAttribute = function (name, value) {
        if (name === 'src' && root.hasAttribute('data-hero-slides') && DRAWN.test(String(value)) &&
            this.getAttribute('loading') !== 'lazy') native.call(this, 'loading', 'lazy')
        return native.call(this, name, value)
      }
    } catch (e) {}
  }

  function hrefOf(img) {
    if (!img || /^data:/i.test(img)) return ''
    return /^https?:\/\//i.test(img) ? img : api + '/' + String(img).replace(/^\.?\//, '')
  }
  function preload(href) {
    if (!href) return
    var abs = new URL(href, location.href).href
    var have = document.querySelectorAll('link[rel=preload][as=image]')
    for (var i = 0; i < have.length; i++) if (have[i].href === abs) return
    var l = document.createElement('link')
    l.rel = 'preload'; l.as = 'image'; l.href = href
    l.setAttribute('fetchpriority', 'high')
    document.head.appendChild(l)
  }
  // No photo slides after all (the list changed since the page was made, or it did not answer):
  // the drawn slides are what the hero will show, so stop hiding them.
  function noSlides() { root.removeAttribute('data-hero-slides') }

  fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (j) {
      var s = j && j.slides && j.slides[0]
      if (!s) { noSlides(); return }
      /* s.image, which is ALREADY the right picture for this screen: since 2026-09-29 ?r=slides
         hands a phone the phone picture in `image` (only in the Full size since 2026-10-01, where
         the phone's hero is tall enough to hold it), and the carousel draws exactly what `image`
         names. image_mobile is never asked for separately; preloading it as well would be a
         wasted download on exactly the connections that can least afford one. */
      preload(hrefOf(s.image))
    })
    .catch(noSlides)
})()
