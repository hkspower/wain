/* Sporta — an edge fade on the website panel's mobile tab bar, so it looks
 * like what it is: a horizontally-scrolling strip with more past the edge.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for as "make backends menu better when slide and easy to move" — the
 * bottom tab bar on a phone (`.m-tabbar`, `@media (max-width:767px)`, the
 * bundle's own replacement for the desktop sidebar) already has real
 * scroll-snap and momentum scrolling built in: `scroll-snap-type:x
 * proximity` on the bar, `scroll-snap-align:center` on each `.m-tabbar__item`,
 * `-webkit-overflow-scrolling:touch`. Measured in a real mobile-viewport
 * browser, scroll position survives navigating between screens correctly —
 * none of the mechanics are actually broken.
 *
 * WHAT WAS ACTUALLY WRONG, measured the same way: of 15 items across roughly
 * three screen-widths of content, only 5 are visible on a 390px phone and the
 * strip is cut off flush at the right edge with NOTHING suggesting there is
 * more — no partial next icon, no shadow, no fade, no scrollbar (the bundle's
 * own CSS sets `scrollbar-width:none`). A first-time user has no reason to
 * try swiping a row of tabs that already looks complete. That is a
 * DISCOVERABILITY problem, not a scrolling-mechanics one, and the fix is a
 * fade, not a rewrite of behaviour that already works.
 *
 * ------------------------------------------------------------------- MARKUP
 *
 * CSS only — no DOM surgery, no MutationObserver, nothing to find and nothing
 * that can fail to be found. `.m-tabbar` is a class name the bundle already
 * gives this element on every render; a mask-image keyed to it needs no
 * element reference at all; it applies for as long as the class exists,
 * including through the bar's own re-renders on navigation.
 *
 * A symmetric fade at BOTH ends, not just the trailing one — this panel is
 * fixed LTR regardless of language (the desktop sidebar next to it never
 * flips either), but a mask that only faded the "next" edge would read as a
 * scroll-position INDICATOR that lies the moment the strip is scrolled
 * partway: mid-scroll, both edges genuinely have content past them, and only
 * a symmetric mask is honest about that in every scroll position.
 *
 * `-webkit-mask-image` is required, not merely mirrored for older engines:
 * this bundle is used from Mobile Safari (the environment this was asked
 * about in), which has never shipped unprefixed `mask-image` on this
 * property. Omitting it would make the fix invisible on exactly the device
 * it was written for.
 */
;(function () {
  'use strict'

  if (location.pathname.indexOf('/backends') !== 0) return

  var CSS =
    '.m-tabbar{' +
    '-webkit-mask-image:linear-gradient(to right,transparent,black 20px,black calc(100% - 20px),transparent);' +
    'mask-image:linear-gradient(to right,transparent,black 20px,black calc(100% - 20px),transparent);' +
    '}'

  function style() {
    if (document.getElementById('sporta-tabbar-fade-css')) return
    var s = document.createElement('style')
    s.id = 'sporta-tabbar-fade-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }
  style()
})()
