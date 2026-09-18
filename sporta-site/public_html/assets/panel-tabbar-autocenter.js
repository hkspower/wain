/* Sporta — the website panel's mobile tab bar re-centres on whichever tab is
 * active, instead of leaving it wherever a swipe last left the strip.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked again as "make better nav menu mobile backend", after
 * panel-tabbar-fade.js already fixed the DISCOVERABILITY half of this same
 * complaint — that file's own header records the measurement: real
 * scroll-snap and momentum scrolling, a genuine DISCOVERABILITY gap (nothing
 * suggested there was more past the edge), fixed with a fade rather than a
 * rewrite of mechanics that already worked.
 *
 * What is left, measured the same way (a real touch context, not Playwright's
 * fine-pointer default): the strip never moves itself. Manually scrolling to
 * "Security" — the 14th of 15 items, nearly three screen-widths in — and
 * tapping it leaves the strip exactly where the swipe left it, with the now-
 * active tab sitting hard against the right edge rather than centred. Next
 * time the owner opens the panel and wants Security again, the strip is back
 * at the start and the whole swipe has to be repeated from memory — there is
 * no "you are here" the strip itself offers.
 *
 * ------------------------------------------------------------------- MARKUP
 *
 * `.m-tabbar` is the bundle's own scrollable strip and `[aria-current="true"]`
 * is the bundle's own way of marking which tab is active — both read, nothing
 * added to them. A MutationObserver watching for `aria-current` changing is
 * needed here where panel-tabbar-fade.js could stay CSS-only, because
 * "re-centre on whichever one is active NOW" is a behaviour, not a static
 * rule a stylesheet can express — `scroll-snap-align` only takes effect
 * during a scroll gesture a person makes themselves, never on a tap.
 *
 * SURVIVES THE BAR BEING RE-RENDERED. The outer observer re-scans the whole
 * document on every mutation rather than assuming the element found once is
 * the element that will exist tomorrow — if the bundle replaces `.m-tabbar`
 * with a fresh node on navigation, the WeakSet check below simply does not
 * recognise it and re-attaches to the new one. No element reference is ever
 * held past this file's own function scope.
 *
 * CENTRES ON MOUNT TOO, not only on a later tap — so a session already deep
 * in the strip that gets its shell rebuilt (a language switch, a reload)
 * settles back on wherever the server says the active tab is, rather than
 * defaulting to whatever scroll position 0 shows.
 *
 * `block: 'nearest'` is there on purpose, not merely to satisfy the API: the
 * tab bar is a horizontally-scrolling strip fixed to the bottom of the
 * viewport, not part of the document's vertical flow, so a plain
 * `scrollIntoView()` centring both axes would also try to scroll the whole
 * PAGE to bring a fixed-position element into view — which it is already,
 * always, being fixed. `nearest` keeps this to the one axis that actually
 * needs it.
 */
;(function () {
  'use strict'

  if (location.pathname.indexOf('/backends') !== 0) return

  function centerActive(bar) {
    var active = bar.querySelector('[aria-current="true"]')
    if (!active) return
    active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }

  var attached = new WeakSet()
  function watch(bar) {
    if (attached.has(bar)) return
    attached.add(bar)
    centerActive(bar)
    new MutationObserver(function () {
      centerActive(bar)
    }).observe(bar, { attributes: true, attributeFilter: ['aria-current'], subtree: true })
  }

  function scan() {
    var bar = document.querySelector('.m-tabbar')
    if (bar) watch(bar)
  }

  scan()
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
})()
