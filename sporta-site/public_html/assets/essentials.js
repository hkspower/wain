/* Sporta — remove the "Shop the essentials" section from the home page.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-17, alongside removing the main menu. It is the last
 * section on the home page: a kicker ("Trending now" / "الأكثر رواجًا"), a
 * heading ("Shop the essentials" / "تسوق الأساسيات"), and a grid of
 * featured products.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * CSS alone cannot do this: there is no `:contains()` selector, and the
 * section's own class (`mx-auto max-w-7xl px-4 py-10 md:px-6 md:py-14`) is
 * a generic Tailwind utility combination, not a name unique to this
 * section — matching it would risk hiding some OTHER plain section that
 * happens to share the same spacing. Matched instead by the one thing that
 * IS unique to it: an <h2> whose text is the section's own heading, in
 * either language, found by walking up to the nearest <section>.
 *
 * ----------------------------------------------------------- WHAT IT SKIPS
 *
 * Every other home page section — the hero, the promo band, the category
 * tiles, the delivery/returns strip. If the heading is not found (a
 * different page, a re-render before the section has painted, a bundle
 * change that renames it), nothing is removed — this can only ever take
 * away the ONE section it was asked to, never guess at another.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * tile-art.js and brand-strip.js. A throttle, not a debounce — brand-strip.js's
 * own finding, re-applied here too: a queued flag plus requestAnimationFrame,
 * since a debounce can starve forever against a page that keeps mutating
 * (the header's own clock, for one).
 */
;(function () {
  'use strict'

  var TITLES = ['Shop the essentials', 'تسوق الأساسيات']

  function place() {
    var main = document.querySelector('main')
    if (!main) return

    var headings = main.querySelectorAll('h2')
    for (var i = 0; i < headings.length; i++) {
      var h2 = headings[i]
      if (TITLES.indexOf(h2.textContent.trim()) === -1) continue
      var section = h2.closest('section')
      if (section && section.parentNode) section.parentNode.removeChild(section)
    }
  }

  var queued = false
  var observer = new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      place()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
