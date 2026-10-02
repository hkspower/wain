/* Sporta — keep the owner's search title and description in place (2026-10-02).
 *
 * /backends → SEO lets the owner set the home page's title and description and a title/description
 * per product. seo.php puts them in the HTML, but the app then writes its OWN title and description
 * once it loads (document.title and meta[name=description]), and Google indexes the rendered page —
 * so without this the owner's text would last until hydration.
 *
 * seo.php marks the page with <meta name="sporta-seo-own" data-path data-lang data-title data-desc>
 * ONLY when the owner set something. This puts that text back whenever the app changes the head, but
 * only while the shopper is still on THAT path in THAT language: after an in-app navigation to another
 * page the app's own text stands, as it should.
 */
;(function () {
  'use strict'
  var m = document.querySelector('meta[name="sporta-seo-own"]')
  if (!m) return
  var path = m.getAttribute('data-path'), lang = m.getAttribute('data-lang')
  var title = m.getAttribute('data-title'), desc = m.getAttribute('data-desc')
  var busy = false

  function here() {
    var p = '/' + location.pathname.replace(/^\/+|\/+$/g, '')
    var l = (document.documentElement.getAttribute('lang') || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar'
    return p === path && l === lang
  }
  function set(sel, value) {
    var n = document.head.querySelector(sel)
    if (n && n.getAttribute('content') !== value) n.setAttribute('content', value)
  }
  function apply() {
    if (busy || !here()) return
    busy = true
    try {
      if (title && document.title !== title) document.title = title
      if (title) { set('meta[property="og:title"]', title); set('meta[name="twitter:title"]', title) }
      if (desc) { set('meta[name="description"]', desc); set('meta[property="og:description"]', desc); set('meta[name="twitter:description"]', desc) }
    } finally { busy = false }
  }
  apply()
  new MutationObserver(apply).observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['content'] })
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
})()
