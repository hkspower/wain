/* Sporta — small icons on the footer's existing KNET / Cash-on-delivery pills.
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
 *   `['knet', 'tpay', 'cod']` — Visa and Mastercard are not separate accepted
 *   methods, whatever card network sits behind T-Pay's own processing. Adding
 *   their marks to the footer would claim direct acceptance this shop cannot
 *   back up, which is a compliance question for the merchant agreement, not a
 *   design one. The two pills already in the footer — KNET, cash on delivery
 *   — are the two methods this gets icons for. Nothing else.
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
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * contact.js and trust-strip.js. If neither span is found — a copy change,
 * a rebuilt bundle — nothing is inserted, and the plain-text pills are
 * exactly as they were before this file existed.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-pay-icon'
  var LABELS = ['KNET', 'الدفع عند الاستلام', 'Cash on delivery']

  var ICONS = {
    KNET:
      '<rect x="2" y="5" width="20" height="14" rx="2.2" /><path d="M2 9.5h20" />' +
      '<rect x="5" y="13" width="5" height="2.6" rx="0.6" />',
    cod:
      '<circle cx="12" cy="12" r="9" /><path d="M9 9.5c0-1 1-1.7 3-1.7s3 .7 3 1.7-1 1.4-3 1.9-3 .9-3 1.9 1 1.7 3 1.7 3-.7 3-1.7" />' +
      '<path d="M12 6.6V6M12 18v-.6" />',
  }

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
    span.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ' +
      'style="width:100%;height:100%;">' + ICONS[which] + '</svg>'
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
