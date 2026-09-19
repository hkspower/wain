/* Sporta — make the shop's phone, WhatsApp and email editable from /backends.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Those three details are hard-coded into the built storefront in seven files
 * — Contact, About, Privacy, Terms, Returns, Invoice and the footer — because
 * they were written into the source, and the source is not in this repository.
 * Changing the shop's phone number therefore meant a rebuild by whoever holds
 * it, and until they got round to it the invoice would keep printing the old
 * number. The owner asked to manage this from the panel; this is the only way
 * to do that without editing minified JavaScript by hand, which is how you get
 * a shop that renders a blank page.
 *
 * ------------------------------------------------------------- WHAT IT TOUCHES
 *
 * Only the three values, and only where they already appear:
 *
 *   - href="mailto:…", href="tel:…", href="https://wa.me/…"
 *   - the exact old strings where they sit in visible prose, in both
 *     languages — "تواصل معنا عبر واتساب ‎+965 2209 1914" and its English twin.
 *
 * It matches the OLD LITERALS, not a pattern. A regular expression for "a
 * Kuwaiti phone number" would also match the courier's number in the returns
 * policy, a number in a customer's own address on the invoice, and any order
 * reference that happened to look numeric. The literals are the three values
 * the build actually contains, and they are listed below.
 *
 * ------------------------------------------------- AND IT USUALLY DOES NOTHING
 *
 * The server's defaults for these are the values already in the bundle. So
 * until somebody saves a change in the panel, every replacement is a no-op and
 * the script exits before touching the DOM at all. That is deliberate: the day
 * this is uploaded, nothing on the site moves. It only ever acts on a
 * difference the owner has deliberately created.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * This is DOM surgery on a page whose source I do not hold, and it should be
 * read as such. If the storefront is ever rebuilt, the literals below have to
 * be re-checked against the new bundle — and if they no longer match, the
 * script quietly does nothing rather than corrupting anything, which is the
 * failure mode to prefer. Deleting the <script> tag in index.html reverts the
 * whole thing.
 */
(function () {
  'use strict'

  /* The values as the BUILD contains them. Anything not listed here is not
     touched, and a value the build does not contain cannot be replaced. */
  var BUILT = {
    phone: '+965 2209 1914',
    whatsapp: '96522091914',
    email: 'cs@sporta.com.kw'
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  fetch(api + '/api.php?r=contact', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (c) {
      if (!c) return

      /* THE PAIRS TO SWAP, and only the ones that actually differ. An empty
         value from the server means "not set", and is skipped rather than
         treated as "blank it" — clearing the shop's phone number off every
         page because a field was left empty is the worst thing this script
         could do. */
      var swaps = []
      var add = function (from, to) {
        if (to && from && to !== from) swaps.push([from, to])
      }
      add(BUILT.phone, c.phone)
      add(BUILT.whatsapp, c.whatsapp)
      add(BUILT.email, c.email)
      if (!swaps.length) return          // the usual case: nothing to do

      var apply = function (root) {
        /* 1. LINKS. href first, because a mailto: or wa.me href that still
              points at the old address is the failure that actually costs a
              customer — the visible text being stale is cosmetic, an
              unanswered email is not. */
        var links = root.querySelectorAll ? root.querySelectorAll('a[href]') : []
        for (var i = 0; i < links.length; i++) {
          var a = links[i]
          var href = a.getAttribute('href')
          if (!href) continue
          if (!/^(mailto:|tel:)|wa\.me\//.test(href)) continue
          var next = href
          for (var s = 0; s < swaps.length; s++) {
            // tel: and wa.me hold digits only; the display phone has spaces in
            // it. Compare against both spellings of the old number.
            next = next.split(swaps[s][0]).join(swaps[s][1])
            next = next.split(swaps[s][0].replace(/[^0-9+]/g, ''))
                       .join(swaps[s][1].replace(/[^0-9+]/g, ''))
          }
          if (next !== href) a.setAttribute('href', next)
        }

        /* 2. VISIBLE TEXT, one text node at a time.
              Never innerHTML: these strings sit inside sentences that also
              carry <a> and <span>, and rewriting the parent's HTML would
              destroy React's own references to those nodes and break the page
              on the next render. Replacing the data of a text node leaves the
              tree exactly as it was. */
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
        var node, edits = []
        while ((node = walker.nextNode())) {
          var t = node.nodeValue
          if (!t || t.length < 8) continue
          var out = t
          for (var k = 0; k < swaps.length; k++) out = out.split(swaps[k][0]).join(swaps[k][1])
          if (out !== t) edits.push([node, out])
        }
        // Collected first, applied after: mutating during a TreeWalker's own
        // traversal is how you skip nodes.
        for (var e = 0; e < edits.length; e++) edits[e][0].nodeValue = edits[e][1]
      }

      apply(document.body)

      /* THE SHOP IS A SINGLE-PAGE APP, so /contact, /terms and /privacy are
         rendered after this script has already run, and re-rendered on every
         navigation. One pass at load would fix whichever page happened to be
         open and no other.

         The observer is debounced through requestAnimationFrame because React
         mutates in bursts; running the walk per mutation would be a full text
         scan of the document dozens of times per navigation. And because our
         own edits are mutations too, the flag stops the observer answering
         itself — without it this is an infinite loop that pins a phone. */
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
    .catch(function () { /* the shop's own numbers stay on the page. */ })
})()
