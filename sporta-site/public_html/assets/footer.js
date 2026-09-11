/* Sporta — make the footer's prose editable from /backends.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * The footer is compiled into the storefront bundle, and that bundle's source
 * is not in this repository. Changing the strapline, the club invitation or
 * the operating-company line therefore meant a rebuild by whoever holds the
 * source. This is the same answer assets/contact.js gives for the phone and
 * email: swap the text in the DOM, from a value the owner types in the panel.
 *
 * ------------------------------------------------------------- WHAT IT TOUCHES
 *
 * Five strings, in two languages, and nothing else. The link columns and the
 * social icons are structure rather than prose — changing those means adding
 * and removing nodes, which this technique cannot do safely — so they are
 * deliberately out of scope.
 *
 * BOTH LANGUAGES ARE IN THE SWAP LIST AT ONCE, which is what makes the language
 * switch work. The shop changes language without reloading, so a script that
 * read html[lang] once would be wrong the moment somebody pressed EN. Instead
 * every Arabic original maps to the Arabic value and every English original to
 * the English one; only the strings actually on the page can match.
 *
 * EMPTY MEANS "LEAVE IT ALONE". An unset field is skipped rather than treated
 * as "blank it" — the same rule contact.js follows, and for the same reason:
 * erasing the shop's strapline because a box was left empty is the worst thing
 * this script could do.
 *
 * THE ORIGINALS BELOW WERE READ OUT OF THE RENDERED PAGE, not typed. Both
 * languages, from the live text nodes, so the apostrophe in "world's" is the
 * one the bundle actually contains rather than the one a keyboard produces.
 * A near-miss here does not throw — it silently matches nothing.
 */
;(function () {
  'use strict'

  /* What the built page says today. Swaps are keyed off these exact strings. */
  var BUILT = {
    tagline_ar: "موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا.",
    tagline_en: "The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands.",
    club_title_ar: "انضم لنادي سبورتا",
    club_title_en: "Join the Sporta club",
    club_text_ar: "العروض والإصدارات الجديدة — مباشرة على واتساب.",
    club_text_en: "Offers and new drops — straight to WhatsApp.",
    rights_ar: "جميع الحقوق محفوظة.",
    rights_en: "All rights reserved.",
    managed_ar: "متجر سبورتا تحت إدارة شركة المهلب لتصميم وبرمجة البرمجيات الخاصة.",
    managed_en: "Sporta is operated by Al-Muhallab Co. for Designing and Programming Special Software.",
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  fetch(api + '/api.php?r=footer', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (f) {
      if (!f) return

      var swaps = []
      for (var key in BUILT) {
        if (!Object.prototype.hasOwnProperty.call(BUILT, key)) continue
        var from = BUILT[key], to = f[key]
        if (to && from && to !== from) swaps.push([from, to])
      }
      if (!swaps.length) return          /* the usual case: nothing to do */

      /* One text node at a time, never innerHTML: these strings sit beside
         <a> and <span> that React holds references to, and rewriting a
         parent's HTML breaks the page on its next render. */
      var apply = function (root) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        var node, edits = []
        while ((node = walker.nextNode())) {
          var t = node.nodeValue
          if (!t || t.length < 8) continue
          var out = t
          for (var k = 0; k < swaps.length; k++) out = out.split(swaps[k][0]).join(swaps[k][1])
          if (out !== t) edits.push([node, out])
        }
        /* Collected first, applied after: mutating during a TreeWalker's own
           traversal is how you skip nodes. */
        for (var e = 0; e < edits.length; e++) edits[e][0].nodeValue = edits[e][1]
      }

      apply(document.body)

      /* The shop is a single-page app and the footer is re-rendered on every
         navigation and on every language switch, so one pass at load would fix
         whichever page happened to be open and no other.

         Debounced through requestAnimationFrame because React mutates in
         bursts, and flagged because our own edits are mutations too — without
         the flag the observer answers itself for ever. */
      var queued = false, ours = false
      new MutationObserver(function () {
        if (ours || queued) return
        queued = true
        requestAnimationFrame(function () {
          queued = false
          ours = true
          try { apply(document.body) } finally { ours = false }
        })
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    .catch(function () { /* the built-in footer stays on the page. */ })
})()
