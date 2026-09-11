/* tile-art.js — the women's category tile, composed for Arabic.
 * ===========================================================================
 *
 * THE FAULT. The home page's four tiles put their copy INSIDE the artwork, on
 * the reading side, so an Arabic frame needs the figure on the left. The men's
 * tile has one and uses it. The women's tile does not — measured in a browser
 * at 1440x900 and 390x844 with ?lang=ar:
 *
 *     desktop ar   art-men-rtl.webp   art-women.webp   <- the English frame
 *     phone ar     art-men-rtl.webp   art-women.webp   <- the English frame
 *
 * So every Arabic shopper sees one tile composed for them and, beside it, one
 * composed for a left-to-right reader. It is the kind of fault that reads as
 * "something is slightly off about this page" rather than as a bug, which is
 * why it has been there since the tiles shipped.
 *
 * THE ART WAS ONLY HALF THE PROBLEM, and fixing the art alone changed nothing.
 * `cats/desktop/art-women-rtl.*` did not exist and `cats/mobile/art-women-rtl`
 * had a hand-copied jpg with no webp beside it; scripts/make-rtl-art.mjs now
 * builds all of them from each crop's own English base. With every file in
 * place the page STILL served art-women.webp, because the bundle decides which
 * tiles have an Arabic frame and it names exactly one:
 *
 *     {id:'men', …, rtlArt:!0}, {id:'women', …}      <- no rtlArt
 *
 * There is no source for that bundle in this repository, so this is the
 * overlay pattern the storefront already uses for contact.js, footer.js and
 * theme.js: add behaviour, touch nothing that exists, and do nothing outside
 * the one element it belongs to.
 *
 * WHY IT IS SAFE TO GET WRONG — AND THE FIRST VERSION OF THIS PARAGRAPH WAS
 * WRONG. It claimed the image's own `error` handler reverted the swap, so a
 * missing -rtl file would fall back to today's picture. Mutation-tested by
 * moving art-women-rtl.webp aside, and the tile painted NO ARTWORK at all:
 * `.tile-women` contained no <img> to fire an error on, because the bundle's
 * own two-<picture> fallback had already taken the layer away. A blank tile on
 * the shop's main navigation, produced by the very guard written to prevent it.
 *
 * So the swap is now PREFLIGHTED: every URL it would point at is loaded first,
 * and the swap happens only if all of them arrive. A file that is missing,
 * corrupt or not yet published leaves the tile exactly as the page renders it
 * today, and the page makes no failed request either. The preflight costs one
 * image load on the Arabic home page, and the browser serves the real thing
 * from cache a moment later.
 *
 * WHY A MutationObserver. The bundle re-renders the tile when the language
 * changes and when its own two-<picture> fallback fires, and a one-shot swap at
 * load would be undone by either without anything reporting it. The observer
 * re-applies; the data attribute makes re-applying free.
 */
(function () {
  'use strict'

  /* The women's tile is matched by the tone class the bundle gives it —
     `.tile-women` — rather than by position among the four. A tile chosen by
     position is a tile chosen at random: the order is the server's, from
     ?r=slides, and it has changed before. */
  var TILE = '.tile-women'
  var FROM = 'art-women'
  var TO = 'art-women-rtl'

  /** Arabic is asked of the DOCUMENT, not of localStorage: the boot script and
   *  the bundle both write `lang`/`dir`, and what is on the element is what the
   *  page is actually rendering. A stored preference can disagree with it for a
   *  frame, and that frame is when this runs. */
  function isArabic() {
    var el = document.documentElement
    return el.getAttribute('lang') === 'ar' || el.getAttribute('dir') === 'rtl'
  }

  /** art-women.webp -> art-women-rtl.webp, in a srcset or a src, leaving any
   *  descriptor and any other candidate alone. Anchored on the filename so it
   *  cannot touch art-women-rtl (already done) or a path merely containing it. */
  function swap(value) {
    return value.replace(/art-women(?=\.(webp|jpg|jpeg|png))/g, TO)
  }

  /** Every URL a node would be swapped to, or null if it cannot be swapped
   *  safely. A srcset carrying descriptors or several candidates is left alone
   *  rather than guessed at — there is one tile shape here and it has neither,
   *  and a wrong guess would point the page at a URL nobody built. */
  function planned(node) {
    var attr = node.tagName === 'SOURCE' ? 'srcset' : 'src'
    var was = node.getAttribute(attr) || ''
    if (was.indexOf(FROM) === -1) return null
    if (attr === 'srcset' && /,|\s\S/.test(was.trim())) return null
    var now = swap(was)
    return now === was ? null : { node: node, attr: attr, was: was, now: now.trim() }
  }

  /** Probe ONE url — the exact candidate the browser has already chosen for
   *  this <img> under the current viewport and format support, swapped. Then
   *  swap everything if it arrives.
   *
   *  THE FIRST VERSION PROBED EVERY PLANNED URL and that was a real regression:
   *  the tiles carry a webp and a jpeg <source> for each of two crops, so an
   *  Arabic phone fetched the jpegs it will never display. `test:tile-art`
   *  caught it — "Arabic, phone: every tile is webp — art-women-rtl.jpg" —
   *  counting REQUESTS rather than what was painted, which is the difference
   *  that mattered. The whole reason these tiles are webp is the bytes, and a
   *  guard that quietly re-downloads the jpeg beside it gives that back.
   *
   *  currentSrc is the right thing to probe precisely because the browser
   *  computed it: it already applied the media queries and the type support,
   *  so it names the one file that is actually going to be used, and the
   *  browser serves it from cache the moment the swap lands. */
  function probeUrl(tile) {
    var img = tile.querySelector('img')
    if (!img) return null

    // WAIT FOR THE BROWSER TO HAVE CHOSEN. currentSrc is empty until the image
    // has actually been selected and started loading, and the first version
    // fell back to the `src` attribute when it was — which is the JPEG, so the
    // probe fetched a jpeg on a page whose whole point is webp. One request
    // rather than two, and still the wrong one. `load` is not a mutation, so
    // the observer cannot see this happen; it has to be waited for directly.
    if (!img.currentSrc) {
      if (!img.getAttribute('data-rtl-wait')) {
        img.setAttribute('data-rtl-wait', '1')
        img.addEventListener('load', apply, { once: true })
      }
      return null
    }

    var live = img.currentSrc
    if (live.indexOf(FROM) === -1) return null
    var next = swap(live)
    return next === live ? null : next
  }

  function applyTile(tile) {
    var state = tile.getAttribute('data-rtl-art')
    // 'checking' is in flight; 'unavailable' means the art is not there and
    // re-probing on every mutation would be a request loop.
    if (state === '1' || state === 'checking' || state === 'unavailable') return

    var nodes = tile.querySelectorAll('source[srcset], img[src]')
    var plans = []
    for (var i = 0; i < nodes.length; i++) {
      var plan = planned(nodes[i])
      if (plan) plans.push(plan)
    }
    if (!plans.length) return

    var url = probeUrl(tile)
    if (!url) return

    tile.setAttribute('data-rtl-art', 'checking')
    var probe = new Image()
    probe.onerror = function () { tile.setAttribute('data-rtl-art', 'unavailable') }
    probe.onload = function () {
      for (var j = 0; j < plans.length; j++) {
        // Re-read: the bundle may have re-rendered while the probe was in
        // flight, and writing a stale value back would undo its work.
        if ((plans[j].node.getAttribute(plans[j].attr) || '') !== plans[j].was) continue
        plans[j].node.setAttribute(plans[j].attr, plans[j].now)
      }
      tile.setAttribute('data-rtl-art', '1')
    }
    probe.src = url
  }

  /** Back to English: put the tile back and forget, so a later switch to
   *  Arabic re-applies. Without this the attribute would pin whichever
   *  language the page happened to load in. */
  function revertTile(tile) {
    if (!tile.getAttribute('data-rtl-art')) return
    var nodes = tile.querySelectorAll('source[srcset], img[src]')
    for (var i = 0; i < nodes.length; i++) {
      var attr = nodes[i].tagName === 'SOURCE' ? 'srcset' : 'src'
      var v = nodes[i].getAttribute(attr) || ''
      if (v.indexOf(TO) === -1) continue
      nodes[i].setAttribute(attr, v.replace(new RegExp(TO, 'g'), FROM))
    }
    tile.removeAttribute('data-rtl-art')
  }

  function apply() {
    var tiles = document.querySelectorAll(TILE)
    for (var i = 0; i < tiles.length; i++) {
      if (isArabic()) applyTile(tiles[i])
      else revertTile(tiles[i])
    }
  }

  function start() {
    apply()
    // The bundle re-renders on a language change and on its own picture
    // fallback. Attribute changes are watched too, because a re-render can
    // reuse the node and only rewrite src.
    try {
      new MutationObserver(apply).observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['src', 'srcset', 'lang', 'dir', 'class'],
      })
    } catch (e) { /* an observer that cannot attach must not take the swap with it */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
