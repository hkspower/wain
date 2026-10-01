/* Sporta — "View all" beside the home page's "Shop by category" and "Best sellers"
 * headings (2026-10-01, the owner's choice of heading style; css/66-section-heads.css).
 *
 * The link is appended to the SECTION, not the <h2>, so the heading's accessible name stays
 * the heading. Both go to /shop: the category tiles already show every category, and the
 * shop is where "all of them" lives. The bundle re-renders the home page on navigation and
 * language change, so the links are re-checked after every render and rebuilt when the
 * language under them changes. DOM calls and text nodes only. */
;(function () {
  'use strict'
  var MARK = 'data-sporta-section-all'
  var CAT = 'h2[class~="mb-5"][class~="text-2xl"][class~="font-extrabold"][class~="text-slate-900"]'

  function lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en' }
  function link(l) {
    var a = document.createElement('a')
    a.className = 'sporta-section-all'
    a.setAttribute(MARK, l)
    a.href = '/shop' + (l === 'en' ? '?lang=en' : '')
    a.appendChild(document.createTextNode(l === 'ar' ? 'عرض الكل' : 'View all'))
    var ns = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2.4'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    var p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M5 12h14M13 6l6 6-6 6'); svg.appendChild(p)
    a.appendChild(svg)
    return a
  }
  function place() {
    if (location.pathname !== '/') return
    var l = lang()
    var heads = document.querySelectorAll('main section > ' + CAT + ', main section.sporta-home-products > h2.sporta-home-products__heading')
    for (var i = 0; i < heads.length; i++) {
      var sec = heads[i].parentNode
      var cur = sec.querySelector(':scope > [' + MARK + ']')
      if (cur && cur.getAttribute(MARK) === l) continue
      if (cur) sec.removeChild(cur)
      sec.appendChild(link(l))
    }
  }
  var queued = false
  new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; place() })
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] })
  place()
})()
