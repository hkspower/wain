/* Sporta — a small SALE badge on product CARDS, in the grid.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * The owner asked for "small SALE / NEW badge when relevant". Measured
 * before writing a line of this: a discounted card already shows a
 * strikethrough original price next to the current one (the bundle's own
 * `e.on_sale && <s>{list_price}</s>` in the price line), but nothing on the
 * IMAGE marks the card as discounted the way "الأكثر مبيعًا" / "Bestseller"
 * does for a featured product. That is the gap this fills.
 *
 * NOTHING NEW IS ASKED OF THE SERVER OR INVENTED ON THE CLIENT. This does
 * not re-derive "is this on sale" from a price comparison of its own — it
 * reads the <s> element the bundle already renders, which only exists when
 * the bundle's own `on_sale` flag (computed server-side from sale_price /
 * sale_starts_at / sale_ends_at, see api.php) was true. If the bundle ever
 * stops rendering that strikethrough, this stops adding badges — it cannot
 * disagree with the page about which products are discounted.
 *
 * ------------------------------------------------------------- WHAT IT SKIPS
 *
 * A "NEW" badge is NOT built here, on purpose. ?r=products exposes no
 * created_at or any other freshness flag for a product — checked directly
 * against a live response before starting this file, the same way brand
 * logos and colour swatches were checked elsewhere in this pass. The
 * database table DOES have a created_at column, but nothing serves it to the
 * browser, and picking an arbitrary "how many days counts as new" cutoff on
 * the client, with no server signal to anchor it, is exactly the kind of
 * invented data this shop's other passes have refused to fabricate. Adding
 * that column to the API response is a real, small backend change — but a
 * different one from this overlay, and one the owner should sign off on
 * (including what "new" should mean) rather than finding it decided for them
 * inside a badge script.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * Bottom-start of the card image. Top-start already carries the featured
 * badge, top-end the wishlist heart, bottom-end the quick-add button —
 * bottom-start was freed up by moving the brand chip (see brand-badge.js)
 * out of the photo and into the text block above the name, so this is the
 * one corner with nothing on it, not a guess.
 */
;(function () {
  'use strict'

  var LABEL = { en: 'Sale', ar: 'تخفيض' }

  var apply = function () {
    var ar = (document.documentElement.lang || 'ar').slice(0, 2) === 'ar'
    var links = document.querySelectorAll('a[href*="/product/"]')
    for (var i = 0; i < links.length; i++) {
      var a = links[i]
      if (a.getAttribute('data-sporta-sale')) continue
      if (!a.querySelector(':scope > img')) continue /* a card, not a text link */

      var info = a.nextElementSibling
      var priceEl = info ? info.querySelector('.price-card') : null
      var onSale = !!(priceEl && priceEl.querySelector('s'))
      /* Only "yes" is permanent. Unlike brand-badge.js's lookup (built from
         its own fetch, independent of render timing), this reads the price
         the SPA has already painted — and on first run that price node can
         still be a moment from carrying its <s>, e.g. straight after
         navigation before the grid's own data settles. Flagging a "no" here
         would freeze a card that is genuinely on sale as un-badged for the
         rest of the page's life the first time this ran a beat too early.
         Leaving "no" unflagged costs one more querySelector next mutation,
         on cards that mostly won't exist for long anyway (the grid
         re-renders wholesale on navigation and filtering). */
      if (!onSale) continue
      a.setAttribute('data-sporta-sale', '1')

      var span = document.createElement('span')
      span.className = 'sale-chip absolute bottom-2 start-2 z-10 rounded-lg bg-rose-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white'
      span.setAttribute('data-sporta-sale-chip', '1')
      span.textContent = ar ? LABEL.ar : LABEL.en
      a.appendChild(span)
    }
  }

  apply()

  /* Same re-render-safe pattern as brand-badge.js, and the same reason: the
     grid is re-rendered on navigation, filtering and language switch, and
     our own appends are mutations too — flagged, so the observer does not
     answer itself forever. A sale starting or ending mid-session while the
     tab stays open on /shop is not handled live, on purpose: re-deriving
     that here would mean re-adding and possibly re-removing chips on every
     unrelated DOM mutation the page makes, one apply() triggering another
     via the very MutationObserver that is supposed to be debounced. A card
     already marked `data-sporta-sale` is left alone, exactly like a card
     brand-badge.js has already marked `data-sporta-brand` — reloading (or a
     fresh navigation, which the SPA already re-renders the grid for) picks
     up a changed sale window the same way it already picks up a changed
     price. */
  var queued = false, ours = false
  new MutationObserver(function () {
    if (ours || queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      ours = true
      try { apply() } finally { ours = false }
    })
  }).observe(document.body, { childList: true, subtree: true })
})()
