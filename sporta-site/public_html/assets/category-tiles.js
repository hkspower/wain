/**
 * The home page's four category tiles point at /shop — left that way since
 * 2026-09-09, when /shop lost its filters and a tile linking anywhere more
 * specific would have opened a page with no visible sign it was narrowed and
 * no way back to "all". Now that /men /women /accessories /outlet exist as
 * real pages of their own (a heading naming the section, and the OTHER three
 * always in reach), each tile should open its own page instead.
 *
 * A HREF REWRITE ALONE IS NOT ENOUGH. These tiles are React Router `Link`s:
 * the compiled bundle has no source here, but a Link intercepts its own
 * click in the bubble phase and calls the router's client-side navigation
 * with whatever `to` prop it was built with — changing the DOM `href`
 * attribute changes what a screen reader announces and what "open in a new
 * tab" uses, but not what a plain left-click does, because the SPA's router
 * has never heard of /men and would hand the click to its own NotFound view
 * rather than letting the browser load the real server route. So the click
 * is intercepted in the CAPTURE phase — which runs before React's own
 * listener — and forced into an ordinary navigation instead, the same
 * reasoning .htaccess's own comment gives for why /card and
 * /returns/request must not fall through to index.html.
 *
 * FOUR NAMED CLASSES, NOT POSITION. `.tile-men`, `.tile-women`, `.tile-acc`
 * and `.tile-outlet` are the bundle's own per-category class names — stable
 * across a re-render, unlike "the first tile" or "the tile at index 2".
 */
(function () {
  'use strict'

  var MAP = {
    'tile-men': '/men',
    'tile-women': '/women',
    'tile-acc': '/accessories',
    'tile-outlet': '/outlet',
  }
  var CLASSES = Object.keys(MAP)

  function classOf(el) {
    for (var i = 0; i < CLASSES.length; i++) {
      if (el.classList.contains(CLASSES[i])) return CLASSES[i]
    }
    return null
  }

  // Keeps the DOM href correct for hover previews, "open in new tab",
  // middle-click and screen readers — everything that does NOT go through
  // React's click handler.
  function fixHrefs() {
    for (var i = 0; i < CLASSES.length; i++) {
      var els = document.getElementsByClassName(CLASSES[i])
      for (var j = 0; j < els.length; j++) {
        var want = MAP[CLASSES[i]]
        if (els[j].getAttribute('href') !== want) els[j].setAttribute('href', want)
      }
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null
    if (!a) return
    var cls = classOf(a)
    if (!cls) return
    // A modified click (open in new tab, middle-click, etc.) is left alone —
    // the corrected href above already does the right thing for those.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    e.stopImmediatePropagation()
    location.href = MAP[cls]
  }, true)

  fixHrefs()
  new MutationObserver(fixHrefs).observe(document.body, { childList: true, subtree: true })
})()
