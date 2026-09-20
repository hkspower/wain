/* Sporta — small icons on the footer's existing KNET / Cash-on-delivery pills,
 * and (new) a T-Pay pill of its own when the shop actually accepts it.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for after reviewing a competitor's theme for ideas: its footer shows
 * payment method LOGOS, Sporta's shows the same two methods as plain text
 * pills. The honest version of that idea is narrower than "add payment
 * logos" sounds, for two reasons checked before writing anything:
 *
 *   NO ARTWORK IS ADDED. Visa, Mastercard and KNET's own logo bitmaps are
 *   each somebody else's trademark, and this project already made the
 *   mistake once this session of treating a third party's material as
 *   something to reuse freely — see CLAUDE.md, "the manuals were briefly
 *   committed". Reproducing a card network's actual mark needs their brand
 *   guidelines and, in KNET's case, the same kind of permission that manual
 *   asked for. So: generic single-colour glyphs, drawn here, not logos.
 *
 *   NO METHOD IS ADDED THAT ISN'T ACCEPTED. STORE_PAY_METHODS in store.php is
 *   `['knet', 'tpay', 'cod']`, and which of the three a shop actually offers
 *   is the owner's own `payment_methods` rule (Settings → Shop rules) — public
 *   at ?r=slides because the checkout already has to know which buttons to
 *   show. Visa and Mastercard are still not separate accepted methods,
 *   whatever card network sits behind T-Pay's own processing, so this still
 *   adds no card-network marks. T-Pay itself is a THIRD accepted method with
 *   no pill in the built footer at all — the bundle only ever renders KNET and
 *   cash-on-delivery there — so getting it an icon means adding a pill, not
 *   decorating one.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * The footer already renders exactly two pills, in a `div.mt-8.flex...` row,
 * matched by their EXACT text — "KNET" in both languages, "الدفع عند
 * الاستلام" / "Cash on delivery" for the other — the same literal-string
 * discipline contact.js already uses and explains: a pattern for "a payment
 * method" would also match a price, a product name, anything numeric or
 * English in the footer's other columns. An icon is PREPENDED inside the
 * matched span; the visible text is never touched, so a language switch that
 * re-renders the span from scratch is unaffected — the next mutation the
 * observer sees just re-runs the match and the icon reappears.
 *
 * THE T-PAY PILL IS CLONED FROM A REAL ONE, never built from guessed markup.
 * contact.js and footer.js both stop short of adding or removing nodes for
 * exactly this reason — a class name, a wrapper, a data attribute typed from
 * memory is a guess about a bundle with no source here, and a wrong guess is
 * a pill that renders wrong or not at all. Cloning the KNET pill and only
 * replacing its label and icon means the new pill inherits the real classes,
 * padding and colours at runtime, from whichever markup the live page
 * actually has — nothing about its shape is assumed.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * contact.js and trust-strip.js. If neither span is found — a copy change,
 * a rebuilt bundle — nothing is inserted, and the plain-text pills are
 * exactly as they were before this file existed. The T-Pay pill additionally
 * depends on ?r=slides answering — if that fetch fails, no T-Pay pill is
 * added and the two existing ones still get their icons.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-pay-icon'
  var LABELS = ['KNET', 'الدفع عند الاستلام', 'Cash on delivery']

  function findPills() {
    var footer = document.querySelector('footer')
    if (!footer) return []
    var spans = footer.querySelectorAll('span')
    var out = []
    for (var i = 0; i < spans.length; i++) {
      var text = spans[i].textContent.trim()
      if (LABELS.indexOf(text) !== -1) out.push(spans[i])
    }
    return out
  }

  function icon(which) {
    var span = document.createElement('span')
    span.setAttribute(MARK, '1')
    span.style.cssText = 'display:inline-flex;width:14px;height:14px;margin-inline-end:5px;vertical-align:-2px;'
    /* Each branch is a single literal string — `which` never reaches the
     * markup itself. A lookup table indexed by `which` reads the same on
     * screen and is not the same thing: it is one more place a future edit
     * could put something other than a fixed literal behind this call. */
    switch (which) {
      case 'KNET':
        span.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
          'style="width:100%;height:100%;">' +
          '<rect x="2" y="5" width="20" height="14" rx="2.2" /><path d="M2 9.5h20" />' +
          '<rect x="5" y="13" width="5" height="2.6" rx="0.6" />' +
          '</svg>'
        break
      case 'tpay':
        // A generic phone-and-waves glyph — T-Pay is CBK's QR/phone payment,
        // not a card network, so this is deliberately not another card shape.
        span.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
          'style="width:100%;height:100%;">' +
          '<rect x="7" y="2" width="10" height="20" rx="2" />' +
          '<path d="M11 18h2" />' +
          '</svg>'
        break
      default:
        span.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
          'style="width:100%;height:100%;">' +
          '<circle cx="12" cy="12" r="9" /><path d="M9 9.5c0-1 1-1.7 3-1.7s3 .7 3 1.7-1 1.4-3 1.9-3 .9-3 1.9 1 1.7 3 1.7 3-.7 3-1.7" />' +
          '<path d="M12 6.6V6M12 18v-.6" />' +
          '</svg>'
    }
    return span
  }

  function place() {
    var pills = findPills()
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i]
      if (pill.querySelector('[' + MARK + ']')) continue   /* already iconed */
      var text = pill.textContent.trim()
      var which = text === 'KNET' ? 'KNET' : 'cod'
      pill.insertBefore(icon(which), pill.firstChild)
    }
    placeTpay()
  }

  // TPAY_ENABLED starts unknown (null) rather than false, so a fetch that has
  // not answered yet adds nothing — the same "empty means leave it alone"
  // rule footer.js and contact.js already follow, here applied to "unknown"
  // rather than to an empty string.
  var TPAY_ENABLED = null
  var TPAY_MARK = 'data-sporta-tpay-pill'

  function tpayLabel() {
    // The built pills' own two languages are literal strings above; T-Pay has
    // no built string to match, so this one is written here rather than read
    // out of the bundle. "T-Pay (CBK)" is the exact label the checkout itself
    // already uses (payment.js / index-*.js), kept the same rather than
    // inventing a shorter one that would read as a different method.
    return (document.documentElement.lang === 'ar') ? 'تي-باي (CBK)' : 'T-Pay (CBK)'
  }

  function placeTpay() {
    if (TPAY_ENABLED !== true) return
    var footer = document.querySelector('footer')
    if (!footer) return
    var existing = footer.querySelector('[' + TPAY_MARK + ']')
    if (existing) {
      // Refreshed every call rather than left as-is, because a language
      // switch that does not fully re-render this row would otherwise leave
      // OUR OWN inserted pill showing the wrong language — the one thing
      // React's own re-render already handles for every pill it owns.
      var t = labelNode(existing)
      if (t) t.nodeValue = tpayLabel()
      return
    }
    var pills = findPills()
    if (!pills.length) return
    var clone = pills[0].cloneNode(true)
    clone.setAttribute(TPAY_MARK, '1')
    var oldIcon = clone.querySelector('[' + MARK + ']')
    if (oldIcon) oldIcon.remove()
    var t = labelNode(clone)
    if (!t) return   /* the template's shape is not what this file expects — decline rather than guess */
    t.nodeValue = tpayLabel()
    clone.insertBefore(icon('tpay'), clone.firstChild)
    var row = pills[0].parentElement
    if (!row) return
    row.appendChild(clone)
  }

  // The pill's visible label is a direct text-node child — the same
  // assumption findPills()/place() already make by reading `textContent`
  // straight off the span with no nested markup expected. Declining when
  // that is not what is found is the same "nothing inserted" fallback the
  // rest of this file uses.
  function labelNode(span) {
    for (var i = 0; i < span.childNodes.length; i++) {
      var n = span.childNodes[i]
      if (n.nodeType === 3 && n.nodeValue.trim()) return n
    }
    return null
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (j) {
      var methods = (j && j.rules && Array.isArray(j.rules.payment_methods)) ? j.rules.payment_methods : []
      TPAY_ENABLED = methods.indexOf('tpay') !== -1
      place()
    })
    .catch(function () { TPAY_ENABLED = false })

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
