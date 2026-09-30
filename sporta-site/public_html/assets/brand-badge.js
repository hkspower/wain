/* Sporta — the brand (logo, or its NAME when there is no logo)
 * on product CARDS, in the grid. See the 2026-09-28 note in
 * the data block below; the history underneath is from when it drew logos only.
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

      /* slug -> what the card needs. Since 2026-09-28 ("rebuild product
         cards") EVERY product with a brand is in here, not only brands with a
         logo: the live shop has 0 of 8 logos, so a logo-only rule drew nothing
         on any card. A brand with a logo still shows the logo; one without
         shows its NAME. */
      var byslug = {}
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i]
        if (!p || !p.slug) continue
        byslug[p.slug] = {
          slug: p.brand_slug || '',
          logo: !!(p.brand_slug && Number(p.brand_has_logo)),
          v: p.brand_logo_v || '',
          ar: p.brand_name_ar || '',
          en: p.brand_name_en || '',
          colour: p.colour || null,
        }
      }

      var apply = function () {
        var ar = (document.documentElement.lang || 'ar').slice(0, 2) === 'ar'

        /* The language can change under a card the grid did not re-render,
           so text this file wrote is re-labelled on every pass — the only
           thing re-visited, and cheap: a handful of spans. */
        var named = document.querySelectorAll('[data-sporta-brand-name]')
        for (var k = 0; k < named.length; k++) {
          var el = named[k]
          var want = el.getAttribute(ar ? 'data-ar' : 'data-en') || ''
          if (el.textContent !== want) el.textContent = want
        }

        /* The colour line (2026-09-30, the owner's card picture: a dot and the
           colour's name under the product name) is re-labelled the same way. */
        var cols = document.querySelectorAll('[data-sporta-colour]')
        for (var q = 0; q < cols.length; q++) {
          var cw = cols[q].getAttribute(ar ? 'data-ar' : 'data-en') || ''
          var ct = cols[q].lastChild
          if (ct && ct.textContent !== cw) ct.textContent = cw
        }

        var links = document.querySelectorAll('a[href*="/product/"]')
        for (var i = 0; i < links.length; i++) {
          var a = links[i]
          if (a.getAttribute('data-sporta-brand')) continue

          /* A CARD, not any link to a product. The grid's card is an <a> that
             wraps the photograph; a text link in prose is not one. */
          var img = a.querySelector(':scope > img')
          if (!img) continue

          var href = a.getAttribute('href') || ''
          var m = href.match(/\/product\/([^/?#]+)/)
          if (!m) continue
          var b = byslug[decodeURIComponent(m[1])]
          /* Marked either way: a card with nothing to add must not be
             re-examined on every mutation for the life of the page. */
          a.setAttribute('data-sporta-brand', b && b.slug ? b.slug : 'none')
          if (!b) continue

          /* The name lives in a SIBLING of this image link, not inside it —
             `<a class="aspect-[4/5]…">` (the photo) then
             `<div class="flex flex-col gap-1 pt-3"><a><h3>name</h3></a>…`.
             Everything here ADDS a node; nothing on the card is moved or
             removed. */
          var info = a.nextElementSibling
          if (!info) continue

          /* THE COLOUR LINE, for any product that has one — brand or no brand.
             It goes after the name link and before the price, and is a plain
             added node like everything else here. */
          if (b.colour && !info.querySelector('[data-sporta-colour]')) {
            var cl = document.createElement('span')
            cl.className = 'sporta-card-colour'
            cl.setAttribute('data-sporta-colour', b.colour.key)
            cl.setAttribute('data-ar', b.colour.ar)
            cl.setAttribute('data-en', b.colour.en)
            var dot = document.createElement('i')
            dot.className = 'sporta-card-colour__dot'
            dot.style.background = /^#[0-9a-fA-F]{6}$/.test(b.colour.hex) ? b.colour.hex : '#888'
            cl.appendChild(dot)
            cl.appendChild(document.createTextNode(ar ? b.colour.ar : b.colour.en))
            var nameLink = info.querySelector(':scope > a')
            if (nameLink && nameLink.nextSibling) info.insertBefore(cl, nameLink.nextSibling)
            else info.appendChild(cl)
          }

          if (!b.slug) continue
          var span = document.createElement('span')
          span.className = 'brand-chip-inline flex items-center gap-1'
          span.setAttribute('data-sporta-brand-chip', '1')

          if (b.logo) {
            var logo = document.createElement('img')
            logo.className = 'h-3.5 w-auto max-w-16 object-contain'
            logo.setAttribute('loading', 'lazy')
            logo.setAttribute('decoding', 'async')
            /* alt is the BRAND NAME, in the page's language. */
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
          } else {
            var name = document.createElement('span')
            name.className = 'sporta-brand-name'
            name.setAttribute('data-sporta-brand-name', '1')
            name.setAttribute('data-ar', b.ar || b.en || '')
            name.setAttribute('data-en', b.en || b.ar || '')
            name.textContent = ar ? (b.ar || b.en) : (b.en || b.ar)
            if (!name.textContent) continue
            span.appendChild(name)
          }
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
      /* documentElement, and `lang` too: a language switch changes that
         attribute and the grid's TEXT, neither of which is a childList
         change on body, and the brand names this file wrote must follow it. */
      }).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['lang'],
      })
    })
    .catch(function () { /* the grid stays exactly as it was. */ })
})()
