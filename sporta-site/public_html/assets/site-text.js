/* Sporta — the owner's own wording, applied over the built storefront.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * The whole vocabulary of this site — every heading, button, empty state and
 * error message, about 420 strings in each language — lives in one object
 * inside the compiled bundle:
 *
 *     var g = { en: { nav: { home: `Home`, … } }, ar: { … } }
 *
 * It is scoped to that module, attached to no global and exported nowhere, so
 * nothing at runtime can read or patch it. Changing a single word therefore
 * meant a rebuild by whoever holds the source. This does what footer.js and
 * contact.js already do for their handful of strings, for the rest of the
 * site: swap the text in the DOM, from values the owner typed in the panel.
 *
 * ------------------------------------------------------- WHAT IT COSTS A SHOPPER
 *
 * Almost nothing, and that is by design. The CATALOGUE of every string the
 * site can say is 51 kB, and it is never fetched here — it is a static file
 * the PANEL reads. What this fetches is the overrides alone, so a shop that
 * has never opened the editor gets `{}` and returns immediately, and a shop
 * that has rewritten five lines carries ten strings to look for, which is what
 * footer.js carries today.
 *
 * ------------------------------------------------------------ HOW IT MATCHES
 *
 * EXACTLY, AND ON A WHOLE TEXT NODE — not as a substring, which is where this
 * differs from footer.js and had to. That file's shortest string is eight
 * characters of distinctive prose; this one swaps words like "Home" and "Bag",
 * and a substring pass would rewrite them inside every sentence that happened
 * to contain them. React renders each `t.nav.home` as its own text node, so
 * the whole trimmed value is the right unit and an exact match is also O(1)
 * per node rather than one pass per override.
 *
 * THE LIMIT THAT FOLLOWS: a string the bundle splices into a longer sentence
 * is not swapped, because it never occupies a node of its own. The catalogue
 * already excludes the strings that carry a value the page fills in — "Show
 * {n} more" arrives as "Show 12 more" and could never be matched — and this is
 * the same boundary seen from the other side.
 *
 * BOTH LANGUAGES ARE IN THE MAP AT ONCE, which is what makes the language
 * toggle work. The shop switches without reloading and re-renders every string
 * straight from that object, so a script that read html[lang] once would be
 * wrong the moment somebody pressed EN. Every Arabic original maps to its
 * Arabic replacement and every English original to its English one; only the
 * strings actually on the page can match.
 *
 * NOT ON /backends. The panel is where these strings are being EDITED, and an
 * editor whose own labels have been rewritten by the edit under way is an
 * editor you cannot trust — you would be reading the replacement while trying
 * to decide whether to make it. theme.js skips the panel with its custom CSS
 * for a neighbouring reason.
 */
;(function () {
  'use strict'

  /* The panel edits this; it must not also be subject to it. */
  if (/^\/backends(\/|$)/.test(location.pathname)) return

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  fetch(api + '/api.php?r=site_text', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (rows) {
      /* PHP hands back `[]` for an empty row and `{}` once it has keys, so
         both shapes arrive here and neither is an error. */
      if (!rows || typeof rows !== 'object') return

      /* original -> replacement, both languages in one map. */
      var map = {}
      var n = 0
      for (var key in rows) {
        if (!Object.prototype.hasOwnProperty.call(rows, key)) continue
        var entry = rows[key]
        if (!entry || typeof entry !== 'object') continue
        for (var i = 0; i < 2; i++) {
          var pair = entry[i === 0 ? 'en' : 'ar']
          if (!pair || pair.length !== 2) continue
          var from = String(pair[0]), to = String(pair[1])
          if (!from || !to || from === to) continue
          map[from] = to
          n++
        }
      }
      if (!n) return                        /* the usual case: nothing to do */

      /* Text inside these is not prose on the page. A <script> containing the
         word "Home" is not a heading, and rewriting a <textarea>'s content
         edits something a person is typing into. */
      var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, TITLE: 1 }

      /* One text node at a time, never innerHTML: these strings sit beside
         <a> and <span> that React holds references to, and rewriting a
         parent's HTML breaks the page on its next render. */
      var apply = function (root) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        var node, edits = []
        while ((node = walker.nextNode())) {
          var raw = node.nodeValue
          if (!raw) continue
          var parent = node.parentNode
          if (parent && SKIP[parent.nodeName]) continue
          var trimmed = raw.trim()
          if (!trimmed) continue
          var to = map[trimmed]
          if (to === undefined) continue
          /* split/join rather than replace(): a replacement containing `$&`
             or `$1` is the owner's literal text, not a pattern. Splitting on
             the trimmed value keeps whatever whitespace surrounded it. */
          edits.push([node, raw.split(trimmed).join(to)])
        }
        /* Collected first, applied after: mutating during a TreeWalker's own
           traversal is how you skip nodes. */
        for (var e = 0; e < edits.length; e++) edits[e][0].nodeValue = edits[e][1]
      }

      apply(document.body)

      /* The shop is a single-page app: every navigation and every language
         switch re-renders from the bundle's own dictionary, so one pass at
         load would fix whichever page happened to be open and no other.

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
    .catch(function () { /* the built-in wording stays on the page. */ })
})()
