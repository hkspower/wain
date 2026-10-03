/**
 * Product page polish — two small things the app cannot do for itself.
 *
 *  1. ONE Product, NOT TWO. seo.php now draws a Product JSON-LD into the server HTML (so a crawler that
 *     does not run scripts still sees price, availability and brand). The app writes its own once it has
 *     mounted (a script marked data-route). This drops the server copy as soon as the app's exists, so
 *     a rendered page holds a single Product.
 *  2. NO ECHO. A product with no description of its own shows its NAME again as the description
 *     ("Cheetahs Rugby T-Shirt." under "Cheetahs Rugby T-Shirt"). When the two are the same words the
 *     repeat is hidden; a real description is never touched.
 * Both only remove or hide; nothing is added, rewritten or sent anywhere.
 */
(function () {
  'use strict'
  function plain(s) { return String(s || '').toLowerCase().replace(/[\s.,;:!؟،\-–—'"]+/g, ' ').trim() }

  function dedupeLd() {
    var ssr = document.querySelector('script[data-seo-ssr="product"]')
    if (!ssr) return
    var mine = document.querySelectorAll('script[type="application/ld+json"][data-route]')
    for (var i = 0; i < mine.length; i++) {
      var t = mine[i].textContent || ''
      if (t.indexOf('"Product"') !== -1) { ssr.remove(); return }
    }
  }

  // 3. THE OWNER'S RETURN WINDOW. The app's Product data says merchantReturnDays 14, fixed in the bundle;
  //    seo.php states the rule from /backends in a meta tag, and the app's copy is corrected to it.
  function fixReturnDays() {
    var m = document.querySelector('meta[name="sporta-return-days"]')
    var days = m ? parseInt(m.getAttribute('content'), 10) : NaN
    if (!(days > 0)) return
    var ld = document.querySelectorAll('script[type="application/ld+json"]')
    for (var i = 0; i < ld.length; i++) {
      var t = ld[i].textContent || ''
      if (t.indexOf('"merchantReturnDays"') === -1) continue
      var n = t.replace(/"merchantReturnDays":\s*\d+/g, '"merchantReturnDays":' + days)
      if (n !== t) ld[i].textContent = n
    }
  }

  function hideEcho() {
    if (!/^\/product\//.test(location.pathname)) return
    var h1 = document.querySelector('h1.product-title')
    if (!h1) return
    var row = h1.closest('.flex') || h1.parentElement
    var holder = row && row.parentElement
    if (!holder) return
    var ps = holder.querySelectorAll(':scope > p')
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]
      if (/^KWD|^د\.ك|\d{1,3}\.\d{3}/.test(p.textContent.trim())) continue   // the price line
      if (plain(p.textContent) === plain(h1.textContent)) p.setAttribute('data-pp-echo', '')
      else p.removeAttribute('data-pp-echo')
    }
  }

  var q = null
  function run() { dedupeLd(); fixReturnDays(); hideEcho() }
  new MutationObserver(function () { if (!q) q = setTimeout(function () { q = null; run() }, 150) }).observe(document.documentElement, { childList: true, subtree: true })
  run()
})()
