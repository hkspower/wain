/* Sporta — an owner-editable body for Privacy, Terms and Returns.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-17 as "make editer for all policys pages at admin".
 * All three pages are compiled into a bundle whose source is not in this
 * repository, so changing a word of them has always meant a rebuild by
 * whoever holds the site's source — the same problem footer.js and
 * contact.js already solved for the footer text and the contact details.
 * ?r=legal reads a `legal` settings row (privacy_en/ar, terms_en/ar,
 * returns_en/ar), and this script swaps it into the page when a field is
 * non-empty.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * Privacy and Terms are structurally identical: h1, a "Last updated" line
 * with a <time>, then an intro paragraph and a <div class="mt-10 space-y-9">
 * of numbered sections. EVERYTHING FROM THE INTRO PARAGRAPH ONWARD is what
 * gets replaced — the heading and the date stay exactly as the bundle
 * renders them, because a rewritten body still needs a date and a title.
 * The replacement is a PLAIN PARAGRAPH EDITOR: the owner's text is split on
 * blank lines into paragraphs, which is what a free-text box can safely do
 * without inventing an HTML parser. It loses the bundle's own numbered
 * headings if the owner replaces the text — a plain editor's trade, not a
 * rich one's.
 *
 * Returns is different on purpose: the order-lookup card, the phone field
 * and the size/fit picker are INTERACTIVE, and an overlay that swapped them
 * out would be rebuilding a control rather than replacing text — the
 * mistake this project has already made once with a duplicate checkbox (see
 * CLAUDE.md's storage-scan entry). So only the one descriptive paragraph
 * above them (`<p class="mb-8 max-w-2xl …">`) is swapped, as a SINGLE STRING
 * rather than a paragraph list — there is only ever one of it.
 *
 * ----------------------------------------------------------- WHAT IT SKIPS
 *
 * A page whose field is empty. Empty means "use the bundle's own text",
 * same rule as footer.js and contact.js, and it is the state every shop
 * starts in — nothing changes here until an owner has actually written
 * something in the panel.
 *
 * ------------------------------------------------------------------- MARKUP
 *
 * `textContent`, never `innerHTML` — the same guard theme.js uses for its
 * custom-CSS field, for the same reason: assigning textContent parses no
 * markup at all, so nothing the owner types can inject an element, and
 * admin.php already refuses `</` in the field as a second, independent
 * guard on the one kind of value here with no shape to check.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * contact.js and footer.js. If a page's expected structure is not found —
 * the "Last updated" paragraph missing on Privacy/Terms, or the returns
 * paragraph missing on Returns — nothing is touched on that page. This can
 * only ever REPLACE text it found in the expected place, never invent a
 * new one.
 *
 * A THROTTLE, NOT A DEBOUNCE — brand-strip.js's own finding, re-applied
 * before it could bite here too: a queued flag plus requestAnimationFrame,
 * which runs at most once per frame, rather than clearTimeout+setTimeout,
 * which starves forever against a page that keeps mutating.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-legal'
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  var legal = null
  var fetching = false
  function loadLegal(cb) {
    if (legal !== null) { cb(legal); return }
    if (fetching) return
    fetching = true
    fetch(api + '/api.php?r=legal', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (t) { legal = t || {}; cb(legal) })
      .catch(function () { legal = {}; cb(legal) })
  }

  /* Splits on one-or-more blank lines, drops empty fragments (leading/
     trailing blank lines, a run of three newlines) rather than emitting a
     paragraph with nothing in it. */
  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/)
      .map(function (p) { return p.trim() })
      .filter(function (p) { return p !== '' })
  }

  function placePrivacyOrTerms(key) {
    var main = document.querySelector('main')
    if (!main) return
    var dateP = main.querySelector('p.mt-2.text-sm.text-slate-600')
    if (!dateP || !dateP.parentNode) return

    loadLegal(function (t) {
      var main2 = document.querySelector('main')
      var dateP2 = main2 ? main2.querySelector('p.mt-2.text-sm.text-slate-600') : null
      if (!dateP2 || !dateP2.parentNode) return

      var text = t[key + '_' + lang()]
      var already = main2.querySelector('[' + MARK + '="body"]')

      if (!text) {
        // No override (or it was cleared): leave the bundle's own markup
        // alone. Nothing to remove — if `already` exists here, the page has
        // just re-rendered from the bundle itself and our wrapper is gone
        // with it already, same as the graceful-degradation case.
        return
      }

      if (already && already.textContent === paragraphs(text).join('')) return

      var wrapper = replaceBodyAfter(dateP2, text)
      if (wrapper) dateP2.parentNode.insertBefore(wrapper, dateP2.nextSibling)
    })
  }

  /* Removes every sibling after `afterEl` up to (and including) an existing
     wrapper if one is there, or the bundle's own intro+sections if not, then
     returns a fresh wrapper built from `text` — never both an old and a new
     copy on screen at once. */
  function replaceBodyAfter(afterEl, text) {
    var parts = paragraphs(text)
    if (!parts.length) return null

    var node = afterEl.nextSibling
    while (node) {
      var next = node.nextSibling
      node.parentNode.removeChild(node)
      node = next
    }

    var wrapper = document.createElement('div')
    wrapper.setAttribute(MARK, 'body')
    for (var i = 0; i < parts.length; i++) {
      var p = document.createElement('p')
      p.className = i === 0
        ? 'mt-6 text-lg leading-relaxed text-slate-600'
        : 'mt-4 leading-relaxed text-slate-600'
      p.textContent = parts[i]
      wrapper.appendChild(p)
    }
    return wrapper
  }

  function placeReturns() {
    var main = document.querySelector('main')
    if (!main) return
    var p = main.querySelector('p.mb-8.max-w-2xl.text-slate-600')
    if (!p) return

    loadLegal(function (t) {
      var main2 = document.querySelector('main')
      var p2 = main2 ? main2.querySelector('p.mb-8.max-w-2xl.text-slate-600') : null
      if (!p2) return

      var text = t['returns_' + lang()]
      if (!text) return
      if (p2.getAttribute(MARK) === 'returns' && p2.textContent === text) return

      p2.textContent = text
      p2.setAttribute(MARK, 'returns')
    })
  }

  function place() {
    var path = location.pathname
    if (path === '/privacy') placePrivacyOrTerms('privacy')
    else if (path === '/terms') placePrivacyOrTerms('terms')
    else if (path === '/returns') placeReturns()
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
