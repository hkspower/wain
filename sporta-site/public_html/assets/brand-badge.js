/* Sporta — the brand logo on product CARDS, in the grid.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * The product PAGE already shows it. Measured before writing a line of this:
 * seeding a logo and loading /product/<slug> renders
 * <span class="brand-chip"><img src="…?r=brand_logo&slug=…&v=…"> and the
 * request answers 200. The grid renders none — zero brand images on /shop.
 * So this is the missing half, not a new feature, and it deliberately reuses
 * the page's own markup rather than inventing a second treatment.
 *
 * NOTHING NEW IS ASKED OF THE SERVER. ?r=products already carries brand_slug,
 * brand_has_logo and brand_logo_v for every row — added for the product page —
 * and ?r=brand_logo serves the bytes under a content-hashed URL cached for a
 * year. This file is one fetch the shop was making anyway.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * UPDATED 2026-09-20: above the product name, in the text block below the
 * photo — not floating on the image. It previously sat at the image's
 * bottom-start corner (the only free one, since the card already carries a
 * badge at top-start, the wishlist button at top-end and the add-to-cart
 * button at bottom-end), which was a reasonable place to put a NEW element
 * but is not "above the name" by any reading of that phrase — the name is a
 * sibling of the photo, not inside it, so no amount of CSS on the old node
 * gets there. The chip is now a real (small, inline, non-absolute) node
 * inserted as the first child of that sibling info block, sized down from
 * the product page's h-8 because a card is smaller than a page.
 *
 * ----------------------------------------------------------- WHAT IT SKIPS
 *
 * A brand with no logo, and a product with no brand. brand_has_logo is the
 * server's answer to both, and it already accounts for a logo dropped into
 * images/<slug>/ as well as one stored in the database. A card whose product
 * is not in the map is left exactly as it was — this can only ever ADD an
 * element, never move or remove one.
 *
 * As of 2026-09-05 the live shop has NO brand logos at all (0 of 8), so this
 * renders nothing there until the owner uploads them in /backends. That is the
 * correct behaviour and it is also why it cannot be verified by looking at the
 * live site today.
 */
;(function () {
  'use strict'

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (rows) {
      if (!rows || !rows.length) return

      /* slug -> what is needed to draw its badge. Only products whose brand
         actually has a logo are in here, so the lookup below doubles as the
         "should this card get one" test. */
      var byslug = {}, n = 0
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i]
        if (!p || !p.slug || !Number(p.brand_has_logo) || !p.brand_slug) continue
        byslug[p.slug] = {
          slug: p.brand_slug,
          v: p.brand_logo_v || '',
          ar: p.brand_name_ar || '',
          en: p.brand_name_en || '',
        }
        n++
      }
      if (!n) return                     /* no brand has a logo: nothing to do */

      var apply = function () {
        var ar = (document.documentElement.lang || 'ar').slice(0, 2) === 'ar'
        var links = document.querySelectorAll('a[href*="/product/"]')
        for (var i = 0; i < links.length; i++) {
          var a = links[i]
          if (a.getAttribute('data-sporta-brand')) continue

          /* A CARD, not any link to a product. The grid's card is an <a> that
             wraps the photograph; a text link in prose is not one, and putting
             an absolutely-positioned logo inside it would place it over
             whatever happened to be nearby. */
          var img = a.querySelector(':scope > img')
          if (!img) continue

          var href = a.getAttribute('href') || ''
          var m = href.match(/\/product\/([^/?#]+)/)
          if (!m) continue
          var b = byslug[decodeURIComponent(m[1])]
          /* Marked either way: a card with no logo must not be re-examined on
             every mutation for the life of the page. */
          a.setAttribute('data-sporta-brand', b ? b.slug : 'none')
          if (!b) continue

          /* WHERE IT GOES, updated 2026-09-20 at the owner's request: "brand
             logo/name above product name". Measured before moving anything:
             the name lives in a SIBLING of this image link, not inside it —
             `<a class="aspect-[4/5]…">` (the photo) is followed by
             `<div class="flex flex-col gap-1 pt-3"><a><h3>name</h3></a>…`.
             An absolutely-positioned chip over the photo can never satisfy
             "above the name" because it is not in that flow at all — moving
             it there means inserting a real DOM node as the first child of
             that info div, not repositioning with CSS. This can still only
             ADD a node; nothing already on the card is moved or removed. */
          var info = a.nextElementSibling
          if (!info) continue

          var span = document.createElement('span')
          span.className = 'brand-chip-inline flex items-center gap-1'
          span.setAttribute('data-sporta-brand-chip', '1')

          var logo = document.createElement('img')
          logo.className = 'h-3.5 w-auto max-w-16 object-contain'
          logo.setAttribute('loading', 'lazy')
          logo.setAttribute('decoding', 'async')
          /* alt is the BRAND NAME, in the page's language. Not "brand logo":
             a screen reader saying "brand logo" twelve times down a grid tells
             the listener nothing about which brands are on the page. */
          logo.setAttribute('alt', (ar ? b.ar : b.en) || b.slug)
          logo.src = api + '/api.php?r=brand_logo&slug=' + encodeURIComponent(b.slug) +
                     (b.v ? '&v=' + encodeURIComponent(b.v) : '')
          /* A logo that 404s must not leave an empty box on the card. */
          logo.onerror = function () {
            if (this.parentNode && this.parentNode.parentNode) {
              this.parentNode.parentNode.removeChild(this.parentNode)
            }
          }

          span.appendChild(logo)
          info.insertBefore(span, info.firstChild)
        }
      }

      apply()

      /* The shop is a single-page app: the grid is re-rendered on navigation,
         on filtering and on a language switch. Debounced through
         requestAnimationFrame because React mutates in bursts, and flagged
         because our own appends are mutations too — without the flag the
         observer answers itself for ever.
         The data-attribute above is what makes re-running cheap: every card
         already seen is skipped, so a re-render costs a querySelectorAll and
         nothing more. */
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
    })
    .catch(function () { /* the grid stays exactly as it was. */ })
})()
