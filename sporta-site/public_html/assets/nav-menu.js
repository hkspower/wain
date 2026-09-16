/* Sporta — the main menu's "About us" link becomes "Terms & Conditions".
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-16, alongside removing "Shop" from the same menu
 * (sporta-ui.css hides both <li>s) and turning the header orange. Removing
 * "Shop" is a plain CSS hide — nothing to replace it with. "About" is
 * different: the request is to REPLACE it with a link to a different page
 * (/terms), not remove it, and that is not something CSS can do — hiding
 * text and painting different text over it with ::after would leave a
 * screen reader announcing "من نحن" for a link that opens the terms page,
 * which is worse than doing nothing.
 *
 * -------------------------------------------------------- WHY A NEW <a>, NOT
 * -------------------------------------------------------- AN EDITED ONE
 *
 * The "About" link the bundle renders is a React Router Link. Its href in
 * the DOM is a RENDERED CONSEQUENCE of the `to="/about"` prop, and React
 * attaches its own click handler to that exact node — changing the DOM's
 * href attribute afterwards does not change where clicking it navigates,
 * because the click is handled by React's listener before the browser ever
 * looks at the href for a same-document anchor. Editing the existing node's
 * text and hoping the navigation follows is how this goes wrong silently.
 *
 * returns-link.js already worked this out and says it plainly: "the SPA only
 * hijacks its own <Link> components. An <a> with a plain href does the right
 * thing; nothing here calls preventDefault." So: hide the bundle's own
 * "About" <li> (sporta-ui.css does that), and insert a BRAND NEW <li><a>
 * that React never rendered and therefore never attached a handler to. A
 * plain href on a node outside React's tree does a normal browser navigation
 * to /terms, which is a real page and needs nothing special to open.
 *
 * ------------------------------------------------------------------- LANGUAGE
 *
 * The label follows document.documentElement.lang, re-read on every
 * MutationObserver tick — the same language switch that changes every other
 * nav label, and this one has to track it too or it would be the one word on
 * the header that never changes with the toggle.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page whose source I do not hold, same class of thing as
 * contact.js and returns-link.js. If the header's nav <ul> cannot be found
 * this inserts nothing and the menu is left exactly as the bundle renders it
 * (with "About" still visible, since the CSS hide only fires once this
 * script's own marker proves the replacement is in place — see below).
 */
(function () {
  'use strict'

  var LABEL = { ar: 'الشروط والأحكام', en: 'Terms & Conditions' }
  var MARK = 'data-sporta'

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  function findNav() {
    var header = document.querySelector('header.app-header')
    if (!header) return null
    return header.querySelector('ul')
  }

  function findAboutLi(ul) {
    var a = ul.querySelector('a[href="/about"]')
    return a ? a.closest('li') : null
  }

  function place() {
    var ul = findNav()
    if (!ul) return

    var aboutLi = findAboutLi(ul)
    var existing = ul.querySelector('li[' + MARK + '="terms-nav"]')

    if (!aboutLi) {
      // The bundle's own "About" is gone from this render (a different page,
      // a different breakpoint's menu) — nothing to replace, so nothing is
      // inserted. Reflects the CSS hide's own condition: hiding what is not
      // there costs nothing, and inserting a link with nowhere it replaced
      // would be adding a fifth menu item rather than swapping the fourth.
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      return
    }

    if (existing) {
      // Keep the label in step with the language — the one thing that can
      // change on a re-render without the <li> itself being rebuilt.
      var link = existing.querySelector('a')
      if (link) link.textContent = LABEL[lang()]
      return
    }

    var li = document.createElement('li')
    li.setAttribute(MARK, 'terms-nav')
    var a = document.createElement('a')
    a.href = '/terms'
    // The SAME classes the bundle gives its own nav links, read off the
    // About link being replaced — so this matches whatever build produced
    // them rather than a copy of today's utility-class string that goes
    // stale the day the bundle's styling changes.
    a.className = aboutLi.querySelector('a')?.className || ''
    a.textContent = LABEL[lang()]
    li.appendChild(a)
    aboutLi.parentNode.insertBefore(li, aboutLi)
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 80)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
