/* Sporta — the menu bar under the top bar, 2026-10-02.
 *
 * Asked for as "add menu bar under topbar, then make menu bar with top bar sticky": Men, Women,
 * Accessories, Outlet and All products (the owner chose those five). The bar is appended INSIDE the
 * bundle's <header class="app-header">, which is already `sticky top-0`, so the top bar and the menu
 * are one sticky block and no scroll code is needed.
 *
 * Plain <a href> links, like the home tiles: the four category pages are server-rendered, and /shop
 * is a normal navigation too. The language rides along as ?lang=en, the same way every other link
 * in the shop carries it; Arabic is the default and needs nothing.
 *
 * NOT on /backends (the panel has its own navigation). category.php draws the same markup on the
 * server, so the four category pages have it without this script. If the header cannot be found
 * nothing is inserted, and a bar from an earlier render is replaced rather than duplicated.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-menubar'
  var ITEMS = [
    ['/men', 'Men', 'رجالي'],
    ['/women', 'Women', 'نسائي'],
    ['/accessories', 'Accessories', 'إكسسوارات'],
    ['/outlet', 'Outlet', 'سبورتا أوتلت'],
    ['/shop', 'All products', 'كل المنتجات'],
  ]

  function isEn() { return document.documentElement.lang === 'en' }

  function build() {
    var en = isEn()
    var nav = document.createElement('nav')
    nav.className = 'sp-menubar'
    nav.setAttribute(MARK, en ? 'en' : 'ar')
    nav.setAttribute('aria-label', en ? 'Shop menu' : 'قائمة المتجر')
    var path = location.pathname.replace(/\/+$/, '') || '/'
    for (var i = 0; i < ITEMS.length; i++) {
      var a = document.createElement('a')
      a.className = 'sp-menubar__link'
      a.href = ITEMS[i][0] + (en ? '?lang=en' : '')
      a.textContent = en ? ITEMS[i][1] : ITEMS[i][2]
      if (path === ITEMS[i][0]) a.setAttribute('aria-current', 'page')
      nav.appendChild(a)
    }
    return nav
  }

  function place() {
    var header = document.querySelector('header.app-header')
    var existing = document.querySelector('[' + MARK + ']')
    if (location.pathname.indexOf('/backends') === 0 || !header) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      return
    }
    var want = isEn() ? 'en' : 'ar'
    var path = location.pathname.replace(/\/+$/, '') || '/'
    if (existing && existing.parentNode === header && existing.getAttribute(MARK) === want
        && existing.dataset.path === path) return
    var fresh = build()
    fresh.dataset.path = path
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
    header.appendChild(fresh)
  }

  var queued = false
  new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; place() })
  }).observe(document.body, { childList: true, subtree: true })
  place()
})()
